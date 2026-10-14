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
import { backupRoot, listBackups, runBackup, startBackupSchedule } from './backup.js'
import { buildLcdpr, mergeSettings, farmLcdpr, defaultAccountant, LCDPR_LAYOUT_VERSION } from './lcdpr.js'
import { validateLcdpr } from './lcdpr-validator.js'
import { readCertificate, sealCertificate, openCertificate, syncProducer, importStored, sefazStatus, UF_CODES } from './sefaz.js'
import { consultaCadastro } from './cadastro.js'

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

// Importa um XML para o produtor (usado no envio de arquivos e na busca na SEFAZ).
// Devolve 'imported', 'duplicate' ou a mensagem de erro.
function invoiceImporter(database, producer, farmId = null) {
  const insert = database.prepare(`INSERT INTO invoices (producer_id,farm_id,participant_id,issue_date,invoice_number,amount,access_key,issuer_name,original_filename,xml_content,operation_type,ncm_codes,ncm_category,content_hash,producer_state_registration,cattle_quantity) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const findFarmByRegistration = database.prepare('SELECT id FROM farms WHERE producer_id=? AND state_registration=? ORDER BY id LIMIT 1')
  const findByAccessKey = database.prepare("SELECT id FROM invoices WHERE access_key=? AND access_key<>'' LIMIT 1")
  const findByContentHash = database.prepare('SELECT id FROM invoices WHERE content_hash=? LIMIT 1')
  return (xml, filename) => {
    try {
      const n = parseInvoiceXml(xml)
      const contentHash = crypto.createHash('sha256').update(xml.replace(/\s+/g, '')).digest('hex')
      if ((n.accessKey && findByAccessKey.get(n.accessKey)) || findByContentHash.get(contentHash)) return 'duplicate'
      const parties = invoiceParties(n, producer.cpf)
      if (!parties) return `${filename}: o CPF do XML não corresponde ao emitente nem ao destinatário selecionado`
      const registration = cleanDocument(parties.producerStateRegistration)
      const inferredFarm = registration && findFarmByRegistration.get(producer.id, registration)
      const participantId = participantFromXml(database, parties.participantDocument, parties.participantName)
      insert.run(producer.id, inferredFarm?.id || farmId, participantId, n.issueDate, n.invoiceNumber, n.amount, n.accessKey, n.issuerName, filename, xml, parties.operationType, n.ncmCodes.join(', '), n.ncmCategory, contentHash, registration || null, n.ncmCategory === 'cattle' ? n.cattleQuantity : null)
      return 'imported'
    } catch { return `${filename}: XML inválido` }
  }
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
app.get('/api/backups', adminOnly, (req, res) => res.json({ folder: backupRoot, items: listBackups() }))
app.post('/api/backups', adminOnly, asyncRoute(async (req, res) => res.status(201).json(await runBackup('Manual'))))

app.get('/api/dashboard', (req, res) => {
  const summary = {
    producers: req.db.prepare('SELECT COUNT(*) total FROM producers').get().total,
    farms: req.db.prepare('SELECT COUNT(*) total FROM farms').get().total,
    participants: req.db.prepare('SELECT COUNT(*) total FROM participants').get().total,
    invoices: req.db.prepare('SELECT COUNT(*) total FROM invoices').get()
  }
  // O gráfico mensal só faz sentido por produtor (e opcionalmente por fazenda), nunca somando todos.
  const producerId = Number(req.query.producer_id)
  if (!req.query.producer_id) return res.json(summary)
  if (!Number.isInteger(producerId) || !req.db.prepare('SELECT id FROM producers WHERE id=?').get(producerId)) return res.status(400).json({ error: 'Produtor inválido.' })
  const farmId = req.query.farm_id ? Number(req.query.farm_id) : null
  if (farmId && !req.db.prepare('SELECT id FROM farms WHERE id=? AND producer_id=?').get(farmId, producerId)) return res.status(400).json({ error: 'A fazenda selecionada não pertence ao produtor.' })
  const scope = `producer_id=?${farmId ? ' AND farm_id=?' : ''}`
  const scopeParams = farmId ? [producerId, farmId] : [producerId]
  const years = req.db.prepare(`SELECT DISTINCT strftime('%Y',issue_date) year FROM invoices WHERE issue_date IS NOT NULL AND ${scope} ORDER BY year DESC`).all(...scopeParams).map(row => row.year)
  const year = /^\d{4}$/.test(String(req.query.year || '')) ? String(req.query.year) : (years[0] || String(new Date().getFullYear()))
  const months = new Map(req.db.prepare(`SELECT CAST(strftime('%m',issue_date) AS INTEGER) month,
    COALESCE(SUM(CASE WHEN operation_type='outgoing' THEN amount ELSE 0 END),0) revenue,
    COALESCE(SUM(CASE WHEN operation_type='incoming' THEN amount ELSE 0 END),0) expenses
    FROM invoices WHERE ${scope} AND strftime('%Y',issue_date)=? GROUP BY month`).all(...scopeParams, year).map(row => [row.month, row]))
  res.json({
    ...summary,
    year, years,
    monthly: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, revenue: Number(months.get(index + 1)?.revenue || 0), expenses: Number(months.get(index + 1)?.expenses || 0) }))
  })
})

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
// Dados fiscais da fazenda para o LCDPR. NIRF e CAEPF em branco ficam zerados, como o escritório usa.
const farmFiscal = body => {
  const nirf = cleanDocument(body.nirf) || '00000000', caepf = cleanDocument(body.caepf) || '00000000000000'
  const uf = cleanText(body.uf).toUpperCase(), cityCode = cleanDocument(body.city_code), exploration = String(body.exploration_type || '')
  if (nirf.length !== 8) return { error: 'O NIRF/CAFIR deve ter 8 dígitos (use zeros se não tiver).' }
  if (caepf.length !== 14) return { error: 'O CAEPF deve ter 14 dígitos (use zeros se não tiver).' }
  if (uf && !/^[A-Z]{2}$/.test(uf)) return { error: 'UF da fazenda inválida.' }
  if (cityCode && cityCode.length !== 7) return { error: 'O código IBGE do município deve ter 7 dígitos.' }
  if (exploration && !['1', '2', '3', '4', '5', '6'].includes(exploration)) return { error: 'Tipo de exploração inválido.' }
  return { values: [nirf, caepf, uf || null, cityCode || null, cleanText(body.city_name) || null, exploration || null] }
}
const saveFarmFiscal = (database, id, fiscal) => database.prepare('UPDATE farms SET nirf=?,caepf=?,uf=?,city_code=?,city_name=?,exploration_type=? WHERE id=?').run(...fiscal.values, id)
app.post('/api/farms', (req, res) => {
  const { producer_id, name, ownership_type } = req.body
  const a = addressValues(req.body)
  const stateRegistration = cleanDocument(req.body.state_registration)
  let partners = []
  try { partners = Array.isArray(req.body.partners) ? req.body.partners : JSON.parse(req.body.partners || '[]') } catch { return res.status(400).json({ error: 'Os dados dos sócios são inválidos.' }) }
  if (!producer_id || !name || stateRegistration.length < 8 || stateRegistration.length > 14 || !a.address || !a.addressNumber || a.zipCode.length !== 8 || !a.neighborhood || !['unique','shared'].includes(ownership_type)) return res.status(400).json({ error: 'Preencha os dados obrigatórios da fazenda. A Inscrição Estadual deve ter de 8 a 14 números e o CEP, 8.' })
  if (req.db.prepare('SELECT id FROM farms WHERE state_registration=?').get(stateRegistration)) return res.status(409).json({ error: 'Já existe uma fazenda cadastrada com esta Inscrição Estadual.' })
  const fiscal = farmFiscal(req.body)
  if (fiscal.error) return res.status(400).json({ error: fiscal.error })
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
    saveFarmFiscal(req.db, info.lastInsertRowid, fiscal)
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
  const fiscal = farmFiscal(req.body)
  if (fiscal.error) return res.status(400).json({ error: fiscal.error })
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
    saveFarmFiscal(req.db, req.params.id, fiscal)
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
  const importXml = invoiceImporter(req.db, producer, farmId)
  const result = { imported: 0, duplicates: 0, errors: [] }
  req.db.transaction(files => files.forEach(file => {
    const outcome = importXml(file.buffer.toString('utf8'), file.originalname)
    if (outcome === 'imported') result.imported++
    else if (outcome === 'duplicate') result.duplicates++
    else result.errors.push(outcome)
  }))(req.files)
  res.status(201).json(result)
})

// ---------- Certificado A1 e busca de notas na SEFAZ ----------
const publicCertificate = row => row ? { holder_name: row.holder_name, holder_document: row.holder_document, valid_until: row.valid_until, uf: row.uf, created_at: row.created_at } : null
app.get('/api/producers/:id/certificate', (req, res) => {
  res.json(publicCertificate(req.db.prepare('SELECT holder_name,holder_document,valid_until,uf,created_at FROM certificates WHERE producer_id=?').get(req.params.id)))
})
app.put('/api/producers/:id/certificate', upload.single('file'), (req, res) => {
  const producer = req.db.prepare('SELECT id,cpf FROM producers WHERE id=?').get(req.params.id)
  if (!producer) return res.status(404).json({ error: 'Produtor não encontrado.' })
  if (!req.file) return res.status(400).json({ error: 'Selecione o arquivo .pfx ou .p12 do certificado.' })
  const uf = String(req.body.uf || 'GO').toUpperCase()
  if (!UF_CODES[uf]) return res.status(400).json({ error: 'UF inválida.' })
  let certificate
  try { certificate = readCertificate(req.file.buffer, req.body.password) } catch (error) { return res.status(400).json({ error: error.message }) }
  if (new Date(certificate.validUntil).getTime() < Date.now()) return res.status(400).json({ error: `Este certificado venceu em ${new Date(certificate.validUntil).toLocaleDateString('pt-BR')}.` })
  if (certificate.document && certificate.document !== producer.cpf) return res.status(400).json({ error: `O certificado é do CPF/CNPJ ${certificate.document}, diferente do CPF do produtor.` })
  req.db.prepare(`INSERT INTO certificates (producer_id,sealed,holder_name,holder_document,valid_until,uf,created_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(producer_id) DO UPDATE SET sealed=excluded.sealed,holder_name=excluded.holder_name,holder_document=excluded.holder_document,valid_until=excluded.valid_until,uf=excluded.uf,created_at=CURRENT_TIMESTAMP`)
    .run(producer.id, sealCertificate(req.file.buffer, req.body.password, secret), certificate.holderName, certificate.document, certificate.validUntil, uf)
  res.json(publicCertificate(req.db.prepare('SELECT holder_name,holder_document,valid_until,uf,created_at FROM certificates WHERE producer_id=?').get(producer.id)))
})
app.delete('/api/producers/:id/certificate', (req, res) => { req.db.prepare('DELETE FROM certificates WHERE producer_id=?').run(req.params.id); res.status(204).end() })
app.get('/api/sefaz/status', (req, res) => {
  const producerId = Number(req.query.producer_id)
  const certificate = req.db.prepare('SELECT holder_name,holder_document,valid_until,uf,created_at FROM certificates WHERE producer_id=?').get(producerId)
  res.json({ certificate: publicCertificate(certificate), ...sefazStatus(req.db, producerId) })
})
// Certificado do escritório e consulta de inscrição estadual na SEFAZ (base do Sintegra).
const officeCertificateRow = database => database.prepare('SELECT holder_name,holder_document,valid_until,created_at FROM office_certificate WHERE id=1').get()
app.get('/api/office-certificate', (req, res) => res.json(officeCertificateRow(req.db) || null))
app.put('/api/office-certificate', adminOnly, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecione o arquivo .pfx ou .p12 do certificado.' })
  let certificate
  try { certificate = readCertificate(req.file.buffer, req.body.password) } catch (error) { return res.status(400).json({ error: error.message }) }
  if (new Date(certificate.validUntil).getTime() < Date.now()) return res.status(400).json({ error: `Este certificado venceu em ${new Date(certificate.validUntil).toLocaleDateString('pt-BR')}.` })
  req.db.prepare(`INSERT INTO office_certificate (id,sealed,holder_name,holder_document,valid_until,created_at) VALUES (1,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET sealed=excluded.sealed,holder_name=excluded.holder_name,holder_document=excluded.holder_document,valid_until=excluded.valid_until,created_at=CURRENT_TIMESTAMP`)
    .run(sealCertificate(req.file.buffer, req.body.password, secret), certificate.holderName, certificate.document, certificate.validUntil)
  res.json(officeCertificateRow(req.db))
})
app.delete('/api/office-certificate', adminOnly, (req, res) => { req.db.prepare('DELETE FROM office_certificate WHERE id=1').run(); res.status(204).end() })
app.post('/api/cadastro/consulta', asyncRoute(async (req, res) => {
  // Usa o certificado do produtor, se houver; senão, o do escritório.
  const producerId = Number(req.body.producer_id) || null
  const own = producerId && req.db.prepare('SELECT sealed FROM certificates WHERE producer_id=?').get(producerId)
  const office = !own && req.db.prepare('SELECT sealed FROM office_certificate WHERE id=1').get()
  if (!own && !office) return res.status(400).json({ error: 'Para consultar a inscrição, cadastre o certificado A1 do produtor (Produtores, ícone de escudo) ou o certificado do escritório (Usuários).' })
  try {
    const certificate = openCertificate((own || office).sealed, secret)
    const result = await consultaCadastro({ certificate, uf: req.body.uf || 'GO', ie: req.body.ie })
    res.json({ ...result, certificate_used: own ? 'produtor' : 'escritorio' })
  } catch (error) { res.status(error.status || 502).json({ error: error.message }) }
}))

// Período opcional da busca (datas de emissão). Devolve null quando não informado.
const periodFrom = body => {
  if (!body.from && !body.to) return null
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
  if (!valid(body.from) || !valid(body.to) || body.from > body.to) throw Object.assign(new Error('Informe um período válido (data inicial até a data final).'), { status: 400 })
  return { from: body.from, to: body.to }
}
app.post('/api/sefaz/import-stored', (req, res) => {
  const producer = req.db.prepare('SELECT id,cpf FROM producers WHERE id=?').get(Number(req.body.producer_id))
  if (!producer) return res.status(404).json({ error: 'Produtor não encontrado.' })
  const farmId = req.body.farm_id ? Number(req.body.farm_id) : null
  if (farmId && !req.db.prepare('SELECT id FROM farms WHERE id=? AND producer_id=?').get(farmId, producer.id)) return res.status(400).json({ error: 'A fazenda selecionada não pertence ao produtor.' })
  let period
  try { period = periodFrom(req.body) } catch (error) { return res.status(400).json({ error: error.message }) }
  res.json(importStored({ db: req.db, producer, period, importXml: invoiceImporter(req.db, producer, farmId) }))
})
const syncing = new Set()
app.post('/api/sefaz/sync', asyncRoute(async (req, res) => {
  const producer = req.db.prepare('SELECT id,cpf,name FROM producers WHERE id=?').get(Number(req.body.producer_id))
  if (!producer) return res.status(404).json({ error: 'Produtor não encontrado.' })
  const row = req.db.prepare('SELECT sealed,uf FROM certificates WHERE producer_id=?').get(producer.id)
  if (!row) return res.status(400).json({ error: 'Cadastre o certificado A1 do produtor antes de buscar na SEFAZ.' })
  const lock = `${req.companyId}:${producer.id}`
  if (syncing.has(lock)) return res.status(409).json({ error: 'Já existe uma busca em andamento para este produtor.' })
  syncing.add(lock)
  try {
    const certificate = openCertificate(row.sealed, secret)
    const farmId = req.body.farm_id ? Number(req.body.farm_id) : null
    if (farmId && !req.db.prepare('SELECT id FROM farms WHERE id=? AND producer_id=?').get(farmId, producer.id)) return res.status(400).json({ error: 'A fazenda selecionada não pertence ao produtor.' })
    const importXml = invoiceImporter(req.db, producer, farmId)
    res.json(await syncProducer({ db: req.db, producer, certificate, uf: row.uf, importXml, period: periodFrom(req.body) }))
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message })
  } finally { syncing.delete(lock) }
}))
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
  if (!['cattle','soy','fuel','other'].includes(ncmCategory)) return res.status(400).json({ error: 'Selecione uma classificação válida.' })
  if (cattleQuantity != null && (!Number.isInteger(cattleQuantity) || cattleQuantity < 0)) return res.status(400).json({ error: 'A quantidade de gado deve ser um número inteiro igual ou maior que zero.' })
  const normalizedCategory = documentType === 'invoice' ? ncmCategory : 'other'
  const normalizedQuantity = documentType === 'invoice' ? cattleQuantity : null
  const movement = String(req.body.movement ?? '').trim().slice(0, 80) || null
  const filename = `lancamento-manual-${invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const info = req.db.prepare(`INSERT INTO invoices (producer_id,farm_id,participant_id,issue_date,invoice_number,amount,original_filename,xml_content,operation_type,ncm_category,cattle_quantity,is_reviewed,is_manual,document_type,movement) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).run(producerId,farmId,participantId,issueDate,invoiceNumber,amount,filename,'',operationType,normalizedCategory,normalizedQuantity,1,documentType,movement)
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
  res.json(req.db.prepare(`SELECT i.id,i.issue_date,i.invoice_number,i.amount,i.operation_type,i.ncm_codes,i.ncm_category,i.cattle_quantity,i.is_reviewed,i.is_manual,i.document_type,i.movement,i.access_key,i.issuer_name,i.original_filename,i.producer_id,(SELECT COUNT(*) FROM attachments a WHERE a.invoice_id=i.id) attachment_count,i.farm_id,i.participant_id,p.name producer_name,f.name farm_name,pt.name participant_name FROM invoices i JOIN producers p ON p.id=i.producer_id LEFT JOIN farms f ON f.id=i.farm_id LEFT JOIN participants pt ON pt.id=i.participant_id ${filters.length?'WHERE '+filters.join(' AND '):''} ORDER BY COALESCE(i.issue_date,i.created_at) DESC`).all(...params))
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
  if (!['cattle','soy','fuel','other'].includes(ncm_category)) return res.status(400).json({ error: 'Selecione uma classificação NCM válida.' })
  const documentType = req.body.document_type || 'invoice'
  if (!['invoice','payroll','contract'].includes(documentType)) return res.status(400).json({ error: 'Tipo de documento inválido.' })
  const category = documentType === 'invoice' ? ncm_category : 'other'
  const movement = String(req.body.movement ?? '').trim().slice(0, 80) || null
  const cattleQuantity = category === 'cattle' && req.body.cattle_quantity !== '' && req.body.cattle_quantity != null ? Number(req.body.cattle_quantity) : null
  if (cattleQuantity != null && (!Number.isInteger(cattleQuantity) || cattleQuantity < 0)) return res.status(400).json({ error: 'A quantidade de gado deve ser um número inteiro igual ou maior que zero.' })
  const operationType = operation_type
  const isReviewed = req.body.is_reviewed === 0 || req.body.is_reviewed === false ? 0 : 1
  req.db.prepare('UPDATE invoices SET issue_date=?,producer_id=?,farm_id=?,participant_id=?,invoice_number=?,amount=?,operation_type=?,ncm_category=?,cattle_quantity=?,is_reviewed=?,document_type=?,movement=? WHERE id=?').run(issue_date||null,producer_id,farm_id||null,participant_id||null,invoice_number,Number(amount)||0,operationType,category,cattleQuantity,isReviewed,documentType,movement,req.params.id)
  res.json({ ok: true, is_reviewed: isReviewed })
})
// LCDPR: dados fiscais por produtor, contador da empresa e geração do arquivo.
const readJson = (text, fallback) => { try { return JSON.parse(text) } catch { return fallback } }
const lcdprContext = (database, producerId) => {
  const producer = database.prepare('SELECT * FROM producers WHERE id=?').get(producerId)
  if (!producer) return null
  const partners = database.prepare('SELECT document, share FROM farm_partners WHERE farm_id=? ORDER BY id')
  const farms = database.prepare('SELECT * FROM farms WHERE producer_id=? ORDER BY id').all(producerId).map(farm => ({ ...farm, partners: partners.all(farm.id) }))
  const settings = mergeSettings(readJson(database.prepare('SELECT data FROM lcdpr_settings WHERE producer_id=?').get(producerId)?.data, {}))
  const accountant = { ...defaultAccountant, ...readJson(database.prepare("SELECT value FROM company_settings WHERE key='lcdpr_accountant'").get()?.value, {}) }
  return { producer, farms, settings, accountant }
}
app.get('/api/lcdpr/settings', (req, res) => {
  const context = lcdprContext(req.db, Number(req.query.producer_id))
  if (!context) return res.status(404).json({ error: 'Produtor não encontrado.' })
  const names = new Map(req.db.prepare('SELECT document,name FROM participants').all().map(row => [row.document, row.name]))
  res.json({ settings: context.settings, accountant: context.accountant, farms: context.farms.map(farm => {
    const fiscal = farmLcdpr(farm, context.settings, names)
    return { id: farm.id, name: farm.name, state_registration: farm.state_registration, ownership_type: farm.ownership_type, partners: farm.partners, share: fiscal.share, exploration: fiscal.exploration, nirf: fiscal.nirf, caepf: fiscal.caepf, uf: fiscal.uf, city_code: fiscal.cityCode }
  }) })
})
app.put('/api/lcdpr/settings', (req, res) => {
  const producerId = Number(req.body.producer_id)
  if (!req.db.prepare('SELECT id FROM producers WHERE id=?').get(producerId)) return res.status(404).json({ error: 'Produtor não encontrado.' })
  const settings = mergeSettings(req.body.settings || {})
  const accountant = { ...defaultAccountant, ...(req.body.accountant || {}) }
  req.db.transaction(() => {
    req.db.prepare('INSERT INTO lcdpr_settings (producer_id,data,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(producer_id) DO UPDATE SET data=excluded.data,updated_at=CURRENT_TIMESTAMP').run(producerId, JSON.stringify(settings))
    req.db.prepare("INSERT INTO company_settings (key,value) VALUES ('lcdpr_accountant',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(accountant))
  })()
  res.json({ ok: true })
})
// Período livre (data inicial e final) e propriedades escolhidas, como no programa usado pelo escritório.
app.get('/api/lcdpr', (req, res) => {
  const year = /^\d{4}$/.test(String(req.query.year || '')) ? String(req.query.year) : ''
  const from = String(req.query.from || (year ? `${year}-01-01` : '')), to = String(req.query.to || (year ? `${year}-12-31` : ''))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return res.status(400).json({ error: 'Informe a data inicial e a data final do período.' })
  const context = lcdprContext(req.db, Number(req.query.producer_id))
  if (!context) return res.status(404).json({ error: 'Produtor não encontrado.' })
  const chosen = String(req.query.farms || '').split(',').map(Number).filter(Boolean)
  const farms = chosen.length ? context.farms.filter(farm => chosen.includes(farm.id)) : context.farms
  const all = req.db.prepare(`SELECT i.id,i.issue_date,i.invoice_number,i.amount,i.operation_type,i.ncm_category,i.document_type,i.farm_id,pt.document participant_document,pt.name participant_name
    FROM invoices i LEFT JOIN participants pt ON pt.id=i.participant_id WHERE i.producer_id=? AND i.issue_date>=? AND i.issue_date<=? ORDER BY i.issue_date,i.id`).all(context.producer.id, from, to)
  // Só entram as notas das propriedades escolhidas (e as sem fazenda, que vão para o imóvel padrão).
  const invoices = all.filter(invoice => !invoice.farm_id || farms.some(farm => farm.id === invoice.farm_id) || !context.farms.some(farm => farm.id === invoice.farm_id))
  const names = new Map([...req.db.prepare('SELECT document,name FROM participants').all().map(row => [row.document, row.name]), ...req.db.prepare('SELECT cpf,name FROM producers').all().map(row => [row.cpf, row.name])])
  const result = buildLcdpr({ ...context, farms, invoices, period: { from, to }, names })
  // Todo arquivo gerado passa pelo validador do leiaute antes de ser liberado.
  if (!result.errors.length) result.errors.push(...validateLcdpr(result.text).map(problem => `Formato: ${problem}`))
  res.status(result.errors.length ? 422 : 200).json({ ...result, version: LCDPR_LAYOUT_VERSION, text: result.errors.length ? '' : result.text })
})

const attachmentTypes = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }
const safeFilename = name => String(name || 'comprovante').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150) || 'comprovante'
app.get('/api/invoices/:id/attachments', (req, res) => {
  if (!req.db.prepare('SELECT id FROM invoices WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Lançamento não encontrado.' })
  res.json(req.db.prepare('SELECT id,filename,mime_type,size,created_at FROM attachments WHERE invoice_id=? ORDER BY id').all(req.params.id))
})
app.post('/api/invoices/:id/attachments', upload.single('file'), (req, res) => {
  if (!req.db.prepare('SELECT id FROM invoices WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Lançamento não encontrado.' })
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' })
  if (!attachmentTypes[req.file.mimetype]) return res.status(400).json({ error: 'Envie um PDF ou uma imagem (JPG, PNG ou WEBP).' })
  const info = req.db.prepare('INSERT INTO attachments (invoice_id,filename,mime_type,size,data) VALUES (?,?,?,?,?)').run(req.params.id, safeFilename(Buffer.from(req.file.originalname, 'latin1').toString('utf8')), req.file.mimetype, req.file.size, req.file.buffer)
  res.status(201).json(req.db.prepare('SELECT id,filename,mime_type,size,created_at FROM attachments WHERE id=?').get(info.lastInsertRowid))
})
app.get('/api/attachments/:id', (req, res) => {
  const row = req.db.prepare('SELECT filename,mime_type,data FROM attachments WHERE id=?').get(req.params.id)
  if (!row || !attachmentTypes[row.mime_type]) return res.status(404).json({ error: 'Anexo não encontrado.' })
  res.set('X-Content-Type-Options', 'nosniff').type(row.mime_type).attachment(row.filename).send(row.data)
})
app.delete('/api/attachments/:id', (req, res) => { req.db.prepare('DELETE FROM attachments WHERE id=?').run(req.params.id); res.status(204).end() })
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
startBackupSchedule()
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { closeDatabases(); process.exit(0) }))
