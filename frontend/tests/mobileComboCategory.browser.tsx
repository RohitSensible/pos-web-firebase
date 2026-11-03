import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import { ProductCategoryPicker } from '../src/pages/ProductCategoryPicker.tsx';
import '../src/index.css';
import '../src/App.css';
const checks: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown) { for (let n = 0; n < 200; n++) { if (check()) return; await pause(); } throw new Error('Timed out: ' + check); }
const categories = [{ id: 'combo-category-id', name: 'COMBO' }, { id: 'food-id', name: 'Food' }, { id: 'offers-id', name: 'Special Offers' }];
const fields = Object.freeze({ active: false, category: 'COMBO', type: 2, code: 156, name: 'COMBO 1', shortName: 'C1', price: 0,
  priceTable: '', currentStock: 0, stockable: false, weighable: false, recipeId: 'X5mzZ8NaMZVkxFiuizxe', kitchenId: null, regionalName: null, taxIndex: 0, unitId: 2 });
const products = [{ documentId: 'android-combo', fields },
  { documentId: 'web-combo', fields: { name: 'Web combo', category: 'combo-category-id', code: 155, price: 30 } },
  { documentId: 'food', fields: { name: 'Regular food', category: 'food-id', code: 1, price: 10 } }];
const before = JSON.stringify(products);
let listedProducts = products;
let mode: 'json' | 'stream' = 'json';
window.fetch = async (input, init) => {
  if (init?.method && init.method !== 'GET') throw new Error('Database writes are forbidden in this test');
  const url = new URL(String(input), location.href);
  if (url.pathname.endsWith('/master-sync')) return new Response('', { status: 404 });
  if (url.pathname.endsWith('/categories')) return Response.json({ success: true, data: categories });
  if (url.pathname.endsWith('/products')) return mode === 'json' ? Response.json({ success: true, data: listedProducts })
    : new Response([JSON.stringify({ type: 'items', data: listedProducts }), JSON.stringify({ type: 'end' })].join('\n') + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
  throw new Error('Unexpected read: ' + url.pathname);
};
const root = createRoot(document.getElementById('root')!);
const rows = () => document.querySelector('tbody')?.textContent ?? '';
const tab = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.products-category-tabs button')].find(node => node.textContent === name)!;
void (async () => {
  for (const format of ['json', 'stream'] as const) {
    mode = format;
    flushSync(() => root.render(<ProductsPage key={format} outlet={{ id: 'outlet', name: 'Outlet' }} token={`mock-${format}`} onSessionExpired={() => { throw new Error('Unexpected expiration'); }} />));
    await until(() => rows().includes('COMBO 1') && !!tab('COMBO'));
    tab('COMBO').click(); await until(() => rows().includes('COMBO 1') && !rows().includes('Regular food'));
    assert(rows().includes('Web combo'), `${format}: document-ID and mobile-name products share the COMBO category`);
    assert(document.querySelector('.products-summary-card strong')?.textContent === '2', `${format}: category total includes both products`);
    assert(rows().includes('156'), `${format}: inactive mobile type-2 combo is displayed without changing its active flag`);
    const select = document.querySelector<HTMLSelectElement>('[aria-label="Filter by category"]')!;
    select.value = 'food-id'; select.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => rows().includes('Regular food') && !rows().includes('COMBO 1'));
    select.value = 'combo-category-id'; select.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => rows().includes('COMBO 1') && rows().includes('Web combo'));
    assert(!rows().includes('Regular food'), `${format}: dropdown filtering stays scoped to the selected category`);
    tab('All').click(); await until(() => rows().includes('Regular food'));
    assert(rows().includes('COMBO 1'), `${format}: All still includes the original combo`);
  }
  for (const name of ['Food', 'Special Offers']) {
    // Simulate a new read after an assignment made in the mobile app. No write
    // request is allowed by the fixture, and the original product stays frozen.
    listedProducts = [{ ...products[0]!, fields: { ...fields, category: name } }, ...products.slice(1)];
    flushSync(() => root.render(<ProductsPage key={name} outlet={{ id: 'outlet', name: 'Outlet' }} token={`mock-${name}`} onSessionExpired={() => { throw new Error('Unexpected expiration'); }} />));
    await until(() => rows().includes('COMBO 1') && !!tab(name));
    tab(name).click(); await until(() => rows().includes('COMBO 1') && !rows().includes('Web combo'));
    assert(rows().includes('156'), `Mobile combo displays under ${name}, independently of the category name`);
    assert(listedProducts[0]!.fields.recipeId === 'X5mzZ8NaMZVkxFiuizxe', `${name}: original recipe reference is preserved`);
  }
  root.render(<ProductCategoryPicker products={products} categories={categories} selected={['android-combo']} max={50} search="" disabled={false}
    outletId="outlet" token="mock" onSessionExpired={() => {}} onChange={() => {}} />);
  await until(() => !!document.querySelector('.category-picker-card'));
  const comboGroup = [...document.querySelectorAll('.category-picker-card')].find(node => node.querySelector('.category-picker-name')?.textContent === 'COMBO');
  assert(comboGroup?.textContent?.includes('COMBO 1') && comboGroup.textContent.includes('2 items'), 'Category product picker groups mobile combos correctly too');
  assert(JSON.stringify(products) === before && fields.recipeId === 'X5mzZ8NaMZVkxFiuizxe' && fields.type === 2 && fields.active === false,
    'Read-only categorization preserves every original product field');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
