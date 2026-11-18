import { createRoot } from 'react-dom/client';
import { TransferPreviewPage } from '../src/pages/TransferPreviewPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const passed: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const transfers: { mode: string; categoryIds: string[]; options: Record<string, boolean>; products: { sourceProductId: string; fields: string[] }[]; categoryMappings: Record<string, string> }[] = [];
let fail = false, hold = false, release: (() => void) | undefined;
let failReads = true;
const previewReads: string[] = [];
const fixtures: Record<string, unknown> = {
  '/api/auth/outlets': { outlets: [{ id: 'source', name: 'Outlet A' }, { id: 'destination', name: 'Outlet B' }] },
  '/api/outlets/source/categories': [{ id: 'c1', name: 'ROLLS', categoryNo: 1 }, { id: 'c2', name: 'WRAPS', categoryNo: 2 }],
  '/api/outlets/destination/categories': [{ id: 'd9', name: ' wraps ', categoryNo: 4 }],
  '/api/outlets/source/products': [
    { documentId: 'p1', fields: { name: 'Roll', code: 1, category: 'c1', taxIndex: 1, unitId: 2, currentStock: 5 } },
    { documentId: 'p2', fields: { name: 'Samosa', code: 2, category: 'c1', taxIndex: 1, unitId: 2 } },
    { documentId: 'p3', fields: { name: 'Wrap', code: 3, category: 'c2', taxIndex: 1, unitId: 2 } },
    { documentId: 'p4', fields: { name: 'No category', code: 4, taxIndex: 1, unitId: 2 } },
    { documentId: 'p5', fields: { name: 'Deleted category', code: 5, category: 'deleted', taxIndex: 1, unitId: 2 } },
  ],
  '/api/outlets/destination/products': [{ documentId: 'x1', fields: { name: 'SAMOSA', code: 9 } }],
};
(fixtures['/api/outlets/source/products'] as unknown[]).push(...Array.from({ length: 60 }, (_, index) => ({
  documentId: `extra-${index}`, fields: { name: `Extra product ${index}`, code: index + 10, category: 'c1', currentStock: index },
})));
window.fetch = async (url, init) => {
  const path = String(url);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer mock-token', 'Requests retain authentication');
  if (path.endsWith('/transfer-preview/verify-quick-pin')) return Response.json({ success: true, data: { verified: true, destinationOutletId: 'destination', transferToken: 'grant' } });
  if (path.endsWith('/master-transfer')) {
    assert(new Headers(init?.headers).get('X-Transfer-Token') === 'grant', 'Transfer retains QuickPin authorization');
    const body = JSON.parse(String(init?.body)); transfers.push(body);
    await new Promise(resolve => setTimeout(resolve, 60));
    if (hold) await new Promise<void>(resolve => { release = resolve; });
    if (fail) return Response.json({ success: false, message: 'Transfer failed; retry.' }, { status: 503 });
    const items = body.products.map((product: { sourceProductId: string }) => ({ type: 'product', sourceId: product.sourceProductId, name: product.sourceProductId, status: 'created', reason: 'Product copied.' }));
    return Response.json({ success: true, data: { created: items.length, skipped: 0, unchanged: 0, items } });
  }
  if (Object.hasOwn(fixtures, path)) {
    if (/\/(categories|products)$/.test(path)) {
      previewReads.push(path);
      if (failReads) return Response.json({ success: false, message: 'Resume Web POS to continue.' }, { status: 503 });
    }
    return Response.json({ success: true, data: fixtures[path] });
  }
  throw new Error(`Unexpected request: ${path}`);
};
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}`); }
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
const select = (name: string) => document.querySelector<HTMLInputElement>(`[aria-label="Select ${name}"]`)!;
const click = async (element: HTMLElement) => { element.click(); await pause(); };
const option = (name: string) => [...document.querySelectorAll<HTMLLabelElement>('.transfer-option')].find(label => label.querySelector('strong')?.textContent === name)!.querySelector('input')!;
async function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause();
}
const root = createRoot(document.getElementById('root')!);
root.render(<div className="retail-dashboard-shell"><main className="dashboard-workspace" style={{ width: '100%' }}><TransferPreviewPage outlet={{ id: 'source', name: 'Outlet A' } as OutletSummary} token="mock-token" onSessionExpired={() => { throw new Error('Unexpected expiry'); }} /></main></div>);
void (async () => {
  await until(() => document.querySelector('[aria-label="Select outlet Outlet B"]'), 'destination outlets');
  await click(document.querySelector<HTMLButtonElement>('[aria-label="Select outlet Outlet B"]')!);
  const pin = document.querySelector<HTMLInputElement>('#preview-quick-pin')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(pin, '1234'); pin.dispatchEvent(new Event('input', { bubbles: true })); await pause();
  await click(button('Verify'));
  await until(() => button('Retry') && !button('Retry').disabled, 'single retry action');
  const state = document.querySelector('.transfer-preview > .devices-state')!;
  assert(state.textContent?.trim() === 'Retry' && state.querySelectorAll('button').length === 1 && !state.querySelector('[role="alert"]'), 'Failed preview reads show only one Retry button without repeated error messages');
  assert(previewReads.length === 4, 'All four preview reads failed in isolation');
  failReads = false; await click(button('Retry'));
  await until(() => select('Roll'), 'product list');
  assert(previewReads.length === 8 && transfers.length === 0, 'One Retry reloads all four failed reads without transferring products');
  assert(!document.body.textContent?.includes('Category Transfer') && !document.querySelector('[aria-label="Transfer type"]'), 'Only Product Transfer is offered');
  assert(!document.querySelector('[aria-label="Select outlet Outlet A"]'), 'Source outlet is excluded');
  assert(select('Samosa').disabled, 'Products already in the destination cannot be selected again');
  assert(select('No category').closest('tr')?.textContent?.includes('All') && select('Deleted category').closest('tr')?.textContent?.includes('All'), 'Missing and deleted categories appear under All');
  const destination = document.querySelector<HTMLSelectElement>('.transfer-destination-field select')!.getBoundingClientRect();
  assert(destination.width <= 401 && destination.right <= innerWidth, 'Destination selector stays compact and fits the screen');
  if (location.hash === '#preview') { document.documentElement.dataset.theme = 'light'; document.getElementById('test-results')!.textContent = JSON.stringify({ passed: ['Product Transfer layout'] }); return; }
  const selectedOnly = document.querySelector<HTMLInputElement>('.transfer-selected-only input')!;
  const category = document.querySelector<HTMLSelectElement>('[aria-label="Filter transfer products by category"]')!;
  const search = document.querySelector<HTMLInputElement>('.transfer-search-field input')!;
  const selectAll = document.querySelector<HTMLInputElement>('.transfer-selection-actions input')!;
  const count = () => document.querySelector('.transfer-action-bar strong')!.textContent;
  await click(selectedOnly);
  assert(!document.querySelector('.transfer-products-table') && document.querySelector('.transfer-products-empty')?.textContent?.includes('No products selected') && button('Review & transfer').disabled, 'Empty selected-only view is clear and cannot transfer');
  await click(selectedOnly); await click(select('Roll')); await click(select('Wrap'));
  await setValue(category, 'c1'); await setValue(search, 'roll'); await click(selectedOnly);
  assert(document.querySelectorAll('.transfer-products-table tbody tr').length === 1 && select('Roll').checked && count()?.startsWith('2 products') && document.querySelector('.transfer-filter-count')?.textContent?.includes('1 selected hidden'), 'Search, category and selected-only filters combine without losing hidden selections');
  await click(select('Roll'));
  assert(!document.querySelector('.transfer-products-table') && count()?.startsWith('1 products'), 'Deselecting removes a row from selected-only while retaining other selections');
  await click(button('Clear selection'));
  assert(count()?.startsWith('0 products') && button('Review & transfer').disabled && button('Clear selection').disabled, 'Clear selection clears visible and hidden selections');
  await click(selectedOnly); await setValue(category, 'c2'); await setValue(search, 'wrap'); await click(selectAll);
  await setValue(category, 'c1'); await setValue(search, 'roll');
  const visibleSelectableCount = document.querySelectorAll('.transfer-products-table tbody input:not(:disabled)').length;
  await click(selectAll);
  assert(count()?.startsWith(`${visibleSelectableCount + 1} products`) && select('Roll').checked, 'Select all visible adds matching rows and preserves hidden selected products');
  await click(button('Clear selection')); await setValue(category, ''); await setValue(search, '');
  const panel = document.querySelector<HTMLElement>('.transfer-preview-selection')!;
  window.scrollTo(0, panel.getBoundingClientRect().top + window.scrollY - 68); await pause();
  const table = document.querySelector<HTMLElement>('.transfer-products-table')!;
  if (innerHeight <= 600) { window.scrollTo(0, table.getBoundingClientRect().top + window.scrollY - 68); await pause(); }
  const firstTop = table.querySelector('tbody tr')!.getBoundingClientRect().top;
  table.scrollTop = 600; table.scrollLeft = 70; await pause();
  const head = table.querySelector('th')!.getBoundingClientRect();
  const bodyCell = table.querySelector('tbody td')!.getBoundingClientRect();
  assert(table.scrollTop > 100 && head.top >= table.getBoundingClientRect().top - 1 && Math.abs(head.left - bodyCell.left) < 2 && table.querySelector('tbody tr')!.getBoundingClientRect().top < firstTop - 100, 'Long product list scrolls under aligned sticky headings, including horizontal scroll');
  const controls = document.querySelector('.transfer-product-controls')!.getBoundingClientRect();
  const actions = document.querySelector('.transfer-action-bar')!.getBoundingClientRect();
  assert((innerHeight <= 600 || controls.top >= 0) && controls.bottom <= table.getBoundingClientRect().top + 1 && actions.top >= table.getBoundingClientRect().bottom - 1 && actions.bottom <= innerHeight, 'Filters and persistent action bar do not cover rows; short screens retain normal filter scrolling');
  table.scrollTop = table.scrollHeight; await pause();
  assert(table.querySelector('tbody tr:last-child')!.getBoundingClientRect().bottom <= table.getBoundingClientRect().bottom + 1, 'Final product row can be scrolled completely above the action bar');
  assert(document.querySelector('.transfer-preview')!.scrollWidth <= document.querySelector('.transfer-preview')!.clientWidth + 2, 'The page fits the viewport while the table handles horizontal scrolling');
  table.scrollTop = 0; table.scrollLeft = 0;
  passed.push('Combined filters, preserved hidden selections, clear selection, selected-only empty state, sticky aligned headings, persistent controls and unobscured last row');
  await click(select('Roll')); await click(select('Wrap')); await click(select('No category')); await click(select('Deleted category'));
  assert(button('Review & transfer') && !button('Review & transfer').disabled, 'Selected products can be reviewed');
  await click(button('Review & transfer'));
  assert(option('Images').checked && !option('Stock').checked && !option('Prices').checked, 'Existing transfer defaults retained');
  await click(option('Prices')); await click(option('Barcode')); await click(button('Cancel'));
  assert(transfers.length === 0, 'Review and cancel make no transfer requests');
  await click(button('Review & transfer'));
  assert(option('Prices').checked && option('Barcode').checked, 'Options survive cancelling review');
  fail = true; hold = true;
  button('Transfer').click(); button('Transfer').click();
  await until(() => document.querySelector('.transfer-progress[open]') && release, 'transfer progress');
  assert(document.querySelector('#transfer-progress-title')?.textContent === 'Transferring products…', 'Progress explains the current action');
  const cancel = new Event('cancel', { cancelable: true }); document.querySelector('.transfer-progress')!.dispatchEvent(cancel);
  assert(cancel.defaultPrevented, 'Pending transfer cannot be dismissed with Escape');
  release!(); hold = false;
  await until(() => document.body.textContent?.includes('Transfer failed; retry.'), 'failed transfer');
  assert(transfers.length === 1 && !document.querySelector('.transfer-progress'), 'Duplicate clicks are guarded and failure clears progress');
  assert(transfers[0]!.mode === 'products', 'Only product mode is submitted');
  assert(JSON.stringify(transfers[0]!.categoryIds) === '["c1","c2"]', 'Assigned categories accompany selected products automatically');
  assert(JSON.stringify(transfers[0]!.categoryMappings) === '{"c2":"d9"}', 'Matching destination categories are reused');
  assert(transfers[0]!.products.length === 4 && !transfers[0]!.products.find(product => product.sourceProductId === 'p4')!.fields.includes('category'), 'Uncategorized products are included without a made-up category');
  passed.push('One product flow, compact destination selector, automatic category inclusion, existing-category reuse and All fallback');
  fail = false;
  await click(button('Review & transfer')); await click(button('Transfer'));
  await until(() => document.querySelector('.action-success')?.textContent?.includes('Transferred successfully.'), 'successful retry');
  assert(transfers.length === 2 && JSON.stringify(transfers[0]) === JSON.stringify(transfers[1]), 'Retry retains the selected products, category mappings and options');
  await click(button('Done'));
  await until(() => document.querySelector('[aria-label="Select outlet Outlet B"]'), 'return to destinations');
  passed.push('QuickPin verification, review cancellation, independent options, transfer progress, error recovery and successful confirmation');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ passed, failed: String(error) }); });
