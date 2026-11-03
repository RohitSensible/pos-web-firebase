import '../src/index.css';
import '../src/App.css';
import '../src/pages/BillWiseReportPage.css';
import '../src/pages/DaywiseReportPage.css';
import '../src/pages/ShiftSummaryReportPage.css';
import '../src/pages/GstReportPage.css';
import '../src/pages/StockInOutReportPage.css';
import '../src/pages/StockTransferReportPage.css';
import '../src/Theme.css';

const checks: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); checks.push(message); };
const root = document.getElementById('root')!;
const reports = [
  ['bill-report-page', true],
  ['bill-report-page daywise-report-page', false],
  ['bill-report-page shift-report-page', false],
  ['bill-report-page gst-report-page', false],
  ['bill-report-page stock-in-out-report-page', false],
  ['bill-report-page stock-transfer-report-page', false],
] as const;

function renderReport(classes: string, native: boolean) {
  const tag = native ? 'dialog' : 'div';
  root.innerHTML = `<div class="retail-dashboard-shell"><aside class="dashboard-sidebar">Sidebar</aside><div class="dashboard-stage"><header class="retail-header">Report workspace</header><main class="dashboard-workspace"><button class="workspace-back">Back</button><section class="${classes}"><div class="bill-report-heading"><div><span>REPORTS</span><h1>Report</h1></div></div><div class="bill-table-card">Report data remains behind the details</div><${tag} class="bill-detail-backdrop"><article class="bill-detail-modal"><header><div><span>DETAILS</span><h2>Selected record</h2></div><button aria-label="Close details">×</button></header><div class="bill-detail-body">${Array.from({ length: 80 }, (_, index) => `<p style="padding:12px">Detail row ${index + 1}</p>`).join('')}</div><footer><button>Print / Save PDF</button></footer></article></${tag}></section></main></div></div>`;
  const overlay = root.querySelector<HTMLElement>('.bill-detail-backdrop')!;
  if (overlay instanceof HTMLDialogElement) overlay.showModal();
  const close = () => { if (overlay instanceof HTMLDialogElement) overlay.close(); overlay.remove(); };
  overlay.querySelector('header button')!.addEventListener('click', close);
  overlay.addEventListener('mousedown', event => { if (event.target === overlay) close(); });
  return overlay;
}

try {
  for (const theme of ['light', 'dark']) {
    document.documentElement.dataset.theme = theme;
    for (const [classes, native] of reports) {
      const label = `${theme}: ${classes}`;
      const overlay = renderReport(classes, native);
      const panel = overlay.querySelector<HTMLElement>('.bill-detail-modal')!;
      const bounds = panel.getBoundingClientRect();
      assert(Math.abs(bounds.right - document.documentElement.clientWidth) < 2 && Math.abs(bounds.width - Math.min(620, document.documentElement.clientWidth)) < 2, `${label} opens at the right edge with the full intended width`);
      assert(bounds.top === 0 && Math.abs(bounds.bottom - innerHeight) < 2, `${label} fills the visible height without clipping`);
      const background = getComputedStyle(overlay, native ? '::backdrop' : null).backgroundColor;
      assert(background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent', `${label} dims the report behind it`);
      const hit = document.elementFromPoint(bounds.left + 8, bounds.top + 8);
      assert(!!hit && panel.contains(hit), `${label} appears above the sidebar, header and Back button`);
      const body = panel.querySelector<HTMLElement>('.bill-detail-body')!;
      const footer = panel.querySelector('footer')!.getBoundingClientRect();
      body.scrollTop = body.scrollHeight;
      assert(body.scrollTop > 0 && footer.bottom <= innerHeight && footer.top >= 0, `${label} scrolls long details while keeping Print / Save PDF visible`);
      if (!native && bounds.left > 10) {
        overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        assert(!root.querySelector('.bill-detail-backdrop'), `${label} closes when the backdrop is clicked`);
      } else {
        panel.querySelector<HTMLButtonElement>('header button')!.click();
        assert(!root.querySelector('.bill-detail-backdrop'), `${label} closes through its close action`);
      }
    }
  }
  if (location.hash.includes('preview')) {
    document.documentElement.dataset.theme = 'light';
    renderReport('bill-report-page daywise-report-page', false);
  }
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length });
} catch (error) {
  document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks });
}
