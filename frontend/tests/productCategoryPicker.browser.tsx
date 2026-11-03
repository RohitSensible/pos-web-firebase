import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useState } from 'react';
import { ProductCategoryPicker } from '../src/pages/ProductCategoryPicker.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/pages/ProductImageBatch.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const canvas = document.createElement('canvas'); canvas.width = canvas.height = 40;
const context = canvas.getContext('2d')!; context.fillStyle = '#f59e0b'; context.fillRect(0, 0, 40, 40);
const png = new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
window.fetch = async input => {
  if (String(input).endsWith('/image')) return new Response(await png, { headers: { 'Content-Type': 'image/png' } });
  throw new Error(`Unexpected request: ${String(input)}`);
};
const product = (id: string, name: string, category: string, code: number, price: number, image?: string) =>
  ({ documentId: id, fields: { name, category, code, price, ...(image ? { image } : {}) } });
const products = [
  product('p1', 'Paneer Tikka', 'starters', 41, 240, 'paneer.png'), product('p2', 'Veg Spring Roll', 'starters', 42, 180),
  product('p3', 'Chicken 65', 'starters', 43, 260), product('m1', 'Butter Chicken', 'mains', 51, 320),
  product('m2', 'Dal Makhani', 'mains', 52, 210), product('x1', 'Water Bottle', 'removed-category', 90, 20),
];
const categories = [{ id: 'starters', name: 'Starters & Appetizers' }, { id: 'mains', name: 'Main Course' }];
let current: string[] = [];
function Harness({ max, search, initial }: { max: number; search: string; initial: string[] }) {
  const [selected, setSelected] = useState(initial); current = selected;
  return <section className="product-image-batch"><details className="batch-assignment-review" open>
    <summary>Review</summary>
    <ProductCategoryPicker products={products} categories={categories} selected={selected} max={max} search={search} disabled={false}
      outletId="o" token="t" onSessionExpired={() => { throw new Error('Unexpected expiry'); }} onChange={setSelected} />
  </details></section>;
}
const root = createRoot(document.getElementById('root')!);
const render = (max = 50, search = '', initial: string[] = []) => flushSync(() => root.render(<Harness key={`${max}:${search}:${initial.join()}`} max={max} search={search} initial={initial} />));
const card = (name: string) => [...document.querySelectorAll<HTMLElement>('.category-picker-card')].find(node => node.querySelector('.category-picker-name')?.textContent === name)!;
const all = (name: string) => card(name).querySelector<HTMLInputElement>('header input')!;
const pill = (name: string) => card(name).querySelector('.category-picker-pill')!.textContent;
const item = (id: string) => document.querySelector<HTMLInputElement>(`.category-picker-items input[value="${id}"]`);
const expand = (name: string) => { flushSync(() => card(name).querySelector<HTMLButtonElement>('.category-picker-toggle')!.click()); };
const click = (input: HTMLInputElement) => flushSync(() => input.click());

void (async () => {
  if (location.hash === '#preview') {
    render(50, '', ['p1', 'p3']); await pause(400);
    document.body.style.background = '#f5f7f9'; document.getElementById('root')!.style.padding = '24px';
    document.getElementById('test-results')!.textContent = JSON.stringify({ passed: ['Preview'] });
    document.getElementById('test-results')!.style.display = 'none';
    return;
  }
  render();
  const names = [...document.querySelectorAll('.category-picker-name')].map(node => node.textContent);
  assert(names.join() === 'Starters & Appetizers,Main Course,Uncategorized', 'Products are grouped by category; unknown categories go to Uncategorized');
  assert(card('Starters & Appetizers').querySelector('.category-picker-count')?.textContent === '3 items' && pill('Main Course') === '0 Selected', 'Headers show item counts and a selection pill');
  assert(!item('p1') && card('Main Course').querySelector('.category-picker-toggle')?.getAttribute('aria-expanded') === 'false', 'Categories start collapsed when nothing is selected');

  click(all('Starters & Appetizers'));
  assert(current.join() === 'p1,p2,p3' && pill('Starters & Appetizers') === '3 Selected' && all('Starters & Appetizers').checked, 'Category checkbox selects every product in that category and updates the pill');
  assert(pill('Main Course') === '0 Selected', 'Other categories are untouched');
  expand('Starters & Appetizers');
  assert(item('p2')?.checked && card('Starters & Appetizers').querySelectorAll('.category-picker-status.ready').length === 3, 'Selected products show Ready for Apply');
  click(item('p2')!);
  assert(!all('Starters & Appetizers').checked && all('Starters & Appetizers').indeterminate && pill('Starters & Appetizers') === '2 Selected',
    'Unchecking one product unchecks the category checkbox and updates the count');
  assert(current.join() === 'p1,p3', 'Selection keeps the remaining products');
  click(all('Starters & Appetizers'));
  assert(current.length === 3 && all('Starters & Appetizers').checked && !all('Starters & Appetizers').indeterminate, 'A partly selected category becomes fully selected');
  click(all('Starters & Appetizers'));
  assert(current.length === 0 && pill('Starters & Appetizers') === '0 Selected', 'Category checkbox clears all its products');

  const statuses = [...card('Starters & Appetizers').querySelectorAll('li')].map(node => node.querySelector('.category-picker-status')!.textContent);
  assert(statuses.join() === 'Has Image,No Image,No Image', 'Untouched products show their current image status');
  const row = card('Starters & Appetizers').querySelector('li')!.textContent!;
  assert(row.includes('Paneer Tikka') && row.includes('Code: 41') && row.includes('₹240'), 'Rows show name, code and price');
  for (let i = 0; i < 100 && !card('Starters & Appetizers').querySelector('li img'); i++) await pause();
  assert(card('Starters & Appetizers').querySelector('li img') && card('Starters & Appetizers').querySelectorAll('.category-picker-placeholder').length === 2,
    'Saved images show a thumbnail; others show a placeholder');
  expand('Starters & Appetizers');
  assert(!item('p1'), 'Chevron collapses a category');

  render(2, '', ['m1']);
  click(all('Starters & Appetizers'));
  assert(current.join() === 'm1,p1' && document.querySelector('.category-picker-notice')?.textContent?.includes('Only 2 products'), 'Category select-all respects the 50-product limit and explains it');
  assert(card('Main Course').querySelector('.category-picker-toggle')?.getAttribute('aria-expanded') === 'true', 'Categories holding a selection start expanded');

  render(50, 'dal');
  assert([...document.querySelectorAll('.category-picker-name')].map(node => node.textContent).join() === 'Main Course' && item('m2') && !item('m1'),
    'Search shows only matching products and opens their category');
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
