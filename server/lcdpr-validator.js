// Validador estrutural do arquivo do LCDPR, montado a partir da planilha oficial do leiaute 1.3 e do Manual de
// Preenchimento da Receita Federal. Confere quantidade de campos, tipo (N só com dígitos), tamanho, obrigatoriedade,
// valores válidos, ordem dos registros e as conferências entre registros (saldos, totais mensais, participações, QTD_LIN).
// Não substitui a validação da Receita na entrega, mas pega os erros de formato antes.

// [nome, tipo, tamanho máximo (ou lista de tamanhos aceitos), obrigatório, valores válidos]
const F = (name, type, size, required = true, values = null) => ({ name, type, size, required, values })
export const LAYOUT = {
  '0000': [F('REG', 'C', 4), F('NOME_ESC', 'C', 5, true, ['LCDPR']), F('COD_VER', 'C', 4), F('CPF', 'N', [11]), F('NOME', 'C', null), F('IND_SIT_INI_PER', 'N', 1, true, ['0', '1', '2']), F('SIT_ESPECIAL', 'N', 1, true, ['0', '1', '2', '3']), F('DT_SIT_ESP', 'N', [8], false), F('DT_INI', 'N', [8]), F('DT_FIN', 'N', [8])],
  '0010': [F('REG', 'C', 4), F('FORMA_APUR', 'N', 1, true, ['1', '2'])],
  '0030': [F('REG', 'C', 4), F('ENDERECO', 'C', 150), F('NUM', 'C', 6), F('COMPL', 'C', 50, false), F('BAIRRO', 'C', 50), F('UF', 'C', [2]), F('COD_MUN', 'C', [7]), F('CEP', 'C', [8]), F('NUM_TEL', 'N', 15, false), F('EMAIL', 'C', 115)],
  '0040': [F('REG', 'C', 4), F('COD_IMOVEL', 'N', [3]), F('PAIS', 'C', [2]), F('MOEDA', 'C', [3]), F('CAD_ITR', 'N', [8]), F('CAEPF', 'N', [14], false), F('INSCR_ESTADUAL', 'N', 14, false), F('NOME_IMOVEL', 'C', 50), F('ENDERECO', 'C', 150), F('NUM', 'C', 6, false), F('COMPL', 'C', 50, false), F('BAIRRO', 'C', 50), F('UF', 'C', [2]), F('COD_MUN', 'C', [7]), F('CEP', 'C', [8]), F('TIPO_EXPLORACAO', 'N', 1, true, ['1', '2', '3', '4', '5', '6']), F('PARTICIPACAO', 'N', [5])],
  '0045': [F('REG', 'C', 4), F('COD_IMOVEL', 'N', [3]), F('TIPO_CONTRAPARTE', 'N', 1, true, ['1', '2', '3', '4', '5']), F('ID_CONTRAPARTE', 'N', [11, 14]), F('NOME_CONTRAPARTE', 'C', 50), F('PERC_CONTRAPARTE', 'N', [5])],
  '0050': [F('REG', 'C', 4), F('COD_CONTA', 'N', [3]), F('PAIS_CTA', 'C', 3), F('BANCO', 'N', [3]), F('NOME_BANCO', 'C', 30), F('AGENCIA', 'N', 4), F('NUM_CONTA', 'N', 16)],
  'Q100': [F('REG', 'C', 4), F('DATA', 'N', [8]), F('COD_IMOVEL', 'N', [3]), F('COD_CONTA', 'N', [3]), F('NUM_DOC', 'C', null, false), F('TIPO_DOC', 'N', 1, true, ['1', '2', '3', '4', '5', '6']), F('HIST', 'C', null), F('ID_PARTIC', 'N', [11, 14]), F('TIPO_LANC', 'N', 1, true, ['1', '2', '3']), F('VL_ENTRADA', 'N', 19), F('VL_SAIDA', 'N', 19), F('SLD_FIN', 'N', 19), F('NAT_SLD_FIN', 'C', 1, true, ['N', 'P'])],
  'Q200': [F('REG', 'C', 4), F('MES', 'N', [6]), F('VL_ENTRADA', 'N', 19), F('VL_SAIDA', 'N', 19), F('SLD_FIN', 'N', 19), F('NAT_SLD_FIN', 'C', 1, true, ['N', 'P'])],
  '9999': [F('REG', 'C', 4), F('IDENT_NOM', 'C', null, false), F('IDENT_CPF_CNPJ', 'N', [11, 14], false), F('IND_CRC', 'C', null, false), F('EMAIL', 'C', 115, false), F('FONE', 'N', 15, false), F('QTD_LIN', 'N', 30)],
}
const ORDER = ['0000', '0010', '0030', '0040', '0050', 'Q100', 'Q200', '9999'] // 0045 vem logo após o seu 0040

const validDate = value => {
  const [d, m, y] = [value.slice(0, 2), value.slice(2, 4), value.slice(4)].map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}
const signed = (value, nature) => Number(value) * (nature === 'N' ? -1 : 1)

/** Devolve a lista de problemas encontrados (vazia quando o arquivo está de acordo com o leiaute). */
export function validateLcdpr(content, { checkFieldsOnly = false } = {}) {
  const problems = []
  const lines = String(content).split('\r\n')
  if (lines.at(-1) === '') lines.pop()
  if (/[^\r]\n/.test(content)) problems.push('As linhas devem terminar com CR+LF.')
  const records = lines.map((line, index) => ({ line: index + 1, fields: line.split('|') }))

  for (const { line, fields } of records) {
    const spec = LAYOUT[fields[0]]
    if (!spec) { problems.push(`Linha ${line}: registro desconhecido "${fields[0]}".`); continue }
    if (fields.length !== spec.length) { problems.push(`Linha ${line} (${fields[0]}): ${fields.length} campos, o leiaute pede ${spec.length}.`); continue }
    spec.forEach((field, i) => {
      const value = fields[i]
      const where = `Linha ${line} (${fields[0]}.${field.name})`
      if (value === '') { if (field.required) problems.push(`${where}: campo obrigatório vazio.`); return }
      if (value !== value.trim()) problems.push(`${where}: espaços no início ou no fim.`)
      if (field.type === 'N' && !/^\d+$/.test(value)) problems.push(`${where}: campo numérico com caracteres que não são dígitos ("${value}").`)
      if (/[\u0000-\u001f]/.test(value)) problems.push(`${where}: caractere de controle no conteúdo.`)
      if (Array.isArray(field.size) && !field.size.includes(value.length)) problems.push(`${where}: tamanho ${value.length}, esperado ${field.size.join(' ou ')}.`)
      if (typeof field.size === 'number' && value.length > field.size) problems.push(`${where}: tamanho ${value.length}, máximo ${field.size}.`)
      if (field.values && !field.values.includes(value)) problems.push(`${where}: valor "${value}" fora dos valores válidos (${field.values.join(', ')}).`)
      if (['DATA', 'DT_INI', 'DT_FIN', 'DT_SIT_ESP'].includes(field.name) && /^\d{8}$/.test(value) && !validDate(value)) problems.push(`${where}: data inválida (${value}).`)
    })
  }
  if (checkFieldsOnly) return problems

  // Ordem e ocorrência dos registros.
  const types = records.map(record => record.fields[0])
  let position = 0
  types.forEach((type, index) => {
    if (type === '0045') { if (!['0040', '0045'].includes(types[index - 1])) problems.push(`Linha ${index + 1}: o 0045 deve vir logo após o 0040 do imóvel.`); return }
    const at = ORDER.indexOf(type)
    if (at < position) problems.push(`Linha ${index + 1}: registro ${type} fora de ordem.`)
    position = Math.max(position, at)
  })
  for (const [type, min, max] of [['0000', 1, 1], ['0010', 1, 1], ['0030', 1, 1], ['0040', 1, Infinity], ['0050', 1, Infinity], ['Q100', 1, Infinity], ['Q200', 1, Infinity], ['9999', 1, 1]]) {
    const count = types.filter(t => t === type).length
    if (count < min || count > max) problems.push(`Registro ${type}: ${count} ocorrência(s), o leiaute pede ${max === 1 ? 'exatamente 1' : 'ao menos 1'}.`)
  }
  if (types[0] !== '0000') problems.push('O arquivo deve começar pelo registro 0000.')
  if (types.at(-1) !== '9999') problems.push('O arquivo deve terminar com o registro 9999.')

  const byType = type => records.filter(record => record.fields[0] === type).map(record => record.fields)
  const header = byType('0000')[0]
  const closing = byType('9999')[0]
  if (closing && Number(closing[6]) !== records.length) problems.push(`9999.QTD_LIN = ${closing[6]}, mas o arquivo tem ${records.length} linhas.`)

  // Imóveis: código único, terceiros obrigatórios e soma das participações = 100%.
  const farms = byType('0040')
  const farmCodes = new Set(farms.map(f => f[1]))
  if (farmCodes.size !== farms.length) problems.push('Há código de imóvel (0040.COD_IMOVEL) repetido.')
  for (const farm of farms) {
    const thirds = byType('0045').filter(t => t[1] === farm[1])
    const total = Number(farm[16]) + thirds.reduce((sum, t) => sum + Number(t[5]), 0)
    if ((Number(farm[16]) < 10000 || farm[15] !== '1') && !thirds.length) problems.push(`Imóvel ${farm[1]}: participação menor que 100% ou exploração não individual exige registro 0045.`)
    if (thirds.length && total !== 10000) problems.push(`Imóvel ${farm[1]}: a soma das participações (0040 + 0045) é ${(total / 100).toFixed(2)}%, deveria ser 100%.`)
    if (farm[15] === '1' && !farm[5]) problems.push(`Imóvel ${farm[1]}: CAEPF obrigatório na exploração individual.`)
  }
  const accountCodes = new Set([...byType('0050').map(a => a[1]), '000', '999'])

  // Lançamentos: referências, período, saldo acumulado e resumo mensal.
  let balance = 0
  const months = new Map()
  for (const record of records.filter(r => r.fields[0] === 'Q100')) {
    const q = record.fields
    if (!farmCodes.has(q[2]) && q[2] !== '000') problems.push(`Linha ${record.line}: Q100.COD_IMOVEL ${q[2]} não existe no 0040.`)
    if (!accountCodes.has(q[3])) problems.push(`Linha ${record.line}: Q100.COD_CONTA ${q[3]} não existe no 0050 (nem é 000/999).`)
    if (header && /^\d{8}$/.test(q[1])) {
      const iso = d => `${d.slice(4)}${d.slice(2, 4)}${d.slice(0, 2)}`
      if (iso(q[1]) < iso(header[8]) || iso(q[1]) > iso(header[9])) problems.push(`Linha ${record.line}: data ${q[1]} fora do período do arquivo.`)
    }
    if (Number(q[9]) && Number(q[10])) problems.push(`Linha ${record.line}: Q100 com entrada e saída no mesmo lançamento.`)
    if (q[8] === '1' && Number(q[10])) problems.push(`Linha ${record.line}: receita (TIPO_LANC 1) lançada como saída.`)
    if (q[8] === '2' && Number(q[9])) problems.push(`Linha ${record.line}: despesa (TIPO_LANC 2) lançada como entrada.`)
    balance += Number(q[9]) - Number(q[10])
    if (signed(q[11], q[12]) !== balance) problems.push(`Linha ${record.line}: SLD_FIN ${q[12] === 'N' ? '-' : ''}${q[11]} não confere com o saldo acumulado (${balance}).`)
    const key = q[1].slice(2, 8)
    const month = months.get(key) || { in: 0, out: 0 }
    month.in += Number(q[9]); month.out += Number(q[10])
    months.set(key, month)
  }
  let running = 0
  const summaries = byType('Q200')
  for (const q of summaries) {
    const month = months.get(q[1])
    if (!month) { problems.push(`Q200 do mês ${q[1]} sem lançamentos no Q100.`); continue }
    running += month.in - month.out
    if (Number(q[2]) !== month.in || Number(q[3]) !== month.out) problems.push(`Q200 ${q[1]}: totais não conferem com os lançamentos do mês.`)
    if (signed(q[4], q[5]) !== running) problems.push(`Q200 ${q[1]}: saldo final não confere com o acumulado (${running}).`)
  }
  for (const key of months.keys()) if (!summaries.some(q => q[1] === key)) problems.push(`Falta o Q200 do mês ${key}.`)
  return problems
}
