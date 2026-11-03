import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createDashboardWorkbook, downloadDashboardExcel } from '../src/utils/dashboardExcel.ts';

const shift = (id, extra = {}) => ({
  id, dayId: '2026-11-03', shiftNo: 1, inActive: true,
  startTime: Date.parse('2026-11-03T08:00:00Z'), endTime: Date.parse('2026-11-03T09:00:00Z'),
  startBillNo: '000', lastBillNo: '005', billCount: 5, openingAmt: 100,
  totalSale: 123.45, cashSale: 80, digitalSale: 33.45, creditSale: 10, expCash: 5,
  payments: {}, ...extra,
});
const options = data => ({
  outlet: { name: 'Test Outlet', branch: '' }, dayId: '2026-11-03',
  cashier: 'Export Operator', terminal: 'Workspace', now: new Date('2026-11-03T12:00:00Z'), data,
});
const roundTrip = async workbook => {
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
  return loaded;
};
const summary = sheet => {
  const rows = new Map();
  sheet.eachRow(row => rows.set(row.getCell(1).value, row.getCell(2).value));
  return rows;
};

test('serialized individual shifts keep duplicate numbers, creators, devices, dates and numeric totals', async () => {
  const first = shift('a', { creatorName: '=SUM(A1:A2)', userId: 'user-a', deviceId: 'device-a',
    startBillNo: 0, lastBillNo: 0, payments: { cash: 0 }, inActive: false });
  const second = shift('b', { creatorName: 'Bea', userId: 'user-b', deviceId: 'device-b',
    startTime: first.startTime + 3600000, endTime: 0, totalSale: 200.15 });
  const third = shift('c', { shiftNo: 2, creatorName: 'Cee', deviceId: 'device-c',
    startTime: second.startTime, inActive: false, endTime: 0, totalSale: 1.01 });
  const input = options({ ...third, shifts: [third, second, first] });
  const before = structuredClone(input);
  const book = await roundTrip(await createDashboardWorkbook(input));
  assert.deepEqual(input, before);
  assert.deepEqual(book.worksheets.map(sheet => sheet.name), ['Dashboard', 'Shift Details']);
  const sheet = book.getWorksheet('Shift Details');
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['Day ID', 'Shift No.', 'Created By',
    'Creator User ID', 'Device ID', 'Started At (UTC)', 'Ended At (UTC)', 'Status', 'Start Bill', 'Last Bill', 'Bills', 'Total Sale']);
  assert.equal(sheet.rowCount, 4);
  assert.deepEqual([2, 3, 4].map(row => sheet.getCell(row, 5).value), ['device-a', 'device-b', 'device-c']);
  assert.deepEqual([2, 3, 4].map(row => sheet.getCell(row, 2).value), [1, 1, 2]);
  assert.equal(sheet.getCell('C2').value, first.creatorName);
  assert.equal(sheet.getCell('C2').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('D2').value, 'user-a');
  assert.equal(sheet.getCell('D3').value, 'user-b');
  assert.equal(sheet.getCell('F2').value.getTime(), first.startTime);
  assert.equal(sheet.getCell('G2').value.getTime(), first.endTime);
  assert.equal(sheet.getCell('H2').value, 'Active', 'inActive governs status even with an end time');
  assert.equal(sheet.getCell('G3').value, 'Not Available');
  assert.equal(sheet.getCell('H3').value, 'Closed');
  assert.equal(sheet.getCell('G4').value, 'In progress');
  assert.equal(sheet.getCell('I2').value, 0);
  assert.equal(sheet.getCell('J2').value, 0);
  assert.equal(sheet.getCell('K2').value, 5);
  assert.equal(sheet.getCell('L2').value, 123.45);
  assert.equal(sheet.getCell('F2').numFmt, 'dd mmm yyyy hh:mm:ss');
  assert.equal(sheet.getCell('L2').numFmt, '#,##0.00;[Red]-#,##0.00');
  assert.equal(sheet.getCell('C2').alignment.wrapText, true);
  assert.equal(sheet.views[0].ySplit, 1);
  assert.equal(sheet.pageSetup.orientation, 'landscape');
  assert.equal(sheet.pageSetup.printTitlesRow, '1:1');
  const totals = summary(book.worksheets[0]);
  assert.equal(totals.get('Exported By'), 'Export Operator');
  assert.equal(totals.get('Total Sale'), 123.45 + 200.15 + 1.01);
  assert.equal(totals.get('Cash In Hand'), 100 + 240 - 15);
  assert.equal(totals.get('Cash'), 160, 'zero payment and per-shift fallback preserved');
  assert.equal(totals.get('Credit'), 30);
  assert.equal(totals.get('No. of Bills'), 15);
  assert.equal(totals.get('Opening Balance'), 100);
});

test('sorting uses id to resolve identical starts and shift numbers without modifying input', async () => {
  const book = await createDashboardWorkbook(options({ ...shift('legacy'), shifts: [
    shift('z', { deviceId: 'z' }), shift('a', { deviceId: 'a' }),
  ] }));
  const sheet = book.getWorksheet('Shift Details');
  assert.equal(sheet.getCell('E2').value, 'a');
  assert.equal(sheet.getCell('E3').value, 'z');
});

test('missing and invalid individual metadata stays unavailable and never uses export operator', async () => {
  const records = [NaN, Infinity, -Infinity, 8640000000000001, 253402300800000, -2208988800001, 0, undefined]
    .map((value, index) => shift(String(index), { startTime: value, endTime: value,
      creatorName: ' ', userId: undefined, deviceId: undefined, startBillNo: '', lastBillNo: undefined,
      billCount: NaN, totalSale: Infinity }));
  const book = await roundTrip(await createDashboardWorkbook(options({ ...shift('legacy'), shifts: records })));
  const sheet = book.getWorksheet('Shift Details');
  for (let row = 2; row <= sheet.rowCount; row++) {
    for (const column of [3, 4, 5, 6, 7]) assert.equal(sheet.getCell(row, column).value, 'Not Available');
    for (const column of [9, 10, 11, 12]) assert.equal(sheet.getCell(row, column).value, '—');
  }
});

test('legacy aggregate and empty shift arrays do not fabricate individual records or creators', async () => {
  for (const shifts of [undefined, []]) {
    const data = shift('legacy', { shifts, creatorName: 'Aggregate Name', userId: 'aggregate-user' });
    const book = await roundTrip(await createDashboardWorkbook(options(data)));
    const sheet = book.getWorksheet('Shift Details');
    assert.equal(sheet.rowCount, 2);
    assert.equal(sheet.getCell('A2').value, 'Individual shift records are not available.');
    assert.equal(summary(book.worksheets[0]).get('Total Sale'), 123.45);
    assert.ok(!JSON.stringify(sheet.model).includes('Aggregate Name'));
    assert.ok(!JSON.stringify(sheet.model).includes('Export Operator'));
  }
});

test('pre-aborted exports stop before workbook creation or browser download', async () => {
  const controller = new AbortController(); controller.abort();
  const input = { ...options(shift('a')), signal: controller.signal };
  await assert.rejects(createDashboardWorkbook(input), { name: 'AbortError' });
  await assert.rejects(downloadDashboardExcel(input), { name: 'AbortError' });
});

test('cancellation while serializing and just before click never clicks or leaks an object URL', async () => {
  const original = { document: globalThis.document, window: globalThis.window,
    create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const xlsxPrototype = Object.getPrototypeOf(new ExcelJS.Workbook().xlsx);
  const writeBuffer = xlsxPrototype.writeBuffer;
  try {
    for (const phase of ['buffer', 'url', 'anchor']) {
      const controller = new AbortController();
      const created = []; const revoked = []; let clicks = 0;
      xlsxPrototype.writeBuffer = async function (...args) {
        const buffer = await writeBuffer.apply(this, args);
        if (phase === 'buffer') controller.abort();
        return buffer;
      };
      URL.createObjectURL = () => {
        created.push('blob:test');
        if (phase === 'url') controller.abort();
        return 'blob:test';
      };
      URL.revokeObjectURL = url => revoked.push(url);
      globalThis.window = { setTimeout: callback => callback() };
      globalThis.document = { createElement: () => {
        if (phase === 'anchor') controller.abort();
        return { click() { clicks++; } };
      } };
      await assert.rejects(downloadDashboardExcel({ ...options(shift('a')), signal: controller.signal }), { name: 'AbortError' });
      assert.equal(clicks, 0, phase);
      assert.deepEqual(created, phase === 'buffer' ? [] : ['blob:test']);
      assert.deepEqual(revoked, created, phase);
    }
  } finally {
    xlsxPrototype.writeBuffer = writeBuffer;
    URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke;
    if (original.document === undefined) delete globalThis.document; else globalThis.document = original.document;
    if (original.window === undefined) delete globalThis.window; else globalThis.window = original.window;
  }
});
