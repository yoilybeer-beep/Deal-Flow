import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabaseClient";
import { QuickActions, LastContactedTag, autoContact, sellerFromDeal, personFromBuyer, FollowUpQuick } from "./crmKit";

/* ============================================================
   CONTACTS — owners, buyers, brokers, lenders
   Tables: public.contacts + public.contact_notes (one row per call/note)
   ============================================================ */

export const AREAS = ["Brooklyn", "Queens", "Manhattan", "Harlem", "Bronx"];
export const CONTACT_TYPES = [["owner", "Owner"], ["buyer", "Buyer"], ["broker", "Broker"], ["lender", "Lender"]];
const typeLabel = (t) => (CONTACT_TYPES.find(([k]) => k === t) || [t, t])[1];

const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const shortDate = (iso) =>
  iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
const initials = (n) => (n || "?").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

// same rules as followUpStatus() in App.jsx
function followUp(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + "T00:00:00");
  if (isNaN(due.getTime())) return null;
  const days = Math.round((due - today) / 86400000);
  if (days < 0) return { cls: "overdue", label: `Overdue ${Math.abs(days)}d`, days };
  if (days === 0) return { cls: "due", label: "Follow up today", days };
  if (days === 1) return { cls: "soon", label: "Follow up tomorrow", days };
  if (days <= 7) return { cls: "soon", label: `Follow up in ${days}d`, days };
  return { cls: "upcoming", label: `Follow up ${due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, days };
}

const blankContact = () => ({
  id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), name: "", phone: "", email: "",
  address: "", area: "", type: "owner", follow_up_date: "", last_contacted: "", is_public: false, notes: [],
});

// search: plain words match name, phone, email, address, area and every note.
// Starting with "notes" (e.g. "notes albanian" or "notes: albanian") looks in notes only.
export function contactMatches(c, query) {
  let t = (query || "").trim().toLowerCase();
  if (!t) return true;
  const notesText = (c.notes || []).map((n) => n.body || "").join(" ").toLowerCase();
  const m = t.match(/^notes?\s*:?\s+(.+)$/) || t.match(/^notes?:(.+)$/);
  if (m) return notesText.includes(m[1].trim());
  return [c.name, c.phone, c.email, c.address, c.area, notesText].join(" ").toLowerCase().includes(t);
}
// the first note that contains the search words, for showing why a contact came up
export function matchingNote(c, query) {
  let t = (query || "").trim().toLowerCase();
  const m = t.match(/^notes?\s*:?\s+(.+)$/) || t.match(/^notes?:(.+)$/);
  if (m) t = m[1].trim();
  if (!t) return null;
  return (c.notes || []).find((n) => (n.body || "").toLowerCase().includes(t)) || null;
}

const sortNotes = (notes) => [...(notes || [])].sort((a, b) => (b.noted_at || "").localeCompare(a.noted_at || ""));

export default function Contacts({ notify, userId, userName, onGo, openId, onOpened }) {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState(null);
  const [q, setQ] = useState("");
  const [area, setArea] = useState("All");
  const [type, setType] = useState("All");
  const [dueOnly, setDueOnly] = useState(false);

  const load = async (first) => {
    const { data, error } = await supabase
      .from("contacts")
      .select("*, contact_notes(id, body, noted_at, author_name)")
      .order("updated_at", { ascending: false });
    if (error) notify?.(error.message);
    const list = (data || []).map(({ contact_notes, ...r }) => ({ ...r, notes: sortNotes(contact_notes) }));
    setRows(list);
    if (first && openId) { const k = list.find((r) => r.id === openId); if (k) setForm({ ...k }); onOpened?.(); }
    setLoaded(true);
  };
  useEffect(() => { load(true); }, []);

  // one tap: every seller on a deal and every buyer becomes a contact (no duplicates)
  const [syncing, setSyncing] = useState(false);
  const syncFromDeals = async () => {
    setSyncing(true);
    try {
      const [d, b, k] = await Promise.all([
        supabase.from("deals").select("id, data, is_public"),
        supabase.from("buyers").select("id, data, is_public"),
        supabase.from("contacts").select("id, name, phone, email, address, area, type, converted_deal_id, converted_buyer_id, owner_id"),
      ]);
      if (k.error) { notify?.(k.error.message); return; }
      const cache = k.data || [];
      let created = 0, updated = 0, failed = 0;
      const people = [
        ...(d.data || []).map((r) => sellerFromDeal({ ...(r.data || {}), id: r.id, isPublic: r.is_public })),
        ...(b.data || []).map((r) => personFromBuyer({ ...(r.data || {}), id: r.id, isPublic: r.is_public })),
      ];
      for (const person of people) {
        const res = await autoContact(person, userId, cache);
        if (res.status === "created") created++; else if (res.status === "updated") updated++; else if (res.status === "error") failed++;
      }
      await load(false);
      notify?.(`Contacts synced: ${created} added, ${updated} updated${failed ? `, ${failed} couldn't be saved` : ""}.`);
    } finally { setSyncing(false); }
  };

  // Done / next follow-up straight from the list
  const quickFollow = async (k, nextDate) => {
    const patch = { follow_up_date: nextDate || null, last_contacted: todayISO() };
    setRows(rows.map((r) => (r.id === k.id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from("contacts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", k.id);
    notify?.(error ? (error.message || "Couldn't update.") : nextDate ? `Next follow-up with ${k.name}: ${shortDate(nextDate)}` : `Follow-up with ${k.name} done.`);
  };

  const filtered = useMemo(() => {
    const t = q.toLowerCase();
    return rows.filter((c) => {
      if (area !== "All" && c.area !== area) return false;
      if (type !== "All" && c.type !== type) return false;
      if (dueOnly) { const f = followUp(c.follow_up_date); if (!f || f.days > 0) return false; }
      return contactMatches(c, t);
    });
  }, [rows, q, area, type, dueOnly]);

  const dueCount = rows.filter((c) => { const f = followUp(c.follow_up_date); return f && f.days <= 0; }).length;

  // draft = whatever is typed in the Notes box when Save is hit; it saves with the contact
  const save = async (draft) => {
    if (!form.name.trim()) return;
    const { notes: savedNotes, contact_notes, ...rest } = form;
    const notes = draft && draft.body
      ? sortNotes([{ id: "tmp" + Date.now(), body: draft.body, noted_at: draft.noted_at, author_name: userName, _pending: true }, ...(savedNotes || [])])
      : savedNotes;
    const isNew = !rows.some((r) => r.id === form.id);
    // a note typed before saving counts as contact on that date
    const pendingLatest = (notes || []).filter((n) => n._pending).map((n) => n.noted_at.slice(0, 10)).sort().pop();
    const lc = [rest.last_contacted, pendingLatest].filter(Boolean).sort().pop() || null;
    const rec = { ...rest, follow_up_date: rest.follow_up_date || null, last_contacted: lc, area: rest.area || null, owner_id: rest.owner_id || userId, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("contacts").upsert(rec);
    if (error) { notify?.(error.message || "Save failed."); return; }
    // notes typed before a new contact was saved go in after the contact row exists
    const pending = (notes || []).filter((n) => n._pending);
    let nerr = null;
    if (pending.length) {
      ({ error: nerr } = await supabase.from("contact_notes").insert(pending.map((n) => ({
        contact_id: rec.id, owner_id: userId, author_name: userName, body: n.body, noted_at: new Date(n.noted_at).toISOString(),
      }))));
      if (nerr) { notify?.("Contact saved, but the note didn't save: " + (nerr.message || "try again.")); }
    }
    const saved = { ...rec, notes: sortNotes((notes || []).filter((n) => !(nerr && n._pending)).map(({ _pending, ...n }) => n)) };
    setRows(isNew ? [saved, ...rows] : rows.map((r) => (r.id === saved.id ? saved : r)));
    setForm(null);
    if (!nerr) notify?.(pending.length ? "Contact and note saved." : "Contact saved.");
  };

  const remove = async (id) => {
    setRows(rows.filter((r) => r.id !== id));
    setForm(null);
    await supabase.from("contacts").delete().eq("id", id);   // notes go with it (on delete cascade)
  };

  /* ---------- Convert: contact -> Buyer row / Deal row (same jsonb shape the Buyers and Deals pages save) ---------- */
  const appId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);   // same as uid() in App.jsx
  const boroughOf = (a) => (a === "Harlem" ? "Manhattan" : a || "");
  const notesText = (k) => (k.notes || []).map((n) => `${shortDate(n.noted_at)}: ${n.body}`).join("\n");
  const linkContact = async (k, patch) => {
    await supabase.from("contacts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", k.id);
    const next = { ...k, ...patch };
    setRows(rows.map((r) => (r.id === k.id ? { ...r, ...patch } : r)));
    setForm(next);
  };
  const convertToBuyer = async (k) => {
    if (k.converted_buyer_id) return onGo?.("buyers", k.converted_buyer_id);
    const id = appId();
    const data = {
      id, name: k.name, company: "", phone: k.phone || "", email: k.email || "",
      boroughs: boroughOf(k.area) ? [boroughOf(k.area)] : [], minSize: "", maxBudget: "", assetTypes: [],
      notes: notesText(k), isPublic: !!k.is_public, ownerName: userName, contactId: k.id,
      followUpDate: k.follow_up_date || "", lastContacted: k.last_contacted || "",
    };
    const { error } = await supabase.from("buyers").upsert({ id, data, owner_id: userId, is_public: !!k.is_public, updated_at: new Date().toISOString() });
    if (error) return notify?.(error.message || "Couldn't create the buyer.");
    await linkContact(k, { converted_buyer_id: id });
    notify?.(`${k.name} added to Buyers. Open it there to tag what they buy.`);
  };
  const convertToDeal = async (k) => {
    if (k.converted_deal_id) return onGo?.("deals", k.converted_deal_id);
    const id = appId();
    const data = {   // blankDeal() defaults + what the contact already knows
      id, address: k.address || "", borough: boroughOf(k.area) || "Bronx", neighborhood: k.area === "Harlem" ? "Harlem" : "",
      zone: "R6", photos: [], streetWidth: "narrow", devPath: "aor", lotArea: "", customFar: "", askingPrice: "",
      sellerNumber: k.phone || "", vacancy: "TBD", existingSf: "", contactName: k.name, contactPhone: k.phone || "",
      contactEmail: k.email || "", notes: notesText(k), followUpDate: k.follow_up_date || "", followUpNotes: "",
      isPublic: false, created: todayISO(), ownerName: userName, contactId: k.id, stage: "New", assetType: "",
    };
    const { error } = await supabase.from("deals").upsert({ id, data, owner_id: userId, is_public: false, updated_at: new Date().toISOString() });
    if (error) return notify?.(error.message || "Couldn't create the deal.");
    await linkContact(k, { converted_deal_id: id, type: k.type === "buyer" ? k.type : "owner" });
    notify?.(`Deal created for ${k.address || k.name}. Zoning and lot size still to fill in.`);
  };

  if (!loaded) return <div style={{ padding: 40, opacity: 0.6 }}>Loading contacts…</div>;

  if (form) return (
    <ContactForm c={form} setC={setForm} onSave={save} onCancel={() => setForm(null)} onDelete={() => remove(form.id)}
      isNew={!rows.some((r) => r.id === form.id)} mine={!form.owner_id || form.owner_id === userId}
      userId={userId} userName={userName} notify={notify}
      onToBuyer={() => convertToBuyer(form)} onToDeal={() => convertToDeal(form)}
      onNoteSaved={(cid, note, patch) => setRows(rows.map((r) => (r.id === cid ? { ...r, ...patch, notes: sortNotes([note, ...(r.notes || [])]) } : r)))} />
  );

  return (
    <>
      <header className="pageHead">
        <h1>Contacts</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="ghost" onClick={syncFromDeals} disabled={syncing} title="Adds every seller on a deal and every buyer to Contacts. Skips anyone already here.">
            {syncing ? "Syncing…" : "↻ Sync sellers & buyers"}
          </button>
          <button className="primary" onClick={() => setForm(blankContact())}>+ New contact</button>
        </div>
      </header>
      <div className="filterRow">
        <input className="search" placeholder="Search name, phone, address, notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div>
          <div className="filterLabel">Area</div>
          <div className="chips">
            {["All", ...AREAS].map((a) => <button key={a} className="chip" data-on={area === a} onClick={() => setArea(a)}>{a}</button>)}
          </div>
        </div>
        <div>
          <div className="filterLabel">Type</div>
          <div className="chips">
            {[["All", "All"], ...CONTACT_TYPES].map(([k, l]) => <button key={k} className="chip small" data-on={type === k} onClick={() => setType(k)}>{l}</button>)}
            <button className="chip small" data-on={dueOnly} onClick={() => setDueOnly(!dueOnly)}>● Follow-ups due ({dueCount})</button>
          </div>
        </div>
        <div className="resultCount">{filtered.length} of {rows.length} contacts</div>
      </div>
      {filtered.length === 0 && (
        <div className="empty">{rows.length === 0
          ? "No contacts yet. Hit “New contact” and log the call while you're still on the phone."
          : "Nothing matches those filters."}</div>
      )}
      <div className="rowList">
        {filtered.map((c) => {
          const fu = followUp(c.follow_up_date);
          const last = c.notes?.[0];
          return (
            <div key={c.id} className="row" onClick={() => setForm({ ...c })} style={{ alignItems: "flex-start" }}>
              <div style={{ flex: "3 1 220px", minWidth: 0 }}>
                <b>{c.name}</b>
                <div style={{ display: "flex", gap: 4, margin: "5px 0 2px", flexWrap: "wrap" }}>
                  <span className="tag type">{typeLabel(c.type)}</span>
                  {c.area && <span className="tag area">{c.area}</span>}
                  {c.converted_deal_id && <span className="tag seller">Seller on a deal</span>}
                </div>
                {c.address && <div className="rowSub">{c.address}</div>}
                {last && <div className="lastNote"><b>{shortDate(last.noted_at)}</b>{last.body}</div>}
              </div>
              <div style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5 }}>
                {c.phone && <span style={{ opacity: 0.75 }}>{c.phone}</span>}
                <QuickActions phone={c.phone} email={c.email} small />
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                  <LastContactedTag date={c.last_contacted} />
                  {fu && <div className={"followTag " + fu.cls} style={{ marginTop: 0 }}>● {fu.label}</div>}
                </div>
                {fu && fu.days <= 0 && (
                  <FollowUpQuick compact onDone={() => quickFollow(c, null)} onNext={(d) => quickFollow(c, d)} />
                )}
                <span className="rowSub" style={{ marginTop: 2 }}>{(c.notes || []).length} note{(c.notes || []).length === 1 ? "" : "s"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ContactForm({ c, setC, onSave, onCancel, onDelete, isNew, mine, userId, userName, notify, onNoteSaved, onToBuyer, onToDeal }) {
  const set = (k) => (e) => setC({ ...c, [k]: e.target.value });
  const [arm, setArm] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteDate, setNoteDate] = useState(todayISO());
  const fu = followUp(c.follow_up_date);
  // Save contact also saves whatever is typed in the Notes box (no need to tap "Add note" first)
  const saveAll = () => {
    const body = noteText.trim();
    onSave(body ? { body, noted_at: noteDate + "T" + new Date().toTimeString().slice(0, 8) } : null);
  };

  const addNote = async () => {
    const body = noteText.trim();
    if (!body) return;
    const noted_at = noteDate + "T" + new Date().toTimeString().slice(0, 8);
    if (isNew) {
      setC({ ...c, notes: sortNotes([{ id: "tmp" + Date.now(), body, noted_at, author_name: userName, _pending: true }, ...(c.notes || [])]) });
    } else {
      const { data, error } = await supabase.from("contact_notes")
        .insert({ contact_id: c.id, owner_id: userId, author_name: userName, body, noted_at: new Date(noted_at).toISOString() })
        .select().single();
      if (error) { notify?.(error.message || "Note not saved."); return; }
      const note = data || { id: "n" + Date.now(), body, noted_at, author_name: userName };
      // logging a call moves "last contacted" forward (never back)
      const patch = !c.last_contacted || noteDate > c.last_contacted ? { last_contacted: noteDate } : {};
      if (patch.last_contacted) await supabase.from("contacts").update(patch).eq("id", c.id);
      setC({ ...c, ...patch, notes: sortNotes([note, ...(c.notes || [])]) });
      onNoteSaved?.(c.id, note, patch);
    }
    setNoteText("");
    setNoteDate(todayISO());
  };

  return (
    <>
      <header className="pageHead">
        <h1>{isNew ? "New contact" : c.name || "Edit contact"}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {!isNew && mine && <button className="danger" onClick={() => (arm ? onDelete() : setArm(true))}>{arm ? "Tap again to delete" : "Delete"}</button>}
          <button className="ghost" onClick={onCancel}>{mine ? "Cancel" : "Back"}</button>
          {mine && <button className="primary" onClick={saveAll} disabled={!c.name.trim()}>Save contact</button>}
        </div>
      </header>
      <div className="formCols">
        <div className="formMain">
          <div className="fgroup">
            <div className="ftitle">Contact</div>
            <div className="frow">
              <Fld label="Name *"><input value={c.name} onChange={set("name")} /></Fld>
              <Fld label="Type">
                <select value={c.type} onChange={set("type")}>
                  {CONTACT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Fld>
            </div>
            <div className="frow">
              <Fld label="Phone"><input type="tel" value={c.phone} onChange={set("phone")} /></Fld>
              <Fld label="Email"><input type="email" value={c.email} onChange={set("email")} /></Fld>
            </div>
            <QuickActions phone={c.phone} email={c.email} />
          </div>
          <div className="fgroup">
            <div className="ftitle">Location</div>
            <Fld label="Address" wide><input value={c.address} onChange={set("address")} placeholder="24 Penn St, Brooklyn, NY" /></Fld>
            <Fld label="Area" wide>
              <select value={c.area || ""} onChange={set("area")}>
                <option value="">Select area…</option>
                {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Fld>
          </div>
          <div className="fgroup">
            <div className="ftitle">Follow-up</div>
            <div className="frow">
              <Fld label="Next follow-up date"><input type="date" value={c.follow_up_date || ""} onChange={set("follow_up_date")} /></Fld>
              <Fld label="Last contacted">
                <div className="dateWithBtn">
                  <input type="date" value={c.last_contacted || ""} onChange={set("last_contacted")} />
                  <button className="ghost" onClick={() => setC({ ...c, last_contacted: todayISO() })}>Today</button>
                </div>
              </Fld>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {!isNew && <LastContactedTag date={c.last_contacted} />}
              {fu && <div className={"followTag " + fu.cls} style={{ marginTop: 0 }}>● {fu.label}</div>}
            </div>
            <div className="hintline">Adding a note updates Last contacted automatically.</div>
          </div>
          {mine && (
            <div className="fgroup">
              <div className="ftitle">Visibility</div>
              <div className="visRow">
                <button className="visBtn" data-on={!c.is_public} onClick={() => setC({ ...c, is_public: false })}>
                  <b>Private</b><span>Only you can see this</span>
                </button>
                <button className="visBtn" data-on={!!c.is_public} onClick={() => setC({ ...c, is_public: true })}>
                  <b>Published</b><span>Your team can view it</span>
                </button>
              </div>
            </div>
          )}
        </div>
        {!isNew && mine && <div className="formSide">
          {(
            <div className="fgroup">
              <div className="ftitle">Convert</div>
              <div className="convertRow">
                <button className="ghost" data-on={!!c.converted_buyer_id} onClick={onToBuyer}>
                  {c.converted_buyer_id ? "✓ In Buyers · open" : "→ Convert to Buyer"}
                </button>
                <button className="ghost" data-on={!!c.converted_deal_id} onClick={onToDeal}>
                  {c.converted_deal_id ? "✓ On a deal · open" : "→ Convert to Seller / Deal"}
                </button>
              </div>
              <div className="hintline">Buyer copies name, phone, email, area and notes into Buyers. Seller opens a deal on the Deal Desk with this address and {c.name ? c.name.split(" ")[0] : "the contact"} as the seller.</div>
            </div>
          )}
        </div>}
      </div>
      <div className="fgroup notesBox">
        <div className="ftitle">Notes</div>
        <div className="noteAdd">
            <textarea rows={4} value={noteText} onChange={(e) => setNoteText(e.target.value)}
              placeholder="Anything to remember — language, what they own, what they're looking for, how the call went…" />
            <div className="noteAddRow">
              <input type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} />
              {!isNew && <button className="ghost" onClick={addNote} disabled={!noteText.trim()}>Add note</button>}
              {mine && <button className="primary" onClick={saveAll} disabled={!c.name.trim()}>Save contact</button>}
            </div>
            <div className="hintline">{mine ? "What you type here saves with the contact, and the search finds it." : "Tap Add note to save it."}</div>
          </div>
        <div className="noteLog">
          {(c.notes || []).length === 0 && <div className="hintline">No notes yet.</div>}
          {(c.notes || []).map((n) => (
            <div key={n.id} className="noteItem">
              <div className="noteDate">{shortDate(n.noted_at)}</div>
              <div style={{ flex: 1, whiteSpace: "pre-wrap" }}>
                {n.body}
                {n.author_name && <div className="noteWho">{n.author_name}{n._pending ? " · saves with the contact" : ""}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Fld({ label, children, wide }) {
  return (
    <div className="field" style={wide ? { flex: "1 1 100%" } : {}}>
      <label className="flabel">{label}</label>
      {children}
    </div>
  );
}
