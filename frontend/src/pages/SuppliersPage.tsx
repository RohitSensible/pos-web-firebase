import { useEffect, useRef, useState } from 'react';
import { Pencil, UsersRound, X } from 'lucide-react';
import { useDataLoading } from '../utils/useDataLoading.ts';
import { useRowBatches } from '../utils/useRowBatches.ts';
import { useActionConfirmation } from '../utils/useActionConfirmation.tsx';
import { SuccessPopup } from './SuccessPopup.tsx';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import { goodsReceiptRequest, GoodsReceiptError, type ReceiptSupplier, type GoodsReceiptOptions, type SupplierCreatePayload, type SupplierCreateResult, type SupplierUpdatePayload, type SupplierUpdateResult } from './goodsReceivedApi.ts';
import './DevicesPage.css';
import './MobileRecords.css';
import './StockAdjustmentPage.css';
import './GoodsReceivedPage.css';
import { MobileAddButton } from './MobileAddButton.tsx';

type SupplierDetails = { name: string; contact: string; alternateNumbers: string; email: string; gstIn: string; address: string };
type SuppliersPageProps = { outlet: OutletSummary; token: string; onSessionExpired: () => void };

export function SuppliersPage(props: SuppliersPageProps) {
  return <SuppliersContent key={JSON.stringify([props.outlet.id, props.token])} {...props} />;
}

function SuppliersContent({ outlet, token, onSessionExpired }: SuppliersPageProps) {
  const [suppliers, setSuppliers] = useState<ReceiptSupplier[]>([]);
  const [documentId, setDocumentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ReceiptSupplier | null>(null);
  const [notice, setNotice] = useState('');
  const base = `/api/outlets/${encodeURIComponent(outlet.id)}`;
  useDataLoading(loading, 'Suppliers');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    // Reuse the existing authorized supplier read; no new API or data model.
    void goodsReceiptRequest<GoodsReceiptOptions>(`${base}/goods-received`, token, controller.signal).then(options => {
      if (controller.signal.aborted) return;
      setSuppliers(options.suppliers); setDocumentId(options.supplierDraftId);
    }).catch(failure => {
      if (controller.signal.aborted) return;
      if (failure instanceof GoodsReceiptError && failure.status === 401) onSessionExpired();
      setError((failure as Error).message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [base, token, onSessionExpired, reload]);

  const query = search.trim().toLowerCase();
  const filtered = suppliers.filter(supplier => [supplier.name, supplier.mobile, supplier.email, supplier.gstin, supplier.address]
    .some(value => value.toLowerCase().includes(query)));
  const { rows, hasMore, sentinelRef } = useRowBatches(filtered, query);

  return <section className="devices-page devices-discovery-page">
    <header className="devices-heading"><div><span>MASTERS</span><h1><UsersRound />Suppliers</h1><p>{outlet.name} · Supplier contact details</p></div>
      <MobileAddButton label="Add Supplier" className="devices-refresh" disabled={loading || !!error || !documentId} onClick={() => { setNotice(''); setAdding(true); }} />
    </header>
    {notice && <SuccessPopup message={notice} onDismiss={() => setNotice('')} />}
    {loading ? <div className="devices-state" data-inline-loading="">Loading suppliers…</div> : error ?
      <div className="devices-state"><p role="alert">{error}</p><button type="button" className="devices-refresh" onClick={() => setReload(value => value + 1)}>Retry loading</button></div> : <>
      <div className="devices-filters"><label>Search suppliers<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, mobile, email, GSTIN or address" /></label>
        <button type="button" className="devices-refresh" disabled={!search} onClick={() => setSearch('')}>Clear search</button>
        <button type="button" className="devices-refresh" onClick={() => setReload(value => value + 1)}>Refresh</button>
      </div>
      <p className="devices-result-count" role="status">{filtered.length} of {suppliers.length} suppliers</p>
      {!filtered.length ? <div className="devices-state"><h2>{suppliers.length ? 'No matching suppliers' : 'No suppliers found'}</h2><p>{suppliers.length ? 'Try another search.' : 'Add your first supplier for this outlet.'}</p></div> :
        <div className="devices-table-scroll" role="region" aria-label="Suppliers" tabIndex={0}><table className="mobile-record-table">
          <thead><tr><th>Supplier Name</th><th>Mobile</th><th>Email ID</th><th>GSTIN</th><th>Address</th><th>Actions</th></tr></thead>
          <tbody>{rows.map(supplier => <tr key={supplier.id}><td data-label="Supplier" className="mobile-record-name">{supplier.name}</td><td data-label="Mobile">{supplier.mobile}</td><td data-label="Email">{supplier.email || '—'}</td><td data-label="GSTIN">{supplier.gstin || '—'}</td><td data-label="Address" className="mobile-record-wide">{supplier.address || '—'}</td><td className="mobile-record-actions"><button type="button" className="devices-refresh" aria-label={`Edit supplier ${supplier.name}`} onClick={() => { setNotice(''); setEditing(supplier); }}><Pencil size={14} />Edit</button></td></tr>)}</tbody>
        </table></div>}
      {hasMore && <div ref={sentinelRef} role="status">Showing {rows.length} of {filtered.length} matching suppliers…</div>}
    </>}
    {(adding || editing) && <SupplierForm base={base} token={token} documentId={editing?.id ?? documentId} supplier={editing} onSessionExpired={onSessionExpired} onClose={() => { setAdding(false); setEditing(null); }} onSaved={saved => {
      if ('nextDocumentId' in saved) setDocumentId(saved.nextDocumentId);
      setSearch(''); setAdding(false); setEditing(null); setNotice(editing ? 'Supplier updated successfully.' : 'Supplier added successfully.');
      setReload(value => value + 1);
    }} />}
  </section>;
}

function SupplierForm({ base, token, documentId, supplier, onSessionExpired, onClose, onSaved }: { base: string; token: string; documentId: string; supplier: ReceiptSupplier | null; onSessionExpired: () => void; onClose: () => void; onSaved: (saved: SupplierCreateResult | SupplierUpdateResult) => void }) {
  const { confirmAction, confirmation } = useActionConfirmation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [details, setDetails] = useState<SupplierDetails>({ name: supplier?.name ?? '', contact: supplier?.mobile ?? '', alternateNumbers: '', email: supplier?.email ?? '', gstIn: supplier?.gstin ?? '', address: supplier?.address ?? '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const busy = useRef(false);
  const pending = useRef<{ payload: SupplierCreatePayload | SupplierUpdatePayload; url: string; method: 'POST' | 'PATCH' } | null>(null);
  const locked = saving || uncertain;
  const saveSupplier = async () => {
    if (busy.current) return;
    if (!pending.current) {
      if (!details.name.trim() || !details.contact.trim()) { setError('Supplier Name and Mobile are required.'); return; }
      if (!documentId) { setError('Reload supplier data before adding a supplier.'); return; }
      busy.current = true;
      const confirmed = await confirmAction(supplier ? 'update' : 'add', details.name.trim());
      busy.current = false;
      if (!confirmed) return;
      const fields: SupplierCreatePayload['fields'] = { name: details.name.trim(), mobile: details.contact.trim(), address: details.address.trim(),
        alternateNumber: details.alternateNumbers.trim(), email: details.email.trim(), gstin: details.gstIn.trim() };
      if (supplier) {
        // The receipt read intentionally omits the master's alternate number. Never overwrite it from this snapshot.
        const changes = Object.entries(fields).filter(([key, value]) => key !== 'alternateNumber' && value !== supplier[key as keyof ReceiptSupplier]);
        if (!changes.length) { onClose(); return; }
        pending.current = { method: 'PATCH', url: `${base}/suppliers/${encodeURIComponent(documentId)}`, payload: {
          fields: Object.fromEntries(changes), previous: Object.fromEntries(changes.map(([key]) => [key, supplier[key as keyof ReceiptSupplier]])),
        } };
      } else pending.current = { method: 'POST', url: `${base}/suppliers`, payload: { documentId, fields } };
    }
    busy.current = true; setSaving(true); setError('');
    try {
      const saved = await goodsReceiptRequest<SupplierCreateResult | SupplierUpdateResult>(pending.current.url, token, undefined, pending.current.payload, pending.current.method);
      pending.current = null; onSaved(saved);
    } catch (failure) {
      if (failure instanceof GoodsReceiptError && failure.status === 401) onSessionExpired();
      if (failure instanceof GoodsReceiptError && [400, 403, 404, 409, 422].includes(failure.status)) { pending.current = null; setUncertain(false); }
      else setUncertain(true);
      setError((failure as Error).message);
    } finally { busy.current = false; setSaving(false); }
  };
  useEffect(() => { dialog.current?.showModal(); }, []);
  const field = (key: keyof SupplierDetails, label: string, required = false, type = 'text') => <label>{label}{required && ' *'}<input autoFocus={key === 'name'} required={required} disabled={locked} type={type} pattern={type === 'tel' ? '\\+?[0-9 \\(\\)\\-]+' : undefined} maxLength={key === 'address' ? 500 : key === 'email' ? 320 : 200} value={details[key]} onChange={event => setDetails(current => ({ ...current, [key]: event.target.value }))} /></label>;
  return <dialog ref={dialog} className="stock-confirm-dialog goods-supplier-dialog" aria-labelledby="goods-supplier-title" onCancel={event => { if (locked) event.preventDefault(); else onClose(); }}>
    {confirmation}<header className="devices-heading"><div><span>MASTERS</span><h2 id="goods-supplier-title">{supplier ? 'Edit Supplier' : 'Add Supplier'}</h2></div><button type="button" className="devices-refresh" aria-label={supplier ? 'Close Edit Supplier' : 'Close Add Supplier'} disabled={locked} onClick={onClose}><X /></button></header>
    <p>Save this supplier for the selected outlet. Company Name, Extra and Balance are unavailable in the existing supplier format.</p>
    <form onSubmit={event => {
      event.preventDefault();
      void saveSupplier();
    }}>
      <div className="goods-supplier-form-grid">
        {field('name', 'Supplier Name', true)}{field('contact', 'Mobile', true, 'tel')}
        {field('email', 'Email ID', false, 'email')}{field('gstIn', 'GSTIN')}{field('address', 'Address')}
        {!supplier && field('alternateNumbers', 'Alternate Number', false, 'tel')}
      </div>
      {error && <p role="alert" className="stock-error">{error}</p>}
      {uncertain && <p role="status">The save outcome is uncertain. Retry to confirm this supplier without creating a duplicate.</p>}
      <div className="goods-actions"><button type="button" className="devices-refresh" disabled={locked} onClick={onClose}>Cancel</button><button type="submit" className="stock-primary" disabled={saving}>{saving ? 'Saving…' : uncertain ? 'Retry supplier save' : supplier ? 'Update Supplier' : 'Save Supplier'}</button></div>
    </form>
  </dialog>;
}
