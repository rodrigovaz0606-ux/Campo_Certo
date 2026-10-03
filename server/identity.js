import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { registry as db, companyDatabase, createCompany } from './tenancy.js'

const clean = value => String(value || '').trim()
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const publicUser = id => db.prepare(`SELECT u.id,u.name,u.email,u.is_admin,u.company_id,u.session_version,u.created_at,c.name company_name
  FROM users u JOIN companies c ON c.id=u.company_id WHERE u.id=? AND c.deleted_at IS NULL`).get(id)

export function identityRoutes(app, { secret, auth, adminOnly }) {
  const loginResponse = (res, id, status = 200) => {
    const user = publicUser(id)
    if (!user) return res.status(401).json({ error: 'Acesso indisponível.' })
    res.status(status).json({ token: jwt.sign({ id: user.id, session_version: user.session_version }, secret, { expiresIn: '8h' }), user })
  }
  app.post('/api/auth/register', asyncRoute(async (req, res) => {
    if (db.prepare('SELECT COUNT(*) total FROM users').get().total) return res.status(403).json({ error: 'O cadastro público está desativado.' })
    const name = clean(req.body.name), email = clean(req.body.email).toLowerCase(), password = String(req.body.password || '')
    if (!name || !email || password.length < 6) return res.status(400).json({ error: 'Informe nome, e-mail e senha com ao menos 6 caracteres.' })
    const hash = await bcrypt.hash(password, 10)
    const id = db.transaction(() => {
      if (db.prepare('SELECT COUNT(*) total FROM users').get().total) return null
      return Number(db.prepare('INSERT INTO users(name,email,password_hash,is_admin,company_id) VALUES (?,?,?,1,1)').run(name,email,hash).lastInsertRowid)
    })()
    if (!id) return res.status(403).json({ error: 'O cadastro público está desativado.' })
    loginResponse(res, id, 201)
  }))
  app.post('/api/auth/login', asyncRoute(async (req, res) => {
    const user = db.prepare('SELECT id,password_hash,session_version FROM users WHERE email=?').get(clean(req.body.email).toLowerCase())
    if (!user || !await bcrypt.compare(String(req.body.password || ''), user.password_hash)) return res.status(401).json({ error: 'E-mail ou senha incorretos.' })
    const current = db.prepare('SELECT password_hash,session_version FROM users WHERE id=?').get(user.id)
    if (!current || current.password_hash !== user.password_hash || current.session_version !== user.session_version) return res.status(401).json({ error: 'O acesso foi atualizado. Entre novamente.' })
    loginResponse(res, user.id)
  }))

  app.use('/api', auth)
  app.get('/api/me', (req, res) => res.json(req.user))
  app.get('/api/companies', adminOnly, (req, res) => res.json(db.prepare('SELECT id,name,created_at FROM companies WHERE deleted_at IS NULL ORDER BY name').all()))
  app.post('/api/companies', adminOnly, (req, res) => {
    const name = clean(req.body.name)
    if (!name || name.length > 120) return res.status(400).json({ error: 'Informe o nome da empresa (até 120 caracteres).' })
    res.status(201).json(createCompany(name))
  })
  app.put('/api/companies/:id', adminOnly, (req, res) => {
    const name = clean(req.body.name)
    if (!name || name.length > 120) return res.status(400).json({ error: 'Informe o nome da empresa (até 120 caracteres).' })
    if (!db.prepare('UPDATE companies SET name=? WHERE id=? AND deleted_at IS NULL').run(name, req.params.id).changes) return res.status(404).json({ error: 'Empresa não encontrada.' })
    res.json(db.prepare('SELECT id,name FROM companies WHERE id=?').get(req.params.id))
  })
  app.delete('/api/companies/:id', adminOnly, (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Empresa inválida.' })
    if (id === 1 || db.prepare('SELECT id FROM users WHERE company_id=? AND is_admin=1').get(id)) return res.status(400).json({ error: 'A empresa original do administrador não pode ser excluída.' })
    const removed = db.transaction(() => {
      const result = db.prepare('UPDATE companies SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL').run(id)
      if (result.changes) db.prepare('UPDATE users SET session_version=session_version+1 WHERE company_id=?').run(id)
      return result.changes
    })()
    if (!removed) return res.status(404).json({ error: 'Empresa não encontrada.' })
    res.status(204).end()
  })
  app.get('/api/users', adminOnly, (req, res) => res.json(db.prepare(`SELECT u.id,u.name,u.email,u.is_admin,u.company_id,u.created_at,c.name company_name
    FROM users u JOIN companies c ON c.id=u.company_id WHERE c.deleted_at IS NULL ORDER BY u.name`).all()))
  app.post('/api/users', adminOnly, asyncRoute(async (req, res) => {
    const name = clean(req.body.name), email = clean(req.body.email).toLowerCase(), password = String(req.body.password || '')
    const companyId = Number(req.body.company_id)
    if (!name || !email || password.length < 6) return res.status(400).json({ error: 'Informe nome, e-mail e senha com ao menos 6 caracteres.' })
    if (!Number.isSafeInteger(companyId) || !db.prepare('SELECT id FROM companies WHERE id=? AND deleted_at IS NULL').get(companyId)) return res.status(400).json({ error: 'Selecione a empresa deste usuário.' })
    const hash = await bcrypt.hash(password, 10)
    if (!db.prepare('SELECT id FROM companies WHERE id=? AND deleted_at IS NULL').get(companyId)) return res.status(400).json({ error: 'Empresa indisponível.' })
    // The administrator flag is never accepted from the client.
    const id = Number(db.prepare('INSERT INTO users(name,email,password_hash,is_admin,company_id) VALUES (?,?,?,0,?)').run(name,email,hash,companyId).lastInsertRowid)
    res.status(201).json(publicUser(id))
  }))
  app.put('/api/users/:id', adminOnly, asyncRoute(async (req, res) => {
    const existing = publicUser(req.params.id)
    if (!existing) return res.status(404).json({ error: 'Usuário não encontrado.' })
    const name = clean(req.body.name), email = clean(req.body.email).toLowerCase(), password = String(req.body.password || '')
    const companyId = Number(req.body.company_id ?? existing.company_id)
    if (!name || !email || (password && password.length < 6)) return res.status(400).json({ error: 'Informe nome, e-mail e senha válida.' })
    if (!Number.isSafeInteger(companyId) || !db.prepare('SELECT id FROM companies WHERE id=? AND deleted_at IS NULL').get(companyId)) return res.status(400).json({ error: 'Empresa inválida.' })
    if (existing.is_admin && companyId !== existing.company_id) return res.status(400).json({ error: 'Use o seletor de empresa para alternar o acesso do administrador.' })
    const hash = password ? await bcrypt.hash(password, 10) : null
    if (!publicUser(existing.id) || !db.prepare('SELECT id FROM companies WHERE id=? AND deleted_at IS NULL').get(companyId)) return res.status(400).json({ error: 'Empresa indisponível.' })
    db.prepare(`UPDATE users SET name=?,email=?,company_id=?,password_hash=COALESCE(?,password_hash),
      session_version=session_version+? WHERE id=?`).run(name,email,companyId,hash,Number(Boolean(password) || companyId !== existing.company_id),existing.id)
    res.json(publicUser(existing.id))
  }))
  app.delete('/api/users/:id', adminOnly, (req, res) => {
    const user = publicUser(req.params.id)
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' })
    if (user.is_admin) return res.status(400).json({ error: 'Não é possível excluir o administrador.' })
    db.prepare('DELETE FROM users WHERE id=?').run(user.id)
    res.status(204).end()
  })

  // Every business route receives a connection derived from the authenticated account.
  // Only the sole administrator may explicitly select a different company.
  app.use('/api', (req, res, next) => {
    let companyId = req.user.company_id
    const selected = req.get('X-Company-Id')
    if (selected !== undefined) {
      const id = Number(selected)
      if (!req.user.is_admin && id !== companyId) return res.status(403).json({ error: 'Você não pode acessar outra empresa.' })
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Empresa inválida.' })
      companyId = id
    }
    if (!db.prepare('SELECT id FROM companies WHERE id=? AND deleted_at IS NULL').get(companyId)) return res.status(404).json({ error: 'Empresa não encontrada.' })
    try { req.db = companyDatabase(companyId); req.companyId = companyId; next() }
    catch { res.status(503).json({ error: 'Os dados desta empresa estão indisponíveis. Contate o administrador.' }) }
  })
}
