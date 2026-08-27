import fs from 'node:fs'
import path from 'node:path'
import db from '../server/db.js'
import { parseInvoiceXml } from '../server/xml.js'

const sourceDirectory = process.argv[2]
if (!sourceDirectory || !fs.existsSync(sourceDirectory)) process.exit(1)

const known = new Set(db.prepare('SELECT cpf FROM producers').all().map(row => row.cpf))
const candidates = new Map()
const cpfPairs = []
const summary = {
  files: 0, alreadyMatched: 0, oneCpfOneCnpj: 0, bothCpf: 0,
  bothCnpj: 0, missingParty: 0, invalidXml: 0
}

for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.xml')) continue
  summary.files++
  try {
    const parsed = parseInvoiceXml(fs.readFileSync(path.join(sourceDirectory, entry.name), 'utf8'))
    if (known.has(parsed.issuerDocument) || known.has(parsed.recipientDocument)) {
      summary.alreadyMatched++
      continue
    }
    const lengths = [parsed.issuerDocument.length, parsed.recipientDocument.length]
    if (lengths.includes(0)) { summary.missingParty++; continue }
    if (lengths[0] === 11 && lengths[1] === 14) {
      summary.oneCpfOneCnpj++
      const item = candidates.get(parsed.issuerDocument) || { document: parsed.issuerDocument, name: parsed.issuerName, notes: 0, issuer: 0, recipient: 0 }
      item.notes++; item.issuer++; candidates.set(item.document, item)
    } else if (lengths[0] === 14 && lengths[1] === 11) {
      summary.oneCpfOneCnpj++
      const item = candidates.get(parsed.recipientDocument) || { document: parsed.recipientDocument, name: parsed.recipientName, notes: 0, issuer: 0, recipient: 0 }
      item.notes++; item.recipient++; candidates.set(item.document, item)
    } else if (lengths[0] === 11 && lengths[1] === 11) { summary.bothCpf++; cpfPairs.push([parsed.issuerDocument, parsed.recipientDocument]) }
    else if (lengths[0] === 14 && lengths[1] === 14) summary.bothCnpj++
    else summary.missingParty++
  } catch { summary.invalidXml++ }
}

const ranked = [...candidates.values()].sort((a, b) => b.notes - a.notes)
const candidateDocuments = new Set(candidates.keys())
const cpfPairCoverage = cpfPairs.reduce((result, [issuer, recipient]) => {
  const matches = Number(candidateDocuments.has(issuer)) + Number(candidateDocuments.has(recipient))
  if (matches === 1) result.oneCandidate++
  else if (matches === 2) result.twoCandidates++
  else result.noCandidate++
  return result
}, { oneCandidate: 0, twoCandidates: 0, noCandidate: 0 })
const mask = document => `${'*'.repeat(document.length - 4)}${document.slice(-4)}`
console.log(JSON.stringify({
  ...summary,
  uniqueCpfCandidates: ranked.length,
  candidatesWithMultipleNotes: ranked.filter(item => item.notes > 1).length,
  notesCoveredByCandidates: ranked.reduce((total, item) => total + item.notes, 0),
  cpfPairCoverage,
  topCandidates: ranked.slice(0, 30).map(item => ({ ...item, document: mask(item.document) }))
}, null, 2))
db.close()
