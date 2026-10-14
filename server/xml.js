import { XMLParser } from 'fast-xml-parser'

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false })
const first = value => Array.isArray(value) ? value[0] : value

// Combustíveis e lubrificantes: diesel, gasolina, querosene e óleos lubrificantes (2710), GLP (2711),
// etanol (2207.10 e 2207.20) e biodiesel (3826).
const fuelPrefixes = ['2710', '2711', '220710', '220720', '3826']
const isFuelNcm = code => fuelPrefixes.some(prefix => code.startsWith(prefix))

export function classifyNcm(codes) {
  if (codes.some(code => code.startsWith('0102'))) return 'cattle'
  if (codes.some(code => code.startsWith('1201'))) return 'soy'
  if (codes.some(isFuelNcm)) return 'fuel'
  return 'other'
}

// Unidades usadas para contar animais por cabeça (CB, CAB, CABECA, UN...).
// Peso (KG, arroba, tonelada) não vira quantidade de cabeças.
const headUnits = new Set(['CB', 'CAB', 'CABS', 'CABECA', 'CABECAS', 'CBC', 'UN', 'UND', 'UNID', 'UNIDADE', 'U', 'ANIMAL', 'ANIMAIS', 'VOL', 'VOLUME', 'QT', 'QTD', 'QTDE']) // VOL: usado por frigoríficos (ex.: JBS) para cabeças
const unitKey = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z]/g, '').toUpperCase()

export function cattleHeadCount(details) {
  let total = 0, found = false
  for (const detail of details) {
    const prod = detail?.prod || {}
    if (!String(first(prod.NCM) || '').replace(/\D/g, '').startsWith('0102')) continue
    const candidates = [[prod.uCom, prod.qCom], [prod.uTrib, prod.qTrib]]
    const match = candidates.find(([unit, quantity]) => headUnits.has(unitKey(first(unit))) && Number.isFinite(Number(first(quantity))))
    if (!match) return null
    const quantity = Number(first(match[1]))
    if (quantity < 0 || Math.abs(quantity - Math.round(quantity)) > 0.001) return null
    total += Math.round(quantity); found = true
  }
  return found ? total : null
}

export function parseInvoiceXml(xml) {
  const parsed = parser.parse(xml)
  const root = parsed.nfeProc?.NFe || parsed.NFe || parsed
  const info = root?.infNFe || root
  const ide = info?.ide || {}
  const total = info?.total?.ICMSTot || {}
  const issuer = info?.emit || {}
  const recipient = info?.dest || {}
  const issuerAddress = first(issuer.enderEmit) || {}
  const recipientAddress = first(recipient.enderDest) || {}
  const protocol = parsed.nfeProc?.protNFe?.infProt || {}
  const rawDate = ide.dhEmi || ide.dEmi || null
  const details = info?.det ? (Array.isArray(info.det) ? info.det : [info.det]) : []
  const ncmCodes = [...new Set(details.map(detail => String(first(detail?.prod?.NCM) || '').replace(/\D/g, '')).filter(Boolean))]
  const issuerDocument = String(first(issuer.CPF) || first(issuer.CNPJ) || '').replace(/\D/g, '')
  const recipientDocument = String(first(recipient.CPF) || first(recipient.CNPJ) || '').replace(/\D/g, '')
  const issuerStateRegistration = String(first(issuer.IE) || '').replace(/\D/g, '')
  const recipientStateRegistration = String(first(recipient.IE) || '').replace(/\D/g, '')
  return {
    issueDate: rawDate ? String(rawDate).slice(0, 10) : null,
    invoiceNumber: ide.nNF != null ? String(ide.nNF) : '',
    amount: Number(total.vNF || 0),
    accessKey: String(protocol.chNFe || info?.['@_Id'] || '').replace(/^NFe/, ''),
    issuerName: first(issuer.xNome) || '',
    recipientName: first(recipient.xNome) || '',
    issuerDocument,
    recipientDocument,
    issuerStateRegistration,
    recipientStateRegistration,
    issuerAddress: {
      street: first(issuerAddress.xLgr) || '', number: first(issuerAddress.nro) || '',
      complement: first(issuerAddress.xCpl) || '', neighborhood: first(issuerAddress.xBairro) || '',
      zipCode: String(first(issuerAddress.CEP) || '').replace(/\D/g, '')
    },
    recipientAddress: {
      street: first(recipientAddress.xLgr) || '', number: first(recipientAddress.nro) || '',
      complement: first(recipientAddress.xCpl) || '', neighborhood: first(recipientAddress.xBairro) || '',
      zipCode: String(first(recipientAddress.CEP) || '').replace(/\D/g, '')
    },
    ncmCodes,
    ncmCategory: classifyNcm(ncmCodes),
    cattleQuantity: cattleHeadCount(details)
  }
}
