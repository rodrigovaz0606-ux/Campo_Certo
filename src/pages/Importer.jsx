import { useState } from "react";
import { Upload, CheckCircle2 } from "lucide-react";
import { api } from "../api";
import { SefazPanel } from "./Sefaz";

export function Importer({ data }) {
  const [files, setFiles] = useState([]),
    [loading, setLoading] = useState(false),
    [processed, setProcessed] = useState(0),
    [result, setResult] = useState(null),
    [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    if (!files.length)
      return setError("Escolha os arquivos ou uma pasta com XMLs.");
    setLoading(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const producerId = form.get("producer_id");
    const farmId = form.get("farm_id");
    const batchSize = 200;
    const consolidated = { imported: 0, duplicates: 0, errors: [] };
    setProcessed(0);
    try {
      for (let start = 0; start < files.length; start += batchSize) {
        const fd = new FormData();
        fd.append("producer_id", producerId);
        if (farmId) fd.append("farm_id", farmId);
        files.slice(start, start + batchSize).forEach((file) => fd.append("files", file));
        const batch = await api("/invoices/import", { method: "POST", body: fd });
        consolidated.imported += batch.imported;
        consolidated.duplicates += batch.duplicates;
        consolidated.errors.push(...batch.errors);
        setProcessed(Math.min(start + batchSize, files.length));
      }
      setResult(consolidated);
      setFiles([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  const pick = (e) =>
    setFiles(
      [...e.target.files].filter((f) => f.name.toLowerCase().endsWith(".xml")),
    );
  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Importar notas fiscais</h1>
          <p>Selecione o destino e envie seus arquivos XML.</p>
        </div>
      </div>
      <form className="import-card" onSubmit={submit}>
        <div className="form-row">
          <label>
            Produtor responsável
            <select name="producer_id" required defaultValue="">
              <option value="" disabled>
                Selecione um produtor
              </option>
              {data.producers.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fazenda (opcional)
            <select name="farm_id" defaultValue="">
              <option value="">Definir depois</option>
              {data.farms.map((f) => (
                <option value={f.id} key={f.id}>
                  {f.name} — {f.producer_name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="drop">
          <Upload />
          <h3>Arraste ou selecione seus XMLs</h3>
          <p>
            Você pode escolher vários arquivos de uma só vez ou uma pasta
            completa.
          </p>
          <div className="picker-buttons">
            <label className="outline">
              Escolher arquivos
              <input
                type="file"
                accept=".xml,text/xml,application/xml"
                multiple
                onChange={pick}
              />
            </label>
            <label className="outline">
              Escolher pasta
              <input
                type="file"
                webkitdirectory=""
                directory=""
                multiple
                onChange={pick}
              />
            </label>
          </div>
          {files.length > 0 && (
            <div className="selected">
              <CheckCircle2 /> {files.length} arquivo(s) XML selecionado(s)
            </div>
          )}
        </div>
        {error && <div className="error">{error}</div>}
        {result && (
          <div className={result.errors.length ? "import-result" : "success"}>
            <div><CheckCircle2 /> {result.imported} nota(s) importada(s){result.duplicates ? ` e ${result.duplicates} duplicada(s) ignorada(s)` : ""}.</div>
            {result.errors.length > 0 && <div className="error-list"><b>{result.errors.length} arquivo(s) não importado(s):</b>{result.errors.map((message, index) => <span key={index}>{message}</span>)}</div>}
          </div>
        )}
        <button
          className="primary import-submit"
          disabled={loading || !data.producers.length}
        >
          {loading ? `Importando... ${processed} de ${files.length}` : "Importar e processar notas"}
        </button>
      </form>
      <SefazPanel data={data} />
    </>
  );
}
