import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AuthenticatedImagePreview } from '../src/pages/AuthenticatedImagePreview.tsx';
import '../src/index.css';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const passed: string[] = [];
const host = document.getElementById('root')!;
const root = createRoot(host);
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function settle() { for (let i = 0; i < 8; i++) await tick(); }
const pixel = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"%3E%3Crect width="1" height="1" fill="green"/%3E%3C/svg%3E';
const created: string[] = [], revoked: string[] = [];
const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
URL.createObjectURL = () => { const url = `${pixel}#${created.length}`; created.push(url); return url; };
URL.revokeObjectURL = url => { revoked.push(url); };
const observers: { fire: () => void; disconnected: boolean }[] = [];
const originalObserver = window.IntersectionObserver;
window.IntersectionObserver = class {
  item: { fire: () => void; disconnected: boolean };
  constructor(callback: IntersectionObserverCallback) {
    this.item = { fire: () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver), disconnected: false };
    observers.push(this.item);
  }
  observe() {}
  disconnect() { this.item.disconnected = true; }
} as unknown as typeof IntersectionObserver;
const nativeFetch = window.fetch;
type Read = { endpoint: string; signal: AbortSignal; token: string; resolve: (response: Response) => void };
const reads: Read[] = [];
window.fetch = (input, init) => {
  assert(!init?.method || init.method === 'GET', 'Only image reads are allowed');
  assert(init?.cache === 'no-store', 'Authorized previews avoid browser cache');
  return new Promise<Response>(resolve => reads.push({ endpoint: String(input), signal: init!.signal!,
    token: new Headers(init?.headers).get('Authorization')!, resolve }));
};
const blob = () => new Blob(['mock image'], { type: 'image/png' });
const respond = (read: Read, status = 200) => read.resolve(new Response(status === 200 ? blob() : '', { status }));
const visible = () => observers.at(-1)!.fire();
let oldExpired = 0, latestExpired = 0;
let props = { endpoint: '/preview/A', imagePath: 'A.png', token: 'token-A', alt: 'Tea', paused: false,
  onSessionExpired: () => { oldExpired++; } };
function render(next: Partial<typeof props> = {}) {
  props = { ...props, ...next };
  flushSync(() => root.render(<label><AuthenticatedImagePreview {...props} /></label>));
}
function placeholder(text: string) {
  assert(!host.querySelector('img'), 'Old image is hidden immediately');
  assert(host.querySelector('[role="img"]')?.getAttribute('aria-label') === `Tea: ${text}`, `Accessible ${text} placeholder`);
  assert(!host.querySelector('button'), 'Selection labels contain no nested retry button');
}
void (async () => {
  render(); placeholder('loading image'); assert(reads.length === 0, 'Lazy reads wait for visibility');
  visible(); visible(); assert(reads.length === 1, 'Repeated observer events start one read');
  respond(reads[0]!); await settle();
  assert(host.querySelector('img')?.alt === 'Tea', 'Alt text preserved');
  const first = created[0]!;
  render({ endpoint: '/preview/B' }); placeholder('loading image');
  assert(revoked.includes(first), 'Source replacement revokes old URL');
  visible(); const stale = reads.at(-1)!;
  render({ token: 'token-B' }); placeholder('loading image');
  assert(stale.signal.aborted, 'Token change forwards cancellation');
  visible(); const current = reads.at(-1)!;
  respond(stale); await settle(); placeholder('loading image');
  respond(current); await settle();
  assert(created.length === 2, 'Stale source never creates an object URL');
  assert(current.token === 'Bearer token-B', 'New token authorizes the new read');
  render({ imagePath: 'B-new.png' }); placeholder('loading image');
  assert(revoked.includes(created[1]!), 'Reference replacement revokes URL');
  visible(); respond(reads.at(-1)!); await settle();
  const beforePause = created.at(-1)!;
  render({ paused: true }); placeholder('image preview paused');
  assert(revoked.includes(beforePause), 'Pause revokes URL');
  const beforeResume = reads.length;
  render({ paused: false }); await settle();
  assert(host.querySelector('img') && reads.length === beforeResume, 'Resume reuses authorized cached bytes');
  host.querySelector('img')!.dispatchEvent(new Event('error'));
  await settle(); placeholder('image unavailable');
  assert(revoked.includes(created.at(-1)!), 'Decode error revokes URL immediately');
  passed.push('Lazy admission, immediate source/token/reference/pause placeholders, cancellation, resume and URL cleanup');

  render({ endpoint: '/preview/unauthorized', imagePath: '401.png' }); visible();
  const unauthorized = reads.at(-1)!;
  render({ onSessionExpired: () => { latestExpired++; } });
  visible(); respond(unauthorized, 401); await settle();
  placeholder('image unavailable');
  assert(oldExpired === 0 && latestExpired === 1, '401 invokes latest handler exactly once');
  const after401 = reads.length; await settle();
  assert(reads.length === after401, 'Errors do not start an automatic retry');
  render({ endpoint: '/preview/stale-401' }); visible(); const stale401 = reads.at(-1)!;
  render({ endpoint: '/preview/recovered' }); visible();
  respond(stale401, 401); respond(reads.at(-1)!); await settle();
  assert(latestExpired === 1, 'Stale unauthorized events are harmless');
  assert(host.querySelector('img'), 'User-driven source change recovers');
  passed.push('Latest session handler once, stale 401 ignored and user-driven recovery without retries');

  const nativeSetTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout;
  const deadlines = new Map<number, () => void>(); let next = 100_000;
  globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === 20_000) { const id = ++next; deadlines.set(id, handler as () => void); return id; }
    return nativeSetTimeout(handler, delay, ...args);
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: number | undefined) => {
    if (id !== undefined && deadlines.delete(Number(id))) return;
    nativeClearTimeout(id);
  }) as typeof clearTimeout;
  try {
    render({ endpoint: '/preview/stalled' }); visible(); const stalled = reads.at(-1)!;
    assert(deadlines.size === 1, 'Active preview has a bounded deadline');
    [...deadlines.values()].forEach(expire => expire()); await settle();
    placeholder('image unavailable'); assert(stalled.signal.aborted, 'Deadline aborts transport');
    const count = reads.length; await settle(); assert(reads.length === count, 'Timeout does not retry');
    respond(stalled); await settle(); placeholder('image unavailable');
    render({ imagePath: 'retry.png' }); visible(); respond(reads.at(-1)!); await settle();
    assert(host.querySelector('img'), 'Reference change permits another read after timeout');
    assert(deadlines.size === 0, 'Successful retry clears its deadline');
  } finally { globalThis.setTimeout = nativeSetTimeout; globalThis.clearTimeout = nativeClearTimeout; }
  passed.push('Stalled read deadline, late completion ignored and explicit reference-change recovery');
  render({ endpoint: '/preview/not-visible' });
  const lateObserver = observers.at(-1)!; const beforeUnmount = reads.length;
  flushSync(() => root.render(null)); lateObserver.fire(); await settle();
  assert(lateObserver.disconnected && reads.length === beforeUnmount, 'Unmount cancels lazy admission');
  render({ endpoint: '/preview/final' }); visible(); respond(reads.at(-1)!); await settle();
  const finalUrl = created.at(-1)!;
  root.unmount();
  assert(revoked.includes(finalUrl), 'Unmount revokes a displayed image URL');
  assert(created.every(url => revoked.filter(value => value === url).length === 1), 'Every URL revoked exactly once');
  passed.push('Unmount and stale observer cleanup; all mocked requests are authorized GETs with no writes');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => {
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed });
}).finally(() => {
  window.fetch = nativeFetch; window.IntersectionObserver = originalObserver;
  URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
});
