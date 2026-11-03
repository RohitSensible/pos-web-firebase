import { createRoot } from 'react-dom/client';
import { StockTransferPage } from '../src/pages/StockTransferPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
const checks: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}`); }
const requests: { path: string; method: string }[] = [];
const outlets = [{ id: 'main', name: 'Warehouse' }, { id: 'branch', name: 'Branch' }, { id: 'empty', name: 'Empty Outlet' }];
let outletFailure = true, productFailure = false, expire = false, holdMain = false;
let releaseMain: (() => void) | undefined;
let expiryCount = 0;
const onSessionExpired = () => { expiryCount++; };
const product = (id: string, fields: Record<string, unknown>) => ({ documentId: id, fields: { name: id, code: 100, category: 'cat', ...fields } });
const mainProducts = [product('Tracked', { stockable: true, currentStock: 12 }), product('Zero', { stockable: true, currentStock: 0 }),
  product('Negative', { stockable: true, currentStock: -2 }), product('Missing', { stockable: true }), product('Text stock', { stockable: true, currentStock: '10' }),
  product('Infinite stock', { stockable: true, currentStock: Infinity }), product('NaN stock', { stockable: true, currentStock: NaN }),
  product('Unsafe stock', { stockable: true, currentStock: Number.MAX_SAFE_INTEGER + 1 }), product('Fractional stock', { stockable: true, currentStock: 0.5 }),
  product('False', { stockable: false, currentStock: 100 }), product('String flag', { stockable: 'true', currentStock: 100 }), product('No flag', { currentStock: 100 })];
window.fetch = async (input, init) => {
  const path = String(input), method = init?.method || 'GET'; requests.push({ path, method });
  if (method !== 'GET') throw new Error('Writes are forbidden');
  if (new Headers(init?.headers).get('Authorization') !== 'Bearer read-only') throw new Error('Missing token');
  if (path === '/api/auth/outlets') {
    if (expire) return Response.json({ success: false }, { status: 401 });
    if (outletFailure) return Response.json({ success: false, message: 'Outlets temporarily unavailable' }, { status: 403 });
    return Response.json({ success: true, data: { outlets } });
  }
  if (path.endsWith('/categories')) return Response.json({ success: true, data: [{ id: 'cat', name: 'Actual category' }] });
  if (path === '/api/outlets/main/products') {
    if (productFailure) return Response.json({ success: false, message: 'Product access unavailable' }, { status: 403 });
    if (holdMain) await new Promise<void>(resolve => { releaseMain = resolve; });
    return Response.json({ success: true, data: mainProducts });
  }
  if (path === '/api/outlets/branch/products') return new Response([
    { type: 'items', data: [product('Branch product', { stockable: true, currentStock: 7 })] }, { type: 'end' },
  ].map(item => JSON.stringify(item)).join('\n'), { headers: { 'Content-Type': 'application/x-ndjson' } });
  if (path === '/api/outlets/empty/products') return Response.json({ success: true, data: [] });
  throw new Error(`Unexpected endpoint: ${path}`);
};
const root = createRoot(document.getElementById('root')!);
const render = (id = 'main', key = 'initial') => root.render(<StockTransferPage key={key} outlet={{ id, name: 'Warehouse' } as OutletSummary} token="read-only" onSessionExpired={onSessionExpired} />);
const sourceSelect = () => document.querySelector<HTMLSelectElement>('.st-source-card select')!;
async function choose(element: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('change', { bubbles: true })); await pause();
}
const retry = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === 'Retry Data')!.click();
render();
void (async () => {
  await until(() => document.body.textContent?.includes('Outlets temporarily unavailable'), 'outlet error');
  assert(!document.querySelector('.st-product-card') && requests.length === 1, 'Outlet loading failure shows an error without mock products or unauthorized product reads');
  outletFailure = false; retry();
  await until(() => document.querySelectorAll('.st-product-card').length === 9, 'actual products');
  assert(document.querySelector('[data-product-id=Tracked]')?.textContent?.includes('Actual category') && document.querySelector('[data-product-id=Tracked] .st-stock')?.textContent?.includes('12'), 'Real response names, resolved category and source stock are displayed after retry');
  assert(!document.querySelector('[data-product-id=False], [data-product-id="String flag"], [data-product-id="No flag"]'), 'Non-stockable, missing and string-valued stockable flags are excluded');
  await choose(document.getElementById('st-destination') as HTMLSelectElement, 'branch');
  assert(!document.querySelector<HTMLInputElement>('[aria-label="Select Tracked"]')!.disabled, 'A stockable product with positive stock can be selected for local preview');
  for (const id of ['Zero', 'Negative', 'Missing', 'Text stock', 'Unsafe stock', 'Fractional stock', 'Infinite stock', 'NaN stock']) assert(document.querySelector<HTMLInputElement>(`[aria-label="Select ${id}"]`)!.disabled, `${id} stock is visible but cannot be selected`);
  assert(document.querySelector('[data-product-id=Missing]')?.textContent?.includes('Unavailable'), 'Missing stock is labelled unavailable, never fabricated as zero');
  assert(document.querySelector('[data-product-id="Unsafe stock"] .st-stock')?.textContent?.includes('Unavailable'), 'Unsafe source stock is unavailable instead of exposing imprecise quantities');
  document.querySelector<HTMLInputElement>('[aria-label="Select Tracked"]')!.click(); await pause();
  await choose(document.querySelector<HTMLSelectElement>('.st-product-toolbar select')!, 'Actual category');
  await choose(sourceSelect(), 'branch');
  await until(() => document.querySelector('[data-product-id="Branch product"]'), 'streamed products');
  assert(document.querySelector<HTMLSelectElement>('.st-product-toolbar select')!.value === '', 'Source changes clear the old category filter with the old product selections');
  assert(!document.querySelector('[data-product-id=Tracked], .st-product-editor') && document.querySelector('.st-stock')?.textContent?.includes('7'), 'Changing source clears old selections and reads the new outlet, including streamed responses');
  holdMain = true; await choose(sourceSelect(), 'main');
  await until(() => releaseMain, 'held response');
  assert(!document.querySelector('.st-product-card'), 'Previous source products disappear immediately during the next load');
  await choose(sourceSelect(), 'empty');
  await until(() => document.body.textContent?.includes('No stockable products in this outlet'), 'empty source');
  releaseMain!(); holdMain = false; await pause(); await pause();
  assert(!document.querySelector('.st-product-card') && sourceSelect().value === 'empty', 'A late response from an old source cannot replace the current outlet data');
  productFailure = true; await choose(sourceSelect(), 'main');
  await until(() => document.body.textContent?.includes('Product access unavailable'), 'product error');
  assert(!document.querySelector('.st-product-card'), 'A product read failure does not fall back to mock or stale stock');
  productFailure = false; retry(); await until(() => document.querySelector('[data-product-id=Tracked]'), 'product retry');
  assert(document.querySelectorAll('.st-product-card').length === 9, 'Failed product loads can be retried without writes');
  const beforeUnauthorized = requests.filter(item => item.path !== '/api/auth/outlets').length;
  render('not-assigned', 'unauthorized');
  await until(() => sourceSelect()?.value === '' && sourceSelect()?.options.length === 4, 'authorized choices');
  assert(sourceSelect().value === '' && requests.filter(item => item.path !== '/api/auth/outlets').length === beforeUnauthorized, 'An unassigned initial source never triggers a product/category read');
  expire = true; render('main', 'expired'); await until(() => expiryCount, 'session expiry');
  assert(expiryCount === 1 && !document.querySelector('.st-product-card'), 'Expired authentication invokes the existing session-expiry handler and displays no products');
  assert(requests.every(item => item.method === 'GET'), 'Every request across success, retries, source changes and failures is GET-only');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
