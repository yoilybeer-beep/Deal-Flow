import React, { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";

/* ============================================================
   TEAM — admin only. Invite by email, set role, remove.
   Reads: rpc team_list()  (security definer, admins only)
   Invites: POST /api/invite (Vercel function, holds the service key)
   ============================================================ */

export const ROLES = [
  ["admin", "Admin", "Everything, plus this Team screen"],
  ["member", "Member", "Add and edit deals, buyers, contacts"],
  ["viewer", "View only", "Can look, can't change anything"],
];
const roleLabel = (r) => (ROLES.find(([k]) => k === r) || [r, r])[1];
const initials = (n) => (n || "?").split(/[\s@.]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const ago = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

export default function Team({ userId, notify }) {
  const [members, setMembers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(null);
  const [notReady, setNotReady] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.rpc("team_list");
    if (error) notify?.(error.message);
    setMembers(data || []);
    setLoaded(true);
  };
  useEffect(() => { load(); }, []);

  const invite = async () => {
    const e = email.trim().toLowerCase();
    if (!e.includes("@")) return;
    setBusy(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ email: e, full_name: name.trim(), role }),
    }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : { error: "No connection. Try again." };
    setBusy(false);
    // the invite function isn't switched on yet (server keys not set) — say so plainly
    if (res && (out.code === "not_configured" || res.status === 404 || (!res.ok && !out.error))) {
      setNotReady(true);
      return notify?.("Invites aren't set up yet — the server side still needs switching on.");
    }
    if (!res?.ok) return notify?.(out.error || "Invite failed.");
    notify?.(`Invite sent to ${e}. They set their own password from the email.`);
    setEmail(""); setName(""); setRole("member");
    load();
  };

  const setMemberRole = async (m, r) => {
    const { error } = await supabase.from("team_members").update({ role: r }).eq("email", m.email);
    if (error) return notify?.(error.message);
    setMembers(members.map((x) => (x.email === m.email ? { ...x, role: r } : x)));
  };

  const remove = async (m) => {
    if (armed !== m.email) return setArmed(m.email);
    const { error } = await supabase.from("team_members").delete().eq("email", m.email);
    if (error) return notify?.(error.message);
    setMembers(members.filter((x) => x.email !== m.email));
    setArmed(null);
    notify?.(`${m.email} removed. Their access ends now.`);
  };

  const admins = members.filter((m) => m.role === "admin").length;

  return (
    <>
      <header className="pageHead">
        <h1>Team</h1>
        <span className="resultCount">{members.length} people · invite-only</span>
      </header>
      <div className="formCols">
        <div className="formMain">
          <div className="fgroup">
            <div className="ftitle">People with access</div>
            {!loaded && <div className="hintline">Loading…</div>}
            <div className="teamList">
              {members.map((m) => {
                const me = m.user_id === userId;
                const invited = !m.last_sign_in_at;
                return (
                  <div key={m.email} className="teamRow">
                    <i className="avatar">{initials(m.full_name || m.email)}</i>
                    <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                      <b>{m.full_name || m.email.split("@")[0]}{me && <span className="youTag">you</span>}</b>
                      <div className="rowSub" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{m.email}</div>
                      <div className={"statusTag " + (invited ? "invited" : "active")}>
                        {invited ? `● Invited ${ago(m.invited_at)} · hasn't signed in` : `● Active · last in ${ago(m.last_sign_in_at)}`}
                      </div>
                    </div>
                    <div className="teamCtl">
                      <select value={m.role} disabled={me && m.role === "admin" && admins === 1} onChange={(e) => setMemberRole(m, e.target.value)}>
                        {ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                      {!me && <button className="danger small" onClick={() => remove(m)}>{armed === m.email ? "Tap again" : "Remove"}</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="formSide">
          <div className="fgroup">
            <div className="ftitle">Invite someone</div>
            <div className="field"><label className="flabel">Email *</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="newhire@jrealtygroup.com" /></div>
            <div className="field"><label className="flabel">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="First Last" /></div>
            <div className="field"><label className="flabel">Role</label>
              <div className="roleList">
                {ROLES.map(([k, l, d]) => (
                  <button key={k} className="visBtn" data-on={role === k} onClick={() => setRole(k)}><b>{l}</b><span>{d}</span></button>
                ))}
              </div>
            </div>
            <button className="primary" style={{ width: "100%", marginTop: 4 }} disabled={busy || !email.includes("@")} onClick={invite}>
              {busy ? "Sending…" : "Send invite"}
            </button>
            {notReady && (
              <div className="notice" style={{ marginTop: 10, background: "#F3F0E4", borderColor: "#DDD0AC" }}>
                Invites aren't set up yet. The invite email needs one server setting switched on first — nothing was sent and nobody was added.
              </div>
            )}
            <div className="hintline">They get an email from J Realty Group with a link to set a password. Nobody else can sign up. Remove someone and their access ends immediately.</div>
          </div>
        </div>
      </div>
    </>
  );
}
