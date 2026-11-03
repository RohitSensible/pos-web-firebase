import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { dashboardShiftStatus } from '../../shared/shiftStatus.ts';

// Exercise the page's real presentation/export functions with a mocked download.
// No React mount, API, workbook download or service connection is needed here.
const source = readFileSync(new URL('../src/pages/ShiftSummaryReportPage.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('ShiftSummaryReportPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helpers = tree.statements.filter(node => ts.isFunctionDeclaration(node)
  && ['dateTime', 'endLabel', 'cashInHand', 'monthDateRange'].includes(node.name?.text)).map(node => node.getText(tree).replace(/^export\s+/, '')).join('\n');
let exportDeclaration;
function findExport(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'exportExcel') exportDeclaration = node.getText(tree);
  ts.forEachChild(node, findExport);
}
findExport(tree);
assert.ok(exportDeclaration, 'The report export handler exists');
const compiled = ts.transpileModule(`${helpers}\nconst ${exportDeclaration};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
}).outputText;

function presentation(shifts = []) {
  let downloaded;
  const report = { shifts, summary: { totalSale: 100, cashSale: 75, digitalSale: 25, creditSale: 0 } };
  const functions = new Function('dashboardShiftStatus', 'report', 'downloadReportExcel', 'sumPayments', 'outlet', 'reportName', 'appliedFilters', 'canOutput', 'exportJob', 'scope', 'currentScope', 'setExportScope', 'setExportFailure',
    `${compiled}\nreturn { endLabel, dateTime, exportExcel };`)(
    dashboardShiftStatus, report, async value => { downloaded = value; }, () => ({}),
    { id: 'mock-outlet', name: 'Mock Outlet' }, 'Shift Summary Report', { month: '2020-01' }, true, { current: null }, null, { current: null }, () => {}, value => { if (value) throw new Error(value.message); },
  );
  return { ...functions, download: () => downloaded };
}

const timestamp = Date.UTC(2020, 0, 1, 8);
const cases = [
  { inActive: false, endTime: 0, status: 'Active', end: 'In progress' },
  { inActive: true, endTime: 0, status: 'Closed', end: 'Not Available' },
  { inActive: false, endTime: timestamp, status: 'Active' },
  { inActive: true, endTime: timestamp, status: 'Closed' },
];

for (const dayId of ['2020-01-01', new Date().toISOString().slice(0, 10)]) {
  for (const fixture of cases) {
    test(`${dayId}: inactive=${fixture.inActive}, end=${fixture.endTime} keeps authoritative status and truthful end`, () => {
      const shift = { ...fixture, dayId, lastBillTime: timestamp + 3_600_000 };
      const { endLabel, dateTime } = presentation();
      assert.equal(dashboardShiftStatus(shift), fixture.status);
      assert.equal(endLabel(shift), fixture.end ?? dateTime(timestamp));
      assert.ok(!endLabel(shift).includes('Last bill'));
    });
  }
}

test('Excel uses the same statuses and missing-end labels while preserving real timestamp cells', async () => {
  const shifts = cases.map((fixture, index) => ({
    ...fixture, dayId: '2020-01-01', shiftNo: index + 1, startTime: timestamp - 3_600_000,
    lastBillTime: timestamp + 3_600_000, startBillNo: '1', lastBillNo: '2', billCount: 2,
    openingAmt: 10, cashSale: 75, expCash: 5, totalSale: 100, digitalSale: 25,
    creditSale: 0, discount: 0, tax: 0, expensesAmtTotal: 5,
  }));
  const page = presentation(shifts);
  await page.exportExcel();
  const exported = page.download();
  assert.deepEqual(exported.rows.slice(1).map(row => row[2]), cases.map(fixture => fixture.status));
  assert.deepEqual(exported.rows.slice(1).map(row => row[4]), ['In progress', 'Not Available', new Date(timestamp), new Date(timestamp)]);
  assert.ok(exported.rows.slice(1).every(row => row[3] instanceof Date && row[15] === 80 && row[16] === 100));
  assert.equal(exported.summary['TOTAL SALE'], 100);
  assert.equal(exported.startDate, '2020-01-01');
  assert.equal(exported.endDate, '2020-01-31');
});
