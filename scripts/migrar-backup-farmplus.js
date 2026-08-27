import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import db from '../server/db.js'
import { parseInvoiceXml } from '../server/xml.js'

const sourceDirectory = process.argv[2]
const lcdprDirectory = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null
const apply = process.argv.includes('--apply')

if (!sourceDirectory || !fs.existsSync(sourceDirectory)) {
  console.error('Uso: node scripts/migrar-backup-farmplus.js <pasta-dos-xmls> [--apply]')
  process.exit(1)
}

const xmlFiles = fs.readdirSync(sourceDirectory, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.xml'))
  .map(entry => path.join(sourceDirectory, entry.name))

const producers = db.prepare('SELECT id,cpf FROM producers').all()
const producerByDocument = new Map(producers.map(producer => [producer.cpf, producer]))
const farmsByProducer = new Map()
const farmIdByProducerAndName = new Map()
for (const farm of db.prepare('SELECT id,producer_id FROM farms ORDER BY id').all()) {
  const farms = farmsByProducer.get(farm.producer_id) || []
  farms.push(farm.id)
  farmsByProducer.set(farm.producer_id, farms)
}
for (const farm of db.prepare('SELECT id,producer_id,name FROM farms').all()) farmIdByProducerAndName.set(`${farm.producer_id}|${farm.name}`, farm.id)

const normalizeInvoiceNumber = value => {
  const normalized = String(value || '').trim().toUpperCase()
  return /^\d+$/.test(normalized) ? normalized.replace(/^0+(?=\d)/, '') : normalized
}
const lcdprDate = value => /^\d{8}$/.test(value || '') ? `${value.slice(4, 8)}-${value.slice(2, 4)}-${value.slice(0, 2)}` : ''
const farmCandidatesByInvoice = new Map()
if (lcdprDirectory && fs.existsSync(lcdprDirectory)) {
  for (const entry of fs.readdirSync(lcdprDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.txt')) continue
    const records = fs.readFileSync(path.join(lcdprDirectory, entry.name), 'utf8').split(/\r?\n/).filter(Boolean).map(line => line.split('|'))
    const producerDocument = String(records.find(row => row[0] === '0000')?.[3] || '').replace(/\D/g, '')
    const producer = producerByDocument.get(producerDocument)
    if (!producer) continue
    const farmNameByCode = new Map(records.filter(row => row[0] === '0040').map(row => [row[1], String(row[7] || '').trim()]))
    for (const row of records.filter(row => row[0] === 'Q100')) {
      const farmId = farmIdByProducerAndName.get(`${producer.id}|${farmNameByCode.get(row[2]) || ''}`)
      const number = normalizeInvoiceNumber(row[4])
      if (!farmId || !number) continue
      const key = `${producer.id}|${lcdprDate(row[1])}|${number}`
      const candidates = farmCandidatesByInvoice.get(key) || new Set()
      candidates.add(farmId)
      farmCandidatesByInvoice.set(key, candidates)
    }
  }
}

const accessKeys = new Set(db.prepare("SELECT access_key FROM invoices WHERE access_key IS NOT NULL AND access_key<>''").all().map(row => row.access_key))
const contentHashes = new Set(db.prepare('SELECT content_hash FROM invoices WHERE content_hash IS NOT NULL').all().map(row => row.content_hash))
const participantByDocument = new Map(db.prepare('SELECT id,document FROM participants').all().map(row => [row.document, row.id]))
const insertParticipant = db.prepare('INSERT INTO participants (name,document) VALUES (?,?)')
const insertInvoice = db.prepare(`INSERT INTO invoices
  (producer_id,farm_id,participant_id,issue_date,invoice_number,amount,access_key,issuer_name,original_filename,xml_content,operation_type,ncm_codes,ncm_category,content_hash)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)

const summary = {
  mode: apply ? 'apply' : 'dry-run', files: xmlFiles.length, importable: 0,
  imported: 0, duplicates: 0, unmatchedProducer: 0, invalidXml: 0,
  ambiguousProducer: 0, participantsToCreate: new Set(), participantsCreated: 0, farmsMatched: 0, byProducer: {}
}

const migrate = db.transaction(() => {
  for (const filePath of xmlFiles) {
    try {
      const xml = fs.readFileSync(filePath, 'utf8')
      const parsed = parseInvoiceXml(xml)
      const contentHash = crypto.createHash('sha256').update(xml.replace(/\s+/g, '')).digest('hex')
      if ((parsed.accessKey && accessKeys.has(parsed.accessKey)) || contentHashes.has(contentHash)) {
        summary.duplicates++
        continue
      }

      let producer
      let operationType
      let participantDocument
      let participantName
      const issuerProducer = producerByDocument.get(parsed.issuerDocument)
      const recipientProducer = producerByDocument.get(parsed.recipientDocument)
      if (issuerProducer && recipientProducer) {
        summary.ambiguousProducer++
        continue
      } else if (issuerProducer) {
        producer = issuerProducer
        operationType = 'outgoing'
        participantDocument = parsed.recipientDocument
        participantName = parsed.recipientName
      } else if (recipientProducer) {
        producer = recipientProducer
        operationType = 'incoming'
        participantDocument = parsed.issuerDocument
        participantName = parsed.issuerName
      } else {
        summary.unmatchedProducer++
        continue
      }

      summary.importable++
      summary.byProducer[producer.id] = (summary.byProducer[producer.id] || 0) + 1
      accessKeys.add(parsed.accessKey)
      contentHashes.add(contentHash)

      let participantId = participantByDocument.get(participantDocument) || null
      if (!participantId && [11, 14].includes(participantDocument.length)) {
        summary.participantsToCreate.add(participantDocument)
        if (apply) {
          participantId = Number(insertParticipant.run(participantName || `Participante ${participantDocument}`, participantDocument).lastInsertRowid)
          participantByDocument.set(participantDocument, participantId)
          summary.participantsCreated++
        }
      }

      const farms = farmsByProducer.get(producer.id) || []
      const farmCandidates = farmCandidatesByInvoice.get(`${producer.id}|${parsed.issueDate}|${normalizeInvoiceNumber(parsed.invoiceNumber)}`)
      const farmId = farmCandidates?.size === 1 ? [...farmCandidates][0] : farms.length === 1 ? farms[0] : null
      if (farmCandidates?.size === 1) summary.farmsMatched++
      if (!apply) continue
      insertInvoice.run(
        producer.id, farmId, participantId,
        parsed.issueDate, parsed.invoiceNumber, parsed.amount, parsed.accessKey,
        parsed.issuerName, path.basename(filePath), xml, operationType,
        parsed.ncmCodes.join(', '), parsed.ncmCategory, contentHash
      )
      summary.imported++
    } catch {
      summary.invalidXml++
    }
  }
})

try {
  migrate()
  summary.participantsToCreate = summary.participantsToCreate.size
  console.log(JSON.stringify(summary, null, 2))
} finally {
  db.close()
}
