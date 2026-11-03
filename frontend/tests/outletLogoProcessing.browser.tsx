import { createRoot } from 'react-dom/client';
import { OutletLogoPage } from '../src/pages/OutletLogoPage.tsx';
import { LOGO_MAX_BYTES, processOutletLogo, type LogoPrinterSize } from '../src/pages/outletLogoProcessing.ts';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

document.documentElement.dataset.theme = 'light';
document.body.style.cssText = 'background:var(--workspace);color:var(--ink);padding:20px';
const checks: string[] = [], outputs: { name: string; width: number; height: number; bytes: number }[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown) { for (let n = 0; n < 250; n++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${check}`); }
async function source(type: string, width: number, height: number, transparent = false) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!;
  if (!transparent) { context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); }
  context.fillStyle = '#c31d35'; context.fillRect(transparent ? width / 4 : 0, transparent ? height / 4 : 0, transparent ? width / 2 : width, transparent ? height / 2 : height);
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), type, .92));
  return new File([blob], 'source-logo', { type: blob.type });
}
async function inspect(blob: Blob) {
  const image = await createImageBitmap(blob);
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); image.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const index = (y * canvas.width + x) * 4, red = pixels[index]!;
    if ((red !== 0 && red !== 255) || pixels[index + 1] !== red || pixels[index + 2] !== red || pixels[index + 3] !== 255) throw new Error('Decoded output contains color, gray or transparency');
    if (red === 0) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  }
  return { width: canvas.width, height: canvas.height, contentWidth: right - left + 1, contentHeight: bottom - top + 1, left, right, top, bottom, pixels };
}

const store = new Map<string, { file: Blob; generation: string }>();
const changes: { method: string; variant: string; file?: Blob }[] = [];
let failNext = false;
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href), variant = url.searchParams.get('variant')!;
  if (url.pathname !== '/api/outlets/demo/logo' || !['header', 'footer'].includes(variant)) throw new Error('Unexpected API blocked');
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer mock', 'Existing authenticated logo endpoint is preserved');
  const saved = store.get(variant);
  if (!init?.method) return saved ? new Response(saved.file, { headers: { 'X-Logo-Generation': saved.generation } }) : new Response('', { status: 404 });
  assert(new Headers(init.headers).get('X-Logo-Expected-Generation') === (saved?.generation ?? '0'), 'Existing Storage generation precondition is preserved');
  if (failNext) { failNext = false; return Response.json({ success: false, message: 'Upload failed. Please retry.' }, { status: 503 }); }
  if (init.method === 'PUT') {
    const file = init.body as File;
    assert(file instanceof Blob && file.type === 'image/png' && file.size <= LOGO_MAX_BYTES, 'Only the processed PNG bytes are uploaded');
    store.set(variant, { file, generation: String(Number(saved?.generation ?? 0) + 1) });
    changes.push({ method: 'PUT', variant, file });
  } else if (init.method === 'DELETE') { store.delete(variant); changes.push({ method: 'DELETE', variant }); }
  else throw new Error('Unexpected method blocked');
  return Response.json({ success: true });
};
const card = (variant: string) => document.querySelector<HTMLElement>(`[aria-labelledby="logo-title-${variant}"]`)!;
const button = (variant: string, selector: string) => card(variant).querySelector<HTMLButtonElement>(selector)!;
const dialogButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find(element => element.textContent === text)!;
const image = (variant: string) => card(variant)?.querySelector<HTMLImageElement>('.outlet-logo-final-image, .outlet-logo-preview > img');
const choose = (variant: string, file: File) => {
  const input = card(variant).querySelector<HTMLInputElement>('input[type=file]')!;
  const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const ready = (variant: string, size: LogoPrinterSize) => until(() => card(variant).querySelector('.outlet-logo-processing strong')?.textContent?.includes(`${size}-inch`));
const settle = () => until(() => !document.querySelector('.outlet-logo-preview[aria-busy=true]'));
async function confirmUpload(variant: string, action = 'Update') {
  const review = card(variant).querySelector<HTMLInputElement>('.outlet-logo-quality-warning input');
  if (review && !review.checked) { review.click(); await pause(); }
  button(variant, '.logo-upload').click(); await until(() => !!dialogButton(action)); dialogButton(action).click();
}

void (async () => {
  const colored = await source('image/png', 1600, 800);
  const jpeg = await source('image/jpeg', 900, 1200);
  const transparent = await source('image/png', 800, 400, true);
  for (const [name, file, size] of [['large colored PNG', colored, 2], ['large JPEG', jpeg, 3], ['transparent PNG', transparent, 2], ['WebP', await source('image/webp', 1200, 600), 3]] as const) {
    const result = await processOutletLogo(file, size), decoded = await inspect(result.file);
    assert(decoded.width === (size === 2 ? 220 : 280) && decoded.height === (size === 2 ? 200 : 250), `${name}: correct printer canvas`);
    assert(result.file.size <= LOGO_MAX_BYTES, `${name}: actual output is within 10 KB and only black/white`);
    if (name === 'large colored PNG' || name === 'transparent PNG') assert(Math.abs(decoded.contentWidth / decoded.contentHeight - 2) < .05, `${name}: original content aspect ratio is preserved`);
    if (name === 'transparent PNG') assert(decoded.pixels[0] === 255 && decoded.pixels[3] === 255, 'Transparent background becomes opaque white');
    assert(Math.abs(decoded.left - (decoded.width - decoded.right - 1)) <= 1 && Math.abs(decoded.top - (decoded.height - decoded.bottom - 1)) <= 1, `${name}: content is centered`);
    outputs.push({ name, width: decoded.width, height: decoded.height, bytes: result.file.size });
  }
  const noise = document.createElement('canvas'); noise.width = 280; noise.height = 250;
  const context = noise.getContext('2d')!, pixels = context.createImageData(280, 250);
  crypto.getRandomValues(pixels.data.subarray(0, 65_536)); crypto.getRandomValues(pixels.data.subarray(65_536, 131_072)); crypto.getRandomValues(pixels.data.subarray(131_072, 196_608)); crypto.getRandomValues(pixels.data.subarray(196_608, 262_144)); crypto.getRandomValues(pixels.data.subarray(262_144));
  for (let n = 3; n < pixels.data.length; n += 4) pixels.data[n] = 255;
  context.putImageData(pixels, 0, 0);
  const noiseBlob = await new Promise<Blob>(resolve => noise.toBlob(value => resolve(value!), 'image/png'));
  const noisy = await processOutletLogo(new File([noiseBlob], 'noise.png', { type: 'image/png' }), 3);
  await inspect(noisy.file);
  assert(noisy.file.size === 9068, 'Noisy images still fit 10 KB without lowering resolution');
  assert(noisy.qualityWarnings.some(warning => warning.includes('noise')), 'Heavy texture is flagged instead of silently approved as clean artwork');
  outputs.push({ name: 'high-entropy PNG', width: noisy.width, height: noisy.height, bytes: noisy.file.size });
  const padded = document.createElement('canvas'); padded.width = 1000; padded.height = 1000;
  const textContext = padded.getContext('2d')!;
  textContext.fillStyle = '#fff'; textContext.fillRect(0, 0, 1000, 1000);
  textContext.fillStyle = '#111'; textContext.fillRect(350, 400, 300, 200);
  textContext.font = '22px sans-serif';
  textContext.fillText('FULL HEADER', 350, 365);
  textContext.fillText('ENTIRE FOOTER TEXT', 350, 665);
  textContext.fillStyle = '#fff'; textContext.font = '24px sans-serif';
  textContext.fillText('WHITE LETTERING', 370, 470);
  const paddedBlob = await new Promise<Blob>(resolve => padded.toBlob(value => resolve(value!), 'image/png'));
  const textLogo = await processOutletLogo(new File([paddedBlob], 'text-logo.png', { type: 'image/png' }), 3);
  const enlarged = await inspect(textLogo.file);
  assert(enlarged.contentWidth > 200, '3-inch output uses blank outer margins to give lettering more printer dots');
  let headerPixels = 0, footerPixels = 0;
  for (let y = 0; y < enlarged.height; y++) for (let x = 0; x < enlarged.width; x++) {
    if (enlarged.pixels[(y * enlarged.width + x) * 4] === 0) {
      if (y < 25) headerPixels++;
      if (y >= enlarged.height - 25) footerPixels++;
    }
  }
  assert(headerPixels > 10 && footerPixels > 10, 'Detached header and footer text remains visible after removing blank margins');
  assert(textLogo.file.size <= LOGO_MAX_BYTES, 'Sharper complete text remains pure monochrome and within 10 KB');
  const smallLogo = await processOutletLogo(await source('image/png', 64, 64), 3);
  const smallOutput = await inspect(smallLogo.file);
  assert(smallOutput.contentWidth === 250 && smallOutput.contentHeight === 250, 'Small 3-inch artwork fills the available canvas without distortion');
  assert(smallLogo.qualityWarnings.some(warning => warning.includes('smaller')), 'Low-resolution sources receive an honest quality warning');
  const regionalCanvas = document.createElement('canvas'); regionalCanvas.width = 1400; regionalCanvas.height = 800;
  const regionalContext = regionalCanvas.getContext('2d')!;
  regionalContext.fillStyle = '#fff'; regionalContext.fillRect(0, 0, 1400, 800);
  regionalContext.fillStyle = '#183c68'; regionalContext.fillRect(100, 100, 1200, 600);
  regionalContext.fillStyle = '#fff'; regionalContext.font = 'bold 110px "Samyak Devanagari", sans-serif';
  regionalContext.fillText('शिवराज ढाबा', 200, 310);
  regionalContext.font = 'bold 76px serif'; regionalContext.fillText('FAMILY RESTAURANT', 200, 450);
  regionalContext.font = '42px sans-serif'; regionalContext.fillText('Fresh food · Warm hospitality', 200, 570);
  const regionalBlob = await new Promise<Blob>(resolve => regionalCanvas.toBlob(value => resolve(value!), 'image/png'));
  const regionalFile = new File([regionalBlob], 'regional-logo.png', { type: 'image/png' });
  const regional = await processOutletLogo(regionalFile, 3);
  const regionalOutput = await inspect(regional.file);
  assert(regionalOutput.contentWidth > 200 && regionalOutput.contentHeight > 80, 'Marathi and Latin glyph artwork is preserved without OCR or font replacement');
  assert(!regional.qualityWarnings.some(warning => warning.includes('blurry')), 'Crisp high-resolution lettering is not labelled blurry');
  const softCanvas = document.createElement('canvas'); softCanvas.width = 1400; softCanvas.height = 800;
  const softContext = softCanvas.getContext('2d')!; softContext.filter = 'blur(12px)'; softContext.drawImage(regionalCanvas, 0, 0);
  const softBlob = await new Promise<Blob>(resolve => softCanvas.toBlob(value => resolve(value!), 'image/jpeg', .7));
  const softFile = new File([softBlob], 'blurry-logo.jpg', { type: 'image/jpeg' });
  const soft = await processOutletLogo(softFile, 3), softOutput = await inspect(soft.file);
  assert(soft.qualityWarnings.some(warning => warning.includes('blurry')), 'Blurry input is warned about rather than claimed to be recovered');
  let retainedLightStrokes = 0;
  for (let y = 90; y < 170; y++) for (let x = 70; x < 210; x++) if (softOutput.pixels[(y * softOutput.width + x) * 4] === 255) retainedLightStrokes++;
  assert(retainedLightStrokes > 30, 'Soft-source conversion retains visible light lettering instead of flattening it to black');
  outputs.push({ name: 'Marathi and Latin text', width: regional.width, height: regional.height, bytes: regional.file.size },
    { name: 'blurry JPEG (review required)', width: soft.width, height: soft.height, bytes: soft.file.size });
  const textureCanvas = document.createElement('canvas'); textureCanvas.width = 600; textureCanvas.height = 600;
  const textureContext = textureCanvas.getContext('2d')!;
  textureContext.fillStyle = '#fff'; textureContext.fillRect(0, 0, 600, 600);
  for (let y = 30; y < 570; y += 2) for (let x = 30; x < 570; x += 2) {
    const noise = (x * 71 + y * 37) % 110;
    const border = x < 60 || x >= 540 || y < 60 || y >= 540;
    textureContext.fillStyle = border ? `rgb(${180 + noise % 75},${145 + noise % 65},5)` : `rgb(${120 + noise},${10 + noise % 35},5)`;
    textureContext.fillRect(x, y, 2, 2);
  }
  for (let y = 400; y < 500; y += 2) for (let x = 80; x < 520; x += 2) {
    textureContext.fillStyle = `rgb(245,${140 + (x * 7 + y * 11) % 45},20)`;
    textureContext.fillRect(x, y, 2, 2);
  }
  textureContext.fillStyle = '#faf00a'; textureContext.fillRect(180, 420, 250, 70);
  textureContext.fillStyle = '#fff'; textureContext.font = 'bold 64px "Samyak Devanagari", sans-serif';
  textureContext.fillText('शिवराज ढाबा', 100, 280);
  textureContext.fillStyle = '#fff000'; textureContext.font = 'bold 30px "Samyak Devanagari", sans-serif';
  textureContext.fillText('शुद्ध शाकाहारी', 170, 170);
  textureContext.font = 'bold 24px "Samyak Devanagari", sans-serif'; textureContext.fillText('अस्सल मराठी जेवण', 120, 530);
  const textureBlob = await new Promise<Blob>(resolve => textureCanvas.toBlob(value => resolve(value!), 'image/png'));
  const textureFile = new File([textureBlob], 'textured-logo.png', { type: 'image/png' });
  const textureResult = await processOutletLogo(textureFile, 2), textureOutput = await inspect(textureResult.file);
  assert(textureResult.qualityWarnings.some(warning => warning.includes('Colour texture')), 'Colour-texture cleanup requires comparison with the original before upload');
  let speckles = 0;
  for (let y = 140; y < 165; y++) for (let x = 60; x < 160; x++) if (textureOutput.pixels[(y * 220 + x) * 4] === 255) speckles++;
  assert(speckles === 0, 'Textured red areas print as solid black instead of scattered dots');
  outputs.push({ name: 'textured colour logo', width: textureResult.width, height: textureResult.height, bytes: textureResult.file.size });
  store.set('header', { file: colored, generation: '1' }); store.set('footer', { file: jpeg, generation: '2' });
  createRoot(document.getElementById('root')!).render(<OutletLogoPage outletId="demo" outletName="OTP" token="mock" />);
  await until(() => image('header') && image('footer')); await settle();
  assert(changes.length === 0, 'Existing colored logos display without rewriting them');
  const savedHeaderSource = image('header')!.src;
  choose('header', new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'oversize.png', { type: 'image/png' }));
  await until(() => card('header').querySelector('[role=alert]')?.textContent?.includes('5 MB'));
  assert(changes.length === 0 && image('header')!.src === savedHeaderSource, 'Oversized input cannot replace the saved logo');
  choose('header', colored); await ready('header', 2);
  assert(changes.length === 0 && image('header')?.alt.includes('processed preview'), 'Processing shows the final preview before any upload');
  assert(card('header').querySelectorAll('.outlet-logo-comparison').length === 2 && card('header').querySelector('img[alt$="original"]'), 'Original and enhanced images appear side by side');
  assert(card('header').textContent?.includes('220 × 200 px') && card('header').textContent?.includes('5.73 KB'), 'Final dimensions and actual file size are displayed');
  card('header').querySelector<HTMLInputElement>('.outlet-logo-quality-warning input')!.click(); await pause();
  button('header', '[aria-pressed=false]').click(); await ready('header', 3);
  assert(!card('header').querySelector<HTMLInputElement>('.outlet-logo-quality-warning input')!.checked, 'Changing printer size requires a fresh quality review of the new result');
  assert(card('header').textContent?.includes('280 × 250 px') && card('header').textContent?.includes('8.86 KB'), 'Changing printer size reprocesses the original before upload');
  assert(button('footer', '[aria-pressed=true]').textContent?.includes('2-inch'), 'Header and footer printer choices are independent');
  const qualityReview = card('header').querySelector<HTMLInputElement>('.outlet-logo-quality-warning input')!;
  assert(!!qualityReview && button('header', '.logo-upload').disabled, 'Quality warnings block upload until explicitly acknowledged');
  qualityReview.click(); await pause();
  button('header', '.logo-upload').click(); await until(() => !!dialogButton('Update')); dialogButton('Cancel').click(); await pause();
  assert(changes.length === 0 && !!card('header').querySelector('.outlet-logo-processing'), 'Cancelling confirmation keeps the processed preview without uploading');
  await confirmUpload('header'); await until(() => !!dialogButton('Done')); dialogButton('Done').click(); await settle();
  assert(changes.length === 1 && changes[0]!.variant === 'header' && store.get('footer')!.generation === '2', 'Header upload preserves the saved footer');
  const saved = await inspect(store.get('header')!.file); assert(saved.width === 280 && saved.height === 250, 'Saved bytes match the selected printer profile');
  choose('header', new File(['invalid'], 'bad.png', { type: 'image/png' }));
  await until(() => !!card('header').querySelector('[role=alert]'));
  assert(changes.length === 1 && !card('header').querySelector('.outlet-logo-processing') && !!image('header'), 'Failed processing preserves the saved logo and sends no upload');
  choose('footer', transparent); await ready('footer', 2);
  failNext = true; await confirmUpload('footer'); await until(() => card('footer').querySelector('[role=alert]')?.textContent?.includes('Upload failed')); await settle();
  assert(store.get('footer')!.file === jpeg && changes.length === 1, 'A failed upload leaves the existing saved footer unchanged');
  await confirmUpload('footer'); await until(() => !!dialogButton('Done')); dialogButton('Done').click(); await settle();
  assert(changes.length === 2 && changes[1]!.variant === 'footer' && store.get('header')!.generation === '2', 'Footer retry uses the existing mechanism without touching header');
  const finalFooter = await inspect(store.get('footer')!.file); assert(finalFooter.width === 220 && finalFooter.height === 200, 'Footer uses its own 2-inch output');
  button('footer', '.logo-remove').click(); await until(() => !!dialogButton('Remove')); dialogButton('Remove').click(); await until(() => !!dialogButton('Done')); dialogButton('Done').click(); await settle();
  assert(!store.has('footer') && store.has('header') && button('footer', '.logo-remove').disabled, 'Existing removal still affects only its selected logo');
  choose('footer', colored); await ready('footer', 2); await confirmUpload('footer', 'Add'); await until(() => !!dialogButton('Done')); dialogButton('Done').click(); await settle();
  assert(store.has('footer') && changes.length === 4, 'Re-upload after removal still works');
  assert(savedHeaderSource !== image('header')!.src, 'Successful upload refreshes the saved preview');
  assert([...document.querySelectorAll('.outlet-logo-actions button')].every(element => { const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }), 'Existing action buttons fit the viewport');
  if (location.hash === '#preview') { choose('header', textureFile); await ready('header', 3); choose('footer', regionalFile); await ready('footer', 2); }
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, outputs, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), outputs, checks }); });
