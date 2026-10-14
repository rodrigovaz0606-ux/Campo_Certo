import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLcdpr } from './lcdpr.js'

const producer = { id: 1, name: 'João da Silva', cpf: '11122233344', address: 'Rodovia GO 156', address_number: 'S/N', complement: 'Km 21', neighborhood: 'Zona Rural', zip_code: '76530000' }
const farms = [
  { id: 7, name: 'Fazenda Boa Vista', state_registration: '115058400', address: 'Rodovia GO 156', address_number: 'S/N', complement: '', neighborhood: 'Zona Rural', zip_code: '76530000', ownership_type: 'unique', partners: [] },
  { id: 9, name: 'Fazenda Sócios', state_registration: '115058401', address: 'Estrada', address_number: '1', complement: '', neighborhood: 'Rural', zip_code: '76530000', ownership_type: 'shared', partners: [{ document: '55566677788', share: 40 }] },
]
const settings = {
  uf: 'GO', cod_mun: '5214051', telefone: '(62) 99999-0000', email: 'joao@exemplo.com',
  conta: { banco: '001', nome_banco: 'Banco do Brasil', agencia: '1234', numero: '56789-0' },
  imovel_padrao: '7',
  imoveis: { 7: { cad_itr: '12345678', cod_mun: '5214051' }, 9: { cad_itr: '87654321', cod_mun: '5214051', tipo_exploracao: '2' } },
}
const accountant = { nome: 'Contabilidade Teste', documento: '12345678000199', crc: 'GO-012345/O', email: 'contador@exemplo.com', telefone: '6232320000' }
const invoices = [
  { id: 1, issue_date: '2025-03-04', invoice_number: '27111523', amount: 112000, operation_type: 'outgoing', ncm_category: 'cattle', document_type: 'invoice', farm_id: 7, participant_document: '88203700187' },
  { id: 2, issue_date: '2025-01-10', invoice_number: '120522', amount: 12936.15, operation_type: 'incoming', ncm_category: 'other', document_type: 'invoice', farm_id: null, participant_document: '01352921000186' },
  { id: 3, issue_date: '2025-03-20', invoice_number: 'FP-03', amount: 3500.5, operation_type: 'incoming', ncm_category: 'other', document_type: 'payroll', farm_id: 9, participant_document: '' },
]
const names = new Map([['55566677788', 'Maria Sócia']])

test('gera o LCDPR com registros, saldos e totais corretos', () => {
  const result = buildLcdpr({ producer, farms, invoices, settings, accountant, year: '2025', names })
  assert.deepEqual(result.errors, [])
  const lines = result.text.trimEnd().split('\r\n')
  const rows = lines.map(line => line.split('|'))
  assert.deepEqual(rows[0], ['0000', 'LCDPR', '0013', '11122233344', 'Joao da Silva', '0', '0', '', '01012025', '31122025'])
  assert.deepEqual(rows[1], ['0010', '1'])
  assert.deepEqual(rows[2], ['0030', 'Rodovia GO 156', 'S/N', 'Km 21', 'Zona Rural', 'GO', '5214051', '76530000', '62999990000', 'joao@exemplo.com'])
  const farmRows = rows.filter(row => row[0] === '0040')
  assert.equal(farmRows.length, 2)
  assert.deepEqual(farmRows[0].slice(0, 8), ['0040', '001', 'BR', 'BRL', '12345678', '', '115058400', 'Fazenda Boa Vista'])
  assert.equal(farmRows[0][16], '10000') // 100,00% para propriedade única
  assert.equal(farmRows[1][15], '2')
  assert.equal(farmRows[1][16], '6000') // 100% - 40% do sócio
  assert.deepEqual(rows.find(row => row[0] === '0045'), ['0045', '002', '1', '55566677788', 'Maria Socia', '4000'])
  assert.deepEqual(rows.find(row => row[0] === '0050'), ['0050', '001', 'BR', '001', 'Banco do Brasil', '1234', '56789-0'])

  const q100 = rows.filter(row => row[0] === 'Q100')
  assert.deepEqual(q100.map(row => row[1]), ['10012025', '04032025', '20032025']) // ordenado por data
  assert.deepEqual(q100[0], ['Q100', '10012025', '001', '001', '120522', '1', 'DESPESA DE CUSTEIO E INVESTIMENTO', '01352921000186', '2', '0', '1293615', '1293615', 'N'])
  assert.deepEqual(q100[1].slice(5, 13), ['1', 'VENDA DE BOVINOS', '88203700187', '1', '11200000', '0', '9906385', 'P'])
  assert.deepEqual(q100[2].slice(2, 9), ['002', '001', 'FP-03', '5', 'FOLHA DE PAGAMENTO', '', '2'])

  const q200 = rows.filter(row => row[0] === 'Q200')
  assert.equal(q200.length, 12)
  assert.deepEqual(q200[0], ['Q200', '012025', '0', '1293615', '1293615', 'N'])
  assert.deepEqual(q200[2], ['Q200', '032025', '11200000', '350050', '9556335', 'P'])
  assert.deepEqual(q200[11].slice(4), ['9556335', 'P'])

  const last = rows.at(-1)
  assert.deepEqual(last, ['9999', 'Contabilidade Teste', '12345678000199', 'GO-012345/O', 'contador@exemplo.com', '6232320000', String(lines.length)])
  assert.equal(result.filename, 'LCDPR-11122233344-2025.txt')
  assert.ok(result.warnings.some(warning => warning.includes('sem participante')))
  assert.ok(!/[^\x20-\x7e\r\n]/.test(result.text), 'arquivo só com caracteres ASCII')
})

test('aponta o que falta antes de gerar', () => {
  const result = buildLcdpr({ producer: { ...producer, cpf: '123' }, farms, invoices, settings: { conta: {} }, accountant: {}, year: '2025', names })
  assert.ok(result.errors.some(error => error.includes('CPF')))
  assert.ok(result.errors.some(error => error.includes('código IBGE do município do produtor')))
  assert.ok(result.errors.some(error => error.includes('conta bancária')))
  assert.ok(result.errors.some(error => error.includes('contador')))
  assert.ok(result.errors.some(error => error.includes('sem fazenda')))
})
