/* ============================================================
   RENTAL UNDERWRITING — screen + report for buying an existing rental building.
   Math lives in rentalCalc.js. Saved in `models` as JSON with kind: "rental".
   ============================================================ */
import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { supabase } from "./supabaseClient";
import { RENTAL_DEFAULTS as RD, RENTAL_EXP_PER_UNIT, RENTAL_EXP_LABELS } from "./uwConstants";
import { blankRental, upgradeRental, runRental, rentalSensitivity, parseRentRoll, newUnit, typicalExpenses, UNIT_STATUS, STATUS_SHORT } from "./rentalCalc";
import { Sec, F, Row, MC, SR, LOGO_FULL, fmt, money, pct, kMoney, sMoney, psf, x2, RED, BOROUGHS } from "./App";

const N = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
const ir = (v) => (isFinite(v) ? v.toFixed(1) + "%" : "—");
export const isRentalModel = (d) => d && d.kind === "rental";

export default function RentalUW({ initialModel, onExit, notify, userId, userName }) {
  const [m, setM] = useState(() => upgradeRental(initialModel));
  const [saved, setSaved] = useState([]);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState("");
  const c = useMemo(() => runRental(m), [m]);
  const sens = useMemo(() => rentalSensitivity(m), [m]);

  const set = (k, v) => setM((p) => ({ ...p, [k]: v }));
  const num = (k, step = "any") => (
    <input type="number" inputMode="decimal" step={step} value={m[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
  );
  const setU = (i, f, v) => setM((p) => ({ ...p, sampleRoll: false, units: p.units.map((u, j) => (j === i ? { ...u, [f]: v } : u)) }));
  const setExp = (k, v) => setM((p) => ({ ...p, exp: { ...p.exp, [k]: v } }));

  useEffect(() => { loadList(); }, []);
  const loadList = async () => {
    const { data } = await supabase.from("models").select("id, data, owner_id, is_public").order("updated_at", { ascending: false });
    setSaved((data || []).filter((r) => isRentalModel(r.data)).map((r) => ({ ...r.data, isPublic: !!r.is_public, _owner: r.owner_id })));
  };
  const save = async () => {
    setBusy(true);
    const rec = { ...m, kind: "rental", ownerName: m.ownerName || userName, updated: new Date().toISOString().slice(0, 10) };
    delete rec._owner;
    setM(rec);
    const { error } = await supabase.from("models").upsert({ id: rec.id, data: rec, owner_id: userId, is_public: !!rec.isPublic, updated_at: new Date().toISOString() });
    setBusy(false);
    if (error) notify?.(error.message || "Save failed.");
    else { notify?.("Rental model saved."); loadList(); }
  };
  const del = async (id) => {
    await supabase.from("models").delete().eq("id", id);
    loadList();
    if (m.id === id) setM(blankRental());
  };
  const addUnit = () => setM((p) => {
    const last = p.units[p.units.length - 1];
    return { ...p, sampleRoll: false, units: [...p.units, newUnit("", last ? { beds: last.beds, status: last.status, market: last.market } : {})] };
  });
  const importRoll = () => {
    const rows = parseRentRoll(paste);
    if (!rows.length) { notify?.("Nothing to import — paste rows: unit, beds, FM/RS/Voucher, current rent, market rent, lease end"); return; }
    setM((p) => ({ ...p, units: rows, sampleRoll: false }));
    setPaste("");
    notify?.(`Imported ${rows.length} units.`);
  };
  const fillTypical = () => { setM((p) => ({ ...p, exp: typicalExpenses(p) })); notify?.("Typical NYC walk-up $/unit filled — replace with the T-12 / tax bill"); };

  const egi = c.proForma.EGI;
  const capexPU = c.nU ? N(m.capex) / c.nU : 0;
  const S = c.byStatus;

  return (
    <div className="uw">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <div className="eyebrow">Underwriting</div>
          <h1 style={{ margin: "2px 0 8px", fontSize: 26, fontWeight: 800, letterSpacing: "-0.01em" }}>Rental Acquisition Model</h1>
          <div className="dealline"><span>Deal</span><input value={m.dealName} onChange={(e) => set("dealName", e.target.value)} /></div>
          <div className="dealline"><span>Market</span><input value={m.marketArea} onChange={(e) => set("marketArea", e.target.value)} placeholder="Fordham, Bronx" /></div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {onExit && <button className="ghost" onClick={onExit}>← Back to deal</button>}
          <button className="ghost" onClick={() => setM(blankRental())}>New</button>
          <button className="ghost" data-on={!!m.isPublic} onClick={() => set("isPublic", !m.isPublic)}>{m.isPublic ? "Published ✓" : "Private"}</button>
          <button className="ghost" onClick={() => setSheet(true)}>Report / PDF</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save model"}</button>
        </div>
      </header>

      {saved.length > 0 && (
        <div className="savedStrip">
          {saved.map((s) => (
            <span key={s.id} className="savedChip">
              <span onClick={() => setM(upgradeRental(s))}>{s.dealName}{s._owner && s._owner !== userId ? ` · ${s.ownerName || "shared"}` : ""}</span>
              {(!s._owner || s._owner === userId) && <b onClick={() => del(s.id)}>✕</b>}
            </span>
          ))}
        </div>
      )}

      <div className="segRow">
        <div>
          <div className="segLabel">Loan sizing</div>
          <div className="seg">
            {[["lesser", "Lesser of LTV / DSCR"], ["ltv", "LTV only"], ["amt", "My amount"]].map(([k, l]) => (
              <button key={k} data-on={m.loanMode === k} onClick={() => set("loanMode", k)}>{l}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="segLabel">Hold</div>
          <div className="seg">
            {[3, 5, 7, 10].map((y) => <button key={y} data-on={N(m.holdYrs) === y} onClick={() => set("holdYrs", y)}>{y} yr</button>)}
          </div>
        </div>
      </div>

      <div className="uwGrid">
        <div>
          <Sec n="01" t="Property & Purchase" open>
            <div className="fg2">
              <F label="Purchase price" hint="$">{num("purchasePrice")}</F>
              <F label="Building size" hint="gross SF">{num("buildingSF")}</F>
              <F label="Borough">
                <select value={m.borough || ""} onChange={(e) => set("borough", e.target.value)}>
                  <option value="">—</option>
                  {BOROUGHS.map((b) => <option key={b}>{b}</option>)}
                </select>
              </F>
              <F label="Year built" hint="optional"><input value={m.yearBuilt || ""} onChange={(e) => set("yearBuilt", e.target.value)} placeholder="1928" /></F>
              <F label="Closing costs" hint={`% of price · default ${RD.closingCostPct}%`}>{num("closingCostPct", "0.1")}</F>
              <F label="Other acquisition costs" hint="$ (reports, legal)">{num("otherAcqCosts")}</F>
            </div>
            <div className="derived">
              {c.nU} units · {money(c.perUnit)}/unit{c.bsf ? ` · ${psf(c.perSF)}/SF` : ""} · GRM {c.grm ? c.grm.toFixed(1) + "x" : "—"} (price ÷ in-place rent roll)
            </div>
          </Sec>

          <Sec n="02" t={`Rent Roll — ${c.nU} units`} open>
            {m.sampleRoll && <div className="warn" style={{ marginTop: 6 }}>Sample rent roll — replace it, add units, or paste yours below.</div>}
            <div className="tableWrap" style={{ marginTop: 10 }}>
              <table className="rr rroll">
                <thead><tr><th>Unit</th><th>Beds</th><th>Type</th><th>Current / mo</th><th>{"Market / legal"}</th><th>Lease end</th><th>Vac</th><th></th></tr></thead>
                <tbody>
                  {m.units.map((u, i) => (
                    <tr key={u.id}>
                      <td><input value={u.unit} onChange={(e) => setU(i, "unit", e.target.value)} style={{ width: 52 }} /></td>
                      <td><input type="number" inputMode="decimal" value={u.beds} onChange={(e) => setU(i, "beds", e.target.value)} style={{ width: 44, minWidth: 44 }} /></td>
                      <td>
                        <select className="amiSel" value={u.status} onChange={(e) => setU(i, "status", e.target.value)}>
                          {UNIT_STATUS.map(([k]) => <option key={k} value={k}>{STATUS_SHORT[k]}</option>)}
                        </select>
                      </td>
                      <td><input type="number" inputMode="decimal" value={u.vacant ? "" : u.current} placeholder={u.vacant ? "vacant" : ""} disabled={u.vacant} onChange={(e) => setU(i, "current", e.target.value)} /></td>
                      <td><input type="number" inputMode="decimal" value={u.market} onChange={(e) => setU(i, "market", e.target.value)} /></td>
                      <td><input value={u.leaseEnd || ""} onChange={(e) => setU(i, "leaseEnd", e.target.value)} placeholder="mm/yy" style={{ width: 62 }} /></td>
                      <td><input type="checkbox" checked={!!u.vacant} onChange={(e) => setU(i, "vacant", e.target.checked)} style={{ minWidth: 0 }} /></td>
                      <td><button className="mini" onClick={() => setM((p) => ({ ...p, units: p.units.filter((_, j) => j !== i) }))}>✕</button></td>
                    </tr>
                  ))}
                  <tr className="tot"><td>Total</td><td>{fmt(c.bedsN)}</td><td></td><td>{money(c.inPlaceM)}</td><td>{money(c.proFormaM)}</td><td colSpan={3}></td></tr>
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button className="mini tall" onClick={addUnit}>+ Unit</button>
              {m.units.length > 0 && <button className="mini tall" onClick={() => setM((p) => ({ ...p, units: [], sampleRoll: false }))}>Clear roll</button>}
            </div>
            <details className="hpdRef">
              <summary>Paste rent roll from Excel</summary>
              <div className="subnote">One unit per row: unit, beds, FM / RS / Voucher, current rent, market rent, lease end. Blank or 0 current rent = vacant.</div>
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} style={{ width: "100%", marginTop: 8, fontSize: 12 }} placeholder={"1A\t2\tRS\t1450\t1450\t08/27\n2B\t1\tFM\t2100\t2300\t03/27"} />
              <button className="mini tall" style={{ marginTop: 6 }} onClick={importRoll}>Replace roll with pasted rows</button>
            </details>
            <div className="chk">
              {UNIT_STATUS.map(([k, l]) => (
                <div key={k}><span>{l}</span><b>{S[k].n} unit{S[k].n === 1 ? "" : "s"}</b><em>{money(S[k].cur)}/mo now → {money(S[k].pf)}</em></div>
              ))}
              <div><span>In-place rent</span><b>{money(c.inPlaceM)}/mo</b><em>{c.nU ? money(c.inPlaceM / c.nU) + " avg" : "—"} · {c.vacantN} vacant</em></div>
              <div><span>Pro forma rent</span><b>{money(c.proFormaM)}/mo</b><em>{c.nU ? money(c.proFormaM / c.nU) + " avg" : "—"}</em></div>
              <div className={c.proFormaM >= c.inPlaceM ? "ok" : "no"}><span>Upside</span><b>{sMoney(c.proFormaM - c.inPlaceM)}/mo</b><em>{c.inPlaceM ? pct((c.proFormaM / c.inPlaceM - 1) * 100) : "—"} over in-place</em></div>
            </div>
            <div className="subnote">Pro forma: free-market units at market, vacant units leased at market / legal rent, voucher units at the contract rent you enter, rent-stabilized units stay at today's legal rent (no mark-to-market).</div>
          </Sec>

          <Sec n="03" t="Income, Vacancy & Growth" open>
            <div className="fg2">
              <F label="Other income" hint="$ / yr · laundry, parking">{num("otherIncomeYr")}</F>
              <F label="Vacancy" hint={`% · default ${RD.vacancyPct}%`}>{num("vacancyPct", "0.5")}</F>
              <F label="Credit loss" hint={`% · default ${RD.creditLossPct}%`}>{num("creditLossPct", "0.5")}</F>
              <F label="Free-market rent growth" hint={`% / yr · default ${RD.rentGrowthPct}%`}>{num("rentGrowthPct", "0.25")}</F>
              <F label="Rent-stabilized increase (RGB)" hint={`% / yr · your assumption, default ${RD.rgbPct}%`}>{num("rgbPct", "0.25")}</F>
              <F label="Voucher rent growth" hint={`% / yr · default ${RD.voucherGrowthPct}%`}>{num("voucherGrowthPct", "0.25")}</F>
              <F label="Free-market gap captured in yr 1" hint={`% · default ${RD.mtmY1Pct}%, all by yr 2`}>{num("mtmY1Pct", "5")}</F>
            </div>
            <div className="derived">
              Year 1: rent {money(c.years[0].GPR)} + other {money(c.years[0].other)} − vacancy & credit {money(c.years[0].vac)} = <b>EGI {money(c.years[0].EGI)}</b>
            </div>
          </Sec>

          <Sec n="04" t="Operating Expenses" open>
            <div className="tableWrap" style={{ marginTop: 10 }}>
              <table className="rr">
                <thead><tr><th>Expense</th><th>$ / yr</th><th>$ / unit</th><th>% EGI</th></tr></thead>
                <tbody>
                  {RENTAL_EXP_LABELS.map(([k, l]) => (
                    <tr key={k}>
                      <td>{l}</td>
                      <td><input type="number" inputMode="decimal" value={m.exp?.[k] ?? 0} onChange={(e) => setExp(k, e.target.value)} /></td>
                      <td className="mono">{c.nU ? money(N(m.exp?.[k]) / c.nU) : "—"}</td>
                      <td className="mono">{egi ? pct(N(m.exp?.[k]) / egi * 100) : "—"}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>Management</td>
                    <td><input type="number" inputMode="decimal" step="0.5" value={m.mgmtPct} onChange={(e) => set("mgmtPct", e.target.value)} title="% of EGI" /></td>
                    <td className="mono">{c.nU ? money(c.proForma.mgmt / c.nU) : "—"}</td>
                    <td className="mono">% of EGI</td>
                  </tr>
                  <tr>
                    <td>Reserves</td>
                    <td><input type="number" inputMode="decimal" value={m.reservesPerUnit} onChange={(e) => set("reservesPerUnit", e.target.value)} title="$ per unit per year" /></td>
                    <td className="mono">$ / unit</td>
                    <td className="mono">{egi ? pct(c.reserves / egi * 100) : "—"}</td>
                  </tr>
                  <tr className="tot"><td>Total (pro forma)</td><td>{money(c.proForma.opex)}</td><td>{c.nU ? money(c.proForma.opex / c.nU) : "—"}</td><td>{egi ? pct(c.proForma.opex / egi * 100) : "—"}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="fg2">
              <F label="Expense growth" hint={`% / yr · default ${RD.expGrowthPct}%`}>{num("expGrowthPct", "0.25")}</F>
              <F label="RE tax growth" hint={`% / yr · default ${RD.taxGrowthPct}%`}>{num("taxGrowthPct", "0.25")}</F>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button className="mini tall" onClick={fillTypical}>Fill typical NYC $/unit</button>
            </div>
            <div className="subnote">Typical $/unit/yr (verify against the T-12): {RENTAL_EXP_LABELS.filter(([k]) => RENTAL_EXP_PER_UNIT[k]).map(([k, l]) => `${l.split(" ")[0]} $${fmt(RENTAL_EXP_PER_UNIT[k])}`).join(" · ")}. Taxes start at {RD.taxPctOfPrice}% of price — use the DOF bill. Management {RD.mgmtPct}% and reserves ${RD.reservesPerUnit}/unit are defaults.</div>
          </Sec>

          <Sec n="05" t="Capex / Renovation" open>
            <div className="fg2">
              <F label="Renovation budget" hint="$ · paid at closing (equity)">{num("capex")}</F>
              <F label="What it covers" hint="optional"><input value={m.capexNote || ""} onChange={(e) => set("capexNote", e.target.value)} placeholder="Turn 3 vacant units, boiler" /></F>
            </div>
            <div className="derived">{money(N(m.capex))} · {money(capexPU)}/unit · total basis {money(c.costBasis)} ({c.nU ? money(c.costBasis / c.nU) : "—"}/unit)</div>
          </Sec>

          <Sec n="06" t="Debt" open>
            <div className="fg2">
              <F label="LTV" hint={`% of price · default ${RD.ltvPct}%`}>{num("ltvPct", "1")}</F>
              <F label="Or loan amount" hint="$ · used with 'My amount'">{num("loanAmt")}</F>
              <F label="Rate" hint={`% · default ${RD.ratePct}%`}>{num("ratePct", "0.125")}</F>
              <F label="Amortization" hint="years · 0 = interest-only">{num("amortYrs")}</F>
              <F label="Interest-only period" hint="years">{num("ioYrs")}</F>
              <F label="Loan fees" hint="% of loan">{num("loanFeePct", "0.25")}</F>
              <F label="Mortgage recording tax" hint={`% of loan · NYC default ${RD.mrtPct}%, verify / CEMA`}>{num("mrtPct", "0.05")}</F>
              <F label="Min DSCR (lender)" hint={`x · default ${RD.minDscr}`}>{num("minDscr", "0.05")}</F>
              <F label="Min debt yield" hint={`% · default ${RD.minDebtYield}% · 0 = ignore`}>{num("minDebtYield", "0.5")}</F>
            </div>
            <div className="tableWrap" style={{ marginTop: 14 }}>
              <table className="rr num">
                <thead><tr><th>Max loan by</th><th>Amount</th><th>LTV</th></tr></thead>
                <tbody>
                  <tr><td>LTV {N(m.ltvPct)}%</td><td>{money(c.ltvLoan)}</td><td>{pct(N(m.ltvPct))}</td></tr>
                  <tr><td>DSCR {N(m.minDscr).toFixed(2)}x (in-place NOI)</td><td>{money(c.dscrLoan)}</td><td>{c.price ? pct(c.dscrLoan / c.price * 100) : "—"}</td></tr>
                  {N(m.minDebtYield) > 0 && <tr><td>Debt yield {N(m.minDebtYield)}%</td><td>{money(c.dyLoan)}</td><td>{c.price ? pct(c.dyLoan / c.price * 100) : "—"}</td></tr>}
                  <tr className="tot"><td>Loan used</td><td>{money(c.loan)}</td><td>{pct(c.ltvActual)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="derived">
              Loan {money(c.loan)} ({c.binding === "your number" ? "your number" : `sized by ${c.binding}`}) · debt service {money(c.years[0].ds)}/yr{c.ioYrs > 0 ? ` (IO for ${c.ioYrs} yr, then ${money(c.dsAm)})` : ""} · loan constant {pct(c.constant * 100)}
              <br />Cash to close {money(c.equity)} = price + closing {money(c.closing)} + capex {money(c.capex)} + MRT {money(c.mrt)} + fees {money(c.loanFees)}{c.otherAcq ? ` + other ${money(c.otherAcq)}` : ""} − loan
            </div>
          </Sec>

          <Sec n="07" t="Hold & Exit" open>
            <div className="fg2">
              <F label="Hold period" hint="years (1–10)">{num("holdYrs", "1")}</F>
              <F label="Exit cap rate" hint={`% · default ${RD.exitCapPct}%`}>{num("exitCapPct", "0.05")}</F>
              <F label="Selling costs" hint={`% · default ${RD.sellCostPct}% (broker + transfer taxes)`}>{num("sellCostPct", "0.25")}</F>
            </div>
            <div className="derived">
              Year {c.hold + 1} NOI {money(c.exitNOI)} ÷ {N(m.exitCapPct).toFixed(2)}% = {money(c.exitValue)} − selling {money(c.sellCosts)} − loan payoff {money(c.loanPayoff)} = <b>{sMoney(c.netSale - c.loanPayoff)} to equity</b>
            </div>
          </Sec>

          <Sec n="08" t="Annual Cash Flow" open>
            <CashFlowTable c={c} />
          </Sec>

          <Sec n="09" t="Sensitivity" open>
            <RentSens s={sens} />
          </Sec>

          <Sec n="10" t="NYC Notes — rent stabilization & vouchers">
            <ul className="subnote" style={{ paddingLeft: 18, opacity: 0.75 }}>
              <li>Rent-stabilized units grow only by the Rent Guidelines Board increase you enter (it sets 1- and 2-year lease rates each year). The model does not mark RS units to market.</li>
              <li>Since the 2019 rent law (HSTPA), RS units no longer leave stabilization on vacancy or high rent, and vacancy bonuses are gone. Renovation (IAI / MCI) increases are capped. Verify the current rules before you count any RS renovation upside.</li>
              <li>Check DHCR registrations / the rent history for legal rents and any overcharge exposure. Some units may be preferential rents.</li>
              <li>Voucher / HASA units: enter the contract rent (Section 8 / CityFHEPS / HASA payment standard). Payment standards change each year.</li>
              <li>Taxes: start from the DOF bill and check for J-51 / 421-a benefits that may be expiring.</li>
            </ul>
          </Sec>
        </div>

        <div className="uwSum">
          <div className="sumHead"><span>Summary</span><span>RENTAL · {c.nU} UNITS · {c.hold} YR</span></div>
          <div style={{ padding: "6px 18px 18px" }}>
            <div className="divLabel">Purchase <i>total · per unit</i></div>
            <Row l="Price" v={money(c.price)} s={kMoney(c.perUnit) + "/u"} />
            <Row l="Closing, capex, loan costs" v={money(c.allIn - c.price)} />
            <Row l="All-in" v={money(c.allIn)} s={c.nU ? kMoney(c.allIn / c.nU) + "/u" : ""} total />
            <div className="divLabel">NOI <i>in-place → pro forma</i></div>
            <Row l="In-place NOI" v={money(c.inPlace.NOI)} s={pct(c.capIn) + " cap"} />
            <Row l="Pro forma NOI" v={money(c.proForma.NOI)} s={pct(c.capPF) + " cap"} />
            <Row l="Yield on cost (pro forma)" v={pct(c.yocPF)} />
            <div className="divLabel">Financing</div>
            <Row l={`Loan · ${c.binding === "your number" ? "your number" : "by " + c.binding}`} v={money(c.loan)} s={pct(c.ltvActual) + " LTV"} />
            <Row l="Cash to close" v={money(c.equity)} total />
            <div className={"profit" + (!(c.levIRR > 0) ? " neg" : "")}>
              <div className="pl">Levered IRR · {c.hold} yr</div>
              <div className="pv">{ir(c.levIRR)}</div>
            </div>
            <div className="mcards">
              <MC l="Unlevered IRR" v={ir(c.unlevIRR)} />
              <MC l="Equity multiple" v={c.equityMultiple ? c.equityMultiple.toFixed(2) + "x" : "—"} good={c.equityMultiple >= 1.5} />
              <MC l="Cash-on-cash yr 1" v={pct(c.coc)} good={c.coc >= 0 ? undefined : false} />
              <MC l="DSCR yr 1" v={x2(c.dscrY1)} good={c.dscrY1 >= N(m.minDscr)} />
              <MC l="Debt yield" v={pct(c.debtYield)} />
              <MC l="Break-even occ." v={pct(c.breakEven)} good={c.breakEven <= 85} />
              <MC l="Profit" v={kMoney(c.profit)} good={c.profit >= 0} />
              <MC l="Rent stabilized" v={`${S.rs.n} of ${c.nU}`} />
            </div>
            {c.flags.length > 0 && (
              <div className="rentFlags">
                {c.flags.map((f, i) => <div key={i}>⚠ {f}</div>)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="foot">Editable defaults, not advice — verify rents (DHCR), the T-12, the tax bill, voucher payment standards and loan terms before circulating.</div>
      {sheet && <RentalSheet m={m} c={c} sens={sens} onClose={() => setSheet(false)} />}
    </div>
  );
}

function CashFlowTable({ c, sheet }) {
  const rows = c.flows;
  return (
    <div className={sheet ? "shWrap" : "tableWrap"} style={{ marginTop: sheet ? 0 : 10 }}>
      <table className={sheet ? "shTable inc" : "rr num"}>
        <thead><tr><th>Year</th><th>Rent + other</th><th>Vac & credit</th><th>Expenses</th><th>NOI</th><th>Debt service</th><th>Cash flow</th><th>DSCR</th></tr></thead>
        <tbody>
          <tr><td>In-place</td><td>{kMoney(c.inPlace.GPI)}</td><td>{kMoney(-c.inPlace.vac)}</td><td>{kMoney(-c.inPlace.opex)}</td><td>{kMoney(c.inPlace.NOI)}</td><td></td><td></td><td></td></tr>
          {rows.map((r) => (
            <tr key={r.y}><td>{r.y}</td><td>{kMoney(r.GPI)}</td><td>{kMoney(-r.vac)}</td><td>{kMoney(-r.opex)}</td><td>{kMoney(r.NOI)}</td><td>{kMoney(-r.ds)}</td><td>{kMoney(r.cf)}</td><td>{x2(r.dscr)}</td></tr>
          ))}
          <tr className="tot"><td>Sale yr {c.hold}</td><td colSpan={3}>{kMoney(c.exitValue)} − selling {kMoney(c.sellCosts)}</td><td>{kMoney(c.netSale)}</td><td>{kMoney(-c.loanPayoff)}</td><td>{kMoney(c.netSale - c.loanPayoff)}</td><td></td></tr>
        </tbody>
      </table>
    </div>
  );
}

function RentSens({ s, sheet }) {
  const base = (i, j) => i === 2 && j === 2;
  const cls = (v, i, j) => (v < 0 || !isFinite(v) ? "neg" : "pos") + (base(i, j) ? " base" : "");
  const T = sheet ? "shTable sens" : "rr sens";
  return (
    <>
      <div className={sheet ? "shNote" : "subnote"} style={{ marginTop: sheet ? 0 : 10 }}>Levered IRR by free-market rent growth (rows) × exit cap (columns).</div>
      <div className={sheet ? "shWrap" : "tableWrap"} style={{ marginTop: 8 }}>
        <table className={T}>
          <thead><tr><th>Growth \ Cap</th>{s.capCols.map((v, j) => <th key={j}>{v.toFixed(2)}%</th>)}</tr></thead>
          <tbody>{s.growRows.map((gr, i) => (
            <tr key={i}><td>{gr.toFixed(2)}%</td>{s.g1[i].map((v, j) => <td key={j} className={cls(v, i, j)}>{ir(v)}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
      <div className={sheet ? "shNote" : "subnote"} style={{ marginTop: 14 }}>Levered IRR (cash-on-cash yr 1 under it) by purchase price (rows) × interest rate (columns).</div>
      <div className={sheet ? "shWrap" : "tableWrap"} style={{ marginTop: 8 }}>
        <table className={T}>
          <thead><tr><th>Price \ Rate</th>{s.rateCols.map((v, j) => <th key={j}>{v.toFixed(2)}%</th>)}</tr></thead>
          <tbody>{s.priceRows.map((p, i) => (
            <tr key={i}><td>{kMoney(p)}</td>{s.g2[i].map((g, j) => <td key={j} className={cls(g.irr, i, j)}>{ir(g.irr)}<small>{pct(g.coc)}</small></td>)}</tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

function RentalSheet({ m, c, sens, onClose }) {
  useEffect(() => { document.body.classList.add("uwPrint"); return () => document.body.classList.remove("uwPrint"); }, []);
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
  const S = c.byStatus;
  const IR = ({ l, v, neg, b }) => <tr className={b ? "tot" : ""}><td>{l}</td><td>{sMoney(neg ? -v.inPlace : v.inPlace)}</td><td>{sMoney(neg ? -v.pf : v.pf)}</td></tr>;
  const L = (k) => ({ inPlace: c.inPlace[k], pf: c.proForma[k] });
  return createPortal(<div className="uwPortal">
    <div className="modalWrap" onClick={onClose}>
      <div style={{ width: 860, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="sheet" id="uw-sheet">
          <div className="shTop">
            <div>
              <img className="shLogo" src={LOGO_FULL} alt="J Stone Realty Group" />
              <div className="shBrand">Rental Acquisition Underwriting</div>
              <div className="shTitle">{m.dealName}</div>
              <div className="shSub">{[m.marketArea, `${c.nU} units`, c.bsf ? fmt(c.bsf) + " SF" : "", m.yearBuilt ? "built " + m.yearBuilt : "", `${c.hold}-year hold`].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="shDate">{new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</div>
          </div>
          <div className="shKpis">
            <div><span>Price</span><b>{kMoney(c.price)}</b><em>{kMoney(c.perUnit)}/unit{c.bsf ? ` · ${psf(c.perSF)}/SF` : ""}</em></div>
            <div><span>Going-in cap</span><b>{pct(c.capIn)}</b><em>pro forma {pct(c.capPF)}</em></div>
            <div><span>Levered IRR</span><b className={!(c.levIRR > 0) ? "neg" : ""}>{ir(c.levIRR)}</b><em>{c.equityMultiple.toFixed(2)}x multiple</em></div>
            <div><span>Cash to close</span><b>{kMoney(c.equity)}</b><em>loan {kMoney(c.loan)} · {pct(c.ltvActual)} LTV</em></div>
          </div>

          <div className="shSec">
            <div className="shH">Rent Roll Summary</div>
            <div className="shWrap">
              <table className="shTable">
                <thead><tr><th>Type</th><th>Units</th><th>In-place / mo</th><th>Pro forma / mo</th><th>Avg pro forma</th></tr></thead>
                <tbody>
                  {UNIT_STATUS.map(([k, l]) => S[k].n > 0 && (
                    <tr key={k}><td>{l}</td><td>{S[k].n}</td><td>{money(S[k].cur)}</td><td>{money(S[k].pf)}</td><td>{money(S[k].pf / S[k].n)}</td></tr>
                  ))}
                  <tr className="tot"><td>Total</td><td>{c.nU}{c.vacantN ? ` (${c.vacantN} vacant)` : ""}</td><td>{money(c.inPlaceM)}</td><td>{money(c.proFormaM)}</td><td>{c.nU ? money(c.proFormaM / c.nU) : "—"}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="shSrc">Pro forma: free-market and vacant units at market, voucher units at contract rent, rent-stabilized units at legal rent (+{N(m.rgbPct)}%/yr RGB assumption from year 2).</div>
          </div>

          <div className="shSec">
            <div className="shH">Income & Expenses</div>
            <div className="shWrap">
              <table className="shTable inc">
                <thead><tr><th></th><th>In-place</th><th>Pro forma</th></tr></thead>
                <tbody>
                  <IR l="Rental income" v={L("GPR")} />
                  {c.inPlace.other > 0 && <IR l="Other income" v={L("other")} />}
                  <IR l={`Vacancy & credit loss (${N(m.vacancyPct) + N(m.creditLossPct)}%)`} v={L("vac")} neg />
                  <IR l="Effective gross income" v={L("EGI")} b />
                  {RENTAL_EXP_LABELS.filter(([k]) => N(m.exp?.[k]) > 0).map(([k, l]) => (
                    <tr key={k}><td>{l}</td><td>{sMoney(-N(m.exp[k]))}</td><td>{sMoney(-N(m.exp[k]))}</td></tr>
                  ))}
                  <IR l={`Management (${N(m.mgmtPct)}% of EGI)`} v={L("mgmt")} neg />
                  <IR l={`Reserves ($${fmt(N(m.reservesPerUnit))}/unit)`} v={L("reserves")} neg />
                  <IR l="Total expenses" v={L("opex")} neg b />
                  <IR l="NET OPERATING INCOME" v={L("NOI")} b />
                </tbody>
              </table>
            </div>
            <div className="shSrc">Expenses {c.nU ? money(c.proForma.opex / c.nU) : "—"}/unit/yr · {c.proForma.EGI ? pct(c.proForma.opex / c.proForma.EGI * 100) : "—"} of pro forma EGI.</div>
          </div>

          <div className="shSec">
            <div className="shH">Purchase, Debt & Returns</div>
            <div className="shGrid">
              <SR l="Purchase price" v={money(c.price)} />
              <SR l="Price / unit · / SF · GRM" v={`${money(c.perUnit)} · ${c.bsf ? psf(c.perSF) : "—"} · ${c.grm ? c.grm.toFixed(1) + "x" : "—"}`} />
              <SR l={`Closing (${N(m.closingCostPct)}%) + other`} v={money(c.closing + c.otherAcq)} />
              <SR l="Capex / renovation" v={money(c.capex)} />
              <SR l={`Loan (${c.binding === "your number" ? "your number" : "sized by " + c.binding})`} v={`${money(c.loan)} · ${pct(c.ltvActual)} LTV`} />
              <SR l="Rate · amortization · IO" v={`${N(m.ratePct)}% · ${N(m.amortYrs) || "IO"}${N(m.amortYrs) ? " yr" : ""} · ${c.ioYrs} yr IO`} />
              <SR l="MRT + loan fees" v={money(c.mrt + c.loanFees)} />
              <SR l="CASH TO CLOSE" v={money(c.equity)} />
              <SR l="Going-in cap (in-place) · pro forma" v={`${pct(c.capIn)} · ${pct(c.capPF)}`} />
              <SR l="Yield on cost (pro forma)" v={pct(c.yocPF)} />
              <SR l="DSCR in-place · year 1" v={`${x2(c.dscrIn)} · ${x2(c.dscrY1)}`} />
              <SR l="Debt yield · break-even occupancy" v={`${pct(c.debtYield)} · ${pct(c.breakEven)}`} />
              <SR l="Cash-on-cash year 1" v={pct(c.coc)} />
              <SR l={`Exit: yr ${c.hold + 1} NOI @ ${N(m.exitCapPct).toFixed(2)}% cap`} v={money(c.exitValue)} />
              <SR l="Unlevered IRR · levered IRR" v={`${ir(c.unlevIRR)} · ${ir(c.levIRR)}`} />
              <SR l="Equity multiple · profit" v={`${c.equityMultiple.toFixed(2)}x · ${sMoney(c.profit)}`} />
            </div>
            {c.flags.length > 0 && <div className="shNote" style={{ marginTop: 10, color: RED }}>{c.flags.join(" · ")}</div>}
          </div>

          <div className="shSec">
            <div className="shH">Annual Cash Flow</div>
            <CashFlowTable c={c} sheet />
          </div>

          <div className="shSec">
            <div className="shH">Sensitivity</div>
            <RentSens s={sens} sheet />
          </div>

          <div className="shFoot">
            Prepared by J Stone Realty Group. Preliminary underwriting based on the assumptions above (vacancy {N(m.vacancyPct)}% + credit loss {N(m.creditLossPct)}%,
            free-market growth {N(m.rentGrowthPct)}%/yr, RS increase {N(m.rgbPct)}%/yr (assumption; set yearly by the Rent Guidelines Board), expenses +{N(m.expGrowthPct)}%/yr, taxes +{N(m.taxGrowthPct)}%/yr,
            selling costs {N(m.sellCostPct)}%). Subject to due diligence: rent roll and leases, DHCR registrations, T-12, tax bill, and lender terms.
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
