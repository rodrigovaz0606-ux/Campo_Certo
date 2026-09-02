import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  Sprout,
  LayoutDashboard,
  Users,
  Tractor,
  UserRound,
  Upload,
  LogOut,
  Plus,
  Trash2,
  FileText,
  Search,
  CheckCircle2,
  X,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Download,
  Eye,
  BarChart3,
  TableProperties,
  Moon,
  Sun,
  Filter,
  Pencil,
  Printer,
} from "lucide-react";
import "./styles.css";
import "./partners.css";
import "./export.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((error) => {
      console.warn("Não foi possível registrar o aplicativo Campo Certo.", error);
    });
  });
}

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const maskDoc = (v) => {
  const s = String(v || "").replace(/\D/g, "");
  return s.length > 11
    ? s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")
    : s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
};

const maskCpf = (v) => {
  const s = String(v || "").replace(/\D/g, "").slice(0, 11);
  return s.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
};
const maskCpfCnpj = (v) => {
  const s = String(v || "").replace(/\D/g, "").slice(0, 14);
  return s.length <= 11 ? maskCpf(s) : s.replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
};
const maskIe = (v) => {
  return String(v || "").replace(/\D/g, "").slice(0, 14);
};
const maskCep = (v) => String(v || "").replace(/\D/g, "").slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");

function MaskedNumberInput({ name, kind = "cpf", value, defaultValue = "", onValue, placeholder, required = true }) {
  const format = kind === "document" ? maskCpfCnpj : kind === "ie" ? maskIe : kind === "cep" ? maskCep : maskCpf;
  const [internal, setInternal] = useState(() => format(defaultValue));
  const current = value === undefined ? internal : value;
  const change = (raw) => { const formatted = format(raw); value === undefined ? setInternal(formatted) : onValue(formatted); };
  return <input name={name} value={current} required={required} inputMode="numeric" autoComplete="off" placeholder={placeholder} maxLength={kind === "ie" ? 14 : undefined}
    onKeyDown={(e) => { if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && !/\d/.test(e.key)) e.preventDefault(); }}
    onPaste={(e) => { e.preventDefault(); change(e.clipboardData.getData("text")); }}
    onChange={(e) => change(e.target.value)} />;
}

function CurrencyInput({ value, onValue }) {
  const numericValue = Number(value) || 0;
  return (
    <input
      className="amount currency-input"
      type="text"
      inputMode="numeric"
      value={money.format(numericValue)}
      aria-label="Valor da nota em reais"
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        const allowed = ["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "Home", "End"];
        if (e.key.length === 1 && !/\d/.test(e.key) && !allowed.includes(e.key)) e.preventDefault();
      }}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "");
        onValue(digits ? Number(digits) / 100 : 0);
      }}
    />
  );
}

function api(path, options = {}) {
  const token = localStorage.getItem("token");
  const headers = {
    ...(options.body instanceof FormData
      ? {}
      : { "Content-Type": "application/json" }),
    ...options.headers,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`/api${path}`, { ...options, headers })
    .then(async (r) => {
      const body = r.status === 204 ? "" : await r.text();
      let data = null;
      if (body) {
        try { data = JSON.parse(body); }
        catch { data = { error: "O servidor retornou uma resposta inválida." }; }
      }
      if (r.status === 401 && token) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        location.reload();
      }
      if (!r.ok) throw new Error(data?.error || `Não foi possível concluir a operação (erro ${r.status}).`);
      return data;
    })
    .catch((error) => {
      if (error instanceof TypeError) throw new Error("Não foi possível conectar ao servidor. Verifique se o backend está em execução.");
      throw error;
    });
}

function ThemeToggle({ theme, onToggle }) {
  const dark = theme === "dark";
  return (
    <button className="theme-toggle" type="button" onClick={onToggle}
      title={dark ? "Usar tema claro" : "Usar tema escuro"}
      aria-label={dark ? "Usar tema claro" : "Usar tema escuro"} aria-pressed={dark}>
      {dark ? <Sun /> : <Moon />}
      <span>{dark ? "Tema claro" : "Tema escuro"}</span>
    </button>
  );
}

function Auth({ onAuth, theme, onThemeToggle }) {
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      onAuth(data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="auth">
      <section className="auth-art">
        <div className="brand">
          <span>
            <Sprout />
          </span>{" "}
          Campo Certo
        </div>
        <div className="auth-copy">
          <p className="eyebrow">GESTÃO RURAL SIMPLIFICADA</p>
          <h1>
            Seu campo.
            <br />
            Seus números.
            <br />
            <em>Sob controle.</em>
          </h1>
          <p>
            Centralize produtores, propriedades e notas fiscais em um só lugar —
            com clareza para decidir melhor.
          </p>
        </div>
        <div className="field-lines" />
      </section>
      <main className="auth-form">
        <ThemeToggle theme={theme} onToggle={onThemeToggle} />
        <div className="mobile-brand">
          <Sprout /> Campo Certo
        </div>
        <div className="form-card">
          <p className="eyebrow">BEM-VINDO</p>
          <h2>Acesse sua conta</h2>
          <p className="muted">Entre para continuar gerenciando sua operação.</p>
          <form onSubmit={submit}>
            <label>
              E-mail
              <input
                name="email"
                type="email"
                required
                placeholder="nome@exemplo.com"
              />
            </label>
            <label>
              Senha
              <input
                name="password"
                type="password"
                minLength="6"
                required
                placeholder="Mínimo de 6 caracteres"
              />
            </label>
            {error && <div className="error">{error}</div>}
            <button className="primary" disabled={loading}>
              {loading ? "Aguarde..." : "Entrar"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

const nav = [
  ["dashboard", "Visão geral", LayoutDashboard],
  ["producers", "Produtores", Users],
  ["farms", "Fazendas", Tractor],
  ["participants", "Participantes", UserRound],
  ["import", "Importar notas", Upload],
  ["conference", "Conferência", FileText],
  ["annual-summary", "Resumo anual", TableProperties],
  ["cattle-summary", "Estoque de animais", BarChart3],
];
function Shell({ user, onLogout, theme, onThemeToggle }) {
  const [page, setPage] = useState("dashboard"),
    [open, setOpen] = useState(false),
    [sidebarCollapsed, setSidebarCollapsed] = useState(
      () => localStorage.getItem("sidebar-collapsed") === "true",
    );
  const availableNav = user.is_admin ? [...nav, ["users", "Usuários", Users]] : nav;
  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  };
  return (
    <div className={`app${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className={open ? "open" : ""}>
        <div className="logo">
          <span>
            <Sprout />
          </span>
          <b>Campo Certo</b>
          <button
            className="sidebar-toggle"
            type="button"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? "Expandir barra lateral" : "Minimizar barra lateral"}
            aria-label={sidebarCollapsed ? "Expandir barra lateral" : "Minimizar barra lateral"}
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
          <button className="close" onClick={() => setOpen(false)}>
            <X />
          </button>
        </div>
        <nav>
          {availableNav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              title={sidebarCollapsed ? label : undefined}
              onClick={() => {
                setPage(id);
                setOpen(false);
              }}
            >
              <Icon />
              {label}
            </button>
          ))}
        </nav>
        <div className="account">
          <div className="avatar">{user.name.slice(0, 2).toUpperCase()}</div>
          <div>
            <b>{user.name}</b>
            <small>{user.email}</small>
          </div>
          <button title="Sair" onClick={onLogout}>
            <LogOut />
          </button>
        </div>
      </aside>
      <main className="content">
        <header>
          <button
            className="menu"
            type="button"
            onClick={() => {
              setOpen(true);
            }}
            title="Abrir menu"
            aria-label="Abrir menu"
            aria-expanded={open}
          >
            <Menu />
          </button>
          <div>
            <p className="eyebrow">PAINEL DE GESTÃO</p>
            <h2>{availableNav.find((x) => x[0] === page)?.[1]}</h2>
          </div>
          <ThemeToggle theme={theme} onToggle={onThemeToggle} />
          <span className="today">Safra organizada, decisão segura.</span>
        </header>
        <Page id={page} navigate={setPage} user={user} />
      </main>
    </div>
  );
}

function useData() {
  const [data, setData] = useState({
    producers: [],
    farms: [],
    participants: [],
  });
  const reload = () =>
    Promise.all(
      ["producers", "farms", "participants"].map((k) => api("/" + k)),
    ).then(([producers, farms, participants]) =>
      setData({ producers, farms, participants }),
    );
  useEffect(() => {
    reload();
  }, []);
  return [data, reload];
}
function Page({ id, navigate, user }) {
  const [data, reload] = useData();
  if (id === "dashboard") return <Dashboard navigate={navigate} />;
  if (id === "producers")
    return (
      <Crud
        type="producers"
        title="Produtores rurais"
        items={data.producers}
        reload={reload}
      />
    );
  if (id === "farms")
    return (
      <Crud
        type="farms"
        title="Fazendas"
        items={data.farms}
        producers={data.producers}
        reload={reload}
      />
    );
  if (id === "participants")
    return (
      <Crud
        type="participants"
        title="Participantes"
        items={data.participants}
        reload={reload}
      />
    );
  if (id === "import") return <Importer data={data} />;
  if (id === "conference") return <Conference data={data} />;
  if (id === "annual-summary") return <AnnualSummary data={data} />;
  if (id === "users" && user.is_admin) return <UserManagement currentUser={user} />;
  return <CattleSummary data={data} />;
}

function UserManagement({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const load = () => api("/users").then(setUsers);
  useEffect(() => { load(); }, []);
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
    <div className="user-management">
      <form className="list-card user-create" onSubmit={submit}>
        <h3>Novo usuário</h3>
        <label>Nome completo<input name="name" required /></label>
        <label>E-mail<input name="email" type="email" required /></label>
        <label>Senha inicial<input name="password" type="password" minLength="6" required /></label>
        {error && <div className="error">{error}</div>}{message && <div className="success">{message}</div>}
        <button className="primary" disabled={loading}>{loading ? "Criando..." : "Criar usuário"}</button>
      </form>
      <div className="list-card"><div className="search"><b>Usuários cadastrados</b></div><div className="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Ações</th></tr></thead><tbody>{users.map(item => <tr key={item.id}><td><b>{item.name}</b></td><td>{item.email}</td><td>{item.is_admin ? "Administrador" : "Usuário"}</td><td><div className="row-actions"><button className="icon" title={`Editar ${item.name}`} aria-label={`Editar ${item.name}`} onClick={() => { setEditing(item); setError(""); }}><Pencil /></button><button className="icon danger" disabled={item.id === currentUser.id} title={item.id === currentUser.id ? "Você não pode excluir sua própria conta" : `Excluir ${item.name}`} aria-label={`Excluir ${item.name}`} onClick={() => setPendingDelete(item)}><Trash2 /></button></div></td></tr>)}</tbody></table></div></div>
    </div>
    {editing && <Modal title="Editar usuário" close={() => setEditing(null)}><form className="modal-form" onSubmit={updateUser}>
      <label>Nome completo<input name="name" required defaultValue={editing.name} /></label>
      <label>E-mail<input name="email" type="email" required defaultValue={editing.email} /></label>
      <label>Nova senha (opcional)<input name="password" type="password" minLength="6" placeholder="Deixe em branco para manter a atual" /></label>
      {error && <div className="error">{error}</div>}
      <div className="actions"><button type="button" onClick={() => setEditing(null)}>Cancelar</button><button className="primary" disabled={loading}>{loading ? "Salvando..." : "Salvar alterações"}</button></div>
    </form></Modal>}
    {pendingDelete && <ConfirmDialog title="Excluir usuário" message={`Deseja excluir o usuário ${pendingDelete.name}? Essa ação não poderá ser desfeita.`} close={() => setPendingDelete(null)} confirm={() => removeUser(pendingDelete)} />}
  </>;
}

function Dashboard({ navigate }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    api("/dashboard").then(setD);
  }, []);
  return (
    <>
      <div className="hero">
        <div>
          <p className="eyebrow">RESUMO DA OPERAÇÃO</p>
          <h1>
            Bom trabalho começa
            <br />
            com informação <em>bem cuidada.</em>
          </h1>
          <p>Acompanhe seus cadastros e mantenha as notas em dia.</p>
        </div>
        <button className="light" onClick={() => navigate("import")}>
          <Upload /> Importar notas XML
        </button>
      </div>
      <div className="stats">
        <Stat icon={Users} label="Produtores" value={d?.producers} />
        <Stat icon={Tractor} label="Fazendas" value={d?.farms} />
        <Stat icon={UserRound} label="Participantes" value={d?.participants} />
        <Stat
          icon={FileText}
          label="Notas importadas"
          value={d?.invoices?.total}
          sub={money.format(d?.invoices?.amount || 0)}
        />
      </div>
      <section className="empty-welcome">
        <div className="round-icon">
          <Sprout />
        </div>
        <div>
          <h3>Tudo pronto para cultivar uma gestão melhor</h3>
          <p>
            Cadastre produtores e fazendas, depois importe as notas fiscais para
            conferência.
          </p>
        </div>
        <button onClick={() => navigate("producers")}>
          Começar cadastro <span>→</span>
        </button>
      </section>
    </>
  );
}
function Stat({ icon: Icon, label, value, sub }) {
  return (
    <div className="stat">
      <span>
        <Icon />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value ?? "—"}</strong>
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}

const fields = {
  producers: [
    ["name", "Nome do produtor"],
    ["cpf", "CPF"],
  ],
  participants: [
    ["name", "Nome do participante"],
    ["document", "CPF ou CNPJ"],
  ],
};
function AddressFields({ item = {} }) {
  return <div className="address-fields">
    <label className="address-street">Endereço<input name="address" required placeholder="Rua, avenida ou estrada" defaultValue={item.address || ""} /></label>
    <label>Número<input name="address_number" required defaultValue={item.address_number || ""} /></label>
    <label>Quadra (opcional)<input name="block" defaultValue={item.block || ""} /></label>
    <label>Lote (opcional)<input name="lot" defaultValue={item.lot || ""} /></label>
    <label>CEP<MaskedNumberInput name="zip_code" kind="cep" placeholder="00000-000" defaultValue={item.zip_code} /></label>
    <label>Bairro<input name="neighborhood" required defaultValue={item.neighborhood || ""} /></label>
    <label className="address-complement">Complemento (opcional)<input name="complement" defaultValue={item.complement || ""} /></label>
  </div>;
}
const formatAddress = item => [
  [item.address, item.address_number].filter(Boolean).join(", "),
  item.block && `Quadra ${item.block}`, item.lot && `Lote ${item.lot}`,
  item.neighborhood, item.zip_code && `CEP ${maskCep(item.zip_code)}`, item.complement
].filter(Boolean).join(" · ");
function Crud({ type, title, items, producers, reload }) {
  const [show, setShow] = useState(false),
    [editing, setEditing] = useState(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [ownership, setOwnership] = useState("unique"),
    [partners, setPartners] = useState([{ document: "", share: "" }]);
  const [pendingDelete, setPendingDelete] = useState(null);
  const filtered = items.filter((i) =>
    JSON.stringify(i).toLowerCase().includes(search.toLowerCase()),
  );
  const openNew = () => {
    setEditing(null); setError(""); setOwnership("unique"); setPartners([{ document: "", share: "" }]); setShow(true);
  };
  const openEdit = (item) => {
    setEditing(item); setError(""); setOwnership(item.ownership_type || "unique");
    setPartners(item.partners?.length ? item.partners.map(p => ({ document: maskCpf(p.document), share: String(p.share) })) : [{ document: "", share: "" }]);
    setShow(true);
  };
  const closeModal = () => { setShow(false); setEditing(null); setError(""); };
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await api(`/${type}${editing ? `/${editing.id}` : ""}`, {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      closeModal();
      reload();
    } catch (e) {
      setError(e.message);
    }
  };
  const remove = async (id) => {
    await api(`/${type}/${id}`, { method: "DELETE" });
    setPendingDelete(null);
    reload();
  };
  return (
    <>
      <div className="toolbar">
        <div>
          <h1>{title}</h1>
          <p>Cadastre e consulte as informações da sua operação.</p>
        </div>
        <button className="primary compact" onClick={openNew}>
          <Plus /> Novo cadastro
        </button>
      </div>
      <div className="list-card">
        <div className="search">
          <Search />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou documento..."
          />
        </div>
        {filtered.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {type === "farms" ? (
                    <>
                      <th>Fazenda</th>
                      <th>Produtor</th>
                      <th>Inscrição Estadual</th>
                      <th>Propriedade</th>
                    </>
                  ) : (
                    <>
                      <th>Nome</th>
                      <th>Documento</th>
                      <th>
                        {type === "producers" ? "Endereço" : "Cadastrado em"}
                      </th>
                    </>
                  )}
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.id}>
                    {type === "farms" ? (
                      <>
                        <td>
                          <b>{i.name}</b>
                          <small>{formatAddress(i)}</small>
                        </td>
                        <td>{i.producer_name}</td>
                        <td>{maskIe(i.state_registration)}</td>
                        <td>
                          <span className="badge">
                            {i.ownership_type === "unique"
                              ? "Proprietário único"
                              : "Com participação"}
                          </span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>
                          <b>{i.name}</b>
                        </td>
                        <td>{maskDoc(i.cpf || i.document)}</td>
                        <td>
                          {formatAddress(i) ||
                            new Date(i.created_at + "Z").toLocaleDateString(
                              "pt-BR",
                            )}
                        </td>
                      </>
                    )}
                    <td><div className="row-actions">
                      <button className="icon" title="Editar cadastro" aria-label={`Editar ${i.name}`} onClick={() => openEdit(i)}>
                        <Pencil />
                      </button>
                      <button
                        className="icon danger"
                        title="Excluir cadastro"
                        aria-label={`Excluir ${i.name}`}
                        onClick={() => setPendingDelete(i)}
                      >
                        <Trash2 />
                      </button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="Nenhum cadastro encontrado." />
        )}
      </div>
      {show && (
        <Modal
          title={`${editing ? "Editar" : "Novo"} ${type === "farms" ? "cadastro de fazenda" : type === "producers" ? "produtor rural" : "participante"}`}
          close={closeModal}
        >
          <form key={editing?.id || "new"} onSubmit={submit} className="modal-form">
            {type === "farms" ? (
              <>
                <label>
                  Produtor responsável
                  <select name="producer_id" required defaultValue={editing?.producer_id || ""}>
                    <option value="" disabled>
                      Selecione o produtor
                    </option>
                    {producers.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Nome da fazenda
                  <input name="name" required defaultValue={editing?.name || ""} />
                </label>
                <label>
                  Inscrição Estadual
                  <MaskedNumberInput name="state_registration" kind="ie" placeholder="Digite ou cole de 8 a 14 números" defaultValue={editing?.state_registration} />
                  <small className="field-help">Aceita de 8 a 14 dígitos. São Paulo utiliza 12 dígitos.</small>
                </label>
                <AddressFields item={editing || {}} />
                <label>
                  Tipo de propriedade
                  <select name="ownership_type" required value={ownership} onChange={(e) => setOwnership(e.target.value)}>
                    <option value="unique">Proprietário único</option>
                    <option value="shared">Possui participação</option>
                  </select>
                </label>
                {ownership === "shared" && <div className="partners">
                  <div className="partners-title"><div><b>Sócios da fazenda</b><small>Informe o CPF e o percentual de cada sócio.</small></div><button type="button" className="outline" onClick={() => setPartners([...partners, { document: "", share: "" }])}><Plus /> Adicionar sócio</button></div>
                  {partners.map((partner, index) => <div className="partner-row" key={index}>
                    <label>CPF do sócio<MaskedNumberInput value={partner.document} onValue={(document) => setPartners(partners.map((p, i) => i === index ? { ...p, document } : p))} placeholder="111.222.333-44" /></label>
                    <label>Participação (%)<input type="number" inputMode="decimal" min="0.01" max="99.99" step="0.01" required value={partner.share} onChange={(e) => setPartners(partners.map((p, i) => i === index ? { ...p, share: e.target.value } : p))} /></label>
                    {partners.length > 1 && <button type="button" className="icon danger" onClick={() => setPartners(partners.filter((_, i) => i !== index))}><Trash2 /></button>}
                  </div>)}
                  <input type="hidden" name="partners" value={JSON.stringify(partners)} />
                </div>}
              </>
            ) : (<>
              {fields[type].map(([name, label]) => (
                <label key={name}>
                  {label}
                  {name === "cpf" ? (
                    <MaskedNumberInput name={name} kind="cpf" placeholder="111.222.333-44" defaultValue={editing?.[name]} />
                  ) : name === "document" ? (
                    <MaskedNumberInput name={name} kind="document" placeholder="CPF ou CNPJ" defaultValue={editing?.[name]} />
                  ) : (
                    <input name={name} required defaultValue={editing?.[name] || ""} />
                  )}
                </label>
              ))}
              {type === "producers" && <AddressFields item={editing || {}} />}
            </>)}
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button type="button" onClick={closeModal}>
                Cancelar
              </button>
              <button className="primary">{editing ? "Salvar alterações" : "Salvar cadastro"}</button>
            </div>
          </form>
        </Modal>
      )}
      {pendingDelete && <ConfirmDialog title="Excluir cadastro" message={`Deseja realmente excluir ${pendingDelete.name}? Essa ação não poderá ser desfeita.`} close={() => setPendingDelete(null)} confirm={() => remove(pendingDelete.id)} />}
    </>
  );
}

function Importer({ data }) {
  const [files, setFiles] = useState([]),
    [loading, setLoading] = useState(false),
    [processed, setProcessed] = useState(0),
    [result, setResult] = useState(null),
    [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    if (!files.length)
      return setError("Escolha os arquivos ou uma pasta com XMLs.");
    setLoading(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const producerId = form.get("producer_id");
    const farmId = form.get("farm_id");
    const batchSize = 200;
    const consolidated = { imported: 0, duplicates: 0, errors: [] };
    setProcessed(0);
    try {
      for (let start = 0; start < files.length; start += batchSize) {
        const fd = new FormData();
        fd.append("producer_id", producerId);
        if (farmId) fd.append("farm_id", farmId);
        files.slice(start, start + batchSize).forEach((file) => fd.append("files", file));
        const batch = await api("/invoices/import", { method: "POST", body: fd });
        consolidated.imported += batch.imported;
        consolidated.duplicates += batch.duplicates;
        consolidated.errors.push(...batch.errors);
        setProcessed(Math.min(start + batchSize, files.length));
      }
      setResult(consolidated);
      setFiles([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  const pick = (e) =>
    setFiles(
      [...e.target.files].filter((f) => f.name.toLowerCase().endsWith(".xml")),
    );
  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Importar notas fiscais</h1>
          <p>Selecione o destino e envie seus arquivos XML.</p>
        </div>
      </div>
      <form className="import-card" onSubmit={submit}>
        <div className="form-row">
          <label>
            Produtor responsável
            <select name="producer_id" required defaultValue="">
              <option value="" disabled>
                Selecione um produtor
              </option>
              {data.producers.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fazenda (opcional)
            <select name="farm_id" defaultValue="">
              <option value="">Definir depois</option>
              {data.farms.map((f) => (
                <option value={f.id} key={f.id}>
                  {f.name} — {f.producer_name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="drop">
          <Upload />
          <h3>Arraste ou selecione seus XMLs</h3>
          <p>
            Você pode escolher vários arquivos de uma só vez ou uma pasta
            completa.
          </p>
          <div className="picker-buttons">
            <label className="outline">
              Escolher arquivos
              <input
                type="file"
                accept=".xml,text/xml,application/xml"
                multiple
                onChange={pick}
              />
            </label>
            <label className="outline">
              Escolher pasta
              <input
                type="file"
                webkitdirectory=""
                directory=""
                multiple
                onChange={pick}
              />
            </label>
          </div>
          {files.length > 0 && (
            <div className="selected">
              <CheckCircle2 /> {files.length} arquivo(s) XML selecionado(s)
            </div>
          )}
        </div>
        {error && <div className="error">{error}</div>}
        {result && (
          <div className={result.errors.length ? "import-result" : "success"}>
            <div><CheckCircle2 /> {result.imported} nota(s) importada(s){result.duplicates ? ` e ${result.duplicates} duplicada(s) ignorada(s)` : ""}.</div>
            {result.errors.length > 0 && <div className="error-list"><b>{result.errors.length} arquivo(s) não importado(s):</b>{result.errors.map((message, index) => <span key={index}>{message}</span>)}</div>}
          </div>
        )}
        <button
          className="primary import-submit"
          disabled={loading || !data.producers.length}
        >
          {loading ? `Importando... ${processed} de ${files.length}` : "Importar e processar notas"}
        </button>
      </form>
    </>
  );
}

async function invoiceXml(row) {
  const response = await fetch(`/api/invoices/${row.id}/xml`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
  });
  if (!response.ok) throw new Error("Não foi possível obter o XML desta nota.");
  return response;
}

function ExportMenu({ row }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewXml, setPreviewXml] = useState("");
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    const closeMenu = (event) => {
      if (!event || !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const scrollArea = menuRef.current?.closest(".table-wrap");
    document.addEventListener("mousedown", closeMenu);
    scrollArea?.addEventListener("scroll", closeMenu, { passive: true });
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      scrollArea?.removeEventListener("scroll", closeMenu);
    };
  }, []);
  const preview = async () => {
    setBusy(true); setError("");
    try { const response = await invoiceXml(row); setPreviewXml(await response.text()); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const downloadXml = async () => {
    setError("");
    try {
      const response = await invoiceXml(row);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = row.original_filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e.message); }
  };
  const downloadDanfe = async () => {
    setBusy(true); setError("");
    try { const response = await invoiceXml(row); const { exportDanfePdf } = await import("./danfe.js"); await exportDanfePdf(await response.text()); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <><div className="export-wrap"><div className={`export-menu${open ? " open" : ""}`} ref={menuRef}>
    <button type="button" className="export-trigger" disabled={busy} aria-expanded={open} onClick={() => setOpen(value => !value)}><Download />{busy ? "Aguarde..." : "Exportar"}</button>
    <div className="export-options">
      <button onClick={preview}><Eye /><span><b>Visualizar nota</b><small>Abrir conferência rápida</small></span></button>
      <button onClick={downloadXml}><FileText /><span><b>XML original</b><small>Baixar arquivo fiscal</small></span></button>
      <button onClick={downloadDanfe}><Download /><span><b>DANFE em PDF</b><small>Gerar documento auxiliar</small></span></button>
    </div>
  </div>{error && <span className="export-error" title={error}>Falha ao abrir a nota</span>}</div>{previewXml && <DanfePreview xml={previewXml} close={() => setPreviewXml("")} />}</>;
}

function DanfePreview({ xml, close }) {
  const content = useRef(null);
  useEffect(() => {
    let active = true;
    import("./danfe.js").then(({ renderDanfePreview }) => {
      if (active && content.current) renderDanfePreview(content.current, xml);
    });
    return () => { active = false; };
  }, [xml]);
  useEffect(() => {
    const onKeyDown = event => event.key === "Escape" && close();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);
  return createPortal(<div className="danfe-preview-overlay" role="dialog" aria-modal="true" aria-label="Visualização da nota" onMouseDown={event => event.target === event.currentTarget && close()}>
    <div className="danfe-preview-modal">
      <div className="danfe-preview-head"><strong>Visualização da nota</strong><button type="button" onClick={close} aria-label="Fechar visualização"><X /></button></div>
      <div className="danfe-preview-scroll"><div className="danfe-preview-page" ref={content} /></div>
    </div>
  </div>, document.body);
}

function ParticipantPicker({ participantId, participantName, choices, labelsById, onChoose }) {
  const currentLabel = labelsById.get(Number(participantId)) || participantName || "";
  const [value, setValue] = useState(currentLabel);
  useEffect(() => setValue(currentLabel), [currentLabel]);
  return <input
    list="conference-participant-options"
    aria-label="Participante"
    placeholder="Não informado"
    value={value}
    onChange={(event) => {
      const next = event.target.value;
      setValue(next);
      if (!next) onChoose(null, "");
      else if (choices.has(next)) {
        const participant = choices.get(next);
        onChoose(participant.id, participant.name);
      }
    }}
    onBlur={() => { if (value && !choices.has(value)) setValue(currentLabel); }}
  />;
}

function Conference({ data }) {
  const loadSequence = useRef(0);
  const [producer, setProducer] = useState(""),
    [farm, setFarm] = useState(""),
    [ncmCategory, setNcmCategory] = useState(""),
    [period, setPeriod] = useState("annual"),
    [year, setYear] = useState(String(new Date().getFullYear())),
    [month, setMonth] = useState(String(new Date().getMonth() + 1).padStart(2, "0")),
    [years, setYears] = useState([]),
    [rows, setRows] = useState([]),
    [tablePage, setTablePage] = useState(1),
    [loading, setLoading] = useState(false),
    [selected, setSelected] = useState([]),
    [bulkBusy, setBulkBusy] = useState(false),
    [bulkError, setBulkError] = useState(""),
    [pendingDelete, setPendingDelete] = useState(null),
    [showManual, setShowManual] = useState(false),
    [manualBusy, setManualBusy] = useState(false),
    [manualError, setManualError] = useState(""),
    [refreshVersion, setRefreshVersion] = useState(0),
    [manual, setManual] = useState({ producer_id: "", farm_id: "", participant_id: "", document_type: "invoice", issue_date: new Date().toISOString().slice(0, 10), invoice_number: "", amount: 0, operation_type: "outgoing", ncm_category: "other", cattle_quantity: "" }),
    [columnFilters, setColumnFilters] = useState({
      issue_date: "", producer_id: "", farm_id: "", participant_id: "", document_type: "", invoice_number: "",
      amount: "", operation_type: "", ncm_category: "", cattle_quantity: "",
    });
  const farms = data.farms.filter(
    (f) => !producer || String(f.producer_id) === producer,
  );
  const filteredRows = useMemo(() => rows.filter((row) => {
    const contains = (value, filter) => String(value ?? "").toLocaleLowerCase("pt-BR").includes(filter.trim().toLocaleLowerCase("pt-BR"));
    return (!columnFilters.issue_date || row.issue_date === columnFilters.issue_date)
      && (!columnFilters.producer_id || String(row.producer_id) === columnFilters.producer_id)
      && (!columnFilters.farm_id || (columnFilters.farm_id === "unreported" ? !row.farm_id : String(row.farm_id) === columnFilters.farm_id))
      && (!columnFilters.participant_id || (columnFilters.participant_id === "unreported" ? !row.participant_id : String(row.participant_id) === columnFilters.participant_id))
      && (!columnFilters.document_type || (row.document_type || "invoice") === columnFilters.document_type)
      && contains(row.invoice_number, columnFilters.invoice_number)
      && contains(Number(row.amount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 }), columnFilters.amount)
      && (!columnFilters.operation_type || (row.operation_type || "outgoing") === columnFilters.operation_type)
      && (!columnFilters.ncm_category || (row.ncm_category || "other") === columnFilters.ncm_category)
      && contains(row.ncm_category === "cattle" ? row.cattle_quantity : "", columnFilters.cattle_quantity);
  }), [rows, columnFilters]);
  const totals = useMemo(() => filteredRows.reduce((sum, row) => {
    const key = row.operation_type === "incoming" ? "incoming" : "outgoing";
    sum[key] += Number(row.amount) || 0;
    return sum;
  }, { incoming: 0, outgoing: 0 }), [filteredRows]);
  const rowsPerPage = 40;
  const tablePages = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage));
  const visibleRows = useMemo(() => filteredRows.slice((tablePage - 1) * rowsPerPage, tablePage * rowsPerPage), [filteredRows, tablePage]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const participantLabelsById = useMemo(() => new Map(data.participants.map(item => [Number(item.id), `${item.name} — ${item.document}`])), [data.participants]);
  const participantChoices = useMemo(() => new Map(data.participants.map(item => [`${item.name} — ${item.document}`, item])), [data.participants]);
  useEffect(() => setTablePage(1), [producer, farm, ncmCategory, period, year, month, columnFilters]);
  useEffect(() => { if (tablePage > tablePages) setTablePage(tablePages); }, [tablePage, tablePages]);
  const setColumnFilter = (key, value) => setColumnFilters(current => ({ ...current, [key]: value }));
  const hasColumnFilters = Object.values(columnFilters).some(Boolean);
  const clearColumnFilters = () => setColumnFilters({
    issue_date: "", producer_id: "", farm_id: "", participant_id: "", document_type: "", invoice_number: "",
    amount: "", operation_type: "", ncm_category: "", cattle_quantity: "",
  });
  const exportSpreadsheet = async () => {
    const { default: ExcelJS } = await import("exceljs");
    const documentTypes = { invoice: "1 - Nota fiscal", payroll: "2 - Folha de pagamento", contract: "3 - Contrato" };
    const accounts = {
      cattle: { incoming: "Compra de Bovinos", outgoing: "Venda de Bovinos" },
      soy: { incoming: "Compra de Soja", outgoing: "Venda de Soja" },
      other: { incoming: "Despesas da Fazenda", outgoing: "Outras receitas" },
    };
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Campo Certo";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Conferência", {
      views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    sheet.columns = [
      { header: "Data", key: "date", width: 13 },
      { header: "Participante", key: "participant", width: 34 },
      { header: "Tipo de lançamento", key: "operation", width: 27 },
      { header: "Conta estendida", key: "account", width: 24 },
      { header: "Tipo de documento", key: "document", width: 19 },
      { header: "Nro. documento", key: "number", width: 17 },
      { header: "Entrada R$", key: "cashIn", width: 18 },
      { header: "Saída R$", key: "cashOut", width: 18 },
    ];
    filteredRows.forEach((row) => {
      const operation = row.operation_type === "incoming" ? "incoming" : "outgoing";
      const amount = Number(row.amount) || 0;
      const categoryAccounts = accounts[row.ncm_category] || accounts.other;
      sheet.addRow({
        date: row.issue_date ? new Date(`${String(row.issue_date).slice(0, 10)}T12:00:00`) : "",
        participant: row.participant_name || data.participants.find(item => item.id === row.participant_id)?.name || "Não informado",
        operation: operation === "outgoing" ? "1 - Receita da Atividade" : "2 - Despesas de custeio",
        account: categoryAccounts[operation],
        document: documentTypes[row.document_type || "invoice"] || row.document_type,
        number: row.invoice_number || "",
        cashIn: operation === "outgoing" ? amount : 0,
        cashOut: operation === "incoming" ? amount : 0,
      });
    });
    const lastDataRow = sheet.rowCount;
    const totalRow = sheet.addRow({ participant: "TOTAL" });
    totalRow.getCell(7).value = { formula: `SUM(G2:G${lastDataRow})` };
    totalRow.getCell(8).value = { formula: `SUM(H2:H${lastDataRow})` };
    sheet.autoFilter = { from: "A1", to: `H${Math.max(lastDataRow, 1)}` };
    sheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: "FF111111" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E0DC" } };
      cell.alignment = { vertical: "middle", horizontal: "left" };
    });
    sheet.eachRow((row, rowNumber) => {
      row.height = rowNumber === 1 ? 22 : 20;
      row.eachCell({ includeEmpty: true }, cell => {
        cell.border = {
          top: { style: "thin", color: { argb: "FF333333" } },
          left: { style: "thin", color: { argb: "FF333333" } },
          bottom: { style: "thin", color: { argb: "FF333333" } },
          right: { style: "thin", color: { argb: "FF333333" } },
        };
        cell.alignment = { ...cell.alignment, vertical: "middle" };
      });
      if (rowNumber > 1 && rowNumber <= lastDataRow) {
        row.getCell(1).numFmt = "dd/mm/yyyy";
        [7, 8].forEach(column => {
          const cell = row.getCell(column);
          cell.numFmt = '#,##0.00;[Red]-#,##0.00';
          cell.font = { bold: true };
          cell.alignment = { horizontal: "right", vertical: "middle" };
        });
        row.getCell(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFBFEFEF" } };
        row.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4B9B9" } };
      }
    });
    totalRow.font = { bold: true };
    totalRow.getCell(7).numFmt = '#,##0.00';
    totalRow.getCell(8).numFmt = '#,##0.00';
    totalRow.getCell(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFBFEFEF" } };
    totalRow.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4B9B9" } };
    const buffer = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const producerName = data.producers.find(item => String(item.id) === producer)?.name || "produtor";
    const safeName = producerName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
    const link = document.createElement("a");
    link.href = url;
    link.download = `conferencia-${safeName || "produtor"}-${year}${period === "monthly" ? `-${month}` : ""}.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const load = () => {
    const sequence = ++loadSequence.current;
    if (!producer) {
      setRows([]);
      setSelected([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    api(`/invoices?producer_id=${producer}&farm_id=${farm}&year=${year}&month=${period === "monthly" ? month : ""}&ncm_category=${ncmCategory}`)
      .then(values => { if (sequence === loadSequence.current) { setRows(values); setSelected([]); } })
      .catch(() => { if (sequence === loadSequence.current) setRows([]); })
      .finally(() => { if (sequence === loadSequence.current) setLoading(false); });
  };
  useEffect(() => {
    load();
  }, [producer, farm, ncmCategory, period, year, month, refreshVersion]);
  useEffect(() => {
    api("/invoice-years").then(values => {
      const current = String(new Date().getFullYear());
      setYears([...new Set([current, ...values])]);
      if (values.length && !values.includes(current)) setYear(values[0]);
    });
  }, []);
  const update = (id, key, value) =>
    setRows(current => current.map((r) => (r.id === id ? { ...r, [key]: value, is_reviewed: 0 } : r)));
  const updateParticipant = (id, participantId, participantName) =>
    setRows(current => current.map(row => row.id === id ? { ...row, participant_id: participantId, participant_name: participantName, is_reviewed: 0 } : row));
  const save = async (row, isReviewed = 1) => {
    const result = await api("/invoices/" + row.id, {
      method: "PUT",
      body: JSON.stringify({ ...row, is_reviewed: isReviewed }),
    });
    setRows(current => current.map(item => item.id === row.id ? { ...item, is_reviewed: result.is_reviewed } : item));
  };
  const openManual = () => {
    setManual({ producer_id: producer, farm_id: farm, participant_id: "", document_type: "invoice", issue_date: new Date().toISOString().slice(0, 10), invoice_number: "", amount: 0, operation_type: "outgoing", ncm_category: "other", cattle_quantity: "" });
    setManualError("");
    setShowManual(true);
  };
  const createManual = async (event) => {
    event.preventDefault();
    setManualBusy(true); setManualError("");
    try {
      await api("/invoices/manual", { method: "POST", body: JSON.stringify(manual) });
      const createdYear = manual.issue_date.slice(0, 4);
      setProducer(String(manual.producer_id));
      setFarm(String(manual.farm_id || ""));
      setYear(createdYear);
      if (period === "monthly") setMonth(manual.issue_date.slice(5, 7));
      setYears(values => [...new Set([createdYear, ...values])]);
      setShowManual(false);
      setRefreshVersion(value => value + 1);
    } catch (error) { setManualError(error.message); }
    finally { setManualBusy(false); }
  };
  const remove = async (id) => {
    await api("/invoices/" + id, { method: "DELETE" });
    setPendingDelete(null);
    load();
  };
  const toggle = (id) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const allVisibleSelected = filteredRows.length > 0 && filteredRows.every(row => selectedSet.has(row.id));
  const toggleAll = () => setSelected(current => allVisibleSelected
    ? current.filter(id => !filteredRows.some(row => row.id === id))
    : [...new Set([...current, ...filteredRows.map(row => row.id)])]);
  const exportSelected = async () => {
    setBulkBusy(true); setBulkError("");
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const chosen = rows.filter(row => selectedSet.has(row.id) && !row.is_manual);
      if (!chosen.length) throw new Error("Lançamentos manuais não possuem XML para exportação.");
      if (chosen.length !== selected.length) setBulkError("Os lançamentos manuais foram ignorados porque não possuem XML.");
      await Promise.all(chosen.map(async row => {
        const response = await invoiceXml(row);
        zip.file(row.original_filename || `nota-${row.invoice_number || row.id}.xml`, await response.blob());
      }));
      const url = URL.createObjectURL(await zip.generateAsync({ type: "blob" }));
      const link = document.createElement("a");
      link.href = url; link.download = `notas-selecionadas-${new Date().toISOString().slice(0, 10)}.zip`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setBulkError(error.message); }
    finally { setBulkBusy(false); }
  };
  const exportSelectedPdf = async () => {
    setBulkBusy(true); setBulkError("");
    try {
      const chosen = rows.filter(row => selectedSet.has(row.id) && !row.is_manual);
      if (!chosen.length) throw new Error("Lançamentos manuais não possuem DANFE para exportação.");
      if (chosen.length !== selected.length) setBulkError("Os lançamentos manuais foram ignorados porque não possuem DANFE.");
      const xmls = await Promise.all(chosen.map(async row => (await invoiceXml(row)).text()));
      const { exportMultipleDanfePdf } = await import("./danfe.js");
      await exportMultipleDanfePdf(xmls);
    } catch (error) { setBulkError(error.message); }
    finally { setBulkBusy(false); }
  };
  const removeSelected = async () => {
    setBulkBusy(true); setBulkError("");
    try {
      await api("/invoices/bulk", { method: "DELETE", body: JSON.stringify({ ids: selected }) });
      setPendingDelete(null);
      load();
    } catch (error) { setBulkError(error.message); }
    finally { setBulkBusy(false); }
  };
  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Conferência de notas</h1>
          <p>Revise e ajuste os dados extraídos dos arquivos XML.</p>
        </div>
        <div className="conference-toolbar-actions">
          <button className="outline compact" type="button" onClick={exportSpreadsheet} disabled={!producer || !filteredRows.length}><Download />Exportar planilha</button>
          <button className="primary compact" onClick={openManual}><Plus />Lançamento manual</button>
        </div>
      </div>
      <div className="filters conference-filters">
        <label>
          Visualização
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="annual">Anual</option>
            <option value="monthly">Mensal</option>
          </select>
        </label>
        <label>
          Ano
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            {years.map(value => <option value={value} key={value}>{value}</option>)}
          </select>
        </label>
        {period === "monthly" && <label>
          Mês
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'].map((name, index) => <option value={String(index + 1).padStart(2, '0')} key={name}>{name}</option>)}
          </select>
        </label>}
        <label>
          Produtor
          <select
            value={producer}
            onChange={(e) => {
              setProducer(e.target.value);
              setFarm("");
            }}
          >
            <option value="">Selecione um produtor</option>
            {data.producers.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fazenda
          <select value={farm} disabled={!producer} onChange={(e) => setFarm(e.target.value)}>
            <option value="">Todas as fazendas</option>
            {farms.map((f) => (
              <option value={f.id} key={f.id}>
                {f.name} — IE {maskIe(f.state_registration)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Classificação NCM
          <select value={ncmCategory} onChange={(e) => setNcmCategory(e.target.value)}>
            <option value="">Todas as classificações</option>
            <option value="cattle">Gado (0102)</option>
            <option value="soy">Soja (1201)</option>
            <option value="other">Outros</option>
          </select>
        </label>
      </div>
      {producer && selected.length > 0 && <div className="bulk-actions">
        <strong>{selected.length} nota(s) selecionada(s)</strong>
        <button className="outline" disabled={bulkBusy} onClick={exportSelected}><Download />Exportar XMLs em ZIP</button>
        <button className="outline" disabled={bulkBusy} onClick={exportSelectedPdf}><FileText />Exportar DANFEs em PDF</button>
        <button className="bulk-delete" disabled={bulkBusy} onClick={() => setPendingDelete({ kind: "bulk" })}><Trash2 />Excluir selecionadas</button>
        {bulkError && <span className="error">{bulkError}</span>}
      </div>}
      <div className="list-card conference">
        <div className="conference-grid-note">
          <span>Grade de conferência</span>
          <small>Edite os campos diretamente na linha e clique em Salvar para confirmar.</small>
        </div>
        {loading ? (
          <Empty text="Carregando notas..." />
        ) : producer && rows.length ? (
          <div className="table-wrap export-table">
            <datalist id="conference-participant-options">
              {data.participants.map(item => <option value={`${item.name} — ${item.document}`} key={item.id} />)}
            </datalist>
            <table>
              <thead>
                <tr className="conference-groups">
                  <th className="select-cell" aria-hidden="true" />
                  <th colSpan="6">Dados do lançamento</th>
                  <th colSpan="2">Movimentação</th>
                  <th colSpan="2">Classificação fiscal</th>
                  <th colSpan="2">Conferência</th>
                </tr>
                <tr>
                  <th className="select-cell"><input type="checkbox" aria-label="Selecionar todas as notas visíveis" checked={allVisibleSelected} onChange={toggleAll} /></th>
                  <th>Data</th>
                  <th>Produtor</th>
                  <th>Fazenda</th>
                  <th>Participante</th>
                  <th>Documento</th>
                  <th>Nº da nota</th>
                  <th>Valor</th>
                  <th>Tipo</th>
                  <th>Classificação NCM</th>
                  <th>Quantidade de gado</th>
                  <th>Exportação</th>
                  <th>Ações</th>
                </tr>
                <tr className="conference-column-filters">
                  <th className="select-cell filter-marker" title="Filtros da grade"><Filter aria-hidden="true" /></th>
                  <th><input type="date" aria-label="Filtrar por data" value={columnFilters.issue_date} onChange={(e) => setColumnFilter("issue_date", e.target.value)} /></th>
                  <th><select aria-label="Filtrar por produtor" value={columnFilters.producer_id} onChange={(e) => setColumnFilter("producer_id", e.target.value)}><option value="">Todos</option>{data.producers.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select></th>
                  <th><select aria-label="Filtrar por fazenda" value={columnFilters.farm_id} onChange={(e) => setColumnFilter("farm_id", e.target.value)}><option value="">Todas</option><option value="unreported">Não informada</option>{data.farms.map((f) => <option value={f.id} key={f.id}>{f.name} — IE {maskIe(f.state_registration)}</option>)}</select></th>
                  <th><select aria-label="Filtrar por participante" value={columnFilters.participant_id} onChange={(e) => setColumnFilter("participant_id", e.target.value)}><option value="">Todos</option><option value="unreported">Não informado</option>{data.participants.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select></th>
                  <th><select aria-label="Filtrar por tipo de documento" value={columnFilters.document_type} onChange={(e) => setColumnFilter("document_type", e.target.value)}><option value="">Todos</option><option value="invoice">Nota fiscal</option><option value="payroll">Folha de pagamento</option><option value="contract">Contrato</option></select></th>
                  <th><input aria-label="Filtrar por número da nota" placeholder="Buscar..." value={columnFilters.invoice_number} onChange={(e) => setColumnFilter("invoice_number", e.target.value)} /></th>
                  <th><input aria-label="Filtrar por valor" inputMode="decimal" placeholder="Buscar..." value={columnFilters.amount} onChange={(e) => setColumnFilter("amount", e.target.value)} /></th>
                  <th><select aria-label="Filtrar por tipo" value={columnFilters.operation_type} onChange={(e) => setColumnFilter("operation_type", e.target.value)}><option value="">Todos</option><option value="incoming">Entrada</option><option value="outgoing">Saída</option></select></th>
                  <th><select aria-label="Filtrar por classificação NCM" value={columnFilters.ncm_category} onChange={(e) => setColumnFilter("ncm_category", e.target.value)}><option value="">Todas</option><option value="cattle">Gado</option><option value="soy">Soja</option><option value="other">Outros</option></select></th>
                  <th><input aria-label="Filtrar por quantidade de gado" inputMode="numeric" placeholder="Buscar..." value={columnFilters.cattle_quantity} onChange={(e) => setColumnFilter("cattle_quantity", e.target.value)} /></th>
                  <th colSpan="2" className="filter-actions"><button type="button" onClick={clearColumnFilters} disabled={!hasColumnFilters}><X aria-hidden="true" />Limpar filtros</button></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.id} className={selectedSet.has(r.id) ? "is-selected" : ""}>
                    <td className="select-cell"><input type="checkbox" aria-label={`Selecionar nota ${r.invoice_number || r.id}`} checked={selectedSet.has(r.id)} onChange={() => toggle(r.id)} /></td>
                    <td>
                      <input
                        type="date"
                        value={r.issue_date || ""}
                        onChange={(e) =>
                          update(r.id, "issue_date", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <select
                        value={r.producer_id}
                        onChange={(e) =>
                          update(r.id, "producer_id", Number(e.target.value))
                        }
                      >
                        {data.producers.map((p) => (
                          <option value={p.id} key={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{r.farm_name || "Não informada"}</td>
                    <td className="conference-participant" title={r.participant_name || "Não informado"}>
                      <ParticipantPicker participantId={r.participant_id} participantName={r.participant_name} choices={participantChoices} labelsById={participantLabelsById} onChoose={(participantId, participantName) => updateParticipant(r.id, participantId, participantName)} />
                    </td>
                    <td className="conference-document-type">{({ invoice: "Nota fiscal", payroll: "Folha de pagamento", contract: "Contrato" })[r.document_type || "invoice"]}</td>
                    <td>
                      <input
                        value={r.invoice_number || ""}
                        onChange={(e) =>
                          update(r.id, "invoice_number", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <CurrencyInput
                        value={r.amount}
                        onValue={(value) => update(r.id, "amount", value)}
                      />
                    </td>
                    <td>
                      <select className={`operation-select ${r.operation_type || "outgoing"} ${r.is_reviewed ? "reviewed" : "pending-review"}`} title={r.is_reviewed ? "Nota conferida" : "Nota pendente de conferência"} aria-label={`${r.operation_type === "incoming" ? "Entrada" : "Saída"} — ${r.is_reviewed ? "nota conferida" : "nota pendente de conferência"}`} value={r.operation_type || "outgoing"} onChange={(e) => update(r.id, "operation_type", e.target.value)}>
                        <option value="incoming">Entrada</option>
                        <option value="outgoing">Saída</option>
                      </select>
                    </td>
                    <td>
                      <select className={`ncm-category-select ${r.ncm_category || "other"}`} title={r.ncm_codes || "NCM não informado"} value={r.ncm_category || "other"} onChange={(e) => setRows(current => current.map(row => row.id === r.id ? { ...row, ncm_category: e.target.value, cattle_quantity: e.target.value === "cattle" ? row.cattle_quantity : null, is_reviewed: 0 } : row))}>
                        <option value="cattle">Gado</option>
                        <option value="soy">Soja</option>
                        <option value="other">Outros</option>
                      </select>
                    </td>
                    <td>
                      {r.ncm_category === "cattle" ? <input className="cattle-quantity" type="number" min="0" step="1" inputMode="numeric" placeholder="Quantidade" value={r.cattle_quantity ?? ""} onChange={(e) => update(r.id, "cattle_quantity", e.target.value)} /> : <span className="not-applicable">Não se aplica</span>}
                    </td>
                    <td>{r.is_manual ? <span className="manual-badge">Manual</span> : <ExportMenu row={r} />}</td>
                    <td>
                      <div className="row-actions">
                        {r.is_reviewed ? (
                          <button className="unreview" title="Voltar esta nota para pendente" onClick={() => save(r, 0)}>
                            Desmarcar
                          </button>
                        ) : (
                          <button className="save" onClick={() => save(r, 1)}>
                            Salvar
                          </button>
                        )}
                        <button
                          className="icon danger"
                          onClick={() => setPendingDelete({ kind: "single", id: r.id, number: r.invoice_number })}
                        >
                          <Trash2 />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!filteredRows.length && <tr className="conference-no-results"><td colSpan="13">Nenhum lançamento corresponde aos filtros das colunas.</td></tr>}
              </tbody>
            </table>
            {tablePages > 1 && <div className="conference-pagination">
              <span>{(tablePage - 1) * rowsPerPage + 1}–{Math.min(tablePage * rowsPerPage, filteredRows.length)} de {filteredRows.length} notas</span>
              <div><button type="button" disabled={tablePage === 1} onClick={() => setTablePage(page => page - 1)}>Anterior</button><b>Página {tablePage} de {tablePages}</b><button type="button" disabled={tablePage === tablePages} onClick={() => setTablePage(page => page + 1)}>Próxima</button></div>
            </div>}
          </div>
        ) : (
          <Empty text={producer ? "Nenhuma nota encontrada para os filtros selecionados." : "Selecione um produtor para visualizar as notas."} />
        )}
      </div>
      {producer && <div className="conference-summary">
        <div><small>Total de entradas</small><strong>{money.format(totals.incoming)}</strong></div>
        <div><small>Total de saídas</small><strong>{money.format(totals.outgoing)}</strong></div>
        <div className="balance"><small>Saldo (saídas − entradas)</small><strong>{money.format(totals.outgoing - totals.incoming)}</strong></div>
      </div>}
      {pendingDelete && <ConfirmDialog title={pendingDelete.kind === "bulk" ? "Excluir notas selecionadas" : "Excluir nota"} message={pendingDelete.kind === "bulk" ? `Deseja excluir permanentemente ${selected.length} nota(s) selecionada(s)?` : `Deseja excluir a nota ${pendingDelete.number || pendingDelete.id}? Essa ação não poderá ser desfeita.`} close={() => setPendingDelete(null)} confirm={() => pendingDelete.kind === "bulk" ? removeSelected() : remove(pendingDelete.id)} loading={bulkBusy} />}
      {showManual && <Modal title="Lançamento manual" close={() => setShowManual(false)}>
        <form className="modal-form manual-invoice-form" onSubmit={createManual}>
          <label>Tipo do arquivo<select required value={manual.document_type} onChange={(e) => setManual({ ...manual, document_type: e.target.value, ncm_category: e.target.value === "invoice" ? manual.ncm_category : "other", cattle_quantity: "" })}><option value="invoice">Nota fiscal</option><option value="payroll">Folha de pagamento</option><option value="contract">Contrato</option></select></label>
          <label>Produtor<select required value={manual.producer_id} onChange={(e) => setManual({ ...manual, producer_id: e.target.value, farm_id: "" })}><option value="" disabled>Selecione o produtor</option>{data.producers.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
          <label>Fazenda<select value={manual.farm_id} disabled={!manual.producer_id} onChange={(e) => setManual({ ...manual, farm_id: e.target.value })}><option value="">Não informada</option>{data.farms.filter((f) => String(f.producer_id) === String(manual.producer_id)).map((f) => <option value={f.id} key={f.id}>{f.name}</option>)}</select></label>
          <label>Participante<select value={manual.participant_id} onChange={(e) => setManual({ ...manual, participant_id: e.target.value })}><option value="">Não informado</option>{data.participants.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
          <label>Data de emissão<input type="date" required value={manual.issue_date} onChange={(e) => setManual({ ...manual, issue_date: e.target.value })} /></label>
          <label>Número/identificação do documento<input required value={manual.invoice_number} onChange={(e) => setManual({ ...manual, invoice_number: e.target.value })} /></label>
          <label>Valor<CurrencyInput value={manual.amount} onValue={(amount) => setManual({ ...manual, amount })} /></label>
          <label>Tipo<select value={manual.operation_type} onChange={(e) => setManual({ ...manual, operation_type: e.target.value })}><option value="incoming">Entrada</option><option value="outgoing">Saída</option></select></label>
          {manual.document_type === "invoice" && <label>Classificação<select value={manual.ncm_category} onChange={(e) => setManual({ ...manual, ncm_category: e.target.value, cattle_quantity: e.target.value === "cattle" ? manual.cattle_quantity : "" })}><option value="cattle">Gado</option><option value="soy">Soja</option><option value="other">Outros</option></select></label>}
          {manual.document_type === "invoice" && manual.ncm_category === "cattle" && <label>Quantidade de gado<input type="number" min="0" step="1" required value={manual.cattle_quantity} onChange={(e) => setManual({ ...manual, cattle_quantity: e.target.value })} /></label>}
          {manualError && <div className="error">{manualError}</div>}
          <div className="actions"><button type="button" onClick={() => setShowManual(false)}>Cancelar</button><button className="primary" disabled={manualBusy}>{manualBusy ? "Salvando..." : "Salvar lançamento"}</button></div>
        </form>
      </Modal>}
    </>
  );
}

const annualMonths = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

function AnnualSummary({ data }) {
  const [producer, setProducer] = useState("");
  const [farm, setFarm] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [years, setYears] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState(() => new Date());
  const farms = data.farms.filter(item => !producer || String(item.producer_id) === producer);
  const selectedProducer = data.producers.find(item => String(item.id) === producer);
  const selectedFarm = farms.find(item => String(item.id) === farm);
  const totals = rows.reduce((sum, row) => ({
    revenue: sum.revenue + Number(row.revenue || 0),
    expenses: sum.expenses + Number(row.expenses || 0)
  }), { revenue: 0, expenses: 0 });

  useEffect(() => {
    api("/invoice-years").then(values => setYears([...new Set([String(new Date().getFullYear()), ...values])]));
  }, []);
  useEffect(() => {
    if (!producer) { setRows([]); return; }
    setLoading(true);
    api(`/annual-summary?producer_id=${producer}&farm_id=${farm}&year=${year}`)
      .then(setRows)
      .finally(() => setLoading(false));
  }, [producer, farm, year]);

  const exportIrpf = () => {
    const selectedProducer = data.producers.find(item => String(item.id) === producer);
    const cpf = String(selectedProducer?.cpf || "").replace(/\D/g, "");
    if (cpf.length !== 11) return alert("O produtor precisa ter um CPF válido para exportar o arquivo do IRPF.");
    const cleanName = String(selectedProducer.name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 .'-]/g, "").toUpperCase().slice(0, 60);
    const moneyField = value => {
      const cents = Math.round(Number(value || 0) * 100);
      if (!Number.isSafeInteger(cents) || cents < 0 || String(cents).length > 13) throw new Error("Há um valor fora do limite aceito pelo arquivo do IRPF.");
      return String(cents).padStart(13, "0");
    };
    try {
      const exercise = String(Number(year) + 1);
      const lines = [
        `IRARURAL  ${exercise}${year}${cpf}100`,
        `01${cpf}${cleanName.padEnd(60, " ")}${year}${"".padEnd(128, " ")}`,
        `02105${"REAL".padEnd(30, " ")}`,
        ...rows.map((row, index) => `04${String.fromCharCode(65 + index)}${moneyField(row.revenue)}${moneyField(row.expenses)}${"0".repeat(39)}105`)
      ];
      let crc = 0xffffffff;
      for (const byte of new TextEncoder().encode(lines.join(""))) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
      lines.push(`99${String((crc ^ 0xffffffff) >>> 0).padStart(10, "0")}`);
      const blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${cpf}-ARURAL-${year}-${year}-EXPORTA-IRPF${exercise}.DEC`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { alert(error.message); }
  };
  const printReport = () => {
    setGeneratedAt(new Date());
    setTimeout(() => window.print(), 0);
  };
  const generatedDate = generatedAt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const generatedTime = generatedAt.toLocaleTimeString("pt-BR");

  return <>
    <div className="toolbar annual-summary-toolbar">
      <div>
        <p className="eyebrow">LIVRO-CAIXA DO PRODUTOR RURAL</p>
        <h1>Resumo anual do produtor</h1>
        <p>Receitas e despesas organizadas por mês para facilitar a declaração do imposto de renda.</p>
      </div>
      {producer && rows.length > 0 && <div className="annual-summary-actions">
        <button className="outline compact" onClick={printReport}><Printer />Imprimir relatório</button>
        <button className="outline compact" onClick={exportIrpf}><Download />Exportar para o IRPF</button>
      </div>}
    </div>
    <div className="filters annual-summary-filters">
      <label>Produtor
        <select value={producer} onChange={(event) => { setProducer(event.target.value); setFarm(""); }}>
          <option value="">Selecione um produtor</option>
          {data.producers.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label>Fazenda
        <select value={farm} disabled={!producer} onChange={(event) => setFarm(event.target.value)}>
          <option value="">Todas as fazendas</option>
          {farms.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label>Ano
        <select value={year} onChange={(event) => setYear(event.target.value)}>
          {years.map(value => <option value={value} key={value}>{value}</option>)}
        </select>
      </label>
    </div>
    {producer ? <section className="annual-report">
      <div className="annual-report-head">
        <div><span>Receitas e despesas</span><small>Livro-caixa do produtor rural</small></div>
        <span className="annual-report-badge">Brasil</span>
      </div>
      <div className="annual-report-identification">
        <div className="annual-report-generated"><b>Campo Certo · Relatório anual</b><span>{generatedDate}<br />{generatedTime}</span></div>
        <div className="annual-report-details">
          <p><b>Produtor:</b> {selectedProducer?.name} <span>·</span> <b>CPF:</b> {maskCpf(selectedProducer?.cpf)}</p>
          <p><b>Endereço:</b> {formatAddress(selectedProducer || {}) || "Não informado"}</p>
          <p><b>Fazenda:</b> {selectedFarm?.name || "Todas as fazendas"}{selectedFarm?.state_registration ? ` · IE: ${maskIe(selectedFarm.state_registration)}` : ""}</p>
          <p><b>Ano-calendário:</b> {year}</p>
        </div>
      </div>
      {loading ? <Empty text="Calculando o resumo anual..." /> : <div className="annual-table-wrap">
        <table className="annual-table">
          <thead><tr><th>Mês</th><th>Receita bruta</th><th>Despesa de custeio<br />e investimento</th></tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={row.month}><th scope="row">{annualMonths[index]}</th><td>{money.format(row.revenue)}</td><td>{money.format(row.expenses)}</td></tr>)}
          </tbody>
          <tfoot><tr><th>Total</th><td>{money.format(totals.revenue)}</td><td>{money.format(totals.expenses)}</td></tr></tfoot>
        </table>
      </div>}
      <p className="annual-report-note">Os valores consideram as notas classificadas na Conferência: saídas como receitas e entradas como despesas.</p>
    </section> : <div className="list-card"><Empty text="Selecione um produtor para gerar o resumo anual." /></div>}
  </>;
}

function CattleSummary({ data }) {
  const [producer, setProducer] = useState("");
  const [farm, setFarm] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [years, setYears] = useState([]);
  const [rows, setRows] = useState([]);
  const [reference, setReference] = useState({ acquisitions: 0, sales: 0, informed_notes: 0, cattle_notes: 0 });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const farms = data.farms.filter(item => !producer || String(item.producer_id) === producer);

  useEffect(() => {
    api("/invoice-years").then(values => {
      const current = String(new Date().getFullYear());
      setYears([...new Set([current, ...values])]);
      if (values.length && !values.includes(current)) setYear(values[0]);
    });
  }, []);

  useEffect(() => {
    if (!producer) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true); setMessage(""); setError("");
    api(`/animal-stock?producer_id=${producer}&farm_id=${farm}&year=${year}`)
      .then(result => { setRows(result.rows); setReference(result.reference); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [producer, farm, year]);

  const update = (code, field, value) => setRows(current => current.map(row => row.code === code ? { ...row, [field]: value === "" ? "" : Math.max(0, Math.trunc(Number(value) || 0)) } : row));
  const finalStock = row => Number(row.initial_stock || 0) + Number(row.acquisitions || 0) + Number(row.births || 0) - Number(row.consumption_losses || 0) - Number(row.sales || 0);
  const save = async () => {
    setSaving(true); setMessage(""); setError("");
    try {
      await api('/animal-stock', { method: 'PUT', body: JSON.stringify({ producer_id: Number(producer), farm_id: farm ? Number(farm) : 0, year: Number(year), rows }) });
      setMessage('Movimentação de animais salva com sucesso.');
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };
  const totalStock = rows.reduce((total, row) => total + finalStock(row), 0);

  return <>
    <div className="toolbar">
      <div>
        <h1>Estoque e movimentação de animais</h1>
        <p>Registre as informações do rebanho conforme a ficha de movimentação do IRPF.</p>
      </div>
    </div>
    <div className="filters animal-filters">
      <label>
        Ano
        <select value={year} onChange={(event) => setYear(event.target.value)}>
          {years.map(value => <option value={value} key={value}>{value}</option>)}
        </select>
      </label>
      <label>
        Produtor
        <select value={producer} onChange={(event) => { setProducer(event.target.value); setFarm(""); }}>
          <option value="">Selecione um produtor</option>
          {data.producers.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label>
        Fazenda
        <select value={farm} disabled={!producer} onChange={(event) => setFarm(event.target.value)}>
          <option value="">Todas as fazendas</option>
          {farms.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </label>
    </div>
    {producer ? <section className="animal-stock-card">
      <div className="animal-stock-head">
        <div><p className="eyebrow">MOVIMENTAÇÃO DO REBANHO · BRASIL</p><h2>Estoque total em {year}</h2><small>O estoque final é calculado por: inicial + aquisições + nascimentos − consumo e perdas − vendas.</small></div>
        <div className="animal-stock-total"><small>Estoque final total</small><strong>{loading ? "…" : totalStock.toLocaleString("pt-BR")}</strong></div>
      </div>
      {loading ? <Empty text="Carregando movimentação de animais..." /> : <div className="animal-stock-table-wrap"><table className="animal-stock-table">
        <thead><tr><th>Cód.</th><th>Espécie</th><th>Estoque inicial</th><th>Aquisições</th><th>Nascimentos</th><th>Consumo e perdas</th><th>Vendas</th><th>Estoque final</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.code}>
          <td>{row.code}</td><th scope="row">{row.name}</th>
          {['initial_stock','acquisitions','births','consumption_losses','sales'].map(field => <td key={field}><input type="number" min="0" step="1" inputMode="numeric" value={row[field]} onChange={event => update(row.code, field, event.target.value)} /></td>)}
          <td className={finalStock(row) < 0 ? 'negative' : ''}><b>{finalStock(row).toLocaleString('pt-BR')}</b></td>
        </tr>)}</tbody>
      </table></div>}
      <div className="animal-stock-reference"><div><b>Referência das notas de bovinos e bufalinos</b><span>Aquisições nas notas: {Number(reference.acquisitions || 0).toLocaleString('pt-BR')} · Vendas nas notas: {Number(reference.sales || 0).toLocaleString('pt-BR')} · {reference.informed_notes || 0} de {reference.cattle_notes || 0} notas com quantidade.</span></div><small>Use esta conferência como apoio ao preenchimento da linha 1.</small></div>
      {error && <div className="error">{error}</div>}{message && <div className="success"><CheckCircle2 />{message}</div>}
      <div className="animal-stock-actions"><button className="primary compact" disabled={saving || loading} onClick={save}>{saving ? 'Salvando...' : 'Salvar movimentação'}</button></div>
    </section> : <div className="list-card"><Empty text="Selecione um produtor para preencher o estoque de animais." /></div>}
  </>;
}

function Modal({ title, close, children }) {
  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="modal">
        <div className="modal-head">
          <div>
            <p className="eyebrow">CADASTRO</p>
            <h2>{title}</h2>
          </div>
          <button className="icon" onClick={close}>
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function ConfirmDialog({ title, message, close, confirm, loading = false }) {
  return <Modal title={title} close={close}>
    <div className="confirm-dialog">
      <div className="confirm-symbol"><Trash2 /></div>
      <p>{message}</p>
      <div className="actions">
        <button type="button" onClick={close} disabled={loading}>Cancelar</button>
        <button type="button" className="confirm-delete" onClick={confirm} disabled={loading}>{loading ? "Excluindo..." : "Excluir"}</button>
      </div>
    </div>
  </Modal>;
}
function Empty({ text }) {
  return (
    <div className="empty">
      <div>
        <Sprout />
      </div>
      <h3>{text}</h3>
      <p>Os dados cadastrados aparecerão aqui.</p>
    </div>
  );
}
function App() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user"));
    } catch {
      return null;
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  useEffect(() => {
    if (!user || !localStorage.getItem("token")) return;
    api("/me").then(current => { localStorage.setItem("user", JSON.stringify(current)); setUser(current); }).catch(() => {});
  }, []);
  const toggleTheme = () => setTheme((current) => current === "dark" ? "light" : "dark");
  return user ? (
    <Shell
      user={user}
      theme={theme}
      onThemeToggle={toggleTheme}
      onLogout={() => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setUser(null);
      }}
    />
  ) : (
    <Auth onAuth={setUser} theme={theme} onThemeToggle={toggleTheme} />
  );
}
createRoot(document.getElementById("root")).render(<App />);
