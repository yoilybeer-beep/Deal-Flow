import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { HPD_RENTS, HPD_RENT_SRC, HPD_RENT_LABEL, DEFAULT_AMI, RENT_DEDUCTION, RENT_DEDUCTION_LABEL, PROGRAMS, BORO_COSTS, DEFAULT_COSTS, UNIT_SF, MKT_RENTS } from "./uwConstants";
import Papa from "papaparse";
import { supabase } from "./supabaseClient";
import Contacts, { contactMatches, matchingNote } from "./Contacts";
import Team from "./Team";
import Opportunities, { OPPS_PREFIX } from "./Opportunities";
import RentalUW, { isRentalModel } from "./RentalUW";
import { blankRental, newUnit, typicalExpenses } from "./rentalCalc";
import { QuickActions, LastContactedTag, lastContacted, todayISO, autoContact, sellerFromDeal, personFromBuyer, FollowUpQuick, shortDay } from "./crmKit";

/* ============================================================
   J STONE REALTY GROUP — DEAL PLATFORM
   ------------------------------------------------------------
   Records live one-per-row in `deals`, `buyers` and `models`,
   each stamped with the owner. Visibility is enforced by
   Postgres row-level security, not by this file: a teammate
   cannot fetch a private deal even outside the app.
   Photos go to the `deal-photos` storage bucket.
   Run supabase-schema.sql once before deploying this.
   ============================================================ */
/* ============================================================
   J STONE REALTY GROUP — DEAL PLATFORM
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
  L.push('J Stone Realty Group');
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
const LOGO_FULL = 'data:image/png;base64,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';

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
const newTier = (ami = DEFAULT_AMI) => ({ ami, units: typeMap(() => 0), rents: hpdRents(ami) });

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
    affMode: "none", affReqPct: 0, tiers: [newTier(DEFAULT_AMI)], utilAllow: typeMap((t) => RENT_DEDUCTION[t] ?? 0),
    floors: [], massReserveSF: 0,
    purchasePrice: 3000000, keyMoney: 0, groundRentYr: 0, groundRentFreeMonths: 0,
    closingCostPct: 3, otherAcqCosts: 50000, creditsAmt: 0, creditsLabel: "Brownfield / other credits",
    hardCostPerBSF: bc.hard, hardContingencyPct: 0, softCostPct: bc.soft,
    constructionMonths: 24, ltcPct: 65, interestRatePct: 9.0, avgOutstandingPct: 60, originationFeePct: 1.0,
    cTaxesYr: 30000, cInsurancePct: 1.5,
    retailSF: 0, retailPSF: 50, commVacancyPct: 10, retailExpPct: 10, commCapRate: 6.0,
    parkingSpaces: 0, parkingRent: 200, otherIncomeYr: 0,
    vacancyPct: 5, opexPerUnit: 6000, mgmtPct: 3, propertyTaxAnnual: 0, exitCapRatePct: 5.5,
    permLoanPct: 90, permLoanAmt: 0, permRatePct: 6.5, permAmortYrs: 30,
    marketSellPSF: 1100, affordableSellPSF: 500, sellingCostPct: 6,
    leaseUpMonths: 6, saleCostPct: 3,          // returns summary only (new; old models get these defaults, nothing else moves)
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
    const utilAllow = typeMap((t) => (N((raw.utilAllow || {})[t]) > 0 ? raw.utilAllow[t] : RENT_DEDUCTION[t] ?? 0));  // 0 / missing → default basis
    return { ...base, ...raw, mix, tiers, utilAllow, floors: Array.isArray(raw.floors) ? raw.floors : [] };
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
  m.tiers = tiers.length ? tiers : [newTier(DEFAULT_AMI)];
  // old affordable rents were entered as collected rents: keep the same net rent under the default deduction
  if (tiers.length) tiers.forEach((tr) => UNIT_TYPES.forEach(([t]) => { tr.rents[t] = N(tr.rents[t]) + (RENT_DEDUCTION[t] ?? 0); }));
  m.utilAllow = typeMap((t) => RENT_DEDUCTION[t] ?? 0);
  m.gsfOverride = N(raw.actualBuildingSF);           // keeps the old cost basis exactly
  m.retailSF = commSF; m.retailPSF = commSF > 0 ? Math.round(commGross / commSF) : 50; m.retailExpPct = 0;
  m.opexPerUnit = 0; m.mgmtPct = N(raw.opexPct);      // v1 opex was a % of EGI
  m.cTaxesYr = 0; m.cInsurancePct = 0;                // v1 had no construction taxes / insurance
  m.hardContingencyPct = N(raw.hardContingencyPct);
  const P = PROGRAMS[raw.program] || PROGRAMS.market;
  m.affMode = P.mode; m.affReqPct = P.pct;
  m.structure = "sale"; m.keyMoney = 0; m.groundRentYr = 0;
  if (raw.permLoanPct == null) m.permLoanPct = 65;  // keep the loan old models were upgraded with
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

/* ---------- prefill a rental model from a Deal Desk deal (existing building) ---------- */
function rentalFromDeal(deal) {
  const m = blankRental(deal.borough || "");
  m.dealId = deal.id;
  m.dealName = deal.address || "Untitled rental";
  m.marketArea = [deal.neighborhood, deal.borough].filter(Boolean).join(", ");
  m.purchasePrice = N(deal.askingPrice) || 0;
  m.buildingSF = N(deal.existingSf) || N(deal.lot?.bldgarea) || 0;
  m.yearBuilt = deal.lot?.yearbuilt ? String(deal.lot.yearbuilt) : "";
  const n = Math.round(N(deal.lot?.unitsres));
  if (n > 0 && n <= 400) { m.units = Array.from({ length: n }, (_, i) => newUnit(String(i + 1), { beds: 1, current: 0, market: 0 })); m.sampleRoll = true; }
  m.exp = typicalExpenses(m);
  return m;
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
  // UAP: the bonus is (UAP FAR − base FAR) × lot, unless the user typed how much of it they use (m.uapSF)
  const autoBonusBSF = Math.max(0, lotSF * effFAR - baseBSF);
  const uapEdited = autoBonusBSF > 0 && m.uapSF !== null && m.uapSF !== undefined && m.uapSF !== "";
  const bonusBSF = uapEdited ? Math.max(0, N(m.uapSF)) : autoBonusBSF;
  const zoningBSF = baseBSF + bonusBSF;
  const airSF = N(m.airRightsSF);
  const totalBSF = zoningBSF + airSF;
  const rawFactor = Math.max(0, totalBSF - N(m.retailSF)) / 680;   // dwelling-unit factor applies to residential floor area only
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
  const equityIn = netCost - permLoan;               // cash required = all-in − loan
  const cashPct = netCost > 0 ? equityIn / netCost * 100 : 0;
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

  // returns summary: build → lease-up (or sell out) → sell. All equity in on day 1, construction loan repaid from the sale.
  const leaseUpMo = Math.max(0, N(m.leaseUpMonths));
  const exitYears = (months + leaseUpMo) / 12;
  const saleNet = rental ? exitValue * (1 - N(m.saleCostPct) / 100) : sellNet + retailValue;
  const profitSold = saleNet - netCost;
  const marginSold = netCost > 0 ? profitSold / netCost * 100 : 0;
  const devEquity = Math.max(0, netCost - constrLoan);
  const toEquity = saleNet - constrLoan;
  const devMultiple = devEquity > 0 ? toEquity / devEquity : 0;
  const devIRR = devEquity > 0 && exitYears > 0 && toEquity > 0 ? (Math.pow(toEquity / devEquity, 1 / exitYears) - 1) * 100 : (devEquity > 0 && toEquity <= 0 ? -100 : NaN);
  const devSpreadBps = rental ? (yieldOnCost - cap) * 100 : 0;

  // UAP deep affordability (ZR / HPD UAP rules as summarized in uwConstants — verify): 10,000+ SF affordable → 20% of it at ≤ 40% AMI
  const deepSF = UNIT_TYPES.reduce((s, [t]) => s + tiers.reduce((a, tr) => a + (N(tr.ami) <= 40 ? N(tr.units?.[t]) : 0), 0) * N((m.mix || {})[t]?.sf), 0);
  const uapDeepReq = affMode === "uap" && bonusBSF >= 10000;
  const uapDeepSF = uapDeepReq ? affReqSF * 0.2 : 0;
  const uapDeepMet = !uapDeepReq || deepSF >= uapDeepSF - 0.5;

  return {
    lease, rental, lotSF, baseFAR, effFAR, baseBSF, zoningBSF, bonusBSF, autoBonusBSF, uapEdited, airSF, totalBSF, buildableSF: zoningBSF, maxUnitsByZoning,
    rows, totalUnits, affUnits, marketUnits, affordableUnits: affUnits, resiNetSF, affSF, mktSF, resiGSF, retailSF, zfaUsed, computedGSF, GSF,
    actualBuildingSF: GSF, netSF: resiNetSF, bsfLeft, overAlloc,
    affMode, affReqSF, affReqUnits, affSurplusSF, affSurplusUnits, affMet, affAvgAmi,
    mktResiM, affResiM, resiM, lostM, lostYr, lostValue, retailYr, parkingM, otherYr, resiYr, GPI, resiVac, retailVac, vacancy, EGI,
    exResi, exMgmt, exRetail, exTax, exGround, opexTotal, NOI,
    price, closing, airCost, otherAcq, totalAcq, hardBase, contingency, totalHard, totalSoft,
    constrLoan, cInterest, cFees, cTaxes, cInsurance, cGround, totalCarry, constrSubtotal, TPC, TDC, credits, netCost, per,
    cap, exitValue, equityCreated, yieldOnCost, yieldOnNet,
    permLoan, dsAmort, dsIO, cfAmort, cfIO, dscr, dscrIO, equityIn, cashPct, coc, debtYield, maxLoan125,
    sellGross, sellCosts, sellNet, retailNOI, retailValue, condoProfit, condoMargin, condoMarginRev,
    profit, margin, leaseUpMo, exitYears, saleNet, profitSold, marginSold, devEquity, toEquity, devMultiple, devIRR, devSpreadBps,
    deepSF, uapDeepReq, uapDeepSF, uapDeepMet,
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
const irPct = (n) => (isFinite(n) ? n.toFixed(1) + "%" : "—");

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
    setSaved((data || []).filter((r) => !String(r.id).startsWith(OPPS_PREFIX) && !isRentalModel(r.data)).map((r) => ({ ...r.data, isPublic: !!r.is_public, _owner: r.owner_id })));
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

  // the envelope (total BSF) changed → refit the unit mix and refill the affordable tier, so units / NOI follow
  const fitAt = useRef(null);
  if (fitAt.current === null) fitAt.current = c.totalBSF;
  const refitEnvelope = (p) => {   // called from event handlers with the current model (not inside a state updater)
    const env = runCalc(p).totalBSF;
    if (Math.abs(env - N(fitAt.current)) < 1) return p;
    fitAt.current = env;
    if (env <= 0) return p;
    const fitted = fitMix(p, env);
    notify?.(`Units refit to ${fmt(env)} BSF — edit the mix if you want something else`);
    return fitted.affMode !== "none" ? autoAffordable(fitted) : fitted;
  };
  const applyDistrict = (district, street, devPath) => {
    const v = district ? farFor(district, street) : null;
    const p = m;
    {
      const next = {
        ...p, district, street, devPath,
        uapSF: devPath === "uap" ? p.uapSF : null,
        far: v ? v.aor : p.far,
        bonusFar: v ? (devPath === "uap" ? v.uap : 0) : p.bonusFar,
      };
      // leaving the UAP path: a UAP set-aside with no bonus area means nothing, so fall back to free market
      const leaveUap = devPath !== "uap" && p.program === "uap";
      if (leaveUap) { next.program = "market"; next.affMode = "none"; next.affReqPct = 0; }
      const out = refitEnvelope(next);
      setM(leaveUap ? autoAffordable(out) : out);   // autoAffordable with no requirement clears tier 1
      if (leaveUap) notify?.("Left the UAP path — program set to Market (pick 485-x / MIH if it applies)");
    }
  };
  const envNum = (k, step = "any") => (
    <input type="number" inputMode="decimal" step={step} value={m[k] ?? ""} onChange={(e) => set(k, e.target.value)}
      onBlur={() => setM(refitEnvelope(m))} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  );
  const applyProgram = (prog) => {
    const P = PROGRAMS[prog];
    const p = m;
    {
      let pct = P.pct;
      if (prog === "485x") pct = runCalc(p).totalUnits >= 100 ? 25 : 20;
      const tiers = p.tiers.map((t, i) => (i === 0 ? { ...t, ami: P.ami, rents: hpdRents(P.ami) } : t));
      const next = { ...p, program: prog, affMode: P.mode, affReqPct: pct, tiers };
      if (prog === "uap" && p.devPath !== "uap") {
        const v = p.district ? farFor(p.district, p.street) : null;
        next.devPath = "uap";
        if (v && v.uap) next.bonusFar = v.uap;
      }
      const out = refitEnvelope(next);   // envelope changed → refit + refill; otherwise just refill the affordable tier
      setM(out === next && next.affMode !== "none" ? autoAffordable(next) : out);
    }
  };
  // UAP SF typed (or reset): refit the unit mix to the new envelope and refill the affordable tier to the requirement
  const refitUap = (p) => {
    const fitted = fitMix(p, runCalc(p).totalBSF);
    fitAt.current = runCalc(fitted).totalBSF;
    return fitted.affMode === "uap" ? autoAffordable(fitted) : fitted;
  };
  const resetUap = () => setM((p) => refitUap({ ...p, uapSF: null }));
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
          <button className="ghost" onClick={() => { const bm = blankModel(); fitAt.current = runCalc(bm).totalBSF; setM(bm); }}>New</button>
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
              <span onClick={() => { const um = upgradeModel(s); fitAt.current = runCalc(um).totalBSF; setM(um); }}>{s.dealName}{s._owner && s._owner !== userId ? ` · ${s.ownerName || "shared"}` : ""}</span>
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
              <F label="Lot size" hint="SF · units refit">{envNum("lotSF")}</F>
              <F label="Base FAR" hint="as-of-right">{envNum("far", "0.01")}</F>
              <F label="Bonus FAR" hint="UAP max FAR · 0 = base">{envNum("bonusFar", "0.01")}</F>
              {c.autoBonusBSF > 0 && (
                <F label="UAP affordable SF" hint={c.uapEdited ? "your number" : "auto"}>
                  <input type="number" inputMode="decimal" step="any" value={c.uapEdited ? m.uapSF : Math.round(c.autoBonusBSF)}
                    onChange={(e) => set("uapSF", e.target.value)}
                    onBlur={() => setM((p) => refitUap(p))}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
                  <div className="uapNote">
                    {c.uapEdited
                      ? <>Auto {fmt(c.autoBonusBSF)} · edited <button className="linkBtn inline" onClick={resetUap}>reset to auto</button>
                          {c.bonusBSF > c.autoBonusBSF + 0.5 && <b style={{ color: RED }}> · above UAP max</b>}</>
                      : <>UAP affordable SF (auto): {fmt(c.autoBonusBSF)}</>}
                  </div>
                </F>
              )}
              <F label="Overlay / special" hint="optional">
                <input value={m.overlay} onChange={(e) => set("overlay", e.target.value)} placeholder="C2-4 overlay" />
              </F>
              <F label="Air rights / neighbor transfer" hint="BSF">{envNum("airRightsSF")}</F>
              <F label="Air rights price" hint="$ / BSF">{num("airRightsPSF")}</F>
            </div>
            <div className="derived">
              Lot {fmt(c.lotSF)} × FAR {c.baseFAR.toFixed(2)} = {fmt(c.baseBSF)} BSF
              {c.bonusBSF > 0 && <> + {fmt(c.bonusBSF)} {c.uapEdited ? "UAP (your number)" : "bonus"}</>}
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
              <button className="mini tall" onClick={() => setM((p) => { fitAt.current = runCalc(p).totalBSF; return fitMix(p, runCalc(p).totalBSF); })}>Fit units to BSF</button>
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
                    <thead><tr><th>Type</th><th>Aff. units</th><th>Affordable rent</th><th>vs market</th></tr></thead>
                    <tbody>
                      {UNIT_TYPES.map(([t, label]) => (
                        <tr key={t}>
                          <td>{label}</td>
                          <td><input type="number" inputMode="decimal" value={tr.units[t]} onChange={(e) => setTierU(i, t, e.target.value)} /></td>
                          <td><input type="number" inputMode="decimal" value={N(tr.rents[t]) - N(m.utilAllow?.[t])} onChange={(e) => setTierR(i, t, N(e.target.value) + N(m.utilAllow?.[t]))} /></td>
                          <td className="mono">{N(m.mix[t].rent) ? "-" + money(N(m.mix[t].rent) - N(tr.rents[t]) + N(m.utilAllow?.[t])) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <details className="hpdRef">
              <summary>HPD max reference · {RENT_DEDUCTION_LABEL.toLowerCase()}</summary>
              <div className="tableWrap">
                <table className="rr">
                  <thead><tr><th></th>{UNIT_TYPES.map(([t]) => <th key={t}>{UT_SHORT[t]}</th>)}</tr></thead>
                  <tbody>
                    {m.tiers.map((tr, i) => <tr key={i}><td className="mono">HPD max {tr.ami}%</td>{UNIT_TYPES.map(([t]) => <td key={t} className="mono">{money(N(tr.rents[t]))}</td>)}</tr>)}
                    <tr><td className="mono">Deduction</td>{UNIT_TYPES.map(([t]) => (
                      <td key={t}><input type="number" inputMode="decimal" value={m.utilAllow?.[t] ?? 0} onChange={(e) => setM((p) => ({ ...p, utilAllow: { ...p.utilAllow, [t]: e.target.value } }))} /></td>
                    ))}</tr>
                  </tbody>
                </table>
              </div>
            </details>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {m.affMode !== "none" && <button className="mini tall" onClick={() => setM((p) => autoAffordable(p))}>Auto-fill to requirement</button>}
              {m.tiers.length < 3 && <button className="mini tall" onClick={addTier}>+ AMI tier</button>}
              <button className="mini tall" onClick={() => setM((p) => ({ ...p, utilAllow: typeMap((t) => RENT_DEDUCTION[t] ?? 0), tiers: p.tiers.map((t) => ({ ...t, rents: hpdRents(N(t.ami)) })) }))}>Reset to default rents</button>
            </div>
            <div className="subnote">Affordable rent = your basis: {DEFAULT_AMI}% AMI {UNIT_TYPES.map(([t]) => UT_SHORT[t] + " " + money((HPD_RENTS[DEFAULT_AMI]?.[t] || 0) - (RENT_DEDUCTION[t] || 0))).join(" · ")}. Other AMI levels = HPD max less the same deduction. Edit any rent to match the term sheet.</div>
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
            {c.uapDeepReq && !c.uapDeepMet && <div className="warn">UAP deep affordability: {fmt(c.affReqSF)} SF affordable is 10,000+ SF, so 20% of it (≈{fmt(c.uapDeepSF)} SF) should be at ≤40% AMI — you have {fmt(c.deepSF)} SF. Add a 40% AMI tier. (Rule as summarized above; verify.)</div>}
            {c.uapDeepReq && c.uapDeepMet && <div className="subnote">UAP deep affordability: {fmt(c.deepSF)} SF at ≤40% AMI covers the 20% (≈{fmt(c.uapDeepSF)} SF) needed above 10,000 SF.</div>}
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
                <F label="Lease-up after completion" hint="months · default 6">{num("leaseUpMonths")}</F>
                <F label="Building sale costs" hint="% · default 3 · returns only">{num("saleCostPct", "0.25")}</F>
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
                <F label="Sellout period" hint="months after completion · default 6">{num("leaseUpMonths")}</F>
              </div>
              <div className="derived">
                Sellout {money(c.sellGross)} − costs {money(c.sellCosts)} = {money(c.sellNet)}{c.retailValue > 0 ? ` + retail ${money(c.retailValue)}` : ""}
              </div>
            </Sec>
          )}

          {rental && (
            <Sec n="07" t="Permanent Loan & Cash Flow" open>
              <div className="fg2">
                <F label="Loan" hint="% of all-in · cash = rest">{num("permLoanPct")}</F>
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
                Loan {money(c.permLoan)} · cash required {money(c.equityIn)} ({pct(c.cashPct)}) · cash-on-cash {pct(c.coc)} · debt yield {pct(c.debtYield)}
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
                <div className="divLabel">Financing <i>total · % of cost</i></div>
                <Row l="Loan" v={money(c.permLoan)} s={pct(100 - c.cashPct)} />
                <Row l="Cash required" v={money(c.equityIn)} s={pct(c.cashPct) + (c.totalUnits ? " · " + kMoney(c.equityIn / c.totalUnits) + "/unit" : "")} total />
              </>
            ) : (
              <>
                <Row l="Gross sellout" v={money(c.sellGross)} />
                <Row l="Net sellout + retail" v={money(c.sellNet + c.retailValue)} total />
              </>
            )}
            <div className={"profit" + (c.profit < 0 ? " neg" : "")}>
              <div className="pl">{rental ? "Equity created (value − cost)" : "Projected profit"}</div>
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
            <div className="divLabel">Returns <i>build → {rental ? "lease up" : "sell out"} → sell</i></div>
            <Row l={rental ? "Profit if sold (after sale costs)" : "Profit"} v={sMoney(c.profitSold)} s={pct(c.marginSold) + " margin"} />
            {rental && <Row l="Development yield" v={pct(c.yieldOnCost)} s={`${Math.round(c.devSpreadBps)} bps vs exit cap`} />}
            <Row l="Equity in (cost − constr. loan)" v={money(c.devEquity)} />
            <Row l="Levered IRR · multiple" v={irPct(c.devIRR)} s={(c.devMultiple ? c.devMultiple.toFixed(2) + "x" : "—") + ` · ${c.exitYears.toFixed(1)} yr`} total />
            <div className="subnote" style={{ opacity: 0.6 }}>Simple: all equity in on day 1, construction loan repaid from the sale at {N(m.constructionMonths)} + {c.leaseUpMo} months. Lease-up carry and NOI not counted.</div>
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
              <img className="shLogo" src={LOGO_FULL} alt="J Stone Realty Group" />
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
              {c.bonusBSF > 0 && <SR l={c.uapEdited ? "UAP affordable BSF (edited)" : "Bonus BSF"} v={fmt(c.bonusBSF) + (c.uapEdited ? ` of ${fmt(c.autoBonusBSF)} max` : "")} />}
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
                  <thead><tr><th>Type</th><th>Units</th><th>AMI</th><th>Affordable rent</th><th>Market rent</th><th>Lost / yr</th></tr></thead>
                  <tbody>
                    {affRows.flatMap((r) => r.parts.map((p, k) => (
                      <tr key={r.type + k}><td>{r.label}</td><td>{p.u}</td><td>{p.ami}%</td><td>{money(p.net)}</td><td>{money(r.rent)}</td><td>{money(p.u * (r.rent - p.net) * 12)}</td></tr>
                    )))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="shSrc">Affordable rent = J Stone basis (HPD max less utility deduction; ref. {HPD_RENT_SRC}).</div>
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
                <SR l={`Levered IRR · multiple (${c.exitYears.toFixed(1)} yr)`} v={`${irPct(c.devIRR)} · ${c.devMultiple ? c.devMultiple.toFixed(2) + "x" : "—"}`} />
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
                <SR l="Equity created (value − cost)" v={sMoney(c.equityCreated)} />
                <SR l={`Profit if sold (after ${N(m.saleCostPct)}% sale costs)`} v={`${sMoney(c.profitSold)} · ${pct(c.marginSold)}`} />
                <SR l="Development spread vs exit cap" v={`${Math.round(c.devSpreadBps)} bps`} />
                <SR l={`Levered IRR · multiple (sell at ${c.exitYears.toFixed(1)} yr)`} v={`${irPct(c.devIRR)} · ${c.devMultiple ? c.devMultiple.toFixed(2) + "x" : "—"}`} />
                <SR l="Loan" v={`${money(c.permLoan)} (${pct(100 - c.cashPct)} of cost) @ ${N(m.permRatePct)}%, ${N(m.permAmortYrs)} yr`} />
                <SR l="CASH REQUIRED" v={`${money(c.equityIn)} · ${pct(c.cashPct)} of cost${c.totalUnits ? " · " + kMoney(c.equityIn / c.totalUnits) + "/unit" : ""}`} />
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
            Prepared by J Stone Realty Group. Preliminary underwriting estimates based on the assumptions stated above
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

function DealDesk({ view, notify, onUnderwrite, onUnderwriteRental, userId, userName, openId, onOpened }) {
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
        onUnderwriteRental={onUnderwriteRental ? () => onUnderwriteRental(dealForm) : null}
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

function DealForm({ deal, setDeal, buyers, onSave, onCancel, onDelete, onShare, onUnderwrite, onUnderwriteRental, isNew, mine = true, notify, onFollow }) {
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
          {onUnderwriteRental && <button className="ghost" onClick={onUnderwriteRental} disabled={!deal.address.trim()}>Rental UW →</button>}
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
        <img src={LOGO_FULL} alt="J Stone Realty Group" style={{ height: 58, display: "block", margin: "0 auto 18px" }} />
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
  const [rentModel, setRentModel] = useState(() => blankRental());
  const underwriteRental = (deal) => {
    setRentModel(rentalFromDeal(deal));
    setReturnTo("deals");
    setView("rent");
  };

  // role comes from team_members (RLS allowlist); only admins see the Team screen
  const [role, setRole] = useState(undefined);   // undefined = loading, null = not on the team
  useEffect(() => {
    supabase.from("team_members").select("role").eq("user_id", userId).maybeSingle().then(({ data }) => setRole(data?.role || null));
  }, [userId]);
  // invite links land here with a session in the URL; ask for a password once
  const [needsPassword, setNeedsPassword] = useState(() => /type=(invite|recovery)/.test(window.location.hash));

  const NAV = [["home", "Home"], ["opps", "New Opportunities"], ["deals", "Deals"], ["buyers", "Buyers"], ["contacts", "Contacts"], ["zcalc", "Zoning calc"], ["uw", "Underwriting"], ["rent", "Rental UW"],
    ...(role === "admin" ? [["team", "Team"]] : [])];

  return (
    <>
      <div className="appShell">
        <aside className="sideBar">
          <div className="brandWrap brand">
            <img className="brandMark" src={LOGO} alt="J Stone Realty Group" />
            <div>
              <div className="brandName"><span>J STONE</span> <span>REALTY GROUP</span></div>
              <div className="brandSub">Deal Platform</div>
            </div>
          </div>
          <nav>
            {NAV.map(([id, label]) => (
              <button key={id} className="navBtn" data-on={view === id}
                onClick={() => { if (id === "uw" || id === "rent") setReturnTo(null); go(id); }}>{label}</button>
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
                <div className="homeCard" onClick={() => { setRentModel(blankRental()); setReturnTo(null); setView("rent"); }}>
                  <div className="hcTag">05</div>
                  <h2>Rental Underwriting</h2>
                  <p>Buy-and-hold model for an existing building — rent roll with RS / free-market / voucher units, itemized expenses, debt sized by LTV and DSCR, 5–10 year cash flow, IRR, sensitivity. Report / PDF.</p>
                  <span className="hcGo">Open rental model →</span>
                </div>
                <div className="homeCard" onClick={() => setView("contacts")}>
                  <div className="hcTag">06</div>
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
            <DealDesk view={view} notify={notify} onUnderwrite={underwriteDeal} onUnderwriteRental={underwriteRental} userId={userId} userName={displayName}
              openId={openTarget?.view === view ? openTarget.id : null} onOpened={() => setOpenTarget(null)} />
          )}

          {view === "team" && role === "admin" && <Team userId={userId} notify={notify} />}

          {view === "opps" && <Opportunities userId={userId} userName={displayName} notify={notify} onGo={go} />}

          {view === "contacts" && (
            <Contacts notify={notify} userId={userId} userName={displayName} onGo={go}
              openId={openTarget?.view === "contacts" ? openTarget.id : null} onOpened={() => setOpenTarget(null)} />
          )}

          {view === "rent" && (
            <RentalUW
              key={rentModel.id}
              initialModel={rentModel}
              onExit={returnTo ? () => { setView(returnTo); setReturnTo(null); } : null}
              notify={notify}
              userId={userId}
              userName={displayName}
            />
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
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{box-sizing:border-box}
body{margin:0;background:${PAPER};color:${INK};font-family:'Inter',-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums lining-nums;font-feature-settings:"tnum" 1,"lnum" 1,"zero" 0}
button{font-family:inherit;cursor:pointer}
input,select,textarea{font-family:inherit;font-variant-numeric:tabular-nums lining-nums;font-feature-settings:"tnum" 1,"lnum" 1,"zero" 0;font-size:16px;width:100%;padding:9px 11px;border:1px solid ${LINE};border-radius:7px;background:#fff;color:${INK};outline:none}
input:focus,select:focus,textarea:focus{border-color:${BLUE};box-shadow:0 0 0 3px rgba(36,86,200,.12)}
.center{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:${PAPER};color:${INK};font-family:'Inter',-apple-system,'Segoe UI',sans-serif}
.authCard{background:#fff;border:1px solid ${LINE};border-radius:14px;padding:30px 28px;width:370px;max-width:92vw;box-shadow:0 10px 34px rgba(16,27,45,.10)}
.authCard .field{margin-bottom:12px}
.appShell{display:flex;min-height:100vh}
.sideBar{width:210px;flex-shrink:0;background:${INK};color:#EDEDE8;display:flex;flex-direction:column;padding:22px 14px;position:sticky;top:0;height:100vh}
.sideBar nav{display:flex;flex-direction:column;gap:4px;flex:1}
.brand{display:flex;gap:10px;align-items:center}
.brandWrap{margin-bottom:28px}
.brandMark{width:29px;height:40px;object-fit:contain;display:block;flex-shrink:0}
.brandName{font-size:12px;font-weight:800;letter-spacing:.12em;line-height:1.25}
.brandName span,.brandSub{white-space:nowrap}
.hpdRef{margin-top:12px;font-size:12px}
.hpdRef summary{cursor:pointer;opacity:.55;font-size:11.5px}
.hpdRef td{color:#777}
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
.hcTag{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:11px;color:#9C7A2E;letter-spacing:.14em}
.homeCard h2{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:22px;margin:6px 0 8px}
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
.lastNote b{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-weight:600;font-size:11px;opacity:.8;margin-right:6px}
.noteAdd{display:flex;flex-direction:column;gap:8px}
.noteAddRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.noteAddRow input[type=date]{width:auto;flex:0 0 170px}
.noteLog{margin-top:14px;display:flex;flex-direction:column}
.noteItem{display:flex;gap:12px;padding:10px 0;border-top:1px solid ${LINE};font-size:14px;line-height:1.45}
.noteDate{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:11.5px;font-weight:600;color:#9C7A2E;flex:0 0 78px;padding-top:2px}
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
.znum{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:18px;font-weight:600}
.zcell.big .znum{font-size:24px}
.znum.brass{color:#D6B45C}
.znum small{font-size:12px;opacity:.6}
.zfoot{margin-top:12px;font-size:11px;opacity:.5;line-height:1.4}
.matchRow{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:13px}
.matchRow span{opacity:.6}
.uw .eyebrow{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:11px;letter-spacing:.18em;color:#9C7A2E;text-transform:uppercase}
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
.segLabel{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:10px;letter-spacing:.14em;text-transform:uppercase;opacity:.5;margin-bottom:6px}
.seg{display:flex;border:1px solid ${LINE};border-radius:7px;overflow:hidden;background:#fff}
.seg button{border:none;border-right:1px solid ${LINE};background:none;padding:8px 15px;font-size:13.5px;font-weight:600;color:${INK};opacity:.6}
.seg button:last-child{border-right:none}
.seg button[data-on="true"]{background:${INK};color:#fff;opacity:1}
.uwGrid{display:grid;grid-template-columns:1fr 350px;gap:24px;align-items:start}
.sec{background:#fff;border:1px solid ${LINE};border-radius:10px;margin-bottom:12px;overflow:hidden}
.secHead{display:flex;align-items:center;gap:12px;padding:14px 18px;cursor:pointer;user-select:none}
.secNum{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:11px;color:#9C7A2E;border:1px solid ${LINE};border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.secTitle{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:17px;font-weight:700;flex:1}
.secChev{opacity:.4;font-size:11px;transition:.2s}
.secBody{padding:4px 18px 18px;border-top:1px solid ${LINE}}
.fg2{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;margin-top:12px}
.fg1{display:grid;grid-template-columns:1fr;margin-top:12px}
.uwField label{display:flex;justify-content:space-between;gap:8px;font-size:12px;font-weight:600;opacity:.8;margin-bottom:4px}
.uwField label em{font-style:normal;font-weight:400;opacity:.6;font-size:10.5px}
.uwField input,.uwField select{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:14px;font-weight:500}
.derived{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:11.5px;color:${BLUE};margin-top:12px;padding-top:12px;border-top:1px dashed ${LINE};line-height:1.5}
.derived.brassText{color:#9C7A2E}
.rrHead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9C7A2E;margin:14px 0 8px}
.rrHead em{font-style:normal;font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:11px;letter-spacing:0;text-transform:none;opacity:.55;color:${INK}}
.tableWrap{overflow-x:auto;border:1px solid ${LINE};border-radius:8px}
table.rr{width:100%;border-collapse:collapse;font-size:12.5px;min-width:420px}
table.rr th,table.rr td{padding:6px;text-align:center;border-bottom:1px solid ${LINE}}
table.rr thead th{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;opacity:.55;font-weight:500;background:#F6F5F1}
table.rr td:first-child,table.rr th:first-child{text-align:left;padding-left:10px;white-space:nowrap;opacity:.8}
table.rr input{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:12px;padding:5px 4px;text-align:center;min-width:56px}
table.rr tbody tr:last-child td{border-bottom:none}
.subnote{font-size:11.5px;opacity:.55;margin-top:8px;line-height:1.5}
.uwSum{position:sticky;top:20px;border:1px solid #9C7A2E;border-radius:10px;background:${INK};color:#EDEDE8;overflow:hidden}
.sumHead{display:flex;justify-content:space-between;align-items:baseline;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.12);font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:10px;letter-spacing:.14em;text-transform:uppercase;opacity:.75}
.divLabel{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#D6B45C;margin:16px 0 4px}
.ledger{display:flex;justify-content:space-between;align-items:baseline;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:13px}
.ledger span{opacity:.7}
.ledger b{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-weight:600}
.ledger.total{border-bottom:none;border-top:1px solid rgba(255,255,255,.2);margin-top:4px;padding-top:11px}
.ledger.total span{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:15px;opacity:1;font-weight:600}
.ledger.total b{font-size:16px;font-weight:600;color:#D6B45C}
.profit{margin-top:16px;padding:16px;border-radius:8px;text-align:center;background:rgba(132,180,130,.1);border:1px solid #84B482}
.profit.neg{background:rgba(196,119,100,.1);border-color:#C47764}
.profit .pl{font-size:11px;text-transform:uppercase;letter-spacing:.1em;opacity:.7}
.profit .pv{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:29px;font-weight:700;color:#84B482;margin-top:4px}
.profit.neg .pv{color:#C47764}
.mcards{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
.mcard{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:11px}
.ml{font-size:10px;text-transform:uppercase;letter-spacing:.08em;opacity:.55}
.mv{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:18px;font-weight:600;margin-top:3px}
.mv[data-good="true"]{color:#84B482}
.mv[data-good="false"]{color:#C47764}
.foot{margin-top:28px;font-size:11.5px;opacity:.5;text-align:center}
.modalWrap{position:fixed;inset:0;background:rgba(16,27,45,.6);display:flex;align-items:flex-start;justify-content:center;padding:30px 16px;z-index:50;overflow-y:auto}
.modal{background:#fff;border-radius:14px;padding:18px;width:420px;max-width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)}
.modalHead{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:${BLUE};margin-bottom:14px}
.modalX{background:none;border:none;font-size:24px;line-height:1;opacity:.5}
.sharePhoto{width:100%;height:170px;object-fit:cover;border-radius:9px;margin-bottom:12px;display:block}
.shareText{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:13px;line-height:1.55;resize:vertical}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:${INK};color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;z-index:60;box-shadow:0 6px 24px rgba(0,0,0,.25);max-width:90vw;text-align:center}
.sheet{background:#fffefb;color:#1c1a15;padding:48px;border-radius:5px;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.shTop{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #c9a267;padding-bottom:18px;margin-bottom:26px}
.shLogo{height:56px;width:auto;display:block;margin-bottom:14px}
.shBrand{font-size:12px;font-weight:700;letter-spacing:.1em;color:#8a6f45;text-transform:uppercase}
.shTitle{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:32px;font-weight:700;margin:6px 0 4px;line-height:1.15}
.shSub{font-size:14px;color:#6a6558}
.shDate{font-size:13px;color:#8a8577;white-space:nowrap}
.shSec{margin-bottom:26px}
.shH{font-size:12px;font-weight:700;letter-spacing:.09em;color:#8a6f45;text-transform:uppercase;margin-bottom:12px;border-bottom:1px solid #ddd6c4;padding-bottom:7px}
.shGrid{display:grid;grid-template-columns:1fr 1fr;gap:6px 30px}
.shRow{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px dotted #ddd6c4;font-size:14px}
.shRow span{color:#5a5648}
.shRow b{font-weight:600}
.shTable{width:100%;border-collapse:collapse;font-size:14px}
.shTable th,.shTable td{padding:8px;text-align:center;border-bottom:1px dotted #ddd6c4}
.shTable thead th{font-size:11px;font-weight:700;color:#8a6f45;text-transform:uppercase;letter-spacing:.05em}
.shTable td:first-child,.shTable th:first-child{text-align:left;color:#5a5648}
.shHl{background:#f5efdf;border:1px solid #ddd0ac;border-radius:5px;padding:18px 22px;margin-top:12px;display:flex;justify-content:space-between;align-items:center}
.shHl span{font-size:12px;font-weight:700;color:#6a6558;text-transform:uppercase;letter-spacing:.07em}
.shHl b{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:32px;color:#7a5a24}
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
.hsSnip b{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-weight:600;font-size:11px;opacity:.8;margin-right:6px}
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
.boardBsf{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:11px;font-weight:600;color:${BRASS};margin-top:5px;letter-spacing:.01em}
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
.lookHead span{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:11px;opacity:.6}
.lookFacts{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;margin:8px 0 6px}
.lookFacts span{font-size:13px;font-weight:600}
.lookFacts label{display:block;font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;opacity:.5;font-weight:600}
.lookOwner{font-size:12.5px;margin-top:4px}
.lookLinks{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:8px}
.lookLinks a{color:${BLUE};font-weight:700;font-size:13px;text-decoration:none}
.lookLinks.solo{margin:-4px 0 12px}
.lookAlt{margin-top:8px;font-size:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;opacity:.9}
.lookNote{margin-top:8px;font-size:11.5px;opacity:.6}
.lookDiff{margin-top:8px;font-size:12.5px;background:#FDF3E3;border:1px solid #F0D9AE;color:#7A5410;border-radius:8px;padding:6px 9px}
.linkBtn.inline{display:inline;padding:0 0 0 4px;color:${BLUE};font-size:12.5px}
.uapNote{font-size:11.5px;color:${BLUE};margin-top:4px;line-height:1.4}
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
.mono{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:12px;font-weight:500}
table.rr td.bad{color:${RED};font-weight:700}
table.rr tr.tot td{font-weight:700;background:#F6F5F1;font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:11.5px}
table.rr.num td{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:12px;font-weight:500}
table.bud{min-width:560px}
table.bud td{text-align:right;font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:12px;font-weight:500;white-space:nowrap}
table.bud td:first-child{text-align:left;font-family:inherit;white-space:normal;font-size:12.5px;opacity:1}
table.bud th:not(:first-child){text-align:right}
table.bud tr.sub td{opacity:.6;font-size:11px}
table.bud tr.sub td:first-child{padding-left:22px;font-size:11.5px}
table.bud tr.head td{font-weight:700}
table.bud tr.sub2 td{font-weight:700;background:#F6F5F1}
table.bud tr.tot td{font-weight:800;border-top:2px solid ${INK};background:#F1EEE4}
table.sens td{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:12px;font-weight:500;line-height:1.25}
table.sens td small{display:block;opacity:.55;font-size:10px}
table.sens td.neg{color:${RED}}
table.sens td.base{outline:2px solid #9C7A2E;outline-offset:-2px;font-weight:700}
.amiSel{width:auto;padding:4px 8px;font-size:12px;font-family:'Inter',-apple-system,'Segoe UI',sans-serif}
.chk{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
.chk>div{border:1px solid ${LINE};border-radius:8px;padding:9px 10px;background:#FBFAF7}
.chk span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;opacity:.55}
.chk b{display:block;font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:15px;font-weight:600;margin-top:2px}
.chk em{display:block;font-style:normal;font-size:10.5px;opacity:.6;margin-top:2px}
.chk>div.ok{border-color:#84B482;background:rgba(132,180,130,.08)}
.chk>div.ok b{color:${GREEN}}
.chk>div.no{border-color:#C47764;background:rgba(196,119,100,.08)}
.chk>div.no b{color:${RED}}
.warn{margin-top:10px;font-size:12px;color:${RED};font-weight:600}
.rentFlags{margin-top:14px;padding:10px 12px;border:1px solid #C47764;border-radius:8px;background:rgba(196,119,100,.1);font-size:11.5px;line-height:1.5;color:#F0C9BE}
table.rr.rroll{min-width:0}
table.rr.rroll td,table.rr.rroll th{padding:5px 2px}
table.rr.rroll td:first-child,table.rr.rroll th:first-child{padding-left:6px}
table.rr.rroll select{padding:4px 2px;font-size:12px}
table.rr.cflow{min-width:0}
table.rr.rsens{min-width:0}
table.rr.rsens td,table.rr.rsens th{padding:6px 3px}
table.rr.cflow td,table.rr.cflow th{padding:6px 3px}
table.rr.cflow td{font-size:11px}
table.rr.rroll input{min-width:0;width:58px;padding:5px 2px}
.ledger b small{font-size:10.5px;opacity:.5;margin-left:7px;font-weight:400}
.divLabel i{font-style:normal;opacity:.5;letter-spacing:.06em;margin-left:6px;color:#EDEDE8}
.shKpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:-6px 0 26px}
.shKpis>div{border:1px solid #ddd0ac;background:#faf6ea;border-radius:5px;padding:12px 14px}
.shKpis span{display:block;font-size:10.5px;font-weight:700;letter-spacing:.07em;color:#8a6f45;text-transform:uppercase}
.shKpis b{display:block;font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:24px;color:#1c1a15;margin-top:4px}
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
  #uw-sheet,#uw-sheet *{font-variant-numeric:tabular-nums lining-nums;font-feature-settings:"tnum" 1,"lnum" 1,"zero" 0}
}
`;

export { Sec, F, Row, MC, SR, LOGO_FULL, fmt, money, pct, kMoney, sMoney, psf, x2, RED, GREEN, BLUE, BOROUGHS };
export default App;
