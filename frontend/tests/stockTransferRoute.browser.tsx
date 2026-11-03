import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

const checks: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 120; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}`); }
const requests: string[] = [];
window.fetch = async (url, init) => {
  const path = String(url); requests.push(path);
  if (init?.method && init.method !== 'GET') throw new Error(`Unexpected write: ${path}`);
  if (path === '/api/auth/outlets') return Response.json({ success: true, data: { outlets: [{ id: 'source', name: 'Real outlet stays unchanged', active: true }] } });
  if (/\/(products|categories)$/.test(path)) return Response.json({ success: true, data: [] });
  if (path.includes('/dashboard?')) return Response.json({ data: { payments: {} } });
  throw new Error(`Unexpected page request: ${path}`);
};
localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'User', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'source', name: 'Real outlet stays unchanged' }));
const originalOutlet = localStorage.getItem('pos_selected_outlet');
const root = createRoot(document.getElementById('root')!); root.render(<App />);
void (async () => {
  await until(() => document.querySelector('.sidebar-nav'), 'sidebar');
  const inventory = [...document.querySelectorAll('.nav-group')].find(group => group.querySelector('.nav-group-title')?.textContent?.includes('Inventory'))!;
  inventory.querySelector<HTMLElement>('.nav-group-title')!.click(); await pause();
  const item = [...inventory.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(node => node.textContent === 'Stock Transfer')!;
  assert(item && item.querySelector('svg'), 'Stock Transfer is under Inventory with an existing icon');
  assert(inventory.textContent?.includes('Stock In and Out'), 'Existing Inventory navigation item remains available');
  item.click(); await until(() => document.querySelector('.stock-transfer-page'), 'Stock Transfer page');
  assert(item.classList.contains('active') && document.querySelector('h1')?.textContent === 'Stock Transfer', 'Inventory navigation opens the dedicated Stock Transfer screen');
  assert(localStorage.getItem('pos_selected_outlet') === originalOutlet, 'Source outlet selection does not replace the authenticated selected outlet');
  assert(!document.querySelector('.bulk-stock-transfer, .st-mode-tabs') && !document.body.textContent?.includes('Bulk Transfer'), 'Stock Transfer opens directly without the removed bulk workflow or mode tabs');
  await until(() => document.body.textContent?.includes('No stockable products in this outlet'), 'source product reads');
  const before = requests.length;
  document.querySelector<HTMLButtonElement>('.stock-transfer-page .devices-heading button')!.click(); await pause();
  assert(requests.length === before && requests.every(path => path.includes('/dashboard?') || path === '/api/auth/outlets' || /\/(products|categories)$/.test(path)), 'Stock Transfer reads only existing outlet/product/category GET endpoints and makes no writes');
  const masters = [...document.querySelectorAll('.nav-group')].find(group => group.querySelector('.nav-group-title')?.textContent?.includes('Masters'))!;
  masters.querySelector<HTMLElement>('.nav-group-title')!.click(); await pause();
  assert([...masters.querySelectorAll('.nav-group-items button')].some(node => node.textContent === 'Product Transfer'), 'Existing Product Transfer navigation remains available');
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
