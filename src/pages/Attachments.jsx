import { useEffect, useState } from "react";
import { Paperclip, Download, Trash2, Upload } from "lucide-react";
import { api, downloadFile } from "../api";
import { fileSize } from "../format";
import { Modal } from "../components";

export const attachmentAccept = "application/pdf,image/jpeg,image/png,image/webp";
export const maxAttachmentBytes = 10 * 1024 * 1024;

export async function uploadAttachments(invoiceId, files) {
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    await api(`/invoices/${invoiceId}/attachments`, { method: "POST", body: form });
  }
}

export function checkAttachmentFiles(files) {
  const tooBig = files.find((file) => file.size > maxAttachmentBytes);
  if (tooBig) return `O arquivo ${tooBig.name} passa de 10 MB.`;
  const wrong = files.find((file) => !attachmentAccept.split(",").includes(file.type));
  if (wrong) return `O arquivo ${wrong.name} não é PDF nem imagem (JPG, PNG ou WEBP).`;
  return "";
}

// Botão da grade que mostra quantos comprovantes o lançamento tem e abre a lista.
export function AttachmentsButton({ row, onChange }) {
  const [open, setOpen] = useState(false);
  const count = Number(row.attachment_count || 0);
  return <>
    <button type="button" className={`attachment-button${count ? " has-files" : ""}`} onClick={() => setOpen(true)}
      title={count ? `${count} comprovante(s) anexado(s)` : "Anexar comprovante"} aria-label={count ? `${count} comprovante(s) anexado(s)` : "Anexar comprovante"}>
      <Paperclip />{count || ""}
    </button>
    {open && <AttachmentsModal row={row} close={() => setOpen(false)} onChange={onChange} />}
  </>;
}

function AttachmentsModal({ row, close, onChange }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () => api(`/invoices/${row.id}/attachments`).then((list) => { setItems(list); onChange?.(row.id, list.length); });
  useEffect(() => { load().catch((e) => setError(e.message)); }, [row.id]);
  const add = async (event) => {
    const files = [...event.target.files];
    event.target.value = "";
    const problem = checkAttachmentFiles(files);
    if (problem) return setError(problem);
    setBusy(true); setError("");
    try { await uploadAttachments(row.id, files); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const remove = async (item) => {
    if (!window.confirm(`Excluir o anexo ${item.filename}?`)) return;
    setBusy(true); setError("");
    try { await api(`/attachments/${item.id}`, { method: "DELETE" }); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const download = (item) => downloadFile(`/attachments/${item.id}`, item.filename).catch((e) => setError(e.message));
  return <Modal title={`Comprovantes · ${row.invoice_number || "lançamento"}`} eyebrow="ANEXOS" close={close}>
    <div className="attachments">
      {items === null ? <p className="muted">Carregando...</p> : items.length ? <ul className="attachment-list">
        {items.map((item) => <li key={item.id}>
          <Paperclip />
          <div><b>{item.filename}</b><small>{fileSize(item.size)} · {new Date(item.created_at + "Z").toLocaleDateString("pt-BR")}</small></div>
          <button type="button" className="icon" title="Baixar" aria-label={`Baixar ${item.filename}`} onClick={() => download(item)}><Download /></button>
          <button type="button" className="icon danger" disabled={busy} title="Excluir" aria-label={`Excluir ${item.filename}`} onClick={() => remove(item)}><Trash2 /></button>
        </li>)}
      </ul> : <p className="muted">Nenhum comprovante anexado ainda.</p>}
      {error && <div className="error">{error}</div>}
      <label className={`outline attachment-upload${busy ? " disabled" : ""}`}>
        <Upload />{busy ? "Enviando..." : "Anexar PDF ou imagem"}
        <input type="file" multiple accept={attachmentAccept} disabled={busy} onChange={add} />
      </label>
      <small className="field-help">Até 10 MB por arquivo. Os anexos entram no backup automático.</small>
    </div>
  </Modal>;
}
