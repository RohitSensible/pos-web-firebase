import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReportMonthInput } from '../src/pages/ReportMonthInput.tsx';
import '../src/index.css';

window.fetch = async () => { throw new Error('Unexpected network request'); };
const checks: string[] = [];
const changes: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => window.setTimeout(resolve, 20));
async function until(check: () => unknown) {
  for (let i = 0; i < 100; i++) { if (check()) return; await pause(); }
  throw new Error('Timed out waiting for render');
}
function Demo() {
  const [value, setValue] = useState('2024-02');
  const [other, setOther] = useState('0000-13');
  return <main style={{ padding: 16, maxWidth: 380 }}>
    <ReportMonthInput aria-label="Report month" value={value} onChange={next => { changes.push(next); setValue(next); }} />
    <ReportMonthInput aria-label="Other month" value={other} onChange={next => { changes.push(next); setOther(next); }} />
    <button id="outside">Outside</button>
    <button id="early" onClick={() => setValue('0001-01')}>Early year</button>
    <button id="late" onClick={() => setValue('9999-12')}>Late year</button>
    <button id="zero" onClick={() => setOther('0000-01')}>Zero year</button>
    <button id="invalid" onClick={() => setOther('not-a-month')}>Invalid month</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Demo />);
const triggers = () => [...document.querySelectorAll<HTMLButtonElement>('.report-date-trigger')];
const popup = () => document.querySelector<HTMLElement>('.report-month-calendar');
const button = (label: string) => popup()!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const select = (label: string) => popup()!.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
const focused = (name: string) => document.activeElement === button(name);
const year = () => select('Year').value;
const stops = () => [...popup()!.querySelectorAll<HTMLButtonElement>('.report-month-grid button')].filter(item => item.tabIndex === 0);
const key = async (name: string) => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  document.activeElement!.dispatchEvent(event);
  await pause();
  return event.defaultPrevented;
};
const open = async (index = 0) => { triggers()[index].click(); await until(popup); };
const escape = async () => { await key('Escape'); assert(!popup(), 'Escape closes the picker'); };
const changeSelect = async (label: string, value: string) => {
  const control = select(label); control.focus(); control.value = value;
  control.dispatchEvent(new Event('change', { bubbles: true })); await pause();
  assert(document.activeElement === control, `${label} dropdown retains focus`);
};
void (async () => {
  await until(() => triggers().length === 2);
  triggers()[0].focus(); await key('ArrowDown'); await until(popup);
  assert(focused('February'), 'keyboard opening focuses selected February');
  assert(button('February').getAttribute('aria-pressed') === 'true', 'selected month is marked');
  const firstId = popup()!.id;
  assert(triggers()[0].getAttribute('aria-controls') === firstId, 'trigger references its popup');
  assert(popup()!.parentElement === document.body, 'popup uses a portal');
  const bounds = popup()!.getBoundingClientRect();
  assert(bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1, 'popup fits desktop or narrow viewport');
  assert(stops().length === 1 && stops()[0] === button('February'), 'grid has one Tab stop');
  const tabbables = [...popup()!.querySelectorAll<HTMLElement>('button:not(:disabled), select')].filter(item => item.tabIndex >= 0);
  const next = tabbables[tabbables.indexOf(button('February')) + 1];
  assert(next.textContent === 'This month', 'Tab order leaves the grid for This month');
  // Untrusted Tab does not run browser defaults: explicitly exercise its focus destination.
  await key('Tab'); next.focus(); await pause();
  assert(!!popup() && document.activeElement === next, 'Tab focus inside the portal keeps it open');
  button('February').focus(); await key('ArrowRight'); assert(focused('March'), 'Right moves one month');
  await key('ArrowDown'); assert(focused('June'), 'Down moves one three-column row');
  await key('ArrowUp'); assert(focused('March'), 'Up moves one row back');
  await key('ArrowLeft'); assert(focused('February'), 'Left moves one month back');
  await key('End'); assert(focused('December'), 'End focuses December');
  await key('ArrowRight'); assert(year() === '2025' && focused('January'), 'Right crosses into next year');
  await key('ArrowLeft'); assert(year() === '2024' && focused('December'), 'Left crosses into previous year');
  await key('Home'); assert(focused('January'), 'Home focuses January');
  await key('ArrowUp'); assert(year() === '2023' && focused('October'), 'Up crosses a year by three months');
  await key('ArrowDown'); await key('ArrowRight');
  await key('PageDown'); assert(year() === '2025' && focused('February'), 'PageDown preserves February across leap-year boundary');
  await key('PageUp'); assert(year() === '2024' && focused('February'), 'PageUp returns to leap-year February');
  assert(changes.length === 0, 'keyboard navigation never selects');
  await changeSelect('Month', '10'); await changeSelect('Year', '2026');
  assert(stops()[0] === button('November'), 'dropdowns update the roving month');
  button('Next year').click(); await pause(); assert(year() === '2027' && focused('November'), 'Next year focuses a valid month');
  button('Previous year').click(); await pause(); assert(year() === '2026' && focused('November'), 'Previous year focuses a valid month');
  assert(changes.length === 0, 'dropdown and year navigation never select');
  // Native buttons own Enter/Space activation. Untrusted keys need an explicit click.
  for (const activation of ['Enter', ' ']) {
    const prevented = await key(activation); assert(!prevented && !!popup(), `${JSON.stringify(activation)} remains native button activation`);
    (document.activeElement as HTMLButtonElement).click(); await pause();
    assert(changes.at(-1) === '2026-11' && !popup(), 'month activation emits ISO value and closes');
    assert(document.activeElement === triggers()[0], 'selection restores trigger focus');
    if (activation === 'Enter') await open();
  }
  await open(); await escape(); assert(document.activeElement === triggers()[0], 'Escape restores trigger focus');
  await open(); document.getElementById('outside')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await pause();
  assert(!popup() && document.activeElement === triggers()[0], 'outside pointer closes and restores focus');
  await open(); document.getElementById('outside')!.focus(); await pause();
  assert(!popup() && document.activeElement === triggers()[0], 'outside focus closes and restores focus');
  document.getElementById('early')!.click(); await pause(); await open();
  assert(year() === '1' && focused('January') && button('Previous year').disabled, 'year 0001 is preserved');
  await key('ArrowLeft'); await key('PageUp'); assert(year() === '1' && focused('January'), 'lower boundary clamps navigation');
  await key('PageDown'); button('January').click(); await pause();
  assert(changes.at(-1) === '0002-01', 'early years emit four-digit ISO without a 1900 offset');
  document.getElementById('late')!.click(); await pause(); await open(); await key('ArrowRight'); await key('PageDown');
  assert(year() === '9999' && focused('December') && button('Next year').disabled, 'upper boundary stays within year 9999');
  await escape();
  for (const invalid of [null, 'zero', 'invalid']) {
    if (invalid) { document.getElementById(invalid)!.click(); await pause(); }
    assert(triggers()[1].textContent?.includes('Choose month'), 'invalid controlled value shows placeholder');
    await open(1);
    assert(popup()!.id !== firstId && triggers()[1].getAttribute('aria-controls') === popup()!.id, 'instances have unique popup references');
    assert(stops().length === 1 && document.activeElement === stops()[0], 'invalid value focuses fallback month');
    await escape();
  }
  await open(1); [...popup()!.querySelectorAll('button')].find(item => item.textContent === 'This month')!.click(); await pause();
  const now = new Date();
  assert(changes.at(-1) === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, 'This month selects local current month');
  if (location.hash === '#preview') await open(1);
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
