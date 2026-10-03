import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'))
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-migration-check-'))
const tables = ['producers','farms','participants','farm_participants','farm_partners','animal_stock','invoices']
function fingerprint(db) {
  return Object.fromEntries([...tables, 'users'].map(table => {
    const rows = table === 'users'
      ? db.prepare('SELECT id,name,email,password_hash,is_admin,created_at FROM users ORDER BY id').all()
      : db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
    // content_hash may be backfilled by the existing schema upgrader.
    if (table === 'invoices') rows.forEach(row => delete row.content_hash)
    return [table, { count: rows.length, hash: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex') }]
  }))
}
try {
  const source = new Database(path.join(sourceDir,'produtor-rural.db'), { readonly:true, fileMustExist:true })
  try { await source.backup(path.join(temporary,'produtor-rural.db')) } finally { source.close() }
  const copy = new Database(path.join(temporary,'produtor-rural.db'), { readonly:true })
  const before = fingerprint(copy)
  const userColumns = new Set(copy.prepare('PRAGMA table_info(users)').all().map(column => column.name))
  const companyAssignments = copy.prepare(`SELECT id,${userColumns.has('company_id') ? 'company_id' : '1 AS company_id'} FROM users ORDER BY id`).all()
  copy.close()
  const moduleUrl = pathToFileURL(path.join(root,'server','tenancy.js')).href
  execFileSync(process.execPath, ['--input-type=module','-e',`const m=await import(${JSON.stringify(moduleUrl)}); m.closeDatabases();`], {
    cwd:root, env:{...process.env,DATA_DIR:temporary}, stdio:'pipe', timeout:60000
  })
  const migrated = new Database(path.join(temporary,'produtor-rural.db'), { readonly:true })
  try {
    assert.deepEqual(fingerprint(migrated),before)
    assert.equal(migrated.pragma('integrity_check',{simple:true}),'ok')
    assert.equal(migrated.prepare('SELECT COUNT(*) n FROM users WHERE is_admin=1').get().n,1)
    assert.deepEqual(migrated.prepare('SELECT id,company_id FROM users ORDER BY id').all(),companyAssignments)
    console.log('Migração validada em cópia temporária: todos os registros, contas, senhas e administrador preservados. Base original não alterada.')
    console.log(JSON.stringify(Object.fromEntries(Object.entries(before).map(([table,value])=>[table,value.count]))))
  } finally { migrated.close() }
} finally {
  if (!temporary.startsWith(path.join(os.tmpdir(),'campo-migration-check-'))) throw new Error('Diretório temporário inesperado')
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200})
}
