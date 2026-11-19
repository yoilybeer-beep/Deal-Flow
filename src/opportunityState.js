export const opportunityStateId = (userId) => `opps-state-${userId}`;
const emptyState = (data = {}) => ({ ...data, prospects: data?.prospects || {}, contacts: data?.contacts || {} });

async function stateSession(client, userId, signal) {
  const { data, error } = await client.auth.getSession();
  if (error || signal.aborted || !userId || data?.session?.user?.id !== userId || !data.session.access_token) {
    throw new Error("Your session changed. Reopen New Opportunities to save changes.");
  }
  return data.session.access_token;
}
const authorized = (query, token, signal) => query.setHeader("Authorization", `Bearer ${token}`).abortSignal(signal);
const ownRow = (query, userId) => query.eq("id", opportunityStateId(userId)).eq("owner_id", userId).eq("is_public", false);
async function readRow(client, userId, signal) {
  const token = await stateSession(client, userId, signal);
  const { data: row, error } = await authorized(ownRow(client.from("models").select("data, updated_at"), userId), token, signal).maybeSingle();
  if (error) throw error;
  return row;
}
export async function readOpportunityState(client, userId, signal) {
  const row = await readRow(client, userId, signal);
  return emptyState(row?.data);
}

// Apply a small mutation to the latest private row. A timestamp compare-and-swap
// stops two current clients overwriting one another's notes, status or edits.
export async function commitOpportunityState(client, userId, signal, change, observe) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await readRow(client, userId, signal);
    const before = emptyState(row?.data);
    observe?.(before);
    const next = change(before);
    if (next === before) return before;
    const token = await stateSession(client, userId, signal);
    const updated_at = new Date(Math.max(Date.now(), (Date.parse(row?.updated_at) || 0) + 1)).toISOString();
    const payload = { data: { ...next, kind: "opps_state" }, updated_at };
    if (!row) {
      const { error } = await authorized(client.from("models").insert({ id: opportunityStateId(userId), owner_id: userId, is_public: false, ...payload }), token, signal);
      if (error?.code === "23505") continue; // Another client created it first.
      if (error) throw error;
    } else {
      let update = ownRow(client.from("models").update(payload), userId);
      update = row.updated_at == null ? update.is("updated_at", null) : update.eq("updated_at", row.updated_at);
      const { data, error } = await authorized(update.select("id"), token, signal);
      if (error) throw error;
      if (data?.length !== 1) continue;
    }
    return payload.data;
  }
  throw new Error("The board is changing in another session. Try saving again.");
}
