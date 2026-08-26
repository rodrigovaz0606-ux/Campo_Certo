import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyNcm, parseInvoiceXml } from './xml.js'

test('extrai os principais dados de uma NFe', () => {
  const xml='<nfeProc><NFe><infNFe Id="NFe123"><ide><nNF>42</nNF><dhEmi>2026-08-04T10:00:00-03:00</dhEmi></ide><emit><xNome>Fazenda Sol</xNome><CPF>11122233344</CPF></emit><dest><xNome>Frigorifico Boi Bom</xNome><CNPJ>55566677000188</CNPJ></dest><det><prod><NCM>01022190</NCM></prod></det><total><ICMSTot><vNF>1520.75</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>123</chNFe></infProt></protNFe></nfeProc>'
  assert.deepEqual(parseInvoiceXml(xml), { issueDate:'2026-08-04', invoiceNumber:'42', amount:1520.75, accessKey:'123', issuerName:'Fazenda Sol', recipientName:'Frigorifico Boi Bom', issuerDocument:'11122233344', recipientDocument:'55566677000188', ncmCodes:['01022190'], ncmCategory:'cattle' })
})

test('classifica os NCMs de gado, soja e outros', () => {
  assert.equal(classifyNcm(['01022190']), 'cattle')
  assert.equal(classifyNcm(['12019000']), 'soy')
  assert.equal(classifyNcm(['25181000']), 'other')
})
