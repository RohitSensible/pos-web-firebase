import { createRoot } from 'react-dom/client';
import { OutletSelectionPage } from '../src/pages/OutletSelectionPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import { getDataLoadingSnapshot } from '../src/utils/dataLoading.ts';
import '../src/index.css';

const checks: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, label: string) {
  for (let i = 0; i < 200; i++) { if (check()) return; await pause(); }
  throw new Error(label);
}
const session = { token: 'mock-token', id: 'user', name: 'Test User', email: 'user@example.com', role: 'Admin', terminal: 'POS' };
const outlets: OutletSummary[] = [true, false].map((active, index) => ({
  id: `outlet-${index}`, name: 'A long outlet name for checking narrow screen readability',
  branch: 'Market Road', country: 'India', dealerCode: 'DEALER123456789012345678901234567890',
  fssaiNo: '12345678901234', businessId: 'business', restaurantId: 'restaurant', active,
  renewalDate: null, isPrimary: active,
}));
let respond: ((response: Response) => void) | undefined;
let selected: OutletSummary | undefined;
let logoutCount = 0;
let requestCount = 0;
window.fetch = async (input, init) => {
  assert(String(input) === '/api/auth/outlets' && (!init?.method || init.method === 'GET'), 'Only the existing outlets read endpoint is used');
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer mock-token' && !!init?.signal, 'Reads preserve authorization and cancellation');
  requestCount++;
  return new Promise<Response>(resolve => { respond = resolve; });
};
const root = createRoot(document.getElementById('root')!);
const onLogout = () => { logoutCount++; };
const render = (key: string) => root.render(<OutletSelectionPage key={key} session={session} onSelect={outlet => { selected = outlet; }} onLogout={onLogout} />);
const search = () => document.querySelector<HTMLInputElement>('input[type="search"]')!;
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)!;
function searchFor(value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search(), value);
  search().dispatchEvent(new Event('input', { bubbles: true }));
}
void (async () => {
  render('initial');
  await until(() => respond && getDataLoadingSnapshot().tasks.length, 'Initial read did not start');
  assert(document.querySelector('[data-inline-loading]')?.getAttribute('role') === 'status' && document.querySelector('section')?.getAttribute('aria-busy') === 'true', 'Pending reads expose a loading status and busy region');
  respond!(Response.json({ message: 'Service temporarily unavailable. Please retry.' }, { status: 503 }));
  await until(() => document.querySelector('[role="alert"]'), 'Read failure did not display');
  assert(document.querySelector('[role="alert"]')?.textContent?.includes('Service temporarily unavailable'), 'Read errors retain the useful server message');
  assert(getDataLoadingSnapshot().tasks.length === 0, 'Failed reads release the existing loading service');
  button('Retry').focus();
  assert(document.activeElement === button('Retry'), 'Retry is a focusable native button');
  respond = undefined;
  button('Retry').click();
  await until(() => respond && requestCount === 2, 'Retry did not issue another read');
  assert(!document.querySelector('[role="alert"]') && !!document.querySelector('[data-inline-loading]'), 'Retry replaces the error with loading feedback');
  respond!(Response.json({ success: true, data: { outlets } }));
  await until(() => search() && document.querySelectorAll('.outlet-card').length === 2, 'Retry did not restore outlets');
  assert(search().getAttribute('aria-describedby') === 'outlet-search-count', 'Search describes its result count');
  searchFor('no-such-outlet');
  await until(() => button('Clear search'), 'No-results recovery action missing');
  assert(document.getElementById('outlet-search-count')?.textContent === '0 of 2 outlets' && document.getElementById('outlet-search-count')?.getAttribute('role') === 'status', 'Filtering updates the announced result count');
  button('Clear search').click();
  await until(() => document.querySelectorAll('.outlet-card').length === 2, 'Clear search did not restore outlets');
  assert(document.activeElement === search() && search().value === '', 'Clearing no-results returns focus to the empty search input');
  searchFor('DEALER123');
  await until(() => document.querySelector('[aria-label="Clear outlet search"]'), 'Search clear button missing');
  document.querySelector<HTMLButtonElement>('[aria-label="Clear outlet search"]')!.click();
  await pause();
  assert(document.activeElement === search() && search().value === '', 'Inline clear also preserves search focus');
  assert(getComputedStyle(document.getElementById('outlet-search-count')!).display !== 'none', 'Result count remains visible at this viewport width');
  assert(document.querySelector('.outlet-selection-page')!.scrollWidth <= window.innerWidth, 'Outlet picker fits the viewport without horizontal overflow');
  const openButtons = [...document.querySelectorAll<HTMLButtonElement>('.outlet-card-footer button')];
  assert(openButtons.every(node => node.tagName === 'BUTTON' && node.type === 'button' && node.getAttribute('aria-label')?.includes('outlet-')), 'Outlet actions retain native keyboard behavior and distinct accessible names');
  openButtons[1].click();
  assert(openButtons[1].disabled && !selected, 'Inactive outlets cannot be selected');
  openButtons[0].focus();
  assert(document.activeElement === openButtons[0], 'Active outlet action accepts keyboard focus');
  openButtons[0].click();
  assert(selected === outlets[0] || JSON.stringify(selected) === JSON.stringify(outlets[0]), 'Opening an outlet passes its exact existing data to the callback');
  button('Sign out').click();
  assert(logoutCount === 1, 'Sign out preserves its callback');
  respond = undefined;
  render('empty');
  await until(() => respond, 'Empty-account read missing');
  respond!(Response.json({ success: true, data: { outlets: [] } }));
  await until(() => document.querySelector('.outlet-state-card')?.textContent?.includes('No outlets are assigned'), 'Empty account feedback missing');
  assert(!search() && !button('Clear search'), 'Unassigned accounts do not show search recovery actions');
  respond = undefined;
  render('unauthorized');
  await until(() => respond, 'Unauthorized read missing');
  respond!(Response.json({ message: 'Session expired' }, { status: 401 }));
  await until(() => logoutCount === 2, 'Unauthorized read did not sign out');
  assert(logoutCount === 2, 'Unauthorized reads preserve session expiry handling');
  root.unmount();
  assert(getDataLoadingSnapshot().tasks.length === 0, 'Unmount leaves no loading tasks');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
