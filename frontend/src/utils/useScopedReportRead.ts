import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const READ_TIMEOUT_MS = 20_000;
type Request = <T>(path: string, allowMissing?: boolean) => Promise<T | null>;

// Race the whole operation, including response bodies that may ignore abort.
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function useScopedReportRead<T>(key: string, token: string, onSessionExpired: () => void,
  load: (request: Request) => Promise<T>) {
  const current = useRef({ key, onSessionExpired });
  useLayoutEffect(() => { current.current = { key, onSessionExpired }; });
  const [state, setState] = useState<{ key: string; data?: T; error: string; loading: boolean }>();
  useEffect(() => {
    const controller = new AbortController();
    const active = () => !controller.signal.aborted && current.current.key === key;
    const timer = window.setTimeout(() => controller.abort(new Error('The report took too long to load. Retry to try again.')), READ_TIMEOUT_MS);
    const request: Request = async <R,>(path: string, allowMissing = false) => {
      controller.signal.throwIfAborted();
      const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      if (!active()) throw new DOMException('Aborted', 'AbortError');
      if (response.status === 401) {
        current.current.onSessionExpired();
        throw new Error('Your session has expired.');
      }
      if (allowMissing && response.status === 404) return null;
      const result = await response.json() as { message?: string; data?: R };
      if (!active()) throw new DOMException('Aborted', 'AbortError');
      if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load the report.');
      return result.data;
    };
    setState({ key, error: '', loading: true });
    void bounded(Promise.resolve().then(() => load(request)), controller.signal).then(data => {
      if (active()) setState({ key, data, error: '', loading: false });
    }, reason => {
      // Cleanup aborts are silent; timeouts remain visible and require manual retry.
      if (current.current.key === key && (!controller.signal.aborted || controller.signal.reason instanceof Error && controller.signal.reason.name !== 'AbortError')) {
        setState({ key, error: reason instanceof Error ? reason.message : 'Unable to load the report.', loading: false });
      }
      controller.abort();
    }).finally(() => window.clearTimeout(timer));
    return () => { window.clearTimeout(timer); controller.abort(); };
    // The key contains all applied request inputs; callback identity must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state?.key === key ? state : { key, data: undefined, error: '', loading: true };
}

export function useScopedReportExport(key: string) {
  const currentKey = useRef(key);
  useLayoutEffect(() => { currentKey.current = key; });
  const job = useRef<{ key: string; controller: AbortController } | null>(null);
  const [state, setState] = useState({ key, busy: false, error: '' });
  useLayoutEffect(() => {
    return () => { job.current?.controller.abort(); job.current = null; };
  }, [key]);
  const runExport = async (task: (signal: AbortSignal) => Promise<void>) => {
    if (job.current) return;
    const controller = new AbortController();
    const ownJob = { key, controller };
    job.current = ownJob;
    setState({ key, busy: true, error: '' });
    const timer = window.setTimeout(() => controller.abort(new Error('Export took too long. Try exporting again.')), READ_TIMEOUT_MS);
    try { await bounded(Promise.resolve().then(() => { controller.signal.throwIfAborted(); return task(controller.signal); }), controller.signal); }
    catch (reason) {
      if (currentKey.current === key && job.current === ownJob && !(reason instanceof DOMException && reason.name === 'AbortError')) {
        setState({ key, busy: false, error: reason instanceof Error ? reason.message : 'Unable to export the report.' });
      }
    } finally {
      window.clearTimeout(timer);
      if (job.current === ownJob) {
        job.current = null;
        setState(previous => previous.key === key ? { ...previous, busy: false } : previous);
      }
    }
  };
  return { runExport, exporting: state.key === key && state.busy, exportError: state.key === key ? state.error : '' };
}
