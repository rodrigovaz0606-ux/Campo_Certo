import { useEffect, useState } from "react";
import { Trash2, CheckCircle2, Download, Pencil } from "lucide-react";
import { CompanyManagement } from "../CompanyControls";
import { fileSize } from "../format";
import { api } from "../api";
import { Modal, ConfirmDialog, Spinner } from "../components";
import { OfficeCertificatePanel } from "./Sefaz";

export function UserManagement({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const load = () => Promise.all([api("/users").then(setUsers), api("/companies").then(setCompanies)]);
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  const submit = async (event) => {
    event.preventDefault(); setLoading(true); setError(""); setMessage("");
    try {
      const form = event.currentTarget;
      await api("/users", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      form.reset(); setMessage("Usuário criado com sucesso."); await load();
    } catch (caught) { setError(caught.message); }
    finally { setLoading(false); }
  };
  const updateUser = async (event) => {
    event.preventDefault(); setLoading(true); setError(""); setMessage("");
    try {
      await api(`/users/${editing.id}`, { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      setEditing(null); setMessage("Usuário atualizado com sucesso."); await load();
    } catch (caught) { setError(caught.message); }
    finally { setLoading(false); }
  };
  const removeUser = async (item) => {
    setError(""); setMessage("");
    try { await api(`/users/${item.id}`, { method: "DELETE" }); setPendingDelete(null); setMessage("Usuário excluído com sucesso."); await load(); }
    catch (caught) { setError(caught.message); }
  };
  return <>
    <div className="toolbar"><div><h1>Usuários</h1><p>Somente o administrador pode criar acessos ao Campo Certo.</p></div></div>
    <CompanyManagement api={api} companies={companies} onChange={load} ConfirmDialog={ConfirmDialog} />
    <BackupPanel />
    <OfficeCertificatePanel />
    <div className="user-management">
      <form className="list-card user-create" onSubmit={submit}>
        <h3>Novo usuário</h3>
        <label>Nome completo<input name="name" required /></label>
        <label>E-mail<input name="email" type="email" required /></label>
        <label>Senha inicial<input name="password" type="password" minLength="6" required /></label>
        <label>Empresa<select name="company_id" required defaultValue=""><option value="" disabled>Selecione a empresa</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {error && <div className="error">{error}</div>}{message && <div className="success">{message}</div>}
        <button className="primary" disabled={loading}>{loading ? "Criando..." : "Criar usuário"}</button>
      </form>
      <div className="list-card"><div className="search"><b>Usuários cadastrados</b></div><div className="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Empresa</th><th>Perfil</th><th>Ações</th></tr></thead><tbody>{users.map(item => <tr key={item.id}><td><b>{item.name}</b></td><td>{item.email}</td><td>{item.company_name}</td><td>{item.is_admin ? "Administrador" : "Usuário"}</td><td><div className="row-actions"><button className="icon" title={`Editar ${item.name}`} aria-label={`Editar ${item.name}`} onClick={() => { setEditing(item); setError(""); }}><Pencil /></button><button className="icon danger" disabled={item.id === currentUser.id} title={item.id === currentUser.id ? "Você não pode excluir sua própria conta" : `Excluir ${item.name}`} aria-label={`Excluir ${item.name}`} onClick={() => setPendingDelete(item)}><Trash2 /></button></div></td></tr>)}</tbody></table></div></div>
    </div>
    {editing && <Modal title="Editar usuário" close={() => setEditing(null)}><form className="modal-form" onSubmit={updateUser}>
      <label>Nome completo<input name="name" required defaultValue={editing.name} /></label>
      <label>E-mail<input name="email" type="email" required defaultValue={editing.email} /></label>
      <label>Empresa<select name="company_id" required defaultValue={editing.company_id} disabled={Boolean(editing.is_admin)}>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <p>Trocar a empresa encerra as sessões deste usuário. Os registros ficam na empresa de origem.</p>
      <label>Nova senha (opcional)<input name="password" type="password" minLength="6" placeholder="Deixe em branco para manter a atual" /></label>
      {error && <div className="error">{error}</div>}
      <div className="actions"><button type="button" onClick={() => setEditing(null)}>Cancelar</button><button className="primary" disabled={loading}>{loading ? "Salvando..." : "Salvar alterações"}</button></div>
    </form></Modal>}
    {pendingDelete && <ConfirmDialog title="Excluir usuário" message={`Deseja excluir o usuário ${pendingDelete.name}? Essa ação não poderá ser desfeita.`} close={() => setPendingDelete(null)} confirm={() => removeUser(pendingDelete)} />}
  </>;
}

export function BackupPanel() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = () => api("/backups").then(setState).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const runNow = async () => {
    setBusy(true); setError(""); setMessage("");
    try { const created = await api("/backups", { method: "POST" }); setMessage(`Backup concluído: ${created.databases} banco(s), ${fileSize(created.size)}.`); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const latest = state?.items?.[0];
  const ageHours = latest ? (Date.now() - new Date(latest.created_at).getTime()) / 36e5 : Infinity;
  return <section className="list-card backup-panel">
    <div className="backup-panel-head">
      <div>
        <h3>Backups automáticos</h3>
        <p>O servidor copia todos os bancos (usuários e empresas) uma vez por dia e guarda as cópias mais recentes.</p>
      </div>
      <button className="outline compact" type="button" disabled={busy} onClick={runNow}>{busy ? <Spinner /> : <Download />}{busy ? "Copiando..." : "Fazer backup agora"}</button>
    </div>
    {state && <div className={`backup-status ${ageHours < 26 ? "ok" : "late"}`}>
      {latest ? <><CheckCircle2 /><span>Último backup em <b>{new Date(latest.created_at).toLocaleString("pt-BR")}</b> · {fileSize(latest.size)} · {state.items.length} cópia(s) guardada(s)</span></>
        : <span>Nenhum backup ainda. O primeiro é feito alguns minutos depois que o servidor inicia.</span>}
    </div>}
    {state && <p className="backup-folder">Pasta no servidor: <code>{state.folder}</code><br />Para proteção contra falha do disco, copie periodicamente essa pasta para outro lugar (HD externo ou nuvem).</p>}
    {error && <div className="error">{error}</div>}{message && <div className="success"><CheckCircle2 />{message}</div>}
  </section>;
}
