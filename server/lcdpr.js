// Geração do arquivo do LCDPR (Livro Caixa Digital do Produtor Rural), leiaute 1.3 da Receita Federal
// (ADE Copes nº 1/2020, conferido com a planilha oficial do leiaute e o Manual de Preenchimento), no mesmo
// modelo dos arquivos que o escritório já entrega: período livre, propriedades escolhidas, conta caixa,
// NIRF/CAEPF do cadastro da fazenda (zerados quando não houver) e lançamentos agrupados por imóvel.
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
const fallbackHistories = {
  cattle: { outgoing: 'Venda de bovinos', incoming: 'Compra de bovinos' },
  soy: { outgoing: 'Venda de soja', incoming: 'Compra de insumos' },
  fuel: { outgoing: 'Venda de combustível', incoming: 'Compra de combustível' },
  other: { outgoing: 'Receita da atividade rural', incoming: 'Despesa de custeio e investimento' },
}
// Tipo de exploração do imóvel (0040) -> tipo da contraparte (0045): condômino, arrendador, parceiro, comodante, outros.
const counterpartTypes = { '2': '1', '3': '2', '4': '3', '5': '4', '6': '5' }

export const defaultProducerSettings = {
  forma_apuracao: '1', situacao_inicio: '0', situacao_especial: '0', data_situacao_especial: '',
  uf: 'GO', cod_mun: '', telefone: '', email: '',
  // tipo 'caixa': conta caixa (0050|000|BRA|000|CONTA CAIXA|000|000), como o escritório usa; 'banco': conta bancária.
  conta: { tipo: 'caixa', banco: '', nome_banco: '', agencia: '', numero: '', movimento: '001' },
  imovel_padrao: '', imoveis: {},
}
export const defaultAccountant = { nome: '', documento: '', crc: '', email: '', telefone: '' }

export function mergeSettings(saved = {}) {
  return { ...defaultProducerSettings, ...saved, conta: { ...defaultProducerSettings.conta, ...(saved.conta || {}) }, imoveis: { ...(saved.imoveis || {}) } }
}

/** Dados do imóvel para o 0040: cadastro da fazenda primeiro; o que estiver salvo no LCDPR completa. */
export function farmLcdpr(farm, settings, names = new Map()) {
  const saved = settings.imoveis?.[farm.id] || {}
  const partners = farm.ownership_type === 'shared' ? (farm.partners || []).map(partner => ({ document: digits(partner.document), share: Number(partner.share || 0), name: names.get(digits(partner.document)) })) : []
  if (digits(saved.terceiro_doc)) partners.push({ document: digits(saved.terceiro_doc), share: Number(String(saved.terceiro_perc || 0).replace(',', '.')), name: text(saved.terceiro_nome) || names.get(digits(saved.terceiro_doc)) })
  const share = saved.participacao !== undefined && saved.participacao !== '' ? Number(String(saved.participacao).replace(',', '.')) : 100 - partners.reduce((sum, partner) => sum + partner.share, 0)
  return {
    nirf: digits(farm.nirf) || digits(saved.cad_itr) || '00000000',
    caepf: digits(farm.caepf) || digits(saved.caepf) || '00000000000000',
    uf: String(farm.uf || saved.uf || settings.uf || '').toUpperCase(),
    cityCode: digits(farm.city_code) || digits(saved.cod_mun),
    exploration: farm.exploration_type || saved.tipo_exploracao || (farm.ownership_type === 'shared' ? '4' : '1'),
    share, partners,
  }
}

/**
 * Monta o arquivo. Não lança erro: devolve `errors` (impedem a geração) e `warnings` (conferir antes de transmitir).
 * producer: linha de producers; farms: propriedades escolhidas (com partners e os dados fiscais do cadastro);
 * invoices: lançamentos do período (com participant_document e participant_name); period: { from, to } em aaaa-mm-dd.
 */
export function buildLcdpr({ producer, farms, invoices, settings, accountant, period, names = new Map() }) {
  const s = mergeSettings(settings)
  const a = { ...defaultAccountant, ...(accountant || {}) }
  const errors = [], warnings = []
  const cpf = digits(producer.cpf)
  const from = String(period?.from || ''), to = String(period?.to || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) errors.push('Informe a data inicial e a data final do período.')
  if (cpf.length !== 11) errors.push('O produtor precisa ter um CPF válido.')
  if (!/^[A-Z]{2}$/.test(String(s.uf).toUpperCase())) errors.push('Informe a UF do endereço do produtor.')
  if (digits(s.cod_mun).length !== 7) errors.push('Informe o código IBGE do município do produtor (7 dígitos).')
  if (!text(s.email)) errors.push('Informe o e-mail do registro 0030 (obrigatório no LCDPR).')
  if (!text(producer.address) || !text(producer.neighborhood) || digits(producer.zip_code).length !== 8) errors.push('O cadastro do produtor precisa de endereço, bairro e CEP.')
  const bank = s.conta.tipo === 'banco'
  const agency = digits(s.conta.agencia), account = digits(s.conta.numero)
  if (bank && (digits(s.conta.banco).length !== 3 || !text(s.conta.nome_banco) || !agency || agency.length > 4 || !account || account.length > 16)) errors.push('Informe a conta bancária: banco com 3 dígitos, nome do banco, agência sem dígito (até 4 números) e conta com dígito (até 16 números).')
  const accountCode = bank ? (['001', '999'].includes(s.conta.movimento) ? s.conta.movimento : '001') : '000'
  if (digits(a.documento) && ![11, 14].includes(digits(a.documento).length)) errors.push('O CPF/CNPJ do contador está incompleto.')
  if (!text(a.nome)) warnings.push('O contador não foi informado (é opcional no leiaute, mas costuma ser preenchido).')

  if (!farms.length) errors.push('Escolha ao menos uma propriedade.')
  // Lançamentos sem fazenda (ou de fazenda fora da seleção) vão para o imóvel padrão, se houver.
  const defaultFarm = farms.find(farm => String(farm.id) === String(s.imovel_padrao)) || (farms.length === 1 ? farms[0] : null)
  const farmOf = invoice => farms.find(farm => farm.id === invoice.farm_id) || defaultFarm
  const orphans = invoices.filter(invoice => !farmOf(invoice))
  if (orphans.length) errors.push(`${orphans.length} lançamento(s) sem fazenda: escolha o imóvel padrão para eles ou vincule a fazenda na Conferência.`)
  const farmCode = new Map(farms.map((farm, index) => [farm.id, code3(index + 1)]))

  const missingDate = invoices.filter(invoice => !date(invoice.issue_date))
  if (missingDate.length) errors.push(`${missingDate.length} lançamento(s) sem data.`)
  // ID_PARTIC é obrigatório. Na folha de pagamento o manual permite usar o CPF do próprio produtor.
  const participantOf = invoice => { const doc = digits(invoice.participant_document); return [11, 14].includes(doc.length) ? doc : invoice.document_type === 'payroll' ? cpf : '' }
  const noParticipant = invoices.filter(invoice => !participantOf(invoice))
  if (noParticipant.length) errors.push(`${noParticipant.length} lançamento(s) sem participante (CPF/CNPJ), que é obrigatório: informe o participante na Conferência.`)
  if (!invoices.length) warnings.push('Não há lançamentos no período escolhido.')

  const lines = []
  const add = (...fields) => lines.push(fields.map(field => text(field)).join('|'))
  add('0000', 'LCDPR', LCDPR_LAYOUT_VERSION, cpf, text(producer.name), s.situacao_inicio, s.situacao_especial, s.situacao_especial !== '0' ? date(s.data_situacao_especial) : '', date(from), date(to))
  add('0010', s.forma_apuracao)
  add('0030', text(producer.address, 150), text(producer.address_number || 'S/N', 6), text(producer.complement, 50), text(producer.neighborhood, 50), String(s.uf).toUpperCase(), digits(s.cod_mun), digits(producer.zip_code), digits(s.telefone).slice(0, 15), text(s.email, 115))

  const farmInfo = new Map()
  for (const farm of farms) {
    const f = farmLcdpr(farm, s, names)
    farmInfo.set(farm.id, f)
    if (f.cityCode.length !== 7) errors.push(`Informe o município (código IBGE) da fazenda ${farm.name} no cadastro da fazenda.`)
    if (!/^[A-Z]{2}$/.test(f.uf)) errors.push(`Informe a UF da fazenda ${farm.name} no cadastro da fazenda.`)
    if (f.nirf.length !== 8) errors.push(`O NIRF da fazenda ${farm.name} deve ter 8 dígitos.`)
    if (f.caepf.length !== 14) errors.push(`O CAEPF da fazenda ${farm.name} deve ter 14 dígitos.`)
    if (!text(farm.address) || !text(farm.neighborhood) || digits(farm.zip_code).length !== 8) errors.push(`O cadastro da fazenda ${farm.name} precisa de endereço, bairro e CEP.`)
    if (!(f.share > 0 && f.share <= 100)) errors.push(`A participação do produtor na fazenda ${farm.name} deve ficar entre 0 e 100%.`)
    // 0045 é obrigatório quando a participação é menor que 100% ou a exploração não é individual.
    if ((f.share < 100 || f.exploration !== '1') && !f.partners.length) errors.push(`A fazenda ${farm.name} é explorada com terceiros: cadastre o sócio na fazenda ou informe o terceiro (CPF/CNPJ, nome e %).`)
    add('0040', farmCode.get(farm.id), 'BR', 'BRL', f.nirf, f.caepf, digits(farm.state_registration), text(farm.name, 50), text(farm.address, 150), text(farm.address_number, 6), text(farm.complement, 50), text(farm.neighborhood, 50), f.uf, f.cityCode, digits(farm.zip_code), f.exploration, percent(f.share))
    for (const partner of f.partners) {
      if (!partner.name) errors.push(`Informe o nome do terceiro ${partner.document} da fazenda ${farm.name} (cadastre-o em Participantes).`)
      if (![11, 14].includes(partner.document.length)) errors.push(`O CPF/CNPJ do terceiro da fazenda ${farm.name} está incompleto.`)
      add('0045', farmCode.get(farm.id), counterpartTypes[f.exploration] || '5', partner.document, text(partner.name, 50), percent(partner.share))
    }
  }
  if (bank) add('0050', '001', 'BR', digits(s.conta.banco), text(s.conta.nome_banco, 30), agency.padStart(4, '0'), account.padStart(16, '0'))
  else add('0050', '000', 'BRA', '000', 'CONTA CAIXA', '000', '000')

  // Lançamentos agrupados por imóvel e, dentro dele, por data (mesma ordem dos arquivos já entregues).
  const sorted = [...invoices].sort((x, y) => String(farmCode.get(farmOf(x)?.id)).localeCompare(String(farmCode.get(farmOf(y)?.id))) || String(x.issue_date).localeCompare(String(y.issue_date)) || x.id - y.id)
  let balance = 0
  const months = new Map()
  // Imóvel explorado em conjunto: o manual pede os valores na proporção da participação do produtor (0040.PARTICIPAÇÃO).
  const shareOf = invoice => { const f = farmInfo.get(farmOf(invoice)?.id); return f && f.share > 0 && f.share < 100 ? f.share / 100 : 1 }
  if (invoices.some(invoice => shareOf(invoice) < 1)) warnings.push('Nas fazendas em parceria/condomínio, os valores das notas foram lançados na proporção da participação do produtor, como o manual do LCDPR determina.')
  for (const invoice of sorted) {
    const amount = Math.round(Number(invoice.amount || 0) * shareOf(invoice) * 100) / 100
    const revenue = invoice.operation_type === 'outgoing'
    balance += revenue ? amount : -amount
    const key = String(invoice.issue_date).slice(0, 7)
    const month = months.get(key) || { entrada: 0, saida: 0 }
    month[revenue ? 'entrada' : 'saida'] += amount
    months.set(key, month)
    const type = invoice.document_type || 'invoice'
    const name = text(invoice.participant_name)
    const history = type === 'payroll' ? 'Folha de pagamento' : name ? (revenue ? `Vendas a ${name}` : `Compras do fornecedor ${name}`) : (fallbackHistories[invoice.ncm_category] || fallbackHistories.other)[revenue ? 'outgoing' : 'incoming']
    add('Q100', date(invoice.issue_date), farmCode.get(farmOf(invoice)?.id) || '', accountCode, text(invoice.invoice_number), documentTypes[type] || '6', history, participantOf(invoice), revenue ? '1' : '2', revenue ? decimal2(amount) : '000', revenue ? '000' : decimal2(amount), decimal2(balance), nature(balance))
  }
  // Q200: um registro por mês com lançamentos, em ordem cronológica; o saldo é acumulado desde o início do período.
  let running = 0
  for (const [key, month] of [...months].sort(([x], [y]) => x.localeCompare(y))) {
    running += month.entrada - month.saida
    add('Q200', `${key.slice(5, 7)}${key.slice(0, 4)}`, decimal2(month.entrada), decimal2(month.saida), decimal2(running), nature(running))
  }
  add('9999', text(a.nome), digits(a.documento), text(a.crc), text(a.email, 115), digits(a.telefone).slice(0, 15), String(lines.length + 1))

  const totals = sorted.reduce((sum, invoice) => { sum[invoice.operation_type === 'outgoing' ? 'revenue' : 'expenses'] += Math.round(Number(invoice.amount || 0) * shareOf(invoice) * 100) / 100; return sum }, { revenue: 0, expenses: 0 })
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], text: lines.join('\r\n') + '\r\n', filename: `LCDPR_${date(from)}_NrSeq_0001_${cpf}_${date(from)}_a_${date(to)}.txt`, summary: { entries: sorted.length, farms: farms.length, ...totals } }
}
