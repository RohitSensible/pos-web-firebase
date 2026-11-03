import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ShiftDetailsDialog } from '../src/pages/ShiftDetailsDialog.tsx';
import type { ShiftRecord } from '../src/pages/shiftReportTypes.ts';
import { runWorkspaceBack } from '../src/utils/useWorkspaceBack.ts';
import '../src/index.css';
import '../src/pages/BillWiseReportPage.css';
import '../src/pages/ShiftDetailsDialog.css';

const checks: string[] = [];
function assert(value: unknown, message: string) { if (!value) throw new Error(message); checks.push(message); }
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function until(test: () => boolean) { for (let i = 0; i < 100; i++) { if (test()) return; await tick(); } throw new Error('Fixture state timed out'); }
const base: ShiftRecord = {
  id: 'shift-A', dayId: '2026-11-03', shiftNo: 7, deviceId: `device-A-${'1234567890'.repeat(12)}`,
  userId: 'operator-42', creatorName: 'Anita Rao', inActive: false,
  startTime: Date.UTC(2026, 10, 3, 9), endTime: 0, lastBillTime: Date.UTC(2026, 10, 3, 10),
  startBillNo: '', lastBillNo: 'B-28', billCount: 28, billDeletesNumber: 2, billDeletesAmount: 17.12,
  openingAmt: 112.11, totalSale: 987.65, cashSale: 234.22, digitalSale: 345.33, creditSale: 456.44,
  subTotalBill: 876.54, discount: 12.34, tax: 23.45, gstTotal: 11.22, vatTotal: 12.23,
  refundAmount: 13.56, extraCharges: 14.67, serviceChargeAmount: 15.78, roundOff: -.09,
  expensesAmtTotal: 16.89, expCash: 34.56, expDigital: 45.67, advanceAmtTotal: 56.78,
  customerReceiveAmtTotal: 67.89, receiveAmtTotal: 78.91, swiggyTotal: 89.12, zomatoTotal: 91.23,
  payments: { upi: 123.45, card: 222.33 },
};
const shifts = [base,
  { ...base, id: 'shift-B', deviceId: 'device-B', userId: undefined, creatorName: undefined, inActive: true, startTime: NaN, endTime: 0, startBillNo: 'B-1', lastBillNo: '', lastBillTime: Infinity },
  { ...base, id: 'invalid-end', startTime: -1, endTime: Infinity },
  { ...base, id: 'out-of-range', startTime: 1e30, endTime: 1e30 },
  { ...base, id: 'valid-end', endTime: Date.UTC(2026, 10, 3, 11) },
];
function Fixture() {
  const [selected, setSelected] = useState<ShiftRecord | null>(null);
  return <><p>REPORT CONTENT MUST NEVER PRINT</p>{shifts.map((shift, i) => <button key={shift.id} id={`open-${i}`} onClick={() => setSelected(shift)}>Open {shift.deviceId}</button>)}
    {selected && <ShiftDetailsDialog key={selected.id} shift={selected} outletName="Test Outlet" onClose={() => setSelected(null)} />}</>;
}
window.fetch = async () => { throw new Error('No API calls allowed'); };
window.print = () => { throw new Error('Whole page printing forbidden'); };
const originalAppend = document.body.append;
let frames = 0, prints = 0, holdFonts = false, failPrint = false;
let releaseFonts = () => {};
let printedDocument: Document | null = null;
let printWindow: Window | null = null;
document.body.append = function (...nodes: (Node | string)[]) {
  originalAppend.apply(this, nodes);
  for (const node of nodes) {
    if (!(node instanceof HTMLIFrameElement)) continue;
    frames++;
    const doc = node.contentDocument!, child = node.contentWindow!;
    printedDocument = doc; printWindow = child;
    child.focus = () => {};
    child.print = () => { prints++; if (failPrint) throw new Error('Mock printer unavailable'); };
    child.requestAnimationFrame = callback => { queueMicrotask(() => callback(0)); return 1; };
    child.cancelAnimationFrame = () => {};
    Object.defineProperty(doc, 'fonts', { configurable: true, value: { ready: new Promise<void>(resolve => {
      releaseFonts = resolve; if (!holdFonts) resolve();
    }) } });
    const append = doc.head.append.bind(doc.head);
    doc.head.append = (...children: (Node | string)[]) => {
      for (const copy of children) {
        if (copy instanceof HTMLLinkElement) queueMicrotask(() => copy.dispatchEvent(new Event('load')));
        else append(copy);
      }
    };
  }
};
const root = createRoot(document.getElementById('root')!);
const modal = () => document.querySelector<HTMLDialogElement>('dialog')!;
const field = (label: string) => [...modal().querySelectorAll('.shift-details-meta > div')].find(el => el.querySelector('span')?.textContent === label)?.querySelector('strong')?.textContent;
const figure = (label: string) => [...modal().querySelectorAll('.shift-details-figures > div')].filter(el => el.querySelector('span')?.textContent === label).map(el => el.querySelector('strong')?.textContent);
async function open(index: number) {
  const opener = document.getElementById(`open-${index}`)!;
  opener.focus(); opener.click(); await until(() => !!document.querySelector('dialog[open]'));
  assert(document.activeElement?.getAttribute('aria-label') === 'Close shift details', 'Initial focus is Close');
}
async function close() {
  modal().querySelector<HTMLButtonElement>('[aria-label="Close shift details"]')!.click();
  await until(() => !document.querySelector('dialog'));
}
void (async () => {
  flushSync(() => root.render(<Fixture />));
  await open(0);
  assert(modal().matches(':modal') && modal().getAttribute('role') === 'dialog' && modal().getAttribute('aria-modal') === 'true', 'Native modal has correct semantics');
  assert(document.getElementById(modal().getAttribute('aria-labelledby')!)?.textContent === 'Shift 7 · 2026-11-03', 'Visible heading labels the dialog');
  document.getElementById('open-1')!.focus();
  assert(modal().contains(document.activeElement), 'Native modality contains focus');
  assert(modal().querySelector('[role="region"]')?.getAttribute('tabindex') === '0', 'Scroll region is keyboard focusable');
  assert(field('Device') === base.deviceId && field('Created by') === 'Anita Rao' && field('Creator ID') === 'operator-42', 'Exact device and actual creator are shown');
  assert(field('End time') === 'In progress' && field('Status') === 'Active', 'Active zero end remains in progress');
  assert(field('Bill range') === 'Not Available – B-28', 'Missing first bill has an individual placeholder');
  assert(field('Bill count') === '28' && field('Deleted bills')?.includes('17.12'), 'Bill counts and deletion figures are exact');
  assert(figure('Cash in hand')[0]?.includes('311.77') && figure('Total Sale')[0]?.includes('987.65'), 'Existing cash formula and supplied total sale remain unchanged');
  const amounts: [string, string][] = [['Opening amount','112.11'],['Cash sale','234.22'],['Digital sale','345.33'],['Credit sale','456.44'],['Cash expenses','34.56'],['Digital expenses','45.67'],['Total expenses','16.89'],['Advance received','56.78'],['Customer receipts','67.89'],['Total receipts','78.91'],['Sub total','876.54'],['Discount','12.34'],['Tax','23.45'],['GST','11.22'],['VAT','12.23'],['Service charge','15.78'],['Extra charges','14.67'],['Refunds','13.56'],['Round off','0.09'],['UPI','123.45'],['Card','222.33'],['Swiggy','89.12'],['Zomato','91.23']];
  assert(amounts.every(([label, value]) => figure(label).some(amount => amount?.includes(value))), 'Every payment, sales and drawer figure matches input');
  assert(modal().scrollWidth <= modal().clientWidth + 1 && modal().getBoundingClientRect().width <= innerWidth, 'Long device ID fits the viewport');
  const printButton = modal().querySelector<HTMLButtonElement>('footer button')!;
  holdFonts = true; printButton.click(); printButton.click(); await tick();
  assert(frames === 1 && printButton.disabled, 'Duplicate print clicks prepare one isolated document');
  releaseFonts(); await until(() => !printButton.disabled);
  assert(prints === 1 && printedDocument!.body.textContent?.includes(base.deviceId) && !printedDocument!.body.textContent?.includes('REPORT CONTENT MUST NEVER PRINT'), 'Only selected shift is printed');
  assert(!printedDocument!.querySelector('button, footer') && printedDocument!.title.includes(base.deviceId), 'Print excludes controls and identifies device');
  printWindow!.dispatchEvent(new Event('afterprint'));
  holdFonts = false; failPrint = true; printButton.click();
  await until(() => !!modal().querySelector('[role="alert"]'));
  assert(modal().querySelector('[role="alert"]')!.textContent?.includes('Please try again') && !printButton.disabled, 'Print failure is useful and permits retry');
  failPrint = false; await close();
  assert(document.activeElement?.id === 'open-0', 'Close restores opener focus');
  await open(1);
  assert(field('Device') === 'device-B' && field('Shift ID') === 'shift-B', 'Duplicate shift number retains selected device identity');
  assert(field('Created by') === 'Not Available' && field('Creator ID') === 'Not Available', 'Missing creator never falls back to current login');
  assert(field('Status') === 'Closed' && field('End time') === 'Not Available' && field('Start time') === 'Not Available' && field('Last bill time') === 'Not Available', 'Closed zero end and invalid times are safe');
  assert(field('Bill range') === 'B-1 – Not Available', 'Missing last bill has an individual placeholder');
  // Synthetic Escape has no browser default action; dispatch its native cancel event explicitly.
  modal().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  modal().dispatchEvent(new Event('cancel', { cancelable: true }));
  await until(() => !document.querySelector('dialog'));
  assert(document.activeElement?.id === 'open-1', 'Escape cancel path closes and restores focus');
  for (const index of [2, 3]) {
    await open(index);
    assert(field('Start time') === 'Not Available' && field('End time') === 'Not Available', 'Invalid numeric timestamps are safe');
    assert(runWorkspaceBack(), 'Workspace Back handles dialog');
    await until(() => !document.querySelector('dialog'));
  }
  await open(4);
  assert(field('Start time') !== 'Not Available' && field('End time') !== 'In progress' && field('End time') !== 'Not Available' && field('End time') !== field('Last bill time'), 'Valid explicit end remains visible and never uses last bill time');
  modal().querySelector('h2')!.click(); await tick();
  assert(!!document.querySelector('dialog'), 'Interior click leaves dialog open');
  modal().dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: -1, clientY: -1 }));
  await until(() => !document.querySelector('dialog'));
  assert(document.activeElement?.id === 'open-4', 'Backdrop closes and restores opener');
  await open(0); holdFonts = true;
  const before = prints;
  modal().querySelector<HTMLButtonElement>('footer button')!.click(); await close();
  releaseFonts(); await until(() => prints === before + 1);
  printWindow!.dispatchEvent(new Event('afterprint'));
  assert(!document.querySelector('dialog') && document.activeElement?.id === 'open-0', 'Closing during print preparation remains closed after late completion');
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); })
  .finally(() => { document.body.append = originalAppend; });
