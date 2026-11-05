import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { type ComponentType } from 'react';
import { BillWiseReportPage } from '../src/pages/BillWiseReportPage.tsx';
import { CategoryWiseReportPage } from '../src/pages/CategoryWiseReportPage.tsx';
import { ProductWiseReportPage } from '../src/pages/ProductWiseReportPage.tsx';
import { StockReportPage } from '../src/pages/StockReportPage.tsx';
import { GstReportPage } from '../src/pages/GstReportPage.tsx';
import { StockInOutReportPage } from '../src/pages/StockInOutReportPage.tsx';
import { StockTransferReportPage } from '../src/pages/StockTransferReportPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 220; i++) { if (check()) return; await pause(); } throw new Error(`${message}: ${document.body.textContent?.slice(-500)}`); }
const mobile = matchMedia('screen and (max-width:600px), screen and (max-width:1024px) and (max-height:500px)').matches;
const now = new Date();
const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const totals = { taxable: 100, cgst: 2.5, sgst: 2.5, igst: 0, gst: 5, gross: 105 };
const names = ['Plain Roti', ...Array.from({ length: 54 }, (_, index) => `Roti ${index}`), 'Roti'];
const items = [{ name: 'Food', productId: 'food', quantity: 1, price: 100, cost: 50, total: 100, remark: '', rate: 5, ...totals }];
const bills = names.map((billNo, index) => ({ documentId: `b${index}`, billNo, serialNo: '', vehicleNo: '', billType: 'Sale', dayId: day, createdDate: now.getTime(), finalTotal: 105,
  taxAmount: 5, discount: 0, serviceChargeAmount: 0, roundOff: 0, shiftId: '', deviceId: '', table: '', remark: '', customerDetails: '', employee: '', payments: { cash: 105 }, paymentModes: ['cash'], items, taxType: 'inclusive', rates: [5], ...totals }));
const transfers = names.map((transferNo, index) => ({ documentId: `t${index}`, transferNo, transactionNo: transferNo, dayId: day, createdDate: now.getTime(), type: 'TRANSFER', direction: 'in', supplier: '', remark: '', source: 'POS', state: 'COMPLETED', quantity: 1, total: 100, roundOff: 0, finalTotal: 100, items, references: [] }));
const requests: URL[] = [];
window.fetch = async (input, init) => {
  assert(!init?.method || init.method === 'GET', 'Reports use only mocked reads');
  const url = new URL(String(input), location.href); requests.push(url);
  let data: unknown;
  if (url.pathname.endsWith('/reports/bills')) {
    const page = Number(url.searchParams.get('page') || 1), pageSize = 50;
    data = { bills: bills.slice((page - 1) * pageSize, page * pageSize), summary: { totalBills: bills.length, totalAmount: 5880, cashTotal: 5880, digitalTotal: 0 }, pagination: { page, pageSize, totalPages: 2, totalItems: bills.length } };
  } else if (url.pathname.endsWith('/reports/categories')) data = { categories: names.map((name, index) => ({ categoryId: `c${index}`, categoryNo: index + 1, name, billCount: 1, productCount: 1, quantity: 1, amount: 100, share: 1, products: [] })), summary: { totalCategories: names.length, totalBills: 56, totalQuantity: 56, totalAmount: 5600 } };
  else if (url.pathname.endsWith('/reports/products')) data = { products: names.map((name, index) => ({ productId: `p${index}`, code: String(index + 1), name, category: 'Food', billCount: 1, quantity: 1, amount: 100, averageRate: 100, share: 1 })), summary: { totalProducts: names.length, totalBills: 56, totalQuantity: 56, totalAmount: 5600 } };
  else if (url.pathname.endsWith('/reports/stock')) data = { products: names.map((name, index) => ({ productId: `p${index}`, code: String(index + 1), name, category: 'Food', categoryId: 'c', currentStock: 1, reorderLevel: 0, tracked: true, status: 'In stock', price: 100, stockValue: 100 })), categories: [{ id: 'c', name: 'Food' }] };
  else if (url.pathname.endsWith('/reports/gst')) data = { bills, rates: [], summary: { ...totals, totalBills: 56, gstBills: 56 } };
  else if (url.pathname.endsWith('/reports/stock-movements')) data = { movements: transfers, summary: { totalTransactions: 56, stockInQuantity: 56, stockOutQuantity: 0, netQuantity: 56, totalAmount: 5600 } };
  else if (url.pathname.endsWith('/reports/stock-transfers')) data = { transfers, summary: { totalTransfers: 56, totalProducts: 56, totalQuantity: 56, totalAmount: 5600 } };
  else throw new Error(`Unexpected mock report request ${url.pathname}`);
  return Response.json({ success: true, data });
};
const root = createRoot(document.getElementById('root')!);
const outlet = { id: 'smart', name: 'Shop' } as OutletSummary;
let key = 0;
function first(selector: string) { return document.querySelector(selector)?.textContent?.trim(); }
const rows = () => [...document.querySelectorAll<HTMLTableRowElement>('.bill-table-scroll tbody tr')].filter(row => getComputedStyle(row).display !== 'none');
async function query(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[placeholder="Category name"],input[placeholder="Product code, name or category"],input[placeholder="Bill no."],input[placeholder="Bill no. or vehicle no."],input[placeholder="Transaction no., supplier or product"],input[placeholder="Transfer no., product or preview outlet / note"]')!;
  assert(!!input, 'Existing report search is available');
  flushSync(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await new Promise(resolve => setTimeout(resolve, 400));
  await until(() => rows().length, 'Search results');
}

void (async () => {
  const pages: [string, ComponentType<{ outlet: OutletSummary; token: string; onSessionExpired: () => void }>, string][] = [
    ['Categories', CategoryWiseReportPage, '.category-expand-button'],
    ['Products', ProductWiseReportPage, '[data-label="Product"] strong'],
    ['Stock', StockReportPage, '[data-label="Product"] strong'],
    ['GST', GstReportPage, '[data-label="Bill No."] strong'],
    ['Stock In/Out', StockInOutReportPage, '[data-label="Product Name"] strong'],
    ['Stock Transfers', StockTransferReportPage, '[data-label="Transfer No."] strong'],
    ['Bills', BillWiseReportPage, '[data-label="Bill No."] strong'],
  ];
  for (const [label, Page, selector] of pages) {
    flushSync(() => root.render(<Page key={++key} outlet={outlet} token="token" onSessionExpired={() => { throw new Error('Unexpected expiry'); }} />));
    await until(() => rows().length, `${label} initial data`);
    const originalSummary = document.querySelector('.bill-summary-grid')!.textContent;
    const before = requests.length;
    await query('Roti');
    const row = rows()[0]!;
    // The movement screen intentionally displays product names instead of transaction IDs.
    const result = label === 'Stock In/Out' ? row.getAttribute('aria-label')?.replace('View stock transaction ', '') : row.querySelector(selector)?.textContent?.trim();
    const billLimited = label === 'Bills';
    assert(result === (mobile ? billLimited ? 'Roti 0' : 'Roti' : 'Plain Roti'), `${label}: mobile relevance precedes client pagination, desktop preserves its order`);
    assert(requests.length === before + (label === 'Stock' ? 0 : 1), `${label}: debounce makes no additional ranking requests`);
    assert(document.querySelector('.bill-summary-grid')!.textContent === originalSummary, `${label}: ranking preserves report totals`);
    if (billLimited) {
      assert(!rows().some(row => row.textContent?.includes('Roti') && row.querySelector('[data-label="Bill No."] strong')?.textContent === 'Roti'), 'Server-paginated Bill Wise does not fetch hidden pages to rank');
      document.querySelector<HTMLButtonElement>('.bill-pagination button:last-child')!.click();
      await until(() => document.querySelector('.bill-pagination')?.textContent?.includes('Page 2'), 'Second server page');
      await until(() => rows().some(row => row.textContent?.includes('Roti')), 'Second page rows');
      assert(first('[data-label="Bill No."] strong') === (mobile ? 'Roti' : 'Roti 49'), 'Bill Wise ranks the loaded page only');
    }
    await query('');
    assert((label === 'Stock In/Out' ? rows()[0]!.getAttribute('aria-label')?.endsWith('Plain Roti') : first(selector) === 'Plain Roti'), `${label}: clearing restores its original ordering`);
  }
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, mobile, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
