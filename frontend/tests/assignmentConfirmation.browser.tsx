import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ProductServicePointAssignment } from '../src/pages/ProductServicePointAssignment.tsx';
import { SuccessPopup } from '../src/pages/SuccessPopup.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';
const checks: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 160; i++) { if (check()) return; await pause(); } throw new Error(label); }
const requests: Record<string, unknown>[] = [];
let fail = true;
window.fetch = async (input, init) => {
  if (String(input).endsWith('/service-points')) return Response.json({ success: true, data: { servicePoints: [{ documentId: 'kitchen', name: 'Kitchen' }] } });
  assert(String(input) === '/api/outlets/shop/products/assign-service-point' && init?.method === 'POST', 'Assignment retains the existing outlet endpoint and method');
  const body = JSON.parse(String(init?.body)); requests.push(body);
  return fail ? Response.json({ message: 'Assignment failed.' }, { status: 503 }) : Response.json({ success: true, data: { ...body, assignedCount: 2 } });
};
function Harness() {
  const [saved, setSaved] = useState(false);
  return saved ? <SuccessPopup message="Assigned successfully." onDismiss={() => setSaved(false)} /> : <ProductServicePointAssignment outletId="shop" token="test" categories={[{ id: 'food', name: 'Food' }]} onCancel={() => {}} onAssigned={() => setSaved(true)} onSessionExpired={() => { throw new Error('Unexpected expiry'); }} />;
}
const root = createRoot(document.getElementById('root')!); root.render(<Harness />);
const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.service-point-assignment button')].find(button => button.textContent === label)!;
void (async () => {
  await until(() => button('Food'), 'Category selection'); button('Food').click();
  await until(() => document.querySelector('[name=assignedServicePoint]'), 'Service point selection'); click('[name=assignedServicePoint]'); await pause(); button('Assign').click();
  await until(() => document.querySelector('.action-confirmation[open]'), 'Assignment confirmation');
  assert(document.querySelector('.action-popup-question')?.textContent === 'Are you sure you want to assign Kitchen to products in Food?', 'Assignment uses the short shared confirmation');
  assert(requests.length === 0, 'Selection and review perform no assignment');
  click('.delete-confirmation-cancel'); await pause();
  assert(!!document.querySelector('.service-point-assignment[open]') && !document.querySelector('.action-confirmation'), 'Cancel returns to the existing selection dialog');
  button('Assign').click(); await until(() => document.querySelector('.action-confirm-button'), 'Review again'); click('.action-confirm-button');
  await until(() => document.querySelector('.action-confirmation [role=alert]'), 'Failed assignment');
  assert(!document.querySelector('.action-success') && requests.length === 1, 'Failed assignment keeps an error in the confirmation and never shows success');
  fail = false; click('.action-confirm-button');
  await until(() => document.querySelector('.action-success[open]'), 'Successful retry');
  assert(requests.length === 2 && JSON.stringify(requests[0]) === '{"categoryId":"food","servicePointId":"kitchen"}' && JSON.stringify(requests[1]) === JSON.stringify(requests[0]), 'Retry preserves the original assignment payload');
  assert(document.querySelector('.success-done')?.textContent === 'Done', 'Successful assignment uses the common Done popup');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
