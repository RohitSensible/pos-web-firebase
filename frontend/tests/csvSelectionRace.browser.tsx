import { createRoot } from 'react-dom/client';
import { CsvUploadPreview } from '../src/pages/CsvUploadPreview.tsx';
import { PRODUCT_COLUMNS, type CsvPreview, type ProductUploadMode } from '../src/pages/productCsvPreview.ts';
import '../src/index.css';
import '../src/App.css';
import '../src/pages/UploadExcelPage.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, message: string) {
  for (let i = 0; i < 200; i++) { if (check()) return; await pause(); }
  throw new Error(message);
}
type QuotaRead = { signal?: AbortSignal | null; finish: (status?: number) => void };
const pending: QuotaRead[] = [];
const forbidden: string[] = [];
let automaticQuota = true;
let expirations = 0;
window.fetch = async (input, init) => {
  const path = String(input);
  if ((init?.method ?? 'GET') !== 'GET' || !/^\/api\/outlets\/[^/]+\/products\/import\/quota$/.test(path)) {
    forbidden.push(path); throw new Error(`Unexpected network request: ${path}`);
  }
  if (automaticQuota) return Response.json({ remainingAttempts: 2 });
  // Deliberately ignore abort: an already queued response must still be harmless.
  return new Promise<Response>(resolve => pending.push({ signal: init?.signal, finish: (status = 200) => {
    resolve(Response.json(status === 200 ? { remainingAttempts: 2 } : { message: 'STALE QUOTA ERROR' }, { status }));
  } }));
};
const workers: MockWorker[] = [];
class MockWorker {
  onmessage: ((event: { data: { source: string; preview: CsvPreview } }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  file: File | null = null;
  url: string;
  constructor(url: URL) { this.url = String(url); workers.push(this); }
  postMessage(file: File) { this.file = file; }
  terminate() { this.terminated = true; }
  complete(label: string, count = 1) {
    // Deliver even after termination, as if the callback was already queued.
    this.onmessage?.({ data: { source: `mock source ${label}`, preview: {
      headers: [...PRODUCT_COLUMNS], headerErrors: [], headerRow: 1, delimiter: ',', blankRows: 0,
      rows: Array.from({ length: count }, (_, i) => ({ rowNumber: i + 2, cells: [label], errors: [], warnings: [] })),
    } } });
  }
  fail() { this.onerror?.(); }
}
window.Worker = MockWorker as unknown as typeof Worker;
const NativeURL = URL;
window.URL = class extends NativeURL { constructor(input: string | URL, base: string | URL = location.href) { super(input, base); } };
const root = createRoot(document.getElementById('root')!);
const onSessionExpired = () => { expirations++; };
const onSuccessAcknowledged = () => { throw new Error('Unexpected upload success'); };
let scope = { outletId: 'outlet-a', token: 'token-a', mode: 'standard' as ProductUploadMode };
const render = () => root.render(<CsvUploadPreview {...scope} onSessionExpired={onSessionExpired} onSuccessAcknowledged={onSuccessAcknowledged} />);
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text);
const filename = () => document.querySelector('.csv-upload-filename strong')?.textContent;
const cells = () => document.querySelector('tbody')?.textContent ?? '';
const empty = () => !filename() && !document.querySelector('tbody') && !document.querySelector('[data-inline-loading]');
async function select(name: string) {
  automaticQuota = false;
  const index = pending.length;
  const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
  const transfer = new DataTransfer(); transfer.items.add(new File(['mock file bytes'], name));
  input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => pending.length > index, `No quota read for ${name}`);
  return pending[index];
}
async function start(name: string) {
  const before = workers.length;
  const read = await select(name); read.finish();
  await until(() => workers.length > before, `No worker for ${name}`);
  return workers[before];
}
async function changeScope(change: Partial<typeof scope>) {
  automaticQuota = true; scope = { ...scope, ...change }; render();
  await until(() => document.querySelector('input[type=file]') && empty(), 'Scope retained an old selection');
  await pause();
}

void (async () => {
  render();
  await until(() => document.querySelector('input[type=file]'), 'Initial quota did not finish');
  const a = await select('a.csv');
  const b = await select('b.csv');
  assert(a.signal?.aborted, 'Selecting B immediately aborts the pending quota read for A');
  assert(filename() === 'b.csv' && !document.querySelector('tbody'), 'Latest filename is visible while its quota read is pending');
  b.finish(); await until(() => workers.length === 1, 'B did not start parsing');
  const bWorker = workers[0]; bWorker.complete('LATEST B');
  await until(() => cells().includes('LATEST B'), 'B preview missing');
  a.finish(); await pause();
  assert(workers.length === 1 && filename() === 'b.csv' && cells().includes('LATEST B'), 'Out-of-order quota A cannot spawn a worker or replace preview B');
  assert(!document.querySelector('[role=alert]'), 'Obsolete quota success leaves the current preview error-free');

  const c = await start('c.csv');
  const dRead = await select('d.csv');
  assert(c.terminated && !document.querySelector('tbody'), 'New selection immediately terminates old parsing and clears the preview before quota resolves');
  c.complete('OBSOLETE C'); c.fail(); await pause();
  assert(filename() === 'd.csv' && !document.querySelector('tbody') && !document.querySelector('[role=alert]'), 'Queued messages and errors from a terminated worker cannot change the pending selection');
  dRead.finish(); await until(() => workers.length === 3, 'D worker missing');
  const d = workers[2]; c.complete('OBSOLETE WHILE D PARSES'); c.fail(); await pause();
  assert(document.querySelector('[data-inline-loading]') && !document.querySelector('[role=alert]'), 'Terminated worker callbacks cannot end the current worker loading state');
  d.complete('LATEST D', 1000);
  await until(() => cells().includes('LATEST D'), 'D preview missing');
  assert(document.querySelector('.csv-upload-summary dd')?.textContent === '1000' && document.querySelectorAll('tbody tr').length < 1000, 'Large previews retain full row totals and batched table rendering');
  c.complete('OBSOLETE C AGAIN'); c.fail(); await pause();
  assert(cells().includes('LATEST D') && !cells().includes('OBSOLETE') && !document.querySelector('[role=alert]'), 'Terminated worker cannot overwrite a newer completed preview');

  const removedRead = await select('remove-pending.csv');
  button('Remove File')!.click(); await until(empty, 'Remove did not clear pending file');
  removedRead.finish(401); await pause();
  assert(removedRead.signal?.aborted && empty() && workers.length === 3 && expirations === 0, 'Removed quota-pending file cannot reappear, start parsing, or expire the session');
  const removedWorker = await start('remove-parsing.tsv');
  button('Remove File')!.click(); await until(empty, 'Remove did not clear parsing');
  removedWorker.complete('REMOVED'); removedWorker.fail(); await pause();
  assert(removedWorker.terminated && empty() && !document.querySelector('[role=alert]'), 'Removed parsing file cannot reappear from queued worker callbacks');

  for (const change of [{ outletId: 'outlet-b' }, { token: 'token-b' }, { mode: 'premises' as ProductUploadMode }]) {
    const pendingRead = await select('scope-pending.csv');
    const before = workers.length;
    await changeScope(change);
    pendingRead.finish(429); await pause();
    assert(pendingRead.signal?.aborted && empty() && workers.length === before && !document.querySelector('[role=alert]'), `${Object.keys(change)[0]} change cancels pending quota and ignores its late result`);
    const worker = await start('scope-parsing.csv');
    // Change the same scope key again while a worker is running.
    const key = Object.keys(change)[0] as keyof typeof scope;
    const next = key === 'mode' ? { mode: 'standard' as ProductUploadMode } : { [key]: `${scope[key]}-next` };
    await changeScope(next);
    worker.complete('OLD SCOPE'); worker.fail(); await pause();
    assert(worker.terminated && empty() && !document.querySelector('[role=alert]'), `${key} change terminates parsing and rejects late worker messages and errors`);
  }

  const confirmedWorker = await start('confirmation.csv'); confirmedWorker.complete('CONFIRMATION FILE');
  await until(() => cells().includes('CONFIRMATION FILE'), 'Confirmation preview missing');
  button('Upload')!.click();
  await until(() => document.querySelector('.action-confirm-button'), 'Upload confirmation missing');
  await changeScope({ outletId: 'confirmation-new-outlet' });
  document.querySelector<HTMLButtonElement>('.action-confirm-button')!.click(); await pause();
  assert(empty() && forbidden.length === 0, 'Completed preview clears on scope change and pending confirmation cannot submit the previous selection');

  const standardError = await start('error.tsv'); standardError.fail();
  await until(() => document.querySelector('[role=alert]'), 'Standard worker error missing');
  assert(document.querySelector('[role=alert]')?.textContent === 'Unable to read or parse this file. Choose a UTF-8 CSV or TSV file.', 'CSV/TSV worker errors recommend the supported text formats');
  await changeScope({ mode: 'premises' });
  const premisesError = await start('error.xlsx');
  assert(premisesError.url.includes('premisesProductPreview.worker'), 'Premises selection retains its dedicated worker');
  premisesError.fail(); await until(() => document.querySelector('[role=alert]'), 'Premises worker error missing');
  assert(document.querySelector('[role=alert]')?.textContent?.includes('XLSX spreadsheet or a UTF-8 CSV or TSV'), 'Premises worker errors include XLSX alongside CSV/TSV');

  const beforeDenied = workers.length;
  const denied = await select('quota-denied.csv'); denied.finish(429);
  await until(() => document.querySelector('[role=alert]')?.textContent === 'STALE QUOTA ERROR', 'Current quota denial missing');
  assert(workers.length === beforeDenied && !document.querySelector('tbody'), 'Current quota denial still prevents local parsing and retains the quota message');
  await changeScope({ outletId: 'after-denial' });

  const unmountRead = await select('unmounted.csv');
  const beforeUnmount = workers.length; root.unmount(); unmountRead.finish(); await pause();
  assert(unmountRead.signal?.aborted && workers.length === beforeUnmount, 'Unmount cancels pending selection before a worker can start');
  assert(forbidden.length === 0, 'Fixture performed quota GETs only, with no validation or import writes');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
