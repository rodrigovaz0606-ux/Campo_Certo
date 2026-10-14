import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { XMLParser } from 'fast-xml-parser'
import { soapRequest, findKey, list, textOf } from './sefaz.js'

// Consulta Cadastro de Contribuinte (CadConsultaCadastro4): a mesma base do Sintegra, pelo serviço oficial da SEFAZ
// de cada estado, autenticado com um certificado A1. Devolve titular, situação e endereço da inscrição estadual.
// Goiás foi testado com consulta real; os demais endereços seguem a tabela oficial de serviços da NF-e.
const URLS = {
  GO: 'https://nfe.sefaz.go.gov.br/nfe/services/CadConsultaCadastro4',
  MT: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/CadConsultaCadastro4',
  MS: 'https://nfe.sefaz.ms.gov.br/ws/CadConsultaCadastro4',
  MG: 'https://nfe.fazenda.mg.gov.br/nfe2/services/CadConsultaCadastro4',
  SP: 'https://nfe.fazenda.sp.gov.br/ws/cadconsultacadastro4.asmx',
  PR: 'https://nfe.sefa.pr.gov.br/nfe/CadConsultaCadastro4',
  RS: 'https://cad.sefazrs.rs.gov.br/ws/cadconsultacadastro/cadconsultacadastro4.asmx',
  BA: 'https://nfe.sefaz.ba.gov.br/webservices/CadConsultaCadastro4/CadConsultaCadastro4.asmx',
  PE: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/CadConsultaCadastro4',
}
export const CADASTRO_UFS = Object.keys(URLS)

// Raízes ICP-Brasil (v5 e v10), exportadas do repositório confiável do Windows; a SEFAZ-GO usa a v10.
const icpBrasil = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'certs', 'icp-brasil-raiz.pem'), 'utf8')
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, attributeNamePrefix: '@_' })
const digits = value => String(value ?? '').replace(/\D/g, '')
const situations = { '0': 'Não habilitada', '1': 'Habilitada' }

/** Consulta uma inscrição estadual. Lança erro com mensagem amigável quando a SEFAZ recusa. */
export async function consultaCadastro({ certificate, uf, ie }) {
  const state = String(uf || '').toUpperCase()
  const url = process.env[`CADASTRO_URL_${state}`] || URLS[state]
  if (!url) throw Object.assign(new Error(`A SEFAZ de ${state || 'UF não informada'} não oferece a consulta de cadastro por sistema. Preencha os dados manualmente.`), { status: 400 })
  const registration = digits(ie)
  if (registration.length < 8 || registration.length > 14) throw Object.assign(new Error('Informe a inscrição estadual com 8 a 14 números.'), { status: 400 })
  const body = `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4"><ConsCad xmlns="http://www.portalfiscal.inf.br/nfe" versao="2.00"><infCons><xServ>CONS-CAD</xServ><UF>${state}</UF><IE>${registration}</IE></infCons></ConsCad></nfeDadosMsg>`
  const xml = await soapRequest(url, 'http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4/consultaCadastro', body, certificate, { extraAuthorities: [icpBrasil] })
  const ret = findKey(parser.parse(xml), 'retConsCad')
  const info = ret?.infCons
  if (!info) {
    const fault = textOf(findKey(parser.parse(xml), 'Text') ?? findKey(parser.parse(xml), 'faultstring'))
    throw new Error(`Resposta inesperada da SEFAZ-${state}${fault ? `: ${fault}` : ''}.`)
  }
  const cStat = textOf(info.cStat)
  // 111: uma ocorrência; 112: mais de uma (ex.: inscrição com histórico).
  if (!['111', '112'].includes(cStat)) throw Object.assign(new Error(`SEFAZ-${state}: ${textOf(info.xMotivo)} (código ${cStat}).`), { status: 422 })
  const records = list(info.infCad).map(item => {
    const address = item.ender || {}
    return {
      ie: digits(textOf(item.IE)), document: digits(textOf(item.CPF) || textOf(item.CNPJ)), uf: textOf(item.UF),
      name: textOf(item.xNome), tradeName: textOf(item.xFant), active: textOf(item.cSit) === '1', situation: situations[textOf(item.cSit)] || textOf(item.cSit),
      regime: textOf(item.xRegApur), cnae: textOf(item.CNAE), startDate: textOf(item.dIniAtiv), situationDate: textOf(item.dUltSit), closedDate: textOf(item.dBaixa),
      address: { street: textOf(address.xLgr), number: textOf(address.nro), complement: textOf(address.xCpl), neighborhood: textOf(address.xBairro), cityCode: textOf(address.cMun), city: textOf(address.xMun), zipCode: digits(textOf(address.CEP)) },
    }
  })
  // Prefere o registro da própria inscrição e, entre eles, o habilitado.
  const match = records.filter(record => record.ie === registration)
  const chosen = (match.length ? match : records).sort((a, b) => Number(b.active) - Number(a.active))[0]
  if (!chosen) throw Object.assign(new Error(`SEFAZ-${state}: inscrição não encontrada.`), { status: 404 })
  return chosen
}
