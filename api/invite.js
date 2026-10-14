// Vercel serverless function: POST /api/invite  { email, full_name, role }
// Needs env vars on Vercel (server-side only, never VITE_*):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL (https://deal-flow-ebon-mu.vercel.app)
// Until they are set, it answers 503 { code: "not_configured" } and the Team screen says invites aren't set up yet.
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return res.status(503).json({ code: "not_configured", error: "Invites aren't set up yet." });
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // 1. who is calling? must be a signed-in admin
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const { data: { user } = {}, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: "Sign in again." });
    const { data: me } = await admin.from("team_members").select("role").eq("user_id", user.id).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Only an admin can invite." });

    // 2. validate
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    const role = ["admin", "member", "viewer"].includes(body.role) ? body.role : "member";
    const full_name = String(body.full_name || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "That email doesn't look right." });

    // 3. allowlist first (RLS reads this), then the invite email
    const { error: upErr } = await admin.from("team_members")
      .upsert({ email, role, full_name: full_name || null, invited_by: user.id, invited_at: new Date().toISOString() });
    if (upErr) return res.status(500).json({ error: upErr.message });

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name },
      redirectTo: process.env.SITE_URL || undefined,
    });
    if (error && !/already been registered/i.test(error.message)) return res.status(500).json({ error: error.message });
    if (data?.user?.id) await admin.from("team_members").update({ user_id: data.user.id }).eq("email", email);

    return res.status(200).json({ ok: true, email, role });
  } catch (e) {
    return res.status(500).json({ error: "Invite failed. Try again in a minute." });
  }
}
