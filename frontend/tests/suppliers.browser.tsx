import { createRoot } from 'react-dom/client';
import { SuppliersPage } from '../src/pages/SuppliersPage.tsx';
import { GoodsReceivedPage } from '../src/pages/GoodsReceivedPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const passed: string[] = [];
const original = { id: 'S'.repeat(20), name: 'chocolate2', mobile: '5874253698', address: '', alternateNumber: null, email: '', gstin: '' };
const originalJson = JSON.stringify(original);
const records = [original];
const posts: any[] = [];
const patches: any[] = [];
let loseUpdateResponse = true;
let reads = 0, loseResponse = true, failRead = true, expired = false, expiryCalls = 0;
Storage.prototype.setItem = () => { throw new Error('Supplier data must not use browser persistence'); };
window.fetch = async (url, init) => {
  const path = String(url);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Authenticated existing API');
  if (expired) return Response.json({ success: false, message: 'Session expired' }, { status: 401 });
  if (path === `/api/outlets/outlet/suppliers/${'D'.repeat(20)}`) {
    assert(init?.method === 'PATCH', 'Supplier edit uses PATCH with the original document ID');
    const payload = JSON.parse(String(init?.body)); patches.push(payload);
    assert(!('alternateNumber' in payload.fields) && !('id' in payload.fields), 'Receipt snapshot never overwrites alternate number or master identity');
    const current = records[1]!;
    const changes = Object.entries(payload.fields);
    const alreadySaved = changes.every(([key, value]) => current[key as keyof typeof current] === value);
    if (!alreadySaved && changes.some(([key]) => current[key as keyof typeof current] !== payload.previous[key])) {
      return Response.json({ success: false, message: 'Supplier details changed. Close the form, refresh the list and try again.' }, { status: 409 });
    }
    records[1] = { ...current, ...payload.fields };
    if (loseUpdateResponse) { loseUpdateResponse = false; throw new Error('Update response lost after commit'); }
    return Response.json({ success: true, data: { documentId: current.id, fields: { ...records[1], id: null, alternateNumber: '123456' } } });
  }
  if (path.endsWith('/suppliers')) {
    assert(init?.method === 'POST', 'Reuse supplier creation endpoint');
    const payload = JSON.parse(String(init?.body)); posts.push(payload);
    assert(Object.keys(payload.fields).sort().join(',') === 'address,alternateNumber,email,gstin,mobile,name', 'Only existing strict schema fields sent');
    assert(payload.documentId === 'D'.repeat(20), 'Allocated document identifier preserved');
    if (records.length === 1) records.push({ ...payload.fields, id: payload.documentId, alternateNumber: null });
    if (loseResponse) { loseResponse = false; throw new Error('Response lost after commit'); }
    return Response.json({ success: true, data: { documentId: payload.documentId, fields: { ...payload.fields, id: null }, nextDocumentId: 'E'.repeat(20) } });
  }
  assert(!init?.method || init.method === 'GET', 'No goods receipt or other writes');
  if (path.endsWith('/products') || path.endsWith('/categories')) return Response.json({ success: true, data: [] });
  assert(path === '/api/outlets/outlet/goods-received', 'Reuse existing supplier retrieval');
  reads++;
  if (failRead) { failRead = false; return Response.json({ success: false, message: 'Supplier read failed' }, { status: 503 }); }
  return Response.json({ success: true, data: { documentId: 'R'.repeat(20), supplierDraftId: records.length === 1 ? 'D'.repeat(20) : 'E'.repeat(20), suppliers: records, receipts: [] } });
};
const root = createRoot(document.getElementById('root')!);
const props = { outlet: { id: 'outlet', name: 'Test Outlet' } as OutletSummary, token: 'token', onSessionExpired: () => { expiryCalls++; } };
root.render(<SuppliersPage {...props} />);
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}: ${document.body.textContent?.slice(0, 1200)}`); }
const button = (text: string) => {
  const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text);
  assert(node, `Missing button ${text}`); return node!;
};
const input = (label: string) => {
  const node = [...document.querySelectorAll('label')].find(node => node.textContent?.trim() === label)?.querySelector('input');
  assert(node, `Missing input ${label}`); return node!;
};
async function setValue(node: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
  node.dispatchEvent(new Event('input', { bubbles: true })); await pause();
}
void (async () => {
  await until(() => document.querySelector('[role="alert"]'), 'read failure');
  assert(button('Add Supplier').disabled && posts.length === 0, 'Read failure prevents creation with no draft ID');
  button('Retry loading').click(); await until(() => document.querySelector('tbody'), 'existing records');
  assert(document.querySelector('tbody')?.textContent?.includes('chocolate2') && document.querySelector('tbody')?.textContent?.includes('5874253698'), 'Existing screenshot fields displayed');
  if (location.hash === '#preview') { document.getElementById('test-results')!.textContent = JSON.stringify({ passed: ['Suppliers layout'] }); return; }
  assert(posts.length === 0, 'Listing causes no writes');
  await setValue(input('Search suppliers'), 'missing'); assert(document.body.textContent?.includes('No matching suppliers'), 'Search empty state');
  button('Add Supplier').click(); await pause();
  assert(input('Supplier Name *').required && input('Mobile *').required, 'Supported fields are compulsory');
  assert(![...document.querySelectorAll('label')].some(node => /Company Name|Extra|Balance/.test(node.textContent || '')), 'Unsupported fields cannot appear to save');
  assert(document.querySelector('.goods-supplier-dialog')?.textContent?.includes('Company Name, Extra and Balance are unavailable'), 'Unsupported-field limitation explained');
  button('Save Supplier').click(); await pause(); assert(posts.length === 0 && !document.querySelector('.action-confirm-button'), 'Empty required fields blocked');
  await setValue(input('Supplier Name *'), '   '); await setValue(input('Mobile *'), '99999');
  button('Save Supplier').click(); await pause(); assert(posts.length === 0 && document.querySelector('[role="alert"]'), 'Whitespace-only name blocked');
  await setValue(input('Supplier Name *'), ' New Supplier '); await setValue(input('Email ID'), 'invalid');
  button('Save Supplier').click(); await pause(); assert(posts.length === 0 && !document.querySelector('.action-confirm-button'), 'Malformed email blocked');
  await setValue(input('Email ID'), 'supplier@example.com'); button('Cancel').click(); await pause();
  assert(!document.querySelector('.goods-supplier-dialog') && posts.length === 0, 'Cancel saves nothing');
  button('Add Supplier').click(); await pause();
  await setValue(input('Supplier Name *'), ' New Supplier '); await setValue(input('Mobile *'), '99999');
  await setValue(input('Address'), ' Supplier address '); await setValue(input('GSTIN'), 'GST123');
  await setValue(input('Alternate Number'), '123456'); await setValue(input('Email ID'), 'supplier@example.com');
  button('Save Supplier').click(); await until(() => document.querySelector('.action-confirm-button'), 'save confirmation');
  assert(posts.length === 0, 'Confirmation precedes API write');
  document.querySelector<HTMLButtonElement>('.action-confirm-button')!.click();
  await until(() => [...document.querySelectorAll('button')].some(node => node.textContent === 'Retry supplier save'), 'lost response');
  assert(input('Supplier Name *').disabled && button('Cancel').disabled && !document.querySelector('.action-success'), 'Unconfirmed save is locked and has no success');
  button('Retry supplier save').click(); button('Retry supplier save').click();
  await until(() => !document.querySelector('.goods-supplier-dialog') && document.querySelector('tbody')?.textContent?.includes('New Supplier'), 'confirmed list refresh');
  assert(records.length === 2 && posts.length === 2 && JSON.stringify(posts[0]) === JSON.stringify(posts[1]), 'Retry reuses identical request and identifier once');
  assert(posts[0].fields.name === 'New Supplier' && posts[0].fields.address === 'Supplier address' && posts[0].fields.alternateNumber === '123456', 'Trimmed values retain their proper mappings');
  assert(reads === 3 && input('Search suppliers').value === '' && document.querySelector('.action-success'), 'Confirmed save refreshes and reveals new supplier');
  button('Done').click(); await pause();
  document.querySelector<HTMLButtonElement>('[aria-label="Edit supplier New Supplier"]')!.click(); await pause();
  assert(input('Supplier Name *').value === 'New Supplier' && input('Mobile *').value === '99999' && input('GSTIN').value === 'GST123', 'Edit form is prefilled');
  assert(![...document.querySelectorAll('label')].some(node => node.textContent?.includes('Alternate Number')), 'Unloaded master alternate number is preserved');
  button('Update Supplier').click(); await until(() => document.querySelector('.action-confirm-button'), 'unchanged edit confirmation');
  document.querySelector<HTMLButtonElement>('.action-confirm-button')!.click(); await until(() => !document.querySelector('.goods-supplier-dialog'), 'unchanged edit closes');
  assert(patches.length === 0, 'Unchanged edit causes no write');
  document.querySelector<HTMLButtonElement>('[aria-label="Edit supplier New Supplier"]')!.click(); await pause();
  await setValue(input('Supplier Name *'), ' Updated Supplier '); await setValue(input('GSTIN'), 'GST456');
  button('Update Supplier').click(); await until(() => document.querySelector('.action-confirm-button'), 'update confirmation');
  document.querySelector<HTMLButtonElement>('.action-confirm-button')!.click();
  await until(() => [...document.querySelectorAll('button')].some(node => node.textContent === 'Retry supplier save'), 'lost update response');
  assert(input('Supplier Name *').disabled && !document.querySelector('.action-success'), 'Unconfirmed edit stays locked without success');
  button('Retry supplier save').click(); button('Retry supplier save').click();
  await until(() => !document.querySelector('.goods-supplier-dialog') && document.querySelector('tbody')?.textContent?.includes('Updated Supplier'), 'updated list');
  assert(patches.length === 2 && JSON.stringify(patches[0]) === JSON.stringify(patches[1]), 'Update retry uses an identical payload');
  assert(JSON.stringify(patches[0].fields) === JSON.stringify({ name: 'Updated Supplier', gstin: 'GST456' }) && patches[0].previous.name === 'New Supplier', 'Only changed fields are patched with their original values');
  assert(records.length === 2 && records[1]!.id === 'D'.repeat(20), 'Editing preserves supplier document identity');
  button('Done').click(); await pause();
  document.querySelector<HTMLButtonElement>('[aria-label="Edit supplier chocolate2"]')!.click(); await pause();
  await setValue(input('Supplier Name *'), 'Cancelled edit'); button('Cancel').click(); await pause();
  assert(patches.length === 2 && original.name === 'chocolate2', 'Cancelling edit leaves the existing supplier unchanged');
  document.querySelector<HTMLButtonElement>('[aria-label="Edit supplier Updated Supplier"]')!.click(); await pause();
  await setValue(input('Mobile *'), '22222'); records[1] = { ...records[1]!, mobile: '33333' };
  button('Update Supplier').click(); await until(() => document.querySelector('.action-confirm-button'), 'stale edit confirmation');
  document.querySelector<HTMLButtonElement>('.action-confirm-button')!.click();
  await until(() => document.querySelector('[role="alert"]')?.textContent?.includes('Supplier details changed'), 'stale edit conflict');
  assert(!input('Mobile *').disabled && !document.querySelector('.action-success') && records[1]!.mobile === '33333', 'Conflict is shown without overwriting newer values');
  button('Cancel').click(); await pause();
  expired = true; button('Refresh').click(); await until(() => expiryCalls === 1, 'expired authentication');
  expired = false;
  root.render(<GoodsReceivedPage {...props} onCancel={() => {}} />);
  await until(() => document.querySelector('.goods-supplier-select select'), 'Goods Received dropdown');
  assert([...document.querySelectorAll('option')].some(option => option.value === 'D'.repeat(20) && option.textContent === 'Updated Supplier'), 'Edited supplier appears through unchanged Goods Received loading');
  assert(![...document.querySelectorAll('button')].some(node => node.textContent?.trim() === 'Add Supplier'), 'Goods Received creation entry point removed');
  assert(JSON.stringify(original) === originalJson, 'Existing supplier fixture unchanged');
  passed.push('supplier creation and editing, validation, cancellation, no-op edits, lost-response retries, conflict handling, preserved identifiers, list refresh, session expiry and Goods Received integration');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ passed, failed: String(error) }); });
