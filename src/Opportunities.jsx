import React, { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";
import { QuickActions } from "./crmKit";
import OpportunityEditor from "./OpportunityEditor";
import { applyCardEdits, conversionParcel, opportunityCard } from "./opportunityEdits";
import { commitOpportunityState, readOpportunityState } from "./opportunityState";
import {
  ACTIVE_STAGES, BOARD_BOROUGHS, CLOSED_STAGES, addressBorough, boroughName, clearCall, hasCall, lotDimensions,
  moveProspect, ownerPhone, parcelMetrics, prospectKey as pkey, recordCall,
  prospectStage, researchTag, street, withBorough,
} from "./opportunityBoard";

/* ============================================================
   NEW OPPORTUNITIES — borough prospect boards + a mini CRM
   Storage (no schema change, no data in this repo):
   - daily batches : public.models rows, id "opps-batch-YYYY-MM-DD",
                     data = { kind: "opps_batch", date, prospects: [...] }
   - your activity + card edits: public.models row "opps-state-<user id>",
                     data = { kind: "opps_state", prospects: {key: {stage, stageAt, called, calledAt, note, cardEdits, …legacy}},
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

export default function Opportunities(props) {
  return props.userId ? <OpportunityWorkspace key={props.userId} {...props} /> : null;
}

function OpportunityWorkspace({ userId, userName, notify, onGo }) {
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
  const [editor, setEditor] = useState(null);
  const stRef = useRef(st);
  const saving = useRef(Promise.resolve());
  const lifetime = useRef(null);

  const observeState = (next, signal) => {
    if (signal.aborted) return;
    stRef.current = next;
    setSt(next);
  };
  const load = async (signal) => {
    try {
      const [b, next, c] = await Promise.all([
        supabase.from("models").select("id, data, updated_at").like("id", `${OPPS_PREFIX}batch-%`).abortSignal(signal),
        readOpportunityState(supabase, userId, signal),
        supabase.from("contacts").select("id, name, phone, email, address, area, type, follow_up_date, last_contacted, converted_deal_id, owner_id, updated_at, contact_notes(id, body, noted_at, author_name, owner_id)").abortSignal(signal),
      ]);
      if (signal.aborted) return;
      if (b.error || c.error) setLoadErr((b.error || c.error).message || "Couldn't load.");
      const bs = (b.data || []).map((r) => ({ date: r.data?.date || String(r.id).slice(-10), prospects: Array.isArray(r.data?.prospects) ? r.data.prospects : [] }))
        .sort((x, y) => (x.date < y.date ? 1 : -1));
      setBatches(bs);
      observeState(next, signal);
      setContacts(c.data || []);
      setLoaded(true);
    } catch { if (!signal.aborted) setLoaded("state-error"); }
  };
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    load(controller.signal);
    return () => controller.abort();
  }, [userId]);

  const commitState = (change) => {
    const signal = lifetime.current.signal;
    const job = saving.current.then(async () => {
      const next = await commitOpportunityState(supabase, userId, signal, change, (before) => observeState(before, signal));
      observeState(next, signal);
      if (!signal.aborted) setSaveErr(false);
      return next;
    });
    saving.current = job.catch(() => {});
    return job;
  };
  const putState = (change) => commitState(change).catch(() => {
    if (!lifetime.current.signal.aborted) setSaveErr(true);
    return null;
  });
  const changeProspect = (key, edit) => (s) => {
    const before = s.prospects[key] || {};
    const next = edit(before);
    return next === before ? s : { ...s, prospects: { ...s.prospects, [key]: next } };
  };
  const editProspect = (key, edit) => putState(changeProspect(key, edit));
  const setPStatus = (key, stage) => {
    const at = new Date().toISOString();
    return editProspect(key, (entry) => moveProspect(entry, stage, at));
  };

  const allP = useMemo(() => batches.flatMap((b) => b.prospects.map((p) => ({ ...p, date: p.date || b.date }))), [batches]);
  const crm = useMemo(() => contacts.filter((c) => st.contacts[c.id]).map((c) => ({
    ...c, ...st.contacts[c.id],
    notes: [...(c.contact_notes || [])].sort((a, b) => (a.noted_at < b.noted_at ? 1 : -1)),
  })), [contacts, st]);
  const boards = useMemo(() => {
    const linked = new Map();
    for (const c of crm) if (c.prospectKey) {
      if (!linked.has(c.prospectKey)) linked.set(c.prospectKey, []);
      linked.get(c.prospectKey).push(c);
    }
    return allP.map((source) => {
      const key = pkey(source), entry = st.prospects[key] || {}, people = linked.get(key) || [];
      const card = opportunityCard(source, entry, people);
      return { p: card.display, card, key, entry, people, phone: card.phone, borough: card.borough,
        priority: !!researchTag(source), called: hasCall(entry), stage: prospectStage(entry, card.phone, people) };
    }).sort((a, b) => String(b.p.date).localeCompare(String(a.p.date)) || (a.p.rank || 0) - (b.p.rank || 0));
  }, [allP, crm, st.prospects]);
  const byKey = useMemo(() => Object.fromEntries(boards.map((item) => [item.key, item])), [boards]);
  const saveCard = async (changes) => {
    const { key, card } = editor;
    const next = await commitState(changeProspect(key, (entry) => applyCardEdits(entry, card.edits, changes)));
    if (lifetime.current.signal.aborted) return;
    const item = byKey[key];
    const entry = next.prospects[key] || {};
    const saved = opportunityCard(card.source, entry, item.people);
    const stage = prospectStage(entry, saved.phone, item.people);
    setBoroFilter(BOARD_BOROUGHS.includes(saved.borough) ? saved.borough : "Other");
    setLane(stage); setArchived(CLOSED_STAGES.includes(stage));
    // Keep the saved card in sight if its changed address/phone no longer matches the old query.
    if (q && !matchesCard({ card: saved, p: saved.display, entry, people: item.people }, q.trim().toLowerCase())) setQ("");
    setEditor(null);
    notify?.(editor.phoneOnly ? (saved.phone ? "Phone saved." : "Phone cleared.") : "Card saved.");
  };
  const dueCount = crm.filter((c) => c.status !== "Converted" && c.status !== "Not interested" && ["overdue", "today"].includes(dueState(c.callbackAt))).length;

  /* ---------------- contacts ---------------- */
  const openNew = (seed = {}) => setForm({ id: null, name: "", role: "owner", phone: "", email: "", address: "", prospectKey: "", status: "Lead", callbackAt: "", notes: [], ...seed });
  const fromProspect = (key, card, n) => {
    if (n) openNew({ name: n.owner || "", role: "neighbor", address: withBorough(n.address, n.displayBorough), prospectKey: key });
    else openNew({ name: card.values.name, role: "owner", phone: card.values.phone, email: card.values.email,
      address: withBorough(card.values.address, card.borough), prospectKey: key });
    window.scrollTo(0, 0);
  };

  const saveContact = async (f, quiet) => {
    const name = String(f.name || "").trim() || (f.address ? `Owner, ${f.address}` : "");
    if (!name) { notify?.("Add a name or an address first."); return null; }
    const isNew = !f.id;
    const id = f.id || newId();
    const prev = contacts.find((c) => c.id === id) || {};
    const linked = byKey[f.prospectKey];
    const neighbor = f.role === "neighbor" && linked?.p.neighbors.find((n) => street(n.address).toLowerCase() === street(f.address).toLowerCase());
    const source = neighbor || (f.role !== "neighbor" ? linked?.p.base : null);
    const linkedBorough = neighbor ? neighbor.displayBorough : linked?.borough;
    // Do not replace a saved CRM address/borough when a linked card is edited.
    const address = (isNew || f.address !== prev.address) && source && street(source.address).toLowerCase() === street(f.address).toLowerCase()
      ? withBorough(f.address, linkedBorough) : f.address;
    const row = {
      name, phone: f.phone || null, email: f.email || null, address: address || null,
      area: addressBorough(address) || prev.area || linkedBorough || null,
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
    const item = byKey[f.prospectKey], card = item?.card, p = item?.p;
    const b = conversionParcel(card);
    const id = appId();
    const notesText = [...(f.notes || [])].reverse().map((n) => `${noteTime(n.noted_at)}: ${n.body}`).join("\n");
    const metrics = parcelMetrics(b);
    const assembly = assemblyLabel(p);
    const summary = p ? [
      `New Opportunities ${p.date} #${p.rank}: ${withBorough(card.values.address, card.borough)}${b.zoning ? ` (${b.zoning})` : ""}.`,
      card.addressChanged ? `Card address was entered manually and is not verified. Original research: ${card.baseline.address}${card.source.base?.bbl ? ` (BBL ${card.source.base.bbl})` : ""}.` : "",
      Object.keys(card.edits).length ? "Card edits are user-entered; verify before underwriting." : "",
      metrics.lot ? `Lot area: ${fmt(metrics.lot)} SF.` : "",
      metrics.aor ? `This lot: ~${fmt(metrics.aor)} SF buildable as of right (estimate).` : "Standalone as-of-right buildable was not supplied.",
      assembly ? `Optional assemblage${card.addressChanged ? " (original research unless edited)" : ""}: ${assembly}.` : "",
      ...(p.neighbors || []).map((n) => `Optional neighbor ${n.side || "adjacent"}: ${street(n.address)}${!n.changedAddress && !card.addressChanged && validUrl(n.zola) ? ` (${validUrl(n.zola)})` : ""}.`),
      f.role === "neighbor" ? `Contact is a neighbor: ${f.address}.` : "",
    ].filter(Boolean).join("\n") : "";
    const data = {   // blankDeal() defaults + what we already know
      id, address: street(card ? card.values.address : f.address), borough: card ? card.borough : addressBorough(f.address) || boroughName(f.area), neighborhood: card?.addressChanged && !Object.hasOwn(card.edits, "neighborhood") ? "" : p?.neighborhood || "",
      zone: b.zoning || "", photos: [], streetWidth: "narrow", devPath: "aor",
      lotArea: metrics.lot ? String(metrics.lot) : "", customFar: metrics.far && (metrics.aor || Object.hasOwn(card?.edits || {}, "max_far")) ? String(metrics.far) : "", askingPrice: card && (!card.addressChanged || Object.hasOwn(card.edits, "askingPrice")) ? String(card.values.askingPrice) : "",
      sellerNumber: f.phone || "", vacancy: "TBD", existingSf: p && b.existing_bldg_sf ? String(b.existing_bldg_sf) : "",
      contactName: f.name, contactPhone: f.phone || "", contactEmail: f.email || "",
      notes: [summary, item && stRef.current.prospects[item.key]?.note, notesText].filter(Boolean).join("\n\n"),
      followUpDate: f.callbackAt ? f.callbackAt.slice(0, 10) : "", followUpNotes: "",
      isPublic: false, stage: "New", assetType: "Development / Land", buildableSf: metrics.aor ? String(Math.round(metrics.aor)) : "",
      lot: null, autoFilled: {}, created: todayStr(), ownerName: userName, contactId: f.id,
    };
    const { error } = await supabase.from("deals").upsert({ id, data, owner_id: userId, is_public: false, updated_at: new Date().toISOString() });
    if (error) return notify?.(error.message || "Couldn't create the deal.");
    await supabase.from("contacts").update({ converted_deal_id: id, updated_at: new Date().toISOString() }).eq("id", f.id);
    setContacts((cs) => cs.map((c) => (c.id === f.id ? { ...c, converted_deal_id: id } : c)));
    const at = new Date().toISOString();
    await putState((s) => {
      const updated = { ...s, contacts: { ...s.contacts, [f.id]: { ...(s.contacts[f.id] || {}), status: "Converted" } } };
      return item ? changeProspect(item.key, (entry) => moveProspect(entry, "Converted", at))(updated) : updated;
    });
    setForm(null);
    notify?.(`Deal created for ${data.address || f.name}.`);
    onGo?.("deals", id);
  };

  /* ---------------- filters ---------------- */
  const t = q.trim().toLowerCase();
  const boroughCounts = Object.fromEntries([...BOARD_BOROUGHS, "Other"].map((b) => [b, 0]));
  const boroughBucket = (b) => BOARD_BOROUGHS.includes(b) ? b : "Other";
  for (const item of boards) boroughCounts[boroughBucket(item.borough)]++;
  const found = boards.filter((item) => boroughBucket(item.borough) === boroFilter && matchesCard(item, t));
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
  if (loaded === "state-error") return <div className="notice">Couldn't load your saved opportunity activity. <button onClick={() => { setLoaded(false); setLoadErr(""); load(lifetime.current.signal); }}>Retry</button></div>;

  if (form) return (
    <div className="op">
      <style>{OP_CSS}</style>
      <ContactCard f={form} setF={setForm} prospects={boards} byKey={byKey}
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
      {saveErr && <div className="notice" role="alert">An opportunity change wasn’t confirmed. Review the board and try that action again.</div>}
      {editor && <OpportunityEditor card={editor.card} phoneOnly={editor.phoneOnly} onSave={saveCard} onClose={() => setEditor(null)} />}
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
                    {byStage[stage].map(({ p, card, key, entry, people, phone, called }) => (
                      <Prospect key={key} card={card} stage={stage} entry={entry} people={people} phone={phone} called={called}
                        onStatus={async (next) => { setLane(stage); if (await setPStatus(key, next)) setAnnouncement(`${street(p.base?.address)} moved to ${next}.`); }}
                        onLogCall={async () => { if (await editProspect(key, (e) => recordCall(e, new Date().toISOString()))) setAnnouncement(`Call logged for ${street(p.base?.address)}.`); }}
                        onClearCall={() => editProspect(key, (e) => clearCall(e, stage, phone, new Date().toISOString()))}
                        onNote={(note) => editProspect(key, (e) => ({ ...e, note }))}
                        onEdit={(phoneOnly) => setEditor({ key, card, phoneOnly })}
                        onAdd={(n) => fromProspect(key, card, n)} onOpen={(c) => setForm({ ...c })} />
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
              const p = c.prospectKey ? byKey[c.prospectKey]?.p : null;
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

function matchesCard({ p, card, entry, people }, term) {
  if (!term) return true;
  const { values, borough } = card;
  const haystack = [values.address, card.baseline.address, p.base?.bbl, borough, p.neighborhood, p.base?.zoning, values.name,
    values.phone, values.email, p.why, entry.note, ...people.flatMap((c) => [c.name, c.phone]),
    ...(p.neighbors || []).flatMap((n) => [n.address, n.owner])];
  const digits = term.replace(/\D/g, "");
  return haystack.join(" ").toLowerCase().includes(term) ||
    (/^[+\d(). -]+$/.test(term) && digits.length >= 4 && String(values.phone || "").replace(/\D/g, "").includes(digits));
}

function ZoLa({ url, small, label = "ZoLa" }) {
  const href = validUrl(url);
  return href ? <a className={`opZola${small ? " sm" : ""}`} href={href} target="_blank" rel="noopener noreferrer">{label}</a> : null;
}

function Prospect({ card, stage, entry, people, phone, called, onStatus, onLogCall, onClearCall, onNote, onEdit, onAdd, onOpen }) {
  const { source, display: p, values, borough, addressChanged, edits } = card;
  const b = p.base || {}, m = parcelMetrics(b), pick = researchTag(source), assembly = assemblyLabel(p);
  const original = source.base || {}, originalMetrics = parcelMetrics(original), originalDims = lotDimensions(original);
  const edited = Object.keys(edits).length > 0;
  const lotEdited = ["lot_sf", "front_ft", "depth_ft", "irregular_lot"].some((field) => Object.hasOwn(edits, field));
  const buildableEdited = Object.hasOwn(edits, "buildable_sf_aor");
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
          <div className="opSub">{(addressChanged
            ? [borough, Object.hasOwn(edits, "neighborhood") && p.neighborhood, Object.hasOwn(edits, "zoning") && b.zoning]
            : [p.neighborhood || borough, b.zoning]).filter(Boolean).join(" · ")}</div>
          {addressChanged && <div className="opAddressEdit">Edited address · not verified</div>}
        </div>
        <button className="opAdd opEditLink" type="button" onClick={() => onEdit(false)}>Edit card</button>
      </div>
      <div className="opNums">
        <div>
          <span>Lot area</span>
          <div className="opLotValue">
            <b>{sizeLabel(m.lot) || "—"}</b>
            {dimensions.label && <>{" "}<small>({dimensions.label})</small></>}
          </div>
          {b.irregular_lot === true && <small>Irregular lot</small>}
          {lotEdited ? <small>Includes edits</small> : addressChanged && <small>Original parcel</small>}
        </div>
        <div><span>Buildable · this lot</span><b>{m.aor ? `~${sizeLabel(m.aor)}` : "—"}</b><small>{buildableEdited ? "Entered by you" : m.aor ? (addressChanged ? "Original parcel estimate" : "Est. as of right") : "Not available"}</small></div>
      </div>
      <div className="opCardFlags">
        {pick && <span className="opPick" title={pick}>Call First</span>}
        <span className="opCallFlag" data-called={called}>{called ? "✓ Called" : "Call not logged"}</span>
      </div>
      <div className="opOwnerLine">
        <span className="opOwner">{values.name || "Owner not listed"}</span>
        <button className="opAdd" type="button" onClick={() => owner ? onOpen(owner) : onAdd(null)}>{owner ? "Contact" : "+ Contact"}</button>
      </div>
      <div className="opCardPhone">
        <button className="opAdd opPhoneEdit" type="button" aria-label={phone ? `Edit phone ${values.phone}` : "Add phone"} onClick={() => onEdit(true)}>
          {phone ? <><span>{values.phone}</span><small>Edit</small></> : "+ Add phone"}
        </button>
        {phone && <a className="opAdd opPhoneCall" href={`tel:${phone}`}>Call</a>}
      </div>
      {Number(values.askingPrice) > 0 && <div className="opMeta opAsking">Ask ${fmt(values.askingPrice)}{Object.hasOwn(edits, "askingPrice") ? " · entered by you" : ""}</div>}
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
        <div className="opMeta">{[p.rank && `#${p.rank}`, p.date && `Added ${dayLabel(p.date)}`].filter(Boolean).join(" · ")}</div>
        {edited && <div className="opDetailsCopy">
          <div><b>Your card</b> {withBorough(values.address, borough) || "Address unavailable"}</div>
          {Object.hasOwn(edits, "phone") && <div><b>Card phone</b> {phone ? `${values.phone} · entered by you` : "Cleared by you"}</div>}
          {values.email && <div><b>Contact email</b> {values.email}{Object.hasOwn(edits, "email") ? " · entered by you" : ""}</div>}
        </div>}
        <div className="opOriginal">
          <b>{edited ? "Original parcel research" : "Researched parcel"}</b>
          <div>{[withBorough(card.baseline.address, card.baseline.borough), original.bbl && `BBL ${original.bbl}`].filter(Boolean).join(" · ")}</div>
          {edited && <div>{[card.baseline.neighborhood, original.zoning, original.owner, sizeLabel(originalMetrics.lot), originalDims.label,
            originalMetrics.aor && `~${sizeLabel(originalMetrics.aor)} as of right`].filter(Boolean).join(" · ")}</div>}
          {edited && Object.hasOwn(edits, "phone") && card.baseline.phone && <div>Original contact phone: {card.baseline.phone}</div>}
          <ZoLa url={original.zola} small label={addressChanged ? "Original ZoLa" : "ZoLa"} />
        </div>
        {entry.status && entry.status !== "New" && <div className="opMeta">Previous status: {entry.status}</div>}
        {called && <div className="opMeta">{entry.calledAt ? `Call logged ${noteTime(entry.calledAt)}` : "Call date not recorded"} · <button type="button" className="opTxt" onClick={onClearCall}>Undo call log</button></div>}
        {pick && <div className="opMeta">{pick} is a research recommendation, not seller interest.</div>}
        <div className="opDetailsCopy">
          {addressChanged && <div className="opMeta">Unedited figures below still describe the original parcel.</div>}
          {bldg && <div><b>Existing</b> {bldg}</div>}
          {dimensions.front && <div><b>Frontage</b> {dimensions.front} ft{dimensions.depth && ` · ${dimensions.depth} ft deep`}</div>}
          {m.legacy && <div><b>Estimate basis</b> Lot area × {far(m.far)} FAR from the original list.</div>}
          {sizeLabel(b.unused_sf) && <div><b>Unused on this lot</b> ~{sizeLabel(b.unused_sf)}</div>}
          {m.uap && <div><b>This lot with UAP</b> ~{sizeLabel(m.uap)} if applicable</div>}
          {Number(p.estimated_homes) > 0 && <div><b>Estimated homes</b> {fmt(p.estimated_homes)}</div>}
          {m.far && <div><b>FAR</b> {far(m.far)}{Object.hasOwn(edits, "max_far") ? " · entered by you" : ""}</div>}
        </div>
        {(p.why_now || p.why || p.risks) && <div className="opDetailsCopy">
          <b>Research notes · original parcel</b>
          {typeof p.why_now === "string" && <div><b>Why now</b> {p.why_now}</div>}
          {p.why && <div><b>Why</b> {p.why}</div>}
          {p.risks && <div className="opRisk"><b>Risks</b> {p.risks}</div>}
        </div>}
        {publicSource && (publicContact.name || publicUrl || publicTel) && (
          <div className="opDetailsCopy opPublicContact">
            <b>Researched owner contact route</b>
            <div>{[publicContact.name, publicContact.role].filter(Boolean).join(" · ")}</div>
            {publicTel && <a href={`tel:${publicTel}`}>{publicContact.phone}</a>}
            {publicUrl && <a href={publicUrl} target="_blank" rel="noopener noreferrer">Contact page</a>}
            <a href={publicSource} target="_blank" rel="noopener noreferrer">Source{publicContact.checked_date ? ` · ${publicContact.checked_date}` : ""}</a>
          </div>
        )}
        {!!p.neighbors?.length && (
          <div className="opNbrs">
            <h4>Optional assemblage</h4>
            {assembly && <div className="opMeta">{assembly} (estimate){addressChanged ? " · check against original research" : ""}</div>}
            {p.neighbors.map((n, i) => (
              <div key={`${n.bbl || n.address}-${i}`} className="opNbr">
                <div className="opNbrMain">
                  <b>{street(n.address)}</b>
                  <div className="opMeta">{[n.side || "Adjacent", n.owner, sizeLabel(n.unused_sf) && `~${sizeLabel(n.unused_sf)} unused`].filter(Boolean).join(" · ")}</div>
                  {n.changedAddress && <div className="opMeta">Edited · original: {source.neighbors[i].address}</div>}
                </div>
                <div className="opNbrActs"><ZoLa url={n.zola} small label={n.changedAddress ? "Original ZoLa" : "ZoLa"} /><button className="opAdd" onClick={() => onAdd(n)}>+ Contact</button></div>
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

function ContactCard({ f, setF, prospects, byKey, onSave, onBack, onAddNote, onEditNote, onDelNote, onConvert, onRemove }) {
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(null);   // {id, body}
  const [custom, setCustom] = useState(false);
  const cbRef = useRef(null);
  const linked = byKey[f.prospectKey], p = linked?.p;
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
            {prospects.map(({ key, p: x }) => <option key={key} value={key}>#{x.rank} {street(x.base?.address)} · {dayLabel(x.date)}</option>)}
          </select>
          {p && <div className="hintline">{[linked.borough, linked.card.addressChanged ? "Edited address · not verified" : p.base?.zoning, !linked.card.addressChanged && parcelMetrics(p.base || {}).aor && `~${fmt(parcelMetrics(p.base || {}).aor)} SF on this lot`].filter(Boolean).join(" · ")}{validUrl(p.base?.zola) ? <> · <ZoLa url={p.base.zola} label={linked.card.addressChanged ? "Original ZoLa" : "ZoLa"} /></> : null}</div>}
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
.opEditLink{border:1px solid ${LINE};border-radius:7px;padding:5px 7px;flex-shrink:0}
.opAddressEdit{color:#765721;font-size:11px;font-weight:700;margin-top:3px}
.opCardPhone{display:flex;gap:5px;align-items:center;justify-content:space-between;background:#F1F5FC;border-radius:7px;padding:0 7px;margin-top:2px}
.opPhoneEdit{min-width:0;text-align:left;white-space:normal;overflow-wrap:anywhere;display:flex;gap:5px;align-items:baseline;font-variant-numeric:tabular-nums}
.opPhoneEdit small{color:#516686;font-weight:650;font-size:10px}
.opPhoneCall{border-left:1px solid #CFD9EC;padding-left:7px;flex-shrink:0}
.opAsking{margin:6px 0 2px}
.opOriginal{display:grid;justify-items:start;gap:3px;background:#F6F4EE;color:#514B3E;padding:7px;border-radius:7px;margin:7px 0;font-size:11px}
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
.opEditDialog{padding:0;border:1px solid ${LINE};border-radius:14px;color:${INK};background:#fff;box-shadow:0 16px 70px #101B2D4D;width:min(100% - 28px,620px);max-height:min(88vh,760px);max-height:min(88dvh,760px);overflow:hidden}
.opEditDialog::backdrop{background:#101B2D83}
.opPhoneDialog{max-width:410px}
.opEditForm{display:flex;flex-direction:column;max-height:inherit}
.opEditHead,.opEditFoot{padding:14px 18px;background:#F7F5EF}
.opEditHead h2{font-size:20px;line-height:1.1;margin:0 0 4px}
.opEditHead p{font-size:13px;margin:0;color:#5D6472;overflow-wrap:anywhere}
.opEditBody{min-height:0;overflow:auto;overscroll-behavior:contain;padding:14px 18px}
.opEditHint{margin:0 0 13px;font-size:13px;line-height:1.4;color:#4F5B70}
.opEditBody fieldset{border:0;padding:0;margin:0;min-width:0}
.opEditGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
.opEditWide,.opPhoneDialog .opEditField{grid-column:1/-1}
.opEditField label{display:block;font-size:12.5px;font-weight:750;margin-bottom:4px}
.opEditField input,.opEditField select{width:100%;padding:7px 9px;min-height:42px;font-size:16px}
.opEditField [aria-invalid="true"]{border-color:${RED};outline-color:${RED}}
.opEditError{color:${RED};font-size:13px;font-weight:650;margin:0 0 5px}
.opEditError small{display:block}
.opEditGroup{margin-top:12px;border-top:1px solid ${LINE};padding-top:2px}
.opEditGroup summary{font-size:13px;font-weight:750;cursor:pointer;padding:10px 0;overflow-wrap:anywhere}
.opEditUtilities{margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.opEditUtilities button{min-height:38px;font-size:13px;text-align:left}
.opEditUtilities small{color:#5D6472}
.opEditFoot{border-top:1px solid ${LINE};flex-shrink:0}
.opEditActs{display:flex;justify-content:flex-end;gap:8px}
.opEditActs button{min-height:42px}
.opEditActs button:disabled{opacity:.55;cursor:wait}
@media (max-width:500px){
  .opEditHead,.opEditBody,.opEditFoot{padding-left:14px;padding-right:14px}
  .opEditMobileWide{grid-column:1/-1}
  .opEditActs button{flex:1}
}
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
  .opEditLink,.opPhoneEdit,.opPhoneCall{min-height:44px}
  .opEditLink{padding:5px 9px}
  .opDetails summary{padding:11px 0 4px}
}
@media (max-width:760px){
  .op .pageHead h1{font-size:22px}
  .opFormActs .primary,.opFormActs .opConvert{flex:1 1 45%}
}
`;
