import test from "node:test";
import assert from "node:assert/strict";
import { applyCardEdits, cardEditDraft, collectCardEdits, conversionParcel, opportunityCard } from "../src/opportunityEdits.js";
import { hasCall, parcelMetrics, prospectKey, prospectStage } from "../src/opportunityBoard.js";

const original = () => ({ date: "2030-01-01", base: { address: "1 Test Fixture St", bbl: "1000000001", owner: "EXAMPLE LLC", lot_sf: 1000, max_far: 4 },
  neighborhood: "Fixture area", neighbors: [{ address: "3 Test Fixture St", side: "left", unused_sf: 500 }] });
const evolve = (source, entry, edits, people = []) => {
  const before = opportunityCard(source, entry, people);
  const { changes, errors } = collectCardEdits(before, { ...cardEditDraft(before.values), ...edits });
  assert.deepEqual(errors, {});
  const saved = JSON.parse(JSON.stringify(applyCardEdits(entry, before.edits, changes)));
  return [opportunityCard(source, saved, people), saved];
};

test("manual phone drives only derived call readiness, survives JSON, and clearing suppresses fallback", () => {
  const p = original();
  assert.equal(prospectStage({}, opportunityCard(p).phone), "No Number");
  const [added, first] = evolve(p, { status: "New", note: "Keep me" }, { phone: "(212) 555-0100 ext. 42" });
  assert.equal(added.phone, "+12125550100;ext=42");
  assert.equal(prospectStage(first, added.phone), "To Call");
  assert.equal(hasCall(first), false);
  const contacts = [{ role: "owner", phone: "212-555-0103" }];
  const [cleared, second] = evolve(p, first, { phone: "" }, contacts);
  assert.equal(cleared.phone, "");
  assert.equal(second.cardEdits.phone, "");
  const reset = collectCardEdits(cleared, cardEditDraft(cleared.baseline), true, true);
  const restored = applyCardEdits(second, cleared.edits, reset.changes);
  assert.equal(opportunityCard(p, restored, contacts).phone, "+12125550103");
  assert.deepEqual(restored, { status: "New", note: "Keep me" });
});

test("manual status, call date, legacy fields, BBL and untouched research stay intact", () => {
  const p = original(), baseSnapshot = structuredClone(p);
  const old = { stage: "Follow Up", status: "Interested", stageAt: "stage-ts", calledAt: "call-ts", note: "Keep note", unknown: [1, true] };
  const [card, entry] = evolve(p, old, { address: "8 New Fixture Ln", borough: "Bronx", neighborhood: "Updated district",
    lot_sf: "5,000", depth_ft: "38.5", askingPrice: "450000", "neighbor:0:address": "2 New Fixture Ln" });
  assert.deepEqual(p, baseSnapshot);
  assert.equal(prospectKey(card.source), "2030-01-01|1000000001");
  assert.equal(card.display.base.bbl, "1000000001");
  assert.equal(card.borough, "Bronx");
  assert.equal(card.display.base.address, "8 New Fixture Ln");
  assert.equal(card.display.neighbors[0].changedAddress, true);
  assert.deepEqual({ ...entry, cardEdits: undefined }, { ...old, cardEdits: undefined });
  assert.equal(prospectStage(entry, card.phone), "Follow Up");
  assert.equal(hasCall(entry), true);
  assert.equal(parcelMetrics(card.display.base).aor, 4000); // Original estimate, not recalculated from an edited area.
  assert.deepEqual(conversionParcel(card), { address: "8 New Fixture Ln", lot_sf: 5000, depth_ft: 38.5 });
});

test("business-field edits merge with another client’s unrelated edits; competing edits fail closed", () => {
  const existing = { note: "new note", calledAt: "call-ts", cardEdits: { phone: "2125550100", neighborhood: "newer neighborhood" } };
  const result = applyCardEdits(existing, {}, { address: "1 Synthetic Way" });
  assert.deepEqual(result, { ...existing, cardEdits: { ...existing.cardEdits, address: "1 Synthetic Way" } });
  assert.throws(() => applyCardEdits(existing, {}, { phone: "2125550101" }), { code: "CARD_CONFLICT" });
  assert.throws(() => applyCardEdits(existing, { phone: "2125550111" }, { phone: undefined }), { code: "CARD_CONFLICT" });
  assert.equal(applyCardEdits(existing, {}, { phone: "2125550100" }), existing);
  assert.throws(() => applyCardEdits({ cardEdits: { address: "10 Other Fixture St, Bronx" } }, {}, { borough: "Brooklyn" }), { code: "CARD_CONFLICT" });
});

test("validation flags invalid phone/address/borough and keeps untampered legacy blanks acceptable", () => {
  const card = opportunityCard(original());
  const draft = cardEditDraft(card.values);
  assert.deepEqual(collectCardEdits(card, draft), { changes: {}, errors: {} });
  const result = collectCardEdits(card, { ...draft, address: "", phone: "call me tomorrow", lot_sf: "-8", email: "bad", est_units: "1.5" });
  assert.deepEqual(Object.keys(result.errors).sort(), ["address", "email", "est_units", "lot_sf", "phone"]);
  assert.match(collectCardEdits(card, { ...draft, address: "1 Test Ave, Brooklyn", borough: "Bronx" }).errors.borough, /Brooklyn/);
});
