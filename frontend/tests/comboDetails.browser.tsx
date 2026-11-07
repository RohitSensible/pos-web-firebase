import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';
document.documentElement.dataset.theme = 'light';
document.body.style.cssText = 'background:var(--workspace);padding:20px';
const checks: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown) { for (let n = 0; n < 200; n++) { if (check()) return; await pause(); } throw new Error('Timed out: ' + check); }
const combo = Object.freeze({ documentId: 'combo', fields: { category: 'Special Offers', name: 'COMBO 1', code: 156, active: false, type: 2, recipeId: 'X5mzZ8NaMZVkxFiuizxe', price: 0, priceTable: '' } });
const details = { documentId: 'combo', name: 'COMBO 1', recipeId: 'X5mzZ8NaMZVkxFiuizxe', revision: 'a'.repeat(64), items: [
  { productId: 'bafebe9cf04910913152', name: 'Included A', available: true, quantity: 1, price: 715, unitId: 2, unitName: 'NUMBER' },
  { productId: 'bafebe9cf04910913152', name: 'Included A', available: true, quantity: 2, price: 500, unitId: 2, unitName: 'NUMBER' },
  { productId: '105ee9ebee16691d00d8', name: 'Included B', available: true, quantity: 0.5, price: 0, unitId: 2, unitName: 'NUMBER' },
] };
const original = JSON.stringify({ combo, details });
let mode: 'success' | 'failure' | 'empty' | 'expired' | 'hold' = 'success';
let writes = 0;
let expired = 0, detailReads = 0, release: ((response: Response) => void) | null = null;
let heldSignal: AbortSignal | null = null;
window.fetch = async (input, init) => {
  if (init?.method && init.method !== 'GET') {
    writes++;
    throw new Error('View-only combo details must never send a mutation');
  }
  const url = new URL(String(input), location.href);
  if (url.pathname.endsWith('/master-sync')) return new Response('', { status: 404 });
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer mock', 'Read uses existing authentication');
  if (url.pathname === '/api/outlets/outlet/categories') return Response.json({ success: true, data: [{ id: 'offers-id', name: 'Special Offers' }] });
  if (url.pathname === '/api/outlets/outlet/products') return Response.json({ success: true, data: [combo, { documentId: 'regular', fields: { name: 'Regular product', category: 'offers-id', type: 0, unitId: 2, price: 25 } }] });
  if (url.pathname === '/api/outlets/outlet/products/combo/combo') {
    detailReads++;
    if (mode === 'hold') { heldSignal = init?.signal ?? null; return new Promise<Response>(resolve => { release = resolve; }); }
    if (mode === 'failure') return Response.json({ success: false, message: 'Unable to load the saved recipe.' }, { status: 503 });
    if (mode === 'expired') return Response.json({ success: false }, { status: 401 });
    return Response.json({ success: true, data: mode === 'empty' ? { ...details, items: [] } : details });
  }
  throw new Error('Unexpected endpoint: ' + url.pathname);
};
const root = createRoot(document.getElementById('root')!);
root.render(<ProductsPage outlet={{ id: 'outlet', name: 'Outlet' }} token="mock" onSessionExpired={() => { expired++; }} />);
const opener = () => document.querySelector<HTMLButtonElement>('[aria-label="View products in COMBO 1"]')!;
const dialog = () => document.querySelector<HTMLDialogElement>('.combo-details-modal[open]');
const close = () => dialog()!.querySelector<HTMLButtonElement>('footer button')!.click();
const rows = () => dialog()?.querySelectorAll('tbody tr');
void (async () => {
  await until(() => !!opener());
  [...document.querySelectorAll<HTMLButtonElement>('.products-category-tabs button')].find(button => button.textContent === 'Special Offers')!.click();
  await until(() => !!opener()); opener().click(); await until(() => rows()?.length === 3);
  assert(dialog()?.textContent?.includes('COMBO 1'), 'Clicking a combo in its assigned category opens its details');
  assert(rows()![0]!.textContent?.includes('Included A') && rows()![1]!.textContent?.includes('Included A') && rows()![2]!.textContent?.includes('Included B'), 'Every saved row is shown, including duplicate product IDs');
  assert([...rows()!].map(row => row.children[1]!.textContent).join(',') === '1,2,0.5', 'Stored quantities display as text, including separate duplicate rows and decimals');
  assert([...rows()!].map(row => row.children[2]!.textContent).join(',') === '715,500,0', 'Stored prices display unchanged as text, including zero');
  assert(!dialog()!.querySelector('input, select, textarea, [contenteditable="true"]') && !dialog()!.textContent?.includes('Unit'), 'Combo details contain no editable fields');
  assert(dialog()!.querySelectorAll('footer button').length === 1 && dialog()!.querySelector('footer button')?.textContent === 'Close', 'Close is the only footer action; no Save is available');
  assert(!dialog()!.querySelector('[aria-label="Product to add"]') && !dialog()!.querySelector('input[type="search"]') && ![...dialog()!.querySelectorAll('button')].some(button => /^(Add product|Remove)$/.test(button.textContent ?? '')), 'Combo shows existing products without add or remove controls');
  assert(!document.querySelector('[aria-label="View products in Regular product"]'), 'Ordinary products retain their existing controls');
  assert(dialog()!.getBoundingClientRect().width <= innerWidth, 'Details dialog fits the viewport');
  assert(getComputedStyle(rows()![0]!.children[0]!).color === 'rgb(23, 25, 28)', 'Table text stays readable in the light theme');
  document.documentElement.dataset.theme = 'dark'; await pause();
  assert(getComputedStyle(rows()![0]!.children[0]!).color === 'rgb(229, 237, 247)', 'Table text follows the existing dark theme');
  document.documentElement.dataset.theme = 'light'; await pause();
  close(); await until(() => !dialog());
  assert(document.activeElement === opener(), 'Closing restores focus to the selected combo');
  mode = 'failure'; opener().click(); await until(() => !!dialog()?.querySelector('[role=alert]'));
  assert(dialog()?.textContent?.includes('Unable to load the saved recipe'), 'Read failures show the error without claiming empty contents');
  mode = 'success'; [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Retry')!.click(); await until(() => rows()?.length === 3);
  assert(detailReads === 3, 'Retry repeats only the read request');
  dialog()!.dispatchEvent(new Event('cancel', { cancelable: true })); await until(() => !dialog());
  assert(!dialog(), 'Native dialog cancellation dismisses the details');
  mode = 'empty'; opener().click(); await until(() => !!dialog()?.textContent?.includes('no saved products'));
  assert(!rows()?.length, 'Empty recipe is represented explicitly'); close(); await until(() => !dialog());
  mode = 'expired'; opener().click(); await until(() => expired === 1); close(); await until(() => !dialog());
  assert(expired === 1, 'Expired session uses the existing session-expiry callback');
  mode = 'hold'; opener().click(); await until(() => !!release);
  close(); await until(() => !dialog());
  assert(heldSignal?.aborted, 'Closing during loading aborts the request');
  release!(Response.json({ success: true, data: details })); await pause();
  assert(!dialog(), 'Late responses cannot reopen the dialog');
  assert(JSON.stringify({ combo, details }) === original, 'Opening, retrying and closing details never change stored product or recipe values');
  mode = 'success'; opener().click(); await until(() => rows()?.length === 3);
  assert(!dialog()!.querySelector('input, select, textarea') && writes === 0, 'Reopening the combo remains view-only with no writes');
  dialog()!.querySelector<HTMLButtonElement>('[aria-label="Close combo details"]')!.click(); await until(() => !dialog());
  assert(writes === 0 && JSON.stringify({ combo, details }) === original, 'All combo interactions preserve stored data and issue only GET requests');
  if (location.hash === '#preview') { mode = 'success'; opener().click(); await until(() => rows()?.length === 3); }
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
