import { useEffect, useState } from "react";
import { CheckCircle2, Download } from "lucide-react";
import { api, companyHeaders } from "../api";
import { money, maskIe } from "../format";
import { Modal, Loading, Spinner } from "../components";

const explorationNames = { "1": "Exploração individual", "2": "Condomínio", "3": "Imóvel arrendado", "4": "Parceria", "5": "Comodato", "6": "Outros" };
const percent = (value) => `${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

// Geração do LCDPR no mesmo fluxo do programa usado pelo escritório: propriedades, período e forma de apuração.
// Os dados do produtor, da conta e do contador ficam salvos (o contador vale para a empresa toda).
export function LcdprModal({ producer, year, close }) {
  const [form, setForm] = useState(null);
  const [farmIds, setFarmIds] = useState([]);
  const [period, setPeriod] = useState({ from: `${year}-01-01`, to: `${year}-12-31` });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/lcdpr/settings?producer_id=${producer.id}`).then((data) => { setForm(data); setFarmIds(data.farms.map((farm) => farm.id)); }).catch((e) => setError(e.message));
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
  const toggleFarm = (id) => setFarmIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const chosenFarms = form ? form.farms.filter((farm) => farmIds.includes(farm.id)) : [];
  const save = () => api("/lcdpr/settings", { method: "PUT", body: JSON.stringify({ producer_id: producer.id, settings: form.settings, accountant: form.accountant }) });
  const generate = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setResult(null);
    try {
      await save();
      const query = new URLSearchParams({ producer_id: producer.id, from: period.from, to: period.to, farms: farmIds.join(",") });
      const response = await fetch(`/api/lcdpr?${query}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}`, ...companyHeaders() } });
      const data = await response.json();
      if (!response.ok && response.status !== 422) throw new Error(data.error || "Não foi possível gerar o arquivo.");
      setResult(data);
      if (!data.errors?.length) {
        const url = URL.createObjectURL(new Blob([data.text], { type: "text/plain;charset=utf-8" }));
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
  const needsData = form && (!form.settings.cod_mun || !form.settings.email);
  const bank = form?.settings.conta?.tipo === "banco";
  return <Modal title={producer.name} eyebrow="GERAÇÃO DO LIVRO CAIXA DIGITAL DO PRODUTOR RURAL" close={close}>
    {!form ? (error ? <div className="error">{error}</div> : <Loading text="Carregando dados do LCDPR..." />) : <form className="modal-form lcdpr-form" onSubmit={generate}>
      <fieldset><legend>Propriedades</legend>
        {form.farms.length ? <div className="lcdpr-farms">
          {form.farms.map((farm) => <label key={farm.id} className={`lcdpr-farm-option${farmIds.includes(farm.id) ? " checked" : ""}`}>
            <input type="checkbox" checked={farmIds.includes(farm.id)} onChange={() => toggleFarm(farm.id)} />
            <span><b>{farm.name}</b><small>IE {maskIe(farm.state_registration)} · {percent(farm.share)} · {explorationNames[farm.exploration]}{farm.city_code ? "" : " · falta o município no cadastro"}</small></span>
          </label>)}
        </div> : <p className="certificate-none">Este produtor não tem fazendas cadastradas. Cadastre ao menos uma em Fazendas (o LCDPR exige o imóvel).</p>}
        {chosenFarms.length > 1 && <label className="lcdpr-wide">Imóvel dos lançamentos sem fazenda
          <select value={form.settings.imovel_padrao || ""} onChange={(e) => set(["settings", "imovel_padrao"], e.target.value)}><option value="">Nenhum (vincular na Conferência)</option>{chosenFarms.map((farm) => <option value={farm.id} key={farm.id}>{farm.name}</option>)}</select>
        </label>}
      </fieldset>
      <fieldset><legend>Definição do LCDPR</legend>
        <label>Indicador do início de período<select value={form.settings.situacao_inicio} onChange={(e) => set(["settings", "situacao_inicio"], e.target.value)}><option value="0">Regular</option><option value="1">Abertura (início das atividades no ano)</option><option value="2">Início da obrigatoriedade no ano</option></select></label>
        <label>Situação especial<select value={form.settings.situacao_especial} onChange={(e) => set(["settings", "situacao_especial"], e.target.value)}><option value="0">Normal (sem ocorrência de situação especial ou evento)</option><option value="1">Falecimento</option><option value="2">Espólio</option><option value="3">Saída definitiva do país</option></select></label>
        {form.settings.situacao_especial !== "0" && input("Data da situação", ["settings", "data_situacao_especial"], { type: "date", required: true })}
        <label>Data inicial<input type="date" required value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></label>
        <label>Data final<input type="date" required value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></label>
        <label className="lcdpr-wide">Forma de apuração do resultado da atividade rural<select value={form.settings.forma_apuracao} onChange={(e) => set(["settings", "forma_apuracao"], e.target.value)}><option value="1">1 - Livro Caixa</option><option value="2">2 - Apuração pelo resultado presumido (20% da receita bruta)</option></select></label>
      </fieldset>
      <details className="lcdpr-details" open={needsData}>
        <summary>Dados do produtor, da conta e do contador {needsData ? "(preencha uma vez)" : "(salvos)"}</summary>
        <fieldset><legend>Produtor (registro 0030)</legend>
          {input("UF", ["settings", "uf"], { maxLength: 2, required: true })}
          {input("Código IBGE do município", ["settings", "cod_mun"], { inputMode: "numeric", maxLength: 7, required: true })}
          {input("Telefone", ["settings", "telefone"])}
          {input("E-mail", ["settings", "email"], { type: "email", required: true })}
        </fieldset>
        <fieldset><legend>Conta dos lançamentos</legend>
          <label className="lcdpr-wide">Conta<select value={bank ? "banco" : "caixa"} onChange={(e) => set(["settings", "conta", "tipo"], e.target.value)}><option value="caixa">Conta caixa (sem banco)</option><option value="banco">Conta bancária</option></select></label>
          {bank && <>
            {input("Código do banco (3 dígitos)", ["settings", "conta", "banco"], { inputMode: "numeric", maxLength: 3, required: true })}
            {input("Nome do banco", ["settings", "conta", "nome_banco"], { maxLength: 30, required: true })}
            {input("Agência (sem dígito)", ["settings", "conta", "agencia"], { inputMode: "numeric", maxLength: 4, required: true })}
            {input("Número da conta (com dígito)", ["settings", "conta", "numero"], { required: true })}
          </>}
        </fieldset>
        <fieldset><legend>Contador (registro 9999)</legend>
          {input("Nome", ["accountant", "nome"])}
          {input("CPF ou CNPJ", ["accountant", "documento"], { inputMode: "numeric" })}
          {input("CRC", ["accountant", "crc"])}
          {input("E-mail", ["accountant", "email"])}
          {input("Telefone", ["accountant", "telefone"])}
        </fieldset>
      </details>
      {error && <div className="error">{error}</div>}
      {result?.errors?.length > 0 && <div className="error-list"><b>Corrija antes de gerar:</b>{result.errors.map((item) => <span key={item}>{item}</span>)}</div>}
      {result && !result.errors?.length && !result.saved && <div className="success lcdpr-success"><CheckCircle2 /><span>Arquivo {result.filename} gerado: {result.summary.entries} lançamento(s) em {result.summary.farms} imóvel(is), receitas {money.format(result.summary.revenue)} e despesas {money.format(result.summary.expenses)}. Conferido com o leiaute 1.3 da Receita.</span></div>}
      {result?.saved && <div className="success"><CheckCircle2 />Dados salvos.</div>}
      {result?.warnings?.length > 0 && <div className="lcdpr-warnings"><b>Confira:</b>{result.warnings.map((item) => <span key={item}>{item}</span>)}</div>}
      <div className="actions"><button type="button" onClick={saveOnly} disabled={busy}>Salvar dados</button><button className="primary" disabled={busy || !farmIds.length}>{busy ? <Spinner /> : <Download />}{busy ? "Gerando..." : "Gerar LCDPR"}</button></div>
    </form>}
  </Modal>;
}
