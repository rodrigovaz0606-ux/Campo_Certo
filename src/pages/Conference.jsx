import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, FileText, CheckCircle2, X, Download, Eye, Filter } from "lucide-react";
import { money, maskIe } from "../format";
import { api, invoiceXml } from "../api";
import { CurrencyInput, Modal, ConfirmDialog, Empty } from "../components";
import { AttachmentsButton, uploadAttachments, checkAttachmentFiles, attachmentAccept } from "./Attachments";

export function ExportMenu({ row }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewXml, setPreviewXml] = useState("");
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const optionsRef = useRef(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = menuRef.current.getBoundingClientRect();
    const options = optionsRef.current.getBoundingClientRect();
    const left = trigger.left - options.width - 8;
    setMenuPosition({
      left: Math.max(8, Math.min(left >= 8 ? left : trigger.left, window.innerWidth - options.width - 8)),
      top: Math.max(8, Math.min(trigger.top, window.innerHeight - options.height - 8)),
    });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const closeMenu = (event) => {
      if (!event || (!menuRef.current?.contains(event.target) && !optionsRef.current?.contains(event.target))) setOpen(false);
    };
    const escapeMenu = event => {
      if (event.key === "Escape") { setOpen(false); menuRef.current?.querySelector('button')?.focus(); }
    };
    const scrollArea = menuRef.current?.closest(".table-wrap");
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", escapeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu);
    scrollArea?.addEventListener("scroll", closeMenu, { passive: true });
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", escapeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu);
      scrollArea?.removeEventListener("scroll", closeMenu);
    };
  }, [open]);
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
    try { const response = await invoiceXml(row); const { exportDanfePdf } = await import("../danfe.js"); await exportDanfePdf(await response.text()); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <><div className="export-wrap"><div className={`export-menu${open ? " open" : ""}`} ref={menuRef}>
    <button type="button" className="export-trigger" disabled={busy} aria-expanded={open} onClick={() => setOpen(value => !value)}><Download />{busy ? "Aguarde..." : "Exportar"}</button>
    {open && createPortal(<div className="export-options export-options-floating" ref={optionsRef} style={menuPosition} onClick={() => setOpen(false)}>
      <button onClick={preview}><Eye /><span><b>Visualizar nota</b><small>Abrir conferência rápida</small></span></button>
      <button onClick={downloadXml}><FileText /><span><b>XML original</b><small>Baixar arquivo fiscal</small></span></button>
      <button onClick={downloadDanfe}><Download /><span><b>DANFE em PDF</b><small>Gerar documento auxiliar</small></span></button>
    </div>, document.body)}
  </div>{error && <span className="export-error" title={error}>Falha ao abrir a nota</span>}</div>{previewXml && <DanfePreview xml={previewXml} close={() => setPreviewXml("")} />}</>;
}

export function DanfePreview({ xml, close }) {
  const content = useRef(null);
  useEffect(() => {
    let active = true;
    import("../danfe.js").then(({ renderDanfePreview }) => {
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

export function ParticipantPicker({ participantId, participantName, choices, labelsById, onChoose }) {
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

// Verificações que apontam notas com informação faltando ou suspeita na Conferência.
export const conferenceIssues = [
  { key: "pending", tone: "warn", label: "não conferida(s)", help: "Notas que ainda não foram salvas como conferidas.", test: (row) => !row.is_reviewed },
  { key: "farm", tone: "warn", label: "sem fazenda", help: "Notas sem fazenda vinculada.", test: (row) => !row.farm_id },
  { key: "participant", tone: "warn", label: "sem participante", help: "Notas sem participante (cliente ou fornecedor).", test: (row) => !row.participant_id },
  { key: "cattle", tone: "warn", label: "de gado sem quantidade", help: "Notas de gado sem a quantidade de cabeças (normalmente vendas por peso).", test: (row) => row.ncm_category === "cattle" && (row.cattle_quantity === null || row.cattle_quantity === undefined || row.cattle_quantity === "") },
  { key: "duplicate", tone: "danger", label: "possível(is) duplicada(s)", help: "Mesmo participante, número, valor e tipo aparecendo mais de uma vez (por exemplo, nota importada e também lançada à mão)." },
];

export function Conference({ data }) {
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
    [issueFilter, setIssueFilter] = useState(""),
    [manualFiles, setManualFiles] = useState([]),
    [issueIds, setIssueIds] = useState(null),
    [manual, setManual] = useState({ producer_id: "", farm_id: "", participant_id: "", document_type: "invoice", issue_date: new Date().toISOString().slice(0, 10), invoice_number: "", amount: 0, operation_type: "outgoing", ncm_category: "other", cattle_quantity: "" }),
    [columnFilters, setColumnFilters] = useState({
      issue_date: "", producer_id: "", farm_id: "", participant_id: "", document_type: "", invoice_number: "",
      amount: "", operation_type: "", ncm_category: "", cattle_quantity: "",
    });
  const farms = data.farms.filter(
    (f) => !producer || String(f.producer_id) === producer,
  );
  const issues = useMemo(() => {
    const keyOf = (row) => [row.participant_id || row.participant_name || "", String(row.invoice_number || "").replace(/^0+/, ""), Number(row.amount || 0).toFixed(2), row.operation_type].join("|");
    const repeated = rows.reduce((map, row) => map.set(keyOf(row), (map.get(keyOf(row)) || 0) + 1), new Map());
    return conferenceIssues.map((issue) => ({ ...issue, test: issue.key === "duplicate" ? (row) => repeated.get(keyOf(row)) > 1 : issue.test }))
      .map((issue) => ({ ...issue, count: rows.filter(issue.test).length }));
  }, [rows]);
  // As notas do filtro ficam fixas desde o clique, para a linha não sumir enquanto é corrigida.
  const chooseIssue = (issue) => {
    const next = issueFilter === issue.key ? "" : issue.key;
    setIssueFilter(next);
    setIssueIds(next ? new Set(rows.filter(issue.test).map((row) => row.id)) : null);
  };
  const filteredRows = useMemo(() => rows.filter((row) => {
    if (issueIds && !issueIds.has(row.id)) return false;
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
  }), [rows, columnFilters, issueIds]);
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
  useEffect(() => setTablePage(1), [producer, farm, ncmCategory, period, year, month, columnFilters, issueFilter]);
  useEffect(() => { setIssueFilter(""); setIssueIds(null); }, [producer, farm, ncmCategory, period, year, month]);
  useEffect(() => { if (tablePage > tablePages) setTablePage(tablePages); }, [tablePage, tablePages]);
  const setColumnFilter = (key, value) => setColumnFilters(current => ({ ...current, [key]: value }));
  const hasColumnFilters = Object.values(columnFilters).some(Boolean) || Boolean(issueFilter);
  const clearColumnFilters = () => { setIssueFilter(""); setIssueIds(null); setColumnFilters({
    issue_date: "", producer_id: "", farm_id: "", participant_id: "", document_type: "", invoice_number: "",
    amount: "", operation_type: "", ncm_category: "", cattle_quantity: "",
  }); };
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
    setManualFiles([]);
    setShowManual(true);
  };
  const createManual = async (event) => {
    event.preventDefault();
    const fileProblem = checkAttachmentFiles(manualFiles);
    if (fileProblem) return setManualError(fileProblem);
    setManualBusy(true); setManualError("");
    try {
      const created = await api("/invoices/manual", { method: "POST", body: JSON.stringify(manual) });
      try { await uploadAttachments(created.id, manualFiles); }
      catch (error) { throw new Error(`O lançamento foi salvo, mas o anexo não foi enviado (${error.message}). Anexe de novo pelo clipe na grade.`); }
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
      const { exportMultipleDanfePdf } = await import("../danfe.js");
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
        {producer && rows.length > 0 && !loading && <div className="conference-issues" role="group" aria-label="Pendências da conferência">
          <span>Pendências</span>
          {issues.some((issue) => issue.count || issueFilter === issue.key) ? issues.filter((issue) => issue.count || issueFilter === issue.key).map((issue) => (
            <button type="button" key={issue.key} className={`issue-chip ${issue.tone}${issueFilter === issue.key ? " active" : ""}`} aria-pressed={issueFilter === issue.key}
              title={issue.help} onClick={() => chooseIssue(issue)}>
              <b>{issue.count.toLocaleString("pt-BR")}</b>{issue.label}
            </button>
          )) : <span className="issue-ok"><CheckCircle2 />Nenhuma pendência nas notas deste filtro.</span>}
          {issueFilter && <button type="button" className="issue-clear" onClick={() => { setIssueFilter(""); setIssueIds(null); }}><X />Mostrar todas</button>}
        </div>}
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
                    <td>{r.is_manual ? <div className="manual-cell"><span className="manual-badge">Manual</span><AttachmentsButton row={r} onChange={(id, count) => setRows(current => current.map(item => item.id === id ? { ...item, attachment_count: count } : item))} /></div> : <ExportMenu row={r} />}</td>
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
          <label className="manual-files">Comprovantes (opcional)
            <input type="file" multiple accept={attachmentAccept} onChange={(e) => setManualFiles([...e.target.files])} />
            <small className="field-help">{manualFiles.length ? `${manualFiles.length} arquivo(s) selecionado(s)` : "PDF ou imagem, até 10 MB cada."}</small>
          </label>
          {manualError && <div className="error">{manualError}</div>}
          <div className="actions"><button type="button" onClick={() => setShowManual(false)}>Cancelar</button><button className="primary" disabled={manualBusy}>{manualBusy ? "Salvando..." : "Salvar lançamento"}</button></div>
        </form>
      </Modal>}
    </>
  );
}
