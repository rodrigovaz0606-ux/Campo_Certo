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

/** Empresa e banco do pedido; `criar` cria o produtor (só para conta do SSO, dona dos dados). */
function destino({ conta, documento }) {
  if (conta) {
    const usuario = registry.prepare('SELECT u.company_id FROM users u JOIN companies c ON c.id=u.company_id WHERE u.sso_sub=? AND c.deleted_at IS NULL').get(conta)
    if (!usuario) return { erro: 404, mensagem: 'Esta conta ainda não entrou no Campo Certo.' }
    return { db: companyDatabase(usuario.company_id), criar: true }
  }
  const empresas = registry.prepare('SELECT id FROM companies WHERE deleted_at IS NULL').all()
  const comProdutor = empresas.filter(e => { try { return companyDatabase(e.id).prepare('SELECT 1 FROM producers WHERE cpf=?').get(documento) } catch { return false } })
  if (comProdutor.length === 1) return { db: companyDatabase(comProdutor[0].id), criar: false }
  if (comProdutor.length > 1) return { erro: 409, mensagem: 'Mais de uma empresa tem esse produtor; entre no Emissor pelo login único.' }
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

export function integrationRoutes(app, { importerFor, deleteInvoice }) {
  // O corpo cru (para a assinatura) é guardado pelo express.json geral, em `req.corpoBruto`.
  app.post('/api/integracao/emissor', (req, res) => {
    if (!integracaoAtiva()) return res.status(404).json({ error: 'Integração desativada.' })
    if (req.get('cf-connecting-ip') || req.get('x-forwarded-for')) return res.status(403).json({ error: 'Integração só dentro do servidor.' })
    if (!conferirAssinatura(req)) return res.status(401).json({ error: 'Assinatura inválida.' })
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
