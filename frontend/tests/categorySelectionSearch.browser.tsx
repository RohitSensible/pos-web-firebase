import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ProductCategoryPicker } from '../src/pages/ProductCategoryPicker.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/pages/ProductImageBatch.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
window.fetch = async input => { throw new Error(`Unexpected network request: ${String(input)}`); };
const products = [
  { documentId: 'hidden', fields: { name: 'Tea', category: 'drinks', code: 10 } },
  { documentId: 'apple', fields: { name: 'Apple juice', category: 'drinks', code: 11 } },
  { documentId: 'orange', fields: { name: 'Orange juice', category: 'drinks', code: 12 } },
  { documentId: 'other', fields: { name: 'Water', category: 'removed', code: 99 } },
];
const categories = [{ id: 'drinks', name: 'Drinks' }];
const root = createRoot(document.getElementById('root')!);
let selected: string[] = [], search = 'juice', max = 50, disabled = false, instances = 1, apply = true;
const outputs: string[][] = [];
function View() {
  return <section className="product-image-batch"><details open className="batch-assignment-review"><summary>Review</summary>
    {Array.from({ length: instances }, (_, index) => <ProductCategoryPicker key={index} products={products} categories={categories}
      selected={selected} search={search} max={max} disabled={disabled} outletId="test" token="test"
      onSessionExpired={() => { throw new Error('Unexpected expiry'); }} onChange={next => {
        outputs.push(next);
        if (apply) { selected = next; render(); }
      }} />)}
  </details></section>;
}
const render = () => root.render(<View />);
const update = (options: { selected?: string[]; search?: string; max?: number; disabled?: boolean; instances?: number; apply?: boolean }) => {
  if (options.selected !== undefined) selected = options.selected;
  if (options.search !== undefined) search = options.search;
  if (options.max !== undefined) max = options.max;
  if (options.disabled !== undefined) disabled = options.disabled;
  if (options.instances !== undefined) instances = options.instances;
  if (options.apply !== undefined) apply = options.apply;
  flushSync(render);
};
const card = () => document.querySelector<HTMLElement>('.category-picker-card')!;
const group = () => card().querySelector<HTMLInputElement>('header input')!;
const item = (id: string) => document.querySelector<HTMLInputElement>(`.category-picker-items input[value="${id}"]`)!;
const click = (node: HTMLElement) => flushSync(() => node.click());
// A dispatched click can bypass the browser's disabled-element click() suppression.
const synthetic = (node: HTMLInputElement) => flushSync(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const notice = () => document.querySelector('.category-picker-notice')?.textContent ?? '';

try {
  update({ selected: ['hidden'] });
  assert(!item('hidden') && !!item('apple') && !!item('orange'), 'Search displays only matching products');
  assert(group().getAttribute('aria-label') === 'Select all matching products in Drinks', 'Category checkbox names its matching scope');
  assert(card().querySelector('.category-picker-count')?.textContent === '2 matches'
    && card().querySelector('.category-picker-pill')?.textContent === '0 Matching Selected'
    && !group().checked && !group().indeterminate, 'Matching counts and checkbox ignore hidden selections');
  click(group());
  assert(selected.join() === 'hidden,apple,orange' && group().checked, 'Selecting matches retains hidden selected IDs');
  click(group());
  assert(selected.join() === 'hidden', 'Clearing matches preserves the hidden selection');
  update({ selected: ['hidden', 'apple'] });
  assert(group().indeterminate && !group().checked
    && card().querySelector('.category-picker-pill')?.textContent === '1 Matching Selected', 'Partial matching selection is indeterminate');
  click(group());
  assert(selected.join() === 'hidden,apple,orange' && !group().indeterminate, 'Partial matching selection adds only missing matches');

  update({ selected: ['hidden', 'other'], max: 3 });
  click(group());
  assert(selected.join() === 'hidden,other,apple' && notice().includes('Only 3 products') && notice().includes('1 more was selected'),
    'Category selection counts hidden and other-category selections toward capacity and explains partial selection');
  assert(!item('apple').disabled && item('orange').disabled && group().indeterminate, 'At capacity, selected products remain enabled for deselection');
  click(group());
  assert(selected.join() === 'hidden,other,apple' && notice().includes('0 more were selected'), 'Category additions cannot exceed capacity');
  synthetic(item('orange'));
  assert(selected.join() === 'hidden,other,apple', 'Synthetic product selection cannot exceed capacity');
  click(item('apple'));
  assert(selected.join() === 'hidden,other' && !notice(), 'Product deselection works at capacity and clears the notice');
  update({ selected: ['hidden', 'apple', 'orange'], max: 3 });
  click(group());
  assert(selected.join() === 'hidden', 'Category deselection works at capacity');

  update({ selected: ['hidden', 'hidden', 'apple', 'apple'], max: 3 });
  click(group());
  assert(selected.join() === 'hidden,apple,orange', 'Duplicate incoming IDs consume capacity once and category outputs are unique');
  click(item('apple'));
  assert(selected.join() === 'hidden,orange', 'Individual deselection also returns unique IDs');
  click(item('apple'));
  assert(selected.join() === 'hidden,orange,apple', 'Individual selection adds one ID');

  update({ selected: ['hidden'], apply: false });
  const beforeControlled = outputs.length;
  click(group());
  assert(outputs.length === beforeControlled + 1 && outputs.at(-1)?.join() === 'hidden,apple,orange'
    && !item('apple').checked && !group().checked, 'Selection stays controlled by parent IDs until the parent accepts an update');
  update({ selected: ['orange'], apply: true });
  assert(item('orange').checked && !item('apple').checked && group().indeterminate, 'External parent selection updates immediately drive the controls');

  update({ selected: ['hidden', 'apple'], disabled: true });
  const beforeDisabled = outputs.length;
  assert([...document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('.category-picker input, .category-picker button')]
    .every(node => node.disabled), 'Disabled state disables category, product and expansion controls');
  synthetic(group()); synthetic(item('apple')); synthetic(item('orange'));
  assert(outputs.length === beforeDisabled && selected.join() === 'hidden,apple', 'Disabled handlers reject synthetic category and product changes');
  // Remove the native attribute to exercise the disabled prop guard even if React/browser suppresses disabled dispatches.
  group().disabled = false; item('apple').disabled = false; item('orange').disabled = false;
  synthetic(group()); synthetic(item('apple')); synthetic(item('orange'));
  assert(outputs.length === beforeDisabled, 'Disabled prop guards still reject events when native disabled attributes are bypassed');

  const beforeEmpty = outputs.length;
  update({ disabled: false, selected: ['hidden'], search: 'no such product' });
  assert(!document.querySelector('.category-picker-card') && notice().includes('No products match') && notice().includes('name or code'),
    'No matches offers useful search guidance');
  assert(outputs.length === beforeEmpty && selected.join() === 'hidden', 'No-match search does not change selection');
  update({ search: '  12  ' });
  assert(!!item('orange') && !item('apple') && card().querySelector('.category-picker-count')?.textContent === '1 match',
    'Trimmed code search uses the same matching selection scope');
  update({ search: 'JUICE' });
  assert(!!item('apple') && !!item('orange'), 'Name matching is case insensitive');
  update({ search: 'water' });
  assert(card().querySelector('.category-picker-name')?.textContent === 'Uncategorized', 'Unknown categories retain Uncategorized grouping during search');

  update({ search: '', selected: ['hidden'], max: 50 });
  assert(card().querySelector('.category-picker-count')?.textContent === '3 items'
    && group().getAttribute('aria-label') === 'Select all products in Drinks' && group().indeterminate,
    'Clearing search restores category-wide counts, labels and indeterminate state');
  click(group());
  assert(selected.join() === 'hidden,apple,orange', 'Without search, category selection includes all products in that category');
  click(group());
  assert(selected.length === 0, 'Without search, category deselection clears the full category');

  update({ search: 'juice', selected: ['apple'], instances: 2 });
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.category-picker-toggle')];
  const ids = buttons.map(button => button.getAttribute('aria-controls')!);
  assert(ids.length === 2 && new Set(ids).size === 2, 'Two picker instances have unique ARIA body IDs');
  assert(buttons.every(button => {
    const body = document.getElementById(button.getAttribute('aria-controls')!);
    return body?.closest('.category-picker-card') === button.closest('.category-picker-card');
  }), 'Each instance controls its own category body');
  assert(outputs.every(output => new Set(output).size === output.length), 'Every emitted selection is duplicate free');
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
} catch (error) {
  document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks });
}
