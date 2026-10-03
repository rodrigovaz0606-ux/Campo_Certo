import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir, openBusinessDatabase } from './db.js'

const filename = path.join(dataDir, 'produtor-rural.db')
export const registry = new Database(filename)
registry.pragma('journal_mode = WAL')
registry.pragma('foreign_keys = ON')
const hasUsers = registry.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get()
const migrated = registry.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='companies'").get()
if (hasUsers && !migrated) {
  const backupDir = path.join(dataDir, 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  await registry.backup(path.join(backupDir, `before-companies-${Date.now()}.db`))
}

// SQLite requires FK enforcement off while adding a populated REFERENCES column.
// The migration remains atomic and enforcement is restored before serving requests.
registry.pragma('foreign_keys = OFF')
try { registry.transaction(() => {
  registry.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO companies(id,name) VALUES (1,'Empresa original');
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      is_admin INTEGER NOT NULL DEFAULT 0
    );
  `)
  const companyColumns = new Set(registry.prepare('PRAGMA table_info(companies)').all().map(c => c.name))
  if (!companyColumns.has('deleted_at')) registry.exec('ALTER TABLE companies ADD COLUMN deleted_at TEXT')
  const columns = new Set(registry.prepare('PRAGMA table_info(users)').all().map(c => c.name))
  if (!columns.has('is_admin')) registry.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0')
  if (!columns.has('company_id')) registry.exec('ALTER TABLE users ADD COLUMN company_id INTEGER NOT NULL DEFAULT 1 REFERENCES companies(id)')
  if (!columns.has('session_version')) registry.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1')
  const admins = registry.prepare('SELECT id FROM users WHERE is_admin=1').all()
  const total = registry.prepare('SELECT COUNT(*) total FROM users').get().total
  if (total && admins.length !== 1) throw new Error('Migração interrompida: é necessário identificar um único administrador existente. Nenhum usuário foi promovido ou rebaixado.')
  registry.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_single_admin ON users(is_admin) WHERE is_admin=1;
    CREATE INDEX IF NOT EXISTS users_company ON users(company_id);
    CREATE TRIGGER IF NOT EXISTS users_keep_admin_delete BEFORE DELETE ON users
      WHEN OLD.is_admin=1 BEGIN SELECT RAISE(ABORT,'cannot delete sole administrator'); END;
    CREATE TRIGGER IF NOT EXISTS users_keep_admin_role BEFORE UPDATE OF is_admin ON users
      WHEN OLD.is_admin<>NEW.is_admin BEGIN SELECT RAISE(ABORT,'administrator role is immutable'); END;
  `)
  if (registry.pragma('foreign_key_check(users)').length) throw new Error('Vínculo de empresa inválido na migração.')
})() } finally { registry.pragma('foreign_keys = ON') }

// The original company's business records stay in place; new companies start empty.
const original = openBusinessDatabase(filename)
const connections = new Map([[1, original]])
const companiesDir = path.join(dataDir, 'companies')
fs.mkdirSync(companiesDir, { recursive: true })

export function companyDatabase(id) {
  if (!Number.isSafeInteger(id) || id < 1 || !registry.prepare('SELECT id FROM companies WHERE id=? AND deleted_at IS NULL').get(id)) {
    throw new Error('Empresa inválida')
  }
  if (!connections.has(id)) {
    // Never create a replacement empty database if an existing company's file was lost.
    const file = path.join(companiesDir, `${id}.db`)
    if (!fs.existsSync(file)) throw new Error('Banco da empresa indisponível. Restaure o backup antes de continuar.')
    connections.set(id, openBusinessDatabase(file))
  }
  return connections.get(id)
}

export function createCompany(name) {
  return registry.transaction(() => {
    const id = Number(registry.prepare('INSERT INTO companies(name) VALUES (?)').run(name).lastInsertRowid)
    const file = path.join(companiesDir, `${id}.db`)
    if (fs.existsSync(file)) throw new Error('Já existe um arquivo para esta empresa. Verifique a restauração dos dados.')
    const connection = openBusinessDatabase(file)
    connections.set(id, connection)
    return registry.prepare('SELECT * FROM companies WHERE id=?').get(id)
  })()
}

export function closeDatabases() {
  for (const connection of connections.values()) connection.close()
  connections.clear()
  registry.close()
}
