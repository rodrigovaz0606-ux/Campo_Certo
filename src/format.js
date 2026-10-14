export const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export const maskDoc = (v) => {
  const s = String(v || "").replace(/\D/g, "");
  return s.length > 11
    ? s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")
    : s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
};

export const maskCpf = (v) => {
  const s = String(v || "").replace(/\D/g, "").slice(0, 11);
  return s.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
};

export const maskCpfCnpj = (v) => {
  const s = String(v || "").replace(/\D/g, "").slice(0, 14);
  return s.length <= 11 ? maskCpf(s) : s.replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
};

export const maskIe = (v) => {
  return String(v || "").replace(/\D/g, "").slice(0, 14);
};

export const maskCep = (v) => String(v || "").replace(/\D/g, "").slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");

export const fileSize = (bytes) => {
  const units = [[1024 ** 3, "GB"], [1024 ** 2, "MB"], [1024, "KB"]];
  const [size, unit] = units.find(([limit]) => bytes >= limit) || [1024, "KB"];
  return `${Math.max(bytes / size, 0.1).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${unit}`;
};

export const readSaved = (key) => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };

export const saveValue = (key, value) => { try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch {} };

export const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export const compactMoney = (value) => {
  if (value >= 1e6) return `R$ ${(value / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (value >= 1e3) return `R$ ${(value / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return `R$ ${value}`;
};

export const niceMax = (value) => {
  if (value <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map((step) => step * magnitude).find((candidate) => candidate >= value);
};

export const formatAddress = item => [
  [item.address, item.address_number].filter(Boolean).join(", "),
  item.block && `Quadra ${item.block}`, item.lot && `Lote ${item.lot}`,
  item.neighborhood, item.zip_code && `CEP ${maskCep(item.zip_code)}`, item.complement
].filter(Boolean).join(" · ");

export const annualMonths = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
