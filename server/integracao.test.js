import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import Database from 'better-sqlite3'
import { assinarPedido } from './integracao.js'

const SEGREDO = 'segredo-de-teste-da-integracao-0123456789'

async function start(dir, extra = {}) {
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DATA_DIR: dir, JWT_SECRET: 'test-only-secret-not-for-production-12345678', NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', BACKUP_DISABLED: '1', SSO_ENABLED: 'false', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stderr.on('data', chunk => { log += chunk })
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Startup timeout: ${log}`)) }, 15000)
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${log}`)) })
    child.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/localhost:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`) } })
  })
  return { url, async stop() { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited } } }
}

const CPF = '11122233344'
const chaveDe = n => `5226111112223334400155920000000${String(n).padStart(3, '0')}1000000001`.slice(0, 44)
// Nota de saída emitida pelo produtor (como o Emissor manda: XML autorizado, nfeProc).
const notaXml = (chave, { cpf = CPF, ie = '111211212', valor = '1520.75' } = {}) => `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chave}" versao="4.00"><ide><nNF>${Number(chave.slice(25, 34))}</nNF><dhEmi>2026-11-10T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CPF>${cpf}</CPF><xNome>JOAO DA SILVA</xNome><enderEmit><xLgr>FAZENDA BOA VISTA</xLgr><nro>SN</nro><xBairro>ZONA RURAL</xBairro><CEP>76530000</CEP></enderEmit><IE>${ie}</IE></emit><dest><CNPJ>55566677000188</CNPJ><xNome>Cerealista Bom Grao</xNome><IE>987654321</IE></dest><det nItem="1"><prod><NCM>12019000</NCM><uCom>SC</uCom><qCom>100</qCom></prod></det><total><ICMSTot><vNF>${valor}</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>${chave}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`

test('integração com o Emissor: recebe nota autorizada e cancelamento, com assinatura e só dentro do servidor', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-integracao-'))
  const app = await start(dir, { INTEGRACAO_EMISSOR_SEGREDO: SEGREDO })
  t.after(async () => { await app.stop(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const call = async (endpoint, token, { method = 'GET', body } = {}) => {
    const response = await fetch(`${app.url}/api${endpoint}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) })
    return { status: response.status, data: await response.json().catch(() => null) }
  }
  const enviar = async (pedido, { segredo = SEGREDO, hora = Math.floor(Date.now() / 1000), cabecalhos = {}, rota = '' } = {}) => {
    const corpo = JSON.stringify(pedido)
    const response = await fetch(`${app.url}/api/integracao/emissor${rota}`, { method: 'POST', body: corpo, headers: { 'Content-Type': 'application/json', 'X-Integracao-Hora': String(hora), 'X-Integracao-Assinatura': assinarPedido(segredo, hora, Buffer.from(corpo)), ...cabecalhos } })
    return { status: response.status, data: await response.json().catch(() => null) }
  }

  // Empresa do administrador (usuário local), com o produtor e a fazenda da IE da nota.
  const admin = (await call('/auth/register', null, { method: 'POST', body: { name: 'Admin', email: 'admin@t.local', password: 'teste123' } })).data.token
  const address = { address: 'Rua 1', address_number: '10', zip_code: '76530000', neighborhood: 'Centro' }
  const joao = (await call('/producers', admin, { method: 'POST', body: { name: 'Joao', cpf: CPF, ...address } })).data
  const fazenda = (await call('/farms', admin, { method: 'POST', body: { producer_id: joao.id, name: 'Faz Boa Vista', state_registration: '111211212', address: 'GO 164', address_number: 'SN', zip_code: '76520000', neighborhood: 'Zona Rural', ownership_type: 'unique', exploration_type: '1', uf: 'GO', city_code: '5208707', city_name: 'GOIANIA', complement: 'KM 5' } })).data
  assert.ok(fazenda?.id, JSON.stringify(fazenda))

  // Fazendas do produtor para o emitente da NF-e (IE e endereço com município IBGE).
  const fz = await enviar({ conta: null, documento: CPF }, { rota: '/fazendas' })
  assert.equal(fz.status, 200, JSON.stringify(fz.data))
  assert.equal(fz.data.produtor.nome, 'Joao')
  assert.deepEqual(fz.data.fazendas, [{ id: fazenda.id, nome: 'Faz Boa Vista', ie: '111211212', endereco: { xLgr: 'GO 164', nro: 'SN', xCpl: 'KM 5', xBairro: 'Zona Rural', CEP: '76520000', cMun: '5208707', xMun: 'GOIANIA', UF: 'GO' } }])
  assert.equal((await enviar({ conta: null, documento: CPF }, { rota: '/fazendas', segredo: 'outro-segredo-qualquer-0123456789abcdef' })).status, 401)
  assert.equal((await enviar({ conta: null, documento: CPF }, { rota: '/fazendas', cabecalhos: { 'X-Forwarded-For': '200.1.2.3' } })).status, 403)
  assert.deepEqual((await enviar({ conta: null, documento: '12345678000195' }, { rota: '/fazendas' })).data, { produtor: null, fazendas: [] })

  const chave = chaveDe(1)
  const nota = { tipo: 'nota', conta: null, chave, produtor: { documento: CPF, nome: 'JOAO DA SILVA' }, xml: notaXml(chave) }

  // Sem assinatura certa, com hora velha ou vindo pela internet: recusado.
  assert.equal((await enviar(nota, { segredo: 'outro-segredo-qualquer-0123456789abcdef' })).status, 401)
  assert.equal((await enviar(nota, { hora: Math.floor(Date.now() / 1000) - 3600 })).status, 401)
  assert.equal((await enviar(nota, { cabecalhos: { 'CF-Connecting-IP': '200.1.2.3' } })).status, 403)

  // Usuário local do Emissor (sem conta do SSO): vai para a única empresa que tem o produtor.
  const r = await enviar(nota)
  assert.equal(r.status, 201, JSON.stringify(r.data))
  assert.equal(r.data.resultado, 'importada')
  assert.equal((await enviar(nota)).data.resultado, 'duplicada')
  let lista = (await call(`/invoices?producer_id=${joao.id}`, admin)).data
  assert.equal(lista.length, 1)
  assert.equal(lista[0].operation_type, 'outgoing')
  assert.equal(lista[0].amount, 1520.75)
  assert.equal(lista[0].farm_id, fazenda.id, 'a fazenda vem da IE do emitente')

  // Cancelamento: a nota sai da conferência (como excluir na tela).
  const cancelamento = { tipo: 'cancelamento', conta: null, chave, produtor: { documento: CPF } }
  assert.equal((await enviar(cancelamento)).data.resultado, 'excluida')
  assert.equal((await call(`/invoices?producer_id=${joao.id}`, admin)).data.length, 0)
  assert.equal((await enviar(cancelamento)).data.resultado, 'nao_encontrada')

  // CNPJ não entra (o Campo Certo é de produtor pessoa física); produtor desconhecido: 404.
  assert.equal((await enviar({ ...nota, produtor: { documento: '12345678000195' } })).status, 422)
  assert.equal((await enviar({ ...nota, produtor: { documento: '99988877766' } })).status, 404)

  // Conta do SaintSSO: cliente com empresa própria, ligado pelo `sub`. O produtor é criado sozinho.
  const empresa = (await call('/companies', admin, { method: 'POST', body: { name: 'Contabilidade Cliente' } })).data
  const cliente = (await call('/users', admin, { method: 'POST', body: { name: 'Cliente', email: 'cliente@t.local', password: 'teste123', company_id: empresa.id } })).data
  const registro = new Database(path.join(dir, 'produtor-rural.db'))
  registro.prepare('UPDATE users SET sso_sub=? WHERE id=?').run('sub-do-cliente', cliente.id)
  registro.close()
  assert.equal((await enviar({ ...nota, conta: 'sub-que-nao-entrou-ainda' })).status, 404)
  const outraChave = chaveDe(2)
  const r2 = await enviar({ tipo: 'nota', conta: 'sub-do-cliente', chave: outraChave, produtor: { documento: '22233344455', nome: 'MARIA SOUZA' }, xml: notaXml(outraChave, { cpf: '22233344455' }) })
  assert.equal(r2.status, 201, JSON.stringify(r2.data))
  const tokenCliente = (await call('/auth/login', null, { method: 'POST', body: { email: 'cliente@t.local', password: 'teste123' } })).data.token
  const produtores = (await call('/producers', tokenCliente)).data
  assert.equal(produtores.length, 1)
  assert.equal(produtores[0].cpf, '22233344455')
  assert.equal(produtores[0].name, 'MARIA SOUZA')
  assert.equal(produtores[0].zip_code, '76530000')
  lista = (await call(`/invoices?producer_id=${produtores[0].id}`, tokenCliente)).data
  assert.equal(lista.length, 1)
  // A nota do cliente não aparece na empresa do administrador.
  assert.equal((await call('/producers', admin)).data.some(p => p.cpf === '22233344455'), false)
})

test('integração com o Emissor: desligada sem o segredo', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-integracao-off-'))
  const app = await start(dir, { INTEGRACAO_EMISSOR_SEGREDO: '' })
  t.after(async () => { await app.stop(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const r = await fetch(`${app.url}/api/integracao/emissor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(r.status, 404)
})

test('integração com o Emissor: produtor cadastrado no Emissor aparece aqui, sem sobrescrever o cadastro', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-integracao-produtor-'))
  const app = await start(dir, { INTEGRACAO_EMISSOR_SEGREDO: SEGREDO })
  t.after(async () => { await app.stop(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const call = async (endpoint, token, { method = 'GET', body } = {}) => {
    const response = await fetch(`${app.url}/api${endpoint}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) })
    return { status: response.status, data: await response.json().catch(() => null) }
  }
  const enviar = async pedido => {
    const corpo = JSON.stringify(pedido), hora = Math.floor(Date.now() / 1000)
    const r = await fetch(`${app.url}/api/integracao/emissor/produtor`, { method: 'POST', body: corpo, headers: { 'Content-Type': 'application/json', 'X-Integracao-Hora': String(hora), 'X-Integracao-Assinatura': assinarPedido(SEGREDO, hora, Buffer.from(corpo)) } })
    return { status: r.status, data: await r.json().catch(() => null) }
  }
  const admin = (await call('/auth/register', null, { method: 'POST', body: { name: 'Admin', email: 'admin@t.local', password: 'teste123' } })).data.token

  // Usuário local do Emissor (sem conta do SSO): vai para a empresa do administrador.
  const endereco = { xLgr: 'FAZENDA BOA VISTA', nro: 'SN', xBairro: 'ZONA RURAL', CEP: '76530-000', xCpl: 'KM 5' }
  let r = await enviar({ conta: null, documento: '333.444.555-66', nome: 'PEDRO ALVES', endereco })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  let p = (await call('/producers', admin)).data.find(x => x.cpf === '33344455566')
  assert.equal(p.name, 'PEDRO ALVES')
  assert.equal(p.address, 'FAZENDA BOA VISTA'); assert.equal(p.zip_code, '76530000'); assert.equal(p.complement, 'KM 5')
  // De novo: já existe, nada muda.
  assert.equal((await enviar({ conta: null, documento: '33344455566', nome: 'OUTRO NOME', endereco: { xLgr: 'OUTRA RUA' } })).data.resultado, 'existente')
  p = (await call('/producers', admin)).data.find(x => x.cpf === '33344455566')
  assert.equal(p.name, 'PEDRO ALVES'); assert.equal(p.address, 'FAZENDA BOA VISTA')

  // Produtor cadastrado aqui sem endereço completo: o Emissor só completa o que está vazio.
  await call('/producers', admin, { method: 'POST', body: { name: 'Ana', cpf: '11122233344', address: 'Rua 1', address_number: '10', zip_code: '76530000', neighborhood: 'Centro' } })
  r = await enviar({ conta: null, documento: '11122233344', nome: 'ANA EMISSOR', endereco: { xLgr: 'OUTRA', nro: '99', xBairro: 'OUTRO', CEP: '74000000', xCpl: 'CASA 2' } })
  assert.equal(r.data.resultado, 'atualizado')
  const ana = (await call('/producers', admin)).data.find(x => x.cpf === '11122233344')
  assert.deepEqual([ana.name, ana.address, ana.address_number, ana.neighborhood, ana.zip_code, ana.complement], ['Ana', 'Rua 1', '10', 'Centro', '76530000', 'CASA 2'])

  // Conta do SaintSSO: na empresa da conta, não na do administrador.
  const empresa = (await call('/companies', admin, { method: 'POST', body: { name: 'Cliente' } })).data
  const cliente = (await call('/users', admin, { method: 'POST', body: { name: 'Cliente', email: 'c@t.local', password: 'teste123', company_id: empresa.id } })).data
  const registro = new Database(path.join(dir, 'produtor-rural.db'))
  registro.prepare('UPDATE users SET sso_sub=? WHERE id=?').run('sub-cliente', cliente.id)
  registro.close()
  assert.equal((await enviar({ conta: 'sub-cliente', documento: '44455566677', nome: 'MARIA', endereco })).status, 201)
  const tokenCliente = (await call('/auth/login', null, { method: 'POST', body: { email: 'c@t.local', password: 'teste123' } })).data.token
  assert.deepEqual((await call('/producers', tokenCliente)).data.map(x => x.cpf), ['44455566677'])
  assert.equal((await call('/producers', admin)).data.some(x => x.cpf === '44455566677'), false)
  // Conta que ainda não entrou no Campo Certo: espera (o Emissor tenta de novo depois).
  assert.equal((await enviar({ conta: 'sub-novo', documento: '55566677788', nome: 'X' })).status, 404)
  // CNPJ não entra.
  assert.equal((await enviar({ conta: null, documento: '12345678000195', nome: 'EMPRESA' })).status, 422)
})
