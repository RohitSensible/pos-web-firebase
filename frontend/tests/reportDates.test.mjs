import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/pages/reportDates.ts', import.meta.url), 'utf8');
const moduleCode = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
new Function('exports', moduleCode)(exports);
const server = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('server.ts', server, ts.ScriptTarget.Latest, true);
const declarations = tree.statements.filter(n => ts.isFunctionDeclaration(n) && ['datesBetween','readReportDays'].includes(n.name?.text)).map(n => n.getText(tree));
const helpers = ts.transpileModule(declarations.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
const { datesBetween, readReportDays } = new Function(`${helpers}; return { datesBetween, readReportDays };`)();
test('UI and API accept complete multi-month, year and leap-year date ranges', () => {
  for (const [start, end, count] of [['2026-01-01','2026-03-31',90], ['2024-01-01','2024-12-31',366], ['2026-12-31','2027-01-01',2], ['2026-10-01','2026-10-31',31], ['2026-10-01','2026-10-01',1]]) {
    assert.equal(exports.reportDateError(start,end),'');
    const days=datesBetween(start,end);
    assert.equal(days.length,count); assert.equal(days[0],start); assert.equal(days.at(-1),end);
    assert.equal(new Set(days).size,days.length);
  }
});
test('invalid and reversed date ranges remain rejected', () => {
  for (const [start,end] of [['2026-02-30','2026-03-01'],['2026-02-01','2026-02-30'],['2026-03-01','2026-02-01'],['','2026-01-01'],['not-a-date','2026-01-01']]) {
    assert.ok(exports.reportDateError(start,end)); assert.deepEqual(datesBetween(start,end),[]);
  }
});
test('long reports read every requested date once with bounded concurrent queries', async () => {
  const days=datesBetween('2026-01-01','2026-03-31');
  const read=[]; let pending=0,peak=0;
  const result=await readReportDays(days,async day=>{ read.push(day); pending++; peak=Math.max(peak,pending); await new Promise(resolve=>setTimeout(resolve,1)); pending--;return day; });
  assert.deepEqual(result,days); assert.deepEqual(read,days); assert.ok(peak<=16 && peak>1);
});
