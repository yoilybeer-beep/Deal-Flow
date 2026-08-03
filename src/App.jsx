import React, { useState, useEffect, useMemo, useRef } from "react";
import Papa from "papaparse";
import { supabase } from "./supabaseClient";

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
function farFor(district, street) {
  const e = farDB[district];
  if (!e) return null;
  return streetSensitive.includes(district) ? e[street === 'wide' ? 'wide' : 'narrow'] : e;
}
function computeZoning(zoneLabel, street, lotArea, customFar) {
  const district = DEAL_ZONES[zoneLabel];
  const area = parseFloat(lotArea) || 0;
  if (!district) {
    const base = parseFloat(customFar) || 0;
    return { district: null, baseFar: base, uapFar: base ? base * 1.2 : 0,
             baseZfa: base * area, uapZfa: base ? base * 1.2 * area : null };
  }
  const v = farFor(district, street);
  if (!v) return null;
  return { district, baseFar: v.aor, uapFar: v.uap,
           baseZfa: v.aor * area, uapZfa: v.uap ? v.uap * area : null };
}

const BOROUGHS = ['Bronx','Brooklyn','Queens','Manhattan','Staten Island'];
const ASSET_TYPES = ['Development site','Multifamily','Mixed-use','Conversion','Other'];
const VACANCY = ['Delivered vacant','Partially occupied','Fully occupied','TBD'];

const fmt = (n, d = 0) =>
  n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
const money = (n) =>
  n == null || n === '' || isNaN(n) ? '—' : '$' + Math.round(Number(n)).toLocaleString('en-US');
const pct = (n) => (isNaN(n) ? '—' : Number(n).toFixed(1) + '%');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const N = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };

function matchBuyers(deal, buyers) {
  const z = computeZoning(deal.zone, deal.streetWidth, deal.lotArea, deal.customFar);
  const bsf = z ? Math.max(z.baseZfa, z.uapZfa || 0) : 0;
  const price = parseFloat(deal.askingPrice) || null;
  return buyers.filter((b) => {
    if (b.boroughs?.length && !b.boroughs.includes(deal.borough)) return false;
    if (b.maxBudget && price && price > Number(b.maxBudget) * 1.1) return false;
    if (b.minSize && bsf && bsf < Number(b.minSize)) return false;
    return true;
  });
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
   DEVELOPMENT UNDERWRITING
   ============================================================ */
const UNIT_TYPES = [
  ["studio", "Studio"],
  ["1br", "1 Bedroom"],
  ["2br", "2 Bedroom"],
  ["3br", "3 Bedroom"],
];
const AMI_BANDS = ["80", "60", "40"];

const PROGRAM_PRESETS = {
  market: {
    affordablePct: 0,
    market: { studio: 6, "1br": 16, "2br": 12, "3br": 6 },
    aff: { 80: { studio:0,"1br":0,"2br":0,"3br":0 }, 60: { studio:0,"1br":0,"2br":0,"3br":0 }, 40: { studio:0,"1br":0,"2br":0,"3br":0 } },
    note: "Market program — no set-aside applied",
  },
  "485x": {
    affordablePct: 20,
    market: { studio: 5, "1br": 13, "2br": 10, "3br": 4 },
    aff: { 80: { studio:1,"1br":3,"2br":2,"3br":2 }, 60: { studio:0,"1br":0,"2br":0,"3br":0 }, 40: { studio:0,"1br":0,"2br":0,"3br":0 } },
    note: "485-x — single AMI band shown; verify local option",
  },
  uap: {
    affordablePct: 20,
    market: { studio: 5, "1br": 13, "2br": 10, "3br": 4 },
    aff: { 80: { studio:1,"1br":2,"2br":1,"3br":1 }, 60: { studio:0,"1br":0,"2br":0,"3br":0 }, 40: { studio:0,"1br":1,"2br":1,"3br":1 } },
    note: "UAP — blended avg ~60% AMI across bands",
  },
  mih: {
    affordablePct: 25,
    market: { studio: 4, "1br": 12, "2br": 9, "3br": 5 },
    aff: { 80: { studio:1,"1br":2,"2br":1,"3br":1 }, 60: { studio:0,"1br":0,"2br":0,"3br":0 }, 40: { studio:1,"1br":2,"2br":1,"3br":1 } },
    note: "MIH Option 1 — blended avg ~60% AMI across bands",
  },
};
const AFF_RENTS = {
  studio: { 80: 2269, 60: 1701, 40: 1134 },
  "1br":  { 80: 2430, 60: 1822, 40: 1215 },
  "2br":  { 80: 2917, 60: 2187, 40: 1458 },
  "3br":  { 80: 3369, 60: 2527, 40: 1685 },
};
const MKT_RENTS = { studio: 2600, "1br": 3200, "2br": 4200, "3br": 5200 };

function blankModel() {
  const mkt = {}, aff = {};
  UNIT_TYPES.forEach(([t]) => {
    mkt[t] = { u: PROGRAM_PRESETS.market.market[t], r: MKT_RENTS[t] };
    aff[t] = {};
    AMI_BANDS.forEach((b) => { aff[t][b] = { u: 0, r: AFF_RENTS[t][b] }; });
  });
  return {
    id: uid(), dealId: null,
    dealName: "Untitled Site", marketArea: "",
    dealType: "rental", program: "market",
    district: "", street: "narrow", devPath: "aor", overlay: "",
    lotSF: 5000, far: 4.0, bonusFar: 0, efficiency: 83, actualBuildingSF: 20000,
    purchasePrice: 3000000, closingCostPct: 3, otherAcqCosts: 50000,
    hardCostPerBSF: 350, hardContingencyPct: 5, softCostPct: 20,
    ltcPct: 65, interestRatePct: 9.0, constructionMonths: 24,
    originationFeePct: 1.0, avgOutstandingPct: 60,
    totalUnits: 40, affordablePct: 0, targetTotalUnits: 0,
    mkt, aff,
    comm: [ {sf:0,rent:50},{sf:0,rent:50},{sf:0,rent:50},{sf:0,rent:50} ],
    commVacancyPct: 10, commCapRate: 6.0,
    vacancyPct: 5, opexPct: 38, propertyTaxAnnual: 0, exitCapRatePct: 5.25,
    marketSellPSF: 1400, affordableSellPSF: 700, sellingCostPct: 6, isPublic: false,
    updated: new Date().toISOString().slice(0, 10),
  };
}

/* ---------- prefill a model from a Deal Desk deal ---------- */
function modelFromDeal(deal) {
  const m = blankModel();
  const district = DEAL_ZONES[deal.zone] || "";
  const uapPath = deal.devPath === "uap";
  m.dealId = deal.id;
  m.dealName = deal.address || "Untitled Site";
  m.marketArea = [deal.neighborhood, deal.borough].filter(Boolean).join(", ");
  m.district = district;
  m.street = deal.streetWidth === "wide" ? "wide" : "narrow";
  m.devPath = uapPath ? "uap" : "aor";
  m.lotSF = N(deal.lotArea) || 0;
  m.purchasePrice = N(deal.askingPrice) || 0;
  const v = district ? farFor(district, m.street) : null;
  if (v) {
    m.far = v.aor;
    m.bonusFar = uapPath && v.uap ? v.uap : 0;
    const eff = uapPath && v.uap ? v.uap : v.aor;
    m.actualBuildingSF = Math.round(m.lotSF * eff);
    if (uapPath) m.program = "uap";
  } else if (deal.customFar) {
    m.far = N(deal.customFar);
    m.actualBuildingSF = Math.round(m.lotSF * N(deal.customFar));
  }
  return m;
}

/* ---------- the model math ---------- */
function runCalc(m) {
  const effFAR = N(m.bonusFar) > 0 ? N(m.bonusFar) : N(m.far);
  const lotSF = N(m.lotSF);
  const buildableSF = lotSF * effFAR;
  const actualBuildingSF = N(m.actualBuildingSF);

  let commTotalSF = 0, commGross = 0;
  m.comm.forEach((c) => { commTotalSF += N(c.sf); commGross += N(c.sf) * N(c.rent); });
  const commEGI = commGross * (1 - N(m.commVacancyPct) / 100);
  const residentialSF = Math.max(0, actualBuildingSF - commTotalSF);
  const netSF = residentialSF * N(m.efficiency) / 100;

  const rawFactor = buildableSF / 680;
  const maxUnitsByZoning = Math.floor(rawFactor) + (rawFactor - Math.floor(rawFactor) >= 0.75 ? 1 : 0);

  const totalAcq = N(m.purchasePrice) + N(m.purchasePrice) * N(m.closingCostPct) / 100 + N(m.otherAcqCosts);
  const totalHard = actualBuildingSF * N(m.hardCostPerBSF) * (1 + N(m.hardContingencyPct) / 100);
  const totalSoft = totalHard * N(m.softCostPct) / 100;
  const loan = N(m.ltcPct) / 100 * (totalAcq + totalHard + totalSoft);
  const interestReserve = loan * N(m.interestRatePct) / 100 * (N(m.constructionMonths) / 12) * N(m.avgOutstandingPct) / 100;
  const origFee = loan * N(m.originationFeePct) / 100;
  const totalFin = interestReserve + origFee;
  const TDC = totalAcq + totalHard + totalSoft + totalFin;

  let totalUnits, marketUnits, affordableUnits, gpi = 0, rentRoll = [];
  if (m.dealType === "rental") {
    let mu = 0, au = 0;
    UNIT_TYPES.forEach(([t]) => {
      const cm = m.mkt[t];
      mu += N(cm.u); gpi += N(cm.u) * N(cm.r) * 12;
      const bands = {};
      AMI_BANDS.forEach((b) => {
        const ca = m.aff[t][b];
        au += N(ca.u); gpi += N(ca.u) * N(ca.r) * 12;
        if (N(ca.u) > 0) bands[b] = { u: N(ca.u), r: N(ca.r) };
      });
      rentRoll.push({ type: t, mu: N(cm.u), mr: N(cm.r), bands });
    });
    marketUnits = mu; affordableUnits = au; totalUnits = mu + au;
  } else {
    totalUnits = N(m.totalUnits);
    affordableUnits = totalUnits * N(m.affordablePct) / 100;
    marketUnits = totalUnits - affordableUnits;
  }
  const avgUnitSF = totalUnits > 0 ? netSF / totalUnits : 0;

  const out = {
    effFAR, lotSF, buildableSF, actualBuildingSF, maxUnitsByZoning, netSF,
    commTotalSF, commGross, commEGI, residentialSF,
    totalAcq, totalHard, totalSoft, totalFin, TDC,
    totalUnits, marketUnits, affordableUnits, avgUnitSF, rentRoll,
  };

  if (m.dealType === "rental") {
    const resEGI = gpi * (1 - N(m.vacancyPct) / 100);
    const EGI = resEGI + commEGI;
    const opex = EGI * N(m.opexPct) / 100;
    const NOI = EGI - opex - N(m.propertyTaxAnnual);
    const cap = N(m.exitCapRatePct);
    const exitValue = cap > 0 ? NOI / (cap / 100) : 0;
    out.GPI = gpi; out.EGI = EGI; out.opex = opex; out.NOI = NOI;
    out.capRate = cap; out.exitValue = exitValue;
    out.yieldOnCost = TDC > 0 ? NOI / TDC * 100 : 0;
    out.profit = exitValue - TDC;
  } else {
    const mSF = totalUnits > 0 ? netSF * (marketUnits / totalUnits) : 0;
    const aSF = totalUnits > 0 ? netSF * (affordableUnits / totalUnits) : 0;
    const gross = mSF * N(m.marketSellPSF) + aSF * N(m.affordableSellPSF);
    const net = gross * (1 - N(m.sellingCostPct) / 100);
    const commVal = N(m.commCapRate) > 0 ? commEGI / (N(m.commCapRate) / 100) : 0;
    out.grossRevenue = gross; out.netRevenue = net; out.commercialValue = commVal;
    out.profit = net + commVal - TDC;
    out.marginOnRevenue = (net + commVal) > 0 ? out.profit / (net + commVal) * 100 : 0;
  }
  out.margin = TDC > 0 ? out.profit / TDC * 100 : 0;
  return out;
}

/* ============================================================ */
function Underwriting({ initialModel, onExit, notify, userId, userName }) {
  const [m, setM] = useState(initialModel || blankModel());
  const [saved, setSaved] = useState([]);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const c = useMemo(() => runCalc(m), [m]);

  const set = (k, v) => setM((p) => ({ ...p, [k]: v }));
  const setMkt = (t, f, v) => setM((p) => ({ ...p, mkt: { ...p.mkt, [t]: { ...p.mkt[t], [f]: v } } }));
  const setAff = (t, b, f, v) => setM((p) => ({
    ...p, aff: { ...p.aff, [t]: { ...p.aff[t], [b]: { ...p.aff[t][b], [f]: v } } },
  }));
  const setComm = (i, f, v) => setM((p) => {
    const comm = p.comm.map((x, j) => (j === i ? { ...x, [f]: v } : x));
    return { ...p, comm };
  });

  useEffect(() => { loadList(); }, []);
  const loadList = async () => {
    const { data } = await supabase.from("models").select("id, data, owner_id, is_public").order("updated_at", { ascending: false });
    setSaved((data || []).map((r) => ({ ...r.data, isPublic: !!r.is_public, _owner: r.owner_id })));
  };
  const save = async () => {
    setBusy(true);
    const rec = { ...m, ownerName: m.ownerName || userName, updated: new Date().toISOString().slice(0, 10) };
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
    const P = PROGRAM_PRESETS[prog];
    setM((p) => {
      const mkt = { ...p.mkt }, aff = { ...p.aff };
      UNIT_TYPES.forEach(([t]) => {
        mkt[t] = { ...mkt[t], u: P.market[t] };
        aff[t] = { ...aff[t] };
        AMI_BANDS.forEach((b) => { aff[t][b] = { ...aff[t][b], u: P.aff[b][t] }; });
      });
      return { ...p, program: prog, affordablePct: P.affordablePct, mkt, aff };
    });
  };

  const isSS = streetSensitive.includes(m.district);
  const rental = m.dealType === "rental";

  return (
    <div className="uw">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <div className="eyebrow">Underwriting</div>
          <h1 style={{ margin: "2px 0 8px", fontSize: 26, fontWeight: 800, letterSpacing: "-0.01em" }}>Development Site Model</h1>
          <div className="dealline">
            <span>Deal</span>
            <input value={m.dealName} onChange={(e) => set("dealName", e.target.value)} placeholder="230 W 122nd Street" />
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
          <button className="ghost" onClick={() => setSheet(true)}>Client summary</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save model"}</button>
        </div>
      </header>

      {saved.length > 0 && (
        <div className="savedStrip">
          {saved.map((s) => (
            <span key={s.id} className="savedChip">
              <span onClick={() => setM(s)}>{s.dealName}{s._owner && s._owner !== userId ? ` · ${s.ownerName || "shared"}` : ""}</span>
              {(!s._owner || s._owner === userId) && <b onClick={() => del(s.id)}>✕</b>}
            </span>
          ))}
        </div>
      )}

      <div className="segRow">
        <div>
          <div className="segLabel">Deal type</div>
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
              <F label="Street type" hint={isSS ? "affects FAR here" : "no effect in this district"}>
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
              <F label="Overlay / special district" hint="optional">
                <input value={m.overlay} onChange={(e) => set("overlay", e.target.value)} placeholder="C2-4 overlay" />
              </F>
              <F label="Lot size" hint="SF"><input type="number" value={m.lotSF} onChange={(e) => set("lotSF", e.target.value)} /></F>
              <F label="Base FAR" hint="as-of-right"><input type="number" step="0.01" value={m.far} onChange={(e) => set("far", e.target.value)} /></F>
              <F label="Bonus FAR" hint="0 = use base"><input type="number" step="0.01" value={m.bonusFar} onChange={(e) => set("bonusFar", e.target.value)} /></F>
              <F label="Efficiency ratio" hint="built → net %"><input type="number" value={m.efficiency} onChange={(e) => set("efficiency", e.target.value)} /></F>
            </div>
            <div className="derived">
              Zoning buildable: {fmt(c.buildableSF)} BSF (max {c.maxUnitsByZoning} units @ 680 SF) → Actual building: {fmt(c.actualBuildingSF)} SF → Net rentable/sellable: {fmt(c.netSF)} SF
            </div>
            <div className="fg1" style={{ marginTop: 14 }}>
              <F label="Actual building SF" hint="drives cost — can differ from zoning envelope">
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="number" value={m.actualBuildingSF} onChange={(e) => set("actualBuildingSF", e.target.value)} />
                  <button className="mini" onClick={() => set("actualBuildingSF", Math.round(c.buildableSF))}>Match zoning max</button>
                </div>
              </F>
            </div>
          </Sec>

          <Sec n="02" t="Acquisition" open>
            <div className="fg2">
              <F label="Purchase price" hint="$"><input type="number" value={m.purchasePrice} onChange={(e) => set("purchasePrice", e.target.value)} /></F>
              <F label="Closing costs" hint="%"><input type="number" step="0.1" value={m.closingCostPct} onChange={(e) => set("closingCostPct", e.target.value)} /></F>
              <F label="Other acquisition costs" hint="$"><input type="number" value={m.otherAcqCosts} onChange={(e) => set("otherAcqCosts", e.target.value)} /></F>
            </div>
          </Sec>

          <Sec n="03" t="Hard & Soft Costs" open>
            <div className="fg2">
              <F label="Hard cost" hint="$ / built SF"><input type="number" value={m.hardCostPerBSF} onChange={(e) => set("hardCostPerBSF", e.target.value)} /></F>
              <F label="Contingency" hint="%"><input type="number" step="0.1" value={m.hardContingencyPct} onChange={(e) => set("hardContingencyPct", e.target.value)} /></F>
              <F label="Soft costs" hint="% of hard"><input type="number" step="0.1" value={m.softCostPct} onChange={(e) => set("softCostPct", e.target.value)} /></F>
            </div>
          </Sec>

          <Sec n="04" t="Construction Financing" open>
            <div className="fg2">
              <F label="Loan-to-cost" hint="%"><input type="number" step="0.1" value={m.ltcPct} onChange={(e) => set("ltcPct", e.target.value)} /></F>
              <F label="Interest rate" hint="%"><input type="number" step="0.1" value={m.interestRatePct} onChange={(e) => set("interestRatePct", e.target.value)} /></F>
              <F label="Construction period" hint="months"><input type="number" value={m.constructionMonths} onChange={(e) => set("constructionMonths", e.target.value)} /></F>
              <F label="Origination fee" hint="%"><input type="number" step="0.1" value={m.originationFeePct} onChange={(e) => set("originationFeePct", e.target.value)} /></F>
              <F label="Avg outstanding balance" hint="draw curve %"><input type="number" value={m.avgOutstandingPct} onChange={(e) => set("avgOutstandingPct", e.target.value)} /></F>
            </div>
          </Sec>

          <Sec n="05" t="Program & Unit Mix" open>
            <div className="derived brassText" style={{ borderTop: "none", paddingTop: 0, marginTop: 0 }}>
              Zoning max units (680 SF factor): {c.maxUnitsByZoning} — based on {fmt(c.buildableSF)} BSF
            </div>
            {!rental && (
              <div className="fg2" style={{ marginTop: 14 }}>
                <F label="Total units">
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="number" value={m.totalUnits} onChange={(e) => set("totalUnits", e.target.value)} />
                    <button className="mini" onClick={() => set("totalUnits", c.maxUnitsByZoning)}>Use max</button>
                  </div>
                </F>
                <F label="Affordable units" hint="%"><input type="number" step="0.1" value={m.affordablePct} onChange={(e) => set("affordablePct", e.target.value)} /></F>
              </div>
            )}
            {rental && (
              <div className="fg2" style={{ marginTop: 14 }}>
                <F label="Target total units" hint="planning check">
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="number" value={m.targetTotalUnits} onChange={(e) => set("targetTotalUnits", e.target.value)} />
                    <button className="mini" onClick={() => set("targetTotalUnits", c.maxUnitsByZoning)}>Use max</button>
                  </div>
                </F>
              </div>
            )}
            <div className="derived">
              {Math.round(c.marketUnits)} market + {Math.round(c.affordableUnits)} affordable = {Math.round(c.totalUnits)} total · avg {fmt(c.avgUnitSF)} SF/unit
              {rental && N(m.targetTotalUnits) > 0 && (
                Math.round(c.totalUnits) === Math.round(N(m.targetTotalUnits))
                  ? ` · matches target of ${Math.round(N(m.targetTotalUnits))}`
                  : ` · ${Math.round(c.totalUnits) - Math.round(N(m.targetTotalUnits)) > 0 ? "+" : ""}${Math.round(c.totalUnits) - Math.round(N(m.targetTotalUnits))} vs target`
              )}
            </div>
          </Sec>

          {rental ? (
            <Sec n="06" t="Unit Mix & Rent Roll" open>
              <div className="rrHead"><span>Free market</span></div>
              <div className="tableWrap">
                <table className="rr">
                  <thead><tr><th>Unit type</th><th>Units</th><th>Rent / mo</th></tr></thead>
                  <tbody>
                    {UNIT_TYPES.map(([t, label]) => (
                      <tr key={t}>
                        <td>{label}</td>
                        <td><input type="number" value={m.mkt[t].u} onChange={(e) => setMkt(t, "u", e.target.value)} /></td>
                        <td><input type="number" value={m.mkt[t].r} onChange={(e) => setMkt(t, "r", e.target.value)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rrHead" style={{ marginTop: 18 }}>
                <span>Affordable</span>
                <em>{PROGRAM_PRESETS[m.program].note}</em>
              </div>
              <div className="tableWrap">
                <table className="rr">
                  <thead>
                    <tr><th rowSpan={2}>Unit type</th><th colSpan={2}>80% AMI</th><th colSpan={2}>60% AMI</th><th colSpan={2}>40% AMI</th></tr>
                    <tr><th>Units</th><th>Rent</th><th>Units</th><th>Rent</th><th>Units</th><th>Rent</th></tr>
                  </thead>
                  <tbody>
                    {UNIT_TYPES.map(([t, label]) => (
                      <tr key={t}>
                        <td>{label}</td>
                        {AMI_BANDS.map((b) => (
                          <React.Fragment key={b}>
                            <td><input type="number" value={m.aff[t][b].u} onChange={(e) => setAff(t, b, "u", e.target.value)} /></td>
                            <td><input type="number" value={m.aff[t][b].r} onChange={(e) => setAff(t, b, "r", e.target.value)} /></td>
                          </React.Fragment>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="subnote">Affordable rents pre-loaded from the current AMI schedule. Update if HPD/HCR publishes new figures or your community district differs.</div>
              <div className="fg2" style={{ marginTop: 18 }}>
                <F label="Vacancy" hint="%"><input type="number" step="0.1" value={m.vacancyPct} onChange={(e) => set("vacancyPct", e.target.value)} /></F>
                <F label="Operating expenses" hint="% of EGI"><input type="number" step="0.1" value={m.opexPct} onChange={(e) => set("opexPct", e.target.value)} /></F>
                <F label="Property tax" hint="annual, net of abatement"><input type="number" value={m.propertyTaxAnnual} onChange={(e) => set("propertyTaxAnnual", e.target.value)} /></F>
                <F label="Exit cap rate" hint="%"><input type="number" step="0.05" value={m.exitCapRatePct} onChange={(e) => set("exitCapRatePct", e.target.value)} /></F>
              </div>
            </Sec>
          ) : (
            <Sec n="06" t="Sellout Assumptions" open>
              <div className="fg2">
                <F label="Market sellout" hint="$/SF"><input type="number" value={m.marketSellPSF} onChange={(e) => set("marketSellPSF", e.target.value)} /></F>
                <F label="Affordable sellout" hint="$/SF"><input type="number" value={m.affordableSellPSF} onChange={(e) => set("affordableSellPSF", e.target.value)} /></F>
                <F label="Selling costs" hint="% commission + legal"><input type="number" step="0.1" value={m.sellingCostPct} onChange={(e) => set("sellingCostPct", e.target.value)} /></F>
              </div>
            </Sec>
          )}

          <Sec n="07" t="Commercial Income">
            <div className="tableWrap">
              <table className="rr">
                <thead><tr><th>Space</th><th>SF</th><th>Rent / SF / yr</th></tr></thead>
                <tbody>
                  {m.comm.map((cm, i) => (
                    <tr key={i}>
                      <td>Commercial {i + 1}</td>
                      <td><input type="number" value={cm.sf} onChange={(e) => setComm(i, "sf", e.target.value)} /></td>
                      <td><input type="number" value={cm.rent} onChange={(e) => setComm(i, "rent", e.target.value)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="derived">
              {c.commTotalSF > 0
                ? `${fmt(c.commTotalSF)} SF commercial → ${fmt(c.residentialSF)} SF left for residential (of ${fmt(c.actualBuildingSF)} total)`
                : `No commercial entered — full ${fmt(c.actualBuildingSF)} SF treated as residential`}
            </div>
            <div className="fg2" style={{ marginTop: 14 }}>
              <F label="Commercial vacancy" hint="%"><input type="number" step="0.1" value={m.commVacancyPct} onChange={(e) => set("commVacancyPct", e.target.value)} /></F>
              {!rental && <F label="Commercial cap rate" hint="values retained space"><input type="number" step="0.05" value={m.commCapRate} onChange={(e) => set("commCapRate", e.target.value)} /></F>}
            </div>
            <div className="subnote">Commercial SF is carved out of actual building SF — not added on top.</div>
          </Sec>
        </div>

        <div className="uwSum">
          <div className="sumHead">
            <span>Underwriting summary</span>
            <span>{rental ? "RENTAL" : "CONDO"} · {m.program.toUpperCase()}</span>
          </div>
          <div style={{ padding: "6px 18px 18px" }}>
            <div className="divLabel">Development cost</div>
            <Row l="Acquisition" v={money(c.totalAcq)} />
            <Row l="Hard costs" v={money(c.totalHard)} />
            <Row l="Soft costs" v={money(c.totalSoft)} />
            <Row l="Financing costs" v={money(c.totalFin)} />
            <Row l="Total dev. cost" v={money(c.TDC)} total />
            <div className="divLabel">{rental ? "Revenue at stabilization" : "Sellout revenue"}</div>
            {rental ? (
              <>
                <Row l="Net operating income" v={money(c.NOI)} />
                <Row l={`Exit value @ ${N(m.exitCapRatePct).toFixed(2)}% cap`} v={money(c.exitValue)} total />
              </>
            ) : (
              <>
                <Row l="Gross sellout revenue" v={money(c.grossRevenue)} />
                <Row l="Net revenue + commercial" v={money(c.netRevenue + c.commercialValue)} total />
              </>
            )}
            <div className={"profit" + (c.profit < 0 ? " neg" : "")}>
              <div className="pl">Projected profit</div>
              <div className="pv">{(c.profit < 0 ? "-" : "") + money(Math.abs(c.profit))}</div>
            </div>
            <div className="mcards">
              <MC l="Profit margin" v={pct(c.margin)} good={c.margin >= 0} />
              <MC l={rental ? "Yield on cost" : "Margin on revenue"} v={pct(rental ? c.yieldOnCost : c.marginOnRevenue)} />
              <MC l="Cost / built SF" v={c.actualBuildingSF > 0 ? money(c.TDC / c.actualBuildingSF) : "—"} />
              <MC l="Cost / unit" v={c.totalUnits > 0 ? money(c.TDC / c.totalUnits) : "—"} />
            </div>
          </div>
        </div>
      </div>

      <div className="foot">Editable defaults, not advice — verify 485-x / UAP / MIH rules and rent tables before circulating.</div>
      {sheet && <ClientSheet m={m} c={c} onClose={() => setSheet(false)} />}
    </div>
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
function Row({ l, v, total }) {
  return <div className={"ledger" + (total ? " total" : "")}><span>{l}</span><b>{v}</b></div>;
}
function MC({ l, v, good }) {
  return (
    <div className="mcard">
      <div className="ml">{l}</div>
      <div className="mv" data-good={good === undefined ? undefined : good}>{v}</div>
    </div>
  );
}

/* ---------- client summary sheet ---------- */
function ClientSheet({ m, c, onClose }) {
  const rental = m.dealType === "rental";
  const typeLabels = Object.fromEntries(UNIT_TYPES);
  const zdLabel = m.district
    ? m.district + (streetSensitive.includes(m.district) ? ` — ${m.street === "wide" ? "Wide street" : "Narrow street"}` : "")
    : "—";
  const openClean = () => {
    const html = document.getElementById("uw-sheet")?.outerHTML || "";
    const css = document.getElementById("jrg-styles")?.textContent || "";
    const w = window.open("", "_blank");
    if (w) {
      w.document.open();
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${m.dealName}</title><style>${css}
body{background:#f2efe6;margin:0;padding:24px;}
#uw-sheet{box-shadow:none;margin:0 auto;}</style></head><body>${html}</body></html>`);
      w.document.close();
    }
  };
  return (
    <div className="modalWrap" onClick={onClose}>
      <div style={{ width: 780, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="sheet" id="uw-sheet">
          <div className="shTop">
            <div>
              <img className="shLogo" src={LOGO_FULL} alt="JStone Realty" />
              <div className="shBrand">Development Underwriting Summary</div>
              <div className="shTitle">{m.dealName}</div>
              <div className="shSub">
                {[m.marketArea, rental ? "Rental Hold" : "Condo Sellout", m.program.toUpperCase() + " Program"].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="shDate">{new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</div>
          </div>
          <div className="shSec">
            <div className="shH">Site & Program</div>
            <div className="shGrid">
              <SR l="Zoning district" v={zdLabel} />
              <SR l="Development path" v={m.devPath === "uap" ? "City of Yes — UAP" : "As-of-right"} />
              {m.overlay && <SR l="Overlay" v={m.overlay} />}
              <SR l="Lot size" v={fmt(c.lotSF) + " SF"} />
              <SR l="Effective FAR" v={c.effFAR.toFixed(2)} />
              <SR l="Zoning buildable" v={fmt(c.buildableSF) + " BSF"} />
              <SR l="Zoning max units" v={c.maxUnitsByZoning} />
              <SR l="Actual building SF" v={fmt(c.actualBuildingSF) + " SF"} />
              <SR l="Net rentable/sellable" v={fmt(c.netSF) + " SF"} />
              <SR l="Total units" v={Math.round(c.totalUnits)} />
              <SR l="Market / affordable" v={`${Math.round(c.marketUnits)} / ${Math.round(c.affordableUnits)}`} />
            </div>
          </div>
          {rental && c.rentRoll?.length > 0 && (
            <div className="shSec">
              <div className="shH">Unit Mix & Rent Roll</div>
              <table className="shTable">
                <thead><tr><th>Unit type</th><th>Free market</th><th style={{ textAlign: "left" }}>Affordable</th></tr></thead>
                <tbody>
                  {c.rentRoll.filter((r) => r.mu > 0 || Object.keys(r.bands).length).map((r) => (
                    <tr key={r.type}>
                      <td>{typeLabels[r.type]}</td>
                      <td>{r.mu > 0 ? `${r.mu} @ ${money(r.mr)}` : "—"}</td>
                      <td style={{ textAlign: "left" }}>
                        {AMI_BANDS.map((b) => (r.bands[b] ? `${r.bands[b].u} @ ${money(r.bands[b].r)} (${b}% AMI)` : null)).filter(Boolean).join(" · ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {c.commTotalSF > 0 && (
            <div className="shSec">
              <div className="shH">Commercial Income</div>
              <div className="shGrid">
                <SR l="Total commercial SF" v={fmt(c.commTotalSF) + " SF"} />
                <SR l="Effective income" v={money(c.commEGI) + "/yr"} />
                {!rental && <SR l="Retained commercial value" v={money(c.commercialValue)} />}
              </div>
            </div>
          )}
          <div className="shSec">
            <div className="shH">Development Cost</div>
            <div className="shGrid">
              <SR l="Acquisition" v={money(c.totalAcq)} />
              <SR l="Hard costs" v={money(c.totalHard)} />
              <SR l="Soft costs" v={money(c.totalSoft)} />
              <SR l="Financing costs" v={money(c.totalFin)} />
              <SR l="Total dev. cost" v={money(c.TDC)} />
              <SR l="Cost / unit" v={c.totalUnits > 0 ? money(c.TDC / c.totalUnits) : "—"} />
            </div>
          </div>
          <div className="shSec">
            <div className="shH">{rental ? "Projected Value at Stabilization" : "Projected Sellout"}</div>
            <div className="shGrid">
              {rental ? (
                <>
                  <SR l="Net operating income" v={money(c.NOI)} />
                  <SR l="Exit cap rate" v={N(m.exitCapRatePct).toFixed(2) + "%"} />
                  <SR l="Exit value" v={money(c.exitValue)} />
                  <SR l="Projected profit" v={money(c.profit)} />
                </>
              ) : (
                <>
                  <SR l="Gross sellout revenue" v={money(c.grossRevenue)} />
                  <SR l="Net revenue" v={money(c.netRevenue)} />
                  <SR l="Projected profit" v={money(c.profit)} />
                  <SR l="Profit margin on cost" v={pct(c.margin)} />
                </>
              )}
            </div>
            <div className="shHl">
              <span>{rental ? "Yield on cost" : "Margin on revenue"}</span>
              <b>{pct(rental ? c.yieldOnCost : c.marginOnRevenue)}</b>
            </div>
          </div>
          <div className="shFoot">
            Prepared by JStone Realty. Figures are preliminary underwriting estimates based on the assumptions stated
            above and are subject to due diligence, final zoning analysis, and market verification. Not an offer or
            guarantee of financing, pricing, or returns.
          </div>
        </div>
        <div className="sheetActions">
          <button className="ghost" onClick={onClose}>Close</button>
          <button className="ghost" onClick={openClean}>Open clean copy</button>
          <button className="primary" onClick={() => window.print()}>Print / Save as PDF</button>
        </div>
      </div>
    </div>
  );
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
  vacancy: "TBD", existingSf: "", contactName: "", contactPhone: "", notes: "", isPublic: false,
  created: new Date().toISOString().slice(0, 10),
});
const blankBuyer = () => ({
  id: uid(), name: "", company: "", phone: "", email: "",
  boroughs: [], minSize: "", maxBudget: "", assetTypes: [], notes: "", isPublic: false,
});

function DealDesk({ view, notify, onUnderwrite, userId, userName }) {
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
  const [importMsg, setImportMsg] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      const [d, b] = await Promise.all([
        supabase.from("deals").select("id, data, owner_id, is_public").order("updated_at", { ascending: false }),
        supabase.from("buyers").select("id, data, owner_id, is_public").order("updated_at", { ascending: false }),
      ]);
      const hydrate = (rows) => (rows || []).map((r) => ({ ...r.data, isPublic: !!r.is_public, _owner: r.owner_id }));
      setDeals(hydrate(d.data));
      setBuyers(hydrate(b.data));
      setLoaded(true);
    })();
  }, []);

  useEffect(() => { setDealForm(null); setBuyerForm(null); }, [view]);

  const saveDeal = async () => {
    if (!dealForm.address.trim()) return;
    const rec = { ...dealForm, ownerName: dealForm.ownerName || userName };
    const exists = deals.some((d) => d.id === rec.id);
    setDeals(exists ? deals.map((d) => (d.id === rec.id ? rec : d)) : [rec, ...deals]);
    setDealForm(null);
    const { error } = await supabase.from("deals").upsert({
      id: rec.id, data: rec, owner_id: userId, is_public: !!rec.isPublic, updated_at: new Date().toISOString(),
    });
    notify?.(error ? (error.message || "Save failed.") : (rec.isPublic ? "Deal saved and published to the team." : "Deal saved — visible only to you."));
  };
  const deleteDeal = async (id) => {
    const d = deals.find((x) => x.id === id);
    if (d?.photos) for (const p of d.photos) await photoDel(p);
    setDeals(deals.filter((x) => x.id !== id));
    setDealForm(null);
    await supabase.from("deals").delete().eq("id", id);
  };

  const saveBuyer = async () => {
    if (!buyerForm.name.trim()) return;
    const rec = { ...buyerForm, ownerName: buyerForm.ownerName || userName };
    const exists = buyers.some((b) => b.id === rec.id);
    setBuyers(exists ? buyers.map((b) => (b.id === rec.id ? rec : b)) : [rec, ...buyers]);
    setBuyerForm(null);
    const { error } = await supabase.from("buyers").upsert({
      id: rec.id, data: rec, owner_id: userId, is_public: !!rec.isPublic, updated_at: new Date().toISOString(),
    });
    notify?.(error ? (error.message || "Save failed.") : "Buyer saved.");
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
        setImportMsg(error ? (error.message || "Import failed to save.") : `Imported ${imported.length} contacts. Open each to tag boroughs and criteria.`);
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
      return !t || [d.address, d.neighborhood, d.zone, d.notes, d.contactName].join(" ").toLowerCase().includes(t);
    });
  }, [deals, q, boroFilter, ownFilter, userId]);

  const filteredBuyers = useMemo(() => {
    const t = bq.toLowerCase();
    return buyers.filter((b) =>
      (bBoro === "All" || b.boroughs?.includes(bBoro)) &&
      (!t || [b.name, b.company, b.notes, b.email, b.phone].join(" ").toLowerCase().includes(t)));
  }, [buyers, bq, bBoro]);

  if (!loaded) return <div style={{ padding: 40, opacity: 0.6 }}>Loading your desk…</div>;

  /* ---------- DEALS ---------- */
  if (view === "deals" && !dealForm) return (
    <>
      <header className="pageHead">
        <h1>Deals</h1>
        <button className="primary" onClick={() => setDealForm(blankDeal())}>+ New deal</button>
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
      <div className="cardGrid">
        {filteredDeals.map((d) => {
          const z = computeZoning(d.zone, d.streetWidth, d.lotArea, d.customFar);
          const ask = parseFloat(d.askingPrice);
          const uapPath = d.devPath === "uap";
          const mine = !d._owner || d._owner === userId;
          const perAor = z && z.baseZfa > 0 && ask ? ask / z.baseZfa : null;
          const perUap = z && z.uapZfa > 0 && ask ? ask / z.uapZfa : null;
          return (
            <div key={d.id} className="card" onClick={() => setDealForm({ ...d })}>
              {d.photos?.[0] && <img className="cardPhoto" src={photoUrl(d.photos[0])} alt="" loading="lazy" />}
              <div className="cardTop">
                <span className="tag">{d.borough}</span>
                <span className="tag alt">{d.zone}</span>
                <span className="tag path">{uapPath ? "UAP" : "As-of-right"}</span>
                <span className={"tag " + (d.isPublic ? "pub" : "priv")}>{d.isPublic ? "Published" : "Private"}</span>
                {!mine && <span className="tag shared">Shared</span>}
                {d.vacancy === "Delivered vacant" && <span className="tag green">Vacant</span>}
                <button className="shareBtn" onClick={(e) => { e.stopPropagation(); setShareFor(d); }}>Share ↗</button>
              </div>
              <div className="cardAddr">{d.address || "Untitled"}</div>
              {d.neighborhood && <div className="cardSub">{d.neighborhood}</div>}
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
      </div>
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
        <div className="chips">
          {["All", ...BOROUGHS].map((b) => (
            <button key={b} className="chip" data-on={bBoro === b} onClick={() => setBBoro(b)}>{b}</button>
          ))}
        </div>
      </div>
      {filteredBuyers.length === 0 && (
        <div className="empty">{buyers.length === 0
          ? "No buyers yet. Add them one by one, or import your old CRM export as a CSV."
          : "No buyers match. Imported contacts need boroughs tagged before borough filters find them."}</div>
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
            </div>
            <div style={{ flex: 1, minWidth: 90 }}>{b.minSize ? `${fmt(b.minSize)}+ SF` : ""}</div>
            <div style={{ flex: 1, minWidth: 90 }}>{b.maxBudget ? `≤ ${money(b.maxBudget)}` : ""}</div>
            <div style={{ flex: 1, minWidth: 100, opacity: 0.7 }}>{b.phone}</div>
            <span className="byline"><i>{initials(b.ownerName || userName)}</i>{b.ownerName || userName}</span>
          </div>
        ))}
      </div>
    </>
  );

  if (view === "buyers" && buyerForm) return (
    <BuyerForm buyer={buyerForm} setBuyer={setBuyerForm} onSave={saveBuyer}
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
  const ss = ["R6", "R7-1", "R7-2", "R8"].includes(DEAL_ZONES[zone]);
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
function ZoningPanel({ zone, streetWidth, lotArea, customFar, askingPrice, devPath }) {
  const z = computeZoning(zone, streetWidth, lotArea, customFar);
  if (!z) return null;
  const ask = parseFloat(askingPrice);
  const ss = ["R6", "R7-1", "R7-2", "R8"].includes(z.district);
  const uapPath = devPath === "uap";
  return (
    <div className="zpanel">
      <div className="zpanelTitle">Zoning analysis · {zone}{ss ? ` · ${streetWidth} street` : ""} · {uapPath ? "UAP" : "as-of-right"}</div>
      <div className="zgrid">
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

function DealForm({ deal, setDeal, buyers, onSave, onCancel, onDelete, onShare, onUnderwrite, isNew, mine = true, notify }) {
  const set = (k) => (e) => setDeal({ ...deal, [k]: e.target.value });
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);
  const photoRef = useRef(null);
  const matches = matchBuyers(deal, buyers);
  const ss = ["R6", "R7-1", "R7-2", "R8"].includes(DEAL_ZONES[deal.zone]);

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
            <div className="frow"><Fld label="Address *" wide><input value={deal.address} onChange={set("address")} placeholder="1982 Belmont Ave" /></Fld></div>
            <div className="frow">
              <Fld label="Borough"><select value={deal.borough} onChange={set("borough")}>{BOROUGHS.map((b) => <option key={b}>{b}</option>)}</select></Fld>
              <Fld label="Neighborhood"><input value={deal.neighborhood} onChange={set("neighborhood")} placeholder="Belmont / Fordham" /></Fld>
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
              <Fld label="Zoning district"><select value={deal.zone} onChange={set("zone")}>{Object.keys(DEAL_ZONES).map((z) => <option key={z}>{z}</option>)}</select></Fld>
              {ss && (
                <Fld label="Street">
                  <select value={deal.streetWidth} onChange={set("streetWidth")}>
                    <option value="narrow">Narrow (&lt;75 ft)</option>
                    <option value="wide">Wide (≥75 ft)</option>
                  </select>
                </Fld>
              )}
              {deal.zone === "Custom" && <Fld label="Custom FAR"><input type="number" value={deal.customFar} onChange={set("customFar")} placeholder="3.0" /></Fld>}
              <Fld label="Development path">
                <select value={deal.devPath || "aor"} onChange={set("devPath")}>
                  <option value="aor">As-of-right</option>
                  <option value="uap">UAP (City of Yes)</option>
                </select>
              </Fld>
              <Fld label="Lot area (SF)"><input type="number" value={deal.lotArea} onChange={set("lotArea")} placeholder="5000" /></Fld>
              <Fld label="Existing bldg SF"><input type="number" value={deal.existingSf} onChange={set("existingSf")} placeholder="optional" /></Fld>
            </div>
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
            </div>
            <Fld label="Notes" wide><textarea rows={3} value={deal.notes} onChange={set("notes")} placeholder="Off-market, wants quiet process, open to seller financing…" /></Fld>
          </div>
        </div>
        <div className="formSide">
          <ZoningPanel zone={deal.zone} streetWidth={deal.streetWidth} lotArea={deal.lotArea} customFar={deal.customFar} askingPrice={deal.askingPrice} devPath={deal.devPath} />
          <div className="zpanel" style={{ marginTop: 14 }}>
            <div className="zpanelTitle">Matching buyers ({matches.length})</div>
            {matches.length === 0 && <div style={{ padding: "10px 2px", fontSize: 13, opacity: 0.6 }}>No buyers match this borough / size / budget yet.</div>}
            {matches.slice(0, 8).map((b) => (
              <div key={b.id} className="matchRow"><b>{b.name}</b><span>{b.phone || b.email || ""}</span></div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function BuyerForm({ buyer, setBuyer, onSave, onCancel, onDelete, isNew, mine = true }) {
  const set = (k) => (e) => setBuyer({ ...buyer, [k]: e.target.value });
  const [arm, setArm] = useState(false);
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
            <Fld label="Phone"><input value={buyer.phone} onChange={set("phone")} /></Fld>
            <Fld label="Email"><input value={buyer.email} onChange={set("email")} /></Fld>
          </div>
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

  if (session === undefined) return <div className="center">Connecting…</div>;
  if (!session) return <SignIn />;
  return <Shell user={session.user} key={session.user.id} />;
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
          <span
            style={{ color: BLUE, fontWeight: 600, cursor: "pointer" }}
            onClick={() => { setMode(mode === "up" ? "in" : "up"); setMsg(""); }}
          >
            {mode === "up" ? "I already have an account" : "New here? Create an account"}
          </span>
        </div>
      </form>
    </div>
  );
}

function Shell({ user }) {
  const userId = user.id;
  const [userName, setUserName] = useState(user.user_metadata?.full_name?.trim() || "");
  const displayName = userName || (user.email || "You").split("@")[0];

  const [view, setView] = useState("home");     // home | deals | buyers | zcalc | uw
  const [uwModel, setUwModel] = useState(() => blankModel());
  const [returnTo, setReturnTo] = useState(null);
  const [toast, setToast] = useState("");
  const notify = (m) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const underwriteDeal = (deal) => {
    setUwModel(modelFromDeal(deal));
    setReturnTo("deals");
    setView("uw");
  };

  const NAV = [["home", "Home"], ["deals", "Deals"], ["buyers", "Buyers"], ["zcalc", "Zoning calc"], ["uw", "Underwriting"]];

  return (
    <>
      <style id="jrg-styles">{CSS}</style>
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
                onClick={() => { if (id === "uw") setReturnTo(null); setView(id); }}>{label}</button>
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

          {view === "home" && (
            <>
              <header className="pageHead"><h1>Welcome back</h1></header>
              {!userName && <NamePrompt onSaved={setUserName} />}
              <p className="homeIntro">Where do you want to work?</p>
              <div className="homeCards">
                <div className="homeCard" onClick={() => setView("deals")}>
                  <div className="hcTag">01</div>
                  <h2>Deal Desk</h2>
                  <p>Log a property while you're still on the phone. Live zoning analysis, photos, one-tap client share, and instant buyer matching.</p>
                  <span className="hcGo">Open deals →</span>
                </div>
                <div className="homeCard" onClick={() => setView("buyers")}>
                  <div className="hcTag">02</div>
                  <h2>Buyers</h2>
                  <p>Your whole database with buy boxes — borough, size, budget. Search by borough when a buyer calls.</p>
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
                  <p>Full development model — FAR and unit counts, 485-x / UAP / MIH programs, rent roll, costs, financing, exit. Client summary in one click.</p>
                  <span className="hcGo">Open model →</span>
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
            <DealDesk view={view} notify={notify} onUnderwrite={underwriteDeal} userId={userId} userName={displayName} />
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
.visRow{display:flex;gap:10px;flex-wrap:wrap}
.visBtn{flex:1 1 180px;text-align:left;background:#fff;border:1px solid ${LINE};border-radius:9px;padding:11px 14px;color:${INK}}
.visBtn b{display:block;font-size:14px}
.visBtn span{display:block;font-size:11.5px;opacity:.6;margin-top:2px}
.visBtn[data-on="true"]{border-color:${BLUE};background:#F4F7FE;box-shadow:0 0 0 2px rgba(36,86,200,.12)}
.ghost[data-on="true"]{border-color:#2E7D5B;color:#2E7D5B}
.tag.green{background:#2E7D5B}
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
  body *{visibility:hidden}
  #uw-sheet,#uw-sheet *{visibility:visible}
  .modalWrap{position:static;background:none;padding:0;overflow:visible}
  #uw-sheet{position:absolute;top:0;left:0;width:100%;box-shadow:none}
  .sheetActions{display:none}
}
@media (max-width:900px){.uwGrid{grid-template-columns:1fr}.uwSum{position:static}}
@media (max-width:760px){
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
`;

export default App;
