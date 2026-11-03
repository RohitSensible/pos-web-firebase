import { requestUnsavedNavigation, useUnsavedChanges } from '../utils/unsavedChanges.tsx';
import { markDataLoadingBackground } from '../utils/dataLoading.ts';
import { useActionConfirmation } from '../utils/useActionConfirmation.tsx';
import { readMasterSnapshot, masterSnapshotRevision } from '../utils/masterSnapshots.ts';
import { useWorkspaceBack } from '../utils/useWorkspaceBack.ts';
import { useMasterSync } from '../utils/useMasterSync.ts';
import { useRowBatches } from '../utils/useRowBatches.ts';
import { ProductListRequestError, streamList } from './productListApi.ts';
import { OutletMasterDeleteButton } from './OutletMasterDeleteButton.tsx';
import { DeleteConfirmation } from './DeleteConfirmation.tsx';
import { DeleteAllError, deleteAllRecords } from './deleteAllApi.ts';
import { SuccessPopup } from './SuccessPopup.tsx';
import { useTimedNotice } from '../utils/useTimedNotice.ts';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { MoreVertical, Pencil, Plus, RefreshCw, Save, Trash2, UsersRound, X } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import { ReportDateInput } from './ReportDateInput.tsx';
import { createRequestId } from '../utils/requestId.ts';
import './CategoryPage.css';
import './MasterForm.css';
import './MasterRowList.css';
import './CustomersPage.css';

interface Customer {
  documentId: string; name: string; contact: string; altContact: string; email: string; gstNo: string; address: string;
  creditLimit: number; dayLimit: number; balance: number; birthdayDate: string; anniversaryDate: string; allowedCredit: boolean;
}
interface CustomerDraft extends Omit<Customer, 'documentId' | 'creditLimit' | 'dayLimit' | 'balance'> {
  requestId: string; creditLimit: string; dayLimit: string; balance: string;
}
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);

interface CustomersPageProps { outlet: OutletSummary; token: string; onSessionExpired: () => void }

export function CustomersPage(props: CustomersPageProps) {
  // Remount before rendering another scope so neither rows nor an open editor leak across outlets or sessions.
  return <CustomersPageContent key={JSON.stringify([props.outlet.id, props.token])} {...props} />;
}

function CustomersPageContent({ outlet, token, onSessionExpired }: CustomersPageProps) {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [liveReady, setLiveReady] = useState(false);
  const [search, setSearch] = useState('');
  const [searchRevision, setSearchRevision] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const query = search.trim().toLowerCase();
  const filteredCustomers = useMemo(() => (customers ?? []).filter(customer => !query ||
    [customer.name, customer.contact, customer.altContact, customer.email, customer.gstNo, customer.address]
      .some(value => (value ?? '').toLowerCase().includes(query))), [customers, query]);
  // A fresh key also resets batching when returning to a previously expanded query.
  const changeSearch = (value: string) => { setSearch(value); setSearchRevision(current => current + 1); };
  const clearSearch = () => { changeSearch(''); searchInput.current?.focus(); };
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [draft, setDraft] = useState<CustomerDraft | null>(null);
  const baseline = useRef<CustomerDraft | null>(null);
  const openDraft = (next: CustomerDraft) => { baseline.current = next; setDraft(next); };
  const { confirmAction, confirmation } = useActionConfirmation(!!draft);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useTimedNotice(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  useUnsavedChanges(!!draft && JSON.stringify(draft) !== JSON.stringify(baseline.current), saving);
  const closeDraft = () => requestUnsavedNavigation(() => setDraft(null));
  useWorkspaceBack(!!draft, () => { if (!saving) setDraft(null); });
  const request = useRef<AbortController | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteAllDone, setDeleteAllDone] = useState(false);

  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    setLiveReady(false);
    const url = `/api/outlets/${encodeURIComponent(outlet.id)}/customers`;
    const cached = readMasterSnapshot<{ customers: Customer[] }>(url, token);
    if (cached) markDataLoadingBackground(controller.signal);
    const revision = masterSnapshotRevision();
    setCustomers(cached?.customers ?? null); setError(''); setDraft(null); setEditing(null); setNotice(''); setSaving(false); busy.current = false;
    // Objects that came from the server; anything else in the list is a local add or edit.
    const fromServer = new WeakSet<Customer>(cached?.customers ?? []);
    const withLocalChanges = (loaded: Customer[]) => (current: Customer[] | null) =>
      [...new Map([...loaded, ...(current ?? []).filter(customer => !fromServer.has(customer))].map(customer => [customer.documentId, customer])).values()]
        .sort((a, b) => a.name.localeCompare(b.name));
    void (async () => {
      try {
        // Without a cached list, show customers batch by batch while the rest streams in.
        const loaded = await streamList<Customer>(url, token, controller.signal, 'customers', received => {
          if (controller.signal.aborted || cached || !received.length) return;
          for (const customer of received) fromServer.add(customer);
          setCustomers(withLocalChanges(received.slice()));
          markDataLoadingBackground(controller.signal);
        }, { fromJson: data => (data as { customers?: unknown } | null)?.customers instanceof Array ? (data as { customers: Customer[] }).customers : null,
          snapshot: customers => ({ customers }) });
        if (controller.signal.aborted) return;
        if (revision !== masterSnapshotRevision()) { setReload(value => value + 1); return; }
        for (const customer of loaded) fromServer.add(customer);
        setCustomers(withLocalChanges(loaded));
        setLiveReady(true);
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure instanceof ProductListRequestError && failure.status === 401) { onSessionExpired(); return; }
        setError((failure as Error).message);
      }
    })();
    return () => controller.abort();
  }, [outlet.id, token, onSessionExpired, reload]);

  useMasterSync(outlet.id, token, 'customers', liveReady && !error && !draft && !saving && !deleteAllOpen, async signal => {
    const revision = masterSnapshotRevision();
    try {
      const loaded = await streamList<Customer>(`/api/outlets/${encodeURIComponent(outlet.id)}/customers`, token, signal, 'customers', () => {},
        { fromJson: data => (data as { customers?: Customer[] } | null)?.customers ?? null, snapshot: customers => ({ customers }) });
      if (!signal.aborted && revision === masterSnapshotRevision()) setCustomers(loaded.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (failure) {
      if (!signal.aborted && failure instanceof ProductListRequestError && failure.status === 401) onSessionExpired();
      else throw failure;
    }
  });

  const openAdd = () => {
    setEditing(null);
    setSaveError(''); setNotice('');
    openDraft({ requestId: createRequestId(), name: '', contact: '', altContact: '', email: '', gstNo: '', address: '',
      creditLimit: '0', dayLimit: '0', balance: '0', birthdayDate: '', anniversaryDate: '', allowedCredit: false });
  };
  const openEdit = (customer: Customer) => {
    if (busy.current) return;
    const { documentId: _documentId, ...fields } = customer;
    setEditing(customer); setSaveError(''); setNotice('');
    openDraft({ ...fields, requestId: '', creditLimit: String(customer.creditLimit), dayLimit: String(customer.dayLimit), balance: String(customer.balance) });
  };
  // Removes only this outlet's customer masters; bills and balances elsewhere are kept.
  const deleteAllCustomers = async () => {
    if (busy.current) return;
    busy.current = true; setDeletingAll(true); setDeleteAllError(''); setNotice('');
    try {
      await deleteAllRecords(outlet.id, token, 'customers');
      setCustomers([]); setDeleteAllOpen(false); setDeleteAllDone(true);
    } catch (failure) {
      if (failure instanceof DeleteAllError && failure.status === 401) { setDeleteAllOpen(false); onSessionExpired(); return; }
      setDeleteAllError((failure as Error).message);
      setReload(value => value + 1);
    } finally { busy.current = false; setDeletingAll(false); }
  };
  const customerDeleted = (documentId: string) => {
    setCustomers(current => current?.filter(customer => customer.documentId !== documentId) ?? null);
    setDraft(null); setEditing(null); setNotice('Customer deleted successfully.');
  };
  const changeText = (key: Exclude<keyof CustomerDraft, 'allowedCredit' | 'requestId'>, value: string) => {
    setSaveError(''); setDraft(current => current ? { ...current, [key]: value } : current);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || busy.current) return;
    const controller = request.current;
    if (!controller || controller.signal.aborted) return;
    setSaveError('');
    const body = { ...draft, creditLimit: Number(draft.creditLimit), dayLimit: Number(draft.dayLimit), balance: Number(draft.balance) };
    if (![body.creditLimit, body.dayLimit, body.balance].every(Number.isFinite) || !Number.isInteger(body.dayLimit) || body.dayLimit < 0) {
      setSaveError('Enter valid amounts and a non-negative whole day limit.'); return;
    }
    if (!await confirmAction(editing ? 'update' : 'add', draft.name.trim())) return;
    busy.current = true; setSaving(true);
    try {
      const { requestId: _requestId, ...editable } = body;
      const payload = editing ? Object.fromEntries(Object.entries(editable).filter(([key, value]) => value !== editing[key as keyof Customer])) : body;
      const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/customers${editing ? `/${encodeURIComponent(editing.documentId)}` : ''}`, {
        method: editing ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal,
      });
      const result = await response.json() as { data?: Customer; message?: string };
      if (controller.signal.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok || !result.data) throw new Error(result.message || 'Unable to save customer.');
      const saved = result.data;
      setCustomers(current => [...(current ?? []).filter(row => row.documentId !== saved.documentId), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft(null); setEditing(null); setNotice(editing ? 'Customer updated successfully.' : 'Customer added successfully.');
    } catch (failure) { if (!controller.signal.aborted) setSaveError((failure as Error).message); }
    finally { if (!controller.signal.aborted) { busy.current = false; setSaving(false); } }
  };

  useEffect(() => {
    if (!draft) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy.current && !document.querySelector('dialog[open]')) closeDraft();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [draft]);

  const { rows: shownCustomers, hasMore: moreCustomers, sentinelRef: moreCustomersRef } = useRowBatches(filteredCustomers, JSON.stringify([outlet.id, token, query, searchRevision]));
  if (draft) return <section className="category-modal customer-form-page master-form-page" aria-labelledby="customer-form-title"><form onSubmit={save}>{confirmation}
    <div className="modal-header master-form-header"><div className="master-form-title"><span className="master-form-icon" aria-hidden="true"><UsersRound size={24} /></span><div><h3 id="customer-form-title">{editing ? 'Edit Customer' : 'Add Customer'}</h3><p>{outlet.name} · Contact, billing and credit details</p></div></div><button type="button" className="modal-close-btn" aria-label="Close customer form" disabled={saving} onClick={closeDraft}><X size={18} /></button></div>
    <fieldset className="customer-form-fields" disabled={saving}>
      <div className="master-form-section-heading"><span>01</span><h4>Contact information</h4></div>
      <div className="form-field"><label htmlFor="customer-name">Name</label><input id="customer-name" placeholder="Customer or business name" autoFocus autoComplete="name" maxLength={200} value={draft.name} onChange={event => changeText('name', event.target.value)} /></div>
      <div className="form-field"><label htmlFor="customer-contact">Mobile Number</label><input id="customer-contact" placeholder="Enter mobile number" type="tel" autoComplete="tel" maxLength={30} pattern="\+?[0-9 \(\)\-]+" value={draft.contact} onChange={event => changeText('contact', event.target.value)} /></div>
      <div className="form-field"><label htmlFor="customer-alt-contact">Alternate Mobile Number</label><input id="customer-alt-contact" placeholder="Optional alternate number" type="tel" maxLength={30} pattern="\+?[0-9 \(\)\-]+" value={draft.altContact} onChange={event => changeText('altContact', event.target.value)} /></div>
      <div className="form-field"><label htmlFor="customer-email">Email ID</label><input id="customer-email" placeholder="name@example.com" type="email" autoComplete="email" maxLength={320} value={draft.email} onChange={event => changeText('email', event.target.value)} /></div>
      <div className="master-form-section-heading"><span>02</span><h4>Business details</h4></div>
      <div className="form-field"><label htmlFor="customer-gst">GST Number</label><input id="customer-gst" placeholder="Enter GST number" maxLength={100} value={draft.gstNo} onChange={event => changeText('gstNo', event.target.value)} /></div>
      <div className="form-field"><label htmlFor="customer-address">Address</label><textarea id="customer-address" placeholder="Street, area, city and PIN code" autoComplete="street-address" maxLength={2000} rows={3} value={draft.address} onChange={event => changeText('address', event.target.value)} /></div>
      <div className="master-form-section-heading"><span>03</span><h4>Credit & balance</h4></div>
      <div className="form-field"><label htmlFor="customer-credit-limit">Credit Limit</label><input id="customer-credit-limit" type="number" step="0.01" value={draft.creditLimit} onChange={event => changeText('creditLimit', event.target.value)} /></div>
      <div className="form-field"><label htmlFor="customer-day-limit">Day Limit</label><input id="customer-day-limit" type="number" step="1" min={0} value={draft.dayLimit} onChange={event => changeText('dayLimit', event.target.value)} /></div>
      <div className="form-field"><label htmlFor="customer-balance">Old Balance</label><input id="customer-balance" type="number" step="0.01" value={draft.balance} onChange={event => changeText('balance', event.target.value)} /></div>
      <div className="master-form-section-heading"><span>04</span><h4>Important dates</h4></div>
      <div className="form-field"><label htmlFor="customer-birth-date">Birth Date</label><ReportDateInput id="customer-birth-date" aria-label="Birth Date" value={draft.birthdayDate} onChange={value => changeText('birthdayDate', value)} disabled={saving} /></div>
      <div className="form-field"><label htmlFor="customer-anniversary-date">Anniversary Date</label><ReportDateInput id="customer-anniversary-date" aria-label="Anniversary Date" value={draft.anniversaryDate} onChange={value => changeText('anniversaryDate', value)} disabled={saving} /></div>
      <div className="form-field customer-credit-option"><label className="customer-credit-checkbox" htmlFor="customer-credit-only"><input id="customer-credit-only" type="checkbox" checked={draft.allowedCredit} onChange={event => { setSaveError(''); setDraft(current => current ? { ...current, allowedCredit: event.target.checked } : current); }} />Credit Only</label><small>Set the customer’s credit preference.</small></div>
    </fieldset>
    {saveError && <p className="customer-save-error" role="alert">{saveError}</p>}
    <div className="modal-footer">{editing && !saving && <OutletMasterDeleteButton outletId={outlet.id} token={token} collection="customers" documentId={editing.documentId} name={editing.name || 'Unnamed customer'} onSessionExpired={onSessionExpired} onDeleted={() => customerDeleted(editing.documentId)} />}<button type="button" className="btn-secondary" disabled={saving} onClick={closeDraft}>Cancel</button><button type="submit" className="btn-primary-add" disabled={saving}>{saving ? <RefreshCw size={16} /> : <Save size={16} />}{saving ? 'Saving…' : editing ? 'Update Customer' : 'Save Customer'}</button></div>
  </form></section>;

  return <section className="customers-page category-page-shell">
    {deleteAllOpen && <DeleteConfirmation kind="customer" name="all customers" busy={deletingAll} error={deleteAllError}
      title="Delete all customers?"
      onCancel={() => { if (!busy.current) setDeleteAllOpen(false); }} onConfirm={() => void deleteAllCustomers()} />}
    {deleteAllDone && <SuccessPopup message="Customers deleted successfully" onDismiss={() => setDeleteAllDone(false)} />}
    <div className="category-header-row"><div className="category-title-group"><h1><UsersRound size={22} /> Customers</h1><p>  Your outlet’s customer list.</p></div>
      <div className="category-header-actions category-master-actions">
        <button type="button" className="btn-primary-add" disabled={!customers || !!error} onClick={openAdd}><Plus size={16} /> Add Customer</button>
        <div className="category-more-actions">
          <button type="button" className="category-menu-toggle" aria-label="Customer options" aria-expanded={menuOpen}
            aria-controls="customer-options-menu" onClick={() => setMenuOpen(value => !value)}><MoreVertical size={17} /></button>
          {menuOpen && <div id="customer-options-menu" className="category-options-menu">
            <button type="button" disabled={!customers || !!error || deletingAll || !customers.length} onClick={() => { setMenuOpen(false); setDeleteAllError(''); setDeleteAllOpen(true); }}><Trash2 size={14} />Delete All</button>
          </div>}
        </div>
      </div></div>
    {notice && <SuccessPopup message={notice} onDismiss={() => setNotice('')} />}
    <div className="customers-search">
      <label htmlFor="customer-search">Search customers</label>
      <div className="customers-search-controls">
        <input ref={searchInput} id="customer-search" type="search" value={search} onChange={event => changeSearch(event.target.value)}
          placeholder="Name, phone, email, GST or address" aria-describedby="customer-search-count" />
        {search && <button type="button" className="btn-secondary" onClick={clearSearch}>Clear search</button>}
      </div>
      <p id="customer-search-count" role={customers ? 'status' : undefined} aria-live="polite" aria-atomic="true">{customers
        ? `${filteredCustomers.length} of ${customers.length} ${liveReady ? 'customers' : 'loaded customers'}${!liveReady ? ' · More records are loading; results may change.' : ''}`
        : 'Customer count will appear as records load.'}</p>
    </div>
    {error ? <div className="customer-state"><p role="alert">{error}</p><button type="button" className="btn-secondary" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /> Retry</button></div> : !customers ? <p className="customer-state" role="status" data-inline-loading>Loading customers…</p> : !customers.length ?
      <div className="customer-state"><UsersRound size={28} /><h2>No customers found</h2><p>Add your first customer for this outlet.</p><button type="button" className="btn-primary-add" onClick={openAdd}><Plus size={16} /> Add Customer</button></div> : !filteredCustomers.length ?
      <div className="customer-state"><UsersRound size={28} /><h2>No matching customers</h2><p>No loaded customers match your search.{!liveReady && ' More customers are still loading.'}</p><button type="button" className="btn-secondary" onClick={clearSearch}>Clear search</button></div> :
      <div className="customers-list master-row-list">{shownCustomers.map((customer, index) => {
        const name = customer.name || 'Unnamed customer';
        return <div className="master-row" key={customer.documentId}>
          <button type="button" className="master-row-main" aria-label={`Edit customer ${name}`} onClick={() => openEdit(customer)}>
            <span className="master-row-number">{index + 1}</span>
            <span className="master-row-title"><strong>{customer.name || '—'}</strong>{customer.allowedCredit && <span className="master-row-badge">Credit Only</span>}</span>
            <span className="master-row-divider" aria-hidden="true" />
            <span className="master-row-info"><span>Mobile: <strong>{customer.contact || '—'}</strong></span>
              <small>Balance {money(customer.balance)} · Credit Limit {money(customer.creditLimit)}</small></span>
          </button>
          <div className="master-row-actions">
            <button type="button" onClick={() => openEdit(customer)}><Pencil size={14} />Edit</button>
            <OutletMasterDeleteButton outletId={outlet.id} token={token} collection="customers" documentId={customer.documentId} name={name} onSessionExpired={onSessionExpired} onDeleted={() => customerDeleted(customer.documentId)} />
          </div>
        </div>;
      })}{moreCustomers && <div ref={moreCustomersRef} className="customers-more-rows" role="status">Showing {shownCustomers.length} of {filteredCustomers.length} matching customers…</div>}</div>}
  </section>;
}
