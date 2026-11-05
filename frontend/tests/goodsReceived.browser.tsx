import { createRoot } from 'react-dom/client';
import { GoodsReceivedPage } from '../src/pages/GoodsReceivedPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const passed: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const existingSupplier = { id: 'S'.repeat(20), name: 'Existing Supplier', mobile: '00000', address: '', alternateNumber: null, email: '', gstin: '' };
let storageWrites = 0, cancelled = false, loseResponse = true, saved = 0, reads = 0;
const posts: any[] = [], receipts: any[] = [];
const products = [{ documentId: 'rice', fields: { name: 'Rice', code: 1, barcode: '100003', category: 'groceries', stockable: true, weighable: false, currentStock: 3, unitId: 0, costPrice: 0, price: 23 } },
  { documentId: 'tea', fields: { name: 'Tea', code: 2, category: 'beverages', stockable: true, weighable: false, currentStock: 7, unitId: 4, costPrice: 2, price: 10 } },
  { documentId: 'hidden', fields: { name: 'Untracked', stockable: false, currentStock: 10 } }];
Storage.prototype.setItem = () => { storageWrites++; throw new Error('No browser persistence'); };
window.fetch = async (url, init) => {
  const path = String(url);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Authorization retained');
  // This fixture tests explicit/focus refresh; live feeds have their own suite.
  if (path.endsWith('/master-sync?kind=products')) return new Response(null, { status: 404 });
  if (path.endsWith('/products')) return Response.json({ success: true, data: products });
  if (path.endsWith('/categories')) return Response.json({ success: true, data: [{ id: 'groceries', name: 'Groceries' }, { id: 'beverages', name: 'Beverages' }] });
  assert(path === '/api/outlets/outlet/goods-received', 'Only authorized receipt/product reads and receipt writes');
  if (init?.method !== 'POST') {
    reads++;
    return Response.json({ success: true, data: { documentId: saved ? 'N'.repeat(20) : 'R'.repeat(20), supplierDraftId: 'D'.repeat(20), suppliers: [existingSupplier], receipts } });
  }
  const payload = JSON.parse(String(init.body)); posts.push(payload);
  assert(['R'.repeat(20), 'N'.repeat(20)].includes(payload.documentId) && payload.goodsReceivedNo === undefined, 'Stable document ID is retained; the server allocates the bill number');
  if (!receipts.some(receipt => receipt.documentId === payload.documentId)) {
    saved++;
    for (const item of payload.items) products.find(product => product.documentId === item.productId)!.fields.currentStock += item.quantity;
    receipts.push({ documentId: payload.documentId, fields: { supplier: payload.supplier, goodsReceivedNo: `261105${saved}`, createDate: Date.now(), goodsReceivedItemBeanList: [{ name: 'Rice', quantity: payload.items[0].quantity }] } });
  }
  if (loseResponse) { loseResponse = false; throw new Error('Response lost after commit'); }
  return Response.json({ success: true, data: { documentId: payload.documentId, goodsReceivedNo: receipts.find(receipt => receipt.documentId === payload.documentId).fields.goodsReceivedNo, alreadySaved: true } });
};
const root = createRoot(document.getElementById('root')!);
root.render(<div className="retail-dashboard-shell"><main className="dashboard-workspace" style={{ width: '100%', minWidth: 0 }}><GoodsReceivedPage outlet={{ id: 'outlet', name: 'Test Outlet' } as OutletSummary} token="token" onSessionExpired={() => { throw new Error('Unexpected expiry'); }} onCancel={() => { cancelled = true; }} /></main></div>);
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}`); }
const button = (text: string) => {
  const result = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text);
  if (!result) throw new Error(`Missing button: ${text}`); return result;
};
const labelled = (text: string) => {
  const label = [...document.querySelectorAll('label')].find(node => node.firstChild?.textContent?.trim() === text);
  const input = label?.querySelector('input, select'); assert(input, `Missing field: ${text}`); return input as HTMLInputElement | HTMLSelectElement;
};
async function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause();
}
void (async () => {
  await until(() => document.querySelector('[aria-label="Product categories"]'), 'outlet loaded');
  if (location.hash === '#preview') { document.getElementById('test-results')!.textContent = JSON.stringify({ passed: ['Goods Received layout'] }); return; }
  assert(posts.length === 0 && reads === 1, 'Opening reads data without writes');
  assert(document.querySelector('[aria-label="Current stock for Rice"]')?.textContent === '3', 'Existing product stock is displayed before any received quantity is entered');
  assert(!document.body.textContent?.includes('Receipt entry only') && !document.body.textContent?.includes('Goods Received Number') && !document.body.textContent?.includes('Search suppliers') && !document.body.textContent?.includes('Only the receipt record will be saved'), 'Requested notices and fields are removed');
  assert(!document.querySelector('.goods-receipt-panel, .goods-catalog-panel, details'), 'Split panels and catalog toggles removed');
  const table = document.querySelector('.goods-products-table')!;
  const searchField = document.querySelector('.goods-search-field')!;
  assert(document.querySelectorAll('.goods-received-page input[type=search]').length === 1 && searchField.getBoundingClientRect().width <= 321, 'Goods Received has one compact product search bar');
  assert(!!document.querySelector('.goods-received-page > .devices-heading .goods-supplier-select') && !document.querySelector('.goods-unified-card .goods-supplier-select'), 'Supplier selection stays beside the page heading');
  assert(!!(searchField.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(document.querySelector('.goods-supplier-select')!.compareDocumentPosition(searchField) & Node.DOCUMENT_POSITION_FOLLOWING), 'Search is below supplier selection and above products');
  assert(!!(document.querySelector('.goods-category-tabs')!.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING), 'Category tabs are above the product list');
  assert([...document.querySelectorAll('.goods-entry-footer button')].map(node => node.textContent?.trim()).join(',') === 'Cancel,Save', 'Footer has only Cancel and Save');
  assert(!document.body.textContent?.includes('Receipt items') && !document.querySelector('.goods-entry-values'), 'Separate receipt list and entry panel removed');
  assert(!document.body.textContent?.includes('Untracked'), 'Non-stockable products excluded');
  button('Save').click(); await pause(); assert(document.querySelector('[role="alert"]')?.textContent?.includes('at least one product'), 'Products required but supplier is optional');
  assert(![...document.querySelectorAll('button')].some(node => node.textContent?.trim() === 'Add Supplier') && !document.querySelector('.goods-supplier-dialog'), 'Goods Received has no supplier creation UI');
  await setValue(labelled('Supplier (optional)'), existingSupplier.id);
  button('Groceries').click(); await pause(); assert(!document.querySelector('.goods-products-table')?.textContent?.includes('Tea'), 'Category tab filters');
  await setValue(labelled('Search products'), '100003');
  document.querySelector<HTMLButtonElement>('[aria-label="Select product Rice"]')!.click(); await pause();
  const qty = () => document.querySelector<HTMLInputElement>('[aria-label="Received quantity for Rice"]')!;
  assert(qty() && !qty().disabled, 'Selected product is editable directly in the unified list');
  button('All').click(); await pause();
  await setValue(labelled('Search products'), '');
  assert(document.querySelector<HTMLInputElement>('[aria-label="Include Rice"]')!.checked, 'Selection survives filtering');
  assert(document.querySelector<HTMLInputElement>('[aria-label="Received quantity for Tea"]')!.disabled, 'Unselected products are excluded from receipt edits');
  await setValue(qty(), '0'); button('Save').click(); await pause(); assert(posts.length === 0 && document.querySelector('[role="alert"]')?.textContent?.includes('positive'), 'Invalid quantity makes no write');
  await setValue(qty(), '58');
  products[0]!.fields.currentStock = 12;
  assert(![...document.querySelectorAll('button')].some(node => node.textContent?.trim() === 'Refresh stock'), 'Manual stock refresh button is removed');
  window.dispatchEvent(new Event('focus'));
  await until(() => document.querySelector('[aria-label="Current stock for Rice"]')?.textContent === '12', 'fresh saved stock');
  assert(qty().value === '58', 'Refreshing existing stock preserves the receipt quantity');
  products[0]!.fields.currentStock = 13;
  window.dispatchEvent(new Event('focus'));
  await until(() => document.querySelector('[aria-label="Current stock for Rice"]')?.textContent === '13', 'stock refresh on returning to the page');
  assert(document.querySelector('.goods-line-total')!.textContent?.includes('1,334.00') && document.querySelector('.goods-receipt-total')!.textContent?.includes('1,334.00'), 'Quantity times selling price updates line and receipt totals even with zero cost');
  button('Save').click(); await pause(); assert(posts.length === 0 && document.querySelector('dialog[open]'), 'Review precedes write');
  document.querySelector<HTMLButtonElement>('.delete-confirmation-cancel')!.click(); await pause(); assert(qty() && posts.length === 0, 'Cancelling confirmation retains draft and makes no write');
  button('Save').click(); await pause(); document.querySelector<HTMLButtonElement>('.action-confirm-button')!.click();
  await until(() => [...document.querySelectorAll('button')].some(node => node.textContent === 'Retry confirmation'), 'uncertain save');
  assert(saved === 1 && labelled('Supplier (optional)').matches(':disabled'), 'Uncertain save locks form');
  assert(labelled('Supplier (optional)').matches(':disabled'), 'Header supplier selection stays locked while receipt save is unconfirmed');
  assert(JSON.stringify(posts[0].supplier) === JSON.stringify(existingSupplier), 'Existing selected supplier map is submitted unchanged');
  button('Retry confirmation').click(); button('Retry confirmation').click();
  await until(() => document.body.textContent?.includes('Added successfully.') && !document.body.textContent?.includes('Loading outlet'), 'save and refresh');
  assert(saved === 1 && posts.length === 2 && JSON.stringify(posts[0]) === JSON.stringify(posts[1]), 'Lost-response retry uses identical receipt once');
  assert(receipts[0].fields.goodsReceivedNo === '2611051' && receipts[0].fields.goodsReceivedNo !== receipts[0].documentId, 'The same actual bill number survives the uncertain response and reload');
  assert(reads === 2 && !document.body.textContent?.includes('Saved receipts'), 'Receipt data refreshes without displaying saved receipts');
  assert(labelled('Supplier (optional)').value === '', 'Draft clears only after confirmed save');
  assert(products[0].fields.currentStock === 71 && document.querySelector('[aria-label="Current stock for Rice"]')?.textContent === '71' && storageWrites === 0, 'Confirmed receipt refresh displays persisted stock 13 + 58 = 71 without browser storage');
  button('Done').click(); await pause(); document.querySelector<HTMLButtonElement>('[aria-label="Select product Rice"]')!.click(); await pause();
  button('Save').click(); await until(() => document.querySelector('dialog[open]'), 'review without a supplier');
  assert(document.querySelector('.action-popup-question')?.textContent === 'Are you sure you want to add goods receipt?', 'Receipt uses the standard confirmation question');
  document.querySelector<HTMLButtonElement>('.action-confirm-button')!.click();
  await until(() => saved === 2 && !document.body.textContent?.includes('Loading outlet') && !!document.querySelector('.action-success[open]'), 'saved without supplier'); button('Done').click(); await pause();
  assert(posts.at(-1).supplier === null, 'Receipt without supplier sends null instead of fabricating a supplier');
  button('Cancel').click(); assert(cancelled, 'Cancel navigation retained');
  passed.push('authenticated reads, stockable product selection, supplier snapshot, validation, confirmation cancellation, one stock increment on retry, persisted stock refresh, and no direct client stock/storage writes');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ passed, failed: String(error) }); });
