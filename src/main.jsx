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
