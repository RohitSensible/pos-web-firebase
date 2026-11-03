import { createRoot } from 'react-dom/client';
import { StockInOutReportPage } from '../src/pages/StockInOutReportPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';
const results: string[] = [];
const requests: URLSearchParams[] = [];
const movement = (n: number, direction: 'in' | 'out', name: string, qty: number) => ({ documentId: `d${n}`, transactionNo: `stock-${n}`, dayId: '2026-10-24',
  createdDate: Date.UTC(2026, 9, 24, 7, 19 + n), type: direction === 'in' ? 'STOCK-IN' : 'STOCK-OUT', direction, supplier: '', remark: '', source: '', state: '',
  quantity: qty, total: qty * 2, roundOff: 0, finalTotal: qty * 2, items: [{ productId: `p${n}`, name, quantity: qty, price: 2, cost: 0, total: qty * 2, remark: '' }] });
const all = [movement(1, 'out', 'PAPAD ROASTED', 10), movement(2, 'in', 'MASALA PAPAD', 50), movement(3, 'in', 'PAPAD ROASTED', 100)];
window.fetch = async url => {
  const params = new URL(String(url), location.href).searchParams; requests.push(params);
  const movements = all.filter(entry => entry.direction === params.get('direction'));
  const sum = (direction: string) => movements.filter(entry => entry.direction === direction).reduce((total, entry) => total + entry.quantity, 0);
  return Response.json({ success: true, data: { movements, summary: { totalTransactions: movements.length, stockInQuantity: sum('in'), stockOutQuantity: sum('out'),
    netQuantity: sum('in') - sum('out'), totalAmount: movements.reduce((total, entry) => total + entry.finalTotal, 0) } } });
};
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function waitFor(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${message}`); }
const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(node => node.textContent === label)!;
const names = () => [...document.querySelectorAll('tbody tr td:first-child')].map(cell => cell.textContent).join(',');
const headings = () => [...document.querySelectorAll('.bill-table-scroll thead th')].map(cell => cell.textContent).join('|');
const cards = () => [...document.querySelectorAll('.stock-summary-grid small')].map(cell => cell.textContent).join('|');
// Simulate the obsolete stylesheet still loaded by an existing browser tab.
const legacy = document.createElement('style');
legacy.textContent = `.stock-direction-tabs { border-top: 3px solid #b5001f; }
.stock-direction-tab.in svg { color: #16a34a; }
.stock-direction-tab.out svg { color: #b5001f; }
.stock-direction-tab.in[aria-selected=true] { color:#3567f0; border-bottom-color:#16a34a; background:#f2fbf5; }
.stock-direction-tab.out[aria-selected=true] { color:#b5001f; border-bottom-color:#b5001f; background:#fdf2f4; }`;
document.head.append(legacy);
function assertNeutralTabs() {
  const reference = document.createElement('span'); document.body.append(reference);
  for (const theme of ['light', 'dark']) {
    document.documentElement.dataset.theme = theme;
    const selected = document.querySelector<HTMLElement>('.stock-direction-tab[aria-selected=true]')!;
    reference.style.color = 'var(--ink)'; reference.style.borderColor = 'var(--line)';
    const bar = getComputedStyle(document.querySelector('.stock-direction-tabs')!);
    assert(bar.borderTopWidth === '1px' && bar.borderTopColor === getComputedStyle(reference).borderTopColor, `${theme}: tab container has the themed box border, without a red top stripe`);
    assert(getComputedStyle(selected).color === getComputedStyle(reference).color, `${theme}: selected tab uses the existing theme text color`);
    for (const label of ['STOCK-IN', 'STOCK-OUT']) {
      assert(getComputedStyle(tab(label).querySelector('svg')!).color === getComputedStyle(tab(label)).color, `${theme}: ${label} icon has no independent red/green color`);
    }
    reference.style.color = 'var(--muted)'; reference.style.backgroundColor = 'var(--workspace)';
    assert(getComputedStyle(selected).borderBottomColor === getComputedStyle(reference).color && getComputedStyle(selected).backgroundColor === getComputedStyle(reference).backgroundColor, `${theme}: selected box uses neutral theme colors despite the old stylesheet`);
  }
  reference.remove(); document.documentElement.dataset.theme = 'light';
}
const root = createRoot(document.getElementById('root')!);
root.render(<StockInOutReportPage outlet={{ id: 'outlet', name: 'OTP' } as OutletSummary} token="mock-token" onSessionExpired={() => {}} />);
void (async () => {
  await waitFor(() => names(), 'stock-in rows');
  assert(tab('STOCK-IN').getAttribute('aria-selected') === 'true' && tab('STOCK-OUT').getAttribute('aria-selected') === 'false', 'Stock-In tab selected by default');
  assertNeutralTabs();
  assert(requests[0]!.get('direction') === 'in', 'default request loads stock-in only');
  assert(names() === 'MASALA PAPAD,PAPAD ROASTED', `stock-in rows ${names()}`);
  assert(headings() === 'Product Name|Type|Quantity|Price|Supplier|Date / Time', `columns ${headings()}`);
  assert(cards() === 'Stock-In Transactions|Stock In Quantity|Total Amount', `cards ${cards()}`);
  assert(document.querySelector('tfoot')!.textContent!.includes('Total Stock-In') && document.querySelector('tfoot')!.textContent!.includes('150'), 'stock-in total');
  assert(!document.body.textContent!.includes('stock-2') && !document.querySelector('select'), 'no transaction numbers or direction dropdown');
  document.querySelector<HTMLTableRowElement>('.bill-table-scroll tbody tr')!.click();
  await waitFor(() => document.querySelector('.bill-detail-modal'), 'stock details');
  const details = document.querySelector('.bill-detail-modal')!;
  assert(!details.textContent!.includes('₹') && details.textContent!.includes('100.00') && details.textContent!.includes('0.00'), 'stock detail amounts have decimal places without rupee symbols');
  document.querySelector<HTMLButtonElement>('[aria-label="Close transaction details"]')!.click(); await pause();
  results.push('Stock detail amounts show numbers without rupee symbols');
  results.push('Stock-In tab is the default and shows only stock-in rows, cards and totals');

  tab('STOCK-OUT').click();
  await waitFor(() => names() === 'PAPAD ROASTED', 'stock-out rows');
  assert(requests.at(-1)!.get('direction') === 'out' && tab('STOCK-OUT').getAttribute('aria-selected') === 'true', 'Stock-Out tab loads stock-out only');
  assertNeutralTabs();
  assert(cards() === 'Stock-Out Transactions|Stock Out Quantity|Total Amount' && document.querySelector('tfoot')!.textContent!.includes('Total Stock-Out'), 'stock-out cards and total');
  const before = requests.length; tab('STOCK-OUT').click(); await pause();
  assert(requests.length === before, 'clicking the active tab does not reload');
  results.push('Stock-Out tab shows only stock-out rows with its own cards and totals');
  results.push('Both directions retain neutral boxed colors in light and dark mode even with legacy red/green CSS loaded');
  if (!location.hash.includes('preview')) root.unmount();
  document.getElementById('test-results')!.style.display = 'none';
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: results });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: results }); });
