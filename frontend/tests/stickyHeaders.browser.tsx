import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

localStorage.clear(); sessionStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'sticky-user', name: 'Test User', email: 'test@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'shop', name: 'Test Outlet' }));
const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
async function until(check: () => unknown, message: string) {
  for (let attempt = 0; attempt < 180; attempt++) { if (check()) return; await pause(); }
  throw new Error(`Timeout: ${message}`);
}
const categories = Array.from({ length: 32 }, (_, index) => ({ id: `c${index}`, categoryNo: index + 1, name: `Category ${index + 1}`, regionalName: '', active: true, createdAt: '', productCount: 0 }));
const products = Array.from({ length: 240 }, (_, index) => ({ documentId: `p${index}`, fields: {
  code: index + 1, name: `${index % 2 ? 'Second' : 'First'} product ${index + 1}`, category: `c${index % 2}`, price: 10, stockable: true, currentStock: 1,
} }));
window.fetch = async (url, init) => {
  assert(!init?.method || init.method === 'GET', 'Sticky navigation never submits a write');
  const path = new URL(String(url), location.origin).pathname;
  if (path.endsWith('/master-sync')) return new Response(null, { status: 404 });
  let data: unknown;
  if (path.endsWith('/dashboard')) data = { payments: {}, shifts: [] };
  else if (path.endsWith('/categories')) data = categories;
  else if (path.endsWith('/products')) data = products;
  else if (path.endsWith('/customers')) data = { customers: [] };
  else throw new Error(`Unexpected request: ${path}`);
  return Response.json({ success: true, data });
};
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
const root = createRoot(document.getElementById('root')!); root.render(<App />);
const bounds = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
async function navigate(label: string) {
  window.scrollTo(0, 0);
  if (!button(label)) { [...document.querySelectorAll<HTMLElement>('.nav-group-title')].find(node => node.textContent?.trim() === 'Masters')!.click(); await until(() => button(label), `${label} menu`); }
  button(label).click(); await pause();
}
async function scrollDown(toBottom = false) {
  const bottom = document.documentElement.scrollHeight - innerHeight;
  window.scrollTo(0, toBottom ? bottom : Math.min(900, bottom)); await pause();
  assert(window.scrollY > 100, 'The test scrolls actual document content');
}
function stickyBelowNavigation(selector: string, label: string) {
  const rect = bounds(selector), globalHeader = bounds('.retail-header');
  assert(Math.abs(rect.top - globalHeader.bottom) <= 2, `${label} stays directly below global navigation after scrolling`);
  assert(rect.left >= -1 && rect.right <= innerWidth + 1 && rect.bottom < innerHeight, `${label} fits and leaves room for content`);
}
void (async () => {
  document.getElementById('test-results')!.style.display = 'none';
  await until(() => document.querySelector('.nav-group-title'), 'navigation');
  await navigate('Customer'); await until(() => document.querySelector('.customer-state h2'), 'customers loaded');
  document.querySelector<HTMLButtonElement>('[aria-label="Add Customer"]')!.click(); await until(() => document.getElementById('customer-name'), 'add customer');
  await scrollDown(true); stickyBelowNavigation('.customer-form-page .master-form-header', 'Complete customer header');
  for (const selector of ['.workspace-back', 'button[type=submit]', '.btn-secondary', '.modal-close-btn']) {
    const rect = bounds(`.customer-form-page .master-form-header ${selector}`);
    assert(rect.top >= bounds('.retail-header').bottom - 1 && rect.bottom <= innerHeight && rect.width > 0, `Customer header control ${selector} remains visible`);
  }
  button('Save Customer').click(); await pause();
  assert(document.activeElement?.id === 'customer-name' && document.getElementById('customer-name-error')?.textContent === 'Customer name is required', 'Sticky Save retains mandatory validation and first-invalid focus');
  document.querySelector<HTMLButtonElement>('[aria-label="Close customer form"]')!.click(); await until(() => !document.getElementById('customer-name'), 'close customer');
  document.querySelector<HTMLButtonElement>('[aria-label="Add Customer"]')!.click(); await until(() => document.getElementById('customer-name'), 'reopen customer');
  button('Cancel').click(); await until(() => !document.getElementById('customer-name'), 'cancel customer');
  document.querySelector<HTMLButtonElement>('[aria-label="Add Customer"]')!.click(); await until(() => document.getElementById('customer-name'), 'reopen for Back');
  document.querySelector<HTMLButtonElement>('.customer-form-page .workspace-back')!.click(); await until(() => !document.getElementById('customer-name'), 'customer back');
  checks.push('Customer Close, Cancel and Back retain navigation behavior');

  await navigate('Category'); await until(() => document.querySelectorAll('.category-table tbody tr').length === categories.length, 'categories loaded');
  await scrollDown(); stickyBelowNavigation('.category-master-page > .category-header-row', 'Category Master header');
  document.querySelector<HTMLButtonElement>('[aria-label="Add New Category"]')!.click(); await until(() => document.querySelector('.category-modal input'), 'add category');
  assert(!!document.querySelector('.category-modal input'), 'Add Category remains usable while the list is scrolled');
  document.querySelector<HTMLButtonElement>('.category-modal .modal-close-btn')!.click(); await pause();

  await navigate('Products'); await until(() => document.querySelectorAll('.products-table tbody tr').length > 20, 'products loaded');
  const firstRow = bounds('.products-table tbody tr').top;
  await scrollDown(); stickyBelowNavigation('.products-sticky-navigation', 'Products header and category navigation');
  assert(bounds('.products-table tbody tr').top < firstRow - 100, 'Product content scrolls underneath the sticky region');
  const tabs = document.querySelector<HTMLElement>('.products-category-tabs')!;
  if (getComputedStyle(tabs).display !== 'none') {
    assert(bounds('.products-category-tabs').top >= bounds('.products-header').bottom && bounds('.products-category-tabs').bottom < innerHeight, 'Category tabs remain below the Products header');
    [...tabs.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === 'Category 2')!.click();
  } else {
    const select = [...document.querySelectorAll<HTMLSelectElement>('.products-category-filter')].find(node => node.getBoundingClientRect().height > 0)!;
    assert(select.getBoundingClientRect().top >= bounds('.retail-header').bottom && select.getBoundingClientRect().bottom < innerHeight, 'Responsive category selector remains visible');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'c1');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await until(() => [...document.querySelectorAll('.products-table tbody .products-name')].every(node => node.textContent?.startsWith('Second')), 'category switch');
  assert(document.querySelectorAll('.products-table tbody tr').length > 0 && tabs.querySelector('[aria-pressed="true"]')?.textContent === 'Category 2', 'Switching category while scrolled preserves filtering and selected state');
  stickyBelowNavigation('.products-sticky-navigation', 'Products navigation after category switch');
  document.querySelector<HTMLButtonElement>('[aria-label="More options"]')!.click(); await until(() => document.getElementById('products-more-menu'), 'product actions');
  assert(!!document.getElementById('products-more-menu'), 'Product actions remain available while scrolled');
  document.querySelector<HTMLButtonElement>('[aria-label="More options"]')!.click();
  document.documentElement.dataset.theme = 'dark'; await pause();
  assert(getComputedStyle(document.querySelector('.products-sticky-navigation')!).backgroundColor === 'rgb(16, 23, 34)', 'Sticky navigation uses the existing opaque dark theme background');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
