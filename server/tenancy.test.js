import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { openBusinessDatabase } from './db.js'

const secret = 'test-only-secret-not-for-production-12345678'
const xml = '<nfeProc><NFe><infNFe Id="NFe123"><ide><nNF>42</nNF><dhEmi>2026-08-04T10:00:00-03:00</dhEmi></ide><emit><xNome>Produtor teste</xNome><CPF>11122233344</CPF></emit><dest><xNome>Cliente teste</xNome><CNPJ>55566677000188</CNPJ></dest><det><prod><NCM>01022190</NCM></prod></det><total><ICMSTot><vNF>100</vNF></ICMSTot></total></infNFe></NFe></nfeProc>'

async function start(dir) {
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DATA_DIR: dir, JWT_SECRET: secret, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stderr.on('data', chunk => { log += chunk })
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Startup timeout: ${log}`)) }, 15000)
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${log}`)) })
    child.stdout.on('data', chunk => {
      const match = String(chunk).match(/http:\/\/localhost:(\d+)/)
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`) }
    })
  })
  return { url, async stop() { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited } } }
}

test('migração preserva dados e administrador; empresas ficam isoladas em todas as operações', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-tenancy-'))
  let server
  t.after(async () => { await server?.stop(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const filename = path.join(dir, 'produtor-rural.db')
  const legacy = openBusinessDatabase(filename)
  const hash = bcrypt.hashSync('teste123', 4)
  legacy.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, password_hash TEXT, is_admin INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
  legacy.prepare('INSERT INTO users VALUES (3,?,?,?,1,CURRENT_TIMESTAMP)').run('Rodrigo','admin@test.local',hash)
  legacy.prepare('INSERT INTO users VALUES (5,?,?,?,0,CURRENT_TIMESTAMP)').run('Funcionário original','original@test.local',hash)
  legacy.prepare('INSERT INTO producers(name,cpf,address) VALUES (?,?,?)').run('Original','11122233344','Rua A')
  legacy.prepare('INSERT INTO producers(name,cpf,address) VALUES (?,?,?)').run('Só original','22233344455','Rua A')
  legacy.prepare('INSERT INTO participants(name,document) VALUES (?,?)').run('Original','55566677000188')
  legacy.prepare('INSERT INTO participants(name,document) VALUES (?,?)').run('Só original','66677788000199')
  legacy.exec("INSERT INTO farms(producer_id,name,state_registration,address,ownership_type) VALUES (1,'Original','12345678','Rua A','unique'),(2,'Só original','87654321','Rua A','unique')")
  legacy.prepare('INSERT INTO invoices(producer_id,farm_id,participant_id,original_filename,xml_content,access_key,amount) VALUES (1,1,1,?,?,?,100)').run('original.xml',xml,'123')
  legacy.prepare('INSERT INTO invoices(producer_id,original_filename,xml_content,amount) VALUES (2,?,?,200)').run('exclusivo.xml',xml)
  legacy.exec('INSERT INTO animal_stock(producer_id,farm_id,year,species_code,initial_stock) VALUES (2,2,2026,1,50)')
  legacy.close()
  server = await start(dir)
  async function request(endpoint, token, { method='GET', body, company, form }={}) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    if (company !== undefined) headers['X-Company-Id'] = String(company)
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetch(server.url + '/api' + endpoint, { method, headers, body: form || (body === undefined ? undefined : JSON.stringify(body)) })
    const text = await response.text()
    let data; try { data = JSON.parse(text) } catch { data = text }
    return { status: response.status, data }
  }
  const login = async email => {
    const response = await request('/auth/login', null, { method:'POST', body:{ email, password:'teste123' } })
    assert.equal(response.status, 200); return response.data.token
  }
  const admin = await login('admin@test.local')
  const originalToken = await login('original@test.local')
  const me = (await request('/me', admin)).data
  assert.equal(me.id, 3); assert.equal(me.is_admin, 1); assert.equal(me.company_id, 1)
  assert.equal((await request('/producers', originalToken)).data.length, 2)
  assert.equal((await request('/invoices/1/xml', originalToken)).data, xml)
  assert.equal((await request('/auth/register', null, { method:'POST', body:{name:'Other',email:'other',password:'teste123'} })).status,403)
  const oldToken = jwt.sign({id:3},secret)
  assert.equal((await request('/me', oldToken)).status,401)
  assert.equal(fs.readdirSync(path.join(dir,'backups')).filter(f=>f.endsWith('.db')).length,1)
  const backup = new Database(path.join(dir,'backups',fs.readdirSync(path.join(dir,'backups'))[0]),{readonly:true})
  assert.equal(backup.prepare('SELECT password_hash FROM users WHERE id=3').get().password_hash,hash)
  assert.equal(backup.prepare('SELECT COUNT(*) n FROM invoices').get().n,2); backup.close()

  const company = await request('/companies', admin, {method:'POST',body:{name:'Cliente B'}})
  assert.equal(company.status,201); const companyId=company.data.id
  assert.deepEqual((await request('/dashboard', admin, {company:companyId})).data, {producers:0,farms:0,participants:0,invoices:{total:0,amount:0}})
  const created = await request('/users', admin, {method:'POST',body:{name:'Cliente B',email:'b@test.local',password:'teste123',company_id:companyId,is_admin:1}})
  assert.equal(created.status,201); assert.equal(created.data.is_admin,0)
  const userId=created.data.id, token=await login('b@test.local')
  for (const endpoint of ['/companies','/users']) assert.equal((await request(endpoint,token)).status,403)
  for (const [endpoint,method] of [['/companies','POST'],['/companies/1','PUT'],['/users','POST'],['/users/3','PUT'],['/users/3','DELETE']]) {
    assert.equal((await request(endpoint,token,{method,body:{name:'Hacked',email:'hack',password:'teste123',company_id:1}})).status,403)
  }
  assert.equal((await request('/users',admin,{method:'POST',body:{name:'No company',email:'missing',password:'teste123'}})).status,400)
  assert.equal((await request('/dashboard',token,{company:1})).status,403)
  assert.equal((await request('/dashboard',admin,{company:'../1'})).status,400)
  assert.equal((await request('/dashboard',admin,{company:9999})).status,404)
  assert.equal((await request('/producers?company_id=1',token)).data.length,0)

  const address={address:'Rua teste',address_number:'1',zip_code:'12345678',neighborhood:'Centro'}
  const producer={name:'Cliente B',cpf:'11122233344',...address,company_id:1}
  assert.equal((await request('/producers',token,{method:'POST',body:producer})).status,201)
  assert.equal((await request('/producers',token,{method:'POST',body:producer})).status,409)
  const farm={producer_id:1,name:'B',state_registration:'12345678',ownership_type:'unique',...address}
  assert.equal((await request('/farms',token,{method:'POST',body:farm})).status,201)
  assert.equal((await request('/farms',token,{method:'POST',body:farm})).status,409)
  assert.equal((await request('/participants',token,{method:'POST',body:{name:'B',document:'55566677000188'}})).status,201)
  const form = () => { const f=new FormData(); f.set('producer_id','1'); f.set('farm_id','1'); f.append('files',new Blob([xml],{type:'application/xml'}),'b.xml'); return f }
  assert.equal((await request('/invoices/import',token,{method:'POST',form:form()})).data.imported,1)
  assert.equal((await request('/invoices/import',token,{method:'POST',form:form()})).data.duplicates,1)
  assert.equal((await request('/invoices/1/xml',token)).data,xml)
  assert.equal((await request('/dashboard',originalToken)).data.producers,2)
  assert.equal((await request('/dashboard',token)).data.producers,1)
  assert.equal((await request('/invoices?producer_id=2',token)).data.length,0)
  assert.equal((await request('/invoices/2/xml',token)).status,404)
  assert.equal((await request('/annual-summary?producer_id=2&year=2026',token)).status,400)
  assert.equal((await request('/animal-stock?producer_id=2&year=2026',token)).status,400)
  assert.equal((await request('/cattle-summary?producer_id=2&year=2026',token)).data.cattle_notes,0)
  assert.deepEqual((await request('/invoice-years',token)).data,['2026'])
  assert.equal((await request('/animal-stock',token,{method:'PUT',body:{producer_id:2,year:2026,rows:[]}})).status,400)
  assert.equal((await request('/farms/2',token,{method:'PUT',body:{...farm,state_registration:'87654321'}})).status,404)
  assert.equal((await request('/producers/2',token,{method:'PUT',body:{...producer,cpf:'22233344455'}})).status,404)
  assert.equal((await request('/participants/2',token,{method:'PUT',body:{name:'Changed',document:'66677788000199'}})).status,404)
  const manual={producer_id:1,farm_id:1,participant_id:1,issue_date:'2026-08-04',invoice_number:'M1',amount:10,operation_type:'incoming',ncm_category:'other',document_type:'invoice'}
  assert.equal((await request('/invoices/manual',token,{method:'POST',body:{...manual,producer_id:2}})).status,400)
  assert.equal((await request('/invoices/2',token,{method:'PUT',body:manual})).status,400)
  assert.equal((await request('/invoices/1',token,{method:'PUT',body:{...manual,farm_id:2}})).status,400)
  assert.equal((await request('/invoices/1',token,{method:'PUT',body:{...manual,participant_id:2}})).status,400)
  assert.equal((await request('/invoices/bulk',token,{method:'DELETE',body:{ids:[2]}})).data.deleted,0)
  for (const resource of ['producers','farms','participants','invoices']) await request(`/${resource}/2`,token,{method:'DELETE'})
  assert.equal((await request('/producers',originalToken)).data.length,2)
  assert.equal((await request('/invoices/2/xml',originalToken)).status,200)
  assert.equal((await request('/invoices/manual',token,{method:'POST',body:manual})).status,201)
  const mixed=await request('/invoices/bulk',token,{method:'DELETE',body:{ids:[1,9999]}})
  assert.equal(mixed.data.deleted,1)
  assert.equal((await request('/invoices/1/xml',originalToken)).status,200)
  assert.equal((await request('/users/3',admin,{method:'DELETE'})).status,400)
  assert.equal((await request(`/users/${userId}`,admin,{method:'PUT',body:{name:'B',email:'b@test.local',company_id:1,is_admin:1}})).status,200)
  assert.equal((await request('/me',token)).status,401)
  const moved=await login('b@test.local')
  assert.equal((await request('/me',moved)).data.is_admin,0)
  assert.equal((await request('/dashboard',moved)).data.producers,2)
  const users=(await request('/users',admin)).data
  assert.deepEqual(users.filter(u=>u.is_admin).map(u=>u.id),[3])
  const removable=(await request('/companies',admin,{method:'POST',body:{name:'Excluir teste'}})).data.id
  await request('/users',admin,{method:'POST',body:{name:'Excluir teste',email:'delete@test.local',password:'teste123',company_id:removable}})
  const removedUser=await login('delete@test.local')
  await request('/producers',removedUser,{method:'POST',body:producer})
  assert.equal((await request(`/companies/${removable}`,removedUser,{method:'DELETE'})).status,403)
  assert.equal((await request('/companies/1',admin,{method:'DELETE'})).status,400)
  assert.equal((await request(`/companies/${removable}`,admin,{method:'DELETE'})).status,204)
  assert.equal((await request('/companies',admin)).data.some(c=>c.id===removable),false)
  assert.equal((await request('/dashboard',removedUser)).status,401)
  assert.equal((await request('/auth/login',null,{method:'POST',body:{email:'delete@test.local',password:'teste123'}})).status,401)
  assert.equal((await request('/dashboard',admin,{company:removable})).status,404)
  assert.equal((await request(`/companies/${removable}`,admin,{method:'PUT',body:{name:'Restore'}})).status,404)
  assert.equal((await request(`/companies/${removable}`,admin,{method:'DELETE'})).status,404)
  assert.equal((await request('/users',admin,{method:'POST',body:{name:'Invalid',email:'invalid@test.local',password:'teste123',company_id:removable}})).status,400)
  const archive=new Database(path.join(dir,'companies',`${removable}.db`),{readonly:true})
  assert.equal(archive.prepare('SELECT COUNT(*) n FROM producers').get().n,1); archive.close()
  await server.stop(); server=await start(dir)
  assert.equal((await request('/dashboard',admin,{company:companyId})).data.producers,1)
  assert.equal(fs.readdirSync(path.join(dir,'backups')).filter(f=>f.endsWith('.db')).length,1)
  const inspect=new Database(filename,{readonly:true})
  assert.equal(inspect.prepare('SELECT password_hash FROM users WHERE id=3').get().password_hash,hash)
  assert.equal(inspect.prepare('SELECT COUNT(*) n FROM invoices').get().n,2)
  assert.equal(inspect.pragma('integrity_check',{simple:true}),'ok'); inspect.close()
  await server.stop()
  const companyFile=path.join(dir,'companies',`${companyId}.db`)
  fs.renameSync(companyFile,companyFile+'.saved')
  server=await start(dir)
  assert.equal((await request('/dashboard',admin,{company:companyId})).status,503)
  assert.equal(fs.existsSync(companyFile),false)
  assert.equal((await request('/dashboard',admin)).status,200)
})

test('primeiro cadastro concorrente cria somente um administrador',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'campo-bootstrap-'))
  const server=await start(dir)
  t.after(async()=>{await server.stop();fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200})})
  const results=await Promise.all(['first','second'].map(email=>fetch(server.url+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:email,email,password:'teste123'})})))
  assert.deepEqual(results.map(r=>r.status).sort(),[201,403])
})
