import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useStockTransferRead } from '../src/pages/useStockTransferRead.ts';
import { getDataLoadingSnapshot } from '../src/utils/dataLoading.ts';
import '../src/index.css';

const checks: string[] = [], unhandled: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
window.addEventListener('unhandledrejection', event => { unhandled.push(String(event.reason)); event.preventDefault(); });
// Advance only the hook's deadline. React and the shared loading indicator keep
// their normal scheduling; no wall-clock wait or real network is necessary.
const realSetTimeout = window.setTimeout.bind(window), realClearTimeout = window.clearTimeout.bind(window);
const deadlines = new Map<number, () => void>();
let timerId = -1;
window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
  if (delay !== 20_000) return realSetTimeout(handler, delay, ...args);
  if (typeof handler !== 'function') throw new Error('Expected a deadline callback');
  const id = timerId--;
  deadlines.set(id, () => handler(...args));
  return id;
}) as typeof window.setTimeout;
window.clearTimeout = (id?: number) => { if (id !== undefined && deadlines.delete(id)) return; realClearTimeout(id); };
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise<void>(resolve => realSetTimeout(resolve, 0)); };
const expire = async () => {
  assert(deadlines.size === 1, 'Exactly one bounded deadline is active for the current read');
  const [id, callback] = [...deadlines][0]; deadlines.delete(id);
  flushSync(callback); await settle();
};
type Request = { url: string; token: string | null; signal: AbortSignal; resolve: (response: Response) => void; reject: (reason: unknown) => void };
const requests: Request[] = [];
window.fetch = (input, init) => {
  if ((init?.method ?? 'GET') !== 'GET') throw new Error('Only GET is allowed');
  if (!init?.signal) throw new Error('Reads must be cancellable');
  // Deliberately ignore cancellation to exercise stale-result protection too.
  return new Promise<Response>((resolve, reject) => requests.push({ url: String(input), token: new Headers(init.headers).get('Authorization'), signal: init.signal!, resolve, reject }));
};
window.Worker = class { constructor() { throw new Error('Unexpected worker in read-only fixture'); } } as unknown as typeof Worker;

type Row = { id: string };
type Kind = 'outlets' | 'products' | 'categories';
let latest!: ReturnType<typeof useStockTransferRead<Row>>;
let expiryCount = 0, expiryVersion = '';
function Harness({ url, token, kind, version }: { url: string | null; token: string; kind: Kind; version: string }) {
  latest = useStockTransferRead<Row>(url, token, kind, () => { expiryCount++; expiryVersion = version; });
  return <output>{latest.loading ? 'loading' : latest.error || JSON.stringify(latest.data)}</output>;
}
const root = createRoot(document.getElementById('root')!);
const render = (url: string | null, kind: Kind = 'outlets', token = 'read-token', version = 'initial') =>
  flushSync(() => root.render(<Harness url={url} kind={kind} token={token} version={version} />));
const lastRequest = () => requests[requests.length - 1];
const succeed = (request: Request, kind: Kind, id: string) => request.resolve(Response.json({ success: true, data: kind === 'outlets' ? { outlets: [{ id }] } : [{ id }] }));
const retry = async () => { flushSync(() => latest.retry()); await settle(); };
const timeoutShown = (kind: Kind) => !latest.loading && latest.data === null && latest.error.includes(`${kind} timed out`) && latest.error.includes('retry');

void (async () => {
  render('/fixture/outlets'); await settle();
  const stalledOutlet = lastRequest(), beforeRerender = requests.length;
  render('/fixture/outlets', 'outlets', 'read-token', 'new-handler'); await settle();
  assert(requests.length === beforeRerender && !stalledOutlet.signal.aborted, 'An inline expiry callback changing identity does not restart the read');
  await expire();
  assert(timeoutShown('outlets') && stalledOutlet.signal.aborted, 'A stalled outlet fetch aborts and releases loading with an actionable timeout');
  assert(requests.length === beforeRerender, 'Timeout never automatically retries the read');
  await retry();
  assert(latest.loading && !latest.error && lastRequest() !== stalledOutlet, 'Explicit retry clears the timeout and starts a fresh read');
  succeed(lastRequest(), 'outlets', 'recovered'); await settle();
  assert(latest.data?.[0]?.id === 'recovered' && !latest.error && !latest.loading && deadlines.size === 0, 'Retry success publishes data and clears the deadline');
  succeed(stalledOutlet, 'outlets', 'late'); await settle();
  assert(latest.data?.[0]?.id === 'recovered', 'A timed-out request resolving after retry cannot overwrite recovered data');

  render('/fixture/body'); await settle();
  const bodyRequest = lastRequest();
  let releaseBody!: (value: { success: boolean; data: { outlets: Row[] } }) => void;
  bodyRequest.resolve({ status: 200, ok: true, json: () => new Promise(resolve => { releaseBody = resolve; }) } as Response);
  await settle(); await expire();
  assert(timeoutShown('outlets') && bodyRequest.signal.aborted, 'The deadline also covers an outlet response whose JSON body stalls');
  releaseBody({ success: true, data: { outlets: [{ id: 'late-body' }] } }); await settle();
  assert(timeoutShown('outlets'), 'A late outlet body cannot clear its timeout error');

  render('/fixture/categories', 'categories'); await settle();
  const categories = lastRequest();
  let releaseText!: (text: string) => void;
  categories.resolve({ status: 200, ok: true, text: () => new Promise<string>(resolve => { releaseText = resolve; }) } as Response);
  await settle(); await expire();
  assert(timeoutShown('categories') && categories.signal.aborted, 'A stalled category response body aborts and releases loading');
  await retry(); succeed(lastRequest(), 'categories', 'fresh-category'); await settle();
  releaseText(JSON.stringify({ success: true, data: [{ id: 'late-category' }] })); await settle();
  assert(latest.data?.[0]?.id === 'fresh-category' && deadlines.size === 0, 'Category retry recovers and ignores the previous response body');

  render('/fixture/products', 'products'); await settle();
  const stalledProduct = lastRequest(); await expire();
  assert(timeoutShown('products') && stalledProduct.signal.aborted, 'Product fetch stalls share the bounded read deadline');
  await retry();
  const streamed = lastRequest();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  streamed.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), { headers: { 'Content-Type': 'application/x-ndjson' } }));
  stream.enqueue(encoder.encode(JSON.stringify({ type: 'items', data: [{ id: 'partial' }] }) + '\n'));
  await settle();
  assert(latest.loading && latest.data === null, 'Partial product batches stay loading until the stream completes');
  await expire();
  assert(timeoutShown('products') && streamed.signal.aborted, 'A stream stalled after a product batch times out and aborts');
  assert(getDataLoadingSnapshot().tasks.length === 0, 'Aborting a stalled stream also releases the shared loading indicator');
  await retry(); succeed(lastRequest(), 'products', 'fresh-product'); await settle();
  stream.enqueue(encoder.encode(JSON.stringify({ type: 'end' }) + '\n')); stream.close();
  succeed(stalledProduct, 'products', 'late-product'); await settle();
  assert(latest.data?.[0]?.id === 'fresh-product' && !latest.error && deadlines.size === 0, 'Product retry recovers and neither the old fetch nor late stream can replace it');

  render('/fixture/old-source', 'products'); await settle();
  const oldSource = lastRequest();
  render('/fixture/new-source', 'products'); await settle();
  const oldToken = lastRequest();
  assert(oldSource.signal.aborted && !latest.error && latest.loading && deadlines.size === 1, 'Source navigation aborts the old request and removes its deadline without a visible error');
  render('/fixture/new-source', 'products', 'replacement-token'); await settle();
  assert(oldToken.signal.aborted && lastRequest().token === 'Bearer replacement-token' && !latest.error && deadlines.size === 1, 'Token changes abort and replace the authenticated read without a cancellation error');
  succeed(lastRequest(), 'products', 'new-scope'); await settle();
  succeed(oldSource, 'products', 'old-source'); succeed(oldToken, 'products', 'old-token'); await settle();
  assert(latest.data?.[0]?.id === 'new-scope', 'Late results from previous sources and tokens stay hidden');

  for (const kind of ['outlets', 'categories', 'products'] as const) {
    render(`/fixture/unauthorized/${kind}`, kind); await settle();
    const unauthorized = lastRequest(), count = requests.length, expiredBefore = expiryCount;
    render(`/fixture/unauthorized/${kind}`, kind, 'read-token', `latest-${kind}`); await settle();
    unauthorized.resolve(Response.json({ success: false }, { status: 401 })); await settle();
    assert(expiryCount === expiredBefore + 1 && expiryVersion === `latest-${kind}` && requests.length === count && !latest.loading && latest.error.includes('session has expired') && deadlines.size === 0, `${kind} 401 calls the latest expiry handler exactly once without retries and clears its deadline`);
  }
  render('/fixture/old-unauthorized'); await settle(); const oldUnauthorized = lastRequest();
  render(null); await settle(); oldUnauthorized.resolve(Response.json({}, { status: 401 })); await settle();
  assert(expiryCount === 3 && !latest.loading && !latest.error && deadlines.size === 0, 'Disabling the source cancels loading and suppresses late unauthorized responses');
  render('/fixture/unmount', 'products'); await settle(); const unmounted = lastRequest();
  unmounted.signal.addEventListener('abort', () => unmounted.reject(new DOMException('Aborted', 'AbortError')), { once: true });
  flushSync(() => root.unmount()); await settle();
  assert(unmounted.signal.aborted && deadlines.size === 0, 'Unmount aborts a pending read and clears its deadline');
  succeed(unmounted, 'products', 'unmounted'); await settle();
  assert(unhandled.length === 0, 'Timeouts, late responses and navigation cleanup produce no unhandled rejections');
  window.setTimeout = realSetTimeout; window.clearTimeout = realClearTimeout;
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => {
  root.unmount(); window.setTimeout = realSetTimeout; window.clearTimeout = realClearTimeout;
  document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks, unhandled });
});
