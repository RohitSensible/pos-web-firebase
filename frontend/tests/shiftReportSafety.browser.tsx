import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ExcelJS from 'exceljs';
import { ShiftSummaryReportPage, monthDateRange } from '../src/pages/ShiftSummaryReportPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';

const checks: string[] = [];
const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(check: () => unknown, label: string) {
  for (let i = 0; i < 200; i++) { if (check()) return; await pause(); }
  throw new Error(label);
}
const zero = Object.fromEntries(['billDeletesNumber', 'billDeletesAmount', 'discount', 'gstTotal', 'vatTotal', 'refundAmount', 'extraCharges', 'serviceChargeAmount', 'roundOff', 'expDigital', 'advanceAmtTotal', 'customerReceiveAmtTotal', 'receiveAmtTotal', 'swiggyTotal', 'zomatoTotal'].map(key => [key, 0]));
const report = (id = 'current', total = 123.45) => ({ shifts: [{ ...zero, id, dayId: '2026-11-01', shiftNo: 1, deviceId: 'device', inActive: false, startTime: 1000, endTime: 0, lastBillTime: 2000, startBillNo: '001', lastBillNo: '002', billCount: 2, openingAmt: 10, cashSale: 75, digitalSale: 25, creditSale: 23.45, totalSale: total, subTotalBill: 120, tax: 3.45, expCash: 5, expensesAmtTotal: 5, payments: { cash: 75, card: 25, credit: 23.45 } }], summary: { totalShifts: 1, totalBills: 2, totalSale: total, cashSale: 75, digitalSale: 25, creditSale: 23.45, expenses: 5 } });
type Read = { url: URL; signal: AbortSignal; resolve: (response: Response) => void };
const reads: Read[] = [];
window.fetch = (input, init) => new Promise<Response>(resolve => reads.push({ url: new URL(String(input), location.origin), signal: init!.signal!, resolve }));
const realTimeout = window.setTimeout.bind(window);
let timeout: (() => void) | undefined;
window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
  if (delay === 20_000 && typeof handler === 'function') { timeout = () => handler(...args); return realTimeout(() => {}, 60_000); }
  return realTimeout(handler, delay, ...args);
}) as typeof window.setTimeout;
const root = createRoot(document.getElementById('root')!);
let outletId = 'one'; let token = 'first'; let expired = 0;
const render = () => flushSync(() => root.render(<ShiftSummaryReportPage outlet={{ id: outletId, name: outletId } as OutletSummary} token={token} onSessionExpired={() => { expired++; }} />));
const click = (text: string) => { const button = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === text); if (!button) throw new Error(`Missing ${text}`); flushSync(() => button.click()); };
const output = () => [...document.querySelectorAll<HTMLButtonElement>('.bill-report-actions button')].find(button => button.textContent?.includes('Export'))!;
const row = () => document.querySelector<HTMLTableRowElement>('tbody tr');
const refresh = () => flushSync(() => document.querySelector<HTMLButtonElement>('[aria-label="Refresh shifts"]')!.click());
const input = (placeholder: string, value: string) => {
  const element = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!;
  flushSync(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
};
async function nextRead() { await until(() => reads.length, 'Read missing'); return reads.shift()!; }
async function load(id = 'current') { (await nextRead()).resolve(Response.json({ data: report(id) })); await until(row, 'Rows missing'); }
let downloads = 0;
HTMLAnchorElement.prototype.click = () => { downloads++; };
URL.createObjectURL = () => 'blob:mock'; URL.revokeObjectURL = () => {};
const books: ExcelJS.Workbook[] = [];
const finish: Array<(fail?: boolean) => void> = [];
Object.getPrototypeOf(new ExcelJS.Workbook().xlsx).writeBuffer = function (this: { workbook: ExcelJS.Workbook }) {
  books.push(this.workbook);
  return new Promise<ArrayBuffer>((resolve, reject) => finish.push(fail => fail ? reject(new Error('Workbook unavailable')) : resolve(new ArrayBuffer(0))));
};
void (async () => {
  for (const [month, end] of [['0004-02', '0004-02-29'], ['0001-02', '0001-02-28'], ['0100-02', '0100-02-28'], ['2000-02', '2000-02-29'], ['9999-12', '9999-12-31']]) {
    assert(monthDateRange(month).endDate === end, `Calendar month ${month} uses correct last day`);
  }
  for (const month of ['0000-02', '10000-01', '2026-13', '2026-1', 'bad']) assert(monthDateRange(month).startDate === '', `Invalid month ${month} is rejected`);
  render(); const oldOutlet = await nextRead();
  outletId = 'two'; render();
  assert(oldOutlet.signal.aborted && output().disabled && !row(), 'Outlet scope cancels the old read and disables output');
  oldOutlet.resolve(new Response('', { status: 401 })); await load(); await pause();
  refresh(); const abandonedSuccess = await nextRead();
  outletId = 'three'; render(); abandonedSuccess.resolve(Response.json({ data: report('old-outlet', 999) }));
  await pause(); assert(!row() && output().disabled, 'Late old outlet success cannot restore rows or enable export');
  await load();
  assert(expired === 0, 'Late old outlet 401 does not expire current session');
  assert(document.querySelector('tfoot td:last-child')?.textContent?.includes('123.45'), 'API financial totals survive');
  flushSync(() => row()!.click()); await until(() => document.querySelector('[role="dialog"]'), 'Details missing');
  refresh(); assert(!row() && !document.querySelector('.bill-detail-modal') && output().disabled, 'Refresh immediately clears stale rows and details');
  assert(document.querySelector('.bill-summary-grid strong')?.textContent === '0 · 0', 'Refresh clears stale totals');
  const bodyRead = await nextRead(); let body!: (value: unknown) => void;
  bodyRead.resolve({ ok: true, status: 200, json: () => new Promise(resolve => { body = resolve; }) } as Response);
  await until(() => body, 'Body not started');
  document.querySelector<HTMLButtonElement>('.report-date-trigger')!.click(); await pause();
  document.querySelector<HTMLButtonElement>('[aria-label="February"]')!.click(); await pause(); click('Apply');
  const monthRead = await nextRead();
  assert(monthRead.url.searchParams.get('startDate')?.endsWith('-02-01'), 'Applied month scopes the request');
  body({ data: report('late-body', 999) }); await pause();
  assert(!row() && output().disabled, 'Late old-month response body cannot restore stale data');
  monthRead.resolve(Response.json({ data: report() })); await until(row, 'Month rows missing');
  for (const value of ['0', '-1', '1.2', '1e2', '2x', '9007199254740992']) {
    input('All shifts', value); click('Apply'); await pause();
    assert(reads.length === 0 && !!row() && !output().disabled, `Invalid shift ${value} makes no GET and preserves applied report`);
  }
  input('All shifts', ' 0002 '); input('All devices', '  till  '); click('Apply');
  const valid = await nextRead();
  assert(valid.url.searchParams.get('shiftNo') === '2' && valid.url.searchParams.get('deviceId') === 'till', 'Valid whole shift and trimmed device sent');
  valid.resolve(Response.json({ data: report() })); await until(row, 'Valid filter rows missing');
  output().click(); output().click(); await until(() => finish.length, 'Workbook missing');
  assert(books.length === 1, 'Synchronous duplicate exports produce one workbook');
  const sheet = books[0].worksheets[0];
  assert(sheet.getCell('B7').value === 123.45 && sheet.getCell('B8').value === 3.45 && sheet.getCell('P33').value === 80, 'Workbook preserves sale, tax and cash drawer amounts');
  token = 'replacement'; render(); finish.shift()!(); await load(); await pause();
  assert(downloads === 0, 'Token scope cancels a pending workbook download');
  output().click(); await until(() => finish.length, 'Failure workbook missing'); finish.shift()!(true);
  await until(() => document.querySelector('[role="alert"]')?.textContent?.includes('Workbook unavailable'), 'Export failure missing');
  assert(!!row() && !output().disabled, 'Export error preserves valid report and retry');
  refresh(); const timed = await nextRead(); timeout!();
  await until(() => document.querySelector('.bill-report-state.error'), 'Timeout missing');
  assert(timed.signal.aborted && output().disabled, '20 second timeout aborts and blocks output');
  timed.resolve(Response.json({ data: report('too-late') })); await pause();
  assert(!row(), 'Success after timeout is ignored');
  click('Retry'); await load('recovered');
  assert(row()?.textContent?.includes('recovered'), 'Explicit retry recovers after timeout');
  refresh(); (await nextRead()).resolve(Response.json({ message: 'Read unavailable' }, { status: 503 }));
  await until(() => document.querySelector('.bill-report-state.error'), 'Read error missing');
  assert(output().disabled && !row(), 'Read failure blocks stale export and rows');
  click('Retry'); const abandonedError = await nextRead();
  refresh(); abandonedError.resolve(Response.json({ message: 'Old error' }, { status: 503 })); await pause();
  assert(!document.querySelector('.bill-report-state.error') && output().disabled, 'Late old errors cannot replace current loading state');
  (await nextRead()).resolve(Response.json({ data: { shifts: [], summary: report().summary } }));
  await until(() => document.querySelector('.bill-report-state')?.textContent?.includes('No shifts'), 'Empty missing');
  assert(output().disabled && [...document.querySelectorAll<HTMLButtonElement>('.bill-report-actions button')].find(button => button.textContent?.includes('Print'))!.disabled, 'Empty report blocks export and print');
  click('Reset filters'); await load(); output().click(); await until(() => finish.length, 'Unmount workbook missing');
  flushSync(() => root.unmount()); finish.shift()!(); await pause();
  assert(downloads === 0 && expired === 0, 'Unmount cancels downloads and session side effects');
  window.setTimeout = realTimeout;
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { window.setTimeout = realTimeout; document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
