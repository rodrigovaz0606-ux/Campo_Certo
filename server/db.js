import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseInvoiceXml, classifyNcm } from './xml.js'
import { ensureSefazTables } from './sefaz.js'

export const dataDir = path.resolve(process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data'))
const dir = dataDir
fs.mkdirSync(dir, { recursive: true })
export function openBusinessDatabase(filename) {
const db = new Database(filename)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('synchronous = NORMAL')
db.pragma('temp_store = MEMORY')
db.pragma('cache_size = -20000')

db.exec(`
CREATE TABLE IF NOT EXISTS producers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, cpf TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS farms (
  id INTEGER PRIMARY KEY AUTOINCREMENT, producer_id INTEGER NOT NULL, name TEXT NOT NULL,
  state_registration TEXT NOT NULL, address TEXT NOT NULL, ownership_type TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(producer_id) REFERENCES producers(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, document TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS farm_participants (
  farm_id INTEGER NOT NULL, participant_id INTEGER NOT NULL, share REAL,
  PRIMARY KEY(farm_id, participant_id), FOREIGN KEY(farm_id) REFERENCES farms(id) ON DELETE CASCADE,
  FOREIGN KEY(participant_id) REFERENCES participants(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS farm_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT, farm_id INTEGER NOT NULL,
  document TEXT NOT NULL, share REAL NOT NULL CHECK(share > 0 AND share <= 100),
  FOREIGN KEY(farm_id) REFERENCES farms(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS animal_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT, producer_id INTEGER NOT NULL, farm_id INTEGER NOT NULL DEFAULT 0,
  year INTEGER NOT NULL, species_code INTEGER NOT NULL, initial_stock INTEGER NOT NULL DEFAULT 0,
  acquisitions INTEGER NOT NULL DEFAULT 0, births INTEGER NOT NULL DEFAULT 0,
  consumption_losses INTEGER NOT NULL DEFAULT 0, sales INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(producer_id, farm_id, year, species_code),
  FOREIGN KEY(producer_id) REFERENCES producers(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, producer_id INTEGER NOT NULL, farm_id INTEGER,
  participant_id INTEGER, issue_date TEXT, invoice_number TEXT, amount REAL DEFAULT 0,
  access_key TEXT, issuer_name TEXT, original_filename TEXT NOT NULL, xml_content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(producer_id) REFERENCES producers(id) ON DELETE CASCADE,
  FOREIGN KEY(farm_id) REFERENCES farms(id) ON DELETE SET NULL,
  FOREIGN KEY(participant_id) REFERENCES participants(id) ON DELETE SET NULL
);
`)

const addressColumns = [
  ['address_number', 'TEXT'], ['block', 'TEXT'], ['lot', 'TEXT'],
  ['zip_code', 'TEXT'], ['neighborhood', 'TEXT'], ['complement', 'TEXT']
]
for (const table of ['producers', 'farms']) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name))
  for (const [name, type] of addressColumns) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
  }
}
// Dados da fazenda usados no LCDPR (o escritório usa NIRF e CAEPF zerados quando não tem o número).
const farmColumns = new Set(db.prepare('PRAGMA table_info(farms)').all().map(column => column.name))
for (const [name, type] of [['nirf', "TEXT NOT NULL DEFAULT '00000000'"], ['caepf', "TEXT NOT NULL DEFAULT '00000000000000'"], ['uf', 'TEXT'], ['city_code', 'TEXT'], ['city_name', 'TEXT'], ['exploration_type', 'TEXT']]) {
  if (!farmColumns.has(name)) db.exec(`ALTER TABLE farms ADD COLUMN ${name} ${type}`)
}
const invoiceColumns = new Set(db.prepare('PRAGMA table_info(invoices)').all().map(column => column.name))
if (!invoiceColumns.has('operation_type')) db.exec('ALTER TABLE invoices ADD COLUMN operation_type TEXT')
if (!invoiceColumns.has('ncm_codes')) db.exec('ALTER TABLE invoices ADD COLUMN ncm_codes TEXT')
if (!invoiceColumns.has('ncm_category')) db.exec('ALTER TABLE invoices ADD COLUMN ncm_category TEXT')
if (!invoiceColumns.has('cattle_quantity')) db.exec('ALTER TABLE invoices ADD COLUMN cattle_quantity INTEGER')
if (!invoiceColumns.has('content_hash')) db.exec('ALTER TABLE invoices ADD COLUMN content_hash TEXT')
if (!invoiceColumns.has('is_reviewed')) db.exec('ALTER TABLE invoices ADD COLUMN is_reviewed INTEGER NOT NULL DEFAULT 0')
if (!invoiceColumns.has('is_manual')) db.exec('ALTER TABLE invoices ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0')
if (!invoiceColumns.has('document_type')) db.exec("ALTER TABLE invoices ADD COLUMN document_type TEXT NOT NULL DEFAULT 'invoice'")
if (!invoiceColumns.has('movement')) db.exec('ALTER TABLE invoices ADD COLUMN movement TEXT')
if (!invoiceColumns.has('producer_state_registration')) db.exec('ALTER TABLE invoices ADD COLUMN producer_state_registration TEXT')
db.exec(`
CREATE INDEX IF NOT EXISTS idx_invoices_producer_date ON invoices(producer_id, issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_producer_farm_date ON invoices(producer_id, farm_id, issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_access_key ON invoices(access_key) WHERE access_key IS NOT NULL AND access_key <> '';
CREATE INDEX IF NOT EXISTS idx_invoices_content_hash ON invoices(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_category_date ON invoices(producer_id, ncm_category, issue_date);
CREATE INDEX IF NOT EXISTS idx_farms_producer_registration ON farms(producer_id, state_registration);
`)
// A inscrição estadual não se repete para o mesmo produtor. Entre produtores pode repetir: a fazenda em
// parceria/condomínio é cadastrada uma vez para cada sócio, com a mesma IE. Gatilhos em vez de índice UNIQUE
// para não falhar em bases antigas que já tenham repetições.
db.exec(`
DROP TRIGGER IF EXISTS farms_state_registration_unique_insert;
DROP TRIGGER IF EXISTS farms_state_registration_unique_update;
CREATE TRIGGER IF NOT EXISTS farms_producer_registration_unique_insert
BEFORE INSERT ON farms
WHEN EXISTS (SELECT 1 FROM farms WHERE producer_id = NEW.producer_id AND state_registration = NEW.state_registration)
BEGIN SELECT RAISE(ABORT, 'duplicate farm state registration'); END;
CREATE TRIGGER IF NOT EXISTS farms_producer_registration_unique_update
BEFORE UPDATE OF producer_id, state_registration ON farms
WHEN EXISTS (SELECT 1 FROM farms WHERE producer_id = NEW.producer_id AND state_registration = NEW.state_registration AND id <> NEW.id)
BEGIN SELECT RAISE(ABORT, 'duplicate farm state registration'); END;
`)
const invoicesWithoutHash = db.prepare('SELECT id,xml_content FROM invoices WHERE content_hash IS NULL').all()
const saveContentHash = db.prepare('UPDATE invoices SET content_hash=? WHERE id=?')
db.transaction(rows => rows.forEach(row => saveContentHash.run(crypto.createHash('sha256').update(row.xml_content.replace(/\s+/g, '')).digest('hex'), row.id)))(invoicesWithoutHash)

// Comprovantes anexados aos lançamentos (PDF ou imagem), guardados no próprio banco da empresa.
db.exec(`
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL, filename TEXT NOT NULL,
  mime_type TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attachments_invoice ON attachments(invoice_id);
`)

// Dados fiscais extras pedidos pelo LCDPR (município IBGE, conta bancária, NIRF...) e configurações da empresa.
db.exec(`
CREATE TABLE IF NOT EXISTS lcdpr_settings (
  producer_id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(producer_id) REFERENCES producers(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS company_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`)
ensureSefazTables(db)

// Migrações de dados que devem rodar uma única vez por banco.
db.exec('CREATE TABLE IF NOT EXISTS data_migrations (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)')
const runOnce = (name, migrate) => {
  if (db.prepare('SELECT 1 FROM data_migrations WHERE name=?').get(name)) return
  db.transaction(() => { migrate(); db.prepare('INSERT INTO data_migrations(name) VALUES (?)').run(name) })()
}
// Notas de combustível importadas antes da categoria existir estavam como "Outros".
runOnce('ncm-category-fuel', () => {
  const rows = db.prepare("SELECT id,ncm_codes FROM invoices WHERE ncm_category='other' AND COALESCE(document_type,'invoice')='invoice' AND COALESCE(ncm_codes,'')<>''").all()
  const save = db.prepare("UPDATE invoices SET ncm_category='fuel' WHERE id=?")
  for (const row of rows) if (classifyNcm(row.ncm_codes.split(/\D+/).filter(Boolean)) === 'fuel') save.run(row.id)
})
// Preenche a quantidade de cabeças das notas de gado já importadas, sem tocar no que foi digitado.
runOnce('cattle-quantity-from-xml', () => {
  const rows = db.prepare("SELECT id,xml_content FROM invoices WHERE is_manual=0 AND ncm_category='cattle' AND cattle_quantity IS NULL AND xml_content<>''").all()
  const save = db.prepare('UPDATE invoices SET cattle_quantity=? WHERE id=? AND cattle_quantity IS NULL')
  for (const row of rows) {
    try { const quantity = parseInvoiceXml(row.xml_content).cattleQuantity; if (quantity != null) save.run(quantity, row.id) } catch {}
  }
})

return db
}
