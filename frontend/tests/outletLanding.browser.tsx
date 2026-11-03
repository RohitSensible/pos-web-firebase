import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

const checks: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(); } throw new Error(label); }
const user = { id: 'u', name: 'User', email: 'user@example.com', role: 'Admin', terminal: 'POS' };
const outlets = ['A', 'B'].map(name => ({ id: name, name: `Outlet ${name}`, active: true, branch: '', country: '' }));
const requests: string[] = [];
window.fetch = async input => {
  const path = String(input); requests.push(path);
  if (path === '/api/auth/login') return Response.json({ success: true, data: { token: 'mock-token', user } });
  if (path === '/api/auth/outlets') return Response.json({ success: true, data: { outlets } });
  if (path.includes('/dashboard?')) return Response.json({ success: true, data: { payments: {}, shifts: [] } });
  if (path.endsWith('/products') || path.endsWith('/categories')) return Response.json({ success: true, data: [] });
  throw new Error(`Unexpected request: ${path}`);
};
localStorage.clear(); sessionStorage.clear(); history.replaceState({ 'pos-screen': 'Masters:Products' }, '');
let root = createRoot(document.getElementById('root')!);
root.render(<App />);
function setInput(id: string, value: string) {
  const input = document.getElementById(id)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
async function login() {
  await until(() => document.getElementById('crm-email'), 'Login did not render');
  setInput('crm-email', user.email); setInput('crm-quick-pin', '1234'); await pause();
  document.querySelector<HTMLButtonElement>('.crm-sign-in-button')!.click();
  await until(() => document.querySelector('.outlet-card button'), 'Outlet selection did not render');
}
async function choose(name: string) {
  const card = [...document.querySelectorAll('.outlet-card')].find(card => card.textContent?.includes(`Outlet ${name}`))!;
  card.querySelector<HTMLButtonElement>('button')!.click();
  await until(() => document.querySelector('.dashboard-columns'), 'Outlet did not open Dashboard');
  assert(history.state['pos-screen'] === 'Home:Dashboard' && !document.querySelector('.products-page-shell'), `Opening Outlet ${name} lands directly on Dashboard`);
}
async function products() {
  const item = () => [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(node => node.textContent?.trim() === 'Products');
  if (!item()) {
    [...document.querySelectorAll<HTMLButtonElement>('.nav-group-title')].find(node => node.textContent?.trim() === 'Masters')!.click();
    await until(item, 'Masters did not expand');
  }
  item()!.click(); await until(() => document.querySelector('.products-page-shell'), 'Products did not open');
}
void (async () => {
  await login(); await choose('A');
  assert(!requests.some(path => path.endsWith('/products')), 'Initial login does not load the stale Products screen');
  await products();
  document.querySelector<HTMLButtonElement>('.business-outlet-switch')!.click();
  await until(() => document.querySelector('.outlet-card button'), 'Change Outlet failed');
  await choose('B');
  assert(JSON.parse(localStorage.getItem('pos_selected_outlet')!).id === 'B', 'Outlet change retains the newly selected outlet');
  await products();
  const before = requests.length;
  root.unmount(); root = createRoot(document.getElementById('root')!); root.render(<App />);
  await until(() => document.querySelector('.dashboard-columns'), 'Restored outlet did not start on Dashboard');
  assert(history.state['pos-screen'] === 'Home:Dashboard' && !requests.slice(before).some(path => path.endsWith('/products')), 'Reloading the saved outlet starts on Dashboard without fetching the previous page');
  await products();
  document.querySelector<HTMLButtonElement>('.sidebar-logout')!.click();
  await until(() => document.querySelector('.action-confirm-button'), 'Logout confirmation missing');
  document.querySelector<HTMLButtonElement>('.action-confirm-button')!.click();
  await login(); await choose('A');
  assert(!!document.querySelector('.dashboard-columns'), 'Signing in again after leaving a module also opens Dashboard');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
