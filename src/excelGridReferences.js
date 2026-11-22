import {cellAddress,cellPosition,colLabel,colNumber} from './excelGridCalc.js';

export function moveIndex(index,{at,mode}) {
  if(mode==='insert')return index>=at?index+1:index;
  return index===at?null:index>at?index-1:index;
}
// References track cells, including absolute references. A deleted endpoint contracts a range.
function moveSpan(lo,hi,op,{retainStart=false,append=false}={}) {
  if(op.mode==='insert') {
    if(op.at<lo || op.at===lo&&!retainStart)return [lo+1,hi+1];
    if(op.at<=hi || append&&op.at===hi+1)return [lo,hi+1];
    return [lo,hi];
  }
  if(op.at<lo)return [lo-1,hi-1];
  if(op.at>hi)return [lo,hi];
  return lo===hi?null:[lo,hi-1];
}
export function moveRect(rect,op,options) {
  const [start,end]=op.axis==='row'?['r1','r2']:['c1','c2'];
  const next=moveSpan(rect[start],rect[end],op,options);
  return next?{...rect,[start]:next[0],[end]:next[1]}:null;
}
export function moveAddress(address,op) {
  const p=cellPosition(address); if(!p)return null;
  if(op.axis==='col')p.col=moveIndex(p.col,op);else p.row=moveIndex(p.row,op);
  return p.col==null||p.row==null?null:cellAddress(p.row,p.col);
}
const CELL_RX=/^(\$?)([A-Z]{1,3})(\$?)([1-9]\d{0,6})$/i;
const COL_RX=/^(\$?)([A-Z]{1,3})$/i;
const ROW_RX=/^(\$?)([1-9]\d{0,6})$/;
const CELL='\\$?[A-Z]{1,3}\\$?[1-9]\\d{0,6}', COL='\\$?[A-Z]{1,3}', ROW='\\$?[1-9]\\d{0,6}';
const scan=new RegExp(`"(?:[^"]|"")*"|([A-Z_][\\w.]*)\\[\\[#This Row\\],\\[([^\\]]+)\\]\\]|(?<![\\w.$!\\]])((?:'(?:[^']|'')*'|[A-Z_][\\w.]*)!)?(${CELL}(?:[ \\t]*:[ \\t]*${CELL})?|${COL}[ \\t]*:[ \\t]*${COL}|${ROW}[ \\t]*:[ \\t]*${ROW})(?![\\w.$\\[(])`, 'gi');
const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
function cellRef(a){const m=CELL_RX.exec(a); return m && {col:colNumber(m[2]),row:+m[4],cf:m[1],rf:m[3],lc:m[2]===m[2].toLowerCase()};}
function letters(n,lc) {const label=colLabel(n);return lc?label.toLowerCase():label;}
function renderRef(p){return p.cf+letters(p.col,p.lc)+p.rf+p.row;}
const columnRef=(a)=>{const m=COL_RX.exec(a);return m&&{index:colNumber(m[2]),abs:m[1],lc:m[2]===m[2].toLowerCase()};};
const rowRef=(a)=>{const m=ROW_RX.exec(a);return m&&{index:+m[2],abs:m[1]};};
function shiftPair(x,y,op) {const sp=moveSpan(Math.min(x,y),Math.max(x,y),op); return sp&& (x<=y?sp:sp.reverse());}
function shiftA1(ref,op) {
  const [a,b]=ref.split(':').map(s=>s.trim());
  const first=cellRef(a), second=b?cellRef(b):null, key=op.axis==='row'?'row':'col';
  if(first && first.col<=16384 && first.row<=1048576) {
    if(!b){first[key]=moveIndex(first[key],op);return first[key]==null?'#REF!':renderRef(first);}
    if(!second || second.col>16384 || second.row>1048576)return ref;
    const p=shiftPair(first[key],second[key],op); if(!p)return '#REF!';
    [first[key],second[key]]=p; return `${renderRef(first)}:${renderRef(second)}`;
  }
  if(b) {
    const a1=(op.axis==='row'?rowRef:columnRef)(a), b1=(op.axis==='row'?rowRef:columnRef)(b);
    if(!a1||!b1||Math.max(a1.index,b1.index)>(op.axis==='row'?1048576:16384))return ref;
    const p=shiftPair(a1.index,b1.index,op); if(!p)return '#REF!';
    const value=(n,v)=>v.abs+(op.axis==='row'?n:letters(n,v.lc));
    return `${value(p[0],a1)}:${value(p[1],b1)}`;
  }
  return ref;
}
function unquote(s) {return s[0]==="'"?s.slice(1,-1).replaceAll("''", "'"):s;}
export function shiftFormula(formula,sourceSheet,op,{tables=new Map(),address=null}={}) {
  return formula.replace(scan,(matched,tname,column,prefix,ref,offset,source)=>{
    if(matched[0]==='"')return matched;
    if(tname) {
      const t=tables.get(tname.toLowerCase()); if(!t)return matched;
      const i=t.headers.findIndex(x=>same(x.trim(),column.trim())); if(i<0)return matched;
      if(op.mode==='delete' && op.axis==='col' && t.c1+i===op.at)return '#REF!';
      if(!t.removed)return matched;
      const r=address&&cellPosition(address)?.row;
      if(!r||!same(t.sheet,sourceSheet)||r<t.r1||r>t.r2)return '#REF!';
      return moveAddress(cellAddress(r,t.c1+i),op)||'#REF!';
    }
    // A function called LOG10 or a cell-looking worksheet name is not a reference.
    if(!prefix && !ref.includes(':') && /^\s*[(!]/.test(source.slice(offset+matched.length)))return matched;
    const target=prefix?unquote(prefix.slice(0,-1)):sourceSheet;
    if(!same(target,op.sheet))return matched;
    const moved=shiftA1(ref,op);
    return moved==='#REF!'?moved:moved===ref?matched:(prefix||'')+moved;
  });
}
export const rectA1=({r1,c1,r2,c2})=>`${cellAddress(r1,c1)}:${cellAddress(r2,c2)}`;
export const rectAbs=({r1,c1,r2,c2})=>`$${colLabel(c1)}$${r1}:$${colLabel(c2)}$${r2}`;
