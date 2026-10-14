import { useState } from "react";
import { Plus, Trash2, Search, Pencil } from "lucide-react";
import { maskDoc, maskCpf, maskIe, formatAddress } from "../format";
import { api } from "../api";
import { MaskedNumberInput, AddressFields, Modal, ConfirmDialog, Empty } from "../components";
import { CertificateButton } from "./Sefaz";

export const fields = {
  producers: [
    ["name", "Nome do produtor"],
    ["cpf", "CPF"],
  ],
  participants: [
    ["name", "Nome do participante"],
    ["document", "CPF ou CNPJ"],
  ],
};

export function Crud({ type, title, items, producers, reload }) {
  const [show, setShow] = useState(false),
    [editing, setEditing] = useState(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [ownership, setOwnership] = useState("unique"),
    [partners, setPartners] = useState([{ document: "", share: "" }]);
  const [pendingDelete, setPendingDelete] = useState(null);
  const filtered = items.filter((i) =>
    JSON.stringify(i).toLowerCase().includes(search.toLowerCase()),
  );
  const openNew = () => {
    setEditing(null); setError(""); setOwnership("unique"); setPartners([{ document: "", share: "" }]); setShow(true);
  };
  const openEdit = (item) => {
    setEditing(item); setError(""); setOwnership(item.ownership_type || "unique");
    setPartners(item.partners?.length ? item.partners.map(p => ({ document: maskCpf(p.document), share: String(p.share) })) : [{ document: "", share: "" }]);
    setShow(true);
  };
  const closeModal = () => { setShow(false); setEditing(null); setError(""); };
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await api(`/${type}${editing ? `/${editing.id}` : ""}`, {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      closeModal();
      reload();
    } catch (e) {
      setError(e.message);
    }
  };
  const remove = async (id) => {
    await api(`/${type}/${id}`, { method: "DELETE" });
    setPendingDelete(null);
    reload();
  };
  return (
    <>
      <div className="toolbar">
        <div>
          <h1>{title}</h1>
          <p>Cadastre e consulte as informações da sua operação.</p>
        </div>
        <button className="primary compact" onClick={openNew}>
          <Plus /> Novo cadastro
        </button>
      </div>
      <div className="list-card registry-card">
        <div className="search">
          <Search />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou documento..."
          />
        </div>
        {filtered.length ? (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={`Lista de ${title.toLowerCase()}, com rolagem`}>
            <table>
              <thead>
                <tr>
                  {type === "farms" ? (
                    <>
                      <th>Fazenda</th>
                      <th>Produtor</th>
                      <th>Inscrição Estadual</th>
                      <th>Propriedade</th>
                    </>
                  ) : (
                    <>
                      <th>Nome</th>
                      <th>Documento</th>
                      <th>
                        {type === "producers" ? "Endereço" : "Cadastrado em"}
                      </th>
                    </>
                  )}
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.id}>
                    {type === "farms" ? (
                      <>
                        <td>
                          <b>{i.name}</b>
                          <small>{formatAddress(i)}</small>
                        </td>
                        <td>{i.producer_name}</td>
                        <td>{maskIe(i.state_registration)}</td>
                        <td>
                          <span className="badge">
                            {i.ownership_type === "unique"
                              ? "Proprietário único"
                              : "Com participação"}
                          </span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>
                          <b>{i.name}</b>
                        </td>
                        <td>{maskDoc(i.cpf || i.document)}</td>
                        <td>
                          {formatAddress(i) ||
                            new Date(i.created_at + "Z").toLocaleDateString(
                              "pt-BR",
                            )}
                        </td>
                      </>
                    )}
                    <td><div className="row-actions">
                      {type === "producers" && <CertificateButton producer={i} />}
                      <button className="icon" title="Editar cadastro" aria-label={`Editar ${i.name}`} onClick={() => openEdit(i)}>
                        <Pencil />
                      </button>
                      <button
                        className="icon danger"
                        title="Excluir cadastro"
                        aria-label={`Excluir ${i.name}`}
                        onClick={() => setPendingDelete(i)}
                      >
                        <Trash2 />
                      </button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="Nenhum cadastro encontrado." />
        )}
      </div>
      {show && (
        <Modal
          title={`${editing ? "Editar" : "Novo"} ${type === "farms" ? "cadastro de fazenda" : type === "producers" ? "produtor rural" : "participante"}`}
          close={closeModal}
        >
          <form key={editing?.id || "new"} onSubmit={submit} className="modal-form">
            {type === "farms" ? (
              <>
                <label>
                  Produtor responsável
                  <select name="producer_id" required defaultValue={editing?.producer_id || ""}>
                    <option value="" disabled>
                      Selecione o produtor
                    </option>
                    {producers.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Nome da fazenda
                  <input name="name" required defaultValue={editing?.name || ""} />
                </label>
                <label>
                  Inscrição Estadual
                  <MaskedNumberInput name="state_registration" kind="ie" placeholder="Digite ou cole de 8 a 14 números" defaultValue={editing?.state_registration} />
                  <small className="field-help">Aceita de 8 a 14 dígitos. São Paulo utiliza 12 dígitos.</small>
                </label>
                <AddressFields item={editing || {}} />
                <label>
                  Tipo de propriedade
                  <select name="ownership_type" required value={ownership} onChange={(e) => setOwnership(e.target.value)}>
                    <option value="unique">Proprietário único</option>
                    <option value="shared">Possui participação</option>
                  </select>
                </label>
                {ownership === "shared" && <div className="partners">
                  <div className="partners-title"><div><b>Sócios da fazenda</b><small>Informe o CPF e o percentual de cada sócio.</small></div><button type="button" className="outline" onClick={() => setPartners([...partners, { document: "", share: "" }])}><Plus /> Adicionar sócio</button></div>
                  {partners.map((partner, index) => <div className="partner-row" key={index}>
                    <label>CPF do sócio<MaskedNumberInput value={partner.document} onValue={(document) => setPartners(partners.map((p, i) => i === index ? { ...p, document } : p))} placeholder="111.222.333-44" /></label>
                    <label>Participação (%)<input type="number" inputMode="decimal" min="0.01" max="99.99" step="0.01" required value={partner.share} onChange={(e) => setPartners(partners.map((p, i) => i === index ? { ...p, share: e.target.value } : p))} /></label>
                    {partners.length > 1 && <button type="button" className="icon danger" onClick={() => setPartners(partners.filter((_, i) => i !== index))}><Trash2 /></button>}
                  </div>)}
                  <input type="hidden" name="partners" value={JSON.stringify(partners)} />
                </div>}
              </>
            ) : (<>
              {fields[type].map(([name, label]) => (
                <label key={name}>
                  {label}
                  {name === "cpf" ? (
                    <MaskedNumberInput name={name} kind="cpf" placeholder="111.222.333-44" defaultValue={editing?.[name]} />
                  ) : name === "document" ? (
                    <MaskedNumberInput name={name} kind="document" placeholder="CPF ou CNPJ" defaultValue={editing?.[name]} />
                  ) : (
                    <input name={name} required defaultValue={editing?.[name] || ""} />
                  )}
                </label>
              ))}
              {type === "producers" && <AddressFields item={editing || {}} />}
            </>)}
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button type="button" onClick={closeModal}>
                Cancelar
              </button>
              <button className="primary">{editing ? "Salvar alterações" : "Salvar cadastro"}</button>
            </div>
          </form>
        </Modal>
      )}
      {pendingDelete && <ConfirmDialog title="Excluir cadastro" message={`Deseja realmente excluir ${pendingDelete.name}? Essa ação não poderá ser desfeita.`} close={() => setPendingDelete(null)} confirm={() => remove(pendingDelete.id)} />}
    </>
  );
}
