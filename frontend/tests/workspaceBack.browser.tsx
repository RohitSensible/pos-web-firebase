import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'Cashier', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'shop', name: 'Test Outlet' }));
const checks: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 160; i++) { if (check()) return; await pause(); } throw new Error('Timeout: ' + label); }
window.fetch = async (input, init) => {
  if (init?.method && init.method !== 'GET') throw new Error('Header verification must not write data');
  const url = new URL(String(input), location.href).pathname;
  if (url.endsWith('/master-sync')) return new Response('', { status: 404 });
  if (url.endsWith('/dashboard')) return Response.json({ data: { id: 'overall', dayId: '2026-10-19', shiftNo: 1, totalSale: 0, payments: {}, shifts: [] } });
  if (url.endsWith('/profile')) return Response.json({ success: true, data: { name: 'Cashier', role: 'Admin', outletName: 'Test Outlet', mobile: '' } });
  if (url.includes('/reports/')) return Response.json({ success: true, data: {
    bills: [], categories: [], products: [], rates: [], movements: [], transfers: [], shifts: [],
    summary: { totalBills: 0, totalAmount: 0, cashTotal: 0, digitalTotal: 0, totalCategories: 0, totalProducts: 0, totalQuantity: 0,
      totalTransactions: 0, stockInQuantity: 0, stockOutQuantity: 0, netQuantity: 0, totalTransfers: 0, totalShifts: 0,
      totalSale: 0, cashSale: 0, digitalSale: 0, creditSale: 0, expenses: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0, gross: 0, gstBills: 0 },
    pagination: { page: 1, pageSize: 50, totalPages: 1, totalItems: 0 },
  } });
  const tea = { documentId: 'p', fields: { name: 'Tea', code: 1, price: 10, category: 'c' } };
  if (url.endsWith('/products')) return Response.json({ success: true, data: [tea] });
  if (url.endsWith('/categories')) return Response.json({ success: true, data: [{ id: 'c', name: 'Drinks' }] });
  if (url.endsWith('/edit-options')) return Response.json({ success: true, data: { code: 1, categories: [{ id: 'c', name: 'Drinks' }], taxes: [], units: [], premises: [], servicePointName: '', product: tea } });
  if (url.endsWith('/service-points')) return Response.json({ success: true, data: { servicePoints: [] } });
  return Response.json({ success: true, data: [] });
};
const title = (label: string) => [...document.querySelectorAll<HTMLElement>('.nav-group-title')].find(node => node.textContent?.trim() === label)!;
const item = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(node => node.textContent?.trim() === label);
const back = () => document.querySelector<HTMLButtonElement>('.workspace-back');
function inlineHeading(label: string) {
  const arrow = back()!, heading = arrow?.closest<HTMLElement>('h1, h2, h3');
  assert(!!heading && heading.textContent?.trim() === label, `${label}: back arrow is inside the existing page heading`);
  const description = heading!.nextElementSibling;
  assert(description?.tagName === 'P' && !!description.textContent?.trim(), `${label}: a short description appears below the page title`);
  assert(!document.querySelector('.dashboard-workspace > .workspace-back') && !arrow.textContent?.trim(), `${label}: no separate Back row or text`);
  const bounds = arrow.getBoundingClientRect(), titleBounds = heading!.getBoundingClientRect();
  const text = [...heading!.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
  const range = document.createRange(); range.selectNodeContents(text!);
  const textBounds = range.getBoundingClientRect();
  assert(bounds.left >= titleBounds.left - 1 && bounds.right <= textBounds.left + 1
    && bounds.top < textBounds.bottom && bounds.bottom > textBounds.top, `${label}: arrow appears before the title on the same row`);
  assert(bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth && titleBounds.right <= document.documentElement.clientWidth + 1, `${label}: heading fits the viewport`);
  assert(getComputedStyle(arrow).borderWidth === '0px' && getComputedStyle(arrow).boxShadow === 'none', `${label}: arrow has no boxed-button styling`);
  const icon = heading!.querySelector<SVGSVGElement>(':scope > svg');
  if (icon) {
    const iconBounds = icon.getBoundingClientRect();
    assert(getComputedStyle(icon).display !== 'none' && iconBounds.width > 0 && iconBounds.left >= bounds.right, `${label}: existing page icon remains visible after the back arrow`);
  }
  if (matchMedia('(max-width: 820px), (max-width: 1024px) and (max-height: 600px)').matches)
    assert(bounds.width >= 44 && bounds.height >= 44, `${label}: mobile arrow remains easy to tap`);
}
async function open(group: string, label: string) {
  const menu = document.querySelector<HTMLButtonElement>('.mobile-menu')!;
  if (getComputedStyle(menu).display !== 'none' && !document.querySelector('.dashboard-sidebar.open')) { menu.click(); await pause(); }
  if (!item(label)) { title(group).click(); await until(() => item(label), `${label} link`); }
  item(label)!.click();
}
createRoot(document.getElementById('root')!).render(<App />);
void (async () => {
  await until(() => document.querySelector('.page-hero'), 'dashboard');
  assert(!back(), 'The Dashboard has no back arrow');
  await open('Masters', 'Products'); await until(() => document.querySelector('.products-page-shell'), 'products page');
  const logo = document.querySelector('.header-logo-crop')!.getBoundingClientRect(), arrow = back()!.getBoundingClientRect();
  assert(arrow.top >= logo.bottom && arrow.left < innerWidth / 2, 'Other screens show a back arrow at the top left, below the logo');
  inlineHeading('Products');
  document.querySelector<HTMLButtonElement>('.theme-button')!.click(); await pause();
  assert(document.documentElement.dataset.theme === 'dark' && getComputedStyle(back()!).color === getComputedStyle(back()!.closest('h1')!).color, 'Back arrow follows the existing dark heading color');
  document.querySelector<HTMLButtonElement>('.theme-button')!.click(); await pause();
  const spacer = document.createElement('div'); spacer.style.height = '3000px'; document.querySelector('.dashboard-workspace')!.append(spacer);
  window.scrollTo(0, 1500); await pause();
  const scrolled = back()!.getBoundingClientRect(), heading = back()!.closest('h1')!.getBoundingClientRect();
  assert(window.scrollY > 1000 && scrolled.bottom < 0 && scrolled.top >= heading.top - 1, 'Arrow scrolls with its page heading without floating over page controls');
  spacer.remove(); window.scrollTo(0, 0); await pause();
  await until(() => document.querySelector('[aria-label="Edit product"]'), 'product row');
  document.querySelector<HTMLButtonElement>('[aria-label="Edit product"]')!.click();
  await until(() => document.querySelector('.add-product-modal'), 'edit product form');
  inlineHeading('Edit Product');
  await until(() => document.querySelector<HTMLSelectElement>('#product-category')?.disabled === false, 'edit product options');
  const name = document.querySelector<HTMLInputElement>('#product-name')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Changed Tea');
  name.dispatchEvent(new Event('input', { bubbles: true })); await pause();
  back()!.click(); await until(() => document.querySelector('#unsaved-changes-title'), 'unsaved changes prompt');
  [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.textContent === 'Stay')!.click();
  await until(() => !document.querySelector('#unsaved-changes-title'), 'keep product draft');
  assert(name.value === 'Changed Tea', 'Inline Back preserves the draft when Stay is chosen');
  back()!.click(); await until(() => document.querySelector('#unsaved-changes-title'), 'confirm discard');
  [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.textContent === 'Discard')!.click();
  await until(() => !document.querySelector('.add-product-modal'), 'discard returns to products');
  document.querySelector<HTMLButtonElement>('[aria-label="Edit product"]')!.click();
  await until(() => document.querySelector('.add-product-modal'), 'reopen edit product');
  back()!.click(); await until(() => !document.querySelector('.add-product-modal') && document.querySelector('.products-page-shell [aria-label="Edit product"]'), 'product list after back');
  assert(item('Products')?.classList.contains('active') && back(), 'Back from Edit Product returns to the product list, not another screen');
  await open('Operations', 'Upload Excel'); await until(() => document.querySelector('.upload-excel-page'), 'upload page');
  inlineHeading('Upload Excel');
  back()!.click(); await until(() => document.querySelector('.products-page-shell'), 'back to products');
  assert(item('Products')?.classList.contains('active') || document.querySelector('.products-page-shell'), 'Back returns to the previous screen');
  back()!.click(); await until(() => document.querySelector('.page-hero'), 'back to dashboard');
  assert(!back(), 'Going back to the Dashboard hides the arrow');
  for (const [label, title] of [
    ['Day Wise Report', 'Daywise Report'], ['Shift Summary Report', 'Shift Summary Report'],
    ['Category Wise', 'Category Wise Report'], ['Product Wise', 'Product Wise Report'], ['Stock Report', 'Stock Report'],
    ['Stock In-Out Report', 'Stock In-Out Report'], ['Stock Transfer Report', 'Stock Transfer Report'],
    ['GST Report', 'GST Report'], ['GST Report Day Wise', 'GST Report Day Wise'], ['Bill Wise Sale Report', 'Bill Wise Sale Report'],
  ]) {
    await open('Reports', label!);
    await until(() => document.querySelector('.bill-report-heading h1')?.textContent?.trim() === title, label!);
    inlineHeading(title!);
  }
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
