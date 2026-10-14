import JsBarcode from 'jsbarcode'

import { all, first, val, brl, fixed4, optional, number, shortDate, shortTime, dateTime, docMask, zipMask, invoiceNumber, seriesNumber, address, street, freightNames, parse } from './danfe-data.js'
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))

// Campo com largura em % da linha; align: 'c' centralizado, 'r' à direita.
const f = (label, value, width, align = '') => `<div class="df-f${align ? ` df-${align}` : ''}" style="width:${width}%"><small>${esc(label)}</small><b>${esc(value)}</b></div>`
const row = (...fields) => `<div class="df-row">${fields.join('')}</div>`
const totals = [[['BASE DE CÁLC. DO ICMS','vBC'],['VALOR DO ICMS','vICMS'],['BASE DE CÁLC. ICMS S.T.','vBCST'],['VALOR DO ICMS SUBST.','vST'],['V. IMP. IMPORTAÇÃO','vII'],['V. ICMS UF REMET.','vICMSUFRemet'],['V. FCP UF DEST.','vFCPUFDest'],['VALOR DO PIS','vPIS'],['V. TOTAL PRODUTOS','vProd']],[['VALOR DO FRETE','vFrete'],['VALOR DO SEGURO','vSeg'],['DESCONTO','vDesc'],['OUTRAS DESPESAS','vOutro'],['VALOR TOTAL IPI','vIPI'],['V. ICMS UF DEST.','vICMSUFDest'],['V. TOT. TRIB.','vTotTrib'],['VALOR DA COFINS','vCOFINS'],['V. TOTAL DA NOTA','vNF']]]
const productHead = ['CÓDIGO PRODUTO','DESCRIÇÃO DO PRODUTO / SERVIÇO','NCM/SH','O/CST','CFOP','UN','QUANT','VALOR<br>UNIT','VALOR<br>TOTAL','VALOR<br>DESC','B.CÁLC<br>ICMS','VALOR<br>ICMS','VALOR<br>IPI','ALÍQ.<br>ICMS','ALÍQ.<br>IPI']
const productWidths = [8.5,27.5,6.5,4.5,4,3,6.5,6.5,6.5,4.5,5,5,4.5,4,3.5]

function template(d, pageNumber = 1, pageTotal = 1, printedAt = '') {
  const destAddress = d.dest.address, emitAddress = d.emit.address
  return `<article class="df-page">
  <section class="df-receipt"><div class="df-receipt-copy"><p>RECEBEMOS DE ${esc(d.emit.name)} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA ABAIXO. EMISSÃO: ${esc(shortDate(d.issued))} VALOR TOTAL: R$ ${brl(d.total.vNF)} DESTINATÁRIO: ${esc(d.dest.name)} - ${esc(street(destAddress))} ${esc(destAddress.district)} ${esc(destAddress.city)}-${esc(destAddress.uf)}</p><div class="df-receipt-sign"><small style="width:22%">DATA DE RECEBIMENTO</small><small style="width:78%">IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR</small></div></div><div class="df-receipt-number"><strong>NF-e</strong><b>Nº. ${invoiceNumber(d.number)}</b><b>Série ${seriesNumber(d.series)}</b></div></section>
  <div class="df-cut"></div>
  <section class="df-box"><div class="df-row df-top"><div class="df-issuer" style="width:41%"><i>IDENTIFICAÇÃO DO EMITENTE</i><h2>${esc(d.emit.name)}</h2>${d.emit.trade && d.emit.trade !== d.emit.name ? `<p>${esc(d.emit.trade)}</p>` : ''}<p>${esc(street(emitAddress))}</p><p>${esc([emitAddress.district, zipMask(emitAddress.zip)].filter(Boolean).join(' - '))}</p><p>${esc(emitAddress.city)} - ${esc(emitAddress.uf)} Fone/Fax: ${esc(emitAddress.phone)}</p></div><div class="df-title" style="width:16.5%"><strong>DANFE</strong><span>Documento Auxiliar da Nota<br>Fiscal Eletrônica</span><div><span>0 - ENTRADA<br>1 - SAÍDA</span><b>${esc(d.type)}</b></div><strong>Nº. ${invoiceNumber(d.number)}<br>Série ${seriesNumber(d.series)}</strong><i>Folha ${pageNumber}/${pageTotal}</i></div><div class="df-access" style="width:42.5%"><div class="df-barcode-box"><svg class="df-barcode" data-key="${esc(d.key)}"></svg></div><div class="df-key"><small>CHAVE DE ACESSO</small><b>${esc(d.key.replace(/(.{4})/g,'$1 ').trim())}</b></div><p>Consulta de autenticidade no portal nacional da NF-e<br>www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora</p></div></div>
  ${row(f('NATUREZA DA OPERAÇÃO',d.nature,57.5,'c'),f('PROTOCOLO DE AUTORIZAÇÃO DE USO',d.protocol,42.5,'c'))}
  ${row(f('INSCRIÇÃO ESTADUAL',d.emit.ie,25,'c'),f('INSCRIÇÃO MUNICIPAL',d.emit.im,25,'c'),f('INSCRIÇÃO ESTADUAL DO SUBST. TRIBUT.',d.emit.iest,24,'c'),f('CNPJ / CPF',docMask(d.emit.doc),26,'c'))}</section>
  <h3 class="df-h">DESTINATÁRIO / REMETENTE</h3><section class="df-box">
  ${row(f('NOME / RAZÃO SOCIAL',d.dest.name,60),f('CNPJ / CPF',docMask(d.dest.doc),23,'c'),f('DATA DA EMISSÃO',shortDate(d.issued),17,'c'))}
  ${row(f('ENDEREÇO',street(destAddress),46),f('BAIRRO / DISTRITO',destAddress.district,14,'c'),f('CEP',zipMask(destAddress.zip),23,'c'),f('DATA DA SAÍDA/ENTRADA',shortDate(d.exit),17,'c'))}
  ${row(f('MUNICÍPIO',destAddress.city,46),f('UF',destAddress.uf,3.5,'c'),f('FONE / FAX',destAddress.phone,10.5,'c'),f('INSCRIÇÃO ESTADUAL',d.dest.ie,23,'c'),f('HORA DA SAÍDA/ENTRADA',shortTime(d.exit),17,'c'))}</section>
  <h3 class="df-h">CÁLCULO DO IMPOSTO</h3><section class="df-box">${totals.map(line=>row(...line.map(([label,key])=>f(label,brl(d.total[key]),100/9,'r')))).join('')}</section>
  <h3 class="df-h">TRANSPORTADOR / VOLUMES TRANSPORTADOS</h3><section class="df-box">
  ${row(f('NOME / RAZÃO SOCIAL',d.carrier,29),f('FRETE',freightNames[d.freight]||d.freight,16,'c'),f('CÓDIGO ANTT',d.antt,15,'c'),f('PLACA DO VEÍCULO',d.plate,15,'c'),f('UF',d.plateUf,3,'c'),f('CNPJ / CPF',docMask(d.carrierDoc),22,'c'))}
  ${row(f('ENDEREÇO',d.carrierAddress,45),f('MUNICÍPIO',d.carrierCity,30),f('UF',d.carrierUf,3,'c'),f('INSCRIÇÃO ESTADUAL',d.carrierIe,22,'c'))}
  ${row(f('QUANTIDADE',d.volumes,10,'c'),f('ESPÉCIE',d.species,17),f('MARCA',d.brand,17),f('NUMERAÇÃO',d.volumeNumber,16),f('PESO BRUTO',number(d.gross),23,'r'),f('PESO LÍQUIDO',number(d.net),17,'r'))}</section>
  <h3 class="df-h">DADOS DOS PRODUTOS / SERVIÇOS</h3><section class="df-products"><table><colgroup>${productWidths.map(w=>`<col style="width:${w}%">`).join('')}</colgroup><thead><tr>${productHead.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${d.products.map(p=>`<tr><td class="df-c">${esc(p.code)}</td><td class="df-l">${esc(p.desc)}${p.additional?`<br>${esc(p.additional)}`:''}</td><td class="df-c">${esc(p.ncm)}</td><td class="df-c">${esc(p.cst)}</td><td class="df-c">${esc(p.cfop)}</td><td class="df-c">${esc(p.unit)}</td><td>${fixed4(p.qty)}</td><td>${fixed4(p.unitValue)}</td><td>${brl(p.total)}</td><td>${brl(p.discount)}</td><td>${brl(p.bc)}</td><td>${brl(p.icms)}</td><td>${optional(p.ipi,brl)}</td><td>${brl(p.rate)}</td><td>${optional(p.ipiRate,brl)}</td></tr>`).join('')}<tr class="df-fill">${productHead.map(()=>'<td></td>').join('')}</tr></tbody></table></section>
  <h3 class="df-h">DADOS ADICIONAIS</h3><section class="df-box">${row(`<div class="df-f df-info" style="width:66%"><small>INFORMAÇÕES COMPLEMENTARES</small><p>${esc([d.info,d.dest.email&&`Email do destinatário: ${d.dest.email}`].filter(Boolean).join(' '))}</p></div>`,`<div class="df-f df-info" style="width:34%"><small>RESERVADO AO FISCO</small><p>${esc(d.fisco)}</p></div>`)}</section>
  <footer>Impresso em ${esc(printedAt)}</footer></article>`
}

// Seletores com .df-page + !important onde necessário para não herdar os estilos globais de tabela/tema do app.
const css = `.df-page{width:198mm;height:285mm;background:#fff!important;color:#000!important;font:7px/1.15 "Times New Roman",Times,serif;display:flex;flex-direction:column;overflow:hidden;text-align:left;letter-spacing:0;text-transform:none}
.df-page *{box-sizing:border-box;color:#000}
.df-page p,.df-page h2,.df-page h3{margin:0;font-family:inherit}
.df-receipt{display:flex;flex:none;height:17mm;border:1px solid}
.df-receipt-copy{flex:1;min-width:0;display:flex;flex-direction:column}
.df-receipt-copy p{flex:1;padding:2px 3px;font-size:6.3px;line-height:1.2;overflow:hidden}
.df-receipt-sign{display:flex;height:7mm;border-top:1px solid}
.df-receipt-sign small{padding:1px 2px;font-size:5px}.df-receipt-sign small+small{border-left:1px solid}
.df-receipt-number{width:20%;border-left:1px solid;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:9px}
.df-receipt-number strong{font-size:15px;margin-bottom:1px}
.df-cut{flex:none;height:0;margin:2mm 0;border-top:1px dashed}
.df-box{flex:none;border-top:1px solid;border-left:1px solid}
.df-row{display:flex}
.df-f{min-width:0;height:7mm;padding:1px 2px;border-right:1px solid;border-bottom:1px solid;overflow:hidden}
.df-f small{display:block;font-size:5px;line-height:1.1;white-space:nowrap;overflow:hidden;text-transform:uppercase}
.df-f b{display:block;margin-top:1.5px;font-size:8.5px;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.df-f.df-c b{text-align:center}.df-f.df-r b{text-align:right}
.df-top>div{height:34mm;border-right:1px solid;border-bottom:1px solid}
.df-issuer{padding:2px 3px;text-align:center}
.df-issuer i{display:block;font-size:5.5px}
.df-issuer h2{margin:6mm 0 1mm;font-size:12.5px;font-weight:bold}
.df-issuer p{font-size:7.5px}
.df-title{padding:2px;display:flex;flex-direction:column;align-items:center;text-align:center}
.df-title>strong:first-child{font-size:16px;margin-top:1mm}
.df-title>span{font-size:6.5px}
.df-title>div{display:flex;align-items:center;gap:8px;margin:2mm 0 1.5mm;font-size:6.5px;text-align:left}
.df-title>div b{border:1px solid;padding:2px 4px;font-size:12px}
.df-title>strong:last-of-type{font-size:10.5px;line-height:1.15}
.df-title i{font-size:7px}
.df-access{display:flex;flex-direction:column}
.df-barcode-box{flex:1;display:flex;align-items:center;justify-content:center;padding:2px 6px;border-bottom:1px solid}
.df-barcode-box svg{width:100%;height:12mm}
.df-key{height:8mm;padding:1px 2px;border-bottom:1px solid}
.df-key small{display:block;font-size:5px}
.df-key b{display:block;margin-top:1.5px;text-align:center;font-size:8px;letter-spacing:.2px}
.df-access p{height:8mm;display:flex;flex-direction:column;justify-content:center;text-align:center;font-size:7px}
.df-h{flex:none;margin:1.6mm 0 .3mm!important;font-size:7px!important;font-weight:bold;text-transform:uppercase}
.df-products{flex:1;min-height:40mm;border:1px solid;overflow:hidden}
.df-page table{width:100%;height:100%;border-collapse:collapse;table-layout:fixed;font-size:6.5px;background:#fff!important}
.df-page table th,.df-page table td{padding:1px 2px!important;border:0;border-right:1px dashed #000!important;background:#fff!important;color:#000!important;text-align:right;vertical-align:top;white-space:normal!important;letter-spacing:0;text-transform:none;font-family:inherit;overflow-wrap:anywhere}
.df-page table th:last-child,.df-page table td:last-child{border-right:0!important}
.df-page table th{height:6mm;border-bottom:1px solid #000!important;border-right-style:solid!important;text-align:center;vertical-align:middle;font-size:5px;font-weight:normal;line-height:1.05}
.df-page table td{height:auto;line-height:1.2}
.df-page table td.df-l{text-align:left}.df-page table td.df-c{text-align:center}
.df-page table tr.df-fill td{height:100%}
.df-info{height:24mm}.df-info p{margin-top:1.5px;font-family:Arial,Helvetica,sans-serif;font-size:7px;line-height:1.25;white-space:pre-wrap;overflow-wrap:anywhere}
.df-page footer{flex:none;height:4mm;padding-top:.6mm;font-size:6px;font-style:italic}`

const referenceCss = `.df-page{page-break-after:always}.df-page:last-child{page-break-after:auto}`

const paginatedTemplates = notes => {
  const now = new Date(), pad = n => String(n).padStart(2,'0')
  const printedAt = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} as ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  return notes.flatMap(note => {
    const chunks=[]
    for(let index=0;index<Math.max(note.products.length,1);index+=12) chunks.push(note.products.slice(index,index+12))
    return chunks.map((products,index)=>template({...note,products},index+1,chunks.length,printedAt))
  }).join('')
}
const renderBarcodes = container => container.querySelectorAll('.df-barcode').forEach(barcode => {
  const key=barcode.dataset.key
  if(key) JsBarcode(barcode,key,{format:'CODE128',displayValue:false,height:42,margin:0})
})

// O PDF é desenhado em vetor (texto selecionável); a visualização na tela continua em HTML.
async function saveDanfes(notes, filename) {
  const { buildDanfePdf } = await import('./danfe-pdf.js')
  buildDanfePdf(notes).save(filename)
}

export async function exportDanfePdf(xml) {
  const note=parse(xml)
  return saveDanfes([note],`DANFE-${note.number||'nfe'}.pdf`)
}

export function renderDanfePreview(container, xml) {
  const note = parse(xml)
  container.innerHTML = `<style>${css}${referenceCss}</style>${paginatedTemplates([note])}`
  renderBarcodes(container)
}

export async function exportMultipleDanfePdf(xmls) {
  if (!xmls.length) throw new Error('Selecione ao menos uma nota.')
  return saveDanfes(xmls.map(parse),`DANFEs-selecionadas-${new Date().toISOString().slice(0,10)}.pdf`)
}
