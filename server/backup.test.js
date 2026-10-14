import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import Database from 'better-sqlite3'

const secret = 'test-only-secret-not-for-production-12345678'

async function start(dir) {
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DATA_DIR: dir, JWT_SECRET: secret, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', BACKUP_KEEP: '2' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stderr.on('data', chunk => { log += chunk })
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Startup timeout: ${log}`)) }, 15000)
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${log}`)) })
    child.stdout.on('data', chunk => {
      const match = String(chunk).match(/http:\/\/localhost:(\d+)/)
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`) }
    })
  })
  return { url, async stop() { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited } } }
}

test('backup copia o cadastro e todas as empresas, mantém só as cópias mais recentes e exige administrador', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-backup-'))
  const server = await start(dir)
  t.after(async () => { await server.stop(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const request = async (endpoint, token, { method = 'GET', body } = {}) => {
    const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    const response = await fetch(`${server.url}/api${endpoint}`, { method, headers, body: body && JSON.stringify(body) })
    return { status: response.status, data: await response.json().catch(() => null) }
  }
  const admin = (await request('/auth/register', null, { method: 'POST', body: { name: 'Admin', email: 'admin@test.local', password: 'teste123' } })).data.token
  await request('/producers', admin, { method: 'POST', body: { name: 'Produtor', cpf: '11122233344', address: 'Rua A', address_number: '1', zip_code: '76530000', neighborhood: 'Centro' } })
  const company = (await request('/companies', admin, { method: 'POST', body: { name: 'Cliente B' } })).data
  await request('/users', admin, { method: 'POST', body: { name: 'Funcionário', email: 'user@test.local', password: 'teste123', company_id: 1 } })
  const user = (await request('/auth/login', null, { method: 'POST', body: { email: 'user@test.local', password: 'teste123' } })).data.token

  assert.equal((await request('/backups', user)).status, 403)
  assert.equal((await request('/backups', user, { method: 'POST' })).status, 403)

  const created = await request('/backups', admin, { method: 'POST' })
  assert.equal(created.status, 201)
  assert.equal(created.data.databases, 2)
  const folder = path.join(dir, 'backups', 'automaticos', created.data.name)
  const copy = new Database(path.join(folder, 'produtor-rural.db'), { readonly: true })
  assert.equal(copy.prepare('SELECT name FROM producers').get().name, 'Produtor')
  assert.equal(copy.prepare('SELECT COUNT(*) n FROM users').get().n, 2)
  copy.close()
  assert.ok(fs.existsSync(path.join(folder, 'companies', `${company.id}.db`)))

  // Com BACKUP_KEEP=2, a terceira cópia remove a mais antiga.
  for (let i = 0; i < 2; i++) { await new Promise(resolve => setTimeout(resolve, 1100)); assert.equal((await request('/backups', admin, { method: 'POST' })).status, 201) }
  const list = (await request('/backups', admin)).data
  assert.equal(list.items.length, 2)
  assert.ok(!list.items.some(item => item.name === created.data.name))
})
