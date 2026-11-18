const NYC_BOROUGHS = ["Manhattan", "Bronx", "Brooklyn", "Queens", "Staten Island"];
export const BOARD_BOROUGHS = ["Manhattan", "Brooklyn", "Bronx"];
export const ACTIVE_STAGES = ["To Call", "No Number", "Called", "Follow Up", "Hot Lead"];
export const CLOSED_STAGES = ["Pass", "Converted", "Other status"];
const stages = [...ACTIVE_STAGES, ...CLOSED_STAGES];
const legacyStages = new Map([
  ["calling", "To Call"], ["interested", "Hot Lead"], ["follow-up", "Follow Up"],
  ["not interested", "Pass"], ["archived", "Other status"],
]);
const norm = (value) => String(value ?? "").trim().toLowerCase();
export const prospectKey = (p) => `${p.date}|${(p.base && (p.base.bbl || p.base.address)) || p.rank}`;
export const boroughName = (value) => NYC_BOROUGHS.find((b) => norm(b) === norm(value)) || (norm(value) === "the bronx" ? "Bronx" : "");

const BORO_SUFFIX = /(?:,\s*|\s+)(the bronx|bronx|brooklyn|manhattan|queens|staten island|new york)(?:\s*,?\s*(?:ny|new york)(?:\s+\d{5}(?:-\d{4})?)?|\s+\d{5}(?:-\d{4})?)?\s*$/i;
const STATE_SUFFIX = /,\s*(?:ny|new york)(?:\s+\d{5}(?:-\d{4})?)?\s*$/i;
export const street = (address) => String(address || "").trim().replace(BORO_SUFFIX, "").replace(STATE_SUFFIX, "").trim();
export function addressBorough(address) {
  const text = String(address || "").trim();
  const suffix = text.match(BORO_SUFFIX);
  const explicit = boroughName(suffix?.[1]);
  if (explicit) return explicit;
  const zip = text.match(/\b(?:NY|New York)\s+(\d{3})\d{2}(?:-\d{4})?$/i)?.[1];
  if (["100", "101", "102"].includes(zip)) return "Manhattan";
  if (zip === "104") return "Bronx";
  if (zip === "112") return "Brooklyn";
  if (zip === "103") return "Staten Island";
  if (["111", "113", "114", "116"].includes(zip)) return "Queens";
  // New York, NY is the postal city for Manhattan; a bare NY suffix is not.
  return suffix && /new york\s*,?\s+ny(?:\s|$)/i.test(suffix[0]) ? "Manhattan" : "";
}
const bblBorough = (bbl) => NYC_BOROUGHS[Number(String(bbl ?? "").trim().match(/^([1-5])\d{9}$/)?.[1]) - 1] || "";
export const prospectBorough = (p) => boroughName(p?.borough) || bblBorough(p?.base?.bbl) || addressBorough(p?.base?.address);
export const neighborBorough = (n, p) => boroughName(n?.borough) || bblBorough(n?.bbl) || addressBorough(n?.address) || prospectBorough(p);
export function withBorough(address, borough) {
  if (!address || !borough || addressBorough(address) === borough) return address || "";
  const line = street(address);
  return line ? `${line}, ${borough}` : "";
}

const positive = (value) => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};
export function parcelMetrics(base = {}) {
  const lot = positive(base.lot_sf);
  const far = positive(base.max_far);
  const legacy = !Object.hasOwn(base, "buildable_sf_aor") && lot && far && base.max_far_verified !== false && base.lot_sf_verified !== false
    ? positive(lot * far) : null;
  return { lot, far, aor: positive(base.buildable_sf_aor) ?? legacy, uap: positive(base.buildable_sf_uap), legacy: legacy !== null };
}

export function ownerPhone(value) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const clean = String(value).replace(/\s*(?:ext\.?|x|#)\s*\d+\s*$/i, "").trim();
  if (!/^\+?[\d()\s.-]+$/.test(clean)) return "";
  const digits = clean.replace(/\D/g, "");
  if (/^(\d)\1+$/.test(digits)) return "";
  if (clean.startsWith("+")) return /^[1-9]\d{7,14}$/.test(digits) && (!digits.startsWith("1") || digits.length === 11) ? `+${digits}` : "";
  if (/^[2-9]\d{9}$/.test(digits)) return `+1${digits}`;
  return /^1[2-9]\d{9}$/.test(digits) ? `+${digits}` : "";
}

export const prospectPhone = (p, contacts) => contacts.map((c) => c.role === "owner" ? ownerPhone(c.phone) : "").find(Boolean)
  || ownerPhone(p.base?.owner_phone);

export function hasCall(entry = {}) {
  // Calling, a callback date and an interested seller aren't evidence a call took place.
  return entry.called !== false && (entry.called === true || !!entry.calledAt || norm(entry.stage || entry.status) === "called");
}
export function prospectStage(entry = {}, phone = "", contacts = []) {
  if (stages.includes(entry.stage)) return entry.stage;
  const old = norm(entry.status);
  const exact = stages.find((stage) => norm(stage) === old);
  if (["Pass", "Converted", "Other status"].includes(exact)) return exact;
  if (old === "not interested" || old === "archived") return legacyStages.get(old);
  if (contacts.some((contact) => contact.converted_deal_id || contact.status === "Converted")) return "Converted";
  if (["", "new", "calling", "called"].includes(old) && contacts.some((contact) =>
    contact.status === "Follow-up" || (contact.callbackAt && contact.status !== "Not interested"))) return "Follow Up";
  if (exact) return exact;
  if (legacyStages.has(old)) return legacyStages.get(old);
  if (old && old !== "new") return "Other status";
  if (hasCall(entry)) return "Called";
  return phone ? "To Call" : "No Number";
}
export function recordCall(entry, at) {
  return hasCall(entry) ? { ...entry, called: true } : { ...entry, called: true, calledAt: at };
}
export function moveProspect(entry, stage, at) {
  const saved = stage === "Called" ? recordCall(entry, at) : hasCall(entry) ? { ...entry, called: true } : entry;
  return { ...saved, stage, stageAt: at };
}
export function clearCall(entry, stage, phone, at) {
  const next = { ...entry, called: false, calledAt: null };
  return stage === "Called" ? moveProspect(next, phone ? "To Call" : "No Number", at) : next;
}
export function researchTag(p) {
  const fields = [p.priority, p.recommendation, p.hotness, p.tier, ...(Array.isArray(p.tags) ? p.tags : [])];
  const text = fields.filter((f) => typeof f === "string").join(" ");
  const why = String(p.why || "");
  if (p.call_first === true || p.tab_pick === true || /\btab[ _-]pick\b/i.test(text) || /^\W*tab[ _-]pick\b/i.test(why)) return "Tab Pick";
  if (p.priority === true || /\b(?:hot|high|priority)\b/i.test(text) || /^\W*(?:hot|priority)\s*(?:lead\b|[—–:-])/i.test(why)) return "Research priority";
  return "";
}
