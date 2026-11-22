// Small, deterministic evaluator for the workbook's finance formulas. No JavaScript eval.
// Unsupported workbook formulas fail explicitly; originals are checked against Excel caches.
const CELL = /^([A-Z]{1,3})([1-9]\d{0,6})$/i;
const COL = /^[A-Z]{1,3}$/i;
const ROW = /^[1-9]\d{0,6}$/;
const FORMULA_CODES=new Set(["#DIV/0!","#VALUE!","#REF!","#NAME?","#NUM!","#N/A","#NULL!","#CIRC!"]);
const MAX_GRID = 768;
const MAX_COLS = 128;
const fail = (code) => { throw new Error(code); };
export const colNumber = (s) => [...s.toUpperCase()].reduce((n,c) => n*26 + c.charCodeAt(0)-64, 0);
export function colLabel(n) {
  let s=""; while (n>0) { const k=(n-1)%26; s=String.fromCharCode(65+k)+s; n=(n-1-k)/26; } return s;
}
export const cellAddress = (row,col) => colLabel(col)+row;
export function cellPosition(key) {
  const m=CELL.exec(key.replaceAll("$", ""));
  if (!m) return null;
  return {row:Number(m[2]), col:colNumber(m[1])};
}
export function rangePosition(ref) {
  const [a,b=a]=ref.split(":"); const s=cellPosition(a), e=cellPosition(b);
  if(!s || !e) throw new Error("Invalid spreadsheet range");
  return {r1:Math.min(s.row,e.row),r2:Math.max(s.row,e.row),c1:Math.min(s.col,e.col),c2:Math.max(s.col,e.col)};
}
const tokenPattern=/\s+|#(?:DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|NULL!)|\$[1-9]\d{0,6}|[A-Za-z_][\w.]*\[\[#This Row\],\[[^\]]+\]\]|'(?:[^']|'')*'|"(?:[^"]|"")*"|\$?[A-Za-z_][A-Za-z0-9_.]*\$?[0-9]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?|<>|<=|>=|[+\-*/^%(),:!=<> &]/iy;
const binary={"=":1,"<>":1,">":1,"<":1,">=":1,"<=":1,"&":2,"+":3,"-":3,"*":4,"/":4,"^":5};
export function compileFormula(input) {
  const source=input.replace(/^=/,"");
  if (source.length>4096) fail("#VALUE!");
  const tok=[]; let pos=0;
  while(pos<source.length) {
    tokenPattern.lastIndex=pos;
    const m=tokenPattern.exec(source); if(!m) fail("#NAME?");
    pos=tokenPattern.lastIndex; if(m[0].trim()) tok.push(m[0]);
    if(tok.length>900) fail("#VALUE!");
  }
  let i=0, depth=0;
  const peek=()=>tok[i]; const take=()=>tok[i++];
  const expects=(s)=>{if(take()!==s) fail("#VALUE!");};
  function pref() {
    const t=take(); if(!t) fail("#VALUE!");
    if(t==="-" || t==="+") return {tag:"unary",op:t,v:expr(6)};
    if(t==="(") { const v=expr(); expects(")"); return v; }
    if(t[0]==='"') return {tag:"val",v:t.slice(1,-1).replaceAll('""','"')};
    if(FORMULA_CODES.has(t.toUpperCase()))return {tag:"error",code:t.toUpperCase()};
    if(/^(?:\d|\.\d)/.test(t) && peek()!==":") return {tag:"val",v:Number(t)};
    const structured=/^([\w.]+)\[\[#This Row\],\[([^\]]+)\]\]$/i.exec(t);
    if(structured) return {tag:"struct",table:structured[1],column:structured[2]};
    if(peek()==="(") {
      take(); const args=[];
      if(peek()!==")") { while(true) { args.push(expr()); if(peek()!==",") break; take(); } }
      expects(")"); return {tag:"call",name:t.toUpperCase().replace(/^_XLFN\./,""),args};
    }
    if(peek()!=="!" && /^(true|false)$/i.test(t)) return {tag:"val",v:t.toUpperCase()==="TRUE"};
    let a=t, sheet=null;
    if(peek()==="!") { take(); sheet=t[0]==="'"?t.slice(1,-1).replaceAll("''","'"):t; a=take(); }
    if (!a) fail("#REF!");
    a=a.replaceAll("$", "").toUpperCase();
    let b=null;
    if(peek()===":") { take(); b=(take()||"").replaceAll("$","").toUpperCase(); }
    if(!CELL.test(a) && !(b && (COL.test(a)&&COL.test(b)||ROW.test(a)&&ROW.test(b)))) fail("#NAME?");
    if(b && !(CELL.test(a)&&CELL.test(b)||COL.test(a)&&COL.test(b)||ROW.test(a)&&ROW.test(b))) fail("#REF!");
    return {tag:"ref",sheet,a,b};
  }
  function expr(min=1) {
    if(++depth>100) fail("#VALUE!");
    let left=pref();
    while(peek()==="%") { take(); left={tag:"unary",op:"%",v:left}; }
    while(peek() && (binary[peek()]||0)>=min) {
      const op=take(), priority=binary[op];
      const right=expr(priority+1); left={tag:"math",op,left,right};
    }
    depth--; return left;
  }
  const parsed=expr(); if(i!==tok.length) fail("#VALUE!"); return parsed;
}
export const gridKey=(sheet,addr)=>sheet+"\u0000"+addr;
const numeric=(x)=>{
  if(x===null || x===undefined || x==="") return 0;
  if(typeof x==="boolean") return +x;
  if(typeof x==="number" && Number.isFinite(x)) return x;
  if(typeof x==="string" && x.trim() && Number.isFinite(Number(x))) return Number(x);
  return fail("#VALUE!");
};
const finite=(x)=>Number.isFinite(x)?x:fail("#NUM!");
const shown=(x)=>x==null?"":typeof x==="boolean"?(x?"TRUE":"FALSE"):String(x);
const comparable=(a,b,op)=> {
  if(a==null) a=typeof b==="string"?"":0;
  if(b==null) b=typeof a==="string"?"":0;
  if(typeof a==="string" && typeof b==="string") {a=a.toLowerCase(); b=b.toLowerCase();}
  switch(op) {case "=":return a===b; case "<>":return a!==b;case "<":return a<b;case ">":return a>b;case "<=":return a<=b;case ">=":return a>=b;}
};
function meets(x,crit) {
  if(typeof crit!=="string") return (x!==null && x!==undefined) && comparable(x,crit,"=");
  const m=/^(<>|<=|>=|<|>|=)?(.*)$/s.exec(crit.trim()), op=m[1]||"="; let goal=m[2];
  if(goal!=="" && Number.isFinite(Number(goal))) {
    if(x===null || x===undefined || x=== "") return false;
    if(typeof x==="string" && x.trim() && Number.isFinite(Number(x))) x=Number(x);
    return comparable(x,Number(goal),op);
  }
  if(typeof x==="string" && /[*?~]/.test(goal) && (op==="="||op==="<>")) {
    let s=""; for(let i=0;i<goal.length;i++) {
      const c=goal[i]; if(c==="~" && i+1<goal.length) s+=goal[++i].replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
      else if(c==="*") s+=".*"; else if(c==="?") s+="."; else s+=c.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    }
    const ok=new RegExp("^(?:"+s+")$","i").test(x); return op==="="?ok:!ok;
  }
  return comparable(x,goal,op);
}
function reference(book,sheet,a,b,limits) {
  const lookup=book.sheets.find(s=>s.name.toLowerCase()===sheet.toLowerCase()); if(!lookup) fail("#REF!");
  const p=cellPosition(a);
  let r;
  if(!p && b && COL.test(a) && COL.test(b)) r={c1:Math.min(colNumber(a),colNumber(b)),c2:Math.max(colNumber(a),colNumber(b)),r1:1,r2:Math.min(MAX_GRID,limits.get(lookup.name)?.row||MAX_GRID)};
  else if(!p && b && ROW.test(a) && ROW.test(b)) r={r1:Math.min(+a,+b),r2:Math.max(+a,+b),c1:1,c2:Math.min(MAX_COLS,limits.get(lookup.name)?.col||MAX_COLS)};
  else if(p && (!b || CELL.test(b))) r=rangePosition(a+(b?":"+b:""));
  else fail("#REF!");
  if(b && ((r.r2-r.r1+1)*(r.c2-r.c1+1)>MAX_GRID*MAX_COLS)) fail("#REF!");
  return {ref:true,sheet:lookup.name,...r};
}
export function recalculate(book, edits=new Map()) {
  const cache=new Map(), running=new Set(), parsed=new Map(), tableMap=new Map((book.tables||[]).map(t=>[t.name.toLowerCase(),t]));
  const sheetMap=new Map(book.sheets.map(s=>[s.name,s]));
  const limits=new Map(book.sheets.map(s=>[s.name,{row:Math.max(s.maxRow||1,s.bounds?.r2||1),col:Math.max(s.maxCol||1,s.bounds?.c2||1)}]));
  for(const key of edits.keys()) {
    const [s,a]=key.split("\u0000"), n=limits.get(s), p=cellPosition(a);if(n&&p){n.row=Math.max(n.row,p.row);n.col=Math.max(n.col,p.col);}
  }
  const assigned=(s,a)=>edits.get(gridKey(s,a))||sheetMap.get(s)?.cells.get(a)||null;
  function read(s,a) {
    const k=gridKey(s,a), c=assigned(s,a);
    if(!c) return null;
    if(c.kind==="error") fail(c.value||"#VALUE!");
    if(c.kind!=="formula") return c.kind==="blank"?null:(c.value??null);
    if(cache.has(k)) { const v=cache.get(k); if(v.error) fail(v.error); return v.value; }
    if(running.has(k)) fail("#CIRC!");
    running.add(k);
    try {
      const formula=c.formula; if(!parsed.has(formula)) parsed.set(formula,compileFormula(formula));
      const value=scalar(interpret(parsed.get(formula),s,a)); cache.set(k,{value}); return value;
    } catch(e) {const code=FORMULA_CODES.has(e.message)?e.message:"#VALUE!"; cache.set(k,{error:code}); fail(code);}
    finally { running.delete(k); }
  }
  function scalar(v) {return v?.ref?read(v.sheet,cellAddress(v.r1,v.c1)):v;}
  function* cells(r) {for(let j=r.r1;j<=r.r2;j++) for(let i=r.c1;i<=r.c2;i++) yield {s:r.sheet,a:cellAddress(j,i),r:j,c:i};}
  function values(v){return v?.ref?Array.from(cells(v),q=>read(q.s,q.a)):[v];}
  function interpret(n,s,a) {
    const go=(node)=>interpret(node,s,a);
    const val=(node)=>scalar(go(node));
    if(n.tag==="val") return n.v;
    if(n.tag==="error") return fail(n.code);
    if(n.tag==="ref") return reference(book,n.sheet||s,n.a,n.b,limits);
    if(n.tag==="struct") {
      const t=tableMap.get(n.table.toLowerCase()), p=cellPosition(a);
      const col=t?.headers.findIndex(h=>h.trim().toLowerCase()===n.column.trim().toLowerCase());
      if(!t||!p||col<0||p.row<t.r1||p.row>t.r2||t.sheet!==s) fail("#REF!");
      return reference(book,s,cellAddress(p.row,t.c1+col),null,limits);
    }
    if(n.tag==="unary"){const d=numeric(val(n.v)); return n.op==="%"?d/100:n.op==="-"?-d:d;}
    if(n.tag==="math") {
      const left=val(n.left), right=val(n.right);
      if(binary[n.op]===1) return comparable(left,right,n.op);
      if(n.op==="&") return shown(left)+shown(right);
      const x=numeric(left),y=numeric(right);
      if(n.op==="+" )return finite(x+y);if(n.op==="-") return finite(x-y);
      if(n.op==="*")return finite(x*y);if(n.op==="/") return y===0?fail("#DIV/0!"):finite(x/y);
      if(n.op==="^") return finite(x**y);
    }
    const f=n.name,args=n.args;
    if(f==="IF" || f==="IFERROR") {
      if(f==="IF") { const cond=val(args[0]);return cond?val(args[1]):args[2]?val(args[2]):false; }
      try{return val(args[0]);}catch{return val(args[1]);}
    }
    if(f==="COUNTIF" || f==="SUMIF") {
      const zone=go(args[0]), crit=val(args[1]);
      if(!zone?.ref) fail("#VALUE!");
      const target=args[2]?go(args[2]):zone;
      if(!target?.ref) fail("#VALUE!");
      let sum=0;
      for(const q of cells(zone)) if(meets(read(q.s,q.a),crit)) {
        if(f==="COUNTIF") sum++;
        else { const item=read(target.sheet,cellAddress(target.r1+q.r-zone.r1,target.c1+q.c-zone.c1)); if(typeof item==="number") sum+=item; }
      }
      return finite(sum);
    }
    if(f==="SUBTOTAL") {
      const mode=numeric(val(args[0])); if(mode!==9 && mode!==109) fail("#VALUE!");
      let z=0;
      for(const arg of args.slice(1)) {
        const r=go(arg); if(!r?.ref) fail("#VALUE!");
        for(const q of cells(r)) {
          if((mode===109 && sheetMap.get(q.s)?.hiddenRows?.has(q.r))||/\bSUBTOTAL\(/i.test(assigned(q.s,q.a)?.formula||"")) continue;
          const v=read(q.s,q.a); if(typeof v==="number") z+=v;
        }
      }
      return finite(z);
    }
    if(["SUM","AVERAGE","MIN","MAX","COUNT"].includes(f)) {
      const a=args.flatMap(v=>values(go(v))).filter(x=>typeof x==="number");
      if(f==="COUNT") return a.length;
      if(f==="SUM") return finite(a.reduce((i,j)=>i+j,0));
      if(f==="AVERAGE") return a.length?finite(a.reduce((i,j)=>i+j,0)/a.length):fail("#DIV/0!");
      if(f==="MAX" || f==="MIN") return a.length?Math[f.toLowerCase()](...a):0;
    }
    if(f==="ABS") return Math.abs(numeric(val(args[0])));
    if(f==="ROUND") { const x=numeric(val(args[0])), d=numeric(val(args[1])); const scale=10**Math.trunc(d); return finite(Math.sign(x)*Math.round(Math.abs(x)*scale+Number.EPSILON)/scale); }
    if(f==="PMT") {
      const [r,k,pv,fv=0,type=0]=args.map(x=>numeric(val(x))); if(k===0) fail("#DIV/0!");
      if(r===0) return finite(-(pv+fv)/k);
      const factor=(1+r)**k; return finite(-r*(pv*factor+fv)/((factor-1)*(1+r*type)));
    }
    return fail("#NAME?");
  }
  const output=new Map();
  for(const s of book.sheets) {
    const ids=new Set([...s.cells.keys(),...Array.from(edits.keys()).filter(k=>k.startsWith(s.name+"\u0000")).map(k=>k.split("\u0000")[1])]);
    for(const a of ids) {
      const original=assigned(s.name,a); if(!original || original.kind==="blank") continue;
      try{output.set(gridKey(s.name,a),{value:read(s.name,a)});}
      catch(e){output.set(gridKey(s.name,a),{error:FORMULA_CODES.has(e.message)?e.message:"#VALUE!"});}
    }
  }
  return output;
}
