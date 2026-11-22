import test from 'node:test';
import assert from 'node:assert/strict';
import {shiftFormula,moveAddress,moveRect} from '../src/excelGridReferences.js';
import {recalculate,gridKey} from '../src/excelGridCalc.js';
const op=(axis,mode,at,sheet='Rent Roll')=>({axis,mode,at,sheet});
test('inserting before an absolute reference moves it across sheets',()=>{
  assert.equal(shiftFormula("SUM('Rent Roll'!$F$4:$F$61)+C21",'Pro Forma',op('col','insert',6)),"SUM('Rent Roll'!$G$4:$G$61)+C21");
  assert.equal(shiftFormula("'O''Brien'!B3+D6",'O’Brien',op('col','delete',2,"O'Brien")),"#REF!+D6");
});
test('ranges expand or shrink around edited rows, including reversed ranges',()=>{
  assert.equal(shiftFormula('SUM(F$61:F4)+COUNTIF($C:$C,0)+SUM($2:$30)','Rent Roll',op('row','insert',10)),'SUM(F$62:F4)+COUNTIF($C:$C,0)+SUM($2:$31)');
  assert.equal(shiftFormula('SUM(F4:F61)+F4','Rent Roll',op('row','delete',4)),'SUM(F4:F60)+#REF!');
  assert.equal(shiftFormula('SUM(F4:F4)','Rent Roll',op('row','delete',4)),'SUM(#REF!)');
  assert.equal(shiftFormula('SUM(F4:F61)+COUNTIF(C:C,0)','Rent Roll',op('row','insert',62)),'SUM(F4:F61)+COUNTIF(C:C,0)');
  assert.deepEqual(moveRect({r1:2,c1:2,r2:4,c2:3},op('col','insert',4),{retainStart:true,append:true}),{r1:2,c1:2,r2:4,c2:4});
  assert.equal(moveAddress('C3',op('col','delete',3)),null);
});
test('structured references, strings, and function names do not get mistaken for coordinates',()=>{
  const tables=new Map([['costs',{sheet:'Rent Roll',headers:['Line','Fees'],c1:2,r1:6,r2:38,removed:false}]]);
  const source='IF(A1="F4 or ""C3""",LOG10(100)+Costs[[#This Row],[Fees]],C3)';
  assert.equal(shiftFormula(source,'Rent Roll',op('col','insert',3),{tables,address:'D12'}),'IF(A1="F4 or ""C3""",LOG10(100)+Costs[[#This Row],[Fees]],D3)');
  assert.equal(shiftFormula(source,'Rent Roll',op('col','delete',3),{tables,address:'D12'}),'IF(A1="F4 or ""C3""",LOG10(100)+#REF!,#REF!)');
});
test('real Excel reference errors recalculate and can be handled deliberately',()=>{
  const cells=new Map([['A1',{kind:'number',value:17}],['A3',{kind:'formula',formula:'SUM($1:$2)'}],['A4',{kind:'formula',formula:'SUM(A1,#REF!)'}],['A5',{kind:'formula',formula:'IFERROR(A4,123)'}]]);
  const result=recalculate({sheets:[{name:'Sample',cells,maxRow:5,maxCol:1}]});
  assert.deepEqual(result.get(gridKey('Sample','A3')),{value:17});
  assert.deepEqual(result.get(gridKey('Sample','A4')),{error:'#REF!'});
  assert.deepEqual(result.get(gridKey('Sample','A5')),{value:123});
});
