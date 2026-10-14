import https from 'node:https'
import tls from 'node:tls'
import fs from 'node:fs'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import forge from 'node-forge'
import { XMLParser } from 'fast-xml-parser'

// Integração com o Ambiente Nacional da NF-e usando o certificado A1 (e-CPF) do produtor:
// - NFeDistribuicaoDFe: baixa as notas em que o CPF é destinatário (ou autorizado no XML);
// - NFeRecepcaoEvento4: registra a "Ciência da Operação" para liberar o XML completo de notas que vieram só em resumo.
// A Receita não devolve por esse serviço as notas emitidas pelo próprio produtor.

const AMBIENTE = process.env.SEFAZ_AMBIENTE === '2' ? '2' : '1'
const URLS = {
  dist: process.env.SEFAZ_DIST_URL || (AMBIENTE === '1' ? 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx' : 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'),
  evento: process.env.SEFAZ_EVENTO_URL || (AMBIENTE === '1' ? 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx' : 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx'),
}
// Autoridades extras só para testes (servidor falso); em produção valem as autoridades públicas do Node.
const extraCa = process.env.SEFAZ_CA_FILE ? [fs.readFileSync(process.env.SEFAZ_CA_FILE, 'utf8')] : []

export const UF_CODES = { AC: '12', AL: '27', AM: '13', AP: '16', BA: '29', CE: '23', DF: '53', ES: '32', GO: '52', MA: '21', MG: '31', MS: '50', MT: '51', PA: '15', PB: '25', PE: '26', PI: '22', PR: '41', RJ: '33', RN: '24', RO: '11', RR: '14', RS: '43', SC: '42', SE: '28', SP: '35', TO: '17' }
const WAIT_MS = 61 * 60 * 1000 // a SEFAZ pede 1 hora de espera quando não há documentos novos
const NFE_NS = 'http://www.portalfiscal.inf.br/nfe'
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, attributeNamePrefix: '@_' })
const digits = value => String(value ?? '').replace(/\D/g, '')

// ---------- Certificado ----------

/** Lê o .pfx/.p12 (inclusive os antigos com RC2/3DES, que o OpenSSL 3 do Node recusa) e devolve chave, cadeia e titular. */
export function readCertificate(pfx, password) {
  let p12
  try { p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(pfx).toString('binary'))), String(password ?? '')) }
  catch (error) { throw new Error(/password|MAC/i.test(error.message) ? 'Senha do certificado incorreta.' : 'Arquivo de certificado inválido. Envie o arquivo .pfx ou .p12 do certificado A1.') }
  const keyBag = [...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []), ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])][0]
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map(bag => bag.cert).filter(Boolean)
  if (!keyBag?.key || !certs.length) throw new Error('O arquivo não contém a chave privada e o certificado.')
  const publicPem = forge.pki.publicKeyToPem(forge.pki.setRsaPublicKey(keyBag.key.n, keyBag.key.e))
  const leaf = certs.find(cert => forge.pki.publicKeyToPem(cert.publicKey) === publicPem) || certs[0]
  const chain = [leaf, ...certs.filter(cert => cert !== leaf)]
  const commonName = leaf.subject.getField('CN')?.value || ''
  // e-CPF ICP-Brasil: CN "NOME DO TITULAR:12345678901"; o CPF também vem no OID 2.16.76.1.3.1 do subjectAltName.
  let document = (commonName.match(/:(\d{11}|\d{14})$/) || [])[1] || ''
  if (!document) {
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(leaf)).getBytes()
    const match = der.match(/\x06\x05\x60\x4c\x01\x03\x01[\s\S]{0,8}?(\d{8})(\d{11})/)
    document = match ? match[2] : ''
  }
  return {
    keyPem: forge.pki.privateKeyToPem(keyBag.key),
    certPem: chain.map(cert => forge.pki.certificateToPem(cert)).join(''),
    leafBase64: forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(leaf)).getBytes()),
    holderName: commonName.replace(/:\d+$/, '').trim(),
    document,
    validFrom: leaf.validity.notBefore.toISOString(),
    validUntil: leaf.validity.notAfter.toISOString(),
  }
}

const sealKey = secret => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(secret)), Buffer.from('campo-certo'), Buffer.from('certificados-a1'), 32))

/** Guarda o .pfx e a senha cifrados (AES-256-GCM) com chave derivada do segredo do servidor. */
export function sealCertificate(pfx, password, secret) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', sealKey(secret), iv)
  const body = Buffer.concat([cipher.update(JSON.stringify({ pfx: Buffer.from(pfx).toString('base64'), password: String(password ?? '') })), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body])
}

export function openCertificate(sealed, secret) {
  try {
    const data = Buffer.from(sealed)
    const decipher = crypto.createDecipheriv('aes-256-gcm', sealKey(secret), data.subarray(0, 12))
    decipher.setAuthTag(data.subarray(12, 28))
    const { pfx, password } = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'))
    return readCertificate(Buffer.from(pfx, 'base64'), password)
  } catch (error) {
    if (/Senha|certificado/.test(error.message)) throw error
    throw new Error('Não foi possível abrir o certificado guardado (a chave do servidor mudou). Envie o certificado novamente.')
  }
}

// ---------- SOAP ----------

function soapRequest(url, action, body, certificate, timeout = 30000) {
  const envelope = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>${body}</soap12:Body></soap12:Envelope>`
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'POST', key: certificate.keyPem, cert: certificate.certPem, timeout,
      ca: extraCa.length ? [...tls.rootCertificates, ...extraCa] : undefined,
      headers: { 'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`, 'Content-Length': Buffer.byteLength(envelope) },
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (response.statusCode >= 500 && !text.includes('Envelope')) return reject(new Error(`A SEFAZ respondeu com erro ${response.statusCode}. Tente mais tarde.`))
        if (response.statusCode === 403) return reject(new Error('A SEFAZ recusou o certificado (403). Confira se é um certificado A1 válido do produtor.'))
        resolve(text)
      })
    })
    request.on('timeout', () => request.destroy(new Error('A SEFAZ demorou demais para responder. Tente novamente em alguns minutos.')))
    request.on('error', error => reject(error.message.includes('SEFAZ') ? error : new Error(`Não foi possível conectar à SEFAZ (${error.code || error.message}).`)))
    request.end(envelope)
  })
}

const findKey = (node, key) => {
  if (!node || typeof node !== 'object') return undefined
  if (key in node) return node[key]
  for (const value of Object.values(node)) { const found = findKey(value, key); if (found !== undefined) return found }
  return undefined
}
const list = value => value == null ? [] : Array.isArray(value) ? value : [value]
const textOf = value => typeof value === 'object' ? value?.['#text'] ?? '' : String(value ?? '')

/** Uma chamada ao NFeDistribuicaoDFe a partir do último NSU recebido. */
export async function distDfe({ certificate, uf, document, ultNSU }) {
  const doc = digits(document)
  const body = `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg><distDFeInt xmlns="${NFE_NS}" versao="1.01"><tpAmb>${AMBIENTE}</tpAmb><cUFAutor>${UF_CODES[uf] || '52'}</cUFAutor>${doc.length === 14 ? `<CNPJ>${doc}</CNPJ>` : `<CPF>${doc}</CPF>`}<distNSU><ultNSU>${String(ultNSU || '0').padStart(15, '0')}</ultNSU></distNSU></distDFeInt></nfeDadosMsg></nfeDistDFeInteresse>`
  const xml = await soapRequest(URLS.dist, 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse', body, certificate)
  const ret = findKey(parser.parse(xml), 'retDistDFeInt')
  if (!ret) throw new Error('Resposta inesperada da SEFAZ na consulta de documentos.')
  const docs = list(ret.loteDistDFeInt?.docZip).map(item => ({
    nsu: item['@_NSU'], schema: item['@_schema'] || '',
    xml: zlib.gunzipSync(Buffer.from(textOf(item), 'base64')).toString('utf8'),
  }))
  return { cStat: textOf(ret.cStat), xMotivo: textOf(ret.xMotivo), ultNSU: textOf(ret.ultNSU), maxNSU: textOf(ret.maxNSU), docs }
}

// ---------- Ciência da Operação (evento 210210) com assinatura XML-DSig ----------

const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
const brasiliaNow = () => {
  const date = new Date(Date.now() - 3 * 3600 * 1000 - 60 * 1000) // horário de Brasília, um minuto atrás para não cair "no futuro"
  return `${date.toISOString().slice(0, 19)}-03:00`
}

/** Monta o <evento> assinado. Os trechos já são gerados na forma canônica (C14N), então o que se assina é o que se envia. */
export function signedAwarenessEvent({ certificate, document, accessKey, when = brasiliaNow() }) {
  const doc = digits(document)
  const id = `ID210210${accessKey}01`
  const inner = `<cOrgao>91</cOrgao><tpAmb>${AMBIENTE}</tpAmb>${doc.length === 14 ? `<CNPJ>${doc}</CNPJ>` : `<CPF>${doc}</CPF>`}<chNFe>${accessKey}</chNFe><dhEvento>${when}</dhEvento><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento>`
  // Na forma canônica do trecho, o namespace herdado do <evento> aparece no próprio infEvento.
  const digest = crypto.createHash('sha1').update(`<infEvento xmlns="${NFE_NS}" Id="${id}">${inner}</infEvento>`).digest('base64')
  const signedInfo = `<SignedInfo><CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod><Reference URI="#${id}"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform><Transform Algorithm="${C14N}"></Transform></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`
  const canonicalSignedInfo = signedInfo.replace('<SignedInfo>', '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">')
  const signature = crypto.createSign('RSA-SHA1').update(canonicalSignedInfo).sign(certificate.keyPem, 'base64')
  return `<evento xmlns="${NFE_NS}" versao="1.00"><infEvento Id="${id}">${inner}</infEvento><Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfo}<SignatureValue>${signature}</SignatureValue><KeyInfo><X509Data><X509Certificate>${certificate.leafBase64}</X509Certificate></X509Data></KeyInfo></Signature></evento>`
}

/** Envia até 20 ciências num lote. Devolve o resultado por chave de acesso. */
export async function sendAwareness({ certificate, document, accessKeys }) {
  const events = accessKeys.map(accessKey => signedAwarenessEvent({ certificate, document, accessKey })).join('')
  const lote = String(Date.now()).slice(-15)
  const body = `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><envEvento xmlns="${NFE_NS}" versao="1.00"><idLote>${lote}</idLote>${events}</envEvento></nfeDadosMsg>`
  const xml = await soapRequest(URLS.evento, 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento', body, certificate)
  const ret = findKey(parser.parse(xml), 'retEnvEvento')
  if (!ret) throw new Error('Resposta inesperada da SEFAZ ao registrar a ciência.')
  const results = new Map()
  for (const item of list(ret.retEvento)) {
    const info = item.infEvento || {}
    results.set(textOf(info.chNFe), { cStat: textOf(info.cStat), xMotivo: textOf(info.xMotivo) })
  }
  return { cStat: textOf(ret.cStat), xMotivo: textOf(ret.xMotivo), results }
}

// ---------- Sincronização de um produtor ----------

export function ensureSefazTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS certificates (
      producer_id INTEGER PRIMARY KEY, sealed BLOB NOT NULL, holder_name TEXT, holder_document TEXT,
      valid_until TEXT, uf TEXT NOT NULL DEFAULT 'GO', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(producer_id) REFERENCES producers(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS sefaz_state (
      producer_id INTEGER PRIMARY KEY, ult_nsu TEXT NOT NULL DEFAULT '000000000000000', max_nsu TEXT,
      last_query_at TEXT, next_allowed_at TEXT, last_status TEXT,
      FOREIGN KEY(producer_id) REFERENCES producers(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS sefaz_summaries (
      access_key TEXT NOT NULL, producer_id INTEGER NOT NULL, nsu TEXT, issuer_document TEXT, issuer_name TEXT,
      issue_date TEXT, amount REAL, situation TEXT, manifested_at TEXT, manifest_status TEXT, imported INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(producer_id, access_key),
      FOREIGN KEY(producer_id) REFERENCES producers(id) ON DELETE CASCADE
    );
  `)
}

export function sefazStatus(db, producerId) {
  const state = db.prepare('SELECT ult_nsu,max_nsu,last_query_at,next_allowed_at,last_status FROM sefaz_state WHERE producer_id=?').get(producerId) || null
  const pending = db.prepare('SELECT COUNT(*) total FROM sefaz_summaries WHERE producer_id=? AND imported=0').get(producerId).total
  return { state, pending }
}

/**
 * Busca documentos novos e importa as notas completas. `importXml(xml, filename)` devolve 'imported' | 'duplicate' | mensagem de erro.
 * Respeita o intervalo exigido pela SEFAZ e para depois de 20 consultas por vez.
 */
export async function syncProducer({ db, producer, certificate, uf, importXml, now = Date.now() }) {
  const state = db.prepare('SELECT * FROM sefaz_state WHERE producer_id=?').get(producer.id) || { ult_nsu: '000000000000000' }
  if (state.next_allowed_at && new Date(state.next_allowed_at).getTime() > now) {
    const when = new Date(state.next_allowed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
    throw Object.assign(new Error(`A SEFAZ só permite uma nova consulta para este produtor depois das ${when}.`), { status: 429 })
  }
  const report = { queries: 0, imported: 0, duplicates: 0, summaries: 0, events: 0, canceled: [], errors: [], manifested: 0, manifestErrors: [], status: '' }
  const saveSummary = db.prepare(`INSERT INTO sefaz_summaries (access_key,producer_id,nsu,issuer_document,issuer_name,issue_date,amount,situation) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(producer_id,access_key) DO UPDATE SET nsu=excluded.nsu,situation=excluded.situation`)
  const markImported = db.prepare('UPDATE sefaz_summaries SET imported=1 WHERE producer_id=? AND access_key=?')
  let ultNSU = state.ult_nsu, maxNSU = state.max_nsu, waitUntil = null
  for (let i = 0; i < 20; i++) {
    const response = await distDfe({ certificate, uf, document: producer.cpf, ultNSU })
    report.queries++
    report.status = `${response.cStat} - ${response.xMotivo}`
    if (response.cStat === '656') { waitUntil = now + WAIT_MS; report.errors.push('A SEFAZ apontou consumo indevido e bloqueou novas consultas por 1 hora.'); break }
    if (!['137', '138'].includes(response.cStat)) { report.errors.push(`SEFAZ: ${response.xMotivo} (código ${response.cStat}).`); break }
    for (const item of response.docs) {
      const parsed = parser.parse(item.xml)
      if (parsed.nfeProc || item.schema.startsWith('procNFe')) {
        const key = textOf(findKey(parsed, 'chNFe'))
        const result = importXml(item.xml, `${key || `nsu-${item.nsu}`}-sefaz.xml`)
        if (result === 'imported') report.imported++
        else if (result === 'duplicate') report.duplicates++
        else report.errors.push(result)
        if (key) markImported.run(producer.id, key)
      } else if (parsed.resNFe) {
        const r = parsed.resNFe
        saveSummary.run(textOf(r.chNFe), producer.id, item.nsu, digits(textOf(r.CNPJ) || textOf(r.CPF)), textOf(r.xNome), textOf(r.dhEmi).slice(0, 10), Number(textOf(r.vNF) || 0), textOf(r.cSitNFe))
        report.summaries++
      } else {
        report.events++
        const event = findKey(parsed, 'infEvento') || {}
        if (textOf(event.tpEvento) === '110111') report.canceled.push(textOf(event.chNFe))
      }
    }
    ultNSU = response.ultNSU || ultNSU
    maxNSU = response.maxNSU || maxNSU
    if (response.cStat === '137' || BigInt(ultNSU || 0) >= BigInt(maxNSU || 0)) { waitUntil = now + WAIT_MS; break }
  }
  db.prepare(`INSERT INTO sefaz_state (producer_id,ult_nsu,max_nsu,last_query_at,next_allowed_at,last_status) VALUES (?,?,?,?,?,?)
    ON CONFLICT(producer_id) DO UPDATE SET ult_nsu=excluded.ult_nsu,max_nsu=excluded.max_nsu,last_query_at=excluded.last_query_at,next_allowed_at=excluded.next_allowed_at,last_status=excluded.last_status`)
    .run(producer.id, ultNSU, maxNSU || null, new Date(now).toISOString(), waitUntil ? new Date(waitUntil).toISOString() : null, report.status)

  // Ciência da Operação para os resumos ainda sem XML (autorizadas e não manifestadas), 20 por lote.
  const pending = db.prepare("SELECT access_key FROM sefaz_summaries WHERE producer_id=? AND imported=0 AND manifested_at IS NULL AND COALESCE(situation,'1')='1' LIMIT 100").all(producer.id).map(row => row.access_key)
  const saveManifest = db.prepare('UPDATE sefaz_summaries SET manifested_at=?,manifest_status=? WHERE producer_id=? AND access_key=?')
  for (let start = 0; start < pending.length; start += 20) {
    try {
      const { results } = await sendAwareness({ certificate, document: producer.cpf, accessKeys: pending.slice(start, start + 20) })
      for (const [key, result] of results) {
        // 135: registrado; 573: já registrado antes. Os dois liberam o XML completo na próxima consulta.
        if (['135', '136', '573'].includes(result.cStat)) { saveManifest.run(new Date(now).toISOString(), `${result.cStat} - ${result.xMotivo}`, producer.id, key); report.manifested++ }
        else { saveManifest.run(null, `${result.cStat} - ${result.xMotivo}`, producer.id, key); report.manifestErrors.push(`${key}: ${result.xMotivo}`) }
      }
    } catch (error) { report.manifestErrors.push(error.message); break }
  }
  report.nextAllowedAt = waitUntil ? new Date(waitUntil).toISOString() : null
  return report
}
