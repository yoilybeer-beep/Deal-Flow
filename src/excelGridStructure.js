import {strToU8,zipSync} from 'fflate';
import {cellAddress,cellPosition,rangePosition,recalculate} from './excelGridCalc.js';
import {NS,REL,child,desc,get,kids,relationships,xml,setCell,loadGridBook,exportGridBook} from './excelGridBook.js';
import {moveAddress,moveIndex,moveRect,rectA1,rectAbs,shiftFormula} from './excelGridReferences.js';

const colsLimit=128, rowsLimit=768;
const remove=(n)=>n?.parentNode?.removeChild(n);
const lower=(s)=>s.toLowerCase();
const relId=(n)=>n.getAttributeNS(REL,'id')||get(n,'r:id');
const relPart=(path)=>path.replace(/([^/]+)$/,'_rels/$1.rels');
const merged=(r)=>r.r1!==r.r2||r.c1!==r.c2;
const visibleOptions={retainStart:true,append:true};
function rangeMove(value,op,options) {return moveRect(rangePosition(value),op,options);}
function replaceRange(n,k,op,options) {
  const ref=get(n,k); if(!ref)return true;
  const moved=rangeMove(ref,op,options); if(!moved)return false;
  n.setAttribute(k,merged(moved)?rectA1(moved):cellAddress(moved.r1,moved.c1));return true;
}
function pointOrNearest(s,op) {
  const a=cellPosition(s); if(!a)return s;
  return moveAddress(s,op)||cellAddress(op.axis==='row'?op.at:a.row,op.axis==='col'?op.at:a.col);
}
function makeHeader(doc,a,name) {
  const p=cellPosition(a), parent=child(doc.documentElement,'sheetData');
  let row=kids(parent,'row').find(r=>+get(r,'r')===p.row);
  if(!row){row=doc.createElementNS(NS,'row');row.setAttribute('r',p.row);parent.insertBefore(row,kids(parent,'row').find(r=>+get(r,'r')>p.row)||null);}
  let c=kids(row,'c').find(n=>get(n,'r')===a);
  if(!c) {
    c=doc.createElementNS(NS,'c'); c.setAttribute('r',a);
    const peer=kids(row,'c').find(n=>cellPosition(get(n,'r')).col>=p.col)||null;
    if(peer&&get(peer,'s'))c.setAttribute('s',get(peer,'s'));
    row.insertBefore(c,peer);
  }
  setCell(doc,c,{kind:'text',value:name});
}
function moveViews(root,op) {
  for(const v of desc(child(root,'sheetViews'),'sheetView')) {
    if(get(v,'topLeftCell'))v.setAttribute('topLeftCell',pointOrNearest(get(v,'topLeftCell'),op));
    const pane=child(v,'pane');
    if(pane) {
      const ax=op.axis==='row'?'ySplit':'xSplit', old=+get(pane,ax)||0;
      if(['frozen','frozenSplit'].includes(get(pane,'state'))) {
        const next=op.at<=old?old+(op.mode==='insert'?1:-1):old;
        if(next)pane.setAttribute(ax,next);else pane.removeAttribute(ax);
        const x=+get(pane,'xSplit')||0,y=+get(pane,'ySplit')||0;
        const oldCorner=cellPosition(get(pane,'topLeftCell'))||{row:1,col:1};
        const newCorner=cellPosition(pointOrNearest(cellAddress(oldCorner.row,oldCorner.col),op));
        if(op.mode==='insert' && oldCorner[op.axis==='row'?'row':'col']===old+1 && op.at===old+1)newCorner[op.axis==='row'?'row':'col']=op.at;
        if(x||y) {
          const active=y&&x?'bottomRight':y?'bottomLeft':'topRight';
          pane.setAttribute('activePane',active);pane.setAttribute('topLeftCell',cellAddress(Math.max(y+1,newCorner.row),Math.max(x+1,newCorner.col)));
          for(const s of kids(v,'selection')) {
            if(get(s,'activeCell')||get(s,'sqref'))s.setAttribute('pane',active);
            else if(get(s,'pane')===active||!x||!y)remove(s);
          }
        } else {remove(pane);const sels=kids(v,'selection');for(const sel of sels)if(get(sel,'activeCell')||sels.length===1)sel.removeAttribute('pane');else remove(sel);}
      } else if(get(pane,'topLeftCell'))pane.setAttribute('topLeftCell',pointOrNearest(get(pane,'topLeftCell'),op));
    }
    for(const s of kids(v,'selection')) {
      if(get(s,'activeCell'))s.setAttribute('activeCell',pointOrNearest(get(s,'activeCell'),op));
      if(get(s,'sqref')) {
        const ranges=get(s,'sqref').trim().split(/\s+/).map(r=>rangeMove(r,op)).filter(Boolean).map(r=>merged(r)?rectA1(r):cellAddress(r.r1,r.c1));
        s.setAttribute('sqref',ranges.join(' ')||get(s,'activeCell')||'A1');
      }
    }
  }
}
function moveGrid(doc,op) {
  const sheet=doc.documentElement, data=child(sheet,'sheetData');
  for(const row of kids(data,'row')) {
    const i=+get(row,'r'), moved=op.axis==='row'?moveIndex(i,op):i;
    if(moved==null){remove(row);continue;}
    if(moved!==i)row.setAttribute('r',moved);
    if(op.axis==='col')row.removeAttribute('spans');
    for(const cell of kids(row,'c')) {
      const a=get(cell,'r'), addr=moveAddress(a,op);
      if(addr==null)remove(cell);else if(addr!==a)cell.setAttribute('r',addr);
    }
  }
  const cols=child(sheet,'cols');
  if(op.axis==='col'&&cols) {
    for(const col of kids(cols,'col')) {
      const p=moveRect({c1:+get(col,'min'),c2:+get(col,'max')},op);
      if(!p)remove(col);else {col.setAttribute('min',p.c1);col.setAttribute('max',p.c2);}
    }
  }
  const groups=child(sheet,'mergeCells');
  if(groups) {
    for(const m of kids(groups,'mergeCell')) {
      const r=rangeMove(get(m,'ref'),op);if(!r||!merged(r))remove(m);else m.setAttribute('ref',rectA1(r));
    }
    const n=kids(groups,'mergeCell').length;
    if(n)groups.setAttribute('count',n);else remove(groups);
  }
  const dim=child(sheet,'dimension');if(dim)replaceRange(dim,'ref',op,visibleOptions);
  const filter=child(sheet,'autoFilter');if(filter&&!replaceRange(filter,'ref',op))remove(filter);
  moveViews(sheet,op);
}
function moveNotes(parts,from,op,write) {
  for(const n of relationships(parts,from)) {
    if(n.type==='comments') {
      const d=xml(parts,n.path);
      for(const note of desc(d,'comment')) {
        const p=moveAddress(get(note,'ref'),op);if(p)note.setAttribute('ref',p);else remove(note);
      }
      write(n.path,d);
    }
    if(n.type==='vmlDrawing') {
      const d=xml(parts,n.path);
      for(const shape of desc(d,'shape')) {
        const meta=desc(shape,'ClientData').find(q=>get(q,'ObjectType')==='Note');
        if(!meta)continue;
        const attach=desc(meta,op.axis==='row'?'Row':'Column')[0];if(!attach)continue;
        const shifted=moveIndex(+attach.textContent+1,op);
        if(!shifted){remove(shape);continue;}
        attach.textContent=String(shifted-1);
        const anchor=desc(meta,'Anchor')[0];
        if(anchor){const points=anchor.textContent.split(',').map(Number);if(points.length===8&&points.every(Number.isFinite)){for(const a of op.axis==='row'?[2,6]:[0,4])points[a]=(moveIndex(points[a]+1,op)??op.at)-1;anchor.textContent=points.join(', ');}}
      }
      write(n.path,d);
    }
  }
}
function unlinkTable(parts,sheetDoc,sheetRel,tableId,path,write) {
  const src=child(sheetDoc.documentElement,'tableParts');
  for(const p of kids(src,'tablePart'))if(relId(p)===tableId)remove(p);
  const n=kids(src,'tablePart').length; if(n)src.setAttribute('count',n);else remove(src);
  const rp=relPart(sheetRel); if(parts[rp]) {
    const rel=xml(parts,rp); for(const n of desc(rel,'Relationship'))if(get(n,'Id')===tableId)remove(n);write(rp,rel);
  }
  const c=xml(parts,'[Content_Types].xml'); for(const n of desc(c,'Override'))if(get(n,'PartName')==='/'+path)remove(n); write('[Content_Types].xml',c);
  delete parts[path];
}

// Repack only the deal copy. The original XLSX remains read-only and byte-identical.
export function changeGridStructure(book,edits,requested) {
  const {axis,mode,at}=requested;
  if(!['row','col'].includes(axis)||!['insert','delete'].includes(mode)||!Number.isInteger(at))throw new Error('Choose a spreadsheet row or column.');
  const sheet=book.sheets.find(s=>lower(s.name)===lower(requested.sheet));
  if(!sheet)throw new Error('That tab doesn’t exist.');
  const op={...requested,sheet:sheet.name}, lo=axis==='row'?'r1':'c1', hi=axis==='row'?'r2':'c2', limit=axis==='row'?rowsLimit:colsLimit;
  if(at<sheet.bounds[lo]||at>sheet.bounds[hi]+(mode==='insert'?1:0))throw new Error('Choose an existing row or column.');
  if(mode==='delete'&&sheet.bounds[lo]===sheet.bounds[hi])throw new Error('Keep at least one row and column on each tab.');
  if(mode==='insert'&&Math.max(sheet.bounds[hi],axis==='row'?sheet.maxRow:sheet.maxCol)>=limit)throw new Error('This tab has reached the editor’s size limit.');
  const working=edits.size?loadGridBook(exportGridBook(book,edits)):book;
  const parts={...working.parts}, ser=new XMLSerializer();
  const write=(path,d)=>{parts[path]=strToU8(ser.serializeToString(d));};
  const xmls=new Map(working.sheets.map(s=>[s.name,xml(parts,s.path)]));
  const target=xmls.get(sheet.name);
  // This master uses ordinary worksheet content, legacy notes and two Excel tables.
  for(const tag of ['drawing','pivotTableParts','conditionalFormatting','dataValidations','rowBreaks','colBreaks','oleObjects','controls','extLst'])
    if(child(target.documentElement,tag))throw new Error('This sheet has special Excel content. Make structural changes in Excel for this copy.');
  const tabPlans=new Map(), touchedTables=[];
  for(const owner of working.sheets)for(const r of relationships(parts,owner.path).filter(n=>n.type==='table')) {
    const table=xml(parts,r.path), root=table.documentElement, name=get(root,'name')||get(root,'displayName'), old=rangePosition(get(root,'ref'));
    const columns=child(root,'tableColumns'), entries=kids(columns,'tableColumn'), headers=entries.map(n=>get(n,'name'));
    const affected=owner.name===op.sheet, next=affected?moveRect(old,op):old;
    const headerCount=get(root,'headerRowCount')==='0'?0:1, totalCount=+get(root,'totalsRowCount')||0;
    const inCol=affected&&axis==='col'&&at>=old.c1&&at<=old.c2;
    const removeHeader=affected&&axis==='row'&&mode==='delete'&&headerCount&&at===old.r1;
    const removeTotal=affected&&axis==='row'&&mode==='delete'&&totalCount&&at===old.r2;
    const removed=!next||!!removeHeader||(next.r2-next.r1+1<=headerCount+(removeTotal?0:totalCount));
    if(affected)tabPlans.set(lower(name),{sheet:owner.name,...old,headers,removed});
    touchedTables.push({table,root,columns,entries,headers,old,next,removed,inCol,removeTotal,owner,r,affected});
  }
  // Rewrite all worksheets before addresses move: a formula’s old location resolves table row references.
  for(const s of working.sheets) {
    const d=xmls.get(s.name);
    for(const f of desc(child(d.documentElement,'sheetData'),'f')) {
      const text=f.textContent, moved=shiftFormula(text,s.name,op,{address:get(f.parentNode,'r'),tables:tabPlans});
      if(moved!==text)f.textContent=moved;
    }
    const links=child(d.documentElement,'hyperlinks');
    for(const link of kids(links,'hyperlink')) {
      if(s.name===op.sheet&&!replaceRange(link,'ref',op)){remove(link);continue;}
      const location=get(link,'location'); if(location) {
        const moved=shiftFormula(location,s.name,op);
        if(moved==='#REF!')remove(link);else if(moved!==location)link.setAttribute('location',moved);
      }
    }
    if(links&&!kids(links,'hyperlink').length)remove(links);
  }
  moveGrid(target,op);
  const added=[];
  for(const t of touchedTables) {
    if(t.removed) {unlinkTable(parts,xmls.get(t.owner.name),t.owner.path,t.r.id,t.r.path,write);continue;}
    if(t.affected) t.root.setAttribute('ref',rectA1(t.next));
    const headerRow=get(t.root,'headerRowCount')!=='0';
    const oldCol=t.inCol?at-t.old.c1:-1;
    if(t.inCol&&mode==='delete')remove(t.entries[oldCol]);
    if(t.inCol&&mode==='insert'&&at>t.old.c1) {
      const c=t.table.createElementNS(NS,'tableColumn'); let j=1; while(t.headers.some(s=>s.trim().toLowerCase()===`column${j}`))j++;
      const name=`Column${j}`;c.setAttribute('id',1+Math.max(...t.entries.map(n=>+get(n,'id')||0)));c.setAttribute('name',name);
      t.columns.insertBefore(c,t.entries[oldCol]||null);
      if(headerRow)added.push({addr:cellAddress(t.next.r1,at),name});
    }
    if(t.removeTotal) {
      t.root.setAttribute('totalsRowCount','0');t.root.setAttribute('totalsRowShown','0');
      for(const c of kids(t.columns,'tableColumn')){c.removeAttribute('totalsRowFunction');c.removeAttribute('totalsRowLabel');remove(child(c,'totalsRowFormula'));}
    }
    t.columns.setAttribute('count',kids(t.columns,'tableColumn').length);
    for(const rule of ['autoFilter','sortState']){const node=child(t.root,rule);if(t.affected&&node&&!replaceRange(node,'ref',op))remove(node);}
    for(const type of ['totalsRowFormula','calculatedColumnFormula'])for(const f of desc(t.root,type)) {
      const c=t.entries.indexOf(f.parentNode), addr=c<0?null:cellAddress(type==='totalsRowFormula'?t.old.r2:t.old.r1+1,t.old.c1+c);
      f.textContent=shiftFormula(f.textContent,t.owner.name,op,{address:addr,tables:tabPlans});
    }
    write(t.r.path,t.table);
  }
  for(const a of added)makeHeader(target,a.addr,a.name);
  for(const s of working.sheets)write(s.path,xmls.get(s.name));
  moveNotes(parts,sheet.path,op,write);
  const workbook=xml(parts,'xl/workbook.xml');
  for(const dn of desc(workbook,'definedName')) {
    const idx=get(dn,'localSheetId'), local=idx===''?'':working.sheets[+idx]?.name||'';
    if(get(dn,'name')==='_xlnm.Print_Area'&&local===sheet.name) {
      const moved=moveRect(sheet.bounds,op,visibleOptions); if(!moved)throw new Error('Keep at least one row and column on the tab.');
      dn.textContent=`'${sheet.name.replaceAll("'","''")}'!${rectAbs(moved)}`;
    } else dn.textContent=shiftFormula(dn.textContent,local,op);
  }
  write('xl/workbook.xml',workbook);
  const bytes=zipSync(parts,{level:5});
  return loadGridBook(bytes);
}

export function downloadStructuredBytes(book,edits,altered){return exportGridBook(book,edits,recalculate(book,edits),altered);}
