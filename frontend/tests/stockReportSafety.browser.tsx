import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useLayoutEffect } from 'react';
import { StockReportPage } from '../src/pages/StockReportPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const passed: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function waitFor(check: () => unknown, message: string) {
  for (let i = 0; i < 180; i++) { if (check()) return; await pause(); }
  throw new Error(`Timed out: ${message}`);
}
const requests: { url: string; token: string | null; signal?: AbortSignal | null; resolve: (value: Response) => void; reject: (reason: Error) => void }[] = [];
window.fetch = (url, options) => new Promise<Response>((resolve, reject) => {
  assert(options?.method === undefined || options.method === 'GET', 'Only report GETs are allowed');
  assert(/^\/api\/outlets\/[^/]+\/reports\/stock$/.test(String(url)), 'Unexpected API request');
  requests.push({ url: String(url), token: new Headers(options?.headers).get('Authorization'), signal: options?.signal, resolve, reject });
});
// These tests never start real workers or perform real downloads/printing.
window.Worker = class { constructor() { throw new Error('Unexpected worker'); } } as unknown as typeof Worker;
let downloaded: Blob | undefined;
URL.createObjectURL = blob => { downloaded = blob as Blob; return 'blob:stock-report-fixture'; };
URL.revokeObjectURL = () => {};
HTMLAnchorElement.prototype.click = () => {};
let prints = 0;
window.print = () => { prints++; };
const product = (n: number, categoryId = 'cat') => ({ productId: `p${n}`, code: String(n), name: `Product ${n}`, categoryId,
  category: categoryId === 'cat' ? 'Fresh category' : 'Other', tracked: true, currentStock: n, reorderLevel: 1, price: 2, costPrice: 1,
  stockValue: n * 2, status: 'In stock' });
const reply = (index: number, products: ReturnType<typeof product>[], category = 'Fresh category') => requests[index]!.resolve(Response.json({ success: true,
  data: { products, categories: [{ id: 'cat', name: category }, { id: 'other', name: 'Other' }] } }));
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)!;
const next = () => document.querySelector<HTMLButtonElement>('[aria-label="Next stock report page"]')!;
const visibleRows = () => [...document.querySelectorAll<HTMLTableRowElement>('tbody tr')].filter(row => getComputedStyle(row).display !== 'none');
const summary = () => [...document.querySelectorAll('.bill-summary-grid strong')].map(node => node.textContent).join('|');
const assertUnavailable = () => {
  assert(button('Export Excel').disabled && button('Print / PDF').disabled, 'Output is blocked without current successful rows');
  assert(!document.querySelector('tbody') && !document.querySelector('tfoot'), 'No stale rows or totals');
  assert(summary() === '0|0|0|0', `No stale summary: ${summary()}`);
  assert(document.querySelectorAll('select')[0]!.options.length === 1, 'No stale category metadata');
};
let expired = 0;
let layoutProbe: (() => void) | undefined;
function Fixture({ id, token, callback }: { id: string; token: string; callback: () => void }) {
  useLayoutEffect(() => { layoutProbe?.(); });
  return <StockReportPage outlet={{ id, name: `Outlet ${id}` } as OutletSummary} token={token} onSessionExpired={callback} />;
}
const root = createRoot(document.getElementById('root')!);
const render = (id: string, token = 'one', callback = () => { expired++; }) => flushSync(() => root.render(<Fixture id={id} token={token} callback={callback} />));
void (async () => {
  render('A');
  await waitFor(() => requests.length === 1, 'initial request');
  reply(0, Array.from({ length: 101 }, (_, i) => product(101 - i)), 'Old category');
  await waitFor(() => visibleRows().length === 50, 'initial rows');
  assert(visibleRows()[0]!.textContent?.includes('Product 1'), 'Numeric product code sorting retained');
  assert(!document.querySelector('[data-label="Code"]'), 'Stock report excludes product codes on screen and in print');
  next().click(); await pause(); next().click(); await pause();
  assert(visibleRows().length === 1 && document.querySelector('.bill-pagination')!.textContent!.includes('Page 3 of 3'), 'Third page is reachable');
  assert(document.querySelectorAll('tbody tr').length === 101 && document.querySelectorAll('.stock-print-only-row').length === 100, 'All filtered rows exist once for print and only current page is visible');
  button('Print / PDF').click(); assert(prints === 1, 'Valid report can print');
  flushSync(() => button('Refresh').click()); assertUnavailable();
  await waitFor(() => requests.length === 2, 'refresh request');
  reply(1, [product(1), product(2)]);
  await waitFor(() => visibleRows().length === 2, 'smaller report');
  assert(document.querySelector('.bill-pagination')!.textContent!.includes('Showing 1–2 of 2') && next().disabled, 'Shrinking data clamps page and range');
  passed.push('Pagination stays valid after shrinking refresh; one table contains all print rows and coherent totals');

  flushSync(() => button('Refresh').click()); assertUnavailable();
  await waitFor(() => requests.length === 3, 'failing refresh');
  requests[2]!.resolve(Response.json({ message: 'Refresh failed' }, { status: 500 }));
  await waitFor(() => document.querySelector('[role="alert"]'), 'refresh failure');
  assertUnavailable();
  button('Export Excel').click(); button('Print / PDF').click();
  assert(!downloaded && prints === 1, 'Failed refresh cannot export or print old data');
  button('Retry').click(); await waitFor(() => requests.length === 4, 'retry');
  reply(3, [product(7)], 'Private category'); await waitFor(() => visibleRows().length === 1, 'retry success');
  passed.push('Refresh immediately hides old rows, totals and metadata; failure blocks output and retry recovers');

  layoutProbe = assertUnavailable;
  render('B'); layoutProbe = undefined;
  await waitFor(() => requests.length === 5, 'outlet B request');
  render('C'); await waitFor(() => requests.length === 6, 'outlet C request');
  assert(requests[4]!.signal?.aborted, 'Old outlet request cancelled');
  reply(5, [product(8)]); await waitFor(() => visibleRows().length === 1, 'C data');
  reply(4, [product(999)], 'Leaked category'); await pause();
  assert(!document.body.textContent!.includes('Product 999') && !document.body.textContent!.includes('Leaked category'), 'Late old success ignored');
  layoutProbe = assertUnavailable;
  render('C', 'two'); layoutProbe = undefined;
  await waitFor(() => requests.length === 7, 'new token request');
  render('C', 'three'); await waitFor(() => requests.length === 8, 'latest token request');
  reply(7, [product(9)]); await waitFor(() => visibleRows().length === 1, 'latest token result');
  requests[6]!.reject(new Error('Late old error')); await pause();
  assert(!document.querySelector('[role="alert"]') && visibleRows()[0]!.textContent!.includes('Product 9'), 'Late token failure cannot replace current data');
  assert(requests[7]!.token === 'Bearer three', 'Latest token used');
  passed.push('Outlet/token changes hide data before effects; cancelled late successes and failures are ignored');

  button('Refresh').click(); await waitFor(() => requests.length === 9, 'auth request');
  let latestExpired = 0;
  render('C', 'three', () => { latestExpired++; });
  requests[8]!.resolve(new Response('invalid JSON', { status: 401 }));
  await waitFor(() => latestExpired === 1, 'latest auth callback');
  assert(expired === 0, 'Latest session callback is preserved without refetch'); assertUnavailable();
  button('Retry').click(); await waitFor(() => requests.length === 10, 'post auth retry');
  reply(9, Array.from({ length: 60 }, (_, i) => product(60 - i, i < 55 ? 'cat' : 'other')));
  await waitFor(() => visibleRows().length === 50, 'export fixture');
  const category = document.querySelector<HTMLSelectElement>('select')!;
  category.value = 'cat'; category.dispatchEvent(new Event('change', { bubbles: true })); await pause(); button('Apply').click(); await pause();
  assert(document.querySelectorAll('tbody tr').length === 55, 'Filtered print rows include all pages');
  button('Export Excel').click(); await waitFor(() => downloaded, 'mocked Excel download');
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await downloaded!.arrayBuffer());
  const sheet = workbook.worksheets[0]!;
  assert(sheet.getCell('A33').value === 'Product 6' && sheet.getCell('A87').value === 'Product 60', 'Excel includes every filtered row in numeric order');
  assert(sheet.getCell('A88').value === 'Total' && sheet.getCell('D88').value === 1815, 'Excel total matches all filtered quantities');
  const input = document.querySelector<HTMLInputElement>('input')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'no matching stock');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => button('Clear filters'), 'filtered empty state');
  assert(button('Export Excel').disabled, 'Filtered empty report cannot export');
  button('Clear filters').click(); await waitFor(() => document.querySelectorAll('tbody tr').length === 60, 'clear filters restores rows');
  passed.push('401 uses current callback; filtered export contains all sorted rows and totals; clear filters restores empty results');
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed }); });
