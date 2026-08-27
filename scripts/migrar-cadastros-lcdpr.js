import fs from 'node:fs'
import path from 'node:path'
import db from '../server/db.js'
import { parseInvoiceXml } from '../server/xml.js'

const lcdprDirectory = process.argv[2]
const xmlDirectory = process.argv[3]
const apply = process.argv.includes('--apply')

if (!lcdprDirectory || !fs.existsSync(lcdprDirectory)) {
  console.error('Uso: node scripts/migrar-cadastros-lcdpr.js <pasta-lcdpr> <pasta-xmls> [--apply]')
  process.exit(1)
}

const cleanDocument = value => String(value || '').replace(/\D/g, '')
const text = value => String(value || '').trim()
const percent = value => Number(value || 0) / 100
const readRecords = file => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => line.split('|'))

const xmlNames = new Map()
if (xmlDirectory && fs.existsSync(xmlDirectory)) {
  for (const entry of fs.readdirSync(xmlDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.xml')) continue
    try {
      const parsed = parseInvoiceXml(fs.readFileSync(path.join(xmlDirectory, entry.name), 'utf8'))
      if (parsed.issuerDocument && parsed.issuerName) xmlNames.set(parsed.issuerDocument, parsed.issuerName)
      if (parsed.recipientDocument && parsed.recipientName) xmlNames.set(parsed.recipientDocument, parsed.recipientName)
    } catch {}
  }
}

const files = fs.readdirSync(lcdprDirectory, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
  .map(entry => path.join(lcdprDirectory, entry.name))

const parsedFiles = files.map(file => {
  const records = readRecords(file)
  const header = records.find(row => row[0] === '0000')
  const address = records.find(row => row[0] === '0030')
  const farms = records.filter(row => row[0] === '0040')
  const thirdParties = records.filter(row => row[0] === '0045')
  const movements = records.filter(row => row[0] === 'Q100')
  if (!header || !address) throw new Error(`LCDPR sem cabeçalho/endereço: ${path.basename(file)}`)
  return { header, address, farms, thirdParties, movements }
})

const producerDocuments = new Set(parsedFiles.map(item => cleanDocument(item.header[3])))
const participantCandidates = new Map()
for (const item of parsedFiles) {
  for (const row of item.thirdParties) {
    const document = cleanDocument(row[3])
    if ([11, 14].includes(document.length) && !producerDocuments.has(document)) participantCandidates.set(document, text(row[4]) || xmlNames.get(document) || '')
  }
  for (const row of item.movements) {
    const document = cleanDocument(row[7])
    if ([11, 14].includes(document.length) && !producerDocuments.has(document) && !participantCandidates.has(document)) participantCandidates.set(document, xmlNames.get(document) || '')
  }
}

const existingProducers = new Map(db.prepare('SELECT id,cpf FROM producers').all().map(row => [row.cpf, row.id]))
const existingParticipants = new Map(db.prepare('SELECT id,document FROM participants').all().map(row => [row.document, row.id]))
const summary = {
  mode: apply ? 'apply' : 'dry-run', lcdprFiles: files.length,
  producersFound: parsedFiles.length,
  producersToCreate: parsedFiles.filter(item => !existingProducers.has(cleanDocument(item.header[3]))).length,
  farmsFound: parsedFiles.reduce((total, item) => total + item.farms.length, 0),
  farmsToCreate: 0,
  participantsFound: participantCandidates.size,
  participantsWithName: [...participantCandidates.values()].filter(Boolean).length,
  participantsToCreate: [...participantCandidates].filter(([document, name]) => name && !existingParticipants.has(document)).length,
  producersCreated: 0, farmsCreated: 0, participantsCreated: 0
}

const insertProducer = db.prepare(`INSERT INTO producers
  (name,cpf,address,address_number,block,lot,zip_code,neighborhood,complement)
  VALUES (?,?,?,?,?,?,?,?,?)`)
const insertFarm = db.prepare(`INSERT INTO farms
  (producer_id,name,state_registration,address,ownership_type,address_number,block,lot,zip_code,neighborhood,complement)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
const findFarm = db.prepare('SELECT id FROM farms WHERE producer_id=? AND name=? AND state_registration=?')
const insertPartner = db.prepare('INSERT OR IGNORE INTO farm_partners (farm_id,document,share) VALUES (?,?,?)')
const insertParticipant = db.prepare('INSERT INTO participants (name,document) VALUES (?,?)')

for (const item of parsedFiles) {
  const cpf = cleanDocument(item.header[3])
  const producerId = existingProducers.get(cpf)
  for (const row of item.farms) {
    if (!producerId || !findFarm.get(producerId, text(row[7]), cleanDocument(row[6]))) summary.farmsToCreate++
  }
}

const migrate = db.transaction(() => {
  for (const item of parsedFiles) {
    const cpf = cleanDocument(item.header[3])
    let producerId = existingProducers.get(cpf)
    if (!producerId) {
      producerId = Number(insertProducer.run(
        text(item.header[4]), cpf, text(item.address[1]), text(item.address[2]), '', '',
        cleanDocument(item.address[7]), text(item.address[4]), text(item.address[3])
      ).lastInsertRowid)
      existingProducers.set(cpf, producerId)
      summary.producersCreated++
    }

    for (const row of item.farms) {
      const name = text(row[7])
      const registration = cleanDocument(row[6])
      if (findFarm.get(producerId, name, registration)) continue
      const farmThirdParties = item.thirdParties.filter(party => party[1] === row[1])
      const farmId = Number(insertFarm.run(
        producerId, name, registration, text(row[8]), farmThirdParties.length ? 'shared' : 'unique',
        text(row[9]), '', '', cleanDocument(row[14]), text(row[11]), text(row[10])
      ).lastInsertRowid)
      for (const party of farmThirdParties) {
        const share = percent(party[5])
        if (share > 0 && share <= 100) insertPartner.run(farmId, cleanDocument(party[3]), share)
      }
      summary.farmsCreated++
    }
  }

  for (const [document, candidateName] of participantCandidates) {
    if (!candidateName || existingParticipants.has(document)) continue
    insertParticipant.run(candidateName, document)
    summary.participantsCreated++
  }
})

try {
  if (apply) migrate()
  console.log(JSON.stringify(summary, null, 2))
} finally {
  db.close()
}
