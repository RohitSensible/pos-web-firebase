/// <reference types="vite/client" />
import { createRoot } from 'react-dom/client';
import { ServicePointsPage } from '../src/pages/ServicePointsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}`); }
const original = { documentId: 'existing', name: 'KOTPRINTER', paperSize: 3, printerType: 1,
  header: 'Kitchen receipt header with a longer business name\nSecond line', subHeader: 'LongPrinterSubHeader'.repeat(8),
  footer: 'Thank you for visiting. Please keep this receipt.', printerIpAddress: '192.168.1.10', port: 9100, usbPath: null };
let records = [original, { ...original, documentId: 'counter', name: 'Counter', paperSize: 2, printerType: 0 }];
const writes: { method: string; body?: Record<string, unknown> }[] = [];
window.fetch = async (url, init) => {
  const path = String(url);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer mock-token', 'Service Point requests preserve authentication');
  assert(path === '/api/outlets/shop/service-points' || path === '/api/outlets/shop/service-points/existing', 'Requests stay in the selected outlet');
  if (init?.method === 'POST') {
    const body = JSON.parse(String(init.body)); writes.push({ method: 'POST', body });
    const { requestId: _requestId, ...fields } = body;
    const saved = { ...fields, documentId: 'created' }; records.push(saved);
    return Response.json({ success: true, data: saved });
  }
  if (init?.method === 'DELETE') {
    writes.push({ method: 'DELETE' }); records = records.filter(row => row.documentId !== 'existing');
    return Response.json({ success: true, data: { documentId: 'existing' } });
  }
  assert(!init?.method || init.method === 'GET', 'Only expected mocked reads occur');
  return Response.json({ success: true, data: { servicePoints: records } });
};
const root = createRoot(document.getElementById('root')!);
root.render(<div className="retail-dashboard-shell"><div className="dashboard-stage"><header className="retail-header">Sensible Connect</header><main className="dashboard-workspace"><ServicePointsPage outlet={{ id: 'shop', name: 'Test outlet' } as OutletSummary} token="mock-token" onSessionExpired={() => { throw new Error('Unexpected expiry'); }} /></main></div></div>);
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
const add = () => document.querySelector<HTMLButtonElement>('[aria-label="Add Service Point"]')!;
const field = (name: string) => document.getElementById(`service-point-${name}`) as HTMLInputElement;
void (async () => {
  await until(() => document.querySelector('.service-points-table tbody tr'), 'records');
  const table = document.querySelector<HTMLElement>('.service-points-table')!;
  const heading = document.querySelector('.service-points-page > .category-header-row')!.getBoundingClientRect();
  assert(document.querySelector('.category-title-group p')?.textContent === 'Manage printers and service points.', 'Existing subtitle is retained');
  assert(table.getBoundingClientRect().top - heading.bottom >= 19, 'Header and records have comfortable separation');
  assert(add().getBoundingClientRect().right <= innerWidth && getComputedStyle(add()).position === 'static' && add().querySelector('span')!.getBoundingClientRect().width > 0, 'Labelled Add Service Point stays accessible at the top right');
  assert([...table.querySelectorAll('th')].map(node => node.textContent).join() === 'Name,Paper Size,Printer Type,Header,Sub Header,Footer,Actions', 'All seven existing columns remain');
  const cells = table.querySelectorAll<HTMLTableCellElement>('tbody tr:first-child td');
  assert(cells[0].textContent === original.name && cells[1].textContent === '3 Inch' && cells[2].textContent === 'Ethernet' && cells[3].textContent === original.header && cells[4].textContent === original.subHeader && cells[5].textContent === original.footer, 'Printer values and long text display unchanged');
  for (const cell of cells) assert(cell.scrollWidth <= cell.clientWidth + 2, 'Cell content wraps without overlapping adjacent fields');
  const mobile = matchMedia('(max-width: 820px), (max-width: 1024px) and (max-height: 600px)').matches;
  if (mobile) {
    assert(getComputedStyle(table.querySelector('tbody tr')!).display === 'grid', 'Existing mobile record layout is preserved');
    assert(cells[3].getBoundingClientRect().width >= table.clientWidth - 40, 'Long printer text uses the mobile card width');
    for (const action of table.querySelectorAll<HTMLButtonElement>('.mobile-record-actions button')) assert(action.getBoundingClientRect().height >= 44 && action.getBoundingClientRect().right <= innerWidth, 'Mobile actions are spaced and easy to tap');
  } else assert(table.querySelector('table')!.getBoundingClientRect().width >= 1120, 'Desktop columns retain comfortable widths rather than squeezing');
  if (location.hash === '#preview') { document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks }); return; }
  add().click(); await until(() => field('name'), 'add form');
  button('Cancel').click(); await until(() => !field('name'), 'cancel add');
  assert(writes.length === 0, 'Cancel add makes no save request');
  add().click(); await until(() => field('name'), 'reopen add');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field('name'), 'New service point');
  field('name').dispatchEvent(new Event('input', { bubbles: true })); await pause();
  document.querySelector<HTMLButtonElement>('.service-point-form-page button[type=submit]')!.click(); await until(() => document.querySelector('.action-confirm-button'), 'add confirmation');
  assert(writes.length === 0, 'Add retains confirmation before saving');
  document.querySelector<HTMLButtonElement>('.action-confirm-button')!.click(); await until(() => document.querySelector('.action-success[open]'), 'created');
  assert(writes.length === 1 && writes[0].body?.paperSize === 2 && writes[0].body?.printerType === 0, 'Valid creation retains printer defaults');
  button('Done').click(); await pause();
  document.querySelector<HTMLButtonElement>('[aria-label="Edit service point KOTPRINTER"]')!.click(); await until(() => field('name'), 'existing edit');
  assert(field('header').value === original.header && field('subHeader').value === original.subHeader, 'Existing edit opens with unchanged printer text');
  button('Cancel').click(); await until(() => !field('name'), 'cancel edit');
  const deleteButton = () => document.querySelector<HTMLButtonElement>('[aria-label="Delete service point KOTPRINTER"]')!;
  deleteButton().click(); await until(() => document.querySelector('.delete-confirmation-confirm'), 'delete confirmation');
  button('Cancel').click(); await pause(); assert(writes.length === 1, 'Cancelling deletion sends no request');
  deleteButton().click(); await until(() => document.querySelector('.delete-confirmation-confirm'), 'reopen delete confirmation');
  document.querySelector<HTMLButtonElement>('.delete-confirmation-confirm')!.click(); await until(() => document.querySelector('.action-success[open]'), 'deleted');
  assert(writes.length === 2 && writes[1].method === 'DELETE' && !deleteButton() && records.some(row => row.documentId === 'counter'), 'Confirmed deletion targets only the existing selected service point');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
