import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { cellAddress, cellPosition, rangePosition, gridKey, recalculate } from "./excelGridCalc.js";

const NS="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL="http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const builtIn={0:"General",1:"0",2:"0.00",3:"#,##0",4:"#,##0.00",9:"0%",10:"0.00%",11:"0.00E+00",12:"# ?/?",13:"# ??/??",14:"mm/dd/yy",15:"d-mmm-yy",16:"d-mmm",17:"mmm-yy",20:"h:mm",22:"m/d/yy h:mm",37:"#,##0 ;(#,##0)",38:"#,##0 ;[Red](#,##0)",39:"#,##0.00;(#,##0.00)",40:"#,##0.00;[Red](#,##0.00)",44:'$#,##0.00',49:"@"};
const get=(n,k)=>n?.getAttribute(k)??"";
const isYes=(v)=>v==="1"||v==="true";
const kids=(n,name)=>Array.from(n?.childNodes||[]).filter(a=>a.nodeType===1 && (!name || a.localName===name));
const child=(n,name)=>kids(n,name)[0];
const desc=(n,name)=>Array.from(n?.getElementsByTagNameNS("*",name)||[]);
const text=(n)=>n?.textContent??"";
const txtRuns=(n)=>desc(n,"t").map(text).join("");
const rgb=(n)=>/^[a-f\d]{6,8}$/i.test(get(n,"rgb"))?"#"+get(n,"rgb").slice(-6):null;
function xml(parts,p) {
  if(!parts[p]) throw new Error("Workbook is missing a required part.");
  const src=strFromU8(parts[p]); if(/<!\s*(?:DOCTYPE|ENTITY)/i.test(src)) throw new Error("Unexpected workbook document type.");
  const d=new DOMParser().parseFromString(src,"application/xml");
  if(!d.documentElement || desc(d,"parsererror").length) throw new Error("Could not read workbook XML.");
  return d;
}
function pathFor(source,target) {
  if(!target||target.includes("\\")||target.includes(":")||target.includes("?")) throw new Error("Unsupported workbook link.");
  const p=target.startsWith("/")?[]:source.split("/").slice(0,-1);
  for(const t of target.replace(/^\//,"").split("/")) {
    if(t==="..") { if(!p.length)throw new Error("Unsupported workbook path.");p.pop(); }
    else if(t!==".") p.push(t);
  }
  return p.join("/");
}
function relationships(parts,mp) {
  const paths=mp.split("/"), last=paths.pop(); const rp=[...paths,"_rels",last+".rels"].join("/");
  if(!parts[rp])return [];
  return desc(xml(parts,rp),"Relationship").filter(r=>get(r,"TargetMode")!=="External").map(r=>({id:get(r,"Id"),type:get(r,"Type").split("/").at(-1),path:pathFor(mp,get(r,"Target"))}));
}
function readStyles(parts,p) {
  if(!p)return [];
  const root=xml(parts,p).documentElement, nrs={...builtIn};
  for(const f of kids(child(root,"numFmts"),"numFmt")) nrs[get(f,"numFmtId")]=get(f,"formatCode");
  const fonts=kids(child(root,"fonts"),"font"), fills=kids(child(root,"fills"),"fill");
  return kids(child(root,"cellXfs"),"xf").map(f=>{
    const font=fonts[+get(f,"fontId")], fill=child(fills[+get(f,"fillId")],"patternFill"), align=child(f,"alignment");
    const color=rgb(child(font,"color")), background=get(fill,"patternType")==="solid"?rgb(child(fill,"fgColor")):null;
    const numFmt=nrs[get(f,"numFmtId")||"0"]||"General";
    return {numFmt, color, background, bold:!!child(font,"b"), italic:!!child(font,"i"), size:Math.min(18,Math.max(11,(+get(child(font,"sz"),"val")||10)*1.19)), align:get(align,"horizontal"), wrap:isYes(get(align,"wrapText"))};
  });
}
export function loadGridBook(bytes) {
  let total=0, entries=0;
  const parts=unzipSync(bytes,{filter:f=>{
    total+=f.originalSize; if(total>8*1024*1024 || ++entries>160 || f.name.includes("..")) throw new Error("Workbook exceeds this editor’s limits.");
    return true;
  }});
  const wb=xml(parts,"xl/workbook.xml").documentElement;
  const rel=relationships(parts,"xl/workbook.xml"), tables=[];
  const styles=readStyles(parts,rel.find(x=>x.type==="styles")?.path);
  const stringsPath=rel.find(x=>x.type==="sharedStrings")?.path;
  const strings=stringsPath?desc(xml(parts,stringsPath),"si").map(txtRuns):[];
  const date1904=isYes(get(child(wb,"workbookPr"),"date1904"));
  const names=kids(child(wb,"sheets"),"sheet");
  if(!names.length||names.length>8)throw new Error("Unexpected number of workbook tabs.");
  const sheets=names.map((node,idx)=>{
    const name=get(node,"name"), id=node.getAttributeNS(REL,"id")||get(node,"r:id");
    const path=rel.find(x=>x.id===id&&x.type==="worksheet")?.path;
    if(!path)throw new Error("Worksheet connection missing.");
    const sh=xml(parts,path).documentElement, sheetData=child(sh,"sheetData"), cells=new Map(), hiddenRows=new Set(), rowHeights=new Map(), colWidths=new Map();
    let maxRow=1,maxCol=1;
    for(const r of kids(sheetData,"row")) {
      const i=+get(r,"r"); if(!i || i>768)throw new Error("Workbook has too many rows.");
      maxRow=Math.max(maxRow,i); if(isYes(get(r,"hidden")))hiddenRows.add(i);
      if(+get(r,"ht"))rowHeights.set(i,Math.max(26,+get(r,"ht")*1.333));
      for(const c of kids(r,"c")) {
        const a=get(c,"r"), pos=cellPosition(a), f=child(c,"f"), v=child(c,"v"), type=get(c,"t"), style=+get(c,"s")||0;
        if(!pos||pos.col>128)throw new Error("Workbook has too many columns.");
        maxCol=Math.max(pos.col,maxCol);
        let value=null, kind="blank";
        if(type==="inlineStr") { value=txtRuns(child(c,"is")); kind="text"; }
        else if(v && text(v)!=="") {
          if(type==="s") { value=strings[+text(v)]||""; kind="text"; }
          else if(type==="str"||type==="d") {value=text(v); kind="text";}
          else if(type==="b") {value=text(v)==="1"; kind="bool";}
          else if(type==="e") {value=text(v); kind="error";}
          else {value=Number(text(v));kind="number";}
        }
        if(f) {if(get(f,"t")==="shared" || get(f,"t")==="array" || !text(f)) throw new Error("This worksheet uses a formula type the browser cannot edit."); kind="formula";}
        cells.set(a,{kind,value,formula:f?text(f):null,style});
      }
    }
    for(const c of kids(child(sh,"cols"),"col")) for(let i=+get(c,"min");i<=Math.min(128,+get(c,"max"));i++)
      colWidths.set(i,Math.max(22,Math.min(410,(+get(c,"width")||9)*7+7)));
    const print=kids(child(wb,"definedNames"),"definedName").find(d=>get(d,"name")==="_xlnm.Print_Area" && get(d,"localSheetId")===String(idx));
    let bounds={r1:1,c1:1,r2:maxRow,c2:maxCol};
    if(print) {
      const r=text(print).split("!").at(-1); if(r&&!r.includes(",")) {
        try{const p=rangePosition(r);if(p.r2<=768&&p.c2<=128) bounds=p;}catch{/* use the actual worksheet dimensions */}
      }
    }
    for(const t of relationships(parts,path).filter(r=>r.type==="table")) {
      const tr=xml(parts,t.path).documentElement;
      tables.push({name:get(tr,"name")||get(tr,"displayName"),sheet:name,...rangePosition(get(tr,"ref")),headers:kids(child(tr,"tableColumns"),"tableColumn").map(h=>get(h,"name"))});
    }
    const merges=kids(child(sh,"mergeCells"),"mergeCell").map(m=>rangePosition(get(m,"ref")));
    return {name,path,cells,bounds,merges,hiddenRows,rowHeights,colWidths,maxRow,maxCol};
  });
  return {parts,bytes,sheets,styles,tables,date1904};
}
export function verifyTemplate(book) {
  const out=recalculate(book); let formulas=0;
  for(const sh of book.sheets) for(const [a,c] of sh.cells) if(c.kind==="formula") {
    const r=out.get(gridKey(sh.name,a));
    const valid=typeof c.value==="number"?typeof r?.value==="number" && Math.abs(c.value-r.value)<=Math.max(1e-7,Math.abs(c.value)*5e-10):r?.value===c.value;
    if(r?.error||!valid)throw new Error(`Formula check failed: ${sh.name} ${a}. The Excel master is unchanged.`);
    formulas++;
  }
  return {out,formulas};
}
const fmtClean=(fmt)=>fmt.replace(/"([^"]*)"/g,"$1").replace(/\[[^\]]+\]/g,"").replace(/\\(.)/g,"$1");
const isDate=(fmt)=>/(?:d{1,4}[-/ .]m{1,4}|m{1,4}[-/ .]d{1,4}|y{2,4}[-/ .]m{1,4}|m{1,4}[-/ .]y{2,4})/i.test(fmtClean(fmt));
const epoch=(date1904)=>Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30);
const fmtInt=new Intl.NumberFormat("en-US",{maximumFractionDigits:9});
export function displayGridValue(v,fmt="General",date1904=false) {
  if(v==null)return ""; if(typeof v==="boolean") return v?"TRUE":"FALSE"; if(typeof v!=="number")return v;
  const s=fmtClean(fmt.split(";")[0]);
  if(isDate(s)&&Number.isFinite(v)) {
    const dt=new Date(epoch(date1904)+v*864e5);
    return Number.isFinite(dt.getTime())?dt.toISOString().slice(0,10):"";
  }
  if(/^general$/i.test(s)||s==="@"||s.includes("?/?")) return fmtInt.format(v);
  const decimals=(s.match(/\.([0#]+)/)?.[1]||"").length, hasPct=s.includes("%"), hasUSD=s.includes("$"), ratio=/(?<=[0#])\s*x/i.test(s);
  const curr=new Intl.NumberFormat("en-US",{style:hasPct?"percent":hasUSD?"currency":"decimal",currency:"USD",useGrouping:s.includes(",")||hasUSD,minimumFractionDigits:Math.min(decimals,8),maximumFractionDigits:Math.min(decimals,8)});
  const fp=curr.format(v), unit=s.match(/(?:[0#)]| +)( +(?:yrs|\/ SF|SF))$/i)?.[1]||""; return ratio?fp+"x":fp+unit;
}
export function editableText(cell,style,date1904=false) {
  if(!cell||cell.kind==="blank")return "";
  if(cell.kind==="formula")return "="+cell.formula;
  if(typeof cell.value==="number") {
    if(isDate(style?.numFmt||"")) return displayGridValue(cell.value,style.numFmt,date1904);
    if(style?.numFmt.includes("%")) return `${Number((cell.value*100).toPrecision(14))}%`;
  }
  return cell.value==null?"":String(cell.value);
}
export function makeGridEdit(raw,style={},date1904=false) {
  if(raw.length>4096)throw new Error("Keep a cell under 4,096 characters.");
  const t=raw.trim(); if(!t)return {kind:"blank",value:null};
  if(t[0]==="="&&t.length>1)return {kind:"formula",formula:t.slice(1),value:null};
  if(raw.startsWith("'"))return {kind:"text",value:raw.slice(1)};
  if(/^(true|false)$/i.test(t)) return {kind:"bool",value:t.toLowerCase()==="true"};
  if(isDate(style.numFmt||"")&&/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d=Date.parse(t+"T00:00:00Z"); if(Number.isFinite(d)&&new Date(d).toISOString().slice(0,10)===t)return {kind:"number",value:(d-epoch(date1904))/864e5};
  }
  const n=t.replace(/^\(([\s\S]+)\)$/, "-$1").replace(/[$,\s]/g, "");
  if(style.numFmt!=="@"&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?%?$/.test(n)) {
    const v=Number(n.replace(/%$/,""))/(n.endsWith("%")||style.numFmt?.includes("%")?100:1);
    if(!Number.isFinite(v))throw new Error("That number is out of range."); return {kind:"number",value:v};
  }
  return {kind:"text",value:raw};
}
function setCell(doc,element,c,r) {
  for(const k of kids(element).filter(el=>["f","v","is"].includes(el.localName)))element.removeChild(k);
  element.removeAttribute("t");
  const append=(el,tag,str)=>{const n=doc.createElementNS(NS,tag);n.appendChild(doc.createTextNode(String(str)));el.appendChild(n);return n;};
  if(!c||c.kind==="blank")return;
  const formula=c.kind==="formula", value=formula?r?.value:c.value;
  if(formula)append(element,"f",c.formula);
  if(formula&&r?.error) {
    element.setAttribute("t","e"); append(element,"v",r.error==="#CIRC!"?"#VALUE!":r.error);
  } else if(typeof value==="number")append(element,"v",value);
  else if(typeof value==="boolean") {element.setAttribute("t","b");append(element,"v",+value);}
  else if(typeof value==="string") {
    if(formula) {element.setAttribute("t","str");append(element,"v",value);}
    else {element.setAttribute("t","inlineStr");const is=doc.createElementNS(NS,"is"); element.appendChild(is); append(is,"t",value).setAttributeNS("http://www.w3.org/XML/1998/namespace","xml:space","preserve");}
  }
}
export function exportGridBook(book,edits,results=recalculate(book,edits)) {
  if(!edits.size)return book.bytes;
  const parts={...book.parts}, serial=new XMLSerializer();
  for(const s of book.sheets) {
    const doc=xml(parts,s.path), data=child(doc.documentElement,"sheetData"), rows=new Map(kids(data,"row").map(r=>[+get(r,"r"),r]));
    const markup=new Map(desc(data,"c").map(r=>[get(r,"r"),r]));
    const changed=Array.from(edits.keys()).filter(k=>k.startsWith(s.name+"\u0000")).map(k=>k.split("\u0000")[1]);
    const all=new Set([...changed,...Array.from(s.cells).filter(([,c])=>c.kind==="formula").map(([a])=>a)]);
    for(const a of all) {
      const key=gridKey(s.name,a), c=edits.get(key)||s.cells.get(a); let node=markup.get(a);
      if(!node) {
        if(c?.kind==="blank")continue;
        const p=cellPosition(a); let row=rows.get(p.row);
        if(!row){row=doc.createElementNS(NS,"row");row.setAttribute("r",p.row);data.insertBefore(row,kids(data,"row").find(r=>+get(r,"r")>p.row)||null);rows.set(p.row,row);}
        node=doc.createElementNS(NS,"c");node.setAttribute("r",a);row.insertBefore(node,kids(row,"c").find(x=>cellPosition(get(x,"r")).col>p.col)||null);markup.set(a,node);
      }
      setCell(doc,node,c,results.get(key));
    }
    parts[s.path]=strToU8(serial.serializeToString(doc));
  }
  const doc=xml(parts,"xl/workbook.xml"), cp=child(doc.documentElement,"calcPr");
  if(cp) {cp.setAttribute("calcMode","auto");cp.setAttribute("fullCalcOnLoad","1");cp.setAttribute("forceFullCalc","1");}
  parts["xl/workbook.xml"]=strToU8(serial.serializeToString(doc));
  return zipSync(parts,{level:6});
}
