/* ============================================================
   RENTAL ACQUISITION UNDERWRITING — buy an existing rental building and hold it.
   Pure math (no React): one set of numbers for the screen, the report and the grids.
   Saved in the same `models` table as development models, inside the JSON,
   marked kind: "rental". Development models have no `kind` and are untouched.
   Every default below is a starting point, labeled as a default and editable.
   ============================================================ */
import { RENTAL_DEFAULTS, RENTAL_EXP_PER_UNIT, RENTAL_EXP_LABELS } from "./uwConstants.js";

const N = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const UNIT_STATUS = [["fm", "Free market"], ["rs", "Rent stabilized"], ["vou", "Voucher / HASA"]];
export const STATUS_SHORT = { fm: "FM", rs: "RS", vou: "Vchr" };
export const EXP_KEYS = RENTAL_EXP_LABELS.map(([k]) => k);

export const newUnit = (n = "", o = {}) => ({ id: rid(), unit: String(n), beds: 1, sf: 0, status: "fm", current: 0, market: 0, leaseEnd: "", vacant: false, ...o });

export function blankRental(borough = "") {
  const D = RENTAL_DEFAULTS;
  const units = [
    newUnit("1A", { beds: 1, status: "rs", current: 1350, market: 1350 }),
    newUnit("1B", { beds: 2, status: "rs", current: 1500, market: 1500 }),
    newUnit("2A", { beds: 1, status: "fm", current: 1900, market: 2100 }),
    newUnit("2B", { beds: 2, status: "fm", current: 2200, market: 2450 }),
    newUnit("3A", { beds: 1, status: "vou", current: 2250, market: 2250 }),
    newUnit("3B", { beds: 2, status: "fm", current: 0, market: 2450, vacant: true }),
  ];
  const m = {
    kind: "rental", v: 1, id: "rent-" + rid(), dealId: null,
    dealName: "Untitled rental", marketArea: "", borough, buildingSF: 6000, yearBuilt: "",
    purchasePrice: 1200000, closingCostPct: D.closingCostPct, otherAcqCosts: 0, mrtPct: D.mrtPct,
    units, sampleRoll: true,
    otherIncomeYr: 0, vacancyPct: D.vacancyPct, creditLossPct: D.creditLossPct,
    rentGrowthPct: D.rentGrowthPct, rgbPct: D.rgbPct, voucherGrowthPct: D.voucherGrowthPct, mtmY1Pct: D.mtmY1Pct,
    exp: {}, mgmtPct: D.mgmtPct, reservesPerUnit: D.reservesPerUnit,
    expGrowthPct: D.expGrowthPct, taxGrowthPct: D.taxGrowthPct,
    capex: 0, capexNote: "",
    loanMode: "lesser", ltvPct: D.ltvPct, loanAmt: 0, ratePct: D.ratePct, amortYrs: D.amortYrs, ioYrs: 0,
    loanFeePct: D.loanFeePct, minDscr: D.minDscr, minDebtYield: D.minDebtYield,
    holdYrs: D.holdYrs, exitCapPct: D.exitCapPct, sellCostPct: D.sellCostPct,
    isPublic: false, updated: new Date().toISOString().slice(0, 10),
  };
  m.exp = typicalExpenses(m);
  return m;
}

/* "typical NYC walk-up" $/unit/yr starting points, scaled to the unit count (labeled typical, verify) */
export function typicalExpenses(m) {
  const n = (m.units || []).length;
  const out = {};
  EXP_KEYS.forEach((k) => { out[k] = k === "taxes" ? Math.round(N(m.purchasePrice) * RENTAL_DEFAULTS.taxPctOfPrice / 100) : Math.round(N(RENTAL_EXP_PER_UNIT[k]) * n); });
  return out;
}

/* open any saved rental model; missing fields fall back to the defaults */
export function upgradeRental(raw) {
  if (!raw) return blankRental();
  const base = blankRental(raw.borough || "");
  const units = Array.isArray(raw.units) ? raw.units.map((u) => ({ ...newUnit(), ...u, id: u.id || rid() })) : base.units;
  return { ...base, ...raw, kind: "rental", units, exp: { ...base.exp, ...(raw.exp || {}) } };
}

/* annual payment on an amortizing loan (amort 0 = interest-only) */
const annualPmt = (loan, ratePct, years) => {
  const r = N(ratePct) / 100 / 12, n = N(years) * 12;
  if (loan <= 0) return 0;
  if (n <= 0) return loan * N(ratePct) / 100;
  if (r === 0) return loan / n * 12;
  return loan * r / (1 - Math.pow(1 + r, -n)) * 12;
};
const balanceAfter = (loan, ratePct, years, monthsPaid) => {
  const r = N(ratePct) / 100 / 12, n = N(years) * 12;
  if (loan <= 0) return 0;
  if (n <= 0) return loan;
  if (r === 0) return Math.max(0, loan * (1 - monthsPaid / n));
  const p = loan * r / (1 - Math.pow(1 + r, -n));
  return loan * Math.pow(1 + r, monthsPaid) - p * (Math.pow(1 + r, monthsPaid) - 1) / r;
};

export function irr(cfs) {
  if (!cfs.length || !(cfs.some((x) => x < 0) && cfs.some((x) => x > 0))) return NaN;
  const npv = (r) => cfs.reduce((s, c, t) => s + c / Math.pow(1 + r, t), 0);
  let lo = -0.99, hi = 5, flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return NaN;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, f = npv(mid);
    if (Math.abs(f) < 1e-6) return mid * 100;
    if (f * flo > 0) { lo = mid; flo = f; } else { hi = mid; }
  }
  return (lo + hi) / 2 * 100;
}

/* ---------- the model ---------- */
export function runRental(m) {
  const units = Array.isArray(m.units) ? m.units : [];
  const nU = units.length;
  const price = N(m.purchasePrice);
  const bsf = N(m.buildingSF);
  const g = N(m.rentGrowthPct) / 100, rgb = N(m.rgbPct) / 100, vg = N(m.voucherGrowthPct) / 100;
  const eg = N(m.expGrowthPct) / 100, tg = N(m.taxGrowthPct) / 100;
  const mtm = Math.min(100, Math.max(0, N(m.mtmY1Pct))) / 100;
  const hold = Math.min(10, Math.max(1, Math.round(N(m.holdYrs) || 5)));

  // rent roll: in-place (today), pro forma (stabilized, year-1 dollars)
  const rows = units.map((u) => {
    const cur = u.vacant ? 0 : N(u.current);
    const mkt = N(u.market) > 0 ? N(u.market) : N(u.current);
    let pf;
    if (u.status === "rs") pf = u.vacant ? mkt : cur;                  // RS: legal rent, no mark-to-market (RGB growth from year 2)
    else pf = mkt;                                                     // FM at market, voucher at contract / payment standard
    return { ...u, cur, mkt, pf, gap: pf - cur };
  });
  const sumR = (f) => rows.reduce((s, r) => s + f(r), 0);
  const inPlaceM = sumR((r) => r.cur);
  const proFormaM = sumR((r) => r.pf);
  const byStatus = Object.fromEntries(UNIT_STATUS.map(([k]) => [k, {
    n: rows.filter((r) => r.status === k).length, cur: sumR((r) => (r.status === k ? r.cur : 0)), pf: sumR((r) => (r.status === k ? r.pf : 0)),
  }]));
  const vacantN = rows.filter((r) => r.vacant).length;
  const rsShare = nU ? byStatus.rs.n / nU * 100 : 0;
  const bedsN = sumR((r) => N(r.beds));

  // expenses, year-1 dollars
  const exp = m.exp || {};
  const fixedExp = EXP_KEYS.reduce((s, k) => s + N(exp[k]), 0);
  const reserves = N(m.reservesPerUnit) * nU;
  const vacRate = (N(m.vacancyPct) + N(m.creditLossPct)) / 100;

  const opYear = (gprM, other, t, factor = 1) => {
    // t = years from today (0 = year 1). Taxes grow at the tax rate, everything else at expense growth.
    const GPR = gprM * 12;
    const GPI = GPR + other;
    const vac = GPI * vacRate;
    const EGI = GPI - vac;
    const taxes = N(exp.taxes) * Math.pow(1 + tg, t);
    const otherFixed = (fixedExp - N(exp.taxes)) * Math.pow(1 + eg, t);
    const mgmt = EGI * N(m.mgmtPct) / 100;
    const res = reserves * Math.pow(1 + eg, t);
    const opex = taxes + otherFixed + mgmt + res;
    return { GPR, other, GPI, vac, EGI, taxes, otherFixed, mgmt, reserves: res, opex, NOI: EGI - opex };
  };
  const otherY1 = N(m.otherIncomeYr);
  const inPlace = opYear(inPlaceM, otherY1, 0);
  const proForma = opYear(proFormaM, otherY1, 0);

  // year-by-year rents: FM/voucher move from in-place toward market (mtm% captured in year 1, all by year 2), RS at RGB
  const rentInYear = (r, t) => {             // t = 0 for year 1
    if (r.status === "rs") return (r.vacant ? r.mkt : r.cur) * Math.pow(1 + rgb, t);
    const gr = r.status === "vou" ? vg : g;
    const start = r.vacant ? r.mkt : r.cur + (r.mkt - r.cur) * (t === 0 ? mtm : 1);
    return (t === 0 ? start : r.mkt) * Math.pow(1 + gr, t);
  };

  // financing
  const D = (loan) => annualPmt(loan, m.ratePct, m.amortYrs);
  const constant = D(1);                                   // amortizing constant (lenders size on this)
  const ltvLoan = price * N(m.ltvPct) / 100;
  const dscrLoan = constant > 0 && N(m.minDscr) > 0 ? Math.max(0, inPlace.NOI) / N(m.minDscr) / constant : 0;
  const dyLoan = N(m.minDebtYield) > 0 ? Math.max(0, inPlace.NOI) / (N(m.minDebtYield) / 100) : 0;
  const lesserLoan = Math.min(ltvLoan, dscrLoan, dyLoan > 0 ? dyLoan : Infinity);
  const loan = m.loanMode === "amt" ? N(m.loanAmt) : m.loanMode === "ltv" ? ltvLoan : lesserLoan;
  const binding = m.loanMode !== "lesser" ? "your number" : lesserLoan === ltvLoan ? "LTV" : lesserLoan === dscrLoan ? "DSCR" : "debt yield";
  const ioYrs = Math.max(0, Math.round(N(m.ioYrs)));
  const dsIO = loan * N(m.ratePct) / 100;
  const dsAm = D(loan);
  const dsInYear = (y) => (y <= ioYrs || N(m.amortYrs) <= 0 ? dsIO : dsAm);
  const balanceEnd = (y) => {
    if (N(m.amortYrs) <= 0) return loan;
    const amMonths = Math.max(0, (y - ioYrs) * 12);
    return balanceAfter(loan, m.ratePct, m.amortYrs, amMonths);
  };

  // sources & uses
  const closing = price * N(m.closingCostPct) / 100;
  const mrt = loan * N(m.mrtPct) / 100;
  const loanFees = loan * N(m.loanFeePct) / 100;
  const capex = N(m.capex);
  const otherAcq = N(m.otherAcqCosts);
  const allIn = price + closing + otherAcq + capex + mrt + loanFees;
  const equity = allIn - loan;

  // annual cash flow, years 1..hold (+ the year after, for the exit NOI)
  const years = [];
  for (let y = 1; y <= hold + 1; y++) {
    const t = y - 1;
    const gprM = rows.reduce((s, r) => s + rentInYear(r, t), 0);
    const op = opYear(gprM, otherY1 * Math.pow(1 + g, t), t);
    const ds = dsInYear(y);
    years.push({ y, ...op, ds, cf: op.NOI - ds, dscr: ds > 0 ? op.NOI / ds : 0 });
  }
  const exitNOI = years[hold].NOI;                          // forward (year hold+1) NOI
  const exitCap = N(m.exitCapPct);
  const exitValue = exitCap > 0 ? exitNOI / (exitCap / 100) : 0;
  const sellCosts = exitValue * N(m.sellCostPct) / 100;
  const netSale = exitValue - sellCosts;
  const loanPayoff = balanceEnd(hold);
  const flows = years.slice(0, hold);

  const unlev = [-(price + closing + otherAcq + capex), ...flows.map((r, i) => r.NOI + (i === hold - 1 ? netSale : 0))];
  const lev = [-equity, ...flows.map((r, i) => r.cf + (i === hold - 1 ? netSale - loanPayoff : 0))];
  const unlevIRR = irr(unlev), levIRR = irr(lev);
  const totalDist = lev.slice(1).reduce((s, x) => s + x, 0);
  const equityMultiple = equity > 0 ? totalDist / equity : 0;
  const profit = totalDist - equity;

  const y1 = years[0];
  const capIn = price > 0 ? inPlace.NOI / price * 100 : 0;
  const capPF = price > 0 ? proForma.NOI / price * 100 : 0;
  const costBasis = price + closing + otherAcq + capex;
  const yocPF = costBasis > 0 ? proForma.NOI / costBasis * 100 : 0;
  const coc = equity > 0 ? y1.cf / equity * 100 : 0;
  const dscrY1 = y1.ds > 0 ? y1.NOI / y1.ds : 0;
  const dscrIn = dsInYear(1) > 0 ? inPlace.NOI / dsInYear(1) : 0;
  const debtYield = loan > 0 ? inPlace.NOI / loan * 100 : 0;
  const breakEven = y1.GPI > 0 ? (y1.opex - y1.mgmt + y1.ds) / (y1.GPI * (1 - N(m.mgmtPct) / 100)) * 100 : 0;
  const grm = inPlace.GPR > 0 ? price / inPlace.GPR : 0;
  const ltvActual = price > 0 ? loan / price * 100 : 0;
  const negLeverage = constant > 0 && capIn > 0 && capIn < constant * 100;

  const flags = [];
  if (loan > 0 && dscrIn < N(m.minDscr)) flags.push(`DSCR on in-place NOI is ${dscrIn.toFixed(2)}x, under your ${N(m.minDscr).toFixed(2)}x minimum`);
  if (negLeverage) flags.push(`Negative leverage: going-in cap ${capIn.toFixed(2)}% is below the loan constant ${(constant * 100).toFixed(2)}%`);
  if (breakEven > 85) flags.push(`Break-even occupancy ${breakEven.toFixed(0)}% leaves little room`);
  if (rsShare >= 50) flags.push(`${rsShare.toFixed(0)}% of units are rent stabilized: upside is limited to RGB increases`);
  if (m.loanMode === "amt" && loan > ltvLoan + 1) flags.push("Loan is above your LTV");
  if (exitCap > 0 && exitCap < capIn - 0.01) flags.push("Exit cap is below the going-in cap (assumes cap compression)");

  return {
    rows, nU, bedsN, price, bsf, byStatus, vacantN, rsShare, inPlaceM, proFormaM, inPlace, proForma, fixedExp, reserves,
    years, flows, hold, exitNOI, exitCap, exitValue, sellCosts, netSale, loanPayoff,
    loan, ltvLoan, dscrLoan, dyLoan, lesserLoan, binding, constant, dsIO, dsAm, ioYrs, ltvActual,
    closing, mrt, loanFees, capex, otherAcq, allIn, equity, costBasis,
    unlev, lev, unlevIRR, levIRR, equityMultiple, profit, totalDist,
    capIn, capPF, yocPF, coc, dscrY1, dscrIn, debtYield, breakEven, grm, negLeverage, flags,
    perUnit: nU ? price / nU : 0, perSF: bsf ? price / bsf : 0,
  };
}

/* ---------- sensitivity grids: levered IRR ---------- */
export function rentalSensitivity(m) {
  const capCols = [-0.5, -0.25, 0, 0.25, 0.5].map((d) => Math.max(0.25, N(m.exitCapPct) + d));
  const growRows = [-2, -1, 0, 1, 2].map((d) => N(m.rentGrowthPct) + d);
  const g1 = growRows.map((gr) => capCols.map((cp) => runRental({ ...m, rentGrowthPct: gr, exitCapPct: cp }).levIRR));
  const priceRows = [-10, -5, 0, 5, 10].map((d) => Math.round(N(m.purchasePrice) * (1 + d / 100)));
  const rateCols = [-1, -0.5, 0, 0.5, 1].map((d) => Math.max(0, N(m.ratePct) + d));
  const g2 = priceRows.map((p) => rateCols.map((r) => {
    const c = runRental({ ...m, purchasePrice: p, ratePct: r });
    return { irr: c.levIRR, coc: c.coc };
  }));
  return { capCols, growRows, g1, priceRows, rateCols, g2 };
}

/* paste from a spreadsheet: unit, beds, status (FM/RS/Voucher), current rent, market rent, lease end — tab or comma separated */
export function parseRentRoll(text) {
  const out = [];
  String(text || "").split(/\r?\n/).forEach((line) => {
    const c = (line.includes("\t") ? line.split("\t") : line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)).map((s) => s.replace(/^"|"$/g, "").trim());
    if (!c[0] || /^unit/i.test(c[0])) return;
    const st = String(c[2] || "").toLowerCase();
    const status = /rs|stab|reg/.test(st) ? "rs" : /v|hasa|sec|8|cityfheps|fheps/.test(st) ? "vou" : "fm";
    const money = (s) => N(String(s || "").replace(/[$,\s]/g, ""));
    const cur = money(c[3]);
    out.push(newUnit(c[0], { beds: N(String(c[1] || "").replace(/[^0-9.]/g, "")), status, current: cur, market: money(c[4]) || cur, leaseEnd: c[5] || "", vacant: cur <= 0 || /vac/i.test(line) }));
  });
  return out;
}
