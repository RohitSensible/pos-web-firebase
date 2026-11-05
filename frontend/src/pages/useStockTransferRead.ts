import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMasterSync } from '../utils/useMasterSync.ts';
import { loadProductList, ProductListRequestError, streamProductList } from './productListApi.ts';
import type { OutletSummary } from './OutletSelectionPage.tsx';

export type StockTransferProduct = { documentId: string; fields: Record<string, unknown> };
export type StockTransferCategory = { id: string; name: string };

// Existing authenticated GET endpoints only. Data is scoped to URL, token and
// retry so an old outlet's result can never appear under the newly chosen one.
export function useStockTransferRead<T>(url: string | null, token: string, kind: 'outlets' | 'products' | 'categories', onSessionExpired: () => void) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([url, token, kind, attempt]);
  const activeKey = useRef(key);
  useLayoutEffect(() => { activeKey.current = key; }, [key]);
  const sessionExpired = useRef(onSessionExpired);
  useEffect(() => { sessionExpired.current = onSessionExpired; }, [onSessionExpired]);
  const [state, setState] = useState<{ key: string; data: T[] | null; error: string }>({ key: '', data: null, error: '' });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    // Cover the entire read, including response bodies and the final stream
    // marker. Publish the error here even if a transport ignores cancellation.
    const timeout = setTimeout(() => {
      if (controller.signal.aborted) return;
      controller.abort();
      setState({ key, data: null, error: `Loading ${kind} timed out. Please check your connection and retry.` });
    }, 20_000);
    void (async () => {
      try {
        let data: T[];
        if (kind === 'products') data = await streamProductList<T>(url, token, controller.signal, () => {});
        else if (kind === 'categories') data = await loadProductList<T>(url, token, controller.signal, 'categories', true);
        else {
          const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal });
          if (response.status === 401) throw new ProductListRequestError('Your session has expired. Please sign in again.', 401);
          const result = await response.json() as { success?: boolean; data?: { outlets?: OutletSummary[] }; message?: string };
          if (!response.ok || result.success !== true || !Array.isArray(result.data?.outlets)) throw new Error(result.message || 'Unable to load your outlets.');
          data = result.data.outlets as T[];
        }
        if (!controller.signal.aborted) setState({ key, data, error: '' });
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure instanceof ProductListRequestError && failure.status === 401) sessionExpired.current();
        setState({ key, data: null, error: failure instanceof Error ? failure.message : 'Unable to load data. Please try again.' });
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [url, token, kind, key]);
  const current = url && state.key === key ? state : { data: null, error: '' };
  const productOutlet = kind === 'products' && url ? /^\/api\/outlets\/([^/]+)\/products(?:\?|$)/.exec(url)?.[1] : undefined;
  useMasterSync(productOutlet ? decodeURIComponent(productOutlet) : '', token, 'products', !!productOutlet && current.data !== null && !current.error, async signal => {
    try {
      const data = await streamProductList<T>(url!, token, signal, () => {});
      signal.throwIfAborted();
      if (activeKey.current !== key) throw new Error('Stock product scope changed.');
      setState({ key, data, error: '' });
    } catch (failure) {
      if (!signal.aborted && activeKey.current === key && failure instanceof ProductListRequestError && failure.status === 401) sessionExpired.current();
      throw failure;
    }
  });
  return { data: current.data, error: current.error, loading: !!url && current.data === null && !current.error, retry: () => setAttempt(value => value + 1) };
}
