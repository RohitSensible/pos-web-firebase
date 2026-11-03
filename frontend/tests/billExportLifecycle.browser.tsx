import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ExcelJS from 'exceljs';
import { BillWiseReportPage } from '../src/pages/BillWiseReportPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(check: () => unknown, message: string) {
  for (let i = 0; i < 250; i++) { if (check()) return; await pause(); }
  throw new Error(message);
}
const bill = (page: number) => ({ documentId: `id-${page}`, billNo: `B-${page}`, serialNo: '', billType: 'Sale', dayId: '2026-11-03',
  createdDate: page * 1000, finalTotal: 104.75, taxAmount: 5, discount: 0.25, serviceChargeAmount: 0, roundOff: 0,
  shiftId: '', deviceId: '', table: '', vehicleNo: '', remark: '', customerDetails: '', employee: '',
  payments: { cash: 104.75 }, paymentModes: ['cash'], items: [{ name: `Item ${page}`, quantity: 2, price: 50, total: 100, taxPercentage: 5, remark: '' }] });
const report = (page = 1, totalPages = 9) => ({ bills: [bill(page)], summary: { totalBills: totalPages, totalAmount: totalPages * 104.75, cashTotal: totalPages * 104.75, digitalTotal: 0 },
  pagination: { page, pageSize: 1, totalItems: totalPages, totalPages } });
const gst = (count = 9) => ({ bills: Array.from({ length: count }, (_, index) => ({ ...bill(index + 1), gross: 999,
  items: [{ quantity: 2, rate: 5, taxable: 100, cgst: 2.5, sgst: 2.5, gst: 5 }] })) });
type Read = { url: URL; signal: AbortSignal; done: boolean; resolve: (data: unknown, status?: number) => void };
const reads: Read[] = [];
window.fetch = (input, init) => new Promise<Response>(resolve => {
  const read: Read = { url: new URL(String(input), location.origin), signal: init!.signal!, done: false,
    resolve(data, status = 200) { read.done = true; resolve(Response.json({ data, message: status === 503 ? 'Export unavailable' : undefined }, { status })); } };
  // Deliberately ignore abort: the page must reject late results itself.
  reads.push(read);
});
const pending = () => reads.filter(read => !read.done);
const root = createRoot(document.getElementById('root')!);
let currentOutlet = 'one';
let token = 'first';
let expired = 0;
function render() { flushSync(() => root.render(<BillWiseReportPage outlet={{ id: currentOutlet, name: currentOutlet } as OutletSummary} token={token} onSessionExpired={() => { expired++; }} />)); }
const exportButton = () => document.querySelector<HTMLButtonElement>('.bill-report-actions button')!;
function clickText(text: string) { const button = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === text); if (!button) throw new Error(`Missing ${text}`); button.click(); }
let downloads = 0;
HTMLAnchorElement.prototype.click = function () { downloads++; };
window.print = () => { throw new Error('Unexpected print'); };
URL.createObjectURL = () => 'blob:mock';
URL.revokeObjectURL = () => {};
const workbooks: ExcelJS.Workbook[] = [];
const finishWorkbook: (() => void)[] = [];
const xlsxPrototype = Object.getPrototypeOf(new ExcelJS.Workbook().xlsx);
xlsxPrototype.writeBuffer = function (this: { workbook: ExcelJS.Workbook }) {
  workbooks.push(this.workbook);
  return new Promise<ArrayBuffer>(resolve => finishWorkbook.push(() => resolve(new ArrayBuffer(0))));
};
async function loadList(totalPages = 9) {
  await until(() => pending().some(read => read.url.pathname.endsWith('/bills')), 'List request missing');
  const read = pending().find(read => read.url.pathname.endsWith('/bills'))!;
  read.resolve(report(Number(read.url.searchParams.get('page')), totalPages));
  await until(() => document.querySelector('.bill-table-scroll tbody tr'), 'List missing');
}
async function reachGst(totalPages = 1) {
  exportButton().click();
  await until(() => pending().length === 1, 'Export page missing');
  pending()[0].resolve(report(1, totalPages));
  await until(() => pending().some(read => read.url.pathname.endsWith('/gst')), 'GST missing');
  return pending().find(read => read.url.pathname.endsWith('/gst'))!;
}
void (async () => {
  render();
  assert(exportButton().disabled, 'Export disabled until current list is ready');
  await loadList();
  const row = document.querySelector<HTMLTableRowElement>('tbody tr')!;
  row.click();
  await until(() => document.querySelector<HTMLDialogElement>('dialog')?.open, 'Drawer missing');
  assert(document.activeElement?.getAttribute('aria-label') === 'Close bill details', 'Native drawer focuses the close action');
  currentOutlet = 'two'; render();
  assert(!document.querySelector('dialog') && !document.querySelector('tbody tr'), 'Outlet render immediately removes old rows and selected bill');
  assert(document.querySelector('.bill-summary-grid strong')?.textContent === '0', 'Outlet render immediately clears old totals');
  await loadList();

  // Same event turn bypasses React's disabled update; the synchronous job guard must win.
  exportButton().click(); exportButton().click();
  await until(() => pending().length > 0, 'Export did not start');
  assert(pending().length === 1, 'Duplicate export clicks create only one first-page read');
  const firstExport = pending()[0]; firstExport.resolve(report());
  await until(() => pending().length === 4, 'Expected four page workers');
  assert(pending().every(read => read.signal === firstExport.signal), 'All page workers share the export AbortSignal');
  const pages = pending().map(read => Number(read.url.searchParams.get('page')));
  assert(pages.join(',') === '2,3,4,5', 'Page reads are bounded to four outstanding GETs');
  document.querySelector<HTMLButtonElement>('.bill-pagination button:last-child')!.click();
  await until(() => pending().some(read => read.signal !== firstExport.signal), 'Paging list request missing');
  assert(!firstExport.signal.aborted, 'Paging preserves a valid export');
  assert(!document.querySelector('tbody tr') && document.querySelector('.bill-summary-grid strong')?.textContent === '0', 'Paging clears old rows and totals while loading');
  pending().find(read => read.signal !== firstExport.signal)!.resolve(report(2));
  await until(() => document.querySelector('.bill-table-scroll tbody tr'), 'Second page missing');
  let peak = 0;
  while (!pending().some(read => read.url.pathname.endsWith('/gst'))) {
    const active = pending(); peak = Math.max(peak, active.length);
    assert(active.length <= 4, 'Outstanding export page reads stay bounded');
    // Complete in reverse order to verify deterministic output ordering.
    for (const read of active.reverse()) read.resolve(report(Number(read.url.searchParams.get('page'))));
    await pause();
  }
  assert(peak === 4, 'Export uses the four available page workers');
  const gstRead = pending()[0];
  assert(gstRead.signal === firstExport.signal && gstRead.url.pathname.includes('/two/'), 'GST uses captured outlet and export signal');
  gstRead.resolve(gst());
  await until(() => finishWorkbook.length === 1, 'Workbook generation missing');
  const sheet = workbooks[0].worksheets[0];
  assert(sheet.getCell('B7').value === 942.75 && sheet.getCell('B8').value === 45, 'Successful export preserves API sale and tax totals');
  assert(sheet.getCell('B33').value === 'B-1' && sheet.getCell('B41').value === 'B-9', 'Concurrent results retain page and bill order');
  assert(sheet.getCell('S42').value === 942.75 && sheet.getCell('E42').value === 900, 'GST total row preserves sales gross and calculated GST taxable values');
  finishWorkbook.shift()!();
  await until(() => downloads === 1 && !exportButton().disabled, 'Successful download missing');

  const lateGst = await reachGst();
  clickText('Refresh report');
  await until(() => lateGst.signal.aborted, 'Refresh did not abort GST');
  lateGst.resolve(gst(1)); await loadList(1); await pause();
  assert(downloads === 1 && workbooks.length === 1, 'Ignored GST abort cannot generate or download a stale workbook');

  const workbookGst = await reachGst(); workbookGst.resolve(gst(1));
  await until(() => finishWorkbook.length === 1, 'Delayed workbook missing');
  token = 'replacement'; render();
  assert(workbookGst.signal.aborted && exportButton().disabled, 'Token change aborts workbook-stage export and clears actions immediately');
  finishWorkbook.shift()!(); await loadList(1); await pause();
  assert(downloads === 1, 'Workbook completion after scope change cannot click download');

  exportButton().click(); await until(() => pending().length === 1, 'Failure export missing');
  pending()[0].resolve(null, 503);
  await until(() => document.querySelector('[role="alert"]')?.textContent?.includes('Export unavailable'), 'Export failure missing');
  assert(!!document.querySelector('tbody tr') && !exportButton().disabled, 'Export failure leaves the valid list and retry controls available');
  clickText('Retry export'); await until(() => pending().length === 1, 'Explicit retry missing');
  const abandoned = pending()[0];
  const select = document.querySelector('select')!;
  select.value = 'cash'; select.dispatchEvent(new Event('change', { bubbles: true })); await pause(); clickText('Apply');
  await until(() => abandoned.signal.aborted, 'Applied filters did not abort export');
  abandoned.resolve(report(1, 1)); await loadList(1); await pause();
  assert(downloads === 1, 'Late page response after applied filter change cannot download');

  exportButton().click(); await until(() => pending().length === 1, 'Old outlet export missing');
  const oldOutlet = pending()[0];
  currentOutlet = 'three'; render();
  assert(oldOutlet.signal.aborted && !document.querySelector('tbody tr'), 'Outlet change aborts export and clears the old list');
  oldOutlet.resolve(null, 401); await loadList(1); await pause();
  assert(downloads === 1 && expired === 0, 'Late old-outlet authentication failure cannot expire the current session');

  clickText('Refresh report');
  await until(() => pending().length === 1, 'Refresh list missing');
  pending()[0].resolve(null, 503);
  await until(() => document.querySelector('.bill-report-state.error'), 'List failure missing');
  await pause();
  assert(pending().length === 0 && exportButton().disabled && !document.querySelector('tbody tr'), 'List failure has no auto retry or stale actions');
  clickText('Retry'); await loadList(1);
  const unmountGst = await reachGst();
  flushSync(() => root.unmount());
  assert(unmountGst.signal.aborted, 'Unmount aborts pending GST reads');
  unmountGst.resolve(gst(1)); await pause();
  assert(downloads === 1 && expired === 0, 'Unmounted export has no download or session side effects');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
