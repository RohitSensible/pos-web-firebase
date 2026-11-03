import { printDocument } from '../src/utils/printDocument.ts';
import '../src/index.css';

const checks: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const nativeTimeout = window.setTimeout.bind(window);
const originalAppend = document.body.append;
const originalMatchMedia = window.matchMedia;
const originalFetch = window.fetch;
const originalSetTimeout = window.setTimeout;
const originalClearTimeout = window.clearTimeout;
const timers = new Map<number, { callback: () => void; delay: number }>();
let timerId = 0;
window.setTimeout = ((callback: () => void, delay = 0) => {
  const id = ++timerId; timers.set(id, { callback, delay }); return id;
}) as typeof window.setTimeout;
window.clearTimeout = ((id?: number) => { if (id !== undefined) timers.delete(id); }) as typeof window.clearTimeout;
window.fetch = async () => { throw new Error('Unexpected network request'); };
const fireTimer = (delay: number) => {
  const entry = [...timers].find(([, timer]) => timer.delay === delay);
  if (!entry) throw new Error(`Missing timer ${delay}`);
  timers.delete(entry[0]); entry[1].callback();
};
const unhandled: unknown[] = [];
const onUnhandled = (event: PromiseRejectionEvent) => { unhandled.push(event.reason); event.preventDefault(); };
window.addEventListener('unhandledrejection', onUnhandled);

type Mode = 'ready' | 'style-error' | 'style-hang' | 'fonts-hang' | 'fonts-error' | 'layout-hang' | 'print-error' | 'missing-style';
let mode: Mode = 'ready';
let frame!: HTMLIFrameElement;
let child!: Window;
let prints = 0;
let cancellations = 0;
let listenerCount = 0;
let lateFontsReject!: (reason: Error) => void;
let lateFontsResolve!: () => void;
let lateStyle!: () => void;
let lateLayout!: FrameRequestCallback;
let activeMedia = false;
let mediaTargets: EventTarget[] = [];
const makeMedia = () => {
  const target = new EventTarget();
  mediaTargets.push(target);
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  target.addEventListener = (...args: Parameters<EventTarget['addEventListener']>) => { listenerCount++; add(...args); };
  target.removeEventListener = (...args: Parameters<EventTarget['removeEventListener']>) => { listenerCount--; remove(...args); };
  Object.defineProperty(target, 'matches', { get: () => activeMedia });
  return target as unknown as MediaQueryList;
};
window.matchMedia = makeMedia;
document.body.append = function (...nodes: (Node | string)[]) {
  originalAppend.apply(this, nodes);
  for (const node of nodes) {
    if (!(node instanceof HTMLIFrameElement)) continue;
    frame = node;
    child = node.contentWindow!;
    mediaTargets = [];
    child.matchMedia = makeMedia;
    child.focus = () => {};
    child.print = () => { prints++; if (mode === 'print-error') throw new Error('Mock print failed'); };
    const add = child.addEventListener.bind(child);
    const remove = child.removeEventListener.bind(child);
    child.addEventListener = ((...args: Parameters<Window['addEventListener']>) => { listenerCount++; add(...args); }) as Window['addEventListener'];
    child.removeEventListener = ((...args: Parameters<Window['removeEventListener']>) => { listenerCount--; remove(...args); }) as Window['removeEventListener'];
    child.requestAnimationFrame = callback => { lateLayout = callback; if (mode !== 'layout-hang') queueMicrotask(() => callback(0)); return 1; };
    child.cancelAnimationFrame = () => { cancellations++; };
    const fonts = new Promise<void>((resolve, reject) => {
      lateFontsReject = reject;
      lateFontsResolve = resolve;
      if (mode === 'fonts-error') queueMicrotask(() => reject(new Error('Mock fonts failed')));
      else if (mode !== 'fonts-hang') resolve();
    });
    Object.defineProperty(node.contentDocument!, 'fonts', { value: { ready: fonts }, configurable: true });
    const head = node.contentDocument!.head;
    const append = head.append.bind(head);
    head.append = (...children: (Node | string)[]) => {
      for (const copy of children) {
        if (copy instanceof HTMLLinkElement) {
          // Never insert copied links: every stylesheet outcome is synthetic.
          lateStyle = () => copy.dispatchEvent(new Event('error'));
          if (mode !== 'style-hang') queueMicrotask(() => copy.dispatchEvent(new Event(mode === 'style-error' ? 'error' : 'load')));
        } else append(copy);
      }
    };
  }
};

const receipt = document.createElement('section');
receipt.setAttribute('role', 'dialog');
receipt.setAttribute('aria-modal', 'true');
receipt.innerHTML = '<h1>Only selected bill</h1><div data-items></div><button>Print</button><footer>Close</footer>';
for (let i = 1; i <= 90; i++) {
  const item = document.createElement('p'); item.textContent = `Item ${i}`; receipt.querySelector('[data-items]')!.append(item);
}
originalAppend.call(document.body, receipt);
const originalHtml = receipt.outerHTML;
const settings = document.createElement('style');
settings.dataset.printPageSettings = 'true'; settings.textContent = '@page { size: A4; margin: 12mm; }';
document.head.append(settings);
const sourceLink = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')!;
const originalClone = sourceLink.cloneNode;
sourceLink.cloneNode = function (deep?: boolean) {
  const copy = originalClone.call(this, deep) as HTMLLinkElement;
  if (mode === 'missing-style') copy.removeAttribute('href');
  const add = copy.addEventListener.bind(copy);
  const remove = copy.removeEventListener.bind(copy);
  copy.addEventListener = ((...args: Parameters<HTMLLinkElement['addEventListener']>) => { listenerCount++; add(...args); }) as HTMLLinkElement['addEventListener'];
  copy.removeEventListener = ((...args: Parameters<HTMLLinkElement['removeEventListener']>) => { listenerCount--; remove(...args); }) as HTMLLinkElement['removeEventListener'];
  return copy;
};
const request = () => {
  let result = 'pending';
  const done = printDocument(receipt, 'Selected bill').then(() => { result = 'requested'; }, error => { result = String(error); });
  return { done, result: () => result };
};
const expectClean = (message: string) => {
  assert(!frame.isConnected && timers.size === 0 && listenerCount === 0, message);
  assert(receipt.outerHTML === originalHtml, 'Original receipt remains unchanged');
};
async function recover() {
  mode = 'ready';
  const next = request(); await flush(); await next.done;
  assert(next.result() === 'requested', 'Next invocation requests printing after recovery');
  assert(frame.isConnected, 'Return means print requested while isolated document remains available');
  const doc = frame.contentDocument!;
  assert(doc.title === 'Selected bill' && doc.body.textContent!.includes('Item 90'), 'Isolated clone retains title and every bill item');
  assert(!doc.querySelector('button, footer') && !doc.body.firstElementChild!.hasAttribute('aria-modal') && !doc.body.firstElementChild!.hasAttribute('role'), 'Clone strips controls and modal attributes');
  assert(!!doc.querySelector('[data-print-page-settings]'), 'Print page settings CSS is copied');
  child.dispatchEvent(new Event('afterprint'));
  child.dispatchEvent(new Event('afterprint'));
  expectClean('Duplicate afterprint cleanup is idempotent and clears all timers/listeners');
}

void (async () => {
  assert(!!sourceLink, 'Runner stylesheet is available for mocked readiness');
  for (const failure of ['style-error', 'style-hang', 'fonts-hang', 'fonts-error', 'layout-hang', 'print-error', 'missing-style'] as const) {
    mode = failure;
    const beforePrints = prints;
    const attempt = request();
    await flush();
    if (failure === 'style-hang' || failure === 'fonts-hang' || failure === 'layout-hang') {
      assert(attempt.result() === 'pending' && frame.isConnected, `${failure} waits only until preparation deadline`);
      fireTimer(15_000);
    }
    await attempt.done;
    const expected = failure === 'print-error' ? 'Mock print failed' : failure === 'fonts-error' ? 'Unable to prepare bill print fonts' : failure.endsWith('hang') ? 'timed out' : 'Unable to load bill print styles';
    assert(attempt.result().includes(expected), `${failure} reports a clear error`);
    assert(prints === beforePrints + (failure === 'print-error' ? 1 : 0), `${failure} never prints an unprepared document`);
    expectClean(`${failure} removes frame, timers and lifecycle listeners`);
    if (failure === 'fonts-hang') lateFontsReject(new Error('Late font rejection'));
    if (failure === 'style-hang') lateStyle();
    if (failure === 'layout-hang') { assert(cancellations > 0, 'Stalled layout callback is cancelled'); lateLayout(0); }
    await flush();
    expectClean(`${failure} late readiness cannot resurrect its frame`);
    await recover();
  }
  mode = 'fonts-hang';
  const lateReady = request(); await flush();
  fireTimer(15_000); await lateReady.done;
  const beforeLateReady = prints;
  lateFontsResolve(); await flush();
  expectClean('Late font success cannot schedule layout or restore a timed-out frame');
  assert(prints === beforeLateReady, 'Late font success never requests printing');
  await recover();
  mode = 'ready';
  const fallback = request(); await flush(); await fallback.done;
  activeMedia = true;
  mediaTargets.forEach(target => target.dispatchEvent(new Event('change')));
  fireTimer(300_000);
  assert(frame.isConnected && timers.size === 1, 'Long fallback preserves an active native print document');
  activeMedia = false;
  mediaTargets.forEach(target => target.dispatchEvent(new Event('change')));
  expectClean('Leaving print media cleans up when afterprint is omitted');
  const deferred = request(); await flush(); await deferred.done;
  activeMedia = true;
  fireTimer(300_000);
  assert(frame.isConnected, 'Fallback checks current media even without change events');
  activeMedia = false;
  fireTimer(60_000);
  expectClean('Deferred fallback cleans up once print media becomes inactive');
  const omitted = request(); await flush(); await omitted.done;
  fireTimer(300_000);
  expectClean('Inactive print lifecycle fallback removes an abandoned frame');
  await recover();
  // Give the browser an event-loop turn to report any late unhandled rejection.
  await new Promise<void>(resolve => nativeTimeout(resolve, 0));
  assert(unhandled.length === 0, 'Failures and late readiness produce no unhandled rejections');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => {
  document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks });
}).finally(() => {
  document.body.append = originalAppend;
  window.matchMedia = originalMatchMedia;
  window.fetch = originalFetch;
  window.setTimeout = originalSetTimeout;
  window.clearTimeout = originalClearTimeout;
  window.removeEventListener('unhandledrejection', onUnhandled);
  sourceLink.cloneNode = originalClone;
  settings.remove();
});
