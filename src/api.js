export function companyHeaders() {
  const selected = sessionStorage.getItem("active-company");
  try {
    return selected && JSON.parse(localStorage.getItem("user"))?.is_admin ? { "X-Company-Id": selected } : {};
  } catch { return {}; }
}

export function api(path, options = {}) {
  const token = localStorage.getItem("token");
  const headers = {
    ...(options.body instanceof FormData
      ? {}
      : { "Content-Type": "application/json" }),
    ...companyHeaders(),
    ...options.headers,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`/api${path}`, { ...options, headers })
    .then(async (r) => {
      const body = r.status === 204 ? "" : await r.text();
      let data = null;
      if (body) {
        try { data = JSON.parse(body); }
        catch { data = { error: "O servidor retornou uma resposta inválida." }; }
      }
      if (r.status === 401 && token) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        sessionStorage.removeItem("active-company");
        location.reload();
      }
      if (!r.ok) throw new Error(data?.error || `Não foi possível concluir a operação (erro ${r.status}).`);
      return data;
    })
    .catch((error) => {
      if (error instanceof TypeError) throw new Error("Não foi possível conectar ao servidor. Verifique se o backend está em execução.");
      throw error;
    });
}

export async function invoiceXml(row) {
  const response = await fetch(`/api/invoices/${row.id}/xml`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("token")}`, ...companyHeaders() },
  });
  if (!response.ok) throw new Error("Não foi possível obter o XML desta nota.");
  return response;
}

// Baixa um arquivo protegido pela sessão (anexos, relatórios) e o entrega ao navegador.
export async function downloadFile(path, filename) {
  const response = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}`, ...companyHeaders() } });
  if (!response.ok) throw new Error("Não foi possível baixar o arquivo.");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
