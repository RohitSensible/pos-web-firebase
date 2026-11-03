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
  { productId: 'bafebe9cf04910913152', name: 'Included A', available: true, quantity: 1, price: 715, unitId: 2, unitName: 'NUMBER' },
  { productId: '105ee9ebee16691d00d8', name: 'Included B', available: true, quantity: 1, price: 700, unitId: 2, unitName: 'NUMBER' },
] };
const original = JSON.stringify({ combo, details });
let mode: 'success' | 'failure' | 'empty' | 'expired' | 'hold' = 'success';
let writes = 0, failSave = false;
const expectedItems: Record<string, unknown>[] = [{ sourceIndex: 0, quantity: 2, price: 720 }, { sourceIndex: 1, quantity: 1, price: 715 }, { sourceIndex: 2, quantity: 1, price: 700 }];
let expired = 0, detailReads = 0, release: ((response: Response) => void) | null = null;
let heldSignal: AbortSignal | null = null;
window.fetch = async (input, init) => {
  if (init?.method === 'PATCH') {
    writes++;
    const body = JSON.parse(String(init.body));
    assert(body.recipeId === details.recipeId && body.revision === details.revision, 'Save targets the reviewed existing recipe revision');
    assert(body.items.length === expectedItems.length && body.items.every((row: Record<string, unknown>, index: number) => Object.keys(row).length === Object.keys(expectedItems[index]!).length && Object.entries(expectedItems[index]!).every(([key, value]) => row[key] === value)), 'Save changes only the edited row and preserves duplicate entries');
    return failSave ? Response.json({ success: false, message: 'Save failed. Try again.' }, { status: 503 }) : Response.json({ success: true });
  }
  if (init?.method && init.method !== 'GET') throw new Error('Unexpected mutation');
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
  assert(rows()![0]!.querySelectorAll('input')[1]!.value === '715' && rows()![2]!.querySelectorAll('input')[1]!.value === '700', 'Stored recipe prices populate editable inputs');
  assert(rows()![0]!.querySelector('input')!.value === '1' && !dialog()!.textContent?.includes('Unit'), 'Quantity is editable and Unit column is removed');
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
  const setValue = (input: HTMLInputElement, value: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); };
  const saveButton = () => [...dialog()!.querySelectorAll<HTMLButtonElement>('footer button')].find(button => button.textContent === 'Save')!;
  assert(saveButton().disabled, 'Unchanged recipe cannot be saved');
  setValue(rows()![0]!.querySelector('input')!, '0'); await pause();
  assert(saveButton().disabled, 'Zero quantities cannot be saved');
  setValue(rows()![0]!.querySelector('input')!, '2');
  setValue(rows()![0]!.querySelectorAll('input')[1]!, '720'); await pause();
  failSave = true; saveButton().click(); await until(() => dialog()?.textContent?.includes('Save failed'));
  assert(rows()![0]!.querySelector('input')!.value === '2', 'Failed save retains editable values');
  failSave = false; saveButton().click(); await until(() => document.querySelector('.action-success')?.textContent?.includes('Updated successfully.'));
  assert(writes === 2 && document.querySelector('.action-success')!.querySelectorAll('.modal-footer button').length === 1, 'Successful save shows a single Done action');
  document.querySelector<HTMLButtonElement>('.action-success .success-done')!.click(); await until(() => !document.querySelector('.action-success'));
  if (location.hash === '#preview') { mode = 'success'; opener().click(); await until(() => rows()?.length === 3); }
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
