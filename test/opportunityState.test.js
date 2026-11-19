import test from "node:test";
import assert from "node:assert/strict";
import { commitOpportunityState } from "../src/opportunityState.js";

function fixture(sessions) {
  let n = 0;
  const requests = [];
  return { requests, client: {
    auth: { getSession: async () => {
      const id = sessions[n++];
      return { data: { session: id ? { user: { id }, access_token: `fixture-${id}` } : null } };
    } },
    from(table) {
      const request = { table, filters: {} };
      const q = {
        select: () => q,
        eq: (k, v) => { request.filters[k] = v; return q; },
        abortSignal: () => q,
        setHeader: (k, v) => { request[k] = v; return q; },
        maybeSingle: async () => { requests.push(request); return { data: null }; },
        insert: async () => { throw new Error("The test must not issue a write"); },
      };
      return q;
    },
  } };
}
const change = (s) => ({ ...s, testValue: true });
for (const [name, sessions, count] of [
  ["anonymous", [null], 0],
  ["another account", ["other"], 0],
  ["account change after read", ["owner", "other"], 1],
]) test(`${name} cannot issue an opportunity-state write`, async () => {
  const { client, requests } = fixture(sessions);
  await assert.rejects(commitOpportunityState(client, "owner", new AbortController().signal, change), /session changed/);
  assert.equal(requests.length, count);
  if (count) assert.deepEqual(requests[0], { table: "models", filters: { id: "opps-state-owner", owner_id: "owner", is_public: false }, Authorization: "Bearer fixture-owner" });
});
