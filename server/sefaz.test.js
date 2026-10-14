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
const summaryXml = `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${SUMMARY_KEY}</chNFe><CNPJ>01409655000180</CNPJ><xNome>Outro Fornecedor</xNome><IE>1</IE><dhEmi>2025-03-05T10:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>990.50</vNF><digVal>x</digVal><dhRecbto>2025-03-05T10:00:00-03:00</dhRecbto><nProt>1</nProt><cSitNFe>1</cSitNFe></resNFe>`
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
          ? `<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><verAplic>1</verAplic><cStat>138</cStat><xMotivo>Documento localizado</xMotivo><dhResp>2026-10-13T10:00:00-03:00</dhResp><ultNSU>000000000000002</ultNSU><maxNSU>000000000000002</maxNSU><loteDistDFeInt><docZip NSU="000000000000001" schema="procNFe_v4.00.xsd">${zip(nfeXml)}</docZip><docZip NSU="000000000000002" schema="resNFe_v1.01.xsd">${zip(summaryXml)}</docZip></loteDistDFeInt></retDistDFeInt>`
          : `<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cStat>137</cStat><xMotivo>Nenhum documento localizado</xMotivo><ultNSU>000000000000002</ultNSU><maxNSU>000000000000002</maxNSU></retDistDFeInt>`
        return res.end(`<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDistDFeInteresseResult>${ret}</nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>`)
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
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DATA_DIR: dir, JWT_SECRET: 'test-only-secret-not-for-production-12345678', NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', BACKUP_DISABLED: '1', SEFAZ_DIST_URL: `${sefazUrl}/dist`, SEFAZ_EVENTO_URL: `${sefazUrl}/evento`, SEFAZ_CA_FILE: caFile }, stdio: ['ignore', 'pipe', 'pipe'] })
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
  assert.equal(first.data.summaries, 1)
  assert.equal(first.data.manifested, 1)
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
  assert.equal(status.state.ult_nsu, '000000000000002')
  assert.equal(status.pending, 1)
  assert.equal(status.certificate.holder_name, 'PRODUTOR TESTE')
})
