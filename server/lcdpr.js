// Geração do arquivo do LCDPR (Livro Caixa Digital do Produtor Rural), leiaute 1.3 da Receita Federal
// (ADE Copes nº 1/2020, conferido com a planilha oficial do leiaute e o Manual de Preenchimento).
// Registros: 0000 abertura, 0010 forma de apuração, 0030 dados cadastrais, 0040 imóveis, 0045 terceiros do imóvel,
// 0050 contas bancárias, Q100 lançamentos, Q200 resumo mensal e 9999 encerramento.
// Regras do manual: texto UTF-8; campos separados por "|", sem "|" no início nem no fim da linha; linhas terminadas em CR+LF;
// números sem separadores, com as casas decimais implícitas e fixas (R$ 1.520,75 -> 152075; zero -> 000; 50% -> 05000);
// datas ddmmaaaa.
export const LCDPR_LAYOUT_VERSION = '0013'

const digits = value => String(value ?? '').replace(/\D/g, '')
// Texto livre: o manual aceita acentos (UTF-8); só não pode haver "|" nem caracteres de controle.
const text = (value, max) => { const s = String(value ?? '').replace(/[|\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim(); return max ? s.slice(0, max) : s }
// Valor com 2 casas decimais implícitas; o zero é "000" e o tamanho mínimo pode ser fixado (percentuais: 5 dígitos).
const decimal2 = (value, width = 3) => String(Math.round(Math.abs(Number(value || 0)) * 100)).padStart(width, '0')
const percent = value => decimal2(value, 5)
const date = iso => { const [y, m, d] = String(iso || '').slice(0, 10).split('-'); return d && m && y ? `${d}${m}${y}` : '' }
const code3 = index => String(index).padStart(3, '0')
const nature = value => value < 0 ? 'N' : 'P'

const documentTypes = { invoice: '1', contract: '4', payroll: '5' }
const histories = {
  cattle: { outgoing: 'VENDA DE BOVINOS', incoming: 'COMPRA DE BOVINOS' },
  soy: { outgoing: 'VENDA DE SOJA', incoming: 'COMPRA DE INSUMOS/SOJA' },
  other: { outgoing: 'RECEITA DA ATIVIDADE RURAL', incoming: 'DESPESA DE CUSTEIO E INVESTIMENTO' },
}
const documentNames = { payroll: 'FOLHA DE PAGAMENTO', contract: 'CONTRATO' }
// Tipo de exploração do imóvel (0040) -> tipo da contraparte (0045): condômino, arrendador, parceiro, comodante, outros.
const counterpartTypes = { '2': '1', '3': '2', '4': '3', '5': '4', '6': '5' }
// Conta dos lançamentos (Q100.COD_CONTA): a conta do 0050, dinheiro em espécie ou numerário em trânsito.
export const ACCOUNT_MODES = ['001', '000', '999']

export const defaultProducerSettings = {
  forma_apuracao: '1', situacao_inicio: '0', situacao_especial: '0', data_situacao_especial: '',
  uf: 'GO', cod_mun: '', telefone: '', email: '',
  conta: { banco: '', nome_banco: '', agencia: '', numero: '', movimento: '001' },
  imovel_padrao: '', imoveis: {},
}
export const defaultFarmSettings = { cad_itr: '', caepf: '', uf: 'GO', cod_mun: '', tipo_exploracao: '1', participacao: '', terceiro_doc: '', terceiro_nome: '', terceiro_perc: '' }
export const defaultAccountant = { nome: '', documento: '', crc: '', email: '', telefone: '' }

export function mergeSettings(saved = {}) {
  return { ...defaultProducerSettings, ...saved, conta: { ...defaultProducerSettings.conta, ...(saved.conta || {}) }, imoveis: { ...(saved.imoveis || {}) } }
}

/**
 * Monta o arquivo. Não lança erro: devolve `errors` (impedem a geração) e `warnings` (conferir antes de transmitir).
 * producer: linha de producers; farms: fazendas do produtor (com partners [{document, share}]);
 * invoices: lançamentos do ano; names: Map documento -> nome (participantes/produtores).
 */
export function buildLcdpr({ producer, farms, invoices, settings, accountant, year, names = new Map() }) {
  const s = mergeSettings(settings)
  const a = { ...defaultAccountant, ...(accountant || {}) }
  const errors = [], warnings = []
  const cpf = digits(producer.cpf)
  if (cpf.length !== 11) errors.push('O produtor precisa ter um CPF válido.')
  if (!/^[A-Z]{2}$/.test(String(s.uf).toUpperCase())) errors.push('Informe a UF do endereço do produtor.')
  if (digits(s.cod_mun).length !== 7) errors.push('Informe o código IBGE do município do produtor (7 dígitos).')
  if (!text(s.email)) errors.push('Informe o e-mail do produtor (obrigatório no registro 0030).')
  if (!text(producer.address) || !text(producer.neighborhood) || digits(producer.zip_code).length !== 8) errors.push('O cadastro do produtor precisa de endereço, bairro e CEP.')
  const agency = digits(s.conta.agencia), account = digits(s.conta.numero)
  if (digits(s.conta.banco).length !== 3 || !text(s.conta.nome_banco) || !agency || agency.length > 4 || !account || account.length > 16) errors.push('Informe a conta bancária do produtor: banco com 3 dígitos, nome do banco, agência sem dígito (até 4 números) e conta com dígito (até 16 números).')
  const accountCode = ACCOUNT_MODES.includes(s.conta.movimento) ? s.conta.movimento : '001'
  // O contador é opcional no leiaute, mas se o CPF/CNPJ for informado precisa ser válido.
  if (digits(a.documento) && ![11, 14].includes(digits(a.documento).length)) errors.push('O CPF/CNPJ do contador está incompleto.')
  if (!text(a.nome)) warnings.push('O contador não foi informado (é opcional no leiaute, mas costuma ser preenchido).')

  // Lançamentos sem fazenda vão para o imóvel padrão escolhido.
  const defaultFarm = farms.find(farm => String(farm.id) === String(s.imovel_padrao))
  const withoutFarm = invoices.filter(invoice => !farms.some(farm => farm.id === invoice.farm_id))
  if (withoutFarm.length && !defaultFarm) errors.push(`${withoutFarm.length} lançamento(s) sem fazenda: escolha o imóvel padrão para eles ou vincule a fazenda na Conferência.`)
  const farmOf = invoice => farms.find(farm => farm.id === invoice.farm_id) || defaultFarm
  const usedFarms = farms.filter(farm => invoices.some(invoice => farmOf(invoice)?.id === farm.id))
  const exportedFarms = usedFarms.length ? usedFarms : (defaultFarm ? [defaultFarm] : farms.slice(0, 1))
  if (!exportedFarms.length) errors.push('Cadastre ao menos uma fazenda para o produtor.')
  const farmCode = new Map(exportedFarms.map((farm, index) => [farm.id, code3(index + 1)]))

  const missingDate = invoices.filter(invoice => !date(invoice.issue_date))
  if (missingDate.length) errors.push(`${missingDate.length} lançamento(s) sem data.`)
  // ID_PARTIC é obrigatório. Na folha de pagamento o manual permite usar o CPF do próprio produtor.
  const participantOf = invoice => { const doc = digits(invoice.participant_document); return [11, 14].includes(doc.length) ? doc : invoice.document_type === 'payroll' ? cpf : '' }
  const noParticipant = invoices.filter(invoice => !participantOf(invoice))
  if (noParticipant.length) errors.push(`${noParticipant.length} lançamento(s) sem participante (CPF/CNPJ), que é obrigatório: informe o participante na Conferência.`)
  if (!invoices.length) warnings.push('Não há lançamentos no ano escolhido.')

  const lines = []
  const add = (...fields) => lines.push(fields.map(field => text(field)).join('|'))
  add('0000', 'LCDPR', LCDPR_LAYOUT_VERSION, cpf, text(producer.name), s.situacao_inicio, s.situacao_especial, s.situacao_especial !== '0' ? date(s.data_situacao_especial) : '', `0101${year}`, `3112${year}`)
  add('0010', s.forma_apuracao)
  add('0030', text(producer.address, 150), text(producer.address_number || 'S/N', 6), text(producer.complement, 50), text(producer.neighborhood, 50), String(s.uf).toUpperCase(), digits(s.cod_mun), digits(producer.zip_code), digits(s.telefone).slice(0, 15), text(s.email, 115))

  for (const farm of exportedFarms) {
    const fs = { ...defaultFarmSettings, tipo_exploracao: farm.ownership_type === 'shared' ? '2' : '1', ...(s.imoveis[farm.id] || {}) }
    fs.uf = fs.uf || s.uf
    const partners = farm.ownership_type === 'shared' ? (farm.partners || []).map(partner => ({ document: digits(partner.document), share: Number(partner.share || 0), name: names.get(digits(partner.document)) })) : []
    if (digits(fs.terceiro_doc)) partners.push({ document: digits(fs.terceiro_doc), share: Number(fs.terceiro_perc || 0), name: text(fs.terceiro_nome) || names.get(digits(fs.terceiro_doc)) })
    const share = fs.participacao !== '' && fs.participacao != null ? Number(String(fs.participacao).replace(',', '.')) : 100 - partners.reduce((sum, partner) => sum + partner.share, 0)
    if (digits(fs.cod_mun).length !== 7) errors.push(`Informe o código IBGE do município da fazenda ${farm.name}.`)
    if (digits(fs.cad_itr).length !== 8) errors.push(`Informe o NIRF/CAFIR (CAD_ITR, 8 dígitos com DV) da fazenda ${farm.name}.`)
    if (fs.tipo_exploracao === '1' && digits(fs.caepf).length !== 14) errors.push(`Informe o CAEPF (14 dígitos) da fazenda ${farm.name}: é obrigatório na exploração individual.`)
    else if (digits(fs.caepf) && digits(fs.caepf).length !== 14) errors.push(`O CAEPF da fazenda ${farm.name} deve ter 14 dígitos.`)
    if (!text(farm.address) || !text(farm.neighborhood) || digits(farm.zip_code).length !== 8) errors.push(`O cadastro da fazenda ${farm.name} precisa de endereço, bairro e CEP.`)
    if (!(share > 0 && share <= 100)) errors.push(`A participação do produtor na fazenda ${farm.name} deve ficar entre 0 e 100%.`)
    // 0045 é obrigatório quando a participação é menor que 100% ou a exploração não é individual.
    if ((share < 100 || fs.tipo_exploracao !== '1') && !partners.length) errors.push(`A fazenda ${farm.name} é explorada com terceiros: informe o condômino/arrendador/parceiro (CPF/CNPJ, nome e %).`)
    add('0040', farmCode.get(farm.id), 'BR', 'BRL', digits(fs.cad_itr), digits(fs.caepf), digits(farm.state_registration), text(farm.name, 50), text(farm.address, 150), text(farm.address_number, 6), text(farm.complement, 50), text(farm.neighborhood, 50), String(fs.uf).toUpperCase(), digits(fs.cod_mun), digits(farm.zip_code), fs.tipo_exploracao, percent(share))
    for (const partner of partners) {
      if (!partner.name) errors.push(`Informe o nome do terceiro ${partner.document} da fazenda ${farm.name} (cadastre-o em Participantes).`)
      if (![11, 14].includes(partner.document.length)) errors.push(`O CPF/CNPJ do terceiro da fazenda ${farm.name} está incompleto.`)
      add('0045', farmCode.get(farm.id), counterpartTypes[fs.tipo_exploracao] || '5', partner.document, text(partner.name, 50), percent(partner.share))
    }
  }
  add('0050', '001', 'BR', digits(s.conta.banco), text(s.conta.nome_banco, 30), agency.padStart(4, '0'), account.padStart(16, '0'))

  const sorted = [...invoices].sort((x, y) => String(x.issue_date).localeCompare(String(y.issue_date)) || x.id - y.id)
  let balance = 0
  const months = new Map()
  for (const invoice of sorted) {
    const amount = Number(invoice.amount || 0)
    const revenue = invoice.operation_type === 'outgoing'
    balance += revenue ? amount : -amount
    const key = String(invoice.issue_date).slice(0, 7)
    const month = months.get(key) || { entrada: 0, saida: 0 }
    month[revenue ? 'entrada' : 'saida'] += amount
    months.set(key, month)
    const type = invoice.document_type || 'invoice'
    const history = documentNames[type] || (histories[invoice.ncm_category] || histories.other)[revenue ? 'outgoing' : 'incoming']
    add('Q100', date(invoice.issue_date), farmCode.get(farmOf(invoice)?.id) || '', accountCode, text(invoice.invoice_number), documentTypes[type] || '6', history, participantOf(invoice), revenue ? '1' : '2', revenue ? decimal2(amount) : '000', revenue ? '000' : decimal2(amount), decimal2(balance), nature(balance))
  }
  // Q200: um registro por mês com lançamentos; o saldo é acumulado desde janeiro.
  let running = 0
  for (const [key, month] of [...months].sort(([x], [y]) => x.localeCompare(y))) {
    running += month.entrada - month.saida
    add('Q200', `${key.slice(5, 7)}${key.slice(0, 4)}`, decimal2(month.entrada), decimal2(month.saida), decimal2(running), nature(running))
  }
  add('9999', text(a.nome), digits(a.documento), text(a.crc), text(a.email, 115), digits(a.telefone).slice(0, 15), String(lines.length + 1))

  const totals = sorted.reduce((sum, invoice) => { sum[invoice.operation_type === 'outgoing' ? 'revenue' : 'expenses'] += Number(invoice.amount || 0); return sum }, { revenue: 0, expenses: 0 })
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], text: lines.join('\r\n') + '\r\n', filename: `LCDPR-${cpf}-${year}.txt`, summary: { entries: sorted.length, farms: exportedFarms.length, ...totals } }
}
