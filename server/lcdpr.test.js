import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLcdpr } from './lcdpr.js'
import { validateLcdpr } from './lcdpr-validator.js'

const producer = { id: 1, name: 'João da Silva', cpf: '11122233344', address: 'Rodovia GO 156', address_number: 'S/N', complement: 'Km 21', neighborhood: 'Zona Rural', zip_code: '76530000' }
const farms = [
  { id: 7, name: 'Fazenda Boa Vista', state_registration: '115058400', address: 'Rodovia GO 156', address_number: 'S/N', complement: '', neighborhood: 'Zona Rural', zip_code: '76530000', ownership_type: 'unique', partners: [] },
  { id: 9, name: 'Fazenda Sócios', state_registration: '115058401', address: 'Estrada', address_number: '1', complement: '', neighborhood: 'Rural', zip_code: '76530000', ownership_type: 'shared', partners: [{ document: '55566677788', share: 40 }] },
]
const settings = {
  uf: 'GO', cod_mun: '5214051', telefone: '(62) 99999-0000', email: 'joao@exemplo.com',
  conta: { banco: '001', nome_banco: 'Banco do Brasil', agencia: '1234', numero: '56789-0' },
  imovel_padrao: '7',
  imoveis: { 7: { cad_itr: '12345678', caepf: '12345678901234', cod_mun: '5214051' }, 9: { cad_itr: '87654321', cod_mun: '5214051', tipo_exploracao: '2' } },
}
const accountant = { nome: 'Contabilidade Teste', documento: '12345678000199', crc: 'GO-012345/O', email: 'contador@exemplo.com', telefone: '6232320000' }
const invoices = [
  { id: 1, issue_date: '2025-03-04', invoice_number: '27111523', amount: 112000, operation_type: 'outgoing', ncm_category: 'cattle', document_type: 'invoice', farm_id: 7, participant_document: '88203700187' },
  { id: 2, issue_date: '2025-01-10', invoice_number: '120522', amount: 12936.15, operation_type: 'incoming', ncm_category: 'other', document_type: 'invoice', farm_id: null, participant_document: '01352921000186' },
  { id: 3, issue_date: '2025-03-20', invoice_number: 'FP-03', amount: 3500.5, operation_type: 'incoming', ncm_category: 'other', document_type: 'payroll', farm_id: 9, participant_document: '' },
]
const names = new Map([['55566677788', 'Maria Sócia']])

test('gera o LCDPR no leiaute 1.3 e o arquivo passa no validador', () => {
  const result = buildLcdpr({ producer, farms, invoices, settings, accountant, year: '2025', names })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(validateLcdpr(result.text), [])
  const lines = result.text.trimEnd().split('\r\n')
  const rows = lines.map(line => line.split('|'))
  assert.ok(result.text.endsWith('\r\n') && !lines.some(line => line.startsWith('|') || line.endsWith('|')))
  assert.deepEqual(rows[0], ['0000', 'LCDPR', '0013', '11122233344', 'João da Silva', '0', '0', '', '01012025', '31122025'])
  assert.deepEqual(rows[1], ['0010', '1'])
  assert.deepEqual(rows[2], ['0030', 'Rodovia GO 156', 'S/N', 'Km 21', 'Zona Rural', 'GO', '5214051', '76530000', '62999990000', 'joao@exemplo.com'])
  const farmRows = rows.filter(row => row[0] === '0040')
  assert.deepEqual(farmRows[0].slice(0, 8), ['0040', '001', 'BR', 'BRL', '12345678', '12345678901234', '115058400', 'Fazenda Boa Vista'])
  assert.equal(farmRows[0][16], '10000') // 100,00%
  assert.equal(farmRows[1][15], '2')
  assert.equal(farmRows[1][16], '06000') // 60,00%: sempre 5 dígitos, como no manual (05000 = 50%)
  assert.deepEqual(rows.find(row => row[0] === '0045'), ['0045', '002', '1', '55566677788', 'Maria Sócia', '04000'])
  assert.deepEqual(rows.find(row => row[0] === '0050'), ['0050', '001', 'BR', '001', 'Banco do Brasil', '1234', '0000000000567890'])

  const q100 = rows.filter(row => row[0] === 'Q100')
  assert.deepEqual(q100.map(row => row[1]), ['10012025', '04032025', '20032025'])
  assert.deepEqual(q100[0], ['Q100', '10012025', '001', '001', '120522', '1', 'DESPESA DE CUSTEIO E INVESTIMENTO', '01352921000186', '2', '000', '1293615', '1293615', 'N'])
  assert.deepEqual(q100[1].slice(5, 13), ['1', 'VENDA DE BOVINOS', '88203700187', '1', '11200000', '000', '9906385', 'P'])
  // Folha de pagamento sem participante: o manual permite o CPF do próprio produtor.
  assert.deepEqual(q100[2].slice(2, 9), ['002', '001', 'FP-03', '5', 'FOLHA DE PAGAMENTO', '11122233344', '2'])

  const q200 = rows.filter(row => row[0] === 'Q200')
  assert.deepEqual(q200, [['Q200', '012025', '000', '1293615', '1293615', 'N'], ['Q200', '032025', '11200000', '350050', '9556335', 'P']])
  assert.deepEqual(rows.at(-1), ['9999', 'Contabilidade Teste', '12345678000199', 'GO-012345/O', 'contador@exemplo.com', '6232320000', String(lines.length)])
  assert.equal(result.filename, 'LCDPR-11122233344-2025.txt')
})

test('dinheiro em espécie usa a conta 000 e o arquivo continua válido', () => {
  const result = buildLcdpr({ producer, farms, invoices, settings: { ...settings, conta: { ...settings.conta, movimento: '000' } }, accountant, year: '2025', names })
  assert.deepEqual(validateLcdpr(result.text), [])
  assert.ok(result.text.split('\r\n').filter(line => line.startsWith('Q100')).every(line => line.split('|')[3] === '000'))
})

test('aponta o que falta antes de gerar', () => {
  const result = buildLcdpr({ producer: { ...producer, cpf: '123' }, farms, invoices: [...invoices, { ...invoices[0], id: 4, participant_document: '' }], settings: { conta: {}, email: '' }, accountant: {}, year: '2025', names })
  for (const expected of ['CPF válido', 'código IBGE do município do produtor', 'e-mail do produtor', 'conta bancária', 'sem fazenda', 'sem participante', 'NIRF', 'CAEPF']) {
    assert.ok(result.errors.some(error => error.includes(expected)), `faltou o erro: ${expected}\n${result.errors.join('\n')}`)
  }
  assert.ok(result.warnings.some(warning => warning.includes('contador')))
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

  const good = buildLcdpr({ producer, farms, invoices, settings, accountant, year: '2025', names }).text
  const broken = good
    .replace('|0000000000567890', '|56789-0') // conta com hífen
    .replace('|06000\r\n', '|07000\r\n') // participação que não soma 100%
    .replace(/\|\d+\r\n$/, '|99\r\n') // QTD_LIN errado
  const problems = validateLcdpr(broken)
  assert.ok(problems.some(p => p.includes('NUM_CONTA') && p.includes('não são dígitos')))
  assert.ok(problems.some(p => p.includes('soma das participações')))
  assert.ok(problems.some(p => p.includes('QTD_LIN')))
})
