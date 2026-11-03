import { createRoot } from 'react-dom/client';
import { TransferPreviewPage } from '../src/pages/TransferPreviewPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${label}`); }
const outlet = (id: string, name: string, branch: string, active = true) => ({ id, name, branch, active }) as OutletSummary;
const source = outlet('a', 'Main Kitchen', 'Pune');
window.fetch = async input => {
  if (String(input).endsWith('/api/auth/outlets')) return Response.json({ success: true, data: { outlets: [source,
    outlet('b', 'Koregaon Park Cafe', 'Pune'), outlet('c', 'Andheri Express', 'Mumbai'), outlet('d', 'Old Warehouse', '', false)] } });
  throw new Error(`Unexpected request: ${String(input)}`);
};
document.documentElement.dataset.theme = 'light';
createRoot(document.getElementById('root')!).render(<TransferPreviewPage outlet={source} token="t" onSessionExpired={() => { throw new Error('Unexpected expiry'); }} />);
void (async () => {
  await until(() => document.querySelector('.transfer-outlet-table tbody tr'), 'destination table');
  if (location.hash === '#preview') {
    document.body.style.background = 'var(--workspace)'; document.getElementById('root')!.style.padding = '24px';
    document.getElementById('test-results')!.textContent = JSON.stringify({ passed: ['Preview'] });
    document.getElementById('test-results')!.style.display = 'none'; return;
  }
  const sourceCard = document.querySelector('.transfer-source-card')!;
  assert(sourceCard.textContent?.includes('Source Outlet') && sourceCard.textContent.includes('Main Kitchen') && sourceCard.textContent.includes('Active'), 'Source Outlet card shows the current outlet and its status');
  assert(document.querySelector('.transfer-flow-indicator svg'), 'A transfer flow indicator sits between source and destination');
  const headings = [...document.querySelectorAll('.transfer-outlet-table th')].map(node => node.textContent);
  assert(headings.join() === 'Outlet Name,City,Status,Action', 'Destination table has Outlet Name, City, Status and Action columns');
  const rows = [...document.querySelectorAll('.transfer-outlet-table tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent));
  assert(rows.length === 3 && !rows.some(row => row[0] === 'Main Kitchen'), 'Source outlet is not offered as a destination');
  assert(rows[2]!.join('|') === 'Old Warehouse|—|Inactive|Select' && rows[1]![1] === 'Mumbai', 'Missing city shows a dash; inactive outlets get an Inactive badge');
  const select = document.querySelector<HTMLButtonElement>('[aria-label="Select outlet Andheri Express"]')!;
  assert(getComputedStyle(select).backgroundColor === 'rgb(79, 70, 229)', 'Select buttons are solid Royal Blue');
  const [left, right] = [sourceCard.getBoundingClientRect(), document.querySelector('.transfer-destination-card')!.getBoundingClientRect()];
  assert(innerWidth > 860 ? right.left > left.right && Math.abs(right.top - left.top) < 2 : right.top > left.bottom, 'Source and destination sit side by side on wide screens and stack on narrow ones');
  const page = document.querySelector<HTMLElement>('.transfer-preview')!;
  assert(page.scrollWidth <= page.clientWidth + 2, 'Layout fits the screen without horizontal scrolling');
  select.click(); await until(() => document.querySelector('#preview-quick-pin'), 'Quick PIN');
  assert(document.querySelector('dialog.quick-pin-modal'), 'Selecting a destination asks for the Quick PIN');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
