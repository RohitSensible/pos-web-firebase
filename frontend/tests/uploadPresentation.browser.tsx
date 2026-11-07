import { createRoot } from 'react-dom/client';
import { UploadExcelPage } from '../src/pages/UploadExcelPage.tsx';
import { PRODUCT_COLUMNS, parseProductCsv } from '../src/pages/productCsvPreview.ts';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const checks: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(); } throw new Error(message); }
const reads: string[] = [];
window.fetch = async (input, init) => {
  const path = String(input);
  assert((init?.method ?? 'GET') === 'GET' && path.endsWith('/quota'), 'Presentation and local preview make only the existing quota GET');
  reads.push(path);
  return Response.json({ success: true, remainingAttempts: 2 });
};
window.Worker = class {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  async postMessage(file: File) { const source = await file.text(); this.onmessage?.({ data: { source, preview: parseProductCsv(source) } }); }
  terminate() {}
} as unknown as typeof Worker;
const NativeURL = URL;
window.URL = class extends NativeURL { constructor(input: string | URL, base: string | URL = location.href) { super(input, base); } };
const root = createRoot(document.getElementById('root')!);
root.render(<div className="retail-dashboard-shell"><aside className="dashboard-sidebar" /><div className="dashboard-stage"><header className="retail-header">Inventory workspace</header><main className="dashboard-workspace"><UploadExcelPage outletId="preview" token="test" onSessionExpired={() => { throw new Error('Unexpected session expiry'); }} /></main></div></div>);
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
const option = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.upload-excel-option')].find(node => node.querySelector('strong')?.textContent === label)!;
const dialog = () => document.querySelector<HTMLDialogElement>('.upload-excel-dialog')!;
function checkDialogPosition(label: string) {
  const node = dialog(), bounds = node.getBoundingClientRect();
  const mobile = matchMedia('(max-width: 820px), (max-width: 1024px) and (max-height: 600px)').matches;
  const phone = matchMedia('(max-width: 600px), (max-width: 1024px) and (max-height: 600px)').matches;
  const sidebar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'));
  const left = mobile ? 0 : sidebar;
  const backdrop = getComputedStyle(node, '::backdrop');
  assert(parseFloat(backdrop.left) === left && parseFloat(backdrop.top) === (phone ? 62 : 68), `${label}: backdrop follows the active sidebar and header layout`);
  assert(bounds.left >= left && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight, `${label}: dialog stays inside the available viewport`);
  const viewportWidth = document.documentElement.clientWidth;
  assert(Math.abs(bounds.left + bounds.width / 2 - (left + viewportWidth) / 2) < 1, `${label}: dialog is horizontally centered in the content area`);
  assert(getComputedStyle(node).overflowY === 'auto', `${label}: short-screen dialog retains vertical scrolling`);
  const close = node.querySelector<HTMLButtonElement>('.upload-excel-close-icon')!;
  const closeBounds = close.getBoundingClientRect();
  assert(!close.disabled && closeBounds.top >= bounds.top && closeBounds.bottom <= bounds.bottom, `${label}: close control remains inside the visible dialog`);
  const previousScroll = node.scrollTop;
  node.scrollTop = node.scrollHeight;
  const footer = node.querySelector<HTMLButtonElement>('.upload-excel-dialog-actions button, .csv-upload-import-note button');
  if (footer) {
    const button = footer.getBoundingClientRect();
    assert(button.top >= bounds.top && button.bottom <= bounds.bottom, `${label}: footer actions remain reachable after scrolling`);
  }
  if (node.scrollHeight > node.clientHeight) assert(node.scrollTop > 0, `${label}: overflowing content can scroll on short screens`);
  node.scrollTop = previousScroll;
}
void (async () => {
  await until(() => option('Upload Excel'), 'Upload page did not render');
  for (const theme of ['light', 'dark']) {
    document.documentElement.dataset.theme = theme;
    option('Excel Sheet Instructions').click();
    await until(() => document.querySelector('.sheet-required-columns'), 'Instructions did not open');
    checkDialogPosition(`${theme}: instructions`);
    assert(parseFloat(getComputedStyle(document.querySelector('#upload-excel-dialog-title')!).fontSize) >= 24, `${theme}: instruction title is prominent`);
    assert(document.querySelector('.sheet-template-card summary strong')?.textContent === 'Template Downloads' && document.querySelectorAll('.sheet-template-card button svg').length === 2, `${theme}: template card contains both download actions with icons`);
    const columns = [...document.querySelectorAll('.sheet-required-columns li')];
    assert(columns.length === 14 && columns.every((column, i) => column.querySelector('span')?.textContent === String(i + 1) && column.textContent?.includes(PRODUCT_COLUMNS[i])), `${theme}: all 14 column pills retain their exact order`);
    assert(document.querySelectorAll('.sheet-rules-list > li').length === 11, `${theme}: every existing guideline remains available`);
    assert(dialog().scrollWidth <= dialog().clientWidth + 1, `${theme}: instruction layout stays within the modal`);
    button('Close').click(); await until(() => !dialog().open, 'Instructions Close failed'); await pause();
    option('Upload Excel').click();
    await until(() => document.querySelector('input[type=file]'), 'File input did not appear');
    checkDialogPosition(`${theme}: upload`);
    assert(document.querySelector('.csv-upload-drop-zone')?.textContent?.includes('Drag & drop') && document.querySelectorAll('.csv-upload-format-pills li').length === 4, `${theme}: upload zone presents the existing file requirements`);
    const banner = document.querySelector('.csv-upload-quota')!;
    assert(banner.textContent?.includes('2') && getComputedStyle(banner).color === 'rgb(244, 247, 252)', `${theme}: quota notice has readable high-contrast text`);
    assert(button('Upload').disabled && !button('Close').disabled, `${theme}: empty upload retains its disabled action and available Close`);
    const source = [PRODUCT_COLUMNS.join(','), ['Tea', 'Tea', '20', '20', '0', '0', 'Food', '1', '0', '0001', 'number', '0', 'no', ''].join(',')].join('\n');
    const file = new File([source], 'example_products.csv', { type: 'text/csv' });
    const transfer = new DataTransfer(); transfer.items.add(file);
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => document.querySelector('.csv-upload-table-scroll tbody tr'), 'Local preview did not appear');
    checkDialogPosition(`${theme}: populated preview`);
    assert(document.querySelector('.csv-upload-filename strong')?.textContent === file.name && !button('Upload File').disabled && !button('Upload').disabled, `${theme}: selected file shows its name and enabled existing upload actions`);
    const footer = document.querySelector('.csv-upload-import-note')!;
    assert(footer.contains(button('Upload')) && footer.contains(button('Close')), `${theme}: footer keeps Upload and Close together`);
    assert(dialog().scrollWidth <= dialog().clientWidth + 1, `${theme}: selected file and preview never overflow the modal`);
    button('Upload File').click(); await until(() => document.querySelector('.action-confirm-button'), 'Inline upload did not open existing confirmation');
    assert(reads.length === (theme === 'light' ? 2 : 4), `${theme}: inline upload still requires confirmation before any import request`);
    document.querySelector<HTMLButtonElement>('.delete-confirmation-cancel')!.click(); await until(() => !document.querySelector('.action-confirmation'), 'Confirmation cancellation failed');
    if (theme === 'light' || !location.hash.includes('preview')) {
      button('Close').click(); await until(() => !dialog().open, 'Upload Close failed'); await pause();
    }
  }
  document.getElementById('test-results')!.style.display = 'none';
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
