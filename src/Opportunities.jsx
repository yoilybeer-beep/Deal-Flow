import React, { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";
import { QuickActions } from "./crmKit";

/* ============================================================
   NEW OPPORTUNITIES — daily Bronx assemblage prospects + a mini CRM
   Storage (no schema change, no data in this repo):
   - daily batches : public.models rows, id "opps-batch-YYYY-MM-DD",
                     data = { kind: "opps_batch", date, prospects: [...] }
   - your statuses : public.models row "opps-state-<user id>",
                     data = { kind: "opps_state", prospects: {key: {status, note}},
                              contacts: {contactId: {role, status, callbackAt, prospectKey}} }
   - people + notes: public.contacts + public.contact_notes (same as Contacts),
                     call-back date mirrors into contacts.follow_up_date (shows on Home > Today)
   ============================================================ */

export const OPPS_PREFIX = "opps-";
const P_STATUSES = ["New", "Interested", "Calling", "Follow-up", "Pass"];
const C_STATUSES = ["Lead", "Follow-up", "Not interested", "Converted"];
const ROLES = [["owner", "Owner"], ["neighbor", "Neighbor"], ["broker", "Broker"]];

const fmt = (n) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const far = (n) => (Number(n) ? String(Math.round(Number(n) * 100) / 100) : "—");
const pkey = (p) => `${p.date}|${(p.base && (p.base.bbl || p.base.address)) || p.rank}`;
const pad = (n) => String(n).padStart(2, "0");
const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const todayStr = () => localISO(new Date()).slice(0, 10);
const titleCase = (s) => String(s || "").toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bLlc\b/g, "LLC").replace(/\bInc\b/g, "Inc").replace(/\bCorp\b/g, "Corp");
const dayLabel = (iso) => {
  const d = new Date(String(iso).slice(0, 10) + "T12:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};
const whenLabel = (cb) => {
  if (!cb) return "";
  const d = new Date(cb.length <= 10 ? cb + "T09:00" : cb);
  if (isNaN(d)) return cb;
  const t = todayStr(), ds = localISO(d).slice(0, 10);
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  const day = ds === t ? "Today" : ds === localISO(tm).slice(0, 10) ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${day} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};
// overdue | today | upcoming | ""
const dueState = (cb) => {
  if (!cb) return "";
  const ds = cb.slice(0, 10), t = todayStr();
  if (ds < t) return "overdue";
  if (ds === t) return new Date(cb.length <= 10 ? cb + "T23:59" : cb) < new Date() ? "overdue" : "today";
  return "upcoming";
};
const plus = (kind) => {
  const d = new Date(); d.setSeconds(0, 0);
  if (kind === "tomorrow") d.setDate(d.getDate() + 1);
  if (kind === "week") d.setDate(d.getDate() + 7);
  if (kind === "month") d.setMonth(d.getMonth() + 1);
  d.setHours(10, 0);
  return localISO(d);
};
const noteTime = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : "x" + Date.now().toString(36) + Math.random().toString(36).slice(2));
const appId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);   // same as uid() in App.jsx

export default function Opportunities({ userId, userName, notify, onGo }) {
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [batches, setBatches] = useState([]);          // [{date, prospects}]
  const [st, setSt] = useState({ prospects: {}, contacts: {} });
  const [contacts, setContacts] = useState([]);
  const [tab, setTab] = useState("prospects");
  const [q, setQ] = useState("");
  const [pFilter, setPFilter] = useState("All");
  const [dFilter, setDFilter] = useState("All");
  const [cFilter, setCFilter] = useState("All");
  const [form, setForm] = useState(null);
  const stRef = useRef(st);
  const saving = useRef(Promise.resolve());
  const STATE_ID = `${OPPS_PREFIX}state-${userId}`;

  const load = async () => {
    const [b, s, c] = await Promise.all([
      supabase.from("models").select("id, data, updated_at").like("id", `${OPPS_PREFIX}batch-%`),
      supabase.from("models").select("id, data").eq("id", STATE_ID).maybeSingle(),
      supabase.from("contacts").select("id, name, phone, email, address, area, type, follow_up_date, last_contacted, converted_deal_id, owner_id, updated_at, contact_notes(id, body, noted_at, author_name, owner_id)"),
    ]);
    if (b.error || c.error) setLoadErr((b.error || c.error).message || "Couldn't load.");
    const bs = (b.data || []).map((r) => ({ date: r.data?.date || String(r.id).slice(-10), prospects: Array.isArray(r.data?.prospects) ? r.data.prospects : [] }))
      .sort((x, y) => (x.date < y.date ? 1 : -1));
    setBatches(bs);
    const sd = s.data?.data || {};
    const next = { prospects: sd.prospects || {}, contacts: sd.contacts || {} };
    stRef.current = next; setSt(next);
    setContacts(c.data || []);
    setLoaded(true);
  };
  useEffect(() => { load(); }, []);

  const putState = (fn) => {
    const next = fn(stRef.current);
    stRef.current = next; setSt(next);
    saving.current = saving.current.then(async () => {
      const { error } = await supabase.from("models").upsert({
        id: STATE_ID, data: { kind: "opps_state", ...stRef.current }, owner_id: userId, is_public: false, updated_at: new Date().toISOString(),
      });
      if (error) notify?.(error.message || "Couldn't save.");
    });
    return next;
  };
  const setPStatus = (k, status) => putState((s) => ({ ...s, prospects: { ...s.prospects, [k]: { ...(s.prospects[k] || {}), status, at: new Date().toISOString() } } }));
  const setPNote = (k, note) => putState((s) => ({ ...s, prospects: { ...s.prospects, [k]: { ...(s.prospects[k] || {}), note } } }));

  const allP = useMemo(() => batches.flatMap((b) => b.prospects.map((p) => ({ ...p, date: p.date || b.date }))), [batches]);
  const pByKey = useMemo(() => Object.fromEntries(allP.map((p) => [pkey(p), p])), [allP]);
  const crm = useMemo(() => contacts.filter((c) => st.contacts[c.id]).map((c) => ({
    ...c, ...st.contacts[c.id],
    notes: [...(c.contact_notes || [])].sort((a, b) => (a.noted_at < b.noted_at ? 1 : -1)),
  })), [contacts, st]);
  const dueCount = crm.filter((c) => c.status !== "Converted" && c.status !== "Not interested" && ["overdue", "today"].includes(dueState(c.callbackAt))).length;

  /* ---------------- contacts ---------------- */
  const openNew = (seed = {}) => setForm({ id: null, name: "", role: "owner", phone: "", email: "", address: "", prospectKey: "", status: "Lead", callbackAt: "", notes: [], ...seed });
  const fromProspect = (p, n) => {
    const k = pkey(p);
    if (n) openNew({ name: titleCase(n.owner), role: "neighbor", address: `${n.address}, Bronx`, prospectKey: k });
    else openNew({ name: titleCase(p.base.owner), role: "owner", address: `${p.base.address}, Bronx`, prospectKey: k });
    setTab("crm");
    window.scrollTo(0, 0);
  };

  const saveContact = async (f, quiet) => {
    const name = String(f.name || "").trim() || (f.address ? `Owner, ${f.address}` : "");
    if (!name) { notify?.("Add a name or an address first."); return null; }
    const isNew = !f.id;
    const id = f.id || newId();
    const prev = contacts.find((c) => c.id === id) || {};
    const row = {
      name, phone: f.phone || null, email: f.email || null, address: f.address || null,
      area: f.prospectKey || /bronx/i.test(f.address || "") ? "Bronx" : (prev.area || null),
      type: f.role === "broker" ? "broker" : "owner",
      follow_up_date: f.callbackAt ? f.callbackAt.slice(0, 10) : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = isNew
      ? await supabase.from("contacts").insert({ id, ...row, owner_id: userId, is_public: false })
      : await supabase.from("contacts").update(row).eq("id", id);
    if (error) { notify?.(error.message || "Couldn't save the contact."); return null; }
    putState((s) => ({ ...s, contacts: { ...s.contacts, [id]: { role: f.role, status: f.status || "Lead", callbackAt: f.callbackAt || "", prospectKey: f.prospectKey || "" } } }));
    setContacts((cs) => isNew ? [{ id, ...row, owner_id: userId, converted_deal_id: null, contact_notes: [] }, ...cs] : cs.map((c) => (c.id === id ? { ...c, ...row } : c)));
    const saved = { ...f, id, name };
    setForm((cur) => (cur && (cur.id === f.id) ? { ...cur, id, name } : cur));
    if (!quiet) notify?.(isNew ? `${name} added.` : "Saved.");
    return saved;
  };

  const addNote = async (f, body) => {
    const text = String(body || "").trim();
    if (!text) return;
    const saved = f.id ? f : await saveContact(f, true);
    if (!saved) return;
    const rec = { id: newId(), contact_id: saved.id, owner_id: userId, author_name: userName, body: text, noted_at: new Date().toISOString() };
    const { error } = await supabase.from("contact_notes").insert(rec);
    if (error) return notify?.(error.message || "Couldn't add the note.");
    await supabase.from("contacts").update({ last_contacted: todayStr() }).eq("id", saved.id);
    setContacts((cs) => cs.map((c) => (c.id === saved.id ? { ...c, last_contacted: todayStr(), contact_notes: [rec, ...(c.contact_notes || [])] } : c)));
    setForm((cur) => cur && ({ ...cur, id: saved.id, notes: [rec, ...(cur.notes || [])] }));
  };
  const editNote = async (cid, nid, body) => {
    const text = String(body || "").trim();
    if (!text) return;
    const { error } = await supabase.from("contact_notes").update({ body: text }).eq("id", nid);
    if (error) return notify?.(error.message || "Couldn't save the note.");
    const fix = (ns) => (ns || []).map((n) => (n.id === nid ? { ...n, body: text } : n));
    setContacts((cs) => cs.map((c) => (c.id === cid ? { ...c, contact_notes: fix(c.contact_notes) } : c)));
    setForm((cur) => cur && ({ ...cur, notes: fix(cur.notes) }));
  };
  const delNote = async (cid, nid) => {
    if (!window.confirm("Delete this note?")) return;
    await supabase.from("contact_notes").delete().eq("id", nid);
    const drop = (ns) => (ns || []).filter((n) => n.id !== nid);
    setContacts((cs) => cs.map((c) => (c.id === cid ? { ...c, contact_notes: drop(c.contact_notes) } : c)));
    setForm((cur) => cur && ({ ...cur, notes: drop(cur.notes) }));
  };
  const removeContact = async (f) => {
    if (!f.id) return setForm(null);
    if (!window.confirm(`Remove ${f.name} from this list? (The contact stays in Contacts.)`)) return;
    putState((s) => { const c = { ...s.contacts }; delete c[f.id]; return { ...s, contacts: c }; });
    setForm(null);
  };

  const convertToDeal = async (f0) => {
    if (f0.converted_deal_id) return onGo?.("deals", f0.converted_deal_id);
    const f = await saveContact(f0, true);
    if (!f) return;
    const p = f.prospectKey ? pByKey[f.prospectKey] : null;
    const b = p?.base || {};
    const id = appId();
    const notesText = [...(f.notes || [])].reverse().map((n) => `${noteTime(n.noted_at)}: ${n.body}`).join("\n");
    const summary = p ? [
      `New Opportunities ${p.date} #${p.rank}: assemblage at ${b.address} (${b.zoning}, ${b.front_ft}×${b.depth_ft}, ${fmt(b.lot_sf)} SF lot).`,
      `Combined buildable ~${fmt(p.combined_buildable_gsf)} GSF / ~${fmt(p.est_units)} units (UAP ~${fmt(p.combined_buildable_gsf_uap)} GSF / ~${fmt(p.est_units_uap)} units).`,
      ...(p.neighbors || []).map((n) => `Neighbor ${n.side}: ${n.address} (${titleCase(n.owner)}), ~${fmt(n.unused_sf)} SF unused.`),
      f.role === "neighbor" ? `Contact is a neighbor: ${f.address}.` : "",
    ].filter(Boolean).join("\n") : "";
    const data = {   // blankDeal() defaults + what we already know
      id, address: p ? b.address : (f.address || "").replace(/,\s*Bronx$/i, ""), borough: "Bronx", neighborhood: p?.neighborhood || "",
      zone: (p && b.zoning) || "R6", photos: [], streetWidth: "narrow", devPath: "aor",
      lotArea: p && b.lot_sf ? String(b.lot_sf) : "", customFar: p && b.max_far ? String(b.max_far) : "", askingPrice: "",
      sellerNumber: f.phone || "", vacancy: "TBD", existingSf: p && b.existing_bldg_sf ? String(b.existing_bldg_sf) : "",
      contactName: f.name, contactPhone: f.phone || "", contactEmail: f.email || "",
      notes: [summary, notesText].filter(Boolean).join("\n\n"),
      followUpDate: f.callbackAt ? f.callbackAt.slice(0, 10) : "", followUpNotes: "",
      isPublic: false, stage: "New", assetType: "Development / Land", buildableSf: p && p.combined_buildable_gsf ? String(Math.round(p.combined_buildable_gsf)) : "",
      lot: null, autoFilled: {}, created: todayStr(), ownerName: userName, contactId: f.id,
    };
    const { error } = await supabase.from("deals").upsert({ id, data, owner_id: userId, is_public: false, updated_at: new Date().toISOString() });
    if (error) return notify?.(error.message || "Couldn't create the deal.");
    await supabase.from("contacts").update({ converted_deal_id: id, updated_at: new Date().toISOString() }).eq("id", f.id);
    setContacts((cs) => cs.map((c) => (c.id === f.id ? { ...c, converted_deal_id: id } : c)));
    putState((s) => ({ ...s, contacts: { ...s.contacts, [f.id]: { ...(s.contacts[f.id] || {}), status: "Converted" } } }));
    if (p && (stRef.current.prospects[pkey(p)]?.status || "New") === "New") setPStatus(pkey(p), "Interested");
    setForm(null);
    notify?.(`Deal created for ${data.address || f.name}.`);
    onGo?.("deals", id);
  };

  /* ---------------- filters ---------------- */
  const t = q.trim().toLowerCase();
  const pStatus = (p) => st.prospects[pkey(p)]?.status || "New";
  const dates = batches.map((b) => b.date);
  const pList = allP.filter((p) =>
    (dFilter === "All" || p.date === dFilter) &&
    (pFilter === "All" || pStatus(p) === pFilter) &&
    (!t || [p.base?.address, p.neighborhood, p.base?.zoning, p.base?.owner, p.why, ...(p.neighbors || []).flatMap((n) => [n.address, n.owner])].join(" ").toLowerCase().includes(t)));
  const groups = [];
  for (const p of [...pList].sort((a, b) => (a.date === b.date ? (a.rank || 0) - (b.rank || 0) : a.date < b.date ? 1 : -1))) {
    const g = groups[groups.length - 1];
    if (g && g.date === p.date) g.items.push(p); else groups.push({ date: p.date, items: [p] });
  }
  const pCount = (s) => allP.filter((p) => (dFilter === "All" || p.date === dFilter) && (s === "All" || pStatus(p) === s)).length;

  const rank = (c) => ({ overdue: 0, today: 1, upcoming: 2, "": 3 })[dueState(c.callbackAt)];
  const cList = crm.filter((c) =>
    (cFilter === "All" ? true : cFilter === "Follow-ups" ? !!c.callbackAt && c.status !== "Converted" && c.status !== "Not interested" : c.status === cFilter) &&
    (!t || [c.name, c.phone, c.email, c.address, ...(c.notes || []).map((n) => n.body)].join(" ").toLowerCase().includes(t)))
    .sort((a, b) => {
      const open = (c) => (c.status === "Converted" || c.status === "Not interested" ? 1 : 0);
      if (open(a) !== open(b)) return open(a) - open(b);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (a.callbackAt && b.callbackAt && a.callbackAt !== b.callbackAt) return a.callbackAt < b.callbackAt ? -1 : 1;
      return String(b.updated_at || "") < String(a.updated_at || "") ? -1 : 1;
    });
  const linked = (k) => crm.filter((c) => c.prospectKey === k);

  if (!loaded) return <div style={{ padding: 40, opacity: 0.6 }}>Loading opportunities…</div>;

  if (form) return (
    <div className="op">
      <style>{OP_CSS}</style>
      <ContactCard f={form} setF={setForm} prospects={allP} pByKey={pByKey}
        onSave={async () => { const s = await saveContact(form); if (s) setForm(null); }}
        onBack={() => setForm(null)} onAddNote={(body) => addNote(form, body)}
        onEditNote={(nid, body) => editNote(form.id, nid, body)} onDelNote={(nid) => delNote(form.id, nid)}
        onConvert={() => convertToDeal(form)} onRemove={() => removeContact(form)} />
    </div>
  );

  return (
    <div className="op">
      <style>{OP_CSS}</style>
      <header className="pageHead">
        <h1>New Opportunities</h1>
        <button className="primary" onClick={() => openNew()}>+ New lead</button>
      </header>
      {loadErr && <div className="notice">{loadErr}</div>}

      <div className="opTabs">
        <button data-on={tab === "prospects"} onClick={() => setTab("prospects")}>Prospects <span>{allP.length}</span></button>
        <button data-on={tab === "crm"} onClick={() => setTab("crm")}>Leads <span data-due={dueCount > 0}>{dueCount ? `${dueCount} due` : crm.length}</span></button>
      </div>
      <input className="opSearch" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={tab === "prospects" ? "Search address, owner, neighborhood…" : "Search name, phone, address, notes…"} />

      {tab === "prospects" && (
        <>
          <div className="opFilters">
            <div className="chips">
              {["All", ...P_STATUSES].map((s) => (
                <button key={s} className="chip small" data-on={pFilter === s} onClick={() => setPFilter(s)}>{s} <i>{pCount(s)}</i></button>
              ))}
            </div>
            {dates.length > 0 && (
              <select className="opDate" value={dFilter} onChange={(e) => setDFilter(e.target.value)}>
                <option value="All">All dates</option>
                {dates.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
              </select>
            )}
          </div>
          {!allP.length && <div className="empty">No prospects yet. Each day's list of Bronx assemblage prospects lands here, newest first.</div>}
          {allP.length > 0 && !pList.length && <div className="empty">Nothing matches these filters.</div>}
          {groups.map((g) => (
            <section key={g.date} className="opGroup">
              <div className="opGroupHead">{dayLabel(g.date)} <span>{g.items.length} prospect{g.items.length === 1 ? "" : "s"}</span></div>
              <div className="opGrid">
                {g.items.map((p) => (
                  <Prospect key={pkey(p)} p={p} status={pStatus(p)} note={st.prospects[pkey(p)]?.note || ""}
                    contacts={linked(pkey(p))} onStatus={(s) => setPStatus(pkey(p), s)} onNote={(v) => setPNote(pkey(p), v)}
                    onAdd={(n) => fromProspect(p, n)} onOpen={(c) => setForm({ ...c })} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {tab === "crm" && (
        <>
          <div className="opFilters">
            <div className="chips">
              {["All", "Follow-ups", ...C_STATUSES].map((s) => (
                <button key={s} className="chip small" data-on={cFilter === s} onClick={() => setCFilter(s)}>
                  {s}{s === "Follow-ups" && dueCount ? <i className="dueI">{dueCount}</i> : null}
                </button>
              ))}
            </div>
          </div>
          {!crm.length && <div className="empty">No leads yet. Tap <b>+ Contact</b> on a prospect or a neighbor, or <b>+ New lead</b> for someone not on the list.</div>}
          {crm.length > 0 && !cList.length && <div className="empty">Nothing here.</div>}
          <div className="opLeads">
            {cList.map((c) => {
              const ds = c.status === "Converted" || c.status === "Not interested" ? "" : dueState(c.callbackAt);
              const p = c.prospectKey ? pByKey[c.prospectKey] : null;
              return (
                <div key={c.id} className="opLead" data-due={ds} onClick={() => setForm({ ...c })}>
                  <div className="opLeadTop">
                    <b>{c.name}</b>
                    <span className="opRole">{(ROLES.find((r) => r[0] === c.role) || ROLES[0])[1]}</span>
                    <span className="opCst" data-s={c.status}>{c.status}</span>
                  </div>
                  <div className="opLeadSub">{c.address || "No address"}{p ? ` · #${p.rank} ${dayLabel(p.date)}` : ""}</div>
                  {c.callbackAt && <div className={"followTag " + (ds === "overdue" ? "overdue" : ds === "today" ? "due" : "upcoming")}>Call back {whenLabel(c.callbackAt)}{ds === "overdue" ? " · overdue" : ""}</div>}
                  {c.notes?.[0] && <div className="lastNote"><b>{noteTime(c.notes[0].noted_at)}</b>{c.notes[0].body}</div>}
                  <QuickActions phone={c.phone} email={c.email} small />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Prospect({ p, status, note, contacts, onStatus, onNote, onAdd, onOpen }) {
  const b = p.base || {};
  const [more, setMore] = useState(false);
  const [n, setN] = useState(note);
  useEffect(() => setN(note), [note]);
  const bldg = [b.bldg_class, b.floors ? `${b.floors} fl` : "", b.units ? `${b.units} unit${b.units === 1 ? "" : "s"}` : "", b.existing_bldg_sf ? `${fmt(b.existing_bldg_sf)} SF` : "", b.year_built ? `built ${b.year_built}` : ""].filter(Boolean).join(" · ");
  return (
    <div className="opCard" data-s={status}>
      <div className="opCardTop">
        <span className="opRank">#{p.rank}</span>
        <div className="opAddrWrap">
          <div className="opAddr">{b.address}</div>
          <div className="opSub">{[p.neighborhood, b.zoning, b.front_ft && b.depth_ft ? `${far(b.front_ft)}×${far(b.depth_ft)}` : "", b.lot_sf ? `${fmt(b.lot_sf)} SF lot` : ""].filter(Boolean).join(" · ")}</div>
        </div>
        {b.zola && <a className="opZola" href={b.zola} target="_blank" rel="noopener noreferrer">ZoLa</a>}
      </div>
      <div className="opLine"><label>Existing</label>{bldg || (b.existing_bldg_sf === 0 ? "Vacant" : "—")}</div>
      <div className="opLine"><label>Owner</label><span className="opOwner">{titleCase(b.owner) || "—"}</span>
        <button className="opAdd" onClick={() => onAdd(null)}>+ Contact</button></div>

      <div className="opNums">
        <div><label>Combined</label><b>~{fmt(p.est_units)} units</b><small>{fmt(p.combined_buildable_gsf)} GSF</small></div>
        <div><label>With UAP</label><b>~{fmt(p.est_units_uap)} units</b><small>{fmt(p.combined_buildable_gsf_uap)} GSF</small></div>
      </div>
      <div className="opSmall">Base unused {fmt(b.unused_sf)} SF · FAR {far(b.max_far)} / UAP {far(b.max_far_uap)}</div>

      {(p.neighbors || []).length > 0 && (
        <div className="opNbrs">
          {(p.neighbors || []).map((x, i) => (
            <div key={i} className="opNbr">
              <span className="opSide">{x.side || "adj."}</span>
              <div className="opNbrMain">
                <div><b>{x.address}</b> <span className="opPlus">+{fmt(x.unused_sf)} SF</span></div>
                <div className="opNbrOwner">{titleCase(x.owner) || "—"}</div>
              </div>
              <div className="opNbrActs">
                {x.zola && <a className="opZola sm" href={x.zola} target="_blank" rel="noopener noreferrer">ZoLa</a>}
                <button className="opAdd" onClick={() => onAdd(x)}>+ Contact</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(p.why || p.risks) && (
        <div className="opWhy" data-more={more} onClick={() => setMore(!more)}>
          {p.why && <div><b>Why</b> {p.why}</div>}
          {p.risks && <div className="opRisk"><b>Risks</b> {p.risks}</div>}
        </div>
      )}

      {contacts.length > 0 && (
        <div className="opLinked">
          {contacts.map((c) => <button key={c.id} className="opPerson" onClick={() => onOpen(c)}>{c.name}{c.callbackAt ? ` · ${whenLabel(c.callbackAt)}` : ""}</button>)}
        </div>
      )}

      <div className="opStatus">
        {P_STATUSES.map((s) => <button key={s} data-s={s} data-on={status === s} onClick={() => onStatus(s)}>{s}</button>)}
      </div>
      <input className="opNote" value={n} onChange={(e) => setN(e.target.value)} onBlur={() => n !== note && onNote(n)} placeholder="Quick note…" />
    </div>
  );
}

function ContactCard({ f, setF, prospects, pByKey, onSave, onBack, onAddNote, onEditNote, onDelNote, onConvert, onRemove }) {
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(null);   // {id, body}
  const [custom, setCustom] = useState(false);
  const cbRef = useRef(null);
  const p = f.prospectKey ? pByKey[f.prospectKey] : null;
  const ds = dueState(f.callbackAt);
  const setCb = (v) => setF({ ...f, callbackAt: v, status: v && f.status === "Lead" ? "Follow-up" : f.status });
  return (
    <div className="opForm">
      <div className="opFormHead">
        <button className="ghost small" onClick={onBack}>← Back</button>
        <h1>{f.id ? f.name || "Contact" : "New lead"}</h1>
      </div>

      <div className="fgroup">
        <div className="frow">
          <div className="field"><label className="flabel">Name</label><input value={f.name} onChange={set("name")} placeholder="Owner name" /></div>
          <div className="field opRoleF"><label className="flabel">Role</label>
            <select value={f.role} onChange={set("role")}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        </div>
        <div className="frow">
          <div className="field"><label className="flabel">Phone</label><input type="tel" value={f.phone || ""} onChange={set("phone")} placeholder="(718) 555-0100" /></div>
          <div className="field"><label className="flabel">Email</label><input type="email" value={f.email || ""} onChange={set("email")} /></div>
        </div>
        <div className="field"><label className="flabel">Property address</label><input value={f.address || ""} onChange={set("address")} placeholder="123 Main St, Bronx" /></div>
        <div className="field"><label className="flabel">Linked prospect</label>
          <select value={f.prospectKey || ""} onChange={set("prospectKey")}>
            <option value="">None</option>
            {prospects.map((x) => { const k = pkey(x); return <option key={k} value={k}>#{x.rank} {x.base?.address} · {dayLabel(x.date)}</option>; })}
          </select>
          {p && <div className="hintline">{p.base?.zoning} · ~{fmt(p.est_units)} units combined ({fmt(p.combined_buildable_gsf)} GSF){p.base?.zola ? <> · <a href={p.base.zola} target="_blank" rel="noopener noreferrer">ZoLa</a></> : null}</div>}
        </div>
        <QuickActions phone={f.phone} email={f.email} />
      </div>

      <div className="fgroup">
        <div className="ftitle">Status</div>
        <div className="opStatus wide">
          {C_STATUSES.map((s) => <button key={s} data-cs={s} data-on={f.status === s} onClick={() => setF({ ...f, status: s })}>{s}</button>)}
        </div>
      </div>

      <div className="fgroup">
        <div className="ftitle">Call back</div>
        {f.callbackAt && <div className={"followTag inForm " + (ds === "overdue" ? "overdue" : ds === "today" ? "due" : "upcoming")}>{whenLabel(f.callbackAt)}{ds === "overdue" ? " · overdue" : ""}</div>}
        <div className="opQuick">
          <button className="mini" onClick={() => setCb(plus("tomorrow"))}>Tomorrow</button>
          <button className="mini" onClick={() => setCb(plus("week"))}>1 week</button>
          <button className="mini" onClick={() => setCb(plus("month"))}>1 month</button>
          <button className="mini" data-on={custom} onClick={() => { setCustom(true); setTimeout(() => cbRef.current?.focus(), 30); }}>Custom</button>
          {f.callbackAt && <button className="mini" onClick={() => { setCustom(false); setF({ ...f, callbackAt: "" }); }}>Clear</button>}
        </div>
        {(custom || f.callbackAt) && <input ref={cbRef} className="opCb" type="datetime-local" value={f.callbackAt || ""} onChange={(e) => setCb(e.target.value)} />}
      </div>

      <div className="fgroup">
        <div className="ftitle">Notes</div>
        <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What did they say? e.g. call back after the holidays, wants $1.2M…" />
        <button className="primary opNoteBtn" disabled={!draft.trim()} onClick={async () => { await onAddNote(draft); setDraft(""); }}>Add note</button>
        <div className="noteLog">
          {(f.notes || []).map((n) => (
            <div key={n.id} className="noteItem">
              <div className="noteDate">{noteTime(n.noted_at)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {editing?.id === n.id ? (
                  <>
                    <textarea rows={3} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                    <div className="opQuick"><button className="mini" onClick={async () => { await onEditNote(n.id, editing.body); setEditing(null); }}>Save</button>
                      <button className="mini" onClick={() => setEditing(null)}>Cancel</button></div>
                  </>
                ) : (
                  <>
                    <div className="opNoteBody">{n.body}</div>
                    <div className="noteWho">{n.author_name || ""} · <button className="opTxt" onClick={() => setEditing({ id: n.id, body: n.body })}>Edit</button> · <button className="opTxt" onClick={() => onDelNote(n.id)}>Delete</button></div>
                  </>
                )}
              </div>
            </div>
          ))}
          {!(f.notes || []).length && <div className="hintline">No notes yet.</div>}
        </div>
      </div>

      <div className="opFormActs">
        <button className="primary" onClick={onSave}>Save</button>
        <button className="ghost opConvert" onClick={onConvert}>{f.converted_deal_id ? "Open deal →" : "Convert to deal →"}</button>
        {f.status !== "Lead" && !f.converted_deal_id && <button className="ghost" onClick={() => setF({ ...f, status: "Lead" })}>Keep as lead</button>}
        {f.id && <button className="opTxt danger2" onClick={onRemove}>Remove from list</button>}
      </div>
    </div>
  );
}

const INK = "#101B2D", BLUE = "#2456C8", BRASS = "#9C7A2E", LINE = "#E3E1D9", GREEN = "#2E7D5B", RED = "#A8453A";
const OP_CSS = `
.op .pageHead{margin-bottom:12px}
.opTabs{display:flex;border:1px solid ${LINE};border-radius:8px;overflow:hidden;background:#fff;margin-bottom:10px;max-width:520px}
.opTabs button{flex:1;white-space:nowrap;background:none;border:none;padding:9px 10px;font-size:13.5px;font-weight:700;color:${INK};opacity:.65}
.opTabs button[data-on="true"]{background:${INK};color:#fff;opacity:1}
.opTabs span{font-size:11.5px;font-weight:700;opacity:.7;margin-left:4px}
.opTabs span[data-due="true"]{background:${RED};color:#fff;opacity:1;border-radius:10px;padding:1px 7px}
.opSearch{max-width:520px;margin-bottom:10px}
.opFilters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.opFilters .chips{flex-wrap:nowrap;overflow-x:auto;max-width:100%;padding-bottom:2px;-webkit-overflow-scrolling:touch}
.opFilters .chip{white-space:nowrap}
.opFilters .chip i{font-style:normal;opacity:.55;margin-left:3px;font-weight:600}
.opFilters .chip i.dueI{background:${RED};color:#fff;opacity:1;border-radius:9px;padding:0 6px;font-size:11px}
.opDate{width:auto;font-size:14px;padding:6px 9px}
.opGroup{margin-bottom:22px}
.opGroupHead{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:${BRASS};margin:0 0 8px}
.opGroupHead span{color:${INK};opacity:.45;margin-left:6px}
.opGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
.opCard{background:#fff;border:1px solid ${LINE};border-radius:10px;padding:12px 13px;font-size:13px;border-left:3px solid ${LINE};min-width:0}
.opCard[data-s="Interested"]{border-left-color:${GREEN}}
.opCard[data-s="Calling"]{border-left-color:${BLUE}}
.opCard[data-s="Follow-up"]{border-left-color:${BRASS}}
.opCard[data-s="Pass"]{opacity:.55}
.opCardTop{display:flex;gap:9px;align-items:flex-start;margin-bottom:6px}
.opRank{background:${INK};color:#fff;font-weight:800;font-size:12px;border-radius:6px;padding:3px 6px;flex-shrink:0;margin-top:1px}
.opAddrWrap{flex:1;min-width:0}
.opAddr{font-size:15.5px;font-weight:800;line-height:1.2}
.opSub{font-size:12px;opacity:.6;margin-top:2px}
.opZola{flex-shrink:0;font-size:12px;font-weight:700;color:${BLUE};text-decoration:none;border:1px solid ${LINE};border-radius:20px;padding:4px 10px}
.opZola.sm{padding:2px 8px;font-size:11.5px}
.opLine{display:flex;gap:8px;align-items:center;padding:2px 0;line-height:1.35}
.opLine label,.opNums label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;opacity:.5;flex:0 0 58px}
.opOwner{flex:1;min-width:0;font-weight:600}
.opAdd{background:none;border:none;color:${BLUE};font-weight:700;font-size:12px;padding:2px 0;white-space:nowrap}
.opNums{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:#F4F6FB;border-radius:8px;padding:8px 10px;margin:8px 0 4px}
.opNums label{display:block}
.opNums b{font-size:15px;font-weight:700;display:block;line-height:1.25}
.opNums small{font-size:12px;opacity:.65}
.opNums > div:last-child b{color:${BRASS}}
.opSmall{font-size:11.5px;opacity:.6}
.opNbrs{margin-top:8px;border-top:1px solid ${LINE}}
.opNbr{display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid ${LINE}}
.opSide{flex:0 0 46px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:${BRASS}}
.opNbrMain{flex:1;min-width:0;font-size:12.5px}
.opNbrMain b{font-weight:700}
.opPlus{color:${GREEN};font-weight:700;font-size:12px;white-space:nowrap}
.opNbrOwner{font-size:11.5px;opacity:.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.opNbrActs{display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.opWhy{margin-top:8px;font-size:12.5px;line-height:1.4;cursor:pointer}
.opWhy b{font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-right:4px;opacity:.55}
.opWhy > div{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.opWhy[data-more="true"] > div{display:block}
.opRisk{color:${RED};margin-top:2px}
.opLinked{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.opPerson{background:#EAF0FB;color:${BLUE};border:none;border-radius:20px;padding:3px 10px;font-size:12px;font-weight:700}
.opStatus{display:flex;gap:4px;margin-top:9px;flex-wrap:wrap}
.opStatus button{flex:1 1 auto;background:#fff;border:1px solid ${LINE};border-radius:20px;padding:5px 8px;font-size:12px;font-weight:600;color:${INK};white-space:nowrap}
.opStatus button[data-on="true"]{background:${INK};color:#fff;border-color:${INK}}
.opStatus button[data-on="true"][data-s="Interested"],.opStatus button[data-on="true"][data-cs="Converted"]{background:${GREEN};border-color:${GREEN}}
.opStatus button[data-on="true"][data-s="Calling"]{background:${BLUE};border-color:${BLUE}}
.opStatus button[data-on="true"][data-s="Follow-up"],.opStatus button[data-on="true"][data-cs="Follow-up"]{background:${BRASS};border-color:${BRASS}}
.opStatus button[data-on="true"][data-s="Pass"],.opStatus button[data-on="true"][data-cs="Not interested"]{background:#6A6558;border-color:#6A6558}
.opStatus.wide button{padding:8px 10px;font-size:13px}
.opNote{margin-top:8px;font-size:14px;padding:7px 10px}
.opLeads{display:flex;flex-direction:column;gap:8px;max-width:760px}
.opLead{background:#fff;border:1px solid ${LINE};border-left:3px solid ${LINE};border-radius:10px;padding:11px 13px;cursor:pointer}
.opLead[data-due="overdue"]{border-left-color:${RED};background:#FFF8F7}
.opLead[data-due="today"]{border-left-color:#C98A12;background:#FFFBF2}
.opLead .followTag{margin-top:6px}
.opLead .qa{margin-top:8px}
.opLeadTop{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.opLeadTop b{font-size:15px;margin-right:2px}
.opLeadSub{font-size:12.5px;opacity:.6;margin-top:2px}
.opRole{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;background:#F2EEE0;color:#7A5F22;border:1px solid #DDD0AC;border-radius:5px;padding:1px 6px}
.opCst{font-size:11px;font-weight:700;border-radius:20px;padding:2px 8px;background:#EEF0F4;color:${INK}}
.opCst[data-s="Follow-up"]{background:#FDEFD8;color:#9C6B0B}
.opCst[data-s="Converted"]{background:#E6F2EC;color:${GREEN}}
.opCst[data-s="Not interested"]{opacity:.6}
.opForm{max-width:640px}
.opFormHead{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.opFormHead h1{margin:0;font-size:22px;font-weight:800;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ghost.small{padding:6px 11px;font-size:13px}
.opForm .fgroup{margin-bottom:12px}
.opRoleF{flex:0 1 150px}
.opQuick{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.opQuick .mini{padding:7px 12px;font-size:13px;border-radius:20px}
.opQuick .mini[data-on="true"]{border-color:${BLUE};color:${BLUE}}
.opCb{margin-top:8px;max-width:280px}
.opNoteBtn{margin-top:8px}
.opNoteBody{white-space:pre-wrap;font-size:14px;line-height:1.4}
.opTxt{background:none;border:none;padding:0;color:${BLUE};font-size:11.5px;font-weight:700}
.opTxt.danger2{color:${RED};font-size:13px;margin-left:auto}
.opFormActs{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0 30px}
.opConvert{border-color:${GREEN};color:${GREEN};font-weight:700}
@media (max-width:760px){
  .opGrid{grid-template-columns:1fr}
  .op .pageHead h1{font-size:22px}
  .opFormActs .primary,.opFormActs .opConvert{flex:1 1 45%}
}
`;
