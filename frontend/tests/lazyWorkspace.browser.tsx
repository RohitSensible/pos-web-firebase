import { lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import { RouteLoadBoundary } from '../src/components/RouteLoadBoundary.tsx';
import '../src/index.css';

// The shared esbuild runner inlines dynamic imports. These checks exercise React
// suspension, navigation and recovery; the Vite production build checks splitting.
const checks: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) {
  for (let i = 0; i < 160; i++) { if (check()) return; await pause(); }
  throw new Error(`Timeout: ${message}`);
}
const requests: string[] = [];
const unexpected: string[] = [];
window.fetch = async (url, init) => {
  const path = String(url); requests.push(path);
  if (init?.method && init.method !== 'GET') { unexpected.push(path); throw new Error(`Unexpected write: ${path}`); }
  if (path.includes('/dashboard?')) {
    const dayId = new URL(path, location.origin).searchParams.get('dayId');
    return Response.json({ data: { id: 'all', dayId, inActive: false, payments: {}, shifts: [],
      totalSale: 0, cashSale: 0, digitalSale: 0, openingAmt: 0, expCash: 0, billCount: 0 } });
  }
  if (path === '/api/auth/account') return Response.json({ data: { name: 'Lazy User', email: 'lazy@example.com', hasLoginPin: false, loginPin: null } });
  unexpected.push(path);
  throw new Error(`Unexpected read: ${path}`);
};
localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'lazy-user', name: 'Lazy User', email: 'lazy@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'lazy-outlet', name: 'Lazy Outlet', branch: 'Test' }));
const savedOutlet = localStorage.getItem('pos_selected_outlet');
const root = createRoot(document.getElementById('root')!);
root.render(<App />);

void (async () => {
  await until(() => document.querySelector('.page-hero h1'), 'initial dashboard');
  const shell = document.querySelector('.retail-dashboard-shell');
  const header = document.querySelector('.retail-header');
  const sidebar = document.querySelector('.dashboard-sidebar');
  assert(!requests.includes('/api/auth/account'), 'Initial dashboard does not mount a noninitial account page');
  document.querySelector<HTMLButtonElement>('.theme-button')!.click();
  await until(() => document.documentElement.dataset.theme === 'dark', 'theme toggle');
  const masters = [...document.querySelectorAll('.nav-group')].find(group => group.querySelector('.nav-group-title')?.textContent?.includes('Masters'))!;
  if (!masters.querySelector('.nav-group-items')) masters.querySelector<HTMLElement>('.nav-group-title')!.click();
  await until(() => [...masters.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].some(button => button.textContent === 'User Account'), 'Masters expanded');
  [...masters.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(button => button.textContent === 'User Account')!.click();
  await until(() => document.querySelector('.user-account-page input[name="name"]'), 'lazy account transition');
  assert(requests.includes('/api/auth/account'), 'Navigating to the lazy account route mounts the real page with mocked reads');
  assert(document.querySelector('.retail-dashboard-shell') === shell && document.querySelector('.retail-header') === header && document.querySelector('.dashboard-sidebar') === sidebar,
    'Lazy route transition preserves the shell, header and navigation DOM');
  assert(document.documentElement.dataset.theme === 'dark' && localStorage.getItem('pos_selected_outlet') === savedOutlet,
    'Theme and selected outlet survive lazy navigation');
  document.querySelector<HTMLButtonElement>('.workspace-back')!.click();
  await until(() => document.querySelector('.page-hero h1'), 'return dashboard');
  assert(document.querySelector('.retail-dashboard-shell') === shell, 'Workspace Back returns to dashboard without remounting the shell');
  assert(unexpected.length === 0, 'Application smoke check performs only explicitly mocked GET reads');

  // Hold a lazy promise to make the accessible loading fallback deterministic.
  let rejectChunk!: (reason: Error) => void;
  let importCalls = 0;
  const FailedChunk = lazy(() => { importCalls++; return new Promise<{ default: () => null }>((_resolve, reject) => { rejectChunk = reject; }); });
  function RenderFailure(): never { throw new Error('Mock route render failure'); }
  const renderRoute = (route: 'chunk' | 'render' | 'healthy') => root.render(<div>
    <nav data-test-shell>Shell navigation remains available</nav>
    <RouteLoadBoundary key={route}>{route === 'chunk' ? <FailedChunk /> : route === 'render' ? <RenderFailure /> : <h1>Recovered route</h1>}</RouteLoadBoundary>
  </div>);
  renderRoute('chunk');
  await until(() => document.querySelector('.route-load-notice[role="status"]'), 'suspense fallback');
  const recoveryShell = document.querySelector('[data-test-shell]');
  assert(document.querySelector('[role="status"]')?.getAttribute('aria-busy') === 'true' && document.body.textContent?.includes('Loading page…'),
    'Suspended route announces a concise loading status while shell navigation stays available');
  rejectChunk(new Error('Mock chunk download failed'));
  await until(() => document.querySelector('.route-load-notice[role="alert"]'), 'chunk failure boundary');
  const recoveryButton = document.querySelector<HTMLButtonElement>('.route-load-notice button');
  assert(recoveryButton?.textContent === 'Reload page' && document.body.textContent?.includes('Reloading will lose unsaved edits'),
    'Chunk failure offers honest document reload recovery and explains lost drafts');
  await pause();
  assert(importCalls === 1, 'Rejected lazy import does not trigger an endless cached retry');
  renderRoute('healthy');
  await until(() => document.querySelector('h1')?.textContent === 'Recovered route', 'navigation after chunk error');
  assert(document.querySelector('[data-test-shell]') === recoveryShell && !document.querySelector('[role="alert"]'),
    'Choosing another route clears its local error without remounting the surrounding shell');
  renderRoute('render');
  await until(() => document.querySelector('.route-load-notice[role="alert"]'), 'render failure boundary');
  assert(document.querySelector('.route-load-notice button')?.textContent === 'Reload page', 'Render failures receive the same local recovery UI');
  renderRoute('healthy');
  await until(() => document.querySelector('h1')?.textContent === 'Recovered route', 'navigation after render error');
  assert(document.querySelector('[data-test-shell]') === recoveryShell, 'Shell remains usable after both chunk and render failures');
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
