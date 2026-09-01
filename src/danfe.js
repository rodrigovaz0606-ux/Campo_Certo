import html2pdf from 'html2pdf.js'
import JsBarcode from 'jsbarcode'

const all = (node, name) => [...(node?.getElementsByTagName('*') || [])].filter(n => n.localName === name)
const first = (node, name) => all(node, name)[0]
const val = (node, name) => first(node, name)?.textContent?.trim() || ''
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const brl = value => Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const number = value => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })
const date = value => { if (!value) return ''; const d = new Date(value); return Number.isNaN(d.valueOf()) ? value : d.toLocaleString('pt-BR') }
const shortDate = value => value ? String(value).slice(0,10).split('-').reverse().join('/') : ''
const shortTime = value => { const match=String(value||'').match(/T(\d{2}:\d{2}:\d{2})/); return match?.[1] || '' }
const docMask = value => { const s=String(value||'').replace(/\D/g,''); return s.length===14?s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5'):s.length===11?s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4'):s }
const zipMask = value => String(value||'').replace(/\D/g,'').replace(/(\d{5})(\d{3})/,'$1-$2')
const invoiceNumber = value => String(value||'').padStart(9,'0').replace(/(\d{3})(\d{3})(\d{3})$/,'$1.$2.$3')
const seriesNumber = value => String(value||'').padStart(3,'0')
const address = node => ({ street:val(node,'xLgr'),number:val(node,'nro'),complement:val(node,'xCpl'),district:val(node,'xBairro'),city:val(node,'xMun'),uf:val(node,'UF'),zip:val(node,'CEP'),phone:val(node,'fone') })
const street = item => [item.street,item.number,item.complement].filter(Boolean).join(', ')
const paymentNames = {'01':'Dinheiro','02':'Cheque','03':'Cartão de crédito','04':'Cartão de débito','05':'Crédito loja','10':'Vale-alimentação','11':'Vale-refeição','12':'Vale-presente','13':'Vale-combustível','15':'Boleto bancário','16':'Depósito bancário','17':'PIX','18':'Transferência bancária','19':'Programa de fidelidade','90':'Sem pagamento','99':'Outros'}

function parse(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('XML inválido.')
  const inf=first(doc,'infNFe'); if(!inf) throw new Error('O XML não contém uma NF-e/NFC-e.')
  const ide=first(inf,'ide'), emit=first(inf,'emit'), dest=first(inf,'dest'), ee=first(emit,'enderEmit'), ed=first(dest,'enderDest'), total=first(inf,'ICMSTot'), transp=first(inf,'transp'), carrier=first(transp,'transporta'), vehicle=first(transp,'veicTransp'), vol=first(transp,'vol'), prot=first(doc,'infProt')
  const payments=all(inf,'detPag').map(item=>({type:paymentNames[val(item,'tPag')]||val(item,'tPag'),value:val(item,'vPag')}))
  return {
    key:(inf.getAttribute('Id')||val(prot,'chNFe')).replace(/^NFe/,''), number:val(ide,'nNF'), series:val(ide,'serie'), type:val(ide,'tpNF'), nature:val(ide,'natOp'), issued:val(ide,'dhEmi')||val(ide,'dEmi'), exit:val(ide,'dhSaiEnt')||val(ide,'dSaiEnt'),
    emit:{name:val(emit,'xNome'),trade:val(emit,'xFant'),doc:val(emit,'CNPJ')||val(emit,'CPF'),ie:val(emit,'IE'),im:val(emit,'IM'),iest:val(emit,'IEST'),address:address(ee)},
    dest:{name:val(dest,'xNome'),doc:val(dest,'CNPJ')||val(dest,'CPF'),ie:val(dest,'IE'),email:val(dest,'email'),address:address(ed)},
    total:Object.fromEntries(['vBC','vICMS','vBCST','vST','vII','vICMSDeson','vFCPUFDest','vICMSUFDest','vICMSUFRemet','vPIS','vProd','vFrete','vSeg','vDesc','vOutro','vIPI','vTotTrib','vCOFINS','vNF'].map(k=>[k,val(total,k)])), payments,
    protocol:[val(prot,'nProt'),date(val(prot,'dhRecbto'))].filter(Boolean).join(' - '), freight:val(transp,'modFrete'), carrier:val(carrier,'xNome'),carrierDoc:val(carrier,'CNPJ')||val(carrier,'CPF'),carrierIe:val(carrier,'IE'),carrierAddress:val(carrier,'xEnder'),carrierCity:val(carrier,'xMun'),carrierUf:val(carrier,'UF'),antt:val(carrier,'RNTRC'),plate:val(vehicle,'placa'),plateUf:val(vehicle,'UF'),volumes:val(vol,'qVol'),species:val(vol,'esp'),brand:val(vol,'marca'),volumeNumber:val(vol,'nVol'),gross:val(vol,'pesoB'),net:val(vol,'pesoL'),info:val(inf,'infCpl'),
    products:all(inf,'det').map(det=>{const p=first(det,'prod'),tax=first(det,'imposto');return{code:val(p,'cProd'),desc:val(p,'xProd'),additional:val(det,'infAdProd'),ncm:val(p,'NCM'),cst:val(tax,'CST')||val(tax,'CSOSN'),cfop:val(p,'CFOP'),unit:val(p,'uCom'),qty:val(p,'qCom'),unitValue:val(p,'vUnCom'),total:val(p,'vProd'),discount:val(p,'vDesc'),bc:val(tax,'vBC'),icms:val(tax,'vICMS'),ipi:val(tax,'vIPI'),rate:val(tax,'pICMS'),ipiRate:val(tax,'pIPI')}})
  }
}

const field = (label,value='') => `<div class="df-field"><small>${esc(label)}</small><b>${esc(value)}</b></div>`
const totals = [['BASE DE CÁLC. DO ICMS','vBC'],['VALOR DO ICMS','vICMS'],['BASE DE CÁLC. ICMS S.T.','vBCST'],['VALOR DO ICMS SUBST.','vST'],['V. IMP. IMPORTAÇÃO','vII'],['V. ICMS UF REMET.','vICMSUFRemet'],['V. FCP UF DEST.','vFCPUFDest'],['VALOR DO PIS','vPIS'],['V. TOTAL PRODUTOS','vProd'],['VALOR DO FRETE','vFrete'],['VALOR DO SEGURO','vSeg'],['DESCONTO','vDesc'],['OUTRAS DESPESAS','vOutro'],['VALOR TOTAL IPI','vIPI'],['V. ICMS UF DEST.','vICMSUFDest'],['V. TOT. TRIB.','vTotTrib'],['VALOR DA COFINS','vCOFINS'],['V. TOTAL DA NOTA','vNF']]

function template(d, pageNumber = 1, pageTotal = 1) { const payment=d.payments.map(item=>`${item.type}: R$ ${brl(item.value)}`).join(' | '); return `<article class="df-page">
  <section class="df-receipt"><div class="df-receipt-copy"><b>RECEBEMOS DE ${esc(d.emit.name)} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA ABAIXO.</b><span>EMISSÃO: ${esc(shortDate(d.issued))} &nbsp; VALOR TOTAL: R$ ${brl(d.total.vNF)} &nbsp; DESTINATÁRIO: ${esc(d.dest.name)} - ${esc(street(d.dest.address))} ${esc(d.dest.address.city)}-${esc(d.dest.address.uf)}</span><div class="df-receipt-sign"><span>DATA DE RECEBIMENTO</span><span>IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR</span></div></div><div class="df-receipt-number"><strong>NF-e</strong><b>Nº. ${invoiceNumber(d.number)}</b><b>Série ${seriesNumber(d.series)}</b></div></section>
  <section class="df-top"><div class="df-issuer"><h2>${esc(d.emit.name)}</h2><p>${esc(d.emit.trade)}</p><p>${esc(street(d.emit.address))}</p><p>${esc(d.emit.address.district)} - ${esc(zipMask(d.emit.address.zip))}</p><p>${esc(d.emit.address.city)} - ${esc(d.emit.address.uf)} Fone/Fax: ${esc(d.emit.address.phone)}</p></div><div class="df-title"><strong>DANFE</strong><span>Documento Auxiliar da Nota<br>Fiscal Eletrônica</span><div><span>0 - ENTRADA<br>1 - SAÍDA</span><b>${esc(d.type)}</b></div><strong>Nº. ${invoiceNumber(d.number)}<br>Série ${seriesNumber(d.series)}</strong><i>Folha ${pageNumber}/${pageTotal}</i></div><div class="df-access"><svg class="df-barcode" data-key="${esc(d.key)}"></svg><small>CHAVE DE ACESSO</small><b>${esc(d.key.replace(/(.{4})/g,'$1 ').trim())}</b><span>Consulta de autenticidade no portal nacional da NF-e<br>www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora</span></div></section>
  <div class="df-grid df-2">${field('NATUREZA DA OPERAÇÃO',d.nature)}${field('PROTOCOLO DE AUTORIZAÇÃO DE USO',d.protocol)}</div><div class="df-grid df-registration">${field('INSCRIÇÃO ESTADUAL',d.emit.ie)}${field('INSCRIÇÃO MUNICIPAL',d.emit.im)}${field('INSCRIÇÃO ESTADUAL DO SUBST. TRIBUT.',d.emit.iest)}${field('CNPJ / CPF',docMask(d.emit.doc))}</div>
  <h3>DESTINATÁRIO / REMETENTE</h3><div class="df-grid df-recipient">${field('NOME / RAZÃO SOCIAL',d.dest.name)}${field('CNPJ / CPF',docMask(d.dest.doc))}${field('DATA DA EMISSÃO',shortDate(d.issued))}${field('ENDEREÇO',street(d.dest.address))}${field('BAIRRO / DISTRITO',d.dest.address.district)}${field('CEP',zipMask(d.dest.address.zip))}${field('DATA DA SAÍDA/ENTRADA',shortDate(d.exit))}${field('MUNICÍPIO',d.dest.address.city)}${field('UF',d.dest.address.uf)}${field('FONE / FAX',d.dest.address.phone)}${field('INSCRIÇÃO ESTADUAL',d.dest.ie)}${field('HORA DA SAÍDA/ENTRADA',shortTime(d.exit))}</div>
  ${payment?`<h3>PAGAMENTO</h3><div class="df-payment">${esc(payment)}</div>`:''}
  <h3>CÁLCULO DO IMPOSTO</h3><div class="df-grid df-totals">${totals.map(([l,k])=>field(l,brl(d.total[k]))).join('')}</div>
  <h3>TRANSPORTADOR / VOLUMES TRANSPORTADOS</h3><div class="df-grid df-carrier">${field('NOME / RAZÃO SOCIAL',d.carrier)}${field('FRETE',({'0':'0-Por conta do Rem.','1':'1-Por conta do Dest.','2':'2-Por conta de Terceiros','9':'9-Sem transporte'})[d.freight]||d.freight)}${field('CÓDIGO ANTT',d.antt)}${field('PLACA DO VEÍCULO',d.plate)}${field('UF',d.plateUf)}${field('CNPJ / CPF',docMask(d.carrierDoc))}${field('ENDEREÇO',d.carrierAddress)}${field('MUNICÍPIO',d.carrierCity)}${field('UF',d.carrierUf)}${field('INSCRIÇÃO ESTADUAL',d.carrierIe)}${field('QUANTIDADE',d.volumes)}${field('ESPÉCIE',d.species)}${field('MARCA',d.brand)}${field('NUMERAÇÃO',d.volumeNumber)}${field('PESO BRUTO',number(d.gross))}${field('PESO LÍQUIDO',number(d.net))}</div>
  <h3>DADOS DOS PRODUTOS / SERVIÇOS</h3><div class="df-products-box"><table><thead><tr><th>CÓDIGO PRODUTO</th><th>DESCRIÇÃO DO PRODUTO / SERVIÇO</th><th>NCM/SH</th><th>O/CST</th><th>CFOP</th><th>UN</th><th>QUANT.</th><th>VALOR<br>UNIT.</th><th>VALOR<br>TOTAL</th><th>VALOR<br>DESC</th><th>B.CÁLC<br>ICMS</th><th>VALOR<br>ICMS</th><th>VALOR<br>IPI</th><th>ALÍQ.<br>ICMS</th><th>ALÍQ.<br>IPI</th></tr></thead><tbody>${d.products.map(p=>`<tr><td>${esc(p.code)}</td><td>${esc(p.desc)}${p.additional?`<small>${esc(p.additional)}</small>`:''}</td><td>${esc(p.ncm)}</td><td>${esc(p.cst)}</td><td>${esc(p.cfop)}</td><td>${esc(p.unit)}</td><td>${number(p.qty)}</td><td>${brl(p.unitValue)}</td><td>${brl(p.total)}</td><td>${brl(p.discount)}</td><td>${brl(p.bc)}</td><td>${brl(p.icms)}</td><td>${brl(p.ipi)}</td><td>${number(p.rate)}</td><td>${number(p.ipiRate)}</td></tr>`).join('')}</tbody></table></div>
  <h3>DADOS ADICIONAIS</h3><div class="df-extra">${field('INFORMAÇÕES COMPLEMENTARES',[d.info,d.dest.email&&`Email do destinatário: ${d.dest.email}`].filter(Boolean).join(' '))}${field('RESERVADO AO FISCO')}</div><footer><span>Documento gerado pelo Campo Certo a partir do XML autorizado.</span><span>${new Date().toLocaleString('pt-BR')}</span></footer></article>` }

const css = `.df-page{width:198mm;height:285mm;padding:0;background:#fff;color:#000;font:6.7px "Times New Roman",serif;display:flex;flex-direction:column;overflow:hidden}.df-page *{box-sizing:border-box}.df-receipt{flex:none}.df-top{display:grid;grid-template-columns:41% 17% 42%;height:36mm;border:1px solid}.df-top>div{padding:2px}.df-top>div+div{border-left:1px solid}.df-issuer{text-align:center}.df-issuer:before{content:'IDENTIFICAÇÃO DO EMITENTE';display:block;font-size:5px;font-style:italic;text-align:center}.df-issuer h2{font-size:12px;margin:7px 0 3px}.df-issuer p{font-size:7px;margin:1px}.df-title,.df-access{display:flex;flex-direction:column;text-align:center;justify-content:center}.df-title>strong:first-child{font-size:16px}.df-title>span{font-size:7px}.df-title>div{display:flex;align-items:center;justify-content:center;gap:8px;margin:2px}.df-title>div b{border:1px solid;padding:3px;font-size:12px}.df-title>strong:last-of-type{font-size:10px}.df-title i{font-size:7px}.df-access svg{width:100%;height:45px}.df-access small{text-align:left;margin-top:1px}.df-access>b{font-size:7px;letter-spacing:.25px;padding:2px}.df-access>span{border-top:1px solid;padding-top:2px;font-size:6px}.df-grid{display:grid}.df-grid .df-field{border-top:0}.df-grid .df-field:not(:first-child){border-left:0}.df-2{grid-template-columns:58% 42%}.df-registration{grid-template-columns:26% 25% 24% 25%}.df-recipient{grid-template-columns:47% 20% 17% 16%}.df-recipient .df-field:nth-child(1){grid-column:span 2}.df-recipient .df-field:nth-child(4){grid-column:span 2}.df-recipient .df-field:nth-child(8){grid-column:span 2}.df-totals{grid-template-columns:repeat(9,1fr)}.df-carrier{grid-template-columns:29% 15% 15% 15% 4% 22%}.df-carrier .df-field:nth-child(7){grid-column:span 2}.df-carrier .df-field:nth-child(8){grid-column:span 2}.df-field{height:7mm;min-width:0;padding:1px 2px;border:1px solid;overflow:hidden}.df-field small{display:block;font-size:4.7px;margin-bottom:1px;white-space:nowrap}.df-field b{display:block;font-size:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.df-page h3{font-size:7px;margin:2px 0 0}.df-payment{width:38%;height:8mm;border:1px solid;padding:2px;font-size:6px}.df-products-box{flex:1;min-height:42mm;border:1px solid;overflow:hidden}.df-page table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:5.6px}.df-page th,.df-page td{border-right:1px solid;padding:1px;text-align:right;vertical-align:top}.df-page th{height:8mm;border-bottom:1px solid;text-align:center;font-size:4.7px;font-weight:normal;line-height:1}.df-page th:nth-child(1){width:9%}.df-page th:nth-child(2){width:25%}.df-page th:nth-child(3){width:6%}.df-page th:nth-child(4){width:5%}.df-page th:nth-child(5){width:4%}.df-page th:nth-child(6){width:3%}.df-page th:nth-child(7){width:7%}.df-page th:nth-child(n+8){width:5.1%}.df-page th:nth-child(2),.df-page td:nth-child(2){text-align:left}.df-page td{height:8mm}.df-page td small{display:block;margin-top:1px}.df-extra{display:grid;grid-template-columns:2fr 1fr;height:13mm}.df-extra .df-field{height:13mm}.df-extra .df-field+div{border-left:0}.df-page footer{height:4mm;display:flex;justify-content:space-between;align-items:end;color:#333;font-size:5px;font-style:italic}`

const referenceCss = `.df-page{page-break-after:always}.df-page:last-child{page-break-after:auto}.df-receipt{display:grid;grid-template-columns:minmax(0,1fr) 37mm;width:100%;height:18mm;border:1px solid;margin-bottom:2mm;overflow:hidden}.df-receipt-copy{min-width:0;padding:2px;font-size:5.8px}.df-receipt-copy>span{display:block;margin-top:1px}.df-receipt-number{padding:2px;border-left:1px solid;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:9px}.df-receipt-number strong{font-size:15px;margin-bottom:2px}.df-receipt-sign{display:grid;grid-template-columns:22% 78%;height:7mm;margin:2px -2px -2px;border-top:1px solid}.df-receipt-sign span{padding:1px;font-size:5px}.df-receipt-sign span+span{border-left:1px solid}`

const paginatedTemplates = notes => notes.flatMap(note => {
  const chunks=[]
  for(let index=0;index<Math.max(note.products.length,1);index+=12) chunks.push(note.products.slice(index,index+12))
  return chunks.map((products,index)=>template({...note,products},index+1,chunks.length))
}).join('')
const renderBarcodes = container => container.querySelectorAll('.df-barcode').forEach(barcode => {
  const key=barcode.dataset.key
  if(key) JsBarcode(barcode,key,{format:'CODE128',displayValue:false,height:42,margin:2})
})

async function saveDanfes(xmls, filename) {
  const notes=xmls.map(parse), host=document.createElement('div'), style=document.createElement('style'), content=document.createElement('div')
  host.style.cssText='position:fixed;left:-10000px;top:0;background:white;z-index:-1'; style.textContent=css+referenceCss; host.append(style,content); content.innerHTML=paginatedTemplates(notes); document.body.append(host)
  try {
    renderBarcodes(content)
    await html2pdf().set({margin:4,filename,image:{type:'jpeg',quality:.98},html2canvas:{scale:2,useCORS:true},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},pagebreak:{mode:['css','legacy']}}).from(content).save()
  } finally { host.remove() }
}

export async function exportDanfePdf(xml) {
  const note=parse(xml)
  return saveDanfes([xml],`DANFE-${note.number||'nfe'}.pdf`)
}

export function renderDanfePreview(container, xml) {
  const note = parse(xml)
  container.innerHTML = `<style>${css}${referenceCss}</style>${paginatedTemplates([note])}`
  renderBarcodes(container)
}

export async function exportMultipleDanfePdf(xmls) {
  if (!xmls.length) throw new Error('Selecione ao menos uma nota.')
  return saveDanfes(xmls,`DANFEs-selecionadas-${new Date().toISOString().slice(0,10)}.pdf`)
}
