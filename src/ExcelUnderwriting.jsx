import React, { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { downloadMasterCopy, isMasterDescriptor } from "./excelUnderwriting";
import "./excelUnderwriting.css";

const TABLE = "uw_excel_templates";

export default function ExcelUnderwriting({ userId }) {
  const [master, setMaster] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(null);
  useEffect(() => {
    if (!userId) return;
    let mounted = true;
    const token = Symbol();
    active.current = token;
    const load = async () => {
      try {
        const { data, error: failure } = await supabase.from(TABLE)
          .select("owner_id,byte_count").eq("owner_id", userId).maybeSingle();
        if (mounted && !failure && isMasterDescriptor(data, userId)) setMaster(data);
      } catch { /* The existing underwriting screen works without a master. */ }
    };
    load();
    return () => { mounted = false; active.current = null; };
  }, [userId]);

  if (!isMasterDescriptor(master, userId)) return null;

  const newCopy = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    const token = active.current;
    try {
      const { data, error: failure } = await supabase.from(TABLE)
        .select("owner_id,byte_count,xlsx_base64").eq("owner_id", userId).single();
      if (active.current !== token) return;
      if (failure || !isMasterDescriptor(data, userId)) throw new Error("Workbook unavailable");
      downloadMasterCopy(data.xlsx_base64, data.byte_count);
    } catch {
      if (active.current === token) setError("I couldn’t download the workbook. Try again.");
    } finally {
      if (active.current === token) setBusy(false);
    }
  };

  return (
    <section className="uwExcel" aria-labelledby="uw-excel-title">
      <div>
        <p className="uwExcel__eyebrow">Excel master · Private</p>
        <h2 id="uw-excel-title">Development Pro Forma</h2>
        <p className="uwExcel__description">Pro Forma, Rent Roll, and Soft Cost Budget in one editable workbook. Download a fresh copy for each deal and open it in Excel. Your edits stay in your copy, not the master.</p>
      </div>
      <button type="button" className="uwExcel__action" onClick={newCopy} disabled={busy}>
        {busy ? "Preparing copy…" : "Download Excel copy"}
      </button>
      {error && <p className="uwExcel__error" role="alert">{error}</p>}
    </section>
  );
}
