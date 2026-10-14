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

test('anexa, lista, baixa e exclui comprovantes de um lançamento manual', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-anexos-'))
  const app = await start(dir)
  t.after(async () => { await app.stop(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const call = async (endpoint, token, { method = 'GET', body, form } = {}) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    if (body) headers['Content-Type'] = 'application/json'
    return fetch(`${app.url}/api${endpoint}`, { method, headers, body: form || (body && JSON.stringify(body)) })
  }
  const json = async response => ({ status: response.status, data: await response.json().catch(() => null) })
  const token = (await json(await call('/auth/register', null, { method: 'POST', body: { name: 'Admin', email: 'a@t.local', password: 'teste123' } }))).data.token
  const producer = (await json(await call('/producers', token, { method: 'POST', body: { name: 'Produtor', cpf: '11122233344', address: 'Rua', address_number: '1', zip_code: '76530000', neighborhood: 'Centro' } }))).data
  const entry = (await json(await call('/invoices/manual', token, { method: 'POST', body: { producer_id: producer.id, issue_date: '2025-05-10', invoice_number: 'REC-1', amount: 350, operation_type: 'incoming', ncm_category: 'other', document_type: 'invoice' } }))).data

  const pdf = Buffer.from('%PDF-1.4 comprovante de teste')
  const form = new FormData(); form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'recibo março.pdf')
  const created = await json(await call(`/invoices/${entry.id}/attachments`, token, { method: 'POST', form }))
  assert.equal(created.status, 201)
  assert.equal(created.data.filename, 'recibo março.pdf')

  const bad = new FormData(); bad.append('file', new Blob(['<script>'], { type: 'text/html' }), 'x.html')
  assert.equal((await call(`/invoices/${entry.id}/attachments`, token, { method: 'POST', form: bad })).status, 400)

  const list = (await json(await call(`/invoices/${entry.id}/attachments`, token))).data
  assert.equal(list.length, 1)
  const rows = (await json(await call(`/invoices?producer_id=${producer.id}&year=2025`, token))).data
  assert.equal(rows[0].attachment_count, 1)

  const download = await call(`/attachments/${list[0].id}`, token)
  assert.equal(download.headers.get('content-type'), 'application/pdf')
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf)

  // Ao excluir o lançamento, os anexos vão junto.
  assert.equal((await call(`/invoices/${entry.id}`, token, { method: 'DELETE' })).status, 204)
  assert.equal((await call(`/attachments/${list[0].id}`, token)).status, 404)
})
