import test from "node:test";
import assert from "node:assert/strict";
import {
  addressBorough, clearCall, hasCall, lotDimensions, moveProspect, neighborBorough, ownerPhone, parcelMetrics, prospectBorough,
  prospectKey, prospectPhone, prospectStage, recordCall, researchTag, withBorough,
} from "../src/opportunityBoard.js";

const A = "2026-01-12T15:30:00Z";
const B = "2026-01-15T19:30:00Z";

test("borough is explicit, valid 10-digit BBL, then reliable address; key never changes", () => {
  const p = { date: "2026-01-01", base: { bbl: 3000000001, address: "80 Fixture Way, Bronx" } };
  assert.equal(prospectBorough(p), "Brooklyn");
  assert.equal(prospectBorough({ ...p, borough: "Manhattan" }), "Manhattan");
  assert.equal(prospectBorough({ base: { bbl: "300000", address: p.base.address } }), "Bronx");
  assert.equal(addressBorough("80 Fixture Way, New York, NY 10011"), "Manhattan");
  assert.equal(addressBorough("80 Fixture Way, NY 11211"), "Brooklyn");
  assert.equal(addressBorough("80 Manhattan Avenue"), "");
  assert.equal(addressBorough("80 Fixture Way, NY"), "");
  assert.equal(neighborBorough({ bbl: 2000000001 }, p), "Bronx");
  assert.equal(neighborBorough({ address: "82 Fixture Way" }, p), "Brooklyn");
  assert.equal(withBorough(p.base.address, "Brooklyn"), "80 Fixture Way, Brooklyn");
  assert.equal(prospectKey({ ...p, borough: "Manhattan" }), "2026-01-01|3000000001");
  assert.equal(prospectKey({ date: "2026-01-01", rank: 17 }), "2026-01-01|17");
});

test("lot dimensions use this lot’s reported feet and compact decimal precision", () => {
  assert.equal(lotDimensions({ front_ft: 50, depth_ft: 100 }).label, "50 × 100 ft");
  assert.equal(lotDimensions({ front_ft: " 50.10 ", depth_ft: "100.125" }).label, "50.1 × 100.13 ft");
  assert.equal(lotDimensions({ front_ft: "1234.567", depth_ft: 987.65 }).label, "1,234.57 × 987.65 ft");
  assert.equal(lotDimensions({ front_ft: 0.004 }).label, "<0.01 ft front");
});

test("missing depth leaves just frontage; never infer depth or use combined data", () => {
  const base = { front_ft: 50, lot_sf: 5000, combined_depth_ft: 100 };
  assert.deepEqual(lotDimensions(base), { front: "50", depth: "", label: "50 ft front" });
  assert.equal(lotDimensions({ depth_ft: 100, lot_sf: 5000 }).label, "");
  assert.equal(lotDimensions().label, "");
});

test("malformed and nonpositive dimensions are ignored", () => {
  for (const invalid of [null, "", " ", 0, "0", -25, "-25", NaN, Infinity, "Infinity", "50 ft", "0x32", [50], true, {}]) {
    assert.equal(lotDimensions({ front_ft: invalid, depth_ft: 100 }).label, "");
    assert.equal(lotDimensions({ front_ft: 50, depth_ft: invalid }).label, "50 ft front");
  }
});

test("standalone totals prefer known AOR; blanks and explicit unknown don't borrow combined or UAP", () => {
  assert.deepEqual(parcelMetrics({ lot_sf: 3500, buildable_sf_aor: 14000, max_far: 2, buildable_sf_uap: null, unused_sf: 8400 }),
    { lot: 3500, far: 2, aor: 14000, uap: null, legacy: false });
  assert.equal(parcelMetrics({ lot_sf: "4700", max_far: "3.44" }).aor, 16168);
  assert.equal(parcelMetrics({ lot_sf: 4700, max_far: 3.44, max_far_verified: false }).aor, null);
  assert.equal(parcelMetrics({ lot_sf: 4700, max_far: 3.44, buildable_sf_aor: null }).aor, null);
  assert.equal(parcelMetrics({ lot_sf: 4700, max_far_uap: 4, combined_buildable_gsf: 99000, buildable_sf_uap: 0 }).aor, null);
  assert.equal(parcelMetrics({ buildable_sf_uap: 19200 }).uap, 19200);
});

test("triage uses a saved usable owner number, not a neighbor, callback or unsaved public route", () => {
  const contacts = [{ role: "neighbor", phone: "212-555-0105" }, { role: "owner", phone: "Unknown" }];
  const candidate = { owner_contact: { phone: "212-555-0106" }, priority: "HOT" };
  assert.equal(prospectPhone(candidate, contacts), "");
  assert.equal(prospectStage({}, prospectPhone(candidate, contacts), contacts), "No Number");
  const phone = prospectPhone(candidate, [...contacts, { role: "owner", phone: "(212) 555-0107 ext. 32" }]);
  assert.equal(phone, "+12125550107");
  assert.equal(prospectStage({}, phone), "To Call");
  assert.equal(ownerPhone("unknown / 555-0107"), "");
  assert.equal(prospectStage({}, "", [{ role: "owner", callbackAt: A }]), "Follow Up");
  assert.equal(prospectStage({ status: "Calling" }, "", [{ role: "owner", callbackAt: A }]), "Follow Up");
  assert.equal(researchTag(candidate), "Research priority");
});

test("legacy and terminal statuses stay reachable without inventing calls", () => {
  for (const [status, stage] of [["Calling", "To Call"], ["Interested", "Hot Lead"], ["Follow-up", "Follow Up"], ["Pass", "Pass"], ["Converted", "Converted"], ["Hold", "Other status"]]) {
    assert.equal(prospectStage({ status, at: A }), stage);
    assert.equal(hasCall({ status, at: A }), false);
  }
  assert.equal(prospectStage({}, "", [{ converted_deal_id: "fixture-deal" }]), "Converted");
  assert.equal(prospectStage({ stage: "No Number", status: "Follow-up" }, "+12125550107"), "No Number");
});

test("call log survives JSON round trip, moves and form state; undo doesn't remove legacy data", () => {
  const prior = { status: "Calling", note: "Original note", at: A, custom: { kept: true } };
  const moved = moveProspect(prior, "Called", B);
  assert.deepEqual(moved, { ...prior, stage: "Called", stageAt: B, called: true, calledAt: B });
  const revived = JSON.parse(JSON.stringify(moveProspect(moveProspect(moved, "Follow Up", A), "Hot Lead", A)));
  assert.equal(prospectStage(revived), "Hot Lead");
  assert.equal(revived.calledAt, B);
  assert.equal(hasCall(revived), true);
  const noCall = clearCall(revived, "Hot Lead", "", B);
  assert.equal(noCall.stage, "Hot Lead");
  assert.equal(hasCall(noCall), false);
  assert.equal(prospectStage(clearCall(moved, "Called", "", B)), "No Number");
  assert.equal(recordCall({ status: "Called", at: A }, B).calledAt, undefined);
  assert.equal(recordCall({ stage: "Follow Up" }, B).stage, "Follow Up");
});
