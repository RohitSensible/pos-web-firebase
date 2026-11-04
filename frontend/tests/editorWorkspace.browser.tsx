import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';
localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'User', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'test' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'shop', name: 'Outlet' }));
const checks: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 180; i++) { if (check()) return; await pause(); } throw new Error('Timeout: ' + label); }
const product = { documentId: 'p', fields: { name: 'Tea', code: 1, price: 10, category: 'c', taxIndex: 0, unitId: 0 } };
window.fetch = async (input, init) => {
  assert(!init?.method || init.method === 'GET', 'Opening editors never writes data');
  const url = new URL(String(input), location.href).pathname;
  if (url.endsWith('/master-sync')) return new Response('', { status: 404 });
  if (url.endsWith('/dashboard')) return Response.json({ success: true, data: { payments: {} } });
  if (url.endsWith('/employees')) return Response.json({ success: true, data: { employees: [{ documentId: 'e', name: 'Employee', mobile: '99999', searchCode: 1, shortName: 'E', balanceAmt: '0', dateOfJoining: '', userId: '' }], nextSearchCode: 2, userAccounts: [] } });
  if (url.endsWith('/customers')) return Response.json({ success: true, data: { customers: [{ documentId: 'c', name: 'Customer', contact: '99999', altContact: '', email: '', gstNo: '', address: '', creditLimit: 0, dayLimit: 0, balance: 0, birthdayDate: '', anniversaryDate: '', allowedCredit: false }] } });
  if (url.endsWith('/premises')) return Response.json({ success: true, data: { premises: [{ documentId: 'room', fields: { name: 'TABLE', code: 1, type: 'Table', tables: 10, range: 1, taxIndex: 0, userId: '', price: 0 } }], nextCode: 2, taxes: [], userAccounts: [] } });
  if (url.endsWith('/service-points')) return Response.json({ success: true, data: { servicePoints: [{ documentId: 'k', name: 'Kitchen', paperSize: 3, printerType: 0, header: '', subHeader: '', footer: '', printerIpAddress: '', port: null, usbPath: null }] } });
  if (url.endsWith('/edit-options')) return Response.json({ success: true, data: { code: 1, categories: [{ id: 'c', name: 'Drinks' }], taxes: [], units: [], premises: [], servicePointName: '', product } });
  if (url.endsWith('/products')) return Response.json({ success: true, data: [product] });
  if (url.endsWith('/categories')) return Response.json({ success: true, data: [{ id: 'c', name: 'Drinks' }] });
  if (url.endsWith('/profile')) return Response.json({ success: true, data: { name: 'User' } });
  throw new Error('Unexpected read: ' + url);
};
const item = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(button => button.textContent === label);
async function navigate(label: string) {
  if (innerWidth <= 820 && !document.querySelector('.dashboard-sidebar.open')) { document.querySelector<HTMLButtonElement>('.mobile-menu')!.click(); await pause(); }
  if (!item(label)) { [...document.querySelectorAll<HTMLButtonElement>('.nav-group-title')].find(button => button.textContent?.trim() === 'Masters')!.click(); await until(() => item(label), label); }
  item(label)!.click(); await pause();
}
const root = createRoot(document.getElementById('root')!); root.render(<App />);
void (async () => {
  await until(() => document.querySelector('.dashboard-workspace'), 'dashboard');
  const sidebar = document.querySelector('.dashboard-sidebar')!.getBoundingClientRect();
  for (const [page, row, form, fields] of [
    ['Employees/Salesman', '[aria-label="Edit employee Employee"]', '.employee-form-page', '.employees-form-fields'],
    ['Customer', '[aria-label="Edit customer Customer"]', '.customer-form-page', '.customer-form-fields'],
    ['Premises', '[aria-label="Edit premise TABLE"]', '.premises-form', '.premises-fields'],
    ['Service Point', '[aria-label="Edit service point Kitchen"]', '.service-point-form-page', '.service-point-fields'],
    ['Products', '[aria-label="Edit product"]', '.add-product-modal', '.modal-body'],
  ].filter(([page]) => !location.hash.includes('preview') || page === 'Products')) {
    await navigate(page); await until(() => document.querySelector(row), page + ' row');
    document.querySelector<HTMLElement>(row)!.click(); await until(() => document.querySelector(form), page + ' editor'); await pause();
    const editor = document.querySelector(form)!.getBoundingClientRect();
    const workspace = document.querySelector('.dashboard-workspace')!.getBoundingClientRect();
    assert(Math.abs(editor.left - workspace.left) < 2 && Math.abs(editor.width - workspace.width) < 2, page + ': editor fills the entire workspace width');
    const content = document.querySelector(form + ' ' + fields)!.getBoundingClientRect();
    assert(Math.abs(content.width - editor.width) < 3, page + ': fields use the full editor width');
    assert(editor.bottom >= innerHeight - 2, page + ': editor fills the available viewport height');
    assert(editor.right <= document.documentElement.clientWidth + 1, page + ': editor fits without horizontal overflow');
    if (innerWidth > 820) {
      const current = document.querySelector('.dashboard-sidebar')!.getBoundingClientRect();
      assert(current.left === sidebar.left && current.width === sidebar.width && editor.left >= current.right, page + ': sidebar size and position remain unchanged');
    }
    if (page === 'Products') {
      await until(() => document.querySelector<HTMLSelectElement>('#product-category')?.disabled === false, 'product edit options');
      const productForm = document.querySelector<HTMLElement>(form)!;
      const bounds = productForm.getBoundingClientRect();
      assert(productForm.scrollWidth <= productForm.clientWidth + 1, 'Product editor has no internal horizontal overflow');
      for (const field of productForm.querySelectorAll<HTMLElement>('.form-field, .product-inventory, .local-image-picker, .product-pricing-fields')) {
        const rect = field.getBoundingClientRect();
        assert(rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1, 'Product field stays within the editor');
      }
      for (const button of productForm.querySelectorAll<HTMLElement>('.modal-header > button, .modal-footer > button, .local-image-button')) {
        assert(button.getBoundingClientRect().height >= 44, 'Product form actions have comfortable touch targets');
      }
      assert(document.querySelector<HTMLInputElement>('#product-name')?.value === 'Tea' && document.querySelector<HTMLInputElement>('#product-price')?.value === '10', 'Responsive layout preserves prefilled product values');
      const footer = productForm.querySelector<HTMLElement>('.modal-footer')!;
      footer.scrollIntoView({ block: 'end' }); await pause();
      assert(footer.getBoundingClientRect().bottom <= innerHeight + 2, 'Product save and cancel actions can be reached by scrolling');
      if (location.hash.includes('preview')) { window.scrollTo(0, 0); break; }
    }
    document.querySelector<HTMLButtonElement>(form + ' .modal-header > button')!.click(); await until(() => !document.querySelector(form), page + ' close');
  }
  if (!location.hash.includes('preview')) root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
