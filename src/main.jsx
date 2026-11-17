import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { api } from "./api";
import { Auth } from "./pages/Auth";
import { Shell } from "./Shell";
import "./styles.css";
import "./sidebar.css";
import "./partners.css";
import "./export.css";
import "./insights.css";
import "./theme-dark.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((error) => {
      console.warn("Não foi possível registrar o aplicativo Campo Certo.", error);
    });
  });
}

// Retorno do SaintSSO: troca o código pela sessão local e volta para a tela inicial.
function SsoCallback({ onAuth }) {
  const [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const voltar = () => { history.replaceState(null, "", "/"); };
    if (params.get("error")) {
      voltar();
      setError(params.get("error") === "access_denied" ? "Seu pacote não inclui o Campo Certo ou o acesso foi negado." : "Não foi possível entrar pelo SaintSSO.");
      return;
    }
    api("/auth/sso/callback", { method: "POST", body: JSON.stringify({ code: params.get("code"), state: params.get("state") }) })
      .then((data) => {
        sessionStorage.removeItem("active-company");
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        voltar();
        onAuth(data.user);
      })
      .catch((e) => { voltar(); setError(e.message); });
  }, []);
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh", gap: 12, textAlign: "center" }}>
      <div>
        {error ? <p className="error">{error}</p> : <p>Entrando pelo SaintSSO…</p>}
        {error && <a href="/">Voltar ao login</a>}
      </div>
    </main>
  );
}

function App() {
  useEffect(() => {
    const syncAccount = event => {
      if (event.key === 'token' || event.key === null) {
        sessionStorage.removeItem('active-company');
        window.location.reload();
      }
    };
    window.addEventListener('storage', syncAccount);
    return () => window.removeEventListener('storage', syncAccount);
  }, []);
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
  const [returning, setReturning] = useState(() => location.pathname === "/callback");
  if (returning && !user) {
    return <SsoCallback onAuth={(u) => { setUser(u); setReturning(false); }} />;
  }
  return user ? (
    <Shell
      user={user}
      theme={theme}
      onThemeToggle={toggleTheme}
      onLogout={() => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        sessionStorage.removeItem("active-company");
        setUser(null);
      }}
    />
  ) : (
    <Auth onAuth={setUser} theme={theme} onThemeToggle={toggleTheme} />
  );
}
createRoot(document.getElementById("root")).render(<App />);
