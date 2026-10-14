import { useEffect, useState } from "react";
import { Sprout, LayoutDashboard, Users, Tractor, UserRound, Upload, LogOut, FileText, X, Menu, PanelLeftClose, PanelLeftOpen, BarChart3, TableProperties } from "lucide-react";
import { CompanySwitcher } from "./CompanyControls";
import { api } from "./api";
import { ThemeToggle } from "./components";
import { UserManagement } from "./pages/Users";
import { Dashboard } from "./pages/Dashboard";
import { Crud } from "./pages/Registry";
import { Importer } from "./pages/Importer";
import { Conference } from "./pages/Conference";
import { AnnualSummary } from "./pages/AnnualSummary";
import { CattleSummary } from "./pages/CattleSummary";

export const nav = [
  ["dashboard", "Visão geral", LayoutDashboard],
  ["producers", "Produtores", Users],
  ["farms", "Fazendas", Tractor],
  ["participants", "Participantes", UserRound],
  ["import", "Importar notas", Upload],
  ["conference", "Conferência", FileText],
  ["annual-summary", "Resumo anual", TableProperties],
  ["cattle-summary", "Estoque de animais", BarChart3],
];

// Cada tela tem um endereço próprio (#/conferencia...), então F5, favoritos e o "voltar" do navegador funcionam.
export const routes = {
  dashboard: "", producers: "produtores", farms: "fazendas", participants: "participantes", import: "importar",
  conference: "conferencia", "annual-summary": "resumo-anual", "cattle-summary": "estoque-animais", users: "usuarios",
};

export const hashSlug = () => decodeURIComponent(location.hash.replace(/^#\/?/, ""));

export const pageFromHash = () => Object.keys(routes).find((id) => routes[id] === hashSlug()) || "dashboard";

export function Shell({ user, onLogout, theme, onThemeToggle }) {
  const [requestedPage, setRequestedPage] = useState(pageFromHash),
    [open, setOpen] = useState(false),
    [sidebarCollapsed, setSidebarCollapsed] = useState(
      () => localStorage.getItem("sidebar-collapsed") === "true",
    );
  const availableNav = user.is_admin ? [...nav, ["users", "Usuários", Users]] : nav;
  const page = availableNav.some(([id]) => id === requestedPage) ? requestedPage : "dashboard";
  useEffect(() => {
    const sync = () => setRequestedPage(pageFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const setPage = (id) => {
    setRequestedPage(id);
    if (hashSlug() !== routes[id]) location.hash = `/${routes[id]}`;
    window.scrollTo(0, 0);
  };
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
          <CompanySwitcher user={user} api={api} />
          <ThemeToggle theme={theme} onToggle={onThemeToggle} />
          <span className="today">Safra organizada, decisão segura.</span>
        </header>
        <Page id={page} navigate={setPage} user={user} />
      </main>
    </div>
  );
}

export function useData() {
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

export function Page({ id, navigate, user }) {
  const [data, reload] = useData();
  if (id === "dashboard") return <Dashboard navigate={navigate} data={data} />;
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
