import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import https from 'node:https'
import zlib from 'node:zlib'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import forge from 'node-forge'
import { DOMParser } from '@xmldom/xmldom'
import { SignedXml } from 'xml-crypto'
import { readCertificate, sealCertificate, openCertificate, signedAwarenessEvent } from './sefaz.js'

const CPF = '11122233344'
const ACCESS_KEY = '52250301409655000180558900271115231143382855'
const SUMMARY_KEY = '52250301409655000180558900271115231143382856'

function makeCertificate({ cn, issuer, issuerKey, altNames, days = 365 }) {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = String(Math.floor(Math.random() * 1e9))
  cert.validity.notBefore = new Date(Date.now() - 86400000)
  cert.validity.notAfter = new Date(Date.now() + days * 86400000)
  cert.setSubject([{ name: 'commonName', value: cn }, { name: 'countryName', value: 'BR' }])
  cert.setIssuer(issuer ? issuer.subject.attributes : [{ name: 'commonName', value: cn }, { name: 'countryName', value: 'BR' }])
  cert.setExtensions([{ name: 'basicConstraints', cA: !issuer }, ...(altNames ? [{ name: 'subjectAltName', altNames }] : [])])
  cert.sign(issuerKey || keys.privateKey, forge.md.sha256.create())
  return { cert, key: keys.privateKey }
}
const ca = makeCertificate({ cn: 'AC TESTE CAMPO CERTO' })
const client = makeCertificate({ cn: `PRODUTOR TESTE:${CPF}`, issuer: ca.cert, issuerKey: ca.key })
const server = makeCertificate({ cn: 'localhost', issuer: ca.cert, issuerKey: ca.key, altNames: [{ type: 7, ip: '127.0.0.1' }, { type: 2, value: 'localhost' }] })
// Formato 3DES usado por muitos certificados ICP-Brasil antigos (o OpenSSL 3 do Node não abre direto).
const pfx = Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(client.key, [client.cert, ca.cert], 'senha123', { algorithm: '3des' })).getBytes(), 'binary')

test('lê o certificado A1, confere a senha e guarda cifrado', () => {
  const info = readCertificate(pfx, 'senha123')
  assert.equal(info.document, CPF)
  assert.equal(info.holderName, 'PRODUTOR TESTE')
  assert.ok(new Date(info.validUntil) > new Date())
  assert.throws(() => readCertificate(pfx, 'errada'), /Senha do certificado incorreta/)
  assert.throws(() => readCertificate(Buffer.from('não é certificado'), 'x'), /certificado inválido/)
  const sealed = sealCertificate(pfx, 'senha123', 'segredo-do-servidor')
  assert.ok(!sealed.includes(Buffer.from('senha123')))
  assert.equal(openCertificate(sealed, 'segredo-do-servidor').document, CPF)
  assert.throws(() => openCertificate(sealed, 'outro-segredo'), /Envie o certificado novamente/)
})

test('a ciência da operação sai com assinatura XML válida (conferida pelo xml-crypto)', () => {
  const certificate = readCertificate(pfx, 'senha123')
  const xml = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote>${signedAwarenessEvent({ certificate, document: CPF, accessKey: ACCESS_KEY, when: '2026-10-13T10:00:00-03:00' })}</envEvento>`
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const signature = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0]
  const verifier = new SignedXml({ publicCert: forge.pki.certificateToPem(client.cert) })
  verifier.loadSignature(signature)
  assert.equal(verifier.checkSignature(xml), true)
  assert.match(xml, new RegExp(`<infEvento Id="ID210210${ACCESS_KEY}01"><cOrgao>91</cOrgao><tpAmb>1</tpAmb><CPF>${CPF}</CPF>`))
  // Qualquer alteração no conteúdo invalida a assinatura.
  const tampered = xml.replace('<nSeqEvento>1</nSeqEvento>', '<nSeqEvento>2</nSeqEvento>')
  const verifier2 = new SignedXml({ publicCert: forge.pki.certificateToPem(client.cert) })
  verifier2.loadSignature(new DOMParser().parseFromString(tampered, 'text/xml').getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0])
  assert.equal(verifier2.checkSignature(tampered), false)
})

const nfeXml = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${ACCESS_KEY}" versao="4.00"><ide><nNF>27111523</nNF><dhEmi>2025-03-03T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>01409655000180</CNPJ><xNome>Agropecuária Fornecedora</xNome><IE>115058400</IE></emit><dest><CPF>${CPF}</CPF><xNome>Produtor Teste</xNome><IE>115052925</IE></dest><det nItem="1"><prod><NCM>31010000</NCM><uCom>UN</uCom><qCom>10</qCom></prod></det><total><ICMSTot><vNF>4500.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>${ACCESS_KEY}</chNFe></infProt></protNFe></nfeProc>`
// Resumo de hoje (dentro dos 10 dias da ciência) e um resumo antigo (fora do prazo: não recebe ciência).
const OLD_SUMMARY_KEY = '52250301409655000180558900271115231143382857'
const today = new Date().toISOString().slice(0, 10)
const summary = (key, day) => `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${key}</chNFe><CNPJ>01409655000180</CNPJ><xNome>Outro Fornecedor</xNome><IE>1</IE><dhEmi>${day}T10:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>990.50</vNF><digVal>x</digVal><dhRecbto>${day}T10:00:00-03:00</dhRecbto><nProt>1</nProt><cSitNFe>1</cSitNFe></resNFe>`
const summaryXml = summary(SUMMARY_KEY, today)
const oldSummaryXml = summary(OLD_SUMMARY_KEY, '2025-03-05')
const zip = xml => zlib.gzipSync(Buffer.from(xml)).toString('base64')

async function startFakeSefaz() {
  const calls = { dist: [], evento: [] }
  const fake = https.createServer({ key: forge.pki.privateKeyToPem(server.key), cert: forge.pki.certificateToPem(server.cert), ca: forge.pki.certificateToPem(ca.cert), requestCert: true, rejectUnauthorized: true }, (req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const clientCn = req.socket.getPeerCertificate().subject?.CN
      res.setHeader('Content-Type', 'application/soap+xml; charset=utf-8')
      if (req.url === '/dist') {
        calls.dist.push({ clientCn, ultNSU: body.match(/<ultNSU>(\d+)<\/ultNSU>/)?.[1], cpf: body.match(/<CPF>(\d+)<\/CPF>/)?.[1] })
        const first = calls.dist.length === 1
        const ret = first
          ? `<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><verAplic>1</verAplic><cStat>138</cStat><xMotivo>Documento localizado</xMotivo><dhResp>2026-10-13T10:00:00-03:00</dhResp><ultNSU>000000000000003</ultNSU><maxNSU>000000000000003</maxNSU><loteDistDFeInt><docZip NSU="000000000000001" schema="procNFe_v4.00.xsd">${zip(nfeXml)}</docZip><docZip NSU="000000000000002" schema="resNFe_v1.01.xsd">${zip(summaryXml)}</docZip><docZip NSU="000000000000003" schema="resNFe_v1.01.xsd">${zip(oldSummaryXml)}</docZip></loteDistDFeInt></retDistDFeInt>`
          : `<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cStat>137</cStat><xMotivo>Nenhum documento localizado</xMotivo><ultNSU>000000000000003</ultNSU><maxNSU>000000000000003</maxNSU></retDistDFeInt>`
        return res.end(`<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDistDFeInteresseResult>${ret}</nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>`)
      }
      if (req.url === '/cadastro') {
        const ie = body.match(/<IE>(\d+)<\/IE>/)?.[1]
        calls.cadastro = [...(calls.cadastro || []), { clientCn, ie }]
        const info = ie === '999999999' ? '<cStat>259</cStat><xMotivo>Rejeição: IE da consulta não cadastrada como contribuinte na UF</xMotivo>'
          : `<cStat>111</cStat><xMotivo>Consulta cadastro com uma ocorrência</xMotivo><infCad><IE>${ie}</IE><CPF>${CPF}</CPF><UF>GO</UF><cSit>1</cSit><xNome>PRODUTOR TESTE</xNome><CNAE>151201</CNAE><ender><xLgr>RODOVIA GO 164 KM 326</xLgr><nro>S/N</nro><xBairro>ZONA RURAL</xBairro><cMun>5214838</cMun><xMun>NOVA CRIXAS</xMun><CEP>76520000</CEP></ender></infCad>`
        return res.end(`<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4"><retConsCad xmlns="http://www.portalfiscal.inf.br/nfe" versao="2.00"><infCons><verAplic>1</verAplic>${info}<UF>GO</UF><IE>${ie}</IE><dhCons>2026-10-14T10:00:00-03:00</dhCons><cUF>52</cUF></infCons></retConsCad></nfeResultMsg></soap:Body></soap:Envelope>`)
      }
      const keys = [...body.matchAll(/<chNFe>(\d{44})<\/chNFe>/g)].map(m => m[1])
      calls.evento.push({ clientCn, keys, signed: body.includes('<SignatureValue>') })
      const events = keys.map(key => `<retEvento versao="1.00"><infEvento><tpAmb>1</tpAmb><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${key}</chNFe></infEvento></retEvento>`).join('')
      res.end(`<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote><tpAmb>1</tpAmb><cStat>128</cStat><xMotivo>Lote de evento processado</xMotivo>${events}</retEnvEvento></nfeResultMsg></soap:Body></soap:Envelope>`)
    })
  })
  fake.listen(0, '127.0.0.1')
  await once(fake, 'listening')
  return { fake, calls, url: `https://127.0.0.1:${fake.address().port}` }
}

async function startApp(dir, sefazUrl, caFile) {
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DATA_DIR: dir, JWT_SECRET: 'test-only-secret-not-for-production-12345678', NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', BACKUP_DISABLED: '1', SEFAZ_DIST_URL: `${sefazUrl}/dist`, SEFAZ_EVENTO_URL: `${sefazUrl}/evento`, CADASTRO_URL_GO: `${sefazUrl}/cadastro`, SEFAZ_CA_FILE: caFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stderr.on('data', chunk => { log += chunk })
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Startup timeout: ${log}`)) }, 15000)
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${log}`)) })
    child.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/localhost:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`) } })
  })
  return { url, async stop() { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited } } }
}

test('busca na SEFAZ: importa a nota completa, registra a ciência do resumo e respeita o intervalo', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-sefaz-'))
  const caFile = path.join(dir, 'ca.pem')
  fs.writeFileSync(caFile, forge.pki.certificateToPem(ca.cert))
  const { fake, calls, url: sefazUrl } = await startFakeSefaz()
  const app = await startApp(dir, sefazUrl, caFile)
  t.after(async () => { await app.stop(); fake.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const call = async (endpoint, token, { method = 'GET', body, form } = {}) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    if (body) headers['Content-Type'] = 'application/json'
    const response = await fetch(`${app.url}/api${endpoint}`, { method, headers, body: form || (body && JSON.stringify(body)) })
    return { status: response.status, data: await response.json().catch(() => null) }
  }
  const token = (await call('/auth/register', null, { method: 'POST', body: { name: 'Admin', email: 'a@t.local', password: 'teste123' } })).data.token
  const producer = (await call('/producers', token, { method: 'POST', body: { name: 'Produtor Teste', cpf: CPF, address: 'Rua', address_number: '1', zip_code: '76530000', neighborhood: 'Centro' } })).data
  const other = (await call('/producers', token, { method: 'POST', body: { name: 'Outro', cpf: '99988877766', address: 'Rua', address_number: '1', zip_code: '76530000', neighborhood: 'Centro' } })).data

  assert.equal((await call('/sefaz/sync', token, { method: 'POST', body: { producer_id: producer.id } })).status, 400) // sem certificado
  const upload = (password, producerId = producer.id) => { const form = new FormData(); form.append('file', new Blob([pfx]), 'produtor.pfx'); form.append('password', password); form.append('uf', 'GO'); return call(`/producers/${producerId}/certificate`, token, { method: 'PUT', form }) }
  assert.match((await upload('errada')).data.error, /Senha/)
  assert.match((await upload('senha123', other.id)).data.error, /diferente do CPF do produtor/)
  const saved = await upload('senha123')
  assert.equal(saved.status, 200)
  assert.equal(saved.data.holder_document, CPF)

  const first = await call('/sefaz/sync', token, { method: 'POST', body: { producer_id: producer.id } })
  assert.equal(first.status, 200, JSON.stringify(first.data))
  assert.equal(first.data.imported, 1)
  assert.equal(first.data.summaries, 2)
  assert.equal(first.data.manifested, 1) // só o resumo de hoje; o antigo está fora dos 10 dias
  assert.equal(first.data.expiredSummaries, 1)
  assert.deepEqual(first.data.manifestErrors, [])
  assert.ok(first.data.nextAllowedAt)
  assert.deepEqual(calls.dist[0], { clientCn: `PRODUTOR TESTE:${CPF}`, ultNSU: '000000000000000', cpf: CPF })
  assert.deepEqual(calls.evento, [{ clientCn: `PRODUTOR TESTE:${CPF}`, keys: [SUMMARY_KEY], signed: true }])

  const invoices = (await call(`/invoices?producer_id=${producer.id}&year=2025`, token)).data
  assert.equal(invoices.length, 1)
  assert.equal(invoices[0].operation_type, 'incoming')
  assert.equal(invoices[0].amount, 4500)

  const again = await call('/sefaz/sync', token, { method: 'POST', body: { producer_id: producer.id } })
  assert.equal(again.status, 429)
  assert.match(again.data.error, /só permite uma nova consulta/)
  const status = (await call(`/sefaz/status?producer_id=${producer.id}`, token)).data
  assert.equal(status.state.ult_nsu, '000000000000003')
  assert.equal(status.pending, 2)
  assert.equal(status.certificate.holder_name, 'PRODUTOR TESTE')
})

test('busca por período: importa só as notas do período e guarda as outras para depois', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-sefaz-periodo-'))
  const caFile = path.join(dir, 'ca.pem')
  fs.writeFileSync(caFile, forge.pki.certificateToPem(ca.cert))
  const { fake, calls, url: sefazUrl } = await startFakeSefaz()
  const app = await startApp(dir, sefazUrl, caFile)
  t.after(async () => { await app.stop(); fake.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const call = async (endpoint, token, { method = 'GET', body, form } = {}) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    if (body) headers['Content-Type'] = 'application/json'
    const response = await fetch(`${app.url}/api${endpoint}`, { method, headers, body: form || (body && JSON.stringify(body)) })
    return { status: response.status, data: await response.json().catch(() => null) }
  }
  const token = (await call('/auth/register', null, { method: 'POST', body: { name: 'Admin', email: 'a@t.local', password: 'teste123' } })).data.token
  const producer = (await call('/producers', token, { method: 'POST', body: { name: 'Produtor Teste', cpf: CPF, address: 'Rua', address_number: '1', zip_code: '76530000', neighborhood: 'Centro' } })).data
  const form = new FormData(); form.append('file', new Blob([pfx]), 'produtor.pfx'); form.append('password', 'senha123'); form.append('uf', 'GO')
  assert.equal((await call(`/producers/${producer.id}/certificate`, token, { method: 'PUT', form })).status, 200)

  assert.equal((await call('/sefaz/sync', token, { method: 'POST', body: { producer_id: producer.id, from: '2025-04-30', to: '2025-04-01' } })).status, 400)
  const april = await call('/sefaz/sync', token, { method: 'POST', body: { producer_id: producer.id, from: '2025-04-01', to: '2025-04-30' } })
  assert.equal(april.status, 200, JSON.stringify(april.data))
  assert.equal(april.data.imported, 0)
  assert.equal(april.data.outOfPeriod, 1)
  assert.equal(april.data.manifested, 0) // o resumo é de março: fora do período, sem ciência
  assert.deepEqual(calls.evento, [])
  let status = (await call(`/sefaz/status?producer_id=${producer.id}`, token)).data
  assert.deepEqual(status.stored, { total: 1, first_date: '2025-03-03', last_date: '2025-03-03' })
  assert.equal((await call(`/invoices?producer_id=${producer.id}&year=2025`, token)).data.length, 0)

  // Importa a guardada escolhendo março, sem consultar a SEFAZ de novo.
  const march = await call('/sefaz/import-stored', token, { method: 'POST', body: { producer_id: producer.id, from: '2025-03-01', to: '2025-03-31' } })
  assert.deepEqual(march.data, { imported: 1, duplicates: 0, errors: [], remaining: 0 })
  assert.equal(calls.dist.length, 1)
  status = (await call(`/sefaz/status?producer_id=${producer.id}`, token)).data
  assert.equal(status.stored.total, 0)
  assert.equal((await call(`/invoices?producer_id=${producer.id}&year=2025`, token)).data.length, 1)
})

test('consulta da inscrição estadual: usa o certificado do produtor ou o do escritório e trata recusas', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-cadastro-'))
  const caFile = path.join(dir, 'ca.pem')
  fs.writeFileSync(caFile, forge.pki.certificateToPem(ca.cert))
  const { fake, calls, url: sefazUrl } = await startFakeSefaz()
  const app = await startApp(dir, sefazUrl, caFile)
  t.after(async () => { await app.stop(); fake.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const call = async (endpoint, token, { method = 'GET', body, form } = {}) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    if (body) headers['Content-Type'] = 'application/json'
    const response = await fetch(`${app.url}/api${endpoint}`, { method, headers, body: form || (body && JSON.stringify(body)) })
    return { status: response.status, data: await response.json().catch(() => null) }
  }
  const pfxForm = () => { const form = new FormData(); form.append('file', new Blob([pfx]), 'certificado.pfx'); form.append('password', 'senha123'); form.append('uf', 'GO'); return form }
  const token = (await call('/auth/register', null, { method: 'POST', body: { name: 'Admin', email: 'a@t.local', password: 'teste123' } })).data.token
  const producer = (await call('/producers', token, { method: 'POST', body: { name: 'Produtor Teste', cpf: CPF, address: 'Rua', address_number: '1', zip_code: '76530000', neighborhood: 'Centro' } })).data

  assert.match((await call('/cadastro/consulta', token, { method: 'POST', body: { ie: '111211212', uf: 'GO' } })).data.error, /cadastre o certificado/)
  assert.equal((await call('/office-certificate', token, { method: 'PUT', form: pfxForm() })).status, 200)
  const byOffice = await call('/cadastro/consulta', token, { method: 'POST', body: { ie: '111.211.212', uf: 'GO' } })
  assert.equal(byOffice.status, 200, JSON.stringify(byOffice.data))
  assert.equal(byOffice.data.certificate_used, 'escritorio')
  assert.equal(byOffice.data.active, true)
  assert.equal(byOffice.data.document, CPF)
  assert.deepEqual(byOffice.data.address, { street: 'RODOVIA GO 164 KM 326', number: 'S/N', complement: '', neighborhood: 'ZONA RURAL', cityCode: '5214838', city: 'NOVA CRIXAS', zipCode: '76520000' })
  assert.deepEqual(calls.cadastro[0], { clientCn: `PRODUTOR TESTE:${CPF}`, ie: '111211212' })

  assert.equal((await call(`/producers/${producer.id}/certificate`, token, { method: 'PUT', form: pfxForm() })).status, 200)
  assert.equal((await call('/cadastro/consulta', token, { method: 'POST', body: { ie: '111211212', uf: 'GO', producer_id: producer.id } })).data.certificate_used, 'produtor')
  assert.equal((await call('/cadastro/consulta', token, { method: 'POST', body: { ie: '123', uf: 'GO' } })).status, 400)
  const refused = await call('/cadastro/consulta', token, { method: 'POST', body: { ie: '999999999', uf: 'GO' } })
  assert.equal(refused.status, 422)
  assert.match(refused.data.error, /não cadastrada como contribuinte.*código 259/)
  assert.match((await call('/cadastro/consulta', token, { method: 'POST', body: { ie: '111211212', uf: 'AC' } })).data.error, /não oferece a consulta/)
})
