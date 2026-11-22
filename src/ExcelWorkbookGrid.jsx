import React,{useEffect,useMemo,useRef,useState} from "react";
import { cellAddress,cellPosition,colLabel,gridKey,recalculate } from "./excelGridCalc.js";
import { loadGridBook,verifyTemplate,editableText,displayGridValue,makeGridEdit,exportGridBook } from "./excelGridBook.js";
import { downloadExcelBytes } from "./excelUnderwriting.js";
import "./excelGrid.css";

function worksheetLayout(sheet) {
  const {r1,r2,c1,c2}=sheet.bounds;
  const anchors=new Map(), covered=new Map();
  for(const b of sheet.merges) {
    const endRow=Math.min(r2,b.r2), endCol=Math.min(c2,b.c2);
    if(b.r1<r1||b.c1<c1||b.r1>endRow||b.c1>endCol)continue;
    const a=cellAddress(b.r1,b.c1);
    anchors.set(a,{rowSpan:endRow-b.r1+1,colSpan:endCol-b.c1+1});
    for(let r=b.r1;r<=endRow;r++)for(let c=b.c1;c<=endCol;c++) if(r!==b.r1||c!==b.c1)covered.set(cellAddress(r,c),a);
  }
  const rows=Array.from({length:r2-r1+1},(_,i)=>i+r1);
  const cols=Array.from({length:c2-c1+1},(_,i)=>i+c1);
  return {anchors,covered,rows,cols};
}
const within=(s,p)=>p&&p.row>=s.bounds.r1&&p.row<=s.bounds.r2&&p.col>=s.bounds.c1&&p.col<=s.bounds.c2;
const first=(s)=>cellAddress(s.bounds.r1,s.bounds.c1);
export default function ExcelWorkbookGrid({bytes,onClose}) {
  const master=useMemo(()=>{
    try{const book=loadGridBook(bytes); const verified=verifyTemplate(book); return {book,verified};}
    catch(error){return {error:error.message||"Couldn’t open the spreadsheet."};}
  },[bytes]);
  if(master.error)return <div className="egFail" role="alert"><p>{master.error} You can still download the original master.</p><button className="egButton" onClick={onClose}>Back to Underwriting</button></div>;
  return <Grid book={master.book} baseline={master.verified.out} onClose={onClose}/>;
}
function Grid({book,baseline,onClose}) {
  const [tab,setTab]=useState(0), [edits,setEdits]=useState(()=>new Map()), [sel,setSel]=useState(()=>first(book.sheets[0]));
  const [pending,setPending]=useState(null), [hint,setHint]=useState(""), [notice,setNotice]=useState(""), [saving,setSaving]=useState(false);
  const [confirmClose,setConfirmClose]=useState(false), [undoLength,setUndoLength]=useState(0);
  const currentEdits=useRef(edits), currentPending=useRef(null), saved=useRef(edits), undo=useRef([]), focusRef=useRef(null);
  const inputRef=useRef(null), viewport=useRef(null);
  const sheet=book.sheets[tab], layout=useMemo(()=>worksheetLayout(sheet),[sheet]);
  const widths=useMemo(()=>{
    const out=new Map(layout.cols.map(c=>[c,sheet.colWidths.get(c)||86]));
    for(const [addr,cell] of sheet.cells) {
      if(typeof cell.value!=="number"||layout.covered.has(addr)||(layout.anchors.get(addr)?.colSpan||1)>1)continue;
      const p=cellPosition(addr); if(!within(sheet,p))continue;
      const fmt=book.styles[cell.style]||{}, displayed=displayGridValue(cell.value,fmt.numFmt||"General",book.date1904);
      const min=Math.min(280,Math.ceil(displayed.length*(fmt.size||12)*.63+19));
      out.set(p.col,Math.max(min,out.get(p.col)||86));
    }
    return out;
  },[book,sheet,layout]);
  const key=gridKey(sheet.name,sel), original=sheet.cells.get(sel), source=edits.get(key)||original;
  const style=book.styles[original?.style??0]||{}, label=`${sheet.name} ${sel}`;
  const textValue=pending?.key===key?pending.text:editableText(source,style,book.date1904);
  const setDraft=(draft)=>{currentPending.current=draft; setPending(draft);};
  const putChanges=(next)=>{undo.current=[...undo.current.slice(-29),currentEdits.current];setUndoLength(undo.current.length);currentEdits.current=next;setEdits(next);setNotice("");};
  const changeSet=useMemo(()=>{
    if(!pending||pending.key!==key||pending.text.startsWith("="))return edits;
    try{const v=makeGridEdit(pending.text,style,book.date1904);const next=new Map(edits);next.set(key,v);return next;}
    catch{return edits;}
  },[edits,pending,key,style,book.date1904]);
  const results=useMemo(()=>changeSet.size?recalculate(book,changeSet):baseline,[book,changeSet,baseline]);
  const errorCount=Array.from(results.values()).filter(r=>r.error).length;
  useEffect(()=>{
    if(!focusRef.current)return; const id=focusRef.current;
    focusRef.current=null;
    viewport.current?.querySelector(`[data-cell="${id}"]`)?.focus();
  },[sel,tab]);
  function saveDraft() {
    const draft=currentPending.current;
    if(!draft||draft.key!==key)return true;
    try {
      const v=makeGridEdit(draft.text,style,book.date1904);
      const next=new Map(currentEdits.current);next.set(key,v);putChanges(next);setDraft(null);setHint("");return true;
    } catch (err) {setHint(err.message);return false;}
  }
  function select(a,focus=true) {
    if(!saveDraft())return;
    a=layout.covered.get(a)||a;
    if(focus){if(sel===a)viewport.current?.querySelector(`[data-cell="${a}"]`)?.focus();else focusRef.current=a;}
    setHint("");setSel(a);
  }
  function openEditor(){inputRef.current?.focus({preventScroll:true});inputRef.current?.select();}
  function clickCell(a){const tapping=window.matchMedia?.("(pointer: coarse)").matches; select(a,!tapping); if(tapping)openEditor();}
  function selectSheet(i) {
    if(i===tab||!saveDraft())return;
    const s=book.sheets[i]; setSel(first(s));setTab(i);setHint("");setNotice("");
    if(viewport.current){viewport.current.scrollTop=0;viewport.current.scrollLeft=0;}
  }
  function arrow(a,dr,dc) {
    const p=cellPosition(a); if(!p)return;
    const span=layout.anchors.get(a), r=p.row+(dr>0?span?.rowSpan||1:dr), c=p.col+(dc>0?span?.colSpan||1:dc);
    if(!within(sheet,{row:r,col:c}))return;
    select(cellAddress(r,c));
  }
  function typeToEdit(raw) {setDraft({key,text:raw});inputRef.current?.focus({preventScroll:true});setHint("");}
  function keyboard(e){
    if(e.target.tagName==="INPUT" || e.target.tagName==="TEXTAREA")return;
    const dirs={ArrowLeft:[0,-1],ArrowRight:[0,1],ArrowUp:[-1,0],ArrowDown:[1,0]};
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&!e.shiftKey){e.preventDefault();undoEdit();}
    else if(dirs[e.key]){e.preventDefault();arrow(sel,...dirs[e.key]);}
    else if(e.key==="Enter"||e.key==="F2"){e.preventDefault();openEditor();}
    else if(e.key==="Backspace"||e.key==="Delete"){e.preventDefault();const next=new Map(currentEdits.current);next.set(key,{kind:"blank",value:null});putChanges(next);}
    else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();typeToEdit(e.key);}
  }
  function handleEditKey(e){
    if(e.key==="Escape"){e.preventDefault();setDraft(null);setHint("");viewport.current?.querySelector(`[data-cell="${sel}"]`)?.focus();}
    else if(e.key==="Enter"){e.preventDefault();if(saveDraft())viewport.current?.querySelector(`[data-cell="${sel}"]`)?.focus();}
  }
  function handlePaste(e) {
    const val=e.clipboardData?.getData("text/plain"); if(val==null)return;
    if(e.target.tagName==="INPUT"&&!/[\n\t]/.test(val))return;
    if(val.length>40000){e.preventDefault();setHint("That paste is too large. Try a smaller cell range.");return;}
    const rows=val.replace(/\r\n/g,"\n").replace(/\n$/,"").split("\n").map(line=>line.split("\t"));
    const {row,col}=cellPosition(sel), items=[];
    try {
      for(const [i,line] of rows.entries())for(const [j,cell] of line.entries()) {
        const r=row+i,c=col+j;
        if(!within(sheet,{row:r,col:c}))throw new Error("The pasted range runs off this sheet.");
        const a=cellAddress(r,c);if(layout.covered.has(a))continue;
        const fmt=book.styles[sheet.cells.get(a)?.style??0]||{};
        items.push([gridKey(sheet.name,a),makeGridEdit(cell,fmt,book.date1904)]);
      }
      e.preventDefault();setDraft(null);const next=new Map(currentEdits.current);for(const [k,v] of items)next.set(k,v);putChanges(next);setHint("");
    }catch(err){e.preventDefault();setHint(err.message);}
  }
  function handleCopy(e) {
    if(e.target.tagName==="INPUT")return;
    const r=results.get(key);const v=r?.error||r?.value; if(v==null)return;
    e.preventDefault();e.clipboardData?.setData("text/plain",displayGridValue(v,style.numFmt||"General",book.date1904));
  }
  function undoEdit(){
    const prior=undo.current.pop();if(!prior)return;
    setDraft(null);currentEdits.current=prior;setEdits(prior);setUndoLength(undo.current.length);setHint("");setNotice("");
  }
  function saveCopy() {
    if(saving || !saveDraft())return;
    setSaving(true);setHint("");
    try{
      const current=currentEdits.current;const bytes=exportGridBook(book,current);downloadExcelBytes(bytes);
      saved.current=current;setNotice("Excel download started. The master is unchanged.");
    }catch(error){setHint(error.message||"Couldn’t export the workbook.");}
    finally{setSaving(false);}
  }
  function closeCopy(){if(saved.current!==currentEdits.current||currentPending.current)setConfirmClose(true);else onClose();}
  return <section className="excelGrid" aria-label="Development Pro Forma spreadsheet" onPaste={handlePaste}>
    <div className="egTop"><div><span className="egKicker">PRIVATE EXCEL WORKSPACE</span><h2>Development Pro Forma</h2></div><div className="egActions">
      <button className="egButton egSecondary" type="button" onClick={undoEdit} disabled={!undoLength}>Undo</button>
      <button className="egButton egMain" type="button" onClick={saveCopy} disabled={saving}>Save Excel copy</button>
      <button className="egButton egSecondary" type="button" onClick={closeCopy}>Close</button>
    </div></div>
    {confirmClose&&<div className="egConfirm" role="alert"><span>Close without saving your edits?</span><button className="egButton egSecondary" onClick={()=>setConfirmClose(false)}>Keep editing</button><button className="egButton egMain" onClick={onClose}>Discard copy</button></div>}
    <p className="egGuide">Click a cell and type, or edit it in the formula bar. Totals update in this copy. The master stays unchanged.</p>
    <div className="egTabs" aria-label="Workbook tabs">{book.sheets.map((s,i)=><button key={s.name} type="button" className="egTab" aria-pressed={i===tab} onClick={()=>selectSheet(i)}>{s.name}</button>)}</div>
    <div className="egFormulaBar"><output className="egAddress" aria-label="Selected cell">{sel}</output><label htmlFor="excel-grid-fx" aria-label="Formula bar" className="egFx">ƒx</label><input id="excel-grid-fx" ref={inputRef} type="text" maxLength={4096} aria-label={`Edit ${label}`} value={textValue} onChange={e=>setDraft({key,text:e.target.value})} onBlur={saveDraft} onKeyDown={handleEditKey} spellCheck={false} autoComplete="off"/><button type="button" className="egButton egApply" onClick={()=>{if(saveDraft())viewport.current?.querySelector(`[data-cell="${sel}"]`)?.focus();}}>Apply</button></div>
    {(hint||notice||errorCount>0)&&<p className={`egStatus${hint||errorCount?" egWarn":""}`} role="status">{hint||(errorCount?`${errorCount} cell${errorCount===1?"":"s"} with a formula error. Check the cells before relying on these totals.`:notice)}</p>}
    <div className="egViewport" ref={viewport} onKeyDown={keyboard} onCopy={handleCopy} aria-label={`${sheet.name} spreadsheet; scroll for more cells`}>
      <table className="egCells" aria-label={sheet.name} style={{width:46+layout.cols.reduce((t,c)=>t+(widths.get(c)||86),0)}}>
        <colgroup><col style={{width:46}}/>{layout.cols.map(c=><col key={c} style={{width:widths.get(c)||86}}/>)}</colgroup>
        <thead><tr><th className="egCorner" aria-hidden="true"/>{layout.cols.map(c=><th key={c} scope="col" className={c===cellPosition(sel)?.col?"egHeaderSelected":""}>{colLabel(c)}</th>)}</tr></thead>
        <tbody>{layout.rows.map(row=><tr key={row} style={{height:sheet.rowHeights.get(row)||28}}><th scope="row" className={row===cellPosition(sel)?.row?"egHeaderSelected":""}>{row}</th>
          {layout.cols.map(col=>{
            const a=cellAddress(row,col);if(layout.covered.has(a))return null;
            const k=gridKey(sheet.name,a), base=sheet.cells.get(a), fmt=book.styles[base?.style??0]||{}, r=results.get(k), selected=a===sel;
            const calc=(changeSet.get(k)||base)?.kind==="formula";
            const val=r?.error||displayGridValue(r?.value,fmt.numFmt||"General",book.date1904);
            const {rowSpan=1,colSpan=1}=layout.anchors.get(a)||{};
            const color=r?.error?"#9B262B":fmt.color||(calc?"#122136":"#174b91");
            return <td key={a} data-cell={a} colSpan={colSpan} rowSpan={rowSpan} tabIndex={selected?0:-1} aria-label={`${a}${val!==""?": "+val:""}`} title={`${a}${val!==""?": "+val:""}`} className={`${selected?"egSelected ":""}${r?.error?"egError":""}`} style={{backgroundColor:fmt.background||"#fff",color,fontWeight:fmt.bold?700:400,fontStyle:fmt.italic?"italic":"normal",fontSize:fmt.size||12,textAlign:fmt.align==="center"?"center":(fmt.align==="right"||typeof r?.value==="number")?"right":"left"}} onClick={()=>clickCell(a)} onDoubleClick={openEditor}>
              <span className={fmt.wrap?"egWrap":"egCellValue"}>{val}</span>
            </td>;
          })}</tr>)}</tbody>
      </table>
    </div>
    <div className="egFooter"><span>{sheet.name} · {edits.size} edited {edits.size===1?"cell":"cells"}</span><span>Save a copy to keep your changes.</span></div>
  </section>;
}
