import { useEffect, useState } from 'react';
import type { ShiftDashboardData } from './dashboardExcel.ts';
import { beginDataLoading, markDataLoadingBackground } from './dataLoading.ts';

type Snapshot = { scope: string; data: ShiftDashboardData | null; loading: boolean; error: string; updated: number };

function validSnapshot(value: unknown, day: string): value is ShiftDashboardData {
  if (!value || typeof value !== 'object') return false;
  const data = value as ShiftDashboardData;
  if (data.dayId !== day || !data.payments || typeof data.payments !== 'object' || Array.isArray(data.payments)) return false;
  const validRow = (row: ShiftDashboardData) => row && typeof row.id === 'string' && !!row.id
    && row.dayId === day && typeof row.inActive === 'boolean'
    && ['creatorName', 'deviceId', 'userId', 'startBillNo', 'lastBillNo'].every(key => row[key as keyof ShiftDashboardData] === undefined || typeof row[key as keyof ShiftDashboardData] === 'string')
    && ['shiftNo', 'startTime', 'endTime'].every(key => row[key as keyof ShiftDashboardData] === undefined || (typeof row[key as keyof ShiftDashboardData] === 'number' && Number.isFinite(row[key as keyof ShiftDashboardData])))
    && ['totalSale', 'cashSale', 'digitalSale', 'openingAmt', 'expCash', 'billCount'].every(key =>
      typeof row[key as keyof ShiftDashboardData] === 'number' && Number.isFinite(row[key as keyof ShiftDashboardData]));
  return validRow(data) && (data.shifts === undefined || (Array.isArray(data.shifts)
    && data.shifts.every(validRow) && new Set(data.shifts.map(row => row.id)).size === data.shifts.length));
}

/** Snapshot identity is checked during render, before scope-change effects run. */
export function useDashboardShiftRead({ outletId, token, day, enabled, reload, onUnauthorized }: {
  outletId?: string; token?: string; day: string; enabled: boolean; reload: number; onUnauthorized: () => void;
}) {
  const scope = JSON.stringify([outletId, token, day, reload]);
  const [snapshot, setSnapshot] = useState<Snapshot>({ scope: '', data: null, loading: false, error: '', updated: 0 });
  useEffect(() => {
    if (!enabled || !outletId || !token) return;
    let disposed = false;
    let cancel: (() => void) | undefined;
    let inFlight = false;
    const load = async (background = false) => {
      if (disposed || inFlight || (background && document.visibilityState === 'hidden')) return;
      inFlight = true;
      const controller = new AbortController();
      if (background) markDataLoadingBackground(controller.signal);
      const finish = beginDataLoading('Dashboard', controller.signal);
      setSnapshot(previous => previous.scope === scope
        ? { ...previous, loading: !background } : { scope, data: null, loading: true, error: '', updated: 0 });
      let timeout: number | undefined;
      let timedOut = false;
      const deadline = new Promise<never>((_, reject) => {
        cancel = () => { controller.abort(); reject(new Error('cancelled')); };
        timeout = window.setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('timeout')); }, 20_000);
      });
      try {
        const { response, result } = await Promise.race([
          (async () => {
            const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/dashboard?dayId=${encodeURIComponent(day)}`, {
              headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
            });
            // Authorization does not depend on a possibly stalled response body.
            if (response.status === 401) return { response, result: null };
            const result = await response.json() as { message?: string; data?: unknown; success?: boolean };
            return { response, result };
          })(), deadline,
        ]);
        if (disposed) return;
        if (response.status === 401) { onUnauthorized(); return; }
        if (!response.ok || result?.success === false || !validSnapshot(result?.data, day)) {
          setSnapshot(previous => ({ ...previous, data: response.status === 403 || response.status === 404 ? null : previous.data,
            error: typeof result?.message === 'string' && result.message.trim() ? result.message : 'Unable to load valid shift data.' }));
          return;
        }
        setSnapshot({ scope, data: result.data, loading: false, error: '', updated: Date.now() });
      } catch {
        if (!disposed) setSnapshot(previous => ({ ...previous, error: timedOut
          ? 'Shift data timed out. Please retry.' : 'Cannot reach the shift service.' }));
      } finally {
        window.clearTimeout(timeout);
        finish();
        inFlight = false;
        cancel = undefined;
        if (!disposed) setSnapshot(previous => ({ ...previous, loading: false }));
      }
    };
    void load();
    const refresh = () => { void load(true); };
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      disposed = true; cancel?.(); window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [scope, outletId, token, day, enabled, reload, onUnauthorized]);
  return enabled && snapshot.scope === scope ? snapshot : { scope, data: null, loading: enabled, error: '', updated: 0 };
}
