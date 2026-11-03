import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CustomersPage } from '../src/pages/CustomersPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';

const passed: string[] = [];
function assert(value: unknown, message: string) { if (!value) throw new Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, message: string) {
  for (let i = 0; i < 180; i++) { if (check()) return; await pause(); }
  throw new Error(`Timed out: ${message}`);
}
const customer = (id: number) => ({ documentId: `c${id}`, name: `Customer ${String(id).padStart(3, '0')}`, contact: `9000${id}`,
  altContact: '', email: '', gstNo: '', address: '', creditLimit: 4321.75, dayLimit: 17, balance: -83.25,
  birthdayDate: '1990-02-03', anniversaryDate: '2015-06-07', allowedCredit: true });
const records = Array.from({ length: 205 }, (_, i) => customer(i));
Object.assign(records[204], { name: 'Zebra Trading', contact: '9876543210', altContact: '8123456789',
  email: 'Accounts@Zebra.example', gstNo: '29ZEBRA1234', address: 'Orchid Road, Pune' });
const original = JSON.stringify(records);
const late = { ...customer(205), name: 'Orchid Late Arrival' };
let release!: () => void;
let notify!: () => void;
let refreshed = false;
let reads = 0;
const methods: string[] = [];
const encoder = new TextEncoder();
const line = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);
const observers = new Map<IntersectionObserver, IntersectionObserverCallback>();
window.IntersectionObserver = class {
  constructor(callback: IntersectionObserverCallback) { observers.set(this as unknown as IntersectionObserver, callback); }
  observe() {}
  unobserve() {}
  disconnect() { observers.delete(this as unknown as IntersectionObserver); }
} as unknown as typeof IntersectionObserver;
window.fetch = async (input, init) => {
  const method = init?.method ?? 'GET'; methods.push(method);
  assert(method === 'GET', 'Only mocked GET requests are permitted');
  const url = String(input);
  if (url === '/api/outlets/search/master-sync?kind=customers') {
    return new Response(new ReadableStream({ start(controller) {
      notify = () => { refreshed = true; controller.enqueue(line({ type: 'changed', collection: 'customers', version: '2' })); };
      init?.signal?.addEventListener('abort', () => controller.close(), { once: true });
    } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  }
  if (url.includes('/master-sync?')) return new Response(null, { status: 404 });
  assert(/^\/api\/outlets\/(search|empty|other)\/customers$/.test(url), `Unexpected GET ${url}`);
  reads++;
  if (url !== '/api/outlets/search/customers') return Response.json({ success: true, data: { customers: [] } });
  if (refreshed) return Response.json({ success: true, data: { customers: [...records, { ...late, name: 'Synced Orchid Customer' }] } });
  return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(line({ type: 'total', total: 206 }));
    controller.enqueue(line({ type: 'items', data: records }));
    release = () => {
      controller.enqueue(line({ type: 'items', data: [late] }));
      controller.enqueue(line({ type: 'end', count: 206 })); controller.close();
    };
  } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
};
const root = createRoot(document.getElementById('root')!);
const expired = () => { throw new Error('Unexpected expired session'); };
function render(id = 'search', token = 'token') {
  flushSync(() => root.render(<CustomersPage outlet={{ id, name: id } as OutletSummary} token={token} onSessionExpired={expired} />));
}
const rows = () => [...document.querySelectorAll('.customers-list .master-row')];
const count = () => document.getElementById('customer-search-count')?.textContent ?? '';
const input = () => document.getElementById('customer-search') as HTMLInputElement;
async function search(value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
  input().dispatchEvent(new Event('input', { bubbles: true })); await pause();
}
const clear = () => [...document.querySelectorAll<HTMLButtonElement>('.customers-page button')].find(button => button.textContent === 'Clear search')!;
void (async () => {
  render();
  await until(() => count().includes('205 of 205 loaded'), 'partial loaded count');
  assert(rows().length === 100 && count().includes('More records are loading'), 'Counts include unmounted records and explain incomplete loading');
  for (const [observer, callback] of observers) callback([{ isIntersecting: true } as IntersectionObserverEntry], observer);
  await until(() => rows().length === 200, 'second row batch');
  const beforeSearch = reads;
  for (const term of ['zEbRa TrAdInG', '9876543210', '8123456789', 'accounts@zebra.EXAMPLE', '29zebra1234', 'ORCHID road', '  zebra  ']) {
    await search(term);
    assert(rows().length === 1 && rows()[0].textContent?.includes('Zebra Trading'), `Matches ${term} across all loaded rows`);
    assert(count().startsWith('1 of 205 loaded'), 'Filtered count includes every loaded record');
  }
  assert(reads === beforeSearch, 'Typing never starts a read');
  passed.push('Case-insensitive name, both contacts, email, GST and address matching before batching');
  await search('4321.75');
  assert(rows().length === 0, 'Credit and balance amounts are not search filters');
  await search('no-such-customer');
  assert(document.querySelector('.customer-state h2')?.textContent === 'No matching customers', 'Distinct filtered empty state');
  clear().click(); await pause();
  assert(input().value === '' && document.activeElement === input(), 'Clear search restores input focus');
  assert(rows().length === 100 && count().startsWith('205 of 205'), 'Clear resets batching while retaining full count');
  passed.push('Accessible count, empty search results, focus restoration and batch reset');
  await search('orchid');
  release();
  await until(() => count().startsWith('2 of 206 customers'), 'streamed match and complete count');
  assert(rows().some(row => row.textContent?.includes('Orchid Late Arrival')), 'Active search incorporates streamed records');
  await until(() => notify, 'sync feed'); notify();
  await until(() => rows().some(row => row.textContent?.includes('Synced Orchid Customer')), 'active search sync refresh');
  assert(count() === '2 of 206 customers', 'Sync retains query and full count');
  passed.push('Active query follows incremental stream and master sync updates');
  await search('zebra');
  const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
  assert(rows()[0].textContent?.includes(money(-83.25)) && rows()[0].textContent?.includes(money(4321.75)), 'Displayed balance and credit remain unchanged');
  document.querySelector<HTMLButtonElement>('[aria-label="Edit customer Zebra Trading"]')!.click();
  await until(() => document.querySelector('.customer-form-page'), 'existing editor');
  for (const [id, value] of Object.entries({ name: 'Zebra Trading', contact: '9876543210', 'alt-contact': '8123456789',
    email: 'Accounts@Zebra.example', gst: '29ZEBRA1234', address: 'Orchid Road, Pune', 'credit-limit': '4321.75',
    'day-limit': '17', balance: '-83.25' })) {
    assert((document.getElementById(`customer-${id}`) as HTMLInputElement).value === value, `Editor preserves ${id}`);
  }
  for (const [id, date] of [['birth-date', '1990-02-03'], ['anniversary-date', '2015-06-07']]) {
    const display = new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    assert(document.getElementById(`customer-${id}`)?.textContent?.includes(display), `Editor preserves ${id}`);
  }
  assert((document.getElementById('customer-credit-only') as HTMLInputElement).checked, 'Credit preference unchanged');
  document.querySelector<HTMLButtonElement>('[aria-label="Close customer form"]')!.click();
  await until(() => input(), 'return from editor');
  assert(input().value === 'zebra' && rows().length === 1, 'Query survives editor cancellation');
  assert(JSON.stringify(records) === original, 'Search never mutates any customer values');
  passed.push('Financial values and every editor field preserved; no saves or deletes invoked');
  // Scope changes must hide the old list synchronously, before loading effects complete.
  render('other');
  assert(!document.querySelector('[aria-label="Edit customer Zebra Trading"]') && input().value === '', 'Outlet rerender hides old rows and query immediately');
  await until(() => document.querySelector('.customer-state h2')?.textContent === 'No customers found', 'outlet empty state');
  render('empty', 'different-token');
  await until(() => count() === '0 of 0 customers', 'empty scoped list');
  await search('zebra');
  assert(document.querySelector('.customer-state h2')?.textContent === 'No customers found', 'An empty customer list remains distinct from filtered empty results');
  assert(methods.every(method => method === 'GET'), 'All requests were mocked reads');
  passed.push('Outlet/session scope isolation and distinct unassigned state; GET requests only');
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed }); });
