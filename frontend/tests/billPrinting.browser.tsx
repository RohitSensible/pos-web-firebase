import { createRoot } from 'react-dom/client';
import { BillWiseReportPage } from '../src/pages/BillWiseReportPage.tsx';
import { PrintPageSettings } from '../src/components/PrintPageSettings.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';

const checks: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(); } throw new Error(message); }
const outletName = 'Outlet "Central" \\ Main';
const bill = (billNo: string, name: string) => ({ documentId: billNo, billNo, serialNo: '11', billType: 'INVOICE', dayId: '2026-11-01', createdDate: 1793491200000,
  finalTotal: 120.50, taxAmount: 20, discount: 0, serviceChargeAmount: 0, roundOff: .50, shiftId: 'shift', deviceId: '', table: '', vehicleNo: '', remark: '',
  customerDetails: { name: 'Customer One' }, employee: { name: 'Employee One' }, payments: { cash: 120.50 }, paymentModes: ['cash'],
  items: Array.from({ length: 90 }, (_, i) => ({ name: `${name} ${i + 1}`, quantity: 1, price: 1, total: 1, taxPercentage: 0, remark: '' })) });
window.fetch = async () => Response.json({ data: { bills: [bill('BILL-ONE', 'Selected Product'), bill('BILL-TWO', 'Other Product')],
  summary: { totalBills: 2, totalAmount: 241, cashTotal: 241, digitalTotal: 0 }, pagination: { page: 1, pageSize: 50, totalItems: 2, totalPages: 1 } } });
let reportPrints = 0;
window.print = () => { reportPrints++; };
let receipt: HTMLIFrameElement | undefined;
let printCalls = 0;
const observer = new MutationObserver(() => {
  const frame = document.querySelector<HTMLIFrameElement>('iframe');
  if (!frame || receipt === frame) return;
  receipt = frame;
  frame.contentWindow!.print = () => { printCalls++; };
});
observer.observe(document.body, { childList: true });
createRoot(document.getElementById('root')!).render(<><PrintPageSettings outletName={outletName} /><BillWiseReportPage outlet={{ id: 'shop', name: outletName } as OutletSummary} token="test" onSessionExpired={() => {}} /></>);
void (async () => {
  await until(() => document.querySelector('.bill-table-scroll tbody tr'), 'Report did not load');
  document.querySelector<HTMLButtonElement>('.bill-report-actions button:last-child')!.click();
  assert(reportPrints === 1, 'Report Print / PDF still prints the full report');
  const billRow = document.querySelector<HTMLTableRowElement>('.bill-table-scroll tbody tr')!;
  assert(billRow.querySelector('[data-label="Bill No."]')!.textContent === 'BILL-ONE', 'Bill number cell contains only the actual bill number, without the secondary serial number');
  assert(billRow.querySelector('.report-serial-number')!.textContent === '1', 'Row serial numbering remains separate from the bill number');
  billRow.click();
  await until(() => document.querySelector('.bill-detail-modal'), 'Bill details did not open');
  const drawer = document.querySelector<HTMLDialogElement>('dialog.bill-detail-backdrop')!;
  assert(drawer.open && drawer.matches(':modal'), 'Bill drawer uses native modal focus containment');
  assert(document.activeElement?.getAttribute('aria-label') === 'Close bill details', 'Opening bill details focuses its close action');
  document.querySelector<HTMLButtonElement>('.bill-report-actions button')!.focus();
  assert(drawer.contains(document.activeElement), 'Background report controls cannot steal focus while the drawer is open');
  document.querySelector<HTMLButtonElement>('.bill-detail-modal footer button')!.click();
  await until(() => printCalls === 1, 'Selected bill print was not requested');
  const doc = receipt!.contentDocument!;
  const content = doc.body.textContent!;
  assert(doc.title === `${outletName} - Bill BILL-ONE`, 'PDF title identifies the selected outlet and bill');
  assert(content.includes(outletName) && content.includes('BILL-ONE') && !content.includes('BILL-TWO'), 'Receipt contains only the selected bill and current outlet');
  assert(content.includes('Selected Product 90') && !content.includes('Other Product'), 'Every selected bill item is included, including content beyond the scrolling panel');
  assert([...doc.querySelectorAll('.bill-items-table tbody .report-serial-number')].every((cell, index) => cell.textContent === String(index + 1)) && doc.querySelectorAll('.bill-items-table tbody .report-serial-number').length === 90, 'Every receipt item has its sequential PDF serial number, including later pages');
  assert(content.includes('Customer One') && content.includes('Employee One') && content.includes('Cash') && content.includes('Round off') && content.includes('120.50'), 'Receipt keeps bill metadata, payments and totals');
  assert(!doc.querySelector('button, footer, .bill-report-page, .bill-report-filters'), 'Receipt excludes report data and interactive controls');
  assert(!!doc.querySelector('[data-print-page-settings]'), 'Individual bill uses the same outlet footer as reports');
  assert(reportPrints === 1, 'Printing a bill does not print the report behind it');
  (window as unknown as { printedBillHtml: string }).printedBillHtml = doc.documentElement.outerHTML;
  receipt!.contentWindow!.dispatchEvent(new Event('afterprint'));
  await pause();
  assert(!document.querySelector('iframe') && !!document.querySelector('.bill-detail-modal'), 'Closing print cleans up its document and preserves bill details');
  drawer.dispatchEvent(new Event('cancel', { cancelable: true }));
  await until(() => !document.querySelector('.bill-detail-modal'), 'Escape did not close bill details');
  assert(document.activeElement === billRow, 'Closing bill details restores focus to its originating bill row');
  billRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await until(() => document.querySelector('dialog.bill-detail-backdrop[open]'), 'Keyboard reopen failed');
  document.querySelector<HTMLButtonElement>('[aria-label="Close bill details"]')!.click();
  await until(() => !document.querySelector('.bill-detail-modal'), 'Close action failed');
  assert(document.activeElement === billRow, 'Keyboard opening and close action preserve focus restoration');
  observer.disconnect();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
