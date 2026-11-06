import { createRoot } from 'react-dom/client';
import { BrowserQRCodeReader } from '@zxing/browser';
import App from '../src/App.tsx';
import '../src/index.css';

localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'Cashier', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'shop', name: 'Test Outlet', branch: 'Central Branch' }));
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
async function qrValue(deviceId: string) {
  await until(() => document.querySelector('.dashboard-device-qr svg')?.getAttribute('aria-label') === `QR code for device ${deviceId}`, 'selected device QR');
  const svg = document.querySelector<SVGSVGElement>('.dashboard-device-qr svg')!;
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 260;
    canvas.getContext('2d')!.drawImage(image, 0, 0, 260, 260);
    return new BrowserQRCodeReader().decodeFromCanvas(canvas).getText();
  } finally { URL.revokeObjectURL(url); }
}
void (async () => {
  await until(() => tabs().length === 3 && sale()?.includes('300'), 'header shifts');
  assert(document.querySelector('.dashboard-outlet-heading h1')?.textContent === 'Test Outlet' && !document.body.textContent?.includes('Retail POS Dashboard'), 'Dashboard heading uses the actual outlet name');
  const heading = document.querySelector<HTMLElement>('.dashboard-outlet-heading')!;
  const branch = heading.querySelector('p strong')!;
  assert(heading.querySelector('h1 > .lucide-store') && Number.parseInt(getComputedStyle(heading.querySelector('h1')!).fontWeight, 10) >= 700, 'A small store icon accompanies the bold dynamic outlet name');
  assert(branch.textContent === 'Central Branch' && Number.parseInt(getComputedStyle(branch).fontWeight, 10) >= 700 && branch.getBoundingClientRect().top >= heading.querySelector('h1')!.getBoundingClientRect().bottom, 'The bold actual branch name remains directly below the outlet name');
  assert(heading.querySelectorAll('p').length === 2 && heading.querySelector('.dashboard-subtitle')?.textContent === 'Daily sales performance' && heading.querySelector('.dashboard-subtitle > .lucide-trending-up'), 'Daily sales performance appears below the branch with an analytics icon');
  const time = document.querySelector('.dashboard-date-picker > .dashboard-time')!;
  assert(time.querySelector('.lucide-clock') && !!time.textContent?.trim(), 'A small clock icon accompanies the existing live time display');
  assert(document.querySelectorAll('#dashboard-report-date .lucide-calendar-days').length === 1 && document.querySelectorAll('[title="Export all shifts for the selected date"] .lucide-download').length === 1, 'The existing date and export controls keep one original icon each');
  assert(await qrValue('private-device-id-2') === 'private-device-id-2', 'All Shifts QR decodes to the active shift device without another API');
  const qr = document.querySelector<HTMLElement>('.dashboard-device-qr')!;
  assert(qr.textContent === '' && qr.previousElementSibling?.querySelector('.shift-device-id'), 'Only the QR image appears below the existing Shift Details information');
  assert(JSON.stringify([...document.querySelectorAll('.shift-card > div > span')].map(node => node.textContent)) === JSON.stringify(['Outlet', 'Branch', 'Terminal', 'Shift No.', 'Created By', 'Created At', 'Ended At', 'Bill Range', 'Status', 'Device ID']), 'Shift Details shows exactly the required fields in order');
  assert(detail('Created By') === 'Shift Owner 2' && detail('Created At') === new Date(shift(2, 200).startTime).toLocaleString(), 'All Shifts identity and time come from the active shift, not aggregate or session');
  assert(detail('Ended At') === 'In progress' && detail('Status') === 'Active', 'Active shift with zero end time stays in progress');
  assert(detail('Terminal') === 'POS (web workspace)', 'Terminal explicitly describes the current web workspace');
  if (location.hash === '#preview') {
    const hero = document.querySelector<HTMLElement>('.page-hero')!;
    const style = getComputedStyle(hero);
    const result = document.getElementById('test-results')!;
    result.style.whiteSpace = 'pre-wrap'; result.style.overflowWrap = 'anywhere';
    result.textContent = JSON.stringify({ passed: ['Dashboard layout'], header: {
      width: hero.getBoundingClientRect().width, height: hero.getBoundingClientRect().height,
      background: style.backgroundImage, color: style.color, border: style.border,
      radius: style.borderRadius, shadow: style.boxShadow, font: style.fontFamily, padding: style.padding,
    } });
    return;
  }
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
  assert(await qrValue('private-device-id-1') === 'private-device-id-1', 'Selecting another shift updates the QR to that shift’s exact device ID');
  assert(detail('Created By') === 'Shift Owner 1' && detail('Status') === 'Closed', 'Selecting a closed shift shows its own creator and authoritative status');
  assert(detail('Ended At') === new Date(shift(1, 100).endTime).toLocaleString() && detail('Bill Range') === '0 → 100', 'Closed shift uses its own end timestamp and preserves zero bill text');
  tabs()[2]!.click(); await pause();
  assert(tabs()[2]!.getAttribute('aria-selected') === 'true' && sale()?.includes('200'), 'Shift 2 selects its existing dashboard figures');
  assert(document.querySelector('.shift-device-id')?.textContent === 'private-device-id-2', 'Selecting Shift 2 displays its stored Device ID');
  assert(await qrValue('private-device-id-2') === 'private-device-id-2', 'Switching back cannot retain the previous shift’s QR');
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
  assert(!document.querySelector('.dashboard-device-qr'), 'Missing device IDs remove the previous QR without inventing an identifier');
  assert(detail('Created By') === 'Not Available' && detail('Created At') === 'Not Available' && detail('Ended At') === 'Not Available', 'Missing creator and closed shift times never fall back to session or aggregate data');
  assert(detail('Bill Range') === '— → —' && detail('Status') === 'Closed', 'Missing bills have no inferred range and closed shift stays closed');
  const longDeviceId = 'device-' + '0123456789abcdef'.repeat(6);
  shifts = [{ ...shift(2, 200), deviceId: longDeviceId }]; window.dispatchEvent(new Event('focus'));
  await until(() => document.querySelector('.shift-device-id')?.textContent === longDeviceId, 'stored device refresh');
  const card = document.querySelector<HTMLElement>('.shift-card')!;
  assert(card.scrollWidth <= card.clientWidth + 1, 'Long stored device IDs wrap within the existing shift card');
  const rawDeviceId = ' Device/Case?value=店 ';
  shifts = [{ ...shift(2, 200), deviceId: rawDeviceId }]; window.dispatchEvent(new Event('focus'));
  assert(await qrValue(rawDeviceId) === rawDeviceId, 'Dashboard QR preserves the raw ID, including case, punctuation, whitespace and Unicode');
  const qrBounds = document.querySelector('.dashboard-device-qr svg')!.getBoundingClientRect();
  assert(Math.abs(qrBounds.width - qrBounds.height) < 1 && qrBounds.left >= 0 && qrBounds.right <= innerWidth, 'The QR remains square and inside the viewport in dark mode');
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
