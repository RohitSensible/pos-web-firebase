import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'Cashier', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'shop', name: 'Test Outlet' }));
const checks: string[] = [];
function assert(ok: unknown, message: string) { if (!ok) throw new Error(message); checks.push(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 120; i++) { if (check()) return; await pause(); } throw new Error('Timeout: ' + label); }
let requests = 0;
const shift = (number: number, total: number) => ({ id: `private-shift-id-${number}`, deviceId: `private-device-id-${number}`, shiftNo: number, inActive: number === 1,
  userId: `creator-${number}`, creatorName: `Shift Owner ${number}`, startTime: 1792386000000 + number * 3600000, endTime: number === 1 ? 1792393200000 : 0,
  startBillNo: number === 1 ? '0' : '201', lastBillNo: number === 1 ? '100' : '299',
  dayId: '2026-10-19', totalSale: total, cashSale: total, digitalSale: 0, creditSale: 0, openingAmt: 0, expCash: 0, billCount: number, payments: { cash: total } });
let shifts = [shift(1, 100), shift(2, 200)];
window.fetch = async (input, init) => {
  if (String(input) === '/api/outlets/shop/profile') return Response.json({ success: true, data: { name: 'Cashier', role: 'Admin', outletName: 'Test Outlet', mobile: '12345' } });
  if (String(input) === '/api/auth/outlets') return Response.json({ success: true, data: { outlets: [{ id: 'shop', name: 'Test Outlet' }, { id: 'other', name: 'Other Outlet' }] } });
  assert(String(input).startsWith('/api/outlets/shop/dashboard?'), 'Reads only the selected outlet dashboard');
  assert(!init?.method || init.method === 'GET', 'Dashboard requests remain read-only');
  assert((init?.headers as Record<string, string>).Authorization === 'Bearer mock-token', 'Existing authentication is preserved');
  requests++;
  const dayId = new URL(String(input), location.href).searchParams.get('dayId');
  return Response.json({ data: { ...shift(2, shifts.reduce((sum, item) => sum + item.totalSale, 0)), id: 'overall', creatorName: 'Wrong aggregate creator', startTime: 1, endTime: 1, dayId, shifts: shifts.map(shift => ({ ...shift, dayId })) } });
};
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('.page-hero [role=tab]')];
const sale = () => [...document.querySelectorAll('.kpi-card')].find(card => card.querySelector('.kpi-card-topline > span')?.textContent === 'Total Sale')?.querySelector('strong')?.textContent;
const detail = (label: string) => [...document.querySelectorAll('.shift-card > div')].find(row => row.querySelector('span')?.textContent === label)?.querySelector('strong')?.textContent;
void (async () => {
  await until(() => tabs().length === 3 && sale()?.includes('300'), 'header shifts');
  assert(JSON.stringify([...document.querySelectorAll('.shift-card > div > span')].map(node => node.textContent)) === JSON.stringify(['Outlet', 'Branch', 'Terminal', 'Shift No.', 'Created By', 'Created At', 'Ended At', 'Bill Range', 'Status', 'Device ID']), 'Shift Details shows exactly the required fields in order');
  assert(detail('Created By') === 'Shift Owner 2' && detail('Created At') === new Date(shift(2, 200).startTime).toLocaleString(), 'All Shifts identity and time come from the active shift, not aggregate or session');
  assert(detail('Ended At') === 'In progress' && detail('Status') === 'Active', 'Active shift with zero end time stays in progress');
  assert(detail('Terminal') === 'POS (web workspace)', 'Terminal explicitly describes the current web workspace');
  if (location.hash === '#preview') { document.getElementById('test-results')!.textContent = JSON.stringify({ passed: ['Dashboard layout'] }); return; }
  assert(JSON.stringify(tabs().map(tab => tab.textContent)) === JSON.stringify(['All Shifts', 'Shift 1', 'Shift 2']), 'Header contains all shifts using names only');
  assert(!document.querySelector('.shift-table-section') && !document.body.textContent?.includes('Shift-wise Summary'), 'Shift-wise Summary comparison table is removed');
  assert(!document.body.textContent?.includes('private-shift-id') && document.querySelector('.shift-device-id')?.textContent === 'private-device-id-2', 'Shift document IDs stay hidden; the active shift displays its own stored Device ID');
  assert(!document.body.textContent?.includes('Quick Actions'), 'Quick Actions widget is removed');
  assert(!document.querySelector('.dashboard-insights .sidebar-logout, .shift-card button'), 'Right sidebar has no logout or outlet-switch buttons');
  const logout = document.querySelector<HTMLButtonElement>('.dashboard-sidebar .sidebar-footer .sidebar-logout')!;
  if (innerWidth <= 820) { document.querySelector<HTMLButtonElement>('.mobile-menu')!.click(); await pause(); }
  assert(logout && getComputedStyle(logout).display !== 'none', 'Logout remains visible below the sidebar plan card');
  const logoutBounds = logout.getBoundingClientRect();
  assert(logoutBounds.bottom <= innerHeight + 1 && logoutBounds.top >= 0, 'Sidebar logout stays pinned within the viewport');
  assert(!!(document.querySelector('.sidebar-footer .plan-card')!.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING), 'Logout follows plan information');
  logout.click(); await until(() => document.querySelector('dialog.action-confirmation'), 'logout confirmation');
  assert(localStorage.getItem('pos_user_session') && document.querySelector('dialog.action-confirmation h3')?.textContent === 'Log out?', 'Logout asks for confirmation before clearing the session');
  document.querySelector<HTMLButtonElement>('dialog.action-confirmation .delete-confirmation-cancel')!.click(); await pause();
  assert(!document.querySelector('dialog.action-confirmation') && localStorage.getItem('pos_user_session'), 'Cancelling logout keeps the session');
  if (innerWidth <= 820) { document.querySelector<HTMLButtonElement>('.sidebar-close')!.click(); await pause(); }
  assert([...document.querySelectorAll('.nav-group-items button')].some(node => node.textContent === 'Product Transfer'), 'Left navigation offers one Product Transfer entry');
  const count = requests;
  tabs()[1]!.click(); await pause();
  assert(tabs()[1]!.getAttribute('aria-selected') === 'true' && sale()?.includes('100'), 'Shift 1 selects its existing dashboard figures');
  assert(document.querySelector('.shift-device-id')?.textContent === 'private-device-id-1', 'Selecting Shift 1 displays its stored Device ID');
  assert(detail('Created By') === 'Shift Owner 1' && detail('Status') === 'Closed', 'Selecting a closed shift shows its own creator and authoritative status');
  assert(detail('Ended At') === new Date(shift(1, 100).endTime).toLocaleString() && detail('Bill Range') === '0 → 100', 'Closed shift uses its own end timestamp and preserves zero bill text');
  tabs()[2]!.click(); await pause();
  assert(tabs()[2]!.getAttribute('aria-selected') === 'true' && sale()?.includes('200'), 'Shift 2 selects its existing dashboard figures');
  assert(document.querySelector('.shift-device-id')?.textContent === 'private-device-id-2', 'Selecting Shift 2 displays its stored Device ID');
  tabs()[0]!.click(); await pause();
  assert(tabs()[0]!.getAttribute('aria-selected') === 'true' && sale()?.includes('300') && requests === count, 'All Shifts restores overall totals without an extra API request');
  assert(tabs().every(tab => { const box = tab.getBoundingClientRect(); return box.width > 0 && box.left >= 0 && box.right <= innerWidth; }), 'Header shift buttons fit the viewport');
  document.querySelector<HTMLButtonElement>('.theme-button')!.click(); await pause();
  assert(document.documentElement.dataset.theme === 'dark' && tabs()[0]!.getAttribute('aria-selected') === 'true', 'Existing dark theme preserves selected shift');
  shifts = [shift(2, 200)]; window.dispatchEvent(new Event('focus'));
  await until(() => tabs().length === 2, 'single shift refresh');
  assert(tabs()[0]!.textContent === 'All Shifts' && tabs()[1]!.textContent === 'Shift 2', 'A single available shift is still named in the header');
  shifts = [{ ...shift(2, 200), deviceId: '', creatorName: '', inActive: true, startTime: 0, startBillNo: '', lastBillNo: '' }]; window.dispatchEvent(new Event('focus'));
  await until(() => document.querySelector('.shift-device-id')?.textContent === 'Not Available', 'legacy shift without device');
  assert(document.querySelector('.shift-device-id')?.textContent === 'Not Available', 'Older shift records without deviceId show Not Available');
  assert(detail('Created By') === 'Not Available' && detail('Created At') === 'Not Available' && detail('Ended At') === 'Not Available', 'Missing creator and closed shift times never fall back to session or aggregate data');
  assert(detail('Bill Range') === '— → —' && detail('Status') === 'Closed', 'Missing bills have no inferred range and closed shift stays closed');
  const longDeviceId = 'device-' + '0123456789abcdef'.repeat(6);
  shifts = [{ ...shift(2, 200), deviceId: longDeviceId }]; window.dispatchEvent(new Event('focus'));
  await until(() => document.querySelector('.shift-device-id')?.textContent === longDeviceId, 'stored device refresh');
  const card = document.querySelector<HTMLElement>('.shift-card')!;
  assert(card.scrollWidth <= card.clientWidth + 1, 'Long stored device IDs wrap within the existing shift card');
  document.querySelector<HTMLButtonElement>('[aria-label="Account details"]')!.click();
  await until(() => document.querySelector('.profile-menu-actions button'), 'profile outlet action');
  const changeOutlet = document.querySelector<HTMLButtonElement>('.profile-menu-actions button')!;
  assert(changeOutlet.textContent?.trim() === 'Change Outlet', 'Profile dropdown offers Change Outlet');
  document.querySelector<HTMLButtonElement>('[aria-label="Close account details"]')!.click(); await pause();
  if (innerWidth <= 820) { document.querySelector<HTMLButtonElement>('.mobile-menu')!.click(); await pause(); }
  const outletSwitch = document.querySelector<HTMLButtonElement>('.business-profile .business-outlet-switch')!;
  assert(outletSwitch && outletSwitch.getAttribute('aria-label') === 'Change Outlet', 'Selected outlet card includes an accessible switch icon');
  outletSwitch.click();
  await until(() => !document.querySelector('.retail-dashboard-shell'), 'outlet switch');
  assert(!localStorage.getItem('pos_selected_outlet') && !!localStorage.getItem('pos_user_session'), 'Changing outlet returns to selection and keeps authentication');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks }); });
