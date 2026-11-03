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
window.fetch = async input => {
  const url = new URL(String(input), location.href).pathname;
  if (url.endsWith('/master-sync')) return new Response('', { status: 404 });
  if (url.endsWith('/dashboard')) return Response.json({ data: { id: 'overall', dayId: '2026-10-19', shiftNo: 1, totalSale: 0, payments: {}, shifts: [] } });
  if (url.endsWith('/profile')) return Response.json({ success: true, data: { name: 'Cashier', role: 'Admin', outletName: 'Test Outlet', mobile: '' } });
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
async function open(group: string, label: string) {
  if (innerWidth <= 820 && !document.querySelector('.dashboard-sidebar.open')) { document.querySelector<HTMLButtonElement>('.mobile-menu')!.click(); await pause(); }
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
  const spacer = document.createElement('div'); spacer.style.height = '3000px'; document.querySelector('.dashboard-workspace')!.append(spacer);
  window.scrollTo(0, 1500); await pause();
  const header = document.querySelector('.retail-header')!.getBoundingClientRect(), stuck = back()!.getBoundingClientRect();
  assert(window.scrollY > 1000 && stuck.top >= header.bottom && stuck.top < header.bottom + 30, 'The back arrow stays in place below the header while scrolling');
  spacer.remove(); window.scrollTo(0, 0); await pause();
  await until(() => document.querySelector('[aria-label="Edit product"]'), 'product row');
  document.querySelector<HTMLButtonElement>('[aria-label="Edit product"]')!.click();
  await until(() => document.querySelector('.add-product-modal'), 'edit product form');
  back()!.click(); await until(() => !document.querySelector('.add-product-modal') && document.querySelector('.products-page-shell [aria-label="Edit product"]'), 'product list after back');
  assert(item('Products')?.classList.contains('active') && back(), 'Back from Edit Product returns to the product list, not another screen');
  await open('Operations', 'Upload Excel'); await until(() => document.querySelector('.upload-excel-page'), 'upload page');
  back()!.click(); await until(() => document.querySelector('.products-page-shell'), 'back to products');
  assert(item('Products')?.classList.contains('active') || document.querySelector('.products-page-shell'), 'Back returns to the previous screen');
  back()!.click(); await until(() => document.querySelector('.page-hero'), 'back to dashboard');
  assert(!back(), 'Going back to the Dashboard hides the arrow');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
