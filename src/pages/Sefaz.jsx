import { useEffect, useState } from "react";
import { ShieldCheck, DownloadCloud, CheckCircle2, Trash2 } from "lucide-react";
import { api } from "../api";
import { maskCpf } from "../format";
import { Modal } from "../components";

const ufs = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
const dateTime = (value) => value ? new Date(value.endsWith("Z") || value.includes("T") ? value : `${value}Z`).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
const daysLeft = (value) => Math.ceil((new Date(value).getTime() - Date.now()) / 864e5);

function CertificateSummary({ certificate }) {
  const left = daysLeft(certificate.valid_until);
  return <div className={`certificate-summary${left <= 30 ? " expiring" : ""}`}>
    <ShieldCheck />
    <div>
      <b>{certificate.holder_name || "Certificado A1"}</b>
      <small>CPF {maskCpf(certificate.holder_document)} · UF {certificate.uf} · válido até {new Date(certificate.valid_until).toLocaleDateString("pt-BR")}{left <= 30 ? ` (vence em ${left} dia(s))` : ""}</small>
    </div>
  </div>;
}

// Botão "Certificado" na lista de produtores: envia, troca ou remove o A1 do produtor.
export function CertificateButton({ producer }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="icon" title="Certificado digital A1" aria-label={`Certificado digital de ${producer.name}`} onClick={() => setOpen(true)}><ShieldCheck /></button>
    {open && <CertificateModal producer={producer} close={() => setOpen(false)} />}
  </>;
}

function CertificateModal({ producer, close }) {
  const [certificate, setCertificate] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { api(`/producers/${producer.id}/certificate`).then(setCertificate).catch((e) => setError(e.message)); }, [producer.id]);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const saved = await api(`/producers/${producer.id}/certificate`, { method: "PUT", body: new FormData(event.currentTarget) });
      setCertificate(saved); setMessage("Certificado salvo. Já é possível buscar as notas na SEFAZ em Importar notas.");
      event.target.reset();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm("Remover o certificado deste produtor do servidor?")) return;
    setBusy(true); setError("");
    try { await api(`/producers/${producer.id}/certificate`, { method: "DELETE" }); setCertificate(null); setMessage("Certificado removido."); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <Modal title={producer.name} eyebrow="CERTIFICADO DIGITAL A1" close={close}>
    <form className="modal-form certificate-form" onSubmit={submit}>
      <p className="muted">Use o certificado A1 (e-CPF) do próprio produtor, arquivo .pfx ou .p12. Ele fica guardado cifrado no servidor e só é usado para buscar as notas na SEFAZ.</p>
      {certificate === undefined ? <p className="muted">Carregando...</p> : certificate ? <div className="certificate-current">
        <CertificateSummary certificate={certificate} />
        <button type="button" className="icon danger" title="Remover certificado" aria-label="Remover certificado" disabled={busy} onClick={remove}><Trash2 /></button>
      </div> : <p className="certificate-none">Nenhum certificado cadastrado para este produtor.</p>}
      <label>{certificate ? "Trocar pelo arquivo" : "Arquivo do certificado"}<input name="file" type="file" accept=".pfx,.p12,application/x-pkcs12" required /></label>
      <label>Senha do certificado<input name="password" type="password" autoComplete="off" required /></label>
      <label>UF do produtor<select name="uf" defaultValue={certificate?.uf || "GO"}>{ufs.map((uf) => <option key={uf}>{uf}</option>)}</select></label>
      {error && <div className="error">{error}</div>}{message && <div className="success"><CheckCircle2 />{message}</div>}
      <div className="actions"><button type="button" onClick={close}>Fechar</button><button className="primary" disabled={busy}>{busy ? "Conferindo..." : "Salvar certificado"}</button></div>
    </form>
  </Modal>;
}

// Painel em Importar notas: busca as notas do produtor direto na SEFAZ.
export function SefazPanel({ data }) {
  const [producer, setProducer] = useState("");
  const [farm, setFarm] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const loadStatus = (id = producer) => id ? api(`/sefaz/status?producer_id=${id}`).then(setStatus).catch((e) => setError(e.message)) : setStatus(null);
  useEffect(() => { setReport(null); setError(""); loadStatus(); }, [producer]);
  const farms = data.farms.filter((item) => String(item.producer_id) === producer);
  const sync = async () => {
    setBusy(true); setError(""); setReport(null);
    try { setReport(await api("/sefaz/sync", { method: "POST", body: JSON.stringify({ producer_id: Number(producer), farm_id: farm || null }) })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); loadStatus(); }
  };
  const blockedUntil = status?.state?.next_allowed_at && new Date(status.state.next_allowed_at) > new Date() ? status.state.next_allowed_at : null;
  return <section className="import-card sefaz-panel">
    <div className="sefaz-head">
      <span className="round-icon"><DownloadCloud /></span>
      <div><h3>Buscar notas na SEFAZ</h3><p>Baixa as notas emitidas para o CPF do produtor (compras e entradas) usando o certificado A1 dele. Notas emitidas pelo próprio produtor não vêm por aqui: importe o XML.</p></div>
    </div>
    <div className="form-row">
      <label>Produtor<select value={producer} onChange={(e) => { setProducer(e.target.value); setFarm(""); }}><option value="">Selecione um produtor</option>{data.producers.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
      <label>Fazenda (opcional)<select value={farm} disabled={!producer} onChange={(e) => setFarm(e.target.value)}><option value="">Definir pela inscrição estadual da nota</option>{farms.map((f) => <option value={f.id} key={f.id}>{f.name}</option>)}</select></label>
    </div>
    {producer && status && (status.certificate ? <>
      <CertificateSummary certificate={status.certificate} />
      <p className="sefaz-state">Última consulta: {dateTime(status.state?.last_query_at)}{status.state?.last_status ? ` · ${status.state.last_status}` : ""}{status.pending ? ` · ${status.pending} nota(s) em resumo aguardando o XML completo` : ""}</p>
    </> : <p className="certificate-none">Este produtor não tem certificado cadastrado. Cadastre em Produtores, no botão de escudo da linha dele.</p>)}
    {error && <div className="error">{error}</div>}
    {report && <div className="sefaz-report">
      <div className="success"><CheckCircle2 />{report.imported} nota(s) importada(s){report.duplicates ? `, ${report.duplicates} já existiam` : ""}{report.summaries ? `, ${report.summaries} chegaram só em resumo` : ""}.</div>
      {report.manifested > 0 && <p>Foi registrada a ciência da operação de {report.manifested} nota(s). O XML completo delas fica disponível numa próxima busca (a SEFAZ libera em alguns minutos ou horas).</p>}
      {report.canceled.length > 0 && <p className="sefaz-warning">A SEFAZ informou cancelamento de {report.canceled.length} nota(s): {report.canceled.join(", ")}. Confira na Conferência e exclua se tiverem sido importadas.</p>}
      {[...report.errors, ...report.manifestErrors].length > 0 && <div className="error-list">{[...report.errors, ...report.manifestErrors].map((item) => <span key={item}>{item}</span>)}</div>}
      <small>Resposta da SEFAZ: {report.status || "—"} · {report.queries} consulta(s).</small>
    </div>}
    <button className="primary" type="button" disabled={!status?.certificate || busy || Boolean(blockedUntil)} onClick={sync}>
      {busy ? "Consultando a SEFAZ..." : blockedUntil ? `Nova consulta liberada às ${new Date(blockedUntil).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Buscar notas agora"}
    </button>
  </section>;
}
