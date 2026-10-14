// Visualização em janela separada, sempre a mesma (mesmo nome): quem usa dois monitores arrasta a janela
// para o lado uma vez e cada nota aberta depois aparece nela, enquanto a Conferência fica na outra tela.
const PREVIEW_WINDOW = "campo-certo-visualizacao";
const PAGE_WIDTH_PX = 750; // largura da DANFE (198 mm) sem zoom

export function openPreviewWindow(row) {
  // Primeira abertura: centralizada sobre o Campo Certo, quase da altura da tela. Se a janela já existe,
  // o navegador ignora posição e tamanho e ela continua onde o usuário deixou (ex.: no segundo monitor).
  const width = Math.min(1000, screen.availWidth - 40);
  const height = Math.min(1050, screen.availHeight - 40);
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
  const top = Math.round(window.screenY + Math.max(0, (window.outerHeight - height) / 2));
  const win = window.open("", PREVIEW_WINDOW, `popup,width=${width},height=${height},left=${left},top=${top}`);
  if (!win) return null;
  win.document.open();
  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Nota ${String(row.invoice_number || "").replace(/[<&]/g, "")}</title>
<style>html,body{margin:0;overflow-x:hidden;background:#e8ece8;font-family:system-ui,sans-serif}#status{padding:40px;text-align:center;color:#30483a}#page{width:max-content;margin:16px auto;display:grid;gap:12px}#page .df-page{box-shadow:0 4px 22px #0002}</style>
</head><body><div id="status">Montando a visualização da nota...</div><div id="page" hidden></div></body></html>`);
  win.document.close();
  win.focus();
  return win;
}

export async function showInPreviewWindow(win, xml) {
  const { renderDanfePreview } = await import("./danfe.js");
  const doc = win.document;
  const page = doc.getElementById("page");
  renderDanfePreview(page, xml);
  // A nota acompanha a largura da janela (ao maximizar no segundo monitor ela cresce junto).
  const fit = () => { page.style.zoom = Math.min(3, Math.max(0.6, (doc.documentElement.clientWidth - 60) / PAGE_WIDTH_PX)); };
  fit();
  win.onresize = fit;
  doc.getElementById("status").remove();
  page.hidden = false;
}
