import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLcdpr } from './lcdpr.js'
import { validateLcdpr } from './lcdpr-validator.js'

const producer = { id: 1, name: 'João da Silva', cpf: '11122233344', address: 'Rua 24', address_number: '245', complement: '', neighborhood: 'Palmares', zip_code: '14790000' }
// Dados fiscais vêm do cadastro da fazenda; NIRF e CAEPF zerados, como o escritório usa.
const farms = [
  { id: 7, name: 'Fazenda Boa Vista', state_registration: '115058400', address: 'Rodovia GO 156', address_number: 'SN', complement: 'KM 21', neighborhood: 'Zona Rural', zip_code: '76530000', ownership_type: 'unique', partners: [], nirf: '00000000', caepf: '00000000000000', uf: 'GO', city_code: '5214838' },
  { id: 9, name: 'Faz Guaíra 111211212', state_registration: '111211212', address: 'Rodovia GO 164', address_number: 'SN', complement: 'KM 326', neighborhood: 'Zona Rural', zip_code: '76520000', ownership_type: 'shared', partners: [{ document: '55566677788', share: 50 }], nirf: '00000000', caepf: '00000000000000', uf: 'GO', city_code: '5214838', exploration_type: '4' },
]
const settings = { uf: 'SP', cod_mun: '3517406', telefone: '(62) 3391-3343', email: 'cont.lacerda@hotmail.com', imovel_padrao: '7' }
const accountant = { nome: 'Sebastião de Lacerda', documento: '36069450191', crc: '9844', email: 'CONT.LACERDA@HOTMAIL.COM', telefone: '62999809079' }
const invoices = [
  { id: 1, issue_date: '2026-01-06', invoice_number: '21', amount: 262154, operation_type: 'outgoing', ncm_category: 'cattle', document_type: 'invoice', farm_id: 9, participant_document: '14731274168', participant_name: 'JESO ANTONIO' },
  { id: 2, issue_date: '2025-01-13', invoice_number: '140889', amount: 465.57, operation_type: 'incoming', ncm_category: 'other', document_type: 'invoice', farm_id: null, participant_document: '45236791008176', participant_name: 'COOPERCITRUS' },
  { id: 3, issue_date: '2025-03-20', invoice_number: 'FP-03', amount: 3500.5, operation_type: 'incoming', ncm_category: 'other', document_type: 'payroll', farm_id: 9, participant_document: '' },
  { id: 4, issue_date: '2025-02-13', invoice_number: '2', amount: 313741.05, operation_type: 'outgoing', ncm_category: 'other', document_type: 'invoice', farm_id: 7, participant_document: '36069450191', participant_name: 'SEBASTIAO DE LACERDA' },
]
const names = new Map([['55566677788', 'Rosangela Aparecida Ribeiro']])
const period = { from: '2025-01-01', to: '2026-12-31' }

test('gera o LCDPR no modelo do escritório (conta caixa, período livre, agrupado por imóvel) e passa no validador', () => {
  const result = buildLcdpr({ producer, farms, invoices, settings, accountant, period, names })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(validateLcdpr(result.text), [])
  const lines = result.text.trimEnd().split('\r\n')
  const rows = lines.map(line => line.split('|'))
  assert.ok(result.text.endsWith('\r\n') && !lines.some(line => line.startsWith('|') || line.endsWith('|')))
  assert.deepEqual(rows[0], ['0000', 'LCDPR', '0013', '11122233344', 'João da Silva', '0', '0', '', '01012025', '31122026'])
  assert.deepEqual(rows[2], ['0030', 'Rua 24', '245', '', 'Palmares', 'SP', '3517406', '14790000', '6233913343', 'cont.lacerda@hotmail.com'])
  assert.deepEqual(rows.filter(row => row[0] === '0040').map(row => [row[1], row[4], row[5], row[13], row[15], row[16]]), [['001', '00000000', '00000000000000', '5214838', '1', '10000'], ['002', '00000000', '00000000000000', '5214838', '4', '05000']])
  assert.deepEqual(rows.find(row => row[0] === '0045'), ['0045', '002', '3', '55566677788', 'Rosangela Aparecida Ribeiro', '05000'])
  assert.deepEqual(rows.find(row => row[0] === '0050'), ['0050', '000', 'BRA', '000', 'CONTA CAIXA', '000', '000'])

  // Agrupado por imóvel (001 antes do 002) e por data dentro do imóvel; conta 000; histórico com o participante.
  const q100 = rows.filter(row => row[0] === 'Q100')
  assert.deepEqual(q100.map(row => [row[1], row[2], row[3]]), [['13012025', '001', '000'], ['13022025', '001', '000'], ['20032025', '002', '000'], ['06012026', '002', '000']])
  assert.deepEqual(q100[0].slice(4, 13), ['140889', '1', 'Compras do fornecedor COOPERCITRUS', '45236791008176', '2', '000', '46557', '46557', 'N'])
  assert.deepEqual(q100[1].slice(6, 13), ['Vendas a SEBASTIAO DE LACERDA', '36069450191', '1', '31374105', '000', '31327548', 'P'])
  assert.deepEqual(q100[2].slice(5, 9), ['5', 'Folha de pagamento', '11122233344', '2'])
  // Fazenda em parceria com 50%: valores lançados pela metade (R$ 3.500,50 -> 1.750,25; R$ 262.154,00 -> 131.077,00).
  assert.deepEqual([q100[2][10], q100[3][9], q100[3][11]], ['175025', '13107700', '44260223'])

  const q200 = rows.filter(row => row[0] === 'Q200')
  assert.deepEqual(q200.map(row => row[1]), ['012025', '022025', '032025', '012026'])
  assert.deepEqual(rows.at(-1), ['9999', 'Sebastião de Lacerda', '36069450191', '9844', 'CONT.LACERDA@HOTMAIL.COM', '62999809079', String(lines.length)])
  assert.equal(result.filename, 'LCDPR_01012025_NrSeq_0001_11122233344_01012025_a_31122026.txt')
})

test('conta bancária e só uma propriedade escolhida', () => {
  const bank = { ...settings, conta: { tipo: 'banco', banco: '001', nome_banco: 'Banco do Brasil', agencia: '1234', numero: '56789-0' } }
  const result = buildLcdpr({ producer, farms: [farms[0]], invoices: invoices.filter(invoice => invoice.farm_id !== 9), settings: bank, accountant, period, names })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(validateLcdpr(result.text), [])
  assert.ok(result.text.includes('0050|001|BR|001|Banco do Brasil|1234|0000000000567890\r\n'))
  assert.equal(result.text.split('\r\n').filter(line => line.startsWith('0040')).length, 1)
})

test('aponta o que falta antes de gerar', () => {
  const noCity = farms.map(farm => ({ ...farm, city_code: '' }))
  const result = buildLcdpr({ producer: { ...producer, cpf: '123' }, farms: noCity, invoices: [...invoices, { ...invoices[0], id: 5, participant_document: '' }], settings: { email: '', imovel_padrao: '' }, accountant: {}, period: { from: '2026-01-01', to: '2025-01-01' }, names })
  for (const expected of ['data inicial', 'CPF válido', 'código IBGE do município do produtor', 'e-mail', 'sem participante', 'município (código IBGE) da fazenda']) {
    assert.ok(result.errors.some(error => error.includes(expected)), `faltou o erro: ${expected}\n${result.errors.join('\n')}`)
  }
  const orphans = buildLcdpr({ producer, farms, invoices, settings: { ...settings, imovel_padrao: '' }, accountant, period, names })
  assert.ok(orphans.errors.some(error => error.includes('sem fazenda')))
})

test('o validador aceita os exemplos do manual oficial e recusa erros comuns', () => {
  // Linhas copiadas dos exemplos do Manual de Preenchimento do LCDPR (ADE Copes nº 1/2020).
  const manual = [
    '0000|LCDPR|0013|11111111191|JOSÉ DA SILVA|0|0||01012019|31122019',
    '0030|RUA TESTE|1234|BLOCO Z SALA 301|BAIRRO LCDPR|DF|5300108|71000000|6133333333|testeLCDPR@LCDPR.com.br',
    '0040|001|BR|BRL|12345678|12345678901234|12345678901234|Fazenda Tudo Certo|Rodovia BR 999, Km 3000|||Distrito do Meio|DF|5300108|71000000|2|05000',
    '0045|002|3|12345678912|JOÃO DE SOUSA|00520',
    '0050|001|BR|999|Banco LCDPR|1234|0000000123456789',
    'Q100|02012019|001|001|2|3|Venda de 100 sacas de milho|12345678912|1|1000000|0|1100000|P',
    'Q200|012019|10000000|8500000|1500000|P',
    '9999|JOSE DE SOUZA|12345678912|AL123456O|testeLCDPR@LCDPR.com.br|6133333333|8007',
  ].join('\r\n') + '\r\n'
  assert.deepEqual(validateLcdpr(manual, { checkFieldsOnly: true }), [])

  const good = buildLcdpr({ producer, farms, invoices, settings, accountant, period, names }).text
  const broken = good
    .replace('|3517406|14790000|6233913343|', '|3517406|14790-000|6233913343|') // CEP com hífen
    .replace('|Rosangela Aparecida Ribeiro|05000', '|Rosangela Aparecida Ribeiro|07000') // participação que não soma 100%
    .replace(/\|\d+\r\n$/, '|99\r\n') // QTD_LIN errado
  const problems = validateLcdpr(broken)
  assert.ok(problems.some(p => p.includes('CEP')))
  assert.ok(problems.some(p => p.includes('soma das participações')))
  assert.ok(problems.some(p => p.includes('QTD_LIN')))
})
