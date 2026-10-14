import { jsPDF } from 'jspdf'
import JsBarcode from 'jsbarcode'
import { brl, fixed4, optional, number, shortDate, shortTime, docMask, zipMask, invoiceNumber, seriesNumber, street, freightNames } from './danfe-data.js'

// DANFE desenhada direto no PDF (texto real, selecionável e pesquisável), no mesmo layout da visualização.
// Medidas em milímetros numa folha A4 retrato, com 6 mm de margem: largura útil de 198 mm.
const X0 = 6, Y0 = 6, W = 198, PAGE_BOTTOM = 291
const FIELD_H = 7, HEADING_H = 4.2
const ADDITIONAL_H = 24, FOOTER_H = 4
const PRODUCT_HEAD = ['CÓDIGO PRODUTO', 'DESCRIÇÃO DO PRODUTO / SERVIÇO', 'NCM/SH', 'O/CST', 'CFOP', 'UN', 'QUANT', 'VALOR\nUNIT', 'VALOR\nTOTAL', 'VALOR\nDESC', 'B.CÁLC\nICMS', 'VALOR\nICMS', 'VALOR\nIPI', 'ALÍQ.\nICMS', 'ALÍQ.\nIPI']
const PRODUCT_WIDTHS = [8.5, 27.5, 6.5, 4.5, 4, 3, 6.5, 6.5, 6.5, 4.5, 5, 5, 4.5, 4, 3.5]
const PRODUCT_ALIGN = ['center', 'left', 'center', 'center', 'center', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right']
const PRODUCT_FONT = 6.5, PRODUCT_LINE = 2.75, PRODUCT_HEAD_H = 6
const TOTALS = [[['BASE DE CÁLC. DO ICMS', 'vBC'], ['VALOR DO ICMS', 'vICMS'], ['BASE DE CÁLC. ICMS S.T.', 'vBCST'], ['VALOR DO ICMS SUBST.', 'vST'], ['V. IMP. IMPORTAÇÃO', 'vII'], ['V. ICMS UF REMET.', 'vICMSUFRemet'], ['V. FCP UF DEST.', 'vFCPUFDest'], ['VALOR DO PIS', 'vPIS'], ['V. TOTAL PRODUTOS', 'vProd']], [['VALOR DO FRETE', 'vFrete'], ['VALOR DO SEGURO', 'vSeg'], ['DESCONTO', 'vDesc'], ['OUTRAS DESPESAS', 'vOutro'], ['VALOR TOTAL IPI', 'vIPI'], ['V. ICMS UF DEST.', 'vICMSUFDest'], ['V. TOT. TRIB.', 'vTotTrib'], ['VALOR DA COFINS', 'vCOFINS'], ['V. TOTAL DA NOTA', 'vNF']]]

// Altura fixa de tudo que não é a tabela de produtos; o que sobra da folha vai para os produtos.
const FIXED_HEIGHT = 17 + 4 + (34 + FIELD_H * 2) + (HEADING_H + FIELD_H * 3) + (HEADING_H + FIELD_H * 2) + (HEADING_H + FIELD_H * 3) + HEADING_H + (HEADING_H + ADDITIONAL_H) + FOOTER_H
const PRODUCTS_H = PAGE_BOTTOM - Y0 - FIXED_HEIGHT

const pad = value => String(value).padStart(2, '0')
const printedAtNow = () => { const d = new Date(); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} as ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }
const productCells = p => [p.code, [p.desc, p.additional].filter(Boolean).join('\n'), p.ncm, p.cst, p.cfop, p.unit, fixed4(p.qty), fixed4(p.unitValue), brl(p.total), brl(p.discount), brl(p.bc), brl(p.icms), optional(p.ipi, brl), brl(p.rate), optional(p.ipiRate, brl)]

function painter(doc) {
  const font = (size, style = 'normal', family = 'times') => { doc.setFont(family, style); doc.setFontSize(size) }
  const fit = (value, width) => {
    let s = String(value ?? '')
    if (doc.getTextWidth(s) <= width) return s
    while (s && doc.getTextWidth(`${s}…`) > width) s = s.slice(0, -1)
    return `${s}…`
  }
  // Com minSize, o texto diminui até caber antes de ser cortado com reticências.
  const text = (value, x, y, { size = 8, style = 'normal', align = 'left', width, family, minSize = size } = {}) => {
    font(size, style, family)
    let current = size
    while (width && current > minSize && doc.getTextWidth(String(value ?? '')) > width) font(current -= 0.25, style, family)
    const s = width ? fit(value, width) : String(value ?? '')
    if (s) doc.text(s, x, y, { align, baseline: 'alphabetic' })
  }
  // Quebra de linha própria, medindo cada palavra com a fonte em uso.
  const lines = (value, width, size, style = 'normal', family = 'times') => {
    font(size, style, family)
    return String(value ?? '').split('\n').flatMap(part => {
      const out = []
      let line = ''
      for (const word of part.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word
        if (doc.getTextWidth(candidate) <= width || !line) line = candidate
        else { out.push(line); line = word }
        while (doc.getTextWidth(line) > width && line.length > 1) {
          let cut = line.length - 1
          while (cut > 1 && doc.getTextWidth(line.slice(0, cut)) > width) cut--
          out.push(line.slice(0, cut)); line = line.slice(cut)
        }
      }
      if (line || !out.length) out.push(line)
      return out
    })
  }
  const box = (x, y, w, h) => doc.rect(x, y, w, h)
  // Campo padrão: rótulo pequeno em cima, valor em negrito embaixo.
  const field = (x, y, w, h, label, value, align = 'left') => {
    box(x, y, w, h)
    text(label, x + 0.8, y + 2.1, { size: 5, minSize: 4, width: w - 1.6 })
    const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w - 0.9 : x + 0.9
    text(value, tx, y + h - 1.5, { size: 8.5, minSize: 6.5, style: 'bold', align, width: w - 1.8 })
  }
  const row = (y, specs, h = FIELD_H) => {
    let x = X0
    for (const [label, value, pct, align] of specs) { const w = W * pct / 100; field(x, y, w, h, label, value, align); x += w }
    return y + h
  }
  const heading = (y, title) => { text(title, X0, y + 3.1, { size: 7, style: 'bold' }); return y + HEADING_H }
  return { font, fit, text, lines, box, field, row, heading }
}

// Separa os produtos em folhas, medindo a altura real de cada linha (descrições longas quebram).
function paginate(doc, products) {
  const p = painter(doc)
  const descWidth = W * PRODUCT_WIDTHS[1] / 100 - 1.6
  const available = PRODUCTS_H - PRODUCT_HEAD_H - 1
  const pages = [[]]
  let used = 0
  for (const product of products) {
    const height = Math.max(1, p.lines(productCells(product)[1], descWidth, PRODUCT_FONT).length) * PRODUCT_LINE + 0.8
    if (used + height > available && pages.at(-1).length) { pages.push([]); used = 0 }
    pages.at(-1).push({ product, height })
    used += height
  }
  return pages
}

function drawBarcode(doc, key, x, y, w, h) {
  if (!key) return
  const target = {}
  JsBarcode(target, key, { format: 'CODE128' })
  const bits = target.encodings.map(item => item.data).join('')
  const module = w / bits.length
  doc.setFillColor(0, 0, 0)
  let start = -1
  for (let i = 0; i <= bits.length; i++) {
    if (bits[i] === '1' && start < 0) start = i
    if (bits[i] !== '1' && start >= 0) { doc.rect(x + start * module, y, (i - start) * module, h, 'F'); start = -1 }
  }
}

function drawPage(doc, d, items, pageNumber, pageTotal, printedAt) {
  const p = painter(doc)
  doc.setLineWidth(0.2)
  doc.setDrawColor(0, 0, 0)
  doc.setTextColor(0, 0, 0)
  const destAddress = d.dest.address, emitAddress = d.emit.address
  let y = Y0

  // Canhoto
  const receiptW = W * 0.8
  p.box(X0, y, receiptW, 17); p.box(X0 + receiptW, y, W - receiptW, 17)
  const receiptText = `RECEBEMOS DE ${d.emit.name} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA ABAIXO. EMISSÃO: ${shortDate(d.issued)} VALOR TOTAL: R$ ${brl(d.total.vNF)} DESTINATÁRIO: ${d.dest.name} - ${street(destAddress)} ${destAddress.district} ${destAddress.city}-${destAddress.uf}`
  p.lines(receiptText, receiptW - 2, 6.3).slice(0, 3).forEach((line, i) => p.text(line, X0 + 1, y + 2.8 + i * 2.6, { size: 6.3 }))
  doc.line(X0, y + 10, X0 + receiptW, y + 10)
  doc.line(X0 + receiptW * 0.22, y + 10, X0 + receiptW * 0.22, y + 17)
  p.text('DATA DE RECEBIMENTO', X0 + 0.8, y + 12, { size: 5 })
  p.text('IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR', X0 + receiptW * 0.22 + 0.8, y + 12, { size: 5 })
  const nfeX = X0 + receiptW + (W - receiptW) / 2
  p.text('NF-e', nfeX, y + 6.5, { size: 15, style: 'bold', align: 'center' })
  p.text(`Nº. ${invoiceNumber(d.number)}`, nfeX, y + 11, { size: 9, style: 'bold', align: 'center' })
  p.text(`Série ${seriesNumber(d.series)}`, nfeX, y + 14.6, { size: 9, style: 'bold', align: 'center' })
  y += 17 + 2
  doc.setLineDashPattern([1, 0.8], 0); doc.line(X0, y, X0 + W, y); doc.setLineDashPattern([], 0)
  y += 2

  // Emitente, DANFE e chave de acesso
  const issuerW = W * 0.41, titleW = W * 0.165, accessW = W - issuerW - titleW
  const titleX = X0 + issuerW, accessX = titleX + titleW
  p.box(X0, y, issuerW, 34); p.box(titleX, y, titleW, 34); p.box(accessX, y, accessW, 34)
  p.text('IDENTIFICAÇÃO DO EMITENTE', X0 + issuerW / 2, y + 2.6, { size: 5.5, style: 'italic', align: 'center' })
  const nameLines = p.lines(d.emit.name, issuerW - 4, 12.5, 'bold').slice(0, 2)
  let ly = y + 10
  nameLines.forEach(line => { p.text(line, X0 + issuerW / 2, ly, { size: 12.5, style: 'bold', align: 'center' }); ly += 5 })
  const issuerLines = [
    d.emit.trade && d.emit.trade !== d.emit.name ? d.emit.trade : '',
    street(emitAddress),
    [emitAddress.district, zipMask(emitAddress.zip)].filter(Boolean).join(' - '),
    `${emitAddress.city} - ${emitAddress.uf} Fone/Fax: ${emitAddress.phone}`,
  ].filter(Boolean)
  issuerLines.forEach(line => { p.text(line, X0 + issuerW / 2, ly, { size: 7.5, align: 'center', width: issuerW - 3 }); ly += 3 })
  const tc = titleX + titleW / 2
  p.text('DANFE', tc, y + 7, { size: 16, style: 'bold', align: 'center' })
  p.text('Documento Auxiliar da Nota', tc, y + 10.3, { size: 6.5, align: 'center' })
  p.text('Fiscal Eletrônica', tc, y + 12.8, { size: 6.5, align: 'center' })
  p.text('0 - ENTRADA', titleX + 3, y + 17.2, { size: 6.5 })
  p.text('1 - SAÍDA', titleX + 3, y + 19.8, { size: 6.5 })
  p.box(titleX + titleW - 9, y + 15, 5, 5.5)
  p.text(d.type, titleX + titleW - 6.5, y + 19.3, { size: 12, style: 'bold', align: 'center' })
  p.text(`Nº. ${invoiceNumber(d.number)}`, tc, y + 25, { size: 10.5, style: 'bold', align: 'center' })
  p.text(`Série ${seriesNumber(d.series)}`, tc, y + 29, { size: 10.5, style: 'bold', align: 'center' })
  p.text(`Folha ${pageNumber}/${pageTotal}`, tc, y + 32.4, { size: 7, style: 'italic', align: 'center' })
  drawBarcode(doc, d.key, accessX + 5, y + 3, accessW - 10, 12)
  doc.line(accessX, y + 18, accessX + accessW, y + 18)
  doc.line(accessX, y + 26, accessX + accessW, y + 26)
  p.text('CHAVE DE ACESSO', accessX + 0.8, y + 20.1, { size: 5 })
  p.text(d.key.replace(/(.{4})/g, '$1 ').trim(), accessX + accessW / 2, y + 24.3, { size: 8, style: 'bold', align: 'center' })
  p.text('Consulta de autenticidade no portal nacional da NF-e', accessX + accessW / 2, y + 29.2, { size: 7, align: 'center' })
  p.text('www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora', accessX + accessW / 2, y + 32.2, { size: 7, align: 'center' })
  y += 34
  y = p.row(y, [['NATUREZA DA OPERAÇÃO', d.nature, 57.5, 'center'], ['PROTOCOLO DE AUTORIZAÇÃO DE USO', d.protocol, 42.5, 'center']])
  y = p.row(y, [['INSCRIÇÃO ESTADUAL', d.emit.ie, 25, 'center'], ['INSCRIÇÃO MUNICIPAL', d.emit.im, 25, 'center'], ['INSCRIÇÃO ESTADUAL DO SUBST. TRIBUT.', d.emit.iest, 24, 'center'], ['CNPJ / CPF', docMask(d.emit.doc), 26, 'center']])

  // Destinatário
  y = p.heading(y, 'DESTINATÁRIO / REMETENTE')
  y = p.row(y, [['NOME / RAZÃO SOCIAL', d.dest.name, 60], ['CNPJ / CPF', docMask(d.dest.doc), 23, 'center'], ['DATA DA EMISSÃO', shortDate(d.issued), 17, 'center']])
  y = p.row(y, [['ENDEREÇO', street(destAddress), 46], ['BAIRRO / DISTRITO', destAddress.district, 14, 'center'], ['CEP', zipMask(destAddress.zip), 23, 'center'], ['DATA DA SAÍDA/ENTRADA', shortDate(d.exit), 17, 'center']])
  y = p.row(y, [['MUNICÍPIO', destAddress.city, 46], ['UF', destAddress.uf, 3.5, 'center'], ['FONE / FAX', destAddress.phone, 10.5, 'center'], ['INSCRIÇÃO ESTADUAL', d.dest.ie, 23, 'center'], ['HORA DA SAÍDA/ENTRADA', shortTime(d.exit), 17, 'center']])

  // Cálculo do imposto
  y = p.heading(y, 'CÁLCULO DO IMPOSTO')
  for (const line of TOTALS) y = p.row(y, line.map(([label, key]) => [label, brl(d.total[key]), 100 / 9, 'right']))

  // Transportador
  y = p.heading(y, 'TRANSPORTADOR / VOLUMES TRANSPORTADOS')
  y = p.row(y, [['NOME / RAZÃO SOCIAL', d.carrier, 29], ['FRETE', freightNames[d.freight] || d.freight, 16, 'center'], ['CÓDIGO ANTT', d.antt, 15, 'center'], ['PLACA DO VEÍCULO', d.plate, 15, 'center'], ['UF', d.plateUf, 3, 'center'], ['CNPJ / CPF', docMask(d.carrierDoc), 22, 'center']])
  y = p.row(y, [['ENDEREÇO', d.carrierAddress, 45], ['MUNICÍPIO', d.carrierCity, 30], ['UF', d.carrierUf, 3, 'center'], ['INSCRIÇÃO ESTADUAL', d.carrierIe, 22, 'center']])
  y = p.row(y, [['QUANTIDADE', d.volumes, 10, 'center'], ['ESPÉCIE', d.species, 17], ['MARCA', d.brand, 17], ['NUMERAÇÃO', d.volumeNumber, 16], ['PESO BRUTO', number(d.gross), 23, 'right'], ['PESO LÍQUIDO', number(d.net), 17, 'right']])

  // Produtos
  y = p.heading(y, 'DADOS DOS PRODUTOS / SERVIÇOS')
  p.box(X0, y, W, PRODUCTS_H)
  const columns = []
  let cx = X0
  for (const pct of PRODUCT_WIDTHS) { const w = W * pct / 100; columns.push({ x: cx, w }); cx += w }
  doc.line(X0, y + PRODUCT_HEAD_H, X0 + W, y + PRODUCT_HEAD_H)
  PRODUCT_HEAD.forEach((label, i) => {
    const parts = label.split('\n')
    parts.forEach((part, j) => p.text(part, columns[i].x + columns[i].w / 2, y + PRODUCT_HEAD_H / 2 + 0.8 + (j - (parts.length - 1) / 2) * 2, { size: 5, align: 'center', width: columns[i].w - 0.6 }))
    if (i) doc.line(columns[i].x, y, columns[i].x, y + PRODUCT_HEAD_H)
  })
  doc.setLineDashPattern([0.7, 0.7], 0)
  columns.slice(1).forEach(column => doc.line(column.x, y + PRODUCT_HEAD_H, column.x, y + PRODUCTS_H))
  doc.setLineDashPattern([], 0)
  let py = y + PRODUCT_HEAD_H + 0.4
  for (const { product, height } of items) {
    productCells(product).forEach((value, i) => {
      const { x, w } = columns[i], align = PRODUCT_ALIGN[i]
      const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w - 0.6 : x + 0.6
      if (i === 1) p.lines(value, w - 1.6, PRODUCT_FONT).forEach((line, j) => p.text(line, tx, py + 2.2 + j * PRODUCT_LINE, { size: PRODUCT_FONT }))
      else p.text(value, tx, py + 2.2, { size: PRODUCT_FONT, align, width: w - 1 })
    })
    py += height
  }
  y += PRODUCTS_H

  // Dados adicionais e rodapé
  y = p.heading(y, 'DADOS ADICIONAIS')
  const infoW = W * 0.66
  p.box(X0, y, infoW, ADDITIONAL_H); p.box(X0 + infoW, y, W - infoW, ADDITIONAL_H)
  p.text('INFORMAÇÕES COMPLEMENTARES', X0 + 0.8, y + 2.1, { size: 5 })
  p.text('RESERVADO AO FISCO', X0 + infoW + 0.8, y + 2.1, { size: 5 })
  const info = [d.info, d.dest.email && `Email do destinatário: ${d.dest.email}`].filter(Boolean).join(' ')
  const maxLines = Math.floor((ADDITIONAL_H - 3.5) / 2.9)
  p.lines(info, infoW - 2, 7, 'normal', 'helvetica').slice(0, maxLines).forEach((line, i) => p.text(line, X0 + 0.9, y + 5 + i * 2.9, { size: 7, family: 'helvetica' }))
  p.lines(d.fisco, W - infoW - 2, 7, 'normal', 'helvetica').slice(0, maxLines).forEach((line, i) => p.text(line, X0 + infoW + 0.9, y + 5 + i * 2.9, { size: 7, family: 'helvetica' }))
  y += ADDITIONAL_H
  p.text(`Impresso em ${printedAt}`, X0, y + 3, { size: 6, style: 'italic' })
}

export function buildDanfePdf(notes) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  const printedAt = printedAtNow()
  let first = true
  for (const note of notes) {
    const pages = paginate(doc, note.products.length ? note.products : [])
    pages.forEach((items, index) => {
      if (!first) doc.addPage('a4', 'portrait')
      first = false
      drawPage(doc, note, items, index + 1, pages.length, printedAt)
    })
  }
  doc.setProperties({ title: notes.length === 1 ? `DANFE ${notes[0].number}` : 'DANFEs', creator: 'Campo Certo' })
  return doc
}
