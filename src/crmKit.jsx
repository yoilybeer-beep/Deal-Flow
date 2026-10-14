import React from "react";

/* ============================================================
   Shared CRM bits: one-tap Call / Text / Email, "last contacted"
   ============================================================ */

export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const dial = (p) => String(p || "").replace(/[^\d+]/g, "");

export function QuickActions({ phone, email, subject, small }) {
  const tel = dial(phone);
  if (!tel && !email) return null;
  return (
    <div className={"qa" + (small ? " small" : "")} onClick={(e) => e.stopPropagation()}>
      {tel && <a className="qaBtn" href={`tel:${tel}`}>Call</a>}
      {tel && <a className="qaBtn" href={`sms:${tel}`}>Text</a>}
      {email && <a className="qaBtn" href={`mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`}>Email</a>}
    </div>
  );
}

// "last contacted" -> { label, days, cold, never }   cold = more than 30 days ago
export function lastContacted(dateStr) {
  if (!dateStr) return { label: "Not logged yet", days: null, cold: false, never: true };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(String(dateStr).slice(0, 10) + "T00:00:00");
  if (isNaN(d.getTime())) return { label: "Not logged yet", days: null, cold: false, never: true };
  const days = Math.round((today - d) / 86400000);
  const label = days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
  return { label, days, cold: days > 30 };
}

export function LastContactedTag({ date }) {
  const l = lastContacted(date);
  return <span className={"lastTag" + (l.cold ? " cold" : l.never ? " never" : "")} title={date || ""}>Last contacted: {l.label}</span>;
}
