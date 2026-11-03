import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CustomersPage } from '../src/pages/CustomersPage.tsx';
import { EmployeesPage } from '../src/pages/EmployeesPage.tsx';
import { AddProductForm, type CreatedProduct } from '../src/pages/AddProductForm.tsx';
import { UserAccountPage } from '../src/pages/UserAccountPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import { hasUnsavedChanges, requestUnsavedNavigation, UnsavedChangesPrompt } from '../src/utils/unsavedChanges.tsx';
import '../src/index.css';

const passed: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); passed.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 160; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${label}`); }
let writes = 0;
let releaseSave: (() => void) | null = null;
let account = { name: 'Original', email: 'original@example.com', hasLoginPin: true, loginPin: '001234' };
const product: CreatedProduct = { documentId: 'product', fields: { name: 'Original', price: 10, mrpPrice: 10, costPrice: 0, category: 'cat', regionalName: '', discount: 0, shortName: '', taxIndex: 1, unitId: 2, hsnCode: '', weighable: false, stockable: false } };
window.fetch = async (input, init) => {
  const path = String(input);
  if (init?.method === 'POST' || init?.method === 'PATCH') {
    writes++;
    await new Promise<void>(resolve => { releaseSave = resolve; }); releaseSave = null;
    const body = JSON.parse(String(init.body));
    if (path === '/api/auth/account') { account = { ...account, ...body }; return Response.json({ data: account }); }
    if (path.includes('/products')) return Response.json({ data: { documentId: 'saved', fields: { ...product.fields, ...body } } });
    return Response.json({ data: { ...body, documentId: 'saved' } });
  }
  if (path === '/api/auth/account') return Response.json({ data: account });
  if (path.endsWith('/create-options') || path.endsWith('/edit-options')) return Response.json({ data: { code: 10, categories: [{ id: 'cat', name: 'Category' }], taxes: [{ index: 1, percent: 0, type: 0 }], units: [{ id: 2, name: 'Number' }], ...(path.endsWith('/edit-options') ? { product } : {}) } });
  if (path.endsWith('/service-points')) return Response.json({ data: { servicePoints: [] } });
  if (path.endsWith('/customers')) return Response.json({ success: true, data: { customers: [] } });
  if (path.endsWith('/employees')) return Response.json({ data: { employees: [], nextSearchCode: 7, userAccounts: [] } });
  throw new Error(`Unexpected mocked request: ${path}`);
};
const outlet = { id: 'unsaved-test', name: 'Test outlet' } as OutletSummary;
const expired = () => { throw new Error('Unexpected session expiry'); };
const saved = () => {};
type Kind = 'customer' | 'employee' | 'product' | 'edit-product' | 'account';
function Harness({ kind }: { kind: Kind }) {
  const [left, setLeft] = useState(false);
  return <><button id="leave" onClick={() => requestUnsavedNavigation(() => setLeft(true))}>Leave page</button>
    {left ? <p id="left">Left page</p> : kind === 'customer' ? <CustomersPage outlet={outlet} token="mock" onSessionExpired={expired} /> :
      kind === 'employee' ? <EmployeesPage outlet={outlet} token="mock" onSessionExpired={expired} /> :
      kind === 'account' ? <UserAccountPage token="mock" onSessionExpired={expired} onSaved={saved} /> :
      <AddProductForm outletId={outlet.id} token="mock" initialCategory="cat" product={kind === 'edit-product' ? product : undefined} onCancel={() => setLeft(true)} onCreated={() => setLeft(true)} onSessionExpired={expired} />}
    <UnsavedChangesPrompt /></>;
}
let root = createRoot(document.getElementById('root')!);
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
const prompt = () => document.getElementById('unsaved-changes-title');
async function edit(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
}
const names: Record<Kind, string> = { customer: '#customer-name', employee: '#employee-name', product: '#product-name', 'edit-product': '#product-name', account: 'input[name="name"]' };
async function open(kind: Kind) {
  root.unmount(); root = createRoot(document.getElementById('root')!); root.render(<Harness kind={kind} />);
  if (kind === 'customer' || kind === 'employee') {
    const label = kind === 'customer' ? 'Add Customer' : 'Add Employee';
    await until(() => button(label) && !button(label).disabled, 'list'); button(label).click();
  }
  await until(() => document.querySelector(names[kind]), `${kind} draft`);
  if (kind.includes('product')) await until(() => !document.querySelector<HTMLSelectElement>('#product-unitId')?.disabled && document.querySelector<HTMLSelectElement>('#product-unitId')?.value === '2', 'product defaults');
  await pause();
}
void (async () => {
  for (const kind of ['customer', 'employee', 'product', 'edit-product', 'account'] as Kind[]) {
    await open(kind);
    assert(!hasUnsavedChanges(), `${kind}: server values and dynamic defaults are pristine`);
    document.getElementById('leave')!.click(); await until(() => document.getElementById('left'), 'pristine navigation');
    assert(!prompt(), `${kind}: pristine navigation needs no discard`);
    await open(kind);
    if (kind === 'account') { button('Show PIN').click(); await pause(); assert(!hasUnsavedChanges(), 'PIN reveal does not dirty account'); }
    await edit(names[kind], 'Retained draft');
    assert(hasUnsavedChanges(), `${kind}: real edits register dirty state`);
    document.getElementById('leave')!.click(); await until(prompt, 'discard prompt'); button('Stay').click(); await pause();
    assert(document.querySelector<HTMLInputElement>(names[kind])?.value === 'Retained draft', `${kind}: Stay retains exact input`);
    if (kind !== 'account') {
      button('Cancel').click(); await until(prompt, 'Cancel guard'); button('Stay').click(); await pause();
      assert(document.querySelector<HTMLInputElement>(names[kind])?.value === 'Retained draft', `${kind}: explicit Cancel can be declined`);
    }
    if (kind === 'customer') await edit('#customer-contact', '9876543210');
    if (kind === 'employee') await edit('#employee-mobile', '9876543210');
    if (kind === 'product') await edit('#product-price', '10');
    const form = document.querySelector<HTMLFormElement>('form')!;
    form.requestSubmit(); await until(() => document.querySelector('.action-confirm-button'), 'save confirmation');
    button('Cancel').click(); await pause();
    assert(hasUnsavedChanges() && document.querySelector<HTMLInputElement>(names[kind])?.value === 'Retained draft', `${kind}: declined save confirmation retains dirty draft`);
    form.requestSubmit(); await until(() => document.querySelector('.action-confirm-button'), 'save confirmation retry');
    document.querySelector<HTMLButtonElement>('.action-confirm-button')!.click(); await until(() => releaseSave, 'mocked save in flight');
    document.getElementById('leave')!.click(); await until(prompt, 'busy guard');
    assert(button('Discard').disabled, `${kind}: pending save prevents discard`);
    if (kind !== 'employee') button('Stay').click();
    releaseSave!(); await until(() => !hasUnsavedChanges(), 'confirmed save clears guard');
    if (kind === 'employee') assert(!document.getElementById('left'), 'Confirmed save cancels a pending stale navigation callback');
    assert(!prompt(), `${kind}: confirmed mocked save is clean`);
    if (kind === 'account') { document.querySelector<HTMLButtonElement>('.success-done')?.click(); await pause(); }
    document.getElementById('leave')!.click(); await until(() => document.getElementById('left'), 'clean leave');
    assert(!prompt(), `${kind}: navigation after confirmed save needs no discard`);
  }
  await open('employee'); await edit(names.employee, 'Discard me'); button('Cancel').click(); await until(prompt, 'explicit discard'); button('Discard').click();
  await until(() => !document.querySelector(names.employee), 'discard closes form');
  assert(!hasUnsavedChanges() && writes === 5, 'Discard closes the real form without extra writes');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ passed, failed: String(error) }); });
