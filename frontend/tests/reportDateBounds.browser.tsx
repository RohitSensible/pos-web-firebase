import { createRoot } from 'react-dom/client';
import { ReportDateInput } from '../src/pages/ReportDateInput.tsx';

// This fixture must remain entirely local, including any future worker/API use.
const unexpectedIO = () => { throw new Error('Unexpected network or worker activity'); };
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'SharedWorker']) {
  Object.defineProperty(window, name, { configurable: true, value: unexpectedIO });
}
const checks: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
const root = createRoot(document.getElementById('root')!);
const changes: string[] = [];
let props = { value: '2024-02-15', min: '2024-02-10', max: '2024-03-05', disabled: false, readOnly: false, required: false };
const render = async (next: Partial<typeof props> = {}) => {
  props = { ...props, ...next };
  root.render(<ReportDateInput {...props} id="date" name="reportDate" aria-label="Report date" onChange={value => changes.push(value)} />);
  await pause();
};
const trigger = () => document.getElementById('date') as HTMLButtonElement;
const popup = () => document.querySelector<HTMLElement>('[role=dialog]');
const day = (date: string) => document.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)!;
const action = (label: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const select = (label: string) => document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
const footer = (label: string) => [...popup()!.querySelectorAll('button')].find(button => button.textContent === label)!;
const focusIs = (date: string, message: string) => {
  assert(document.activeElement === day(date) && !day(date).disabled && day(date).tabIndex === 0, message);
  assert(popup()!.querySelectorAll('[data-date][tabindex="0"]:not(:disabled)').length === 1, 'calendar retains one enabled day in its tab order');
};
const key = async (name: string) => {
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })); await pause();
};
const changeSelect = async (label: string, value: string) => {
  const element = select(label); element.focus(); element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true })); await pause();
};
const open = async () => { trigger().click(); await pause(); assert(!!popup(), 'calendar opens'); };
const escape = async () => { await key('Escape'); assert(!popup() && document.activeElement === trigger(), 'Escape closes the popup and restores trigger focus'); };

void (async () => {
  await render(); await open();
  assert(popup()!.parentElement === document.body, 'bounded calendar preserves portal rendering');
  assert(trigger().getAttribute('aria-label') === 'Report date: 15 Feb 2024', 'trigger preserves its label and formatted controlled value');
  focusIs('2024-02-15', 'selected date receives focus');
  await key('Home'); focusIs('2024-02-12', 'Home moves to Monday');
  await key('End'); focusIs('2024-02-18', 'End moves to Sunday');
  await key('ArrowLeft'); focusIs('2024-02-17', 'ArrowLeft moves one day');
  await key('ArrowRight'); focusIs('2024-02-18', 'ArrowRight moves one day');
  await key('ArrowUp'); focusIs('2024-02-11', 'ArrowUp moves one week');
  await key('ArrowUp'); focusIs('2024-02-10', 'ArrowUp clamps to inclusive minimum');
  await key('ArrowLeft'); focusIs('2024-02-10', 'ArrowLeft stays on minimum');
  await key('Home'); focusIs('2024-02-10', 'Home clamps a partial first week');
  await key('PageUp'); focusIs('2024-02-10', 'PageUp stays on minimum');
  assert(action('Previous month').disabled, 'Previous month is disabled in the first allowed month');
  action('Previous month').click(); await pause(); focusIs('2024-02-10', 'disabled navigation cannot move focus outside bounds');
  await key('PageDown'); focusIs('2024-03-05', 'PageDown clamps to inclusive maximum');
  assert(action('Next month').disabled, 'Next month is disabled in the last allowed month');
  for (const name of ['ArrowRight', 'ArrowDown', 'End', 'PageDown']) { await key(name); focusIs('2024-03-05', `${name} stays at maximum`); }
  await key('ArrowLeft'); focusIs('2024-03-04', 'ArrowLeft can leave the maximum');
  await key('ArrowDown'); focusIs('2024-03-05', 'ArrowDown clamps to maximum');
  assert(day('2024-03-06').disabled && !day('2024-03-05').disabled, 'maximum is inclusive');
  assert(select('Month').options[0].disabled && !select('Month').options[1].disabled && !select('Month').options[2].disabled && select('Month').options[3].disabled, 'month options allow only intersecting months');
  assert([...select('Year').options].filter(option => !option.disabled).every(option => option.value === '2024'), 'year options exclude years outside bounds');
  await changeSelect('Month', '0');
  assert(select('Month').value === '1' && day('2024-02-10').tabIndex === 0, 'month changes clamp even a synthetic disallowed selection');
  await changeSelect('Year', '2023');
  assert(select('Year').value === '2024' && day('2024-02-10').tabIndex === 0, 'year changes clamp disallowed selections');
  await escape();
  await open();
  action('Next month').click(); await pause(); focusIs('2024-03-05', 'Next month clamps focus to the last allowed day');
  action('Previous month').click(); await pause(); focusIs('2024-02-10', 'Previous month clamps focus to the first allowed day');
  assert(day('2024-02-09').disabled && !day('2024-02-10').disabled, 'minimum is inclusive');
  await escape();
  assert(changes.length === 0, 'all navigation and Escape leave controlled value unchanged');

  await render({ value: '2024-02-29', min: '2023-01-01', max: '2025-12-31' }); await open();
  await key('PageDown'); focusIs('2024-03-29', 'PageDown preserves day after leap February');
  await key('PageUp'); focusIs('2024-02-29', 'PageUp returns to leap day');
  await changeSelect('Year', '2023');
  assert(day('2023-02-28').tabIndex === 0 && select('Month').value === '1', 'year selection clamps leap day to February 28');
  await escape();
  await render({ value: '2024-01-31' }); await open();
  await key('PageDown'); focusIs('2024-02-29', 'PageDown clamps January 31 to leap day');
  await key('PageUp'); focusIs('2024-01-29', 'PageUp preserves the clamped day');
  await escape();

  await render({ value: 'invalid', min: '2024-02-29', max: '2024-02-29' }); await open();
  focusIs('2024-02-29', 'invalid current value falls back to an enabled day');
  await escape();

  await render({ value: '', min: '2024-02-29', max: '2024-02-29', required: true }); await open();
  focusIs('2024-02-29', 'missing value opens on the only enabled leap day');
  assert(action('Previous month').disabled && action('Next month').disabled, 'single-day range disables both month buttons');
  assert(footer('Clear').disabled && trigger().getAttribute('aria-required') === 'true', 'required field disables Clear and preserves required semantics');
  assert(footer('Today').disabled, 'Today cannot select outside bounds');
  assert(changes.length === 0, 'opening a missing controlled value never auto-selects');
  day('2024-02-29').click(); await pause();
  assert(changes.join() === '2024-02-29' && !popup(), 'inclusive single-day selection emits exactly the chosen ISO date');
  assert((document.querySelector('input[name=reportDate]') as HTMLInputElement).value === '', 'component leaves the controlled hidden value to its parent');
  changes.length = 0;

  await render({ value: '2024-02-15', min: '2024-02-10', max: '2024-03-05', required: false }); await open();
  await render({ min: '2024-03-01', max: '2024-03-02' });
  focusIs('2024-03-01', 'bounds changing while open reconcile focus to an enabled date');
  assert(trigger().textContent?.includes('15 Feb 2024') && changes.length === 0, 'bound reconciliation preserves selected value without onChange');
  await render({ min: '2024-04-10', max: '2024-04-01' });
  assert(!popup() && document.activeElement === trigger(), 'reversed valid bounds close safely and restore trigger focus');
  trigger().click(); await pause(); assert(!popup(), 'reversed bounds cannot open a calendar with no available dates');
  await render({ min: 'not-a-date', max: '2024-02-30' }); await open();
  focusIs('2024-02-15', 'malformed and impossible bounds are ignored without crashing');
  assert(!action('Previous month').disabled && !action('Next month').disabled, 'invalid bounds do not block month navigation');
  await render({ min: 'invalid', max: '2024-02-12' });
  focusIs('2024-02-12', 'valid maximum still applies when minimum is invalid');
  await render({ disabled: true });
  assert(!popup() && trigger().disabled && changes.length === 0, 'becoming disabled closes without mutation');
  trigger().click(); await pause(); assert(!popup(), 'disabled trigger cannot reopen');
  await render({ disabled: false, max: '', min: '2024-02-20' }); await open();
  focusIs('2024-02-20', 'valid minimum applies without a maximum');
  await render({ readOnly: true });
  assert(!popup() && trigger().disabled && changes.length === 0, 'becoming readOnly closes without mutation');
  trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await pause();
  assert(!popup(), 'readOnly prevents keyboard opening');
  await render({ readOnly: false, min: '', max: '' }); await open();
  footer('Clear').click(); await pause();
  assert(changes.join() === '' && changes.length === 1 && !popup(), 'optional Clear emits only the explicit empty selection');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
