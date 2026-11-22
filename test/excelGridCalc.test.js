import test from "node:test";
import assert from "node:assert/strict";
import { recalculate,gridKey } from "../src/excelGridCalc.js";
const num=(value)=>({kind:"number",value}), fx=(formula)=>({kind:"formula",formula});
const s=(name,cells)=>({name,maxRow:20,cells:new Map(Object.entries(cells)),hiddenRows:new Set()});
const build=()=>({sheets:[s("Example",{A1:num(12),A2:num(8),B3:fx("A1+A2"),C3:fx("'Other Tab'!D4"),D3:fx("120*(1+5%)"),E3:fx("1/0"),F3:fx("F3+1"),H3:fx("SUM(A1:A2)")}),s("Other Tab",{A2:num(1),B2:num(25),A3:num(1),B3:num(15),C2:fx('SUMIF(A2:A3,"1",B2:B3)'),D4:fx("C2+Example!B3"),E4:fx("C2*Costs[[#This Row],[Fees]]"),B4:num(.10)})],tables:[{name:"Costs",sheet:"Other Tab",r1:1,r2:5,c1:2,headers:["Fees"]}]});
test("A1+A2 and sums work, including across tabs, and edits do not alter master",()=>{
 const book=build(), a=recalculate(book), edit=new Map([[gridKey("Example","A1"),num(30)]]), b=recalculate(book,edit);
 const lookup=(out,s,k)=>out.get(gridKey(s,k)).value;
 assert.equal(lookup(a,"Example","B3"),20);
 assert.equal(lookup(b,"Example","B3"),38);
 assert.equal(lookup(b,"Example","H3"),38);
 assert.equal(lookup(b,"Example","C3"),78);
 assert.equal(lookup(a,"Other Tab","E4"),4);
 assert.equal(lookup(a,"Example","D3"),126);
 assert.equal(lookup(recalculate(book),"Example","B3"),20);
});
test("new formulas recalculate and errors are not hidden",()=>{
 const b=build(); const vals=recalculate(b,new Map([[gridKey("Example","B3"),fx("SUM(A1:A2)*2")]]));
 assert.deepEqual(vals.get(gridKey("Example","B3")),{value:40});
 assert.deepEqual(vals.get(gridKey("Example","E3")),{error:"#DIV/0!"});
 assert.deepEqual(vals.get(gridKey("Example","F3")),{error:"#CIRC!"});
});
