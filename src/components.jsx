import { useState } from "react";
import { createPortal } from "react-dom";
import { Sprout, Trash2, X, Moon, Sun } from "lucide-react";
import { money, maskCpf, maskCpfCnpj, maskIe, maskCep } from "./format";

export function MaskedNumberInput({ name, kind = "cpf", value, defaultValue = "", onValue, placeholder, required = true }) {
  const format = kind === "document" ? maskCpfCnpj : kind === "ie" ? maskIe : kind === "cep" ? maskCep : maskCpf;
  const [internal, setInternal] = useState(() => format(defaultValue));
  const current = value === undefined ? internal : value;
  const change = (raw) => { const formatted = format(raw); value === undefined ? setInternal(formatted) : onValue(formatted); };
  return <input name={name} value={current} required={required} inputMode="numeric" autoComplete="off" placeholder={placeholder} maxLength={kind === "ie" ? 14 : undefined}
    onKeyDown={(e) => { if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && !/\d/.test(e.key)) e.preventDefault(); }}
    onPaste={(e) => { e.preventDefault(); change(e.clipboardData.getData("text")); }}
    onChange={(e) => change(e.target.value)} />;
}

export function CurrencyInput({ value, onValue }) {
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

export function ThemeToggle({ theme, onToggle }) {
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

export function Stat({ icon: Icon, label, value, sub }) {
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

export function AddressFields({ item = {} }) {
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

// As janelas são desenhadas direto no <body>, para não herdar estilos de onde foram abertas (ex.: células de tabela).
export function Modal({ title, close, children, eyebrow = "CADASTRO" }) {
  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="modal">
        <div className="modal-head">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <button className="icon" onClick={close}>
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ title, message, close, confirm, loading = false }) {
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

export function Empty({ text }) {
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
