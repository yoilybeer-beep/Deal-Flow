import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSnapshot, inFilter, cleanEdits, emptyEdits, roughSensitivity, safeLink, dialNumber } from '../src/developmentLeads.js';
import { fixtureSnapshot } from './developmentLeads.fixtures.js';

test('normalizes stable ranked 30+ scenarios, keeps 299+ and idempotent data', () => {
  const f = fixtureSnapshot(); f.leads.reverse();
  const data = parseSnapshot(f);
  assert.deepEqual(data.leads.map((s) => s.rank), [1,2,3,4]);
  assert.deepEqual(parseSnapshot(data), data);
  assert.equal(data.leads[1].target_units.max,305);
  assert.equal(inFilter(data.leads[1],emptyEdits,{units:'299+'}),true);
  assert.equal(inFilter(data.leads[2],emptyEdits,{units:'100+'}),true);
  assert.equal(inFilter(data.leads[3],emptyEdits,{units:'100+'}),false);
  assert.equal(inFilter(data.leads[3],emptyEdits,{units:'unconfirmed',borough:'Staten Island',frontage:'50'}),true);
  assert.equal(inFilter(data.leads[2],emptyEdits,{units:'30-99',existing:'6-10'}),true);
});
test('retained donor households are not added to redevelopment occupancy or rough units', () => {
  const f = fixtureSnapshot(), a = parseSnapshot(f).leads[1];
  assert.equal(a.existing_units,4);
  assert.equal(a.parcels[1].existing_units,54);
  assert.deepEqual(roughSensitivity(a.air_rights.new_build_sf),{min:248,max:320});
  f.leads[1].existing_units = 5;
  assert.throws(() => parseSnapshot(f), /acquisition-parcel units/);
  f.leads[1].existing_units = 4; f.leads[1].air_rights.transfer_verified = true;
  assert.throws(() => parseSnapshot(f), /transfer as unverified/);
});
test('finds researched parcels and private corrections but does not mutate source', () => {
  const s = parseSnapshot(fixtureSnapshot()).leads[1];
  const p = cleanEdits({...emptyEdits,address:'91 Corrected Fixture Way',phone:'(212) 555-0109 x 91',status:'Follow up'});
  assert.equal(dialNumber(p.phone),'2125550109;ext=91');
  assert.equal(inFilter(s,p,{q:'corrected fixture',status:'Follow up'}),true);
  assert.equal(inFilter(s,p,{q:'22 donor',status:'Follow up'}),true);
  assert.equal(s.anchor.address,'20 Fixture Receiver Lane');
  assert.throws(() => cleanEdits({...emptyEdits,phone:'not a number'}), /valid phone/);
  assert.equal(cleanEdits({...p,phone:''}).phone,'');
});
test('rejects duplicate identities, weak fallback, invented asks and non-HTTPS evidence', () => {
  const f = fixtureSnapshot(); f.leads[1].id=f.leads[0].id;
  assert.throws(() => parseSnapshot(f), /Duplicate site ID/);
  const g = fixtureSnapshot(); g.leads[3].frontage_ft=49;
  assert.throws(() => parseSnapshot(g), /50′\+ anchor frontage/);
  g.leads[3].frontage_ft=50; g.leads[3].listing.ask_usd=1;
  assert.throws(() => parseSnapshot(g), /Unverified asking prices/);
  assert.equal(safeLink('javascript:alert(0)'),'');
  assert.equal(safeLink('https://user:pass@example.test/'),'');
});
