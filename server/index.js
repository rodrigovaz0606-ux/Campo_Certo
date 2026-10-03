import express from 'express'
import cors from 'cors'
import multer from 'multer'
import jwt from 'jsonwebtoken'
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registry as db, closeDatabases } from './tenancy.js'
import { parseInvoiceXml } from './xml.js'
import { identityRoutes } from './identity.js'

const app = express()
const port = Number(process.env.PORT || 3333)
const secret = process.env.JWT_SECRET || 'desenvolvimento-local-troque-em-producao'
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || secret.length < 32 || secret.includes('altere-esta-chave'))) {
  throw new Error('Defina JWT_SECRET com uma chave exclusiva de pelo menos 32 caracteres antes de publicar.')
}
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 250, fileSize: 10 * 1024 * 1024 } })
app.use(cors())
app.use(express.json({ limit: '2mb' }))
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

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

const participantFromXml = (database, document, name) => {
  const findParticipantByDocument = database.prepare('SELECT id FROM participants WHERE document=?')
  const insertParticipantFromXml = database.prepare('INSERT INTO participants (name,document) VALUES (?,?)')
  const normalizedDocument = cleanDocument(document)
  if (![11, 14].includes(normalizedDocument.length)) return null
  const existing = findParticipantByDocument.get(normalizedDocument)
  if (existing) return existing.id
  return Number(insertParticipantFromXml.run(cleanText(name) || `Participante ${normalizedDocument}`, normalizedDocument).lastInsertRowid)
}
const invoiceParties = (parsed, producerDocument) => {
  if (parsed.issuerDocument === producerDocument) return { operationType: 'outgoing', participantDocument: parsed.recipientDocument, participantName: parsed.recipientName, producerStateRegistration: parsed.issuerStateRegistration }
  if (parsed.recipientDocument === producerDocument) return { operationType: 'incoming', participantDocument: parsed.issuerDocument, participantName: parsed.issuerName, producerStateRegistration: parsed.recipientStateRegistration }
  return null
}

function auth(req, res, next) {
  try {
    const tokenUser = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), secret)
    const user = db.prepare('SELECT u.id,u.name,u.email,u.is_admin,u.company_id,u.session_version,c.name company_name FROM users u JOIN companies c ON c.id=u.company_id WHERE u.id=? AND c.deleted_at IS NULL').get(tokenUser.id)
    if (!user || tokenUser.session_version !== user.session_version) throw new Error('Sessão revogada')
    req.user = user
    next()
  }
  catch { res.status(401).json({ error: 'Sessão inválida ou expirada.' }) }
}

function adminOnly(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Somente o administrador pode gerenciar usuários.' })
  next()
}

identityRoutes(app, { secret, auth, adminOnly })
app.get('/api/dashboard', (req, res) => res.json({
  producers: req.db.prepare('SELECT COUNT(*) total FROM producers').get().total,
  farms: req.db.prepare('SELECT COUNT(*) total FROM farms').get().total,
  participants: req.db.prepare('SELECT COUNT(*) total FROM participants').get().total,
  invoices: req.db.prepare('SELECT COUNT(*) total, COALESCE(SUM(amount),0) amount FROM invoices').get()
}))

app.get('/api/producers', (req, res) => res.json(req.db.prepare('SELECT * FROM producers ORDER BY name').all()))
app.post('/api/producers', (req, res) => {
  const { name, cpf } = req.body; const doc = cleanDocument(cpf); const a = addressValues(req.body)
  if (!name || doc.length !== 11 || !a.address || !a.addressNumber || a.zipCode.length !== 8 || !a.neighborhood) return res.status(400).json({ error: 'Preencha nome, CPF válido, endereço, número, CEP e bairro.' })
  if (req.db.prepare('SELECT id FROM producers WHERE cpf=?').get(doc)) return res.status(409).json({ error: 'Já existe um produtor cadastrado com este CPF.' })
  const info = req.db.prepare('INSERT INTO producers (name,cpf,address,address_number,block,lot,zip_code,neighborhood,complement) VALUES (?,?,?,?,?,?,?,?,?)').run(name.trim(),doc,a.address,a.addressNumber,a.block,a.lot,a.zipCode,a.neighborhood,a.complement)
  res.status(201).json(req.db.prepare('SELECT * FROM producers WHERE id=?').get(info.lastInsertRowid))
})
app.put('/api/producers/:id', (req, res) => {
  const name = cleanText(req.body.name); const doc = cleanDocument(req.body.cpf); const a = addressValues(req.body)
  if (!name || doc.length !== 11 || !a.address || !a.addressNumber || a.zipCode.length !== 8 || !a.neighborhood) return res.status(400).json({ error: 'Preencha nome, CPF válido, endereço, número, CEP e bairro.' })
  if (req.db.prepare('SELECT id FROM producers WHERE cpf=? AND id<>?').get(doc, req.params.id)) return res.status(409).json({ error: 'Já existe um produtor cadastrado com este CPF.' })
  const info = req.db.prepare('UPDATE producers SET name=?,cpf=?,address=?,address_number=?,block=?,lot=?,zip_code=?,neighborhood=?,complement=? WHERE id=?').run(name,doc,a.address,a.addressNumber,a.block,a.lot,a.zipCode,a.neighborhood,a.complement,req.params.id)
  if (!info.changes) return res.status(404).json({ error: 'Produtor não encontrado.' })
  res.json(req.db.prepare('SELECT * FROM producers WHERE id=?').get(req.params.id))
})
app.delete('/api/producers/:id', (req, res) => { req.db.prepare('DELETE FROM producers WHERE id=?').run(req.params.id); res.status(204).end() })

app.get('/api/farms', (req, res) => {
  const farms = req.db.prepare('SELECT f.*,p.name producer_name FROM farms f JOIN producers p ON p.id=f.producer_id ORDER BY f.name').all()
  const partners = req.db.prepare('SELECT id, document, share FROM farm_partners WHERE farm_id=? ORDER BY id')
  res.json(farms.map(f => ({ ...f, partners: partners.all(f.id) })))
})
app.post('/api/farms', (req, res) => {
  const { producer_id, name, ownership_type } = req.body
  const a = addressValues(req.body)
  const stateRegistration = cleanDocument(req.body.state_registration)
  let partners = []
  try { partners = Array.isArray(req.body.partners) ? req.body.partners : JSON.parse(req.body.partners || '[]') } catch { return res.status(400).json({ error: 'Os dados dos sócios são inválidos.' }) }
  if (!producer_id || !name || stateRegistration.length < 8 || stateRegistration.length > 14 || !a.address || !a.addressNumber || a.zipCode.length !== 8 || !a.neighborhood || !['unique','shared'].includes(ownership_type)) return res.status(400).json({ error: 'Preencha os dados obrigatórios da fazenda. A Inscrição Estadual deve ter de 8 a 14 números e o CEP, 8.' })
  if (req.db.prepare('SELECT id FROM farms WHERE state_registration=?').get(stateRegistration)) return res.status(409).json({ error: 'Já existe uma fazenda cadastrada com esta Inscrição Estadual.' })
  if (ownership_type === 'shared') {
    if (!partners.length) return res.status(400).json({ error: 'Adicione ao menos um sócio com CPF e participação.' })
    partners = partners.map(p => ({ document: cleanDocument(p.document), share: Number(p.share) }))
    if (partners.some(p => p.document.length !== 11 || !p.share || p.share <= 0 || p.share > 100)) return res.status(400).json({ error: 'Informe um CPF válido e uma participação entre 0 e 100 para cada sócio.' })
    if (new Set(partners.map(p => p.document)).size !== partners.length) return res.status(400).json({ error: 'O mesmo CPF não pode ser informado mais de uma vez.' })
    if (partners.reduce((sum, p) => sum + p.share, 0) >= 100) return res.status(400).json({ error: 'A soma das participações dos sócios deve ser menor que 100%.' })
  }
  if (!req.db.prepare('SELECT id FROM producers WHERE id=?').get(producer_id)) return res.status(400).json({ error: 'Selecione um produtor válido.' })
  const create = req.db.transaction(() => {
    const info = req.db.prepare('INSERT INTO farms (producer_id,name,state_registration,address,address_number,block,lot,zip_code,neighborhood,complement,ownership_type) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(producer_id,name.trim(),stateRegistration,a.address,a.addressNumber,a.block,a.lot,a.zipCode,a.neighborhood,a.complement,ownership_type)
    const addPartner = req.db.prepare('INSERT INTO farm_partners (farm_id,document,share) VALUES (?,?,?)')
    if (ownership_type === 'shared') partners.forEach(p => addPartner.run(info.lastInsertRowid, p.document, p.share))
    return info.lastInsertRowid
  })
  const id = create()
  res.status(201).json(req.db.prepare('SELECT * FROM farms WHERE id=?').get(id))
})
app.put('/api/farms/:id', (req, res) => {
  const { producer_id, ownership_type } = req.body
  const name = cleanText(req.body.name); const a = addressValues(req.body); const stateRegistration = cleanDocument(req.body.state_registration)
  let partners = []
  try { partners = Array.isArray(req.body.partners) ? req.body.partners : JSON.parse(req.body.partners || '[]') } catch { return res.status(400).json({ error: 'Os dados dos sócios são inválidos.' }) }
  if (!producer_id || !name || stateRegistration.length < 8 || stateRegistration.length > 14 || !a.address || !a.addressNumber || a.zipCode.length !== 8 || !a.neighborhood || !['unique','shared'].includes(ownership_type)) return res.status(400).json({ error: 'Preencha os dados obrigatórios da fazenda. A Inscrição Estadual deve ter de 8 a 14 números e o CEP, 8.' })
  if (req.db.prepare('SELECT id FROM farms WHERE state_registration=? AND id<>?').get(stateRegistration, req.params.id)) return res.status(409).json({ error: 'Já existe uma fazenda cadastrada com esta Inscrição Estadual.' })
  if (!req.db.prepare('SELECT id FROM producers WHERE id=?').get(producer_id)) return res.status(400).json({ error: 'Selecione um produtor válido.' })
  if (ownership_type === 'shared') {
    if (!partners.length) return res.status(400).json({ error: 'Adicione ao menos um sócio com CPF e participação.' })
    partners = partners.map(p => ({ document: cleanDocument(p.document), share: Number(p.share) }))
    if (partners.some(p => p.document.length !== 11 || !p.share || p.share <= 0 || p.share > 100)) return res.status(400).json({ error: 'Informe um CPF válido e uma participação entre 0 e 100 para cada sócio.' })
    if (new Set(partners.map(p => p.document)).size !== partners.length) return res.status(400).json({ error: 'O mesmo CPF não pode ser informado mais de uma vez.' })
    if (partners.reduce((sum, p) => sum + p.share, 0) >= 100) return res.status(400).json({ error: 'A soma das participações dos sócios deve ser menor que 100%.' })
  }
  const update = req.db.transaction(() => {
    const info = req.db.prepare('UPDATE farms SET producer_id=?,name=?,state_registration=?,address=?,address_number=?,block=?,lot=?,zip_code=?,neighborhood=?,complement=?,ownership_type=? WHERE id=?').run(producer_id,name,stateRegistration,a.address,a.addressNumber,a.block,a.lot,a.zipCode,a.neighborhood,a.complement,ownership_type,req.params.id)
    if (!info.changes) return false
    req.db.prepare('DELETE FROM farm_partners WHERE farm_id=?').run(req.params.id)
    const addPartner = req.db.prepare('INSERT INTO farm_partners (farm_id,document,share) VALUES (?,?,?)')
    if (ownership_type === 'shared') partners.forEach(p => addPartner.run(req.params.id, p.document, p.share))
    return true
  })
  if (!update()) return res.status(404).json({ error: 'Fazenda não encontrada.' })
  res.json(req.db.prepare('SELECT * FROM farms WHERE id=?').get(req.params.id))
})
app.delete('/api/farms/:id', (req, res) => { req.db.prepare('DELETE FROM farms WHERE id=?').run(req.params.id); res.status(204).end() })

app.get('/api/participants', (req, res) => res.json(req.db.prepare('SELECT * FROM participants ORDER BY name').all()))
app.post('/api/participants', (req, res) => {
  const { name, document } = req.body; const doc = cleanDocument(document)
  if (!name || ![11,14].includes(doc.length)) return res.status(400).json({ error: 'Informe nome e CPF/CNPJ válido.' })
  const info = req.db.prepare('INSERT INTO participants (name,document) VALUES (?,?)').run(name.trim(),doc)
  res.status(201).json(req.db.prepare('SELECT * FROM participants WHERE id=?').get(info.lastInsertRowid))
})
app.put('/api/participants/:id', (req, res) => {
  const name = cleanText(req.body.name); const doc = cleanDocument(req.body.document)
  if (!name || ![11,14].includes(doc.length)) return res.status(400).json({ error: 'Informe nome e CPF/CNPJ válido.' })
  const info = req.db.prepare('UPDATE participants SET name=?,document=? WHERE id=?').run(name,doc,req.params.id)
  if (!info.changes) return res.status(404).json({ error: 'Participante não encontrado.' })
  res.json(req.db.prepare('SELECT * FROM participants WHERE id=?').get(req.params.id))
})
app.delete('/api/participants/:id', (req, res) => { req.db.prepare('DELETE FROM participants WHERE id=?').run(req.params.id); res.status(204).end() })

app.post('/api/invoices/import', upload.array('files'), (req, res) => {
  const producerId = Number(req.body.producer_id); const farmId = req.body.farm_id ? Number(req.body.farm_id) : null
  const producer = req.db.prepare('SELECT id,cpf FROM producers WHERE id=?').get(producerId)
  if (!producer) return res.status(400).json({ error: 'Selecione um produtor válido.' })
  if (farmId && !req.db.prepare('SELECT id FROM farms WHERE id=? AND producer_id=?').get(farmId, producerId)) return res.status(400).json({ error: 'A fazenda selecionada não pertence ao produtor.' })
  if (!req.files?.length) return res.status(400).json({ error: 'Selecione ao menos um arquivo XML.' })
  const insert = req.db.prepare(`INSERT INTO invoices (producer_id,farm_id,participant_id,issue_date,invoice_number,amount,access_key,issuer_name,original_filename,xml_content,operation_type,ncm_codes,ncm_category,content_hash,producer_state_registration) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const findFarmByRegistration = req.db.prepare('SELECT id FROM farms WHERE producer_id=? AND state_registration=? ORDER BY id LIMIT 1')
  const findByAccessKey = req.db.prepare("SELECT id FROM invoices WHERE access_key=? AND access_key<>'' LIMIT 1")
  const findByContentHash = req.db.prepare('SELECT id FROM invoices WHERE content_hash=? LIMIT 1')
  const result = { imported: 0, duplicates: 0, errors: [] }
  const transaction = req.db.transaction(files => files.forEach(file => {
    try { const xml=file.buffer.toString('utf8'); const n=parseInvoiceXml(xml); const contentHash=crypto.createHash('sha256').update(xml.replace(/\s+/g, '')).digest('hex'); const duplicate=(n.accessKey&&findByAccessKey.get(n.accessKey))||findByContentHash.get(contentHash); if(duplicate){result.duplicates++;return} const parties=invoiceParties(n,producer.cpf); if (!parties) { result.errors.push(`${file.originalname}: o CPF do XML não corresponde ao emitente nem ao destinatário selecionado`); return } const registration=cleanDocument(parties.producerStateRegistration); const inferredFarm=registration&&findFarmByRegistration.get(producerId,registration); const participantId=participantFromXml(req.db, parties.participantDocument,parties.participantName); insert.run(producerId,inferredFarm?.id||farmId,participantId,n.issueDate,n.invoiceNumber,n.amount,n.accessKey,n.issuerName,file.originalname,xml,parties.operationType,n.ncmCodes.join(', '),n.ncmCategory,contentHash,registration||null); result.imported++ }
    catch { result.errors.push(`${file.originalname}: XML inválido`) }
  }))
  transaction(req.files); res.status(201).json(result)
})
app.post('/api/invoices/manual', (req, res) => {
  const producerId = Number(req.body.producer_id)
  const farmId = req.body.farm_id ? Number(req.body.farm_id) : null
  const participantId = req.body.participant_id ? Number(req.body.participant_id) : null
  const issueDate = String(req.body.issue_date || '')
  const invoiceNumber = cleanText(req.body.invoice_number)
  const amount = Number(req.body.amount)
  const operationType = req.body.operation_type
  const ncmCategory = req.body.ncm_category
  const documentType = req.body.document_type || 'invoice'
  const cattleQuantity = ncmCategory === 'cattle' && req.body.cattle_quantity !== '' && req.body.cattle_quantity != null ? Number(req.body.cattle_quantity) : null
  if (!req.db.prepare('SELECT id FROM producers WHERE id=?').get(producerId)) return res.status(400).json({ error: 'Selecione um produtor válido.' })
  if (farmId && !req.db.prepare('SELECT id FROM farms WHERE id=? AND producer_id=?').get(farmId, producerId)) return res.status(400).json({ error: 'A fazenda selecionada não pertence ao produtor.' })
  if (participantId && !req.db.prepare('SELECT id FROM participants WHERE id=?').get(participantId)) return res.status(400).json({ error: 'Selecione um participante válido.' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate) || !invoiceNumber) return res.status(400).json({ error: 'Informe a data e o número/identificação do documento.' })
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Informe um valor válido para o lançamento.' })
  if (!['incoming','outgoing'].includes(operationType)) return res.status(400).json({ error: 'Selecione Entrada ou Saída para o lançamento.' })
  if (!['invoice','payroll','contract'].includes(documentType)) return res.status(400).json({ error: 'Selecione um tipo de arquivo válido.' })
  if (!['cattle','soy','other'].includes(ncmCategory)) return res.status(400).json({ error: 'Selecione uma classificação válida.' })
  if (cattleQuantity != null && (!Number.isInteger(cattleQuantity) || cattleQuantity < 0)) return res.status(400).json({ error: 'A quantidade de gado deve ser um número inteiro igual ou maior que zero.' })
  const normalizedCategory = documentType === 'invoice' ? ncmCategory : 'other'
  const normalizedQuantity = documentType === 'invoice' ? cattleQuantity : null
  const filename = `lancamento-manual-${invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const info = req.db.prepare(`INSERT INTO invoices (producer_id,farm_id,participant_id,issue_date,invoice_number,amount,original_filename,xml_content,operation_type,ncm_category,cattle_quantity,is_reviewed,is_manual,document_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)`).run(producerId,farmId,participantId,issueDate,invoiceNumber,amount,filename,'',operationType,normalizedCategory,normalizedQuantity,1,documentType)
  res.status(201).json({ id: info.lastInsertRowid })
})
app.get('/api/invoices', (req, res) => {
  if (!req.query.producer_id) return res.json([])
  const filters=[]; const params=[]
  if (req.query.producer_id) { filters.push('i.producer_id=?'); params.push(req.query.producer_id) }
  if (req.query.farm_id) {
    filters.push(`((i.is_manual=0 AND COALESCE(i.producer_state_registration,'')<>'' AND i.producer_state_registration=(SELECT state_registration FROM farms WHERE id=? AND producer_id=i.producer_id)) OR ((i.is_manual=1 OR COALESCE(i.producer_state_registration,'')='') AND i.farm_id=?))`)
    params.push(req.query.farm_id, req.query.farm_id)
  }
  if (req.query.year) {
    const year = String(req.query.year)
    const month = req.query.month ? String(req.query.month).padStart(2, '0') : ''
    const start = month ? `${year}-${month}-01` : `${year}-01-01`
    const end = `${Number(year) + 1}-01-01`
    if (month) {
      const next = new Date(Date.UTC(Number(year), Number(month), 1)).toISOString().slice(0, 10)
      filters.push('i.issue_date>=? AND i.issue_date<?'); params.push(start, next)
    } else { filters.push('i.issue_date>=? AND i.issue_date<?'); params.push(start, end) }
  }
  if (req.query.ncm_category) { filters.push('i.ncm_category=?'); params.push(req.query.ncm_category) }
  res.json(req.db.prepare(`SELECT i.id,i.issue_date,i.invoice_number,i.amount,i.operation_type,i.ncm_codes,i.ncm_category,i.cattle_quantity,i.is_reviewed,i.is_manual,i.document_type,i.access_key,i.issuer_name,i.original_filename,i.producer_id,i.farm_id,i.participant_id,p.name producer_name,f.name farm_name,pt.name participant_name FROM invoices i JOIN producers p ON p.id=i.producer_id LEFT JOIN farms f ON f.id=i.farm_id LEFT JOIN participants pt ON pt.id=i.participant_id ${filters.length?'WHERE '+filters.join(' AND '):''} ORDER BY COALESCE(i.issue_date,i.created_at) DESC`).all(...params))
})
app.get('/api/invoice-years', (req, res) => res.json(req.db.prepare("SELECT DISTINCT strftime('%Y',issue_date) year FROM invoices WHERE issue_date IS NOT NULL ORDER BY year DESC").all().map(row => row.year)))
app.get('/api/annual-summary', (req, res) => {
  const producerId = Number(req.query.producer_id)
  const farmId = req.query.farm_id ? Number(req.query.farm_id) : null
  const year = String(req.query.year || '')
  if (!Number.isInteger(producerId) || !/^\d{4}$/.test(year)) return res.status(400).json({ error: 'Selecione um produtor e um ano validos.' })
  if (!req.db.prepare('SELECT id FROM producers WHERE id=?').get(producerId)) return res.status(400).json({ error: 'Produtor invalido.' })
  if (farmId && !req.db.prepare('SELECT id FROM farms WHERE id=? AND producer_id=?').get(farmId, producerId)) return res.status(400).json({ error: 'A fazenda selecionada nao pertence ao produtor.' })
  const params = [producerId, year]
  const farmFilter = farmId ? ' AND farm_id=?' : ''
  if (farmId) params.push(farmId)
  const values = req.db.prepare(`SELECT CAST(strftime('%m',issue_date) AS INTEGER) month,
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
  const summary = req.db.prepare(`SELECT
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
  if (!req.db.prepare('SELECT id FROM producers WHERE id=?').get(producerId)) return res.status(400).json({ error: 'Produtor inválido.' })
  if (farmId && !req.db.prepare('SELECT id FROM farms WHERE id=? AND producer_id=?').get(farmId, producerId)) return res.status(400).json({ error: 'A fazenda selecionada não pertence ao produtor.' })
  const saved = new Map(req.db.prepare('SELECT * FROM animal_stock WHERE producer_id=? AND farm_id=? AND year=?').all(producerId, farmId, year).map(row => [row.species_code, row]))
  const referenceFilters = ["ncm_category='cattle'", "strftime('%Y',issue_date)=?", 'producer_id=?']; const referenceParams = [String(year), producerId]
  if (farmId) { referenceFilters.push('farm_id=?'); referenceParams.push(farmId) }
  const reference = req.db.prepare(`SELECT COALESCE(SUM(CASE WHEN operation_type='incoming' THEN cattle_quantity ELSE 0 END),0) acquisitions, COALESCE(SUM(CASE WHEN operation_type='outgoing' THEN cattle_quantity ELSE 0 END),0) sales, COUNT(CASE WHEN cattle_quantity IS NOT NULL THEN 1 END) informed_notes, COUNT(*) cattle_notes FROM invoices WHERE ${referenceFilters.join(' AND ')}`).get(...referenceParams)
  res.json({ rows: animalSpecies.map(species => ({ ...species, initial_stock: 0, acquisitions: 0, births: 0, consumption_losses: 0, sales: 0, ...saved.get(species.code) })), reference })
})
app.put('/api/animal-stock', (req, res) => {
  const producerId = Number(req.body.producer_id); const farmId = Number(req.body.farm_id || 0); const year = Number(req.body.year); const rows = req.body.rows
  if (!Number.isInteger(producerId) || !Number.isInteger(year) || !Array.isArray(rows)) return res.status(400).json({ error: 'Os dados da movimentação são inválidos.' })
  if (!req.db.prepare('SELECT id FROM producers WHERE id=?').get(producerId)) return res.status(400).json({ error: 'Produtor inválido.' })
  if (farmId && !req.db.prepare('SELECT id FROM farms WHERE id=? AND producer_id=?').get(farmId, producerId)) return res.status(400).json({ error: 'A fazenda selecionada não pertence ao produtor.' })
  let normalized
  try { normalized = animalSpecies.map(species => {
    const input = rows.find(row => Number(row.code) === species.code) || {}
    const values = ['initial_stock','acquisitions','births','consumption_losses','sales'].map(field => Number(input[field] || 0))
    if (values.some(value => !Number.isInteger(value) || value < 0)) throw new Error('Informe somente quantidades inteiras iguais ou maiores que zero.')
    if (values[0] + values[1] + values[2] - values[3] - values[4] < 0) throw new Error(`O estoque final de ${species.name} não pode ser negativo.`)
    return { code: species.code, values }
  }) } catch (error) { return res.status(400).json({ error: error.message }) }
  const save = req.db.prepare(`INSERT INTO animal_stock (producer_id,farm_id,year,species_code,initial_stock,acquisitions,births,consumption_losses,sales,updated_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(producer_id,farm_id,year,species_code) DO UPDATE SET initial_stock=excluded.initial_stock,acquisitions=excluded.acquisitions,births=excluded.births,consumption_losses=excluded.consumption_losses,sales=excluded.sales,updated_at=CURRENT_TIMESTAMP`)
  req.db.transaction(() => normalized.forEach(row => save.run(producerId, farmId, year, row.code, ...row.values)))()
  res.json({ ok: true })
})
app.put('/api/invoices/:id', (req, res) => {
  const { issue_date, producer_id, farm_id, participant_id, invoice_number, amount, operation_type, ncm_category } = req.body
  const invoice = req.db.prepare('SELECT xml_content,is_manual,producer_id FROM invoices WHERE id=?').get(req.params.id)
  const producer = req.db.prepare('SELECT cpf FROM producers WHERE id=?').get(producer_id)
  if (farm_id && !req.db.prepare('SELECT id FROM farms WHERE id=? AND producer_id=?').get(farm_id, producer_id)) return res.status(400).json({ error: 'A fazenda não pertence ao produtor.' })
  if (participant_id && !req.db.prepare('SELECT id FROM participants WHERE id=?').get(participant_id)) return res.status(400).json({ error: 'Participante inválido.' })
  if (!invoice || !producer) return res.status(400).json({ error: 'Nota ou produtor inválido.' })
  if (!invoice.is_manual && Number(invoice.producer_id) !== Number(producer_id)) {
    const parsed = parseInvoiceXml(invoice.xml_content)
    const cpfMatches = parsed.issuerDocument === producer.cpf || parsed.recipientDocument === producer.cpf
    if (!cpfMatches) return res.status(400).json({ error: 'O CPF do produtor não consta como emitente nem destinatário desta nota.' })
  }
  if (!['incoming','outgoing'].includes(operation_type)) return res.status(400).json({ error: 'Selecione Entrada ou Saída para a nota.' })
  if (!['cattle','soy','other'].includes(ncm_category)) return res.status(400).json({ error: 'Selecione uma classificação NCM válida.' })
  const cattleQuantity = ncm_category === 'cattle' && req.body.cattle_quantity !== '' && req.body.cattle_quantity != null ? Number(req.body.cattle_quantity) : null
  if (cattleQuantity != null && (!Number.isInteger(cattleQuantity) || cattleQuantity < 0)) return res.status(400).json({ error: 'A quantidade de gado deve ser um número inteiro igual ou maior que zero.' })
  const operationType = operation_type
  const isReviewed = req.body.is_reviewed === 0 || req.body.is_reviewed === false ? 0 : 1
  req.db.prepare('UPDATE invoices SET issue_date=?,producer_id=?,farm_id=?,participant_id=?,invoice_number=?,amount=?,operation_type=?,ncm_category=?,cattle_quantity=?,is_reviewed=? WHERE id=?').run(issue_date||null,producer_id,farm_id||null,participant_id||null,invoice_number,Number(amount)||0,operationType,ncm_category,cattleQuantity,isReviewed,req.params.id)
  res.json({ ok: true, is_reviewed: isReviewed })
})
app.get('/api/invoices/:id/xml', (req, res) => { const row=req.db.prepare('SELECT original_filename,xml_content,is_manual FROM invoices WHERE id=?').get(req.params.id); if(!row)return res.status(404).end(); if(row.is_manual)return res.status(409).json({ error: 'Lançamentos manuais não possuem XML.' }); res.type('application/xml').attachment(row.original_filename).send(row.xml_content) })
app.delete('/api/invoices/bulk', (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger))]
  if (!ids.length) return res.status(400).json({ error: 'Selecione ao menos uma nota.' })
  const remove = req.db.prepare('DELETE FROM invoices WHERE id=?')
  const removeAll = req.db.transaction(() => ids.reduce((total, id) => total + remove.run(id).changes, 0))
  res.json({ deleted: removeAll() })
})
app.delete('/api/invoices/:id', (req, res) => { req.db.prepare('DELETE FROM invoices WHERE id=?').run(req.params.id); res.status(204).end() })

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(distDir, 'index.html')))
}

app.use((err, req, res, next) => {
  console.error(err)
  if (err.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ error: 'Este lote tem arquivos demais. Envie no máximo 250 arquivos por requisição.' })
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Um dos arquivos ultrapassa o limite de 10 MB.' })
  if (err.code?.startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'Já existe um cadastro com esse CPF, CNPJ, e-mail ou inscrição.' })
  res.status(500).json({ error: 'Não foi possível concluir a operação.' })
})
const server = app.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`API disponível em http://localhost:${server.address().port}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { closeDatabases(); process.exit(0) }))
