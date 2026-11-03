import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import ExcelJS from 'exceljs';
import { getDataLoadingSnapshot } from '../src/utils/dataLoading.ts';
import '../src/index.css';
const checks: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${label}`); }
const requests: { path: string; method: string }[] = [];
let writeAttempts = 0, reportFailure = false, reportCount = 1;
let holdReport: Promise<void> | null = null;
const outlets = [{ id: 'main', name: 'Main Outlet', active: true }, { id: 'anna', name: 'Anna Nagar', active: true }, { id: 'adyar', name: 'Adyar', active: true }];
const products = [
  { documentId: 'p1', fields: { name: 'Preview Product', code: 101, category: 'cat', stockable: true, currentStock: 100 } },
  { documentId: 'p2', fields: { name: 'Second Product', code: 102, category: 'cat', stockable: true, currentStock: 80 } },
];
const original = JSON.stringify(products);
const savedTransfer = { documentId: 'saved-1', transferNo: 'SAVED-ST-001', dayId: '2026-10-30', createdDate: Date.parse('2026-10-30T12:00:00+05:30'), type: 'TRANSFER', supplier: '', remark: '', source: 'POS', state: 'COMPLETED', quantity: 3, total: 30, roundOff: 0, finalTotal: 30,
  items: [{ productId: 'saved-product', name: 'Previously saved product', quantity: 3, price: 10, cost: 5, total: 30, remark: '' }], references: [] };
window.fetch = async (input, init) => {
  const path = String(input), method = init?.method || 'GET'; requests.push({ path, method });
  if (method !== 'GET') { writeAttempts++; throw new Error(`Unexpected write: ${path}`); }
  if (path.includes('/dashboard?')) return Response.json({ data: { payments: {} } });
  if (new Headers(init?.headers).get('Authorization') !== 'Bearer session-token') throw new Error('Missing login authorization');
  if (path === '/api/auth/outlets') return Response.json({ success: true, data: { outlets } });
  if (path.endsWith('/products')) return Response.json({ success: true, data: products });
  if (path.endsWith('/categories')) return Response.json({ success: true, data: [{ id: 'cat', name: 'Stock category' }] });
  if (path.includes('/reports/stock-transfers?')) {
    if (holdReport) await holdReport;
    if (reportFailure) return Response.json({ message: 'Saved reports are temporarily unavailable' }, { status: 503 });
    const params = new URL(path, location.href).searchParams;
    const matches = savedTransfer.dayId >= params.get('startDate')! && savedTransfer.dayId <= params.get('endDate')! && (!params.get('search') || `${savedTransfer.transferNo} Previously saved product`.toLowerCase().includes(params.get('search')!.toLowerCase()));
    return Response.json({ success: true, data: { transfers: matches ? Array.from({ length: reportCount }, (_, index) => ({ ...savedTransfer, documentId: `saved-${index}`, transferNo: index ? `SAVED-ST-${index + 1}` : savedTransfer.transferNo })) : [], summary: { totalTransfers: matches ? reportCount : 0, totalProducts: matches ? reportCount : 0, totalQuantity: matches ? 3 * reportCount : 0, totalAmount: matches ? 30 * reportCount : 0 } } });
  }
  throw new Error(`Unexpected GET: ${path}`);
};
localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'User', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'session-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify(outlets[0]));
const rootElement = document.getElementById('root')!;
let root = createRoot(rootElement); root.render(<App />);
const button = (text: string) => {
  const scope = document.querySelector('dialog[open]') ?? document;
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text);
  if (!found) throw new Error(`Missing button: ${text}`); return found;
};
const control = (label: string) => {
  const field = [...document.querySelectorAll('label')].find(node => node.textContent?.trim().startsWith(label));
  const element = field?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea');
  if (!element) throw new Error(`Missing control: ${label}`); return element;
};
async function setValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause();
}
async function navigate(groupName: string, itemName: string) {
  const group = [...document.querySelectorAll('.nav-group')].find(node => node.querySelector('.nav-group-title')?.textContent?.includes(groupName))!;
  if (!group.querySelector('.nav-group-items')) { group.querySelector<HTMLElement>('.nav-group-title')!.click(); await pause(); }
  [...group.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(node => node.textContent === itemName)!.click(); await pause();
}
const previewRows = () => document.querySelectorAll('.session-preview-scroll tbody tr');
const previewReferences = () => [...document.querySelectorAll('.session-preview-scroll tbody tr td:first-child')].map(node => node.textContent!);
async function chooseReportDate(label: string, date: string) {
  document.querySelector<HTMLButtonElement>(`.report-date-trigger[aria-label^="${label}:"]`)!.click(); await pause();
  document.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)!.click(); await pause();
}
async function fillDraft(second = false) {
  await until(() => document.querySelector('[aria-label="Select Preview Product"]'), 'source stock');
  await setValue(document.getElementById('st-destination') as HTMLSelectElement, 'anna');
  await setValue(document.getElementById('st-destination') as HTMLSelectElement, 'adyar');
  document.querySelector<HTMLInputElement>('[aria-label="Select Preview Product"]')!.click(); await pause();
  await setValue(document.querySelector<HTMLInputElement>('[aria-label="Preview Product quantity for Anna Nagar"]')!, second ? '4' : '10');
  await setValue(document.querySelector<HTMLInputElement>('[aria-label="Preview Product quantity for Adyar"]')!, second ? '4' : '20');
  if (!second) {
    document.querySelector<HTMLInputElement>('[aria-label="Select Second Product"]')!.click(); await pause();
    await setValue(document.querySelector<HTMLInputElement>('[aria-label="Second Product quantity for Anna Nagar"]')!, '5');
    await setValue(document.querySelector<HTMLInputElement>('[aria-label="Second Product quantity for Adyar"]')!, '15');
  }
  await setValue(control('Transfer Date'), '2026-10-30');
  await setValue(control('Transfer Note'), second ? 'Second preview note' : 'Session preview note');
}
async function confirmDraft() { button('Review Transfer').click(); await pause(); button('Continue to Confirmation').click(); await pause(); button('Confirm Transfer').click(); await pause(); }
void (async () => {
  await until(() => document.querySelector('.sidebar-nav'), 'app');
  await navigate('Reports', 'Stock Transfer Report');
  await until(() => document.querySelector('.stock-transfer-report-page') && !document.querySelector('.bill-report-state[data-inline-loading]'), 'initial report');
  assert(!document.querySelector('.stock-transfer-session-previews'), 'No session previews exist before a transfer preview is confirmed');
  await navigate('Inventory', 'Stock Transfer'); await fillDraft();
  button('Review Transfer').click(); await pause(); button('Cancel').click(); await pause();
  assert(!document.querySelector('dialog[open]'), 'Cancelling review leaves the draft editable');
  button('Review Transfer').click(); await pause(); button('Continue to Confirmation').click(); await pause();
  const confirm = button('Confirm Transfer'); confirm.click(); confirm.click(); await pause();
  assert(document.querySelector('dialog')?.textContent?.includes('is available in the Stock Transfer Report'), 'Confirmation reports that a local session preview is available');
  button('Done').click(); await pause();
  await confirmDraft();
  button('View Stock Transfer Report').click();
  await until(() => previewRows().length === 1, 'connected report');
  const reference = previewReferences()[0]!;
  assert(reference.startsWith('PREVIEW-') && previewRows()[0]!.textContent?.includes('Main Outlet') && previewRows()[0]!.textContent?.includes('Anna Nagar, Adyar') && previewRows()[0]!.textContent?.includes('50 units'), 'Confirmed preview appears in the report with source, destinations, quantities and an explicit preview reference');
  assert(previewRows().length === 1, 'Repeated confirmation of an unchanged draft and duplicate clicks do not create duplicate report entries');
  assert(requests.some(request => request.path.includes('/reports/stock-transfers?') && request.path.includes('startDate=2026-10-30') && request.path.includes('endDate=2026-10-30')), 'View Report opens on the chosen transfer date, including backdated previews');
  await until(() => document.querySelector('.bill-table-scroll tbody tr')?.textContent?.includes('SAVED-ST-001'), 'saved report entry');
  assert([...document.querySelectorAll('.bill-summary-grid strong')].slice(0, 3).map(node => node.textContent).join(',') === '1,1,3', 'Unsaved previews do not inflate the existing saved report totals or replace saved entries');
  document.querySelector<HTMLButtonElement>(`[aria-label="View preview ${reference}"]`)!.click(); await pause();
  assert(document.querySelector('dialog')?.textContent?.includes('Estimated remaining: 70 units') && document.querySelector('dialog')?.textContent?.includes('Session preview note') && document.querySelectorAll('.session-preview-product').length === 2, 'Preview details contain immutable product stock snapshots, destination quantities and notes');
  button('Close Preview').click(); await pause();
  await setValue(document.querySelector<HTMLInputElement>('.bill-search-filter input')!, 'not present');
  await until(() => previewRows().length === 0, 'preview search');
  assert(document.body.textContent?.includes('No session previews match') && document.querySelector('.session-preview-empty-help')?.textContent?.includes('Widen the dates and choose Apply'), 'Filtered previews retain a useful recovery hint without deleting session data');
  await setValue(document.querySelector<HTMLInputElement>('.bill-search-filter input')!, 'Anna Nagar'); await until(() => previewRows().length === 1, 'outlet search');
  assert(previewRows().length === 1, 'Report search finds destination outlet names');
  await setValue(document.querySelector<HTMLInputElement>('.bill-search-filter input')!, '101'); await until(() => previewRows().length === 1 && requests.at(-1)?.path.includes('search=101'), 'code search');
  assert(previewRows().length === 1, 'Report search finds source product codes');
  await setValue(document.querySelector<HTMLInputElement>('.bill-search-filter input')!, ''); await until(() => !new URL(requests.at(-1)!.path, location.href).searchParams.get('search'), 'clear search');
  await chooseReportDate('To date', '2026-10-31'); await chooseReportDate('From date', '2026-10-31'); button('Apply').click(); await until(() => previewRows().length === 0, 'date exclusion');
  assert(previewRows().length === 0, 'Date ranges also filter local preview records');
  await chooseReportDate('From date', '2026-10-30'); button('Apply').click(); await until(() => previewRows().length === 1, 'date restored');
  let releaseReport!: () => void;
  holdReport = new Promise<void>(resolve => { releaseReport = resolve; });
  button('Refresh').click(); await until(() => document.querySelector('[data-inline-loading]'), 'saved report loading');
  await new Promise(resolve => setTimeout(resolve, 250));
  assert(previewRows().length === 1 && getDataLoadingSnapshot().tasks.length === 0 && !document.querySelector('[data-loading-root]'), 'Saved-report loading leaves valid previews accessible without a blocking loading overlay');
  document.querySelector<HTMLButtonElement>(`[aria-label="View preview ${reference}"]`)!.click(); await pause();
  assert(!!document.querySelector('dialog[open].stock-transfer-preview-dialog'), 'Preview details remain usable while the saved report is pending');
  button('Close Preview').click(); await pause();
  reportFailure = true; holdReport = null; releaseReport(); await until(() => document.body.textContent?.includes('Saved reports are temporarily unavailable'), 'saved-report failure');
  assert(previewRows().length === 1 && button('Print / PDF').disabled && button('Export Excel').disabled && document.querySelector('.bill-summary-grid strong')?.textContent === '—', 'A saved-report failure retains previews and marks saved totals unavailable with print and export disabled');
  reportFailure = false; button('Retry').click(); await until(() => document.querySelector('.bill-table-scroll tbody tr')?.textContent?.includes('SAVED-ST-001'), 'saved-report retry');
  assert(document.querySelector('#saved-transfers-title')?.textContent?.includes('Database records') && document.querySelector('.session-preview-help')?.textContent?.includes('selected report outlet does not restrict previews'), 'Saved outlet scope and cross-outlet preview scope are explicit');
  let exportBlob: Blob | null = null;
  const createObjectURL = URL.createObjectURL, anchorClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = blob => { exportBlob = blob as Blob; return 'blob:mock-export'; };
  HTMLAnchorElement.prototype.click = function () {};
  try {
    button('Export Excel').click(); await until(() => exportBlob, 'Excel export');
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await exportBlob!.arrayBuffer());
    const cells: string[] = []; workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => cells.push(String(cell.value)))));
    assert(cells.includes('SAVED-ST-001') && !cells.some(value => value.includes(reference)), 'Excel contains saved database records and excludes session previews');
  } finally { URL.createObjectURL = createObjectURL; HTMLAnchorElement.prototype.click = anchorClick; }
  reportCount = 51; button('Refresh').click(); await until(() => document.querySelectorAll('.bill-table-scroll tbody tr').length === 51, 'paginated saved records');
  const savedRows = () => [...document.querySelectorAll<HTMLElement>('.bill-table-scroll tbody tr')];
  assert(savedRows().filter(row => getComputedStyle(row).display !== 'none').length === 50, 'Screen report keeps fifty saved records per page');
  document.querySelector<HTMLButtonElement>('.bill-pagination button:last-child')!.click(); await pause();
  assert(savedRows().filter(row => getComputedStyle(row).display !== 'none').length === 1 && savedRows().length === 51, 'All saved rows remain available for printing when viewing the last page');
  const printRules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules]).filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText === 'print').flatMap(rule => [...rule.cssRules]).filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
  assert(printRules.some(rule => rule.selectorText.includes('.stock-transfer-session-previews') && rule.selectorText.includes('.stock-transfer-preview-dialog') && rule.style.display === 'none') && printRules.some(rule => rule.selectorText.includes('.stock-transfer-other-page') && rule.style.display === 'table-row'), 'Print styles exclude preview sections and dialogs while including every saved page');
  let printCalls = 0; const originalPrint = window.print; window.print = () => { printCalls++; };
  button('Print / PDF').click(); window.print = originalPrint;
  assert(printCalls === 1, 'Saved report print action invokes browser printing');
  reportCount = 1;
  await navigate('Inventory', 'Stock Transfer'); await fillDraft(true); await confirmDraft(); button('View Stock Transfer Report').click();
  await until(() => previewRows().length === 2, 'second preview');
  assert(previewRows().length === 2 && previewReferences().includes(reference), 'Confirmed previews survive navigation and accumulate during the login session');
  const oldRow = [...previewRows()].find(node => node.textContent?.includes(reference))!;
  assert(oldRow.textContent?.includes('50 units') && [...previewRows()].some(node => node.textContent?.includes('8 units')), 'New draft quantities never mutate a previously confirmed preview');
  assert(JSON.stringify(products) === original && writeAttempts === 0 && requests.every(request => request.method === 'GET'), 'Confirmation, report navigation, details and filtering perform no backend writes or stock changes');
  const stored = Object.keys(localStorage).map(key => localStorage.getItem(key)).join('');
  assert(!stored.includes(reference), 'Preview records are never persisted to browser storage');
  for (const theme of ['light', 'dark']) { document.documentElement.dataset.theme = theme; assert(document.documentElement.scrollWidth <= innerWidth + 2, `${theme}: preview report table scrolls within the viewport`); }
  if (location.hash === '#preview') {
    document.documentElement.dataset.theme = 'light';
    document.querySelector('.stock-transfer-session-previews')!.scrollIntoView({ block: 'start' }); await pause();
    document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks }); return;
  }
  root.unmount(); root = createRoot(rootElement); root.render(<App />);
  await until(() => document.querySelector('.sidebar-nav'), 'new app session memory');
  await navigate('Reports', 'Stock Transfer Report'); await until(() => document.querySelector('.stock-transfer-report-page') && !document.querySelector('.bill-report-state[data-inline-loading]'), 'reloaded report');
  assert(!document.querySelector('.stock-transfer-session-previews'), 'Reloading the application clears all in-memory previews');
  if (location.hash !== '#preview') root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
