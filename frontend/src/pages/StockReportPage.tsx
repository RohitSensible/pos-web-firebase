import { useMobileSearch, createSearchMatcher, rankSearchResults } from '../utils/useMobileSearch.ts';
import { useDataLoading } from '../utils/useDataLoading.ts';
import { downloadReportExcel } from '../utils/reportExcel.ts';
import { useReportSearch } from './useReportSearch.ts';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMasterSync } from '../utils/useMasterSync.ts';
import {
  AlertTriangle, Boxes, ChevronLeft, ChevronRight, Download, Filter, PackageSearch,
  PackageX, Printer, RefreshCw, Search, X,
} from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import { StockPlanning } from './StockPlanning.tsx';
import type { ReplenishmentDraft } from './stockPlanning.ts';
import './BillWiseReportPage.css';
import './ProductWiseReportPage.css';
import './StockReportPage.css';

type StockStatus = 'In stock' | 'Low stock' | 'Out of stock' | 'Not tracked';

interface StockRow {
  productId: string;
  code: string;
  name: string;
  categoryId: string;
  category: string;
  tracked: boolean;
  currentStock: number;
  reorderLevel: number;
  price: number;
  costPrice: number;
  stockValue: number;
  status: StockStatus;
}

interface StockReportResponse {
  products: StockRow[];
  categories: Array<{ id: string; name: string }>;
}

interface StockFilters {
  categoryId: string;
  status: string;
  search: string;
}

const PAGE_SIZE = 50;

const STATUS_CLASS: Record<StockStatus, string> = {
  'In stock': 'in-stock',
  'Low stock': 'low-stock',
  'Out of stock': 'out-of-stock',
  'Not tracked': 'not-tracked',
};

interface StockReportPageProps {
  outlet: OutletSummary;
  reportName?: string;
  token: string;
  onSessionExpired: () => void;
  onPrepareReceipt?: (draft: ReplenishmentDraft) => void;
}

function money(value = 0): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
}

function quantity(value = 0): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(value);
}

function todayId(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const StockReportPage = ({ outlet, token, onSessionExpired, reportName = 'Stock Report', onPrepareReceipt }: StockReportPageProps) => {
  const initialFilters = useMemo<StockFilters>(() => ({ categoryId: '', status: '', search: '' }), []);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const scope = useMemo(() => ({ outletId: outlet.id, token, reloadKey }), [outlet.id, token, reloadKey]);
  const activeScope = useRef(scope);
  const sessionExpired = useRef(onSessionExpired);
  useLayoutEffect(() => {
    activeScope.current = scope;
    sessionExpired.current = onSessionExpired;
  }, [scope, onSessionExpired]);
  const [read, setRead] = useState<{
    scope: typeof scope;
    status: 'success' | 'error';
    report?: StockReportResponse;
    error?: string;
  } | null>(null);
  // A prop change invalidates data during render, before effect cleanup can run.
  const currentRead = read?.scope === scope ? read : null;
  const report = currentRead?.status === 'success' ? currentRead.report : undefined;
  const loading = !currentRead;
  const error = currentRead?.status === 'error' ? currentRead.error : '';
  useDataLoading(loading, 'Stock Report');

  const mobileSearch = useMobileSearch();
  useReportSearch(filters.search, appliedFilters.search, setAppliedFilters, setPage);

  const readReport = useCallback(async (signal: AbortSignal) => {
    const isCurrent = () => !signal.aborted && activeScope.current === scope;
    const response = await fetch(`/api/outlets/${encodeURIComponent(scope.outletId)}/reports/stock`, {
      headers: { Authorization: `Bearer ${scope.token}` }, cache: 'no-store', signal,
    });
    signal.throwIfAborted();
    if (!isCurrent()) throw new Error('Stock report scope changed.');
    if (response.status === 401) {
      sessionExpired.current();
      throw new Error('Your session has expired.');
    }
    const result = await response.json() as { success: boolean; message?: string; data?: StockReportResponse };
    signal.throwIfAborted();
    if (!isCurrent()) throw new Error('Stock report scope changed.');
    if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load stock.');
    setRead({ scope, status: 'success', report: result.data });
  }, [scope]);
  useEffect(() => {
    const controller = new AbortController();
    void readReport(controller.signal).catch(requestError => {
      if (!controller.signal.aborted && activeScope.current === scope) setRead({ scope, status: 'error', error: requestError instanceof Error && requestError.message ? requestError.message : 'Unable to load stock.' });
    });
    return () => controller.abort();
  }, [scope, readReport]);
  // Keep the current report and planning drafts mounted during reconciliation.
  useMasterSync(outlet.id, token, 'products', !!report && !loading && !error, readReport);

  // Filtering is done in the browser because the full product list is already loaded.
  const rows = useMemo(() => {
    const search = appliedFilters.search.trim().toLowerCase();
    const matches = createSearchMatcher(appliedFilters.search);
    const filtered = (report?.products ?? []).filter(product =>
      (!appliedFilters.categoryId || product.categoryId === appliedFilters.categoryId)
      && (!appliedFilters.status || product.status === appliedFilters.status)
      && (mobileSearch ? matches({ primary: [product.name], text: [product.name, product.category], identifiers: [product.code] }) : !search
        || product.name.toLowerCase().includes(search)
        || product.code.toLowerCase().includes(search)
        || product.category.toLowerCase().includes(search)));
    const sorted = filtered.sort((left, right) => {
      if (!left.code || !right.code) return left.code ? -1 : right.code ? 1 : 0;
      return left.code.localeCompare(right.code, undefined, { numeric: true });
    });
    return sorted;
  }, [report, appliedFilters, mobileSearch]);

  const displayedProducts = useMemo(() => mobileSearch ? rankSearchResults(rows, appliedFilters.search, product => ({ primary: [product.name], text: [product.name, product.category], identifiers: [product.code] })) : rows, [rows, appliedFilters.search, mobileSearch]);

  const summary = useMemo(() => rows.reduce((totals, product) => {
    if (product.tracked) {
      totals.tracked += 1;
      totals.totalStock += product.currentStock;
      totals.stockValue += product.stockValue;
    }
    if (product.status === 'Low stock') totals.low += 1;
    if (product.status === 'Out of stock') totals.out += 1;
    return totals;
  }, { tracked: 0, totalStock: 0, stockValue: 0, low: 0, out: 0 }), [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  // Normalize the stored page too, so a later refresh cannot revive an old page.
  if (page !== currentPage) setPage(currentPage);
  const canOutput = !loading && !error && !!report && rows.length > 0;

  const applyFilters = () => {
    setPage(1);
    setAppliedFilters({ ...filters, search: filters.search.trim() });
  };

  const resetFilters = () => {
    setFilters(initialFilters);
    setPage(1);
    setAppliedFilters(initialFilters);
  };

  const exportExcel = async () => {
    if (!canOutput) return;
    const csvRows: (string | number | Date)[][] = [
      ['Product', 'Category', 'Stock Tracked', 'Current Stock', 'Reorder Level', 'Status', 'Price', 'Stock Value'],
      ...rows.map(product => [
        product.name, product.category, product.tracked ? 'Yes' : 'No', product.currentStock,
        product.reorderLevel, product.status, product.price, product.stockValue,
      ]),
      ['Total', '', summary.tracked, summary.totalStock, '', '', '', summary.stockValue],
    ];
    await downloadReportExcel({
      name: reportName, outlet, startDate: todayId(), endDate: todayId(),
      summary: {}, rows: csvRows,
    });
  };

  return (
    <section className="bill-report-page product-report-page stock-report-page">
      <div className="bill-report-heading">
        <div><strong className="report-print-shop-name">{outlet.name}</strong><span>REPORTS</span><h1>Stock Report</h1><p>{outlet.name} · Current stock count for stockable products.</p></div>
        <div className="bill-report-actions">
          <button type="button" onClick={() => setReloadKey(value => value + 1)} disabled={loading}><RefreshCw /> Refresh</button>
          <button type="button" onClick={exportExcel} disabled={!canOutput}><Download /> Export Excel</button>
          <button type="button" disabled={!canOutput} onClick={() => { if (canOutput) window.print(); }}><Printer /> Print / PDF</button>
        </div>
      </div>

      <div className="bill-report-filters">
        <label><span>Category</span><select value={filters.categoryId} onChange={event => setFilters(current => ({ ...current, categoryId: event.target.value }))}><option value="">All categories</option>{report?.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label><span>Stock status</span><select value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))}><option value="">All statuses</option><option value="In stock">In stock</option><option value="Low stock">Low stock</option><option value="Out of stock">Out of stock</option></select></label>
        <label className="bill-search-filter"><span>Product search</span><div><Search /><input value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters(); }} placeholder="Product code, name or category" /></div></label>
        <div className="bill-filter-buttons"><button type="button" className="apply" onClick={applyFilters}><Filter /> Apply</button><button type="button" onClick={resetFilters}><X /> Reset</button></div>
      </div>

      <div className="bill-summary-grid">
        <article><span><PackageSearch /></span><div><small>Stockable Products</small><strong>{rows.length}</strong></div></article>
        <article><span><Boxes /></span><div><small>Total Stock Qty</small><strong>{quantity(summary.totalStock)}</strong></div></article>
        <article><span><AlertTriangle /></span><div><small>Low Stock</small><strong>{summary.low}</strong></div></article>
        <article><span><PackageX /></span><div><small>Out of Stock</small><strong>{summary.out}</strong></div></article>
      </div>

      {report && !loading && !error && <StockPlanning key={`${outlet.id}:${token}:${reloadKey}`} products={report.products} outlet={outlet} token={token} onSessionExpired={onSessionExpired} onPrepareReceipt={onPrepareReceipt} />}
      <div className="bill-table-card" aria-busy={loading}>
        {loading && <div className="bill-report-state" data-inline-loading><RefreshCw className="bill-report-spinner" /><strong>Loading stock…</strong></div>}
        {!loading && error && <div className="bill-report-state error" role="alert"><strong>{error}</strong><button type="button" onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Retry</button></div>}
        {!loading && !error && report && rows.length === 0 && <div className="bill-report-state"><PackageSearch /><strong>No products found.</strong><p>{report.products.length ? 'Clear some filters to see more products.' : 'This outlet has no stockable products.'}</p>{report.products.length > 0 && <button type="button" onClick={resetFilters}>Clear filters</button>}</div>}
        {!loading && !error && report && rows.length > 0 && (
          <>
            <div className="bill-table-scroll"><table className="mobile-report-table"><thead><tr><th>Product</th><th>Category</th><th className="amount">Stock Count</th><th className="amount">Reorder Level</th><th>Status</th><th className="amount">Price</th><th className="amount">Stock Value</th></tr></thead><tbody>{displayedProducts.map((product, index) => <tr key={product.productId} className={index < (currentPage - 1) * PAGE_SIZE || index >= currentPage * PAGE_SIZE ? 'stock-print-only-row' : undefined}><td data-label="Product" data-mobile-primary="true"><strong>{product.name}</strong></td><td data-label="Category">{product.category}</td><td data-label="Stock Count" className="amount"><strong className={product.tracked ? (product.currentStock <= 0 ? 'stock-count negative' : 'stock-count') : 'stock-count muted'}>{quantity(product.currentStock)}</strong></td><td data-label="Reorder Level" className="amount">{product.reorderLevel ? quantity(product.reorderLevel) : '—'}</td><td data-label="Status"><span className={`stock-status ${STATUS_CLASS[product.status]}`}>{product.status}</span></td><td data-label="Price" className="amount">{money(product.price)}</td><td data-label="Stock Value" className="amount">{product.tracked ? money(product.stockValue) : '—'}</td></tr>)}</tbody><tfoot><tr><td data-mobile-primary="true"><strong>Total</strong></td><td data-label="Category">{rows.length} products</td><td data-label="Stock Count" className="amount">{quantity(summary.totalStock)}</td><td data-label="Reorder Level" /><td data-label="Status" /><td data-label="Price" /><td data-label="Stock Value" className="amount"><strong>{money(summary.stockValue)}</strong></td></tr></tfoot></table></div>
            <div className="bill-pagination"><span>Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, rows.length)} of {rows.length}</span><div><button type="button" aria-label="Previous stock report page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></button><strong aria-live="polite">Page {currentPage} of {totalPages}</strong><button type="button" aria-label="Next stock report page" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}><ChevronRight /></button></div></div>
          </>
        )}
      </div>
    </section>
  );
};
