import { createRoot } from 'react-dom/client';
import { GoodsReceiptHistory } from '../src/pages/GoodsReceiptHistory.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';
const passed: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const requests: { url: URL; signal?: AbortSignal | null; resolve: (value: Response) => void }[] = [];
window.fetch = (url, init) => {
  assert(!init?.method || init.method === 'GET', 'Only read history');
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Authorized history');
  return new Promise(resolve => requests.push({ url: new URL(String(url), location.origin), signal: init?.signal, resolve }));
};
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
const deadlines = new Map<number, () => void>();
const nativeTimeout = window.setTimeout.bind(window), nativeClear = window.clearTimeout.bind(window);
let timerId = -1;
window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
  if (delay === 20000) { const id = timerId--; deadlines.set(id, handler as () => void); return id; }
  return nativeTimeout(handler, delay, ...args);
}) as typeof window.setTimeout;
window.clearTimeout = ((id?: number) => { if (id !== undefined && deadlines.delete(id)) return; nativeClear(id); }) as typeof window.clearTimeout;
async function until(check: () => unknown, label: string) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${label}`); }
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
const reply = (index: number, reference: string, cursor: string | null) => requests[index]!.resolve(Response.json({ success: true, data: { receipts: [{ documentId: reference, fields: { createDate: Date.now(), goodsReceivedNo: reference, type: 'STOCK-IN', goodsReceivedItemBeanList: [{ productid: 'rice', name: 'Rice', quantity: 4 }] } }], nextCursor: cursor } }));
const root = createRoot(document.getElementById('root')!);
let expired = 0, closed = false;
const render = (id: string) => root.render(<GoodsReceiptHistory key={id} outletId={id} token="token" onSessionExpired={() => { expired++; }} onClose={() => { closed = true; root.unmount(); }} />);
void (async () => {
  render('a'); await until(() => requests.length === 1, 'initial page');
  assert(requests[0]!.url.searchParams.get('limit') === '25' && requests[0]!.url.searchParams.get('history') === '1', 'History requests one bounded page');
  reply(0, 'Receipt One', 'next-page'); await until(() => document.body.textContent?.includes('Receipt One'), 'first receipt');
  button('Next history page').click(); await until(() => requests.length === 2, 'next page');
  assert(!document.body.textContent?.includes('Receipt One') && requests[1]!.url.searchParams.get('cursor') === 'next-page', 'Paging hides prior results and uses cursor');
  reply(1, 'Receipt Two', null); await until(() => document.body.textContent?.includes('Receipt Two'), 'second page');
  assert(button('Next history page').disabled && !button('Previous history page').disabled, 'Last page has correct navigation');
  button('Apply dates').click(); await until(() => requests.length === 3, 'apply resets cursor');
  assert(!requests[2]!.url.searchParams.has('cursor'), 'Applying filters returns to first page');
  render('b'); await until(() => requests.length === 4, 'new outlet');
  assert(requests[2]!.signal?.aborted, 'Old outlet request cancelled');
  reply(3, 'Private B', null); await until(() => document.body.textContent?.includes('Private B'), 'B result');
  reply(2, 'Stale A', null); await pause(); assert(!document.body.textContent?.includes('Stale A'), 'Late old outlet body cannot leak');
  passed.push('History pages by cursor, resets dates to first page, and cancels stale outlet reads');
  button('Apply dates').click(); await until(() => requests.length === 5, 'auth read');
  requests[4]!.resolve(Response.json({ success: false, message: 'Expired' }, { status: 401 }));
  await until(() => expired === 1 && button('Retry history'), 'read error');
  button('Retry history').click(); await until(() => requests.length === 6, 'retry read');
  assert(deadlines.size === 1, 'A single deadline bounds the whole read');
  [...deadlines.values()][0]!();
  await until(() => document.querySelector('[role="alert"]')?.textContent?.includes('timed out'), 'bounded timeout');
  assert(requests[5]!.signal?.aborted, 'Timeout aborts its request');
  reply(5, 'Timed-out result', null); await pause(); assert(!document.body.textContent?.includes('Timed-out result'), 'Late timed-out results stay hidden');
  button('Retry history').click(); await until(() => requests.length === 7, 'retry timeout');
  button('Close history').click(); await pause(); assert(closed && requests[6]!.signal?.aborted, 'Closing cancels a pending read');
  passed.push('Authentication errors are truthful, retry works, and closing cancels pending reads without writes');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed }); });
