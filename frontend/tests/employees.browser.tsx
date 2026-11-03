import { readMasterSnapshot } from '../src/utils/masterSnapshots.ts';
import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';
localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'Current User', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'shop', name: 'Existing Shop' }));
const checks: string[] = [];
function assert(ok: unknown, message: string) { if (!ok) throw new Error(message); checks.push(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 120; i++) { if (check()) return; await pause(); } throw new Error('Timeout: ' + message); }
interface Employee { documentId: string; name: string; mobile: string; searchCode: number; shortName: string; balanceAmt: string; dateOfJoining: string; userId: string }
const records: Employee[] = [];
const submissions: Record<string, unknown>[] = [];
let getStatus = 200, postStatus = 200;
let releaseGet: (() => void) | undefined, releasePost: (() => void) | undefined;
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.includes('/dashboard?')) return Response.json({ data: { payments: {} } });
  assert(path === '/api/outlets/shop/employees' || path === '/api/outlets/shop/employees/saved-employee', 'Employee requests target the selected outlet');
  assert((init?.headers as Record<string, string>).Authorization === 'Bearer mock-token', 'Employee requests use the session token');
  if (init?.method === 'POST' || init?.method === 'PATCH') {
    const body = JSON.parse(String(init.body)); submissions.push(body);
    await new Promise<void>(resolve => { releasePost = resolve; });
    if (postStatus !== 200) return Response.json({ message: 'Unable to confirm save. Retry.' }, { status: postStatus });
    const { requestId: _requestId, ...fields } = body;
    const saved = { ...fields, documentId: 'saved-employee' } as Employee;
    if (init?.method === 'PATCH') records.splice(records.findIndex(row => row.documentId === saved.documentId), 1, saved);
    else records.push(saved); return Response.json({ success: true, data: saved });
  }
  assert(init?.cache === 'no-store', 'Lists load fresh database records');
  await new Promise<void>(resolve => { releaseGet = resolve; });
  return Response.json(getStatus === 200 ? { success: true, data: { employees: records, nextSearchCode: records.length + 1,
    userAccounts: [{ userId: 'colleague', name: 'Existing Colleague' }] } } : { message: 'Unable to load employees' }, { status: getStatus });
};
const root = createRoot(document.getElementById('root')!); root.render(<App />);
const nav = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(button => button.textContent === label)!;
async function navigate(label: string) {
  if (!nav(label)) {
    const group = label === 'Dashboard' ? 'Home' : 'Masters';
    [...document.querySelectorAll<HTMLButtonElement>('.nav-group-title')].find(button => button.textContent?.trim() === group)!.click();
    await until(() => nav(label), `${label} navigation`);
  }
  nav(label).click();
}
const form = () => document.querySelector<HTMLFormElement>('.employee-form-page form');
const field = (id: string) => document.getElementById(`employee-${id}`) as HTMLInputElement;
function edit(id: string, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(id), value);
  field(id).dispatchEvent(new Event('input', { bubbles: true }));
}
function select(id: string, value: string) {
  const el = document.getElementById(id) as HTMLSelectElement; el.value = value; el.dispatchEvent(new Event('change', { bubbles: true }));
}
const add = () => document.querySelector<HTMLButtonElement>('.category-header-row .btn-primary-add')!;
const save = () => document.querySelector<HTMLButtonElement>('.employee-form-page button[type=submit]')!;
async function submit() {
  const previous = submissions.length;
  save().click();
  await until(() => document.querySelector('.action-confirmation[open]'), 'save confirmation');
  assert(submissions.length === previous, 'Opening the confirmation makes no save request');
  assert(!document.querySelector('.delete-confirmation-icon'), 'Confirmation has no warning icon');
  document.querySelector<HTMLButtonElement>('.action-confirm-button')!.click(); await pause();
}
async function done() {
  document.querySelector<HTMLButtonElement>('.success-done')!.click(); await pause();
}
async function openPage() {
  releaseGet = undefined; await navigate('Employees/Salesman'); await until(() => releaseGet, 'list request'); await pause();
  const cached = readMasterSnapshot('/api/outlets/shop/employees', 'mock-token');
  if (cached) assert(!document.querySelector('.employees-page [role=status]')?.textContent?.includes('Loading'), 'Recent employees remain visible while a fresh list is fetched');
  else assert(document.querySelector('.employees-page [role=status]')?.textContent?.includes('Loading'), 'First load shows progress while fetching');
  releaseGet!(); await pause();
}
void (async () => {
  await until(() => nav('Employees/Salesman'), 'navigation');
  await openPage(); await until(() => document.querySelector('.employees-state h2'), 'empty state');
  assert(add().textContent?.includes('Add Employee'), 'Empty employee list provides Add Employee');
  assert(!document.getElementById('employee-selection-kind') && !document.body.textContent?.includes('Select as'), 'No Employee/Salesman selector is shown');
  for (const kind of ['Employee']) {
    assert(add().textContent?.includes(`Add ${kind}`), `Add action is labelled ${kind}`);
    add().click(); await until(form, 'add form');
    assert(document.querySelector('#employee-form-title')?.textContent === `Add ${kind}`, `Add opens the ${kind} form`);
    const bounds = document.querySelector('.employee-form-page')!.getBoundingClientRect();
    assert(bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0, 'Form fits the available content width');
    const workspace = document.querySelector('.dashboard-workspace')!.getBoundingClientRect();
    const workspaceStyle = getComputedStyle(document.querySelector('.dashboard-workspace')!);
    assert(Math.abs(bounds.width - (workspace.width - parseFloat(workspaceStyle.paddingLeft) - parseFloat(workspaceStyle.paddingRight))) < 2, 'Form fills the main content area');
    assert(!document.querySelector('.modal-scrim') && !document.querySelector('.employees-selection'), 'Add form replaces the list without an overlay');
    if (innerWidth > 820) {
      const sidebar = document.querySelector('.dashboard-sidebar')!.getBoundingClientRect();
      assert(bounds.left >= sidebar.right && document.elementFromPoint(sidebar.left + 20, sidebar.top + 20)?.closest('.dashboard-sidebar'), 'Sidebar remains visible and interactive beside the form');
    } else {
      assert(!!document.querySelector('.mobile-menu'), 'Mobile navigation remains available');
    }
  }
  assert(field('code').value === '1' && field('balance').value === '0', 'New form uses search code 1 and zero balance for an empty outlet');
  assert((document.getElementById('employee-user') as HTMLSelectElement).options[1].text === 'Existing Colleague', 'Account dropdown uses returned existing user accounts');
  save().click(); await pause(); assert(submissions.length === 0 && !form()!.checkValidity(), 'Required fields prevent an empty save');
  edit('name', 'New Person'); edit('mobile', '9876543210'); await pause();
  assert(field('short-name').value === 'N', 'Short name defaults to the initial and can be edited');
  edit('short-name', 'NP'); edit('balance', '25.50'); select('employee-user', 'colleague');
  document.querySelector<HTMLButtonElement>('[aria-label^="Joining Date:"]')!.click(); await until(() => document.querySelector('.report-date-calendar'), 'joining date');
  [...document.querySelectorAll<HTMLButtonElement>('.report-date-calendar button')].find(button => button.textContent === 'Today')!.click(); await pause();
  postStatus = 503; releasePost = undefined; await submit(); await until(() => releasePost, 'save request');
  assert(field('name').matches(':disabled') && save().disabled, 'Fields and Save are disabled during submission');
  assert(!!form() && !document.querySelector('.action-success') && records.length === 0, 'Form and list do not claim success before the database confirms');
  releasePost!(); await until(() => document.querySelector('.employees-save-error'), 'save error');
  assert(!!form() && field('name').value === 'New Person', 'Database save error retains the form for retry');
  assert(submissions[0].searchCode === 1 && submissions[0].balanceAmt === '25.50' && submissions[0].userId === 'colleague'
    && /^\d{4}-\d{2}-\d{2}$/.test(String(submissions[0].dateOfJoining)), 'Save maps fields to the discovered Android schema');
  assert(!('type' in submissions[0]) && !('id' in submissions[0]), 'Selection context does not invent a stored employee type or trust a document ID');
  postStatus = 200; releasePost = undefined; await submit(); await until(() => releasePost, 'retry request');
  assert(submissions[1].requestId === submissions[0].requestId, 'Save retry reuses the same request ID to avoid duplicates');
  releasePost!(); await until(() => document.querySelector('.action-success'), 'success');
  assert(!form() && records.length === 1 && document.querySelector('.employees-table-scroll')?.textContent?.includes('New Person'), 'Confirmed save closes form and immediately inserts the new record');
  assert(!document.querySelector('.employees-table-scroll input[type="radio"]'), 'Employee list has no radio selectors');
  assert(!document.querySelector('.employees-selection') && document.querySelector('.employees-table-scroll th')?.textContent === 'Name', 'Employee list starts with Name and has no redundant selection status');
  await done(); await navigate('Dashboard'); await pause(); await openPage(); await until(() => document.querySelector('.employees-table-scroll'), 'existing records');
  assert(document.querySelector('.employees-table-scroll')?.textContent?.includes('9876543210'), 'Reopening fetches existing records and mobile numbers');
  document.querySelector<HTMLTableRowElement>('.employees-table-scroll tbody tr')!.click(); await pause();
  assert(document.querySelector('#employee-form-title')?.textContent === 'Edit Employee', 'Clicking an employee opens the edit form');
  assert(field('name').value === 'New Person' && field('short-name').value === 'NP' && field('balance').value === '25.50', 'Edit form loads the existing employee details');
  edit('name', 'Updated Person'); await pause();
  assert(field('short-name').value === 'NP', 'Editing the name preserves the existing short name');
  postStatus = 503; releasePost = undefined; await submit(); await until(() => releasePost, 'update request');
  releasePost!(); await until(() => document.querySelector('.employees-save-error'), 'update error');
  assert(field('name').value === 'Updated Person' && records[0].name === 'New Person', 'Failed update keeps the draft and leaves the saved row unchanged');
  postStatus = 200; releasePost = undefined; await submit(); await until(() => releasePost, 'update retry');
  releasePost!(); await until(() => document.querySelector('.action-success'), 'update success');
  assert(records.length === 1 && records[0].name === 'Updated Person' && document.querySelector('.action-success')?.textContent?.includes('Updated successfully.'), 'Updating saves the same employee without adding a duplicate');
  await done(); document.querySelector<HTMLTableRowElement>('.employees-table-scroll tbody tr')!.click(); await until(form, 'row edit');
  document.querySelector<HTMLButtonElement>('.employee-form-page .modal-close-btn')!.click(); await pause();
  document.querySelector<HTMLButtonElement>('.master-delete-button')!.click(); await until(() => document.querySelector('dialog[open]'), 'delete confirmation');
  assert(document.querySelector('.action-popup-question')?.textContent === 'Are you sure you want to delete Updated Person?', 'Delete confirmation contains only the requested message');
  document.querySelector<HTMLButtonElement>('.delete-confirmation-cancel')!.click(); await pause();
  await navigate('Dashboard'); await pause(); getStatus = 503; await openPage();
  await until(() => document.querySelector('.employees-state [role=alert]'), 'load error');
  assert(!document.querySelector('.employees-table-scroll') && add().disabled, 'Fetch errors show feedback without stale or empty-success lists');
  getStatus = 200; releaseGet = undefined; document.querySelector<HTMLButtonElement>('.employees-state button')!.click();
  await until(() => releaseGet, 'reload'); releaseGet!(); await until(() => document.querySelector('.employees-table-scroll'), 'reload records');
  assert(records.length === 1, 'Retrying list reads does not duplicate records');
  if (location.hash.includes('preview')) { add().click(); await until(form, 'preview form'); } else root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks }); });
