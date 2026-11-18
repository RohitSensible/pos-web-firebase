import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import { AddProductForm } from '../src/pages/AddProductForm.tsx';
import { ReportDateInput } from '../src/pages/ReportDateInput.tsx';
import { ProductImageCropper } from '../src/pages/ProductImageCropper.tsx';
import { DataLoadingModal } from '../src/components/DataLoadingModal.tsx';
import { beginDataLoading } from '../src/utils/dataLoading.ts';
import '../src/index.css';

// All requests stay in this fixture. No real authentication or database access.
window.fetch = async (input, init) => {
  if (init?.method && init.method !== 'GET') throw new Error('Unexpected write');
  const path = new URL(String(input), location.origin).pathname;
  if (path.endsWith('/master-sync')) return new Response('', { status: 404 });
  if (path.endsWith('/dashboard')) return Response.json({ data: { id: 'overall', dayId: '2026-11-17', totalSale: 0, payments: {}, shifts: [] } });
  if (path.endsWith('/devices')) return Response.json({ data: { outletName: 'Test Outlet', devices: [{ documentId: 'd', deviceId: 'TEST-DEVICE', outletName: 'Test Outlet', active: true }] } });
  if (path.endsWith('/create-options')) return Response.json({ data: { code: 1, categories: [{ id: 'c', name: 'Food' }], taxes: [], units: [{ id: 2, name: 'Number' }], premises: [{ id: 'p', name: 'AC' }] } });
  throw new Error(`Unexpected fixture request: ${path}`);
};
const root = createRoot(document.getElementById('root')!);
const checks: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(check: () => unknown) { for (let i = 0; i < 180; i++) { if (check()) return; await pause(); } throw new Error('Timed out waiting for fixture'); }
const phone = innerWidth <= 600;
const baseline = location.hash.includes('baseline');
const mode = location.hash.slice(1).split('-')[0] || 'nav';
const still = document.createElement('style');
still.textContent = '* { animation: none !important; transition: none !important; caret-color: transparent !important; }';
document.head.append(still);
document.documentElement.dataset.theme = 'light';

function fits(element: HTMLElement) {
  const r = element.getBoundingClientRect();
  assert(r.left >= -1 && r.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1, 'Control fits without horizontal overflow');
}
function targets(elements: HTMLElement[], minimumWidth = 44) {
  for (const element of elements) {
    const r = element.getBoundingClientRect();
    assert(r.width >= minimumWidth - 1 && r.height >= 43, 'Phone touch target has sufficient dimensions');
  }
  for (let i = 0; i < elements.length; i++) for (let j = i + 1; j < elements.length; j++) {
    const a = elements[i].getBoundingClientRect(), b = elements[j].getBoundingClientRect();
    assert(Math.min(a.right, b.right) - Math.max(a.left, b.left) < 1 || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) < 1, 'Touch targets do not overlap');
  }
}
async function navigation() {
  localStorage.clear();
  localStorage.setItem('pos_user_session', JSON.stringify({ id: 'u', name: 'Test User', email: 'test@example.com', role: 'Admin', terminal: 'POS', token: 'mock' }));
  localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'o', name: 'Test Outlet' }));
  root.render(<App />);
  await until(() => document.querySelector('.sidebar-nav'));
  const menu = document.querySelector<HTMLButtonElement>('.mobile-menu')!;
  const drawer = document.querySelector<HTMLElement>('.dashboard-sidebar')!;
  const close = document.querySelector<HTMLButtonElement>('.sidebar-close')!;
  if (innerWidth <= 820) { menu.focus(); menu.click(); await pause(); }
  if (phone && !baseline) {
    assert(menu.getAttribute('aria-expanded') === 'true' && menu.getAttribute('aria-controls') === drawer.id, 'Phone menu exposes its expanded drawer');
    assert(document.activeElement === close && drawer.getAttribute('aria-modal') === 'true', 'Opening focuses the modal drawer close control');
    const background = document.querySelector<HTMLElement>('.dashboard-stage')!;
    assert(background.inert, 'Background is inert while the phone drawer is open');
    document.querySelector<HTMLButtonElement>('.theme-button')!.focus();
    assert(drawer.contains(document.activeElement), 'Background cannot receive focus');
    const tabbables = [...drawer.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(e => e.getClientRects().length);
    tabbables.at(-1)!.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert(document.activeElement === close, 'Tab wraps to the start of the drawer');
    close.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert(document.activeElement === tabbables.at(-1), 'Shift Tab wraps to the end of the drawer');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await pause();
    assert(!drawer.classList.contains('open') && document.activeElement === menu && !background.inert, 'Escape closes, restores focus and releases the background');
    menu.click(); await pause();
    close.click(); await pause();
    assert(document.activeElement === menu && !drawer.classList.contains('open'), 'Close button restores the menu trigger');
    menu.click(); await pause();
    document.querySelector<HTMLButtonElement>('.sidebar-scrim')!.click(); await pause();
    assert(document.activeElement === menu && !drawer.classList.contains('open'), 'Scrim dismissal restores the menu trigger');
    menu.click(); await pause();
  }
  const operations = [...document.querySelectorAll<HTMLElement>('.nav-group-title')].find(e => e.textContent === 'Operations')!;
  if (phone && !baseline) assert(operations.tagName === 'BUTTON', 'Phone section headings are native buttons');
  if (!phone) assert(operations.tagName === 'DIV' && !drawer.hasAttribute('aria-modal') && !document.querySelector<HTMLElement>('.dashboard-stage')!.inert, 'Wider navigation retains its original semantics and nonmodal behavior');
  operations.click(); await pause();
  if (phone && !baseline) assert(operations.getAttribute('aria-expanded') === 'true' && !!document.getElementById(operations.getAttribute('aria-controls')!), 'Section expansion is associated with its existing items');
  const device = [...drawer.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(e => e.textContent === 'Device')!;
  device.click(); await until(() => document.querySelector('.registered-devices-page tbody tr'));
  assert(document.querySelector('.registered-devices-page')?.textContent?.includes('TEST-DEVICE'), 'Existing Device destination still opens');
  if (innerWidth <= 820) { menu.click(); await pause(); }
}
async function form() {
  root.render(<div className="retail-dashboard-shell"><main className="dashboard-workspace" style={{ width: '100%' }}><AddProductForm outletId="o" token="mock" initialCategory="c" onCancel={() => {}} onCreated={() => { throw new Error('Unexpected save'); }} onSessionExpired={() => { throw new Error('Unexpected expiry'); }} /></main></div>);
  await until(() => document.querySelector('option[value="c"]'));
  if (phone && !baseline) {
    for (const element of document.querySelectorAll<HTMLElement>('.add-product-modal .form-field')) fits(element);
    if (innerWidth <= 360) {
      const pairs = ['product-category', 'product-taxIndex', 'product-price', 'product-costPrice'].map(id => document.getElementById(id)!);
      assert(pairs.every(e => Math.abs(e.getBoundingClientRect().left - pairs[0].getBoundingClientRect().left) < 1), 'Narrow-phone paired fields stack in one column');
    }
  }
  document.activeElement instanceof HTMLElement && document.activeElement.blur();
  window.scrollTo(0, 0);
}
function DateFixture() { const [date, setDate] = useState('2026-11-17'); return <main style={{ padding: 16 }}><ReportDateInput aria-label="Test date" value={date} onChange={setDate} /></main>; }
async function calendar() {
  root.render(<DateFixture />);
  await until(() => document.querySelector('.report-date-trigger'));
  document.querySelector<HTMLButtonElement>('.report-date-trigger')!.click();
  await until(() => document.querySelector('.report-date-calendar'));
  const popup = document.querySelector<HTMLElement>('.report-date-calendar')!;
  if (phone && !baseline) {
    fits(popup);
    targets([...popup.querySelectorAll<HTMLElement>('.report-date-navigation > button')]);
    targets([...popup.querySelectorAll<HTMLElement>('.report-date-days > button')], 32);
  }
}
async function cropper() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 160;
  const context = canvas.getContext('2d')!; context.fillStyle = '#6699bb'; context.fillRect(0, 0, 160, 160);
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
  root.render(<ProductImageCropper file={new File([blob], 'fixture.png', { type: 'image/png' })} onCancel={() => {}} onApply={() => {}} />);
  await until(() => [...document.querySelectorAll<HTMLButtonElement>('.product-crop-actions button')].some(e => e.textContent === 'Save' && !e.disabled));
  if (phone && !baseline) {
    fits(document.querySelector<HTMLElement>('.product-crop-toolbar')!);
    targets([...document.querySelectorAll<HTMLElement>('.product-crop-toolbar button, .product-crop-ratio button, .product-crop-actions button')]);
  }
}
async function loading() {
  root.render(<DataLoadingModal />); beginDataLoading('Test data');
  await until(() => document.querySelector('.data-loading-dismiss'));
  if (phone && !baseline) targets([document.querySelector<HTMLElement>('.data-loading-dismiss')!]);
}
void (async () => {
  if (mode === 'nav') await navigation();
  else if (mode === 'form') await form();
  else if (mode === 'date') await calendar();
  else if (mode === 'crop') await cropper();
  else if (mode === 'loading') await loading();
  else throw new Error('Unknown test mode');
  assert(true, 'Fixture rendered with mocked requests only');
  // Wait for the existing sidebar chevron transition before screenshot capture.
  await new Promise(resolve => setTimeout(resolve, 250));
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, mode, width: innerWidth });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks }); });
