import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Search, Pencil, SearchCheck } from "lucide-react";
import { maskDoc, maskCpf, maskIe, formatAddress } from "../format";
import { api } from "../api";
import { MaskedNumberInput, AddressFields, Modal, ConfirmDialog, Empty, Loading } from "../components";
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

const PAGE_SIZE = 100;
export function Crud({ type, title, items, producers, reload, loading = false }) {
  const [show, setShow] = useState(false),
    [editing, setEditing] = useState(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [ownership, setOwnership] = useState("unique"),
    [partners, setPartners] = useState([{ document: "", share: "" }]);
  const [pendingDelete, setPendingDelete] = useState(null);
  // Consulta da inscrição na SEFAZ: o resultado preenche o formulário (que é remontado com os novos valores).
  const formRef = useRef(null);
  const [draft, setDraft] = useState(null), [formVersion, setFormVersion] = useState(0);
  const [lookup, setLookup] = useState(null), [lookupBusy, setLookupBusy] = useState(false), [lookupError, setLookupError] = useState(""), [lookupUf, setLookupUf] = useState("GO");
  const lookedUp = useRef("");
  const resetLookup = () => { setDraft(null); setLookup(null); setLookupError(""); lookedUp.current = ""; };
  const holderProducer = (result) => producers?.find((item) => item.cpf === result?.document);
  const lookupRegistration = async () => {
    const current = Object.fromEntries(new FormData(formRef.current));
    lookedUp.current = String(current.state_registration || "").replace(/\D/g, "");
    setLookupBusy(true); setLookupError(""); setLookup(null);
    try {
      const result = await api("/cadastro/consulta", { method: "POST", body: JSON.stringify({ ie: current.state_registration, uf: lookupUf, producer_id: current.producer_id || null }) });
      const a = result.address;
      // Sem produtor escolhido, seleciona o titular quando ele já está cadastrado como produtor.
      const owner = holderProducer(result);
      setDraft({ ...current, uf: result.uf || current.uf, city_code: a.cityCode || current.city_code, city_name: a.city ? `${a.city}/${result.uf}` : current.city_name, producer_id: current.producer_id || owner?.id || "", name: current.name || result.tradeName || "", address: a.street || current.address, address_number: a.number || current.address_number, complement: a.complement || current.complement, neighborhood: a.neighborhood || current.neighborhood, zip_code: a.zipCode || current.zip_code });
      setFormVersion((v) => v + 1);
      setLookup(result);
    } catch (e) { setLookupError(e.message); }
    finally { setLookupBusy(false); }
  };
  // Consulta sozinha ao sair do campo da inscrição (ou Enter), quando a inscrição é nova e tem tamanho válido.
  const autoLookup = (event) => {
    if (event.target.name !== "state_registration" || lookupBusy) return;
    const ie = event.target.value.replace(/\D/g, "");
    if (ie.length < 8 || ie === lookedUp.current || ie === (editing?.state_registration || "")) return;
    lookupRegistration();
  };
  const useHolderAsProducer = () => {
    const current = Object.fromEntries(new FormData(formRef.current));
    setDraft({ ...current, producer_id: holderProducer(lookup).id });
    setFormVersion((v) => v + 1);
  };
  const holderRelation = () => {
    if (!lookup) return null;
    const producerId = draft?.producer_id || editing?.producer_id;
    const producerCpf = producers?.find((item) => String(item.id) === String(producerId))?.cpf;
    if (producerCpf && lookup.document === producerCpf) return { ok: true, text: "O titular é o produtor selecionado." };
    if (partners.some((partner) => partner.document.replace(/\D/g, "") === lookup.document)) return { ok: true, text: "O titular é um dos sócios desta fazenda." };
    const owner = holderProducer(lookup);
    if (owner) return { ok: false, text: `O titular é ${owner.name}, que está cadastrado como outro produtor.`, owner };
    return { ok: false, text: "O titular da inscrição na SEFAZ não é o produtor selecionado nem um sócio cadastrado. Confira antes de salvar." };
  };
  // O texto de busca de cada cadastro é montado uma vez; a lista mostra 100 por vez (a busca considera todos).
  const searchable = useMemo(() => items.map((item) => [item, JSON.stringify(item).toLowerCase()]), [items]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? searchable.filter(([, text]) => text.includes(term)).map(([item]) => item) : items;
  }, [searchable, items, search]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => setVisibleCount(PAGE_SIZE), [search, type]);
  const openNew = () => {
    setEditing(null); setError(""); setOwnership("unique"); setPartners([{ document: "", share: "" }]); resetLookup(); setShow(true);
  };
  const openEdit = (item) => {
    setEditing(item); setError(""); setOwnership(item.ownership_type || "unique"); resetLookup();
    setPartners(item.partners?.length ? item.partners.map(p => ({ document: maskCpf(p.document), share: String(p.share) })) : [{ document: "", share: "" }]);
    setShow(true);
  };
  const closeModal = () => { setShow(false); setEditing(null); setError(""); resetLookup(); };
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const values = Object.fromEntries(new FormData(e.currentTarget));
      await api(`/${type}${editing ? `/${editing.id}` : ""}`, {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(values),
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
        {loading ? <Loading text={`Carregando ${title.toLowerCase()}...`} /> : filtered.length ? (
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
                {filtered.slice(0, visibleCount).map((i) => (
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
            {filtered.length > visibleCount && <div className="load-more">
              <span>Mostrando {visibleCount.toLocaleString("pt-BR")} de {filtered.length.toLocaleString("pt-BR")}. Use a busca para encontrar um cadastro específico.</span>
              <button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Mostrar mais</button>
            </div>}
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
          <form key={`${editing?.id || "new"}-${formVersion}`} ref={formRef} onSubmit={submit} className="modal-form">
            {type === "farms" ? (
              <>
                <label>
                  Produtor responsável
                  <select name="producer_id" required defaultValue={draft?.producer_id || editing?.producer_id || ""}>
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
                  <input name="name" required defaultValue={draft?.name ?? editing?.name ?? ""} />
                </label>
                <label>
                  Inscrição Estadual
                  <div className="ie-lookup" onBlur={autoLookup} onKeyDown={(e) => { if (e.key === "Enter" && e.target.name === "state_registration") { e.preventDefault(); autoLookup(e); } }}>
                    <MaskedNumberInput name="state_registration" kind="ie" placeholder="Digite ou cole de 8 a 14 números" defaultValue={draft?.state_registration ?? editing?.state_registration} />
                    <select aria-label="UF da inscrição" value={lookupUf} onChange={(e) => setLookupUf(e.target.value)}>{["GO", "MT", "MS", "MG", "SP", "PR", "RS", "BA", "PE"].map((uf) => <option key={uf}>{uf}</option>)}</select>
                    <button type="button" className="outline" disabled={lookupBusy} onClick={lookupRegistration}><SearchCheck />{lookupBusy ? "Consultando..." : "Buscar na SEFAZ"}</button>
                  </div>
                  <small className="field-help">Aceita de 8 a 14 dígitos. São Paulo utiliza 12 dígitos. A busca preenche o endereço com o cadastro da SEFAZ (base do Sintegra).</small>
                </label>
                {lookupError && <div className="error">{lookupError}</div>}
                {lookup && (() => { const relation = holderRelation(); return <div className={`ie-result${lookup.active ? "" : " inactive"}`}>
                  <b>{lookup.active ? "Inscrição habilitada" : `Inscrição ${lookup.situation.toLowerCase()}`}{lookup.closedDate ? ` (baixada em ${lookup.closedDate.split("-").reverse().join("/")})` : ""}</b>
                  <span>Titular: {lookup.name} · {maskDoc(lookup.document)} · {lookup.address.city}/{lookup.uf}</span>
                  {relation && <span className={relation.ok ? "" : "ie-warning"}>{relation.text}{relation.owner && <button type="button" className="ie-switch" onClick={useHolderAsProducer}>Usar {relation.owner.name} como produtor</button>}</span>}
                  <small>Endereço preenchido com os dados da SEFAZ; confira e ajuste se precisar. Consulta feita com o certificado {lookup.certificate_used === "produtor" ? "do produtor" : "do escritório"}.</small>
                </div>; })()}
                <AddressFields item={draft || editing || {}} />
                {/* Dados usados no LCDPR (registro 0040). NIRF e CAEPF ficam zerados quando não houver o número. */}
                <fieldset className="farm-fiscal">
                  <legend>Dados para o LCDPR</legend>
                  <label>UF<input name="uf" maxLength={2} defaultValue={(draft || editing)?.uf || "GO"} /></label>
                  <label>Município (código IBGE)<input name="city_code" inputMode="numeric" maxLength={7} placeholder="Ex.: 5214838" defaultValue={(draft || editing)?.city_code || ""} />
                    {(draft || editing)?.city_name && <small className="field-help">{(draft || editing).city_name}</small>}
                  </label>
                  <input type="hidden" name="city_name" defaultValue={(draft || editing)?.city_name || ""} />
                  <label>NIRF / CAFIR<input name="nirf" inputMode="numeric" maxLength={8} defaultValue={(draft || editing)?.nirf || "00000000"} /></label>
                  <label>CAEPF<input name="caepf" inputMode="numeric" maxLength={14} defaultValue={(draft || editing)?.caepf || "00000000000000"} /></label>
                </fieldset>
                <label>
                  Tipo de propriedade
                  <select name="ownership_type" required value={ownership} onChange={(e) => setOwnership(e.target.value)}>
                    <option value="unique">Proprietário único</option>
                    <option value="shared">Possui participação</option>
                  </select>
                </label>
                {ownership === "shared" ? <label>
                  Tipo de exploração (LCDPR)
                  <select name="exploration_type" defaultValue={(draft || editing)?.exploration_type && (draft || editing).exploration_type !== "1" ? (draft || editing).exploration_type : "4"}>
                    <option value="4">Parceria</option>
                    <option value="2">Condomínio</option>
                    <option value="3">Imóvel arrendado</option>
                    <option value="5">Comodato</option>
                    <option value="6">Outros</option>
                  </select>
                </label> : <input type="hidden" name="exploration_type" value="1" />}
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
