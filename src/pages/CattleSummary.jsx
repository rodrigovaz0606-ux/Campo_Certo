import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { api } from "../api";
import { Empty, Loading } from "../components";

export function CattleSummary({ data }) {
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
      {loading ? <Loading text="Carregando movimentação de animais..." /> : <div className="animal-stock-table-wrap"><table className="animal-stock-table">
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
