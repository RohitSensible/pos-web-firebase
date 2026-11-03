import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { LoginPage, type UserSession } from '../src/pages/LoginPage.tsx';
import '../src/pages/LoginPage.css';

const passed: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); passed.push(message); };
const nativeTimeout = window.setTimeout.bind(window);
const nativeClearTimeout = window.clearTimeout.bind(window);
const pause = () => new Promise<void>(resolve => nativeTimeout(resolve, 0));
const settle = async () => { await pause(); await pause(); };
const timers = new Map<number, () => void>();
let timerId = -1;
// Advance only the login deadline; React and the fixture keep their real timers.
window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
  if (delay !== 20_000) return nativeTimeout(handler, delay, ...args);
  if (typeof handler !== 'function') throw new Error('Unexpected string timer');
  const id = timerId--;
  timers.set(id, () => handler(...args));
  return id;
}) as typeof window.setTimeout;
window.clearTimeout = (id?: Parameters<typeof window.clearTimeout>[0]) => {
  if (typeof id === 'number' && timers.delete(id)) return;
  nativeClearTimeout(id);
};
const expire = () => {
  assert(timers.size === 1, 'One bounded 20-second deadline is active');
  const [id, callback] = [...timers.entries()][0]!;
  timers.delete(id); callback();
};
type Request = { init: RequestInit; resolve: (response: Response) => void; reject: (reason: unknown) => void };
const requests: Request[] = [];
const unexpected: string[] = [];
const unhandled: string[] = [];
window.addEventListener('unhandledrejection', event => { unhandled.push(String(event.reason)); event.preventDefault(); });
window.fetch = (input, init) => {
  if (String(input) !== '/api/auth/login') {
    unexpected.push(String(input));
    return Promise.reject(new Error('Unexpected endpoint'));
  }
  // Deliberately ignore cancellation to prove obsolete responses are harmless.
  return new Promise<Response>((resolve, reject) => requests.push({ init: init!, resolve, reject }));
};
const user = { id: 'user', email: 'user@example.com', name: 'Test User', role: 'Admin', terminal: 'POS Workspace' };
const success = () => Response.json({ success: true, data: { user, token: 'mock-token' } });
const sessions: UserSession[] = [];
const host = document.getElementById('root')!;
let root = createRoot(host);
const render = () => flushSync(() => root.render(<StrictMode><LoginPage onLoginSuccess={session => sessions.push(session)} /></StrictMode>));
const form = () => host.querySelector<HTMLFormElement>('form')!;
const email = () => host.querySelector<HTMLInputElement>('#crm-email')!;
const pin = () => host.querySelector<HTMLInputElement>('#crm-quick-pin')!;
const toggle = () => host.querySelector<HTMLButtonElement>('[aria-label="Toggle quick PIN visibility"]')!;
const submitButton = () => host.querySelector<HTMLButtonElement>('[type=submit]')!;
const alert = () => host.querySelector<HTMLElement>('[role=alert]');
const input = (element: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  flushSync(() => element.dispatchEvent(new Event('input', { bubbles: true })));
};
const fill = () => { input(email(), ' user@example.com '); input(pin(), '123456'); };
// Dispatch directly so two submissions can run before React paints disabled controls.
const submit = () => form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const remount = () => { flushSync(() => root.unmount()); root = createRoot(host); render(); fill(); };
const latest = () => requests[requests.length - 1]!;

void (async () => {
  render(); fill();
  input(pin(), 'a12b34567');
  assert(pin().value === '123456' && pin().pattern === '[0-9]{4,6}' && pin().minLength === 4 && pin().maxLength === 6, 'PIN retains numeric-only entry and 4–6 digit rules');
  input(pin(), '123'); assert(!pin().checkValidity(), 'Three-digit PIN is invalid');
  input(pin(), '1234'); assert(pin().checkValidity(), 'Four-digit PIN is valid');
  input(pin(), '123456'); assert(pin().checkValidity(), 'Six-digit PIN is valid');
  assert(pin().type === 'password' && toggle().getAttribute('aria-pressed') === 'false', 'PIN starts hidden with an unpressed visibility toggle');
  flushSync(() => toggle().click());
  assert(pin().type === 'text' && toggle().getAttribute('aria-pressed') === 'true' && toggle().getAttribute('aria-label') === 'Toggle quick PIN visibility', 'Showing PIN exposes pressed state and preserves its accessible label');
  flushSync(() => toggle().click());
  assert(pin().type === 'password' && toggle().getAttribute('aria-pressed') === 'false', 'PIN can be hidden again');

  submit(); submit();
  assert(requests.length === 1, 'Synchronous double submit sends exactly one login request');
  await settle();
  const timedOut = latest();
  assert(timedOut.init.method === 'POST' && new Headers(timedOut.init.headers).get('Content-Type') === 'application/json'
    && timedOut.init.body === JSON.stringify({ email: user.email, quickPin: '123456', terminal: 'POS Workspace' }), 'Login keeps the exact POST payload and JSON header');
  assert(form().getAttribute('aria-busy') === 'true' && email().disabled && pin().disabled && toggle().disabled && submitButton().disabled, 'Pending login marks the form busy and disables all relevant controls');
  submit(); assert(requests.length === 1, 'Repeated pending submit is ignored');
  expire(); await settle();
  const timeoutMessage = alert()?.textContent;
  assert(timedOut.init.signal?.aborted && timeoutMessage?.includes('timed out') && timeoutMessage.includes('select Sign in'), 'Deadline aborts the request and explains how to retry');
  assert(form().getAttribute('aria-busy') === 'false' && !email().disabled && !pin().disabled && !toggle().disabled && !submitButton().disabled, 'Timeout releases the guard and controls');
  assert(email().value === user.email && pin().value === '123456' && requests.length === 1, 'Timeout preserves credentials without automatically retrying');
  assert(email().getAttribute('aria-describedby') === alert()?.id && pin().getAttribute('aria-describedby') === alert()?.id, 'Alert is associated with both credential fields');

  submit(); submit(); await settle();
  assert(requests.length === 2 && !alert(), 'User-driven retry starts one fresh request and clears the old error');
  timedOut.resolve(success()); await settle();
  assert(sessions.length === 0 && form().getAttribute('aria-busy') === 'true' && submitButton().disabled && timers.size === 1, 'Late timed-out success cannot sign in or release a newer request');
  latest().resolve(success()); await settle();
  assert(sessions.length === 1 && JSON.stringify(sessions[0]) === JSON.stringify({ ...user, token: 'mock-token' }), 'Retry succeeds once with the unchanged session result shape');
  submit(); await settle();
  assert(requests.length === 2 && sessions.length === 1 && timers.size === 0, 'Successful login clears its deadline and cannot deliver success twice');

  remount(); submit(); await settle();
  latest().resolve(Response.json({ success: false, message: 'Invalid credentials' }, { status: 401 })); await settle();
  assert(alert()?.textContent === 'Invalid credentials' && !submitButton().disabled && timers.size === 0 && pin().value === '123456', 'Bad credentials show the server error, preserve inputs and release the guard');
  submit(); await settle(); latest().reject(new TypeError('mock network failure')); await settle();
  assert(alert()?.textContent?.includes('Cannot reach the login server') && !submitButton().disabled && timers.size === 0, 'Network failure gives an actionable error and permits retry');
  submit(); await settle(); latest().resolve(new Response('<html>Unavailable</html>', { status: 502 })); await settle();
  assert(alert()?.textContent?.includes('unreadable response') && !submitButton().disabled && timers.size === 0, 'Non-JSON error response is handled without losing credentials');
  submit(); await settle(); latest().resolve(Response.json(null)); await settle();
  assert(alert()?.textContent?.includes('Unable to sign in') && !submitButton().disabled, 'Malformed JSON result uses the recoverable fallback error');
  submit(); await settle(); latest().resolve(Response.json({ success: false, message: 'Denied', data: { user, token: 'mock-token' } })); await settle();
  assert(alert()?.textContent === 'Denied' && sessions.length === 1, 'Explicit authentication failure never invokes success even when data is present');

  submit(); await settle();
  const lateFailure = latest();
  expire(); await settle();
  const preservedError = alert()?.textContent;
  lateFailure.reject(new TypeError('obsolete failure')); await settle();
  assert(alert()?.textContent === preservedError && sessions.length === 1, 'Late failure cannot overwrite the timeout error');

  submit(); await settle();
  const parsing = latest();
  let resolveBody!: (value: unknown) => void;
  parsing.resolve({ ok: true, json: () => new Promise(resolve => { resolveBody = resolve; }) } as Response);
  await settle(); expire(); await settle();
  resolveBody({ success: true, data: { user, token: 'mock-token' } }); await settle();
  assert(sessions.length === 1 && alert()?.textContent?.includes('timed out'), 'Deadline also covers response parsing and ignores a late parsed success');

  submit(); await settle();
  const unmounted = latest();
  const staleDeadline = [...timers.values()][0]!;
  flushSync(() => root.unmount());
  assert(unmounted.init.signal?.aborted && timers.size === 0, 'Unmount aborts pending login and clears its deadline');
  root = createRoot(host); render(); fill();
  staleDeadline(); unmounted.resolve(success()); await settle();
  assert(sessions.length === 1 && !alert() && form().getAttribute('aria-busy') === 'false', 'Unmounted success and queued deadline cannot affect a fresh login form');
  submit(); await settle();
  const rejectedAfterUnmount = latest();
  flushSync(() => root.unmount()); rejectedAfterUnmount.reject(new DOMException('Aborted', 'AbortError')); await settle();
  assert(unhandled.length === 0 && unexpected.length === 0 && timers.size === 0, 'Unmounted rejection is handled; only the mock login endpoint was called and no deadlines leak');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => {
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed, failed: String(error) });
}).finally(() => {
  window.setTimeout = nativeTimeout;
  window.clearTimeout = nativeClearTimeout;
});
