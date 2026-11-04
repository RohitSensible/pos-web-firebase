import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useLayoutEffect, type ComponentType } from 'react';
import type ExcelJS from 'exceljs';
import { CategoryWiseReportPage } from '../src/pages/CategoryWiseReportPage.tsx';
import { GstReportPage } from '../src/pages/GstReportPage.tsx';
import { GstDaywiseReportPage } from '../src/pages/GstDaywiseReportPage.tsx';
import { DaywiseReportPage } from '../src/pages/DaywiseReportPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(check: () => unknown, message: string) {
  for (let i = 0; i < 160; i++) { if (check()) return; await pause(); }
  throw new Error(`${message}: writers=${writers.length} workbooks=${workbooks.length} downloads=${downloads} ${document.body.textContent?.slice(-1200)}`);
}
type Read = { url: URL; signal: AbortSignal; done: boolean; resolve: (response: Response) => void };
const reads: Read[] = [];
window.fetch = (input, init) => new Promise<Response>(resolve => {
  assert(!init?.method || init.method === 'GET', 'Only mocked GET reads allowed');
  reads.push({ url: new URL(String(input), location.origin), signal: init!.signal!, done: false, resolve(response) { this.done = true; resolve(response); } });
});
const pending = () => reads.filter(read => !read.done);
const realTimeout = window.setTimeout.bind(window);
const realClearTimeout = window.clearTimeout.bind(window);
const deadlines = new Map<number, () => void>();
let timerId = -1;
window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
  if (delay === 20_000) { const id = timerId--; deadlines.set(id, () => (handler as () => void)()); return id; }
  return realTimeout(handler, delay, ...args);
}) as typeof window.setTimeout;
window.clearTimeout = ((id?: number) => { if (id !== undefined && deadlines.delete(id)) return; realClearTimeout(id); }) as typeof window.clearTimeout;
let downloads = 0;
let prints = 0;
HTMLAnchorElement.prototype.click = () => { downloads++; };
window.print = () => { prints++; };
URL.createObjectURL = () => 'blob:remaining-report-test';
URL.revokeObjectURL = () => {};
const workbooks: ExcelJS.Workbook[] = [];
const writers: { resolve: () => void; reject: () => void }[] = [];
const now = new Date();
const dayId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const totals = { taxable: 100, cgst: 2.5, sgst: 2.5, igst: 0, gst: 5, gross: 105 };
const bill = (marker: string, day = dayId) => ({ documentId: marker, billNo: marker, serialNo: '', billType: 'Sale', dayId: day,
  createdDate: 1000, finalTotal: 104.75, taxAmount: 5, discount: 0.25, serviceChargeAmount: 0, roundOff: 0,
  shiftId: '', deviceId: '', table: '', vehicleNo: '', remark: '', customerDetails: '', employee: '',
  payments: { cash: 104.75 }, paymentModes: ['cash'], items: [{ name: marker, code: '1', quantity: 2, price: 50, total: 100, taxPercentage: 5, remark: '', rate: 5, ...totals }] });
function data(read: Read, marker: string, pages = 1) {
  if (read.url.pathname.endsWith('/categories')) return { categories: [{ categoryId: marker, categoryNo: 1, name: marker, billCount: 1, productCount: 1, quantity: 2, amount: 104.75, taxAmount: 5, taxRate: 5, share: 100,
    products: [{ productId: marker, name: `Product ${marker}`, quantity: 2, amount: 104.75, taxAmount: 5, taxRate: 5 }] }], summary: { totalCategories: 1, totalBills: 1, totalQuantity: 2, totalAmount: 104.75, totalTax: 5 } };
  if (read.url.pathname.endsWith('/gst')) return { summary: { ...totals, totalBills: 1, gstBills: 1 }, rates: [], bills: [{ ...bill(marker), ...totals, taxType: 'inclusive', rates: [5] }] };
  if (read.url.pathname.endsWith('/bills')) return { bills: [bill(marker, read.url.searchParams.get('startDate')!)], pagination: { totalPages: pages } };
  return { dayId: read.url.searchParams.get('dayId'), billCount: 1, totalSale: 104.75, tax: 5, cashSale: 104.75, digitalSale: 0, creditSale: 0, expensesAmtTotal: 0, payments: { cash: 104.75 }, openingAmt: 0, expCash: 0 };
}
function reply(read: Read, marker: string, status = 200) {
  read.resolve(Response.json({ data: data(read, marker), message: status === 503 ? 'Read unavailable' : undefined }, { status }));
}
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)!;
const unavailable = () => {
  assert(button('Export Excel').disabled && button('Print / PDF').disabled, 'Output disabled without current rows');
  assert(!document.querySelector('tbody tr, tfoot, [role="dialog"]'), 'No stale rows, totals or details before effects');
  assert(!document.querySelector('.bill-summary-grid')!.textContent!.includes('104.75'), 'No stale summary');
};
let probe: (() => void) | undefined;
type Props = { outlet: OutletSummary; token: string; onSessionExpired: () => void };
export function Fixture({ Page, outlet, token, onSessionExpired }: Props & { Page: ComponentType<Props> }) {
  useLayoutEffect(() => { probe?.(); });
  return <Page outlet={outlet} token={token} onSessionExpired={onSessionExpired} />;
}
let root = createRoot(document.getElementById('root')!);
let expired = 0;
let Page: ComponentType<Props>;
let outlet = 'A';
let token = 'one';
function render() { flushSync(() => root.render(<Fixture Page={Page} outlet={{ id: outlet, name: outlet } as OutletSummary} token={token} onSessionExpired={() => { expired++; }} />)); }
async function load(marker: string) {
  await until(() => pending().length > 0, 'Expected report request');
  pending().forEach(read => reply(read, marker));
  await until(() => !button('Export Excel').disabled, 'Expected successful current report');
}
async function workbook(marker: string) {
  await until(() => !button('Export Excel').disabled, 'Report ready for workbook');
  const count = writers.length;
  button('Export Excel').click(); button('Export Excel').click();
  if (Page === DaywiseReportPage) {
    await until(() => pending().length === 1, 'Daywise export GST read');
    reply(pending()[0]!, marker);
  }
  await until(() => writers.length === count + 1, 'Expected single workbook writer');
  await pause(); assert(writers.length === count + 1, 'Duplicate export guarded synchronously');
  return writers.shift()!;
}
void (async () => {
  const { default: ExcelJS } = await import('exceljs');
  Object.getPrototypeOf(new ExcelJS.Workbook().xlsx).writeBuffer = function (this: { workbook: ExcelJS.Workbook }) {
    workbooks.push(this.workbook);
    return new Promise<ArrayBuffer>((resolve, reject) => writers.push({ resolve: () => resolve(new ArrayBuffer(0)), reject: () => reject(new Error('Workbook unavailable')) }));
  };
  for (const [name, component] of [['Category', CategoryWiseReportPage], ['GST', GstReportPage], ['GST Day', GstDaywiseReportPage], ['Daywise', DaywiseReportPage]] as const) {
    Page = component; outlet = 'A'; token = 'one'; render(); unavailable(); await load('Initial');
    assert(!!document.querySelector('tbody tr') && document.body.textContent!.includes(Page === GstReportPage || Page === GstDaywiseReportPage ? '105.00' : '104.75'), `${name}: expected real rows and totals`);
    if (Page === GstReportPage || Page === DaywiseReportPage) {
      document.querySelector<HTMLTableRowElement>('tbody tr')!.click();
      await until(() => document.querySelector('[role="dialog"]'), 'Expected details');
    }
    outlet = 'B'; probe = unavailable; render(); probe = undefined;
    await until(() => pending().length > 0, 'B reads');
    const oldReads = [...pending()];
    let releaseBody: (() => void) | undefined;
    const bodyRead = oldReads.shift()!;
    let bodyStarted = false;
    bodyRead.resolve({ status: 200, ok: true, json: () => { bodyStarted = true; return new Promise(resolve => { releaseBody = () => resolve({ data: data(bodyRead, 'Late body') }); }); } } as Response);
    await until(() => bodyStarted, 'Controlled response body');
    outlet = 'C'; probe = unavailable; render(); probe = undefined;
    oldReads.forEach(read => reply(read, 'Late fetch', 401));
    releaseBody!();
    await load('Current'); await pause();
    assert(expired === 0 && !document.body.textContent!.includes('Late'), `${name}: late body/fetch/401 ignored`);
    token = 'two'; render(); await until(() => pending().length > 0, 'Old token read');
    const oldToken = [...pending()]; token = 'three'; render();
    oldToken.forEach(read => read.resolve(new Response('invalid JSON', { status: 401 })));
    await load('Current'); assert(expired === 0, `${name}: stale 401 silent`);

    button('Refresh').click(); await until(() => pending().length > 0, 'Refresh request');
    const failing = [...pending()]; failing.forEach(read => reply(read, '', 503));
    await until(() => document.querySelector('[role="alert"]'), 'Read failure'); unavailable();
    await pause(); assert(pending().length === 0, `${name}: no automatic retry`);
    button('Retry').click(); await load('Current');

    const failed = await workbook('Current'); failed.reject();
    await until(() => document.querySelector('[role="alert"]')?.textContent?.includes('Workbook unavailable'), 'Export failure');
    assert(!button('Export Excel').disabled && !!document.querySelector('tbody tr'), `${name}: export error retains valid data`);
    const completed = await workbook('Current');
    const sheet = workbooks.at(-1)!.worksheets[0]!;
    assert(sheet.getCell('B8').value === 5, `${name}: exact tax summary preserved`);
    assert(sheet.getCell('B7').value === (Page === GstReportPage || Page === GstDaywiseReportPage ? 105 : 104.75), `${name}: exact sale summary preserved`);
    const before = downloads; completed.resolve();
    await until(() => downloads === before + 1 && !button('Export Excel').disabled, 'Successful export');
    button('Print / PDF').click(); assert(prints > 0, 'Current report prints');
    if (Page === CategoryWiseReportPage || Page === GstReportPage) {
      const draftExport = await workbook('Current');
      const input = document.querySelector<HTMLInputElement>(Page === CategoryWiseReportPage ? 'input[placeholder="Category name"]' : 'input[placeholder="All shifts"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'draft');
      flushSync(() => input.dispatchEvent(new Event('input', { bubbles: true })));
      draftExport.resolve(); await pause();
      assert(downloads === before + 1, `${name}: editing draft cancels workbook`);
      button('Reset').click(); await pause();
      document.querySelector<HTMLButtonElement>('[aria-label^="From date:"]')!.click(); await pause();
      button('Clear').click(); await pause();
      const count = reads.length; button('Apply').click(); await pause();
      assert(reads.length === count && !!document.querySelector('[role="alert"]') && !!document.querySelector('tbody tr'), `${name}: invalid draft makes no read and retains valid report`);
      button('Reset').click(); await pause();
    }
    if (Page === GstDaywiseReportPage || Page === DaywiseReportPage) {
      const dateExport = await workbook('Current');
      document.querySelector<HTMLButtonElement>('[aria-label^="Report date:"]')!.click(); await pause();
      const date = document.querySelector<HTMLButtonElement>('[data-date]:not([aria-pressed="true"])')!;
      const chosen = date.dataset.date!;
      flushSync(() => date.click()); unavailable(); dateExport.resolve();
      await until(() => pending().length > 0, 'Changed date reads');
      assert(pending().every(read => (read.url.searchParams.get('dayId') ?? read.url.searchParams.get('startDate')) === chosen), 'Changed date captured consistently');
      await load('Current'); await pause(); assert(downloads === before + 1, `${name}: date change cancels workbook`);
      button('Today').click(); await load('Current');
    }
    const abandoned = await workbook('Current');
    token = 'four'; probe = unavailable; render(); probe = undefined; abandoned.resolve();
    await load('Current'); await pause(); assert(downloads === before + 1, `${name}: late workbook cannot download`);

    button('Refresh').click(); await until(() => pending().length > 0, 'Timeout read');
    const timedOut = [...pending()]; assert(deadlines.size === 1, 'One read deadline');
    [...deadlines.values()][0]!();
    await until(() => document.querySelector('[role="alert"]')?.textContent?.includes('too long'), 'Read timeout'); unavailable();
    timedOut.forEach(read => reply(read, 'Late timeout')); await pause(); unavailable();
    button('Retry').click(); await load('Current');
    if (Page === DaywiseReportPage) {
      button('Refresh').click(); await until(() => pending().length === 2, 'Joined summary and bills');
      const summary = pending().find(read => read.url.pathname.endsWith('/dashboard'))!;
      const first = pending().find(read => read.url.pathname.endsWith('/bills'))!;
      reply(summary, 'Current');
      first.resolve(Response.json({ data: data(first, 'First bill', 3) }));
      await until(() => pending().length === 1, 'Second bill page'); unavailable();
      const second = pending()[0]!;
      assert(second.url.searchParams.get('page') === '2', 'Second page requested in order'); reply(second, 'Second bill');
      await until(() => pending().length === 1, 'Third bill page'); unavailable();
      reply(pending()[0]!, 'Third bill');
      await until(() => !button('Export Excel').disabled, 'Atomic joined report');
      const names = [...document.querySelectorAll('.daywise-bills-card tbody tr')].map(row => row.textContent).join('|');
      assert(names.indexOf('First bill') < names.indexOf('Second bill') && names.indexOf('Second bill') < names.indexOf('Third bill'), 'All pages retain service order');
      button('Refresh').click(); await until(() => pending().length === 2, 'Missing-day join');
      pending().find(read => read.url.pathname.endsWith('/dashboard'))!.resolve(new Response('missing', { status: 404 }));
      reply(pending()[0]!, 'Recorded bill');
      await until(() => !button('Export Excel').disabled, 'Missing summary with recorded bills');
      assert(document.body.textContent!.includes('No shift data') && !document.querySelector('.bill-summary-grid')!.textContent!.includes('104.75'), 'Missing summary never fabricates sales from bills');
    }
    button('Refresh').click(); await until(() => pending().length > 0, 'Empty scope reads');
    pending().forEach(read => {
      if (read.url.pathname.endsWith('/dashboard')) read.resolve(new Response('missing', { status: 404 }));
      else {
        const empty = read.url.pathname.endsWith('/categories') ? { categories: [], summary: { totalCategories: 0, totalBills: 0, totalQuantity: 0, totalAmount: 0 } }
          : read.url.pathname.endsWith('/bills') ? { bills: [], pagination: { totalPages: 1 } }
          : { bills: [], rates: [], summary: { taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0, gross: 0, totalBills: 0, gstBills: 0 } };
        read.resolve(Response.json({ data: empty }));
      }
    });
    await until(() => !button('Refresh').disabled, 'Empty scope settles'); unavailable();
    button('Refresh').click(); await until(() => pending().length > 0, 'Unmount read');
    const unmounted = [...pending()]; flushSync(() => root.unmount());
    unmounted.forEach(read => { assert(read.signal.aborted, 'Unmount aborts read'); reply(read, '', 401); });
    await pause(); assert(expired === 0 && downloads === before + 1, `${name}: unmount has no side effects`);
    root = createRoot(document.getElementById('root')!);
    checks.push(`${name}: render scope isolation, late fetch/body/401, error/manual retry, timeout, duplicate export, workbook error/retry, exact totals, cancellation and unmount`);
  }
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
