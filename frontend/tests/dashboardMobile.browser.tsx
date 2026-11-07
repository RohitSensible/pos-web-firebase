import { createRoot } from 'react-dom/client';
import { BrowserQRCodeReader } from '@zxing/browser';
import App from '../src/App.tsx';
import '../src/index.css';

localStorage.clear();
const outlet = { id: 'shop', name: 'North Outlet — Central Market', branch: 'Branch 2 — City Centre' };
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'cashier', name: 'Cashier', email: 'cashier@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify(outlet));
const checks: string[] = [];
function assert(ok: unknown, message: string) { if (!ok) throw new Error(message); checks.push(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(); } throw new Error('Timeout: ' + message); }
let requests = 0;
let lastDay = '';
const shift = (id: string, shiftNo: number, totalSale: number, cashSale: number, digitalSale: number, openingAmt: number, expCash: number) => ({
  id, shiftNo, deviceId: id, userId: 'cashier', creatorName: 'Cashier', inActive: false, startTime: 1000 * shiftNo, endTime: 0,
  totalSale, cashSale, digitalSale, openingAmt, expCash, billCount: 3, payments: { cash: cashSale, googlepay: digitalSale },
  // Large historical amounts exercise narrow-screen wrapping without changing app data.
  discount: 12.5 * shiftNo, tax: 1234567.89 * shiftNo, refundAmount: 3.25 * shiftNo, extraCharges: 7.5 * shiftNo,
  expensesAmtTotal: expCash, advanceAmtTotal: 20 * shiftNo, customerReceiveAmtTotal: 123456789.01 * shiftNo,
});
window.fetch = async (input, init) => {
  assert(String(input).startsWith('/api/outlets/shop/dashboard?') && (!init?.method || init.method === 'GET'), 'Only the existing read-only dashboard API is requested');
  requests++;
  lastDay = new URL(String(input), location.origin).searchParams.get('dayId')!;
  return Response.json({ data: { ...shift('aggregate', 2, 900, 550, 350, 80, 30), dayId: lastDay,
    shifts: [shift('one', 1, 300, 200, 100, 50, 20), shift('two', 2, 600, 350, 250, 30, 10)].map(row => ({ ...row, dayId: lastDay })) } });
};
const root = createRoot(document.getElementById('root')!); root.render(<App />);
const info = () => document.querySelector<HTMLElement>('.dashboard-outlet-heading')!;
const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('.page-hero [role=tab]')];
const cards = () => [...document.querySelectorAll<HTMLElement>('.kpi-card')];
const card = (label: string) => cards().find(item => item.querySelector('.kpi-card-topline > span')?.textContent === label)!;
const value = (label: string) => card(label).querySelector('strong')?.textContent;
const money = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
const visualOrder = () => cards().sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(item => item.querySelector('.kpi-card-topline > span')?.textContent).join(',');
const fits = (element: Element) => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1; };
async function decodeQrImage(url: string) {
  const image = new Image(); image.src = url; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = image.naturalWidth;
  const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
  assert(image.naturalWidth === 1040 && image.naturalHeight === 1040 && context.getImageData(0, 0, 1, 1).data.every(value => value === 255), 'Exported QR is a square high-resolution image with a white quiet zone');
  return new BrowserQRCodeReader().decodeFromCanvas(canvas).getText();
}

void (async () => {
  await until(() => tabs().length === 3 && value('Total Sale') === money(900), 'dashboard ready');
  const phone = matchMedia('(max-width: 600px), (max-width: 1024px) and (max-height: 500px)').matches;
  const exportButton = document.querySelector<HTMLButtonElement>('[title="Export all shifts for the selected date"]')!;
  assert(cards().length === 3 && document.querySelectorAll('#dashboard-report-date').length === 1, 'Dashboard reuses three cards and one date control without duplication');
  assert(value('Cash In Hand') === money(600) && value('Total Digital Sale') === money(350), 'Existing cash-in-hand calculation and digital total are preserved');
  assert(cards().every(item => item.querySelector('.kpi-icon') && item.querySelector('.sparkline')), 'All summary icons and charts are preserved');
  assert(visualOrder() === (phone ? 'Total Sale,Cash In Hand,Total Digital Sale' : 'Cash In Hand,Total Sale,Total Digital Sale'), 'Summary card visual order changes only on phones');
  assert(document.querySelector('.payment-section')!.getBoundingClientRect().top >= Math.max(...cards().map(item => item.getBoundingClientRect().bottom)), 'Other Sales remains directly below the summary cards');
  assert([...document.querySelectorAll('.payment-copy > span')].map(item => item.textContent).join(',') === 'Cash,Google Pay,PhonePe,Paytm,Cheque,Card,Credit,Other', 'Other Sales retains every payment method');
  const payments = [...document.querySelectorAll<HTMLElement>('.payment-grid > .payment-tile')];
  const grid = document.querySelector<HTMLElement>('.payment-grid')!;
  const bounds = payments.map(payment => payment.getBoundingClientRect());
  assert(payments.length === 8 && payments.every(payment => payment.querySelector('.payment-brand') && payment.querySelector('.payment-copy strong')), 'All eight original payment cards retain their icons and live amounts');
  if (phone) {
    assert(Math.abs(bounds[0]!.width - grid.clientWidth) < 1 && Math.abs(bounds[7]!.width - grid.clientWidth) < 1, 'Cash and Other each span the full payment grid width on phones');
    for (const [left, right] of [[1, 2], [3, 4], [5, 6]]) {
      assert(Math.abs(bounds[left]!.top - bounds[right]!.top) < 1 && bounds[left]!.right < bounds[right]!.left && Math.abs(bounds[left]!.width - bounds[right]!.width) < 1 && Math.abs(bounds[left]!.height - bounds[right]!.height) < 1,
        `${payments[left]!.querySelector('.payment-copy > span')!.textContent} and ${payments[right]!.querySelector('.payment-copy > span')!.textContent} share an equal-width, equal-height phone row`);
    }
    assert(bounds[0]!.bottom < bounds[1]!.top && bounds[2]!.bottom < bounds[3]!.top && bounds[4]!.bottom < bounds[5]!.top && bounds[6]!.bottom < bounds[7]!.top, 'Payment rows follow Cash, three pairs, then Other without overlap');
    assert(payments.every(fits) && payments.every(payment => [...payment.querySelectorAll('.payment-brand, .payment-copy > span, .payment-copy > strong')].every(fits)), 'Payment icons, labels and amounts fit narrow phones without clipping or horizontal overflow');
    assert(!!payments[0]!.querySelector('.sparkline.compact') && getComputedStyle(payments[0]!).borderLeftColor === 'rgb(63, 102, 255)', 'Cash keeps its blue accent and existing sparkline');
  } else {
    assert(getComputedStyle(grid).gridTemplateColumns.split(' ').length === (innerWidth > 1080 ? 4 : 2) && bounds.every(box => Math.abs(box.width - bounds[0]!.width) < 1), 'Desktop/tablet retain their original payment column count and card widths');
  }
  const detailGrids = [...document.querySelectorAll<HTMLElement>('.bottom-panels .detail-grid')];
  const operational = [...detailGrids[0]!.querySelectorAll<HTMLElement>('.metric-row')];
  const expenses = [...detailGrids[1]!.querySelectorAll<HTMLElement>('.metric-row')];
  const metricLabel = (metric: Element) => metric.querySelector('.metric-label > span:last-child')!.textContent;
  const metricValue = (metric: Element) => metric.querySelector('strong')!.textContent;
  assert(operational.map(metricLabel).join(',') === 'No. of Bills,Total Discount,Opening Balance,Total Tax,Refund Amount,Extra Charge' && expenses.map(metricLabel).join(',') === 'Total Expenses,Advance Payment,Received Customer Credit', 'Operational and expense metrics retain their exact labels, order and counts');
  assert(operational.map(metricValue).join('|') === ['3', money(25), money(80), money(1234567.89 * 2), money(6.5), money(15)].join('|') && expenses.map(metricValue).join('|') === [money(30), money(40), money(123456789.01 * 2)].join('|'), 'All detail values retain existing number/currency formatting, including large amounts');
  assert(operational.every(metric => metric.querySelector('.metric-label svg, .percent-icon')), 'Operational metrics keep all original icons');
  if (phone) {
    const pair = (left: HTMLElement, right: HTMLElement) => {
      const a = left.getBoundingClientRect(), b = right.getBoundingClientRect();
      return Math.abs(a.top - b.top) < 1 && a.right < b.left && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
    };
    assert(pair(operational[0]!, operational[1]!) && pair(operational[2]!, operational[3]!), 'Operational Summary shows Bills/Discount then Opening Balance/Tax as equal phone tiles');
    assert(operational.slice(4).every(metric => Math.abs(metric.getBoundingClientRect().width - detailGrids[0]!.clientWidth) < 1 && getComputedStyle(metric).flexDirection === 'row') && operational[4]!.getBoundingClientRect().top > operational[3]!.getBoundingClientRect().bottom && operational[5]!.getBoundingClientRect().top > operational[4]!.getBoundingClientRect().bottom, 'Refund and Extra Charge are full-width horizontal rows below the main tiles');
    assert(operational.slice(4).every(metric => metric.querySelector('.metric-label')!.getBoundingClientRect().right < metric.querySelector('strong')!.getBoundingClientRect().left && getComputedStyle(metric.querySelector('strong')!).textAlign === 'right'), 'Refund and Extra Charge labels remain left of their right-aligned values');
    assert(pair(expenses[0]!, expenses[1]!) && Math.abs(expenses[2]!.getBoundingClientRect().width - detailGrids[1]!.clientWidth) < 1 && expenses[2]!.getBoundingClientRect().top > expenses[1]!.getBoundingClientRect().bottom, 'Expenses/Advance share a row and Received Customer Credit occupies the full-width tile below');
    assert([...operational, ...expenses].every(metric => fits(metric) && [...metric.querySelectorAll('.metric-label, strong')].every(fits)), 'Every metric label and large currency amount fits the phone without clipping or horizontal overflow');
    assert([...operational.slice(0, 4), ...expenses].every(metric => metric.querySelector('strong')!.getBoundingClientRect().top >= metric.querySelector('.metric-label')!.getBoundingClientRect().bottom), 'Tile values sit below labels without overlap');
  } else {
    assert(getComputedStyle(detailGrids[0]!).gridAutoFlow === 'column' && getComputedStyle(detailGrids[1]!).gridTemplateColumns.split(' ').length === 1 && [...operational, ...expenses].every(metric => getComputedStyle(metric).flexDirection === 'row'), 'Desktop/tablet keep their original metric rows and grid arrangement');
  }
  assert(getComputedStyle(exportButton).display === (phone ? 'none' : 'flex'), 'Export All Shifts is hidden only on phones');
  assert(info().querySelector('h1')?.textContent === outlet.name && info().querySelector('p strong')?.textContent === outlet.branch, 'Dashboard heading uses the actual outlet and bold branch name without a Branch label on every screen size');
  assert(info().querySelector('h1 > .lucide-store') && info().querySelector('.dashboard-subtitle > .lucide-trending-up') && info().querySelector('.dashboard-subtitle')?.textContent === 'Daily sales performance', 'Store and analytics icons accompany the existing outlet data and restored sales subtitle');
  const time = document.querySelector<HTMLElement>('.dashboard-date-picker > .dashboard-time')!;
  assert(time.querySelector('.lucide-clock') && !!time.textContent?.trim() && (phone ? getComputedStyle(time).display === 'none' : ['flex', 'inline-flex'].includes(getComputedStyle(time).display)), 'The clock icon follows the existing desktop and phone time visibility');
  assert(document.querySelectorAll('#dashboard-report-date .lucide-calendar-days').length === 1 && exportButton.querySelectorAll('.lucide-download').length === 1 && !exportButton.disabled, 'Date and export retain their original single icons and available controls');
  assert(!document.querySelector('.mobile-dashboard-info'), 'The duplicate mobile outlet strip is removed');
  if (phone) {
    assert(info().textContent?.includes(outlet.name) && info().textContent?.includes(outlet.branch), 'Mobile header uses the actual outlet and branch names');
    assert(!info().querySelector('time'), 'The removed mobile date/time strip is not reintroduced');
    assert(getComputedStyle(document.querySelector('.dashboard-date-picker > span')!).display === 'none' && getComputedStyle(info().querySelector('p')!).display !== 'none', 'Outlet information is visible while the existing phone control clock remains hidden');
    assert([...info().children].filter(child => getComputedStyle(child).display !== 'none').every(fits) && fits(info()) && document.documentElement.scrollWidth <= innerWidth, 'Long outlet and branch names fit narrow phones without horizontal overflow');
    assert(tabs().every(tab => fits(tab) && tab.getBoundingClientRect().height >= 44) && fits(document.querySelector('.dashboard-date-picker')!), 'Shift and date controls fit and remain touch friendly');
    assert(['.mobile-menu', '.header-logo-crop', '.theme-button', '.profile-menu-trigger'].every(selector => document.querySelector(selector)!.getBoundingClientRect().width > 0), 'Hamburger, original logo, theme toggle and profile remain visible');
  }
  const count = requests;
  tabs()[1]!.click(); await until(() => value('Total Sale') === money(300), 'individual shift');
  assert(value('Cash In Hand') === money(230) && value('Total Digital Sale') === money(100) && requests === count, 'Shift selection updates the original live values without extra requests');
  assert(document.querySelector('.payment-copy strong')!.textContent === money(200), 'Other Sales follows the selected shift');
  assert(operational[1]!.querySelector('strong')!.textContent === money(12.5) && expenses[0]!.querySelector('strong')!.textContent === money(20) && expenses[2]!.querySelector('strong')!.textContent === money(123456789.01), 'Operational and expense values follow the selected shift without extra reads');
  tabs()[0]!.click(); await until(() => value('Total Sale') === money(900), 'all shifts');
  const headerOutlet = info().textContent;
  document.querySelector<HTMLButtonElement>('#dashboard-report-date')!.click();
  await until(() => document.querySelector('[data-date]'), 'date calendar');
  const anotherDay = [...document.querySelectorAll<HTMLButtonElement>('[data-date]')].find(button => button.dataset.date !== lastDay && !button.disabled)!;
  anotherDay.click(); await until(() => lastDay === anotherDay.dataset.date && value('Total Sale') === money(900), 'selected date read');
  assert(requests === count + 1 && info().textContent === headerOutlet, 'Date selection reads the selected report day once while retaining the outlet heading');
  document.querySelector<HTMLButtonElement>('.theme-button')!.click(); await pause();
  assert(document.documentElement.dataset.theme === 'dark' && value('Total Sale') === money(900), 'Theme switching preserves current values and selection');
  if (phone) {
    document.querySelector<HTMLButtonElement>('.mobile-menu')!.click(); await pause();
    assert(document.querySelector('.dashboard-sidebar')!.classList.contains('open'), 'Mobile navigation still opens');
    document.querySelector<HTMLButtonElement>('.sidebar-close')!.click();
  }
  if (phone) {
    const beforeQr = requests;
    const trigger = document.querySelector<HTMLButtonElement>('.dashboard-mobile-device-qr button')!;
    assert(trigger?.textContent === 'View QR Code' && !document.querySelector('.dashboard-device-qr'), 'Phones show the compact Device QR action instead of the inline QR');
    trigger.click();
    const dialog = () => document.querySelector<HTMLDialogElement>('.dashboard-qr-dialog');
    const save = () => document.querySelector<HTMLButtonElement>('.dashboard-qr-dialog .modal-footer button:first-child')!;
    const share = () => document.querySelector<HTMLButtonElement>('.dashboard-qr-dialog .modal-footer button:last-child')!;
    await until(() => dialog()?.open && !save().disabled, 'mobile QR image ready');
    const bounds = dialog()!.getBoundingClientRect();
    assert(bounds.left === 0 && bounds.top === 0 && bounds.width === innerWidth && bounds.height === innerHeight, 'The QR dialog fills only the phone viewport');
    assert(dialog()!.querySelector('svg[role="img"]')?.getAttribute('aria-label') === 'QR code for device two' && !dialog()!.textContent?.includes('Device ID'), 'The popup displays only the existing selected-device QR without additional device identification');
    assert(fits(dialog()!) && dialog()!.scrollWidth === dialog()!.clientWidth && [...dialog()!.querySelectorAll('button, .dashboard-qr-image')].every(fits), 'Portrait and landscape QR content and actions fit without horizontal scrolling');
    assert([...dialog()!.querySelectorAll('button')].every(button => button.getBoundingClientRect().height >= 44), 'Close, Save QR and Share QR are touch friendly');
    let download = '';
    const captureDownload = (event: MouseEvent) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[download]');
      if (link) { event.preventDefault(); download = link.href; assert(link.download === 'device-qr.png', 'Save QR requests a PNG image download'); }
    };
    document.addEventListener('click', captureDownload, true);
    save().click(); await until(() => download, 'QR download');
    assert(await decodeQrImage(download) === 'two', 'The saved PNG decodes to the exact existing device payload');
    const canShareDescriptor = Object.getOwnPropertyDescriptor(navigator, 'canShare');
    const shareDescriptor = Object.getOwnPropertyDescriptor(navigator, 'share');
    let sharedFile: File | undefined;
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data: ShareData) => data.files?.[0]?.type === 'image/png' });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => { sharedFile = data.files?.[0]; } });
    share().click(); await until(() => sharedFile && !share().disabled, 'native image share');
    const shareUrl = URL.createObjectURL(sharedFile!);
    try { assert(await decodeQrImage(shareUrl) === 'two' && sharedFile!.name === 'device-qr.png', 'Native image sharing uses the same PNG and exact device payload'); }
    finally { URL.revokeObjectURL(shareUrl); }
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
    share().click();
    await until(() => dialog()!.textContent?.includes('Image sharing is unavailable'), 'unsupported image share fallback');
    assert(!save().disabled && dialog()!.querySelector<HTMLAnchorElement>('.dashboard-qr-image-link')?.href === download, 'Unsupported image sharing offers the same image for saving without breaking the QR');
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    share().click(); await pause();
    assert(!save().disabled && !share().disabled && dialog()!.open, 'Browsers without Web Share keep working Save and Close actions');
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('Cancelled', 'AbortError'); } });
    share().click(); await pause(); await until(() => !share().disabled, 'cancelled share');
    assert(!dialog()!.textContent?.includes('could not be shared'), 'Cancelling native sharing is handled without a failure warning');
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('Blocked', 'NotAllowedError'); } });
    share().click(); await until(() => dialog()!.textContent?.includes('could not be shared'), 'rejected share fallback');
    assert(!save().disabled && !share().disabled, 'Rejected native sharing preserves Save QR and allows retry');
    let finishShare: (() => void) | undefined;
    Object.defineProperty(navigator, 'share', { configurable: true, value: () => new Promise<void>(resolve => { finishShare = resolve; }) });
    share().click(); await until(() => finishShare && share().disabled, 'pending share');
    const close = dialog()!.querySelector<HTMLButtonElement>('.modal-close-btn')!;
    assert(!close.disabled, 'Closing remains available during an unfinished native share');
    close.click(); await until(() => !dialog() && document.activeElement === trigger, 'closed QR focus restored');
    finishShare!(); await pause();
    assert(document.body.style.overflow !== 'hidden' && !dialog() && requests === beforeQr, 'Closing restores scrolling; all QR actions are local with no extra API requests');
    if (canShareDescriptor) Object.defineProperty(navigator, 'canShare', canShareDescriptor); else Reflect.deleteProperty(navigator, 'canShare');
    if (shareDescriptor) Object.defineProperty(navigator, 'share', shareDescriptor); else Reflect.deleteProperty(navigator, 'share');
    document.removeEventListener('click', captureDownload, true);
    trigger.click(); await until(() => dialog()?.open && !save().disabled, 'reopen QR');
    dialog()!.dispatchEvent(new Event('cancel', { cancelable: true }));
    await until(() => !dialog(), 'Escape cancel closes QR');
    if (location.hash === '#qr') { trigger.click(); await until(() => dialog()?.open && !save().disabled, 'QR screenshot'); }
  } else {
    await until(() => document.querySelector('.dashboard-device-qr svg'), 'desktop inline QR');
    assert(!document.querySelector('.dashboard-mobile-device-qr, .dashboard-qr-dialog, .shift-card button'), 'Desktop and tablet retain the original inline QR with no mobile buttons or dialog');
  }
  if (location.hash === '#preview') {
    document.querySelector<HTMLButtonElement>('.theme-button')!.click(); await pause();
    window.scrollTo(0, 0);
  } else if (location.hash !== '#qr') root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
