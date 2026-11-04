import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AddProductForm } from '../src/pages/AddProductForm.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 240; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}: ${document.body.textContent?.slice(-800)}`); }
const product = { documentId: 'p1', fields: { name: 'Original Product', barcode: 'OLD', code: '001', price: 20, mrpPrice: 0, costPrice: 10,
  category: 'c', regionalName: '', discount: 0, shortName: '', taxIndex: 1, hsnCode: '', unitId: 2, weighable: false, stockable: true, currentStock: 12 } };
const patches: Record<string, unknown>[] = [];
let saved = 0, cameras = 0;
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.endsWith('/edit-options')) return Response.json({ data: { code: '001', product, categories: [{ id: 'c', name: 'Category' }], taxes: [], units: [{ id: 2, name: 'Number' }], premises: [] } });
  if (path.endsWith('/service-points')) return Response.json({ data: { servicePoints: [] } });
  assert(path === '/api/outlets/shop/products/p1' && init?.method === 'PATCH', 'Only the existing product Update endpoint may write; images are never uploaded');
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer test-token', 'Existing update authorization is preserved');
  const patch = JSON.parse(String(init?.body)); patches.push(patch);
  return Response.json({ data: { documentId: 'p1', fields: { ...product.fields, ...patch } } });
};
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { cameras++; throw new DOMException('Permission denied', 'NotAllowedError'); } });
const root = createRoot(document.getElementById('root')!);
root.render(<StrictMode><AddProductForm outletId="shop" token="test-token" product={product} initialCategory={null}
  onCancel={() => { throw new Error('Must stay in Edit Product'); }} onCreated={() => { saved++; }} onSessionExpired={() => { throw new Error('Unexpected expiry'); }} /></StrictMode>);
const field = () => document.querySelector<HTMLInputElement>('#product-barcode')!;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
const popup = () => document.querySelector<HTMLDialogElement>('.barcode-image-popup[open]');
const open = async () => { document.querySelector<HTMLButtonElement>('[aria-label="Upload barcode image"]')!.click(); await until(popup, 'image popup'); };
async function select(file: File) {
  const input = popup()!.querySelector<HTMLInputElement>('input[type="file"]')!;
  const files = new DataTransfer(); files.items.add(file); input.files = files.files;
  input.dispatchEvent(new Event('change', { bubbles: true })); await pause();
}
async function imageFile(sideways = false) {
  // Independently encode Code 39. The real ZXing image decoder is never stubbed.
  const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 600;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1000, 600);
  const patterns = [0x034, 0x121, 0x061, 0x160, 0x031, 0x130, 0x070, 0x025, 0x124, 0x064];
  let x = 200;
  for (const character of '*00123456*') {
    const pattern = character === '*' ? 0x094 : patterns[Number(character)]!;
    for (let bar = 0; bar < 9; bar++) { const width = pattern & (1 << (8 - bar)) ? 9 : 3; if (bar % 2 === 0) { ctx.fillStyle = '#000'; ctx.fillRect(x, 120, width, 360); } x += width; }
    x += 3;
  }
  let output = canvas;
  if (sideways) { output = document.createElement('canvas'); output.width = 600; output.height = 1000; const rotated = output.getContext('2d')!; rotated.translate(600, 0); rotated.rotate(Math.PI / 2); rotated.drawImage(canvas, 0, 0); }
  return new File([await new Promise<Blob>(resolve => output.toBlob(blob => resolve(blob!), 'image/png'))], 'barcode.png', { type: 'image/png' });
}
void (async () => {
  await until(() => document.querySelector<HTMLSelectElement>('#product-category')?.disabled === false, 'options loaded');
  const scan = document.querySelector<HTMLButtonElement>('[aria-label="Scan barcode"]')!;
  const upload = document.querySelector<HTMLButtonElement>('[aria-label="Upload barcode image"]')!;
  const visible = (node: HTMLElement) => getComputedStyle(node).display !== 'none';
  if (innerWidth <= 820) {
    assert(visible(scan) && !visible(upload), 'Phone screens show the live scanner option and hide desktop image upload');
    scan.click(); await until(() => document.querySelector('[role="alert"]')?.textContent?.includes('permission was denied'), 'mobile scanner requests camera');
    assert(cameras > 0 && !popup(), 'Phone action opens the camera scanner without an image picker');
    button('Cancel').click(); await pause();
    assert(field().value === 'OLD' && patches.length === 0, 'Cancelling the mobile scanner preserves product data');
  } else {
    assert(visible(upload) && !visible(scan), 'Desktop and laptop screens show image upload and hide the mobile camera option');
    await open();
    assert(button('Use Barcode').disabled && cameras === 0, 'Desktop popup never requests the camera and waits for a decoded image');
    let pickerOpened = false; popup()!.querySelector<HTMLInputElement>('input')!.click = () => { pickerOpened = true; };
    button('Choose image').click(); assert(pickerOpened, 'Choose image opens the local file picker');
    await select(await imageFile()); await until(() => popup()?.querySelector('output')?.textContent === '00123456', 'real uploaded image decode');
    assert(field().value === 'OLD' && patches.length === 0 && cameras === 0, 'Image decoding preserves leading zeros, stays pending, and makes no upload or camera request');
    if (location.hash.includes('preview')) {
      const bounds = popup()!.getBoundingClientRect();
      assert(bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight, 'Barcode image popup fits the viewport');
      const results = document.getElementById('test-results')!; results.style.display = 'none'; results.textContent = JSON.stringify({ passed: checks.length, checks }); return;
    }
    button('Use Barcode').click(); await until(() => !popup() && field().value === '00123456', 'decoded value accepted');
    assert(document.querySelector<HTMLInputElement>('#product-name')!.value === product.fields.name && patches.length === 0, 'Use Barcode fills only the existing draft field without saving');
    button('Update').click(); await until(() => document.querySelector('.action-confirm-button'), 'existing confirmation');
    assert(patches.length === 0, 'Image barcode saving retains Update confirmation');
    document.querySelector<HTMLButtonElement>('.action-confirm-button')!.click(); await until(() => saved === 1, 'existing update');
    assert(JSON.stringify(patches) === JSON.stringify([{ barcode: '00123456' }]), 'Existing Update saves only the actual decoded barcode');
    await open(); await select(await imageFile(true)); await until(() => popup()?.querySelector('output')?.textContent === '00123456', 'sideways image decode');
    assert(!button('Use Barcode').disabled, 'Sideways barcode images are decoded correctly');
    button('Cancel').click(); await until(() => !popup(), 'cancel decoded image');
    await open(); await select(new File(['not an image'], 'invalid.png', { type: 'image/png' }));
    await until(() => popup()?.querySelector('[role="alert"]'), 'invalid image error');
    assert(button('Use Barcode').disabled && field().value === '00123456', 'Unreadable images cannot overwrite the current barcode');
    await select(new File(['text'], 'invalid.txt', { type: 'text/plain' }));
    await until(() => popup()?.querySelector('[role="alert"]')?.textContent?.includes('Choose an image'), 'file type error');
    assert(button('Use Barcode').disabled && patches.length === 1, 'Non-image files cannot populate or save a barcode');
    popup()!.querySelector<HTMLButtonElement>('[aria-label="Close popup"]')!.click(); await until(() => !popup(), 'close image popup');
    assert(cameras === 0 && field().value === '00123456' && product.fields.barcode === 'OLD', 'Desktop workflow preserves source records and never opens the camera');
  }
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
