import { useEffect, useState } from "react";
import { CheckCircle2, Download } from "lucide-react";
import { api, companyHeaders } from "../api";
import { money } from "../format";
import { Modal, Loading, Spinner } from "../components";

const exploration = [["1", "Exploração individual"], ["2", "Condomínio"], ["3", "Imóvel arrendado"], ["4", "Parceria"], ["5", "Comodato"], ["6", "Outros"]];

// Formulário com os dados que o LCDPR exige e o sistema não tinha; fica salvo por produtor (o contador vale para a empresa).
export function LcdprModal({ producer, year, close }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/lcdpr/settings?producer_id=${producer.id}`).then(setForm).catch((e) => setError(e.message));
  }, [producer.id]);
  const set = (path, value) => setForm((current) => {
    const next = structuredClone(current);
    let target = next;
    path.slice(0, -1).forEach((key) => { target[key] ??= {}; target = target[key]; });
    target[path.at(-1)] = value;
    return next;
  });
  const input = (label, path, props = {}) => {
    const value = path.reduce((obj, key) => obj?.[key], form) ?? "";
    return <label>{label}<input value={value} onChange={(e) => set(path, e.target.value)} {...props} /></label>;
  };
  const save = () => api("/lcdpr/settings", { method: "PUT", body: JSON.stringify({ producer_id: producer.id, settings: form.settings, accountant: form.accountant }) });
  const generate = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setResult(null);
    try {
      await save();
      const response = await fetch(`/api/lcdpr?producer_id=${producer.id}&year=${year}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}`, ...companyHeaders() } });
      const data = await response.json();
      if (!response.ok && response.status !== 422) throw new Error(data.error || "Não foi possível gerar o arquivo.");
      setResult(data);
      if (!data.errors?.length) {
        const url = URL.createObjectURL(new Blob([data.text], { type: "text/plain" }));
        const link = document.createElement("a");
        link.href = url; link.download = data.filename; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const saveOnly = async () => {
    setBusy(true); setError("");
    try { await save(); setResult({ saved: true, errors: [], warnings: [] }); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <Modal title={`LCDPR ${year} · ${producer.name}`} eyebrow="LIVRO CAIXA DIGITAL" close={close}>
    {!form ? (error ? <div className="error">{error}</div> : <Loading text="Carregando dados do LCDPR..." />) : <form className="modal-form lcdpr-form" onSubmit={generate}>
      <p className="lcdpr-note">Preencha uma vez: os dados ficam salvos para os próximos anos. O código do município é o do IBGE, com 7 dígitos (ex.: Goiânia 5208707), e pode ser consultado em cidades.ibge.gov.br.</p>
      <fieldset><legend>Produtor</legend>
        <label>Forma de apuração<select value={form.settings.forma_apuracao} onChange={(e) => set(["settings", "forma_apuracao"], e.target.value)}><option value="1">Livro caixa</option><option value="2">Resultado presumido (20% da receita)</option></select></label>
        <label>Situação no início do ano<select value={form.settings.situacao_inicio} onChange={(e) => set(["settings", "situacao_inicio"], e.target.value)}><option value="0">Regular (desde 1º de janeiro)</option><option value="1">Início das atividades no ano</option><option value="2">Início da obrigatoriedade no ano</option></select></label>
        {input("UF", ["settings", "uf"], { maxLength: 2, required: true })}
        {input("Código IBGE do município", ["settings", "cod_mun"], { inputMode: "numeric", maxLength: 7, required: true })}
        {input("Telefone", ["settings", "telefone"])}
        {input("E-mail", ["settings", "email"], { type: "email", required: true })}
      </fieldset>
      <fieldset><legend>Conta bancária do produtor</legend>
        {input("Código do banco (3 dígitos)", ["settings", "conta", "banco"], { inputMode: "numeric", maxLength: 3, required: true })}
        {input("Nome do banco", ["settings", "conta", "nome_banco"], { maxLength: 30, required: true })}
        {input("Agência (sem dígito)", ["settings", "conta", "agencia"], { inputMode: "numeric", maxLength: 4, required: true })}
        {input("Número da conta (com dígito)", ["settings", "conta", "numero"], { required: true })}
        <label className="lcdpr-wide">Por onde passou o dinheiro dos lançamentos
          <select value={form.settings.conta?.movimento || "001"} onChange={(e) => set(["settings", "conta", "movimento"], e.target.value)}>
            <option value="001">Pela conta bancária acima</option>
            <option value="000">Dinheiro em espécie</option>
            <option value="999">Numerário em trânsito (contas de terceiros, financiamentos, permutas...)</option>
          </select>
        </label>
      </fieldset>
      <fieldset><legend>Imóveis rurais</legend>
        {form.farms.length ? form.farms.map((farm) => <div className="lcdpr-farm" key={farm.id}>
          <b>{farm.name}</b>
          {input("NIRF (CAD_ITR)", ["settings", "imoveis", farm.id, "cad_itr"], { inputMode: "numeric" })}
          {input("CAEPF (14 dígitos)", ["settings", "imoveis", farm.id, "caepf"], { inputMode: "numeric", maxLength: 18 })}
          {input("UF", ["settings", "imoveis", farm.id, "uf"], { maxLength: 2, placeholder: "GO" })}
          {input("Código IBGE do município", ["settings", "imoveis", farm.id, "cod_mun"], { inputMode: "numeric", maxLength: 7 })}
          <label>Tipo de exploração<select value={form.settings.imoveis?.[farm.id]?.tipo_exploracao || (farm.ownership_type === "shared" ? "2" : "1")} onChange={(e) => set(["settings", "imoveis", farm.id, "tipo_exploracao"], e.target.value)}>{exploration.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          {input("Participação do produtor (%)", ["settings", "imoveis", farm.id, "participacao"], { inputMode: "decimal", placeholder: String(100 - farm.partners.reduce((sum, partner) => sum + Number(partner.share || 0), 0)) })}
          {(form.settings.imoveis?.[farm.id]?.tipo_exploracao || (farm.ownership_type === "shared" ? "2" : "1")) !== "1" && <>
            <small className="lcdpr-farm-help">{farm.partners.length ? "Os sócios cadastrados na fazenda entram como terceiros. Se houver mais alguém (arrendador, parceiro, comodante), informe abaixo." : "Informe o terceiro da exploração (condômino, arrendador, parceiro ou comodante)."}</small>
            {input("CPF/CNPJ do terceiro", ["settings", "imoveis", farm.id, "terceiro_doc"], { inputMode: "numeric" })}
            {input("Nome do terceiro", ["settings", "imoveis", farm.id, "terceiro_nome"], { maxLength: 50 })}
            {input("Participação do terceiro (%)", ["settings", "imoveis", farm.id, "terceiro_perc"], { inputMode: "decimal" })}
          </>}
        </div>) : <p className="muted">Este produtor não tem fazendas cadastradas.</p>}
        <label className="lcdpr-wide">Imóvel para os lançamentos sem fazenda
          <select value={form.settings.imovel_padrao || ""} onChange={(e) => set(["settings", "imovel_padrao"], e.target.value)}><option value="">Nenhum (vincular na Conferência)</option>{form.farms.map((farm) => <option value={farm.id} key={farm.id}>{farm.name}</option>)}</select>
        </label>
      </fieldset>
      <fieldset><legend>Contador / responsável pela escrituração (opcional)</legend>
        {input("Nome", ["accountant", "nome"])}
        {input("CPF ou CNPJ", ["accountant", "documento"], { inputMode: "numeric" })}
        {input("CRC", ["accountant", "crc"])}
        {input("E-mail", ["accountant", "email"], { type: "email" })}
        {input("Telefone", ["accountant", "telefone"])}
      </fieldset>
      {error && <div className="error">{error}</div>}
      {result?.errors?.length > 0 && <div className="error-list"><b>Corrija antes de gerar:</b>{result.errors.map((item) => <span key={item}>{item}</span>)}</div>}
      {result && !result.errors?.length && !result.saved && <div className="success lcdpr-success"><CheckCircle2 /><span>Arquivo {result.filename} gerado: {result.summary.entries} lançamento(s), receitas {money.format(result.summary.revenue)} e despesas {money.format(result.summary.expenses)}. O arquivo passou na conferência do leiaute 1.3 da Receita.</span></div>}
      {result?.saved && <div className="success"><CheckCircle2 />Dados salvos.</div>}
      {result?.warnings?.length > 0 && <div className="lcdpr-warnings"><b>Confira:</b>{result.warnings.map((item) => <span key={item}>{item}</span>)}</div>}
      <div className="actions"><button type="button" onClick={saveOnly} disabled={busy}>Salvar dados</button><button className="primary" disabled={busy}>{busy ? <Spinner /> : <Download />}{busy ? "Gerando..." : "Salvar e gerar arquivo"}</button></div>
    </form>}
  </Modal>;
}
