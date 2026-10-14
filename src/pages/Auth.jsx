import { useState } from "react";
import { Sprout } from "lucide-react";
import { api } from "../api";
import { ThemeToggle } from "../components";

export function Auth({ onAuth, theme, onThemeToggle }) {
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
      sessionStorage.removeItem("active-company");
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
