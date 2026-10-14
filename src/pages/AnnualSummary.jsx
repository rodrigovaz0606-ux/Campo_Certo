import { useEffect, useState } from "react";
import { Download, Printer, BookOpenCheck } from "lucide-react";
import { money, maskCpf, maskIe, formatAddress, annualMonths } from "../format";
import { api } from "../api";
import { Empty } from "../components";
import { LcdprModal } from "./Lcdpr";

export function AnnualSummary({ data }) {
  const [producer, setProducer] = useState("");
  const [farm, setFarm] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [years, setYears] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState(() => new Date());
  const [showLcdpr, setShowLcdpr] = useState(false);
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
        <button className="outline compact" onClick={() => setShowLcdpr(true)}><BookOpenCheck />Gerar LCDPR</button>
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
    {showLcdpr && selectedProducer && <LcdprModal producer={selectedProducer} year={year} close={() => setShowLcdpr(false)} />}
  </>;
}
