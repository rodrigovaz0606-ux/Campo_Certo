import fs from 'node:fs'
import path from 'node:path'
import db from '../server/db.js'
import { parseInvoiceXml } from '../server/xml.js'

const sourceDirectory = process.argv[2]
const apply = process.argv.includes('--apply')
if (!sourceDirectory || !fs.existsSync(sourceDirectory)) process.exit(1)

const knownDocuments = new Set(db.prepare('SELECT cpf FROM producers').all().map(row => row.cpf))
const candidates = new Map()
const files = fs.readdirSync(sourceDirectory, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.xml'))

for (const entry of files) {
  try {
    const parsed = parseInvoiceXml(fs.readFileSync(path.join(sourceDirectory, entry.name), 'utf8'))
    if (knownDocuments.has(parsed.issuerDocument) || knownDocuments.has(parsed.recipientDocument)) continue
    const issuerCpf = parsed.issuerDocument.length === 11
    const recipientCpf = parsed.recipientDocument.length === 11
    const issuerCnpj = parsed.issuerDocument.length === 14
    const recipientCnpj = parsed.recipientDocument.length === 14
    if (issuerCpf && recipientCnpj) candidates.set(parsed.issuerDocument, { name: parsed.issuerName, address: parsed.issuerAddress })
    else if (issuerCnpj && recipientCpf) candidates.set(parsed.recipientDocument, { name: parsed.recipientName, address: parsed.recipientAddress })
  } catch {}
}

const addressComplete = address => Boolean(address?.street && address?.number && address?.zipCode?.length === 8 && address?.neighborhood)
const summary = {
  mode: apply ? 'apply' : 'dry-run', candidates: candidates.size,
  withCompleteAddress: [...candidates.values()].filter(item => addressComplete(item.address)).length,
  created: 0
}
const insert = db.prepare(`INSERT INTO producers
  (name,cpf,address,address_number,block,lot,zip_code,neighborhood,complement)
  VALUES (?,?,?,?,?,?,?,?,?)`)
const migrate = db.transaction(() => {
  for (const [cpf, item] of candidates) {
    if (knownDocuments.has(cpf)) continue
    const address = item.address || {}
    insert.run(item.name || 'Produtor identificado no XML', cpf, address.street || 'Não informado', address.number || 'S/N', '', '', address.zipCode || '', address.neighborhood || 'Não informado', address.complement || '')
    knownDocuments.add(cpf)
    summary.created++
  }
})

try {
  if (apply) migrate()
  console.log(JSON.stringify(summary, null, 2))
} finally { db.close() }
