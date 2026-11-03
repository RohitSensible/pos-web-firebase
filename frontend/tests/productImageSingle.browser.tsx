import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import JSZip from 'jszip';
import { ProductImageBatch } from '../src/pages/ProductImageBatch.tsx';
import { ProductImageUpload } from '../src/pages/ProductImageUpload.tsx';
import { PRODUCT_IMAGE_MAX_BYTES } from '../src/pages/productImageProcessing.ts';
import '../src/index.css';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const passed: string[] = [];
let saved: File | undefined;
let image: string | undefined;
let downloads = 0, uploads = 0, bulkUploads = 0;
let failUpload = true;
const filename = `${'a'.repeat(64)}.jpg`;
const nativeFetch = window.fetch.bind(window);
window.fetch = async (url, init) => {
  if (String(url) === '/api/outlets/test/product-image-assignments') {
    bulkUploads++;
    const body = JSON.parse(String(init?.body));
    const bytes = Uint8Array.from(atob(body.base64), char => char.charCodeAt(0));
    assert(bytes.length > 0 && bytes.length <= PRODUCT_IMAGE_MAX_BYTES, 'Bulk final bytes within 25 KB');
    assert(body.contentType === 'image/jpeg', 'Bulk uploads JPEG, the format the Android POS displays');
    assert(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff, 'Bulk bytes are actual JPEG');
    saved = new File([bytes], filename, { type: body.contentType });
    return Response.json({ success: true, data: { image: filename, results: [{ documentId: 'tea', status: 'saved', message: 'Saved' }] } });
  }
  assert(String(url) === '/api/outlets/test/products/tea/image', 'Same product endpoint for upload and display');
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer test', 'Authenticated access');
  if (init?.method === 'PUT') {
    uploads++;
    const file = init.body as File;
    assert(file instanceof File && file.size > 0 && file.size <= PRODUCT_IMAGE_MAX_BYTES, 'Only validated compressed output uploaded');
    assert(file.type === 'image/jpeg' && file.name.endsWith('.jpg'), 'Single uploads JPEG, the format the Android POS displays');
    const bytes = new Uint8Array(await file.arrayBuffer());
    assert(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff, 'Actual encoded JPEG bytes match the MIME type and extension');
    if (failUpload) return Response.json({ success: false, message: 'Simulated interruption' }, { status: 503 });
    saved = file;
    return Response.json({ success: true, data: { image: filename } });
  }
  downloads++;
  return new Response(saved, { headers: { 'Content-Type': saved!.type } });
};
const root = createRoot(document.getElementById('root')!);
function Product() {
  const [reference, setReference] = useState(image);
  return <ProductImageUpload outletId="test" documentId="tea" name="Tea" token="test" image={reference}
    onSaved={value => { image = value; setReference(value); }} onUploadStart={() => {}}
    onSessionExpired={() => { throw new Error('Unexpected expired session'); }} />;
}
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text);
async function waitFor(check: () => unknown, label: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}: ${document.body.textContent}`);
}
void (async () => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(1024, 1024); let seed = 17;
  for (let i = 0; i < pixels.data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels.data[i] = i % 4 === 3 ? 255 : seed >>> 24;
  }
  ctx.putImageData(pixels, 0, 0);
  const source = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/webp', .95));
  root.render(<Product />);
  await waitFor(() => document.querySelector('input[type="file"]'), 'upload control');
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const selection = new DataTransfer(); selection.items.add(new File([source], 'tea.webp', { type: source.type }));
  input.files = selection.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => button('Save') && !button('Save')!.disabled, 'crop decode');
  button('Save')!.click();
  await waitFor(() => button('Retry upload'), 'interruption reported');
  assert(!image && !saved, 'Failed upload preserves previous reference');
  failUpload = false; button('Retry upload')!.click();
  await waitFor(() => image === filename, 'retry saves filename');
  assert(uploads === 2 && saved!.size <= 25600, 'Retry completes within hard limit');
  passed.push('Single WebP source compressed to WebP within 25 KB; interrupted upload safely retried');
  // Remount to discard the local selection preview and exercise authenticated retrieval.
  root.render(<Product key="reload" />);
  await waitFor(() => downloads > 0 && !!document.querySelector<HTMLImageElement>('img')?.naturalWidth, 'saved image downloads and decodes');
  const displayed = new Uint8Array(await (await nativeFetch(document.querySelector<HTMLImageElement>('img')!.src)).arrayBuffer());
  const uploaded = new Uint8Array(await saved!.arrayBuffer());
  assert(displayed.length === uploaded.length && displayed.every((byte, i) => byte === uploaded[i]), 'Displayed bytes equal the compressed upload');
  passed.push('Filename reference survives remount; authenticated Web POS display decodes the exact saved bytes');
  const singleBytes = saved!.size;
  root.render(<ProductImageBatch mode="bulk" products={[{ documentId: 'tea', fields: { name: 'Tea', code: 1 } }]}
    outletId="test" token="test" imageGrant="grant" onClose={() => {}} onSaved={(_id, reference) => { image = reference; }}
    onSessionExpired={() => { throw new Error('Unexpected expired bulk session'); }} />);
  await waitFor(() => document.querySelector('.product-image-batch input[type="file"]'), 'bulk picker');
  const zip = new JSZip(); zip.file('Tea.webp', await source.arrayBuffer());
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const files = new DataTransfer(); files.items.add(new File([zipBlob], 'images.zip', { type: 'application/zip' }));
  const bulkInput = document.querySelector<HTMLInputElement>('.product-image-batch input[type="file"]')!;
  bulkInput.files = files.files; bulkInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => !!button('Upload Images') && !button('Upload Images')!.disabled && !!document.querySelector('.batch-image-preview'), 'ZIP prepared');
  button('Upload Images')!.click();
  await waitFor(() => bulkUploads === 1 && document.body.textContent?.includes('Images uploaded successfully'), 'bulk saves filename');
  const bulkBytes = saved!.size;
  root.render(<Product key="bulk-reload" />);
  await waitFor(() => !!document.querySelector<HTMLImageElement>('img')?.naturalWidth, 'bulk result displays');
  const bulkDisplayed = new Uint8Array(await (await nativeFetch(document.querySelector<HTMLImageElement>('img')!.src)).arrayBuffer());
  const bulkSaved = new Uint8Array(await saved!.arrayBuffer());
  assert(bulkDisplayed.length === bulkSaved.length && bulkDisplayed.every((byte, i) => byte === bulkSaved[i]), 'Bulk display uses exact uploaded bytes');
  passed.push('Bulk ZIP uses the same product and WebP source, saves filename-only reference and displays the exact uploaded bytes');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed, singleBytes, bulkBytes, format: saved!.type, uploads, bulkUploads, downloads });
  root.unmount();
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed }); });
