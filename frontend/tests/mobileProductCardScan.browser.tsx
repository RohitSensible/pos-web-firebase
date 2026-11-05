import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 250; i++) { if (check()) return; await pause(); } throw new Error('Timeout: ' + label); }
const products = ['First product', 'Second product'].map((name, index) => ({ documentId: `p${index + 1}`, fields: {
  name, code: String(index + 1), price: 50, barcode: `OLD-${index + 1}`, category: 'c', taxIndex: 1, unitId: 2,
  regionalName: '', stockable: true, mrpPrice: 0, costPrice: 0, discount: 0, weighable: false,
} }));
const original = JSON.stringify(products);
const patches: { id: string; payload: Record<string, unknown> }[] = [];
let releaseOptions: (() => void) | undefined;
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.endsWith('/master-sync')) return new Response('', { status: 404 });
  if (path.endsWith('/categories')) return Response.json({ success: true, data: [{ id: 'c', name: 'Category' }] });
  if (path.endsWith('/products') && (!init?.method || init.method === 'GET')) return Response.json({ success: true, data: products });
  if (path.endsWith('/service-points')) return Response.json({ success: true, data: { servicePoints: [] } });
  const editing = /\/products\/(p[12])\/edit-options$/.exec(path)?.[1];
  if (editing) {
    if (editing === 'p2') await new Promise<void>(resolve => { releaseOptions = resolve; });
    return Response.json({ success: true, data: { product: products.find(product => product.documentId === editing), code: 1,
      categories: [{ id: 'c', name: 'Category' }], taxes: [], units: [{ id: 2, name: 'Number' }], premises: [] } });
  }
  assert(path === '/api/outlets/shop/products/p2' && init?.method === 'PATCH', 'Only normal confirmation can call the existing selected-product update endpoint');
  const payload = JSON.parse(String(init?.body)); patches.push({ id: 'p2', payload });
  return Response.json({ success: true, data: { documentId: 'p2', fields: { ...products[1]!.fields, ...payload } } });
};
let cameraRequests = 0, decode = false;
const streams: MediaStream[] = [];
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
  cameraRequests++;
  const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 600;
  const context = canvas.getContext('2d')!;
  const draw = () => {
    context.fillStyle = '#fff'; context.fillRect(0, 0, 1000, 600);
    if (!decode) return;
    const patterns = [0x034, 0x121, 0x061, 0x160, 0x031, 0x130, 0x070, 0x025, 0x124, 0x064];
    let x = 200;
    for (const digit of '*00123456*') {
      const pattern = digit === '*' ? 0x094 : patterns[Number(digit)]!;
      for (let bar = 0; bar < 9; bar++) { const width = pattern & (1 << (8 - bar)) ? 9 : 3; if (bar % 2 === 0) { context.fillStyle = '#000'; context.fillRect(x, 120, width, 360); } x += width; }
      x += 3;
    }
  };
  draw(); const stream = canvas.captureStream(8); const timer = setInterval(draw, 100);
  const track = stream.getVideoTracks()[0]!, stop = track.stop.bind(track);
  track.stop = () => { clearInterval(timer); stop(); }; streams.push(stream); return stream;
} });
const root = createRoot(document.getElementById('root')!);
root.render(<ProductsPage outlet={{ id: 'shop', name: 'Test Outlet' } as OutletSummary} token="mock-token" onSessionExpired={() => { throw new Error('Unexpected session expiration'); }} />);
const rows = () => [...document.querySelectorAll<HTMLTableRowElement>('.products-table tbody tr')];
const dialog = () => document.querySelector<HTMLDialogElement>('.barcode-scanner-popup[open]');
const barcode = () => document.querySelector<HTMLInputElement>('#product-barcode')!;
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text)!;

void (async () => {
  await until(() => rows().length === 2, 'product cards');
  const phone = matchMedia('(max-width: 600px), (max-width: 1024px) and (max-height: 500px)').matches;
  const icons = [...document.querySelectorAll<HTMLButtonElement>('.products-card-scan')];
  assert(icons.length === 2 && icons.every(icon => getComputedStyle(icon).display === (phone ? 'grid' : 'none')), 'Every product has its own scanner shortcut visible only on phones');
  assert(cameraRequests === 0 && patches.length === 0, 'Rendering product cards opens no camera and writes no data');
  if (phone) {
    assert(icons.every((icon, index) => {
      const bounds = icon.getBoundingClientRect(), card = rows()[index]!.getBoundingClientRect();
      return bounds.width === 44 && bounds.height === 44 && bounds.left > card.left && card.right - bounds.right <= 16 && bounds.top - card.top <= 16;
    }), 'Scanner buttons sit at the top right with touch-friendly dimensions');
    assert(document.documentElement.scrollWidth <= innerWidth, 'Cards remain inside the phone viewport');
    icons[1]!.click(); await until(() => releaseOptions, 'selected product options');
    assert(cameraRequests === 0 && !dialog(), 'Scanner waits for original edit data before opening, preventing a late response from overwriting a scan');
    releaseOptions!(); await until(() => (dialog()?.querySelector<HTMLVideoElement>('video')?.readyState ?? 0) >= 2, 'selected product live scanner');
    assert(document.querySelector<HTMLInputElement>('#product-name')!.value === 'Second product' && barcode().value === 'OLD-2', 'Card shortcut opens the correct existing product and preserves its stored barcode');
    button('Cancel').click(); await until(() => !dialog(), 'cancel card scan');
    assert(barcode().value === 'OLD-2' && patches.length === 0 && streams.at(-1)!.getTracks().every(track => track.readyState === 'ended'), 'Cancelling changes no data and stops the camera');
    const fieldScanner = document.querySelector<HTMLButtonElement>('[aria-label="Scan barcode"]')!;
    assert(getComputedStyle(fieldScanner).display === 'grid', 'The original Barcode field scanner remains available inside Edit Product');
    decode = true; fieldScanner.click();
    await until(() => dialog()?.querySelector('output')?.textContent === '00123456', 'real barcode decoding');
    button('Use Barcode').click(); await until(() => !dialog() && barcode().value === '00123456', 'barcode fills edit draft');
    assert(patches.length === 0 && document.querySelector<HTMLInputElement>('#product-name')!.value === 'Second product', 'Using the scanned barcode changes only the selected edit draft, with no automatic save');
    document.querySelector<HTMLButtonElement>('.product-mobile-save')!.click(); await until(() => document.querySelector('.action-confirm-button'), 'existing update confirmation');
    assert(patches.length === 0, 'Update retains the existing confirmation step');
    document.querySelector<HTMLButtonElement>('.action-confirm-button')!.click(); await until(() => document.querySelector('.success-done'), 'mock update completed');
    assert(patches.length === 1 && JSON.stringify(patches[0]!.payload) === JSON.stringify({ barcode: '00123456' }), 'Confirmed update sends only the exact scanned barcode to that product’s existing endpoint');
    button('Done').click(); await until(() => rows().length === 2, 'return to cards');
    const before = cameraRequests;
    rows()[0]!.querySelector<HTMLButtonElement>('[aria-label="Edit product"]')!.click();
    await until(() => document.querySelector<HTMLSelectElement>('#product-category')?.disabled === false, 'ordinary Edit Product');
    assert(!dialog() && cameraRequests === before && barcode().value === 'OLD-1', 'Ordinary Edit keeps its previous behavior and does not reuse the card scanner state or another product’s barcode');
  } else {
    assert(document.querySelectorAll('.products-table th').length === 6, 'Desktop/tablet table columns stay unchanged');
  }
  assert(JSON.stringify(products) === original, 'Input product records remain untouched');
  root.unmount(); streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { root.unmount(); streams.forEach(stream => stream.getTracks().forEach(track => track.stop())); document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
