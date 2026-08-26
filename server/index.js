import express from 'express'
import cors from 'cors'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import db from './db.js'
import { parseInvoiceXml } from './xml.js'

const app = express()
const port = Number(process.env.PORT || 3333)
const secret = process.env.JWT_SECRET || 'desenvolvimento-local-troque-em-producao'
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 300, fileSize: 10 * 1024 * 1024 } })
app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get()
    res.json({ status: 'ok', database: 'connected' })
  } catch {
    res.status(503).json({ status: 'error', database: 'disconnected' })
  }
})

const cleanDocument = value => String(value || '').replace(/\D/g, '')
const cleanText = value => String(value || '').trim()
const addressValues = body => ({
  address: cleanText(body.address), addressNumber: cleanText(body.address_number),
  block: cleanText(body.block), lot: cleanText(body.lot), zipCode: cleanDocument(body.zip_code),
  neighborhood: cleanText(body.neighborhood), complement: cleanText(body.complement)
})
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

const findParticipantByDocument = db.prepare('SELECT id FROM participants WHERE document=?')
const insertParticipantFromXml = db.prepare('INSERT INTO participants (name,document) VALUES (?,?)')
const participantFromXml = (document, name) => {
  const normalizedDocument = cleanDocument(document)
  if (![11, 14].includes(normalizedDocument.length)) return null
  const existing = findParticipantByDocument.get(normalizedDocument)
  if (existing) return existing.id
  return Number(insertParticipantFromXml.run(cleanText(name) || `Participante ${normalizedDocument}`, normalizedDocument).lastInsertRowid)
}
const invoiceParties = (parsed, producerDocument) => {
  if (parsed.issuerDocument === producerDocument) return { operationType: 'outgoing', participantDocument: parsed.recipientDocument, participantName: parsed.recipientName }
  if (parsed.recipientDocument === producerDocument) return { operationType: 'incoming', participantDocument: parsed.issuerDocument, participantName: parsed.issuerName }
  return null
}

const reconcileInvoiceCpf = db.transaction(() => {
  const invoices = db.prepare('SELECT i.id,i.xml_content,i.operation_type,i.ncm_category,i.participant_id,p.cpf FROM invoices i JOIN producers p ON p.id=i.producer_id').all()
  const remove = db.prepare('DELETE FROM invoices WHERE id=?')
  const updateType = db.prepare('UPDATE invoices SET operation_type=? WHERE id=?')
  const updateNcm = db.prepare('UPDATE invoices SET ncm_codes=?,ncm_category=? WHERE id=?')
  const updateParticipant = db.prepare('UPDATE invoices SET participant_id=? WHERE id=?')
  let removed = 0
  for (const invoice of invoices) {
    try {
      const parsed = parseInvoiceXml(invoice.xml_content)
      if (!invoice.ncm_category) updateNcm.run(parsed.ncmCodes.join(', '), parsed.ncmCategory, invoice.id)
      const parties = invoiceParties(parsed, invoice.cpf)
      if (parties) {
        if (!['incoming','outgoing'].includes(invoice.operation_type)) updateType.run(parties.operationType, invoice.id)
        if (!invoice.participant_id) {
          const participantId = participantFromXml(parties.participantDocument, parties.participantName)
          if (participantId) updateParticipant.run(participantId, invoice.id)
        }
        continue
      }
    } catch {}
    remove.run(invoice.id); removed++
  }
  return removed
})
const removedInvoices = reconcileInvoiceCpf()
if (removedInvoices) console.log(`${removedInvoices} nota(s) removida(s) por divergência de CPF.`)

function auth(req, res, next) {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), secret); next() }
  catch { res.status(401).json({ error: 'Sessão inválida ou expirada.' }) }
}

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { name, email, password } = req.body
  if (!name || !email || !password || password.length < 6) return res.status(400).json({ error: 'Informe nome, e-mail e senha com ao menos 6 caracteres.' })
  const result = db.prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)').run(name.trim(), email.trim().toLowerCase(), await bcrypt.hash(password, 10))
  const token = jwt.sign({ id: result.lastInsertRowid, name, email }, secret, { expiresIn: '8h' })
  res.status(201).json({ token, user: { id: result.lastInsertRowid, name, email } })
}))
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(String(req.body.email || '').trim().toLowerCase())
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password_hash))) return res.status(401).json({ error: 'E-mail ou senha incorretos.' })
  const safe = { id: user.id, name: user.name, email: user.email }
  res.json({ token: jwt.sign(safe, secret, { expiresIn: '8h' }), user: safe })
}))

app.use('/api', auth)
app.get('/api/dashboard', (req, res) => res.json({
  producers: db.prepare('SELECT COUNT(*) total FROM producers').get().total,
  farms: db.prepare('SELECT COUNT(*) total FROM farms').get().total,
  participants: db.prepare('SELECT COUNT(*) total FROM participants').get().total,
  invoices: db.prepare('SELECT COUNT(*) total, COALESCE(SUM(amount),0) amount FROM invoices').get()
}))

app.get('/api/producers', (req, res) => res.json(db.prepare('SELECT * FROM producers ORDER BY name').all()))
app.post('/api/producers', (req, res) => {
  const { name, cpf } = req.body; const doc = cleanDocument(cpf); const a = addressValues(req.body)
  if (!name || doc.length !== 11 || !a.address || !a.addressNumber || a.zipCode.length !== 8 || !a.neighborhood) return res.status(400).json({ error: 'Preencha nome, CPF válido, endereço, número, CEP e bairro.' })
  const info = db.prepare('INSERT INTO producers (name,cpf,address,address_number,block,lot,zip_code,neighborhood,complement) VALUES (?,?,?,?,?,?,?,?,?)').run(name.trim(),doc,a.address,a.addressNumber,a.block,a.lot,a.zipCode,a.neighborhood,a.complement)
  res.status(201).json(db.prepare('SELECT * FROM producers WHERE id=?').get(info.lastInsertRowid))
})
app.put('/api/producers/:id', (req, res) => {
  const name = cleanText(req.body.name); const doc = cleanDocument(req.body.cpf); const a = addressValues(req.body)
  if (!name || doc.length !== 11 || !a.address || !a.addressNumber || a.zipCode.length !== 8 || !a.neighborhood) return res.status(400).json({ error: 'Preencha nome, CPF válido, endereço, número, CEP e bairro.' })
  const info = db.prepare('UPDATE producers SET name=?,cpf=?,address=?,address_number=?,block=?,lot=?,zip_code=?,neighborhood=?,complement=? WHERE id=?').run(name,doc,a.address,a.addressNumber,a.block,a.lot,a.zipCode,a.neighborhood,a.complement,req.params.id)
  if (!info.changes) return res.status(404).json({ error: 'Produtor não encontrado.' })
  res.json(db.prepare('SELECT * FROM producers WHERE id=?').get(req.params.id))
})
app.delete('/api/producers/:id', (req, res) => { db.prepare('DELETE FROM producers WHERE id=?').run(req.params.id); res.status(204).end() })

app.get('/api/farms', (req, res) => {
  const farms = db.prepare('SELECT f.*,p.name producer_name FROM farms f JOIN producers p ON p.id=f.producer_id ORDER BY f.name').all()
  const partners = db.prepare('SELECT id, document, share FROM farm_partners WHERE farm_id=? ORDER BY id')
  res.json(farms.map(f => ({ ...f, partners: partners.all(f.id) })))
})
app.post('/api/farms', (req, res) => {
  const { producer_id, name, ownership_type } = req.body
  const a = addressValues(req.body)
  const stateRegistration = cleanDocument(req.body.state_registration)
  let partners = []
  try { partners = Array.isArray(req.body.partners) ? req.body.partners : JSON.parse(req.body.partners || '[]') } catch { return res.status(400).json({ error: 'Os dados dos sócios são inválidos.' }) }
  if (!producer_id || !name || stateRegistration.length !== 9 || !a.address || !a.addressNumber || a.zipCode.length !== 8 || !a.neighborhood || !['unique','shared'].includes(ownership_type)) return res.status(400).json({ error: 'Preencha os dados obrigatórios da fazenda. A Inscrição Estadual deve ter 9 números e o CEP, 8.' })
  if (ownership_type === 'shared') {
    if (!partners.length) return res.status(400).json({ error: 'Adicione ao menos um sócio com CPF e participação.' })
    partners = partners.map(p => ({ document: cleanDocument(p.document), share: Number(p.share) }))
    if (partners.some(p => p.document.length !== 11 || !p.share || p.share <= 0 || p.share > 100)) return res.status(400).json({ error: 'Informe um CPF válido e uma participação entre 0 e 100 para cada sócio.' })
    if (new Set(partners.map(p => p.document)).size !== partners.length) return res.status(400).json({ error: 'O mesmo CPF não pode ser informado mais de uma vez.' })
    if (partners.reduce((sum, p) => sum + p.share, 0) >= 100) return res.status(400).json({ error: 'A soma das participações dos sócios deve ser menor que 100%.' })
  }
  const create = db.transaction(() => {
    const info = db.prepare('INSERT INTO farms (producer_id,name,state_registration,address,address_number,block,lot,zip_code,neighborhood,complement,ownership_type) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(producer_id,name.trim(),stateRegistration,a.address,a.addressNumber,a.block,a.lot,a.zipCode,a.neighborhood,a.complement,ownership_type)
    const addPartner = db.prepare('INSERT INTO farm_partners (farm_id,document,share) VALUES (?,?,?)')
    if (ownership_type === 'shared') partners.forEach(p => addPartner.run(info.lastInsertRowid, p.document, p.share))
    return info.lastInsertRowid
  })
  const id = create()
  res.status(201).json(db.prepare('SELECT * FROM farms WHERE id=?').get(id))
})
app.put('/api/farms/:id', (req, res) => {
  const { producer_id, ownership_type } = req.body
  const name = cleanText(req.body.name); const a = addressValues(req.body); const stateRegistration = cleanDocument(req.body.state_registration)
  let partners = []
  try { partners = Array.isArray(req.body.partners) ? req.body.partners : JSON.parse(req.body.partners || '[]') } catch { return res.status(400).json({ error: 'Os dados dos sócios são inválidos.' }) }
  if (!producer_id || !name || stateRegistration.length !== 9 || !a.address || !a.addressNumber || a.zipCode.length !== 8 || !a.neighborhood || !['unique','shared'].includes(ownership_type)) return res.status(400).json({ error: 'Preencha os dados obrigatórios da fazenda. A Inscrição Estadual deve ter 9 números e o CEP, 8.' })
  if (!db.prepare('SELECT id FROM producers WHERE id=?').get(producer_id)) return res.status(400).json({ error: 'Selecione um produtor válido.' })
  if (ownership_type === 'shared') {
    if (!partners.length) return res.status(400).json({ error: 'Adicione ao menos um sócio com CPF e participação.' })
    partners = partners.map(p => ({ document: cleanDocument(p.document), share: Number(p.share) }))
    if (partners.some(p => p.document.length !== 11 || !p.share || p.share <= 0 || p.share > 100)) return res.status(400).json({ error: 'Informe um CPF válido e uma participação entre 0 e 100 para cada sócio.' })
    if (new Set(partners.map(p => p.document)).size !== partners.length) return res.status(400).json({ error: 'O mesmo CPF não pode ser informado mais de uma vez.' })
    if (partners.reduce((sum, p) => sum + p.share, 0) >= 100) return res.status(400).json({ error: 'A soma das participações dos sócios deve ser menor que 100%.' })
  }
  const update = db.transaction(() => {
    const info = db.prepare('UPDATE farms SET producer_id=?,name=?,state_registration=?,address=?,address_number=?,block=?,lot=?,zip_code=?,neighborhood=?,complement=?,ownership_type=? WHERE id=?').run(producer_id,name,stateRegistration,a.address,a.addressNumber,a.block,a.lot,a.zipCode,a.neighborhood,a.complement,ownership_type,req.params.id)
    if (!info.changes) return false
    db.prepare('DELETE FROM farm_partners WHERE farm_id=?').run(req.params.id)
    const addPartner = db.prepare('INSERT INTO farm_partners (farm_id,document,share) VALUES (?,?,?)')
    if (ownership_type === 'shared') partners.forEach(p => addPartner.run(req.params.id, p.document, p.share))
    return true
  })
  if (!update()) return res.status(404).json({ error: 'Fazenda não encontrada.' })
  res.json(db.prepare('SELECT * FROM farms WHERE id=?').get(req.params.id))
})
app.delete('/api/farms/:id', (req, res) => { db.prepare('DELETE FROM farms WHERE id=?').run(req.params.id); res.status(204).end() })

app.get('/api/participants', (req, res) => res.json(db.prepare('SELECT * FROM participants ORDER BY name').all()))
app.post('/api/participants', (req, res) => {
  const { name, document } = req.body; const doc = cleanDocument(document)
  if (!name || ![11,14].includes(doc.length)) return res.status(400).json({ error: 'Informe nome e CPF/CNPJ válido.' })
  const info = db.prepare('INSERT INTO participants (name,document) VALUES (?,?)').run(name.trim(),doc)
  res.status(201).json(db.prepare('SELECT * FROM participants WHERE id=?').get(info.lastInsertRowid))
})
app.put('/api/participants/:id', (req, res) => {
  const name = cleanText(req.body.name); const doc = cleanDocument(req.body.document)
  if (!name || ![11,14].includes(doc.length)) return res.status(400).json({ error: 'Informe nome e CPF/CNPJ válido.' })
  const info = db.prepare('UPDATE participants SET name=?,document=? WHERE id=?').run(name,doc,req.params.id)
  if (!info.changes) return res.status(404).json({ error: 'Participante não encontrado.' })
  res.json(db.prepare('SELECT * FROM participants WHERE id=?').get(req.params.id))
})
app.delete('/api/participants/:id', (req, res) => { db.prepare('DELETE FROM participants WHERE id=?').run(req.params.id); res.status(204).end() })

app.post('/api/invoices/import', upload.array('files'), (req, res) => {
  const producerId = Number(req.body.producer_id); const farmId = req.body.farm_id ? Number(req.body.farm_id) : null
  const producer = db.prepare('SELECT id,cpf FROM producers WHERE id=?').get(producerId)
  if (!producer) return res.status(400).json({ error: 'Selecione um produtor válido.' })
  if (farmId && !db.prepare('SELECT id FROM farms WHERE id=? AND producer_id=?').get(farmId, producerId)) return res.status(400).json({ error: 'A fazenda selecionada não pertence ao produtor.' })
  if (!req.files?.length) return res.status(400).json({ error: 'Selecione ao menos um arquivo XML.' })
  const insert = db.prepare(`INSERT INTO invoices (producer_id,farm_id,participant_id,issue_date,invoice_number,amount,access_key,issuer_name,original_filename,xml_content,operation_type,ncm_codes,ncm_category,content_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const findByAccessKey = db.prepare("SELECT id FROM invoices WHERE access_key=? AND access_key<>'' LIMIT 1")
  const findByContentHash = db.prepare('SELECT id FROM invoices WHERE content_hash=? LIMIT 1')
  const result = { imported: 0, duplicates: 0, errors: [] }
  const transaction = db.transaction(files => files.forEach(file => {
    try { const xml=file.buffer.toString('utf8'); const n=parseInvoiceXml(xml); const contentHash=crypto.createHash('sha256').update(xml.replace(/\s+/g, '')).digest('hex'); const duplicate=(n.accessKey&&findByAccessKey.get(n.accessKey))||findByContentHash.get(contentHash); if(duplicate){result.duplicates++;return} const parties=invoiceParties(n,producer.cpf); if (!parties) { result.errors.push(`${file.originalname}: o CPF do XML não corresponde ao emitente nem ao destinatário selecionado`); return } const participantId=participantFromXml(parties.participantDocument,parties.participantName); insert.run(producerId,farmId,participantId,n.issueDate,n.invoiceNumber,n.amount,n.accessKey,n.issuerName,file.originalname,xml,parties.operationType,n.ncmCodes.join(', '),n.ncmCategory,contentHash); result.imported++ }
    catch { result.errors.push(`${file.originalname}: XML inválido`) }
  }))
  transaction(req.files); res.status(201).json(result)
})
app.get('/api/invoices', (req, res) => {
  if (!req.query.producer_id) return res.json([])
  const filters=[]; const params=[]
  if (req.query.producer_id) { filters.push('i.producer_id=?'); params.push(req.query.producer_id) }
  if (req.query.farm_id) { filters.push('i.farm_id=?'); params.push(req.query.farm_id) }
  if (req.query.year) { filters.push("strftime('%Y',i.issue_date)=?"); params.push(String(req.query.year)) }
  if (req.query.month) { filters.push("strftime('%m',i.issue_date)=?"); params.push(String(req.query.month).padStart(2,'0')) }
  if (req.query.ncm_category) { filters.push('i.ncm_category=?'); params.push(req.query.ncm_category) }
  res.json(db.prepare(`SELECT i.id,i.issue_date,i.invoice_number,i.amount,i.operation_type,i.ncm_codes,i.ncm_category,i.cattle_quantity,i.access_key,i.issuer_name,i.original_filename,i.producer_id,i.farm_id,i.participant_id,p.name producer_name,f.name farm_name,pt.name participant_name FROM invoices i JOIN producers p ON p.id=i.producer_id LEFT JOIN farms f ON f.id=i.farm_id LEFT JOIN participants pt ON pt.id=i.participant_id ${filters.length?'WHERE '+filters.join(' AND '):''} ORDER BY COALESCE(i.issue_date,i.created_at) DESC`).all(...params))
})
app.get('/api/invoice-years', (req, res) => res.json(db.prepare("SELECT DISTINCT strftime('%Y',issue_date) year FROM invoices WHERE issue_date IS NOT NULL ORDER BY year DESC").all().map(row => row.year)))
app.get('/api/annual-summary', (req, res) => {
  const producerId = Number(req.query.producer_id)
  const farmId = req.query.farm_id ? Number(req.query.farm_id) : null
  const year = String(req.query.year || '')
  if (!Number.isInteger(producerId) || !/^\d{4}$/.test(year)) return res.status(400).json({ error: 'Selecione um produtor e um ano validos.' })
  if (!db.prepare('SELECT id FROM producers WHERE id=?').get(producerId)) return res.status(400).json({ error: 'Produtor invalido.' })
  if (farmId && !db.prepare('SELECT id FROM farms WHERE id=? AND producer_id=?').get(farmId, producerId)) return res.status(400).json({ error: 'A fazenda selecionada nao pertence ao produtor.' })
  const params = [producerId, year]
  const farmFilter = farmId ? ' AND farm_id=?' : ''
  if (farmId) params.push(farmId)
  const values = db.prepare(`SELECT CAST(strftime('%m',issue_date) AS INTEGER) month,
    COALESCE(SUM(CASE WHEN operation_type='outgoing' THEN amount ELSE 0 END),0) revenue,
    COALESCE(SUM(CASE WHEN operation_type='incoming' THEN amount ELSE 0 END),0) expenses
    FROM invoices WHERE producer_id=? AND strftime('%Y',issue_date)=?${farmFilter}
    GROUP BY strftime('%m',issue_date) ORDER BY month`).all(...params)
  const byMonth = new Map(values.map(row => [row.month, row]))
  res.json(Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    revenue: Number(byMonth.get(index + 1)?.revenue || 0),
    expenses: Number(byMonth.get(index + 1)?.expenses || 0)
  })))
})
app.get('/api/cattle-summary', (req, res) => {
  if (!req.query.producer_id) return res.json({ animals: 0, informed_notes: 0, cattle_notes: 0 })
  const filters = ["i.ncm_category='cattle'", "strftime('%Y',i.issue_date)=?"]
  const params = [String(req.query.year || new Date().getFullYear())]
  if (req.query.producer_id) { filters.push('i.producer_id=?'); params.push(req.query.producer_id) }
  if (req.query.farm_id) { filters.push('i.farm_id=?'); params.push(req.query.farm_id) }
  const summary = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN i.operation_type='incoming' THEN i.cattle_quantity WHEN i.operation_type='outgoing' THEN -i.cattle_quantity ELSE 0 END),0) animals,
    COALESCE(SUM(CASE WHEN i.operation_type='incoming' THEN i.cattle_quantity ELSE 0 END),0) incoming_animals,
    COALESCE(SUM(CASE WHEN i.operation_type='outgoing' THEN i.cattle_quantity ELSE 0 END),0) outgoing_animals,
    COUNT(CASE WHEN i.cattle_quantity IS NOT NULL THEN 1 END) informed_notes,
    COUNT(*) cattle_notes
    FROM invoices i WHERE ${filters.join(' AND ')}`).get(...params)
  res.json(summary)
})
const animalSpecies = [
  { code: 1, name: 'Bovinos e bufalinos' },
  { code: 2, name: 'Suínos' },
  { code: 3, name: 'Caprinos e ovinos' },
  { code: 4, name: 'Asininos, equinos e muares' },
  { code: 5, name: 'Outros' }
]
app.get('/api/animal-stock', (req, res) => {
  const producerId = Number(req.query.producer_id); const farmId = Number(req.query.farm_id || 0); const year = Number(req.query.year)
  if (!Number.isInteger(producerId) || !Number.isInteger(year)) return res.status(400).json({ error: 'Selecione um produtor e um ano válidos.' })
  if (!db.prepare('SELECT id FROM producers WHERE id=?').get(producerId)) return res.status(400).json({ error: 'Produtor inválido.' })
  if (farmId && !db.prepare('SELECT id FROM farms WHERE id=? AND producer_id=?').get(farmId, producerId)) return res.status(400).json({ error: 'A fazenda selecionada não pertence ao produtor.' })
  const saved = new Map(db.prepare('SELECT * FROM animal_stock WHERE producer_id=? AND farm_id=? AND year=?').all(producerId, farmId, year).map(row => [row.species_code, row]))
  const referenceFilters = ["ncm_category='cattle'", "strftime('%Y',issue_date)=?", 'producer_id=?']; const referenceParams = [String(year), producerId]
  if (farmId) { referenceFilters.push('farm_id=?'); referenceParams.push(farmId) }
  const reference = db.prepare(`SELECT COALESCE(SUM(CASE WHEN operation_type='incoming' THEN cattle_quantity ELSE 0 END),0) acquisitions, COALESCE(SUM(CASE WHEN operation_type='outgoing' THEN cattle_quantity ELSE 0 END),0) sales, COUNT(CASE WHEN cattle_quantity IS NOT NULL THEN 1 END) informed_notes, COUNT(*) cattle_notes FROM invoices WHERE ${referenceFilters.join(' AND ')}`).get(...referenceParams)
  res.json({ rows: animalSpecies.map(species => ({ ...species, initial_stock: 0, acquisitions: 0, births: 0, consumption_losses: 0, sales: 0, ...saved.get(species.code) })), reference })
})
app.put('/api/animal-stock', (req, res) => {
  const producerId = Number(req.body.producer_id); const farmId = Number(req.body.farm_id || 0); const year = Number(req.body.year); const rows = req.body.rows
  if (!Number.isInteger(producerId) || !Number.isInteger(year) || !Array.isArray(rows)) return res.status(400).json({ error: 'Os dados da movimentação são inválidos.' })
  if (!db.prepare('SELECT id FROM producers WHERE id=?').get(producerId)) return res.status(400).json({ error: 'Produtor inválido.' })
  if (farmId && !db.prepare('SELECT id FROM farms WHERE id=? AND producer_id=?').get(farmId, producerId)) return res.status(400).json({ error: 'A fazenda selecionada não pertence ao produtor.' })
  let normalized
  try { normalized = animalSpecies.map(species => {
    const input = rows.find(row => Number(row.code) === species.code) || {}
    const values = ['initial_stock','acquisitions','births','consumption_losses','sales'].map(field => Number(input[field] || 0))
    if (values.some(value => !Number.isInteger(value) || value < 0)) throw new Error('Informe somente quantidades inteiras iguais ou maiores que zero.')
    if (values[0] + values[1] + values[2] - values[3] - values[4] < 0) throw new Error(`O estoque final de ${species.name} não pode ser negativo.`)
    return { code: species.code, values }
  }) } catch (error) { return res.status(400).json({ error: error.message }) }
  const save = db.prepare(`INSERT INTO animal_stock (producer_id,farm_id,year,species_code,initial_stock,acquisitions,births,consumption_losses,sales,updated_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(producer_id,farm_id,year,species_code) DO UPDATE SET initial_stock=excluded.initial_stock,acquisitions=excluded.acquisitions,births=excluded.births,consumption_losses=excluded.consumption_losses,sales=excluded.sales,updated_at=CURRENT_TIMESTAMP`)
  db.transaction(() => normalized.forEach(row => save.run(producerId, farmId, year, row.code, ...row.values)))()
  res.json({ ok: true })
})
app.put('/api/invoices/:id', (req, res) => {
  const { issue_date, producer_id, farm_id, participant_id, invoice_number, amount, operation_type, ncm_category } = req.body
  const invoice = db.prepare('SELECT xml_content FROM invoices WHERE id=?').get(req.params.id)
  const producer = db.prepare('SELECT cpf FROM producers WHERE id=?').get(producer_id)
  if (!invoice || !producer) return res.status(400).json({ error: 'Nota ou produtor inválido.' })
  const parsed = parseInvoiceXml(invoice.xml_content)
  const cpfMatches = parsed.issuerDocument === producer.cpf || parsed.recipientDocument === producer.cpf
  if (!cpfMatches) return res.status(400).json({ error: 'O CPF do produtor não consta como emitente nem destinatário desta nota.' })
  if (!['incoming','outgoing'].includes(operation_type)) return res.status(400).json({ error: 'Selecione Entrada ou Saída para a nota.' })
  if (!['cattle','soy','other'].includes(ncm_category)) return res.status(400).json({ error: 'Selecione uma classificação NCM válida.' })
  const cattleQuantity = ncm_category === 'cattle' && req.body.cattle_quantity !== '' && req.body.cattle_quantity != null ? Number(req.body.cattle_quantity) : null
  if (cattleQuantity != null && (!Number.isInteger(cattleQuantity) || cattleQuantity < 0)) return res.status(400).json({ error: 'A quantidade de gado deve ser um número inteiro igual ou maior que zero.' })
  const operationType = operation_type
  db.prepare('UPDATE invoices SET issue_date=?,producer_id=?,farm_id=?,participant_id=?,invoice_number=?,amount=?,operation_type=?,ncm_category=?,cattle_quantity=? WHERE id=?').run(issue_date||null,producer_id,farm_id||null,participant_id||null,invoice_number,Number(amount)||0,operationType,ncm_category,cattleQuantity,req.params.id)
  res.json({ ok: true })
})
app.get('/api/invoices/:id/xml', (req, res) => { const row=db.prepare('SELECT original_filename,xml_content FROM invoices WHERE id=?').get(req.params.id); if(!row)return res.status(404).end(); res.type('application/xml').attachment(row.original_filename).send(row.xml_content) })
app.delete('/api/invoices/bulk', (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger))]
  if (!ids.length) return res.status(400).json({ error: 'Selecione ao menos uma nota.' })
  const remove = db.prepare('DELETE FROM invoices WHERE id=?')
  const removeAll = db.transaction(() => ids.reduce((total, id) => total + remove.run(id).changes, 0))
  res.json({ deleted: removeAll() })
})
app.delete('/api/invoices/:id', (req, res) => { db.prepare('DELETE FROM invoices WHERE id=?').run(req.params.id); res.status(204).end() })

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(distDir, 'index.html')))
}

app.use((err, req, res, next) => {
  console.error(err)
  if (err.code?.startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'Já existe um cadastro com esse CPF, CNPJ, e-mail ou inscrição.' })
  res.status(500).json({ error: 'Não foi possível concluir a operação.' })
})
app.listen(port, () => console.log(`API disponível em http://localhost:${port}`))
