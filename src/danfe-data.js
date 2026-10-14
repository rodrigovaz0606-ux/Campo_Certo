// Leitura do XML da NF-e e formatações usadas pela visualização e pelo PDF da DANFE.
export const all = (node, name) => [...(node?.getElementsByTagName('*') || [])].filter(n => n.localName === name)
export const first = (node, name) => all(node, name)[0]
export const val = (node, name) => first(node, name)?.textContent?.trim() || ''
export const brl = value => Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fixed4 = value => Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
export const optional = (value, format) => value === '' ? '' : format(value)
export const number = value => optional(value, v => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 }))
export const shortDate = value => value ? String(value).slice(0,10).split('-').reverse().join('/') : ''
export const shortTime = value => { const match=String(value||'').match(/T(\d{2}:\d{2}:\d{2})/); return match?.[1] || '' }
export const dateTime = value => [shortDate(value), shortTime(value)].filter(Boolean).join(' ')
export const docMask = value => { const s=String(value||'').replace(/\D/g,''); return s.length===14?s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5'):s.length===11?s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4'):s }
export const zipMask = value => String(value||'').replace(/\D/g,'').replace(/(\d{5})(\d{3})/,'$1-$2')
export const invoiceNumber = value => String(value||'').padStart(9,'0').replace(/(\d{3})(\d{3})(\d{3})$/,'$1.$2.$3')
export const seriesNumber = value => String(value||'').padStart(3,'0')
export const address = node => ({ street:val(node,'xLgr'),number:val(node,'nro'),complement:val(node,'xCpl'),district:val(node,'xBairro'),city:val(node,'xMun'),uf:val(node,'UF'),zip:val(node,'CEP'),phone:val(node,'fone') })
export const street = item => [[item.street,item.number].filter(Boolean).join(', '),item.complement].filter(Boolean).join(' - ')
export const freightNames = {'0':'0-Por conta do Rem','1':'1-Por conta do Dest','2':'2-Por conta de Terceiros','3':'3-Próprio por conta do Rem','4':'4-Próprio por conta do Dest','9':'9-Sem Transporte'}

export function parse(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('XML inválido.')
  const inf=first(doc,'infNFe'); if(!inf) throw new Error('O XML não contém uma NF-e/NFC-e.')
  const ide=first(inf,'ide'), emit=first(inf,'emit'), dest=first(inf,'dest'), ee=first(emit,'enderEmit'), ed=first(dest,'enderDest'), total=first(inf,'ICMSTot'), transp=first(inf,'transp'), carrier=first(transp,'transporta'), vehicle=first(transp,'veicTransp'), vol=first(transp,'vol'), prot=first(doc,'infProt')
  return {
    key:(inf.getAttribute('Id')||val(prot,'chNFe')).replace(/^NFe/,''), number:val(ide,'nNF'), series:val(ide,'serie'), type:val(ide,'tpNF'), nature:val(ide,'natOp'), issued:val(ide,'dhEmi')||val(ide,'dEmi'), exit:val(ide,'dhSaiEnt')||val(ide,'dSaiEnt'),
    emit:{name:val(emit,'xNome'),trade:val(emit,'xFant'),doc:val(emit,'CNPJ')||val(emit,'CPF'),ie:val(emit,'IE'),im:val(emit,'IM'),iest:val(emit,'IEST'),address:address(ee)},
    dest:{name:val(dest,'xNome'),doc:val(dest,'CNPJ')||val(dest,'CPF'),ie:val(dest,'IE'),email:val(dest,'email'),address:address(ed)},
    total:Object.fromEntries(['vBC','vICMS','vBCST','vST','vII','vICMSDeson','vFCPUFDest','vICMSUFDest','vICMSUFRemet','vPIS','vProd','vFrete','vSeg','vDesc','vOutro','vIPI','vTotTrib','vCOFINS','vNF'].map(k=>[k,val(total,k)])),
    protocol:[val(prot,'nProt'),dateTime(val(prot,'dhRecbto'))].filter(Boolean).join(' - '), freight:val(transp,'modFrete'), carrier:val(carrier,'xNome'),carrierDoc:val(carrier,'CNPJ')||val(carrier,'CPF'),carrierIe:val(carrier,'IE'),carrierAddress:val(carrier,'xEnder'),carrierCity:val(carrier,'xMun'),carrierUf:val(carrier,'UF'),antt:val(carrier,'RNTRC'),plate:val(vehicle,'placa'),plateUf:val(vehicle,'UF'),volumes:val(vol,'qVol'),species:val(vol,'esp'),brand:val(vol,'marca'),volumeNumber:val(vol,'nVol'),gross:val(vol,'pesoB'),net:val(vol,'pesoL'),info:val(inf,'infCpl'),fisco:val(inf,'infAdFisco'),
    products:all(inf,'det').map(det=>{const p=first(det,'prod'),tax=first(det,'imposto'),icms=first(tax,'ICMS'),ipi=first(tax,'IPI'),orig=val(icms,'orig'),cst=val(icms,'CST')||val(icms,'CSOSN');return{code:val(p,'cProd'),desc:val(p,'xProd'),additional:val(det,'infAdProd'),ncm:val(p,'NCM'),cst:[orig,cst].filter(Boolean).join('/'),cfop:val(p,'CFOP'),unit:val(p,'uCom'),qty:val(p,'qCom'),unitValue:val(p,'vUnCom'),total:val(p,'vProd'),discount:val(p,'vDesc'),bc:val(icms,'vBC'),icms:val(icms,'vICMS'),ipi:val(ipi,'vIPI'),rate:val(icms,'pICMS'),ipiRate:val(ipi,'pIPI')}})
  }
}
