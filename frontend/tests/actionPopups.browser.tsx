import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ActionConfirmation } from '../src/pages/ActionPopup.tsx';
import { SuccessPopup } from '../src/pages/SuccessPopup.tsx';
import { useActionConfirmation } from '../src/utils/useActionConfirmation.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';
import '../src/pages/MasterForm.css';
import '../src/pages/EmployeesPage.css';
import '../src/pages/AddProductForm.css';
const checks: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 160; i++) { if (check()) return; await pause(); } throw new Error('Timeout: ' + label); }
let writes = 0;
function Harness() {
  const [open, setOpen] = useState(true);
  const { confirmAction, confirmation } = useActionConfirmation(open);
  const [success, setSuccess] = useState(false);
  const run = async () => { if (await confirmAction('add', 'Suresh')) { writes++; setSuccess(true); } };
  return <><button id="add" onClick={() => void run()}>Add employee</button><button id="close-form" onClick={() => setOpen(false)}>Close form</button><button id="reopen" onClick={() => setOpen(true)}>Reopen</button>
    <div className="category-modal master-form-page employee-form-page add-product-modal"><form><footer className="modal-footer"><button type="button">Save</button></footer>{open && confirmation}</form></div>{success && <SuccessPopup message="Employee added successfully." onDismiss={() => setSuccess(false)} />}</>;
}
const root = createRoot(document.getElementById('root')!);
const dialog = () => document.querySelector<HTMLDialogElement>('dialog[open]');
const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
void (async () => {
  document.documentElement.dataset.theme = 'dark';
  root.render(<Harness />); await until(() => document.getElementById('add'), 'harness');
  click('#add'); await until(dialog, 'add confirmation');
  assert(dialog()!.querySelector('.action-popup-question')!.textContent === 'Are you sure you want to add Suresh?', 'Add confirmation contains only the short item-specific question');
  assert(!dialog()!.querySelector('.modal-body svg'), 'Confirmation has no warning illustration');
  assert(getComputedStyle(dialog()!).backgroundColor === 'rgb(25, 35, 49)', 'Confirmation retains the existing dark theme');
  assert(getComputedStyle(dialog()!.querySelector('.action-confirm-button')!).backgroundColor === 'rgb(220, 38, 38)', 'Primary confirmation button is crimson');
  assert(getComputedStyle(dialog()!.querySelector('.modal-body')!).display === 'flex', 'Product form grid layout does not leak into nested dialogs');
  assert(getComputedStyle(dialog()!).borderRadius === '12px', 'Action dialog uses the shared shell radius');
  const footer = getComputedStyle(dialog()!.querySelector('.modal-footer')!);
  assert(footer.paddingTop === '16px' && footer.paddingLeft === '20px' && footer.marginTop === '0px', 'Nested confirmation footer is independent of host form layout');
  assert(getComputedStyle(dialog()!.querySelector('.modal-footer button')!).minHeight === '40px', 'Host form button dimensions do not leak into nested popups');
  assert(document.activeElement?.textContent === 'Cancel', 'Cancel receives initial keyboard focus');
  const bounds = dialog()!.getBoundingClientRect();
  assert(bounds.width <= innerWidth - 30 && bounds.left >= 0 && bounds.right <= innerWidth, 'Popup fits the screen without horizontal overflow');
  click('.delete-confirmation-cancel'); await until(() => !dialog(), 'cancel');
  assert(writes === 0, 'Cancellation performs no action');
  click('#add'); await until(dialog, 'second confirmation');
  click('#close-form'); await until(() => !dialog(), 'closed form');
  click('#reopen'); await pause(); click('#add'); await until(dialog, 'confirmation after closing form');
  assert(writes === 0, 'Leaving a form cancels its pending confirmation');
  click('.action-confirm-button'); await until(() => document.querySelector('.action-success[open]'), 'success');
  assert(writes === 1 && dialog()!.textContent!.includes('Added successfully.'), 'Confirmed add produces one action and clear success feedback');
  assert(!!dialog()!.querySelector('.success-checkmark svg') && dialog()!.querySelectorAll('.modal-footer button').length === 1 && dialog()!.querySelector('.success-done')!.textContent === 'Done', 'Success uses one green checkmark and a single Done action');
  assert(getComputedStyle(dialog()!.querySelector('.success-checkmark')!).color === 'rgb(74, 222, 128)', 'Success indicator is green in dark mode');
  assert(document.activeElement?.textContent === 'Done', 'Done receives keyboard focus');
  click('.success-done'); await until(() => !dialog(), 'Done');
  assert(writes === 1, 'Dismissing success never repeats an action');
  document.documentElement.dataset.theme = 'light';
  root.render(<ActionConfirmation action="delete" item="ganesh" busy onCancel={() => { throw new Error('Busy action dismissed'); }} onConfirm={() => { throw new Error('Busy action repeated'); }} />);
  await until(dialog, 'busy confirmation');
  assert(getComputedStyle(dialog()!).backgroundColor === 'rgb(255, 255, 255)', 'Light theme remains supported');
  assert([...dialog()!.querySelectorAll('button')].every(button => button.disabled), 'Busy actions disable confirmation and dismissal');
  dialog()!.dispatchEvent(new Event('cancel', { cancelable: true })); await pause(); assert(!!dialog(), 'Escape cannot dismiss a busy action');
  if (location.hash.includes('preview')) {
    root.render(<SuccessPopup message="Updated successfully." onDismiss={() => {}} />); await pause();
    document.documentElement.dataset.theme = 'dark';
  } else root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
