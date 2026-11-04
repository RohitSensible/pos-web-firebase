import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import { LoginPage } from '../src/pages/LoginPage.tsx';
import { OutletSelectionPage } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';

const checks: string[] = [];
const phoneViewport = matchMedia('(max-width: 820px), (max-width: 1024px) and (max-height: 600px)').matches;
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 180; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}: ${document.body.textContent?.slice(-700)}`); }
const session = { id: 'phone-user', name: 'Phone User', email: 'phone@example.com', role: 'Admin', terminal: 'POS', token: 'phone-token' };
const outlet = { id: 'shop', name: 'Sensible Biz Test Outlet', branch: 'Phone layout', active: true };
const product = { documentId: 'p', fields: { name: 'Product with a longer name', code: 1, price: 20, costPrice: 10, category: 'c', stockable: true, currentStock: 12, taxIndex: 1, unitId: 2 } };
const supplier = { id: 's', name: 'Supplier with a longer company name', mobile: '9876543210', email: 'supplier@example.com', address: 'A long supplier address for mobile screens', gstin: '', alternateNumber: null };
const requests: string[] = [];
const assetFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  assert(!init?.method || init.method === 'GET', 'Phone layout checks never write data');
  const path = new URL(String(input), location.origin).pathname; requests.push(path);
  if (path.endsWith('/master-sync')) return new Response('', { status: 404 });
  let data: unknown;
  if (path === '/api/auth/outlets') data = { outlets: [outlet, { ...outlet, id: 'branch', name: 'Second Outlet' }] };
  else if (path.endsWith('/dashboard')) data = { id: 'overall', dayId: '2026-11-04', shiftNo: 1, totalSale: 0, payments: {}, shifts: [] };
  else if (path.endsWith('/profile')) data = { name: session.name, role: session.role, outletName: outlet.name, mobile: '' };
  else if (path.endsWith('/products')) data = [product];
  else if (path.endsWith('/categories')) data = [{ id: 'c', categoryNo: 1, name: 'Food and beverages with a long category name', regionalName: 'खाद्यपदार्थ', active: true, createdAt: '2026-11-04', productCount: 1 }];
  else if (path.endsWith('/edit-options') || path.endsWith('/create-options')) data = { code: 1, categories: [{ id: 'c', name: 'Food and beverages' }], taxes: [], units: [{ id: 2, name: 'Number' }], premises: [], product, servicePoints: [] };
  else if (path.endsWith('/service-points')) data = { servicePoints: [{ documentId: 'sp', name: 'Kitchen and counter with a longer name', paperSize: 3, printerType: 1, header: 'Long header for the receipt', subHeader: '', footer: 'Thank you for visiting', printerIpAddress: '', port: null, usbPath: null }] };
  else if (path.endsWith('/customers')) data = { customers: [{ documentId: 'customer', name: 'Customer with a long name', contact: '9876543210', altContact: '', email: '', gstNo: '', address: '', creditLimit: 0, dayLimit: 0, balance: 0, birthdayDate: '', anniversaryDate: '', allowedCredit: false }] };
  else if (path.endsWith('/employees')) data = { employees: [{ documentId: 'employee', name: 'Employee with a long name', mobile: '9876543210', searchCode: 1, shortName: '', balanceAmt: '0', dateOfJoining: '2026-11-04', userId: '' }], nextSearchCode: 2, userAccounts: [] };
  else if (path.endsWith('/premises')) data = { premises: [{ documentId: 'premise', fields: { name: 'Main dining area with a long name', code: 1, type: 'Table', tables: 15, range: 1, price: 0 } }], nextCode: 2, taxes: [], userAccounts: [] };
  else if (path.endsWith('/devices')) data = { outletName: outlet.name, devices: [{ documentId: 'device', outletName: outlet.name, deviceId: 'A-very-long-device-identifier-for-phone-layout-checking-1234567890', active: true }] };
  else if (path.endsWith('/goods-received')) data = { documentId: 'R'.repeat(20), supplierDraftId: 'D'.repeat(20), suppliers: [supplier], receipts: [] };
  else if (path.endsWith('/reports/stock-transfers')) data = { transfers: [], summary: { totalTransfers: 0, totalProducts: 0, totalQuantity: 0, totalAmount: 0 } };
  else throw new Error(`Unexpected phone fixture request: ${path}`);
  return Response.json({ success: true, data });
};
const root = createRoot(document.getElementById('root')!);
const login = () => <LoginPage onLoginSuccess={() => { throw new Error('Layout check must not sign in'); }} />;
function fits(selector: string, label: string) {
  const element = document.querySelector<HTMLElement>(selector)!;
  assert(!!element, `${label} is displayed`);
  const rect = element.getBoundingClientRect();
  if (rect.left < -1 || rect.right > document.documentElement.clientWidth + 1 || element.scrollWidth > element.clientWidth + 1) {
    const overflow = [...element.querySelectorAll<HTMLElement>('*')].filter(node => node.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(node).position !== 'absolute').slice(0, 8).map(node => `${node.tagName}.${node.className}: ${Math.round(node.getBoundingClientRect().width)}`);
    throw new Error(`${label} overflow: width=${rect.width}, scroll=${element.scrollWidth}, viewport=${document.documentElement.clientWidth}; ${overflow.join(', ')}`);
  }
  assert(rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1 && element.scrollWidth <= element.clientWidth + 1, `${label} fits the phone width`);
}
function mobileRecords(selector: string, label: string) {
  if (!phoneViewport) return;
  fits(selector, label);
  const table = document.querySelector<HTMLElement>(selector)!;
  for (const cell of table.querySelectorAll<HTMLElement>('tbody td')) {
    const bounds = cell.getBoundingClientRect();
    assert(bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth + 1 && cell.scrollWidth <= cell.clientWidth + 1, `${label} fields fit without horizontal scrolling`);
  }
  for (const button of table.querySelectorAll<HTMLElement>('.mobile-record-actions button')) {
    const bounds = button.getBoundingClientRect();
    assert(bounds.width > 0 && bounds.height >= 44 && bounds.right <= document.documentElement.clientWidth + 1, `${label} actions are visible and easy to tap`);
  }
}
async function navigate(group: string, page: string, ready: string) {
  const toggle = document.querySelector<HTMLButtonElement>('.mobile-menu')!;
  if (getComputedStyle(toggle).display !== 'none' && !document.querySelector('.dashboard-sidebar.open')) { toggle.click(); await pause(); }
  const section = [...document.querySelectorAll('.nav-group')].find(node => node.querySelector('.nav-group-title')?.textContent?.trim() === group)!;
  if (!section.querySelector('.nav-group-items')) { section.querySelector<HTMLButtonElement>('.nav-group-title')!.click(); await pause(); }
  if (group === 'Masters') {
    const items = [...section.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].map(button => button.textContent?.trim());
    assert(items.indexOf('Products') === items.indexOf('Category') + 1, 'Sidebar lists Products immediately below Category');
  }
  [...section.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(node => node.textContent?.trim() === page)!.click();
  await until(() => document.querySelector(ready), page);
  fits('.dashboard-workspace', page);
  assert(!document.querySelector('.dashboard-sidebar.open'), 'Navigation closes the phone drawer');
  const add = document.querySelector<HTMLElement>('.mobile-add-trigger');
  if (phoneViewport && add) {
    const bounds = add.getBoundingClientRect();
    assert(getComputedStyle(add).position === 'fixed' && bounds.width === 56 && bounds.right <= document.documentElement.clientWidth + 1 && bounds.bottom <= innerHeight - 10 && bounds.bottom >= innerHeight - 100 && getComputedStyle(add.querySelector('.mobile-add-label')!).display === 'none', `${page} uses a floating plus with an accessible name`);
  }
}
void (async () => {
  const manifestResponse = await assetFetch('/manifest.webmanifest');
  const manifest = await manifestResponse.json();
  assert(manifestResponse.ok && manifest.name === 'Sensible Biz' && manifest.short_name === 'Sensible Biz' && manifest.display === 'standalone', 'Home-screen manifest supplies the Sensible Biz name and standalone display');
  const homeIcon = new Image(); homeIcon.src = '/apple-touch-icon.png'; await homeIcon.decode();
  assert(homeIcon.naturalWidth === 180 && homeIcon.naturalHeight === 180, 'Apple home-screen icon loads at its declared size');
  localStorage.clear(); root.render(login());
  await until(() => document.querySelector('#crm-email'), 'login');
  fits('.crm-login-shell', 'Sign-in');
  const form = document.querySelector<HTMLElement>('.crm-login-form-panel')!.getBoundingClientRect();
  const promo = document.querySelector<HTMLElement>('.crm-login-promo')!.getBoundingClientRect();
  if (phoneViewport) {
    assert(form.top < promo.top, 'Phone sign-in appears before the large illustration');
    assert(getComputedStyle(document.querySelector('#crm-email')!).fontSize === '16px', 'Phone sign-in inputs avoid automatic focus zoom');
    assert(document.querySelector<HTMLElement>('.crm-sign-in-button')!.getBoundingClientRect().height >= 44, 'Sign-in is easy to tap');
  }
  assert(requests.length === 0, 'Displaying sign-in performs no API requests');
  await until(() => document.querySelector<HTMLImageElement>('.crm-brand-crop img')?.naturalWidth, 'existing Sensible logo');
  assert(document.querySelector<HTMLImageElement>('.crm-brand-crop img')!.naturalWidth === 717, 'Existing Sensible brand artwork is retained');
  root.render(<OutletSelectionPage session={session} onSelect={() => {}} onLogout={() => {}} />);
  await until(() => document.querySelector('.outlet-card'), 'outlet selection'); fits('.outlet-selection-content', 'Outlet selection');
  localStorage.setItem('pos_user_session', JSON.stringify(session)); localStorage.setItem('pos_selected_outlet', JSON.stringify(outlet));
  root.render(<App />); await until(() => document.querySelector('.page-hero'), 'dashboard');
  fits('.retail-header', 'Header'); fits('.dashboard-workspace', 'Dashboard');
  if (phoneViewport) assert(getComputedStyle(document.querySelector('.mobile-menu')!).display !== 'none', 'Phone navigation drawer is available in this orientation');
  await navigate('Masters', 'Products', '.products-table-card');
  mobileRecords('.products-table', 'Products');
  if (phoneViewport) assert(getComputedStyle(document.querySelector('.products-category-tabs')!).display === 'none' && !!document.querySelector('[aria-label="Filter by category"]'), 'Phone hides duplicate category chips while retaining the category filter');
  else assert(getComputedStyle(document.querySelector('.products-category-tabs')!).display !== 'none' && getComputedStyle(document.querySelector('.products-table')!).display === 'table', 'Desktop keeps category chips and the existing product table');
  document.querySelector<HTMLButtonElement>('[aria-label="Delete product"]')!.click();
  await until(() => document.querySelector('dialog[open]'), 'product delete confirmation');
  [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find(button => button.textContent?.trim() === 'Cancel')!.click();
  await until(() => !document.querySelector('dialog[open]'), 'cancel product deletion');
  document.querySelector<HTMLButtonElement>('[aria-label="Edit product"]')!.click();
  await until(() => document.querySelector<HTMLSelectElement>('#product-category')?.disabled === false, 'product editor'); fits('.add-product-modal', 'Product editor');
  if (phoneViewport) {
    const update = document.querySelector<HTMLButtonElement>('.product-mobile-save')!;
    assert(getComputedStyle(update).display !== 'none' && !update.disabled && update.getBoundingClientRect().height >= 44, 'Phone product editor has an enabled top Update button');
    window.scrollTo(0, 600); await pause();
    const bounds = update.getBoundingClientRect(), header = document.querySelector('.retail-header')!.getBoundingClientRect();
    assert(bounds.top >= header.bottom - 1 && bounds.bottom <= innerHeight, 'Top Update remains visible below the app header while scrolling');
    window.scrollTo(0, 0); await pause();
  } else assert(getComputedStyle(document.querySelector('.product-mobile-save')!).display === 'none', 'Desktop product editor keeps its existing footer save controls');
  document.querySelector<HTMLButtonElement>('[aria-label="Close edit product"]')!.click(); await until(() => !document.querySelector('.add-product-modal'), 'close product');
  document.querySelector<HTMLButtonElement>('.products-add')!.click(); await until(() => document.querySelector('.add-product-modal'), 'new product');
  if (phoneViewport) assert(document.querySelector('.product-mobile-save')?.textContent === 'Save', 'New product editor also has a top Save button');
  document.querySelector<HTMLButtonElement>('[aria-label="Close add product"]')!.click(); await until(() => !document.querySelector('.add-product-modal'), 'close new product');
  await navigate('Masters', 'Category', '.category-table');
  await until(() => document.querySelector('[aria-label="Edit category"]'), 'category records'); mobileRecords('.category-table', 'Categories');
  document.querySelector<HTMLButtonElement>('[aria-label="Delete category"]')!.click(); await until(() => document.querySelector('dialog[open]'), 'category delete confirmation');
  [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find(button => button.textContent?.trim() === 'Cancel')!.click(); await until(() => !document.querySelector('dialog[open]'), 'cancel category deletion');
  document.querySelector<HTMLButtonElement>('[aria-label="Edit category"]')!.click(); await until(() => document.querySelector('.category-edit-page'), 'edit category'); fits('.category-edit-page', 'Category editor');
  document.querySelector<HTMLButtonElement>('[aria-label="Close edit category"]')!.click(); await until(() => !document.querySelector('.category-edit-page'), 'close category editor');
  await navigate('Masters', 'Customer', '.customers-page');
  await until(() => document.querySelector('.master-row'), 'customer records'); fits('.master-row', 'Customer card'); fits('.master-row-actions', 'Customer actions');
  document.querySelector<HTMLButtonElement>('.master-row-main')!.click(); await until(() => document.querySelector('.customer-form-page'), 'customer form'); fits('.customer-form-page', 'Customer editor');
  if (phoneViewport) {
    const footer = document.querySelector<HTMLElement>('.customer-form-page .modal-footer')!;
    assert(getComputedStyle(footer).position === 'sticky', 'Long master forms keep save actions attached to the bottom of the phone');
    fits('.customer-form-page .modal-footer', 'Customer save actions');
  }
  document.querySelector<HTMLButtonElement>('[aria-label="Close customer form"]')!.click(); await until(() => !document.querySelector('.customer-form-page'), 'close customer form');
  await navigate('Masters', 'Suppliers', '[aria-label="Suppliers"]');
  mobileRecords('[aria-label="Suppliers"] table', 'Suppliers');
  await navigate('Masters', 'Service Point', '.service-points-table'); mobileRecords('.service-points-table table', 'Service points');
  await navigate('Masters', 'Employees/Salesman', '.employees-table-scroll'); mobileRecords('.employees-table-scroll table', 'Employees');
  await navigate('Masters', 'Premises', '.premises-list'); fits('.master-row', 'Premise card'); fits('.master-row-actions', 'Premise actions');
  await navigate('Operations', 'Device', '.devices-table-scroll'); mobileRecords('.devices-table-scroll table', 'Devices');
  await navigate('Masters', 'Goods Received', '.goods-products-table');
  mobileRecords('.goods-products-table table', 'Goods received cards');
  if (phoneViewport) {
    assert(getComputedStyle(document.querySelector('.goods-category-tabs')!).display === 'none' && getComputedStyle(document.querySelector('.goods-mobile-category')!).display !== 'none', 'Phone goods receipt uses a category picker');
    document.querySelector<HTMLInputElement>('.goods-row-checkbox')!.click(); await pause();
    const quantity = document.querySelector<HTMLInputElement>('[aria-label^="Received quantity"]')!;
    assert(!quantity.disabled && quantity.getBoundingClientRect().width > 0 && quantity.getBoundingClientRect().right <= document.documentElement.clientWidth + 1, 'Including a product expands usable quantity and price controls');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(quantity, '2'); quantity.dispatchEvent(new Event('input', { bubbles: true })); await pause();
    assert(document.querySelector('.goods-receipt-total')?.textContent?.includes('40'), 'Mobile goods receipt keeps existing quantity and total calculations');
    mobileRecords('.goods-products-table table', 'Expanded goods received cards');
    if (location.hash === '#preview-goods') {
      window.scrollTo(0, Math.max(0, document.querySelector('.goods-products-table')!.getBoundingClientRect().top + scrollY - 80)); await pause();
      const results = document.getElementById('test-results')!; results.style.display = 'none'; results.textContent = JSON.stringify({ passed: checks.length, checks }); return;
    }
  } else assert(getComputedStyle(document.querySelector('.goods-products-table table')!).display === 'table', 'Desktop goods receipt keeps its existing table');
  await navigate('Inventory', 'Stock Transfer', '.stock-transfer-page');
  await navigate('Reports', 'Stock Transfer Report', '.stock-transfer-report-page');
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.bill-report-filters input, .bill-report-filters select')) {
    const rect = control.getBoundingClientRect(); assert(rect.right <= document.documentElement.clientWidth + 1, 'Report controls fit the phone');
  }
  if (location.hash.includes('preview')) { await navigate('Masters', 'Products', '.products-table-card'); window.scrollTo(0, 0); }
  else root.unmount();
  document.getElementById('test-results')!.style.display = 'none';
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
