// Real receiving/report components, isolated clients, one in-memory API fixture.
// No Firebase, production inventory, browser storage or optimistic stock writes.
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { GoodsReceivedPage } from '../src/pages/GoodsReceivedPage.tsx';
import { StockAdjustmentPage } from '../src/pages/StockAdjustmentPage.tsx';
import { StockReportPage } from '../src/pages/StockReportPage.tsx';
import { useStockTransferRead, type StockTransferProduct } from '../src/pages/useStockTransferRead.ts';
import { clearMasterSnapshots, readMasterSnapshot } from '../src/utils/masterSnapshots.ts';
import '../src/index.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 250; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${label}`); }
const outlet = { id: 'outlet', name: 'Test Outlet', active: true };
const expired = () => { throw new Error('Unexpected session expiry'); };
const stock = new Map([['outlet', 20], ['other', 500]]);
let version = 0, receiptNumber = 0, loseResponse = true, failReport = false;
let holdNextProductRead = false;
let releaseOldProducts: (() => void) | undefined;
const receipts = new Map<string, string>(), posts: { path: string; body: any }[] = [];
const feeds = new Set<{ id: string; controller: ReadableStreamDefaultController<Uint8Array> }>();
const encode = new TextEncoder();
function notify() { version++; for (const { controller } of feeds) controller.enqueue(encode.encode(JSON.stringify({ type: 'changed', collection: 'PRODUCT', version: String(version) }) + '\n')); }
const fields = (id: string) => ({ name: 'Rice', code: 1, barcode: '123456789', category: 'food', currentStock: stock.get(id), stockable: true, weighable: false, costPrice: 2, price: 3, unitId: 0, reorderLevel: 100 });
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href), id = decodeURIComponent(url.pathname.split('/')[3]!);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Requests retain authorization');
  if (url.pathname.endsWith('/master-sync')) {
    let feed: (typeof feeds extends Set<infer T> ? T : never);
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      feed = { id, controller }; feeds.add(feed);
      controller.enqueue(encode.encode(JSON.stringify({ type: 'changed', collection: 'PRODUCT', version: String(version) }) + '\n'));
      init?.signal?.addEventListener('abort', () => { feeds.delete(feed); try { controller.close(); } catch { /* Closed already. */ } }, { once: true });
    }, cancel() { feeds.delete(feed); } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  }
  if (url.pathname.endsWith('/products')) {
    const data = [{ documentId: 'rice', fields: fields(id) }];
    if (holdNextProductRead) {
      holdNextProductRead = false;
      // Deliberately ignore abort to test protection from old network responses.
      return new Promise<Response>(resolve => { releaseOldProducts = () => resolve(Response.json({ success: true, data })); });
    }
    return Response.json({ success: true, data });
  }
  if (url.pathname.endsWith('/categories')) return Response.json({ success: true, data: [{ id: 'food', name: 'Food' }] });
  if (url.pathname.endsWith('/reports/stock')) {
    if (failReport && id === 'outlet') return Response.json({ message: 'Temporary failure' }, { status: 503 });
    const f = fields(id), balance = stock.get(id)!;
    return Response.json({ success: true, data: { categories: [{ id: 'food', name: 'Food' }], products: [{ productId: 'rice', ...f, categoryId: 'food', category: 'Food', tracked: true, stockValue: balance * 3, status: balance <= 0 ? 'Out of stock' : balance <= 100 ? 'Low stock' : 'In stock' }] } });
  }
  if (url.pathname.endsWith('/goods-received') && init?.method !== 'POST') return Response.json({ success: true, data: { documentId: String(++receiptNumber).padStart(20, 'R'), supplierDraftId: 'S'.repeat(20), suppliers: [], receipts: [] } });
  if (init?.method === 'POST' && /\/(goods-received|stock-adjustments)$/.test(url.pathname)) {
    const body = JSON.parse(String(init.body)); posts.push({ path: url.pathname, body });
    const key = `${id}:${body.documentId ?? body.requestId}`;
    const previous = receipts.get(key), payload = JSON.stringify(body);
    if (previous) assert(previous === payload, 'Unconfirmed retries reuse the exact confirmation payload');
    else {
      if (body.requestId) assert(body.items[0].expectedStock === stock.get(id), 'Stock In confirms the latest persisted balance');
      stock.set(id, stock.get(id)! + body.items[0].quantity * (body.direction === 'out' ? -1 : 1));
      receipts.set(key, payload); notify();
    }
    if (body.documentId && loseResponse) { loseResponse = false; throw new Error('Response lost after commit'); }
    return Response.json({ success: true, data: { documentId: body.documentId ?? body.requestId,
      ...(body.documentId ? { goodsReceivedNo: `261105${body.documentId.replaceAll('R', '')}` } : {}), alreadySaved: !!previous } });
  }
  throw new Error(`Unexpected request ${url.pathname}`);
};
function TransferBalance() {
  const read = useStockTransferRead<StockTransferProduct>('/api/outlets/outlet/products', 'token', 'products', expired);
  return <output>{read.data?.[0]?.fields.currentStock as number}</output>;
}
const roots = new Map<string, ReturnType<typeof createRoot>>();
for (const id of ['device', 'web', 'phone2', 'adjust', 'transfer', 'other']) { const host = document.createElement('div'); host.id = id; document.getElementById('root')!.append(host); roots.set(id, createRoot(host)); }
const host = (id: string) => document.getElementById(id)!;
const button = (id: string, label: string) => [...host(id).querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
const query = <T extends Element>(id: string, selector: string) => host(id).querySelector<T>(selector)!;
async function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause();
}
const reportBalance = (id: string) => query(id, '.stock-count')?.textContent;
const goodsBalance = () => query('device', '[aria-label="Current stock for Rice"]')?.textContent;
function renderGoods() { roots.get('device')!.render(<GoodsReceivedPage outlet={outlet} token="token" onSessionExpired={expired} onCancel={() => {}} />); }
function renderReport(id: string, selected = outlet) { roots.get(id)!.render(<StockReportPage outlet={selected} token="token" onSessionExpired={expired} />); }
void (async () => {
  clearMasterSnapshots(); readMasterSnapshot('/api/outlets/outlet/products', 'token');
  renderGoods(); renderReport('web'); renderReport('phone2'); renderReport('other', { ...outlet, id: 'other' });
  roots.get('adjust')!.render(<StockAdjustmentPage outlet={outlet} token="token" onSessionExpired={expired} />);
  roots.get('transfer')!.render(<TransferBalance />);
  await until(() => goodsBalance() === '20' && reportBalance('web') === '20' && reportBalance('phone2') === '20' && feeds.size === 6, 'all clients opened');
  query<HTMLButtonElement>('adjust', '[aria-label="Go ahead with Stock In"]').click();
  await until(() => query('adjust', 'option[value="rice"]'), 'Stock In ready');
  await setValue(query('adjust', '[aria-label="Select product"]'), 'rice');
  await setValue(query('adjust', '[aria-label="Quantity for Rice"]'), '30');
  assert(!query('web', '.stock-planning'), 'Stock Report does not display removed planning tools');
  await setValue(query('web', '.bill-search-filter input'), 'Rice');
  query<HTMLButtonElement>('device', '[aria-label="Select product Rice"]').click(); await pause();
  await setValue(query('device', '[aria-label="Received quantity for Rice"]'), '50');
  await setValue(query('device', '[aria-label="Cost price for Rice"]'), '4');
  await pause(450);
  holdNextProductRead = true; window.dispatchEvent(new Event('focus'));
  await until(() => !!releaseOldProducts, 'old manual stock read held');
  button('device', 'Save').click(); await until(() => query('device', '.action-confirm-button'), 'receipt confirmation');
  query<HTMLButtonElement>('device', '.action-confirm-button').click();
  await until(() => button('device', 'Retry confirmation') && reportBalance('web') === '70' && reportBalance('phone2') === '70', 'lost-response commit visible on other clients');
  assert(stock.get('outlet') === 70, '20 + 50 persists as 70 even when the save response is lost');
  assert(query<HTMLInputElement>('device', '[aria-label="Received quantity for Rice"]').value === '50', 'Unconfirmed receipt retains its quantity draft');
  assert(query<HTMLInputElement>('adjust', '[aria-label="Quantity for Rice"]').value === '30', 'Other device stock updates preserve a Stock In draft');
  assert(query<HTMLInputElement>('web', '.bill-search-filter input').value === 'Rice', 'Report reconciliation preserves the product search');
  button('device', 'Retry confirmation').click();
  await until(() => goodsBalance() === '70' && !query('device', '.action-confirm-button'), 'retry confirmed and goods stock reconciled');
  assert(receipts.size === 1 && stock.get('outlet') === 70 && posts.length === 2, 'Retry acknowledges one receipt without adding stock twice');
  releaseOldProducts!(); await pause(80);
  assert(goodsBalance() === '70', 'A late pre-save stock response cannot overwrite the confirmed balance');
  assert(query('transfer', 'output').textContent === '70', 'Transfer availability receives the same persisted stock');
  query<HTMLButtonElement>('device', '.success-done')?.click();
  button('adjust', 'Add Stock').click(); await until(() => query('adjust', '.action-confirm-button'), 'Stock In confirmation');
  query<HTMLButtonElement>('adjust', '.action-confirm-button').click();
  await until(() => goodsBalance() === '100' && reportBalance('web') === '100' && reportBalance('phone2') === '100' && query('transfer', 'output').textContent === '100', 'all clients see 100');
  assert(stock.get('outlet') === 100 && receipts.size === 2, 'Goods Received 50 followed by Stock In 30 persists 100 everywhere');
  assert(reportBalance('other') === '500' && stock.get('other') === 500, 'A different outlet retains its balance');
  const snapshot = readMasterSnapshot<StockTransferProduct[]>('/api/outlets/outlet/products', 'token');
  assert(snapshot?.[0]?.fields.currentStock === 100, 'Product display snapshot is refreshed from persisted stock');
  // A remote stock-out still updates the report after removing the planning tools.
  stock.set('outlet', 95); notify();
  await until(() => reportBalance('web') === '95' && reportBalance('phone2') === '95', 'remote stock-out visible in reports');
  // Failed background reads retain visible rows and are retried by the existing feed.
  failReport = true; stock.set('outlet', 96); notify(); await pause(500);
  assert(reportBalance('web') === '95', 'An unsuccessful background read does not fabricate updated stock');
  failReport = false;
  await until(() => reportBalance('web') === '96' && reportBalance('phone2') === '96', 'background read retries without a new stock write');
  button('phone2', 'Refresh').click(); await until(() => reportBalance('phone2') === '96', 'refresh persisted stock');
  flushSync(() => roots.get('device')!.render(null)); renderGoods();
  await until(() => goodsBalance() === '96', 'reopened Goods Received uses persisted stock');
  assert(posts.length === 3 && receipts.size === 2, 'Refreshing and reopening do not replay stock writes');
  // Newly low stock remains visible without restoring the removed planning section.
  stock.set('other', 5); notify();
  await until(() => reportBalance('other') === '5', 'other outlet stock update');
  assert(query('other', '.stock-status').textContent === 'Low stock' && !query('other', '.stock-planning'), 'New low-stock rows display their status without planning tools');
  for (const root of roots.values()) root.unmount(); await pause();
  assert(feeds.size === 0, 'All inventory change feeds close on navigation/unmount');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
