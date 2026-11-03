import { useScopedReportRead, useScopedReportExport } from '../utils/useScopedReportRead.ts';
import { useDataLoading } from '../utils/useDataLoading.ts';
import { downloadReportExcel, salesTaxRows, salesTaxSummary, type SalesTaxBreakdown } from '../utils/reportExcel.ts';
import { useReportSearch } from './useReportSearch.ts';
import { ReportDateInput } from './ReportDateInput.tsx';
import { reportDateError } from './reportDates.ts';
import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown, Download, FileText, Filter, Layers, Package, Printer,
  ReceiptText, RefreshCw, Search, X,
} from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './BillWiseReportPage.css';
import './CategoryWiseReportPage.css';

interface ProductTotals {
  taxRate?: string | number;
  taxAmount?: number;
  taxBreakdown?: SalesTaxBreakdown[];
  productId: string;
  name: string;
  quantity: number;
  amount: number;
}

interface CategoryRow {
  categoryNo?: number | null;
  taxRate?: string | number;
  taxAmount?: number;
  taxBreakdown?: SalesTaxBreakdown[];
  categoryId: string;
  name: string;
  billCount: number;
  productCount: number;
  quantity: number;
  amount: number;
  share: number;
  products: ProductTotals[];
}

interface CategoryReportResponse {
  categories: CategoryRow[];
  summary: { totalCategories: number; totalBills: number; totalQuantity: number; totalAmount: number; totalTax?: number };
}

interface CategoryFilters {
  startDate: string;
  endDate: string;
  shiftId: string;
  search: string;
}

interface CategoryWiseReportPageProps {
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

export const CategoryWiseReportPage = ({ outlet, token, onSessionExpired, reportName = 'Category Wise' }: CategoryWiseReportPageProps) => {
  const initialFilters = useMemo<CategoryFilters>(() => ({
    startDate: todayId(), endDate: todayId(), shiftId: '', search: '',
  }), []);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set());
  const [validationError, setValidationError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useReportSearch(filters.search, appliedFilters.search, setAppliedFilters);

  const scopeKey = JSON.stringify([outlet.id, token, appliedFilters, reloadKey]);
  const { data, loading, error } = useScopedReportRead<CategoryReportResponse>(scopeKey, token, onSessionExpired, async request => {
    const params = new URLSearchParams({ startDate: appliedFilters.startDate, endDate: appliedFilters.endDate });
    if (appliedFilters.shiftId) params.set('shiftId', appliedFilters.shiftId);
    if (appliedFilters.search) params.set('search', appliedFilters.search);
    return (await request<CategoryReportResponse>(`/api/outlets/${encodeURIComponent(outlet.id)}/reports/categories?${params}`))!;
  });
  const report = data ?? null;
  useDataLoading(loading, 'Category Sales Report');
  const { runExport, exporting, exportError } = useScopedReportExport(JSON.stringify([scopeKey, filters]));
  // The keyed read already hides old details; reset local selection for the next result.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { setExpandedCategories(new Set()); }, [scopeKey]);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(current => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

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
    setValidationError('');
    const reset = { ...initialFilters, startDate: todayId(), endDate: todayId() };
    setFilters(reset);
    setAppliedFilters(reset);
  };

  const canOutput = !loading && !error && (!!report?.categories.length);

  const exportExcel = async () => {
    if (!canOutput || !report) return;
    await runExport(async signal => {
      const taxSummary = salesTaxSummary(report.categories);
      const totalTax = report.summary.totalTax ?? Number(taxSummary['TOTAL TAX']);
      const rows: (string | number | Date)[][] = [
        ['Category No', 'Category Name', 'Tax Rate', 'Total Products', 'Items Sold', 'Sale', 'Tax Amount', 'Discount'],
        ...report.categories.flatMap(category => salesTaxRows(category).flatMap(group => [
          [category.categoryNo ?? 0, category.name, group.rate === null ? 0 : `${group.rate}%`,
            group.productCount ?? category.productCount, group.quantity, group.amount, group.taxAmount, 0],
          ...category.products.flatMap(product => salesTaxRows(product)
            .filter(productGroup => !category.taxBreakdown?.length || productGroup.rate === group.rate)
            .map(productGroup => ['', product.name, productGroup.rate === null ? 0 : `${productGroup.rate}%`, '',
              productGroup.quantity, productGroup.amount, productGroup.taxAmount, 0])),
        ])),
        ['Total', '', '', '', report.summary.totalQuantity, report.summary.totalAmount, totalTax, 0],
      ];
      await downloadReportExcel({
        signal,
        name: reportName, outlet, startDate: appliedFilters.startDate, endDate: appliedFilters.endDate,
        summary: { ...taxSummary, 'TOTAL SALE': report.summary.totalAmount, 'TOTAL TAX': totalTax }, rows,
      });
    });
  };

  return (
    <section className="bill-report-page category-report-page">
      <div className="bill-report-heading">
        <div><strong className="report-print-shop-name">{outlet.name}</strong><span>REPORTS</span><h1>Category Wise Report</h1><p>{outlet.name} · Billing totals grouped by product category.</p></div>
        <div className="bill-report-actions">
          <button type="button" onClick={exportExcel} disabled={!canOutput || exporting}><Download /> Export Excel</button>
          <button type="button" disabled={!canOutput} onClick={() => { if (canOutput) window.print(); }}><Printer /> Print / PDF</button>
        </div>
      </div>

      <div className="bill-report-filters category-product-search-filters">
        <label><span>From date</span><ReportDateInput aria-label="From date" value={filters.startDate} onChange={value => setFilters(current => ({ ...current, startDate: value }))} /></label>
        <label><span>To date</span><ReportDateInput aria-label="To date" value={filters.endDate} onChange={value => setFilters(current => ({ ...current, endDate: value }))} /></label>
        <label className="bill-search-filter"><span>Category search</span><div><Search /><input value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') applyFilters(); }} placeholder="Category name" /></div></label>
        <div className="bill-filter-buttons"><button type="button" className="apply" onClick={applyFilters}><Filter /> Apply</button><button type="button" onClick={resetFilters}><X /> Reset</button><button type="button" disabled={loading} onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Refresh</button></div>
      </div>

      {exportError && <div role="alert">Export failed: {exportError} Use Export Excel to try again.</div>}
      {validationError && <div role="alert">{validationError} Correct the dates or use Reset.</div>}

      <div className="bill-summary-grid">
        <article><span><Layers /></span><div><small>Categories</small><strong>{report?.summary.totalCategories ?? 0}</strong></div></article>
        <article><span><ReceiptText /></span><div><small>Bills</small><strong>{report?.summary.totalBills ?? 0}</strong></div></article>
        <article><span><Package /></span><div><small>Quantity Sold</small><strong>{quantity(report?.summary.totalQuantity)}</strong></div></article>
        <article><span><FileText /></span><div><small>Total Amount</small><strong>{money(report?.summary.totalAmount)}</strong></div></article>
      </div>

      <div className="bill-table-card">
        {loading && <div className="bill-report-state" data-inline-loading><RefreshCw className="bill-report-spinner" /><strong>Loading categories…</strong></div>}
        {!loading && error && <div className="bill-report-state error" role="alert"><strong>{error}</strong><button type="button" onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Retry</button></div>}
        {!loading && !error && report?.categories.length === 0 && <div className="bill-report-state"><Layers /><strong>No category sales found for these filters.</strong><p>Choose another date or clear some filters.</p></div>}
        {!loading && !error && report && report.categories.length > 0 && (
          <div className="bill-table-scroll">
            <table>
              <thead><tr><th>Category / Product</th><th>Bills</th><th>Products</th><th>Quantity</th><th>Share</th><th className="amount">Amount</th></tr></thead>
              {report.categories.map(category => (
                <tbody key={category.categoryId}>
                  <tr className="category-summary-row" onClick={() => toggleCategory(category.categoryId)}>
                    <td><button type="button" className="category-expand-button" aria-expanded={expandedCategories.has(category.categoryId)} onClick={event => { event.stopPropagation(); toggleCategory(category.categoryId); }}><ChevronDown aria-hidden="true" /><strong>{category.name}</strong></button><small>{category.productCount} products sold</small></td>
                    <td>{category.billCount}</td>
                    <td>{category.productCount}</td>
                    <td>{quantity(category.quantity)}</td>
                    <td><div className="category-share"><span><i style={{ width: `${Math.min(100, category.share)}%` }} /></span><small>{category.share.toFixed(1)}%</small></div></td>
                    <td className="amount"><strong>{money(category.amount)}</strong></td>
                  </tr>
                  {category.products.map(product => (
                    <tr key={product.productId} className={`category-product-row${expandedCategories.has(category.categoryId) ? '' : ' category-product-collapsed'}`}>
                      <td colSpan={3}><span className="category-product-name">{product.name}</span></td>
                      <td>{quantity(product.quantity)}</td>
                      <td />
                      <td className="amount">{money(product.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot><tr><td><strong>Total</strong></td><td>{report.summary.totalBills}</td><td /><td>{quantity(report.summary.totalQuantity)}</td><td>100%</td><td className="amount"><strong>{money(report.summary.totalAmount)}</strong></td></tr></tfoot>
            </table>
          </div>
        )}
      </div>

    </section>
  );
};
