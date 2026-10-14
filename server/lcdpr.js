// Geração do arquivo do LCDPR (Livro Caixa Digital do Produtor Rural), layout 1.3 da Receita Federal.
// Registros: 0000 abertura, 0010 forma de apuração, 0030 dados cadastrais, 0040 imóveis, 0045 terceiros do imóvel,
// 0050 contas bancárias, Q100 lançamentos, Q200 resumo mensal e 9999 encerramento.
// Campos separados por "|", valores com duas casas decimais implícitas (R$ 1.520,75 -> 152075) e datas ddmmaaaa.
export const LCDPR_LAYOUT_VERSION = '0013'

const digits = value => String(value ?? '').replace(/\D/g, '')
const clean = (value, max = 255) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const cents = value => String(Math.round(Math.abs(Number(value || 0)) * 100))
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
// Tipo de exploração do imóvel (0040) -> tipo da contraparte (0045).
const counterpartTypes = { '2': '1', '3': '2', '4': '3', '5': '4' }

export const defaultProducerSettings = {
  forma_apuracao: '1', situacao_inicio: '0', situacao_especial: '0', data_situacao_especial: '',
  uf: 'GO', cod_mun: '', telefone: '', email: '',
  conta: { banco: '', nome_banco: '', agencia: '', numero: '' },
  imovel_padrao: '', imoveis: {},
}
export const defaultFarmSettings = { cad_itr: '', caepf: '', uf: 'GO', cod_mun: '', tipo_exploracao: '1', participacao: '' }
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
  if (digits(s.conta.banco).length !== 3 || !digits(s.conta.agencia) || !clean(s.conta.numero)) errors.push('Informe a conta bancária do produtor (banco com 3 dígitos, agência e número da conta).')
  if (!clean(a.nome) || ![11, 14].includes(digits(a.documento).length)) errors.push('Informe o nome e o CPF/CNPJ do contador ou responsável pela escrituração.')

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
  const noParticipant = invoices.filter(invoice => ![11, 14].includes(digits(invoice.participant_document).length))
  if (noParticipant.length) warnings.push(`${noParticipant.length} lançamento(s) sem participante (CPF/CNPJ) vão sem identificação.`)
  if (!invoices.length) warnings.push('Não há lançamentos no ano escolhido.')

  const lines = []
  const add = (...fields) => lines.push(fields.map(field => clean(field)).join('|'))
  add('0000', 'LCDPR', LCDPR_LAYOUT_VERSION, cpf, clean(producer.name, 150), s.situacao_inicio, s.situacao_especial, s.situacao_especial !== '0' ? date(s.data_situacao_especial) : '', `0101${year}`, `3112${year}`)
  add('0010', s.forma_apuracao)
  add('0030', producer.address, producer.address_number, producer.complement, producer.neighborhood, String(s.uf).toUpperCase(), digits(s.cod_mun), digits(producer.zip_code), digits(s.telefone), s.email)

  for (const farm of exportedFarms) {
    const farmSettings = { ...defaultFarmSettings, tipo_exploracao: farm.ownership_type === 'shared' ? '2' : '1', ...(s.imoveis[farm.id] || {}) }
    farmSettings.uf = farmSettings.uf || s.uf
    const partners = farm.ownership_type === 'shared' ? farm.partners || [] : []
    const share = farmSettings.participacao !== '' && farmSettings.participacao != null ? Number(farmSettings.participacao) : 100 - partners.reduce((sum, partner) => sum + Number(partner.share || 0), 0)
    if (digits(farmSettings.cod_mun).length !== 7) errors.push(`Informe o código IBGE do município da fazenda ${farm.name}.`)
    if (!digits(farmSettings.cad_itr)) warnings.push(`A fazenda ${farm.name} está sem NIRF (CAD_ITR).`)
    if (!(share > 0 && share <= 100)) errors.push(`A participação do produtor na fazenda ${farm.name} deve ficar entre 0 e 100%.`)
    add('0040', farmCode.get(farm.id), 'BR', 'BRL', digits(farmSettings.cad_itr), digits(farmSettings.caepf), digits(farm.state_registration), clean(farm.name, 50), farm.address, farm.address_number, farm.complement, farm.neighborhood, String(farmSettings.uf).toUpperCase(), digits(farmSettings.cod_mun), digits(farm.zip_code), farmSettings.tipo_exploracao, cents(share))
    for (const partner of partners) {
      const name = names.get(digits(partner.document))
      if (!name) warnings.push(`O sócio ${partner.document} da fazenda ${farm.name} não está cadastrado como participante: o nome irá em branco.`)
      add('0045', farmCode.get(farm.id), counterpartTypes[farmSettings.tipo_exploracao] || '5', digits(partner.document), name || '', cents(partner.share))
    }
  }
  add('0050', '001', 'BR', digits(s.conta.banco), s.conta.nome_banco, digits(s.conta.agencia), s.conta.numero)

  const sorted = [...invoices].sort((x, y) => String(x.issue_date).localeCompare(String(y.issue_date)) || x.id - y.id)
  let balance = 0
  const months = Array.from({ length: 12 }, () => ({ entrada: 0, saida: 0, saldo: 0 }))
  for (const invoice of sorted) {
    const amount = Number(invoice.amount || 0)
    const revenue = invoice.operation_type === 'outgoing'
    balance += revenue ? amount : -amount
    const month = months[Number(String(invoice.issue_date).slice(5, 7)) - 1]
    if (month) { month[revenue ? 'entrada' : 'saida'] += amount }
    const type = invoice.document_type || 'invoice'
    const history = documentNames[type] || (histories[invoice.ncm_category] || histories.other)[revenue ? 'outgoing' : 'incoming']
    add('Q100', date(invoice.issue_date), farmCode.get(farmOf(invoice)?.id) || '', '001', invoice.invoice_number, documentTypes[type] || '6', history, digits(invoice.participant_document), revenue ? '1' : '2', revenue ? cents(amount) : '0', revenue ? '0' : cents(amount), cents(balance), nature(balance))
  }
  let running = 0
  months.forEach((month, index) => {
    running += month.entrada - month.saida
    add('Q200', `${String(index + 1).padStart(2, '0')}${year}`, cents(month.entrada), cents(month.saida), cents(running), nature(running))
  })
  add('9999', a.nome, digits(a.documento), a.crc, a.email, digits(a.telefone), String(lines.length + 1))

  const totals = sorted.reduce((sum, invoice) => { sum[invoice.operation_type === 'outgoing' ? 'revenue' : 'expenses'] += Number(invoice.amount || 0); return sum }, { revenue: 0, expenses: 0 })
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], text: lines.join('\r\n') + '\r\n', filename: `LCDPR-${cpf}-${year}.txt`, summary: { entries: sorted.length, farms: exportedFarms.length, ...totals } }
}
