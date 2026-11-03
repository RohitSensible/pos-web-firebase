// Real hook/client, fully mocked lifecycle and protected APIs. No App dependency.
import { createRoot } from 'react-dom/client';
import { useWebUsage } from '../src/utils/useWebUsage.ts';
import '../src/index.css';

const checks: string[] = [];
function assert(value: unknown, label: string) { if (!value) throw new Error(label); checks.push(label); }
const nativeTimeout = window.setTimeout.bind(window);
const nativeClearTimeout = window.clearTimeout.bind(window);
const nativeInterval = window.setInterval.bind(window);
const nativeClearInterval = window.clearInterval.bind(window);
const originalNow = Date.now, originalFetch = window.fetch;
const pause = () => new Promise<void>(resolve => nativeTimeout(resolve, 10));
async function until(check: () => unknown, label: string) {
  for (let i = 0; i < 100; i++) { if (check()) return; await pause(); }
  throw new Error(`Timeout: ${label}`);
}
// Usage timeouts/backoff and heartbeat intervals advance only when requested.
let nextTimer = 1;
const timeouts = new Map<number, { delay: number; run: () => void }>();
const intervals = new Map<number, () => void>();
window.setTimeout = ((run: TimerHandler, delay?: number, ...args: unknown[]) => {
  if (typeof run !== 'function' || ![1000, 2000, 4000, 5000, 8000, 10000].includes(delay ?? 0)) return nativeTimeout(run, delay, ...args);
  const id = -nextTimer++; timeouts.set(id, { delay: delay!, run: () => run(...args) }); return id;
}) as typeof window.setTimeout;
window.clearTimeout = ((id?: number) => { if (id !== undefined) timeouts.delete(id); nativeClearTimeout(id); }) as typeof window.clearTimeout;
window.setInterval = ((run: TimerHandler, delay?: number) => {
  if (delay !== 10000 || typeof run !== 'function') return nativeInterval(run, delay);
  const id = -nextTimer++; intervals.set(id, () => run()); return id;
}) as typeof window.setInterval;
window.clearInterval = ((id?: number) => { if (id !== undefined) intervals.delete(id); nativeClearInterval(id); }) as typeof window.clearInterval;
let now = Date.parse('2026-10-19T18:29:50Z'); Date.now = () => now;
const tick = async () => { for (const run of [...intervals.values()]) run(); await pause(); };
const fireTimeout = async (delay: number) => {
  const timer = [...timeouts].find(([, value]) => value.delay === delay);
  assert(timer, `A ${delay}ms recovery/timeout is scheduled`);
  timeouts.delete(timer![0]); timer![1].run(); await pause();
};
function visible(value: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: value ? 'visible' : 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
type Call = { path: string; body: Record<string, any>; headers: Headers; signal?: AbortSignal | null; keepalive?: boolean };
const calls: Call[] = [];
let hold: { suffix: string; response: ReturnType<typeof deferred> } | undefined;
let heartbeatError = false, offlineStart = false, stallBody = false;
let date = '2026-10-19', generation = 'old-period';
const sequences = new Map<string, number>();
const metadata = (outletId: string, sequence = 0) => ({ outletId, sessionId: `lease-${outletId}`, generation, sequence,
  dailyLimitApplies: outletId !== 'E', usedSeconds: 123, remainingSeconds: 1677, date, timeZone: 'Asia/Kolkata' });
const success = (id: string, sequence = 0) => Response.json({ success: true, data: metadata(id, sequence) });
const denial = () => Response.json({ success: false, code: 'USAGE_SESSION_EXPIRED', message: 'Lease expired.' }, { status: 428 });
window.fetch = async (input, init) => {
  const path = input instanceof Request ? input.url : String(input);
  const call: Call = { path, body: init?.body ? JSON.parse(String(init.body)) : {}, headers: new Headers(init?.headers), signal: init?.signal, keepalive: init?.keepalive };
  calls.push(call);
  if (hold && path.endsWith(hold.suffix)) { const pending = hold.response; hold = undefined; return pending.promise; }
  const match = path.match(/^\/api\/outlets\/(A|B|E)\/(usage\/(start|heartbeat|stop)|products(?:\?.*)?)$/);
  if (!match) throw new Error(`Unmocked API: ${path}`);
  const id = match[1]!, action = match[3];
  if (!action) {
    if (!call.headers.get('X-Web-Usage-Session')) throw new Error('Protected mock requires a lease');
    return Response.json({ success: true, data: [] });
  }
  if (!['Bearer token-1', 'Bearer token-2'].includes(call.headers.get('Authorization') ?? '')) throw new Error('JWT missing');
  if (action === 'start' && offlineStart) { offlineStart = false; throw new TypeError('Mock offline'); }
  if (action === 'heartbeat' && heartbeatError) { heartbeatError = false; return denial(); }
  if (action === 'heartbeat' && stallBody) {
    stallBody = false;
    return { ok: true, status: 200, json: () => new Promise(() => undefined) } as unknown as Response;
  }
  if (action === 'start') {
    const key = `${id}:${call.body.requestId}`;
    const sequence = (sequences.get(key) ?? -1) + 1; sequences.set(key, sequence);
    return success(id, sequence);
  }
  return success(id, call.body.sequence);
};
let usage: ReturnType<typeof useWebUsage> | undefined;
function Harness({ token, outlet }: { token?: string; outlet?: string }) {
  usage = useWebUsage(token, outlet);
  return <output data-ready={String(usage.ready)}>{usage.message}</output>;
}
const host = document.getElementById('root')!;
let root = createRoot(host);
const render = async (outlet?: string, token = 'token-1') => { root.render(<Harness token={token} outlet={outlet} />); await pause(); };
const starts = (id: string) => calls.filter(call => call.path === `/api/outlets/${id}/usage/start`);
const ready = () => usage?.ready;

void (async () => {
  try {
    sessionStorage.clear();
    visible(false); await render('A');
    assert(starts('A').length === 0, 'A hidden restored mount does not admit or renew');
    const admission = deferred(); hold = { suffix: '/A/usage/start', response: admission };
    visible(true); await until(() => starts('A').length === 1, 'visible admission');
    let readComplete = false;
    const read = fetch('/api/outlets/A/products').then(response => { readComplete = true; return response; });
    await pause();
    assert(!readComplete && !calls.some(call => call.path.endsWith('/products')), 'Protected reads wait for pending admission');
    admission.resolve(success('A')); await until(ready, 'initial admission'); await read;
    assert(calls.at(-1)!.headers.get('X-Web-Usage-Session') === 'lease-A', 'Queued read receives freshly authorized lease headers');

    const staleRead = deferred(); hold = { suffix: '/products?stale', response: staleRead };
    const oldRead = fetch('/api/outlets/A/products?stale');
    await until(() => calls.at(-1)?.path.endsWith('?stale'), 'pending old read');
    await tick();
    staleRead.resolve(denial()); await oldRead; await pause();
    assert(usage!.ready && !usage!.message, 'A delayed usage error from before renewal cannot revoke the newer sequence');

    heartbeatError = true; await tick(); await until(() => !usage?.ready, 'expired restricted heartbeat');
    assert(usage!.authorized && !usage!.blocked, 'Expired lease preserves mounted-draft admission history without claiming exhaustion');
    const startsAtExpiry = starts('A').length;
    assert(![...timeouts.values()].some(timer => timer.delay === 1000), 'Restricted lease recovery requires explicit Resume');
    now += 20_000; date = '2026-10-20'; generation = 'new-period';
    usage!.retry(); await until(() => starts('A').length > startsAtExpiry && ready(), 'new-day manual recovery');
    await fetch('/api/outlets/A/products');
    assert(calls.at(-1)!.headers.get('X-Web-Usage-Generation') === 'new-period', 'Recovery uses the newly authorized generation after local midnight');

    const pendingRenewal = deferred(); hold = { suffix: '/A/usage/heartbeat', response: pendingRenewal };
    await tick(); const renewal = calls.at(-1)!;
    await render('B', 'token-2'); await until(() => starts('B').length === 1 && ready(), 'new token/outlet admission');
    assert(renewal.signal?.aborted, 'Changing token/outlet aborts the pending old renewal');
    pendingRenewal.resolve(Response.json({ success: false, code: 'USAGE_LIMIT_REACHED' }, { status: 403 })); await pause();
    assert(usage!.ready && !usage!.blocked, 'Late exhaustion from a cancelled old-token renewal cannot block the new outlet');
    await fetch('/api/outlets/B/products');
    assert(calls.at(-1)!.headers.get('X-Web-Usage-Outlet') === 'B', 'Only the replacement outlet lease authorizes new reads');

    const pendingStart = deferred(); hold = { suffix: '/A/usage/start', response: pendingStart };
    await render('A', 'token-2'); await until(() => starts('A').length > startsAtExpiry + 1, 'pending replacement start');
    const cancelledStart = calls.at(-1)!;
    await render('B', 'token-2'); await until(() => ready() && starts('B').length === 2, 'cancelled admission replacement');
    assert(cancelledStart.signal?.aborted, 'An outlet switch cancels pending admission even if its mock ignores abort');
    pendingStart.resolve(success('A')); await pause(); await fetch('/api/outlets/B/products');
    assert(calls.at(-1)!.headers.get('X-Web-Usage-Outlet') === 'B' && usage!.ready, 'A late successful old admission cannot restore old-outlet access');

    const keyBeforeRefresh = starts('B').at(-1)!.body.requestId;
    window.dispatchEvent(new Event('pagehide')); await pause();
    assert(calls.at(-1)!.path.endsWith('/usage/stop') && calls.at(-1)!.keepalive, 'Pagehide attempts keepalive release');
    root.unmount(); await pause(); root = createRoot(host); await render('B', 'token-2');
    await until(() => starts('B').length === 3 && ready(), 'refresh admission');
    assert(starts('B').at(-1)!.body.requestId === keyBeforeRefresh, 'Refresh reuses the random idempotency key without persisting counters');
    assert([...Array(sessionStorage.length)].every((_, i) => sessionStorage.key(i)?.startsWith('pos_web_usage:')), 'Usage storage contains only admission idempotency keys');

    await render('E'); await until(ready, 'exempt admission');
    stallBody = true; await tick(); await fireTimeout(10000);
    await until(() => !usage?.ready, 'stalled heartbeat body fails closed');
    assert(!usage!.blocked && usage!.dailyLimitApplies === false, 'A bounded offline failure retains verified exemption without granting access');
    offlineStart = true; await fireTimeout(1000);
    assert(!usage!.ready, 'A failed automatic offline retry remains unauthorized');
    visible(false); const beforeHiddenRetry = starts('E').length;
    await fireTimeout(2000);
    assert(starts('E').length === beforeHiddenRetry, 'Recovery backoff does not open leases while hidden');
    visible(true); await until(() => starts('E').length > beforeHiddenRetry && ready(), 'visible exempt recovery');
    assert(!usage!.blocked && !usage!.message, 'Returning visible recovers exemption using fresh server admission');

    visible(false); await until(() => usage?.suspended, 'hidden exempt release');
    assert(usage!.silentResume && !usage!.ready, 'Hidden exemption preserves editor state while releasing authorization');
    visible(true); await until(ready, 'silent exempt readmission');
    heartbeatError = true; await tick(); await until(() => !usage?.ready, 'pending recovery before logout');
    const startsBeforeLogout = starts('E').length;
    root.render(<Harness />); await pause(); // Missing token/outlet cancels the lifecycle.
    assert(![...timeouts.values()].some(timer => timer.delay === 1000), 'Leaving the outlet cancels scheduled recovery');
    assert(intervals.size === 0 && !usage!.ready, 'Logout/outlet cancellation removes heartbeat and authorization');
    assert(starts('E').length === startsBeforeLogout, 'Cancelled recovery sends no later admission');
    root.unmount();
    document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
  } finally {
    window.setTimeout = nativeTimeout; window.clearTimeout = nativeClearTimeout;
    window.setInterval = nativeInterval; window.clearInterval = nativeClearInterval;
    window.fetch = originalFetch; Date.now = originalNow;
  }
})().catch(error => {
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks });
});
