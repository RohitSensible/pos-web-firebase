import { PageHeading } from '../components/PageHeading.tsx';
import { useMobileSearch, rankSearchResults } from '../utils/useMobileSearch.ts';
import { useDataLoading } from '../utils/useDataLoading.ts';
import { downloadReportExcel, salesTaxRows, salesTaxSummary, type SalesTaxBreakdown } from '../utils/reportExcel.ts';
import { useReportSearch } from './useReportSearch.ts';
import { ReportDateInput } from './ReportDateInput.tsx';
import { reportDateError } from './reportDates.ts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Download, FileText, Filter, Package, PackageSearch, Printer,
  ReceiptText, RefreshCw, Search, X,
} from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './BillWiseReportPage.css';
import './CategoryWiseReportPage.css';
import './ProductWiseReportPage.css';

interface ProductRow {
  taxRate?: string | number;
  taxAmount?: number;
  taxBreakdown?: SalesTaxBreakdown[];
  productId: string;
  code: string;
  name: string;
  category: string;
  billCount: number;
  quantity: number;
  averageRate: number;
  amount: number;
  share: number;
}

interface ProductReportResponse {
  products: ProductRow[];
  summary: { totalProducts: number; totalBills: number; totalQuantity: number; totalAmount: number; totalTax?: number };
}

interface ProductFilters {
  startDate: string;
  endDate: string;
  shiftId: string;
  search: string;
}

interface ProductWiseReportPageProps {
  outlet: OutletSummary;
  reportName?: string;
  token: string;
  onSessionExpired: () => void;
}

function todayId(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function money(value = 0): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
}

function quantity(value = 0): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(value);
}

// Numeric codes sort numerically; missing codes go last.
function compareCodes(left: string, right: string): number {
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  return left.localeCompare(right, undefined, { numeric: true });
}

export const ProductWiseReportPage = ({ outlet, token, onSessionExpired, reportName = 'Product Wise' }: ProductWiseReportPageProps) => {
  const initialFilters = useMemo<ProductFilters>(() => ({
    startDate: todayId(), endDate: todayId(), shiftId: '', search: '',
  }), []);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [validationError, setValidationError] = useState('');
  const [sort, setSort] = useState('code');
  const [reloadKey, setReloadKey] = useState(0);
  const scope = useMemo(() => ({ outletId: outlet.id, token, filters: appliedFilters, revision: reloadKey }), [outlet.id, token, appliedFilters, reloadKey]);
  const [result, setResult] = useState<{ scope: object; report?: ProductReportResponse; error?: string } | null>(null);
  const loading = result?.scope !== scope;
  const error = !loading ? result?.error ?? '' : '';
  const report = !loading && !error ? result?.report : undefined;
  const canOutput = !!report?.products.length && !validationError;
  const exportJob = useRef<AbortController | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportFailure, setExportFailure] = useState('');
  useDataLoading(loading, 'Product Sales Report');

  useLayoutEffect(() => {
    setExporting(false);
    setExportFailure('');
    return () => { exportJob.current?.abort(); exportJob.current = null; };
  }, [scope]);

  const mobileSearch = useMobileSearch();
  useReportSearch(filters.search, appliedFilters.search, setAppliedFilters);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ startDate: appliedFilters.startDate, endDate: appliedFilters.endDate });
    if (appliedFilters.shiftId) params.set('shiftId', appliedFilters.shiftId);
    if (appliedFilters.search) params.set('search', appliedFilters.search);

    fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/reports/products?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    })
      .then(async response => {
        const result = await response.json() as { success: boolean; message?: string; data?: ProductReportResponse };
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          onSessionExpired();
          throw new Error('Your session has expired.');
        }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load products.');
        setResult({ scope, report: result.data });
      })
      .catch(requestError => {
        if (!controller.signal.aborted) setResult({ scope, error: (requestError as Error).message });
      });
    return () => controller.abort();
  // onSessionExpired is a stable callback from the parent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const sortedProducts = useMemo(() => {
    const rows = [...(report?.products ?? [])];
    return rows.sort((left, right) => {
      const primary = sort === 'name' ? left.name.localeCompare(right.name)
        : sort === 'quantity' ? right.quantity - left.quantity
        : sort === 'amount' ? right.amount - left.amount : 0;
      return primary || compareCodes(left.code, right.code) || left.productId.localeCompare(right.productId);
    });
  }, [report, sort]);

  const displayedProducts = useMemo(() => mobileSearch ? rankSearchResults(sortedProducts, appliedFilters.search, product => ({ primary: [product.name], text: [product.name, product.category], identifiers: [product.code] })) : sortedProducts, [sortedProducts, appliedFilters.search, mobileSearch]);

  const applyFilters = () => {
    const dateError = reportDateError(filters.startDate, filters.endDate);
    if (dateError) {
      setValidationError(dateError);
      return;
    }
    setValidationError('');
    setAppliedFilters({ ...filters, search: filters.search.trim() });
  };

  const resetFilters = () => {
    const reset = { ...initialFilters, startDate: todayId(), endDate: todayId() };
    setValidationError('');
    setFilters(reset);
    setAppliedFilters(reset);
  };

  const exportExcel = async () => {
    if (!canOutput || !report || exportJob.current) return;
    const controller = new AbortController();
    exportJob.current = controller;
    setExporting(true);
    setExportFailure('');
    try {
      // Keep the existing accumulation order so sorting cannot change tax totals.
      const taxSummary = salesTaxSummary([...report.products].sort((left, right) => compareCodes(left.code, right.code)));
      const totalTax = report.summary.totalTax ?? Number(taxSummary['TOTAL TAX']);
      const rows: (string | number | Date)[][] = [
        ['Product Name', 'Category', 'Tax Rate', 'Qty Sold', 'Sale', 'Tax Amount', 'Discount'],
        ...sortedProducts.flatMap(product => salesTaxRows(product).map(group => [
          product.name, product.category, group.rate === null ? 0 : `${group.rate}%`,
          group.quantity, group.amount, group.taxAmount, 0,
        ])),
        ['Total', '', '', report.summary.totalQuantity, report.summary.totalAmount, totalTax, 0],
      ];
      await downloadReportExcel({
        signal: controller.signal, name: reportName, outlet, startDate: appliedFilters.startDate, endDate: appliedFilters.endDate,
        summary: { ...taxSummary, 'TOTAL SALE': report.summary.totalAmount, 'TOTAL TAX': totalTax }, rows,
      });
    } catch {
      if (!controller.signal.aborted) setExportFailure('Unable to export. Please try again.');
    } finally {
      if (exportJob.current === controller) {
        exportJob.current = null;
        setExporting(false);
      }
    }
  };

  return (
    <section className="bill-report-page category-report-page product-report-page">
      <div className="bill-report-heading">
        <div><strong className="report-print-shop-name">{outlet.name}</strong><span>REPORTS</span><PageHeading>Product Wise Report</PageHeading><p>Review sales by product.</p></div>
        <div className="bill-report-actions">
          <button type="button" onClick={exportExcel} disabled={!canOutput || exporting}><Download /> {exporting ? 'Exporting…' : 'Export Excel'}</button>
          <button type="button" disabled={!canOutput} onClick={() => { if (canOutput) window.print(); }}><Printer /> Print / PDF</button>
        </div>
      </div>

      <div className="bill-report-filters category-product-search-filters">
        <label><span>From date</span><ReportDateInput aria-label="From date" value={filters.startDate} onChange={value => setFilters(current => ({ ...current, startDate: value }))} /></label>
        <label><span>To date</span><ReportDateInput aria-label="To date" value={filters.endDate} onChange={value => setFilters(current => ({ ...current, endDate: value }))} /></label>
        <label className="bill-search-filter"><span>Product search</span><div><Search /><input value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters(); }} placeholder="Product code, name or category" /></div></label>
        <div className="bill-filter-buttons"><button type="button" className="apply" onClick={applyFilters}><Filter /> Apply</button><button type="button" onClick={resetFilters}><X /> Reset</button><button type="button" aria-label="Refresh report" onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Refresh</button></div>
      </div>

      {validationError && <p role="alert">{validationError}</p>}
      {exportFailure && <p role="alert">{exportFailure} <button type="button" onClick={exportExcel} disabled={!canOutput || exporting}>Retry export</button></p>}
      <div className="product-sales-sort">
        <label htmlFor="product-sales-sort">Sort products</label>
        <select id="product-sales-sort" value={sort} onChange={event => setSort(event.target.value)}>
          <option value="code">Product code</option>
          <option value="name">Product name A–Z</option>
          <option value="quantity">Quantity high–low</option>
          <option value="amount">Sales amount high–low</option>
        </select>
      </div>

      <div className="bill-summary-grid">
        <article><span><PackageSearch /></span><div><small>Products Sold</small><strong>{report?.summary.totalProducts ?? 0}</strong></div></article>
        <article><span><ReceiptText /></span><div><small>Bills</small><strong>{report?.summary.totalBills ?? 0}</strong></div></article>
        <article><span><Package /></span><div><small>Quantity Sold</small><strong>{quantity(report?.summary.totalQuantity)}</strong></div></article>
        <article><span><FileText /></span><div><small>Total Amount</small><strong>{money(report?.summary.totalAmount)}</strong></div></article>
      </div>

      <div className="bill-table-card">
        {loading && <div className="bill-report-state" data-inline-loading><RefreshCw className="bill-report-spinner" /><strong>Loading products…</strong></div>}
        {!loading && error && <div className="bill-report-state error"><strong>{error}</strong><button type="button" onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Retry</button></div>}
        {!loading && !error && report?.products.length === 0 && <div className="bill-report-state"><PackageSearch /><strong>No product sales found for these filters.</strong><p>Choose another date or clear some filters.</p><button type="button" onClick={resetFilters}><X /> Clear filters</button></div>}
        {!loading && !error && report && report.products.length > 0 && (
          <>
            <div className="bill-table-scroll">
              <table className="mobile-report-table">
                <thead><tr>
                  <th className="report-serial-number" scope="col">Sr. No.</th>
                  <th className="product-report-name" scope="col">Product</th>
                  <th className="product-report-category" scope="col">Category</th>
                  <th className="product-report-bills" scope="col">Bills</th>
                  <th className="product-report-quantity" scope="col">Quantity</th>
                  <th className="amount product-report-rate" scope="col">Avg Rate</th>
                  <th className="product-report-share" scope="col">Share</th>
                  <th className="amount product-report-amount" scope="col">Amount</th>
                </tr></thead>
                <tbody>{displayedProducts.map((product, index) => <tr key={product.productId}>
                  <td data-label="Sr. No." className="report-serial-number">{index + 1}</td>
                  <td data-label="Product" data-mobile-primary="true" className="product-report-name"><strong>{product.name}</strong></td>
                  <td data-label="Category">{product.category}</td>
                  <td data-label="Bills">{product.billCount}</td>
                  <td data-label="Quantity">{quantity(product.quantity)}</td>
                  <td data-label="Avg Rate" className="amount">{money(product.averageRate)}</td>
                  <td data-label="Share" className="product-report-share"><div className="category-share"><span><i style={{ width: `${Math.min(100, product.share)}%` }} /></span><small>{product.share.toFixed(1)}%</small></div></td>
                  <td data-label="Amount" className="amount"><strong>{money(product.amount)}</strong></td>
                </tr>)}</tbody>
                <tfoot><tr>
                  <td data-label="Sr. No." className="report-serial-number" />
                  <td data-mobile-primary="true"><strong>Total</strong></td>
                  <td data-label="Category" />
                  <td data-label="Bills">{report.summary.totalBills}</td>
                  <td data-label="Quantity">{quantity(report.summary.totalQuantity)}</td>
                  <td data-label="Avg Rate" />
                  <td data-label="Share" className="product-report-share">100%</td>
                  <td data-label="Amount" className="amount"><strong>{money(report.summary.totalAmount)}</strong></td>
                </tr></tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
};
