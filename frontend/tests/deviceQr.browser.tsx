import { createRoot } from 'react-dom/client';
import { BrowserQRCodeReader } from '@zxing/browser';
import { DevicesPage } from '../src/pages/DevicesPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const checks: string[] = [];
function assert(ok: unknown, message: string) { if (!ok) throw new Error(message); checks.push(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 15));
async function until(check: () => unknown, message: string) {
  for (let i = 0; i < 200; i++) { if (check()) return; await pause(); }
  throw new Error('Timeout: ' + message);
}
const devices = [
  { documentId: 'alpha', deviceId: '3ac2ebae1622cae9', outletName: 'Shop', active: true },
  { documentId: 'beta', deviceId: 'Device-B/002?value=ABC', outletName: 'Shop', active: false },
  { documentId: 'spaced', deviceId: '  POS-Device 03  ', outletName: 'Shop', active: null },
  { documentId: 'unicode', deviceId: 'POS-设备-०४', outletName: 'Shop', active: true },
  { documentId: 'empty', deviceId: '', outletName: 'Shop', active: false },
  { documentId: 'blank', deviceId: '   ', outletName: 'Shop', active: false },
  { documentId: 'oversize', deviceId: 'x'.repeat(4000), outletName: 'Shop', active: null },
];
const before = JSON.stringify(devices);
const reads: string[] = [];
window.fetch = async (input, init) => {
  const path = String(input);
  assert(/^\/api\/outlets\/(shop|next)\/devices$/.test(path) && (!init?.method || init.method === 'GET'), 'Only the existing read-only devices API is used');
  reads.push(path);
  return Response.json({ data: { outletName: 'Shop', devices } });
};
let copied = '', rejectCopy = false;
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => {
  if (rejectCopy) throw new Error('Clipboard denied'); copied = text;
} } });
const root = createRoot(document.getElementById('root')!);
const expired = () => { throw new Error('Unexpected session expiration'); };
function render(id = 'shop') {
  root.render(<div className="retail-dashboard-shell"><main className="dashboard-workspace"><DevicesPage outlet={{ id, name: 'Shop' } as OutletSummary} token="mock" onSessionExpired={expired} /></main></div>);
}
const rows = () => [...document.querySelectorAll<HTMLTableRowElement>('.devices-table-scroll tbody tr')];
const modal = () => document.querySelector<HTMLDialogElement>('.device-qr-dialog');
const show = (index: number) => rows()[index].querySelector<HTMLButtonElement>('[aria-label^="Show QR"]')!;
const button = (text: string) => [...modal()!.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;
async function open(index: number) {
  show(index).focus(); show(index).click();
  await until(() => modal()?.open && modal()?.querySelector('.device-qr-code svg'), 'QR opens');
}
async function close() { button('Close').click(); await until(() => !modal(), 'modal closes'); }
async function decode() {
  const svg = modal()!.querySelector<SVGSVGElement>('.device-qr-code svg')!;
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 260;
    canvas.getContext('2d')!.drawImage(image, 0, 0, 260, 260);
    return new BrowserQRCodeReader().decodeFromCanvas(canvas).getText();
  } finally { URL.revokeObjectURL(url); }
}

void (async () => {
  document.documentElement.dataset.theme = 'light'; render();
  await until(() => rows().length === devices.length, 'devices load');
  assert(rows().every(row => row.querySelector('[aria-label^="Copy ID"]') && row.querySelector('[aria-label^="Show QR"]')), 'Every row retains Copy ID and adds Show QR inside the Device ID column');
  assert([...document.querySelectorAll('thead th')].map(cell => cell.textContent).join(',') === 'Outlet Name,Device ID,Status', 'The original table columns are unchanged');
  assert(show(4).disabled && show(5).disabled, 'Empty and whitespace-only IDs cannot open a QR');
  const initialReads = reads.length;
  let previous = '';
  for (let index = 0; index < 4; index++) {
    await open(index);
    assert(modal()!.matches(':modal') && modal()!.querySelector('h2')?.textContent === 'Device QR Code', `Row ${index + 1} opens a named native modal`);
    assert(modal()!.querySelector('.device-qr-id strong')?.textContent === devices[index].deviceId, `Row ${index + 1} displays the original ID unchanged`);
    assert(await decode() === devices[index].deviceId, `A QR reader decodes the exact raw ID for row ${index + 1}, preserving case, punctuation, whitespace and Unicode`);
    const svg = modal()!.querySelector('.device-qr-code svg')!;
    assert(svg.outerHTML !== previous, 'Different device IDs produce different QR images'); previous = svg.outerHTML;
    const bounds = svg.getBoundingClientRect();
    assert(Math.abs(bounds.width - bounds.height) < 1 && bounds.left >= 0 && bounds.right <= innerWidth && bounds.width >= 200, 'QR stays square, sharp and large enough within the viewport');
    const dialogBounds = modal()!.getBoundingClientRect();
    assert(dialogBounds.left >= 0 && dialogBounds.right <= innerWidth && dialogBounds.top >= 0 && dialogBounds.bottom <= innerHeight, 'Dialog fits the desktop or phone viewport');
    if (index === 0) {
      const rowCopy = rows()[0].querySelector<HTMLButtonElement>('[aria-label^="Copy ID"]')!;
      rowCopy.focus(); assert(modal()!.contains(document.activeElement), 'Native dialog contains keyboard focus');
      button('Copy ID').click(); await until(() => modal()?.querySelector('[role="status"]')?.textContent === 'ID copied.', 'modal copy');
      assert(copied === devices[0].deviceId, 'Modal Copy ID reuses the existing exact-ID clipboard action');
      rejectCopy = true; button('Copy ID').click(); await until(() => modal()?.querySelector('input[readonly]'), 'manual copy fallback');
      assert(modal()!.querySelector<HTMLInputElement>('input[readonly]')!.value === devices[0].deviceId && modal()!.textContent?.includes('Could not copy ID'), 'Copy failures retain manual-copy guidance inside the modal');
      rejectCopy = false;
      document.documentElement.dataset.theme = 'dark';
      assert(getComputedStyle(modal()!).backgroundColor === 'rgb(255, 255, 255)' && getComputedStyle(modal()!.querySelector('h2')!).color === 'rgb(23, 25, 28)', 'QR modal stays white with readable text in dark mode');
      assert(await decode() === devices[0].deviceId, 'QR remains readable in dark mode');
      document.documentElement.dataset.theme = 'light';
    }
    await close();
    assert(document.activeElement === show(index), 'Closing restores focus to the correct Show QR button');
  }
  const rowCopy = rows()[1].querySelector<HTMLButtonElement>('[aria-label^="Copy ID"]')!;
  rowCopy.click(); await until(() => copied === devices[1].deviceId && rows()[1].textContent?.includes('ID copied.'), 'original row copy');
  assert(rows()[1].textContent?.includes('ID copied.'), 'The existing row Copy ID success notification still works');
  await open(0); modal()!.dispatchEvent(new Event('cancel', { cancelable: true })); await until(() => !modal(), 'Escape dismissal');
  assert(rows().length === devices.length, 'Escape closes the QR without navigating away');
  await open(1); modal()!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 })); await until(() => !modal(), 'backdrop dismissal');
  assert(rows().length === devices.length, 'Backdrop dismissal returns to the same device list');
  show(6).click(); await until(() => modal()?.querySelector('[role="alert"]'), 'generation error');
  assert(!modal()!.querySelector('.device-qr-code svg') && modal()!.textContent?.includes('Unable to generate') && !button('Close').disabled, 'Generation failure shows a clear error without stale QR and always permits closing');
  await close(); await open(0);
  assert(await decode() === devices[0].deviceId, 'A later valid device works after a generation error');
  await close();
  show(0).click(); await until(() => modal()?.open, 'quick opening');
  button('Close').click(); show(1).click();
  await until(() => modal()?.querySelector('.device-qr-id strong')?.textContent === devices[1].deviceId && modal()?.querySelector('.device-qr-code svg'), 'replacement QR');
  assert(await decode() === devices[1].deviceId, 'Quickly reopening a different device cannot display a stale QR');
  assert(reads.length === initialReads && JSON.stringify(devices) === before && [...document.querySelectorAll<HTMLInputElement>('.device-status input')].every(box => box.disabled), 'Showing, copying and closing QR codes make no requests or changes to device data and status controls');
  render('next'); await until(() => !modal() && reads.length === initialReads + 1, 'outlet transition');
  assert(!modal(), 'Changing outlets removes the previous device QR immediately');
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
