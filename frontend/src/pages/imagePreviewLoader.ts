// Short-lived, bounded memory only. Keys include the session, record and reviewed reference.
const previews = new Map<string, { blob: Blob; expires: number }>();
let cachedBytes = 0;
let session = '';
let sessionVersion = 0;
// Product images are often ~300 KB, so keep room for a few screens of thumbnails.
const MAX_BYTES = 48 * 1024 * 1024;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_ENTRIES = 300;
const ENTRY_LIFETIME_MS = 10 * 60_000;
const keyFor = (endpoint: string, reference: string, token: string) => JSON.stringify([token, endpoint, reference]);

function selectSession(token: string) {
  if (session !== token) { previews.clear(); cachedBytes = 0; session = token; sessionVersion++; }
}

export function rememberImagePreview(endpoint: string, reference: string, token: string, blob: Blob) {
  selectSession(token);
  if (!blob.type.startsWith('image/') || blob.size > MAX_IMAGE_BYTES) return;
  const key = keyFor(endpoint, reference, token);
  const old = previews.get(key);
  if (old) { cachedBytes -= old.blob.size; previews.delete(key); }
  previews.set(key, { blob, expires: Date.now() + ENTRY_LIFETIME_MS }); cachedBytes += blob.size;
  while (cachedBytes > MAX_BYTES || previews.size > MAX_ENTRIES) {
    const first = previews.keys().next().value!;
    cachedBytes -= previews.get(first)!.blob.size; previews.delete(first);
  }
}

export function cachedImagePreview(endpoint: string, reference: string, token: string): Blob | undefined {
  selectSession(token);
  const key = keyFor(endpoint, reference, token), entry = previews.get(key);
  if (!entry) return;
  if (entry.expires <= Date.now()) { cachedBytes -= entry.blob.size; previews.delete(key); return; }
  return entry.blob;
}

let active = 0;
const waiting = new Set<() => void>();
function drain() { while (active < 4 && waiting.size) { const next = waiting.values().next().value!; waiting.delete(next); next(); } }
const READ_DEADLINE_MS = 20_000;

// Reserve connection capacity for foreground actions such as PIN verification.
export function loadImagePreview(endpoint: string, reference: string, token: string, signal: AbortSignal): Promise<Blob> {
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  const cached = cachedImagePreview(endpoint, reference, token);
  if (cached) return Promise.resolve(cached);
  const version = sessionVersion;
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let admitted = false;
    let finished = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      waiting.delete(start);
      if (admitted) { active--; drain(); }
    };
    const cancel = () => {
      reject(new DOMException('Cancelled', 'AbortError'));
      controller.abort();
      // Keep admitted capacity until the transport settles or its deadline.
      // Real fetch aborts; an abort-ignoring transport must not free a slot early.
      if (!admitted) finish();
      else signal.removeEventListener('abort', cancel);
    };
    const start = () => {
      admitted = true;
      active++;
      // This is a logical slot deadline, including body reads. At the deadline
      // release even abort-ignoring mocks; production fetch honors the abort.
      timer = setTimeout(() => {
        reject(new DOMException('Image preview timed out', 'TimeoutError'));
        controller.abort();
        finish();
      }, READ_DEADLINE_MS);
      void (async () => {
        try {
          const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store', priority: 'low', signal: controller.signal });
          if (controller.signal.aborted || finished) return;
          if (response.status === 401) throw Object.assign(new Error('Your session has expired.'), { status: 401 });
          if (!response.ok) throw new Error('Image unavailable');
          const blob = await response.blob();
          if (controller.signal.aborted || finished) return;
          if (!blob.type.startsWith('image/')) throw new Error('Invalid image response');
          if (sessionVersion === version) rememberImagePreview(endpoint, reference, token, blob);
          resolve(blob);
        } catch (error) { reject(error); }
        finally { finish(); }
      })();
    };
    signal.addEventListener('abort', cancel, { once: true });
    waiting.add(start);
    drain();
  });
}
