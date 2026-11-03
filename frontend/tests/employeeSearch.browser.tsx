import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { EmployeesPage } from '../src/pages/EmployeesPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import { clearMasterSnapshots } from '../src/utils/masterSnapshots.ts';
import '../src/index.css';

const checks: string[] = [];
function assert(ok: unknown, message: string) { if (!ok) throw new Error(message); checks.push(message); }
const pause = () => new Promise<void>(resolve => window.setTimeout(resolve, 20));
async function until(check: () => unknown, message: string) {
  for (let i = 0; i < 120; i++) { if (check()) return; await pause(); }
  throw new Error(`Timeout: ${message}`);
}
const records = Object.freeze([
  Object.freeze({ documentId: 'a', name: 'Alice Rao', mobile: '+91 98765 43210', searchCode: 12, shortName: 'AR', balanceAmt: '-25.50', dateOfJoining: '2021-03-04', userId: 'u1' }),
  Object.freeze({ documentId: 'b', name: 'Bala Shah', mobile: '9000012345', searchCode: 34, shortName: 'Bee', balanceAmt: '100.00', dateOfJoining: '2023-06-07', userId: 'missing' }),
  Object.freeze({ documentId: 'c', name: 'Carol Das', mobile: '', searchCode: null, shortName: 'CD', balanceAmt: '0.00', dateOfJoining: '', userId: '' }),
]);
const accounts = Object.freeze([Object.freeze({ userId: 'u1', name: 'Morgan Patel' })]);
const data = Object.freeze({ employees: records, nextSearchCode: 35, userAccounts: accounts });
const original = JSON.stringify(data);
type Pending = { path: string; token: string; signal: AbortSignal | null | undefined; respond: (value: unknown, status?: number) => void };
const pending: Pending[] = [];
let requestCount = 0, expired = 0;
window.fetch = (input, init) => {
  requestCount++;
  assert((init?.method ?? 'GET') === 'GET', 'Fixture permits GET requests only');
  assert(/^\/api\/outlets\/[^/]+\/employees$/.test(String(input)), 'Only the employee list is requested');
  return new Promise<Response>(resolve => pending.push({ path: String(input), token: new Headers(init?.headers).get('Authorization') ?? '', signal: init?.signal,
    respond(value, status = 200) {
      const response = new Response(null, { status });
      response.json = async () => value;
      resolve(response);
    } }));
};
const root = createRoot(document.getElementById('root')!);
const onSessionExpired = () => { expired++; };
const outlet = (id: string): OutletSummary => ({ id, name: id, branch: '', country: '', dealerCode: '', fssaiNo: '', businessId: '', restaurantId: '', active: true, renewalDate: null, isPrimary: false });
function render(id = 'shop', token = 'token-a') { flushSync(() => root.render(<EmployeesPage outlet={outlet(id)} token={token} onSessionExpired={onSessionExpired} />)); }
const rows = () => [...document.querySelectorAll<HTMLTableRowElement>('.employees-table-scroll tbody tr')];
const names = () => rows().map(row => row.cells[0].textContent).join(',');
const search = () => document.getElementById('employee-search') as HTMLInputElement;
async function query(value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search(), value);
  search().dispatchEvent(new Event('input', { bubbles: true })); await pause();
}
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text)!;
async function clear() { button('Clear search').click(); await pause(); }
const field = (id: string) => document.getElementById(`employee-${id}`) as HTMLInputElement;

void (async () => {
  clearMasterSnapshots(); render(); await until(() => pending.length === 1, 'initial list');
  pending[0].respond({ data }); await until(search, 'search control');
  assert(names() === 'Alice Rao,Bala Shah,Carol Das', 'Default order follows the original search-code order');
  assert(document.querySelector('label[for="employee-search"]')?.textContent === 'Search employees' && search().getAttribute('aria-describedby') === 'employee-search-count', 'Search has a visible label and result description');
  const count = document.getElementById('employee-search-count')!;
  assert(count.getAttribute('role') === 'status' && count.textContent === '3 of 3 employees', 'Result count is announced accessibly');
  const reads = requestCount;
  for (const [value, expected] of [['  aLiCe  ', 'Alice Rao'], ['98765', 'Alice Rao'], ['12', 'Alice Rao,Bala Shah'], ['bEE', 'Bala Shah'], ['mORgAN', 'Alice Rao'], ['Assigned account', 'Bala Shah'], ['Not assigned', 'Carol Das']]) {
    await query(value); assert(names() === expected, `Local search matches ${value.trim()}`);
  }
  await query('missing');
  assert(document.querySelector('.employees-state h2')?.textContent === 'No matching employees' && !rows().length, 'Unavailable account IDs are not treated as display names');
  assert(count.textContent === '0 of 3 employees' && !document.body.textContent?.includes('No employees found'), 'Filtered empty state differs from an empty outlet');
  assert(!!button('Add Employee') && !button('Add Employee').disabled, 'Add Employee remains available for no matches');
  document.querySelector<HTMLButtonElement>('[aria-label="Employee options"]')!.click(); await pause();
  assert(!button('Delete All').disabled, 'Delete All remains enabled when a nonempty outlet has no matches');
  button('Delete All').click(); await until(() => document.querySelector('dialog[open]'), 'delete all confirmation');
  assert(document.querySelector('.action-popup-question')?.textContent?.includes('all employees'), 'Delete All still confirms all employees');
  document.querySelector<HTMLButtonElement>('.delete-confirmation-cancel')!.click(); await pause();
  await clear();
  assert(document.activeElement === search() && search().value === '' && rows().length === 3, 'Clear restores all records and focuses search');
  await query('bee'); rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await until(() => field('name'), 'filtered edit');
  assert(field('name').value === records[1].name && field('mobile').value === records[1].mobile && field('code').value === '34' && field('short-name').value === 'Bee' && field('balance').value === '100.00', 'Filtered row opens the exact existing record with unchanged values');
  document.querySelector<HTMLButtonElement>('[aria-label="Close employee form"]')!.click(); await until(search, 'close edit');
  await query('morgan'); rows()[0].click(); await until(() => field('name'), 'linked edit');
  assert(field('balance').value === '-25.50' && (field('user') as unknown as HTMLSelectElement).value === 'u1' && document.querySelector('[aria-label^="Joining Date:"]')?.getAttribute('aria-label')?.includes('2021'), 'Edit retains credit balance, linked account and joining date');
  document.querySelector<HTMLButtonElement>('[aria-label="Close employee form"]')!.click(); await until(search, 'close linked edit');
  assert(requestCount === reads && JSON.stringify(data) === original, 'Searching, resetting and opening editors never fetch or mutate source data');
  await clear();
  const controls = document.querySelector('.employees-search-controls')!.getBoundingClientRect();
  assert(controls.left >= 0 && controls.right <= innerWidth && search().getBoundingClientRect().right <= innerWidth, 'Search controls fit the viewport');

  render('slow'); await until(() => pending.length === 2, 'slow outlet');
  assert(!document.querySelector('.employees-table-scroll') && !search(), 'Changing outlet immediately hides old records and search');
  render('new'); await until(() => pending.length === 3, 'new outlet');
  assert(pending[1].signal?.aborted && pending[2].path === '/api/outlets/new/employees', 'Outlet switch aborts the old list and requests the new outlet');
  pending[2].respond({ data: { ...data, employees: [{ ...records[0], name: 'New outlet person' }] } });
  await until(() => names() === 'New outlet person', 'new outlet data');
  pending[1].respond({ data }); await pause();
  assert(names() === 'New outlet person', 'Late old-outlet response cannot replace current records');
  await query('new'); render('new', 'token-b'); await until(() => pending.length === 4, 'new token');
  assert(!search() && !rows().length && pending[3].token === 'Bearer token-b', 'Token change immediately isolates previous records and search');
  render('new', 'token-c'); await until(() => pending.length === 5, 'latest token');
  assert(pending[3].signal?.aborted, 'Session switch aborts the previous session read');
  pending[4].respond({ data: { ...data, employees: [] } }); await until(search, 'empty latest session');
  pending[3].respond({ message: 'Old session expired' }, 401); await pause();
  assert(expired === 0 && rows().length === 0 && document.querySelector('.employees-state h2')?.textContent === 'No employees found', 'Late old-token response cannot expire the latest session or show stale records');
  assert(document.querySelector('.employees-state p')?.textContent === 'Add a employee to get started.' && !!document.querySelector('.employees-state .btn-primary-add'), 'Original empty-list copy and Add Employee are preserved');
  assert(search().value === '' && document.getElementById('employee-search-count')?.textContent === '0 of 0 employees', 'New session begins with an empty search and correct count');
  assert(JSON.stringify(data) === original, 'Source records, account data and ordering remain unchanged');
  if (!location.hash.includes('preview')) root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks }); });
