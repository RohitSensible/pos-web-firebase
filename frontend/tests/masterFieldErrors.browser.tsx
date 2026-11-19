/// <reference types="vite/client" />
import { createRoot } from 'react-dom/client';
import { EmployeesPage } from '../src/pages/EmployeesPage.tsx';
import { ServicePointsPage } from '../src/pages/ServicePointsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';

// Every request is handled here; no Firebase SDK or real API is used.
localStorage.clear(); sessionStorage.clear();
const outlet: OutletSummary = { id: 'shop', name: 'Shop', branch: '', country: '', dealerCode: '', fssaiNo: '', businessId: '', restaurantId: '', active: true, renewalDate: null, isPrimary: true };
const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
const until = async (check: () => unknown) => { for (let i = 0; i < 100; i++) { if (check()) return; await pause(); } throw new Error('Timed out waiting for UI'); };
const writes: { method: string; body: Record<string, unknown> }[] = [];
let failure = '';
const employee = { documentId: 'employee', name: 'Existing Employee', mobile: '9876543210', searchCode: 1, shortName: 'E', balanceAmt: '0', dateOfJoining: '', userId: '' };
const point = { documentId: 'point', name: 'Kitchen', paperSize: 2, printerType: 0, header: '', subHeader: '', footer: '', printerIpAddress: '', port: 0, usbPath: null };
window.fetch = async (url, init) => {
  const path = String(url), isEmployee = path.includes('/employees');
  if (!/^\/api\/outlets\/shop\/(employees|service-points)(\/[^/]+)?$/.test(path)) throw new Error(`Unexpected request: ${path}`);
  if (init?.method === 'POST' || init?.method === 'PATCH') {
    const body = JSON.parse(String(init.body)); writes.push({ method: init.method, body });
    if (failure) return Response.json({ message: failure }, { status: 409 });
    return Response.json({ success: true, data: { ...(isEmployee ? employee : point), ...body } });
  }
  return Response.json({ success: true, data: isEmployee
    ? { employees: [employee], nextSearchCode: 2, userAccounts: [{ userId: 'user', name: 'User' }] }
    : { servicePoints: [point] } });
};
const root = createRoot(document.getElementById('root')!);
const expired = () => { throw new Error('Unexpected session expiry'); };
let revision = 0;
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)!;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const edit = async (id: string, value: string) => {
  const node = field(id);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
  node.dispatchEvent(new Event('input', { bubbles: true })); await pause();
};
const click = async (node: HTMLElement) => { node.click(); await pause(); };
const submit = async (label = 'Save') => {
  await click(button(label));
  if (document.querySelector('.action-confirm-button')) await click(document.querySelector<HTMLButtonElement>('.action-confirm-button')!);
};
const errorAt = (id: string, focused = false) => {
  const node = field(id), message = document.getElementById(`${id}-error`);
  assert(!!message?.textContent && node.getAttribute('aria-invalid') === 'true' && node.getAttribute('aria-describedby') === message.id && node.parentElement?.contains(message), `${id}: error beside field with accessible association`);
  if (focused) assert(document.activeElement === node, `${id}: first invalid field focused`);
};
const cleared = (id: string) => assert(!document.getElementById(`${id}-error`) && !field(id).hasAttribute('aria-invalid') && !field(id).hasAttribute('aria-describedby'), `${id}: correction clears message and association`);
const mount = async (employeePage: boolean) => {
  root.render(employeePage ? <EmployeesPage key={++revision} outlet={outlet} token="mock" onSessionExpired={expired} /> : <ServicePointsPage key={++revision} outlet={outlet} token="mock" onSessionExpired={expired} />);
  await until(() => { const add = button(employeePage ? 'Add Employee' : 'Add Service Point'); return add && !add.disabled; });
  await click(button(employeePage ? 'Add Employee' : 'Add Service Point'));
};
void (async () => {
  await mount(true);
  await submit();
  errorAt('employee-name', true); errorAt('employee-mobile'); errorAt('employee-short-name');
  assert(writes.length === 0 && !document.querySelector('dialog[open]'), 'Invalid employee does not open confirmation or submit');
  await edit('employee-name', 'Alex'); cleared('employee-name'); cleared('employee-short-name');
  assert(field('employee-short-name').value === 'A', 'Automatic short name behavior preserved');
  await edit('employee-mobile', 'abc'); await submit(); errorAt('employee-mobile', true);
  await edit('employee-mobile', '---'); await submit(); errorAt('employee-mobile', true);
  assert(document.getElementById('employee-mobile-error')?.textContent === 'Enter a valid mobile number.', 'Existing custom mobile check has a field message');
  await edit('employee-mobile', '+91 98765-43210'); cleared('employee-mobile');
  await edit('employee-short-name', 'AX'); await edit('employee-name', '   '); await submit(); errorAt('employee-name', true);
  await edit('employee-name', 'Alex');
  await edit('employee-short-name', '   '); await submit(); errorAt('employee-short-name', true);
  await edit('employee-short-name', 'AX'); cleared('employee-short-name');
  await edit('employee-code', '0'); await submit(); errorAt('employee-code', true);
  await edit('employee-code', '2.5'); await submit(); errorAt('employee-code', true);
  await edit('employee-code', '2'); cleared('employee-code');
  await edit('employee-balance', ''); await submit(); errorAt('employee-balance', true);
  await edit('employee-balance', '-2.50'); cleared('employee-balance');
  assert(writes.length === 0, 'All invalid employee attempts remain local');
  failure = 'This search code is already in use. Choose another code or reload the list.';
  await submit(); errorAt('employee-code', true);
  await edit('employee-code', '3'); cleared('employee-code');
  failure = 'An employee with this mobile number already exists. Select the existing employee.';
  await submit(); errorAt('employee-mobile', true);
  await edit('employee-mobile', '1234567890'); cleared('employee-mobile');
  failure = 'Select an active user account assigned to this outlet.';
  await submit(); errorAt('employee-user', true);
  field('employee-user').value = 'user'; field('employee-user').dispatchEvent(new Event('change', { bubbles: true })); await pause(); cleared('employee-user');
  failure = 'Unable to save employee.'; await submit();
  assert(document.querySelector('.employees-save-error')?.textContent === failure, 'General employee save error remains form-level');
  failure = ''; await submit(); await until(() => !field('employee-name'));
  assert(writes.at(-1)?.body.balanceAmt === '-2.50' && writes.at(-1)?.body.mobile === '1234567890' && writes.at(-1)?.body.searchCode === 3, 'Valid employee payload and negative balance behavior preserved');
  await click(button('Edit')); await edit('employee-name', 'Edited Employee'); await submit();
  assert(writes.at(-1)?.method === 'PATCH', 'Employee editing still submits PATCH');

  await mount(false); const before = writes.length;
  await submit(); errorAt('service-point-name', true);
  await edit('service-point-name', '   '); await submit(); errorAt('service-point-name', true);
  await edit('service-point-name', 'Counter'); cleared('service-point-name');
  await click(document.querySelector<HTMLInputElement>('input[name="printerType"][value="1"]')!);
  await edit('service-point-port', '65536'); await submit(); errorAt('service-point-port', true);
  await edit('service-point-port', '-1'); await submit(); errorAt('service-point-port', true);
  await edit('service-point-port', '1.5'); await submit(); errorAt('service-point-port', true);
  await edit('service-point-port', ''); await edit('service-point-name', ''); await submit();
  errorAt('service-point-name', true); errorAt('service-point-port');
  assert(writes.length === before, 'Invalid service point name and port do not submit');
  await edit('service-point-name', 'Counter'); await edit('service-point-port', '0'); cleared('service-point-port');
  failure = 'A service point with this name already exists.'; await submit(); errorAt('service-point-name', true);
  await edit('service-point-name', 'Counter 2'); cleared('service-point-name');
  failure = 'Unable to save service point.'; await submit();
  assert(document.querySelector('.service-point-error')?.textContent === failure, 'General service point save error remains form-level');
  failure = ''; await submit(); await until(() => !field('service-point-name'));
  assert(writes.at(-1)?.body.port === 0 && writes.at(-1)?.body.printerIpAddress === '' && writes.at(-1)?.body.header === '', 'Valid zero port and empty optional fields preserve service point payload');
  await click(button('Edit')); await edit('service-point-name', ''); await submit('Update'); errorAt('service-point-name', true);
  await edit('service-point-name', 'Edited Kitchen'); await submit('Update');
  assert(writes.at(-1)?.method === 'PATCH' && JSON.stringify(writes.at(-1)?.body) === JSON.stringify({ name: 'Edited Kitchen' }), 'Service point edit still sends only changed settings');
  await click(button('Add Service Point')); assert(!document.querySelector('[aria-invalid="true"]'), 'Reopening form clears stale errors');
  await edit('service-point-name', 'USB Kitchen'); await click(document.querySelector<HTMLInputElement>('input[name="printerType"][value="1"]')!);
  await edit('service-point-port', ''); await submit(); errorAt('service-point-port', true);
  await click(document.querySelector<HTMLInputElement>('input[name="printerType"][value="2"]')!); await submit();
  assert(writes.at(-1)?.body.printerType === 2 && writes.at(-1)?.body.usbPath === null && writes.at(-1)?.body.port === 0, 'Hidden Ethernet errors do not block valid USB saves');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
