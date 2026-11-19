export const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];
export const TYPES = { standalone: 'Standalone', sandwich: 'Sandwich / assemblage', air_rights: 'Air rights', fallback: '50′+ fallback' };
export const STATUSES = ['New', 'To call', 'Follow up', 'Passed'];
export const LISTING = { verified_listed: 'Verified listing', not_found: 'No listing found', unknown: 'Listing unknown' };
export const CERTAINTY = { screened: 'Screened estimate', concept: 'Concept estimate', unconfirmed: 'Unconfirmed' };
export const PARCEL_ROLES = { anchor: 'Anchor / receiver', left: 'Left neighbor', right: 'Right neighbor', acquisition: 'Other acquisition lot', donor: 'Retained donor' };
export const MAX_BYTES = 1800000;
const ID = /^[a-z0-9][a-z0-9._:-]{0,95}$/;
const BBL = /^[1-5][0-9]{9}$/;
const realISO = /^\d{4}-\d\d-\d\d(?:T\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d))?$/;
const object = (x) => x && typeof x === 'object' && !Array.isArray(x);
const must = (s, msg) => { if (!s) throw new Error(msg); };
const txt = (v, max, label, required = false) => {
  if (v == null && !required) return '';
  must(typeof v === 'string' && (v.trim() || !required) && v.trim().length <= max && !v.includes('\0'), `Invalid ${label}.`);
  return v.trim();
};
const num = (v, label, integer = false) => {
  if (v == null) return null;
  must(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e12 && (!integer || Number.isSafeInteger(v)), `Invalid ${label}.`);
  return v;
};
const enumVal = (v, allowed, label) => { must(allowed.includes(v), `Invalid ${label}.`); return v; };
const date = (v, label, required = false) => {
  if (!v && !required) return '';
  must(typeof v === 'string' && realISO.test(v) && Number.isFinite(Date.parse(v)), `Invalid ${label}.`);
  return v;
};
const strings = (xs, label) => {
  if (xs == null) return [];
  must(Array.isArray(xs) && xs.length <= 24, `Invalid ${label}.`);
  return xs.map((x) => txt(x, 900, label, true));
};
const range = (v, label, integer = false, certainty = false) => {
  if (v == null) return null;
  must(object(v), `Invalid ${label} range.`);
  const min = num(v.min, label, integer), max = num(v.max, label, integer);
  must(min != null && max != null && min <= max, `Invalid ${label} range.`);
  return certainty ? { min, max, certainty: enumVal(v.certainty, Object.keys(CERTAINTY), 'unit confidence') } : { min, max };
};
export function safeLink(raw) {
  if (typeof raw !== 'string' || raw.length > 1800) return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : '';
  } catch { return ''; }
}
const link = (s) => {
  must(object(s) && safeLink(s.url), 'Source links must be HTTPS and contain no credentials.');
  return { label: txt(s.label, 120, 'source label', true), url: safeLink(s.url) };
};
const links = (v) => {
  if (v == null) return [];
  must(Array.isArray(v) && v.length <= 24, 'Invalid source links.');
  return v.map(link);
};
const parcelRef = (p) => {
  must(object(p) && typeof p.bbl === 'string' && BBL.test(p.bbl), 'Each parcel needs a valid ten-digit BBL.');
  return { address: txt(p.address, 240, 'parcel address', true), bbl: p.bbl };
};
const parseSite = (p) => {
  must(object(p) && typeof p.id === 'string' && ID.test(p.id), 'Invalid stable site ID.');
  must(Number.isSafeInteger(p.rank) && p.rank > 0 && p.rank <= 150, 'Rank must be 1–150.');
  const type = enumVal(p.type, Object.keys(TYPES), 'site type'), borough = enumVal(p.borough, BOROUGHS, 'borough');
  const anchor = parcelRef(p.anchor);
  const units = num(p.existing_units, 'existing redevelopment units', true);
  must(units == null || units <= 10, 'More than ten existing redevelopment units.');
  const frontage = num(p.frontage_ft, 'anchor frontage');
  const target = range(p.target_units, 'target units', true, true);
  must(type === 'fallback' ? (frontage >= 50 && (!target || target.certainty === 'unconfirmed')) : (target && target.max >= 30),
    'A fallback needs 50′+ anchor frontage and an unconfirmed yield; a target site needs a 30+ scenario.');
  must(Array.isArray(p.parcels) && p.parcels.length > 0 && p.parcels.length <= 30, 'Each site needs a parcel breakdown.');
  const parcels = p.parcels.map((v) => ({ ...parcelRef(v), role: enumVal(v.role, Object.keys(PARCEL_ROLES), 'parcel role'),
    existing_units: num(v.existing_units, 'parcel residential units', true), area_sf: num(v.area_sf, 'parcel area'),
    frontage_ft: num(v.frontage_ft, 'parcel frontage'), ownership: txt(v.ownership, 240, 'ownership evidence'),
    geometry: txt(v.geometry, 850, 'parcel relationship'), sources: links(v.sources) }));
  const receiver = parcels.filter((v) => v.role === 'anchor');
  must(new Set(parcels.map((v) => v.bbl)).size === parcels.length && receiver.length === 1 && receiver[0].bbl === anchor.bbl,
    'Parcels need distinct BBLs and exactly one matching anchor.');
  const acquired = parcels.filter((v) => v.role !== 'donor'), donors = parcels.filter((v) => v.role === 'donor');
  must((type === 'air_rights') === (donors.length > 0), 'Air-rights sites must identify each retained donor separately.');
  must(type !== 'sandwich' || acquired.some((v) => ['left', 'right', 'acquisition'].includes(v.role)), 'Assemblage needs at least one acquisition neighbor.');
  if (acquired.every((v) => v.existing_units != null)) {
    must(acquired.reduce((sum, v) => sum + v.existing_units, 0) === units, 'Site existing units must equal acquisition-parcel units only (exclude retained donors).');
  }
  let air_rights = null;
  if (type === 'air_rights') {
    const a = p.air_rights;
    must(object(a) && a.transfer_verified === false, 'Air rights must identify transfer as unverified.');
    air_rights = { transfer_verified: false,
      receiver_standalone_sf: range(a.receiver_standalone_sf, 'receiver standalone zoning SF'),
      donor_unused_sf: range(a.donor_unused_sf, 'estimated donor unused zoning SF'),
      receiver_increment_sf: range(a.receiver_increment_sf, 'plausible receiver increment'),
      new_build_sf: range(a.new_build_sf, 'combined new build SF'),
      confidence: enumVal(a.confidence, Object.keys(CERTAINTY), 'air-rights confidence'),
      title_risk: txt(a.title_risk, 1000, 'title risk', true), zoning_risk: txt(a.zoning_risk, 1000, 'zoning risk', true),
      envelope_risk: txt(a.envelope_risk, 1000, 'receiver envelope risk', true) };
    if (air_rights.receiver_increment_sf && air_rights.donor_unused_sf) {
      must(air_rights.receiver_increment_sf.max <= air_rights.donor_unused_sf.max, 'Receiver increment exceeds estimated donor unused area.');
    }
  }
  const l = p.listing ?? { status: 'unknown' };
  must(object(l), 'Invalid listing evidence.');
  const listing = { status: enumVal(l.status, Object.keys(LISTING), 'listing evidence'),
    ask_usd: num(l.ask_usd, 'asking price'), checked_at: date(l.checked_at, 'listing check date', l.status !== 'unknown'),
    source: l.source == null ? null : link(l.source), note: txt(l.note, 800, 'listing note') };
  must(listing.status !== 'verified_listed' || listing.source, 'A verified listing needs a dated source.');
  must(listing.status === 'verified_listed' || listing.ask_usd == null, 'Unverified asking prices cannot be imported.');
  const sources = links(p.sources);
  must(sources.length, 'Each lead needs source evidence.');
  return { id:p.id, rank:p.rank, type, borough, anchor, existing_units:units, frontage_ft:frontage,
    depth_ft:num(p.depth_ft, 'anchor depth'), lot_area_sf:num(p.lot_area_sf, 'anchor area'),
    combined_area_sf:num(p.combined_area_sf, 'redevelopment area'), combined_frontage_ft:num(p.combined_frontage_ft, 'combined frontage'),
    neighborhood:txt(p.neighborhood, 160, 'neighborhood'), zoning:txt(p.zoning, 240, 'zoning'), buildable_sf:range(p.buildable_sf,'new build zoning SF'),
    standalone_buildable_sf:range(p.standalone_buildable_sf,'anchor-alone zoning SF'), target_units:target, air_rights, parcels, listing, why_call:txt(p.why_call, 1300, 'call rationale', true),
    fit:txt(p.fit, 950, 'site fit'), risks:strings(p.risks,'delivery risks'), assumptions:strings(p.assumptions,'sizing assumptions'), sources };
};
export function parseSnapshot(raw) {
  must(object(raw) && raw.schema_version === 1, 'Use a Development Leads research file (schema version 1).');
  must(Array.isArray(raw.leads) && raw.leads.length > 0 && raw.leads.length <= 150, 'A snapshot needs 1–150 ranked sites.');
  const leads = raw.leads.map((p, i) => {
    try { return parseSite(p); } catch (e) { throw new Error(`Site ${i + 1}: ${e.message}`); }
  }).sort((a, b) => a.rank - b.rank);
  must(new Set(leads.map((v) => v.id)).size === leads.length && new Set(leads.map((v) => v.rank)).size === leads.length,
    'Duplicate site ID or rank. Nothing was imported.');
  return { schema_version:1, generated_at:date(raw.generated_at, 'research date', true),
    label:txt(raw.label,140,'snapshot label'), methodology:txt(raw.methodology,5500,'methodology'), leads };
}
export const emptyEdits = { address:'', contact_name:'', phone:'', note:'', status:'New' };
export const dialNumber = (raw) => {
  if (!raw) return '';
  const m = String(raw).match(/^([+0-9().\s-]+?)(?:\s*(?:x|ext\.?|#)\s*(\d{1,8}))?$/i);
  const digits = m?.[1]?.replace(/\D/g,'') || '';
  return digits.length >= 7 && digits.length <= 15 ? `${m[1].trim().startsWith('+') ? '+' : ''}${digits}${m[2] ? ';ext='+m[2] : ''}` : '';
};
export function cleanEdits(data) {
  const phone = txt(data.phone,60,'phone');
  must(!phone || dialNumber(phone),'Enter a valid phone number, or leave it blank.');
  return { address:txt(data.address,240,'working address'), contact_name:txt(data.contact_name,160,'contact name'), phone,
    note:txt(data.note,3000,'private note'), status:enumVal(data.status,STATUSES,'status') };
}
export function inFilter(site, edits, f) {
  const units = site.target_units;
  const u = units && units.certainty !== 'unconfirmed' && site.type !== 'fallback' ? units : null;
  if (f.borough && site.borough !== f.borough || f.type && site.type !== f.type || f.listing && site.listing.status !== f.listing ||
      f.status && (edits?.status || 'New') !== f.status) return false;
  if (f.units === '30-99' && (!u || u.max < 30 || u.min > 99) || f.units === '100+' && (!u || u.max < 100) ||
      f.units === '299+' && (!u || u.max < 299) || f.units === 'unconfirmed' && u) return false;
  const existing = site.existing_units;
  if (f.existing === '0-5' && (existing == null || existing > 5) || f.existing === '6-10' && (existing == null || existing < 6 || existing > 10) ||
      f.existing === 'unknown' && existing != null) return false;
  if (f.frontage && !(site.frontage_ft >= Number(f.frontage))) return false;
  const hay = [site.anchor.address,site.borough,site.anchor.bbl,site.neighborhood,site.zoning,site.why_call,edits?.address,edits?.contact_name,edits?.phone,
    ...site.parcels.flatMap((p) => [p.address,p.bbl,p.ownership])].join(' ').toLowerCase();
  return !f.q || f.q.trim().toLowerCase().split(/\s+/).every((part) => hay.includes(part));
}
export function roughSensitivity(sf) {
  return sf ? { min:Math.floor(sf.min / 680), max:Math.floor(sf.max / 680) } : null;
}
