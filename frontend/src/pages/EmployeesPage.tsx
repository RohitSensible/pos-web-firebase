import { useMobileSearch, searchRecords } from '../utils/useMobileSearch.ts';
import { requestUnsavedNavigation, useUnsavedChanges } from '../utils/unsavedChanges.tsx';
import { beginDataLoading, markDataLoadingBackground } from '../utils/dataLoading.ts';
import { useActionConfirmation } from '../utils/useActionConfirmation.tsx';
import { readMasterSnapshot, masterSnapshotRevision, rememberMasterSnapshot } from '../utils/masterSnapshots.ts';
import { useWorkspaceBack } from '../utils/useWorkspaceBack.ts';
import { OutletMasterDeleteButton } from './OutletMasterDeleteButton.tsx';
import { DeleteConfirmation } from './DeleteConfirmation.tsx';
import { DeleteAllError, deleteAllRecords } from './deleteAllApi.ts';
import { SuccessPopup } from './SuccessPopup.tsx';
import { useTimedNotice } from '../utils/useTimedNotice.ts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MoreVertical, Pencil, Plus, RefreshCw, Save, Trash2, UserRoundCog, X } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import { ReportDateInput } from './ReportDateInput.tsx';
import { createRequestId } from '../utils/requestId.ts';
import './CategoryPage.css';
import './MasterForm.css';
import './EmployeesPage.css';
import './MobileRecords.css';
import { MobileAddButton } from './MobileAddButton.tsx';

interface Employee {
  documentId: string; name: string; mobile: string; searchCode: number | null;
  shortName: string; balanceAmt: string; dateOfJoining: string; userId: string;
}
interface EmployeeList { employees: Employee[]; nextSearchCode: number; userAccounts: { userId: string; name: string }[] }
interface Draft { documentId?: string; requestId: string; name: string; mobile: string; searchCode: string; shortName: string; balanceAmt: string; dateOfJoining: string; userId: string }

interface EmployeesPageProps {
  outlet: OutletSummary; token: string; onSessionExpired: () => void;
}

export function EmployeesPage(props: EmployeesPageProps) {
  return <EmployeesWorkspace key={JSON.stringify([props.outlet.id, props.token])} {...props} />;
}

function EmployeesWorkspace({ outlet, token, onSessionExpired }: EmployeesPageProps) {
  const [data, setData] = useState<EmployeeList | null>(null);
  const mobileSearch = useMobileSearch();
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const clearSearch = () => { setSearch(''); searchInput.current?.focus(); };
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  // Employees and salesmen share one record type and form; the page labels records as employees.
  const kind = 'Employee';
  const [draft, setDraft] = useState<Draft | null>(null);
  const baseline = useRef<Draft | null>(null);
  const openDraft = (next: Draft) => { baseline.current = next; setDraft(next); };
  const { confirmAction, confirmation } = useActionConfirmation(!!draft);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useTimedNotice(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  useUnsavedChanges(!!draft && JSON.stringify(draft) !== JSON.stringify(baseline.current), saving);
  const closeDraft = () => requestUnsavedNavigation(() => setDraft(null));
  useWorkspaceBack(!!draft, () => { if (!saving) setDraft(null); });
  const requests = useRef<AbortController | null>(null);
  const shortNameEdited = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteAllDone, setDeleteAllDone] = useState(false);

  useEffect(() => {
    const controller = new AbortController(); requests.current = controller;
    const url = `/api/outlets/${encodeURIComponent(outlet.id)}/employees`;
    const cached = readMasterSnapshot<EmployeeList>(url, token);
    if (cached) markDataLoadingBackground(controller.signal);
    const revision = masterSnapshotRevision();
    setData(cached ?? null); setError(''); setDraft(null); setNotice(''); setSaving(false); busy.current = false;
    void (async () => {
      const finishLoading = beginDataLoading('Employees', controller.signal);
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        const result = await response.json() as { data?: EmployeeList; message?: string };
        if (controller.signal.aborted) return;
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load employees.');
        if (revision !== masterSnapshotRevision()) { setReload(value => value + 1); return; }
        rememberMasterSnapshot(url, token, result.data, revision);
        setData(result.data);
      } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); } finally { finishLoading(); }
    })();
    return () => controller.abort();
  }, [outlet.id, token, onSessionExpired, reload]);

  useEffect(() => {
    if (!draft) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy.current && !document.querySelector('dialog[open]')) closeDraft(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [draft]);

  const openAdd = () => {
    if (!data) return;
    shortNameEdited.current = false; setSaveError(''); setNotice('');
    openDraft({ requestId: createRequestId(), name: '', mobile: '', searchCode: String(data.nextSearchCode),
      shortName: '', balanceAmt: '0', dateOfJoining: '', userId: '' });
  };
  const openEdit = (employee: Employee) => {
    shortNameEdited.current = true; setSaveError(''); setNotice('');
    openDraft({ ...employee, requestId: createRequestId(), searchCode: String(employee.searchCode ?? ''), balanceAmt: employee.balanceAmt || '0' });
  };
  const change = (key: keyof Draft, value: string) => {
    setSaveError(''); setDraft(current => current ? { ...current, [key]: value } : current);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || !data || busy.current) return;
    setSaveError('');
    const searchCode = Number(draft.searchCode);
    if (!draft.name.trim() || !draft.mobile.trim() || !draft.shortName.trim()) { setSaveError('Name, mobile and short name are required.'); return; }
    if (!Number.isSafeInteger(searchCode) || searchCode < 1) { setSaveError('Enter a positive whole search code.'); return; }
    if (!/^\+?(?=.*\d)[\d ()-]+$/.test(draft.mobile.trim())) { setSaveError('Enter a valid mobile number.'); return; }
    const controller = requests.current;
    if (!controller || controller.signal.aborted) return;
    if (!await confirmAction(draft.documentId ? 'update' : 'add', draft.name.trim())) return;
    busy.current = true; setSaving(true);
    try {
      const { documentId, requestId, ...fields } = draft;
      const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/employees${documentId ? `/${encodeURIComponent(documentId)}` : ''}`, {
        method: documentId ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, ...(documentId ? {} : { requestId }), name: draft.name.trim(), mobile: draft.mobile.trim(), shortName: draft.shortName.trim(), searchCode }), signal: controller.signal,
      });
      const result = await response.json() as { data?: Employee; message?: string };
      if (controller.signal.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok || !result.data) throw new Error(result.message || 'Unable to save employee.');
      const saved = result.data;
      setData(current => current ? { ...current,
        employees: [...current.employees.filter(row => row.documentId !== saved.documentId), saved]
          .sort((a, b) => (a.searchCode ?? Infinity) - (b.searchCode ?? Infinity)),
        nextSearchCode: Math.max(current.nextSearchCode, (saved.searchCode ?? 0) + 1),
      } : current);
      setDraft(null); setNotice(`${kind} ${draft.documentId ? 'updated' : 'added'} successfully.`);
    } catch (failure) { if (!controller.signal.aborted) setSaveError((failure as Error).message); }
    finally { if (!controller.signal.aborted) { busy.current = false; setSaving(false); } }
  };
  // Removes only this outlet's employee masters; bills and user accounts are kept.
  const deleteAllEmployees = async () => {
    if (busy.current) return;
    busy.current = true; setDeletingAll(true); setDeleteAllError(''); setNotice('');
    try {
      await deleteAllRecords(outlet.id, token, 'employees');
      setData(current => current ? { ...current, employees: [] } : current);
      setDeleteAllOpen(false); setDeleteAllDone(true);
    } catch (failure) {
      if (failure instanceof DeleteAllError && failure.status === 401) { setDeleteAllOpen(false); onSessionExpired(); return; }
      setDeleteAllError((failure as Error).message);
      setReload(value => value + 1);
    } finally { busy.current = false; setDeletingAll(false); }
  };

  const userNames = new Map(data?.userAccounts.map(user => [user.userId, user.name]));
  const userDisplayName = (employee: Employee) => employee.userId ? userNames.get(employee.userId) || 'Assigned account' : 'Not assigned';
  const query = search.trim().toLowerCase();
  const visibleEmployees = mobileSearch ? searchRecords(data?.employees ?? [], search, employee => ({ primary: [employee.name], text: [employee.name, employee.shortName, userDisplayName(employee)], identifiers: [employee.mobile, employee.searchCode] })) : data?.employees.filter(employee => !query || [employee.name, employee.mobile,
    String(employee.searchCode ?? ''), employee.shortName, userDisplayName(employee)]
    .some(value => value.toLowerCase().includes(query))) ?? [];

  if (draft) return <section className="category-modal employee-form-page master-form-page" aria-labelledby="employee-form-title"><form onSubmit={save}>{confirmation}
        <div className="modal-header master-form-header"><div className="master-form-title"><span className="master-form-icon" aria-hidden="true"><UserRoundCog size={24} /></span><div><h3 id="employee-form-title">{draft.documentId ? 'Edit' : 'Add'} {kind}</h3><p>{outlet.name} · Personal and work details</p></div></div><button type="button" className="modal-close-btn" aria-label="Close employee form" disabled={saving} onClick={closeDraft}><X size={18} /></button></div>
        <fieldset className="employees-form-fields" disabled={saving}>
          <div className="master-form-section-heading"><span>01</span><h4>Personal information</h4></div>
          <div className="form-field"><label htmlFor="employee-name">Employee Name*</label><input id="employee-name" placeholder="Full name" value={draft.name} required maxLength={200} autoFocus onChange={event => { const value = event.target.value; setSaveError(''); setDraft(current => current ? { ...current, name: value, shortName: shortNameEdited.current ? current.shortName : Array.from(value.trim())[0] ?? '' } : current); }} /></div>
          <div className="form-field"><label htmlFor="employee-mobile">Mobile*</label><input id="employee-mobile" placeholder="Enter mobile number" type="tel" value={draft.mobile} required maxLength={30} pattern="\+?[0-9 \(\)\-]+" onChange={event => change('mobile', event.target.value)} /></div>
          <div className="master-form-section-heading"><span>02</span><h4>Work details</h4></div>
          <div className="form-field"><label htmlFor="employee-code">Search code</label><input id="employee-code" type="number" min={1} step={1} required value={draft.searchCode} onChange={event => change('searchCode', event.target.value)} /></div>
          <div className="form-field"><label htmlFor="employee-short-name">Short name</label><input id="employee-short-name" placeholder="Initials or short name" required maxLength={200} value={draft.shortName} onChange={event => { shortNameEdited.current = true; change('shortName', event.target.value); }} /></div>
          <div className="master-form-section-heading"><span>03</span><h4>Balance & joining date</h4></div>
          <div className="form-field"><label htmlFor="employee-balance">Balance</label><input id="employee-balance" type="number" step="0.01" required value={draft.balanceAmt} onChange={event => change('balanceAmt', event.target.value)} /></div>
          <div className="form-field"><label>Joining Date</label><ReportDateInput aria-label="Joining Date" value={draft.dateOfJoining} onChange={value => change('dateOfJoining', value)} disabled={saving} /></div>
          <div className="master-form-section-heading"><span>04</span><h4>Account assignment</h4></div>
          <div className="form-field"><label htmlFor="employee-user">Assign To User Account</label><select id="employee-user" value={draft.userId} onChange={event => change('userId', event.target.value)}><option value="">Not assigned</option>{data?.userAccounts.map(user => <option key={user.userId} value={user.userId}>{user.name || 'User account'}</option>)}</select></div>
        </fieldset>
        {saveError && <p className="employees-save-error" role="alert">{saveError}</p>}
        <div className="modal-footer"><button type="button" className="btn-secondary" disabled={saving} onClick={closeDraft}>Cancel</button><button type="submit" className="btn-primary-add" disabled={saving}>{saving ? <RefreshCw size={16} /> : <Save size={16} />}{saving ? 'Saving…' : 'Save'}</button></div>
      </form></section>;

  return <section className="employees-page category-page-shell">
    {deleteAllOpen && <DeleteConfirmation kind="employee" name="all employees" busy={deletingAll} error={deleteAllError}
      title="Delete all employees?"
      onCancel={() => { if (!busy.current) setDeleteAllOpen(false); }} onConfirm={() => void deleteAllEmployees()} />}
    {deleteAllDone && <SuccessPopup message="Employees deleted successfully" onDismiss={() => setDeleteAllDone(false)} />}
    <div className="category-header-row"><div className="category-title-group"><h1><UserRoundCog size={22} /> Employees / Salesman</h1><p>Click a person to edit their details.</p></div>
      <div className="category-header-actions category-master-actions">
        <MobileAddButton label={`Add ${kind}`} className="btn-primary-add" disabled={!data || !!error} onClick={openAdd} />
        <div className="category-more-actions">
          <button type="button" className="category-menu-toggle" aria-label="Employee options" aria-expanded={menuOpen}
            aria-controls="employee-options-menu" onClick={() => setMenuOpen(value => !value)}><MoreVertical size={17} /></button>
          {menuOpen && <div id="employee-options-menu" className="category-options-menu">
            <button type="button" disabled={!data || !!error || deletingAll || !data.employees.length} onClick={() => { setMenuOpen(false); setDeleteAllError(''); setDeleteAllOpen(true); }}><Trash2 size={14} />Delete All</button>
          </div>}
        </div>
      </div></div>
    {notice && <SuccessPopup message={notice} onDismiss={() => setNotice('')} />}
    {data && !error && <div className="employees-search-controls">
      <div className="employees-search-field"><label htmlFor="employee-search">Search employees</label>
        <input ref={searchInput} id="employee-search" type="search" value={search} aria-describedby="employee-search-count"
          placeholder="Name, mobile, code, short name or user account" onChange={event => setSearch(event.target.value)} />
      </div>
      {search && <button type="button" className="btn-secondary" onClick={clearSearch}>Clear search</button>}
      <p id="employee-search-count" role="status" aria-live="polite" aria-atomic="true">{visibleEmployees.length} of {data.employees.length} employees</p>
    </div>}
    {error ? <div className="employees-state"><p role="alert">{error}</p><button type="button" className="btn-secondary" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /> Retry</button></div> : !data ? <p className="employees-state" role="status" data-inline-loading>Loading employees…</p> : !data.employees.length ?
      <div className="employees-state"><UserRoundCog size={28} /><h2>No employees found</h2><p>Add a {kind.toLowerCase()} to get started.</p><button type="button" className="btn-primary-add mobile-add-inline" onClick={openAdd}><Plus size={16} /> Add {kind}</button></div> :
      !visibleEmployees.length ? <div className="employees-state"><h2>No matching employees</h2><p>Try another search or clear it to see all employees.</p><button type="button" className="btn-secondary" onClick={clearSearch}>Clear search</button></div> :
      <div className="employees-table-scroll"><table className="mobile-record-table"><thead><tr><th>Name</th><th>Mobile</th><th>Search code</th><th>Balance</th><th>Joining date</th><th>User account</th><th>Actions</th></tr></thead><tbody>{visibleEmployees.map(employee => <tr key={employee.documentId}
        tabIndex={0} aria-label={`Edit employee ${employee.name}`} onClick={() => openEdit(employee)}
        onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openEdit(employee); } }}>
        <td data-label="Employee" className="mobile-record-name">{employee.name}</td><td data-label="Mobile">{employee.mobile || '—'}</td><td data-label="Search code">{employee.searchCode ?? '—'}</td><td data-label="Balance">{employee.balanceAmt || '0'}</td><td data-label="Joining date">{employee.dateOfJoining || '—'}</td>
        <td data-label="User account">{userDisplayName(employee)}</td>
        <td className="mobile-record-actions"><div><button type="button" className="mobile-record-edit" onClick={event => { event.stopPropagation(); openEdit(employee); }}><Pencil size={14} />Edit</button><OutletMasterDeleteButton outletId={outlet.id} token={token} collection="employees" documentId={employee.documentId} name={employee.name || 'Unnamed employee'} onSessionExpired={onSessionExpired} onDeleted={() => { setData(current => current ? { ...current, employees: current.employees.filter(row => row.documentId !== employee.documentId) } : current); setNotice('Employee deleted successfully.'); }} /></div></td>
      </tr>)}</tbody></table></div>}

  </section>;
}
