import React, { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";
import { QuickActions } from "./crmKit";
import {
  ACTIVE_STAGES, BOARD_BOROUGHS, CLOSED_STAGES, addressBorough, boroughName, clearCall, hasCall, lotDimensions,
  moveProspect, neighborBorough, ownerPhone, parcelMetrics, prospectBorough, prospectKey as pkey, prospectPhone, recordCall,
  prospectStage, researchTag, street, withBorough,
} from "./opportunityBoard";

/* ============================================================
   NEW OPPORTUNITIES — borough prospect boards + a mini CRM
   Storage (no schema change, no data in this repo):
   - daily batches : public.models rows, id "opps-batch-YYYY-MM-DD",
                     data = { kind: "opps_batch", date, prospects: [...] }
   - your statuses : public.models row "opps-state-<user id>",
                     data = { kind: "opps_state", prospects: {key: {stage, stageAt, called, calledAt, note, …legacy}},
                              contacts: {contactId: {role, status, callbackAt, prospectKey}} }
   - people + notes: public.contacts + public.contact_notes (same as Contacts),
                     call-back date mirrors into contacts.follow_up_date (shows on Home > Today)
   ============================================================ */

export const OPPS_PREFIX = "opps-";
const C_STATUSES = ["Lead", "Follow-up", "Not interested", "Converted"];
const ROLES = [["owner", "Owner"], ["neighbor", "Neighbor"], ["broker", "Broker"]];

const fmt = (n) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const far = (n) => (Number(n) ? String(Math.round(Number(n) * 100) / 100) : "—");
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
  const [boroFilter, setBoroFilter] = useState("Manhattan");
  const [callFilter, setCallFilter] = useState("all");
  const [lane, setLane] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [saveErr, setSaveErr] = useState(false);
  const [archived, setArchived] = useState(false);
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
    if (b.error || c.error || s.error) setLoadErr((b.error || c.error || s.error).message || "Couldn't load.");
    const bs = (b.data || []).map((r) => ({ date: r.data?.date || String(r.id).slice(-10), prospects: Array.isArray(r.data?.prospects) ? r.data.prospects : [] }))
      .sort((x, y) => (x.date < y.date ? 1 : -1));
    setBatches(bs);
    const sd = s.data?.data || {};
    const next = { ...sd, prospects: sd.prospects || {}, contacts: sd.contacts || {} };
    stRef.current = next; setSt(next);
    setContacts(c.data || []);
    setLoaded(s.error ? "state-error" : true);
  };
  useEffect(() => { load(); }, []);

  const queueState = () => {
    saving.current = saving.current.then(async () => {
      const { error } = await supabase.from("models").upsert({
        id: STATE_ID, data: { ...stRef.current, kind: "opps_state" }, owner_id: userId, is_public: false, updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      setSaveErr(false);
    }).catch(() => setSaveErr(true));
  };
  const putState = (fn) => {
    const next = fn(stRef.current);
    stRef.current = next; setSt(next);
    queueState();
    return next;
  };
  const editProspect = (key, edit) => putState((s) => ({ ...s, prospects: { ...s.prospects, [key]: edit(s.prospects[key] || {}) } }));
  const setPStatus = (key, stage) => editProspect(key, (entry) => moveProspect(entry, stage, new Date().toISOString()));

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
    if (n) openNew({ name: titleCase(n.owner), role: "neighbor", address: withBorough(n.address, neighborBorough(n, p)), prospectKey: k });
    else openNew({ name: titleCase(p.base?.owner), role: "owner", address: withBorough(p.base?.address, prospectBorough(p)), prospectKey: k });
    window.scrollTo(0, 0);
  };

  const saveContact = async (f, quiet) => {
    const name = String(f.name || "").trim() || (f.address ? `Owner, ${f.address}` : "");
    if (!name) { notify?.("Add a name or an address first."); return null; }
    const isNew = !f.id;
    const id = f.id || newId();
    const prev = contacts.find((c) => c.id === id) || {};
    const p = pByKey[f.prospectKey];
    const neighbor = f.role === "neighbor" && p?.neighbors?.find((n) => street(n.address).toLowerCase() === street(f.address).toLowerCase());
    const source = neighbor || (f.role !== "neighbor" ? p?.base : null);
    const linkedBorough = neighbor ? neighborBorough(neighbor, p) : prospectBorough(p);
    const address = source && street(source.address).toLowerCase() === street(f.address).toLowerCase()
      ? withBorough(f.address, linkedBorough) : f.address;
    const row = {
      name, phone: f.phone || null, email: f.email || null, address: address || null,
      area: addressBorough(address) || linkedBorough || prev.area || null,
      type: f.role === "broker" ? "broker" : "owner",
      follow_up_date: f.callbackAt ? f.callbackAt.slice(0, 10) : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = isNew
      ? await supabase.from("contacts").insert({ id, ...row, owner_id: userId, is_public: false })
      : await supabase.from("contacts").update(row).eq("id", id);
    if (error) { notify?.(error.message || "Couldn't save the contact."); return null; }
    putState((s) => ({ ...s, contacts: { ...s.contacts, [id]: { ...s.contacts[id], role: f.role, status: f.status || "Lead", callbackAt: f.callbackAt || "", prospectKey: f.prospectKey || "" } } }));
    setContacts((cs) => isNew ? [{ id, ...row, owner_id: userId, converted_deal_id: null, contact_notes: [] }, ...cs] : cs.map((c) => (c.id === id ? { ...c, ...row } : c)));
    const saved = { ...f, id, name, area: row.area, address };
    setForm((cur) => (cur && (cur.id === f.id) ? { ...cur, id, name, area: row.area, address } : cur));
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
    const metrics = parcelMetrics(b);
    const assembly = assemblyLabel(p);
    const summary = p ? [
      `New Opportunities ${p.date} #${p.rank}: ${street(b.address)}${b.zoning ? ` (${b.zoning})` : ""}.`,
      metrics.lot ? `Lot area: ${fmt(metrics.lot)} SF.` : "",
      metrics.aor ? `This lot: ~${fmt(metrics.aor)} SF buildable as of right (estimate).` : "Standalone as-of-right buildable was not supplied.",
      assembly ? `Optional assemblage: ${assembly}.` : "",
      ...(p.neighbors || []).map((n) => `Optional neighbor ${n.side || "adjacent"}: ${street(n.address)}${validUrl(n.zola) ? ` (${validUrl(n.zola)})` : ""}.`),
      f.role === "neighbor" ? `Contact is a neighbor: ${f.address}.` : "",
    ].filter(Boolean).join("\n") : "";
    const data = {   // blankDeal() defaults + what we already know
      id, address: street(p ? b.address : f.address), borough: prospectBorough(p) || addressBorough(f.address) || boroughName(f.area), neighborhood: p?.neighborhood || "",
      zone: b.zoning || "", photos: [], streetWidth: "narrow", devPath: "aor",
      lotArea: metrics.lot ? String(metrics.lot) : "", customFar: metrics.aor && metrics.far ? String(metrics.far) : "", askingPrice: "",
      sellerNumber: f.phone || "", vacancy: "TBD", existingSf: p && b.existing_bldg_sf ? String(b.existing_bldg_sf) : "",
      contactName: f.name, contactPhone: f.phone || "", contactEmail: f.email || "",
      notes: [summary, p && stRef.current.prospects[pkey(p)]?.note, notesText].filter(Boolean).join("\n\n"),
      followUpDate: f.callbackAt ? f.callbackAt.slice(0, 10) : "", followUpNotes: "",
      isPublic: false, stage: "New", assetType: "Development / Land", buildableSf: metrics.aor ? String(Math.round(metrics.aor)) : "",
      lot: null, autoFilled: {}, created: todayStr(), ownerName: userName, contactId: f.id,
    };
    const { error } = await supabase.from("deals").upsert({ id, data, owner_id: userId, is_public: false, updated_at: new Date().toISOString() });
    if (error) return notify?.(error.message || "Couldn't create the deal.");
    await supabase.from("contacts").update({ converted_deal_id: id, updated_at: new Date().toISOString() }).eq("id", f.id);
    setContacts((cs) => cs.map((c) => (c.id === f.id ? { ...c, converted_deal_id: id } : c)));
    putState((s) => ({ ...s, contacts: { ...s.contacts, [f.id]: { ...(s.contacts[f.id] || {}), status: "Converted" } } }));
    if (p) setPStatus(pkey(p), "Converted");
    setForm(null);
    notify?.(`Deal created for ${data.address || f.name}.`);
    onGo?.("deals", id);
  };

  /* ---------------- filters ---------------- */
  const t = q.trim().toLowerCase();
  const boards = useMemo(() => {
    const linked = new Map();
    for (const c of crm) if (c.prospectKey) {
      if (!linked.has(c.prospectKey)) linked.set(c.prospectKey, []);
      linked.get(c.prospectKey).push(c);
    }
    return allP.map((p) => {
      const key = pkey(p), entry = st.prospects[key] || {}, people = linked.get(key) || [];
      const phone = prospectPhone(p, people), borough = prospectBorough(p);
      return { p, key, entry, people, phone, borough, priority: !!researchTag(p), called: hasCall(entry), stage: prospectStage(entry, phone, people) };
    }).sort((a, b) => String(b.p.date).localeCompare(String(a.p.date)) || (a.p.rank || 0) - (b.p.rank || 0));
  }, [allP, crm, st.prospects]);
  const boroughCounts = Object.fromEntries([...BOARD_BOROUGHS, "Other"].map((b) => [b, 0]));
  const boroughBucket = (b) => BOARD_BOROUGHS.includes(b) ? b : "Other";
  for (const item of boards) boroughCounts[boroughBucket(item.borough)]++;
  const found = boards.filter(({ p, borough, people, entry }) => boroughBucket(borough) === boroFilter &&
    (!t || [p.base?.address, p.base?.bbl, p.neighborhood, p.base?.zoning, p.base?.owner, p.why, entry.note,
      ...people.flatMap((c) => [c.name, c.phone]), ...(p.neighbors || []).flatMap((n) => [n.address, n.owner])].join(" ").toLowerCase().includes(t)));
  const calledCount = found.filter((item) => item.called).length;
  const byStage = Object.fromEntries([...ACTIVE_STAGES, ...CLOSED_STAGES].map((stage) => [stage, []]));
  for (const item of found) if (callFilter === "all" || item.called === (callFilter === "called")) byStage[item.stage].push(item);
  for (const stage of ["To Call", "No Number"]) byStage[stage].sort((a, b) => Number(b.priority) - Number(a.priority));
  const selectedLane = lane || ACTIVE_STAGES.find((stage) => byStage[stage].length) || "To Call";
  const archivedCount = CLOSED_STAGES.reduce((count, stage) => count + byStage[stage].length, 0);

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

  if (!loaded) return <div style={{ padding: 40, opacity: 0.6 }}>Loading opportunities…</div>;
  if (loaded === "state-error") return <div className="notice">Couldn't load your saved opportunity activity. <button onClick={() => { setLoaded(false); setLoadErr(""); load(); }}>Retry</button></div>;

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
        <button className="primary" onClick={() => { setTab("crm"); openNew(); }}>+ New lead</button>
      </header>
      {loadErr && <div className="notice">{loadErr}</div>}
      {saveErr && <div className="notice" role="alert">Opportunity changes couldn't be saved. <button onClick={queueState}>Retry save</button></div>}
      <span className="opSR" role="status">{announcement}</span>

      <div className="opTabs">
        <button data-on={tab === "prospects"} onClick={() => setTab("prospects")}>Prospects <span>{allP.length}</span></button>
        <button data-on={tab === "crm"} onClick={() => setTab("crm")}>Leads <span data-due={dueCount > 0}>{dueCount ? `${dueCount} due` : crm.length}</span></button>
      </div>
      <input className="opSearch" aria-label={tab === "prospects" ? "Search prospects" : "Search leads"} type="search" value={q} onChange={(e) => { setQ(e.target.value); setLane(""); }}
        placeholder={tab === "prospects" ? "Search address, owner, neighborhood…" : "Search name, phone, address, notes…"} />

      {tab === "prospects" && (
        <>
          <div className="opBoroughs" role="group" aria-label="Borough">
            {[...BOARD_BOROUGHS, ...(boroughCounts.Other ? ["Other"] : [])].map((b) => (
              <button key={b} type="button" aria-pressed={boroFilter === b} onClick={() => { setBoroFilter(b); setArchived(false); setLane(""); setCallFilter("all"); }}>
                {b} <span>{boroughCounts[b]}</span>
              </button>
            ))}
          </div>
          <div className="opBoardBar">
            <div className="opCallFilters" role="group" aria-label="Call activity">
              {[["all", "All", found.length], ["called", "Called", calledCount], ["unlogged", "Not logged", found.length - calledCount]].map(([id, label, count]) => (
                <button className="chip small" type="button" key={id} data-on={callFilter === id} aria-pressed={callFilter === id} onClick={() => {
                  setCallFilter(id); setLane("");
                }}>{label} <span>{count}</span></button>
              ))}
            </div>
            <button className="opArchive" type="button" aria-pressed={archived} onClick={() => setArchived(!archived)}>
              {archived ? "← Active board" : `Archive · ${archivedCount}`}
            </button>
          </div>
          {!boroughCounts[boroFilter] ? <div className="empty">No prospects in {boroFilter === "Other" ? "other areas" : boroFilter} yet.</div> : (
            <>
              {!archived && <div className="opLanePicker" role="group" aria-label="Prospect stages">
                {ACTIVE_STAGES.map((stage) => (
                  <button key={stage} type="button" aria-pressed={selectedLane === stage} onClick={() => setLane(stage)}>
                    {stage} <span>{byStage[stage].length}</span>
                  </button>
                ))}
              </div>}
              <div className="opBoard" data-archive={archived}>
                {(archived ? CLOSED_STAGES.filter((stage) => stage !== "Other status" || byStage[stage].length) : ACTIVE_STAGES).map((stage) => (
                  <section key={stage} className="opLane" data-stage={stage} data-shown={archived || selectedLane === stage} aria-label={stage}>
                    <h2>{stage} <span>{byStage[stage].length}</span></h2>
                    {!byStage[stage].length && <div className="opLaneEmpty">{t ? "No matches" : stage === "To Call" ? "No prospects to call" : "No prospects here"}</div>}
                    {byStage[stage].map(({ p, key, entry, people, phone, called }) => (
                      <Prospect key={key} p={p} stage={stage} entry={entry} people={people} phone={phone} called={called}
                        onStatus={(next) => { setLane(stage); setPStatus(key, next); setAnnouncement(`${street(p.base?.address)} moved to ${next}.`); }}
                        onLogCall={() => { editProspect(key, (e) => recordCall(e, new Date().toISOString())); setAnnouncement(`Call logged for ${street(p.base?.address)}.`); }}
                        onClearCall={() => editProspect(key, (e) => clearCall(e, stage, phone, new Date().toISOString()))}
                        onNote={(note) => editProspect(key, (e) => ({ ...e, note }))}
                        onAdd={(n) => fromProspect(p, n)} onOpen={(c) => setForm({ ...c })} />
                    ))}
                  </section>
                ))}
              </div>
            </>
          )}
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

const validUrl = (value) => {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
};
const sizeLabel = (value) => Number(value) > 0 && Number.isFinite(Number(value)) ? `${fmt(value)} SF` : "";
const unitsLabel = (value) => Number(value) > 0 && Number.isFinite(Number(value)) ? `~${fmt(value)} units` : "";
const assemblyLabel = (p) => p?.neighbors?.length
  ? [sizeLabel(p.combined_buildable_gsf) && `~${sizeLabel(p.combined_buildable_gsf)} combined buildable`, unitsLabel(p.est_units)].filter(Boolean).join(" · ")
  : "";

function ZoLa({ url, small }) {
  const href = validUrl(url);
  return href ? <a className={`opZola${small ? " sm" : ""}`} href={href} target="_blank" rel="noopener noreferrer">ZoLa</a> : null;
}

function Prospect({ p, stage, entry, people, phone, called, onStatus, onLogCall, onClearCall, onNote, onAdd, onOpen }) {
  const b = p.base || {}, m = parcelMetrics(b), pick = researchTag(p), assembly = assemblyLabel(p);
  const dimensions = lotDimensions(b);
  const [note, setNote] = useState(entry.note || "");
  useEffect(() => setNote(entry.note || ""), [entry.note]);
  const bldg = [b.bldg_class, b.floors > 0 && `${b.floors} fl`, b.units > 0 && `${b.units} unit${Number(b.units) === 1 ? "" : "s"}`,
    sizeLabel(b.existing_bldg_sf), b.year_built > 0 && `built ${b.year_built}`].filter(Boolean).join(" · ");
  const owner = people.find((c) => c.role === "owner");
  const callback = people.find((c) => c.callbackAt && c.status !== "Converted" && c.status !== "Not interested");
  const active = ACTIVE_STAGES.includes(stage);
  const waiting = stage === "To Call" || stage === "No Number";
  const publicContact = p.owner_contact;
  const publicSource = validUrl(publicContact?.source_url);
  const publicUrl = validUrl(publicContact?.url);
  const publicTel = ownerPhone(publicContact?.phone);
  return (
    <article className="opCard" data-stage={stage} aria-label={street(b.address) || "Prospect"}>
      <div className="opCardTop">
        <div className="opAddrWrap">
          <h3 className="opAddr">{street(b.address) || "Address unavailable"}</h3>
          <div className="opSub">{[p.neighborhood || prospectBorough(p), b.zoning].filter(Boolean).join(" · ")}</div>
        </div>
        <ZoLa url={b.zola} />
      </div>
      <div className="opNums">
        <div>
          <span>Lot area</span>
          <div className="opLotValue">
            <b>{sizeLabel(m.lot) || "—"}</b>
            {dimensions.label && <>{" "}<small>({dimensions.label})</small></>}
          </div>
          {b.irregular_lot === true && <small>Irregular lot</small>}
        </div>
        <div><span>Buildable · this lot</span><b>{m.aor ? `~${sizeLabel(m.aor)}` : "—"}</b><small>{m.aor ? "Est. as of right" : "Not available"}</small></div>
      </div>
      <div className="opCardFlags">
        {pick && <span className="opPick" title={pick}>Call First</span>}
        <span className="opCallFlag" data-called={called}>{called ? "✓ Called" : "Call not logged"}</span>
      </div>
      <div className="opOwnerLine">
        <span className="opOwner">{owner?.name || titleCase(b.owner) || "Owner not listed"}</span>
        {phone && <a className="opAdd" href={`tel:${phone}`}>Call</a>}
        <button className="opAdd" onClick={() => owner ? onOpen(owner) : onAdd(null)}>{owner ? (phone ? "Contact" : "Add number") : "+ Contact"}</button>
      </div>
      {callback && <div className="followTag">Call back {whenLabel(callback.callbackAt)}</div>}
      <div className="opCardBtns">
        {!called && active && (waiting || stage === "Called"
          ? <button className="opMark" type="button" onClick={() => onStatus("Called")}>Mark Called</button>
          : <button className="opMark" type="button" onClick={onLogCall}>Log call</button>)}
        <select className="opMove" aria-label="Move to stage" value="" onChange={(e) => onStatus(e.target.value)}>
          <option value="" disabled>Move to…</option>
          {[...ACTIVE_STAGES, ...CLOSED_STAGES.slice(0, 2)].filter((next) => next !== stage).map((next) => <option key={next}>{next}</option>)}
        </select>
      </div>
      <details className="opDetails">
        <summary>Details{entry.note ? " · Note saved" : ""}</summary>
        <div className="opMeta">{[p.rank && `#${p.rank}`, p.date && `Added ${dayLabel(p.date)}`, b.bbl && `BBL ${b.bbl}`].filter(Boolean).join(" · ")}</div>
        {entry.status && entry.status !== "New" && <div className="opMeta">Previous status: {entry.status}</div>}
        {called && <div className="opMeta">{entry.calledAt ? `Call logged ${noteTime(entry.calledAt)}` : "Call date not recorded"} · <button type="button" className="opTxt" onClick={onClearCall}>Undo call log</button></div>}
        {pick && <div className="opMeta">{pick} is a research recommendation, not seller interest.</div>}
        <div className="opDetailsCopy">
          {bldg && <div><b>Existing</b> {bldg}</div>}
          {dimensions.front && <div><b>Frontage</b> {dimensions.front} ft{dimensions.depth && ` · ${dimensions.depth} ft deep`}</div>}
          {m.legacy && <div><b>Estimate basis</b> Lot area × {far(m.far)} FAR from the original list.</div>}
          {sizeLabel(b.unused_sf) && <div><b>Unused on this lot</b> ~{sizeLabel(b.unused_sf)}</div>}
          {m.uap && <div><b>This lot with UAP</b> ~{sizeLabel(m.uap)} if applicable</div>}
          {typeof p.why_now === "string" && <div><b>Why now</b> {p.why_now}</div>}
          {p.why && <div><b>Why</b> {p.why}</div>}
          {p.risks && <div className="opRisk"><b>Risks</b> {p.risks}</div>}
        </div>
        {publicSource && (publicContact.name || publicUrl || publicTel) && (
          <div className="opDetailsCopy opPublicContact">
            <b>Public owner contact route</b>
            <div>{[publicContact.name, publicContact.role].filter(Boolean).join(" · ")}</div>
            {publicTel && <a href={`tel:${publicTel}`}>{publicContact.phone}</a>}
            {publicUrl && <a href={publicUrl} target="_blank" rel="noopener noreferrer">Contact page</a>}
            <a href={publicSource} target="_blank" rel="noopener noreferrer">Source{publicContact.checked_date ? ` · ${publicContact.checked_date}` : ""}</a>
          </div>
        )}
        {!!p.neighbors?.length && (
          <div className="opNbrs">
            <h4>Optional assemblage</h4>
            {assembly && <div className="opMeta">{assembly} (estimate)</div>}
            {p.neighbors.map((n, i) => (
              <div key={`${n.bbl || n.address}-${i}`} className="opNbr">
                <div className="opNbrMain">
                  <b>{street(n.address)}</b>
                  <div className="opMeta">{[n.side || "Adjacent", titleCase(n.owner), sizeLabel(n.unused_sf) && `~${sizeLabel(n.unused_sf)} unused`].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="opNbrActs"><ZoLa url={n.zola} small /><button className="opAdd" onClick={() => onAdd(n)}>+ Contact</button></div>
              </div>
            ))}
          </div>
        )}
        {!!people.length && <div className="opLinked">
          {people.map((c) => <button key={c.id} className="opPerson" onClick={() => onOpen(c)}>{c.name}{c.callbackAt ? ` · ${whenLabel(c.callbackAt)}` : ""}</button>)}
        </div>}
        <input className="opNote" aria-label="Quick note" value={note} onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (entry.note || "") && onNote(note)} placeholder="Quick note…" />
      </details>
    </article>
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
          <div className="field"><label className="flabel" htmlFor="opContactName">Name</label><input id="opContactName" value={f.name} onChange={set("name")} placeholder="Owner name" /></div>
          <div className="field opRoleF"><label className="flabel">Role</label>
            <select value={f.role} onChange={set("role")}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        </div>
        <div className="frow">
          <div className="field"><label className="flabel" htmlFor="opContactPhone">Phone</label><input id="opContactPhone" type="tel" value={f.phone || ""} onChange={set("phone")} placeholder="(718) 555-0100" /></div>
          <div className="field"><label className="flabel">Email</label><input type="email" value={f.email || ""} onChange={set("email")} /></div>
        </div>
        <div className="field"><label className="flabel" htmlFor="opContactAddress">Property address</label><input id="opContactAddress" value={f.address || ""} onChange={set("address")} placeholder="Street address, borough" /></div>
        <div className="field"><label className="flabel">Linked prospect</label>
          <select value={f.prospectKey || ""} onChange={set("prospectKey")}>
            <option value="">None</option>
            {prospects.map((x) => { const k = pkey(x); return <option key={k} value={k}>#{x.rank} {street(x.base?.address)} · {dayLabel(x.date)}</option>; })}
          </select>
          {p && <div className="hintline">{[prospectBorough(p), p.base?.zoning, parcelMetrics(p.base || {}).aor && `~${fmt(parcelMetrics(p.base || {}).aor)} SF on this lot`].filter(Boolean).join(" · ")}{validUrl(p.base?.zola) ? <> · <ZoLa url={p.base.zola} /></> : null}</div>}
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
.opSR{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.op button:focus-visible,.op a:focus-visible,.op summary:focus-visible{outline:2px solid ${BLUE};outline-offset:2px}
.opBoroughs,.opLanePicker{display:flex;gap:7px;min-width:0;flex-wrap:wrap}
.opBoroughs{margin:4px 0 12px}
.opBoroughs button,.opLanePicker button{border:1px solid ${LINE};background:#fff;color:${INK};font-weight:750;border-radius:8px;padding:9px 13px;white-space:nowrap;min-height:40px}
.opBoroughs button[aria-pressed="true"],.opLanePicker button[aria-pressed="true"]{background:${INK};color:#fff;border-color:${INK}}
.opBoroughs span,.opLanePicker span,.opCallFilters span{font-size:.86em;margin-left:3px;font-weight:700;opacity:.77}
.opBoardBar{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap}
.opCallFilters{display:flex;gap:5px;flex-wrap:wrap}
.opCallFilters .chip{padding:6px 9px;min-height:34px;white-space:nowrap}
.opArchive{border:1px solid ${LINE};background:#fff;color:${INK};min-height:34px;font-weight:700;border-radius:18px;padding:5px 10px;white-space:nowrap}
.opLanePicker{display:none}
.opBoard{display:grid;grid-template-columns:repeat(5,minmax(206px,1fr));align-items:start;gap:8px;max-width:100%;overflow-x:auto;scroll-snap-type:x proximity;padding-bottom:10px;margin-bottom:14px}
.opBoard[data-archive="true"]{grid-template-columns:repeat(auto-fit,minmax(206px,1fr))}
.opLane{min-width:0;min-height:125px;background:#EFEBDF;border-radius:10px;padding:7px;scroll-snap-align:start}
.opLane h2{display:flex;align-items:center;justify-content:space-between;gap:6px;color:#514B3E;font-size:11px;font-weight:800;letter-spacing:.075em;text-transform:uppercase;margin:0;padding:4px 3px 8px}
.opLane h2 span{border-radius:12px;background:#fff;font-size:11px;padding:2px 7px;letter-spacing:0}
.opLaneEmpty{font-size:12px;color:#675D4C;text-align:center;padding:19px 5px}
.opCard{background:#fff;border:1px solid ${LINE};border-top:3px solid ${BLUE};border-radius:9px;padding:10px;font-size:13px;min-width:0;overflow-wrap:anywhere}
.opCard+.opCard{margin-top:8px}
.opCard[data-stage="No Number"],.opCard[data-stage="Pass"],.opCard[data-stage="Other status"]{border-top-color:#8A8374}
.opCard[data-stage="Follow Up"]{border-top-color:${BRASS}}
.opCard[data-stage="Called"],.opCard[data-stage="Hot Lead"],.opCard[data-stage="Converted"]{border-top-color:${GREEN}}
.opCardTop{display:flex;gap:5px;align-items:flex-start;margin-bottom:7px}
.opAddrWrap{flex:1;min-width:0}
.opAddr{font-size:15px;font-weight:800;line-height:1.25;margin:0}
.opSub{font-size:11.5px;color:#5D6472;margin-top:2px}
.opZola{display:inline-block;flex-shrink:0;font-size:11px;font-weight:750;color:${BLUE};text-decoration:none;border:1px solid ${LINE};border-radius:20px;padding:5px 7px}
.opZola.sm{padding:4px 7px}
.opNums{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;background:#F5F3EC;border-radius:7px;padding:7px 6px;margin:5px 0 8px}
.opNums span,.opNums small{display:block;font-size:10px;color:#595447;line-height:1.23}
.opNums b{font-size:14px;font-weight:800;display:block;line-height:1.25;margin:2px 0 1px}
.opLotValue{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:4px;overflow-wrap:anywhere}
.opLotValue small{font-size:11px;min-width:0}
.opNums > div:last-child b{color:#765721}
.opCardFlags,.opOwnerLine,.opCardBtns{display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-top:5px}
.opCallFlag,.opPick{display:inline-block;border-radius:14px;background:#F0F1F3;color:#455063;padding:3px 6px;font-size:10.5px;font-weight:750;line-height:1.15}
.opCallFlag[data-called="true"]{background:#E6F2EC;color:#215F45}
.opPick{background:#F7EDCF;color:#715014}
.opOwner{flex:1 1 58px;min-width:0;font-size:12px;font-weight:650}
.opAdd{background:none;border:none;color:${BLUE};font-weight:750;font-size:12px;padding:6px 1px;white-space:nowrap;text-decoration:none}
.opCardBtns{margin:6px 0 1px}
.opMark,.opMove{min-height:34px;font-weight:750;font-size:12px;border-radius:7px;padding:6px 7px}
.opMark{background:${INK};border:1px solid ${INK};color:white;flex:0 1 auto;white-space:nowrap}
.opMove{flex:1 1 73px;min-width:72px;width:auto;background:#fff;border:1px solid ${LINE}}
.opDetails{margin-top:8px;border-top:1px solid ${LINE};color:${INK}}
.opDetails summary{cursor:pointer;font-size:12px;font-weight:750;padding:7px 0 1px;color:#3F4C61}
.opDetails[open] summary{margin-bottom:5px}
.opMeta{font-size:11px;color:#5D6472;line-height:1.35}
.opDetailsCopy{font-size:12px;line-height:1.45;margin-top:7px;display:grid;gap:4px}
.opRisk{color:${RED}}
.opPublicContact a{color:${BLUE}}
.opNbrs{margin-top:8px;border-top:1px solid ${LINE};padding-top:7px}
.opNbrs h4{margin:0 0 3px;font-size:12px}
.opNbr{display:flex;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid ${LINE}}
.opNbrMain{flex:1;min-width:0;font-size:12.5px}
.opNbrActs{display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.opLinked{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.opPerson{background:#EAF0FB;color:${BLUE};border:none;border-radius:20px;padding:3px 10px;font-size:12px;font-weight:700}
.opStatus{display:flex;gap:4px;margin-top:9px;flex-wrap:wrap}
.opStatus button{flex:1 1 auto;background:#fff;border:1px solid ${LINE};border-radius:20px;padding:5px 8px;font-size:12px;font-weight:600;color:${INK};white-space:nowrap}
.opStatus button[data-on="true"]{background:${INK};color:#fff;border-color:${INK}}
.opStatus button[data-on="true"][data-cs="Converted"]{background:${GREEN};border-color:${GREEN}}
.opStatus button[data-on="true"][data-cs="Follow-up"]{background:${BRASS};border-color:${BRASS}}
.opStatus button[data-on="true"][data-cs="Not interested"]{background:#6A6558;border-color:#6A6558}
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
@media (max-width:820px){
  .opLanePicker{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;margin:0 0 9px}
  .opLanePicker button{grid-column:span 2;padding:7px 4px;font-size:12px;min-height:38px}
  .opLanePicker button:nth-last-child(-n+2){grid-column:span 3}
  .opBoroughs button{flex:1 1 auto;padding:8px;font-size:13px}
  .opBoard,.opBoard[data-archive="true"]{grid-template-columns:minmax(0,1fr);overflow:visible;scroll-snap-type:none}
  .opLane[data-shown="false"]{display:none}
  .opCard{padding:12px}
  .opCardTop{gap:8px}
  .opNums{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);padding:8px 10px}
  .opNums span,.opNums small{font-size:11px}
  .opNums b{font-size:18px}
  .opMark,.opMove,.opAdd,.opZola,.opDetails summary{min-height:40px}
  .opAdd,.opZola{display:inline-flex;align-items:center}
  .opDetails summary{padding:11px 0 4px}
}
@media (max-width:760px){
  .op .pageHead h1{font-size:22px}
  .opFormActs .primary,.opFormActs .opConvert{flex:1 1 45%}
}
`;
