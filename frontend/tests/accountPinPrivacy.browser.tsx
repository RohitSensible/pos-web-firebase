import { useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { UserAccountPage } from '../src/pages/UserAccountPage.tsx';
import '../src/index.css';

const checks: string[] = [];
function assert(ok: unknown, message: string) { if (!ok) throw new Error(message); checks.push(message); }
const pause = () => new Promise(resolve => window.setTimeout(resolve, 20));
async function until(check: () => unknown, message: string) {
  for (let attempt = 0; attempt < 120; attempt++) { if (check()) return; await pause(); }
  throw new Error('Timeout: ' + message);
}
type Details = { name: string | null; email: string | null; hasLoginPin: boolean; loginPin: string | null };
const privatePin = '071628';
const consoleCalls: unknown[][] = [];
const restoreConsole: (() => void)[] = [];
for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const original = console[method];
  console[method] = (...args: unknown[]) => { consoleCalls.push(args); };
  restoreConsole.push(() => { console[method] = original; });
}
const profile: Details = { name: 'Current User', email: 'current@example.com', hasLoginPin: true, loginPin: privatePin };
const requests: { token: string; signal: AbortSignal; release: (data: Details) => void }[] = [];
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  assert(String(input) === '/api/auth/account' && (!init?.method || init.method === 'GET'), 'Privacy fixture permits only mocked account reads');
  assert(init?.cache === 'no-store', 'Account reads keep the existing fresh-read policy');
  assert(!JSON.stringify([String(input), init?.headers, init?.body]).includes(privatePin), 'Account read never sends the PIN');
  return new Promise<Response>(resolve => {
    requests.push({ token: (init?.headers as Record<string, string>).Authorization, signal: init!.signal as AbortSignal,
      release: data => resolve(Response.json({ data })) });
  });
};
const storageSnapshot = () => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]);
const initialStorage = storageSnapshot();
const initialUrl = location.href;
const root = createRoot(document.getElementById('root')!);
const sessionExpired = () => { throw new Error('Unexpected session expiration'); };
const saved = () => { throw new Error('Privacy controls must not save'); };
const pin = () => document.querySelector<HTMLInputElement>('#account-login-pin');
const toggle = () => document.querySelector<HTMLButtonElement>('[aria-controls="account-login-pin"]');
const save = () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
let inspectCommit: (() => void) | undefined;
function Harness({ token, expired = sessionExpired }: { token: string; expired?: () => void }) {
  useLayoutEffect(() => { inspectCommit?.(); });
  return <UserAccountPage token={token} onSessionExpired={expired} onSaved={saved} />;
}
function render(token: string, expired: () => void = sessionExpired) { flushSync(() => root.render(<Harness token={token} expired={expired} />)); }
async function load(token: string, data: Details) {
  const count = requests.length;
  render(token);
  await until(() => requests.length > count, 'mocked account request');
  const request = requests.at(-1)!;
  assert(request.token === `Bearer ${token}`, 'Account read uses the active session');
  request.release(data);
  await until(() => document.querySelector('form'), 'account read completion');
}
function noLeaks() {
  const field = pin();
  assert(!document.querySelector('.user-account-page')!.textContent!.includes(privatePin), 'PIN never appears in page text, help, labels or notices');
  assert([...document.querySelectorAll('.user-account-page *')].every(element => [...element.attributes].every(attribute =>
    (element === field && attribute.name === 'value') || !attribute.value.includes(privatePin))), 'Only the read-only field may contain the PIN in an attribute');
  assert(storageSnapshot() === initialStorage && location.href === initialUrl, 'Privacy actions leave storage and URL unchanged');
  assert(!JSON.stringify(consoleCalls).includes(privatePin), 'Privacy actions never log the PIN');
}

const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
const restores: (() => void)[] = [];
for (const [target, names] of [[window, ['blur', 'pagehide']], [document, ['visibilitychange']]] as const) {
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  const originalAdd = target.addEventListener;
  const originalRemove = target.removeEventListener;
  target.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if ((names as readonly string[]).includes(type)) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    }
    add(type, listener, options);
  }) as typeof target.addEventListener;
  target.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
    if ((names as readonly string[]).includes(type)) listeners.get(type)?.delete(listener);
    remove(type, listener, options);
  }) as typeof target.removeEventListener;
  restores.push(() => { target.addEventListener = originalAdd; target.removeEventListener = originalRemove; });
}
const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
function visibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}

void (async () => {
  await load('first-session', profile);
  assert(pin()?.type === 'password' && pin()?.value === privatePin && pin()?.readOnly && !pin()?.name, 'PIN starts concealed, preserves leading zeroes and remains read-only without a submit name');
  assert(toggle()?.textContent === 'Show PIN' && toggle()?.getAttribute('aria-pressed') === 'false' && toggle()?.getAttribute('aria-controls') === pin()?.id, 'Reveal button has a clear label, controlled field and pressed state');
  assert(pin()?.labels?.[0]?.textContent === 'Login PIN' && !!document.getElementById(pin()!.getAttribute('aria-describedby')!), 'PIN field keeps a label and explanatory help');
  assert(toggle()?.tagName === 'BUTTON' && toggle()?.type === 'button' && toggle()?.tabIndex === 0, 'Reveal is a native keyboard-accessible button that cannot submit');
  const controls = document.querySelector('.user-account-pin-controls')!.getBoundingClientRect();
  assert(controls.left >= 0 && controls.right <= innerWidth && toggle()!.getBoundingClientRect().right <= controls.right + 1, 'PIN and toggle fit together inside the viewport');
  assert(save().disabled && [...new FormData(document.querySelector('form')!).values()].every(value => value !== privatePin), 'Read-only PIN is excluded from form entries and cannot enable save');
  noLeaks();
  toggle()!.focus(); toggle()!.click(); await pause();
  assert(pin()?.type === 'text' && toggle()?.getAttribute('aria-pressed') === 'true' && toggle()?.textContent === 'Hide PIN', 'User can reveal the unchanged PIN');
  pin()!.focus(); toggle()!.focus(); await pause();
  assert(pin()?.type === 'text' && document.activeElement === toggle(), 'Moving keyboard focus from the PIN to its toggle keeps Hide PIN usable');
  noLeaks();
  toggle()!.click(); await pause();
  assert(pin()?.type === 'password' && toggle()?.getAttribute('aria-pressed') === 'false', 'User can hide the PIN again');
  const name = document.querySelector<HTMLInputElement>('input[name="name"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Draft Name');
  name.dispatchEvent(new Event('input', { bubbles: true })); await pause();
  toggle()!.click(); await pause(); visibility('hidden'); await pause();
  assert(pin()?.type === 'password', 'Hidden document automatically conceals the PIN');
  visibility('visible'); await pause();
  assert(pin()?.type === 'password', 'Returning to the page does not reveal the PIN again');
  toggle()!.click(); await pause(); window.dispatchEvent(new Event('blur')); await pause();
  assert(pin()?.type === 'password', 'Leaving the browser window conceals the PIN');
  toggle()!.click(); await pause(); window.dispatchEvent(new Event('pagehide')); await pause();
  assert(pin()?.type === 'password', 'Page navigation conceals the PIN');
  toggle()!.focus(); toggle()!.click(); await pause();
  const outside = document.getElementById('test-results')!;
  outside.tabIndex = 0; outside.focus(); await pause();
  assert(pin()?.type === 'password', 'Moving focus outside the account page conceals the PIN');
  assert(name.value === 'Draft Name' && !save().disabled, 'Privacy actions preserve unsaved edits and the existing save availability');
  toggle()!.click(); await pause();
  const oldRequest = requests.at(-1)!;
  inspectCommit = () => {
    assert(!pin() && !document.querySelector('input[name="name"]'), 'Session change removes prior account fields before passive effects');
    assert(!document.querySelector('.user-account-page')!.textContent!.includes(profile.name!), 'Session change cannot render the previous account name');
  };
  render('second-session'); inspectCommit = undefined;
  await until(() => requests.length === 2, 'second session request');
  assert(oldRequest.signal.aborted, 'Session change aborts the old account request');
  requests.at(-1)!.release({ ...profile, name: 'Next User', loginPin: '024680' });
  await until(() => pin()?.value === '024680', 'second session load');
  assert(pin()?.type === 'password' && toggle()?.getAttribute('aria-pressed') === 'false', 'New account is concealed even after the previous account was revealed');
  toggle()!.click(); await pause();
  const beforeRefresh = requests.length;
  render('second-session', () => {});
  await until(() => requests.length > beforeRefresh, 'account refresh');
  requests.at(-1)!.release({ ...profile, name: 'Refreshed User', loginPin: '035791' });
  await until(() => pin()?.value === '035791', 'refreshed account');
  assert(pin()?.type === 'password', 'Replacing account details resets reveal state within the same session');
  await load('missing-pin', { ...profile, loginPin: null });
  assert(pin()?.type === 'text' && pin()?.value === 'Unavailable' && !toggle() && document.getElementById('account-pin-help')?.textContent?.includes('This PIN cannot be displayed.'), 'Missing PIN keeps the clear unavailable message with no fake mask or reveal action');
  await load('empty-pin', { ...profile, loginPin: '' });
  assert(pin()?.value === 'Unavailable' && pin()?.type === 'text' && !toggle(), 'Empty PIN also has no mask or useless reveal action');
  await load('absent-pin', { ...profile, hasLoginPin: false, loginPin: null });
  assert(!pin() && !toggle(), 'Account without a PIN does not invent a field or reveal action');
  await load('late-session', profile);
  toggle()!.click(); await pause();
  render('pending-session');
  await until(() => requests.at(-1)?.token === 'Bearer pending-session', 'pending request');
  const pending = requests.at(-1)!;
  render('final-session');
  await until(() => requests.at(-1)?.token === 'Bearer final-session', 'final session request');
  pending.release(profile); await pause();
  assert(pending.signal.aborted && !pin(), 'Late response from a previous session cannot restore its PIN under a new session');
  const finalRequest = requests.at(-1)!;
  flushSync(() => root.unmount());
  assert(finalRequest.signal.aborted && !pin(), 'Unmount aborts pending reads and removes private fields');
  assert([...listeners.values()].every(set => set.size === 0), 'Unmount removes all privacy event listeners');
  finalRequest.release(profile); await pause();
  assert(!pin() && !document.querySelector('.user-account-page'), 'Late read completion cannot restore private fields after unmount');
  assert(storageSnapshot() === initialStorage && location.href === initialUrl, 'All privacy scenarios leave storage and URL unchanged');
  assert(!JSON.stringify(consoleCalls).includes(privatePin), 'No lifecycle scenario logs the PIN');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
})().catch(error => {
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks });
}).finally(() => {
  window.fetch = originalFetch;
  for (const restore of restoreConsole) restore();
  for (const restore of restores) restore();
  if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
  else Reflect.deleteProperty(document, 'visibilityState');
});
