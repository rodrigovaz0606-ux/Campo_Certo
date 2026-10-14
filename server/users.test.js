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

test('e-mail de usuário de empresa excluída pode ser usado de novo; e-mail em uso mostra de quem é', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-usuarios-'))
  const app = await start(dir)
  t.after(async () => { await app.stop(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const call = async (endpoint, token, { method = 'GET', body } = {}) => {
    const response = await fetch(`${app.url}/api${endpoint}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) })
    return { status: response.status, data: await response.json().catch(() => null) }
  }
  const admin = (await call('/auth/register', null, { method: 'POST', body: { name: 'Admin', email: 'admin@t.local', password: 'teste123' } })).data.token
  const old = (await call('/companies', admin, { method: 'POST', body: { name: 'Empresa teste' } })).data
  assert.equal((await call('/users', admin, { method: 'POST', body: { name: 'Teste', email: 'teste@gmail.com', password: 'antiga1', company_id: old.id } })).status, 201)
  assert.equal((await call(`/companies/${old.id}`, admin, { method: 'DELETE' })).status, 204)
  assert.ok(!(await call('/users', admin)).data.some(user => user.email === 'teste@gmail.com')) // arquivado: some da lista

  const fresh = (await call('/companies', admin, { method: 'POST', body: { name: 'TESTE LTDA' } })).data
  const reused = await call('/users', admin, { method: 'POST', body: { name: 'Teste novo', email: 'Teste@Gmail.com', password: 'nova123', company_id: fresh.id } })
  assert.equal(reused.status, 201, JSON.stringify(reused.data))
  assert.equal(reused.data.company_id, fresh.id)
  assert.equal(reused.data.name, 'Teste novo')
  const login = await call('/auth/login', null, { method: 'POST', body: { email: 'teste@gmail.com', password: 'nova123' } })
  assert.equal(login.status, 200)
  assert.equal(login.data.user.company_name, 'TESTE LTDA')

  const duplicate = await call('/users', admin, { method: 'POST', body: { name: 'Outro', email: 'teste@gmail.com', password: 'outra12', company_id: 1 } })
  assert.equal(duplicate.status, 409)
  assert.match(duplicate.data.error, /Já existe um usuário com este e-mail \(Teste novo, empresa TESTE LTDA\)/)
})
