import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { HPD_RENTS, HPD_RENT_SRC, HPD_RENT_LABEL, PROGRAMS, BORO_COSTS, DEFAULT_COSTS, UNIT_SF, MKT_RENTS } from "./uwConstants";
import Papa from "papaparse";
import { supabase } from "./supabaseClient";
import Contacts, { contactMatches, matchingNote } from "./Contacts";
import Team from "./Team";
import { QuickActions, LastContactedTag, lastContacted, todayISO, autoContact, sellerFromDeal, personFromBuyer, FollowUpQuick, shortDay } from "./crmKit";

/* ============================================================
   JSTONE REALTY — DEAL PLATFORM
   ------------------------------------------------------------
   Records live one-per-row in `deals`, `buyers` and `models`,
   each stamped with the owner. Visibility is enforced by
   Postgres row-level security, not by this file: a teammate
   cannot fetch a private deal even outside the app.
   Photos go to the `deal-photos` storage bucket.
   Run supabase-schema.sql once before deploying this.
   ============================================================ */
/* ============================================================
   JSTONE REALTY — DEAL PLATFORM
   Local desktop build. All data is stored in this browser on
   this computer: records in localStorage, photos in IndexedDB.
   Nothing is uploaded anywhere.
   ============================================================ */


/* ---------- photos now live in Supabase Storage ---------- */
const photoUrl = (p) => p || "";          // records already hold full URLs
const photosBoot = async () => {};        // nothing to preload any more

async function photoDel(url) {
  if (!supabase || !url) return;
  const marker = "/deal-photos/";
  const i = url.indexOf(marker);
  if (i < 0) return;                      // not one of ours; leave it alone
  const path = decodeURIComponent(url.slice(i + marker.length));
  try { await supabase.storage.from("deal-photos").remove([path]); } catch (e) {}
}

/* ---------- export a snapshot of everything you can see ---------- */
async function exportBackup() {
  const grab = async (t) => (await supabase.from(t).select("id, data, owner_id, is_public, updated_at")).data || [];
  const [deals, buyers, models] = await Promise.all([grab("deals"), grab("buyers"), grab("models")]);
  const payload = {
    app: "jstone-realty", version: 2, exported: new Date().toISOString(),
    deals, buyers, models,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "jstone-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ============================================================
   SHARED LIBRARY
   ============================================================ */

/* ---------- NYC residential FAR (post City of Yes, ZR 23-21/23-22) ----------
   aor = as-of-right FAR ; uap = max FAR with UAP affordable housing */
const farDB = {
  'R1-1':{aor:0.75,uap:1.00},'R1-2':{aor:0.75,uap:1.00},'R1-2A':{aor:0.75,uap:1.00},
  'R2':{aor:0.75,uap:1.00},'R2A':{aor:0.75,uap:1.00},'R2X':{aor:1.00,uap:1.00},
  'R3-1':{aor:0.75,uap:1.00},'R3-2':{aor:0.75,uap:1.00},'R3A':{aor:0.75,uap:1.00},'R3X':{aor:0.75,uap:1.00},
  'R4':{aor:1.00,uap:1.50},'R4-1':{aor:1.00,uap:1.50},'R4A':{aor:1.00,uap:1.50},'R4B':{aor:1.00,uap:1.50},
  'R5':{aor:1.50,uap:2.00},'R5A':{aor:1.50,uap:2.00},'R5B':{aor:1.50,uap:2.00},'R5D':{aor:2.00,uap:2.00},
  'R6':{narrow:{aor:2.20,uap:3.90},wide:{aor:3.00,uap:3.90}},
  'R6-1':{aor:3.00,uap:3.90},'R6-2':{aor:2.50,uap:3.00},
  'R6A':{aor:3.00,uap:3.90},'R6B':{aor:2.00,uap:2.40},'R6D':{aor:2.50,uap:3.00},
  'R7-1':{narrow:{aor:3.44,uap:5.01},wide:{aor:4.00,uap:5.01}},
  'R7-2':{narrow:{aor:3.44,uap:5.01},wide:{aor:4.00,uap:5.01}},
  'R7-3':{aor:5.00,uap:6.00},'R7A':{aor:4.00,uap:5.01},'R7B':{aor:3.00,uap:3.90},
  'R7D':{aor:4.66,uap:5.60},'R7X':{aor:5.00,uap:6.00},
  'R8':{narrow:{aor:6.02,uap:7.20},wide:{aor:7.20,uap:8.64}},
  'R8A':{aor:6.02,uap:7.20},'R8B':{aor:4.00,uap:4.80},'R8X':{aor:6.02,uap:7.20},
  'R9':{aor:7.52,uap:9.02},'R9-1':{aor:9.00,uap:10.80},'R9A':{aor:7.52,uap:9.02},
  'R9D':{aor:9.00,uap:10.80},'R9X':{aor:9.00,uap:10.80},
  'R10':{aor:10.00,uap:12.00},'R10A':{aor:10.00,uap:12.00},'R10X':{aor:10.00,uap:12.00},
  'R11':{aor:12.50,uap:15.00},'R12':{aor:15.00,uap:18.00},
};
const streetSensitive = ['R6','R7-1','R7-2','R8'];

/* Deal Desk district picker — includes commercial/MX equivalents mapped to a residential district */
const DEAL_ZONES = {
  'R5':'R5','R5B':'R5B','R5D':'R5D','R6':'R6','R6A':'R6A','R6B':'R6B',
  'R7-1':'R7-1','R7-2':'R7-2','R7A':'R7A','R7B':'R7B','R7D':'R7D','R7X':'R7X',
  'R8':'R8','R8A':'R8A','R8B':'R8B','R8X':'R8X','R9':'R9','R9A':'R9A','R9X':'R9X',
  'R10':'R10','R10A':'R10A','R10X':'R10X',
  'C4-4 (R7 equiv)':'R7-1','C4-4A (R7A equiv)':'R7A','C4-5X (R7X equiv)':'R7X',
  'C6-2 (R8 equiv)':'R8','C6-3 (R9 equiv)':'R9','C6-4 (R10 equiv)':'R10',
  'M1-2/R6 (MX)':'R6A','M1-4/R7A (MX)':'R7A',
  'Custom':null,
};
/* Commercial districts -> residential equivalent (ZR 34-112 / 35-23), used when an
   address lookup brings back a district that isn't in the picker above. */
const COMM_EQUIV = {
  'C1-6':'R7-2','C2-6':'R7-2','C1-6A':'R7A','C2-6A':'R7A','C1-7':'R8','C2-7':'R8','C1-7A':'R8A','C2-7A':'R8A',
  'C1-8':'R9','C2-8':'R9','C1-8A':'R9A','C2-8A':'R9A','C1-8X':'R9X','C2-8X':'R9X','C1-9':'R10','C2-9':'R10','C1-9A':'R10A','C2-9A':'R10A',
  'C4-1':'R5','C4-2':'R6','C4-2A':'R6A','C4-3':'R6','C4-3A':'R6A','C4-4':'R7-2','C4-4A':'R7A','C4-4D':'R8A','C4-4L':'R7A',
  'C4-5':'R7-2','C4-5A':'R7A','C4-5D':'R7D','C4-5X':'R7X','C4-6':'R10','C4-6A':'R10A','C4-7':'R10','C4-7A':'R10A',
  'C5-1':'R10','C5-1A':'R10A','C5-2':'R10','C5-2A':'R10A','C5-3':'R10','C5-5':'R10',
  'C6-1':'R7-2','C6-1A':'R6','C6-2':'R8','C6-2A':'R8A','C6-3':'R9','C6-3A':'R9A','C6-3D':'R9D','C6-3X':'R9X',
  'C6-4':'R10','C6-4A':'R10A','C6-4X':'R10X','C6-5':'R10','C6-6':'R10','C6-7':'R10','C6-9':'R10',
};
// any district label -> the residential district we have FARs for (null = use the typed / looked-up FAR)
function resolveDistrict(label) {
  if (!label) return null;
  if (label in DEAL_ZONES) return DEAL_ZONES[label];
  const z = String(label).toUpperCase().trim();
  if (farDB[z]) return z;
  if (COMM_EQUIV[z]) return COMM_EQUIV[z];
  if (z.includes('/')) { const r = z.split('/').map((s) => s.trim()).find((s) => farDB[s]); if (r) return r; }   // MX: M1-4/R7A
  return null;
}
const isStreetSensitive = (label) => streetSensitive.includes(resolveDistrict(label));
function farFor(district, street) {
  const e = farDB[district];
  if (!e) return null;
  return streetSensitive.includes(district) ? e[street === 'wide' ? 'wide' : 'narrow'] : e;
}
function computeZoning(zoneLabel, street, lotArea, customFar) {
  const district = resolveDistrict(zoneLabel);
  const area = parseFloat(lotArea) || 0;
  if (!district) {
    const base = parseFloat(customFar) || 0;
    const uap = zoneLabel === 'Custom' && base ? base * 1.2 : 0;   // looked-up districts we can't map get no UAP guess
    return { district: null, baseFar: base, uapFar: uap,
             baseZfa: base * area, uapZfa: uap ? uap * area : null };
  }
  const v = farFor(district, street);
  if (!v) return null;
  return { district, baseFar: v.aor, uapFar: v.uap,
           baseZfa: v.aor * area, uapZfa: v.uap ? v.uap * area : null };
}

// buildable SF shown on cards: the typed override, else lot x FAR on the chosen path
function dealBuildable(d) {
  const o = parseFloat(d.buildableSf);
  if (o > 0) return o;
  const z = computeZoning(d.zone, d.streetWidth, d.lotArea, d.customFar);
  if (!z) return null;
  const v = d.devPath === 'uap' && z.uapZfa ? z.uapZfa : z.baseZfa;
  return v > 0 ? v : null;
}

const BOROUGHS = ['Bronx','Brooklyn','Queens','Manhattan','Staten Island'];
const ASSET_TYPES = ['Development / Land','Value-add','Existing / Stabilized','Office','Retail','Industrial','Conversion','Other'];
// Tags saved before the new list. Read as the new names; the next save writes the new name.
const ASSET_ALIAS = { 'Development site': 'Development / Land', 'Multifamily': 'Existing / Stabilized', 'Mixed-use': 'Existing / Stabilized' };
const normTypes = (arr) => [...new Set((arr || []).map((t) => ASSET_ALIAS[t] || t))];
const VACANCY = ['Delivered vacant','Partially occupied','Fully occupied','TBD'];
// Deal pipeline. Saved in deals.data.stage; deals without one are "New".
const DEAL_STAGES = ['New','Underwriting','Sent to buyers','Offer','Contract','Closed'];
const stageOf = (d) => (DEAL_STAGES.includes(d?.stage) ? d.stage : 'New');

const fmt = (n, d = 0) =>
  n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
const money = (n) =>
  n == null || n === '' || isNaN(n) ? '—' : '$' + Math.round(Number(n)).toLocaleString('en-US');
const pct = (n) => (isNaN(n) ? '—' : Number(n).toFixed(1) + '%');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const N = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };

// one clause for the save toast about the auto-contact
function contactNote(c, who) {
  if (!c) return "";
  if (c.status === "created") return ` ${who} added to Contacts.`;
  if (c.status === "updated") return ` ${who}'s contact updated.`;
  if (c.status === "error") return ` (Couldn't add to Contacts: ${c.error})`;
  return "";
}

/* ---------- follow-up date status (today, relative to the device clock) ---------- */
function followUpStatus(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + 'T00:00:00');
  if (isNaN(due.getTime())) return null;
  const days = Math.round((due - today) / 86400000);
  if (days < 0) return { cls: 'overdue', label: `Overdue ${Math.abs(days)}d`, days };
  if (days === 0) return { cls: 'due', label: 'Follow up today', days };
  if (days === 1) return { cls: 'soon', label: 'Follow up tomorrow', days };
  if (days <= 7) return { cls: 'soon', label: `Follow up in ${days}d`, days };
  return { cls: 'upcoming', label: `Follow up ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, days };
}

// Auto-match: a buyer fits when nothing in their buy box rules the deal out
// (borough, what they buy, budget with 10% stretch, min size). Each criterion the
// buyer actually has filled in and that fits counts as a "hit"; best fits first.
function matchBuyers(deal, buyers) {
  const z = computeZoning(deal.zone, deal.streetWidth, deal.lotArea, deal.customFar);
  const bsf = dealBuildable(deal) || (z ? Math.max(z.baseZfa, z.uapZfa || 0) : 0);
  const price = parseFloat(deal.askingPrice) || null;
  const type = deal.assetType || '';
  const out = [];
  for (const b of buyers) {
    const hits = [];
    if (b.boroughs?.length) { if (!b.boroughs.includes(deal.borough)) continue; hits.push(deal.borough); }
    const bt = normTypes(b.assetTypes);
    if (type && bt.length) { if (!bt.includes(type)) continue; hits.push(type); }
    if (b.maxBudget && price) { if (price > Number(b.maxBudget) * 1.1) continue; hits.push('Budget ' + money(b.maxBudget)); }
    if (b.minSize && bsf) { if (bsf < Number(b.minSize)) continue; hits.push(fmt(b.minSize) + '+ SF'); }
    out.push({ ...b, _hits: hits });
  }
  return out.sort((a, b) => b._hits.length - a._hits.length);
}

/* ---------- client-facing share text (no seller number / contact / notes) ---------- */
function buildShareText(deal) {
  const z = computeZoning(deal.zone, deal.streetWidth, deal.lotArea, deal.customFar);
  const ask = parseFloat(deal.askingPrice);
  const uapPath = deal.devPath === 'uap';
  const L = [];
  L.push(`🏢 ${deal.address}${deal.neighborhood ? ' · ' + deal.neighborhood : ''} — ${deal.borough}`);
  const bits = [`Zoning ${deal.zone}`];
  if (deal.lotArea) bits.push(`${fmt(deal.lotArea)} SF lot`);
  L.push(bits.join(' · '));
  if (ask > 0) L.push(`Asking: ${money(ask)}`);
  if (z && z.baseZfa > 0) {
    const aorPer = ask > 0 ? ` — $${fmt(ask / z.baseZfa)}/BSF` : '';
    L.push(`As-of-right: ~${fmt(z.baseZfa)} BSF${aorPer}${!uapPath ? '  ←' : ''}`);
    if (z.uapZfa) {
      const uapPer = ask > 0 ? ` — $${fmt(ask / z.uapZfa)}/BSF` : '';
      L.push(`With UAP: ~${fmt(z.uapZfa)} BSF${uapPer}${uapPath ? '  ←' : ''}`);
    }
  }
  if (parseFloat(deal.buildableSf) > 0) L.push(`Buildable (provided): ~${fmt(deal.buildableSf)} SF`);
  if (deal.existingSf) L.push(`Existing building: ${fmt(deal.existingSf)} SF`);
  if (deal.vacancy && deal.vacancy !== 'TBD') L.push(deal.vacancy);
  L.push('');
  L.push('JStone Realty');
  return L.join('\n');
}

/* ---------- image resize before storing ---------- */
function resizeImage(file, maxDim = 1600) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => { URL.revokeObjectURL(url); resolve(b || file); }, 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

/* ---------- brand marks ----------
   LOGO      : building glyph, recoloured for the dark sidebar
   LOGO_FULL : full lockup in brand colours, for the client sheet */
const LOGO = 'data:image/png;base64,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';
const LOGO_FULL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPUAAADICAYAAAAwVacWAABm8ElEQVR42t29f3BU150n+j1X3UJqGZDBoMz4TbGQFLJBsG5oYCzZL5uJ82Ps99j1GyshtowfLUut2FM1VW9TW5WJ6zmu8mbf25fdquyLPbRAzVrGthKSdcr1MjuesZPM2MgjEIiAQiwqxuPkkZlGgCWIJFBLfd4f957b5577Pb/uvcJ+c1MOUqv79r3nnu+vz/f7/XwBAIBSSoA7KABhr4f+JvwuHpRSwj6Pnlvyef51/vOh9yCfF7+T+4PyWqMedAnOSw3uy38uqvVBnhv7XfYfAEBrW9caAIB8vpBu2Xz/QfZ76HoU9656hqHfNeeSntdyP0rPKVlD3TWY7FPxe4z2PHJe2fO0vkmZgIibwGaDqh6KqcAEblCxYdgiSs8D8QRSt05JCLdUaBUbRH69eoHO5tpbAAA2dvY0r2r93JkNmzt+vbGzp5kJeXDt9QImnt90P1CARNeUQvB6k1bKuusNrQOi2GR7OIriYYfDTkwAKP+z+EZCCGX/6U6qeg//N3+T0NrFyz7LXieEUP5axeslAIHrNNKmphYDgLDvYteRlGXw115xXgJAgRAzxeA/S27d2NoS9/fu7r7Uxs6e5rHR4fK67O49vz3xq8vzlYVNF+fqb1c9A3Z+/lLc3wmlAITfKxSAiNcs3R+Ugs2aavchEMruP7BfvOuyMTay5yHuRfFZ+t+HnJ9fh8B9U+quZ8S1SJkKY6zF1Qiqp00JAUKBUgK84HuCxCkcAOR8vMCFBEF40Ow7+Q1v+hBl3xm4TkLEh0REZab6XfYafw3ixhHXVdzE4nta27rWlErFSQCYWpfdvefy9LWX1jbOX2ACfc9yZ+Yc5uVQJhSUUKhpKv87XLH21yO0Zkz4Jfene55J78Ek9j5vQJhRwYyRyb1Rf4vjysjIUisX1tbV02g+qetLasIGxBNsTmvxloZiFh+AAKXWWjyuOy56CP51CtdCBUstehGiBTTdhKLwYhuA3R9/7jvaHr1tYvzwZLH4Qn3L5vsPXp6+9hL73NrG+QtrG+cvvH2t2gQAMDCwf0FcM/9nil+X6nmoFI5ouegSYSIybzRWyGRxraJiFr1O8dnrPGTxux2lprTUXrIH5GtokFhs8XXhPAHX1bMCITdIFHJDt1d2TTHNQvihKLwIDKgUYzE+zgq8n4Stdu1z7prziuuOLa5Ab+zsaf76fz58YmZubt/axvkLAAAX5+pvF13v7u6+VEApk+ANSN1S4XmElJpBGGGz/5JUALbn8sMNT5GZAmhsDUzDVdP3OLKbSVKTmQBW/EbEYi0xjlHFq6JLbAsqLTWaKqL4Ic2suGYsnOCtH4WwW8vewwS6ta1rzaXT//DWfGVhE/YdF+fqbye/nEsDABw9NtNcc615DweISiEGhBizTF7cmJSAiuGM4YdQZBsTpFBGAQFngWEK3DOSgWTYPuaBUuMsA/I+RxfXJanNeKEVN4QfewAeI0ZxpUwEOqjIiGCKortzKm/Bs1RU8rq/4WprAlQUAlH58evnA1nez8XiC/XZXHvLxPjhyXXZ3XsuzF74J16gReu8tnH+QsfOpikAgInxFy9hrrNqbV0PAQJhVEDRCqCriJSbWmjZHhT3mulndRYz4ImKhoZ/VhIQ0NjqIy64qUccAMpkgEsirhFQkrSbmxSQEroPYqAIDL4bi7fFDStqdN5Nl2Ug/M1Ia6636tkx6wwAZS9+3scDYuLBXHHuTNRWiQfwEfG+mS27CYduz/E4iKkSqWUQ1GAtqrATCAtMzuPINFgofxijaIRtT9ftkucPbc67VOGBn1sEeW5V992yPL+NK2j7UDGQrbWta83E+OFJVlAyMze3j1lmBojJBJoBZdh5tUUoQvFEQGlJUH4eERct91LUA9gKmYlSE9NSQClIsZ6YIYaVUPPBe82Nk7sDoYekSLC77qVai/ruuSyHJ1NCSCGArEpL6iZzG8zEsxA/y5SfKs8vtfwcyh/lQYsgGRPojZ09zT86ev4kE2iVy23ieurqFWSFQbK6AYKBonzowXkvmJKIA5DpjJW4d2UCqlK+VBGCLFVlohO6eN5tNCw2CTw8z8EKPEwSgv2oNDYE87g+GEuGgQddDlc8t3W4IcZJYipLVlHF1ocv/ME2HGfxgsUckuwCIbS/fzC9sbOnmcXPrKBEBogZYknsW4gJmChza0WFh8a1EgBJFkvGyi8jxspXzIhQBvY1p2hUsb2q1gD7jiQAQ0cELEzcKx3K6Vfa+AsgD+x1+WJsY8hLQOXlrRJFAFhxRJT4BnuAgYoiYZ1UCojlefmHzwNUfJWUf3+EQG+mt25kZJieO3IgUFCissLi35mgM/QbeAXsXbXMymD56QCIJFmfpDILUWrJQ/uNCtWLPC4gUziGFXOy++CBPbTWgNqVujqYFbOx0DJgB4ur4oAaovAYn1d1L8h5jO5btSmEmNBXWFgKR/pdLBZTP2AxROmf7V/ctaud8AUlLPcsE2wsN80f+Xwhze1dqortUcsnE36LeNwUP0mkIpLgtQOi4PKeqPH1GbxPV1mIhadS9BvbPHFdG3ExtKWBFt+pcmtigQ9CmapMGRD24MWSUPScZusadPu8jU8oqd0dlVrJjZ09zeSXc+n//b987z+I8XMCgRqhJFhHHhBaYQ38DS8CRQLCHxWRDqDMEfap7FnIzsWXAGtTVxFi4JpyEEOBYBjgv4cCoYQGw1ju2hzVl0QCHsSkPP8aUg2WhKblEdLY4AMiNMqYSYgRA11MQEPxmcqlYjXVLF3lvpd4D49KMYLu7r7UuSMHpgAAmmD685hVVlljlXteKhUr7EqlzRmIy+2lrmjc56vq9jI5p7HrjgB4bO/KikSSQM+DzUfB/SMNWwkorbkTNigJWGchdvS1nBcnmqDU9loOYgEnodJMg0J6NN1ChZCCEDnSi1UGUd4uh6uT/AdIgoIXV3jFz9E7Gyvh8Iiae01IJ1Q0HUuorCnC5tlqgTcudODBMB/4RTAUGwXiKT/levBdZXHCVSeu+ypubqIo/4OEXRd7waVSII1v2QwgzYoUiN8Gyr9OSHA9uMYEVfxOgIQ3caCABQEYCb6RZDG0TOCx99eAMkpqigbxTPiNKuSWTVtFTWLwUNODpMgjdA4vX6wMLWRlxjw4SRBw0iD8CyhuMS7XcQuAOW4kFep4+IK/yLVCCq4JQed2Wlturn83NhhnuPFk+Xp/83qxZSgnS/CabO5miBSgEWrig2is6/ryYJaJxTYSLt9SI91gPEgkQf1VlXGaHYog0lTevot0c8myEhj5AFVYWcwzkAGvupJV1f5R7Ve/yw7MGV8SEWpZQ4J0wRUFIKYuNOV7dmP2worXyReRmFL4hEo+eW0v5uZD51O4dVycjRc0EDh6bKZZd58q11ulBHjmExGkknli/DUGmFY0BRvYOnpxvNTVNQkZRZwn0J/Paq0lrZ7+Z0XcIAG8QNeEIvYlmH5fJKGmmpSO1i0R0z6Uxo6v47gvyA0C1lghsywYe4wMyXX/TpQAI2qPXFNOQikNxaXxOWgTy82/p+Z+c5cA5nl937p76ydWhondS7KecplLq/MEguwvYN0kJBZTqZh0olB8SdcrlCnQ194b91PbWGblxctcW0LCrBlgx0KyVMwYvPU2adxQFaHgGp2GNp0uzcNyxMDRjbgCLl8vXQ5aZ70ZCCemW4L97erSUF3JLNrUInH3TS2cTBmLRVE6Vzkuom6lRDRAnI0nYCTUVh06hr3BXhxKxdhR6z4FQZDYBAhxU2xSFlAZKR/T+kRvrcU0nbtmXL7Y+5e1SdoeKoEX0W8RVPSxAAHx1wqEoiRShq0oFZ6q6krS/mprDEIceArFkFQIG8eNd0wWP2p/q40yoKaLGsjXRUtxYEBLVLcfqx3G0HPf+lC/ZU0kEaFYSlBsWGE90qI1tb1uZqV11pqBcH6OmvCdbMTg6Zlt3hCHl4QdRfqcxfd6qLcsNIq6b8Ta77gCaaLsbGSJEEIdmxsxdbWtrRePZMcQzqiLZ9WBo6VHksecfJEBIYRSSekhj+jzrCPMbRevgNH5RgHGdLF2qeRylLGCkoD3Q2mgWi4pj89fQ5EYglOK2ueg6iTj9x2XGlN2bGFMJ4b3FZWmOFDBRsz72h1bjWpkwbG0BLbIAkdTIP8ooYFJ0s2Rfocirymz7LKeb455U9mCyH+vlJESKSNEQS2FsJrE0cFz1tIq3d19qQCIReTddmL4EIUMX/R4An3XiFdjgpVggsKFg6jAhdJSBt2AtmGgzOOL4qY7RtrC0NUQEUldtwpWLyxufhvBjkqxJMa1pkyeJpuK1loEgOfiFjeHtO7Y78KiNddecME9ZpPYBy7wteKTUqlY6e7uS/nlrIInEUK0kX1AiGDpTbANgzJN4ypFRU2Cat9igmw64CKg8Gi4Ok0nc8oBDyqOMiPLxpVS2kD7WEWQ6iZkKLdpb3Uc1z0uoh4uHmFIv8DJxaWn/E2iUl406I76wg1AsBE5NuAYS33xf2NAWT7vCnFrW9eabK69pVQqVrK59hYllxxzkflaeKJGrW3AJxZv+/uR/xyrZlMUq0SJp1VFU7aWOg5Lr94wKYAyqYB5Cyo+BFWMYUpcbop0xrHOqlh5KTjPCGFoabi8VLnhuLLT2jlJyAIQAIoh1ZjQqgRdFHbmfu/a1U4AADIN5x1C6YHczo69Y6PDZZ2bG8IQIFibgKWu7Ikia7G3TDGrcBwdGaBJqGnL1UcN3h63A9GJA2SI7W+qyQtGzCERBHappookoTSCFEfepg66YnJ00ytqqbWwegoi4L66/9yz3JnRWWcb+qKLc/W3M0UxMjIcWN/qYvWh3M6Ovez3JzOZlBgquP8BF2qECysCtfIWFlP0BjwFCVhGBFeyyBiim7S3+AEI8We6SYY4gAL9jgr/25TsmS7qUk5qkGl3XQuqDiEP9BkTv1Ak+HmBi0v0GgIgEVIHzD6DlYmaWGcToGzs9JlV4t+YYOfzhfRzs7MLYimpG7dSwOiYWFpMRUNlKtxcSy9dCnLCpTAGOnAxCe/QUfrnhm60bsNHGYnLvyeOxjQZqWrq5ovdV7owpebRuNbKdcX1mxkblsYLthijJQWU8QpB59JXF6sPnR4f/wqLs/v7B9O1tfMrrEPKOUDHxGEttvlYDAsxGrNsORTPqtZC467LeqVx4E/O8S7uAVHZO0qNYdq9RPSTGni3Ca0eQkbQJuH+iC16IlCiHd7H9TDr6n+NkFDPBTedBhIqO+XcePbcTLq0TFNZNkd1sfqQA/TPs7n2lkLhsfltOzrWBtB9ydysmmtOw56KyVRPgzJPo7WMOcFV6T1oADNxDJVowcWhDErgTagwdGQgAsbqYbLQoRSYYReVOII2UVdIMxFTV80jTjU03TSot+Oh1jwabh1ikFp8JttEIprN/2wi4FjuG18jWM8Ee2x0uOwqGG6sEFJgQ2od2lQorDPj8cJSXB+R+23rzWLeJ5oxATs235D7LXJPRU16K2NQxOLdrAN1zah9AzrWGYTm1RUxOdvEoc1MiLKySZw5zSterExUFTOzv7G4Wxd/mwg2ofRALeXVsda7SyJtSeXaUhKSriUdYK+0zjF6I7Bz6Fx33TCMxEkSRKuNgUIfi8PADTOxpLbE/TUrReWTRzQVeWL4YpOnxlBxzIqzmDq7dcsV4yXlUl69mYLTmyk4MgWHcV8nQX0UOL8iuxL3u5IGb61z3WDBJqq7EdMWMr6e2yj/yHFGxxV+nzfbMn5S3Z/uXjCSdzndq8fNKRnIHqZbrsVVAYbJGnmCFVAm67HmrTUbOu8h68bn95Bx6D/WP2hrweIIylLOgtMqECSVG5eNV2apZTxm/B5xktQmMhdehTjyRAlJueZR2VBMpmvK3DpTAM5D0DmLrQcmxfGxIkkhBpSZWGgVjxlLk0Vp62Qpr207OtZ2d/el+BnXpgr1ZrjOSVpbVf9zEt+DCbOMGcUx1xTmVKuhaRSa5m/VmJOP6oFKEVaL2dEhTYo0Ztj0+YouaxQlKGND0REqRBHsOod8ASDYGmo6iUVFLHizXF5VZ1bSxjByPI+sZ8pcUwgMiwa1tTq3WDfiVuSSihMWWFkJr3BEGSYYNAaIYQU2A4sniceslZTOJ8hdZtVPzaw0b61lAu0Vn5QjrWu1ur1x6MWXQ4qUmD/DkAck2RNxynxNvpt4VJeyPWH73QFDJo7A5YY2yEAzMY1lDZRhaZmo5PmBXC8lchRYkh/WsT4m5TrJXG3R8zDpr9aypQotqIHHp5gF5uW2rIEyniCBR8ID3ywUn8xe31CNsrbDm+5arQIQbQAy3lPB5pPF2ACxwz2RJtka1DPYl3z2Q3XulInmwrSGOIbE5qH4MbS7KTnCRqqkYQUFVaxK62Kk+CZaXtc5FElDI/E2Bq4FupuAbeAaSUHtvQRg3BzIEpFumaUW89SZhvNOFLHJbt1yZWx02Lt0OQGgVLApJZQb68OveVIcddjgBMy71NUoJAGOseyHzotVHY6xK4I1lseYhuFNmQjlZnXMnZFQUE1TOy+8mGUOjJVFimxkXFh8lZlyBhM/NshryfQLVLiyUgjbcf/8+17+XqpjZ9PU6pXLH+EF1qQ7SzaEPonDrx2vdZUTG/Tb60NT8pUlEXfLykxtQNe4vQoi8BVpeCMgFWWxxtYY8DqjQqYjVQjOcY40G8n0ocroiELWQaAGRuOwwChbSUGJx2sdGPkKRAm41UKEmkdT+sqXFnftaicfjL02dHvm9k9MLWSmRXc7ijW3yVNjR/vZU5dr96rBUAwnaSbxvDHFa7KfZQpc5olF6kATFJ1tjbpjggabENpraW41N2rCrW1C2WsbY2m7xpCplrYaHGToEKKoMKVSYz9xL1hUEOw6env3VtjA+du2/ot7Z2DlX8uQb51bnjxUC2DCYa1zbzGSDptOL1V/QXgOOFI5KABaIjouq6AzkSWsaCtEG4UoITF7lDI17bLOJR60MC4yiRhnaF16kE8DFBFG3VxtDDOw8WTE6SGyyjMVFxvao85NZgKorfsdWx69jd7ZWDl35MBUNtfeMnbkQBkAHmfD5zGgTIyjk0xphZ9h9LBNFKCk6HRVgh0eIYt4l4RIlbNJs5BsL9ryEggMuzj6rfPlZblkWxRThqD7I3AjtuFhKL2NhZeFA6ounLD1oH58rOvICsykIppN4J+npiyyufaWifHDk0ygd5xtu5TNtbeorLHuiMolLkO/VzyxIhXVExSHF/LrbWIkbFzY0DQOWWoTOx83Q07WDBXK7lgi3yo5Y687ptpMdoG8ljHtxuLRbAwk8UfgRtDoonuicqEieRRUPs41QDcrfpxoFCa14Hzj7o91R23s7Glel929J7t1y5XibH/VJF5WueRvX6s2JSHUJjG5zMXUWlyBxsj0/CqXF/PmsDgapbTm2GCtrGsEIE0lX5HH7sRBHCnSliej7jW11ry7K3uIQaEz4+/WDe+TUgP7/3kINiWChyPERe7//EF4GIeX+P35fCE9Njpcbm3rWnPp9D+8dXn62ku7drVrwyCsTHSp0G92XH3+6oKJlQELYgwl3bJKgIV4XKTj4igeQliRlJqYKyAK7WNKI/V/yxSTrASVve7otAG2qXWLqJ3gp5lTHaC6MUQ+ZbGxSuis3XpJysOEvpXVegcePObakfDnMcHu7u5LlUrFyrrs7j0V+v6J+crCpvp06iwAwNNPB5V1FIE17ae2VeTaONNisIIpKKrreQ6525SaWUn+fYqUr87zxZhN4mR4HNmiKycGKkZ/ylwT2QQOqUAoXg/Q4MgAOokrFGdTUkKMNhU2yTEAgLBPiONRhaJ9bDOw6rFSqVhp2Xz/wcvT115iVrc5NbsSAOCb3wRqm4paSpBMu7ENcRnTlGlIoRMSsMqy7xTbNXV890QyYtc2jWXTVinG45g354jFEaj20swWRjUywtctmxdlYnlV8TbGQy7zKKjFvWAxsy53qVUk3lTa8LQS8ZzhbrbWtq41E+OHJ1vbuta0bL7/4Mzc3D7ZtfIxcRSB1XGUJYuMKwpKuDE7pinTwHx0SVZEJFXA3Fxd+IfuOwueep1Ha+KKY7Lr6KYGsumU2Ia2jWlM3Qkb68qT/GHjc3A6oXgdQMZxPkKLG8zVkhqLBQ2zm/Dn6u7uSzGBnqyUf9IE05/HLO3JsUXSm+mta3r/F8vEv2NuuKz2O6mjxkZqXhMdHJVLYnlcMpYa2QA+bG/JQiGT0lEVCh8qCQY9+afJHkzJOJNkuTlM80VxU3TglMlIGtTlFsA3DLiIFacj9edY+gIjuQvyXQPwA+dkcdQdWx69DcBlDF2X3b3nwvQFN+ecgtBUDVZFdnzT+G1uA8Ywem9inpoHzdi/ScfU/kwuata3rrTikvoD8dlhCLaMfSXwXuH8pgpc1nMg2ze8u412ChpgENjfHRlSbEPfE99ChyuEVNpbjKlVZG7KgfCa3mhVLhK7Fsw1CjzgADJPlOWjAG66amL88OS7Z168xOJnnYWtzI9UsQkamBu+lGg3O/jYXhsrmpYZa56hrORXZjF1GY5AEZE4hkpIcclA1CjFXVGLbBwZQpn0eFK1Zha8AszVkQwoQ1sbFUUDJg9Z6Y4Jws6T7ssAH58LGwkx+MJ93iVk6aqNnT3Nn2h74AAWP2OCzcbkmABivEu+1ECZTClK0WRBcJTDAzVCohrYF4qDLfARmSerw5HiAIsmcb5jIqSmfr1R1YuJOxOaxYQvtIqowSoul+W1JfGUtPHAACARlYLYM85KPkulYmVjZ0/zpdP/8NbM3Nw+WVoqrjCa9lMngZdQoEZgl64+2jaMwmJrHcmH6Yxym+akJGo7dGnewNB5UxcWSxUYpS3Eip2IJaA3YwSPzN3D0gdKS+GXDaq7k9g58vlCmrnc67K79/z2xK8uz1cWNulcZoxvLNNw3tEJ81IXnASfIUXdbxkJhGwsj4oeS8odJwCmcUPIJEC7KJ6v6d5PKbm4iaazSBX8i4st1MXKmTbVQIQMIElqamXceEbsnValC/nf8/lCulTavwBAylgThghm2Vpo/jM8ndHNirExBiiV0UjiWQZmkkUZn2PJiOLPT3NvNjK9UZT9yBuOlKrDShtPEIIjkhhLCt/9JOmYCgyV09yUSb5bdtM8x5cNuwTKWqJhkZT9zispjwS/nM9D+scj9//F5elr+6K40fVpmD45tkgAGP3QsNZSS59vwug3Krh8RoB77sH9QgFA3WlnvAcMsyhR+PACnmgUZQBBckobkBkFyphFiTMwTGz/8l0rr3jFZxBBxvLwLpcpYhkFjBMXwZYuxnPlpKipOPAt0APMASj8ffDjan509PxJWUGJjiBQPET3G/vcTQPHdK4ooshrvweH68liXx1tcxTmVTU/nB6XMY2ha3tfMZhRmo0KMuT4Qm0zDkeKQiLggS+kfK03IdFiY0IS2kwxucVVn8Vy2JI6dgLEF+jWtq41Pzp6/qQYP5sg2OKxLVtndW+ycy1VRRlWPixjm2HEizpQVGWlZVWFpl6Zdq8ghAXRmHqoNHNiq5CcgEUR4HJqwYyosrCh4CoC6GUTY8kKOeSIqp2CkdXFq/jbAtVMHuHi2OhweV12954Lsxf+yVSgb5ol9dzvpFowZXuArb+st96kZFNFMWQSysXab3x3l2K8UBRPMuo+dUxdahv3V0URFIeI3rwyjVCbz1u74WKlGk9MaIKOE6Cs/1kExKJYZyw2NqH0NQHG7lnuzCyZ2x1Yf6p8LrJUTogVxSKUtAkztXReESyqrSdpuk+dUPrAImYwfXCR2RXBviB+ydBbRcOIji2FcJuNH5FzfX7hvqbGxkP8fyaCLaaiosbGMhR8yb0AYRZzgJwepYYGLStKYC8ohjGadgXqSDBRbyKB/WjrNWJHCj7GR2h2kIhWE3xRovIl21sY05DAbdwAQqAEUKFACTlCpgDgcf5d5fFy/Sd379nHW1ITgAt7ny5PLQq27Pe4h+O8oi6PpDWcQobtUO5R81M6MHAWxPeFKvjk3X+a4iI7ZWWYohX3rEnbZXh9gnvesanOiaKNKMIIkZSQ85qef8/NtOAmSCf1/y/4ALK59pbWtq41rOjk3meeyoiusUrAVIj4zPrNN+KAZQwoq3VZRTuq1a8QgFofuFjnD0gaNNQLQEA6AhdTsHxftGl1oZ9Wk6WrDAgPbEJFm34L1eeMZmnpGDSxxn+b+NNUCZhoOz/pIe0F11tt09yl6n2yWVjBv7EZXIF5XBcJDNOJcddQ57duSX/fwiJjwsjy1GLrpUohYMqBjbKNe/yg4RUacKOF9BUOLrk1BPxIpsC+Q1JgYt46abxG1RasGxiv20/+HiXm3iY/2haNqWXxQUh7YjO1DNFyU3ZEVIEIcD9PaC/TWuxnXYxiUtqqGocXeDissQO9H8LvDqrrxbUFy2yBMn7KJTbxko2yjUvm/9D1r5BCX2nZxPjhSSBAVz6xoi6fL6RxAn3+mRGoVSOTUE5bxTCiYhqNQkzAnhXWm83jTdh+tdl3wWmo4b0cAtQkgu8ob0TQngELaEmapnyNmLvdLoukwfuQpHxUQIfPtQcQb6Hv1i0OxFUAITW4RyxI2djZ0xxHgDEX/WYylyhBmyFa3b9/3zxQd72uPn91oVQqVvr7B9PYHgsCYOE+Ab8ASGASFYtZZEyjur2Iod66wpaQkgeMRJMaDZTkRy5phV2iFLVgihizokIW0eUxneIHKtSCfES7VSw0YZtIYoExl4p4cd+57x+YjnMpvAKwLT65WYBnsf+FNCGEtrZ1rcnm2lsKhcfmGTd5mBeP6zMnCG6hy8RoBimqrDw6dRWbsqHJq4f2OZV7nzpwWFYFGQqTQcImagJOJQWooe61pnAkIBwUCLYIUpcsQQBNVwMeLoLw2TL5UazsmpMXpJi120lZ+oU9bnvvyMgwBQBYnnn/jwmlB1g1nTh0QBRsAm63m2qSiREIxQsypVL+dlkRCeaOa8M35tGic8nNay5M3suf3zE9cdxNH4qjEe3D6G6MY18C1PRa4xQGSCeSgDp/im8WGsIkurv7tKnFm9UiuRTuN4WnA/ts6rpzF6H0QG5nx15W945PnPSVtx9LJ9H2iA0P8LETxQxtY9JKCgEPdClSrCpF4qiQNZtNbwvH21R9qZowlGV1FgSBMuBOpE0KkRxI2EX5c3KILQQJBs2xCdv8sWmeWqY4kurSWthDnELmHwmWGqsuVh/K7ezYWyoVKwAuuSJKlED0qLPqeaNECRoeeowGyye41HkNBG6qEIsy4CRxYuVYE6v6btwdV44/VeSuTXOBGElg6IFylUs+6q8Y+yJOVCDg9aoFN5uVAv0ouqri5qkd5xXaP9u/yL/W3FA9JQo2G04gxtlM2NDab0KMR9FgyKVeYMymuCwtdKObM1Zzz5msODL0DpsaEBoVQ6NB96KVRQtIQD/PWGatxThElgbTDa6TWV4tKMjHa7y1FgAcdxxP9Ace1SW3+VzclNaJU22rdeepLlYf+vnp098W4+wQEInxjvmzyCx7kan+rSbD61QpMhVSbWswTSjFpECZbPC5nyJyU0pWVWgqLYNB+DYAgfHCAJ4X1I5EUbBgiKNoUUoobofweVfeiruMJ/FQb/FQ5alFXjIVrVFcSy1ex2KVvi6RsfUqAC28gQVOOIMiJ5H9M471VCl3TIbiVmyaMAzFc78TjBmSKOuUue1xNGTI9TaY66V7wK63qEf6Ta0pE0bT9yatHEyOT5/PXOGVQ51DvqBcQ06w+eaXoNeFN18sJQNuUpkT1dA8FSGiMqamipg6Sl13lMAe03bYoDDbeEeMLfxzQzIPURaPU47ZRXZ97P7Ee3U7t8Lot2mrpfg+ViaqUwLixMvQvXoprbhzqof+1yEiut9T1527dILNADQm2IGqLaEnXxT0QCss969JGkqpsIX51aaxt7ECisA1gHmbjm3dqu79xoJOzFxkJVCAaD20yCNKXI70TGunJUgqnGroKw+che83Xb/LynOK01HFu+BLCcA9dP0roWfHA2WqOJtHxqVIN2vCEHqqeS48FeWRpWRTNBanFJI4f5RCLkw2UiJwJAJM/OaWTvPgisvlfaxe7OyV9Ron3yWFBDw1kqyIJTC3iqgFPJwqA2LDYKEjpPNajQJgGfeZCoA7XcMG7OJrt9nrunNgDSEqxeC5zeWEUHSr83iC7cbhBC76e4jfkxLGVv6ZWT87WkMwtUVGYhcie84x0XGbhinxcw7qvgonVAmqLKaVCo0iHjfmjkLYLcRrkQFj5nE6RO7y4YsVglacog31WOyocruxKRvsdzahQ5anxlo6l9JSs37qqCh6dbH60Oz1DVUChP5ppqlOXG8ZA40U+MTCNg78ZXsUG58k/SyEU3D8HsUmt8g8UCuGIUk46JgE8FIQCGmgkF6sTOBdrUiM+64pBcxrcJm/VGV9ySHpIURVYHwUH7SkGk6rhVUMJ7KWSVsrLxP6pIpP3vr73bfGRdGZgnpudnYBs5I+Cw1S/snXaIficQgKsmy/YuGV+NxDlMeAM+Tq6LwChS6W4TBqqU03mwlibGolqTe5QSUAoQcjQeStlEli6D2gDwGzJKISZPeFpbSY4KkENgpqrTsnOxhAFjdPncR5VAi8OI5GHFSnJIdU8tqrDYz43ENdYqKxNGgDNecAlIfDAUsdpSIsEZjf5AyUGoEH+N8/qjYuSRsf78kwgIXaCWzUI4qCiJunTuLgQwnMEspCJ7GmGxtiqKzfN+A5E3+WEYxEZTU1wn9kKS2/gosS5RBsLYhF1RSnoVY1gzx1LM/Bgg9aFcfr3h/aLLxrKPxOhOZ/k4aOpRRoLNfNSBJMrKUFUJZI+GNigELZCjYh1WCqh1bYEe6zQMrMMnUWdcyPTD6cEEgWM/RUjyTBu2Oi9mHHtqQGgm0y1yk0Okg4vyjcYqjA0jZJHCxPHaWhI3BPXp6auc1xz5eE+62tg5a41hjJBS9EJgMGdMYiKtK9FHx6jrg7Tcy77YXGLSe1tdw2s6ZNhVyq0b2abhToMB1wsARxf1zLKrPYUT+fBFBmAh6FuuMslXaSQmba+80XMIUMQwSE3DFBiXW8xtKpCgm61TaxvdV5VYUJ/EIjLrgMpZSBImLNdw30IB87thIsnv24HignO0KgGXLPeb72iNVmoWfNpzMtZ6TrfjaRsUA/dagrS0FaLt6MTbG5Cs3T3bTpJBGbWFjKcwX6J4KVgkrOI81Nmta+m1aOMTqjpISRuc1RLX/cMtM43hw2k0oUOFtGnJCrzltXRiWMUA0vFesOxqjiyBA1Xc7Ydni8ric0qmVXWWm+CEDpaUhcMOxc0s+gNcHhdIuYMqRgxnySBBouKgZZMQtALU+dlPudxPFkJpNCjUpEi2g8BE8Ttvnn1SDdWN9D7PFAslG2cdzjpMjNpUIL6kYPE4pf/z1cCV+UVIYMARUfpFjrLYKF4rlkeeqowqpTDDzarevyYpY2quVPKt8NAPDd2dlFnSDrOONtuM7iCh7mlWGWVhtDg56B1Eiol3LKhS0bStRqMGyKg0k9MPbg0Zha4q1gZayeWUcVVG+m4KgscxL8ZLZloR8XimEdWBlFMdtyrtvO5Ypj8CSzxEDZskslljopxDqRIWEJM3/Keldlm0V00agkx+nPJpYQKASrm9zJjnyowahjGeOmKITsP50Q8n9nKS0sBjY5p1gm+nEoPmFHoEZeMhNaZ93EwYa8wpZhJEth1Exbjd0ZbEH3nWcmctlWJUIdRYgD6QNGZp+Ay57ESFDd94kEgiHLzAkyT9gvnJiqtDYV9ABfG89fE+Z+8+WcNpY66aHzSbjNAAD3LrvX/1nXTy07Avl8hEcOc3VNLL7Me9Pu0zgcZYadioHSYq4wTEb2r42pTYSF44gycmk/bkeg7JAjuDMpP1SBJy6QFiSFw8EVvdBhrriO5MBUoMXPikBZUsc7L/yd7zmY9FPzB+912BFp2IR5ssqy+Aw6mBeM4S26WJwSaqQIEstBEo3Vupnuu+n3oB6BMDZH1W4Xum9xPIx0rcwsii4utu3SYgqCfRZTBuy1pGNqLMSwPXozvXVi+GKSVYlltHgGnYh9ENF6FsKKyZQe2zHy6y2nVqKbPEGUPHGXnKOaDbXKmY5BBXWHWfAhiC2q+hZMmTDLhBNDq204ze5Z7sx8XGJqdi/9s/2LpqyuesQYH5ujE05bYsC4e1OsYzAR8lBDh8nN6W5crM4JvB+JY1WQ/s2w3CakgnEUkT/niOr7aTFBFC1xlJy1DdjGHzZzrm+WMjbpN9ZaaQkfWByrqlMgUb1Wk+mu/D07GFNIiAhfQZouHScqqzhTDAvHiBJuhuWO6onYKgxsLLDX3E90wmbLBmpTAaYSeGaxPw6HbDyP7TMTxw+LPdiJCKphKLYUXitKZ6TTclhaIGyZzIvkVUPub7orfjO8AxoU+rxhRRnmbssEUnS/ZUpBpjTevlZtAki2IizuMVDavxA31ZrU/hIrFUNVi6rClxgpW55hKACiced2TDSS6J761DEiUihxF0w1YVStmbQgovOcLLSn+IDF/lxxQLkNmb8pc4loqW0phxn6nVTtdpzY/L2d45cxb9IqJFQx61g2X8gAV53C0IVeNh1mMkLEAPOJ7ERodZSktjWEBCs+I4udTfqXlyrWkZHER7kWPmevi/0w3u+bdSz1NE1GPBjn+OQxd3TPUriqSQx7SCpUlE3j1F1viPlEN49XlvrRsU/wBe42LndSPM2RB6dF/C4sdx38HSGg9z6zFC6uzv2+2cP2kipiMQHCbNzbpAud2L6NyxQa57ocrSXRCG9gGoIAdJlSAKG5YjAbXxo+p55NRZqWQKrMxHCAUnNaIx8Uc+uHQvTLbK2Woj0Rc79t6snZNcVNabEBeTcbI0mqbkIrvOikGHk2xYgx19IjCdEZxdZSCCWrimzNRBhUJAva66VRbkHFqxYMBwgBxcMS2zHx/mpTEok47rOsq4ofAGBireNa2KQtdBTX2YSOKorwi629mn1JdHE9Oi0TTBlGa9fuICtllKtGScxlY0lkLrqmyENXzBE1tsL4mWXIqIliqq1FsIw0UP0EeFqFEEIHBqJNvWTCaRsXq4pWZABXUvRISVtkpQuuaNII5nfB2ghhoaNyv2uGSvIlw1hdt064eeWC8H5HGB7GsysuMYmgOe9X2CXXxSwmJAxU1x3EPWS//punLiLh70rCNxQF1FYIZVY7KeJBliIDiN7QwZMkGLngWGcdib7qyRFeysI/NaDK16Ebc5TFuSkM3ZbB80nlhVUgn6qcLo41QK28OMETaoSEIpl/KK8IHgVOzEMUShshxASaCWFSZaJ8EYttQwc7xAkdcQA2jNTCBNSStfGakG6oiDKsrl0x3YMCECPmkyhUvrrcoPi+KDOExHlHzM3FJl/axCeqB8lT4HCMKkIqL7x+geuhQDx/KRHNH6WiTGztxLq/koyJPy592SqyCyNPjhAzj0CyXwN7kYZJM7TxNNVz7jkmlvBmVHjFgfBDTJ2Gky1tXCURBwgRHGqVkvsQA1ab+MMVEztOji2S1rauNRPL7p0yAdVuVmprKQEzW9DMGNxCrLht3K0tIhGUfYgAQdyLBOK1XppWeCVdVolN8jABusTYI4qFDgknxb0JYfpDTYt7TJLiCGBwGSrYwPnAdzJGDz7ujHpsy9bRifHDk6033mrGBPqjFOyoh+91UEARYpU3KGtSMq5yVPG9WxgrMRQlbD9geE9Mo5TSIXg83K8je0vMaoOePABjjvBcGu9Cay6v1QhbMRQgNcHr++oh56eX32nM5tqXMeszdvrMqm07OiCba4dt3mutx2aaO3Y2TXV398Gr1++tbuzsWc7O3/fVQ3M/e/snK/L5whT7LADAxs6eJe+GMhFeEU33CmMmPxbSTcAfOWs83xxUdLo4lTM2SieuByELRQOlr8SLy7j9zGMwKBaFyEFKBlwJg72VqLgprJ9oz6nsoRKmg/AB9CbXI1mPCkARAMAXvrHRYQBhkLr32uTEOHulCB8C+K7wOTjA/7322dFhKPSVlv1N49lI42mTEOiP68FAv2Bmgdvw3s9R9ljIevOccwJhBoo1EY11NSRXUE2K5bsmA3uZKCy1uGAmABf2fhsUOaqmCzxEQVjZayyVhLnkGE0r6q7R2gPp7x9Mb+zsydz4VfmLDZUVb15PX/1sU/Py8szUtRYAgKbm5WUAAPa7yYF95q9GfgSXI+Sd+ePvlzdUowo99r0dO5umJsZdF7hp2XsfraFGwiw+oyCjmJaBpuJst9B3BFKT0adWKt/HLC2V8/sFMiYGrDmppXKhk7LUmKYT3WoTVzvUL654nxsiu/GvR7RPb/yq/MXL09deArgGAACXp6/5n+F/Nj1kn2GkCCYsokkdmDCLHGWZhvMOfETDgdyYeljrrZmQ8tnEp+JoHi9rQZOUiRp6F3S94xhGJ2qaBxM2sTNLd0EyxhNTECSu6y6nka0xt5RKxcrRYzPNH4y9NnR75vZPNDU2HtIJiGm1Fva5uPf2h9euO7zLaiLMmPJImqNsKVNaUWoStD0ESDsmRSm5KbEBZmWjgEiC89RitfzJCjOI5ef9GF5wp6JYelk6II5nMTF+eDKba28ZGz1cBoDH12V3v+FabdzKxnV/dedRdVzVnzKjCBY9AvH7kmYTXVr8LDogajdyJ/yZ0HdSsN6n/N6XprMEGVHJhWNaW2qr6dh7bKdx2JxftrC6h4sVqOi8g7HR4XI+X0hnc+0tH4y9NvT72z+1mlltU9J9nTW2YQWV/W3+rkUCQIlJ8YnqXEl3jsXJU/NeB01g7K9JJ5+UJZanpMJGQpnUeCv2rI5W2kQeHT6ASCI+FonvTcbgmrSTGYMSwoJgVLKYN6DrzwVwyeTHRofLGzt7ms8dOTBV/sVfPr565fJHTDuedNZXZjV1HoGoKJ6mybUaxm3oiOt2O3XOD2xjYS3oCnZtubJROD61kKIKzJTCWJevrvHrS8IO7hqdKCCW0VA6r6eUdctwpP8xp/wBsRFuj7tZC0LYfPe5IwemWtu61mBWO45g27jq7F++1HO+srAJAOCbAPRf3fNHV3VgmOr1pIgbdpxtuxRHoEePHR0cGx0uq56HychiGQ6EASr8+WXnDfL0cYaEyoycOu42zrsLrj8mi85Sk+yFhpGJF8FNotRpTdYkESHoClXv8JVJmJZEtSD33RPjhyfHRofLrW1da3irHRX44okFbQE29vPqlcsfSf18RNkjH5UBJWqX1sIeYg3GEgLvU0J6Ro8dHRQZRKVCpmgoMvb4BHIPWU23br8oPUiLpo6ooYazFHQudvKmKIbntaZsooZNDIW4M4yPW3x/0DUCfxAeP7mSUkrePfPipX0vfy8lWu0oc7AwIVOVd7L3Ty1kphfrV/+7D8ZeG/rusVMrAQCOjR5slgFxN/NIDdGqjcvs1Dk/+Jdbt35tbHS4nM21t5RKxQrf/CL24GNzwnlk2Qj3YRbZMsQLXkuQ150HzmRusmmYYFv27CQupEg1VnQ6VEgkPWHyRWrgjWuip+F5Roce/vICZrVNY20bayweTY2Nh/5Nx4ZtH4y9NuQi9O51MJf1+vzCfZFCjYQG5LFxOybuPLPOPDgpFhKJzKyiO44RZZp4khhRgil1lkpg/flXhjgHTv6JdwHeNKFGF03TWqlyv03aPvXTCdUziLAmkJDWlDC91H6n5N3xFy+Zxto6C2wi3KtXLn+k/Iu/fHxgYP9Coa+07OTxoxezufaWifHDk/l8Id2y+f6DM3Nz+0QX3+Q7biaJv1Pn/IAS0sMyDLJwy/fWZD0I3GQYEbA15csTw6w4gFxg70maN7CbMGlVVnpHUYAy6xv0OpdUFhktxSPEp2mJklc0FXJesEN/I7g1QM5KASiZGD88SSkld2x5dM3EkQOTIOS1bWNa0W1e2zh/YQZW/vXKTbd/7dyRA1OeECxse3xrtb9/MM0s9Y+Onv9Jc2p2ZVMjRMqdex1jUx56XY6z3r2Z3rrjDeOOCgxjv5dKxQoFICUQMimS6gedN8ez8qieY5CHTphfJdl/slwyRtjBI+WqJo0kilC0bKJRNZQUKJO9n1IBwOIWnRBI8jptEEh/prRkIgmPkPqTE4gLpOXzhXRrW9caW4RcFWcv1q/+d+Vf/OXjDIEvlfYv3LHl0dsKuVylt3dvpWXz/QcvzF74J4aEf9RHaohWf2+2SPmU2NR15y4eDDMRVB0RgQlug+03U28zjkFBOceWEKBGGzriuNo27WqiKysbGBB5eoLmWqKkEXTnDwyTHyguUEIvbcudbxk7coBVo+3BqtF0x9RCZnpNuuWPzo8dnmxt61rDEOlsrmMty52vvuPzb0UVZrFk9PcT2mALe4izuQRVemdjBbzOtVsbq6/+y61bv1YqFSv5fCE9UCouaBW/YZ0imx4jpfsRPEddnYTU+mJW1qKT0eS9UasjHRtUzgyxg9DImiR5l21i86TI+k2APAzAoZ73zlxiG6vNu9xNjY2H/sP/1rV9YtwV6Hv/8LUP6Z2NlbHR4fLY6HB5XXb3nt+e+NVlUaAxuiLje0uoTDQ1RKudANVzRw5MAQCcy515+cToO39WKhUrT2YyqVKpWFHP8paMqFGktnRgLUaUyRPwS4c7WuA4SYDNqpLpjxQoC21+UBMSqkgJdWktGZncUpG5yxSaH0e5Tf3AYm1WQ26S1744V397fTp1loFhIyPDtNBXWvbumRcvnTjVtvrckQNTGzt7mls233/w8vS1l3RCa0Pkz6PfbI5VArEOoZSSq89f9ckDn5udXaCGlNSmsTL2zNFZV5QG32PoGQYHO1hcr2YohmqvYjKgugbHZLOKmkyFDgdALoKnIqL2YYuIpjoNABQTNhuNJ32YwoMVCRCDqCdLg7qHqoacP/hUVWtb15qBgf0L+/9i3zwhhPLWmUe3MYssA8nEbjIZMv6JyS/fwsfCxuHCdecuSmH9wh7iMOqeEPEeyCuuTJ5RGN/Qz3sL5LGR0EkGqrH9b+L9SbsPEWOGsbFg+0v6fkSGUsbahVIjDUS99Qzm1ryLFGIdXcwrjXd0ExcUFh0jd1Bdh+wasM8EymEVny2VihUAKGdz7WisvXrl8kc+GHttaOAXQMZy7S0nRw9f7O5uSu3a1U42dvZkps9e+Pbl6Wv7ogBtJlY64Pq//4tl7Gcbat/mhuopQuB9lZYMNfwTbCJKzLAwAUqiQAaGO5+Ja84opKnGmPmMK4KMkGg8/OYuJibAAYuoZBMhgXjb14oSUEP1N1PBSxIEVLrdhtcfmggClLR29q4EcOvJN3b2NLOfWSEJ+2xrW9ead8+8eKn1S70rb/yq/EXdtTVUVrwZ594yDeedk6NHL7rCR2Bbrn0t1tQhdnONnT6zasfZtkt/u2F21afPZ64UZ4pVmfIXwyVxfyQloFIFrHkt7r4JD3YAmoSSsd6gtotl0mzOgxVRYygM9LCJlZOOq2UslQY3gL6XL7rI5tpbsOt9mj59UzCQpPdVkumbJCehintSNto47gTLuGuk/B489NRb4kQ0FM98mBAtjNJtVlgCrQciI18HnO8s3vpQQqh7YYWmgrOwhzilUrEii7sopaT1S70r71nuzBw9NtOcaTjv7Mw9PvWzt3+yomNn05RYjvnp85krP3uALie/nEvznVuV+ZFqun6XU5kfqR49NtP86fOZKwC1ss6Bgf0LWNqHTzGJ67niiRWp6eevLhYyvU7/bP8iVrQRsMgW3hgvZCYD73iXOaolj5NBwUC4RNhJTc4R0lYKcExZzgk4H7MPMvifpcSeCN9Qoxl2e0XxUGR806aWQ0b1xK+/am6XieegK0OsPSNAO9SCP+tLd8N/k7Qqit6ZMLxO3Hv8nsDQZuM1X+L55lIPMtABGOD8DXurQnunco8LXgW/RiqvIuTealND7KTCgocGySGuDY8qRllg5Y0g35VEOKG6JpP7UKZhIrh02ERNTEgDmyzwHTb3ES90sl93w9BOYXxM1jSW+6tRKOGUldooRFGmNyXWttWasqFjJucKvU8RH2GpMF3clMQ6xcUR0PvReCzU56gEkvTzUitaStxsR3RBsBFqmaKUCrkiZZWUTKiGQ8qElIK6+yy610GT0cQmlnPJ3CCLBdAJSnAz4N7GR60sw+fj3DGj71C504qNhoz0lW5kahei2EybtPUGdN5S0kbQdsQyv+5em6VWCUXaSzpNeDMRzLgPWiXIJvhBUveiClf+/35g+AOrJBSzIWp8B8hSGBdbr9FKwQmtnnZCjWBNYHYP2nW6WZosyuTB2BpKiMGkc4hjWHxbYOWjFr7ErRMAYQVHYurPfS8i0AA4rZRBWBN1gqUtwGri/ZgajbACkIOA7rqBeTmp9VxoGVIeMeds5BUsce22CbCFWdY4wqzbrLpB6EsJ6CUCfAHuOiapXKIaCBvwLA4lscn+ru0HUM6ltqyFUAfy4YsAotOUxmizQYrCZiPHAxTMtLatp4Cm7zTobDgmpSSp+zO5PlslZBO+yFKDUZVRJMxFsd4BpW1j8Az2hW22By/YCjO5RN4TuhgoFC9JNZJdE0WcGDkqgGFqFWTCJ7027qFK11PcVMLDSzIGN82Rql6zrS/AADbt94vX6Ln3Ub0V6XdQ87VQ5tGRKjXtutL4z8Ja8/AMmnHdPv/cJu5JRJDOJM2h8xSwMsLAZyxdYdkDN0JDFYoyigcSJWWVzxfSjLJX5Z3JALEopcLYRjd1i80tIqDxvUlBj6kRNAnX8BoPsCiL9iodpbN7QgO4azOAAdzSxXy+kGalirPXN1Qnxg9P8jcRpUQvNC+4VokGIgVrNtfekt265YrX9YQe2Vx7C4DLismXPkZVTLIOm+7uvhSbRrHjbNslVm4pO8ZOn1nVfvbU5edmZxfYfYjTLBiTZ2qIVhf2ECdQugl455vqXpRNLwLxHrsf1fqueGJF6pPH2lazZ883LbhdfQRqjFTEuFlD2yDklRz/aaapbnjTXatnr2+oZhrOO/y1mhBW1uZXBctV2Z5hx8nRoxf5va+8Nk5u/HulwdF6bG3HRofLT2YyKQCA4U13rWbXz/cBsKNUKlZ6M711/L7in8uKJ1ak9vzXPbQ4W6wSkzpmrINGtUnQ2mlTIdcsXGtb1xpeeTALwpTLzPrNN+5Z7sywRRM/27GzaUrcpLIOIawhXWy/M9k8ScfAqnUP0UIRfDOK72Wv5/OFdOPQi/S52dkFfn0BajS/HTubplJDtNo/278oPgcAgIFScYEJiU8fJBiHOEKtOvL5QnpgYP+CVviQgfEme1p3XpO9vZR7hVJKUroJer7W5cj/Nnb2NBNCpjZ29jRPn73wbf79zWTV1wkhk94Drkg3HlZEr1nU7u6+VKlUnNzY2dPc9P4vltU55Au0Wt1+6uen1zctA5iac+5qPj9+6pRnI7Ztv9ufxbRYpa+PjR4uT4zXlIDoWYgLLm9IF5qBASC3s2PvUgv01ra2VwghUq9E24dLiFJxPpnJpJ7zFF42197Cry8AQIW6JAmnfl49BXcCbCd3v08c58Rilb7uWQ5XieYL6ZJ3nf5XWrRa6jY9m2WW29mxl1ar24njnGD/lkrFwV272ut7e/dWtPAR+xbinhMAplvbutYsz7z/x/zbFqv0dUJIWeXJmihib/9WWtu61tzS8N5TxHFOJCbM3v0TQgZTKu2DxXwECGWN8zd+Vf4iz7wBANCcga8DAFwrfbYKUETPLRNsmQfAD6jL7ezYWz0//lCNhSPo5SLsHN7v5NntubtfrQL5lrf5Jlvbuta8O/7iJd8Fk4QEuqO7uy9VXaw+ZMMMEvF4JY51YH3t4vMoFl+oLxQem2ehgAP0zz+cIw9i6yus8V0A8CAAeba5oXoqt7PjB4tV+nqpVPSHCNawAiJlJjFh6+T/zvYfrVa3fzjnPOhegwMA8GA21/56ofBYeWRkOF0CuUcmIxvM5tqdKzPkWf71lY3wungOm/3BvovRLS/PvP/HV2bYdSd1OHBrYxUAYNDR0cUEXSJzzODnnX+zHNVsHCNJoAWP+1LRneru7ktt29Gxdnvu7u9cmYFnowrPh3POg9Nz5HhuZ8dexsgZ/EICKsoaDH2+WW53c0P1FHN/WRym20Qynmr+tY2dPc2FwmPz2Vx7y/bc3d+ZniPHPUGxOqauO3ddmYFnCaUHcjs79jKBBm5EDcaTjV2z5KaMrmN6jhxn43pYbMyq2VTPVTa8gGd7yecL6ZtGcBBHvHXgCTbLd2b95hsAanYNxkap4wnznTNFvFUqFSuu9cA3W3ND9VRzQ/XUrY3VV29trL7Kfpd93ZUZePaWhveemhg/PMkDGoQA1dEBu6N3gpuycejFJX/QvCLj412NiUDjbB5EZCwrJsLM1lW1tky4czs79vrD7SiPBhPAgNCARyHhnPNBRskUTP+9lB5gzDEbO3uaxemQAeXsPdfUENWO6o3znCmlhMnN0sXTsB5AwlEWHG9CgJKgYN6z3Jk5p/mCjp1NU++OgzGogwFUvZneun7P5b4yE3ZVVjXBU4tV+joFEnjQ+XwhnRqi1eObxm+rc8gXMNeYxTP5fCHN4lQe4Q8POqM1DjKG8XqbogBdlJLxnlVN8AUWX7KjziFfYHGZ6yQFlVNzQ/UUJaRHfF+dQ0Lnym5tmpoYV4N5IUGQDELI5wvpUqlY9tb2WZkQO3XOD9h1zFz/ZJVNv0yT9dXlmff/mHOBQ4rz56dPb+/u7vvarl3tpLd3b8VfRxc6owHCBVNObKCkO+/GpirF0txQPdDa1tU9ceTAZLH4Qr3//QK5A/tZBP2wg1emWk+NEYFQIJT42SJUbsR1jizUnsJM6QAXCS4UOPgh6Iy0/e1r1SYCMKUjS1f9bWEPcaAEi7Ra3S7Gdisb6Y7RY0GNzdDXxqEX6Y2HU2Ts4NUyAAzm84VXTo+Pf4UJ962N1VdHj70z6G3sSiDNRyQKTiBh5K1M/2z/IoxCGQAGkeUZFAC1E3wsRQi8f9JVSIOqz3kWChNcPK0i436rAY6VbK69BRNotsmOHxt+Meg5Dbu1BYRQgGF2jYPZXPu36hzyBfFcH845D54eHz9RKhUHR0aGfVQaCwPEaxYtN8+FnYeCkWdza+N7T+Xzha+huI6QemJrkpjV9G/RHcekC12xSSWR0W8dMCFaUkop6fvqIQegCNfTVz8rtdQP3ve7ie/3ExlaKKM8Cky48DYepXS9aKFHj7lUuwxNnBg/PBmY9HDQjRf/7X33zI6MDNPRY0cHs7n2129trP55Fci3QgINbFQ2Ht8FUiAkPMpUzC3eu+xe+C/Hnw/knWevb6jS6nshBbWxs6dZjOl+0PAK/eSxttX80Dg2ZyogrDwtEtQ4rWXznNh5Wtu61hD63gFxs93aWH21CuRbo8eOlrvzfens6XY/NcilpwIuvPf3wdzODhAF23PFoVQqDo6dPtMyNjpcxmdI1bwKNjtLBmqxOV8mGAqvVACg4q6DORXV1HXnrpWNFDV8ajzKDmvpzfTWAQAc3zR+G3vm9L4/ouSNnxAAgF272snIyLAfJhzfNH4bC0X2vfy91B9eu842VUU6IM//nQ2p8/PZAJ37b1moxdTX/CFuPBUteeMnBL7ypcBDk6HpfsKD++vjj69IHTzoEr9jwJgHglwBhUsx8f3+aQCA3sJeGMudYZvvz2RWT+uxSG1jsBAAAGCA7ifvNP3dpTQcJgxVnhg/PLk9dzeIYcC5Iwem7vHGz/DKYgxcYQp6ExQFjWSTHGrk9e6Ju7v7UgBQ8RDYu0SBZuNwisUX6kdGhikf1mA8YyePH73Y3z9YPzIyTEulIirY1cXqQ09mMi/Pbd1yxWTdfTpqYlfM1dxQPSXuFV6ptLZ1rSHjZDKQqvWOXbvaSalUtPo+U7SePRvVsEEmzJ7HB75X8/CXKQDAQGk/KcBjtfUfrZ3n0MNfXmDE8b29e4mjSyX4FpQjp1+ef9Mxvekg+iryOQtD5bk4iwm07BgbHS4fPTbTzISFLR5fSujGv7X3szJH+1jFs47UfH4xIYT2z/Yvfnd2dhEAoP3sKe2kC+J7bfLzq6YzhGqsSfBzrDAjny+kq4vVh0SB8NJ9ld5Mb12h8Ni86xnIBiWAv8a9vXsrAwP7F7K59pbRY0cHb22svipau5G27MPM89IJQ+0+8TJYGVLt1Dk/WNUET2HxfW5nx142ISWgOLzv+s//99+slF0To0a22Tu2taV9PYUP+fJXfu/yioGN98V71l0e7hTB3DcFiqq9GQ/1Tg3RqlZhUG84Ta2aEAUhRA3MtO/oscODSPqLf6my8omVdVefu7oIpKb9RI1sothMY1bRCyHenPptOzpWw+hw2QPo/JjaxQtg0NfixD7/KcurY+N5vVzsqmnBonkjZcvZXHtL/2h/mb9Z9ymJnlxNsDmlcSW7dUt67PSZb4k5WHaf2a1broyNHnXJ7UE3dI5QZqz58E94xqHYVBYGZHPtr3PhzAK/hmKVIn8wcNAm5uZ9RqVsecfIyDAdGRlOjeXOrMpCOwAAbIMOyEI78GWwd2x5tJkB0fl8AVqv9Ta1/rIrXau3ILWYWvWlzHVmF2cS0/zsAbqcEDKFxc9cDOVRxXNaidRUDofQ/gD8IpLaQ9qeu3s7q2h6b+f45dLz4UW/+vzVBXje17ILKKhk6Obxc5j0mpqtJwNK+M0ddnR2nG27NAZHCYAmW4BN2hRiz4Br6dq7wKZiSDt/7Bofe/k4ACHHj17k10NG7YtN0WCWeGx0uJzb2fEUL1iUwnovf1zO5yFNEAFRGg0L0ycTbC+HvaNUKpb9qjMP1mLTQ20AKXUJKrGKrzmFgVzDMA+UTrpKqOYIud9x2H8hFUjlKAZi8+BR31cPzZ2DA4GvFecwsbRXuAACLw3kB3Oz8SvdefdvLtRPnsWAEPAqmj41svkUybljXli6iqUIxkaHy6VSsVIqFVksXpZZYcVTJGAxAwwXWnk86SH9VQyMEQt2ZDXpRmbDi3F5xXJrY/XV52ZnF4Zz7S0glEOGwjC3QSEwYojfN9vvGr88NmoOOPnuI1WPo/ERcyCgQ7/z+ULacV55eezU5lC6zcth9xQKj5X/0xtvNwPAFAWAbYo4HeN6UHHk2+6PqevOXdtzd38natmoWwI9XO7N9NaR2f7FFB+LCqgqrpkIwE8732kEgBtW1g17nUfYhe8jABRKxcqKJ1akxp4fLmdz7Tum58hx1cJw1tx7kG754vZcrUaZjZVVuVuooBjkhVWfZ+k5KUZw+swqgLBAqVJ+GBLL6guwNj02PvYd8XzCZgo1YWhaGHlLxLAQTBF7HsIg5gdKvRBxoAIB6M73Kdd+7PSZVbPXd1czDee/1dxQXc+HbiyHnc2198z+cq664okVKfI8WchvLaAgnqiMZD0LOLBHfc+LApBtGqQeIpaNrmoiAACDC3uIAwNQlc6nZpo5PNuXUBlQ4eepwe3oMegfhdrkDnyC4dXnry7k84X02OhweWUj3WEzpI09lA/nnAevzMCzrESUzX/CgA9dUYGpFpYVU9hoY56oXUpQgZTfhoSQ1F4b3nTXal2GlVcMWJ4ey/eKqRlm5YzAQX68rKLH3iZNlGk474yNDpcpIT3idUxdd+5ygP45AMAnj7WtNo+TqR/WiCWukkwJZSy0hC59denY6TOrgAB1VNQrsgeZrt+lRb/pnY0VUovriNSSeVlDkQNZtDBMsE+eeGf3yka6Y1UTPMVKQm1u3Kt0+nY2194yMLB/gQ2lS+qQ0dqYlCGiioVSZYggWlPM6+HljvVoY0d265YrbJ62l8+lWu9NqN+vPjxEBO9JlrUyZ8HhkWog1ASwGhsdLrP4nhLSg1nGWxree4p5brt2tVsB1rp+6pAfQwhVrX2SR0pe/F+LD6KwP0ymP30t4IToNiUHxGEbgJDagxyrVWANZnPtLSsbqQ/+0Gp1O6uBlW2qD+ecB29trMIdWx599pzghsdu0BDiTXb87YbZVTAOkzKgLOvlcGUbXQSsZLOU/fcRQkAAKHXIsfc575nIZ3776RYqlhQDVKtfIXx3ntpPMw/V+P1pEj4BuOQG3fm+dKlURMO3D+ecB3M7O06MHjs8ODLSpE1XBQBd1X7mZsURA9ZzVsEXdctdm13/3wGOAivsSWHUMqpB4BQoab3c2wgAN+idjRU4gae0Hmx4yymRrkVZSghtt/OQWhNXmGlhDrEc5P/lhR2r/f5wznlwVdP7J5hiODk6fDGJQWYyJXnf+f/24USEz6OVVwgCJumfDnhaxeIL9aVScX577u73+WwCSzft2tVOSKlIVa5u0HIHBZsCkG1eag5D2Nnmaxx6kbLv0XoqyPd++nzmyoTh8xgY2L+wa1d7faHwWAiR59OjpVJRW6bpEzAQu1DABIeJVyZ6NPB8Ur4lpkj8xyHhfK6SIdtMgLFDlfYKeAGcu1j7HVXkgcUR0w/5fCHN6Hc8l50X9kGscYFtZr8wxEO4dXOSbR8YBSA9D6cADmriISGdoc1vMiVIEWWArOD+A8VbASCUK/9wznnwyUzm3xYKj82LAI/KaokGgRBCs96z+Pnp0wGPxG1ccfO9z83OLoTXLfidqjX92QN0ORzRl4kyrTMyMkxb27rWjB47rCxlxQQLQ7+1TCleFp51pZnk1xkrD6O0YvRWrPCF4UAsjPvZA3Q5w7Z4phq/9psAofluBhrRBQCipJURN+DaxvkLLK3FGjr+1Y/JNT6lpbK6YjcR1mfLFZZUMIHy4qzyyeNHiaehiVdo0bLjbNul/mP9g9tzdwdSHCx3+tzocPm77upTW1dclloSQ5nel/dQgH7peWbWb74BPPpK3A0Z8p74jURwUA5LUfKKEEOmR9qyD8Oxo4Oua0smZc8L28jd3X0pVqlWKhXLdQ7ZK6aS+OKWsdHhcthTq6HfKg4zCpR0L+/TdgnWcHUgXmXcpW258y2jx46G9gET7GyuXdklxdKizADIrtMr7Ap6UwRgLCcvE+3Y2TQ1MLB/obu770qpVKycPD5MCIEyy1G7eWlX8bnhKEz58iV4PQ5DLL0LrrS2PXobBRVLZe1l1tDBctRrG+cvMOvNCNJUhe/M+svGqYrNHawRQZor9Lpt+L+NjQ6X/3bD7KqNnT3NIvLMu+Td+UIqLkChUgJ/u2F2leqzjM0jgAp7fcCiy1tbI4K6gbUZ2iTEc53NtbfMrN98Qyzl9DZ1y8T4YUZFBTIGGhFxHxjYv9DfP5geGNi/0NrWtUYsQa253jWgjrpxJ8qGgmIFEeek82uy42zbJQCAKpBviffvqZUDWNjAe4NYaCPDiMRnp+qn/uxnr1ZZuMCLmcDII4pgeM8RAk42197SP9u/uC67e0/L5vsPTowfnryj7dHb+vsH07KLZi4Bf1ycq79dLEARv1hMhXhOYqCGld+kbBEZKwfbdBs7e5qLxRfqRaSZbTAMD6gxcQRdKyxNBDE5tW0og4OKRs+N7hfohEDGoCAQiSub3brlyrkjB6aqQL6FbWrGGsKUo/gcMde+0FRwCoXH5ru7+1K3NLz3lIhf3NpYfZUBWwMlr1GBBCvpgwKoRPt9AkSbZ0ABCOuZHhsdLv/u+iefxVJdomsu3osKNOarJfkQjhFFiIpbdR5ZrYFsffhhes7Y6HB5XXb3nsvT116amZvbty67e8/E+OHJQuGx+VWPvORs29GxtrWta002197S2ta1hiGP+XwhfW127hv8ievTqbN/93/8p6kVT6xIDQzsX+B5k1WADwHihobchuazJ4xYgKfKKRQemycANJtrb/GIDihzBf+0qamutbN3ZT5fSLPrzebaWzALwlxSPk1CCYlrskMPmsVEoYfhxvW+WBFQN22wjYUMVwMe/whvLvc6SgNFP++PNV7wgs0UajbX3sJSf8XiC/WsMSaba2+hTz/t9M/2L2Zz7S0/P3362xhhwu+uf/JZX0lTgueowZgbGz59PnNF/whES0oDFndi/PAklurSKX4GDOqEjW8qMt1N3d19qTu2PHpbIdPr5POFdM/jK+paO3tW9mZ661rbutYQcJtyejO9db2Z3rrHH1+R6s301jHKr3x3IUUAaIoJNDvx5elrL7Vsvv++ZrLq6xMvd01+CDW/nv27sbOn+ccjv/n2fGVhE99yuTzT+O9b/qcWt1eX1OIyDwpDAAWukdBjieBj6JLAesKqxrbn7t7OLI2HgAfiHgAAOHJgyou7JrO59hZC6YEppImBR9LjuHpyhSVUSAkgFRqOuDETVcJUPA0T56XJ00I+RS/07xokpVIRqkDQiisAOM5IGv118da4BqYBAEB5G0BLbmeHR5AQ3r4rG+mOsdHDk4zFplQKJtAAhJSppLWUNwDZTe23wSiUzfSrH7MH9sjGzp7msSMHtJWK0pjaBmthX52Tv/+RR15ZBIBFAJicAIBa9aG3j8fdmu9Ajv4gAEA/iJWKaBw5Mze3bwYu7GvZfP+hhvrUG/zfrs8v3PfbE7/axwNkTLCXfarlr/LZQvoP/mD/5WfGDwfJBiytH2sOEOuUGVoLAA8yBksG/rCwgHXVMIpblxmThDTwYpW8DuC2RY4FgCZQktRh7ZdJEBD6iDIhqNVH88VWqLz/2jxTiNlce09zQ/UAlvIDgAe35+5+lacBZgeLPauL1YeuzBC0HoCRWYQ6v4SEHPHDf61jSsCLjVV19NmtW66cHB0O1V3wwOHEkf7pbblfoM0nNi6y7m/8c2DdV9ixPXf3d2LvH8c5MTpy9MXUB2OvDa3L7gbeWtfQbNg3Mwf7ZCfhY+jVK5c/wpr9n3mGVP34gxIITZWQWUMv0GJ/81rO0E3HW27vw8+C288B03NExAKR7UF6WBse47oOlCsCGKWqTNBhkyO7dcsVhtyrLL0UdXcR1trGxR3EwLl6M711/aP95WyuvefWxipK7Mg3zeBXjq8vo5vycrsXiViNxiPzxu2m7vs/feAa9D8if5db8VgMfU8AZwBCYRTKrAccS3WxPVar/a6l3Uyq/EyVvdC3EPlobqiuBwKDTm+mt+6DsdeGVq9c/ojqA2sb5y8wYReP1SuXP/LB2GtDfCzmx8okvEGV7in3+7tnXrw0NjpcPjE6/K9XNcFTtiWhshjJdQn9DbcQUjiSWl4Vzaz4EEXUWVcmKo7csUXdqS8fRFk8wh/9s/2LLL4+MfrOn2EEA1bxpgeKsfVl+0Fsyog73O/NN1coy5Qr8yNVFEyCcP38yeNHL+bzhfTosaODuvvP54Pgocns7Jt99GZ665z+2f7FQl9p2Qdjrw39/vZPrW5qbDxkeoKmxsZDt2du/8QHY68NFfpKy2T9qKKFNgEa2Gbd9/L3UoWmgjN67OggJaSH1Xzb3uytjdVXVzXBUydPvLOb1fvyc5dM4mhTC+x7G6SG7utma82s33xD3hggd0drFMzqcTEyVJ2f3TR67Oggq6s3UaDMe2puqJ5a1QRPrWykO06MvvNnfN21xL2hyjFPSB+AjZDw6HjIOvPn8lg+B0pujh1jbWEeYyieNdgP4jXfjNrv6sNDxF+w/Cvfrzv08JcXGEj15tg//gmLocUPNtSn3lj2qZa/Ymmi3kxvXXGmWNVxZpvEf2hrGwDZlmsPNLG3tnWtyTScd/iab1mqiLVcBtxOL70R1V02j71c9495BXdsefQ2FvOzDfPumRcv2cfH+N/Mq+DC7rgoiGz0Dra+bI0Xq/R1fjBdPl9Iv32t2oSlEI33A0LIgPX6i4PsGE4gI7KUPRsKlBQyBad/tn+RjXQShdqk1tw03dn6pd6Vpukt2+Pk8aMXBffCTVMYx4FemsvwbqQDt01Hm7LUmm5Chcwt8cnlDXKOUR4WOm4W9GOAVa/bjHrVKRdlmoyz6DZ7gN87xeIL9UbXrOgMNP1MlFG8Js/QxAvD3HjT890Mt1zaPNGb6a1jVVCsN5UJFr2zsfK5H7/0u+dmZhdZWspjL6c2zRCmmlSm3ZnbeO+ye+GtG28BP2qF1c769LYSDyBqpZI05tZYSTZogLnk4vRIEz4rm+vw0XR+CqUMcINgHTlfQcUs8ZOZTIrvyd5xtu1ScaZYDWMK5vcRUY2S3kzBYWENG3gY55myn7u7+1KMkhfArfKqdcVR0IYOwsCA8F6jJJ/vS7ERxexfAADHeYW+9fe7b73v/H/7cG7PoyEFwF8XgEslvee/7qHs8wMD+xeUTemywe3o62A6GDuaZRKrppQghWiBKRDRYt4sIIPaE0tGtiyy52XiFck68kJWSQC6wn8H9TllLJgmXpCBhccGt8ex0ozkgN236vwmxTOiYpLudVojx6h5gcb95ybuEhDVZ1Tuc+jcHJsH+lCovlSSX2zxM7JFNXWbVA83jltuswGibkjc/QerjRagGcaEWvHsMQEV3X7x+aqUgmo/6FxeI1dapyy4EmY+dFR9TrX/jBQYsl7RNh1qeXktoY519IsTXSDQ72EU2RE2P3ZO25g0yRgtqXPaxqkqRaBS0LaYiHH8qVE+NaHQWe1kvDBM2YQVkv56l2JPWHt/okWTaSNdqkT/HTbWg7nPYCWUPL+X0SYWLJPs5yQeBBaumFqXqFYpCWWiUx6h5wNBpW9r4fA9pwr/IijfCMK5FOEW5qUkYjyUrjUfl4L+QUndOq0wGrjJwjhSU0tvr6EtYhnLB6ZD/W1cSFvvJAnvydRtFhWCPFMAyWzihD2jON9nJSMWQh3ZLQ/EFYjrYeoKytx7lctmIkg2N2bqNiUNkImxoykWsRQb0mq9DLwxLMa0VRq+NUfcWxMBCcWgEF05Ji3cJmuPgW86/ECGMUivD3NZVS6YaXwhWtU47ntSG13ukYAxMmvlJvMb11RxYRZQek00kdytyspq3w/yzwQAOENU3gbJj2tRbZWiLttgAiCbgIAqA6oXaO3DABTSFx8kKugUpA9gKQoJUJAD8BhP7uKbxX66e2Fgo60bbIIsx93YyjjXMiTgLWV4D8Rz+1HFYInMR9szgGIx4t+lXihAfPc9DugmT72YxwK6nJoqLZBkhZcuppGlVKKAUGbAWDQQxAa116X1lOuDgJfo90aNe2N6ZuK+ChkSCHoJUULCpQbXZEMZIocEEoWxhG5vmJES6z3GmEzFyiZxsWwqhjDiPsZWum1Hx1rx/bPXN1QZCZyOMJFdk9+kwlUS8aWWbGoh//PJ40cvyjjAQhMwKAXZNWRz7S2sfjzwYC1aQvkpnqxi8NyRA1Oy69HV8bPPFPpKy356+Z1GAJfKh1+HmfWbb3xm9d1zlfmRqoycXyStZOdl9dl8zbm4udmzrVUU1vYUf7/inopSERk4n1DNp5tMKt6brD1Z93lt/0J8LRa2wEbupqZOOrKlEFxBU0vByiSDMTFErl3HP6eIrRRulxVQkvDnVR5N7Ry262AfHqDPiFJiMkc6an26qVdmUzUphrXS9KDhNaUwiVd30NRa/WR1rkSgqBF/xywx9UbaMgXAU91i1idAzobMisaG2/F/Y51oYhcaY3r5YOy1oVKpWHn6aeoQQrjaZgm5Q43JdGFjZ0/z9NkL35atYUN96o3PZn/vh4SQSkBLc7xWAeshaGP+vf9i27/+sneK79lYF/H1b34TyDe/CXRddvceAIB/OJn9/p82/V8O45OWWQVsKINLRUUq67K792BdfuJaEEKGWtu61rw7/uKlmjUNz3XZ2NnTfO7IgSl23may6uulUnGy0FdaRgi5QQFIf/9gulQqzrP3PLDrD74qegK80Jh4SwaL6jPUcLxSxuesjYqG4MBIZKSwkVCHp3KE29Z8l9V7g++4+2JF0I2HaTyeszow/tP/t6YAdDOz/X8lEzqxUUJPZjIptlF5thd2MKaXls333/fArj/46jPPkIpLXugO9ZZeCyGQzxeYewgzc3NSxpjKQmoXAPywBiCFAyJs3fiWQ0JImeeXu2PLo28yQkjVrCnZ5njmGVJ95hmAVa2f+8Z8ZWETIc8MAYRH68rOyU9+HMu1rwKA8vX5hftU6+AejQAAQxPjhycJHK5xmQOR0gU3VFa8eXnuwkuVdHlXoa+UK+7P32ht61rTemdj5VzhsanWtq41F6YvvNS66vp3d+36Mnn7WrX53JEDU7Vxyd6uFdxvzN03UopMoDkZ4K01MeGTZ4P3JAqHKnjGldNJ9XW6QPRul3+NyjpZHUAVNySQuSuMFTOfL6Rv2fCZxZbN9x+klJJDXz2cZq7buuzuPexvfHyM1Y9jx8bOnuZbNnxmcV129x5KKRl44omGXx78P5cXiy/U//jHV1MioGUKyol/X9X6uTPsP3at/NTJKAc7H4DbkRd1vRnjaLH4Qj1ryWTnppSS8v9TTpfHy/XF4gv1Nug8exbiM2pt61qTzxfSh756OM2+Bzu3ql7BpIRVWlKtARnBABBWZWOsC5EYlW5vpreO9Sqz/mOZULAHzj77ZCaTYj8//viKFHuo/APmN1xvprduY2dPM3udvUf8j32G32ArngieH8BtCUSUn3Rh8vlCesPmjl/zm4L/t2Xz/QdXtX7uDB+zYSkbLL7jhZptxO986lPLGN1uFDyDfT/7jta2rjUbNnf8el129x62wcV7iBIjqoQ6gDiDfZ0/f27JzRtVHfLPiF9n/jV+f2Ixa+2/2vfJFMzGzp7mjZ09zWyP5fOF9OOPr0iteGJFiu1HRp+9sbOnmf9ubH+Ke5V/puw/mQxiz5YpTxMs4Z/JgZMz8ELNhI1f0JbN9x/csLnj17xi0qXDmAIShdo2HaLybMQNnc8X0uz7Qp6FBdjDzqsVPJO0JpebZspbtNTMiARBUln1YvjZMcu8qvVzZ9g6tLZ1reHXodBXWqa56I+kAGqpj1RuZ8feycpqn8t5TfpyfVInn6ysnmfnY99hcn72Of66ZJ9l72morHhzYvzwpDjmlCr4sC/O1d++emXqjRqFT43XfOHs2c/PwMq/ZhxeAUJFbGInuER+AO7gwLWN8xemZue+0bL5/hBQdAdZ9XUYPzz59NPUYcyrImgSTmsBtG5x721jZ0/zb0/8al9TY+Oh1BCtTsz0T3+i7YFDM3Nz+zZ29nxt7MiBcm+mt44QMJ+J7c1Ai3qE5mR799A/S6twhEwRcgA2bO5YObWQmfZwAad/dnhRCA6puL60NlXMx1m8mVNT3himP7pQufBPPx75zV9UFiq76tOps/d/47G+o6/e3rz7f37od8X9eZmvSjwOVh84XZfd/SdJy0Bc+eGvh5cnpVBfm13/3xu4F65VVkjfnGk477BcI/8v+xvLw7LfGyorqux8Dcj5Ra4uHwjx3tcgfP+1yorQ9zR4G7JjuTPz7hlKCCGTQesWROdFob+GCN7C2bOfvzhXf/vtmVVfL4NPZDdpnA65s7ECZwGaU7MrpxYyu0Jv8Gz+b37TV+ftXp9VIzDBkqH/Hrq/sbOnAuMADFl/YNcffLX/F8XFftIPrW1dX5+BC/tu/Kr8RQAYInv/MEX/AuYJMclTU9IKvQDgX/O07F6DoBgOZvLvaW179LYJj4ieP68/j5uBV0owiVAQMiEeC2y6VCpOrsvufuTa7Nw3mlOzK9Nk/fZDD395obWtK/3AAysWZDleKmRtUkO02rBhxZvYHsXGTOlkxER22D4W5YC9h+3/xbpL/u+YfNI7GyusDuCfn6NtkOfl451bNnxm8ZYNn1lc1fq5Mxs2d/ya/dey+f6DzHUT4xRVtxk798bOnmYW78pcVQzQUoFwvZneOhZTs2tm8TQfVzNXNJ8vpJ+mTztGuWnudbYGJqAjWhqMAEKYa7/v5e+ldO68rrSXPZti8YV6Hh/BcAtT5pR/DofDuyMM7BIXgQeseBBLRJPZe1Y8sSL1+OMrUnwM1JvpraNejMXeAxQIBqCxwgUXUAhuDAbm8aAFIxT0UwlIlRC7pz1/8uJl9l1rG+cvNDU2Hroy8Tdb3ht/e91742+vc9Nac/t+evmdRmxzyKqFANzB8rxrzzYYI0xkP9/R1nUbz0sWzOfjBTLHN43fRgihjOV1vrKwqW7+8n+sm7/8Hy9PX3uJT8+9OfaPf1IqFStDW95bzewScGlPkeNcNLVTC5lpFvdmc+0t23Z0rL1jy6O3yYRFFt74aak7G0MptqOvvnGLSsDYnC1VWpNxvfGcXSpCD5kS5S22uL/ZPmxt61rDlCrbe09mMikG9vKAsb+Pqau88/lCmoG7/HdgBTpBDCdYSMNmaIF3HRiQ5v8epQNHZiFl3UdoeyVDkyloG+dl3U2hdlBNhxVDOBlQtj1393cogM+gKYIt2Vx7C2vGCFkOCF4PU3A6oEyXRpQ1vxSLL9QzKy3LFjBr+OMfX00Fnx+gNdyiBTMFysy6i9z3sHXhz53NtbcE68Eh2MmG8Y5J2jPFTEYtBRmtnVLXRCH1CFHqLoEeiv88BWlHF9bXL/WUeJAR2NB5SZ0wW2htDTRf+SIOPENiJL8SzRsTAwQoASIHX7zAWBa/ifFzKHHPxVS8Vr84V3/7DDQ2EQCa9YRx4siByXXZ3Y9cnr720rrs7jfGRl8b6u4upAcGYIGvnvNr1rl7v2e5ExiGfk0ClAEArNx0+9dcbmziPzSh9t0/8R1bHr0NACa/tf+H/wuAO4gwVCXl3fO67O5/f3n62ktPPNX1EAAMbdvRsdblgmaTq/yR6CFmVnbO+crCJiYgAAD/Q+OHMwAA/+/crU3/5t6Hnizuz98QnwdW8MP2Aqsj/2TbPX68PjY6XA4WDVHw8Q9WzERIADwUPSV2ze6YnRrKN3t9Q5XSo0Rns2V12WINdmAfYf0IlJ+1zp2LuHPCKKEBjnGuAEs7Ukn0egIeBjf8jy/eSqlO6s8Q5u6APyG7AbEYnugaOUjwIjDhExPO4sYPgT8MPRUHzNXmTIWO+nTqLD8A8Cvf//2rv+kupAcG9n/vE20P3Hdtdu4b+Xzhh95mT5cAKv6iktpiYgMA69OpswAAlYXKLiYo7DVeARQyvQ7M9i/yG4PNwhItwvX5hfvq06mzn83+3g/f/lRP8z3LnRkPCU51d/dBPl8AAPjhj47OfcMrzxxig9aFwfVSlzadSo+w656vLGwCAJiYa/DuqXK2Mj9SFfeCq6AJBQSM4ysMWzbf/9fpVBiwJB5wFShVlow+9id9ukZnoVQCmP8fmxanfpqZZudm7j6mdLDfxYGHrFQ6VFXJhCJUPclVhwbORUAEP2WZE8wKi98drI4Uh//VZOf/A94ogiNmrngIAAAAAElFTkSuQmCC';

/* ---------- palette ---------- */
const INK = '#101B2D';
const PAPER = '#FAFAF7';
const BLUE = '#2456C8';
const BRASS = '#9C7A2E';
const LINE = '#E3E1D9';
const GREEN = '#2E7D5B';
const RED = '#A8453A';

/* ============================================================
   DEVELOPMENT UNDERWRITING  (v2 — Sale / Ground-lease, unit mix,
   affordable set-aside, hard / soft / carrying, NOI, debt, exit)
   Everything lives in the model JSON; v1 models are upgraded on load.
   ============================================================ */
const UNIT_TYPES = [
  ["studio", "Studio"],
  ["1br", "1 Bedroom"],
  ["2br", "2 Bedroom"],
  ["3br", "3 Bedroom"],
];
const UT_SHORT = { studio: "Studio", "1br": "1 BR", "2br": "2 BR", "3br": "3 BR" };
const AMI_BANDS = ["80", "60", "40"];   // v1 layout, read only when upgrading old models

const AMI_LEVELS = Object.keys(HPD_RENTS).map(Number);
const hpdRents = (ami) => ({ ...(HPD_RENTS[ami] || HPD_RENTS[60]) });

const REQ_MODES = [["sf", "% of resi floor area"], ["units", "% of units"], ["uap", "UAP bonus floor area"], ["none", "None"]];

const costsFor = (boro) => BORO_COSTS[boro] || DEFAULT_COSTS;
const typeMap = (fn) => Object.fromEntries(UNIT_TYPES.map(([t]) => [t, fn(t)]));
const newTier = (ami = 60) => ({ ami, units: typeMap(() => 0), rents: hpdRents(ami) });

function blankModel(borough = "") {
  const bc = costsFor(borough);
  const units = { studio: 4, "1br": 12, "2br": 7, "3br": 2 };
  return {
    v: 2, id: uid(), dealId: null,
    dealName: "Untitled Site", marketArea: "", borough,
    structure: "sale", dealType: "rental", program: "market",
    district: "", street: "narrow", devPath: "aor", overlay: "",
    lotSF: 5000, far: 4.0, bonusFar: 0, airRightsSF: 0, airRightsPSF: 0,
    mix: typeMap((t) => ({ sf: UNIT_SF[t], units: units[t], rent: MKT_RENTS[t] })),
    addonPct: 25, gsfOverride: 0, otherGSF: 0,
    affMode: "none", affReqPct: 0, tiers: [newTier(60)], utilAllow: typeMap(() => 0),
    floors: [], massReserveSF: 0,
    purchasePrice: 3000000, keyMoney: 0, groundRentYr: 0, groundRentFreeMonths: 0,
    closingCostPct: 3, otherAcqCosts: 50000, creditsAmt: 0, creditsLabel: "Brownfield / other credits",
    hardCostPerBSF: bc.hard, hardContingencyPct: 0, softCostPct: bc.soft,
    constructionMonths: 24, ltcPct: 65, interestRatePct: 9.0, avgOutstandingPct: 60, originationFeePct: 1.0,
    cTaxesYr: 30000, cInsurancePct: 1.5,
    retailSF: 0, retailPSF: 50, commVacancyPct: 10, retailExpPct: 10, commCapRate: 6.0,
    parkingSpaces: 0, parkingRent: 200, otherIncomeYr: 0,
    vacancyPct: 5, opexPerUnit: 6000, mgmtPct: 3, propertyTaxAnnual: 0, exitCapRatePct: 5.5,
    permLoanPct: 65, permLoanAmt: 0, permRatePct: 6.5, permAmortYrs: 30,
    marketSellPSF: 1100, affordableSellPSF: 500, sellingCostPct: 6,
    isPublic: false, updated: new Date().toISOString().slice(0, 10),
  };
}

/* ---------- load any saved model (v1 or v2) into the v2 shape ---------- */
function upgradeModel(raw) {
  if (!raw) return blankModel();
  const base = blankModel(raw.borough || "");
  if (N(raw.v) >= 2) {
    const tiers = Array.isArray(raw.tiers) && raw.tiers.length ? raw.tiers.map((t) => ({
      ami: N(t.ami) || 60, units: { ...typeMap(() => 0), ...(t.units || {}) }, rents: { ...hpdRents(N(t.ami) || 60), ...(t.rents || {}) },
    })) : base.tiers;
    const mix = typeMap((t) => ({ ...base.mix[t], ...((raw.mix || {})[t] || {}) }));
    return { ...base, ...raw, mix, tiers, utilAllow: { ...base.utilAllow, ...(raw.utilAllow || {}) }, floors: Array.isArray(raw.floors) ? raw.floors : [] };
  }
  // v1 → v2: keep every number that drove the old result (building SF, costs, opex %, rents)
  const m = { ...base, ...raw, v: 2, id: raw.id || base.id };
  const comm = Array.isArray(raw.comm) ? raw.comm : [];
  const commSF = comm.reduce((s, c) => s + N(c.sf), 0);
  const commGross = comm.reduce((s, c) => s + N(c.sf) * N(c.rent), 0);
  const oldNet = Math.max(0, N(raw.actualBuildingSF) - commSF) * N(raw.efficiency ?? 83) / 100;
  const units = typeMap(() => 0), rents = typeMap((t) => MKT_RENTS[t]);
  const tiers = [];
  if (raw.dealType === "condo") {
    const tot = Math.round(N(raw.totalUnits)), aff = Math.round(tot * N(raw.affordablePct) / 100);
    units["1br"] = tot;
    if (aff > 0) { const tr = newTier(60); tr.units["1br"] = aff; tiers.push(tr); }
  } else {
    UNIT_TYPES.forEach(([t]) => {
      const mk = (raw.mkt || {})[t] || {};
      units[t] += N(mk.u); if (N(mk.r) > 0) rents[t] = N(mk.r);
    });
    AMI_BANDS.forEach((b) => {
      const tr = { ami: Number(b), units: typeMap(() => 0), rents: hpdRents(Number(b)) };
      let any = 0;
      UNIT_TYPES.forEach(([t]) => {
        const a = ((raw.aff || {})[t] || {})[b] || {};
        tr.units[t] = N(a.u); any += N(a.u); units[t] += N(a.u);
        if (N(a.r) > 0) tr.rents[t] = N(a.r);
      });
      if (any > 0) tiers.push(tr);
    });
  }
  const rawNet = UNIT_TYPES.reduce((s, [t]) => s + UNIT_SF[t] * units[t], 0);
  const f = oldNet > 0 && rawNet > 0 ? oldNet / rawNet : 1;
  m.mix = typeMap((t) => ({ sf: Math.round(UNIT_SF[t] * f), units: units[t], rent: rents[t] }));
  m.tiers = tiers.length ? tiers : [newTier(60)];
  m.gsfOverride = N(raw.actualBuildingSF);           // keeps the old cost basis exactly
  m.retailSF = commSF; m.retailPSF = commSF > 0 ? Math.round(commGross / commSF) : 50; m.retailExpPct = 0;
  m.opexPerUnit = 0; m.mgmtPct = N(raw.opexPct);      // v1 opex was a % of EGI
  m.cTaxesYr = 0; m.cInsurancePct = 0;                // v1 had no construction taxes / insurance
  m.hardContingencyPct = N(raw.hardContingencyPct);
  const P = PROGRAMS[raw.program] || PROGRAMS.market;
  m.affMode = P.mode; m.affReqPct = P.pct;
  m.structure = "sale"; m.keyMoney = 0; m.groundRentYr = 0;
  delete m.mkt; delete m.aff; delete m.comm;
  return m;
}

/* ---------- prefill a model from a Deal Desk deal ---------- */
function modelFromDeal(deal) {
  const m = blankModel(deal.borough || "");
  const district = resolveDistrict(deal.zone) || "";
  const uapPath = deal.devPath === "uap";
  m.dealId = deal.id;
  m.dealName = deal.address || "Untitled Site";
  m.marketArea = [deal.neighborhood, deal.borough].filter(Boolean).join(", ");
  m.district = district;
  m.street = deal.streetWidth === "wide" ? "wide" : "narrow";
  m.devPath = uapPath ? "uap" : "aor";
  m.lotSF = N(deal.lotArea) || 0;
  m.purchasePrice = N(deal.askingPrice) || 0;
  m.cTaxesYr = Math.round(m.purchasePrice * 0.01);
  const v = district ? farFor(district, m.street) : null;
  if (v) {
    m.far = v.aor;
    m.bonusFar = uapPath && v.uap ? v.uap : 0;
    if (uapPath) { m.program = "uap"; m.affMode = "uap"; }
  } else if (deal.customFar) {
    m.far = N(deal.customFar);
  }
  const target = N(deal.buildableSf) > 0 ? N(deal.buildableSf) : m.lotSF * (N(m.bonusFar) > 0 ? N(m.bonusFar) : N(m.far));
  if (N(deal.buildableSf) > 0 && m.lotSF > 0) {           // his own buildable number wins
    const f = Math.round(N(deal.buildableSf) / m.lotSF * 100) / 100;
    if (uapPath && v) m.bonusFar = f; else { m.far = f; m.bonusFar = 0; }
  }
  return fitMix(m, target);
}

/* scale the unit counts so resi gross + retail ≈ the target buildable SF */
function fitMix(m, targetBSF) {
  const target = N(targetBSF) - N(m.retailSF);
  if (target <= 0) return m;
  const mix = { ...m.mix };
  let net = UNIT_TYPES.reduce((s, [t]) => s + N(mix[t].sf) * N(mix[t].units), 0);
  if (net <= 0) {
    const d = { studio: 4, "1br": 12, "2br": 7, "3br": 2 };
    UNIT_TYPES.forEach(([t]) => { mix[t] = { ...mix[t], units: d[t], sf: N(mix[t].sf) || UNIT_SF[t] }; });
    net = UNIT_TYPES.reduce((s, [t]) => s + N(mix[t].sf) * N(mix[t].units), 0);
  }
  const goalNet = target / (1 + N(m.addonPct) / 100);
  const f = goalNet / net;
  UNIT_TYPES.forEach(([t]) => { mix[t] = { ...mix[t], units: Math.max(0, Math.floor(N(mix[t].units) * f)) }; });
  // top up one unit at a time (largest type that still fits) without going over the envelope
  const netOf = () => UNIT_TYPES.reduce((s, [t]) => s + N(mix[t].sf) * N(mix[t].units), 0);
  for (let g = 0; g < 200; g++) {
    const room = goalNet - netOf();
    const fit = UNIT_TYPES.map(([t]) => t).filter((t) => N(mix[t].sf) > 0 && N(mix[t].sf) <= room);
    if (!fit.length) break;
    const t = fit.reduce((best, x) => (N(mix[x].units) * N(mix[best].sf) < N(mix[best].units) * N(mix[x].sf) ? x : best), fit[0]);
    mix[t] = { ...mix[t], units: N(mix[t].units) + 1 };
  }
  return { ...m, mix };
}

/* ---------- affordable units needed to meet the requirement (fills tier 1) ---------- */
function autoAffordable(m) {
  const c = runCalc(m);
  const tiers = m.tiers.map((t) => ({ ...t, units: { ...t.units } }));
  const t0 = tiers[0];
  const others = (t) => tiers.slice(1).reduce((s, x) => s + N(x.units[t]), 0);
  UNIT_TYPES.forEach(([t]) => { t0.units[t] = 0; });
  const need = () => {
    const cc = runCalc({ ...m, tiers });
    return c.affMode === "units" ? cc.affReqUnits - cc.affUnits : cc.affReqSF - cc.affSF;
  };
  if (c.affMode === "none") return { ...m, tiers };
  // proportional first pass (keeps the bedroom mix proportional), then top up
  const share = c.affMode === "units"
    ? (c.totalUnits > 0 ? c.affReqUnits / c.totalUnits : 0)
    : (c.resiNetSF > 0 ? c.affReqSF / c.resiNetSF : 0);
  UNIT_TYPES.forEach(([t]) => {
    const room = Math.max(0, N(m.mix[t].units) - others(t));
    t0.units[t] = Math.min(room, Math.floor(N(m.mix[t].units) * share));
  });
  for (let guard = 0; guard < 400 && need() > 0; guard++) {
    // add one unit to the type with the lowest affordable share (keeps the bedroom mix proportional)
    let best = null, bestShare = Infinity;
    UNIT_TYPES.forEach(([t]) => {
      const u = N(m.mix[t].units), room = u - others(t) - t0.units[t];
      const sh = u > 0 ? (others(t) + t0.units[t] + 1) / u : Infinity;
      if (room > 0 && sh < bestShare) { bestShare = sh; best = t; }
    });
    if (!best) break;
    t0.units[best] += 1;
  }
  return { ...m, tiers };
}

const pmtYr = (loan, ratePct, years) => {
  const r = N(ratePct) / 100 / 12, n = N(years) * 12;
  if (loan <= 0 || n <= 0) return 0;
  if (r === 0) return loan / n * 12;
  return loan * r / (1 - Math.pow(1 + r, -n)) * 12;
};

/* ---------- the model math (one set of numbers for screen + report) ---------- */
function runCalc(m) {
  const lease = m.structure === "lease";
  const rental = m.dealType !== "condo";
  const lotSF = N(m.lotSF);
  const baseFAR = N(m.far);
  const effFAR = N(m.bonusFar) > 0 ? N(m.bonusFar) : baseFAR;
  const baseBSF = lotSF * baseFAR;
  const zoningBSF = lotSF * effFAR;
  const bonusBSF = Math.max(0, zoningBSF - baseBSF);
  const airSF = N(m.airRightsSF);
  const totalBSF = zoningBSF + airSF;
  const rawFactor = totalBSF / 680;
  const maxUnitsByZoning = Math.floor(rawFactor) + (rawFactor - Math.floor(rawFactor) >= 0.75 ? 1 : 0);

  // unit mix + affordable tiers
  const tiers = Array.isArray(m.tiers) ? m.tiers : [];
  const rows = UNIT_TYPES.map(([t, label]) => {
    const x = (m.mix || {})[t] || {};
    const sf = N(x.sf), units = N(x.units), rent = N(x.rent);
    let affU = 0, affRentM = 0, lostM = 0;
    const parts = [];
    const ua = N((m.utilAllow || {})[t]);   // utility allowance: max gross rent − allowance = rent collected
    tiers.forEach((tr) => {
      const u = N(tr.units?.[t]), r = N(tr.rents?.[t]), net = r - ua;
      if (u > 0) { affU += u; affRentM += u * net; lostM += u * (rent - net); parts.push({ u, r, net, ua, ami: N(tr.ami) }); }
    });
    const mktU = Math.max(0, units - affU);
    return { type: t, label, sf, units, rent, affU, mktU, parts, over: affU > units,
      netSF: sf * units, affSF: sf * Math.min(affU, units), mktSF: sf * mktU, mktRentM: mktU * rent, affRentM, lostM };
  });
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const totalUnits = sum("units"), affUnits = sum("affU"), marketUnits = sum("mktU");
  const resiNetSF = sum("netSF"), affSF = sum("affSF"), mktSF = sum("mktSF");
  const addon = N(m.addonPct) / 100;
  const resiGSF = resiNetSF * (1 + addon);
  const retailSF = N(m.retailSF);
  const zfaUsed = resiGSF + retailSF;
  const computedGSF = zfaUsed + N(m.otherGSF);
  const GSF = N(m.gsfOverride) > 0 ? N(m.gsfOverride) : computedGSF;
  const bsfLeft = totalBSF - zfaUsed;
  const overAlloc = rows.some((r) => r.over);

  // affordable requirement
  const affMode = m.affMode || "none";
  let affReqSF = 0, affReqUnits = 0;
  if (affMode === "sf") affReqSF = resiNetSF * N(m.affReqPct) / 100;
  if (affMode === "uap") affReqSF = (1 + addon) > 0 ? bonusBSF / (1 + addon) : 0;   // bonus floor area, on a net basis
  if (affMode === "units") { affReqUnits = Math.ceil(totalUnits * N(m.affReqPct) / 100 - 1e-9); affReqSF = totalUnits > 0 ? resiNetSF * affReqUnits / totalUnits : 0; }
  const affSurplusSF = affSF - affReqSF;
  const affSurplusUnits = affUnits - affReqUnits;
  const affMet = affMode === "none" ? true : affMode === "units" ? affSurplusUnits >= 0 : affSurplusSF >= -0.5;
  const affAvgAmi = affUnits > 0 ? tiers.reduce((s, tr) => s + UNIT_TYPES.reduce((a, [t]) => a + N(tr.units?.[t]), 0) * N(tr.ami), 0) / affUnits : 0;

  // income
  const mktResiM = sum("mktRentM"), affResiM = sum("affRentM"), resiM = mktResiM + affResiM;
  const lostM = sum("lostM");
  const retailYr = retailSF * N(m.retailPSF);
  const parkingM = N(m.parkingSpaces) * N(m.parkingRent);
  const otherYr = N(m.otherIncomeYr);
  const resiYr = resiM * 12;
  const GPI = resiYr + parkingM * 12 + otherYr + retailYr;
  const resiVac = (resiYr + parkingM * 12 + otherYr) * N(m.vacancyPct) / 100;
  const retailVac = retailYr * N(m.commVacancyPct) / 100;
  const vacancy = resiVac + retailVac;
  const EGI = GPI - vacancy;
  const exResi = N(m.opexPerUnit) * totalUnits;
  const exMgmt = EGI * N(m.mgmtPct) / 100;
  const exRetail = retailYr * N(m.retailExpPct) / 100;
  const exTax = N(m.propertyTaxAnnual);
  const exGround = lease ? N(m.groundRentYr) : 0;
  const opexTotal = exResi + exMgmt + exRetail + exTax + exGround;
  const NOI = EGI - opexTotal;

  // cost
  const price = lease ? N(m.keyMoney) : N(m.purchasePrice);
  const closing = price * N(m.closingCostPct) / 100;
  const airCost = airSF * N(m.airRightsPSF);
  const otherAcq = N(m.otherAcqCosts);
  const totalAcq = price + closing + otherAcq + airCost;
  const hardBase = GSF * N(m.hardCostPerBSF);
  const contingency = hardBase * N(m.hardContingencyPct) / 100;
  const totalHard = hardBase + contingency;
  const totalSoft = totalHard * N(m.softCostPct) / 100;
  const months = N(m.constructionMonths);
  const constrLoan = N(m.ltcPct) / 100 * (totalAcq + totalHard + totalSoft);
  const cInterest = constrLoan * N(m.interestRatePct) / 100 * (months / 12) * N(m.avgOutstandingPct) / 100;
  const cFees = constrLoan * N(m.originationFeePct) / 100;
  const cTaxes = N(m.cTaxesYr) * months / 12;
  const cInsurance = totalHard * N(m.cInsurancePct) / 100;
  const cGround = lease ? N(m.groundRentYr) * Math.max(0, months - N(m.groundRentFreeMonths)) / 12 : 0;
  const totalCarry = cInterest + cFees + cTaxes + cInsurance + cGround;
  const constrSubtotal = totalHard + totalSoft + totalCarry;
  const TPC = totalAcq + constrSubtotal;
  const credits = Math.abs(N(m.creditsAmt));
  const netCost = TPC - credits;
  const TDC = TPC;   // v1 name

  const per = (x) => ({ bsf: totalBSF > 0 ? x / totalBSF : 0, gsf: GSF > 0 ? x / GSF : 0, unit: totalUnits > 0 ? x / totalUnits : 0 });

  const cap = N(m.exitCapRatePct);
  const exitValue = cap > 0 ? NOI / (cap / 100) : 0;
  const equityCreated = exitValue - netCost;
  const yieldOnCost = TPC > 0 ? NOI / TPC * 100 : 0;
  const yieldOnNet = netCost > 0 ? NOI / netCost * 100 : 0;
  const lostYr = lostM * 12;
  const lostValue = cap > 0 ? lostYr / (cap / 100) : 0;

  // permanent loan
  const permLoan = N(m.permLoanAmt) > 0 ? N(m.permLoanAmt) : netCost * N(m.permLoanPct) / 100;
  const dsAmort = pmtYr(permLoan, m.permRatePct, m.permAmortYrs);
  const dsIO = permLoan * N(m.permRatePct) / 100;
  const cfAmort = NOI - dsAmort, cfIO = NOI - dsIO;
  const dscr = dsAmort > 0 ? NOI / dsAmort : 0;
  const dscrIO = dsIO > 0 ? NOI / dsIO : 0;
  const equityIn = netCost - permLoan;
  const coc = equityIn > 0 ? cfAmort / equityIn * 100 : 0;
  const debtYield = permLoan > 0 ? NOI / permLoan * 100 : 0;
  const constant = permLoan > 0 ? dsAmort / permLoan : 0;
  const maxLoan125 = constant > 0 ? NOI / 1.25 / constant : 0;

  // condo sellout (main case for condo, "alt exit" for rental)
  const sellGross = mktSF * N(m.marketSellPSF) + affSF * N(m.affordableSellPSF);
  const sellCosts = sellGross * N(m.sellingCostPct) / 100;
  const sellNet = sellGross - sellCosts;
  const retailNOI = (retailYr - retailVac) - exRetail;
  const retailValue = N(m.commCapRate) > 0 ? retailNOI / (N(m.commCapRate) / 100) : 0;
  const condoProfit = sellNet + retailValue - netCost;
  const condoMargin = netCost > 0 ? condoProfit / netCost * 100 : 0;
  const condoMarginRev = (sellNet + retailValue) > 0 ? condoProfit / (sellNet + retailValue) * 100 : 0;

  const profit = rental ? equityCreated : condoProfit;
  const margin = netCost > 0 ? profit / netCost * 100 : 0;

  return {
    lease, rental, lotSF, baseFAR, effFAR, baseBSF, zoningBSF, bonusBSF, airSF, totalBSF, buildableSF: zoningBSF, maxUnitsByZoning,
    rows, totalUnits, affUnits, marketUnits, affordableUnits: affUnits, resiNetSF, affSF, mktSF, resiGSF, retailSF, zfaUsed, computedGSF, GSF,
    actualBuildingSF: GSF, netSF: resiNetSF, bsfLeft, overAlloc,
    affMode, affReqSF, affReqUnits, affSurplusSF, affSurplusUnits, affMet, affAvgAmi,
    mktResiM, affResiM, resiM, lostM, lostYr, lostValue, retailYr, parkingM, otherYr, resiYr, GPI, resiVac, retailVac, vacancy, EGI,
    exResi, exMgmt, exRetail, exTax, exGround, opexTotal, NOI,
    price, closing, airCost, otherAcq, totalAcq, hardBase, contingency, totalHard, totalSoft,
    constrLoan, cInterest, cFees, cTaxes, cInsurance, cGround, totalCarry, constrSubtotal, TPC, TDC, credits, netCost, per,
    cap, exitValue, equityCreated, yieldOnCost, yieldOnNet,
    permLoan, dsAmort, dsIO, cfAmort, cfIO, dscr, dscrIO, equityIn, coc, debtYield, maxLoan125,
    sellGross, sellCosts, sellNet, retailNOI, retailValue, condoProfit, condoMargin, condoMarginRev,
    profit, margin,
    avgRentUnit: totalUnits > 0 ? resiM / totalUnits : 0,
    avgMktRent: marketUnits > 0 ? mktResiM / marketUnits : 0,
    avgAffRent: affUnits > 0 ? affResiM / affUnits : 0,
    rentPSF: resiNetSF > 0 ? resiYr / resiNetSF : 0,
    mktRentPSF: mktSF > 0 ? mktResiM * 12 / mktSF : 0,
    affRentPSF: affSF > 0 ? affResiM * 12 / affSF : 0,
  };
}

/* ---------- sensitivity: hard cost $/SF × exit cap (rental) or × sellout $/SF (condo) ---------- */
function sensitivity(m) {
  const rental = m.dealType !== "condo";
  const hard = N(m.hardCostPerBSF);
  const rowsV = [-30, -15, 0, 15, 30].map((d) => Math.max(0, hard + d));
  const colsV = rental
    ? [-0.5, -0.25, 0, 0.25, 0.5].map((d) => Math.max(0.25, N(m.exitCapRatePct) + d))
    : [-0.1, -0.05, 0, 0.05, 0.1].map((d) => Math.round(N(m.marketSellPSF) * (1 + d)));
  const grid = rowsV.map((h) => colsV.map((cv) => {
    const mm = rental ? { ...m, hardCostPerBSF: h, exitCapRatePct: cv } : { ...m, hardCostPerBSF: h, marketSellPSF: cv };
    const c = runCalc(mm);
    return { profit: c.profit, yoc: c.yieldOnCost };
  }));
  return { rental, rowsV, colsV, grid };
}

/* ---------- formatting helpers ---------- */
const psf = (n) => (n == null || isNaN(n) || !isFinite(n) ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const sMoney = (n) => (n < 0 ? "-" : "") + money(Math.abs(n));
const kMoney = (n) => {
  const a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + "M";
  if (a >= 1e3) return s + "$" + Math.round(a / 1e3) + "K";
  return s + "$" + Math.round(a);
};
const x2 = (n) => (isFinite(n) && n > 0 ? n.toFixed(2) + "x" : "—");

/* ============================================================ */
function Underwriting({ initialModel, onExit, notify, userId, userName }) {
  const [m, setM] = useState(() => upgradeModel(initialModel));
  const [saved, setSaved] = useState([]);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const c = useMemo(() => runCalc(m), [m]);
  const sens = useMemo(() => sensitivity(m), [m]);

  const set = (k, v) => setM((p) => ({ ...p, [k]: v }));
  const num = (k, step = "any") => (
    <input type="number" inputMode="decimal" step={step} value={m[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
  );
  const setMix = (t, f, v) => setM((p) => ({ ...p, mix: { ...p.mix, [t]: { ...p.mix[t], [f]: v } } }));
  const setTier = (i, fn) => setM((p) => ({ ...p, tiers: p.tiers.map((x, j) => (j === i ? fn(x) : x)) }));
  const setTierU = (i, t, v) => setTier(i, (x) => ({ ...x, units: { ...x.units, [t]: v } }));
  const setTierR = (i, t, v) => setTier(i, (x) => ({ ...x, rents: { ...x.rents, [t]: v } }));
  const setTierAmi = (i, ami) => setTier(i, (x) => ({ ...x, ami: Number(ami), rents: hpdRents(Number(ami)) }));
  const addTier = () => setM((p) => (p.tiers.length >= 3 ? p : { ...p, tiers: [...p.tiers, newTier(p.tiers.some((t) => N(t.ami) === 40) ? 80 : 40)] }));
  const delTier = (i) => setM((p) => ({ ...p, tiers: p.tiers.length > 1 ? p.tiers.filter((_, j) => j !== i) : [newTier(60)] }));
  const setFloor = (i, f, v) => setM((p) => ({ ...p, floors: p.floors.map((x, j) => (j === i ? { ...x, [f]: v } : x)) }));
  const [fill, setFill] = useState({ n: 8, cov: 70, eff: 85 });

  useEffect(() => { loadList(); }, []);
  const loadList = async () => {
    const { data } = await supabase.from("models").select("id, data, owner_id, is_public").order("updated_at", { ascending: false });
    setSaved((data || []).map((r) => ({ ...r.data, isPublic: !!r.is_public, _owner: r.owner_id })));
  };
  const save = async () => {
    setBusy(true);
    const rec = { ...m, v: 2, ownerName: m.ownerName || userName, updated: new Date().toISOString().slice(0, 10) };
    delete rec._owner;
    setM(rec);
    const { error } = await supabase.from("models").upsert({
      id: rec.id, data: rec, owner_id: userId, is_public: !!rec.isPublic, updated_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) notify?.(error.message || "Save failed.");
    else { notify?.("Model saved."); loadList(); }
  };
  const del = async (id) => {
    await supabase.from("models").delete().eq("id", id);
    loadList();
    if (m.id === id) setM(blankModel());
  };

  const applyDistrict = (district, street, devPath) => {
    const v = district ? farFor(district, street) : null;
    setM((p) => ({
      ...p, district, street, devPath,
      far: v ? v.aor : p.far,
      bonusFar: v ? (devPath === "uap" ? v.uap : 0) : p.bonusFar,
    }));
  };
  const applyProgram = (prog) => {
    const P = PROGRAMS[prog];
    setM((p) => {
      let pct = P.pct;
      if (prog === "485x") pct = runCalc(p).totalUnits >= 100 ? 25 : 20;
      const tiers = p.tiers.map((t, i) => (i === 0 ? { ...t, ami: P.ami, rents: hpdRents(P.ami) } : t));
      const next = { ...p, program: prog, affMode: P.mode, affReqPct: pct, tiers };
      if (prog === "uap" && p.devPath !== "uap") {
        const v = p.district ? farFor(p.district, p.street) : null;
        next.devPath = "uap";
        if (v && v.uap) next.bonusFar = v.uap;
      }
      return next;
    });
  };
  const applyBorough = (b) => {
    const bc = costsFor(b);
    setM((p) => ({ ...p, borough: b, hardCostPerBSF: bc.hard, softCostPct: bc.soft }));
    notify?.(`${b || "Default"} costs: hard $${bc.hard}/SF, soft ${bc.soft}% of hard (editable)`);
  };

  const isSS = streetSensitive.includes(m.district);
  const rental = c.rental, lease = c.lease;
  const P = PROGRAMS[m.program] || PROGRAMS.market;
  const bc = costsFor(m.borough);
  const tierAmiOK = (m.tiers || []).every((t) => N(t.ami) <= 100);

  return (
    <div className="uw">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <div className="eyebrow">Underwriting</div>
          <h1 style={{ margin: "2px 0 8px", fontSize: 26, fontWeight: 800, letterSpacing: "-0.01em" }}>Development Site Model</h1>
          <div className="dealline">
            <span>Deal</span>
            <input value={m.dealName} onChange={(e) => set("dealName", e.target.value)} />
          </div>
          <div className="dealline">
            <span>Market</span>
            <input value={m.marketArea} onChange={(e) => set("marketArea", e.target.value)} placeholder="Mott Haven, Bronx" />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {onExit && <button className="ghost" onClick={onExit}>← Back to deal</button>}
          <button className="ghost" onClick={() => setM(blankModel())}>New</button>
          <button className="ghost" data-on={!!m.isPublic} onClick={() => set("isPublic", !m.isPublic)}>
            {m.isPublic ? "Published ✓" : "Private"}
          </button>
          <button className="ghost" onClick={() => setSheet(true)}>Report / PDF</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save model"}</button>
        </div>
      </header>

      {saved.length > 0 && (
        <div className="savedStrip">
          {saved.map((s) => (
            <span key={s.id} className="savedChip">
              <span onClick={() => setM(upgradeModel(s))}>{s.dealName}{s._owner && s._owner !== userId ? ` · ${s.ownerName || "shared"}` : ""}</span>
              {(!s._owner || s._owner === userId) && <b onClick={() => del(s.id)}>✕</b>}
            </span>
          ))}
        </div>
      )}

      <div className="segRow">
        <div>
          <div className="segLabel">Structure</div>
          <div className="seg">
            <button data-on={!lease} onClick={() => set("structure", "sale")}>Buy land</button>
            <button data-on={lease} onClick={() => set("structure", "lease")}>Ground lease</button>
          </div>
        </div>
        <div>
          <div className="segLabel">Exit</div>
          <div className="seg">
            <button data-on={rental} onClick={() => set("dealType", "rental")}>Rental hold</button>
            <button data-on={!rental} onClick={() => set("dealType", "condo")}>Condo sellout</button>
          </div>
        </div>
        <div>
          <div className="segLabel">Affordability program</div>
          <div className="seg">
            {[["market","Market"],["485x","485-x"],["uap","UAP"],["mih","MIH"]].map(([k, l]) => (
              <button key={k} data-on={m.program === k} onClick={() => applyProgram(k)}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="uwGrid">
        <div>
          <Sec n="01" t="Site & Zoning" open>
            <div className="fg2">
              <F label="Zoning district" hint="auto-fills FAR">
                <select value={m.district} onChange={(e) => applyDistrict(e.target.value, m.street, m.devPath)}>
                  <option value="">Custom / manual FAR</option>
                  {Object.keys(farDB).map((d) => <option key={d}>{d}</option>)}
                </select>
              </F>
              <F label="Borough" hint="sets cost defaults">
                <select value={m.borough || ""} onChange={(e) => applyBorough(e.target.value)}>
                  <option value="">—</option>
                  {BOROUGHS.map((b) => <option key={b}>{b}</option>)}
                </select>
              </F>
              <F label="Street type" hint={isSS ? "affects FAR here" : "no effect here"}>
                <select value={m.street} onChange={(e) => applyDistrict(m.district, e.target.value, m.devPath)} style={{ opacity: isSS ? 1 : 0.5 }}>
                  <option value="narrow">Narrow street</option>
                  <option value="wide">Wide street</option>
                </select>
              </F>
              <F label="Development path">
                <select value={m.devPath} onChange={(e) => applyDistrict(m.district, m.street, e.target.value)}>
                  <option value="aor">As-of-right</option>
                  <option value="uap">City of Yes — UAP</option>
                </select>
              </F>
              <F label="Lot size" hint="SF">{num("lotSF")}</F>
              <F label="Base FAR" hint="as-of-right">{num("far", "0.01")}</F>
              <F label="Bonus FAR" hint="UAP etc · 0 = base">{num("bonusFar", "0.01")}</F>
              <F label="Overlay / special" hint="optional">
                <input value={m.overlay} onChange={(e) => set("overlay", e.target.value)} placeholder="C2-4 overlay" />
              </F>
              <F label="Air rights / neighbor transfer" hint="BSF">{num("airRightsSF")}</F>
              <F label="Air rights price" hint="$ / BSF">{num("airRightsPSF")}</F>
            </div>
            <div className="derived">
              Lot {fmt(c.lotSF)} × FAR {c.baseFAR.toFixed(2)} = {fmt(c.baseBSF)} BSF
              {c.bonusBSF > 0 && <> + {fmt(c.bonusBSF)} bonus</>}
              {c.airSF > 0 && <> + {fmt(c.airSF)} transfer</>}
              {" "}= <b>{fmt(c.totalBSF)} total BSF</b> · zoning max ≈ {c.maxUnitsByZoning} units (680 SF factor)
            </div>
          </Sec>

          <Sec n="02" t="Unit Mix & Building" open>
            <div className="tableWrap">
              <table className="rr">
                <thead><tr><th>Type</th><th>Avg net SF</th><th>Units</th><th>Market rent / mo</th><th>Mkt · Aff</th></tr></thead>
                <tbody>
                  {UNIT_TYPES.map(([t, label]) => {
                    const r = c.rows.find((x) => x.type === t);
                    return (
                      <tr key={t}>
                        <td>{label}</td>
                        <td><input type="number" inputMode="decimal" value={m.mix[t].sf} onChange={(e) => setMix(t, "sf", e.target.value)} /></td>
                        <td><input type="number" inputMode="decimal" value={m.mix[t].units} onChange={(e) => setMix(t, "units", e.target.value)} /></td>
                        <td><input type="number" inputMode="decimal" value={m.mix[t].rent} onChange={(e) => setMix(t, "rent", e.target.value)} /></td>
                        <td className={"mono" + (r.over ? " bad" : "")}>{r.mktU} · {r.affU}</td>
                      </tr>
                    );
                  })}
                  <tr className="tot"><td>Total</td><td>{fmt(c.resiNetSF)} SF</td><td>{fmt(c.totalUnits)}</td><td>{c.totalUnits ? money(c.avgRentUnit) + " avg" : "—"}</td><td className="mono">{c.marketUnits} · {c.affUnits}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="fg2">
              <F label="Gross-up for walls / common" hint="% on net">{num("addonPct")}</F>
              <F label="Retail / commercial" hint="SF (zoning floor area)">{num("retailSF")}</F>
              <F label="Cellar / other gross" hint="SF · cost only">{num("otherGSF")}</F>
              <F label="Building GSF override" hint="0 = calculated">{num("gsfOverride")}</F>
            </div>
            <div className="derived">
              Resi net {fmt(c.resiNetSF)} SF × {(1 + N(m.addonPct) / 100).toFixed(2)} = {fmt(c.resiGSF)} gross
              {c.retailSF > 0 && <> + {fmt(c.retailSF)} retail</>} = {fmt(c.zfaUsed)} SF vs {fmt(c.totalBSF)} BSF →{" "}
              <b style={{ color: c.bsfLeft < -1 ? RED : undefined }}>
                {c.bsfLeft >= 0 ? `${fmt(c.bsfLeft)} BSF unused` : `${fmt(-c.bsfLeft)} SF over zoning`}
              </b>
              <br />Building {fmt(c.GSF)} GSF{N(m.gsfOverride) > 0 ? " (override)" : ""} drives hard cost
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button className="mini tall" onClick={() => setM((p) => fitMix(p, runCalc(p).totalBSF))}>Fit units to BSF</button>
              {N(m.gsfOverride) > 0 && <button className="mini tall" onClick={() => set("gsfOverride", 0)}>Use calculated GSF</button>}
            </div>
          </Sec>

          <Sec n="03" t={`Affordable — ${m.program === "market" ? "set-aside" : m.program.toUpperCase()}`} open>
            <div className="subnote" style={{ marginTop: 10 }}>{P.label}</div>
            <div className="fg2">
              <F label="Requirement basis">
                <select value={m.affMode} onChange={(e) => set("affMode", e.target.value)}>
                  {REQ_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </F>
              {(m.affMode === "sf" || m.affMode === "units") && <F label="Required" hint="%">{num("affReqPct", "1")}</F>}
              {m.affMode === "uap" && <F label="UAP bonus floor area" hint="from Site"><input readOnly value={fmt(c.bonusBSF) + " BSF"} /></F>}
            </div>
            {m.tiers.map((tr, i) => (
              <div key={i}>
                <div className="rrHead" style={{ marginTop: 16 }}>
                  <span>Affordable tier {i + 1}</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <select className="amiSel" value={tr.ami} onChange={(e) => setTierAmi(i, e.target.value)}>
                      {AMI_LEVELS.map((a) => <option key={a} value={a}>{a}% AMI</option>)}
                    </select>
                    {m.tiers.length > 1 && <button className="mini" onClick={() => delTier(i)}>✕</button>}
                  </span>
                </div>
                <div className="tableWrap">
                  <table className="rr">
                    <thead><tr><th>Type</th><th>Aff. units</th><th>Max gross rent</th><th>Net vs market</th></tr></thead>
                    <tbody>
                      {UNIT_TYPES.map(([t, label]) => (
                        <tr key={t}>
                          <td>{label}</td>
                          <td><input type="number" inputMode="decimal" value={tr.units[t]} onChange={(e) => setTierU(i, t, e.target.value)} /></td>
                          <td><input type="number" inputMode="decimal" value={tr.rents[t]} onChange={(e) => setTierR(i, t, e.target.value)} /></td>
                          <td className="mono">{N(m.mix[t].rent) ? "-" + money(N(m.mix[t].rent) - N(tr.rents[t]) + N(m.utilAllow?.[t])) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <div className="rrHead" style={{ marginTop: 14 }}><span>Utility allowance</span><em>$ / mo, subtracted from gross rent · 0 = tenant pays none</em></div>
            <div className="tableWrap">
              <table className="rr">
                <thead><tr>{UNIT_TYPES.map(([t]) => <th key={t}>{UT_SHORT[t]}</th>)}</tr></thead>
                <tbody><tr>{UNIT_TYPES.map(([t]) => (
                  <td key={t}><input type="number" inputMode="decimal" value={m.utilAllow?.[t] ?? 0} onChange={(e) => setM((p) => ({ ...p, utilAllow: { ...p.utilAllow, [t]: e.target.value } }))} /></td>
                ))}</tr></tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {m.affMode !== "none" && <button className="mini tall" onClick={() => setM((p) => autoAffordable(p))}>Auto-fill to requirement</button>}
              {m.tiers.length < 3 && <button className="mini tall" onClick={addTier}>+ AMI tier</button>}
              <button className="mini tall" onClick={() => setM((p) => ({ ...p, tiers: p.tiers.map((t) => ({ ...t, rents: hpdRents(N(t.ami)) })) }))}>Reset rents to HPD</button>
            </div>
            <div className="subnote">Rents default to {HPD_RENT_SRC}. Edit any rent to match the term sheet.</div>
            <div className="chk">
              <div><span>Required</span><b>{m.affMode === "none" ? "—" : m.affMode === "units" ? `${c.affReqUnits} units` : `${fmt(c.affReqSF)} SF`}</b>
                <em>{m.affMode === "units" ? `≈ ${fmt(c.affReqSF)} SF` : m.affMode === "none" ? "no set-aside" : `${c.resiNetSF ? pct(c.affReqSF / c.resiNetSF * 100) : "—"} of resi net SF`}</em></div>
              <div><span>Provided</span><b>{fmt(c.affSF)} SF</b><em>{c.affUnits} units · {c.totalUnits ? pct(c.affUnits / c.totalUnits * 100) : "—"} of units</em></div>
              <div className={c.affMet ? "ok" : "no"}><span>{c.affMet ? "Surplus" : "Shortfall"}</span>
                <b>{m.affMode === "units" ? `${c.affSurplusUnits > 0 ? "+" : ""}${c.affSurplusUnits} units` : `${c.affSurplusSF > 0 ? "+" : ""}${fmt(c.affSurplusSF)} SF`}</b>
                <em>{m.affMode === "none" ? "" : c.affMet ? "requirement met" : "add affordable units"}</em></div>
              <div><span>Weighted avg AMI</span><b>{c.affUnits ? Math.round(c.affAvgAmi) + "%" : "—"}</b><em>{P.avg ? `program target ≤ ${P.avg}%` : "by units"}{!tierAmiOK ? " · a tier is over 100%" : ""}</em></div>
              <div><span>Revenue given up</span><b>{money(c.lostM)}/mo</b><em>{money(c.lostYr)}/yr vs all-market</em></div>
              <div><span>Value given up</span><b>{kMoney(c.lostValue)}</b><em>@ {N(m.exitCapRatePct).toFixed(2)}% cap</em></div>
            </div>
            {c.overAlloc && <div className="warn">More affordable units than total units for a type — fix the unit mix.</div>}
          </Sec>

          <Sec n="04" t={lease ? "Acquisition — Ground Lease" : "Acquisition — Land Purchase"} open>
            <div className="fg2">
              {lease ? (
                <>
                  <F label="Key money" hint="$ upfront">{num("keyMoney")}</F>
                  <F label="Ground rent" hint="$ / yr (expense)">{num("groundRentYr")}</F>
                  <F label="Free rent in construction" hint="months">{num("groundRentFreeMonths")}</F>
                </>
              ) : (
                <F label="Purchase price" hint="$">{num("purchasePrice")}</F>
              )}
              <F label="Closing costs" hint={`% of ${lease ? "key money" : "price"}`}>{num("closingCostPct", "0.1")}</F>
              <F label="Other acquisition costs" hint="$">{num("otherAcqCosts")}</F>
              <F label="Credits / grants" hint="$ — reduces basis">{num("creditsAmt")}</F>
              <F label="Credit label">
                <input value={m.creditsLabel || ""} onChange={(e) => set("creditsLabel", e.target.value)} placeholder="Brownfield / other credits" />
              </F>
            </div>
            <div className="derived">
              Acquisition {money(c.totalAcq)} · {psf(c.per(c.totalAcq).bsf)}/BSF{c.totalUnits ? ` · ${money(c.per(c.totalAcq).unit)}/unit` : ""}
              {lease && N(m.groundRentYr) > 0 && <><br />Ground rent {money(m.groundRentYr)}/yr · {psf(N(m.groundRentYr) / (c.totalBSF || 1))}/BSF/yr</>}
            </div>
          </Sec>

          <Sec n="05" t="Hard, Soft & Carrying Costs" open>
            <div className="fg2">
              <F label="Hard cost" hint={`$/gross SF · ${m.borough || "default"} $${bc.hard}`}>{num("hardCostPerBSF")}</F>
              <F label="Soft cost" hint={`% of hard · default ${bc.soft}%`}>{num("softCostPct", "0.5")}</F>
              <F label="Hard contingency" hint="% on top">{num("hardContingencyPct", "0.5")}</F>
              <F label="Construction period" hint="months">{num("constructionMonths")}</F>
              <F label="Construction loan" hint="% LTC">{num("ltcPct")}</F>
              <F label="Construction rate" hint="%">{num("interestRatePct", "0.125")}</F>
              <F label="Avg loan drawn" hint="% over period">{num("avgOutstandingPct")}</F>
              <F label="Loan fees" hint="% of loan">{num("originationFeePct", "0.25")}</F>
              <F label="RE taxes in construction" hint="$ / yr">{num("cTaxesYr")}</F>
              <F label="Insurance (builder's risk + GL)" hint="% of hard">{num("cInsurancePct", "0.25")}</F>
            </div>
            <div className="rrHead" style={{ marginTop: 18 }}><span>Development budget</span><em>{fmt(c.totalBSF)} BSF · {fmt(c.GSF)} GSF · {c.totalUnits} units</em></div>
            <BudgetTable m={m} c={c} />
          </Sec>

          {rental ? (
            <Sec n="06" t="Income & Expenses" open>
              <div className="fg2">
                <F label="Resi vacancy" hint="%">{num("vacancyPct", "0.5")}</F>
                <F label="Retail rent" hint="$ / SF / yr">{num("retailPSF")}</F>
                <F label="Parking spaces">{num("parkingSpaces")}</F>
                <F label="Parking rent" hint="$ / mo">{num("parkingRent")}</F>
                <F label="Other income" hint="$ / yr">{num("otherIncomeYr")}</F>
                <F label="Retail vacancy" hint="%">{num("commVacancyPct", "0.5")}</F>
                <F label="Resi operating exp." hint="$ / unit / yr">{num("opexPerUnit")}</F>
                <F label="Mgmt / other" hint="% of EGI">{num("mgmtPct", "0.5")}</F>
                <F label="Retail expenses" hint="% of retail income">{num("retailExpPct", "0.5")}</F>
                <F label="RE tax (485-x / abated)" hint="$ / yr">{num("propertyTaxAnnual")}</F>
                <F label="Exit cap rate" hint="%">{num("exitCapRatePct", "0.05")}</F>
              </div>
              <div className="derived">
                Market resi {money(c.mktResiM)}/mo · affordable {money(c.affResiM)}/mo · avg {money(c.avgRentUnit)}/unit · {psf(c.rentPSF)}/net SF/yr
                <br />Gross {money(c.GPI)} − vacancy {money(c.vacancy)} − expenses {money(c.opexTotal)}{lease ? " (incl. ground rent)" : ""} = <b>NOI {money(c.NOI)}</b>
              </div>
            </Sec>
          ) : (
            <Sec n="06" t="Sellout & Retail" open>
              <div className="fg2">
                <F label="Market sellout" hint="$ / net SF">{num("marketSellPSF")}</F>
                <F label="Affordable sellout" hint="$ / net SF">{num("affordableSellPSF")}</F>
                <F label="Selling costs" hint="% commission + legal">{num("sellingCostPct", "0.5")}</F>
                <F label="Retail rent" hint="$ / SF / yr">{num("retailPSF")}</F>
                <F label="Retail vacancy" hint="%">{num("commVacancyPct", "0.5")}</F>
                <F label="Retail expenses" hint="% of retail income">{num("retailExpPct", "0.5")}</F>
                <F label="Retail cap rate" hint="values retained retail">{num("commCapRate", "0.05")}</F>
              </div>
              <div className="derived">
                Sellout {money(c.sellGross)} − costs {money(c.sellCosts)} = {money(c.sellNet)}{c.retailValue > 0 ? ` + retail ${money(c.retailValue)}` : ""}
              </div>
            </Sec>
          )}

          {rental && (
            <Sec n="07" t="Permanent Loan & Cash Flow" open>
              <div className="fg2">
                <F label="Loan" hint="% of net cost">{num("permLoanPct")}</F>
                <F label="Or loan amount" hint="$ · 0 = use %">{num("permLoanAmt")}</F>
                <F label="Rate" hint="%">{num("permRatePct", "0.125")}</F>
                <F label="Amortization" hint="years">{num("permAmortYrs")}</F>
              </div>
              <div className="tableWrap" style={{ marginTop: 14 }}>
                <table className="rr num">
                  <thead><tr><th></th><th>Debt service / yr</th><th>Cash flow</th><th>DSCR</th></tr></thead>
                  <tbody>
                    <tr><td>Amortizing</td><td>{money(c.dsAmort)}</td><td>{sMoney(c.cfAmort)}</td><td>{x2(c.dscr)}</td></tr>
                    <tr><td>Interest-only</td><td>{money(c.dsIO)}</td><td>{sMoney(c.cfIO)}</td><td>{x2(c.dscrIO)}</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="derived">
                Loan {money(c.permLoan)} · equity in {money(c.equityIn)} · cash-on-cash {pct(c.coc)} · debt yield {pct(c.debtYield)}
                <br />Max loan at 1.25x DSCR ≈ {money(c.maxLoan125)}
              </div>
            </Sec>
          )}

          {rental && (
            <Sec n="08" t="Condo Exit Check (optional)">
              <div className="fg2">
                <F label="Market sellout" hint="$ / net SF">{num("marketSellPSF")}</F>
                <F label="Affordable sellout" hint="$ / net SF">{num("affordableSellPSF")}</F>
                <F label="Selling costs" hint="%">{num("sellingCostPct", "0.5")}</F>
                <F label="Retail cap rate" hint="%">{num("commCapRate", "0.05")}</F>
              </div>
              <div className="derived">
                If sold as condos: {money(c.sellNet + c.retailValue)} net → profit <b style={{ color: c.condoProfit < 0 ? RED : undefined }}>{sMoney(c.condoProfit)}</b> ({pct(c.condoMargin)} on cost) vs rental equity created {sMoney(c.equityCreated)}
              </div>
            </Sec>
          )}

          <Sec n={rental ? "09" : "07"} t="Massing Check (optional)">
            <div className="fg2" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              <F label="Floors"><input type="number" inputMode="decimal" value={fill.n} onChange={(e) => setFill({ ...fill, n: e.target.value })} /></F>
              <F label="Coverage" hint="%"><input type="number" inputMode="decimal" value={fill.cov} onChange={(e) => setFill({ ...fill, cov: e.target.value })} /></F>
              <F label="Efficiency" hint="%"><input type="number" inputMode="decimal" value={fill.eff} onChange={(e) => setFill({ ...fill, eff: e.target.value })} /></F>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button className="mini tall" onClick={() => set("floors", Array.from({ length: Math.min(60, Math.max(0, Math.round(N(fill.n)))) }, () => ({ cov: fill.cov, eff: fill.eff })))}>Fill floors</button>
              <button className="mini tall" onClick={() => set("floors", [...(m.floors || []), { cov: fill.cov, eff: fill.eff }])}>+ Floor</button>
            </div>
            {(m.floors || []).length > 0 && (
              <MassingTable m={m} c={c} setFloor={setFloor} onDel={(i) => set("floors", m.floors.filter((_, j) => j !== i))} onReserve={(v) => set("massReserveSF", v)} />
            )}
          </Sec>

          <Sec n={rental ? "10" : "08"} t="Sensitivity" open>
            <SensTable s={sens} m={m} />
          </Sec>
        </div>

        <div className="uwSum">
          <div className="sumHead">
            <span>Summary</span>
            <span>{lease ? "LEASE" : "SALE"} · {rental ? "RENTAL" : "CONDO"} · {m.program.toUpperCase()}</span>
          </div>
          <div style={{ padding: "6px 18px 18px" }}>
            <div className="divLabel">Development cost <i>total · $/BSF</i></div>
            <Row l="Hard cost" v={money(c.totalHard)} s={psf(c.per(c.totalHard).bsf)} />
            <Row l="Soft cost" v={money(c.totalSoft)} s={psf(c.per(c.totalSoft).bsf)} />
            <Row l="Carrying cost" v={money(c.totalCarry)} s={psf(c.per(c.totalCarry).bsf)} />
            <Row l={lease ? "Key money + acq." : "Acquisition"} v={money(c.totalAcq)} s={psf(c.per(c.totalAcq).bsf)} />
            <Row l="Total project cost" v={money(c.TPC)} s={psf(c.per(c.TPC).bsf)} total />
            {c.credits > 0 && <Row l={"Less " + (m.creditsLabel || "credits")} v={"-" + money(c.credits)} />}
            {c.credits > 0 && <Row l="Net cost (basis)" v={money(c.netCost)} s={psf(c.per(c.netCost).bsf)} total />}
            <div className="divLabel">{rental ? "Stabilized" : "Sellout"}</div>
            {rental ? (
              <>
                <Row l="Effective gross income" v={money(c.EGI)} />
                <Row l="Expenses" v={money(c.opexTotal)} />
                <Row l="Net operating income" v={money(c.NOI)} />
                <Row l={`Value @ ${N(m.exitCapRatePct).toFixed(2)}% cap`} v={money(c.exitValue)} total />
              </>
            ) : (
              <>
                <Row l="Gross sellout" v={money(c.sellGross)} />
                <Row l="Net sellout + retail" v={money(c.sellNet + c.retailValue)} total />
              </>
            )}
            <div className={"profit" + (c.profit < 0 ? " neg" : "")}>
              <div className="pl">{rental ? "Equity created" : "Projected profit"}</div>
              <div className="pv">{sMoney(c.profit)}</div>
            </div>
            <div className="mcards">
              {rental ? (
                <>
                  <MC l="Yield on cost" v={pct(c.yieldOnCost)} good={c.yieldOnCost >= N(m.exitCapRatePct)} />
                  <MC l={c.credits > 0 ? "Yield on net cost" : "Margin on cost"} v={pct(c.credits > 0 ? c.yieldOnNet : c.margin)} />
                  <MC l="DSCR (amort.)" v={x2(c.dscr)} good={c.dscr >= 1.25} />
                  <MC l="Cash-on-cash" v={pct(c.coc)} />
                </>
              ) : (
                <>
                  <MC l="Margin on cost" v={pct(c.condoMargin)} good={c.condoMargin >= 0} />
                  <MC l="Margin on revenue" v={pct(c.condoMarginRev)} />
                </>
              )}
              <MC l="All-in / BSF" v={psf(c.per(c.netCost).bsf)} />
              <MC l="All-in / unit" v={c.totalUnits > 0 ? kMoney(c.per(c.netCost).unit) : "—"} />
              <MC l="Affordable" v={m.affMode === "none" ? "None" : c.affMet ? "Met ✓" : "Short"} good={m.affMode === "none" ? undefined : c.affMet} />
              <MC l="Units" v={`${c.marketUnits}+${c.affUnits}`} />
            </div>
          </div>
        </div>
      </div>

      <div className="foot">Editable defaults, not advice — verify 485-x / UAP / MIH rules, HPD rents and costs before circulating.</div>
      {sheet && <ClientSheet m={m} c={c} sens={sens} onClose={() => setSheet(false)} />}
    </div>
  );
}

/* ---------- shared tables (screen + report) ---------- */
function budgetRows(m, c) {
  const L = c.lease;
  return [
    { l: `Hard cost — ${fmt(c.GSF)} GSF × $${fmt(N(m.hardCostPerBSF))}`, v: c.hardBase, sub: true, hide: !c.contingency },
    { l: `Contingency (${N(m.hardContingencyPct)}%)`, v: c.contingency, sub: true, hide: !c.contingency },
    { l: c.contingency ? "Hard cost" : `Hard cost (${fmt(c.GSF)} GSF × $${fmt(N(m.hardCostPerBSF))})`, v: c.totalHard, k: "head" },
    { l: `Soft cost (${N(m.softCostPct)}% of hard)`, v: c.totalSoft, k: "head" },
    { l: `Interest — ${N(m.interestRatePct)}% on ${money(c.constrLoan)} loan, ${N(m.constructionMonths)} mo, ${N(m.avgOutstandingPct)}% avg drawn`, v: c.cInterest, sub: true },
    { l: `Loan fees (${N(m.originationFeePct)}%)`, v: c.cFees, sub: true, hide: !c.cFees },
    { l: `RE taxes during construction (${N(m.constructionMonths)} mo)`, v: c.cTaxes, sub: true },
    { l: `Insurance (${N(m.cInsurancePct)}% of hard)`, v: c.cInsurance, sub: true },
    { l: `Ground rent during construction`, v: c.cGround, sub: true, hide: !L },
    { l: "Carrying cost", v: c.totalCarry, k: "head" },
    { l: "Construction subtotal (hard + soft + carrying)", v: c.constrSubtotal, k: "sub2" },
    { l: L ? "Key money" : "Land purchase", v: c.price, sub: true },
    { l: `Closing costs (${N(m.closingCostPct)}%)`, v: c.closing, sub: true, hide: !c.closing },
    { l: "Other acquisition costs", v: c.otherAcq, sub: true, hide: !c.otherAcq },
    { l: `Air rights (${fmt(c.airSF)} SF × $${fmt(N(m.airRightsPSF))})`, v: c.airCost, sub: true, hide: !c.airCost },
    { l: L ? "Acquisition (ground lease)" : "Acquisition", v: c.totalAcq, k: "head" },
    { l: "TOTAL PROJECT COST", v: c.TPC, k: "tot" },
    { l: "Less: " + (m.creditsLabel || "credits"), v: -c.credits, k: "head", hide: !c.credits },
    { l: "NET PROJECT COST (basis)", v: c.netCost, k: "tot", hide: !c.credits },
  ].filter((r) => !r.hide);
}
function BudgetTable({ m, c, sheet }) {
  const rows = budgetRows(m, c);
  return (
    <div className={sheet ? "shWrap" : "tableWrap"}>
      <table className={(sheet ? "shTable bud" : "rr bud")}>
        <thead><tr><th>Line</th><th>Total</th><th>$/BSF</th><th>$/GSF</th><th>Per unit</th><th>%</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const p = c.per(r.v);
            return (
              <tr key={i} className={r.sub ? "sub" : r.k || ""}>
                <td>{r.l}</td>
                <td>{sMoney(r.v)}</td>
                <td>{r.sub ? "" : psf(p.bsf)}</td>
                <td>{r.sub ? "" : psf(p.gsf)}</td>
                <td>{r.sub || !c.totalUnits ? "" : psf(p.unit)}</td>
                <td>{r.sub || !c.TPC ? "" : pct(r.v / c.TPC * 100)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function MassingTable({ m, c, setFloor, onDel, onReserve }) {
  const lot = c.lotSF;
  let gross = 0, net = 0;
  const rows = (m.floors || []).map((f) => { const plate = lot * N(f.cov) / 100; const n = plate * N(f.eff) / 100; gross += plate; net += n; return { plate, n }; });
  const resiNet = net - N(m.massReserveSF);
  return (
    <>
      <div className="tableWrap" style={{ marginTop: 12 }}>
        <table className="rr">
          <thead><tr><th>Floor</th><th>Coverage %</th><th>Plate SF</th><th>Eff. %</th><th>Net SF</th><th></th></tr></thead>
          <tbody>
            {(m.floors || []).map((f, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><input type="number" inputMode="decimal" value={f.cov} onChange={(e) => setFloor(i, "cov", e.target.value)} /></td>
                <td className="mono">{fmt(rows[i].plate)}</td>
                <td><input type="number" inputMode="decimal" value={f.eff} onChange={(e) => setFloor(i, "eff", e.target.value)} /></td>
                <td className="mono">{fmt(rows[i].n)}</td>
                <td><button className="mini" onClick={() => onDel(i)}>✕</button></td>
              </tr>
            ))}
            <tr className="tot"><td>Total</td><td></td><td className="mono">{fmt(gross)}</td><td></td><td className="mono">{fmt(net)}</td><td></td></tr>
          </tbody>
        </table>
      </div>
      <div className="fg2"><F label="Reserve (bulkhead, amenities)" hint="net SF"><input type="number" inputMode="decimal" value={m.massReserveSF} onChange={(e) => onReserve(e.target.value)} /></F></div>
      <div className="derived">
        Massing {fmt(gross)} SF vs {fmt(c.totalBSF)} BSF → <b style={{ color: gross - c.totalBSF > 1 ? RED : undefined }}>{gross <= c.totalBSF ? `${fmt(c.totalBSF - gross)} under` : `${fmt(gross - c.totalBSF)} over`}</b>
        <br />Net {fmt(net)} − reserve {fmt(N(m.massReserveSF))} = {fmt(resiNet)} SF vs unit mix {fmt(c.resiNetSF)} SF
      </div>
    </>
  );
}
function SensTable({ s, m, sheet }) {
  const base = (i, j) => i === 2 && j === 2;
  return (
    <>
      <div className={sheet ? "" : "subnote"} style={sheet ? { fontSize: 12, color: "#6a6558", marginBottom: 8 } : { marginTop: 10 }}>
        {s.rental ? "Equity created (value − net cost) by hard cost $/GSF (rows) × exit cap rate (columns); yield on cost under each." : "Profit by hard cost $/GSF (rows) × market sellout $/SF (columns)."}
      </div>
      <div className={sheet ? "shWrap" : "tableWrap"} style={{ marginTop: 8 }}>
        <table className={(sheet ? "shTable" : "rr") + " sens"}>
          <thead><tr><th>Hard \ {s.rental ? "Cap" : "$/SF"}</th>{s.colsV.map((v, j) => <th key={j}>{s.rental ? v.toFixed(2) + "%" : "$" + fmt(v)}</th>)}</tr></thead>
          <tbody>
            {s.rowsV.map((h, i) => (
              <tr key={i}>
                <td>${fmt(h)}</td>
                {s.grid[i].map((g, j) => (
                  <td key={j} className={(g.profit < 0 ? "neg" : "pos") + (base(i, j) ? " base" : "")}>
                    {kMoney(g.profit)}{s.rental && <small>{pct(g.yoc)}</small>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------- little pieces ---------- */
function Sec({ n, t, open, children }) {
  const [o, setO] = useState(!!open);
  return (
    <div className="sec">
      <div className="secHead" onClick={() => setO(!o)}>
        <span className="secNum">{n}</span>
        <span className="secTitle">{t}</span>
        <span className="secChev" style={{ transform: o ? "rotate(90deg)" : "none" }}>▸</span>
      </div>
      {o && <div className="secBody">{children}</div>}
    </div>
  );
}
function F({ label, hint, children }) {
  return (
    <div className="uwField">
      <label>{label}{hint && <em>{hint}</em>}</label>
      {children}
    </div>
  );
}
function Row({ l, v, s, total }) {
  return <div className={"ledger" + (total ? " total" : "")}><span>{l}</span><b>{v}{s && <small>{s}</small>}</b></div>;
}
function MC({ l, v, good }) {
  return (
    <div className="mcard">
      <div className="ml">{l}</div>
      <div className="mv" data-good={good === undefined ? undefined : good}>{v}</div>
    </div>
  );
}

/* ---------- report sheet (screen → Print / Save as PDF) ---------- */
function ClientSheet({ m, c, sens, onClose }) {
  const rental = c.rental, lease = c.lease;
  const P = PROGRAMS[m.program] || PROGRAMS.market;
  const zdLabel = m.district
    ? m.district + (streetSensitive.includes(m.district) ? ` — ${m.street === "wide" ? "Wide street" : "Narrow street"}` : "")
    : "—";
  const openClean = () => {
    const html = document.getElementById("uw-sheet")?.outerHTML || "";
    const css = document.getElementById("jrg-styles")?.textContent || "";
    const w = window.open("", "_blank");
    if (w) {
      w.document.open();
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${m.dealName}</title><style>${css}
body{background:#f2efe6;margin:0;padding:24px;}
#uw-sheet{box-shadow:none;margin:0 auto;max-width:860px}</style></head><body>${html}</body></html>`);
      w.document.close();
    }
  };
  const IR = ({ l, mo, yr, neg, b }) => (
    <tr className={b ? "tot" : ""}><td>{l}</td><td>{mo == null ? "" : sMoney(neg ? -mo : mo)}</td><td>{sMoney(neg ? -yr : yr)}</td></tr>
  );
  const affRows = c.rows.filter((r) => r.parts.length);
  useEffect(() => { document.body.classList.add("uwPrint"); return () => document.body.classList.remove("uwPrint"); }, []);
  return createPortal(<div className="uwPortal">
    <div className="modalWrap" onClick={onClose}>
      <div style={{ width: 860, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="sheet" id="uw-sheet">
          <div className="shTop">
            <div>
              <img className="shLogo" src={LOGO_FULL} alt="JStone Realty" />
              <div className="shBrand">Development Underwriting</div>
              <div className="shTitle">{m.dealName}</div>
              <div className="shSub">
                {[m.marketArea, lease ? "Ground lease" : "Land purchase", rental ? "Rental hold" : "Condo sellout", m.program === "market" ? "Free market" : m.program.toUpperCase()].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="shDate">{new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</div>
          </div>

          <div className="shKpis">
            <div><span>Total project cost</span><b>{kMoney(c.TPC)}</b><em>{psf(c.per(c.TPC).bsf)}/BSF · {c.totalUnits ? kMoney(c.per(c.TPC).unit) + "/unit" : ""}</em></div>
            {rental ? (
              <>
                <div><span>NOI</span><b>{kMoney(c.NOI)}</b><em>yield on cost {pct(c.yieldOnCost)}</em></div>
                <div><span>Value @ {N(m.exitCapRatePct).toFixed(2)}% cap</span><b>{kMoney(c.exitValue)}</b><em>{c.totalUnits ? kMoney(c.exitValue / c.totalUnits) + "/unit" : ""}</em></div>
                <div><span>Equity created</span><b className={c.equityCreated < 0 ? "neg" : ""}>{kMoney(c.equityCreated)}</b><em>{pct(c.margin)} on {c.credits ? "net " : ""}cost</em></div>
              </>
            ) : (
              <>
                <div><span>Net sellout</span><b>{kMoney(c.sellNet + c.retailValue)}</b><em>{psf(N(m.marketSellPSF))}/SF market</em></div>
                <div><span>Profit</span><b className={c.condoProfit < 0 ? "neg" : ""}>{kMoney(c.condoProfit)}</b><em>{pct(c.condoMargin)} on cost</em></div>
              </>
            )}
          </div>

          <div className="shSec">
            <div className="shH">Site & Zoning</div>
            <div className="shGrid">
              <SR l="Zoning district" v={zdLabel} />
              <SR l="Development path" v={m.devPath === "uap" ? "City of Yes — UAP" : "As-of-right"} />
              {m.overlay && <SR l="Overlay" v={m.overlay} />}
              {m.borough && <SR l="Borough" v={m.borough} />}
              <SR l="Lot size" v={fmt(c.lotSF) + " SF"} />
              <SR l="FAR (base / with bonus)" v={c.baseFAR.toFixed(2) + " / " + c.effFAR.toFixed(2)} />
              <SR l="Base BSF" v={fmt(c.baseBSF)} />
              {c.bonusBSF > 0 && <SR l="Bonus BSF" v={fmt(c.bonusBSF)} />}
              {c.airSF > 0 && <SR l="Air rights / transfer" v={fmt(c.airSF) + " SF"} />}
              <SR l="Total BSF" v={fmt(c.totalBSF)} />
              <SR l="Resi net SF" v={fmt(c.resiNetSF)} />
              <SR l={`Resi gross (+${N(m.addonPct)}%)`} v={fmt(c.resiGSF)} />
              {c.retailSF > 0 && <SR l="Retail SF" v={fmt(c.retailSF)} />}
              <SR l="Building GSF (cost basis)" v={fmt(c.GSF)} />
              <SR l="BSF used / unused" v={c.bsfLeft >= 0 ? `${fmt(c.zfaUsed)} / ${fmt(c.bsfLeft)}` : `${fmt(-c.bsfLeft)} SF over`} />
              <SR l="Units (market + affordable)" v={`${c.totalUnits} (${c.marketUnits} + ${c.affUnits})`} />
            </div>
          </div>

          <div className="shSec">
            <div className="shH">Unit Mix & Rents</div>
            <div className="shWrap">
              <table className="shTable">
                <thead><tr><th>Type</th><th>Avg SF</th><th>Units</th><th>Market</th><th>Affordable</th><th>Net SF</th></tr></thead>
                <tbody>
                  {c.rows.filter((r) => r.units > 0).map((r) => (
                    <tr key={r.type}>
                      <td>{r.label}</td><td>{fmt(r.sf)}</td><td>{r.units}</td>
                      <td>{r.mktU > 0 ? `${r.mktU} @ ${money(r.rent)}` : "—"}</td>
                      <td>{r.parts.map((p) => `${p.u} @ ${money(p.net)} (${p.ami}%)`).join(" · ") || "—"}</td>
                      <td>{fmt(r.netSF)}</td>
                    </tr>
                  ))}
                  <tr className="tot"><td>Total</td><td>{c.totalUnits ? fmt(c.resiNetSF / c.totalUnits) : "—"}</td><td>{c.totalUnits}</td><td>{c.marketUnits} · avg {money(c.avgMktRent)}</td><td>{c.affUnits} · avg {money(c.avgAffRent)}</td><td>{fmt(c.resiNetSF)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="shSec">
            <div className="shH">Affordable Set-Aside — {m.program === "market" ? "none" : m.program.toUpperCase()}</div>
            <div className="shNote">{P.label}</div>
            <div className="shGrid">
              <SR l="Requirement" v={m.affMode === "none" ? "None" : m.affMode === "units" ? `${N(m.affReqPct)}% of units = ${c.affReqUnits} units` : m.affMode === "uap" ? `UAP bonus ${fmt(c.bonusBSF)} BSF ≈ ${fmt(c.affReqSF)} net SF` : `${N(m.affReqPct)}% of resi = ${fmt(c.affReqSF)} SF`} />
              <SR l="Provided" v={`${fmt(c.affSF)} SF · ${c.affUnits} units (${c.totalUnits ? pct(c.affUnits / c.totalUnits * 100) : "—"})`} />
              <SR l={c.affMet ? "Surplus" : "Shortfall"} v={m.affMode === "units" ? `${c.affSurplusUnits} units` : `${fmt(c.affSurplusSF)} SF`} />
              <SR l="Weighted avg AMI" v={c.affUnits ? Math.round(c.affAvgAmi) + "%" + (P.avg ? ` (target ≤ ${P.avg}%)` : "") : "—"} />
              <SR l="Rent given up vs market" v={`${money(c.lostM)}/mo · ${money(c.lostYr)}/yr`} />
              <SR l={`Value given up @ ${N(m.exitCapRatePct).toFixed(2)}% cap`} v={money(c.lostValue)} />
            </div>
            {affRows.length > 0 && (
              <div className="shWrap" style={{ marginTop: 10 }}>
                <table className="shTable">
                  <thead><tr><th>Type</th><th>Units</th><th>AMI</th><th>Gross rent</th><th>Utility allow.</th><th>Net rent</th><th>Market rent</th><th>Lost / yr</th></tr></thead>
                  <tbody>
                    {affRows.flatMap((r) => r.parts.map((p, k) => (
                      <tr key={r.type + k}><td>{r.label}</td><td>{p.u}</td><td>{p.ami}%</td><td>{money(p.r)}</td><td>{p.ua ? "-" + money(p.ua) : "—"}</td><td>{money(p.net)}</td><td>{money(r.rent)}</td><td>{money(p.u * (r.rent - p.net) * 12)}</td></tr>
                    )))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="shSrc">Affordable rents: {HPD_RENT_SRC}. Net rent = gross rent − utility allowance.</div>
          </div>

          <div className="shSec">
            <div className="shH">Development Budget</div>
            <BudgetTable m={m} c={c} sheet />
            <div className="shSrc">BSF = {fmt(c.totalBSF)} buildable SF · GSF = {fmt(c.GSF)} gross building SF · {c.totalUnits} units. Hard ${fmt(N(m.hardCostPerBSF))}/GSF{m.borough ? ` (${m.borough} default $${costsFor(m.borough).hard})` : ""}; soft {N(m.softCostPct)}% of hard; construction loan {N(m.ltcPct)}% LTC at {N(m.interestRatePct)}%.</div>
          </div>

          {rental ? (
            <div className="shSec">
              <div className="shH">Stabilized Income & Expenses</div>
              <div className="shWrap">
                <table className="shTable inc">
                  <thead><tr><th>Income</th><th>Monthly</th><th>Yearly</th></tr></thead>
                  <tbody>
                    <IR l={`Market residential (${c.marketUnits} units)`} mo={c.mktResiM} yr={c.mktResiM * 12} />
                    <IR l={`Affordable residential (${c.affUnits} units)`} mo={c.affResiM} yr={c.affResiM * 12} />
                    {c.retailYr > 0 && <IR l={`Retail (${fmt(c.retailSF)} SF × $${fmt(N(m.retailPSF))})`} mo={c.retailYr / 12} yr={c.retailYr} />}
                    {c.parkingM > 0 && <IR l={`Parking (${N(m.parkingSpaces)} × $${fmt(N(m.parkingRent))}/mo)`} mo={c.parkingM} yr={c.parkingM * 12} />}
                    {c.otherYr > 0 && <IR l="Other income" mo={c.otherYr / 12} yr={c.otherYr} />}
                    <IR l="Gross potential income" mo={c.GPI / 12} yr={c.GPI} b />
                    <IR l={`Vacancy (resi ${N(m.vacancyPct)}%${c.retailYr > 0 ? `, retail ${N(m.commVacancyPct)}%` : ""})`} mo={c.vacancy / 12} yr={c.vacancy} neg />
                    <IR l="Effective gross income" mo={c.EGI / 12} yr={c.EGI} b />
                    <tr className="hd"><td colSpan={3}>Expenses</td></tr>
                    <IR l={`Residential opex ($${fmt(N(m.opexPerUnit))}/unit/yr)`} mo={c.exResi / 12} yr={c.exResi} neg />
                    {c.exMgmt > 0 && <IR l={`Management / other (${N(m.mgmtPct)}% of EGI)`} mo={c.exMgmt / 12} yr={c.exMgmt} neg />}
                    {c.exRetail > 0 && <IR l={`Retail expenses (${N(m.retailExpPct)}%)`} mo={c.exRetail / 12} yr={c.exRetail} neg />}
                    <IR l="Real estate tax (485-x / abated)" mo={c.exTax / 12} yr={c.exTax} neg />
                    {lease && <IR l="Ground lease payment" mo={c.exGround / 12} yr={c.exGround} neg />}
                    <IR l="Total expenses" mo={c.opexTotal / 12} yr={c.opexTotal} neg b />
                    <IR l="NET OPERATING INCOME" mo={c.NOI / 12} yr={c.NOI} b />
                  </tbody>
                </table>
              </div>
              <div className="shSrc">Avg rent {money(c.avgRentUnit)}/unit/mo ({psf(c.rentPSF)}/net SF/yr) · market {money(c.avgMktRent)} ({psf(c.mktRentPSF)}/SF) · affordable {money(c.avgAffRent)} ({psf(c.affRentPSF)}/SF) · expense ratio {c.EGI ? pct(c.opexTotal / c.EGI * 100) : "—"}</div>
            </div>
          ) : (
            <div className="shSec">
              <div className="shH">Sellout</div>
              <div className="shGrid">
                <SR l={`Market (${fmt(c.mktSF)} SF × $${fmt(N(m.marketSellPSF))})`} v={money(c.mktSF * N(m.marketSellPSF))} />
                <SR l={`Affordable (${fmt(c.affSF)} SF × $${fmt(N(m.affordableSellPSF))})`} v={money(c.affSF * N(m.affordableSellPSF))} />
                <SR l={`Selling costs (${N(m.sellingCostPct)}%)`} v={"-" + money(c.sellCosts)} />
                {c.retailValue > 0 && <SR l={`Retail value @ ${N(m.commCapRate)}% cap`} v={money(c.retailValue)} />}
                <SR l="Net revenue" v={money(c.sellNet + c.retailValue)} />
                <SR l="Profit / margin on cost" v={`${sMoney(c.condoProfit)} · ${pct(c.condoMargin)}`} />
              </div>
            </div>
          )}

          {rental && (
            <div className="shSec">
              <div className="shH">Returns & Debt</div>
              <div className="shGrid">
                <SR l="Yield on total cost" v={pct(c.yieldOnCost)} />
                {c.credits > 0 && <SR l="Yield on net cost (after credits)" v={pct(c.yieldOnNet)} />}
                <SR l={`Value @ ${N(m.exitCapRatePct).toFixed(2)}% cap`} v={money(c.exitValue)} />
                <SR l="Value / BSF · / unit" v={`${psf(c.per(c.exitValue).bsf)} · ${c.totalUnits ? kMoney(c.per(c.exitValue).unit) : "—"}`} />
                <SR l={c.credits > 0 ? "Net project cost" : "Total project cost"} v={money(c.netCost)} />
                <SR l="Equity created" v={sMoney(c.equityCreated)} />
                <SR l="Permanent loan" v={`${money(c.permLoan)} @ ${N(m.permRatePct)}%, ${N(m.permAmortYrs)} yr`} />
                <SR l="Equity required" v={money(c.equityIn)} />
                <SR l="Debt service (amort. / IO)" v={`${money(c.dsAmort)} / ${money(c.dsIO)}`} />
                <SR l="Cash flow after debt (amort. / IO)" v={`${sMoney(c.cfAmort)} / ${sMoney(c.cfIO)}`} />
                <SR l="DSCR (amort. / IO)" v={`${x2(c.dscr)} / ${x2(c.dscrIO)}`} />
                <SR l="Cash-on-cash · debt yield" v={`${pct(c.coc)} · ${pct(c.debtYield)}`} />
                {N(m.marketSellPSF) > 0 && <SR l={`Alt: sell as condo @ $${fmt(N(m.marketSellPSF))}/SF`} v={`${sMoney(c.condoProfit)} profit`} />}
              </div>
              <div className="shHl">
                <span>Yield on cost</span>
                <b>{pct(c.yieldOnCost)}</b>
              </div>
            </div>
          )}

          <div className="shSec">
            <div className="shH">Sensitivity</div>
            <SensTable s={sens} m={m} sheet />
          </div>

          <div className="shFoot">
            Prepared by JStone Realty. Preliminary underwriting estimates based on the assumptions stated above
            (construction {N(m.constructionMonths)} months, {N(m.avgOutstandingPct)}% average draw, RE taxes during construction ${fmt(N(m.cTaxesYr))}/yr,
            insurance {N(m.cInsurancePct)}% of hard{lease ? `, ground rent ${money(m.groundRentYr)}/yr with ${N(m.groundRentFreeMonths)} free months` : ""}).
            Subject to due diligence, final zoning analysis, program rules (485-x / UAP / MIH) and market verification.
            Not an offer or guarantee of financing, pricing, or returns.
          </div>
        </div>
        <div className="sheetActions">
          <button className="ghost" onClick={onClose}>Close</button>
          <button className="ghost" onClick={openClean}>Open clean copy</button>
          <button className="primary" onClick={() => window.print()}>Print / Save as PDF</button>
        </div>
      </div>
    </div>
  </div>, document.body);
}
function SR({ l, v }) {
  return <div className="shRow"><span>{l}</span><b>{v}</b></div>;
}

/* ============================================================
   DEAL DESK
   ============================================================ */
const initials = (n) =>
  (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

const blankDeal = () => ({
  id: uid(), address: "", borough: "Bronx", neighborhood: "", zone: "R6", photos: [],
  streetWidth: "narrow", devPath: "aor", lotArea: "", customFar: "", askingPrice: "", sellerNumber: "",
  vacancy: "TBD", existingSf: "", contactName: "", contactPhone: "", contactEmail: "", notes: "",
  followUpDate: "", followUpNotes: "", isPublic: false, stage: "New", assetType: "", buildableSf: "", lot: null, autoFilled: {},
  created: new Date().toISOString().slice(0, 10),
});
const blankBuyer = () => ({
  id: uid(), name: "", company: "", phone: "", email: "",
  boroughs: [], minSize: "", maxBudget: "", assetTypes: [], notes: "", isPublic: false,
  followUpDate: "", lastContacted: "",
});

function DealDesk({ view, notify, onUnderwrite, userId, userName, openId, onOpened }) {
  const [deals, setDeals] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [dealForm, setDealForm] = useState(null);
  const [buyerForm, setBuyerForm] = useState(null);
  const [shareFor, setShareFor] = useState(null);
  const [q, setQ] = useState("");
  const [boroFilter, setBoroFilter] = useState("All");
  const [ownFilter, setOwnFilter] = useState("All");
  const [bq, setBq] = useState("");
  const [bBoro, setBBoro] = useState("All");
  const [bTypes, setBTypes] = useState([]);
  const [bCold, setBCold] = useState(false);   // only buyers not contacted in 30+ days   // "what they buy" filter, multi-select, matches ANY
  const [importMsg, setImportMsg] = useState("");
  const [dealLayout, setDealLayout] = useState(() => localStorage.getItem("dealLayout") || "board");
  const [dragId, setDragId] = useState(null);
  const fileRef = useRef(null);
  const pickLayout = (l) => { setDealLayout(l); try { localStorage.setItem("dealLayout", l); } catch (e) {} };

  useEffect(() => {
    (async () => {
      const [d, b] = await Promise.all([
        supabase.from("deals").select("id, data, owner_id, is_public").order("updated_at", { ascending: false }),
        supabase.from("buyers").select("id, data, owner_id, is_public").order("updated_at", { ascending: false }),
      ]);
      const hydrate = (rows) => (rows || []).map((r) => ({ ...r.data, isPublic: !!r.is_public, _owner: r.owner_id }));
      setDeals(hydrate(d.data));
      setBuyers(hydrate(b.data).map((x) => ({ ...x, assetTypes: normTypes(x.assetTypes) })));
      setLoaded(true);
    })();
  }, []);

  useEffect(() => { setDealForm(null); setBuyerForm(null); }, [view]);

  // opened from Home's Today list or from a converted contact: jump straight to the record
  useEffect(() => {
    if (!loaded || !openId) return;
    if (view === "deals") { const d = deals.find((x) => x.id === openId); if (d) setDealForm({ ...d }); }
    if (view === "buyers") { const b = buyers.find((x) => x.id === openId); if (b) setBuyerForm({ ...b }); }
    onOpened?.();
  }, [loaded, openId, view]);

  const saveDeal = async () => {
    if (!dealForm.address.trim()) return;
    const rec = { ...dealForm, ownerName: dealForm.ownerName || userName };
    const exists = deals.some((d) => d.id === rec.id);
    setDeals(exists ? deals.map((d) => (d.id === rec.id ? rec : d)) : [rec, ...deals]);
    setDealForm(null);
    const { error } = await supabase.from("deals").upsert({
      id: rec.id, data: rec, owner_id: rec._owner || userId, is_public: !!rec.isPublic, updated_at: new Date().toISOString(),
    });
    if (error) return notify?.(error.message || "Save failed.");
    const base = rec.isPublic ? "Deal saved and published to the team." : "Deal saved — visible only to you.";
    const c = await autoContact(sellerFromDeal(rec), userId);
    notify?.(base + contactNote(c, rec.contactName || "Seller"));
  };
  // stage change from the board (dropdown or drag) saves right away
  const setStage = async (d, stage) => {
    if (stageOf(d) === stage) return;
    const mine = !d._owner || d._owner === userId;
    if (!mine) return notify?.("Only the person who added this deal can move it.");
    const rec = { ...d, stage };
    setDeals(deals.map((x) => (x.id === d.id ? rec : x)));
    const { error } = await supabase.from("deals").update({ data: rec, updated_at: new Date().toISOString() }).eq("id", d.id);
    notify?.(error ? (error.message || "Couldn't move the deal.") : `${d.address || "Deal"} → ${stage}`);
  };
  // follow-up Done / next date, from the board or the open deal; saves right away
  const followDeal = async (d, nextDate) => {
    const mine = !d._owner || d._owner === userId;
    if (!mine) return notify?.("Only the person who added this deal can change its follow-up.");
    const patch = { followUpDate: nextDate || "", lastFollowUp: todayISO() };
    const saved = deals.find((x) => x.id === d.id);
    if (dealForm && dealForm.id === d.id) setDealForm((f) => ({ ...f, ...patch }));
    if (!saved) return;   // a new, unsaved deal: the form keeps it until Save
    const rec = { ...saved, ...patch };
    setDeals(deals.map((x) => (x.id === d.id ? rec : x)));
    const { error } = await supabase.from("deals").update({ data: rec, updated_at: new Date().toISOString() }).eq("id", d.id);
    notify?.(error ? (error.message || "Couldn't update the follow-up.") : nextDate ? `Next follow-up: ${shortDay(nextDate)}` : "Follow-up done ✓");
  };
  const deleteDeal = async (id) => {
    const d = deals.find((x) => x.id === id);
    if (d?.photos) for (const p of d.photos) await photoDel(p);
    setDeals(deals.filter((x) => x.id !== id));
    setDealForm(null);
    await supabase.from("deals").delete().eq("id", id);
  };

  const saveBuyer = async (draft, keepOpen) => {
    const src = draft || buyerForm;
    if (!src.name.trim()) return;
    const rec = { ...src, ownerName: src.ownerName || userName };
    const exists = buyers.some((b) => b.id === rec.id);
    setBuyers(exists ? buyers.map((b) => (b.id === rec.id ? rec : b)) : [rec, ...buyers]);
    if (keepOpen) setBuyerForm(rec); else setBuyerForm(null);
    const { error } = await supabase.from("buyers").upsert({
      id: rec.id, data: rec, owner_id: rec._owner || userId, is_public: !!rec.isPublic, updated_at: new Date().toISOString(),
    });
    if (error) return notify?.(error.message || "Save failed.");
    const c = await autoContact(personFromBuyer(rec), userId);
    notify?.((keepOpen ? "Call logged." : "Buyer saved.") + contactNote(c, rec.name));
  };
  const deleteBuyer = async (id) => {
    setBuyers(buyers.filter((b) => b.id !== id));
    setBuyerForm(null);
    await supabase.from("buyers").delete().eq("id", id);
  };

  const handleCsv = (file) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (res) => {
        const pick = (row, keys) => {
          const k = Object.keys(row).find((h) => keys.some((x) => h.toLowerCase().includes(x)));
          return k ? String(row[k]).trim() : "";
        };
        const imported = res.data.map((row) => ({
          ...blankBuyer(),
          name: pick(row, ["name", "contact", "lead"]),
          company: pick(row, ["company", "organization", "firm"]),
          phone: pick(row, ["phone", "mobile", "cell", "tel"]),
          email: pick(row, ["email", "mail"]),
          notes: pick(row, ["note", "description", "comment", "background"]),
        })).filter((b) => b.name || b.phone || b.email);
        if (!imported.length) { setImportMsg("No rows found — the file needs a header row with Name / Phone / Email columns."); return; }
        setBuyers([...imported, ...buyers]);
        const now = new Date().toISOString();
        const { error } = await supabase.from("buyers").upsert(imported.map((b) => ({
          id: b.id, data: { ...b, ownerName: userName }, owner_id: userId, is_public: false, updated_at: now,
        })));
        if (error) return setImportMsg(error.message || "Import failed to save.");
        const cache = (await supabase.from("contacts").select("id, name, phone, email, address, area, type, converted_deal_id, converted_buyer_id, owner_id")).data;
        let added = 0;
        if (cache) for (const b of imported) { const c = await autoContact(personFromBuyer(b), userId, cache); if (c.status === "created") added++; }
        setImportMsg(`Imported ${imported.length} buyers${added ? ` (${added} new in Contacts)` : ""}. Open each to tag boroughs and criteria.`);
      },
      error: () => setImportMsg("Couldn't read that file. Export your CRM as CSV and try again."),
    });
  };

  const filteredDeals = useMemo(() => {
    const t = q.toLowerCase();
    return deals.filter((d) => {
      const mine = !d._owner || d._owner === userId;
      if (ownFilter === "Mine" && !mine) return false;
      if (ownFilter === "Shared with me" && mine) return false;
      if (boroFilter !== "All" && d.borough !== boroFilter) return false;
      return !t || [d.address, d.neighborhood, d.zone, d.notes, d.contactName, d.contactEmail, d.followUpNotes].join(" ").toLowerCase().includes(t);
    });
  }, [deals, q, boroFilter, ownFilter, userId]);

  const filteredBuyers = useMemo(() => {
    const t = bq.toLowerCase();
    return buyers.filter((b) =>
      (bBoro === "All" || b.boroughs?.includes(bBoro)) &&
      (bTypes.length === 0 || bTypes.some((x) => b.assetTypes?.includes(x))) &&
      (!bCold || lastContacted(b.lastContacted).cold || lastContacted(b.lastContacted).never) &&
      (!t || [b.name, b.company, b.notes, b.email, b.phone].join(" ").toLowerCase().includes(t)));
  }, [buyers, bq, bBoro, bTypes, bCold]);
  const coldCount = buyers.filter((b) => { const l = lastContacted(b.lastContacted); return l.cold || l.never; }).length;
  const toggleBType = (x) => setBTypes(bTypes.includes(x) ? bTypes.filter((y) => y !== x) : [...bTypes, x]);

  if (!loaded) return <div style={{ padding: 40, opacity: 0.6 }}>Loading your desk…</div>;

  /* ---------- DEALS ---------- */
  if (view === "deals" && !dealForm) return (
    <>
      <header className="pageHead">
        <h1>Deals</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="seg">
            <button data-on={dealLayout === "board"} onClick={() => pickLayout("board")}>Board</button>
            <button data-on={dealLayout === "list"} onClick={() => pickLayout("list")}>List</button>
          </div>
          <button className="primary" onClick={() => setDealForm(blankDeal())}>+ New deal</button>
        </div>
      </header>
      <div className="filterRow">
        <input className="search" placeholder="Search address, zoning, contact, notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          {["All", ...BOROUGHS].map((b) => (
            <button key={b} className="chip" data-on={boroFilter === b} onClick={() => setBoroFilter(b)}>{b}</button>
          ))}
        </div>
        <div className="chips">
          {["All", "Mine", "Shared with me"].map((o) => (
            <button key={o} className="chip small" data-on={ownFilter === o} onClick={() => setOwnFilter(o)}>{o}</button>
          ))}
        </div>
      </div>
      {filteredDeals.length === 0 && (
        <div className="empty">{deals.length === 0
          ? "No deals yet. Someone calls with a property — hit “New deal” and lock it in while you're still on the phone."
          : "Nothing matches that search."}</div>
      )}
      {dealLayout === "board" && filteredDeals.length > 0 && (
        <div className="board">
          {DEAL_STAGES.map((s) => {
            const col = filteredDeals.filter((d) => stageOf(d) === s);
            return (
              <div key={s} className="boardCol" data-drop={dragId ? "1" : ""}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const d = deals.find((x) => x.id === dragId); setDragId(null); if (d) setStage(d, s); }}>
                <div className="boardHead"><span>{s}</span><b>{col.length}</b></div>
                {col.length === 0 && <div className="boardEmpty">No deals</div>}
                {col.map((d) => {
                  const fu = followUpStatus(d.followUpDate);
                  const n = matchBuyers(d, buyers).length;
                  const bsf = dealBuildable(d);
                  return (
                    <div key={d.id} className="boardCard" draggable onDragStart={() => setDragId(d.id)} onDragEnd={() => setDragId(null)}
                      onClick={() => setDealForm({ ...d })}>
                      {d.photos?.[0] && <img className="boardPhoto" src={photoUrl(d.photos[0])} alt="" loading="lazy" />}
                      <div className="boardAddr">{d.address || "Untitled"}</div>
                      {d.contactName && <div className="boardSeller">{d.contactName}</div>}
                      <div className="boardSub">{[d.neighborhood, d.borough].filter(Boolean).join(" · ")}</div>
                      {bsf ? <div className="boardBsf">{fmt(bsf)} buildable SF{d.zone && d.zone !== "Custom" ? ` · ${d.zone}` : ""}</div>
                        : <div className="boardBsf none">Buildable — add lot size</div>}
                      <div className="boardMeta">
                        <span>{d.askingPrice ? money(d.askingPrice) : "No ask yet"}</span>
                        {n > 0 && <span className="matchCount">{n} buyer{n === 1 ? "" : "s"} fit</span>}
                      </div>
                      {fu && <div className={"followTag " + fu.cls}>● {fu.label}</div>}
                      {fu && fu.days <= 0 && <FollowUpQuick compact onDone={() => followDeal(d, null)} onNext={(x) => followDeal(d, x)} />}
                      <select className="stageSel" value={s} onClick={(e) => e.stopPropagation()} onChange={(e) => setStage(d, e.target.value)}>
                        {DEAL_STAGES.map((x) => <option key={x}>{x}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {dealLayout === "list" && <div className="cardGrid">
        {filteredDeals.map((d) => {
          const z = computeZoning(d.zone, d.streetWidth, d.lotArea, d.customFar);
          const ask = parseFloat(d.askingPrice);
          const uapPath = d.devPath === "uap";
          const mine = !d._owner || d._owner === userId;
          const perAor = z && z.baseZfa > 0 && ask ? ask / z.baseZfa : null;
          const perUap = z && z.uapZfa > 0 && ask ? ask / z.uapZfa : null;
          const fu = followUpStatus(d.followUpDate);
          return (
            <div key={d.id} className="card" onClick={() => setDealForm({ ...d })}>
              {d.photos?.[0] && <img className="cardPhoto" src={photoUrl(d.photos[0])} alt="" loading="lazy" />}
              <div className="cardTop">
                <span className="tag">{d.borough}</span>
                <span className="tag alt">{d.zone}</span>
                <span className="tag path">{uapPath ? "UAP" : "As-of-right"}</span>
                <span className={"tag " + (d.isPublic ? "pub" : "priv")}>{d.isPublic ? "Published" : "Private"}</span>
                <span className="tag stage">{stageOf(d)}</span>
                {!mine && <span className="tag shared">Shared</span>}
                {d.vacancy === "Delivered vacant" && <span className="tag green">Vacant</span>}
                <button className="shareBtn" onClick={(e) => { e.stopPropagation(); setShareFor(d); }}>Share ↗</button>
              </div>
              <div className="cardAddr">{d.address || "Untitled"}</div>
              {(d.contactName || d.neighborhood) && <div className="cardSub">{[d.contactName, d.neighborhood].filter(Boolean).join(" · ")}</div>}
              {fu && <div className={"followTag " + fu.cls}>● {fu.label}</div>}
              {fu && fu.days <= 0 && <FollowUpQuick compact onDone={() => followDeal(d, null)} onNext={(x) => followDeal(d, x)} />}
              <div className="cardStats">
                <div><label>Ask</label><b>{money(d.askingPrice)}</b></div>
                <div><label>Lot</label><b>{fmt(d.lotArea)} SF</b></div>
                <div data-hi={!uapPath}><label>Buildable — AOR</label><b>{z ? fmt(z.baseZfa) : "—"} SF</b></div>
                <div data-hi={!uapPath}><label>$/BSF — AOR</label><b>{perAor ? "$" + fmt(perAor) : "—"}</b></div>
                <div data-hi={uapPath}><label>Buildable — UAP</label><b>{z?.uapZfa ? fmt(z.uapZfa) + " SF" : "n/a"}</b></div>
                <div data-hi={uapPath}><label>$/BSF — UAP</label><b>{perUap ? "$" + fmt(perUap) : "n/a"}</b></div>
              </div>
              <div className="cardFoot">
                <span className="byline"><i>{initials(d.ownerName || (mine ? userName : "?"))}</i>{d.ownerName || (mine ? userName : "Unknown")}</span>
                <span onClick={(e) => { e.stopPropagation(); onUnderwrite(d); }} style={{ color: BLUE, fontWeight: 700 }}>Underwrite →</span>
              </div>
            </div>
          );
        })}
      </div>}
      {shareFor && <ShareSheet deal={shareFor} onClose={() => setShareFor(null)} notify={notify} />}
    </>
  );

  if (view === "deals" && dealForm) return (
    <>
      <DealForm
        deal={dealForm} setDeal={setDealForm} buyers={buyers}
        onSave={saveDeal} onCancel={() => setDealForm(null)}
        onDelete={() => deleteDeal(dealForm.id)}
        onShare={() => setShareFor(dealForm)}
        onUnderwrite={() => onUnderwrite(dealForm)}
        isNew={!deals.some((d) => d.id === dealForm.id)}
        mine={!dealForm._owner || dealForm._owner === userId}
        notify={notify}
        onFollow={(x) => followDeal(dealForm, x)}
      />
      {shareFor && <ShareSheet deal={shareFor} onClose={() => setShareFor(null)} notify={notify} />}
    </>
  );

  /* ---------- BUYERS ---------- */
  if (view === "buyers" && !buyerForm) return (
    <>
      <header className="pageHead">
        <h1>Buyers</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ghost" onClick={() => fileRef.current?.click()}>Import CSV</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }}
            onChange={(e) => { if (e.target.files?.[0]) handleCsv(e.target.files[0]); e.target.value = ""; }} />
          <button className="primary" onClick={() => setBuyerForm(blankBuyer())}>+ New buyer</button>
        </div>
      </header>
      {importMsg && <div className="notice">{importMsg}</div>}
      <div className="filterRow">
        <input className="search" placeholder="Search name, company, notes…" value={bq} onChange={(e) => setBq(e.target.value)} />
        <div>
          <div className="filterLabel">Borough</div>
          <div className="chips">
            {["All", ...BOROUGHS].map((b) => (
              <button key={b} className="chip" data-on={bBoro === b} onClick={() => setBBoro(b)}>{b}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="filterLabel">What they buy {bTypes.length > 0 && <span className="clearLink" onClick={() => setBTypes([])}>Clear</span>}</div>
          <div className="chips">
            {ASSET_TYPES.map((a) => (
              <button key={a} className="chip" data-on={bTypes.includes(a)} onClick={() => toggleBType(a)}>{bTypes.includes(a) ? "✓ " : ""}{a}</button>
            ))}
          </div>
        </div>
        <div className="chips">
          <button className="chip small" data-on={bCold} onClick={() => setBCold(!bCold)}>● Not contacted in 30+ days or never logged ({coldCount})</button>
        </div>
        <div className="resultCount">{filteredBuyers.length} of {buyers.length} buyers</div>
      </div>
      {filteredBuyers.length === 0 && (
        <div className="empty">{buyers.length === 0
          ? "No buyers yet. Add them one by one, or import your old CRM export as a CSV."
          : "No buyers match. Imported contacts need boroughs and asset types tagged before the filters find them."}</div>
      )}
      <div className="rowList">
        {filteredBuyers.map((b) => (
          <div key={b.id} className="row" onClick={() => setBuyerForm({ ...b })}>
            <div style={{ flex: 2, minWidth: 140 }}>
              <b>{b.name}</b>
              {b.company && <div className="rowSub">{b.company}</div>}
            </div>
            <div style={{ flex: 2, minWidth: 120 }}>
              {(b.boroughs || []).map((x) => <span key={x} className="tag" style={{ marginRight: 4 }}>{x}</span>)}
              {!b.boroughs?.length && <span style={{ opacity: 0.4 }}>no boroughs tagged</span>}
              <div style={{ marginTop: 5 }}>
                {(b.assetTypes || []).map((x) => <span key={x} className="tag alt" data-hit={bTypes.includes(x)} style={{ marginRight: 4, marginBottom: 3 }}>{x}</span>)}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 90 }}>{b.minSize ? `${fmt(b.minSize)}+ SF` : ""}</div>
            <div style={{ flex: 1, minWidth: 90 }}>{b.maxBudget ? `≤ ${money(b.maxBudget)}` : ""}</div>
            <div style={{ flex: "1 1 150px", minWidth: 130, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5 }}>
              {b.phone && <span style={{ opacity: 0.7 }}>{b.phone}</span>}
              <QuickActions phone={b.phone} email={b.email} small />
              <LastContactedTag date={b.lastContacted} />
              {followUpStatus(b.followUpDate) && <div className={"followTag " + followUpStatus(b.followUpDate).cls}>● {followUpStatus(b.followUpDate).label}</div>}
            </div>
            <span className="byline"><i>{initials(b.ownerName || userName)}</i>{b.ownerName || userName}</span>
          </div>
        ))}
      </div>
    </>
  );

  if (view === "buyers" && buyerForm) return (
    <BuyerForm buyer={buyerForm} setBuyer={setBuyerForm} onSave={() => saveBuyer()} onLogCall={(b) => saveBuyer(b, true)}
      onCancel={() => setBuyerForm(null)} onDelete={() => deleteBuyer(buyerForm.id)}
      isNew={!buyers.some((b) => b.id === buyerForm.id)}
      mine={!buyerForm._owner || buyerForm._owner === userId} />
  );

  if (view === "zcalc") return <ZoningCalc />;
  return null;
}

/* ============================================================
   QUICK ZONING CALCULATOR
   ============================================================ */
function ZoningCalc() {
  const [zone, setZone] = useState("R6");
  const [street, setStreet] = useState("narrow");
  const [devPath, setDevPath] = useState("aor");
  const [lot, setLot] = useState("");
  const [far, setFar] = useState("");
  const [price, setPrice] = useState("");
  const ss = isStreetSensitive(zone);
  return (
    <>
      <header className="pageHead"><h1>Zoning calculator</h1></header>
      <p className="homeIntro" style={{ maxWidth: 560 }}>
        Quick check while you're on the phone — district and lot size in, buildable SF and $/BSF out. Nothing is saved.
      </p>
      <div className="formCols">
        <div className="formMain" style={{ maxWidth: 460 }}>
          <div className="fgroup">
            <div className="ftitle">Inputs</div>
            <div className="frow">
              <Fld label="Zoning district">
                <select value={zone} onChange={(e) => setZone(e.target.value)}>
                  {Object.keys(DEAL_ZONES).map((z) => <option key={z}>{z}</option>)}
                </select>
              </Fld>
              {ss && (
                <Fld label="Street">
                  <select value={street} onChange={(e) => setStreet(e.target.value)}>
                    <option value="narrow">Narrow (&lt;75 ft)</option>
                    <option value="wide">Wide (≥75 ft)</option>
                  </select>
                </Fld>
              )}
              <Fld label="Development path">
                <select value={devPath} onChange={(e) => setDevPath(e.target.value)}>
                  <option value="aor">As-of-right</option>
                  <option value="uap">UAP (City of Yes)</option>
                </select>
              </Fld>
              {zone === "Custom" && <Fld label="Custom FAR"><input type="number" value={far} onChange={(e) => setFar(e.target.value)} placeholder="3.0" /></Fld>}
              <Fld label="Lot area (SF)"><input type="number" value={lot} onChange={(e) => setLot(e.target.value)} placeholder="5000" /></Fld>
              <Fld label="Price ($, optional)"><input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="4500000" /></Fld>
            </div>
          </div>
        </div>
        <div className="formSide">
          <ZoningPanel zone={zone} streetWidth={street} lotArea={lot} customFar={far} askingPrice={price} devPath={devPath} />
        </div>
      </div>
    </>
  );
}

/* ============================================================ */
function ZoningPanel({ zone, streetWidth, lotArea, customFar, askingPrice, devPath, buildableSf }) {
  const z = computeZoning(zone, streetWidth, lotArea, customFar);
  if (!z) return null;
  const ask = parseFloat(askingPrice);
  const ss = ["R6", "R7-1", "R7-2", "R8"].includes(z.district);
  const uapPath = devPath === "uap";
  return (
    <div className="zpanel">
      <div className="zpanelTitle">Zoning analysis · {zone}{ss ? ` · ${streetWidth} street` : ""} · {uapPath ? "UAP" : "as-of-right"}</div>
      <div className="zgrid">
        {parseFloat(buildableSf) > 0 && <div className="zcell big" style={{ gridColumn: "1 / -1" }}><label>Buildable · your number</label><div className="znum brass">{fmt(buildableSf)} <small>SF</small></div></div>}
        <div className="zcell"><label>Base FAR</label><div className="znum">{z.baseFar ? z.baseFar.toFixed(2) : "—"}</div></div>
        <div className="zcell"><label>UAP FAR</label><div className="znum">{z.uapFar ? z.uapFar.toFixed(2) : "n/a"}</div></div>
        <div className="zcell big" data-dim={uapPath}><label>Buildable — as of right</label><div className="znum brass">{fmt(z.baseZfa)} <small>SF</small></div></div>
        <div className="zcell big" data-dim={!uapPath}><label>Buildable — with UAP</label><div className="znum brass">{z.uapZfa ? fmt(z.uapZfa) : "n/a"} {z.uapZfa ? <small>SF</small> : null}</div></div>
        {ask > 0 && z.baseZfa > 0 && (
          <>
            <div className="zcell" data-dim={uapPath}><label>$/BSF as-of-right</label><div className="znum">${fmt(ask / z.baseZfa)}</div></div>
            <div className="zcell" data-dim={!uapPath}><label>$/BSF with UAP</label><div className="znum">{z.uapZfa ? "$" + fmt(ask / z.uapZfa) : "n/a"}</div></div>
          </>
        )}
      </div>
      <div className="zfoot">Reference values — confirm district & FAR on ZoLa before you quote it.</div>
    </div>
  );
}

/* ============================================================
   NYC lot lookup (free, public, called from the browser)
   address -> GeoSearch (BBL) -> PLUTO (lot area, zoning, FARs, built SF)
   PLUTO is asked two ways at once (NYC Open Data + NYC Planning's
   MapPLUTO); whichever answers first wins.
   ============================================================ */
const PLUTO_FIELDS = 'bbl,address,zonedist1,zonedist2,spdist1,overlay1,lotarea,bldgarea,residfar,commfar,facilfar,builtfar,ownername,lotfront,numfloors,unitsres,yearbuilt';
async function fetchJson(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
  .replace(/\b(Llc|Lp|Llp|Ny|Nyc|Usa)\b/g, (m) => m.toUpperCase());
async function geoSearch(text) {
  const j = await fetchJson(`https://geosearch.planninglabs.nyc/v2/search?size=8&text=${encodeURIComponent(text)}`);
  const seen = new Set(), out = [];
  for (const f of j.features || []) {
    const pr = f.properties || {};
    const bbl = pr.addendum?.pad?.bbl;
    if (!bbl || seen.has(bbl)) continue;
    seen.add(bbl);
    out.push({ label: titleCase(String(pr.label || '').replace(/, NY, USA$/i, '')).replace(/, (Bronx|Brooklyn|Queens|Manhattan|Staten Island)$/i, ''),
      bbl: String(bbl), borough: pr.borough, neighborhood: pr.neighbourhood || '' });
  }
  return out.slice(0, 4);
}
async function plutoLot(bbl) {
  const soda = fetchJson(`https://data.cityofnewyork.us/resource/64uk-42ks.json?$select=${PLUTO_FIELDS}&bbl=${bbl}`)
    .then((r) => { if (!r?.length) throw new Error('none'); return { ...r[0], src: 'NYC Open Data · PLUTO' }; });
  const carto = fetchJson(`https://planninglabs.carto.com/api/v2/sql?q=${encodeURIComponent(`SELECT ${PLUTO_FIELDS} FROM dcp_mappluto WHERE bbl=${Number(bbl)}`)}`)
    .then((r) => { if (!r?.rows?.length) throw new Error('none'); return { ...r.rows[0], src: 'NYC Planning · MapPLUTO' }; });
  try { return await Promise.any([soda, carto]); }
  catch (e) {
    const all = await Promise.allSettled([soda, carto]);
    if (all.every((x) => x.status === 'rejected' && x.reason?.message === 'none')) return null;   // both answered: no such lot
    throw new Error('City data did not answer');
  }
}
const bblParts = (bbl) => { const s = String(bbl || '').replace(/\D/g, '').padEnd(10, '0').slice(0, 10); return { boro: s[0], block: String(parseInt(s.slice(1, 6), 10)), lot: String(parseInt(s.slice(6, 10), 10)) }; };
const zolaUrl = (bbl) => { const b = bblParts(bbl); return `https://zola.planning.nyc.gov/l/lot/${b.boro}/${b.block}/${b.lot}`; };
const mapsUrl = (d) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([d.address, d.borough, 'NY'].filter(Boolean).join(', '))}`;
const roundSf = (v) => { const n = parseFloat(v); return n > 0 ? String(Math.round(n)) : ''; };
// a PLUTO row -> the deal fields it fills (zone kept exactly as the city writes it)
function lotFields(hit, lot) {
  const zd = String(lot.zonedist1 || '').toUpperCase().trim();
  const maxFar = Math.max(N(lot.residfar), N(lot.commfar));
  return {
    zone: zd || 'Custom',
    customFar: resolveDistrict(zd) ? '' : (maxFar ? String(+maxFar.toFixed(2)) : ''),
    lotArea: roundSf(lot.lotarea),
    existingSf: roundSf(lot.bldgarea),
    borough: BOROUGHS.includes(hit.borough) ? hit.borough : '',
    neighborhood: hit.neighborhood || '',
  };
}

function DealForm({ deal, setDeal, buyers, onSave, onCancel, onDelete, onShare, onUnderwrite, isNew, mine = true, notify, onFollow }) {
  const touched = useRef(new Set());   // fields typed by hand in this visit: a lookup never overwrites them
  const set = (k) => (e) => { touched.current.add(k); setDeal({ ...deal, [k]: e.target.value }); };

  /* ---- auto zoning: look the address up and fill what the city knows ---- */
  const [look, setLook] = useState({ state: deal.lot ? "found" : "idle", hits: [] });
  const reqId = useRef(0);
  const applyLot = (hit, lot, force) => {
    const vals = lotFields(hit, lot);
    setDeal((d) => {
      const prev = d.autoFilled || {};
      const next = { ...d };
      const filled = {};
      for (const [k, v] of Object.entries(vals)) {
        if (!v) continue;
        const cur = d[k] == null ? "" : String(d[k]);
        const untouched = !touched.current.has(k) && (cur === "" || cur === String(prev[k] ?? "") || (isNew && (k === "zone" || k === "borough")));
        if (force ? !touched.current.has(k) || cur === "" : untouched) { next[k] = v; filled[k] = v; }
      }
      const { boro, block, lot: lt } = bblParts(lot.bbl || hit.bbl);
      next.lot = {
        bbl: String(hit.bbl), boro, block, lot: lt, label: hit.label, query: d.address,
        zonedist1: lot.zonedist1 || "", zonedist2: lot.zonedist2 || "", spdist1: lot.spdist1 || "", overlay1: lot.overlay1 || "",
        residfar: N(lot.residfar), commfar: N(lot.commfar), facilfar: N(lot.facilfar), builtfar: N(lot.builtfar),
        lotarea: N(lot.lotarea), bldgarea: N(lot.bldgarea), ownername: lot.ownername || "", lotfront: N(lot.lotfront),
        numfloors: N(lot.numfloors), unitsres: N(lot.unitsres), yearbuilt: N(lot.yearbuilt) || "",
        src: lot.src, at: new Date().toISOString(),
      };
      next.autoFilled = { ...prev, ...filled };
      return next;
    });
  };
  const runLookup = async (hitOverride) => {
    const address = (deal.address || "").trim();
    if (!hitOverride && (address.length < 5 || !/\d/.test(address))) return;
    const id = ++reqId.current;
    setLook((l) => ({ ...l, state: "looking" }));
    try {
      let hits = look.hits, hit = hitOverride;
      if (!hit) {
        const named = /\b(bronx|brooklyn|queens|manhattan|staten island|new york|ny)\b/i.test(address);
        hits = await geoSearch(address);
        if (!hits.length && !named && deal.borough) hits = await geoSearch(`${address}, ${deal.borough}`);
        // a borough picked by hand wins over the top guess
        hit = (touched.current.has("borough") && hits.find((h) => h.borough === deal.borough)) || hits[0];
      }
      if (id !== reqId.current) return;
      if (!hit) { setLook({ state: "notfound", hits: [] }); return; }
      const lot = await plutoLot(hit.bbl);
      if (id !== reqId.current) return;
      if (!lot) { setLook({ state: "nolot", hits, hit }); return; }
      applyLot(hit, lot, !!hitOverride);
      setLook({ state: "found", hits, hit });
    } catch (e) {
      if (id === reqId.current) setLook((l) => ({ ...l, state: "error", msg: e.message }));
    }
  };
  useEffect(() => {
    if (!mine) return;
    const address = (deal.address || "").trim();
    if (deal.lot && deal.lot.query === deal.address) return;   // already looked up
    if (address.length < 5 || !/\d/.test(address)) return;
    const t = setTimeout(() => runLookup(), 900);
    return () => clearTimeout(t);
  }, [deal.address]);
  const lotInfo = deal.lot;
  const zEst = computeZoning(deal.zone, deal.streetWidth, deal.lotArea, deal.customFar);
  const estBsf = zEst ? (deal.devPath === "uap" && zEst.uapZfa ? zEst.uapZfa : zEst.baseZfa) : 0;
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);
  const photoRef = useRef(null);
  const matches = matchBuyers(deal, buyers);
  const [showAll, setShowAll] = useState(false);
  const ss = isStreetSensitive(deal.zone);

  const upload = async (files) => {
    setBusy(true);
    const refs = [];
    for (const f of files) {
      try {
        const blob = await resizeImage(f);
        const path = `${deal.id}/${uid()}.jpg`;
        const { error } = await supabase.storage.from("deal-photos").upload(path, blob, { contentType: "image/jpeg" });
        if (error) { notify?.("Photo failed: " + error.message); continue; }
        const { data } = supabase.storage.from("deal-photos").getPublicUrl(path);
        if (data?.publicUrl) refs.push(data.publicUrl);
      } catch (e) { notify?.("Photo failed to save."); }
    }
    if (refs.length) setDeal((d) => ({ ...d, photos: [...(d.photos || []), ...refs] }));
    setBusy(false);
  };

  const removePhoto = async (ref) => {
    setDeal({ ...deal, photos: deal.photos.filter((p) => p !== ref) });
    await photoDel(ref);
  };

  return (
    <>
      <header className="pageHead">
        <h1>{isNew ? "New deal" : deal.address || "Edit deal"}</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isNew && mine && <button className="danger" onClick={() => (arm ? onDelete() : setArm(true))}>{arm ? "Tap again to delete" : "Delete"}</button>}
          {!isNew && <button className="ghost" onClick={onShare}>Share ↗</button>}
          <button className="ghost" onClick={onUnderwrite} disabled={!deal.address.trim()}>Underwrite →</button>
          <button className="ghost" onClick={onCancel}>{mine ? "Cancel" : "Back"}</button>
          {mine && <button className="primary" onClick={onSave} disabled={!deal.address.trim()}>Save deal</button>}
        </div>
      </header>
      {!mine && (
        <div className="notice" style={{ background: "#F3F0E4", borderColor: "#DDD0AC" }}>
          Published by <b>{deal.ownerName || "another user"}</b> — you can view, share, and underwrite it, but only they can edit it.
        </div>
      )}
      <div className="formCols">
        <div className="formMain">
          {mine && (
            <div className="fgroup">
              <div className="ftitle">Visibility</div>
              <div className="visRow">
                <button className="visBtn" data-on={!deal.isPublic} onClick={() => setDeal({ ...deal, isPublic: false })}>
                  <b>Private</b><span>Only you can see this</span>
                </button>
                <button className="visBtn" data-on={!!deal.isPublic} onClick={() => setDeal({ ...deal, isPublic: true })}>
                  <b>Published</b><span>Your team can view it</span>
                </button>
              </div>
              <div className="hintline">Flip this any time. Private deals are invisible to your teammates — that is enforced by the database, not just hidden in the screen.</div>
            </div>
          )}
          <div className="fgroup">
            <div className="ftitle">Property</div>
            <div className="frow"><Fld label="Address *" wide><input value={deal.address} onChange={set("address")} placeholder="1982 Belmont Ave" autoComplete="off" /></Fld></div>
            {mine && look.state === "looking" && <div className="lookBox busy">Looking up NYC zoning for this address…</div>}
            {mine && look.state === "notfound" && <div className="lookBox warn">Couldn't find that address in NYC records. Add the borough or check the spelling, or fill zoning by hand.</div>}
            {mine && look.state === "nolot" && <div className="lookBox warn">Found {look.hit?.label}, but the city has no lot data for it. Fill zoning by hand.</div>}
            {mine && look.state === "error" && (
              <div className="lookBox warn">City data didn't answer. <button className="linkBtn inline" onClick={() => runLookup()}>Try again</button></div>
            )}
            {lotInfo && look.state !== "looking" && (
              <div className="lookBox found">
                <div className="lookHead">
                  <b>✓ {lotInfo.label}</b>
                  <span>Block {lotInfo.block} · Lot {lotInfo.lot}</span>
                </div>
                <div className="lookFacts">
                  <span><label>Zoning</label>{[lotInfo.zonedist1, lotInfo.zonedist2].filter(Boolean).join(" / ") || "—"}{lotInfo.spdist1 ? ` · ${lotInfo.spdist1}` : ""}{lotInfo.overlay1 ? ` · ${lotInfo.overlay1}` : ""}</span>
                  <span><label>Lot</label>{lotInfo.lotarea ? fmt(lotInfo.lotarea) + " SF" : "—"}{lotInfo.lotfront ? ` · ${fmt(lotInfo.lotfront)} ft front` : ""}</span>
                  <span><label>Built</label>{lotInfo.bldgarea ? fmt(lotInfo.bldgarea) + " SF" : "Vacant / none"}{lotInfo.numfloors ? ` · ${fmt(lotInfo.numfloors)} fl` : ""}{lotInfo.yearbuilt ? ` · ${lotInfo.yearbuilt}` : ""}</span>
                  <span><label>City FAR</label>resi {lotInfo.residfar || 0} · comm {lotInfo.commfar || 0} · facility {lotInfo.facilfar || 0}</span>
                </div>
                {lotInfo.ownername && !/unavailable/i.test(lotInfo.ownername) && (
                  <div className="lookOwner">
                    Owner of record: <b>{titleCase(lotInfo.ownername)}</b>
                    {mine && !deal.contactName && (
                      <button className="linkBtn inline" onClick={() => setDeal({ ...deal, contactName: titleCase(lotInfo.ownername) })}>Use as seller</button>
                    )}
                  </div>
                )}
                <div className="lookLinks">
                  <a href={zolaUrl(lotInfo.bbl)} target="_blank" rel="noreferrer">ZoLa ↗</a>
                  <a href={mapsUrl(deal)} target="_blank" rel="noreferrer">Google Maps ↗</a>
                  {mine && <button className="linkBtn inline" onClick={() => { touched.current.clear(); runLookup(); }}>Look up again</button>}
                </div>
                {mine && look.hits?.length > 1 && look.state === "found" && (
                  <div className="lookAlt">Not this one?{" "}
                    {look.hits.filter((h) => h.bbl !== lotInfo.bbl).slice(0, 3).map((h) => (
                      <button key={h.bbl} className="chip small" onClick={() => runLookup(h)}>{h.label}, {h.borough}</button>
                    ))}
                  </div>
                )}
                {mine && (() => {
                  const city = lotFields({}, lotInfo);
                  const diffs = [
                    city.zone && resolveDistrict(city.zone) !== resolveDistrict(deal.zone) && city.zone !== deal.zone ? `zoning ${deal.zone} → ${city.zone}` : null,
                    city.lotArea && String(deal.lotArea || "") !== city.lotArea ? `lot ${deal.lotArea ? fmt(deal.lotArea) : "blank"} → ${fmt(city.lotArea)}` : null,
                    city.existingSf && String(deal.existingSf || "") !== city.existingSf ? `built ${deal.existingSf ? fmt(deal.existingSf) : "blank"} → ${fmt(city.existingSf)}` : null,
                  ].filter(Boolean);
                  if (!diffs.length) return null;
                  return (
                    <div className="lookDiff">City data differs: {diffs.join(" · ")}.{" "}
                      <button className="linkBtn inline" onClick={() => setDeal({ ...deal, zone: city.zone, customFar: city.customFar, lotArea: city.lotArea || deal.lotArea, existingSf: city.existingSf || deal.existingSf })}>Use city data</button>
                    </div>
                  );
                })()}
                <div className="lookNote">Auto-filled from {lotInfo.src || "NYC PLUTO"} — an estimate. Edit any number below; confirm on ZoLa before you quote it.</div>
              </div>
            )}
            {!lotInfo && deal.address.trim() && look.state !== "looking" && (
              <div className="lookLinks solo"><a href={mapsUrl(deal)} target="_blank" rel="noreferrer">Google Maps ↗</a></div>
            )}
            <div className="frow">
              <Fld label="Borough"><select value={deal.borough} onChange={set("borough")}>{BOROUGHS.map((b) => <option key={b}>{b}</option>)}</select></Fld>
              <Fld label="Neighborhood"><input value={deal.neighborhood} onChange={set("neighborhood")} placeholder="Belmont / Fordham" /></Fld>
            </div>
            <div className="frow">
              <Fld label="Asset type">
                <select value={deal.assetType || ""} onChange={set("assetType")}>
                  <option value="">Any (not set)</option>
                  {ASSET_TYPES.map((a) => <option key={a}>{a}</option>)}
                </select>
              </Fld>
              <Fld label="Stage">
                <select value={stageOf(deal)} onChange={set("stage")}>{DEAL_STAGES.map((s) => <option key={s}>{s}</option>)}</select>
              </Fld>
            </div>
          </div>
          <div className="fgroup">
            <div className="ftitle">Photos</div>
            {isNew && <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 8 }}>Save the deal first, then add photos.</div>}
            <div className="photoGrid">
              {(deal.photos || []).map((ref, i) => (
                <div key={ref} className="photoThumb">
                  <img src={photoUrl(ref)} alt="" />
                  <button className="photoX" onClick={() => removePhoto(ref)}>×</button>
                  {i === 0 && <span className="coverTag">Cover</span>}
                </div>
              ))}
              {!isNew && <button className="photoAdd" onClick={() => photoRef.current?.click()} disabled={busy}>{busy ? "Saving…" : "+ Add photo"}</button>}
              <input ref={photoRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; if (f.length) upload(f); }} />
            </div>
            {!isNew && <div className="hintline">First photo is the cover and goes out when you share. Photos are resized before upload.</div>}
          </div>
          <div className="fgroup">
            <div className="ftitle">Zoning & size</div>
            <div className="frow">
              <Fld label="Zoning district">
                <select value={deal.zone} onChange={set("zone")}>
                  {deal.zone && !(deal.zone in DEAL_ZONES) && <option value={deal.zone}>{deal.zone}{resolveDistrict(deal.zone) && resolveDistrict(deal.zone) !== deal.zone ? ` (${resolveDistrict(deal.zone)} equiv)` : ""}</option>}
                  {Object.keys(DEAL_ZONES).map((z) => <option key={z}>{z}</option>)}
                </select>
              </Fld>
              {!resolveDistrict(deal.zone) && <Fld label={deal.zone === "Custom" ? "Custom FAR" : "Max FAR (city data)"}><input type="number" value={deal.customFar} onChange={set("customFar")} placeholder="3.0" /></Fld>}
              <Fld label="Development path">
                <select value={deal.devPath || "aor"} onChange={set("devPath")}>
                  <option value="aor">As-of-right</option>
                  <option value="uap">UAP (City of Yes)</option>
                </select>
              </Fld>
              <Fld label="Lot area (SF)"><input type="number" value={deal.lotArea} onChange={set("lotArea")} placeholder="5000" /></Fld>
              <Fld label="Existing bldg SF"><input type="number" value={deal.existingSf} onChange={set("existingSf")} placeholder="optional" /></Fld>
              <Fld label="Max buildable SF">
                <input type="number" value={deal.buildableSf || ""} onChange={set("buildableSf")} placeholder={estBsf ? `≈ ${fmt(estBsf)} (estimate)` : "lot × FAR"} />
              </Fld>
            </div>
            <div className="streetPick">
              <div className="segLabel">Street</div>
              <div className="seg">
                <button data-on={deal.streetWidth === "narrow"} onClick={() => { touched.current.add("streetWidth"); setDeal({ ...deal, streetWidth: "narrow" }); }}>Narrow street</button>
                <button data-on={deal.streetWidth === "wide"} onClick={() => { touched.current.add("streetWidth"); setDeal({ ...deal, streetWidth: "wide" }); }}>Wide street</button>
              </div>
              <div className="hintline">
                {ss
                  ? (() => { const d = resolveDistrict(deal.zone); const n = farFor(d, "narrow"), w = farFor(d, "wide"); return `Matters here: ${deal.zone} is ${n.aor} FAR on a narrow street, ${w.aor} on a wide one (75 ft+).${deal.streetWidth ? "" : " Counted as narrow until you pick."}`; })()
                  : `Wide = 75 ft or more. Doesn't change the FAR in ${deal.zone || "this district"}; saved with the deal.`}
              </div>
            </div>
            <div className="hintline">{parseFloat(deal.buildableSf) > 0
              ? <>Using your number. <button className="linkBtn inline" onClick={() => setDeal({ ...deal, buildableSf: "" })}>Back to estimate{estBsf ? ` (${fmt(estBsf)})` : ""}</button></>
              : "Buildable is lot area × FAR on the path you pick. Type a number above to override it."}</div>
          </div>
          <div className="fgroup">
            <div className="ftitle">Pricing & status</div>
            <div className="frow">
              <Fld label="Asking price ($)"><input type="number" value={deal.askingPrice} onChange={set("askingPrice")} placeholder="4500000" /></Fld>
              <Fld label="Seller's number ($)"><input type="number" value={deal.sellerNumber} onChange={set("sellerNumber")} placeholder="what he really wants" /></Fld>
              <Fld label="Delivery"><select value={deal.vacancy} onChange={set("vacancy")}>{VACANCY.map((v) => <option key={v}>{v}</option>)}</select></Fld>
            </div>
          </div>
          <div className="fgroup">
            <div className="ftitle">Seller contact</div>
            <div className="frow">
              <Fld label="Name"><input value={deal.contactName} onChange={set("contactName")} /></Fld>
              <Fld label="Phone"><input value={deal.contactPhone} onChange={set("contactPhone")} /></Fld>
              <Fld label="Email"><input type="email" value={deal.contactEmail || ""} onChange={set("contactEmail")} placeholder="seller@email.com" /></Fld>
            </div>
            <Fld label="Notes" wide><textarea rows={3} value={deal.notes} onChange={set("notes")} placeholder="Off-market, wants quiet process, open to seller financing…" /></Fld>
          </div>
          <div className="fgroup">
            <div className="ftitle">Follow-up</div>
            <div className="frow">
              <Fld label="Follow-up date"><input type="date" value={deal.followUpDate || ""} onChange={set("followUpDate")} /></Fld>
            </div>
            <Fld label="Comments" wide><textarea rows={3} value={deal.followUpNotes || ""} onChange={set("followUpNotes")} placeholder="What to check on, who to call, where things stand…" /></Fld>
            {followUpStatus(deal.followUpDate) && (
              <>
                <div className={"followTag inForm " + followUpStatus(deal.followUpDate).cls}>● {followUpStatus(deal.followUpDate).label}</div>
                {mine && <FollowUpQuick onDone={() => onFollow(null)} onNext={(x) => onFollow(x)} />}
              </>
            )}
          </div>
        </div>
        <div className="formSide">
          <ZoningPanel zone={deal.zone} streetWidth={deal.streetWidth} lotArea={deal.lotArea} customFar={deal.customFar} askingPrice={deal.askingPrice} devPath={deal.devPath} buildableSf={deal.buildableSf} />
          <div className="zpanel" style={{ marginTop: 14 }}>
            <div className="zpanelTitle">Buyers that fit ({matches.length})</div>
            <div className="matchHint">
              Checks borough{deal.assetType ? `, ${deal.assetType}` : ""}, budget and size against each buyer's buy box.
              {!deal.assetType && " Set an asset type above to narrow it."}
            </div>
            {matches.length === 0 && <div style={{ padding: "10px 2px", fontSize: 13, opacity: 0.6 }}>No buyers fit this deal yet.</div>}
            {matches.slice(0, showAll ? matches.length : 8).map((b) => (
              <div key={b.id} className="matchRow">
                <div className="matchMain">
                  <b>{b.name}</b>{b.company && <span className="matchCo"> · {b.company}</span>}
                  <div className="matchHits">
                    {b._hits.map((h) => <span key={h} className="hit">✓ {h}</span>)}
                    {b._hits.length === 0 && <span className="hit open">Open buy box</span>}
                  </div>
                  <LastContactedTag date={b.lastContacted} />
                </div>
                <QuickActions phone={b.phone} email={b.email} subject={deal.address} small />
              </div>
            ))}
            {matches.length > 8 && (
              <button className="linkBtn" onClick={() => setShowAll(!showAll)}>{showAll ? "Show top 8" : `Show all ${matches.length}`}</button>
            )}
            {matches.some((b) => b.email) && (
              <a className="linkBtn" href={`mailto:?bcc=${matches.filter((b) => b.email).map((b) => b.email).join(",")}&subject=${encodeURIComponent(deal.address || "New deal")}`}>
                Email all {matches.filter((b) => b.email).length} (BCC) →
              </a>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function BuyerForm({ buyer, setBuyer, onSave, onLogCall, onCancel, onDelete, isNew, mine = true }) {
  const set = (k) => (e) => setBuyer({ ...buyer, [k]: e.target.value });
  const [arm, setArm] = useState(false);
  const [callNote, setCallNote] = useState("");
  const fu = followUpStatus(buyer.followUpDate);
  // log a call: dated line on top of the notes + last contacted = today; saves right away
  const logCall = () => {
    const t = todayISO();
    const stamp = new Date(t + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const line = `${stamp}: ${callNote.trim() || "Called"}`;
    const next = { ...buyer, lastContacted: t, notes: buyer.notes ? `${line}\n${buyer.notes}` : line };
    setCallNote("");
    if (isNew || !mine) setBuyer(next); else onLogCall(next);
  };
  const toggle = (k, v) => () => {
    const arr = buyer[k] || [];
    setBuyer({ ...buyer, [k]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] });
  };
  return (
    <>
      <header className="pageHead">
        <h1>{isNew ? "New buyer" : buyer.name || "Edit buyer"}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {!isNew && mine && <button className="danger" onClick={() => (arm ? onDelete() : setArm(true))}>{arm ? "Tap again to delete" : "Delete"}</button>}
          <button className="ghost" onClick={onCancel}>{mine ? "Cancel" : "Back"}</button>
          {mine && <button className="primary" onClick={onSave} disabled={!buyer.name.trim()}>Save buyer</button>}
        </div>
      </header>
      <div style={{ maxWidth: 720 }}>
        {mine && (
          <div className="fgroup">
            <div className="ftitle">Visibility</div>
            <div className="visRow">
              <button className="visBtn" data-on={!buyer.isPublic} onClick={() => setBuyer({ ...buyer, isPublic: false })}>
                <b>Private</b><span>Only you can see this</span>
              </button>
              <button className="visBtn" data-on={!!buyer.isPublic} onClick={() => setBuyer({ ...buyer, isPublic: true })}>
                <b>Published</b><span>Your team can view it</span>
              </button>
            </div>
          </div>
        )}
        <div className="fgroup">
          <div className="ftitle">Contact</div>
          <div className="frow">
            <Fld label="Name *"><input value={buyer.name} onChange={set("name")} /></Fld>
            <Fld label="Company"><input value={buyer.company} onChange={set("company")} /></Fld>
          </div>
          <div className="frow">
            <Fld label="Phone"><input type="tel" value={buyer.phone} onChange={set("phone")} /></Fld>
            <Fld label="Email"><input type="email" value={buyer.email} onChange={set("email")} /></Fld>
          </div>
          <QuickActions phone={buyer.phone} email={buyer.email} />
        </div>
        <div className="fgroup">
          <div className="ftitle">Follow-up & call log</div>
          <div className="frow">
            <Fld label="Last contacted">
              <div className="dateWithBtn">
                <input type="date" value={buyer.lastContacted || ""} onChange={set("lastContacted")} />
                <button className="ghost" onClick={() => setBuyer({ ...buyer, lastContacted: todayISO() })}>Today</button>
              </div>
            </Fld>
            <Fld label="Next follow-up"><input type="date" value={buyer.followUpDate || ""} onChange={set("followUpDate")} /></Fld>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <LastContactedTag date={buyer.lastContacted} />
            {fu && <div className={"followTag " + fu.cls}>● {fu.label}</div>}
          </div>
          {mine && (
            <div className="noteAddRow">
              <input value={callNote} onChange={(e) => setCallNote(e.target.value)} placeholder="Quick note on the call (optional)"
                onKeyDown={(e) => { if (e.key === "Enter") logCall(); }} />
              <button className="primary" onClick={logCall}>Log call</button>
            </div>
          )}
          <div className="hintline">Log call stamps today's date into the notes and updates Last contacted.</div>
        </div>
        <div className="fgroup">
          <div className="ftitle">Buy box</div>
          <Fld label="Boroughs" wide>
            <div className="chips">{BOROUGHS.map((b) => <button key={b} className="chip" data-on={buyer.boroughs?.includes(b)} onClick={toggle("boroughs", b)}>{b}</button>)}</div>
          </Fld>
          <Fld label="Asset types" wide>
            <div className="chips">{ASSET_TYPES.map((a) => <button key={a} className="chip" data-on={buyer.assetTypes?.includes(a)} onClick={toggle("assetTypes", a)}>{a}</button>)}</div>
          </Fld>
          <div className="frow">
            <Fld label="Min size (BSF)"><input type="number" value={buyer.minSize} onChange={set("minSize")} placeholder="5000" /></Fld>
            <Fld label="Max budget ($)"><input type="number" value={buyer.maxBudget} onChange={set("maxBudget")} placeholder="10000000" /></Fld>
          </div>
          <Fld label="Notes" wide><textarea rows={3} value={buyer.notes} onChange={set("notes")} placeholder="All-cash, closes fast, only prime Brooklyn…" /></Fld>
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

function ShareSheet({ deal, onClose, notify }) {
  const text = buildShareText(deal);
  const [copied, setCopied] = useState(false);
  const photo = photoUrl(deal.photos?.[0]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch (e) { notify?.("Select the text and copy manually."); }
  };
  const share = async () => {
    if (!navigator.share) return copy();
    try {
      if (photo && navigator.canShare) {
        try {
          const blob = await (await fetch(photo)).blob();
          const file = new File([blob], "property.jpg", { type: "image/jpeg" });
          if (navigator.canShare({ files: [file] })) { await navigator.share({ text, files: [file] }); return; }
        } catch (e) {}
      }
      await navigator.share({ text });
    } catch (e) { if (e.name !== "AbortError") copy(); }
  };
  return (
    <div className="modalWrap" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead"><span>Share with client</span><button className="modalX" onClick={onClose}>×</button></div>
        {photo && <img className="sharePhoto" src={photo} alt="" />}
        <textarea className="shareText" readOnly value={text} rows={9} onFocus={(e) => e.target.select()} />
        <div className="hintline">Client-safe: seller's number, contact, and your notes are not included.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button className="primary" onClick={share}>Share ↗</button>
          <button className="ghost" onClick={copy}>{copied ? "✓ Copied" : "Copy text"}</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   APP SHELL
   ============================================================ */
function App() {
  const [session, setSession] = useState(undefined);   // undefined = still checking

  useEffect(() => {
      supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s || null));
    return () => sub?.subscription?.unsubscribe();
  }, []);

  // styles must live above the auth gate, otherwise the sign-in screen
  // renders before Shell mounts and arrives with no CSS at all
  return (
    <>
      <style id="jrg-styles">{CSS}</style>
      {session === undefined
        ? <div className="center">Connecting…</div>
        : !session
          ? <SignIn />
          : <Shell user={session.user} key={session.user.id} />}
    </>
  );
}

function SignIn() {
  const [mode, setMode] = useState("in");        // in | up
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const go = async (e) => {
    e?.preventDefault?.();
    if (!email.trim() || !pw) return;
    setBusy(true); setMsg("");
    try {
      if (mode === "up") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(), password: pw,
          options: { data: { full_name: name.trim() } },
        });
        if (error) setMsg(error.message);
        else setMsg("Account created. If your project requires email confirmation, check your inbox, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (error) setMsg(error.message);
      }
    } catch (err) {
      setMsg(err.message || "Something went wrong.");
    }
    setBusy(false);
  };

  return (
    <div className="center">
      <form className="authCard" onSubmit={go}>
        <img src={LOGO_FULL} alt="JStone Realty" style={{ height: 58, display: "block", margin: "0 auto 18px" }} />
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 14 }}>
          {mode === "up" ? "Create your account" : "Sign in"}
        </div>
        {mode === "up" && (
          <div className="field">
            <label className="flabel">Your name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Joel Beer" autoComplete="name" />
          </div>
        )}
        <div className="field">
          <label className="flabel">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div className="field">
          <label className="flabel">Password</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
                 autoComplete={mode === "up" ? "new-password" : "current-password"} />
        </div>
        {msg && <div className="notice" style={{ marginTop: 4 }}>{msg}</div>}
        <button className="primary" type="submit" disabled={busy} style={{ width: "100%", marginTop: 6 }}>
          {busy ? "Working…" : mode === "up" ? "Create account" : "Sign in"}
        </button>
        <div style={{ textAlign: "center", marginTop: 12, fontSize: 13 }}>
          <span style={{ opacity: 0.55 }}>Invite only. Ask your admin for access.</span>
        </div>
      </form>
    </div>
  );
}

function Shell({ user }) {
  const userId = user.id;
  const [userName, setUserName] = useState(user.user_metadata?.full_name?.trim() || "");
  const displayName = userName || (user.email || "You").split("@")[0];

  const [view, setView] = useState("home");     // home | deals | buyers | contacts | zcalc | uw | team
  const [openTarget, setOpenTarget] = useState(null);   // { view, id } to open one record after switching screens
  const go = (v, id) => { setOpenTarget(id ? { view: v, id } : null); setView(v); window.scrollTo(0, 0); };
  const [uwModel, setUwModel] = useState(() => blankModel());
  const [returnTo, setReturnTo] = useState(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const notify = (m) => { setToast(m); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), 4000); };

  const underwriteDeal = (deal) => {
    setUwModel(modelFromDeal(deal));
    setReturnTo("deals");
    setView("uw");
  };

  // role comes from team_members (RLS allowlist); only admins see the Team screen
  const [role, setRole] = useState(undefined);   // undefined = loading, null = not on the team
  useEffect(() => {
    supabase.from("team_members").select("role").eq("user_id", userId).maybeSingle().then(({ data }) => setRole(data?.role || null));
  }, [userId]);
  // invite links land here with a session in the URL; ask for a password once
  const [needsPassword, setNeedsPassword] = useState(() => /type=(invite|recovery)/.test(window.location.hash));

  const NAV = [["home", "Home"], ["deals", "Deals"], ["buyers", "Buyers"], ["contacts", "Contacts"], ["zcalc", "Zoning calc"], ["uw", "Underwriting"],
    ...(role === "admin" ? [["team", "Team"]] : [])];

  return (
    <>
      <div className="appShell">
        <aside className="sideBar">
          <div className="brandWrap brand">
            <img className="brandMark" src={LOGO} alt="JStone Realty" />
            <div>
              <div className="brandName">JSTONE REALTY</div>
              <div className="brandSub">Deal Platform</div>
            </div>
          </div>
          <nav>
            {NAV.map(([id, label]) => (
              <button key={id} className="navBtn" data-on={view === id}
                onClick={() => { if (id === "uw") setReturnTo(null); go(id); }}>{label}</button>
            ))}
          </nav>
          <div className="sideFoot">
            <div className="saveNote"><b>{displayName}</b><br />{user.email}</div>
            <div className="backupRow">
              <button className="tinyBtn" onClick={exportBackup}>Export</button>
              <button className="tinyBtn" onClick={() => supabase.auth.signOut()}>Sign out</button>
            </div>
          </div>
        </aside>
        <main>
          {toast && <div className="toast">{toast}</div>}
          {needsPassword && <SetPassword onDone={() => { setNeedsPassword(false); window.history.replaceState(null, "", window.location.pathname); }} />}
          {role === null && <div className="notice">Your login isn't on the team list yet. Ask an admin to invite you.</div>}

          {view === "home" && (
            <>
              <header className="pageHead"><h1>Welcome back</h1></header>
              {!userName && <NamePrompt onSaved={setUserName} />}
              <HomeSearch onOpen={go} />
              <TodayPanel onOpen={go} notify={notify} />
              <p className="homeIntro">Where do you want to work?</p>
              <div className="homeCards">
                <div className="homeCard" onClick={() => setView("deals")}>
                  <div className="hcTag">01</div>
                  <h2>Deal Desk</h2>
                  <p>Log a property while you're still on the phone. Live zoning, photos, one-tap share, a stage board, and the buyers that fit.</p>
                  <span className="hcGo">Open deals →</span>
                </div>
                <div className="homeCard" onClick={() => setView("buyers")}>
                  <div className="hcTag">02</div>
                  <h2>Buyers</h2>
                  <p>Your whole database with buy boxes — borough, what they buy, size, budget. Filter in a tap when a deal comes in.</p>
                  <span className="hcGo">Open buyers →</span>
                </div>
                <div className="homeCard" onClick={() => setView("zcalc")}>
                  <div className="hcTag">03</div>
                  <h2>Zoning Calc</h2>
                  <p>Fast check on a call — district, street, path, lot size. Buildable SF and $/BSF, as-of-right and with UAP.</p>
                  <span className="hcGo">Open calculator →</span>
                </div>
                <div className="homeCard" onClick={() => { setUwModel(blankModel()); setReturnTo(null); setView("uw"); }}>
                  <div className="hcTag">04</div>
                  <h2>Underwriting</h2>
                  <p>Full development model — buy or ground lease, unit mix, 485-x / UAP / MIH set-aside, hard / soft / carrying costs, NOI, debt, exit. Report / PDF in one click.</p>
                  <span className="hcGo">Open model →</span>
                </div>
                <div className="homeCard" onClick={() => setView("contacts")}>
                  <div className="hcTag">05</div>
                  <h2>Contacts</h2>
                  <p>Owners, buyers, brokers and lenders. Area, follow-up date, and a dated note for every call.</p>
                  <span className="hcGo">Open contacts →</span>
                </div>
              </div>
              <div className="homeNote">
                Open any deal and hit <b>Underwrite →</b> — the address, zoning, lot size, buildable SF, and asking price carry straight into the model. No retyping.
              </div>
              <div className="homeNote alt">
                <b>Signed in as {displayName}.</b> Everything you save syncs to your team database, so the same deals show up on your phone, your tablet, and anyone else's login. Deals you mark <b>Published</b> are visible to the team; <b>Private</b> ones stay yours alone.
              </div>
            </>
          )}

          {(view === "deals" || view === "buyers" || view === "zcalc") && (
            <DealDesk view={view} notify={notify} onUnderwrite={underwriteDeal} userId={userId} userName={displayName}
              openId={openTarget?.view === view ? openTarget.id : null} onOpened={() => setOpenTarget(null)} />
          )}

          {view === "team" && role === "admin" && <Team userId={userId} notify={notify} />}

          {view === "contacts" && (
            <Contacts notify={notify} userId={userId} userName={displayName} onGo={go}
              openId={openTarget?.view === "contacts" ? openTarget.id : null} onOpened={() => setOpenTarget(null)} />
          )}

          {view === "uw" && (
            <Underwriting
              key={uwModel.id}
              initialModel={uwModel}
              onExit={returnTo ? () => { setView(returnTo); setReturnTo(null); } : null}
              notify={notify}
              userId={userId}
              userName={displayName}
            />
          )}
        </main>
      </div>
    </>
  );
}

/* ============================================================
   HOME SEARCH — one box that looks through contacts (and their notes), buyers and deals
   "albanian" finds every contact whose notes say albanian. "notes albanian" looks in notes only.
   ============================================================ */
const parseSearch = (q) => {
  const t = (q || "").trim().toLowerCase();
  const m = t.match(/^notes?\s*:?\s+(.+)$/) || t.match(/^notes?:(.+)$/);
  return m ? { t: m[1].trim(), notesOnly: true } : { t, notesOnly: false };
};
// a short piece of the text around the match, with the match highlighted
function Snip({ text, t }) {
  const s = String(text || "");
  const i = s.toLowerCase().indexOf(t);
  if (i < 0 || !t) return <>{s.length > 120 ? s.slice(0, 117) + "…" : s}</>;
  const from = Math.max(0, i - 45), to = Math.min(s.length, i + t.length + 60);
  return <>{from > 0 ? "…" : ""}{s.slice(from, i)}<mark>{s.slice(i, i + t.length)}</mark>{s.slice(i + t.length, to)}{to < s.length ? "…" : ""}</>;
}

function HomeSearch({ onOpen }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const loading = useRef(false);
  const load = async () => {
    if (data || loading.current) return;
    loading.current = true;
    const [c, b, d] = await Promise.all([
      supabase.from("contacts").select("id, name, phone, email, address, area, type, contact_notes(id, body, noted_at)"),
      supabase.from("buyers").select("id, data"),
      supabase.from("deals").select("id, data"),
    ]);
    setData({
      contacts: (c.data || []).map(({ contact_notes, ...r }) => ({
        ...r, notes: [...(contact_notes || [])].sort((x, z) => (z.noted_at || "").localeCompare(x.noted_at || "")),
      })),
      buyers: (b.data || []).map((r) => ({ ...(r.data || {}), id: r.id })),
      deals: (d.data || []).map((r) => ({ ...(r.data || {}), id: r.id })),
    });
    loading.current = false;
  };
  useEffect(() => { if (q.trim().length >= 2) load(); }, [q]);

  const { t, notesOnly } = parseSearch(q);
  const active = t.length >= 2;
  const results = useMemo(() => {
    if (!active || !data) return [];
    const has = (v) => String(v || "").toLowerCase().includes(t);
    const out = [];
    for (const k of data.contacts) {
      if (!contactMatches(k, q)) continue;
      const n = matchingNote(k, q);
      out.push({ kind: "Contact", view: "contacts", id: k.id, title: k.name, sub: [k.phone, k.area, k.address].filter(Boolean).join(" · "), note: n?.body });
    }
    for (const x of data.buyers) {
      const noteHit = has(x.notes) ? x.notes : "";
      if (notesOnly ? !noteHit : !(noteHit || [x.name, x.company, x.phone, x.email].some(has))) continue;
      out.push({ kind: "Buyer", view: "buyers", id: x.id, title: x.name || "Unnamed buyer", sub: [x.company, x.phone].filter(Boolean).join(" · "), note: noteHit });
    }
    for (const x of data.deals) {
      const noteHit = [x.notes, x.followUpNotes].find(has) || "";
      if (notesOnly ? !noteHit : !(noteHit || [x.address, x.neighborhood, x.zone, x.contactName, x.contactPhone, x.contactEmail].some(has))) continue;
      out.push({ kind: "Deal", view: "deals", id: x.id, title: x.address || "Untitled deal", sub: [x.contactName, x.neighborhood].filter(Boolean).join(" · "), note: noteHit });
    }
    return out;
  }, [data, q, t, notesOnly, active]);

  return (
    <div className="homeSearch">
      <input className="search" placeholder="Search contacts, buyers, deals — names, phones, addresses, notes…"
        value={q} onChange={(e) => setQ(e.target.value)} onFocus={load} />
      {active && (
        <div className="today hsResults">
          <div className="todayHead">
            <h2>Search</h2>
            <span>{!data ? "Searching…" : `${results.length} result${results.length === 1 ? "" : "s"}`}</span>
          </div>
          {data && results.length === 0 && <div className="todayEmpty">Nothing matches “{q.trim()}”.</div>}
          {results.map((it) => (
            <div key={it.kind + it.id} className="todayRow" onClick={() => onOpen(it.view, it.id)}>
              <div className="todayTop"><span className={"tag kind " + it.kind.toLowerCase()}>{it.kind}</span></div>
              <div className="todayMain">
                <b>{it.title}</b>
                {it.sub && <div className="rowSub">{it.sub}</div>}
                {it.note && <div className="hsSnip"><b>Note</b><Snip text={it.note} t={t} /></div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   TODAY — follow-ups due today or overdue (contacts, buyers, deals)
   ============================================================ */
function TodayPanel({ onOpen, notify }) {
  const [items, setItems] = useState(null);
  const [showSoon, setShowSoon] = useState(false);
  useEffect(() => {
    (async () => {
      const t = todayISO();
      const wk = new Date(); wk.setDate(wk.getDate() + 7);
      const w = new Date(wk.getTime() - wk.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const [c, b, d] = await Promise.all([
        supabase.from("contacts").select("id, name, phone, email, area, address, follow_up_date, last_contacted").lte("follow_up_date", w),
        supabase.from("buyers").select("id, data"),
        supabase.from("deals").select("id, data"),
      ]);
      const out = [];
      for (const k of c.data || []) if (k.follow_up_date) out.push({ kind: "Contact", view: "contacts", id: k.id, title: k.name, sub: [k.area, k.address].filter(Boolean).join(" · "), date: k.follow_up_date, phone: k.phone, email: k.email, last: k.last_contacted });
      for (const r of b.data || []) { const x = r.data || {}; if (x.followUpDate && x.followUpDate <= w) out.push({ kind: "Buyer", view: "buyers", id: r.id, raw: x, title: x.name, sub: x.company || "", date: x.followUpDate, phone: x.phone, email: x.email, last: x.lastContacted }); }
      for (const r of d.data || []) { const x = r.data || {}; if (x.followUpDate && x.followUpDate <= w && stageOf(x) !== "Closed") out.push({ kind: "Deal", view: "deals", id: r.id, raw: x, title: x.address || "Untitled deal", sub: [x.contactName, stageOf(x)].filter(Boolean).join(" · "), date: x.followUpDate, phone: x.contactPhone, email: x.contactEmail, note: x.followUpNotes }); }
      out.sort((a, z) => a.date.localeCompare(z.date));
      setItems(out);
    })();
  }, []);

  // Done clears the date; Next moves it. Both count as "followed up today".
  const act = async (it, nextDate) => {
    const t = todayISO();
    let error;
    if (it.kind === "Contact") {
      ({ error } = await supabase.from("contacts").update({ follow_up_date: nextDate || null, last_contacted: t, updated_at: new Date().toISOString() }).eq("id", it.id));
    } else {
      const table = it.kind === "Buyer" ? "buyers" : "deals";
      const { data: row, error: e1 } = await supabase.from(table).select("data").eq("id", it.id).maybeSingle();
      if (e1 || !row) { notify?.(e1?.message || "Couldn't find that record."); return; }
      const extra = it.kind === "Buyer" ? { lastContacted: t } : { lastFollowUp: t };
      ({ error } = await supabase.from(table).update({ data: { ...row.data, followUpDate: nextDate || "", ...extra }, updated_at: new Date().toISOString() }).eq("id", it.id));
    }
    if (error) { notify?.(error.message || "Couldn't update."); return; }
    setItems((list) => (nextDate ? list.map((x) => (x.kind === it.kind && x.id === it.id ? { ...x, date: nextDate } : x)).sort((a, z) => a.date.localeCompare(z.date))
      : list.filter((x) => !(x.kind === it.kind && x.id === it.id))));
    notify?.(nextDate ? `${it.title}: next follow-up ${shortDay(nextDate)}` : `${it.title}: follow-up done ✓`);
  };

  if (!items) return null;
  const t = todayISO();
  const due = items.filter((x) => x.date <= t);
  const soon = items.filter((x) => x.date > t);
  const row = (it, isDue) => {
    const fu = followUpStatus(it.date);
    return (
      <div key={it.kind + it.id} className={"todayRow" + (isDue ? "" : " soonRow")} onClick={() => onOpen(it.view, it.id)}>
        <div className="todayTop">
          <span className={"tag kind " + it.kind.toLowerCase()}>{it.kind}</span>
          {fu && <div className={"followTag " + fu.cls}>● {fu.label}</div>}
        </div>
        <div className="todayMain">
          <b>{it.title}</b>
          {(it.sub || it.note) && <div className="rowSub">{[it.sub, it.note].filter(Boolean).join(" — ")}</div>}
        </div>
        <div className="todayActs">
          <QuickActions phone={it.phone} email={it.email} small />
          <FollowUpQuick compact onDone={() => act(it, null)} onNext={(x) => act(it, x)} />
        </div>
      </div>
    );
  };
  return (
    <div className="today">
      <div className="todayHead">
        <h2>Today</h2>
        <span>{due.length === 0 ? "Nothing due" : `${due.length} follow-up${due.length === 1 ? "" : "s"} due`}</span>
      </div>
      {due.length === 0 && <div className="todayEmpty">You're all caught up. Follow-up dates you set on contacts, buyers and deals show up here the day they're due.</div>}
      {due.map((it) => row(it, true))}
      {soon.length > 0 && (
        <>
          <button className="soonToggle" onClick={() => setShowSoon(!showSoon)}>
            {showSoon ? "▾" : "▸"} Coming up this week ({soon.length})
          </button>
          {showSoon && soon.map((it) => row(it, false))}
        </>
      )}
    </div>
  );
}

function SetPassword({ onDone }) {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const save = async () => {
    if (pw.length < 8) return setMsg("At least 8 characters.");
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return setMsg(error.message);
    onDone();
  };
  return (
    <div className="notice" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span><b>Welcome to the team.</b> Choose a password for next time:</span>
      <input type="password" style={{ width: 200 }} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      <button className="primary" onClick={save}>Save password</button>
      {msg && <span style={{ color: RED }}>{msg}</span>}
    </div>
  );
}

function NamePrompt({ onSaved }) {
  const [v, setV] = useState("");
  const [done, setDone] = useState(false);
  if (done) return null;
  const save = async () => {
    if (!v.trim()) return;
    await supabase.auth.updateUser({ data: { full_name: v.trim() } });
    onSaved(v.trim());
    setDone(true);
  };
  return (
    <div className="notice" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span>Add your name so it shows on the deals you post:</span>
      <input style={{ width: 180 }} value={v} onChange={(e) => setV(e.target.value)}
        placeholder="Joel Beer" onKeyDown={(e) => e.key === "Enter" && save()} />
      <button className="primary" onClick={save} disabled={!v.trim()}>Save name</button>
      <button className="ghost" onClick={() => setDone(true)}>Later</button>
    </div>
  );
}

/* ============================================================
   STYLES
   ============================================================ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Source+Serif+4:wght@600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
*{box-sizing:border-box}
body{margin:0;background:${PAPER};color:${INK};font-family:'Archivo',-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}
button{font-family:inherit;cursor:pointer}
input,select,textarea{font-family:inherit;font-size:16px;width:100%;padding:9px 11px;border:1px solid ${LINE};border-radius:7px;background:#fff;color:${INK};outline:none}
input:focus,select:focus,textarea:focus{border-color:${BLUE};box-shadow:0 0 0 3px rgba(36,86,200,.12)}
.center{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:${PAPER};color:${INK};font-family:'Archivo',-apple-system,'Segoe UI',sans-serif}
.authCard{background:#fff;border:1px solid ${LINE};border-radius:14px;padding:30px 28px;width:370px;max-width:92vw;box-shadow:0 10px 34px rgba(16,27,45,.10)}
.authCard .field{margin-bottom:12px}
.appShell{display:flex;min-height:100vh}
.sideBar{width:210px;flex-shrink:0;background:${INK};color:#EDEDE8;display:flex;flex-direction:column;padding:22px 14px;position:sticky;top:0;height:100vh}
.sideBar nav{display:flex;flex-direction:column;gap:4px;flex:1}
.brand{display:flex;gap:10px;align-items:center}
.brandWrap{margin-bottom:28px}
.brandMark{width:29px;height:40px;object-fit:contain;display:block;flex-shrink:0}
.brandName{font-size:12px;font-weight:800;letter-spacing:.12em}
.brandSub{font-size:11px;opacity:.55;letter-spacing:.04em}
.navBtn{background:none;border:none;color:inherit;padding:10px 12px;border-radius:8px;font-size:14px;font-weight:600;text-align:left;opacity:.7}
.navBtn:hover{opacity:1;background:rgba(255,255,255,.06)}
.navBtn[data-on="true"]{opacity:1;background:${BLUE}}
.sideFoot{margin-top:12px}
.saveNote{font-size:11px;opacity:.5;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis}
.backupRow{display:flex;gap:6px}
.tinyBtn{flex:1;background:none;border:1px solid rgba(255,255,255,.2);color:#EDEDE8;padding:6px 8px;border-radius:7px;font-size:11.5px;font-weight:600}
.tinyBtn:hover{border-color:rgba(255,255,255,.5)}
main{flex:1;padding:28px 32px 60px;max-width:1180px;min-width:0}
.pageHead{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;gap:12px;flex-wrap:wrap}
.pageHead h1{margin:0;font-size:26px;font-weight:800;letter-spacing:-.01em}
.primary{background:${BLUE};color:#fff;border:none;padding:10px 16px;border-radius:8px;font-weight:700;font-size:14px}
.primary:hover{background:#1c46a6}
.primary:disabled{opacity:.4;cursor:default}
.ghost{background:none;border:1px solid ${LINE};padding:10px 14px;border-radius:8px;font-weight:600;font-size:14px;color:${INK}}
.ghost:hover{border-color:${INK}}
.ghost:disabled{opacity:.4;cursor:default}
.danger{background:none;border:1px solid #d8b4b4;color:#a33;padding:10px 14px;border-radius:8px;font-weight:600;font-size:14px}
.mini{background:none;border:1px solid ${LINE};border-radius:7px;padding:0 12px;font-size:12px;font-weight:600;white-space:nowrap;color:${INK}}
.mini:hover{border-color:${BLUE};color:${BLUE}}
.homeIntro{margin:0 0 18px;opacity:.65;font-size:15px}
.homeCards{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}
.homeCard{background:#fff;border:1px solid ${LINE};border-radius:12px;padding:22px;cursor:pointer;transition:.15s}
.homeCard:hover{border-color:${BLUE};box-shadow:0 6px 22px rgba(16,27,45,.09);transform:translateY(-2px)}
.hcTag{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#9C7A2E;letter-spacing:.14em}
.homeCard h2{font-family:'Source Serif 4',serif;font-size:22px;margin:6px 0 8px}
.homeCard p{margin:0 0 14px;font-size:13.5px;line-height:1.55;opacity:.7}
.hcGo{font-size:13px;font-weight:700;color:${BLUE}}
.homeNote{margin-top:22px;background:#EEF3E6;border:1px solid #CBD8B4;border-radius:9px;padding:12px 16px;font-size:13.5px;line-height:1.5}
.homeNote.alt{background:#F3F0E4;border-color:#DDD0AC;margin-top:12px}
.filterRow{display:flex;flex-direction:column;gap:10px;margin-bottom:20px}
.search{max-width:480px}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{background:#fff;border:1px solid ${LINE};border-radius:20px;padding:5px 13px;font-size:13px;font-weight:600;color:${INK}}
.chip[data-on="true"]{background:${INK};color:#fff;border-color:${INK}}
.tag{display:inline-block;background:${INK};color:#fff;font-size:11px;font-weight:700;letter-spacing:.04em;padding:2px 8px;border-radius:4px}
.tag.alt{background:#fff;color:${BLUE};border:1px solid ${BLUE}}
.tag.path{background:#F2EEE0;color:#7A5F22;border:1px solid #DDD0AC}
.tag.priv{background:#fff;color:#6A6558;border:1px solid ${LINE}}
.tag.pub{background:#2E7D5B}
.tag.shared{background:#6A6558}
.byline{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;color:#5A5648;background:#F2F0E8;border:1px solid ${LINE};border-radius:20px;padding:2px 9px}
.byline i{width:16px;height:16px;border-radius:50%;background:${INK};color:#fff;font-style:normal;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center}
.chip.small{padding:4px 11px;font-size:12px}
.filterLabel{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;opacity:.5;margin-bottom:6px;display:flex;gap:10px;align-items:baseline}
.clearLink{color:${BLUE};opacity:1;letter-spacing:0;text-transform:none;font-size:12px;font-weight:700;cursor:pointer}
.resultCount{font-size:12.5px;font-weight:600;opacity:.55}
.tag.alt[data-hit="true"]{background:${BLUE};color:#fff}
.tag.type{background:#F2EEE0;color:#7A5F22;border:1px solid #DDD0AC}
.tag.area{background:#fff;color:${INK};border:1px solid ${INK}}
.lastNote{font-size:12.5px;opacity:.7;margin-top:4px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.lastNote b{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:11px;opacity:.8;margin-right:6px}
.noteAdd{display:flex;flex-direction:column;gap:8px}
.noteAddRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.noteAddRow input[type=date]{width:auto;flex:0 0 170px}
.noteLog{margin-top:14px;display:flex;flex-direction:column}
.noteItem{display:flex;gap:12px;padding:10px 0;border-top:1px solid ${LINE};font-size:14px;line-height:1.45}
.noteDate{font-family:'IBM Plex Mono',monospace;font-size:11.5px;font-weight:600;color:#9C7A2E;flex:0 0 78px;padding-top:2px}
.noteWho{font-size:11px;opacity:.5;margin-top:3px}
.convertRow{display:flex;flex-direction:column;gap:8px}
.convertRow .ghost{text-align:left;background:#fff}
.teamList{display:flex;flex-direction:column}
.teamRow{display:flex;gap:12px;align-items:center;padding:12px 0;border-top:1px solid ${LINE};flex-wrap:wrap}
.teamRow:first-child{border-top:none;padding-top:2px}
.avatar{width:34px;height:34px;border-radius:50%;background:${INK};color:#fff;font-style:normal;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.youTag{margin-left:6px;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;background:#F2EEE0;color:#7A5F22;border:1px solid #DDD0AC;border-radius:4px;padding:1px 6px}
.statusTag{font-size:11.5px;font-weight:700;margin-top:4px}
.statusTag.active{color:${GREEN}}
.statusTag.invited{color:#9C6B0B}
.teamCtl{display:flex;gap:8px;align-items:center;margin-left:auto}
.teamCtl select{width:130px;font-size:14px;padding:7px 9px}
.danger.small{padding:7px 11px;font-size:13px}
.roleList{display:flex;flex-direction:column;gap:6px}
.roleList .visBtn{flex:0 0 auto}
.visRow{display:flex;gap:10px;flex-wrap:wrap}
.visBtn{flex:1 1 180px;text-align:left;background:#fff;border:1px solid ${LINE};border-radius:9px;padding:11px 14px;color:${INK}}
.visBtn b{display:block;font-size:14px}
.visBtn span{display:block;font-size:11.5px;opacity:.6;margin-top:2px}
.visBtn[data-on="true"]{border-color:${BLUE};background:#F4F7FE;box-shadow:0 0 0 2px rgba(36,86,200,.12)}
.ghost[data-on="true"]{border-color:#2E7D5B;color:#2E7D5B}
.tag.green{background:#2E7D5B}
.followTag{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;letter-spacing:.02em;padding:3px 9px;border-radius:20px;margin-top:8px;width:fit-content}
.followTag.overdue{background:#FBEAE8;color:${RED}}
.followTag.due{background:#FDEFD8;color:#9C6B0B}
.followTag.soon{background:#FDEFD8;color:#9C6B0B;opacity:.8}
.followTag.upcoming{background:#EAF0FB;color:${BLUE}}
.followTag.inForm{margin-top:10px;font-size:12.5px}
.cardStats > div[data-hi="false"]{opacity:.45}
.zcell[data-dim="true"]{opacity:.45}
.empty{padding:40px 20px;text-align:center;opacity:.55;font-size:14px;max-width:480px;margin:0 auto;line-height:1.5}
.notice{background:#EEF3E6;border:1px solid #CBD8B4;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:14px}
.cardGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
.card{background:#fff;border:1px solid ${LINE};border-radius:10px;padding:16px;cursor:pointer;transition:.15s}
.card:hover{box-shadow:0 4px 16px rgba(16,27,45,.1);transform:translateY(-1px)}
.cardPhoto{width:calc(100% + 32px);margin:-16px -16px 12px;height:150px;object-fit:cover;border-radius:10px 10px 0 0;display:block}
.cardTop{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;align-items:center}
.shareBtn{margin-left:auto;background:none;border:1px solid ${BLUE};color:${BLUE};border-radius:6px;padding:3px 10px;font-size:12px;font-weight:700}
.shareBtn:hover{background:${BLUE};color:#fff}
.cardAddr{font-size:17px;font-weight:800;line-height:1.2}
.cardSub{font-size:13px;opacity:.6;margin-top:2px}
.cardStats{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;margin:12px 0;font-size:13px}
.cardStats label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;opacity:.5}
.cardFoot{display:flex;justify-content:space-between;font-size:12px;color:${BLUE};font-weight:600;border-top:1px solid ${LINE};padding-top:8px}
.rowList{display:flex;flex-direction:column;gap:6px}
.row{display:flex;gap:14px;align-items:center;background:#fff;border:1px solid ${LINE};border-radius:9px;padding:12px 16px;cursor:pointer;font-size:14px;flex-wrap:wrap}
.row:hover{border-color:${BLUE}}
.rowSub{font-size:12px;opacity:.55}
.formCols{display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap}
.formMain{flex:1 1 420px;min-width:0}
.formSide{flex:0 1 340px;min-width:280px}
.fgroup{background:#fff;border:1px solid ${LINE};border-radius:10px;padding:16px 18px;margin-bottom:14px}
.ftitle{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:${BLUE};margin-bottom:12px}
.frow{display:flex;gap:12px;flex-wrap:wrap}
.field{flex:1 1 160px;margin-bottom:10px}
.flabel{display:block;font-size:12px;font-weight:600;margin-bottom:4px;opacity:.75}
.hintline{font-size:12px;opacity:.55;margin-top:8px;line-height:1.4}
.photoGrid{display:flex;gap:10px;flex-wrap:wrap}
.photoThumb{position:relative;width:112px;height:84px;border-radius:8px;overflow:hidden;border:1px solid ${LINE}}
.photoThumb img{width:100%;height:100%;object-fit:cover;display:block}
.photoX{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(16,27,45,.75);color:#fff;font-size:15px;line-height:1}
.coverTag{position:absolute;bottom:0;left:0;background:${BLUE};color:#fff;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 6px;border-radius:0 6px 0 0}
.photoAdd{width:112px;height:84px;border:2px dashed ${LINE};border-radius:8px;background:none;color:${INK};font-size:13px;font-weight:600;opacity:.7}
.photoAdd:hover{border-color:${BLUE};color:${BLUE};opacity:1}
.zpanel{background:${INK};color:#EDEDE8;border-radius:10px;padding:16px 18px;
  background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:22px 22px}
.zpanelTitle{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;opacity:.7;margin-bottom:12px}
.zgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.zcell label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;opacity:.55;margin-bottom:3px}
.znum{font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:600}
.zcell.big .znum{font-size:24px}
.znum.brass{color:#D6B45C}
.znum small{font-size:12px;opacity:.6}
.zfoot{margin-top:12px;font-size:11px;opacity:.5;line-height:1.4}
.matchRow{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:13px}
.matchRow span{opacity:.6}
.uw .eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.18em;color:#9C7A2E;text-transform:uppercase}
.dealline{display:flex;align-items:center;gap:8px;margin-top:4px}
.dealline span{font-size:12px;opacity:.55;min-width:48px}
.dealline input{font-size:14px;border:none;border-bottom:1px dashed ${LINE};border-radius:0;padding:3px 0;background:transparent;max-width:280px}
.dealline input:focus{box-shadow:none;border-bottom-color:${BLUE}}
.savedStrip{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.savedChip{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid ${LINE};border-radius:20px;padding:5px 12px;font-size:12.5px;cursor:pointer}
.savedChip:hover{border-color:${BLUE}}
.savedChip b{opacity:.4;font-size:11px}
.savedChip b:hover{color:#a33;opacity:1}
.segRow{display:flex;gap:22px;flex-wrap:wrap;margin-bottom:20px}
.segLabel{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;opacity:.5;margin-bottom:6px}
.seg{display:flex;border:1px solid ${LINE};border-radius:7px;overflow:hidden;background:#fff}
.seg button{border:none;border-right:1px solid ${LINE};background:none;padding:8px 15px;font-size:13.5px;font-weight:600;color:${INK};opacity:.6}
.seg button:last-child{border-right:none}
.seg button[data-on="true"]{background:${INK};color:#fff;opacity:1}
.uwGrid{display:grid;grid-template-columns:1fr 350px;gap:24px;align-items:start}
.sec{background:#fff;border:1px solid ${LINE};border-radius:10px;margin-bottom:12px;overflow:hidden}
.secHead{display:flex;align-items:center;gap:12px;padding:14px 18px;cursor:pointer;user-select:none}
.secNum{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#9C7A2E;border:1px solid ${LINE};border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.secTitle{font-family:'Source Serif 4',serif;font-size:17px;font-weight:700;flex:1}
.secChev{opacity:.4;font-size:11px;transition:.2s}
.secBody{padding:4px 18px 18px;border-top:1px solid ${LINE}}
.fg2{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;margin-top:12px}
.fg1{display:grid;grid-template-columns:1fr;margin-top:12px}
.uwField label{display:flex;justify-content:space-between;gap:8px;font-size:12px;font-weight:600;opacity:.8;margin-bottom:4px}
.uwField label em{font-style:normal;font-weight:400;opacity:.6;font-size:10.5px}
.uwField input,.uwField select{font-family:'IBM Plex Mono',monospace;font-size:13.5px}
.derived{font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:${BLUE};margin-top:12px;padding-top:12px;border-top:1px dashed ${LINE};line-height:1.5}
.derived.brassText{color:#9C7A2E}
.rrHead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9C7A2E;margin:14px 0 8px}
.rrHead em{font-style:normal;font-family:'Archivo',sans-serif;font-size:11px;letter-spacing:0;text-transform:none;opacity:.55;color:${INK}}
.tableWrap{overflow-x:auto;border:1px solid ${LINE};border-radius:8px}
table.rr{width:100%;border-collapse:collapse;font-size:12.5px;min-width:420px}
table.rr th,table.rr td{padding:6px;text-align:center;border-bottom:1px solid ${LINE}}
table.rr thead th{font-family:'IBM Plex Mono',monospace;font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;opacity:.55;font-weight:500;background:#F6F5F1}
table.rr td:first-child,table.rr th:first-child{text-align:left;padding-left:10px;white-space:nowrap;opacity:.8}
table.rr input{font-family:'IBM Plex Mono',monospace;font-size:12px;padding:5px 4px;text-align:center;min-width:56px}
table.rr tbody tr:last-child td{border-bottom:none}
.subnote{font-size:11.5px;opacity:.55;margin-top:8px;line-height:1.5}
.uwSum{position:sticky;top:20px;border:1px solid #9C7A2E;border-radius:10px;background:${INK};color:#EDEDE8;overflow:hidden}
.sumHead{display:flex;justify-content:space-between;align-items:baseline;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.12);font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;opacity:.75}
.divLabel{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#D6B45C;margin:16px 0 4px}
.ledger{display:flex;justify-content:space-between;align-items:baseline;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:13px}
.ledger span{opacity:.7}
.ledger b{font-family:'IBM Plex Mono',monospace;font-weight:500}
.ledger.total{border-bottom:none;border-top:1px solid rgba(255,255,255,.2);margin-top:4px;padding-top:11px}
.ledger.total span{font-family:'Source Serif 4',serif;font-size:15px;opacity:1;font-weight:600}
.ledger.total b{font-size:16px;font-weight:600;color:#D6B45C}
.profit{margin-top:16px;padding:16px;border-radius:8px;text-align:center;background:rgba(132,180,130,.1);border:1px solid #84B482}
.profit.neg{background:rgba(196,119,100,.1);border-color:#C47764}
.profit .pl{font-size:11px;text-transform:uppercase;letter-spacing:.1em;opacity:.7}
.profit .pv{font-family:'Source Serif 4',serif;font-size:29px;font-weight:700;color:#84B482;margin-top:4px}
.profit.neg .pv{color:#C47764}
.mcards{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
.mcard{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:11px}
.ml{font-size:10px;text-transform:uppercase;letter-spacing:.08em;opacity:.55}
.mv{font-family:'IBM Plex Mono',monospace;font-size:18px;margin-top:3px}
.mv[data-good="true"]{color:#84B482}
.mv[data-good="false"]{color:#C47764}
.foot{margin-top:28px;font-size:11.5px;opacity:.5;text-align:center}
.modalWrap{position:fixed;inset:0;background:rgba(16,27,45,.6);display:flex;align-items:flex-start;justify-content:center;padding:30px 16px;z-index:50;overflow-y:auto}
.modal{background:#fff;border-radius:14px;padding:18px;width:420px;max-width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)}
.modalHead{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:${BLUE};margin-bottom:14px}
.modalX{background:none;border:none;font-size:24px;line-height:1;opacity:.5}
.sharePhoto{width:100%;height:170px;object-fit:cover;border-radius:9px;margin-bottom:12px;display:block}
.shareText{font-family:'IBM Plex Mono',monospace;font-size:13px;line-height:1.55;resize:vertical}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:${INK};color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;z-index:60;box-shadow:0 6px 24px rgba(0,0,0,.25);max-width:90vw;text-align:center}
.sheet{background:#fffefb;color:#1c1a15;padding:48px;border-radius:5px;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.shTop{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #c9a267;padding-bottom:18px;margin-bottom:26px}
.shLogo{height:56px;width:auto;display:block;margin-bottom:14px}
.shBrand{font-size:12px;font-weight:700;letter-spacing:.1em;color:#8a6f45;text-transform:uppercase}
.shTitle{font-family:'Source Serif 4',serif;font-size:32px;font-weight:700;margin:6px 0 4px;line-height:1.15}
.shSub{font-size:14px;color:#6a6558}
.shDate{font-size:13px;color:#8a8577;white-space:nowrap}
.shSec{margin-bottom:26px}
.shH{font-size:12px;font-weight:700;letter-spacing:.09em;color:#8a6f45;text-transform:uppercase;margin-bottom:12px;border-bottom:1px solid #ddd6c4;padding-bottom:7px}
.shGrid{display:grid;grid-template-columns:1fr 1fr;gap:6px 30px}
.shRow{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px dotted #ddd6c4;font-size:14px}
.shRow span{color:#5a5648}
.shRow b{font-weight:700}
.shTable{width:100%;border-collapse:collapse;font-size:14px}
.shTable th,.shTable td{padding:8px;text-align:center;border-bottom:1px dotted #ddd6c4}
.shTable thead th{font-size:11px;font-weight:700;color:#8a6f45;text-transform:uppercase;letter-spacing:.05em}
.shTable td:first-child,.shTable th:first-child{text-align:left;color:#5a5648}
.shHl{background:#f5efdf;border:1px solid #ddd0ac;border-radius:5px;padding:18px 22px;margin-top:12px;display:flex;justify-content:space-between;align-items:center}
.shHl span{font-size:12px;font-weight:700;color:#6a6558;text-transform:uppercase;letter-spacing:.07em}
.shHl b{font-family:'Source Serif 4',serif;font-size:32px;color:#7a5a24}
.shFoot{font-size:11.5px;color:#8a8577;line-height:1.7;margin-top:26px;border-top:1px solid #ddd6c4;padding-top:14px}
.sheetActions{display:flex;gap:8px;justify-content:flex-end;padding:14px 0;flex-wrap:wrap}
.sheetActions .ghost{background:#fff}
@media print{
  body.uwPrint > *:not(.uwPortal){display:none !important}
  body.uwPrint{background:#fff}
  .uwPortal .modalWrap{position:static;background:none;padding:0;overflow:visible;display:block}
  .uwPortal .modalWrap > div{width:100% !important}
  #uw-sheet{box-shadow:none}
  .sheetActions{display:none}
}
@media (max-width:900px){.uwGrid{grid-template-columns:1fr}.uwSum{position:static}}
/* ---- quick actions, last contacted ---- */
.qa{display:flex;gap:6px;flex-wrap:wrap}
.qaBtn{display:inline-flex;align-items:center;justify-content:center;min-width:54px;padding:7px 12px;border:1px solid ${LINE};border-radius:20px;background:#fff;color:${BLUE};font-size:13px;font-weight:700;text-decoration:none;line-height:1}
.qaBtn:hover{border-color:${BLUE}}
.qa.small .qaBtn{min-width:0;padding:5px 10px;font-size:12px}
.fgroup > .qa{margin-top:4px}
.lastTag{display:inline-flex;font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:20px;background:#EEF3E6;color:#2E7D5B;width:fit-content}
.lastTag.cold{background:#FBEAE8;color:${RED}}
.lastTag.never{background:#F1EFE8;color:#6A6558}
.dateWithBtn{display:flex;gap:6px}
.dateWithBtn input{flex:1;min-width:0}
.dateWithBtn .ghost{padding:8px 12px;font-size:13px;flex:0 0 auto}
/* ---- today ---- */
.today{background:#fff;border:1px solid ${LINE};border-radius:12px;padding:16px 18px;margin-bottom:22px}
.todayHead{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.todayHead h2{margin:0;font-size:18px;font-weight:800}
.todayHead span{font-size:12.5px;font-weight:700;opacity:.55}
.todayEmpty{font-size:13.5px;opacity:.6;padding:6px 0 2px;line-height:1.45}
.todayRow{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid ${LINE};cursor:pointer;flex-wrap:wrap}
.todayRow:first-of-type{border-top:none}
.todayRow .followTag{margin-top:0}
.todayMain{flex:1 1 180px;min-width:0}
.tag.kind{flex:0 0 auto;min-width:58px;text-align:center}
.homeSearch{margin-bottom:18px}
.homeSearch .search{max-width:none;width:100%}
.hsResults{margin-top:10px;margin-bottom:0}
.hsSnip{font-size:12.5px;opacity:.8;margin-top:4px;line-height:1.4}
.hsSnip b{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:11px;opacity:.8;margin-right:6px}
.hsSnip mark{background:#F6E7B8;color:inherit;padding:0 1px;border-radius:2px}
.notesBox textarea{min-height:96px}
.tag.kind.contact{background:#F2EEE0;color:#7A5F22;border:1px solid #DDD0AC}
.tag.kind.buyer{background:#fff;color:${BLUE};border:1px solid ${BLUE}}
.tag.kind.deal{background:${INK}}
/* ---- deals board ---- */
.seg{display:inline-flex;border:1px solid ${LINE};border-radius:8px;overflow:hidden;background:#fff}
.seg button{border:none;background:none;padding:9px 14px;font-size:13.5px;font-weight:700;color:${INK};opacity:.6}
.seg button[data-on="true"]{background:${INK};color:#fff;opacity:1}
.tag.stage{background:#EAF0FB;color:${BLUE}}
.board{display:grid;grid-template-columns:repeat(6,minmax(150px,1fr));gap:10px;overflow-x:auto;padding-bottom:10px;align-items:start}
.boardCol{background:#EFEBDF;border-radius:10px;padding:8px;min-height:120px;transition:.15s}
.boardCol[data-drop="1"]{outline:2px dashed #C9C2AE;outline-offset:-2px}
.boardHead{display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:2px 4px 10px;opacity:.75}
.boardHead b{background:#fff;border-radius:20px;padding:1px 8px;font-size:11px}
.boardEmpty{font-size:12px;opacity:.4;padding:14px 4px;text-align:center}
.boardCard{background:#fff;border:1px solid ${LINE};border-radius:9px;padding:11px 12px;margin-bottom:8px;cursor:pointer}
.boardCard:hover{border-color:${INK}}
.boardPhoto{width:100%;height:90px;object-fit:cover;border-radius:6px;margin-bottom:8px;display:block}
.boardAddr{font-weight:800;font-size:14.5px;line-height:1.25}
.boardSub{font-size:12px;opacity:.55;margin-top:2px}
.boardMeta{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px;font-size:13px;font-weight:700}
.matchCount{white-space:nowrap;font-size:11px;font-weight:700;color:#2E7D5B;background:#EEF3E6;padding:2px 8px;border-radius:20px}
.boardCard .followTag{margin-top:6px}
.stageSel{margin-top:9px;width:100%;font-size:12.5px;padding:6px 8px}
/* ---- buyers that fit (dark panel) ---- */
.matchHint{font-size:12px;opacity:.6;margin:-6px 0 8px;line-height:1.4}
.matchRow .matchMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.matchRow span.matchCo{opacity:.6;font-weight:400}
.matchHits{display:flex;gap:4px;flex-wrap:wrap}
.matchRow span.hit{opacity:1;font-size:11px;font-weight:700;color:#BFE3CF;background:rgba(46,125,91,.28);padding:1px 7px;border-radius:20px}
.matchRow span.hit.open{color:#EDEDE8;background:rgba(255,255,255,.1)}
.matchRow span.lastTag{opacity:1;font-size:10.5px;padding:1px 7px;background:rgba(255,255,255,.1);color:#EDEDE8}
.matchRow span.lastTag.never{background:rgba(255,255,255,.06);color:#B9B8B0}
.matchRow span.lastTag.cold{background:rgba(224,80,64,.25);color:#FFC9C1}
.matchRow{flex-direction:column;align-items:stretch;gap:7px;padding:10px 0}
.matchRow .matchMain{gap:5px}
.zpanel .qaBtn{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.18);color:#fff}

.linkBtn{display:block;background:none;border:none;color:#D6B45C;font-weight:700;font-size:12.5px;padding:10px 0 0;text-decoration:none;text-align:left}
@media (max-width:760px){
  .board{grid-template-columns:repeat(6,78vw);scroll-snap-type:x mandatory}
  .boardCol{scroll-snap-align:start}
  .todayRow .qa{width:100%}
  .zpanel .qa{flex-wrap:wrap}
  .seg button{padding:8px 11px}
  .appShell{flex-direction:column}
  .sideBar{width:100%;height:auto;position:static;flex-direction:row;align-items:center;padding:12px 14px;gap:10px;overflow-x:auto}
  .brandWrap{margin-bottom:0}
  .sideBar nav{flex-direction:row;flex:1}
  .sideFoot{margin-top:0}
  .saveNote{display:none}
  .backupRow{flex-direction:column}
  .navBtn{padding:8px 10px;font-size:13px;white-space:nowrap}
  main{padding:18px 14px 50px}
  .fg2{grid-template-columns:1fr}
  .shGrid{grid-template-columns:1fr}
  .sheet{padding:26px}
}
/* ---- Oct 26: follow-up quick actions, lookup, street pick, board extras ---- */
.todayRow{flex-direction:column;align-items:stretch;gap:6px;padding:12px 0}
.todayTop{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.todayActs{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-top:2px}
.todayRow.soonRow{opacity:.85}
.todayRow .todayMain{flex:0 0 auto}
.todayActs .qa{width:auto !important}
.todayActs .fuq.compact{margin-top:0}
.soonToggle{display:block;width:100%;text-align:left;background:none;border:none;border-top:1px solid ${LINE};padding:11px 0 4px;font-size:13px;font-weight:700;color:${INK};opacity:.65}
.fuq{display:flex;flex-direction:column;gap:6px}
.fuq.compact{margin-top:6px}
.fuqBtns{display:flex;gap:6px;flex-wrap:wrap}
.fuqBtns button{border-radius:20px;font-size:12.5px;font-weight:700;padding:6px 12px;line-height:1;border:1px solid ${LINE};background:#fff;color:${INK}}
.fuq .fuqDone{background:${GREEN};border-color:${GREEN};color:#fff}
.fuq .fuqDone:hover{filter:brightness(1.08)}
.fuq .fuqNext[data-on="true"]{background:${INK};border-color:${INK};color:#fff}
.fuqPick{display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:#F6F4EE;border:1px solid ${LINE};border-radius:10px;padding:8px}
.fuqPick button{border:1px solid ${LINE};background:#fff;border-radius:20px;padding:6px 10px;font-size:12.5px;font-weight:600;color:${INK}}
.fuqPick button:hover{border-color:${INK}}
.fuqDate{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;opacity:.8}
.fuqDate input{width:150px;padding:5px 8px;font-size:14px}
.fgroup .fuq{margin-top:10px}
.boardCard .fuqBtns button{padding:5px 10px;font-size:12px}
.boardCard .fuqPick{padding:6px}
.boardSeller{font-size:12.5px;font-weight:600;margin-top:3px;color:${INK};opacity:.8}
.boardSeller:before{content:"👤 ";opacity:.7}
.boardBsf{font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;color:${BRASS};margin-top:5px;letter-spacing:.01em}
.boardBsf.none{color:#A09C90;font-weight:500}
.tag.seller{background:#EAF0FB;color:${BLUE}}
.lookBox{margin:4px 0 12px;border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.45;border:1px solid ${LINE};background:#fff}
.lookBox.busy{color:#6A6558;background:#F6F4EE}
.lookBox.busy:before{content:"";display:inline-block;width:9px;height:9px;border-radius:50%;border:2px solid ${BLUE};border-right-color:transparent;margin-right:8px;animation:spin .8s linear infinite;vertical-align:-1px}
@keyframes spin{to{transform:rotate(360deg)}}
.lookBox.warn{background:#FDF3E3;border-color:#F0D9AE;color:#7A5410}
.lookBox.found{background:#F3F8F4;border-color:#CFE3D6}
.lookHead{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline}
.lookHead b{font-size:13.5px;color:${GREEN}}
.lookHead span{font-family:'IBM Plex Mono',monospace;font-size:11px;opacity:.6}
.lookFacts{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;margin:8px 0 6px}
.lookFacts span{font-size:13px;font-weight:600}
.lookFacts label{display:block;font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;opacity:.5;font-weight:600}
.lookOwner{font-size:12.5px;margin-top:4px}
.lookLinks{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:8px}
.lookLinks a{color:${BLUE};font-weight:700;font-size:13px;text-decoration:none}
.lookLinks.solo{margin:-4px 0 12px}
.lookAlt{margin-top:8px;font-size:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;opacity:.9}
.lookNote{margin-top:8px;font-size:11.5px;opacity:.6}
.lookDiff{margin-top:8px;font-size:12.5px;background:#FDF3E3;border:1px solid #F0D9AE;color:#7A5410;border-radius:8px;padding:6px 9px}
.linkBtn.inline{display:inline;padding:0 0 0 4px;color:${BLUE};font-size:12.5px}
.lookLinks .linkBtn.inline{padding:0}
.streetPick{margin-top:12px}
.streetPick .seg button{padding:9px 16px}
@media (max-width:760px){
  .lookFacts{grid-template-columns:1fr}
  .fuqDate input{width:140px}
}

/* ---- underwriting v2 ---- */
.uwGrid>*{min-width:0}
.mini.tall{padding:7px 12px}
.mono{font-family:'IBM Plex Mono',monospace;font-size:12px}
table.rr td.bad{color:${RED};font-weight:700}
table.rr tr.tot td{font-weight:700;background:#F6F5F1;font-family:'IBM Plex Mono',monospace;font-size:11.5px}
table.rr.num td{font-family:'IBM Plex Mono',monospace;font-size:12px}
table.bud{min-width:560px}
table.bud td{text-align:right;font-family:'IBM Plex Mono',monospace;font-size:11.5px;white-space:nowrap}
table.bud td:first-child{text-align:left;font-family:inherit;white-space:normal;font-size:12.5px;opacity:1}
table.bud th:not(:first-child){text-align:right}
table.bud tr.sub td{opacity:.6;font-size:11px}
table.bud tr.sub td:first-child{padding-left:22px;font-size:11.5px}
table.bud tr.head td{font-weight:700}
table.bud tr.sub2 td{font-weight:700;background:#F6F5F1}
table.bud tr.tot td{font-weight:800;border-top:2px solid ${INK};background:#F1EEE4}
table.sens td{font-family:'IBM Plex Mono',monospace;font-size:11.5px;line-height:1.25}
table.sens td small{display:block;opacity:.55;font-size:10px}
table.sens td.neg{color:${RED}}
table.sens td.base{outline:2px solid #9C7A2E;outline-offset:-2px;font-weight:700}
.amiSel{width:auto;padding:4px 8px;font-size:12px;font-family:'IBM Plex Mono',monospace}
.chk{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
.chk>div{border:1px solid ${LINE};border-radius:8px;padding:9px 10px;background:#FBFAF7}
.chk span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;opacity:.55}
.chk b{display:block;font-family:'IBM Plex Mono',monospace;font-size:15px;margin-top:2px}
.chk em{display:block;font-style:normal;font-size:10.5px;opacity:.6;margin-top:2px}
.chk>div.ok{border-color:#84B482;background:rgba(132,180,130,.08)}
.chk>div.ok b{color:${GREEN}}
.chk>div.no{border-color:#C47764;background:rgba(196,119,100,.08)}
.chk>div.no b{color:${RED}}
.warn{margin-top:10px;font-size:12px;color:${RED};font-weight:600}
.ledger b small{font-size:10.5px;opacity:.5;margin-left:7px;font-weight:400}
.divLabel i{font-style:normal;opacity:.5;letter-spacing:.06em;margin-left:6px;color:#EDEDE8}
.shKpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:-6px 0 26px}
.shKpis>div{border:1px solid #ddd0ac;background:#faf6ea;border-radius:5px;padding:12px 14px}
.shKpis span{display:block;font-size:10.5px;font-weight:700;letter-spacing:.07em;color:#8a6f45;text-transform:uppercase}
.shKpis b{display:block;font-family:'Source Serif 4',serif;font-size:24px;color:#1c1a15;margin-top:4px}
.shKpis b.neg{color:#A8453A}
.shKpis em{display:block;font-style:normal;font-size:11.5px;color:#6a6558;margin-top:2px}
.shWrap{overflow-x:auto}
.shNote{font-size:12.5px;color:#6a6558;margin:-4px 0 10px;line-height:1.5}
.shSrc{font-size:11px;color:#8a8577;margin-top:8px;line-height:1.5}
.shTable tr.tot td{font-weight:800;border-top:1.5px solid #8a6f45;color:#1c1a15}
.shTable tr.hd td{font-size:11px;font-weight:700;color:#8a6f45;text-transform:uppercase;letter-spacing:.05em;padding-top:14px}
.shTable.bud{font-size:12.5px}
.shTable.bud td{text-align:right;padding:6px 8px}
.shTable.bud td:first-child{text-align:left;color:#1c1a15}
.shTable.bud tr.sub td{color:#8a8577;font-size:11.5px}
.shTable.bud tr.sub td:first-child{padding-left:22px;color:#8a8577}
.shTable.bud tr.head td{font-weight:700}
.shTable.bud tr.sub2 td{font-weight:700;background:#f5efdf}
.shTable.bud tr.tot td{background:#f5efdf;border-top:2px solid #8a6f45}
.shTable.inc td{text-align:right}
.shTable.inc td:first-child{text-align:left}
.shTable.sens td{font-size:12.5px}
.shTable.sens td.neg{color:#A8453A}
.shTable.sens td.base{outline:2px solid #c9a267;outline-offset:-2px;font-weight:700}
.shTable.sens td small{display:block;font-size:10.5px;color:#8a8577}
@media (max-width:760px){
  .uw .fg2{grid-template-columns:1fr 1fr;gap:10px}
  .uw .uwField label{flex-wrap:wrap;gap:0 6px;font-size:11.5px}
  .uw .uwField label em{white-space:nowrap}
  .uw .secBody{padding:4px 12px 14px}
  .chk{grid-template-columns:1fr 1fr}
  .sheet{padding:20px}
  .shTitle{font-size:24px}
  .shGrid{grid-template-columns:1fr}
  .shKpis{grid-template-columns:1fr 1fr}
  .shTop{flex-direction:column}
}
@media print{
  @page{size:letter;margin:.45in}
  #uw-sheet{padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .shSec{break-inside:avoid}
  .shTable tr,.shRow,.shKpis{break-inside:avoid}
  .shH{break-after:avoid}
  .shWrap{overflow:visible}
}
`;

export default App;
