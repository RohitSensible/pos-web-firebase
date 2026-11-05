import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ReactNode } from 'react';
import { OutletSelectionPage, type OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import { CategoryPage } from '../src/pages/CategoryPage.tsx';
import { CustomersPage } from '../src/pages/CustomersPage.tsx';
import { EmployeesPage } from '../src/pages/EmployeesPage.tsx';
import { PremisesPage } from '../src/pages/PremisesPage.tsx';
import { SuppliersPage } from '../src/pages/SuppliersPage.tsx';
import { DevicesPage } from '../src/pages/DevicesPage.tsx';
import { GoodsReceivedPage } from '../src/pages/GoodsReceivedPage.tsx';
import { StockTransferPage } from '../src/pages/StockTransferPage.tsx';
import { ProductFlagsBulkUpdate } from '../src/pages/ProductFlagsBulkUpdate.tsx';
import { ProductPriceBulkUpdate } from '../src/pages/ProductPriceBulkUpdate.tsx';
import { ProductCategoryPicker } from '../src/pages/ProductCategoryPicker.tsx';
import '../src/index.css';
import '../src/App.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(); } throw new Error(`${message}: ${document.body.textContent?.slice(-500)}`); }
const mobile = matchMedia('screen and (max-width:600px), screen and (max-width:1024px) and (max-height:500px)').matches;
const names = ['Plain Roti', 'Roti Roll', 'Roti'];
const products = names.map((name, index) => ({ documentId: `p${index}`, fields: { name, code: index + 1, barcode: index === 2 ? '012345' : `012345${index}`, category: 'c0', currentStock: 20, stockable: true, price: 50, costPrice: 20, priceTable: '{"default price":50}' } }));
const originals = JSON.stringify(products);
const categories = names.map((name, index) => ({ id: `c${index}`, name, categoryNo: index + 1, regionalName: '', active: true, productCount: 0 }));
const customers = names.map((name, index) => ({ documentId: `c${index}`, name, contact: `900000000${index}`, altContact: '', email: '', gstNo: '', address: '', creditLimit: 0, dayLimit: 0, balance: 0, birthdayDate: '', anniversaryDate: '', allowedCredit: false }));
const suppliers = names.map((name, index) => ({ id: `s${index}`, name, mobile: `900000000${index}`, alternateNumber: '', email: '', gstin: '', address: '' }));
const outlet = { id: 'smart', name: 'Shop', branch: '', active: true } as OutletSummary;
const session = { id: 'user', name: 'User', email: '', role: 'Admin', terminal: 'POS', token: 'token' };
let selectedOutlet = '', reads = 0;
window.fetch = async (input, init) => {
  assert(!init?.method || init.method === 'GET', 'Fixture permits only mocked reads'); reads++;
  const path = new URL(String(input), location.href).pathname;
  if (path.endsWith('/master-sync')) return new Response('', { status: 404 });
  let data: unknown;
  if (path === '/api/auth/outlets') data = { outlets: names.map((name, index) => ({ ...outlet, id: index ? `branch${index}` : 'smart', name })) };
  else if (path.endsWith('/products')) data = products;
  else if (path.endsWith('/categories')) data = categories;
  else if (path.endsWith('/customers')) data = { customers };
  else if (path.endsWith('/employees')) data = { employees: names.map((name, index) => ({ documentId: `e${index}`, name, mobile: '', searchCode: index + 1, shortName: '', balanceAmt: '0', dateOfJoining: '', userId: '' })), userAccounts: [], nextSearchCode: 4 };
  else if (path.endsWith('/premises')) data = { premises: names.map((name, index) => ({ documentId: `r${index}`, fields: { name, code: index + 1, type: 'Table', tables: 1, range: 1, price: 0 } })), nextCode: 4, taxes: [], userAccounts: [] };
  else if (path.endsWith('/devices')) data = { outletName: 'Shop', devices: names.map((deviceId, index) => ({ documentId: `d${index}`, outletName: 'Shop', deviceId, active: true })) };
  else if (path.endsWith('/goods-received')) data = { documentId: 'R'.repeat(20), supplierDraftId: 'D'.repeat(20), suppliers, receipts: [] };
  else throw new Error(`Unexpected mock URL ${path}`);
  return Response.json({ success: true, data });
};
const root = createRoot(document.getElementById('root')!);
const props = { outlet, token: 'token', onSessionExpired: () => { throw new Error('Unexpected expiry'); } };
const noAction = () => {};
let key = 0;
async function mount(view: ReactNode, ready: string) {
  flushSync(() => root.render(<div key={++key}>{view}</div>));
  await until(() => document.querySelector(ready), ready);
}
async function query(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  assert(!!input, 'Existing search input is available');
  flushSync(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await pause();
}
function firstName(selector: string) { return document.querySelector(selector)?.textContent?.trim(); }
async function check(view: ReactNode, selector: string, label: string) {
  await mount(view, selector); await pause(); const before = reads;
  await query('Roti');
  assert(firstName(selector) === (mobile ? 'Roti' : 'Plain Roti'), `${label}: relevance is mobile-only`);
  assert(reads === before, `${label}: typing adds no API requests`);
  if (mobile) { await query('  rOtI   '); assert(firstName(selector) === 'Roti', `${label}: case and spaces are normalized`); }
  await query(''); assert(firstName(selector) === 'Plain Roti', `${label}: clearing restores default order`);
}

void (async () => {
  await check(<OutletSelectionPage session={session} onSelect={value => { selectedOutlet = value.id; }} onLogout={noAction} />, '.outlet-card h2', 'Outlets');
  await query('Roti'); document.querySelector<HTMLButtonElement>('.outlet-card button')?.click();
  if (mobile) assert(selectedOutlet === 'branch2', 'Selecting the exact outlet preserves its ID');
  await check(<ProductsPage {...props} />, '.products-name', 'Products');
  if (mobile) { await query('012345'); assert(firstName('.products-name') === 'Roti', 'Exact barcode beats barcode prefixes'); }
  await check(<CategoryPage {...props} />, '.category-title-text', 'Categories');
  await check(<CustomersPage {...props} />, '.master-row-title strong', 'Customers');
  await query('Roti'); document.querySelector<HTMLButtonElement>('.master-row-main')!.click();
  await until(() => document.querySelector('#customer-name'), 'Customer form');
  assert(document.querySelector<HTMLInputElement>('#customer-name')!.value === (mobile ? 'Roti' : 'Plain Roti'), 'Customer edit opens the correct ranked record');
  await check(<EmployeesPage {...props} />, '.employees-table-scroll .mobile-record-name', 'Employees');
  await check(<PremisesPage {...props} />, '.master-row-title strong', 'Premises');
  await check(<SuppliersPage {...props} />, '.mobile-record-name', 'Suppliers');
  await query('Roti'); document.querySelector<HTMLButtonElement>('[aria-label^="Edit supplier"]')!.click();
  await until(() => document.querySelector('.goods-supplier-form-grid input'), 'Supplier form');
  assert(document.querySelector<HTMLInputElement>('.goods-supplier-form-grid input')!.value === (mobile ? 'Roti' : 'Plain Roti'), 'Supplier edit opens the correct ranked record');
  await check(<DevicesPage {...props} />, 'tbody [data-label="Device ID"] > span', 'Devices');
  await check(<GoodsReceivedPage {...props} onCancel={noAction} />, '.goods-product-select', 'Goods receipt');
  await query('Roti'); document.querySelector<HTMLInputElement>('.goods-row-checkbox')!.click(); await pause();
  assert(!!document.querySelector('input[aria-label^="Received quantity"]:not(:disabled)'), 'Ranked goods receipt products remain selectable');
  await check(<StockTransferPage {...props} />, '.st-product-name strong', 'Stock transfers');
  await check(<ProductFlagsBulkUpdate products={products} outletId="smart" token="token" onClose={noAction} onSaved={noAction} onSessionExpired={noAction} />, '.products-name', 'Bulk flags');
  await check(<ProductPriceBulkUpdate products={products} outletId="smart" token="token" onClose={noAction} onSaved={noAction} onSessionExpired={noAction} />, '.products-name', 'Bulk prices');
  let selected: string[] = [];
  await mount(<ProductCategoryPicker products={products.map((product, index) => ({ ...product, fields: { ...product.fields, category: index === 2 ? 'exact' : 'partial' } }))} categories={[{ id: 'partial', name: 'First category' }, { id: 'exact', name: 'Last category' }]} selected={selected} max={50} search="Roti" disabled={false} outletId="smart" token="token" onSessionExpired={noAction} onChange={value => { selected = value; }} />, '.category-picker-product strong');
  assert(firstName('.category-picker-product strong') === (mobile ? 'Roti' : 'Plain Roti'), 'Image-product picker ranks groups and products without flattening categories');
  document.querySelector<HTMLInputElement>('.category-picker-items input')!.click();
  assert(selected[0] === (mobile ? 'p2' : 'p0'), 'Image-product selection retains the original product ID');
  assert(JSON.stringify(products) === originals, 'All source product values remain unchanged');
  if (location.hash === '#resize') {
    await mount(<ProductsPage {...props} />, '.products-name');
    await query('Roti');
    const category = document.querySelector<HTMLSelectElement>('[aria-label="Filter by category"]')!;
    flushSync(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(category, 'c0'); category.dispatchEvent(new Event('change', { bubbles: true })); });
    const beforeResize = reads;
    document.body.dataset.searchResize = 'desktop';
    await until(() => innerWidth === 1280, 'Desktop resize'); await pause();
    assert(firstName('.products-name') === 'Plain Roti', 'Resizing to desktop restores the existing sort');
    assert(document.querySelector<HTMLInputElement>('input[type="search"]')!.value === 'Roti' && document.querySelector<HTMLSelectElement>('[aria-label="Filter by category"]')!.value === 'c0', 'Resizing preserves query and category state');
    document.body.dataset.searchResize = 'mobile';
    await until(() => innerWidth === 390, 'Phone resize'); await pause();
    assert(firstName('.products-name') === 'Roti', 'Resizing back to mobile restores exact-match priority');
    assert(reads === beforeResize, 'Viewport changes cause no API requests');
  }
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, mobile, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
