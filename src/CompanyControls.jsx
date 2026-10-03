import React, { useEffect, useState } from 'react';

export function CompanySwitcher({ user, api }) {
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const refresh = () => { if (user.is_admin) api('/companies').then(setCompanies).catch(e => setError(e.message)); };
    refresh();
    window.addEventListener('companies-changed', refresh);
    return () => window.removeEventListener('companies-changed', refresh);
  }, [user.id]);
  if (!user.is_admin) return <span className="company-current">{user.company_name}</span>;
  const selected = sessionStorage.getItem('active-company') || String(user.company_id);
  return <div className="company-switcher"><label>Empresa em uso
    <select aria-label="Empresa em uso" value={selected} onChange={e => {
      sessionStorage.setItem('active-company', e.target.value);
      // Reload cancels old page work and removes every previous company's screen state.
      window.location.reload();
    }}><option value="" disabled>Selecione uma empresa</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
  </label>{error && <small role="alert">{error}</small>}</div>;
}

export function CompanyManagement({ api, companies, onChange, ConfirmDialog }) {
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (busy || !pendingDelete) return;
    setBusy(true); setError('');
    try {
      await api(`/companies/${pendingDelete.id}`, { method: 'DELETE' });
      if (sessionStorage.getItem('active-company') === String(pendingDelete.id)) {
        sessionStorage.removeItem('active-company');
        window.location.reload();
        return;
      }
      if (editing?.id === pendingDelete.id) setEditing(null);
      setPendingDelete(null); await onChange();
      window.dispatchEvent(new Event('companies-changed'));
    } catch (caught) { setPendingDelete(null); setError(caught.message); }
    finally { setBusy(false); }
  };
  const save = async e => {
    e.preventDefault(); setBusy(true); setError('');
    const form = e.currentTarget;
    try {
      await api(`/companies${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      form.reset(); setEditing(null); await onChange();
      window.dispatchEvent(new Event('companies-changed'));
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };
  return <section className="list-card company-management"><h3>Empresas clientes</h3>
    <p>Crie a empresa e depois vincule seus usuários. Empresas novas começam sem dados. Você continua sendo o único administrador.</p>
    <form key={editing?.id || 'new'} onSubmit={save} className="company-create">
      <label>{editing ? 'Nome da empresa' : 'Nova empresa'}<input name="name" required maxLength={120} defaultValue={editing?.name || ''} placeholder="Nome da empresa cliente" /></label>
      <button className="primary" disabled={busy}>{busy ? 'Salvando...' : editing ? 'Salvar nome' : 'Criar empresa'}</button>
      {editing && <button type="button" onClick={() => setEditing(null)}>Cancelar</button>}
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="company-list">{companies.map(c => <div key={c.id}><span>{c.name}</span><button type="button" disabled={busy} onClick={() => setEditing(c)}>Renomear</button>{c.id !== 1 && <button type="button" className="company-delete" disabled={busy} onClick={() => setPendingDelete(c)}>Excluir</button>}</div>)}</div>
    {pendingDelete && <ConfirmDialog title="Excluir empresa" message={`Excluir a empresa “${pendingDelete.name}”? Ela sairá da lista e seus usuários perderão o acesso. Os dados serão mantidos arquivados, sem apagamento definitivo.`} close={() => { if (!busy) setPendingDelete(null); }} confirm={remove} loading={busy} />}
  </section>;
}
