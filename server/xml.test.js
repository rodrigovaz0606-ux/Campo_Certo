import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyNcm, parseInvoiceXml } from './xml.js'

const cattleXml = items => `<nfeProc><NFe><infNFe Id="NFe1"><ide><nNF>1</nNF><dhEmi>2026-03-03T10:00:00-03:00</dhEmi></ide><emit><CPF>11122233344</CPF></emit><dest><CPF>55566677788</CPF></dest>${items.map(([ncm, unit, qty]) => `<det><prod><NCM>${ncm}</NCM><uCom>${unit}</uCom><qCom>${qty}</qCom></prod></det>`).join('')}<total><ICMSTot><vNF>112000.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`

test('extrai os principais dados de uma NFe', () => {
  const xml='<nfeProc><NFe><infNFe Id="NFe123"><ide><nNF>42</nNF><dhEmi>2026-08-04T10:00:00-03:00</dhEmi></ide><emit><xNome>Fazenda Sol</xNome><CPF>11122233344</CPF><IE>11.408.371-1</IE></emit><dest><xNome>Frigorifico Boi Bom</xNome><CNPJ>55566677000188</CNPJ><IE>987654321</IE></dest><det><prod><NCM>01022190</NCM></prod></det><total><ICMSTot><vNF>1520.75</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>123</chNFe></infProt></protNFe></nfeProc>'
  assert.deepEqual(parseInvoiceXml(xml), { issueDate:'2026-08-04', invoiceNumber:'42', amount:1520.75, accessKey:'123', issuerName:'Fazenda Sol', recipientName:'Frigorifico Boi Bom', issuerDocument:'11122233344', recipientDocument:'55566677000188', issuerStateRegistration:'114083711', recipientStateRegistration:'987654321', issuerAddress:{street:'',number:'',complement:'',neighborhood:'',zipCode:''}, recipientAddress:{street:'',number:'',complement:'',neighborhood:'',zipCode:''}, ncmCodes:['01022190'], ncmCategory:'cattle', cattleQuantity:null })
})

test('classifica os NCMs de gado, soja e outros', () => {
  assert.equal(classifyNcm(['01022190']), 'cattle')
  assert.equal(classifyNcm(['12019000']), 'soy')
  assert.equal(classifyNcm(['25181000']), 'other')
})

test('conta as cabeças de gado pelas unidades da nota', () => {
  assert.equal(parseInvoiceXml(cattleXml([['01022990', 'CB', '46.0000']])).cattleQuantity, 46)
  assert.equal(parseInvoiceXml(cattleXml([['01022990', 'CAB', '10'], ['01022190', 'Cabeça', '5.0000']])).cattleQuantity, 15)
  assert.equal(parseInvoiceXml(cattleXml([['01022990', 'VOL', '110.0000']])).cattleQuantity, 110)
  assert.equal(parseInvoiceXml(cattleXml([['01022990', 'UN', '3'], ['25181000', 'TON', '152.19']])).cattleQuantity, 3)
})

test('não inventa quantidade quando o gado é vendido por peso', () => {
  assert.equal(parseInvoiceXml(cattleXml([['01022990', 'KG', '15400.50']])).cattleQuantity, null)
  assert.equal(parseInvoiceXml(cattleXml([['01022990', '@', '320']])).cattleQuantity, null)
  assert.equal(parseInvoiceXml(cattleXml([['01022990', 'CB', '10'], ['01022990', 'KG', '500']])).cattleQuantity, null)
  assert.equal(parseInvoiceXml(cattleXml([['25181000', 'TON', '2']])).cattleQuantity, null)
})
