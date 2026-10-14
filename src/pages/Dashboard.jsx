import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Sprout, Users, Tractor, UserRound, Upload, FileText } from "lucide-react";
import { money, readSaved, saveValue, monthNames, compactMoney, niceMax } from "../format";
import { api } from "../api";
import { Stat, Empty, Loading } from "../components";

export function Dashboard({ navigate, data }) {
  const [d, setD] = useState(null);
  // O produtor escolhido fica lembrado neste navegador para o próximo acesso.
  const [producer, setProducer] = useState(() => readSaved("dashboard-producer"));
  const [farm, setFarm] = useState("");
  const [year, setYear] = useState("");
  const [chartError, setChartError] = useState("");
  useEffect(() => {
    const query = new URLSearchParams();
    if (producer) query.set("producer_id", producer);
    if (producer && farm) query.set("farm_id", farm);
    if (producer && year) query.set("year", year);
    setChartError("");
    api(`/dashboard?${query}`).then(setD).catch((e) => {
      if (producer) { setProducer(""); saveValue("dashboard-producer", ""); }
      setChartError(e.message);
    });
  }, [producer, farm, year]);
  const chooseProducer = (value) => { setProducer(value); setFarm(""); setYear(""); saveValue("dashboard-producer", value); };
  const farms = data.farms.filter((item) => String(item.producer_id) === producer);
  const totals = (d?.monthly || []).reduce((sum, row) => ({ revenue: sum.revenue + row.revenue, expenses: sum.expenses + row.expenses }), { revenue: 0, expenses: 0 });
  const hasInvoices = Boolean(d?.invoices?.total);
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
        />
      </div>
      {!d ? <section className="list-card"><Loading text="Carregando painel..." /></section> : hasInvoices ? (
        <section className="list-card chart-card">
          <div className="chart-card-head">
            <div>
              <h3>Receitas e despesas por mês</h3>
              <p>Saídas contam como receita e entradas como despesa, conforme classificadas na Conferência.</p>
            </div>
          </div>
          <div className="chart-filters">
            <label>Produtor
              <select value={producer} onChange={(e) => chooseProducer(e.target.value)}>
                <option value="">Selecione um produtor</option>
                {data.producers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>Fazenda
              <select value={farm} disabled={!producer} onChange={(e) => { setFarm(e.target.value); setYear(""); }}>
                <option value="">Todas as fazendas</option>
                {farms.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>Ano
              <select value={d.monthly ? d.year : ""} disabled={!d.monthly} onChange={(e) => setYear(e.target.value)}>
                {d.monthly ? [...new Set([d.year, ...d.years])].map((value) => <option value={value} key={value}>{value}</option>) : <option value="">—</option>}
              </select>
            </label>
          </div>
          {chartError && <div className="error">{chartError}</div>}
          {!d.monthly ? <Empty text="Selecione um produtor para ver as receitas e despesas mês a mês." /> : <>
          <div className="chart-totals">
            <div><span><i className="chart-key revenue" />Receitas</span><b>{money.format(totals.revenue)}</b></div>
            <div><span><i className="chart-key expenses" />Despesas</span><b>{money.format(totals.expenses)}</b></div>
            <div><span>Saldo do ano</span><b>{money.format(totals.revenue - totals.expenses)}</b></div>
          </div>
          <MonthlyChart rows={d.monthly} />
          <details className="chart-table">
            <summary>Ver valores em tabela</summary>
            <div className="table-wrap"><table><thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Saldo</th></tr></thead>
              <tbody>{d.monthly.map((row) => <tr key={row.month}><td>{monthNames[row.month - 1]}</td><td>{money.format(row.revenue)}</td><td>{money.format(row.expenses)}</td><td>{money.format(row.revenue - row.expenses)}</td></tr>)}</tbody>
            </table></div>
          </details>
          </>}
        </section>
      ) : (
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
      )}
    </>
  );
}

// Colunas agrupadas por mês (receita e despesa), com tooltip ao passar o mouse ou focar o mês pelo teclado.
export function MonthlyChart({ rows }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(null);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, []);
  const height = 260, left = 72, right = 8, top = 12, bottom = 28;
  const innerWidth = Math.max(0, width - left - right), innerHeight = height - top - bottom;
  const max = niceMax(Math.max(...rows.map((row) => Math.max(row.revenue, row.expenses))));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((step) => step * max);
  const band = innerWidth / 12;
  const barWidth = Math.max(3, Math.min(24, (band - 10) / 2 - 1));
  const y = (value) => top + innerHeight - (value / max) * innerHeight;
  const bar = (x, value) => {
    const h = (value / max) * innerHeight, r = Math.min(4, h, barWidth / 2), base = top + innerHeight;
    if (h <= 0) return "";
    return `M${x},${base}V${base - h + r}Q${x},${base - h} ${x + r},${base - h}H${x + barWidth - r}Q${x + barWidth},${base - h} ${x + barWidth},${base - h + r}V${base}Z`;
  };
  const current = active == null ? null : rows[active];
  return (
    <div className="monthly-chart" ref={wrapRef} onMouseLeave={() => setActive(null)}>
      {width > 0 && <svg width={width} height={height} role="img" aria-label="Gráfico de colunas com receitas e despesas de cada mês">
        {ticks.map((tick) => <g key={tick}>
          <line className={tick ? "chart-grid" : "chart-baseline"} x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
          <text className="chart-axis" x={left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{compactMoney(tick)}</text>
        </g>)}
        {rows.map((row, index) => {
          const x = left + index * band, center = x + band / 2;
          return <g key={row.month}>
            {active === index && <rect className="chart-hover" x={x + 2} y={top} width={band - 4} height={innerHeight} rx="6" />}
            <path className="chart-bar revenue" d={bar(center - barWidth - 1, row.revenue)} />
            <path className="chart-bar expenses" d={bar(center + 1, row.expenses)} />
            <text className="chart-axis" x={center} y={height - 8} textAnchor="middle">{monthNames[index].slice(0, 3)}</text>
            <rect x={x} y={top} width={band} height={innerHeight + bottom} fill="transparent" tabIndex={0}
              aria-label={`${monthNames[index]}: receitas ${money.format(row.revenue)}, despesas ${money.format(row.expenses)}`}
              onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} />
          </g>;
        })}
      </svg>}
      {current && <div className="chart-tooltip" style={{ left: Math.min(Math.max(left + active * band + band / 2, 110), width - 110) }}>
        <b>{monthNames[active]}</b>
        <span><i className="chart-key revenue" />Receitas<strong>{money.format(current.revenue)}</strong></span>
        <span><i className="chart-key expenses" />Despesas<strong>{money.format(current.expenses)}</strong></span>
        <span>Saldo<strong>{money.format(current.revenue - current.expenses)}</strong></span>
      </div>}
    </div>
  );
}
