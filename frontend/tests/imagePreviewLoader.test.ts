import assert from 'node:assert/strict';
import test from 'node:test';
import { cachedImagePreview, loadImagePreview, rememberImagePreview } from '../src/pages/imagePreviewLoader.ts';

const image = () => new Blob(['image bytes'], { type: 'image/png' });

test('only four background requests run at once; cancelled queued previews never fetch', async t => {
  const releases: (() => void)[] = [];
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => {
    calls.push(init);
    return new Promise<Response>(resolve => releases.push(() => resolve(new Response(image()))));
  });
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  const requests = controllers.map((controller, i) => loadImagePreview(`/image/${i}`, 'ref', 'queue-session', controller.signal));
  const results = Promise.allSettled(requests);
  assert.equal(calls.length, 4);
  controllers[4]!.abort();
  releases.splice(0).forEach(release => release()); await Promise.all(requests.slice(0, 4));
  assert.equal(calls.length, 7);
  releases.splice(0).forEach(release => release());
  assert.equal((await results).filter(result => result.status === 'rejected').length, 1);
  assert.ok(calls.every(call => call.priority === 'low'));
  assert.ok(calls.every(call => new Headers(call.headers).get('Authorization') === 'Bearer queue-session'));
});

test('recent previews and verified uploads reuse bytes; changed references, records and sessions fetch afresh', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(image()); });
  const signal = new AbortController().signal;
  await loadImagePreview('/p/image', 'old.png', 'cache-session', signal);
  await loadImagePreview('/p/image', 'old.png', 'cache-session', signal);
  assert.equal(calls, 1);
  rememberImagePreview('/p/image', 'uploaded.png', 'cache-session', image());
  await loadImagePreview('/p/image', 'uploaded.png', 'cache-session', signal);
  assert.equal(calls, 1, 'Returning to Products uses the verified processed upload');
  await loadImagePreview('/p/image', 'new.png', 'cache-session', signal);
  await loadImagePreview('/other/image', 'new.png', 'cache-session', signal);
  await loadImagePreview('/p/image', 'new.png', 'different-session', signal);
  assert.equal(calls, 4);
});

test('expired and oversized cache entries are discarded; authorization failures are never cached', async t => {
  const start = Date.now();
  rememberImagePreview('/p/image', 'ref', 'expiry-session', image());
  t.mock.method(Date, 'now', () => start + 10 * 60_000 + 1_000);
  assert.equal(cachedImagePreview('/p/image', 'ref', 'expiry-session'), undefined);
  rememberImagePreview('/large/image', 'ref', 'expiry-session', new Blob([new Uint8Array(7 * 1024 * 1024)], { type: 'image/png' }));
  assert.equal(cachedImagePreview('/large/image', 'ref', 'expiry-session'), undefined);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', { status: 401 }); });
  for (let i = 0; i < 2; i++) await assert.rejects(loadImagePreview('/p/image', 'ref', 'expiry-session', new AbortController().signal), { status: 401 });
  assert.equal(calls, 2);
});

test('active cancellation forwards abort without admitting a fifth live transport; queued cancellation removes listeners', async t => {
  const releases: (() => void)[] = [];
  const signals: AbortSignal[] = [];
  t.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => {
    signals.push(init.signal!);
    return new Promise<Response>(resolve => releases.push(() => resolve(new Response(image()))));
  });
  const controllers = Array.from({ length: 6 }, () => new AbortController());
  const removed = t.mock.method(controllers[4]!.signal, 'removeEventListener');
  const requests = controllers.map((c, i) => loadImagePreview(`/cancel/${i}`, 'ref', 'cancel-session', c.signal));
  const results = Promise.allSettled(requests);
  controllers[4]!.abort(); controllers[0]!.abort();
  assert.equal(signals[0]!.aborted, true);
  assert.equal(signals.length, 4, 'Abort-ignoring active fetch still occupies capacity');
  assert.equal(removed.mock.callCount(), 1);
  releases.shift()!();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signals.length, 5);
  releases.splice(0).forEach(release => release());
  assert.equal((await results).filter(r => r.status === 'rejected').length, 2);
  assert.equal(cachedImagePreview('/cancel/0', 'ref', 'cancel-session'), undefined);
});

test('20 second deadlines cover hung fetches and bodies, release slots once, and ignore late data', async t => {
  const deadlines = new Map<number, () => void>();
  let nextTimer = 0;
  t.mock.method(globalThis, 'setTimeout', ((callback: () => void, delay: number) => {
    assert.equal(delay, 20_000);
    const id = ++nextTimer; deadlines.set(id, callback); return id;
  }) as unknown as typeof setTimeout);
  t.mock.method(globalThis, 'clearTimeout', ((id: number) => { deadlines.delete(id); }) as unknown as typeof clearTimeout);
  const signals: AbortSignal[] = [];
  const releases: (() => void)[] = [];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => {
    const index = calls++; signals.push(init.signal!);
    if (index === 0) return new Promise<Response>(resolve => releases.push(() => resolve(new Response(image()))));
    if (index < 4) return Promise.resolve({ ok: true, status: 200,
      blob: () => new Promise<Blob>(resolve => releases.push(() => resolve(image()))) } as Response);
    return Promise.resolve(new Response(image()));
  });
  const requests = Array.from({ length: 7 }, (_, i) => loadImagePreview(`/deadline/${i}`, 'ref', 'deadline-session', new AbortController().signal));
  const results = Promise.allSettled(requests);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 4); assert.equal(deadlines.size, 4);
  const expire = [...deadlines.values()];
  expire.forEach(callback => callback());
  const settled = await results;
  assert.equal(settled.filter(r => r.status === 'rejected' && r.reason.name === 'TimeoutError').length, 4);
  assert.equal(calls, 7); assert.equal(deadlines.size, 0);
  assert.ok(signals.slice(0, 4).every(s => s.aborted));
  releases.forEach(release => release());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cachedImagePreview('/deadline/0', 'ref', 'deadline-session'), undefined);
  assert.equal(cachedImagePreview('/deadline/1', 'ref', 'deadline-session'), undefined);
  await loadImagePreview('/deadline/resumed', 'ref', 'deadline-session', new AbortController().signal);
  assert.equal(deadlines.size, 0);
});

test('a read from an earlier session generation cannot populate a later session with the same token', async t => {
  let release!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => { release = resolve; }));
  const pending = loadImagePreview('/stale', 'ref', 'session-A', new AbortController().signal);
  cachedImagePreview('/stale', 'ref', 'session-B');
  cachedImagePreview('/stale', 'ref', 'session-A');
  release(new Response(image())); await pending;
  assert.equal(cachedImagePreview('/stale', 'ref', 'session-A'), undefined);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadImagePreview('/never', 'ref', 'session-A', controller.signal), { name: 'AbortError' });
});
