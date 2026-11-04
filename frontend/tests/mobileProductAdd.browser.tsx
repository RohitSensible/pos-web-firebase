import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 240; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${label}: ${document.body.textContent?.slice(-700)}`); }
const original = { documentId: 'p1', fields: { name: 'Existing product', code: 1, price: 20, barcode: 'EXISTING', category: 'c' } };
const posts: Record<string, unknown>[] = [];
const products = [original];
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.endsWith('/master-sync')) return new Response('', { status: 404 });
  if (path.endsWith('/categories')) return Response.json({ success: true, data: [{ id: 'c', name: 'Food' }] });
  if (path.endsWith('/create-options')) return Response.json({ success: true, data: { code: 2, categories: [{ id: 'c', name: 'Food' }], taxes: [], units: [{ id: 2, name: 'Number' }], premises: [] } });
  if (path.endsWith('/service-points')) return Response.json({ success: true, data: { servicePoints: [] } });
  if (path.endsWith('/products') && (!init?.method || init.method === 'GET')) return Response.json({ success: true, data: products });
  assert(path === '/api/outlets/shop/products' && init?.method === 'POST', 'Scan-to-add only uses the existing product creation endpoint');
  const payload = JSON.parse(String(init?.body)); posts.push(payload);
  const created = { documentId: 'p2', fields: payload }; products.push(created as typeof original);
  return Response.json({ success: true, data: created }, { status: 201 });
};
let cameraRequests = 0, decode = false;
const streams: MediaStream[] = [];
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
  cameraRequests++;
  const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 600;
  const ctx = canvas.getContext('2d')!;
  const draw = () => {
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1000, 600);
    if (!decode) return;
    const patterns = [0x034, 0x121, 0x061, 0x160, 0x031, 0x130, 0x070, 0x025, 0x124, 0x064];
    let x = 200;
    for (const digit of '*00123456*') {
      const pattern = digit === '*' ? 0x094 : patterns[Number(digit)]!;
      for (let bar = 0; bar < 9; bar++) { const width = pattern & (1 << (8 - bar)) ? 9 : 3; if (bar % 2 === 0) { ctx.fillStyle = 'black'; ctx.fillRect(x, 120, width, 360); } x += width; }
      x += 3;
    }
  };
  draw(); const stream = canvas.captureStream(8), timer = setInterval(draw, 100);
  const track = stream.getVideoTracks()[0]!, stop = track.stop.bind(track);
  track.stop = () => { clearInterval(timer); stop(); }; streams.push(stream); return stream;
} });
const root = createRoot(document.getElementById('root')!);
root.render(<ProductsPage outlet={{ id: 'shop', name: 'Test outlet', active: true, branch: 'Test' }} token="test-token" onSessionExpired={() => { throw new Error('Unexpected session expiry'); }} />);
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
async function value(id: string, text: string) {
  const input = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
  Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, text);
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause();
}
void (async () => {
  await until(() => document.querySelector('.products-table'), 'product list');
  const add = document.querySelector<HTMLButtonElement>('.mobile-add-trigger')!;
  const scan = document.querySelector<HTMLButtonElement>('.products-scan-add')!;
  if (matchMedia('(max-width: 820px), (max-width: 1024px) and (max-height: 600px)').matches) {
    assert(getComputedStyle(add).position === 'fixed' && add.getBoundingClientRect().width === 56 && getComputedStyle(add.querySelector('span')!).display === 'none', 'Mobile Add is an accessible floating plus button');
    assert(getComputedStyle(document.querySelector('.products-image-menu')!).display === 'none' && getComputedStyle(scan).display !== 'none', 'Phone Products hides image options and shows Scan to add');
    scan.click(); await until(() => document.querySelector<HTMLVideoElement>('video')?.readyState! >= 2, 'live scanner');
    button('Cancel').click(); await until(() => !document.querySelector('dialog[open]'), 'cancel scan');
    assert(!document.querySelector('.add-product-modal') && posts.length === 0 && streams.at(-1)!.getTracks().every(track => track.readyState === 'ended'), 'Cancelling Scan to add keeps the list unchanged and releases the camera');
    decode = true; scan.click(); await until(() => document.querySelector('output')?.textContent === '00123456', 'actual barcode decode');
    assert(posts.length === 0, 'Detecting a barcode creates no product');
    button('Use Barcode').click(); await until(() => document.querySelector<HTMLSelectElement>('#product-category')?.disabled === false, 'new product form');
    assert(document.querySelector('#add-product-title')?.textContent === 'Add New Product' && (document.getElementById('product-barcode') as HTMLInputElement).value === '00123456', 'Use Barcode opens Add New Product with the exact scanned barcode');
    assert((document.getElementById('product-name') as HTMLInputElement).value === '' && original.fields.barcode === 'EXISTING', 'Scan-to-add does not copy or edit an existing product');
    await value('product-name', 'Scanned new product'); await value('product-price', '30'); await value('product-category', 'c');
    document.querySelector<HTMLButtonElement>('.product-mobile-save')!.click(); await until(() => document.querySelector('.action-confirm-button'), 'existing save confirmation');
    assert(posts.length === 0, 'New barcode product still requires normal Save confirmation');
    document.querySelector<HTMLButtonElement>('.action-confirm-button')!.click(); await until(() => !document.querySelector('.add-product-modal'), 'new product saved');
    assert(posts.length === 1 && posts[0]!.barcode === '00123456' && original.fields.barcode === 'EXISTING', 'Normal creation submits the scanned barcode with leading zeros without editing existing products');
    document.querySelector<HTMLButtonElement>('.mobile-add-trigger')!.click(); await until(() => document.querySelector<HTMLSelectElement>('#product-category')?.disabled === false, 'ordinary add');
    assert((document.getElementById('product-barcode') as HTMLInputElement).value === '', 'Ordinary Add does not reuse the previous scan');
  } else {
    assert(getComputedStyle(add).position !== 'fixed' && getComputedStyle(add.querySelector('span')!).display !== 'none', 'Desktop keeps its normal Add button');
    assert(getComputedStyle(document.querySelector('.products-image-menu')!).display !== 'none' && getComputedStyle(scan).display === 'none', 'Desktop keeps Product Images and hides mobile Scan to add');
    assert(cameraRequests === 0 && posts.length === 0, 'Displaying desktop Products never starts a camera or creates records');
  }
  root.unmount(); streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { root.unmount(); streams.forEach(stream => stream.getTracks().forEach(track => track.stop())); document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
