import React, { useState } from "react";
import { supabase } from "./supabaseClient";

/* ============================================================
   Shared CRM bits: one-tap Call / Text / Email, "last contacted"
   ============================================================ */

export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const dial = (p) => String(p || "").replace(/[^\d+]/g, "");

export function QuickActions({ phone, email, subject, small }) {
  const tel = dial(phone);
  if (!tel && !email) return null;
  return (
    <div className={"qa" + (small ? " small" : "")} onClick={(e) => e.stopPropagation()}>
      {tel && <a className="qaBtn" href={`tel:${tel}`}>Call</a>}
      {tel && <a className="qaBtn" href={`sms:${tel}`}>Text</a>}
      {email && <a className="qaBtn" href={`mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`}>Email</a>}
    </div>
  );
}

// "last contacted" -> { label, days, cold, never }   cold = more than 30 days ago
export function lastContacted(dateStr) {
  if (!dateStr) return { label: "Not logged yet", days: null, cold: false, never: true };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(String(dateStr).slice(0, 10) + "T00:00:00");
  if (isNaN(d.getTime())) return { label: "Not logged yet", days: null, cold: false, never: true };
  const days = Math.round((today - d) / 86400000);
  const label = days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
  return { label, days, cold: days > 30 };
}

export function LastContactedTag({ date }) {
  const l = lastContacted(date);
  return <span className={"lastTag" + (l.cold ? " cold" : l.never ? " never" : "")} title={date || ""}>Last contacted: {l.label}</span>;
}

/* ============================================================
   Auto-contacts: every seller saved on a deal and every buyer
   saved on the Buyers page lands in Contacts — once.
   Match order: same linked record -> phone (last 10 digits) ->
   email -> name (only when phone/email don't contradict).
   A match only fills blanks; it never overwrites what's there.
   ============================================================ */
const AREA_OK = ["Brooklyn", "Queens", "Manhattan", "Harlem", "Bronx"];   // contacts.area check constraint
export const digits10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const normName = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normEmail = (e) => String(e || "").trim().toLowerCase();

export function findContactMatch(list, { name, phone, email, dealId, buyerId }) {
  const ph = digits10(phone), em = normEmail(email), nm = normName(name);
  return (
    (dealId && list.find((c) => c.converted_deal_id === dealId)) ||
    (buyerId && list.find((c) => c.converted_buyer_id === buyerId)) ||
    (ph.length >= 7 && list.find((c) => digits10(c.phone) === ph)) ||
    (em && list.find((c) => normEmail(c.email) === em)) ||
    (nm && list.find((c) => normName(c.name) === nm &&
      !(ph.length >= 7 && digits10(c.phone).length >= 7 && digits10(c.phone) !== ph) &&
      !(em && c.email && normEmail(c.email) !== em))) ||
    null
  );
}

// person = { name, phone, email, address, area, type: 'owner'|'buyer', dealId, buyerId, isPublic }
// -> { status: 'created'|'updated'|'exists'|'skipped', id?, error? }
export async function autoContact(person, userId, cache) {
  const name = String(person.name || "").trim();
  const phone = String(person.phone || "").trim();
  const email = String(person.email || "").trim();
  if (!name && digits10(phone).length < 7 && !email) return { status: "skipped" };
  let list = cache;
  if (!list) {
    const { data, error } = await supabase.from("contacts").select("id, name, phone, email, address, area, type, converted_deal_id, converted_buyer_id, owner_id");
    if (error) return { status: "error", error: error.message };
    list = data || [];
  }
  const area = AREA_OK.includes(person.area) ? person.area : null;
  const hit = findContactMatch(list, { name, phone, email, dealId: person.dealId, buyerId: person.buyerId });
  if (hit) {
    const patch = {};
    if (!hit.phone && phone) patch.phone = phone;
    if (!hit.email && email) patch.email = email;
    if (!hit.address && person.address) patch.address = person.address;
    if (!hit.area && area) patch.area = area;
    if (person.dealId && !hit.converted_deal_id) patch.converted_deal_id = person.dealId;
    if (person.buyerId && !hit.converted_buyer_id) patch.converted_buyer_id = person.buyerId;
    if (!Object.keys(patch).length) return { status: "exists", id: hit.id };
    const { error } = await supabase.from("contacts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", hit.id);
    if (error) return { status: "error", error: error.message, id: hit.id };
    Object.assign(hit, patch);
    return { status: "updated", id: hit.id };
  }
  const id = crypto.randomUUID ? crypto.randomUUID() : undefined;
  const rec = {
    ...(id ? { id } : {}),
    name: name || phone || email, phone: phone || null, email: email || null,
    address: person.address || null, area, type: person.type === "buyer" ? "buyer" : "owner",
    is_public: !!person.isPublic, owner_id: userId,
    converted_deal_id: person.dealId || null, converted_buyer_id: person.buyerId || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("contacts").insert(rec).select("id").maybeSingle();
  if (error) return { status: "error", error: error.message };
  list.push({ ...rec, id: data?.id || id });
  return { status: "created", id: data?.id || id };
}

// the seller on a deal / the buyer record, in contact shape
export const sellerFromDeal = (d) => ({
  name: d.contactName, phone: d.contactPhone, email: d.contactEmail,
  address: d.address && d.borough && !String(d.address).toLowerCase().includes(String(d.borough).toLowerCase()) ? `${d.address}, ${d.borough}` : (d.address || ""),
  area: d.borough, type: "owner", dealId: d.id, isPublic: !!d.isPublic,
});
export const personFromBuyer = (b) => ({
  name: b.name, phone: b.phone, email: b.email, address: "",
  area: (b.boroughs || []).length === 1 ? b.boroughs[0] : null, type: "buyer", buyerId: b.id, isPublic: !!b.isPublic,
});

/* ============================================================
   Follow-up quick actions: Done (clears it) or set the next date
   ============================================================ */
const isoPlus = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const nextMonday = () => { const d = new Date(); const add = ((8 - d.getDay()) % 7) || 7; return isoPlus(add); };
export const shortDay = (iso) => iso ? new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";

export function FollowUpQuick({ onDone, onNext, compact, dark }) {
  const [open, setOpen] = useState(false);
  const stop = (e) => e.stopPropagation();
  const pick = (iso) => { setOpen(false); if (iso) onNext(iso); };
  return (
    <div className={"fuq" + (compact ? " compact" : "") + (dark ? " dark" : "")} onClick={stop}>
      <div className="fuqBtns">
        <button className="fuqDone" onClick={() => onDone()}>✓ Done</button>
        <button className="fuqNext" data-on={open} onClick={() => setOpen(!open)}>Next follow-up…</button>
      </div>
      {open && (
        <div className="fuqPick">
          <button onClick={() => pick(isoPlus(1))}>Tomorrow</button>
          <button onClick={() => pick(isoPlus(3))}>In 3 days</button>
          <button onClick={() => pick(nextMonday())}>Next Mon</button>
          <button onClick={() => pick(isoPlus(7))}>1 week</button>
          <button onClick={() => pick(isoPlus(14))}>2 weeks</button>
          <button onClick={() => pick(isoPlus(30))}>1 month</button>
          <label className="fuqDate">Pick date<input type="date" min={isoPlus(0)} onChange={(e) => pick(e.target.value)} /></label>
        </div>
      )}
    </div>
  );
}
