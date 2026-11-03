import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ExcelJS from 'exceljs';
import { ProductWiseReportPage } from '../src/pages/ProductWiseReportPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(check: () => unknown, message: string) {
  for (let i = 0; i < 200; i++) { if (check()) return; await pause(); }
  throw new Error(message);
}
for (const name of ['XMLHttpRequest', 'WebSocket', 'Worker', 'SharedWorker']) {
  Object.defineProperty(window, name, { configurable: true, value: () => { throw new Error('Unexpected network activity'); } });
}
const product = (productId: string, code: string, name: string, quantity: number, amount: number) => ({
  productId, code, name, quantity, amount, category: 'Food', billCount: 2, averageRate: 10.125, share: 12.345,
  taxBreakdown: [{ rate: 5, quantity, amount, taxableValue: 17.123, taxAmount: 0.876 }],
});
const products = [product('b', '10', 'Apple', 2, 25.125), product('z', '2', 'Zebra', -1.25, -12.5),
  product('a', '10', 'Apple', 2, 25.125), product('c', '', 'Cherry', 0, 0), product('d', '3', 'Dates', 5.75, 25.125)];
const data = { products, summary: { totalProducts: 5, totalBills: 7, totalQuantity: 8.5, totalAmount: 62.875, totalTax: 4.38 } };
type Read = { signal: AbortSignal; url: URL; done: boolean; resolve: (data: unknown, status?: number) => void };
const reads: Read[] = [];
window.fetch = (input, init) => new Promise<Response>(resolve => {
  const read: Read = { signal: init!.signal!, url: new URL(String(input), location.origin), done: false,
    resolve(value, status = 200) { read.done = true; resolve(Response.json({ data: value, message: 'Please try again.' }, { status })); } };
  reads.push(read); // Ignore cancellation deliberately to exercise late-response guards.
});
const pending = () => reads.filter(read => !read.done);
let root = createRoot(document.getElementById('root')!);
let outlet = 'one'; let token = 'first'; let expired = 0;
const render = () => flushSync(() => root.render(<ProductWiseReportPage outlet={{ id: outlet, name: outlet } as OutletSummary} token={token} onSessionExpired={() => { expired++; }} />));
const button = (text: string) => [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === text)!;
const exportButton = () => document.querySelector<HTMLButtonElement>('.bill-report-actions button')!;
const printButton = () => document.querySelector<HTMLButtonElement>('.bill-report-actions button:last-child')!;
const order = () => [...document.querySelectorAll('tbody tr')].map(row => row.children[1].textContent).join(',');
const totals = () => document.querySelector('.bill-summary-grid')!.textContent;
const sort = async (value: string) => { const select = document.querySelector<HTMLSelectElement>('#product-sales-sort')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); await pause(); };
const emptyScope = (message: string) => assert(!document.querySelector('tbody tr') && document.querySelector('.bill-summary-grid strong')?.textContent === '0' && exportButton().disabled && printButton().disabled, message);
async function load(value: unknown = data) {
  await until(() => pending().length > 0, 'Missing report read'); pending().at(-1)!.resolve(value);
  await until(() => !document.querySelector('[data-inline-loading]'), 'Report did not settle');
}
let downloads = 0; let prints = 0;
HTMLAnchorElement.prototype.click = function () { downloads++; };
window.print = () => { prints++; };
URL.createObjectURL = () => 'blob:mock'; URL.revokeObjectURL = () => {};
const workbooks: ExcelJS.Workbook[] = []; const finish: (() => void)[] = [];
const xlsxPrototype = Object.getPrototypeOf(new ExcelJS.Workbook().xlsx);
xlsxPrototype.writeBuffer = function (this: { workbook: ExcelJS.Workbook }) {
  workbooks.push(this.workbook);
  return new Promise<ArrayBuffer>(resolve => finish.push(() => resolve(new ArrayBuffer(0))));
};
async function startExport() { exportButton().click(); await until(() => finish.length > 0, 'Missing workbook'); }
void (async () => {
  render(); emptyScope('Initial pending report blocks output'); await load();
  assert(order() === 'Zebra,Dates,Apple,Apple,Cherry', 'Default order uses numeric codes and missing codes last');
  const before = totals(); const count = reads.length;
  for (const [mode, expected, ids] of [
    ['name', 'Apple,Apple,Cherry,Dates,Zebra', ['a', 'b', 'c', 'd', 'z']],
    ['quantity', 'Dates,Apple,Apple,Cherry,Zebra', ['d', 'a', 'b', 'c', 'z']],
    ['amount', 'Dates,Apple,Apple,Cherry,Zebra', ['d', 'a', 'b', 'c', 'z']],
    ['code', 'Zebra,Dates,Apple,Apple,Cherry', ['z', 'd', 'a', 'b', 'c']],
  ] as const) {
    await sort(mode); assert(order() === expected, `${mode} order preserves returns and zero rows`);
    assert(totals() === before && reads.length === count, `${mode} changes no totals or GETs`);
    await startExport();
    const sheet = workbooks.at(-1)!.worksheets[0];
    ids.forEach((id, index) => {
      const expectedProduct = products.find(item => item.productId === id)!;
      const row = sheet.getRow(33 + index);
      assert(JSON.stringify(row.values) === JSON.stringify([, expectedProduct.code, expectedProduct.name, 'Food', '5%', expectedProduct.quantity, expectedProduct.amount, 0.876, 0]), `${mode} export preserves exact values and deterministic code/ID ties for ${id}`);
    });
    assert(sheet.getCell('B7').value === 62.875 && sheet.getCell('B8').value === 4.38 && sheet.getCell('E38').value === 8.5 && sheet.getCell('F38').value === 62.875, `${mode} export preserves exact totals`);
    assert(sheet.getCell('B19').value === 85.61500000000001 && sheet.getCell('B20').value === 4.38, `${mode} export preserves tax breakdown summary`);
    finish.shift()!(); await until(() => !exportButton().disabled, 'Export did not finish');
  }
  printButton().click(); assert(prints === 1, 'Ready current scope can print');
  await startExport(); outlet = 'two'; render(); emptyScope('Outlet render immediately removes stale rows, totals and output');
  finish.shift()!(); await load(); await pause(); assert(downloads === 4, 'Outlet change cancels pending workbook download');
  button('Refresh').click(); await until(() => pending().length > 0, 'Refresh missing'); emptyScope('Refresh hides previous totals and blocks output');
  pending().at(-1)!.resolve(null, 503); await until(() => button('Retry'), 'Retry missing'); emptyScope('Failed refresh cannot retain stale data or output');
  button('Retry').click(); await load(); assert(!exportButton().disabled, 'Retry restores the current report');

  await startExport();
  const input = document.querySelector<HTMLInputElement>('.bill-search-filter input')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'missing');
  input.dispatchEvent(new Event('input', { bubbles: true })); await pause(); button('Apply').click();
  await until(() => pending().length > 0, 'Search request missing'); emptyScope('Applied search hides old data and output');
  assert(pending().at(-1)!.url.searchParams.get('search') === 'missing', 'Applied search reaches the report read');
  finish.shift()!(); await pause(); assert(downloads === 4, 'Applied search aborts pending workbook');
  await load({ products: [], summary: { totalProducts: 0, totalBills: 0, totalQuantity: 0, totalAmount: 0 } });
  emptyScope('Empty filtered report blocks output'); button('Clear filters').click(); await load();
  await sort('name'); assert((document.querySelector('.bill-search-filter input') as HTMLInputElement).value === '', 'Clear filters resets the search');
  assert(reads.at(-1)!.url.searchParams.get('search') === null, 'Cleared filter read omits search');
  const appliedUrl = reads.at(-1)!.url.search; const appliedCount = reads.length;
  await sort('amount'); assert(reads.length === appliedCount && reads.at(-1)!.url.search === appliedUrl, 'Sort retains applied dates and search');

  button('Refresh').click(); await until(() => pending().length > 0, 'Late read missing'); const late = pending().at(-1)!;
  token = 'second'; render(); assert(late.signal.aborted, 'Token change aborts old report read');
  late.resolve(null, 401); await load(); await pause(); assert(expired === 0, 'Ignored late authentication failure cannot expire current session');
  button('Refresh').click(); await until(() => pending().length > 0, 'Old success read missing');
  const oldSuccess = pending().at(-1)!; outlet = 'three'; render();
  oldSuccess.resolve({ ...data, products: [product('old', '1', 'Old outlet only', 999, 999)] });
  await pause(); emptyScope('Late successful old outlet response cannot restore stale data'); await load();
  await startExport(); button('Refresh').click(); await until(() => pending().length > 0, 'Workbook refresh missing');
  finish.shift()!(); await load(); await pause(); assert(downloads === 4, 'Refresh aborts pending workbook');
  await startExport(); token = 'third'; render(); finish.shift()!(); await load(); await pause(); assert(downloads === 4, 'Token change aborts pending workbook');
  await startExport(); flushSync(() => root.unmount()); finish.shift()!(); await pause(); assert(downloads === 4, 'Unmount aborts pending workbook');
  root = createRoot(document.getElementById('root')!);
  render(); await until(() => pending().length > 0, 'Remount read missing'); pending().at(-1)!.resolve(null, 401);
  await until(() => expired === 1, 'Current session expiry missing'); emptyScope('Current authentication failure blocks output and preserves session expiry callback');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
