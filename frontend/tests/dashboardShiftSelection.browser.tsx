import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import App from '../src/App.tsx';
import '../src/index.css';
import '../src/App.css';
import { getDataLoadingSnapshot } from '../src/utils/dataLoading.ts';

localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'Session Owner', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'shop', name: 'Test Outlet' }));
const checks: string[] = [];
function assert(ok: unknown, message: string) { if (!ok) throw new Error(message); checks.push(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 100; i++) { if (check()) return; await pause(); } throw new Error('Timeout: ' + label); }
const nativeTimeout = window.setTimeout.bind(window);
const deadlines = new Map<number, () => void>();
window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
  const id = nativeTimeout(handler, delay, ...args);
  if (delay === 20_000 && typeof handler === 'function') deadlines.set(id, () => handler());
  return id;
}) as typeof window.setTimeout;
const nativeClear = window.clearTimeout.bind(window);
window.clearTimeout = ((id?: number) => { if (id !== undefined) deadlines.delete(id); nativeClear(id); }) as typeof window.clearTimeout;
function expireRead() { assert(deadlines.size === 1, 'Each in-flight read has one 20-second deadline'); [...deadlines.values()][0]!(); }
const shift = (id: string, deviceId: string, startTime: number, totalSale: number, shiftNo = 1) => ({
  id, deviceId, shiftNo, creatorName: `Owner ${deviceId}`, inActive: false, startTime, endTime: 0,
  startBillNo: '1', lastBillNo: '2', dayId: '', totalSale, cashSale: totalSale, digitalSale: 0,
  openingAmt: 0, expCash: 0, billCount: 1, payments: { cash: totalSale },
});
let rows = [shift('private-doc-a', 'Counter A', 1000, 100), shift('private-doc-b', 'Counter B', 2000, 200), shift('private-doc-c', 'Counter C', 3000, 400, 2)];
let mode: 'ok' | 'body' | 'transport' | 'error' | 'invalid' | 'missing' | 'mismatch' = 'ok';
let resolveBody: ((value: unknown) => void) | undefined;
let resolveTransport: ((response: Response) => void) | undefined;
let requests = 0;
let lastDay = '';
const payload = (day: string, total = 700) => ({ success: true, data: { ...rows[0], id: 'aggregate', dayId: day, totalSale: total,
  shifts: rows.map(row => ({ ...row, dayId: day })) } });
window.fetch = async (input, init) => {
  assert(!init?.method || init.method === 'GET', 'Fixture requests are GET only');
  if (String(input) === '/api/outlets/shop/profile') return Response.json({ success: true, data: { name: 'Session Owner' } });
  assert(String(input).startsWith('/api/outlets/shop/dashboard?dayId='), 'Only mocked dashboard reads are used');
  assert((init?.headers as Record<string, string>).Authorization === 'Bearer mock-token', 'Dashboard preserves the token header');
  lastDay = new URL(String(input), location.href).searchParams.get('dayId')!;
  requests++;
  if (mode === 'body') return { ok: true, status: 200, json: () => new Promise(resolve => { resolveBody = resolve; }) } as Response;
  if (mode === 'transport') return new Promise(resolve => { resolveTransport = resolve; });
  if (mode === 'error') throw new Error('Mock offline');
  if (mode === 'missing') return Response.json({ success: false, message: 'No shift data for this day.' }, { status: 404 });
  if (mode === 'mismatch') return Response.json(payload('1900-01-01', 9999));
  return Response.json(mode === 'invalid' ? { data: { dayId: lastDay, shifts: 'invalid' } } : payload(lastDay));
};
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('.page-hero [role=tab]')];
const sale = () => [...document.querySelectorAll('.kpi-card')].find(card => card.querySelector('.kpi-card-topline > span')?.textContent === 'Total Sale')?.querySelector('strong')?.textContent;
const exportButton = () => document.querySelector<HTMLButtonElement>('[title="Export all shifts for the selected date"]')!;
const notice = () => document.querySelector('.dashboard-data-notice.error')?.textContent;
const retry = () => document.querySelector<HTMLButtonElement>('.dashboard-data-notice.error button')!.click();
const key = (index: number, name: string) => tabs()[index]!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
void (async () => {
  await until(() => tabs().length === 4, 'initial shifts');
  assert(tabs()[1]!.textContent?.includes('Counter A') && tabs()[2]!.textContent?.includes('Counter B') && tabs()[3]!.textContent === 'Shift 2', 'Duplicate numbers include device/time while unique numbers retain simple labels');
  assert(!document.body.textContent?.includes('private-doc'), 'Document IDs never appear in visible labels');
  assert(document.querySelector('.shift-device-id')?.textContent === 'Counter C', 'All Shifts metadata uses the latest active shift deterministically');
  assert(tabs().filter(tab => tab.tabIndex === 0).length === 1, 'Tablist has one tab stop');
  tabs()[0]!.focus(); key(0, 'ArrowRight'); await pause();
  assert(document.activeElement === tabs()[1] && tabs()[1]!.getAttribute('aria-selected') === 'true' && sale()?.includes('100'), 'Right arrow focuses and selects the actual first document');
  key(1, 'ArrowRight'); await pause();
  assert(sale()?.includes('200') && document.querySelector('.shift-device-id')?.textContent === 'Counter B', 'Equal shift numbers select separate document metrics and metadata');
  key(2, 'End'); await pause(); assert(document.activeElement === tabs()[3], 'End selects the final tab');
  key(3, 'Home'); await pause(); assert(document.activeElement === tabs()[0], 'Home selects All Shifts');
  key(0, 'ArrowLeft'); await pause(); assert(document.activeElement === tabs()[3], 'Left arrow wraps to the final tab');
  assert(tabs().every(tab => document.getElementById(tab.getAttribute('aria-controls')!)?.getAttribute('role') === 'tabpanel'), 'Tabs control the dashboard panel');
  assert(document.querySelector('[role=tabpanel]')?.getAttribute('aria-labelledby') === tabs()[3]!.id, 'Panel is labelled by the selected tab');
  assert(exportButton().textContent === 'Export All Shifts', 'Export scope remains all shifts regardless of selection');
  rows = rows.slice(0, 2); window.dispatchEvent(new Event('focus'));
  await until(() => tabs().length === 3, 'vanished selection refresh');
  assert(tabs()[0]!.getAttribute('aria-selected') === 'true' && tabs().filter(tab => tab.tabIndex === 0).length === 1, 'Vanished selected document normalizes to All Shifts');
  mode = 'error'; window.dispatchEvent(new Event('online'));
  await until(() => notice()?.includes('Last updated'), 'background error');
  assert(sale()?.includes('700') && notice()?.includes('last good data') && exportButton().disabled, 'Last-good same-scope data is clearly marked and cannot export');
  mode = 'ok'; retry(); await until(() => !notice() && !exportButton().disabled, 'retry success');
  mode = 'body'; const beforeBody = requests; window.dispatchEvent(new Event('focus'));
  await until(() => !!resolveBody, 'stalled body');
  window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); await pause();
  assert(requests === beforeBody + 1, 'Focus and online do not duplicate an in-flight body read');
  expireRead(); await until(() => notice()?.includes('timed out'), 'body deadline');
  assert(!getDataLoadingSnapshot().tasks.some(task => task.label === 'Dashboard') && exportButton().disabled, 'Body timeout releases loading and disables export');
  const lateBody = resolveBody!; mode = 'ok'; retry(); await until(() => !notice(), 'body retry');
  lateBody(payload(lastDay, 9999)); await pause(); assert(!sale()?.includes('9,999'), 'Late timed-out body cannot replace a recovered snapshot');
  mode = 'transport'; window.dispatchEvent(new Event('focus')); await until(() => !!resolveTransport, 'stalled transport');
  expireRead(); await until(() => notice()?.includes('timed out'), 'transport deadline');
  const lateTransport = resolveTransport!; mode = 'ok'; retry(); await until(() => !notice(), 'transport retry');
  lateTransport(Response.json(payload(lastDay, 9999))); await pause(); assert(!sale()?.includes('9,999'), 'Late timed-out transport cannot overwrite retry data');
  mode = 'body'; resolveBody = undefined; window.dispatchEvent(new Event('focus')); await until(() => !!resolveBody, 'old day body');
  const oldDay = lastDay; const oldBody = resolveBody!;
  document.querySelector<HTMLButtonElement>('#dashboard-report-date')!.click(); await pause();
  const otherDate = [...document.querySelectorAll<HTMLButtonElement>('[data-date]')].find(button => button.dataset.date !== oldDay && !button.disabled)!;
  mode = 'transport'; resolveTransport = undefined;
  flushSync(() => otherDate.click());
  assert(!sale()?.includes('700') && !document.querySelector('.shift-device-id')?.textContent?.includes('Counter'), 'New day hides previous totals and metadata during the selecting render');
  await until(() => !!resolveTransport, 'new day request');
  const newDay = lastDay;
  oldBody(payload(oldDay, 9999)); await pause(); assert(!sale()?.includes('9,999'), 'Old day response cannot enter the new render scope');
  const lateNewDay = resolveTransport!;
  expireRead(); await until(() => notice()?.includes('timed out'), 'new day foreground deadline');
  assert(!document.querySelector('[data-inline-loading]') && !getDataLoadingSnapshot().tasks.some(task => task.label === 'Dashboard'), 'Foreground timeout releases both inline and modal loaders');
  mode = 'ok'; retry(); await until(() => !notice() && sale()?.includes('700'), 'new day retry');
  lateNewDay(Response.json(payload(newDay, 9999))); await pause();
  assert(!sale()?.includes('9,999'), 'Late foreground response cannot overwrite the retried day');
  mode = 'invalid'; window.dispatchEvent(new Event('online')); await until(() => notice()?.includes('valid shift data'), 'invalid snapshot');
  assert(exportButton().disabled && sale()?.includes('700'), 'Malformed refresh retains only clearly marked last-good data');
  mode = 'missing'; window.dispatchEvent(new Event('focus')); await until(() => tabs().length === 1, 'missing day');
  assert(notice()?.includes('No shift data') && !sale()?.includes('700') && exportButton().disabled, 'Missing day clears last-good figures and prevents export');
  mode = 'mismatch'; retry(); await until(() => notice()?.includes('valid shift data') && !document.querySelector('[data-inline-loading]'), 'mismatched day');
  assert(tabs().length === 1 && !sale()?.includes('9,999') && exportButton().disabled, 'A successful response for the wrong day is rejected');
  root.unmount();
  assert(!getDataLoadingSnapshot().tasks.some(task => task.label === 'Dashboard'), 'Unmount releases dashboard loading');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
})().catch(error => { root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks }); });
