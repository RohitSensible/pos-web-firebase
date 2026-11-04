import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QRCodeWriter, BarcodeFormat } from '@zxing/library';
import { AddProductForm } from '../src/pages/AddProductForm.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 240; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}: ${document.body.textContent?.slice(-900)}`); }
const product = { documentId: 'p1', fields: { name: 'Original Product', barcode: 'OLD-0001', code: '001', price: 20, mrpPrice: 0, costPrice: 10,
  category: 'c', regionalName: '', discount: 0, shortName: '', taxIndex: 1, hsnCode: '', unitId: 2, weighable: false, stockable: true, currentStock: 12 } };
const original = JSON.stringify(product);
const patches: Record<string, unknown>[] = [];
let saved = 0;
window.fetch = async (input, init) => {
  const path = String(input);
  if (path === '/api/outlets/shop/products/p1/edit-options') return Response.json({ success: true, data: {
    code: '001', product, categories: [{ id: 'c', name: 'Category' }], taxes: [], units: [{ id: 2, name: 'Number' }], premises: [], servicePoints: [],
  } });
  if (path === '/api/outlets/shop/service-points') return Response.json({ success: true, data: { servicePoints: [] } });
  assert(path === '/api/outlets/shop/products/p1' && init?.method === 'PATCH', 'Only the existing update endpoint can write');
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer test-token', 'Existing update authorization retained');
  const payload = JSON.parse(String(init?.body)); patches.push(payload);
  return Response.json({ success: true, data: { documentId: product.documentId, fields: { ...product.fields, ...payload } } });
};

// An independently encoded Code 39 fixture becomes real video pixels via captureStream.
// The production ZXing decoder is used unchanged; decoded results are never stubbed.
const expected = '00123456';
const ean = '5901234123457';
let fixtureFormat: 'code39' | 'ean13' | 'qr' = 'code39';
const digitPatterns = [0x034, 0x121, 0x061, 0x160, 0x031, 0x130, 0x070, 0x025, 0x124, 0x064];
let fixtureCanvas: HTMLCanvasElement;
function cameraStream(withBarcode: boolean) {
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
  fixtureCanvas = canvas;
  const context = canvas.getContext('2d')!;
  const draw = () => {
    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
    if (!withBarcode) return;
    if (fixtureFormat === 'qr') {
      const matrix = new QRCodeWriter().encode('QR-001234', BarcodeFormat.QR_CODE, 400, 400, new Map());
      context.fillStyle = 'black';
      for (let y = 0; y < matrix.getHeight(); y++) for (let x = 0; x < matrix.getWidth(); x++) if (matrix.get(x, y)) context.fillRect(440 + x, 160 + y, 1, 1);
      return;
    }
    if (fixtureFormat === 'ean13') {
      const left = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
      const invert = (bits: string) => bits.replace(/[01]/g, bit => bit === '0' ? '1' : '0');
      const parity = 'LGGLLG'; // EAN-13 leading digit 5.
      const encodedLeft = [...ean.slice(1, 7)].map((digit, i) => parity[i] === 'L' ? left[Number(digit)] : [...invert(left[Number(digit)]!)].reverse().join('')).join('');
      const encodedRight = [...ean.slice(7)].map(digit => invert(left[Number(digit)]!)).join('');
      const bits = `101${encodedLeft}01010${encodedRight}101`;
      context.fillStyle = 'black'; [...bits].forEach((bit, i) => { if (bit === '1') context.fillRect(400 + i * 5, 180, 5, 360); });
      return;
    }
    let x = 390;
    for (const character of `*${expected}*`) {
      const pattern = character === '*' ? 0x094 : digitPatterns[Number(character)]!;
      for (let bar = 0; bar < 9; bar++) {
        const width = pattern & (1 << (8 - bar)) ? 9 : 3;
        if (bar % 2 === 0) { context.fillStyle = 'black'; context.fillRect(x, 180, width, 360); }
        x += width;
      }
      x += 3;
    }
  };
  draw(); const stream = canvas.captureStream(8);
  const timer = setInterval(draw, 100);
  const track = stream.getVideoTracks()[0]!;
  const nativeStop = track.stop.bind(track);
  track.stop = () => { clearInterval(timer); nativeStop(); };
  return stream;
}
let mode: 'denied' | 'missing' | 'fallback' | 'held' | 'blank' | 'barcode' = 'held';
let cameras = 0;
const streams: MediaStream[] = [];
let releaseCamera: (() => void) | undefined;
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async (constraints: MediaStreamConstraints) => {
  cameras++;
  assert(constraints.audio === false && (constraints.video === true || typeof constraints.video === 'object' && (constraints.video.facingMode as ConstrainDOMStringParameters)?.ideal === 'environment'), 'Scanner requests camera video without audio, preferring the rear camera');
  if (mode === 'fallback' && constraints.video !== true) throw new DOMException('Camera hints unsupported', 'OverconstrainedError');
  if (mode === 'denied') throw new DOMException('Denied', 'NotAllowedError');
  if (mode === 'missing') throw new DOMException('No camera', 'NotFoundError');
  const stream = cameraStream(mode === 'barcode'); streams.push(stream);
  if (mode === 'held') await new Promise<void>(resolve => { releaseCamera = resolve; });
  return stream;
} });

const host = document.getElementById('root')!;
let root = createRoot(host);
const render = () => root.render(<StrictMode><AddProductForm outletId="shop" token="test-token" product={product} initialCategory={null}
  onCancel={() => { throw new Error('Scanner must not leave the editor'); }} onCreated={() => { saved++; }} onSessionExpired={() => { throw new Error('Unexpected expiry'); }} /></StrictMode>);
const barcode = () => document.querySelector<HTMLInputElement>('#product-barcode')!;
const dialog = () => document.querySelector<HTMLDialogElement>('.barcode-scanner-popup[open]');
const button = (label: string) => {
  const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label);
  if (!node) throw new Error(`Missing button: ${label}`); return node;
};
const scan = async () => { document.querySelector<HTMLButtonElement>('[aria-label="Scan barcode"]')!.click(); await until(dialog, 'scanner dialog'); };
const cancel = async () => { button('Cancel').click(); await until(() => !dialog(), 'scanner closed'); };
async function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
}
void (async () => {
  render(); await until(() => document.querySelector<HTMLSelectElement>('#product-category')?.disabled === false, 'existing form loaded');
  assert(barcode().value === 'OLD-0001' && cameras === 0, 'Saved barcode loads without requesting camera access');
  const field = barcode().getBoundingClientRect(), icon = document.querySelector<HTMLElement>('[aria-label="Scan barcode"]')!.getBoundingClientRect();
  assert(icon.right <= field.right && icon.left > field.left && Math.abs(icon.top + icon.height / 2 - field.top - field.height / 2) < 2, 'Scanner icon sits inside the right end of the unchanged input');
  assert(field.height === document.querySelector('#product-name')!.getBoundingClientRect().height, 'Barcode input retains the other input dimensions');
  await scan(); await until(() => releaseCamera, 'pending permission');
  assert(button('Use Barcode').disabled && barcode().value === 'OLD-0001' && patches.length === 0, 'Opening scanner preserves the draft and cannot save');
  await cancel(); releaseCamera!(); await until(() => streams[0]!.getTracks().every(track => track.readyState === 'ended'), 'late camera cleanup');
  assert(barcode().value === 'OLD-0001', 'Camera resolving after cancellation is released without changing the form');
  mode = 'denied'; await scan(); await until(() => document.querySelector('[role="alert"]')?.textContent?.includes('permission was denied'), 'permission error');
  assert(button('Use Barcode').disabled, 'Permission failure cannot populate a barcode');
  mode = 'missing'; button('Try again').click(); await until(() => document.querySelector('[role="alert"]')?.textContent?.includes('No camera'), 'missing camera');
  assert(button('Use Barcode').disabled && !document.querySelector('.barcode-photo-actions'), 'Camera errors retain the live scanner instead of switching to a photo picker');
  const requestsBeforeFallback = cameras;
  mode = 'fallback'; button('Try again').click();
  await until(() => document.querySelector<HTMLVideoElement>('.barcode-camera video')?.readyState! >= 2, 'live camera recovery after error');
  assert(cameras === requestsBeforeFallback + 2, 'Unsupported camera hints recover automatically using the default camera');
  assert(!document.querySelector<HTMLVideoElement>('.barcode-camera video')!.hidden, 'Retry recovers the live preview after camera errors');
  await cancel();
  mode = 'blank'; await scan(); await until(() => document.querySelector<HTMLVideoElement>('.barcode-camera video')?.readyState! >= 2, 'live preview');
  assert(document.querySelector<HTMLVideoElement>('.barcode-camera video')!.playsInline && button('Use Barcode').disabled, 'Live inline preview waits for an actual decoded barcode');
  await cancel(); assert(streams.at(-1)!.getTracks().every(track => track.readyState === 'ended'), 'Cancel stops every active media track');
  mode = 'barcode'; fixtureFormat = 'ean13'; await scan(); await until(() => dialog()?.querySelector('output')?.textContent === ean, 'real EAN-13 decode');
  assert(barcode().value === 'OLD-0001' && patches.length === 0, 'Real decoded pixels stay pending until explicitly accepted');
  assert(streams.at(-1)!.getTracks().every(track => track.readyState === 'ended'), 'Detection stops camera tracks and repeated scanning');
  await until(() => dialog()?.querySelector<HTMLImageElement>('.barcode-captured-preview')?.naturalWidth, 'frozen camera frame');
  assert(dialog()!.querySelectorAll('.barcode-target i').length === 4 && !!dialog()!.querySelector('.barcode-status-success'), 'Detected scanner shows corner guides and success indicator');
  assert(dialog()!.querySelector<HTMLImageElement>('.barcode-captured-preview')!.src.startsWith('data:image/jpeg'), 'Scanner preserves a real camera frame after stopping the stream');
  await cancel(); assert(barcode().value === 'OLD-0001', 'Cancelling a detected result discards it');
  fixtureFormat = 'qr'; await scan(); await until(() => dialog()?.querySelector('output')?.textContent === 'QR-001234', 'real live QR decode');
  assert(streams.at(-1)!.getTracks().every(track => track.readyState === 'ended'), 'Live QR detection releases the camera');
  await cancel();
  fixtureFormat = 'code39'; await scan(); await until(() => dialog()?.querySelector('output')?.textContent === expected, 'real Code 39 decode');
  if (location.hash.includes('preview')) {
    const bounds = dialog()!.getBoundingClientRect(); assert(bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight, 'Scanner fits the phone viewport');
    const footer = dialog()!.querySelector('.modal-footer')!.getBoundingClientRect();
    assert(footer.bottom <= innerHeight && footer.width <= innerWidth, 'Cancel and Use Barcode remain visible within the viewport');
    document.getElementById('test-results')!.style.display = 'none'; document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks }); return;
  }
  button('Use Barcode').click(); await until(() => !dialog() && barcode().value === expected, 'barcode accepted into form');
  assert(patches.length === 0 && document.querySelector<HTMLInputElement>('#product-name')!.value === product.fields.name, 'Use Barcode updates the existing state with leading zeros and preserves other fields without saving');
  button('Update').click(); await until(() => document.querySelector('.action-confirm-button'), 'scanned barcode save confirmation');
  assert(patches.length === 0, 'A detected barcode never bypasses the existing product confirmation');
  document.querySelector<HTMLButtonElement>('.action-confirm-button')!.click(); await until(() => saved === 1, 'scanned barcode saved');
  assert(JSON.stringify(patches) === JSON.stringify([{ barcode: expected }]), 'Update saves the actual decoded live barcode and no unrelated fields');
  await setValue(barcode(), '000999999');
  button('Update').click(); await until(() => document.querySelector('.action-confirm-button'), 'existing update confirmation');
  assert(patches.length === 1, 'Existing update confirmation still precedes persistence');
  document.querySelector<HTMLButtonElement>('.action-confirm-button')!.click(); await until(() => saved === 2, 'existing PATCH');
  assert(JSON.stringify(patches) === JSON.stringify([{ barcode: expected }, { barcode: '000999999' }]), 'Existing PATCH saves the final manually edited barcode and no unrelated fields');
  assert(JSON.stringify(product) === original, 'Original product fixture remains unchanged');
  mode = 'blank'; await scan(); await until(() => document.querySelector<HTMLVideoElement>('.barcode-camera video')?.readyState! >= 2, 'camera before unmount');
  root.unmount(); assert(streams.at(-1)!.getTracks().every(track => track.readyState === 'ended'), 'Leaving the editor stops the camera');
  root = createRoot(host); render(); await until(() => barcode(), 'fresh editor');
  const media = navigator.mediaDevices.getUserMedia;
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: undefined });
  await until(() => document.querySelector<HTMLSelectElement>('#product-category')?.disabled === false, 'fresh options');
  await scan(); await until(() => document.querySelector('[role="alert"]')?.textContent?.includes('not supported'), 'unsupported camera API');
  dialog()!.querySelector<HTMLButtonElement>('[aria-label="Close popup"]')!.click(); await until(() => !dialog(), 'close button');
  assert(barcode().value === 'OLD-0001', 'Close popup preserves the original barcode');
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: media });
  mode = 'blank'; await scan(); await until(() => document.querySelector<HTMLVideoElement>('.barcode-camera video')?.readyState! >= 2, 'camera before Escape');
  dialog()!.dispatchEvent(new Event('cancel', { cancelable: true })); await until(() => !dialog(), 'Escape cancellation');
  assert(streams.at(-1)!.getTracks().every(track => track.readyState === 'ended') && barcode().value === 'OLD-0001', 'Dialog keyboard cancellation stops the camera without changing the field');

  // Insecure LAN origins must fail honestly rather than switch to a photo UI.
  const secureDescriptor = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
  const cameraCount = cameras, patchCount = patches.length;
  await scan(); await until(() => dialog()?.querySelector('[role="alert"]')?.textContent?.includes('trusted HTTPS'), 'HTTP secure-context error');
  assert(cameras === cameraCount && button('Use Barcode').disabled, 'HTTP origin cannot request a blocked stream or accept an invented result');
  assert(!dialog()!.querySelector('input[type="file"]') && !dialog()!.textContent?.includes('Open camera'), 'Scanner never substitutes a photo-first interface');
  assert(!dialog()!.querySelector('a.barcode-secure-app'), 'HTTP testing does not offer an unavailable HTTPS development server');
  await cancel();
  assert(barcode().value === 'OLD-0001' && patches.length === patchCount, 'Insecure-origin cancellation preserves barcode and product data');
  if (secureDescriptor) Object.defineProperty(window, 'isSecureContext', secureDescriptor);
  else Reflect.deleteProperty(window, 'isSecureContext');
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { streams.forEach(stream => stream.getTracks().forEach(track => track.stop())); document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
