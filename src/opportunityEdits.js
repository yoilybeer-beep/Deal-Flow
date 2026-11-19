import { addressBorough, boroughName, neighborBorough, ownerPhone, parcelMetrics, prospectBorough, street } from "./opportunityBoard.js";

export const BOROUGH_CHOICES = ["Manhattan", "Brooklyn", "Bronx", "Queens", "Staten Island"];
export const PHONE_FIELD = ["phone", "Contact phone", "tel"];
export const CARD_FIELDS = [
  ["Property & contact", [
    ["address", "Display address"], ["borough", "Borough", "borough"], ["neighborhood", "Neighborhood"],
    ["name", "Owner or contact name"], PHONE_FIELD, ["email", "Contact email", "email"],
  ]],
  ["Lot & deal figures", [
    ["askingPrice", "Asking price ($)", "number"], ["zoning", "Zoning"], ["lot_sf", "Lot area (SF)", "number"],
    ["front_ft", "Frontage (ft)", "number"], ["depth_ft", "Depth (ft)", "number"], ["irregular_lot", "Lot shape", "shape"],
    ["max_far", "FAR", "number"], ["buildable_sf_aor", "Buildable as of right (SF)", "number"],
    ["buildable_sf_uap", "Buildable with UAP (SF)", "number"], ["unused_sf", "Unused area (SF)", "number"],
    ["estimated_homes", "Estimated homes on this lot", "whole"], ["combined_buildable_gsf", "Combined buildable (SF)", "number"],
    ["est_units", "Combined estimated homes", "whole"],
    ["existing_bldg_sf", "Existing building (SF)", "number"], ["bldg_class", "Building class"],
    ["floors", "Existing floors", "number"], ["units", "Existing units", "whole"], ["year_built", "Year built", "whole"],
  ]],
];
const neighborFields = [["address", "Neighbor address"], ["borough", "Neighbor borough", "borough"],
  ["owner", "Neighbor owner"], ["side", "Side"], ["unused_sf", "Neighbor unused area (SF)", "number"]];
const neighborField = (i, field) => `neighbor:${i}:${field}`;
const baseFields = ["address", "zoning", "lot_sf", "front_ft", "depth_ft", "irregular_lot", "max_far", "buildable_sf_aor",
  "buildable_sf_uap", "unused_sf", "existing_bldg_sf", "bldg_class", "floors", "units", "year_built"];
const topFields = ["neighborhood", "combined_buildable_gsf", "est_units", "estimated_homes"];
const text = (value) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
export const titleCase = (value) => text(value).toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bLlc\b/g, "LLC").replace(/\bInc\b/g, "Inc").replace(/\bCorp\b/g, "Corp");
const number = (value) => {
  const raw = text(value);
  if (!/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)$/.test(raw)) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const numeric = (value) => number(value) ?? "";
const own = (record, key) => Object.hasOwn(record, key);

export function cardPhoneHref(value) {
  const tel = ownerPhone(value);
  const extension = text(value).match(/\s*(?:ext\.?|x|#)\s*(\d+)$/i)?.[1];
  return tel && (extension ? `${tel};ext=${extension}` : tel);
}

export function opportunityCard(p, entry = {}, people = []) {
  const b = p.base || {}, metrics = parcelMetrics(b);
  const owners = people.filter((c) => c.role === "owner");
  const linked = owners.find((c) => ownerPhone(c.phone));
  const phone = text(linked?.phone) || (ownerPhone(b.owner_phone) ? text(b.owner_phone) : "");
  const baseline = {
    address: text(b.address), borough: prospectBorough(p), neighborhood: text(p.neighborhood),
    name: text(linked?.name || owners[0]?.name) || titleCase(b.owner), phone,
    email: text(linked?.email || owners[0]?.email || b.owner_email), askingPrice: numeric(b.asking_price ?? p.asking_price ?? p.askingPrice),
    zoning: text(b.zoning), bldg_class: text(b.bldg_class), irregular_lot: b.irregular_lot === true ? "yes" : b.irregular_lot === false ? "no" : "",
    estimated_homes: numeric(p.estimated_homes ?? b.estimated_homes), combined_buildable_gsf: numeric(p.combined_buildable_gsf),
    est_units: numeric(p.est_units), lot_sf: numeric(b.lot_sf), front_ft: numeric(b.front_ft), depth_ft: numeric(b.depth_ft),
    max_far: numeric(b.max_far), buildable_sf_aor: metrics.aor ?? "", buildable_sf_uap: numeric(b.buildable_sf_uap), unused_sf: numeric(b.unused_sf),
    existing_bldg_sf: numeric(b.existing_bldg_sf), floors: numeric(b.floors), units: numeric(b.units), year_built: numeric(b.year_built),
  };
  const groups = [...CARD_FIELDS];
  (p.neighbors || []).forEach((n, i) => {
    const values = { address: text(n.address), borough: neighborBorough(n, p), owner: titleCase(n.owner), side: text(n.side), unused_sf: numeric(n.unused_sf) };
    groups.push([`Optional neighbor ${i + 1} · ${street(n.address) || "original listing"}`, neighborFields.map(([key, ...rest]) => {
      const field = neighborField(i, key);
      baseline[field] = values[key];
      return [field, ...rest];
    })]);
  });
  const stored = entry.cardEdits && typeof entry.cardEdits === "object" && !Array.isArray(entry.cardEdits) ? entry.cardEdits : {};
  const edits = Object.fromEntries(Object.keys(baseline).filter((key) => own(stored, key)).map((key) => [key, stored[key]]));
  const values = { ...baseline, ...edits };
  const base = { ...b };
  for (const key of baseFields) if (own(edits, key)) base[key] = key === "irregular_lot" ? edits[key] === "yes" : edits[key];
  // Area/FAR overrides don't silently manufacture a new verified buildable figure.
  if (!own(edits, "buildable_sf_aor") && (own(edits, "lot_sf") || own(edits, "max_far")) && metrics.legacy) base.buildable_sf_aor = metrics.aor;
  const display = { ...p, base };
  for (const key of topFields) if (own(edits, key)) display[key] = edits[key];
  display.neighbors = (p.neighbors || []).map((n, i) => {
    const result = { ...n };
    for (const [key] of neighborFields) if (own(edits, neighborField(i, key))) result[key] = values[neighborField(i, key)];
    const changedAddress = ["address", "borough"].some((key) => text(values[neighborField(i, key)]) !== text(baseline[neighborField(i, key)]));
    return { ...result, owner: values[neighborField(i, "owner")], displayBorough: values[neighborField(i, "borough")], changedAddress };
  });
  const addressChanged = text(values.address) !== text(baseline.address) || values.borough !== baseline.borough;
  return { source: p, display, borough: values.borough, values, edits, baseline, groups, addressChanged, phone: cardPhoneHref(values.phone) };
}

export function cardEditDraft(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, text(value)]));
}

// Only fields this editor touched are patched. Undefined is a revert to the source;
// an explicitly saved empty string (including phone) stays cleared on reload.
export function collectCardEdits(card, draft, reset, phoneOnly = false) {
  const fields = phoneOnly ? [PHONE_FIELD] : card.groups.flatMap(([, fields]) => fields);
  const changes = {}, errors = {};
  for (const [key, label, type] of fields) {
    const value = text(draft[key]), previous = text(card.values[key]);
    const revert = reset && value === text(card.baseline[key]);
    if (revert) {
      if (own(card.edits, key)) changes[key] = undefined;
      continue;
    }
    if (value === previous) continue;
    const n = type === "number" || type === "whole" ? number(value) : null;
    if (key === "address" && !value) errors[key] = "Enter a display address.";
    else if (type === "tel" && value && (value.length > 48 || !cardPhoneHref(value))) errors[key] = "Enter a valid phone number, or leave it blank.";
    else if (type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors[key] = "Enter a valid email address, or leave it blank.";
    else if (type === "borough" && value && !boroughName(value)) errors[key] = "Choose a borough from the list.";
    else if ((type === "number" || type === "whole") && value && (n == null || n >= 1e12 || (type === "whole" && !Number.isInteger(n))))
      errors[key] = `Enter a nonnegative ${type === "whole" ? "whole number" : "number"}, or leave it blank.`;
    else if (value.length > 240) errors[key] = `${label} must be 240 characters or fewer.`;
    else changes[key] = value && value === text(card.baseline[key]) ? undefined : n ?? value;
  }
  for (const prefix of ["", ...(card.source.neighbors || []).map((_, i) => `neighbor:${i}:`)]) {
    const addr = `${prefix}address`, boro = `${prefix}borough`;
    if (!own(changes, addr) && !own(changes, boro)) continue;
    const fromAddress = addressBorough(draft[addr]);
    if (fromAddress && draft[boro] && fromAddress !== draft[boro]) errors[boro] = `The address includes ${fromAddress}. Match the borough or correct the address.`;
  }
  return { changes, errors };
}

export function applyCardEdits(entry, expected, changes) {
  const now = entry.cardEdits || {};
  const toSave = Object.entries(changes).filter(([key, next]) => now[key] !== next);
  for (const [key] of toSave) {
    const related = key === "address" || key.endsWith(":address") ? key.replace(/address$/, "borough")
      : key === "borough" || key.endsWith(":borough") ? key.replace(/borough$/, "address") : "";
    if (now[key] !== expected[key] || (related && now[related] !== expected[related] &&
      !(own(changes, related) && now[related] === changes[related]))) {
      const error = new Error("A field you edited changed in another session. Your draft is still here. Cancel and reopen the card to review the latest values.");
      error.code = "CARD_CONFLICT";
      throw error;
    }
  }
  if (!toSave.length) return entry;
  const cardEdits = { ...now };
  for (const [key, next] of toSave) {
    if (next === undefined) delete cardEdits[key];
    else cardEdits[key] = next;
  }
  const result = { ...entry };
  if (Object.keys(cardEdits).length) result.cardEdits = cardEdits;
  else delete result.cardEdits;
  return result;
}

export function conversionParcel(card) {
  if (!card?.addressChanged) return card?.display.base || {};
  // A new display address hasn't been matched to a parcel. Don't transfer untouched
  // zoning/lot/size inputs from the old site into underwriting for the new address.
  return Object.fromEntries(baseFields.filter((key) => own(card.edits, key)).map((key) => [key, card.display.base[key]]));
}
