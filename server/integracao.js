// Integração com o Emissor NF-e (pacote Pro): o Emissor envia aqui cada nota autorizada (XML
// autorizado) e cada cancelamento. A nota entra pelo mesmo importador do envio de XML (ignora
// repetidas e acha a fazenda pela IE); o cancelamento exclui a nota, como a Conferência faz.
//
// Segurança: só funciona com INTEGRACAO_EMISSOR_SEGREDO definido (32+ caracteres, o mesmo no
// Emissor). Cada pedido leva a hora e uma assinatura HMAC-SHA256 do corpo com esse segredo, e
// pedidos que chegam pela internet (túnel da Cloudflare) são recusados: a conversa é só dentro
// do servidor.
//
// De quem é a nota: pela conta do login único (SaintSSO, `sub`), que no Campo Certo é uma empresa.
// Sem conta (usuário local do Emissor), vale a empresa que tiver o produtor com aquele CPF, se só
// uma tiver.
import crypto from 'node:crypto'
import { registry, companyDatabase } from './tenancy.js'

const segredo = () => String(process.env.INTEGRACAO_EMISSOR_SEGREDO || '')
export const integracaoAtiva = () => segredo().length >= 32
const TOLERANCIA_SEGUNDOS = 300

/** Assinatura do pedido: HMAC-SHA256(segredo, `${hora}\n${sha256(corpo)}`), em hexadecimal. */
export function assinarPedido(secret, hora, corpo) {
  const resumo = crypto.createHash('sha256').update(corpo).digest('hex')
  return crypto.createHmac('sha256', secret).update(`${hora}\n${resumo}`).digest('hex')
}

function conferirAssinatura(req) {
  const hora = Number(req.get('x-integracao-hora'))
  const recebida = String(req.get('x-integracao-assinatura') || '')
  if (!Number.isSafeInteger(hora) || Math.abs(Date.now() / 1000 - hora) > TOLERANCIA_SEGUNDOS) return false
  const esperada = assinarPedido(segredo(), hora, req.corpoBruto || Buffer.alloc(0))
  return recebida.length === esperada.length && crypto.timingSafeEqual(Buffer.from(recebida), Buffer.from(esperada))
}

const soDigitos = valor => String(valor || '').replace(/\D/g, '')
const tag = (xml, nome) => xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`))?.[1]?.trim() || ''

/** Empresa e banco do pedido; `criar` cria o produtor (só para conta do SSO, dona dos dados).
 * `semContaNaCasa`: sem conta do SSO (usuário local do Emissor, que o administrador criou) e sem
 * nenhuma empresa com o produtor, usa a empresa do administrador do Campo Certo. */
function destino({ conta, documento }, { semContaNaCasa = false } = {}) {
  if (conta) {
    const usuario = registry.prepare('SELECT u.company_id FROM users u JOIN companies c ON c.id=u.company_id WHERE u.sso_sub=? AND c.deleted_at IS NULL').get(conta)
    if (!usuario) return { erro: 404, mensagem: 'Esta conta ainda não entrou no Campo Certo.' }
    return { db: companyDatabase(usuario.company_id), criar: true }
  }
  const empresas = registry.prepare('SELECT id FROM companies WHERE deleted_at IS NULL').all()
  const comProdutor = empresas.filter(e => { try { return companyDatabase(e.id).prepare('SELECT 1 FROM producers WHERE cpf=?').get(documento) } catch { return false } })
  if (comProdutor.length === 1) return { db: companyDatabase(comProdutor[0].id), criar: false }
  if (comProdutor.length > 1) return { erro: 409, mensagem: 'Mais de uma empresa tem esse produtor; entre no Emissor pelo login único.' }
  if (semContaNaCasa) {
    const admin = registry.prepare('SELECT u.company_id FROM users u JOIN companies c ON c.id=u.company_id WHERE u.is_admin=1 AND c.deleted_at IS NULL').get()
    if (admin) return { db: companyDatabase(admin.company_id), criar: true }
  }
  return { erro: 404, mensagem: 'Nenhuma empresa do Campo Certo tem esse produtor.' }
}

/** Produtor do CPF; cria com nome e endereço do emitente da nota se a conta for dona dos dados. */
function produtor(db, { documento, nome, xml }, criar) {
  const existente = db.prepare('SELECT * FROM producers WHERE cpf=?').get(documento)
  if (existente || !criar) return existente
  const ender = xml.match(/<enderEmit>([\s\S]*?)<\/enderEmit>/)?.[1] || ''
  const info = db.prepare('INSERT INTO producers (name,cpf,address,address_number,zip_code,neighborhood,complement) VALUES (?,?,?,?,?,?,?)')
    .run(String(nome || tag(xml, 'xNome') || `Produtor ${documento}`).slice(0, 120), documento, tag(ender, 'xLgr'), tag(ender, 'nro'), soDigitos(tag(ender, 'CEP')), tag(ender, 'xBairro'), tag(ender, 'xCpl'))
  return db.prepare('SELECT * FROM producers WHERE id=?').get(info.lastInsertRowid)
}

/** Integração ligada, pedido de dentro do servidor e assinatura certa; senão responde o erro. */
function autorizado(req, res) {
  if (!integracaoAtiva()) { res.status(404).json({ error: 'Integração desativada.' }); return false }
  if (req.get('cf-connecting-ip') || req.get('x-forwarded-for')) { res.status(403).json({ error: 'Integração só dentro do servidor.' }); return false }
  if (!conferirAssinatura(req)) { res.status(401).json({ error: 'Assinatura inválida.' }); return false }
  return true
}

/** Fazenda no formato que o Emissor usa no emitente da NF-e (IE e endereço com município IBGE). */
const fazendaParaEmissor = f => ({
  id: f.id, nome: f.name, ie: soDigitos(f.state_registration),
  endereco: {
    xLgr: f.address || '', nro: f.address_number || 'SN', xCpl: f.complement || '', xBairro: f.neighborhood || '',
    CEP: soDigitos(f.zip_code), cMun: soDigitos(f.city_code), xMun: f.city_name || '', UF: (f.uf || '').toUpperCase()
  }
})

export function integrationRoutes(app, { importerFor, deleteInvoice }) {
  // Produtor cadastrado no Emissor: aparece aqui na hora (nome, CPF e endereço do emitente).
  // Se já existir, só completa o endereço que estiver vazio: o cadastro principal é este.
  app.post('/api/integracao/emissor/produtor', (req, res) => {
    if (!autorizado(req, res)) return
    const b = req.body || {}
    const documento = soDigitos(b.documento)
    if (documento.length !== 11) return res.status(422).json({ error: 'O Campo Certo só cadastra produtor com CPF.' })
    const conta = typeof b.conta === 'string' && b.conta ? b.conta : null
    const alvo = destino({ conta, documento }, { semContaNaCasa: true })
    if (alvo.erro) return res.status(alvo.erro).json({ error: alvo.mensagem })
    const e = b.endereco || {}
    const campos = { address: e.xLgr, address_number: e.nro, neighborhood: e.xBairro, zip_code: soDigitos(e.CEP), complement: e.xCpl }
    const limpo = v => String(v ?? '').trim().slice(0, 200)
    const existente = alvo.db.prepare('SELECT * FROM producers WHERE cpf=?').get(documento)
    if (!existente) {
      if (!alvo.criar) return res.status(404).json({ error: 'Produtor não cadastrado nesta empresa.' })
      alvo.db.prepare('INSERT INTO producers (name,cpf,address,address_number,neighborhood,zip_code,complement) VALUES (?,?,?,?,?,?,?)')
        .run(limpo(b.nome).slice(0, 120) || `Produtor ${documento}`, documento, ...Object.values(campos).map(limpo))
      return res.status(201).json({ resultado: 'criado' })
    }
    const vazios = Object.entries(campos).filter(([k, v]) => !String(existente[k] ?? '').trim() && limpo(v))
    for (const [k, v] of vazios) alvo.db.prepare(`UPDATE producers SET ${k}=? WHERE id=?`).run(limpo(v), existente.id)
    res.json({ resultado: vazios.length ? 'atualizado' : 'existente' })
  })

  // Fazendas do produtor (cadastro principal aqui no Campo Certo), para o Emissor preencher a IE e o
  // endereço do emitente. Só leitura; a empresa vem da conta do SSO, como no envio das notas.
  app.post('/api/integracao/emissor/fazendas', (req, res) => {
    if (!autorizado(req, res)) return
    const documento = soDigitos(req.body?.documento)
    if (documento.length !== 11) return res.json({ produtor: null, fazendas: [] }) // CNPJ: o Campo Certo é de pessoa física
    const conta = typeof req.body?.conta === 'string' && req.body.conta ? req.body.conta : null
    const alvo = destino({ conta, documento })
    if (alvo.erro) return res.status(alvo.erro).json({ error: alvo.mensagem })
    const dono = alvo.db.prepare('SELECT id,name FROM producers WHERE cpf=?').get(documento)
    if (!dono) return res.json({ produtor: null, fazendas: [] })
    const fazendas = alvo.db.prepare('SELECT * FROM farms WHERE producer_id=? ORDER BY name').all(dono.id)
    res.json({ produtor: { nome: dono.name }, fazendas: fazendas.map(fazendaParaEmissor) })
  })

  // O corpo cru (para a assinatura) é guardado pelo express.json geral, em `req.corpoBruto`.
  app.post('/api/integracao/emissor', (req, res) => {
    if (!autorizado(req, res)) return
    const pedido = req.body || {}

    const documento = soDigitos(pedido.produtor?.documento)
    const chave = soDigitos(pedido.chave)
    if (chave.length !== 44) return res.status(422).json({ error: 'Chave de acesso inválida.' })
    // O Campo Certo cadastra produtor rural pessoa física (CPF): nota de CNPJ não tem onde entrar.
    if (documento.length !== 11) return res.status(422).json({ error: 'O Campo Certo só recebe notas de produtor com CPF.' })
    const conta = typeof pedido.conta === 'string' && pedido.conta ? pedido.conta : null
    const alvo = destino({ conta, documento })
    if (alvo.erro) return res.status(alvo.erro).json({ error: alvo.mensagem })
    const { db } = alvo

    if (pedido.tipo === 'cancelamento') {
      const nota = db.prepare('SELECT id FROM invoices WHERE access_key=?').get(chave)
      if (!nota) return res.json({ resultado: 'nao_encontrada' })
      db.transaction(() => deleteInvoice(db, nota.id))()
      return res.json({ resultado: 'excluida' })
    }
    if (pedido.tipo !== 'nota') return res.status(422).json({ error: 'Tipo desconhecido.' })
    const xml = String(pedido.xml || '')
    if (!xml.includes(chave)) return res.status(422).json({ error: 'O XML não é desta chave.' })
    const dono = produtor(db, { documento, nome: pedido.produtor?.nome, xml }, alvo.criar)
    if (!dono) return res.status(404).json({ error: 'Produtor não cadastrado nesta empresa.' })
    const resultado = importerFor(db, dono)(xml, `${chave}.xml`)
    if (resultado === 'imported') return res.status(201).json({ resultado: 'importada' })
    if (resultado === 'duplicate') return res.json({ resultado: 'duplicada' })
    return res.status(422).json({ error: resultado })
  })
}
