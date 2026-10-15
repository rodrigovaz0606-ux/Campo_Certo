import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

async function start(dir) {
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DATA_DIR: dir, JWT_SECRET: 'test-only-secret-not-for-production-12345678', NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', BACKUP_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stderr.on('data', chunk => { log += chunk })
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Startup timeout: ${log}`)) }, 15000)
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${log}`)) })
    child.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/localhost:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`) } })
  })
  return { url, async stop() { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited } } }
}

test('cadastros: fazenda com sócios para cada produtor, editar, excluir e cadastrar de novo; mensagens de duplicado claras', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-cadastros-'))
  const app = await start(dir)
  t.after(async () => { await app.stop(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const call = async (endpoint, token, { method = 'GET', body } = {}) => {
    const response = await fetch(`${app.url}/api${endpoint}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) })
    return { status: response.status, data: await response.json().catch(() => null) }
  }
  const token = (await call('/auth/register', null, { method: 'POST', body: { name: 'Admin', email: 'admin@t.local', password: 'teste123' } })).data.token
  const address = { address: 'Rua 1', address_number: '10', zip_code: '76530000', neighborhood: 'Centro' }
  const ana = (await call('/producers', token, { method: 'POST', body: { name: 'Ana', cpf: '11122233344', ...address } })).data
  const bia = (await call('/producers', token, { method: 'POST', body: { name: 'Bia', cpf: '55566677788', ...address } })).data
  const dupProducer = await call('/producers', token, { method: 'POST', body: { name: 'Outra', cpf: '111.222.333-44', ...address } })
  assert.equal(dupProducer.status, 409)
  assert.match(dupProducer.data.error, /CPF: Ana/)

  const farm = (producer, partner, extra = {}) => ({ producer_id: producer.id, name: 'Faz Guaíra', state_registration: '111211212', address: 'Rodovia GO 164', address_number: 'SN', zip_code: '76520000', neighborhood: 'Zona Rural', ownership_type: 'shared', partners: [{ document: partner.cpf, share: 50 }], exploration_type: '4', ...extra })
  // A mesma fazenda (mesma IE) para cada sócio.
  const anaFarm = await call('/farms', token, { method: 'POST', body: farm(ana, bia) })
  const biaFarm = await call('/farms', token, { method: 'POST', body: farm(bia, ana) })
  assert.equal(anaFarm.status, 201, JSON.stringify(anaFarm.data))
  assert.equal(biaFarm.status, 201, JSON.stringify(biaFarm.data))

  // Editar uma delas não esbarra na do outro sócio.
  const edited = await call(`/farms/${anaFarm.data.id}`, token, { method: 'PUT', body: farm(ana, bia, { complement: 'KM 326', city_code: '5214838', uf: 'GO' }) })
  assert.equal(edited.status, 200, JSON.stringify(edited.data))
  assert.equal(edited.data.complement, 'KM 326')

  // Excluir e cadastrar de novo.
  assert.equal((await call(`/farms/${anaFarm.data.id}`, token, { method: 'DELETE' })).status, 204)
  const again = await call('/farms', token, { method: 'POST', body: farm(ana, bia, { ownership_type: 'unique', partners: [] }) })
  assert.equal(again.status, 201, JSON.stringify(again.data))

  // A mesma IE duas vezes para o mesmo produtor continua bloqueada, com o nome da fazenda.
  const dupFarm = await call('/farms', token, { method: 'POST', body: farm(ana, bia, { name: 'Outra' }) })
  assert.equal(dupFarm.status, 409)
  assert.match(dupFarm.data.error, /Este produtor já tem uma fazenda com esta Inscrição Estadual: Faz Guaíra/)
  // Mover a fazenda da Bia para a Ana também (a Ana já tem essa IE).
  const moved = await call(`/farms/${biaFarm.data.id}`, token, { method: 'PUT', body: farm(ana, bia) })
  assert.equal(moved.status, 409)

  // Participantes: duplicado com mensagem clara; excluir e cadastrar de novo funciona.
  const part = await call('/participants', token, { method: 'POST', body: { name: 'Frigorífico', document: '12345678000190' } })
  assert.equal(part.status, 201)
  const dupPart = await call('/participants', token, { method: 'POST', body: { name: 'Outro', document: '12.345.678/0001-90' } })
  assert.equal(dupPart.status, 409)
  assert.match(dupPart.data.error, /participante: Frigorífico/)
  assert.equal((await call(`/participants/${part.data.id}`, token, { method: 'DELETE' })).status, 204)
  assert.equal((await call('/participants', token, { method: 'POST', body: { name: 'Frigorífico', document: '12345678000190' } })).status, 201)

  // Produtor excluído pode ser cadastrado de novo.
  assert.equal((await call(`/producers/${bia.id}`, token, { method: 'DELETE' })).status, 204)
  assert.equal((await call('/producers', token, { method: 'POST', body: { name: 'Bia', cpf: '55566677788', ...address } })).status, 201)
})
