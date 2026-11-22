import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { downloadMasterCopy, isMasterDescriptor, workbookBytes } from "./excelUnderwriting";
import "./excelUnderwriting.css";

const TABLE = "uw_excel_templates";
const WorkbookGrid = lazy(() => import("./ExcelWorkbookGrid.jsx"));
export default function ExcelUnderwriting({ userId }) {
  return userId ? <OwnerExcelUnderwriting key={userId} userId={userId}/> : null;
}

function OwnerExcelUnderwriting({ userId }) {
  const [master, setMaster] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [sessionBook,setSessionBook] = useState(null);
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

  const openCopy = async (mode) => {
    if (busy) return;
    setBusy(mode);
    setError("");
    const token = active.current;
    try {
      const { data, error: failure } = await supabase.from(TABLE)
        .select("owner_id,byte_count,xlsx_base64").eq("owner_id", userId).single();
      if (active.current !== token) return;
      if (failure || !isMasterDescriptor(data, userId)) throw new Error("Workbook unavailable");
      if(mode === "edit")setSessionBook(workbookBytes(data.xlsx_base64,data.byte_count));
      else downloadMasterCopy(data.xlsx_base64,data.byte_count);
    } catch {
      if (active.current === token) setError("Couldn’t open the workbook. Try again.");
    } finally {
      if (active.current === token) setBusy("");
    }
  };

  if(sessionBook)return <Suspense fallback={<p role="status">Opening spreadsheet…</p>}><WorkbookGrid bytes={sessionBook} onClose={()=>setSessionBook(null)}/></Suspense>;
  return (
    <section className="uwExcel" aria-labelledby="uw-excel-title">
      <div>
        <p className="uwExcel__eyebrow">Excel master · Private</p>
        <h2 id="uw-excel-title">Development Pro Forma</h2>
        <p className="uwExcel__description">Edit Pro Forma, Rent Roll, and Soft Cost Budget here in a spreadsheet. Save an Excel copy when you’re done. The master never changes.</p>
      </div>
      <div className="uwExcel__choices">
        <button type="button" className="uwExcel__action" onClick={()=>openCopy("edit")} disabled={!!busy}>{busy==="edit"?"Opening…":"Edit in spreadsheet"}</button>
        <button type="button" className="uwExcel__action uwExcel__download" onClick={()=>openCopy("download")} disabled={!!busy}>{busy==="download"?"Preparing…":"Download master"}</button>
      </div>
      {error && <p className="uwExcel__error" role="alert">{error}</p>}
    </section>
  );
}
