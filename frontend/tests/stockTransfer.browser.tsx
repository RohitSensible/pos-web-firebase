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
  const element = (field?.control ?? field?.querySelector('input, select, textarea')) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
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
  assert(document.querySelectorAll('.st-product-card').length === 6 && !document.querySelector('[data-product-id="false-flag"], [data-product-id="missing-flag"], [data-product-id="string-flag"]'), 'Only existing stockable products are shown');
  assert(![...control('Category').querySelectorAll('option')].some(option => option.textContent === 'Excluded category'), 'Category filter excludes non-stockable products');
  assert(control('Stock Type').value === 'TRANSFER' && control('Stock Type').readOnly, 'Stock type matches existing TRANSFER records and cannot be edited');
  assert(control('Status').value === 'LOCAL PREVIEW' && !document.body.textContent?.includes('COMPLETED'), 'Preview never claims the transfer has completed');
  for (const label of ['Request ID', 'Request Count']) assert(control(label).disabled && control(label).value === 'Not assigned', `${label} is not fabricated`);
  assert(!document.querySelector('#st-audit-title') && !document.body.textContent?.includes('Not recorded'), 'Record audit details section is removed');
  assert(!document.querySelector('textarea') && !document.querySelector('.st-chip'), 'Unsupported note and multiple-destination chips are absent');
  assert(![...document.querySelectorAll('button')].some(node => node.textContent?.includes('Review Transfer')), 'Empty form has no transfer action bar');
  assert(document.querySelector<HTMLInputElement>('[aria-label="Select Turmeric Powder · 100 g"]')!.disabled, 'Products require a destination');
  await setValue(control('From Outlet'), 'anna');
  assert(!document.querySelector('#st-destination option[value=anna]'), 'Source cannot be selected as destination');
  await setValue(control('From Outlet'), 'main');
  await until(() => document.querySelectorAll('.st-product-card').length === 6, 'main stock');
  await setValue(control('To Outlet'), 'anna');
  assert(control('To Outlet').value === 'anna' && !(control('To Outlet') as HTMLSelectElement).multiple, 'One receiving outlet is selected');
  await setValue(control('Product search'), 'SP-001');
  assert(document.querySelectorAll('.st-product-card').length === 1, 'Product search still finds codes');
  await setValue(control('Category'), 'Staples');
  assert(!document.querySelector('.st-product-card'), 'Category and search filters combine');
  await setValue(control('Product search'), ''); await setValue(control('Category'), '');
  document.querySelector<HTMLInputElement>('[aria-label="Select Turmeric Powder · 100 g"]')!.click(); await pause();
  assert(!!quantity() && document.querySelectorAll('.st-allocation').length === 1, 'Selected product has one destination quantity');
  await setValue(quantity(), '100');
  assert(document.querySelector('[data-value=allocated]')?.textContent === '100 units' && document.querySelector('[data-value=remaining]')?.textContent === '0 units', 'Quantity preview retains correct remaining stock');
  await setValue(control('To Outlet'), 'adyar');
  assert(!quantity() && quantity('Adyar').value === '' && document.querySelectorAll('.st-allocation').length === 1, 'Changing destination replaces the old allocation and clears its quantity');
  await setValue(control('To Outlet'), 'anna');
  await setValue(quantity(), '101'); button('Review Transfer').click(); await pause();
  assert(!document.querySelector('dialog[open]') && document.body.textContent!.includes('exceeds available stock'), 'Over-allocation is rejected');
  for (const invalid of ['0', '-1', '1.5', '', 'NaN', 'Infinity', '1e309', '9007199254740992', '1.0000000000000001', '1e1']) {
    await setValue(quantity(), invalid); button('Review Transfer').click(); await pause();
    assert(!document.querySelector('dialog[open]') && quantity().getAttribute('aria-invalid') === 'true', `Invalid quantity ${invalid || '(empty)'} is rejected`);
  }
  await setValue(quantity(), '50'); await setValue(control('Day ID'), '2026-11-03');
  assert(control('Month ID').value === '2026-11' && control('Month ID').readOnly, 'Month ID follows the selected day');
  button('Selected (1)').click(); await pause(); assert(document.querySelectorAll('.st-product-card').length === 1, 'Selected filter remains functional'); button('Selected (1)').click(); await pause();
  button('Review Transfer').click(); await pause();
  assert(document.querySelector('dialog')?.textContent?.includes('TRANSFER') && document.querySelector('dialog')?.textContent?.includes('50 units') && document.querySelector('dialog')?.textContent?.includes('LOCAL PREVIEW'), 'Review shows the stock-log-facing details and local status');
  button('Cancel').click(); await pause(); assert(!!quantity() && !document.querySelector('dialog[open]'), 'Cancelling review preserves the draft');
  button('Review Transfer').click(); await pause(); button('Continue to Confirmation').click(); await pause(); button('Confirm Transfer').click(); await pause();
  assert(document.querySelector('dialog')!.textContent!.includes('Local preview confirmed. No stock was moved or saved to the server.'), 'Confirmation remains explicitly local');
  assert(confirmedPreviews.length === 1 && confirmedPreviews[0].destinations.length === 1 && confirmedPreviews[0].products[0].allocations[0].quantity === 50 && confirmedPreviews[0].note === '', 'Preview contains one outlet and the validated quantity without a fabricated note');
  button('View Stock Transfer Report').click(); await pause(); assert(reportDates[0] === '2026-11-03', 'Existing report navigation retains the preview date');
  button('Review Transfer').click(); await pause(); button('Continue to Confirmation').click(); await pause(); button('Confirm Transfer').click(); await pause();
  assert(confirmedPreviews.length === 2 && confirmedPreviews[1].id === confirmedPreviews[0].id, 'Reconfirming unchanged data retains preview identity'); button('Done').click(); await pause();
  await setValue(control('From Outlet'), 'anna');
  assert(!document.querySelector('.st-product-editor') && control('To Outlet').value === '', 'Source change clears selections and prevents same-outlet transfer');
  await setValue(control('To Outlet'), 'adyar');
  document.querySelector<HTMLInputElement>('[aria-label="Select Turmeric Powder · 100 g"]')!.click(); await pause();
  assert(document.querySelector('.st-added .st-stock')?.textContent?.includes('60'), 'Source change uses the actual source stock');
  button('New Stock Transfer').click(); await pause(); button('Keep Editing').click(); await pause(); assert(control('To Outlet').value === 'adyar', 'Cancelling reset preserves destination');
  button('New Stock Transfer').click(); await pause(); button('Clear Transfer').click(); await pause();
  assert(!document.querySelector('.st-product-editor') && control('To Outlet').value === '' && control('From Outlet').value === 'main', 'Reset clears the local transfer');
  assert(JSON.stringify({ demoHistory, demoProducts }) === original && writeAttempts === 0 && requests.every(path => path === '/api/auth/outlets' || /\/(products|categories)$/.test(path)), 'All interactions preserve stock and use only existing authenticated GET reads');
  for (const theme of ['light', 'dark']) {
    document.documentElement.dataset.theme = theme;
    assert(document.documentElement.scrollWidth <= innerWidth + 2, `${theme}: page fits viewport`);
  }
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
