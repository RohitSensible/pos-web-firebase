import { createRoot } from 'react-dom/client';
import { StockTransferPage } from '../src/pages/StockTransferPage.tsx';
import { demoHistory, demoOutlets, demoProducts } from '../src/pages/stockTransferDemo.ts';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 120; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}`); }
const button = (text: string) => {
  const found = [...(document.querySelector('dialog[open]') ?? document).querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text);
  if (!found) throw new Error(`Missing button: ${text}`); return found;
};
const control = (label: string) => {
  const field = [...document.querySelectorAll('label')].find(node => node.textContent?.trim().startsWith(label));
  const element = field?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea');
  if (!element) throw new Error(`Missing control: ${label}`); return element;
};
async function setValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause();
}
const quantity = (outlet = 'Anna Nagar') => document.querySelector<HTMLInputElement>(`[aria-label="Turmeric Powder · 100 g quantity for ${outlet}"]`)!;
const requests: string[] = [];
let writeAttempts = 0;
window.fetch = async (input, init) => {
  const path = String(input); requests.push(path);
  if (init?.method && init.method !== 'GET') { writeAttempts++; throw new Error(`Unexpected write: ${path}`); }
  if (new Headers(init?.headers).get('Authorization') !== 'Bearer read-token') throw new Error('Missing authorization');
  if (path === '/api/auth/outlets') return Response.json({ success: true, data: { outlets: demoOutlets.map(item => ({ ...item, branch: item.location, active: true })) } });
  const source = decodeURIComponent(path.split('/')[3] ?? '');
  if (!demoOutlets.some(item => item.id === source)) throw new Error(`Unexpected outlet: ${path}`);
  if (path.endsWith('/categories')) return Response.json({ success: true, data: [...new Set(demoProducts.map(product => product.category))].map(name => ({ id: name, name })) });
  if (path.endsWith('/products')) return Response.json({ success: true, data: demoProducts.map(product => ({ documentId: product.id, fields: { name: product.name, code: product.code, stockable: product.stockable, category: product.category, currentStock: product.stocks[demoOutlets.findIndex(item => item.id === source)] } })) });
  throw new Error(`Unexpected read: ${path}`);
};
const onSessionExpired = () => { throw new Error('Unexpected session expiry'); };
// Include excluded product shapes in this isolated browser fixture.
const fixtureProduct = { name: 'Untracked sample', category: 'Excluded category', code: 'EX-001', stocks: [10, 10, 10, 10] };
const stringFlagProduct = { ...fixtureProduct, id: 'string-flag', stockable: true };
Reflect.set(stringFlagProduct, 'stockable', 'true');
demoProducts.push({ ...fixtureProduct, id: 'false-flag', stockable: false }, { ...fixtureProduct, id: 'missing-flag' }, stringFlagProduct);
const confirmedPreviews: import('../src/pages/stockTransferPreviews.ts').StockTransferPreview[] = [];
const reportDates: string[] = [];
const original = JSON.stringify({ demoHistory, demoProducts });
document.documentElement.dataset.theme = 'light';
document.body.style.background = 'var(--workspace)'; document.body.style.padding = '20px';
createRoot(document.getElementById('root')!).render(<StockTransferPage outlet={{ id: 'main', name: 'Main Outlet' } as OutletSummary} token="read-token" onSessionExpired={onSessionExpired} onPreviewConfirmed={preview => confirmedPreviews.push(preview)} onViewReport={date => reportDates.push(date)} />);
void (async () => {
  await until(() => document.querySelector('.st-product-card'), 'loaded products');
  assert(document.querySelectorAll('.st-product-card').length === 6 && !document.querySelector('[data-product-id="false-flag"], [data-product-id="missing-flag"], [data-product-id="string-flag"]'), 'Only products with stockable boolean true are displayed; false, missing and string values are excluded');
  assert(![...control('Category').querySelectorAll('option')].some(option => option.textContent === 'Excluded category'), 'Category filter excludes categories containing only non-stockable products');
  assert(!document.querySelector('.st-metrics, #st-summary-title, #st-history-title, .st-product-editor') && !document.body.textContent!.includes('No products added yet'), 'Summary cards, summary panel, history and empty allocations are removed');
  assert(![...document.querySelectorAll('button')].some(node => node.textContent?.includes('Review Transfer')), 'Empty form has no transfer action bar');
  assert(document.querySelector<HTMLInputElement>('[aria-label="Select Turmeric Powder · 100 g"]')!.disabled, 'Products require a destination before quantity selection');
  await setValue(control('Source Outlet'), 'anna');
  assert(!document.querySelector('#st-destination option[value=anna]'), 'Selected source is excluded from destination choices');
  await setValue(control('Source Outlet'), 'main');
  await setValue(document.getElementById('st-destination') as HTMLSelectElement, 'anna');
  await setValue(document.getElementById('st-destination') as HTMLSelectElement, 'adyar');
  assert(document.querySelectorAll('.st-chip').length === 2 && !document.querySelector('#st-destination option[value=anna]'), 'Multiple destinations appear as chips and duplicates are excluded');
  await setValue(control('Product search'), 'SP-001');
  assert(document.querySelectorAll('.st-product-card').length === 1, 'Search finds a product by code');
  await setValue(control('Category'), 'Staples');
  assert(!document.querySelector('.st-product-card') && document.body.textContent!.includes('No products match'), 'Category combines with search and shows empty results');
  await setValue(control('Product search'), '');
  assert(document.querySelectorAll('.st-product-card').length === 2, 'Category filter shows matching products');
  await setValue(control('Category'), '');
  document.querySelector<HTMLInputElement>('[aria-label="Select Turmeric Powder · 100 g"]')!.click(); await pause();
  await until(() => quantity(), 'allocation inputs');
  assert(document.querySelectorAll('.st-product-card.st-added').length === 1 && quantity(), 'Checking a product immediately reveals its quantity inputs without an Add Product step');
  document.querySelector<HTMLInputElement>('[aria-label="Select Turmeric Powder · 100 g"]')!.click(); await pause();
  assert(!quantity(), 'Unchecking a product removes its quantity inputs');
  document.querySelector<HTMLInputElement>('[aria-label="Select Turmeric Powder · 100 g"]')!.click(); await pause();
  await setValue(quantity(), '50'); await setValue(quantity('Adyar'), '50');
  const active = document.querySelector('.st-product-card.st-added')!;
  assert(active.querySelector('.st-stock')!.textContent!.includes('100') && active.querySelector('[data-value=allocated]')!.textContent === '100 units' && active.querySelector('[data-value=remaining]')!.textContent === '0 units', '50 + 50 allocates 100 units and leaves zero stock');
  assert(active.querySelector('.st-readiness.ready'), 'Valid product allocation gets a Ready indicator');
  button('Selected (1)').click(); await pause();
  assert(document.querySelectorAll('.st-product-card').length === 1, 'Selected filter keeps chosen products and their quantity fields together');
  button('Selected (1)').click(); await pause();
  await setValue(document.getElementById('st-destination') as HTMLSelectElement, 'velachery');
  assert(document.querySelector('[aria-label="Turmeric Powder · 100 g quantity for Velachery"]'), 'Adding an outlet immediately adds its quantity field to selected products');
  document.querySelector<HTMLButtonElement>('[aria-label="Remove destination Velachery"]')!.click(); await pause();
  assert(document.documentElement.scrollWidth <= innerWidth + 2, 'Product allocations fit the viewport with active destination inputs');
  assert(quantity('Adyar').parentElement!.getBoundingClientRect().width <= 162 && quantity('Adyar').getAttribute('aria-describedby'), 'Quantity controls are compact and connected to destination capacity guidance');
  await setValue(quantity('Adyar'), '51'); button('Review Transfer').click(); await pause();
  assert(!document.querySelector('dialog[open]') && document.body.textContent!.includes('exceeds available stock'), 'Combined over-allocation is rejected before review');
  await setValue(quantity('Adyar'), '-1');
  assert(quantity().getAttribute('aria-invalid') === 'false' && quantity('Adyar').getAttribute('aria-invalid') === 'true', 'Invalid quantities identify only the affected destination');
  assert(active.querySelector('[data-value=remaining]')!.textContent === 'Enter valid quantities' && !active.textContent!.includes('101 units'), 'Invalid quantities cannot increase the displayed remaining source balance');
  for (const invalid of ['0', '-1', '1.5', '', 'NaN', 'Infinity', '1e309', '9007199254740992', '1.0000000000000001', '1e1']) {
    await setValue(quantity('Adyar'), invalid); button('Review Transfer').click(); await pause();
    assert(!document.querySelector('dialog[open]') && quantity('Adyar').getAttribute('aria-invalid') === 'true', `Invalid quantity ${invalid || '(empty)'} is rejected`);
  }
  await setValue(quantity('Adyar'), '50');
  assert(quantity('Adyar').getAttribute('aria-invalid') === 'false' && quantity().getAttribute('aria-invalid') === 'false', 'Correcting quantities clears destination errors');
  document.querySelector<HTMLButtonElement>('[aria-label="Remove Adyar allocation for Turmeric Powder · 100 g"]')!.click(); await pause();
  assert(!quantity('Adyar') && document.querySelector('[data-value=allocated]')?.textContent === '50 units', 'Removing a per-product allocation recalculates totals');
  await setValue(document.querySelector<HTMLSelectElement>('[aria-label="Add destination allocation for Turmeric Powder · 100 g"]')!, 'adyar');
  await setValue(quantity('Adyar'), '50');
  await setValue(control('Transfer Note'), 'Weekly restock'); await setValue(control('Transfer Date'), '2026-11-03');
  button('Review Transfer').click(); await until(() => document.querySelector('dialog[open]'), 'review');
  assert(document.querySelector('dialog')!.textContent!.includes('Estimated remaining source stock: 0 units') && document.querySelector('dialog')!.textContent!.includes('Weekly restock'), 'Review includes note, available stock, destination quantities and remaining stock');
  button('Cancel').click(); await pause();
  assert(!document.querySelector('dialog[open]'), 'Review cancellation returns to editing');
  button('Review Transfer').click(); await pause(); button('Continue to Confirmation').click(); await pause();
  assert(document.querySelector('dialog')!.textContent!.includes('No stock will be moved or saved to the server'), 'Final confirmation explicitly describes demonstration behavior');
  button('Back to Review').click(); await pause(); button('Continue to Confirmation').click(); await pause(); button('Confirm Transfer').click(); await pause();
  assert(document.querySelector('dialog')!.textContent!.includes('Local preview confirmed. No stock was moved or saved to the server.'), 'Confirm shows only the requested demonstration feedback');
  assert(confirmedPreviews.length === 1 && confirmedPreviews[0].products[0].allocations.every(item => item.quantity === 50), 'Confirmation emits a local session preview with validated quantities');
  button('View Stock Transfer Report').click(); await pause();
  assert(reportDates[0] === '2026-11-03', 'Report callback receives the confirmed preview date');
  button('Review Transfer').click(); await pause(); button('Continue to Confirmation').click(); await pause(); button('Confirm Transfer').click(); await pause();
  assert(confirmedPreviews.length === 2 && confirmedPreviews[1].id === confirmedPreviews[0].id, 'Reconfirming unchanged allocations preserves the session preview identity');
  button('Done').click(); await pause();
  assert(JSON.stringify({ demoHistory, demoProducts }) === original, 'Confirmation leaves fixtures and stock unchanged');
  document.querySelector<HTMLButtonElement>('[aria-label="Remove destination Adyar"]')!.click(); await pause();
  assert(!quantity('Adyar'), 'Removing a destination chip also removes its product allocations');
  await setValue(control('Source Outlet'), 'anna');
  assert(!document.querySelector('.st-product-editor') && !document.querySelector('.st-chip'), 'Source changes clear old stock allocations and exclude the source from selected destinations');
  await setValue(document.getElementById('st-destination') as HTMLSelectElement, 'adyar');
  document.querySelector<HTMLInputElement>('[aria-label="Select Turmeric Powder · 100 g"]')!.click(); await pause();
  assert(document.querySelector('.st-product-card.st-added .st-stock')!.textContent!.includes('60'), 'Sample available stock changes with the source outlet');
  document.querySelector<HTMLButtonElement>('[aria-label="Remove product Turmeric Powder · 100 g"]')!.click(); await pause();
  assert(!document.querySelector('.st-product-editor'), 'Products can be removed');
  button('New Stock Transfer').click(); await pause(); button('Keep Editing').click(); await pause();
  assert(document.querySelector('.st-chip'), 'Cancelling reset preserves the form');
  button('New Stock Transfer').click(); await pause(); button('Clear Transfer').click(); await pause();
  assert(!document.querySelector('.st-chip') && control('Source Outlet').value === 'main', 'New transfer clears local form after confirmation');
  assert(writeAttempts === 0 && requests.includes('/api/auth/outlets') && requests.includes('/api/outlets/main/products') && requests.includes('/api/outlets/anna/products') && requests.every(path => path === '/api/auth/outlets' || /\/(products|categories)$/.test(path)), 'The entire UI flow uses only authenticated existing GET reads and never submits transfers');
  for (const theme of ['light', 'dark']) {
    document.documentElement.dataset.theme = theme;
    const page = document.querySelector<HTMLElement>('.stock-transfer-page')!;
    assert(page.scrollWidth <= page.clientWidth + 2 && document.documentElement.scrollWidth <= innerWidth + 2, `${theme}: page fits the viewport`);
  }
  if (location.hash === '#preview') {
    document.documentElement.dataset.theme = 'light';
    await setValue(document.getElementById('st-destination') as HTMLSelectElement, 'anna'); await setValue(document.getElementById('st-destination') as HTMLSelectElement, 'adyar');
    document.querySelector<HTMLInputElement>('[aria-label="Select Turmeric Powder · 100 g"]')!.click(); await pause();
    await setValue(quantity(), '50'); await setValue(quantity('Adyar'), '50');
    if (innerWidth < 620) document.querySelector('.st-product-card.st-added')!.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
  }
  document.getElementById('test-results')!.style.display = 'none';
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
