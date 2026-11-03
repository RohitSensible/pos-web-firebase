import { createRoot } from 'react-dom/client';
import { DevicesPage } from '../src/pages/DevicesPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';

const checks: string[] = [];
function assert(ok: unknown, message: string) { if (!ok) throw new Error(message); checks.push(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 120; i++) { if (check()) return; await pause(); } throw new Error('Timeout: ' + message); }
// No workers or external requests may escape this fixture.
window.Worker = class { constructor() { throw new Error('Unexpected worker'); } } as unknown as typeof Worker;
const longId = 'LONG-DEVICE-' + 'x'.repeat(300);
const devices = [
  { documentId: 'a', deviceId: 'POS-ALPHA', outletName: 'North Shop', active: true },
  { documentId: 'b', deviceId: 'POS-BETA', outletName: 'South Shop', active: false },
  { documentId: 'c', deviceId: 'POS-GAMMA', outletName: 'North Shop', active: null },
  { documentId: 'd', deviceId: longId, outletName: 'South Shop', active: 'true' },
  { documentId: 'e', deviceId: 'ZERO', outletName: 'South Shop', active: 0 },
];
let responseStatus = 200, empty = false, requests = 0, expired = 0;
const pending: { signal: AbortSignal; resolve: (value: Response) => void }[] = [];
window.fetch = async (input, init) => {
  assert(/^\/api\/outlets\/(shop|next|last)\/devices$/.test(String(input)), 'Only the devices endpoint is requested');
  assert(!init?.method || init.method === 'GET', 'No write requests');
  assert((init?.headers as Record<string, string>).Authorization === 'Bearer fixture-token' && init?.cache === 'no-store', 'GET preserves auth and fresh reads');
  requests++;
  if (String(input).includes('/next/')) return new Promise<Response>(resolve => pending.push({ signal: init!.signal as AbortSignal, resolve }));
  return Response.json({ data: { outletName: String(input).includes('/last/') ? 'Last Outlet' : 'Registered Outlet', devices: empty ? [] : devices } }, { status: responseStatus });
};
let clipboardMode = 'success', copied = '', clipboardCalls = 0;
function clipboard(available = true) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: available ? { writeText: async (text: string) => { clipboardCalls++; if (clipboardMode === 'reject') throw new Error('Denied'); copied = text; } } : undefined });
}
clipboard();
const root = createRoot(document.getElementById('root')!);
const onSessionExpired = () => { expired++; };
function render(id = 'shop') { root.render(<DevicesPage outlet={{ id, name: id === 'shop' ? 'Cached Shop' : 'New Outlet' } as OutletSummary} token="fixture-token" onSessionExpired={onSessionExpired} />); }
const rows = () => [...document.querySelectorAll('.devices-table-scroll tbody tr')];
const search = () => document.querySelector<HTMLInputElement>('.devices-filters input')!;
const status = () => document.querySelector<HTMLSelectElement>('.devices-filters select')!;
async function query(value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search(), value);
  search().dispatchEvent(new Event('input', { bubbles: true })); await pause();
}
async function filter(value: string) { status().value = value; status().dispatchEvent(new Event('change', { bubbles: true })); await pause(); }
async function reset() { document.querySelector<HTMLButtonElement>('.devices-filters button')!.click(); await pause(); }
const copy = () => document.querySelector<HTMLButtonElement>('.devices-copy')!;
const feedback = () => document.querySelector('.devices-copy-feedback')?.textContent || '';
async function refresh() { document.querySelector<HTMLButtonElement>('.devices-heading button')!.click(); await pause(); }
void (async () => {
  render(); await until(() => rows().length === 5, 'initial rows');
  const sharedPage = document.createElement('section'); sharedPage.className = 'devices-page';
  sharedPage.innerHTML = '<div class="devices-table-scroll"><table><tbody><tr><td>Other page</td></tr></tbody></table></div>';
  document.body.append(sharedPage);
  assert(getComputedStyle(sharedPage.querySelector('table')!).tableLayout === 'auto', 'Device-specific table styles do not affect other pages sharing the stylesheet');
  sharedPage.remove();
  const initialRequests = requests;
  await query(' pos-alpha ');
  assert(rows().length === 1 && rows()[0].textContent?.includes('POS-ALPHA'), 'Exact ID search trims spaces and ignores case');
  await query('pos-'); assert(rows().length === 3, 'Substring ID search');
  await query('NORTH'); assert(rows().length === 2, 'Outlet name search ignores case');
  await filter('active'); assert(rows().length === 1 && rows()[0].textContent?.includes('POS-ALPHA'), 'Search and Active combine');
  await filter('inactive'); assert(!rows().length && document.querySelector('h2')?.textContent === 'No matching devices', 'Combined filters have a distinct no-results state');
  assert(document.querySelector('.devices-result-count')?.textContent === '0 of 5 devices', 'Visible count reflects filters');
  await reset(); assert(search().value === '' && status().value === 'all' && rows().length === 5, 'Clear filters resets search and status');
  await filter('inactive'); assert(rows().length === 1 && rows()[0].textContent?.includes('POS-BETA'), 'Inactive accepts only boolean false');
  await filter('unavailable'); assert(rows().length === 3 && rows().some(row => row.textContent?.includes('ZERO')), 'Unavailable includes null and nonboolean values');
  assert(document.querySelector<HTMLInputElement>('[aria-label="Active status for device POS-GAMMA"]')?.indeterminate, 'Null status stays indeterminate');
  await reset(); await query('south'); await filter('active'); assert(!rows().length, 'Truthy strings do not count as Active');
  await reset(); assert(requests === initialRequests, 'Filtering never refetches or writes');
  assert([...document.querySelectorAll<HTMLInputElement>('.device-status input')].every(box => box.disabled), 'All status controls remain disabled');
  copy().click(); await until(() => feedback() === 'ID copied.', 'clipboard success');
  assert(copied === 'POS-ALPHA', 'Copy writes the exact ID');
  clipboardMode = 'reject'; copy().click(); await until(() => feedback().includes('Could not copy'), 'clipboard rejection');
  assert(!feedback().includes('ID copied.') && copy().textContent === 'Retry copy', 'Rejected clipboard promises never report success and allow retry');
  const manual = document.querySelector<HTMLInputElement>('.devices-copy-feedback input')!; manual.focus();
  assert(manual.readOnly && manual.selectionStart === 0 && manual.selectionEnd === 'POS-ALPHA'.length && feedback().includes('manually'), 'Manual ID field selects the full ID with clear guidance');
  clipboardMode = 'success'; copy().click(); await until(() => feedback() === 'ID copied.', 'retry succeeds');
  clipboard(false); const callsBefore = clipboardCalls; copy().click(); await until(() => feedback().includes('Clipboard is unavailable'), 'unavailable clipboard');
  assert(clipboardCalls === callsBefore && !feedback().includes('ID copied.'), 'Unavailable clipboard provides manual guidance without a false success');
  const region = document.querySelector<HTMLElement>('.devices-table-scroll')!; region.focus();
  assert(document.activeElement === region && region.tabIndex === 0 && region.getAttribute('aria-label') === 'Registered devices', 'Scrollable device table is keyboard focusable and named');
  assert(region.getBoundingClientRect().right <= innerWidth && document.documentElement.scrollWidth <= innerWidth, 'Long IDs stay inside the scroll region without page overflow');
  assert(getComputedStyle(document.querySelector('.device-id')!).overflowWrap === 'anywhere', 'Long IDs can wrap');
  await query('North'); render('next'); await until(() => pending.length === 1, 'new outlet request');
  assert(!rows().length && !document.querySelector('.devices-filters') && !document.querySelector('.devices-result-count') && !document.querySelector('.devices-heading')?.textContent?.includes('Registered Outlet'), 'Outlet transition removes old rows, filters, counts and outlet heading');
  render('last'); await until(() => rows().length === 5, 'last outlet');
  assert(pending[0].signal.aborted && search().value === '' && status().value === 'all', 'Outlet changes abort old requests and reset filters');
  pending[0].resolve(Response.json({ data: { outletName: 'Stale Outlet', devices: [] } })); await pause();
  assert(rows().length === 5 && !document.querySelector('.devices-heading')?.textContent?.includes('Stale Outlet'), 'Late cancelled response cannot replace current outlet');
  empty = true; await refresh();
  assert(document.querySelector('h2')?.textContent === 'No registered devices', 'Empty registration list differs from filtered no-results');
  responseStatus = 401; await refresh();
  assert(expired === 1 && !rows().length, 'Expired authorization uses the session expiry callback and hides rows');
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks }); });
