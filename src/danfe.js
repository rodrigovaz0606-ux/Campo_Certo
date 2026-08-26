import html2pdf from 'html2pdf.js'
import JsBarcode from 'jsbarcode'

const all = (node, name) => [...(node?.getElementsByTagName('*') || [])].filter(n => n.localName === name)
const first = (node, name) => all(node, name)[0]
const val = (node, name) => first(node, name)?.textContent?.trim() || ''
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const brl = value => Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const number = value => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })
const date = value => { if (!value) return ''; const d = new Date(value); return Number.isNaN(d.valueOf()) ? value : d.toLocaleString('pt-BR') }
const docMask = value => { const s=String(value||'').replace(/\D/g,''); return s.length===14?s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5'):s.length===11?s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4'):s }
const address = node => [val(node,'xLgr'),val(node,'nro'),val(node,'xCpl'),val(node,'xBairro')].filter(Boolean).join(', ')

function parse(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('XML inválido.')
  const inf=first(doc,'infNFe'); if(!inf) throw new Error('O XML não contém uma NF-e/NFC-e.')
  const ide=first(inf,'ide'), emit=first(inf,'emit'), dest=first(inf,'dest'), ee=first(emit,'enderEmit'), ed=first(dest,'enderDest'), total=first(inf,'ICMSTot'), transp=first(inf,'transp'), carrier=first(transp,'transporta'), vol=first(transp,'vol'), prot=first(doc,'infProt')
  return {
    key:(inf.getAttribute('Id')||val(prot,'chNFe')).replace(/^NFe/,''), number:val(ide,'nNF'), series:val(ide,'serie'), type:val(ide,'tpNF'), nature:val(ide,'natOp'), issued:val(ide,'dhEmi')||val(ide,'dEmi'), exit:val(ide,'dhSaiEnt')||val(ide,'dSaiEnt'),
    emit:{name:val(emit,'xNome'),trade:val(emit,'xFant'),doc:val(emit,'CNPJ')||val(emit,'CPF'),ie:val(emit,'IE'),address:address(ee),city:val(ee,'xMun'),uf:val(ee,'UF'),zip:val(ee,'CEP'),phone:val(ee,'fone')},
    dest:{name:val(dest,'xNome'),doc:val(dest,'CNPJ')||val(dest,'CPF'),ie:val(dest,'IE'),address:address(ed),city:val(ed,'xMun'),uf:val(ed,'UF'),zip:val(ed,'CEP'),phone:val(ed,'fone')},
    total:Object.fromEntries(['vBC','vICMS','vBCST','vST','vProd','vFrete','vSeg','vDesc','vOutro','vIPI','vTotTrib','vNF'].map(k=>[k,val(total,k)])),
    protocol:[val(prot,'nProt'),date(val(prot,'dhRecbto'))].filter(Boolean).join(' - '), freight:val(transp,'modFrete'), carrier:val(carrier,'xNome'),carrierDoc:val(carrier,'CNPJ')||val(carrier,'CPF'),carrierIe:val(carrier,'IE'),carrierAddress:val(carrier,'xEnder'),carrierCity:val(carrier,'xMun'),carrierUf:val(carrier,'UF'),volumes:val(vol,'qVol'),species:val(vol,'esp'),brand:val(vol,'marca'),gross:val(vol,'pesoB'),net:val(vol,'pesoL'),info:val(inf,'infCpl'),
    products:all(inf,'det').map(det=>{const p=first(det,'prod'),tax=first(det,'imposto');return{code:val(p,'cProd'),desc:val(p,'xProd'),ncm:val(p,'NCM'),cst:val(tax,'CST')||val(tax,'CSOSN'),cfop:val(p,'CFOP'),unit:val(p,'uCom'),qty:val(p,'qCom'),unitValue:val(p,'vUnCom'),total:val(p,'vProd'),bc:val(tax,'vBC'),icms:val(tax,'vICMS'),ipi:val(tax,'vIPI'),rate:val(tax,'pICMS')}})
  }
}

const field = (label,value='') => `<div class="df-field"><small>${esc(label)}</small><b>${esc(value)}</b></div>`
const totals = [['BASE DE CÁLCULO DO ICMS','vBC'],['VALOR DO ICMS','vICMS'],['BASE DE CÁLCULO ICMS ST','vBCST'],['VALOR DO ICMS ST','vST'],['TOTAL DOS PRODUTOS','vProd'],['VALOR DO FRETE','vFrete'],['VALOR DO SEGURO','vSeg'],['DESCONTO','vDesc'],['OUTRAS DESPESAS','vOutro'],['VALOR DO IPI','vIPI'],['VALOR APROX. TRIBUTOS','vTotTrib'],['VALOR TOTAL DA NOTA','vNF']]

function template(d, pageNumber = 1, pageTotal = 1) { return `<article class="df-page">
  <section class="df-receipt"><div class="df-receipt-copy"><b>RECEBEMOS DE ${esc(d.emit.name)} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA ABAIXO.</b><span>EMISSÃO: ${esc(date(d.issued))} &nbsp; VALOR TOTAL: R$ ${brl(d.total.vNF)} &nbsp; DESTINATÁRIO: ${esc(d.dest.name)} - ${esc(d.dest.address)} ${esc(d.dest.city)}-${esc(d.dest.uf)}</span><div class="df-receipt-sign"><span>DATA DE RECEBIMENTO</span><span>IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR</span></div></div><div class="df-receipt-number"><strong>NF-e</strong><b>Nº ${esc(d.number)}</b><b>Série ${esc(d.series)}</b></div></section>
  <section class="df-top"><div class="df-issuer"><h2>${esc(d.emit.name)}</h2><p>${esc(d.emit.trade)}</p><p>${esc(d.emit.address)}</p><p>${esc(d.emit.city)} - ${esc(d.emit.uf)} | CEP ${esc(d.emit.zip)} | Fone ${esc(d.emit.phone)}</p></div><div class="df-title"><strong>DANFE</strong><span>Documento Auxiliar da<br>Nota Fiscal Eletrônica</span><b>${d.type==='0'?'0 - ENTRADA':'1 - SAÍDA'}</b><strong>Nº ${esc(d.number)}<br>SÉRIE ${esc(d.series)}</strong></div><div class="df-access"><svg class="df-barcode"></svg><b>${esc(d.key.replace(/(.{4})/g,'$1 ').trim())}</b><small>Consulta de autenticidade no portal nacional da NF-e</small></div></section>
  <div class="df-grid df-2">${field('NATUREZA DA OPERAÇÃO',d.nature)}${field('PROTOCOLO DE AUTORIZAÇÃO DE USO',d.protocol)}</div><div class="df-grid df-3">${field('INSCRIÇÃO ESTADUAL',d.emit.ie)}${field('INSCRIÇÃO ESTADUAL DO SUBST. TRIBUTÁRIO')}${field('CNPJ / CPF',docMask(d.emit.doc))}</div>
  <h3>DESTINATÁRIO / REMETENTE</h3><div class="df-grid df-dest">${field('NOME / RAZÃO SOCIAL',d.dest.name)}${field('CNPJ / CPF',docMask(d.dest.doc))}${field('DATA DA EMISSÃO',date(d.issued))}${field('ENDEREÇO',d.dest.address)}${field('MUNICÍPIO',d.dest.city)}${field('UF',d.dest.uf)}${field('CEP',d.dest.zip)}${field('INSCRIÇÃO ESTADUAL',d.dest.ie)}${field('DATA DA SAÍDA / ENTRADA',date(d.exit))}</div>
  <h3>CÁLCULO DO IMPOSTO</h3><div class="df-grid df-totals">${totals.map(([l,k])=>field(l,`R$ ${brl(d.total[k])}`)).join('')}</div>
  <h3>TRANSPORTADOR / VOLUMES TRANSPORTADOS</h3><div class="df-grid df-4">${field('RAZÃO SOCIAL',d.carrier)}${field('FRETE POR CONTA',({'0':'0 - Emitente','1':'1 - Destinatário','9':'9 - Sem frete'})[d.freight]||d.freight)}${field('CNPJ / CPF',docMask(d.carrierDoc))}${field('INSCRIÇÃO ESTADUAL',d.carrierIe)}${field('ENDEREÇO',d.carrierAddress)}${field('MUNICÍPIO',d.carrierCity)}${field('UF',d.carrierUf)}${field('QUANTIDADE / ESPÉCIE / MARCA',`${d.volumes} ${d.species} ${d.brand}`)}${field('PESO BRUTO',d.gross)}${field('PESO LÍQUIDO',d.net)}</div>
  <h3>DADOS DOS PRODUTOS / SERVIÇOS</h3><table><thead><tr><th>CÓDIGO</th><th>DESCRIÇÃO</th><th>NCM/SH</th><th>CST</th><th>CFOP</th><th>UN</th><th>QTD.</th><th>V. UNIT.</th><th>V. TOTAL</th><th>BC ICMS</th><th>V. ICMS</th><th>V. IPI</th><th>% ICMS</th></tr></thead><tbody>${d.products.map(p=>`<tr><td>${esc(p.code)}</td><td>${esc(p.desc)}</td><td>${esc(p.ncm)}</td><td>${esc(p.cst)}</td><td>${esc(p.cfop)}</td><td>${esc(p.unit)}</td><td>${number(p.qty)}</td><td>${brl(p.unitValue)}</td><td>${brl(p.total)}</td><td>${brl(p.bc)}</td><td>${brl(p.icms)}</td><td>${brl(p.ipi)}</td><td>${number(p.rate)}</td></tr>`).join('')}</tbody></table>
  <h3>DADOS ADICIONAIS</h3><div class="df-extra">${field('INFORMAÇÕES COMPLEMENTARES',d.info)}${field('RESERVADO AO FISCO')}</div><footer>Documento gerado a partir do XML autorizado. Confira os dados antes de utilizar.</footer></article>` }

const css = `.df-page{width:198mm;min-height:285mm;padding:2mm;background:#fff;color:#000;font:8px Arial,sans-serif}.df-page *{box-sizing:border-box}.df-top{display:grid;grid-template-columns:37% 22% 41%;min-height:104px;border:1px solid}.df-top>div{padding:5px}.df-top>div+div{border-left:1px solid}.df-issuer{text-align:center}.df-issuer h2{font-size:15px;margin:8px 0 3px}.df-issuer p{margin:2px}.df-title,.df-access{display:flex;flex-direction:column;text-align:center;justify-content:center;gap:5px}.df-title>strong:first-child{font-size:17px}.df-title>b{border:1px solid;padding:3px}.df-access svg{width:100%;height:43px}.df-access>b{font-size:9px;letter-spacing:.5px}.df-grid{display:grid}.df-grid .df-field{border-top:0}.df-grid .df-field+.df-field{border-left:0}.df-2{grid-template-columns:1fr 1fr}.df-3{grid-template-columns:1fr 1.5fr 1fr}.df-dest{grid-template-columns:2fr 1fr .8fr}.df-totals{grid-template-columns:repeat(5,1fr)}.df-4{grid-template-columns:2fr 1fr 1fr 1fr}.df-field{min-height:28px;padding:3px 4px;border:1px solid;overflow:hidden}.df-field small{display:block;font-size:6px;margin-bottom:4px}.df-field b{font-size:8px}.df-page h3{font-size:8px;margin:7px 0 2px}.df-page table{width:100%;border-collapse:collapse;font-size:6.5px}.df-page th,.df-page td{border:1px solid;padding:3px;text-align:right}.df-page th{font-size:5.5px;background:#f2f2f2}.df-page th:nth-child(2),.df-page td:nth-child(2){text-align:left;width:26%}.df-page td{height:20px}.df-extra{display:grid;grid-template-columns:2fr 1fr;min-height:70px}.df-extra .df-field+div{border-left:0}.df-page footer{text-align:right;margin-top:5px;color:#555;font-size:6px}`

const referenceCss = `.df-page{page-break-after:always;overflow:hidden}.df-page:last-child{page-break-after:auto}.df-receipt{position:static;display:grid;grid-template-columns:minmax(0,1fr) 37mm;width:100%;height:23mm;min-height:23mm;max-height:23mm;border:1px solid;margin:0 0 2mm;background:#fff;color:#000;overflow:hidden}.df-receipt-copy{min-width:0;padding:3px;font-size:6.5px;background:#fff;color:#000}.df-receipt-copy>span{display:block;margin-top:2px}.df-receipt-number{position:static;width:auto;height:auto;min-height:0;padding:3px;border-left:1px solid;background:#fff;color:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:10px}.df-receipt-number strong{font-size:16px;margin-bottom:5px}.df-receipt-sign{display:grid;grid-template-columns:35% 65%;height:9mm;margin:4px -3px -3px;border-top:1px solid}.df-receipt-sign span{padding:2px;font-size:5.5px}.df-receipt-sign span+span{border-left:1px solid}.df-top{grid-template-columns:41% 17% 42%;min-height:36mm}.df-issuer:before{content:'IDENTIFICAÇÃO DO EMITENTE';display:block;font-size:5px;font-style:italic;text-align:left}.df-issuer h2{font-size:12px}.df-page tbody:after{content:'';display:block;height:30mm}.df-extra{min-height:27mm}`

async function saveDanfes(xmls, filename) {
  const notes=xmls.map(parse), host=document.createElement('div'), style=document.createElement('style'), content=document.createElement('div')
  host.style.cssText='position:fixed;left:-10000px;top:0;background:white;z-index:-1'; style.textContent=css+referenceCss; host.append(style,content); content.innerHTML=notes.map((note,index)=>template(note,index+1,notes.length)).join(''); document.body.append(host)
  try {
    content.querySelectorAll('.df-barcode').forEach((barcode,index)=>{ if(notes[index].key) JsBarcode(barcode,notes[index].key,{format:'CODE128',displayValue:false,height:42,margin:2}) })
    await html2pdf().set({margin:4,filename,image:{type:'jpeg',quality:.98},html2canvas:{scale:2,useCORS:true},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},pagebreak:{mode:['css','legacy']}}).from(content).save()
  } finally { host.remove() }
}

export async function exportDanfePdf(xml) {
  const note=parse(xml)
  return saveDanfes([xml],`DANFE-${note.number||'nfe'}.pdf`)
}

export function renderDanfePreview(container, xml) {
  const note = parse(xml)
  container.innerHTML = `<style>${css}${referenceCss}</style>${template(note)}`
  const barcode = container.querySelector('.df-barcode')
  if (barcode && note.key) JsBarcode(barcode, note.key, { format: 'CODE128', displayValue: false, height: 42, margin: 2 })
}

export async function exportMultipleDanfePdf(xmls) {
  if (!xmls.length) throw new Error('Selecione ao menos uma nota.')
  return saveDanfes(xmls,`DANFEs-selecionadas-${new Date().toISOString().slice(0,10)}.pdf`)
}
