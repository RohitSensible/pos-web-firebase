import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { ProductImageCropper } from '../src/pages/ProductImageCropper.tsx';
import { cropRegion, decodeProductImage, processProductImage, PRODUCT_IMAGE_MAX_BYTES } from '../src/pages/productImageProcessing.ts';

const passed: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const root = createRoot(document.getElementById('root')!);
async function fixture(width: number, height: number, noisy = false, type = 'image/png') {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!;
  if (noisy) {
    const data = context.createImageData(width, height); let seed = 17;
    for (let index = 0; index < data.data.length; index++) { seed = (seed * 1664525 + 1013904223) >>> 0; data.data[index] = index % 4 === 3 ? 255 : seed >>> 24; }
    context.putImageData(data, 0, 0);
  } else {
    context.fillStyle = '#ff0000'; context.fillRect(0, 0, width / 2, height);
    context.fillStyle = '#0000ff'; context.fillRect(width / 2, 0, width / 2, height / 2);
  }
  const encoded = atob(canvas.toDataURL(type, 0.95).split(',')[1]);
  const blob = new Blob([Uint8Array.from(encoded, char => char.charCodeAt(0))], { type });
  return new File([blob], 'fixture', { type: blob.type });
}
async function pixels(file: File) {
  const bitmap = await decodeProductImage(file);
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height); bitmap.close(); return data;
}
async function waitFor(check: () => unknown, label: string) {
  for (let i = 0; i < 160; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error(`Timed out: ${label}: ${document.querySelector('[role="alert"]')?.textContent}`);
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label);
void (async () => {
  for (const [w, h] of [[320, 160], [160, 320], [160, 160]]) {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      const source = await fixture(w, h, false, type); const bitmap = await decodeProductImage(source);
      const result = await processProductImage(bitmap, cropRegion(w, h, 1, 0.5, 0.5));
      assert(result.size <= PRODUCT_IMAGE_MAX_BYTES && result.type === 'image/jpeg' && result.name.endsWith('.jpg'), 'Measured JPEG result is within limit');
      const decoded = await pixels(result); assert(decoded.width === Math.min(w, h) && decoded.height === decoded.width, 'Native square output');
      bitmap.close();
    }
  }
  passed.push('JPEG, PNG and WebP portrait, landscape and square images decode and crop to square JPEGs within 25 KB');
  const source = await fixture(320, 160); const bitmap = await decodeProductImage(source);
  const left = await pixels(await processProductImage(bitmap, cropRegion(320, 160, 2, 0, 0)));
  const transparent = await pixels(await processProductImage(bitmap, cropRegion(320, 160, 2, 1, 1)));
  assert(left.width === 80 && left.data[0]! >= 240 && left.data[2]! <= 15, 'Zoom and left crop keep the red pixels (JPEG tolerance)');
  // JPEG has no alpha: transparent areas are filled white for the Android POS.
  assert(transparent.data[3] === 255 && [0, 1, 2].every(channel => transparent.data[channel]! >= 240), 'Transparent region becomes white'); bitmap.close();
  const smallSource = await decodeProductImage(source);
  passed.push(`Small PNG: ${(await processProductImage(smallSource, cropRegion(320, 160, 2, 0, 0))).size} bytes`);
  smallSource.close();
  passed.push('Small image: 80px crop preserved without upscaling; transparent pixels become white');
  passed.push('Zoom and reposition produce the expected pixels; transparency is filled white');
  // Insert a standard EXIF orientation=6 APP1 segment into a generated JPEG.
  const jpeg = await fixture(80, 40, false, 'image/jpeg');
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  const exif = new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
  const oriented = await decodeProductImage(new File([bytes.slice(0,2), exif, bytes.slice(2)], 'oriented.jpg', { type: 'image/jpeg' }));
  assert(oriented.width === 40 && oriented.height === 80, 'EXIF orientation applied'); oriented.close();
  passed.push('JPEG EXIF orientation is corrected before crop calculations');
  const noise = await fixture(1024, 1024, true); const noisy = await decodeProductImage(noise);
  const adjusted = await processProductImage(noisy, cropRegion(1024,1024,1,0.5,0.5));
  assert(adjusted.size <= PRODUCT_IMAGE_MAX_BYTES && ['image/webp', 'image/jpeg', 'image/png'].includes(adjusted.type), 'Detailed image remains within safety limit');
  const adjustedBitmap = await decodeProductImage(adjusted);
  assert(adjustedBitmap.width < 1024 && adjustedBitmap.width === adjustedBitmap.height, 'Oversized image is resized without changing crop shape');
  assert(adjustedBitmap.width >= 256, 'Detailed fixture retains product-detail resolution');
  passed.push(`Detailed noise: ${adjusted.size} bytes, ${adjustedBitmap.width}px, ${adjusted.type}`);
  adjustedBitmap.close(); noisy.close();
  const labelCanvas = document.createElement('canvas'); labelCanvas.width = labelCanvas.height = 900;
  const labelContext = labelCanvas.getContext('2d')!;
  labelContext.fillStyle = '#fff'; labelContext.fillRect(0, 0, 900, 900);
  labelContext.fillStyle = '#183b57'; labelContext.font = '22px sans-serif';
  for (let y = 0; y < 900; y += 32) labelContext.fillText('SENSIBLE BIZ | Product 12345 | 250g | Rs 199', 12, y + 24);
  const labelBlob = await new Promise<Blob>(resolve => labelCanvas.toBlob(blob => resolve(blob!), 'image/png'));
  const labelBitmap = await decodeProductImage(new File([labelBlob], 'label.png', { type: 'image/png' }));
  const labelFile = await processProductImage(labelBitmap, cropRegion(900, 900, 1, 0.5, 0.5));
  const labelResult = await decodeProductImage(labelFile);
  assert(labelFile.size <= PRODUCT_IMAGE_MAX_BYTES && labelResult.width >= 256, 'Fine text retains useful resolution within the actual byte limit');
  passed.push(`Fine text: ${labelFile.size} bytes, ${labelResult.width}px, ${labelFile.type}`);
  labelBitmap.close(); labelResult.close();
  // A broken encoder must never allow oversized bytes through.
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function(callback, type) { callback(new Blob([new Uint8Array(PRODUCT_IMAGE_MAX_BYTES + 1)], { type })); };
  const small = await decodeProductImage(source);
  try {
    let failed = false; try { await processProductImage(small, cropRegion(320,160,1,0.5,0.5)); } catch (error) { failed = String(error).includes('25 KB'); }
    assert(failed, 'Oversized output never silently accepted');
  } finally { HTMLCanvasElement.prototype.toBlob = originalToBlob; small.close(); }
  passed.push('Detail keeps at least 256px; output exceeding safety limit is rejected');
  // Output is always JPEG, even when the browser has no WebP encoder.
  const alphaSource = await fixture(320, 320, true);
  const alphaBitmap = await decodeProductImage(alphaSource);
  const alphaCanvas = document.createElement('canvas'); alphaCanvas.width = alphaCanvas.height = 320;
  const alphaContext = alphaCanvas.getContext('2d')!; alphaContext.drawImage(alphaBitmap, 0, 0); alphaBitmap.close();
  alphaContext.clearRect(240, 240, 80, 80);
  const alphaBlob = await new Promise<Blob>(resolve => alphaCanvas.toBlob(blob => resolve(blob!), 'image/png'));
  const alphaImage = await decodeProductImage(new File([alphaBlob], 'alpha.png', { type: 'image/png' }));
  HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
    originalToBlob.call(this, callback, type === 'image/webp' ? 'image/png' : type, quality);
  };
  try {
    // JPEG output flattens transparency to white and is never uploaded oversized.
    const flattened = await processProductImage(alphaImage, cropRegion(320,320,1,0.5,0.5));
    const corner = await pixels(flattened), last = (corner.width * corner.height - 1) * 4;
    assert(flattened.type === 'image/jpeg' && flattened.size <= PRODUCT_IMAGE_MAX_BYTES
      && corner.data[last + 3] === 255 && [0, 1, 2].every(channel => corner.data[last + channel]! >= 240), 'Transparent areas become a white JPEG within the limit');
    const opaqueImage = await decodeProductImage(new File([labelBlob], 'label.png', { type: 'image/png' }));
    try {
      const jpeg = await processProductImage(opaqueImage, cropRegion(900,900,1,0.5,0.5));
      assert(jpeg.type === 'image/jpeg' && jpeg.size <= PRODUCT_IMAGE_MAX_BYTES, 'Opaque images use JPEG within 25 KB when WebP encoding is unavailable');
      const bytes = new Uint8Array(await jpeg.arrayBuffer());
      assert(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255, 'JPEG fallback has real JPEG content');
    } finally { opaqueImage.close(); }
  } finally { HTMLCanvasElement.prototype.toBlob = originalToBlob; alphaImage.close(); }
  passed.push('Unavailable WebP encoder: opaque images use valid JPEG; transparent images are flattened to white JPEG');

  let applied: File | null = null; let canceled = 0;
  const render = (file: File) => root.render(<ProductImageCropper file={file} onCancel={() => { canceled++; }} onApply={value => { applied = value; }} />);
  render(source);
  await waitFor(() => button('Save') && !button('Save')!.disabled, 'decoded crop UI');
  assert(!document.querySelector('input'), 'Crop settings fields have been removed');
  assert(!button('Preview Crop') && !button('Apply Crop'), 'There is no separate preview step');
  assert(button('Square crop'), 'Full image is default; square crop is explicit');
  button('Square crop')!.click();
  await new Promise(resolve => setTimeout(resolve, 20));
  const cropCanvas = document.querySelector('canvas')!;
  const sample = () => cropCanvas.getContext('2d')!.getImageData(0, 0, 640, 640).data;
  const initial = sample();
  cropCanvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -350 }));
  await new Promise(resolve => setTimeout(resolve, 20));
  cropCanvas.setPointerCapture = () => {};
  cropCanvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 140, clientY: 140 }));
  cropCanvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 80, clientY: 80 }));
  cropCanvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert(sample().some((value, index) => value !== initial[index]), 'Scroll zoom and dragging change crop');
  button('Clear')!.click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert(sample().every((value, index) => value === initial[index]), 'Clear restores centered native crop');
  cropCanvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 100, clientY: 100 }));
  cropCanvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, clientX: 150, clientY: 100 }));
  cropCanvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 2, clientX: 250, clientY: 100 }));
  cropCanvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  cropCanvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
  await new Promise(resolve => setTimeout(resolve, 20));
  let releaseEncoding: (() => void) | undefined;
  const encoderBeforeSave = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
    releaseEncoding = () => encoderBeforeSave.call(this, callback, type, quality);
  };
  button('Save')!.click();
  await waitFor(() => releaseEncoding && document.querySelector('.product-crop-saving .product-image-spinner'), 'Save processing loader');
  assert(button('Saving…')?.disabled && button('Cancel')?.disabled, 'Save cannot be submitted twice while processing');
  HTMLCanvasElement.prototype.toBlob = encoderBeforeSave;
  releaseEncoding!();
  await waitFor(() => applied, 'direct save completes');
  assert((applied as unknown as File).size <= PRODUCT_IMAGE_MAX_BYTES, 'Save returns only processed bytes within 25 KB');
  const savedBitmap = await decodeProductImage(applied!);
  assert(savedBitmap.width < 160, 'Pinch zoom affects the saved crop'); savedBitmap.close();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); assert(canceled === 1, 'Escape cancels editor');
  passed.push('Crop UI removes settings and preview step; drag, scroll, pinch, clear and direct Save work');
  // Redesigned layout: header, aspect choice, zoom percentage and rotation in one toolbar.
  root.render(<></>); await new Promise(resolve => setTimeout(resolve, 20));
  applied = null; render(source);
  await waitFor(() => button('Save') && !button('Save')!.disabled, 'decoded crop UI again');
  assert(document.getElementById('product-crop-title')?.textContent === 'Prepare Product Image' && button('Original')?.getAttribute('aria-pressed') === 'true'
    && document.querySelector('.product-crop-zoom output')?.textContent === '100%', 'Header, Original/Square choice and a 100% zoom readout are shown');
  document.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click(); await new Promise(resolve => setTimeout(resolve, 20));
  assert(button('Square crop')?.getAttribute('aria-pressed') === 'true' && document.querySelector('.product-crop-zoom output')?.textContent === '110%', 'Zoom in switches to Square crop and steps by 10%');
  button('Original')!.click(); button('Rotate Right')!.click(); await new Promise(resolve => setTimeout(resolve, 60));
  button('Save')!.click(); await waitFor(() => applied, 'rotated save');
  const rotatedBitmap = await decodeProductImage(applied!);
  assert(rotatedBitmap.height > rotatedBitmap.width, 'Rotate Right turns a landscape image into a portrait saved image'); rotatedBitmap.close();
  passed.push('Prepare Product Image layout: header, aspect choice, zoom readout and rotation');
  if (location.hash !== '#preview') root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed }); });
