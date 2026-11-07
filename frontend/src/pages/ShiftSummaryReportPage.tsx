import { PageHeading } from '../components/PageHeading.tsx';
import { useDataLoading } from '../utils/useDataLoading.ts';
import { dashboardShiftStatus } from '../../../shared/shiftStatus.ts';
import { downloadReportExcel, sumPayments } from '../utils/reportExcel.ts';
import { ReportMonthInput } from './ReportMonthInput.tsx';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ShiftRecord } from './shiftReportTypes.ts';
import { ShiftDetailsDialog } from './ShiftDetailsDialog.tsx';
export type { ShiftRecord } from './shiftReportTypes.ts';
import {
  Banknote, Clock3, CreditCard, Download, Filter, Printer,
  RefreshCw, TrendingUp, X,
} from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './BillWiseReportPage.css';
import './ShiftSummaryReportPage.css';

interface ShiftReportResponse {
  shifts: ShiftRecord[];
  summary: {
    totalShifts: number; totalBills: number; totalSale: number; cashSale: number;
    digitalSale: number; creditSale: number; expenses: number;
  };
}

interface ShiftFilters {
  month: string;
  shiftNo: string;
  deviceId: string;
}

interface ShiftSummaryReportPageProps {
  outlet: OutletSummary;
  reportName?: string;
  token: string;
  onSessionExpired: () => void;
}

function currentMonthId(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function monthDateRange(month: string): { startDate: string; endDate: string } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match || Number(match[1]) === 0) return { startDate: '', endDate: '' };
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lastDay = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthNumber - 1];
  return {
    startDate: `${month}-01`,
    endDate: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

function money(value = 0): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
}

function dateTime(value: number): string {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function endLabel(shift: ShiftRecord): string {
  if (shift.endTime) return dateTime(shift.endTime) === '—' ? 'Not Available' : dateTime(shift.endTime);
  return dashboardShiftStatus(shift) === 'Active' ? 'In progress' : 'Not Available';
}

function cashInHand(shift: ShiftRecord): number {
  return shift.openingAmt + shift.cashSale - shift.expCash;
}

export const ShiftSummaryReportPage = ({ outlet, token, onSessionExpired, reportName = 'Shift Summary Report' }: ShiftSummaryReportPageProps) => {
  const initialFilters = useMemo<ShiftFilters>(() => ({
    month: currentMonthId(), shiftNo: '', deviceId: '',
  }), []);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [reloadKey, setReloadKey] = useState(0);
  const scope = useMemo(() => ({ outletId: outlet.id, token, appliedFilters, reloadKey }), [outlet.id, token, appliedFilters, reloadKey]);
  const currentScope = useRef(scope);
  const sessionExpired = useRef(onSessionExpired);
  const [read, setRead] = useState<{ scope: typeof scope; report?: ShiftReportResponse; error?: string } | null>(null);
  const [selection, setSelection] = useState<{ scope: typeof scope; id: string } | null>(null);
  const [validationError, setValidationError] = useState('');
  const [exportFailure, setExportFailure] = useState<{ scope: typeof scope; message: string } | null>(null);
  const [exportScope, setExportScope] = useState<typeof scope | null>(null);
  const exportJob = useRef<AbortController | null>(null);
  const report = read?.scope === scope ? read.report ?? null : null;
  const error = read?.scope === scope ? read.error ?? '' : '';
  const loading = read?.scope !== scope;
  const canOutput = !loading && !error && !!report?.shifts.length;
  const exporting = exportScope === scope;
  const selectedShift = selection?.scope === scope && !loading && !error
    ? report?.shifts.find(shift => shift.id === selection.id) : undefined;
  useDataLoading(loading, 'Shift Summary');

  useLayoutEffect(() => {
    currentScope.current = scope;
    sessionExpired.current = onSessionExpired;
  });
  useLayoutEffect(() => {
    setSelection(null);
    return () => { exportJob.current?.abort(); exportJob.current = null; };
  }, [scope]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const isCurrent = () => active && !controller.signal.aborted && currentScope.current === scope;
    const timer = window.setTimeout(() => {
      if (!isCurrent()) return;
      controller.abort();
      setRead({ scope, error: 'Loading shifts timed out. Please retry.' });
    }, 20_000);
    const { startDate, endDate } = monthDateRange(appliedFilters.month);
    const params = new URLSearchParams({ startDate, endDate });
    if (appliedFilters.shiftNo) params.set('shiftNo', appliedFilters.shiftNo);
    if (appliedFilters.deviceId) params.set('deviceId', appliedFilters.deviceId);
    void (async () => {
      try {
        const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/reports/shifts?${params}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        if (!isCurrent()) return;
        if (response.status === 401) {
          sessionExpired.current();
          throw new Error('Your session has expired.');
        }
        const result = await response.json() as { message?: string; data?: ShiftReportResponse };
        if (!isCurrent()) return;
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load shifts.');
        setRead({ scope, report: result.data });
      } catch (requestError) {
        if (isCurrent()) setRead({ scope, error: requestError instanceof Error ? requestError.message : 'Unable to load shifts.' });
      } finally { window.clearTimeout(timer); }
    })();
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [scope, outlet.id, token, appliedFilters]);

  const applyFilters = () => {
    if (!monthDateRange(filters.month).startDate) {
      setValidationError('Choose a valid month and year.');
      return;
    }
    const shiftNo = filters.shiftNo.trim();
    if (shiftNo && (!/^[0-9]+$/.test(shiftNo) || !Number.isSafeInteger(Number(shiftNo)) || Number(shiftNo) < 1)) {
      setValidationError('Shift number must be a positive whole number.');
      return;
    }
    setValidationError('');
    setAppliedFilters({ ...filters, shiftNo: shiftNo ? String(Number(shiftNo)) : '', deviceId: filters.deviceId.trim() });
  };

  const resetFilters = () => {
    const reset = { ...initialFilters, month: currentMonthId() };
    setValidationError('');
    setFilters(reset);
    setAppliedFilters(reset);
  };

  const exportExcel = async () => {
    if (!canOutput || !report || exportJob.current) return;
    const controller = new AbortController();
    exportJob.current = controller;
    setExportScope(scope);
    setExportFailure(null);
    try {
      const rows = [
        ['Day ID', 'Shift No', 'Status', 'Start Time', 'End Time', 'Start Bill', 'Last Bill', 'Bill Count',
          'Opening Amount', 'Cash Sale', 'Digital Sale', 'Credit Sale', 'Discount', 'Tax', 'Expenses', 'Cash In Hand', 'Total Sale'],
        ...report.shifts.map(shift => [
          shift.dayId, shift.shiftNo, dashboardShiftStatus(shift),
          (dateTime(shift.startTime) !== '—' ? new Date(shift.startTime) : '—'), (shift.endTime && dateTime(shift.endTime) !== '—' ? new Date(shift.endTime) : endLabel(shift)), shift.startBillNo, shift.lastBillNo, shift.billCount,
          shift.openingAmt, shift.cashSale, shift.digitalSale, shift.creditSale, shift.discount, shift.tax,
          shift.expensesAmtTotal, cashInHand(shift), shift.totalSale,
        ]),
      ];
      await downloadReportExcel({
        signal: controller.signal,
        name: reportName, outlet, ...monthDateRange(appliedFilters.month),
        summary: {
          ...sumPayments(report.shifts),
          'TOTAL SALE': report.summary.totalSale,
          'TOTAL TAX': report.shifts.reduce((sum, shift) => sum + shift.tax, 0),
          Cash: report.summary.cashSale,
          Digital: report.summary.digitalSale,
          Credit: report.summary.creditSale,
          'Bill No Range': report.shifts.filter(shift => shift.startBillNo || shift.lastBillNo)
            .map(shift => `${shift.startBillNo} to ${shift.lastBillNo}`).join('; ') || 'N/A',
        },
        rows,
      });
    } catch (exportError) {
      if (!controller.signal.aborted && currentScope.current === scope) {
        setExportFailure({ scope, message: exportError instanceof Error ? exportError.message : 'Unable to export shifts.' });
      }
    } finally {
      if (exportJob.current === controller) {
        exportJob.current = null;
        setExportScope(null);
      }
    }
  };

  return (
    <section className="bill-report-page shift-report-page">
      <div className="bill-report-heading">
        <div><strong className="report-print-shop-name">{outlet.name}</strong><span>REPORTS</span><PageHeading>Shift Summary Report</PageHeading><p>Review sales by shift.</p></div>
        <div className="bill-report-actions">
          <button type="button" aria-label="Refresh shifts" onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Refresh</button>
          <button type="button" onClick={exportExcel} disabled={!canOutput || exporting}><Download /> {exporting ? 'Exporting…' : 'Export Excel'}</button>
          <button type="button" disabled={!canOutput} onClick={() => { if (canOutput) window.print(); }}><Printer /> Print / PDF</button>
        </div>
      </div>

      <div className="bill-report-filters">
        <label><span>Month / Year</span><ReportMonthInput aria-label="Month and year" value={filters.month} onChange={value => setFilters(current => ({ ...current, month: value }))} /></label>
        <label><span>Shift No.</span><input type="text" inputMode="numeric" value={filters.shiftNo} onChange={event => setFilters(current => ({ ...current, shiftNo: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters(); }} placeholder="All shifts" /></label>
        <label><span>Device ID</span><input value={filters.deviceId} onChange={event => setFilters(current => ({ ...current, deviceId: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters(); }} placeholder="All devices" /></label>
        <div className="bill-filter-buttons"><button type="button" className="apply" onClick={applyFilters}><Filter /> Apply</button><button type="button" onClick={resetFilters}><X /> Reset</button></div>
      </div>

      {validationError && <p className="shift-report-error" role="alert">{validationError}</p>}
      {exportFailure?.scope === scope && <p className="shift-report-error" role="alert">{exportFailure.message}</p>}
      <p className="shift-report-timezone">Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
      <div className="bill-summary-grid">
        <article><span><Clock3 /></span><div><small>Total Shifts · Bills</small><strong>{report?.summary.totalShifts ?? 0} · {report?.summary.totalBills ?? 0}</strong></div></article>
        <article><span><TrendingUp /></span><div><small>Total Sale</small><strong>{money(report?.summary.totalSale)}</strong></div></article>
        <article><span><Banknote /></span><div><small>Cash Sale</small><strong>{money(report?.summary.cashSale)}</strong></div></article>
        <article><span><CreditCard /></span><div><small>Digital Sale</small><strong>{money(report?.summary.digitalSale)}</strong></div></article>
      </div>

      <div className="bill-table-card">
        {loading && <div className="bill-report-state" data-inline-loading><RefreshCw className="bill-report-spinner" /><strong>Loading shifts…</strong></div>}
        {!loading && error && <div className="bill-report-state error" role="alert"><strong>{error}</strong><button type="button" onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Retry</button></div>}
        {!loading && !error && report?.shifts.length === 0 && <div className="bill-report-state"><Clock3 /><strong>No shifts found for these filters.</strong><p>Choose another month or reset the filters.</p><button type="button" onClick={resetFilters}>Reset filters</button></div>}
        {!loading && !error && report && report.shifts.length > 0 && (
          <div className="bill-table-scroll"><table className="mobile-report-table"><thead><tr><th>Day ID</th><th>Shift</th><th>Status</th><th>Start / End</th><th>Bills</th><th className="amount">Cash</th><th className="amount">Digital</th><th className="amount">Credit</th><th className="amount">Expenses</th><th className="amount">Total Sale</th></tr></thead><tbody>{report.shifts.map(shift => <tr key={shift.id} onClick={() => setSelection({ scope, id: shift.id })} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') setSelection({ scope, id: shift.id }); }}><td data-label="Day ID" data-mobile-primary="true"><strong>{shift.dayId || '—'}</strong><small>{shift.id}</small></td><td data-label="Shift">Shift {shift.shiftNo}</td><td data-label="Status"><span className={`shift-status ${dashboardShiftStatus(shift).toLowerCase()}`}>{dashboardShiftStatus(shift)}</span></td><td data-label="Start / End"><div className="shift-times"><span>{dateTime(shift.startTime)}</span><small>{endLabel(shift)}</small></div></td><td data-label="Bills"><div className="shift-times"><span>{shift.billCount} bills</span><small>{shift.startBillNo && shift.lastBillNo ? `${shift.startBillNo} – ${shift.lastBillNo}` : '—'}</small></div></td><td data-label="Cash" className="amount">{money(shift.cashSale)}</td><td data-label="Digital" className="amount">{money(shift.digitalSale)}</td><td data-label="Credit" className="amount">{money(shift.creditSale)}</td><td data-label="Expenses" className="amount">{money(shift.expensesAmtTotal)}</td><td data-label="Total Sale" className="amount"><strong>{money(shift.totalSale)}</strong></td></tr>)}</tbody><tfoot><tr><td data-mobile-primary="true"><strong>Total</strong></td><td colSpan={3}>{report.summary.totalShifts} shifts</td><td data-label="Bills">{report.summary.totalBills} bills</td><td data-label="Cash" className="amount">{money(report.summary.cashSale)}</td><td data-label="Digital" className="amount">{money(report.summary.digitalSale)}</td><td data-label="Credit" className="amount">{money(report.summary.creditSale)}</td><td data-label="Expenses" className="amount">{money(report.summary.expenses)}</td><td data-label="Total Sale" className="amount"><strong>{money(report.summary.totalSale)}</strong></td></tr></tfoot></table></div>
        )}
      </div>

      {selectedShift && <ShiftDetailsDialog shift={selectedShift} outletName={outlet.name} onClose={() => setSelection(null)} />}
    </section>
  );
};
