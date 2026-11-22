import assert from "node:assert/strict";
import { test } from "node:test";
import { isMasterDescriptor, workbookBytes, MAX_BYTES, WORKBOOK_FILENAME } from "../src/excelUnderwriting.js";
const synthetic = Buffer.from([0x50,0x4b,3,4,10,20,30,40,50]);
test("owner and valid bytes are required", () => {
  assert.equal(isMasterDescriptor({ owner_id:"a", byte_count:32 }, "a"), true);
  for (const row of [null, {owner_id:"b",byte_count:32},{owner_id:"a",byte_count:"32"},{owner_id:"a",byte_count:MAX_BYTES+1}]) {
    assert.equal(isMasterDescriptor(row,"a"), false);
  }
  assert.equal(isMasterDescriptor({owner_id:"a",byte_count:10},null),false);
});
test("download exposes exact original bytes in a generic editable .xlsx", () => {
  assert.equal(WORKBOOK_FILENAME,"Development-Pro-Forma.xlsx");
  assert.deepEqual(Buffer.from(workbookBytes(synthetic.toString("base64"),synthetic.length)),synthetic);
  assert.throws(() => workbookBytes("YWFhYQ==",4));
  assert.throws(() => workbookBytes(synthetic.toString("base64"),synthetic.length+1));
  assert.throws(() => workbookBytes(synthetic.toString("base64").replace("A","?"),synthetic.length));
});
