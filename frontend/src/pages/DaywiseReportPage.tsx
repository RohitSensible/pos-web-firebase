import { PageHeading } from '../components/PageHeading.tsx';
import { useScopedReportRead, useScopedReportExport } from '../utils/useScopedReportRead.ts';
import { useDataLoading } from '../utils/useDataLoading.ts';
import { gstDetailRows, loadGstExportBills, gstBillSummary } from '../utils/gstExcel.ts';
import { downloadReportExcel, billRange, sumPayments, paymentSummary } from '../utils/reportExcel.ts';
import { reportDateError } from './reportDates.ts';
import { ReportDateInput } from './ReportDateInput.tsx';
import { isProvided, tableLabel } from './billReceipt.ts';
import { useEffect, useState } from 'react';
import { Banknote, CalendarDays, CreditCard, Download, Printer, ReceiptText, RefreshCw, TrendingUp, X } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './BillWiseReportPage.css';
import './DaywiseReportPage.css';

interface DaySummary {
  dayId: string;
  billCount: number;
  billDeletesNumber: number;
  billDeletesAmount: number;
  openingAmt: number;
  totalSale: number;
  cashSale: number;
  digitalSale: number;
  creditSale: number;
  subTotalBill: number;
  discount: number;
  tax: number;
  gstTotal: number;
  vatTotal: number;
  refundAmount: number;
  extraCharges: number;
  serviceChargeAmount: number;
  roundOff: number;
  expensesAmtTotal: number;
  expCash: number;
  expDigital: number;
  advanceAmtTotal: number;
  customerReceiveAmtTotal: number;
  receiveAmtTotal: number;
  swiggyTotal: number;
  zomatoTotal: number;
  payments: Record<string, number>;
}

interface DaywiseReportPageProps {
  outlet: OutletSummary;
  reportName?: string;
  token: string;
  onSessionExpired: () => void;
}

interface DayBill {
  documentId: string;
  billNo: string;
  serialNo: string;
  billType: string;
  dayId: string;
  createdDate: number;
  finalTotal: number;
  taxAmount: number;
  discount: number;
  serviceChargeAmount: number;
  roundOff: number;
  shiftId: string;
  deviceId: string;
  table: string;
  vehicleNo: string;
  remark: unknown;
  customerDetails: unknown;
  employee: unknown;
  payments: Record<string, number>;
  paymentModes: string[];
  items: { name: string; quantity: number; price: number; total: number; taxPercentage: number; remark: unknown }[];
}

interface BillsResponse {
  bills: DayBill[];
  pagination: { totalPages: number };
}

function dateTime(value: number): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function todayId(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function money(value = 0): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
}

function paymentLabel(mode: string): string {
  const labels: Record<string, string> = {
    cash: 'Cash', card: 'Card', digital: 'Digital', googlepay: 'Google Pay',
    phonepe: 'PhonePe', paytm: 'Paytm', upi: 'UPI', credit: 'Credit',
    cheque_payment_mode: 'Cheque', other: 'Other',
  };
  return labels[mode.toLowerCase()] || mode;
}

function detailLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not provided';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(detailLabel).join(' · ') || 'Not provided';
  if (typeof value === 'object') {
    return Object.entries(value).map(([key, entry]) => `${key}: ${detailLabel(entry)}`).join(' · ') || 'Not provided';
  }
  return 'Not provided';
}

export const DaywiseReportPage = ({ outlet, token, onSessionExpired, reportName = 'Day Wise Report' }: DaywiseReportPageProps) => {
  const [dayId, setDayId] = useState(todayId);
  const [reloadKey, setReloadKey] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedBill, setSelectedBill] = useState<DayBill | null>(null);

  useEffect(() => {
    if (!selectedBill) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedBill(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedBill]);

  const scopeKey = JSON.stringify([outlet.id, token, dayId, reloadKey]);
  const { data, loading, error } = useScopedReportRead<{ report: DaySummary | null; bills: DayBill[] }>(scopeKey, token, onSessionExpired, async request => {
    const dateError = reportDateError(dayId, dayId);
    if (dateError) throw new Error(dateError);
    const params = new URLSearchParams({ dayId, scope: 'day' });
    const requestBills = async (page: number) => {
      const billParams = new URLSearchParams({ startDate: dayId, endDate: dayId, page: String(page), limit: '50' });
      return (await request<BillsResponse>(`/api/outlets/${encodeURIComponent(outlet.id)}/reports/bills?${billParams}`))!;
    };
    const [summary, firstPage] = await Promise.all([
      request<DaySummary>(`/api/outlets/${encodeURIComponent(outlet.id)}/dashboard?${params}`, true), requestBills(1),
    ]);
    if (summary && summary.dayId !== dayId) throw new Error('The day summary does not match the selected date. Refresh to try again.');
    const allBills = [...firstPage.bills];
    // Sequential pages bound concurrency and retain the service's bill order.
    for (let page = 2; page <= firstPage.pagination.totalPages; page++) {
      allBills.push(...(await requestBills(page)).bills);
    }
    if (allBills.some(bill => bill.dayId && bill.dayId !== dayId)) throw new Error('Bill dates do not match the selected date. Refresh to try again.');
    return { report: summary, bills: allBills };
  });
  const report = data?.report ?? null;
  const bills = data?.bills ?? [];
  useDataLoading(loading, 'Daywise Report');
  const { runExport, exporting, exportError } = useScopedReportExport(JSON.stringify([scopeKey, dayId]));
  // The keyed read already hides old details; reset local selection for the next result.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { setDetailsOpen(false); setSelectedBill(null); }, [scopeKey]);

  const cashInHand = report ? report.openingAmt + report.cashSale - report.expCash : 0;
  const metrics: [string, number][] = report ? [
    ['Opening Balance', report.openingAmt], ['Cash In Hand', cashInHand],
    ['Sub Total', report.subTotalBill], ['Total Discount', report.discount],
    ['Total Tax', report.tax], ['GST', report.gstTotal], ['VAT', report.vatTotal],
    ['Refund Amount', report.refundAmount], ['Extra Charge', report.extraCharges],
    ['Service Charge', report.serviceChargeAmount], ['Round Off', report.roundOff],
    ['Total Expenses', report.expensesAmtTotal], ['Cash Expenses', report.expCash],
    ['Digital Expenses', report.expDigital], ['Advance Payment', report.advanceAmtTotal],
    ['Received Customer Credit', report.customerReceiveAmtTotal], ['Total Receipts', report.receiveAmtTotal],
    ['Deleted Bill Amount', report.billDeletesAmount], ['Swiggy', report.swiggyTotal], ['Zomato', report.zomatoTotal],
  ] : [];

  const canOutput = !loading && !error && ((report?.billCount ?? 0) > 0 || bills.length > 0);

  const exportExcel = async () => {
    if (!canOutput) return;
    await runExport(async signal => {
      const gstBills = await loadGstExportBills(outlet.id, token, bills, dayId, dayId, onSessionExpired, signal);
      signal.throwIfAborted();
      const rows = gstDetailRows(gstBills, 'day');
      await downloadReportExcel({
        signal,
        name: reportName, outlet, startDate: dayId, endDate: dayId,
        summary: {
          ...sumPayments(bills),
          ...gstBillSummary(gstBills),
          ...(report ? paymentSummary(report.payments) : {}),
          'Bill No Range': billRange(bills),
          'TOTAL SALE': report?.totalSale ?? bills.reduce((sum, bill) => sum + bill.finalTotal, 0),
          'TOTAL TAX': report?.tax ?? bills.reduce((sum, bill) => sum + bill.taxAmount, 0),
          ...(report ? { Cash: report.cashSale, Digital: report.digitalSale, Credit: report.creditSale } : {}),
        },
        rows,
      });
    });
  };

  return (
    <section className="bill-report-page daywise-report-page">
      <div className="bill-report-heading">
        <div><strong className="report-print-shop-name">{outlet.name}</strong><span>REPORTS</span><PageHeading>Daywise Report</PageHeading><p>Review daily sales totals.</p></div>
        <div className="bill-report-actions">
          <button type="button" onClick={exportExcel} disabled={!canOutput || exporting}><Download /> Export Excel</button>
          <button type="button" disabled={!canOutput} onClick={() => { if (canOutput) window.print(); }}><Printer /> Print / PDF</button>
        </div>
      </div>

      <div className="bill-report-filters">
        <label><span>Report date</span><ReportDateInput aria-label="Report date" value={dayId} onChange={value => { if (value) setDayId(value); }} /></label>
        <div className="bill-filter-buttons"><button type="button" className="apply" disabled={loading} onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Refresh</button><button type="button" onClick={() => setDayId(todayId())}>Today</button></div>
      </div>

      {exportError && <div role="alert">Export failed: {exportError} Use Export Excel to try again.</div>}

      <div className="bill-summary-grid">
        <article><span><ReceiptText /></span><div><small>Total Bills</small><strong>{report?.billCount ?? 0}</strong></div></article>
        <article><span><TrendingUp /></span><div><small>Total Sale</small><strong>{money(report?.totalSale)}</strong></div></article>
        <article><span><Banknote /></span><div><small>Cash Sale</small><strong>{money(report?.cashSale)}</strong></div></article>
        <article><span><CreditCard /></span><div><small>Digital Sale</small><strong>{money(report?.digitalSale)}</strong></div></article>
      </div>

      <div className="bill-table-card">
        {loading && <div className="bill-report-state" data-inline-loading><RefreshCw className="bill-report-spinner" /><strong>Loading daywise report…</strong></div>}
        {!loading && error && <div className="bill-report-state error" role="alert"><strong>{error}</strong><button type="button" onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Retry</button></div>}
        {!loading && !error && !report && <div className="bill-report-state"><CalendarDays /><strong>No shift data found for this date.</strong><p>Choose another date or refresh to load recorded sales.</p></div>}
        {!loading && !error && report && <div className="bill-table-scroll"><table className="mobile-report-table">
          <thead><tr><th>Day ID</th><th>Bills</th><th className="amount">Cash</th><th className="amount">Digital</th><th className="amount">Credit</th><th className="amount">Expenses</th><th className="amount">Total Sale</th></tr></thead>
          <tbody><tr onClick={() => setDetailsOpen(true)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') setDetailsOpen(true); }}><td data-label="Day ID" data-mobile-primary="true"><strong>{report.dayId}</strong><small>All shifts</small></td><td data-label="Bills">{report.billCount}</td><td data-label="Cash" className="amount">{money(report.cashSale)}</td><td data-label="Digital" className="amount">{money(report.digitalSale)}</td><td data-label="Credit" className="amount">{money(report.creditSale)}</td><td data-label="Expenses" className="amount">{money(report.expensesAmtTotal)}</td><td data-label="Total Sale" className="amount"><strong>{money(report.totalSale)}</strong></td></tr></tbody>
          <tfoot><tr><td data-mobile-primary="true"><strong>Total</strong></td><td data-label="Bills">{report.billCount}</td><td data-label="Cash" className="amount">{money(report.cashSale)}</td><td data-label="Digital" className="amount">{money(report.digitalSale)}</td><td data-label="Credit" className="amount">{money(report.creditSale)}</td><td data-label="Expenses" className="amount">{money(report.expensesAmtTotal)}</td><td data-label="Total Sale" className="amount"><strong>{money(report.totalSale)}</strong></td></tr></tfoot>
        </table></div>}
      </div>

      {!loading && !error && <div className="bill-table-card daywise-bills-card">
        <h2>Bills &amp; Products <small>{bills.length} bills</small></h2>
        {!bills.length ? <div className="bill-report-state"><ReceiptText /><strong>No bills found for this date.</strong><p>Choose another date or refresh to load recorded bills.</p></div> : <div className="bill-table-scroll"><table className="mobile-report-table">
          <thead><tr><th>Bill No.</th><th>Date / Time</th><th>Payment</th><th>Product</th><th className="amount">Qty</th><th className="amount">Rate</th><th className="amount">Product Total</th><th className="amount">Bill Total</th></tr></thead>
          <tbody>{bills.flatMap(bill => {
            const items = bill.items.length ? bill.items : [null];
            return items.map((item, index) => <tr data-report-context={index > 0 ? `Bill ${bill.billNo}` : undefined} key={`${bill.documentId}-${index}`} onClick={() => setSelectedBill(bill)} tabIndex={0} aria-label={`View bill ${bill.billNo} details`} onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setSelectedBill(bill);
              }
            }}>
              {index === 0 && <>
                <td data-label="Bill No." data-mobile-primary="true" rowSpan={items.length}><strong>{bill.billNo}</strong></td>
                <td data-label="Date / Time" rowSpan={items.length}>{dateTime(bill.createdDate)}</td>
                <td data-label="Payment" rowSpan={items.length}><div className="payment-tags">{bill.paymentModes.length ? bill.paymentModes.map(mode => <span key={mode}>{paymentLabel(mode)}</span>) : <span>Unspecified</span>}</div></td>
              </>}
              <td data-label="Product" data-mobile-primary="true">{item?.name ?? 'No product details available'}</td>
              <td data-label="Qty" className="amount">{item?.quantity ?? '—'}</td>
              <td data-label="Rate" className="amount">{item ? money(item.price) : '—'}</td>
              <td data-label="Product Total" className="amount">{item ? money(item.total) : '—'}</td>
              {index === 0 && <td data-label="Bill Total" className="amount" rowSpan={items.length}><strong>{money(bill.finalTotal)}</strong></td>}
            </tr>);
          })}</tbody>
          <tfoot><tr><td data-mobile-primary="true" colSpan={7}><strong>Total · {bills.length} bills</strong></td><td data-label="Bill Total" className="amount"><strong>{money(bills.reduce((total, bill) => total + bill.finalTotal, 0))}</strong></td></tr></tfoot>
        </table></div>}
      </div>}

      {!loading && !error && selectedBill && <div className="bill-detail-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedBill(null); }}>
        <article className="bill-detail-modal daywise-bill-detail" role="dialog" aria-modal="true" aria-label={`Bill ${selectedBill.billNo}`}>
          <header><div><span>BILL DETAILS</span><h2>{selectedBill.billNo}</h2><p>{dateTime(selectedBill.createdDate)}</p></div><button type="button" onClick={() => setSelectedBill(null)} aria-label="Close bill details" autoFocus><X /></button></header>
          <div className="bill-detail-body">
            <div className="bill-detail-meta">
              {/* Only details a person needs, and only when they are set; internal IDs are left out. */}
              {[
                ['Bill type', selectedBill.billType], ['Table', tableLabel(selectedBill.table)],
                ['Customer', detailLabel(selectedBill.customerDetails)], ['Employee', detailLabel(selectedBill.employee)],
                ['Vehicle', selectedBill.vehicleNo], ['Remark', detailLabel(selectedBill.remark)],
              ].filter(([, value]) => isProvided(value)).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
            </div>
            <h3>Products</h3>
            <div className="bill-items-table"><table className="mobile-report-table">
              <thead><tr><th>Product</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead>
              <tbody>{selectedBill.items.length ? selectedBill.items.map((item, index) => <tr key={index}><td data-label="Product" data-mobile-primary="true">{item.name}{isProvided(detailLabel(item.remark)) && <small className="bill-item-remark">{detailLabel(item.remark)}</small>}</td><td data-label="Qty">{item.quantity}</td><td data-label="Rate">{money(item.price)}</td><td data-label="Total">{money(item.total)}</td></tr>) : <tr><td data-mobile-primary="true" colSpan={4}>No product details available</td></tr>}</tbody>
            </table></div>
            <div className="bill-payment-detail"><h3>Payments</h3>
              {Object.entries(selectedBill.payments).filter(([, amount]) => amount > 0).map(([mode, amount]) => <div key={mode}><span>{paymentLabel(mode)}</span><strong>{money(amount)}</strong></div>)}
              {!Object.values(selectedBill.payments).some(amount => amount > 0) && <div><span>No payments recorded</span><strong>{money(0)}</strong></div>}
            </div>
            <div className="bill-total-detail">
              {([['Discount', selectedBill.discount], ['Tax', selectedBill.taxAmount], ['Service Charge', selectedBill.serviceChargeAmount], ['Round Off', selectedBill.roundOff]] as const)
                .filter(([, amount]) => amount !== 0).map(([label, amount]) => <div key={label}><span>{label}</span><strong>{money(amount)}</strong></div>)}
              <div className="grand-total"><span>Grand Total</span><strong>{money(selectedBill.finalTotal)}</strong></div>
            </div>
          </div>
          <footer><button type="button" onClick={() => setSelectedBill(null)}>Close</button></footer>
        </article>
      </div>}

      {detailsOpen && report && <div className="bill-detail-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDetailsOpen(false); }}>
        <article className="bill-detail-modal" role="dialog" aria-modal="true" aria-label={`Daywise report for ${report.dayId}`}>
          <header><div><span>DAYWISE SUMMARY</span><h2>{report.dayId}</h2><p>All shifts</p></div><button type="button" onClick={() => setDetailsOpen(false)} aria-label="Close daywise details"><X /></button></header>
          <div className="bill-detail-body">
            <div className="bill-detail-meta"><div><span>Bills</span><strong>{report.billCount}</strong></div><div><span>Deleted Bills</span><strong>{report.billDeletesNumber}</strong></div></div>
            <div className="bill-payment-detail"><h3>Payments</h3>{Object.entries(report.payments).filter(([, amount]) => amount > 0).map(([mode, amount]) => <div key={mode}><span>{paymentLabel(mode)}</span><strong>{money(amount)}</strong></div>)}{!Object.values(report.payments).some(amount => amount > 0) && <div><span>No payments recorded</span><strong>{money(0)}</strong></div>}</div>
            <div className="bill-total-detail">{metrics.map(([label, amount]) => <div key={label}><span>{label}</span><strong>{money(amount)}</strong></div>)}<div className="grand-total"><span>Total Sale</span><strong>{money(report.totalSale)}</strong></div></div>
          </div>
          <footer><button type="button" disabled={!canOutput} onClick={() => { if (canOutput) window.print(); }}><Printer /> Print / Save PDF</button></footer>
        </article>
      </div>}
    </section>
  );
};
