import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StockReportPage } from '../src/pages/StockReportPage.tsx';
import { GoodsReceivedPage } from '../src/pages/GoodsReceivedPage.tsx';
import type { ReplenishmentDraft } from '../src/pages/stockPlanning.ts';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';
const passed: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${label}`); }
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
const input = (label: string) => [...document.querySelectorAll('label')].find(node => node.firstChild?.textContent?.trim() === label)?.querySelector<HTMLInputElement>('input, select')!;
async function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause();
}
const outlet = { id: 'outlet', name: 'Test Outlet' } as OutletSummary;
const supplier = { id: 'supplier', name: 'Main Supplier', mobile: '123', address: '', alternateNumber: null, email: '', gstin: '' };
const products = [{ productId: 'rice', code: '1', name: 'Rice', categoryId: 'food', category: 'Food', tracked: true, currentStock: 2, reorderLevel: 10, price: 20, costPrice: 15, stockValue: 40, status: 'Low stock' },
  { productId: 'tea', code: '2', name: 'Tea', categoryId: 'food', category: 'Food', tracked: true, currentStock: -1, reorderLevel: 5, price: 10, costPrice: 8, stockValue: -10, status: 'Out of stock' },
  { productId: 'hidden', code: '3', name: 'Untracked', category: '', categoryId: '', tracked: false, currentStock: 0, reorderLevel: 5, status: 'Not tracked' }];
let writes = 0, optionsReads = 0, prepared: ReplenishmentDraft | undefined;
let exported: Blob | undefined;
URL.createObjectURL = blob => { exported = blob as Blob; return 'blob:stock-plan'; };
URL.revokeObjectURL = () => {};
HTMLAnchorElement.prototype.click = () => {};
window.fetch = async (url, init) => {
  if (init?.method && init.method !== 'GET') { writes++; throw new Error('Planning must never write'); }
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Authorized reads');
  const path = String(url);
  if (path.endsWith('/reports/stock')) return Response.json({ success: true, data: { products, categories: [{ id: 'food', name: 'Food' }] } });
  if (path.endsWith('/products')) return Response.json({ success: true, data: products.map(product => ({ documentId: product.productId, fields: { name: product.name, code: product.code, category: product.categoryId, currentStock: product.currentStock, price: product.price, costPrice: product.costPrice, unitId: 0, stockable: product.tracked } })) });
  if (path.endsWith('/categories')) return Response.json({ success: true, data: [{ id: 'food', name: 'Food' }] });
  if (path.endsWith('/goods-received')) { optionsReads++; return Response.json({ success: true, data: { documentId: 'R'.repeat(20), suppliers: [supplier], receipts: [] } }); }
  throw new Error(`Unexpected URL ${path}`);
};
function Fixture() {
  const [draft, setDraft] = useState<ReplenishmentDraft | null>(null);
  return draft ? <GoodsReceivedPage outlet={outlet} token="token" initialDraft={draft} onSessionExpired={() => { throw new Error('Unexpected expiry'); }} onCancel={() => setDraft(null)} />
    : <StockReportPage outlet={outlet} token="token" onSessionExpired={() => { throw new Error('Unexpected expiry'); }} onPrepareReceipt={next => { prepared = next; setDraft(next); }} />;
}
const root = createRoot(document.getElementById('root')!);
root.render(<div className="retail-dashboard-shell"><main className="dashboard-workspace"><Fixture /></main></div>);
void (async () => {
  await until(() => button('Compare stock count'), 'stock report');
  assert(optionsReads === 0, 'Planning does not load suppliers or history until requested');
  button('Compare stock count').click(); await pause();
  await setValue(input('Physical count'), '0');
  assert(document.querySelector('.stock-planning-result')?.textContent === 'Difference: -2', 'Zero physical count exposes a shortage');
  await setValue(input('Physical count'), '2');
  assert(document.querySelector('.stock-planning-result')?.textContent === 'Count matches recorded stock', 'Equal physical stock matches');
  assert(![...input('Counted product').querySelectorAll('option')].some(option => option.textContent?.includes('Untracked')), 'Comparison excludes untracked products');
  passed.push('Physical count comparison accepts zero, highlights variance, and makes no stock writes');
  button('Plan replenishment (2)').click();
  await until(() => optionsReads === 1 && !document.body.textContent?.includes('Loading suppliers…'), 'supplier options');
  const riceQuantity = document.querySelector<HTMLInputElement>('[aria-label="Order quantity for Rice"]')!;
  const teaQuantity = document.querySelector<HTMLInputElement>('[aria-label="Order quantity for Tea"]')!;
  assert(riceQuantity.value === '8' && teaQuantity.value === '6', 'Suggestions fill to target, including negative stock');
  await setValue(riceQuantity, '0'); assert(button('Export replenishment plan').disabled, 'Invalid quantity blocks output');
  await setValue(riceQuantity, '8');
  await setValue(document.querySelector<HTMLSelectElement>('[aria-label="Supplier for Rice"]')!, supplier.id);
  assert([...document.querySelectorAll('.stock-planning-actions strong')].some(node => node.textContent?.includes('Main Supplier · 1 products')), 'Plans group selected products by supplier');
  document.querySelector<HTMLInputElement>('[aria-label="Replenish Tea"]')!.click(); await pause();
  button('Export replenishment plan').click();
  await until(() => exported && !button('Export replenishment plan').disabled, 'exported plan');
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await exported!.arrayBuffer());
  let checkedExport = false;
  workbook.worksheets[0]!.eachRow(row => { if (row.getCell(2).value === 'Rice') {
    assert(row.getCell(1).value === supplier.name && row.getCell(6).value === 8, 'Excel retains supplier grouping and planned quantity'); checkedExport = true;
  } });
  assert(checkedExport, 'Export includes selected product');
  passed.push('Replenishment Excel export contains the selected supplier group and numeric quantities');
  button('Prepare Goods Received draft').click();
  await until(() => document.querySelector('[aria-label="Received quantity for Rice"]'), 'receipt draft');
  document.querySelector<HTMLButtonElement>('.success-done')?.click(); await pause();
  assert(JSON.stringify(prepared) === JSON.stringify({ supplierId: supplier.id, items: [{ productId: 'rice', quantity: 8 }] }), 'Handoff retains only selected supplier group and quantities');
  assert(document.querySelector<HTMLInputElement>('[aria-label="Received quantity for Rice"]')!.value === '8', 'Goods Received pre-fills received quantity');
  assert(document.querySelector<HTMLInputElement>('[aria-label="Cost price for Rice"]')!.value === '15', 'Receipt draft loads current authorized prices');
  assert(document.querySelector<HTMLSelectElement>('.goods-supplier-select select')!.value === supplier.id, 'Receipt draft selects authorized supplier');
  assert(!document.querySelector<HTMLInputElement>('[aria-label="Include Tea"]')!.checked && writes === 0, 'Handoff never saves, orders or changes stock');
  passed.push('Replenishment validates quantities, groups suppliers, and opens a reviewable receipt draft without saving');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed }); });
