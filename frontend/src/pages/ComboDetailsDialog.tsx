import { useEffect, useId, useRef, useState } from 'react';
import { Boxes, RefreshCw, X } from 'lucide-react';
import { useDataLoading } from '../utils/useDataLoading.ts';
import { SuccessPopup } from './SuccessPopup.tsx';
import './CategoryPage.css';
import './ComboDetailsDialog.css';

interface ComboDetails {
  documentId: string; name: string; recipeId: string; revision: string;
  items: { productId: string; name: string; available: boolean; quantity: number; price: number; unitId: number; unitName: string }[];
}


export function ComboDetailsDialog({ outletId, token, product, onClose, onSessionExpired }: {
  outletId: string; token: string; product: { documentId: string; name: string }; onClose: () => void; onSessionExpired: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [data, setData] = useState<ComboDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState<{ quantity: string; price: string; productId: string; name: string; available: boolean; sourceIndex: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const dirty = !!data && (draft.length !== data.items.length || draft.some((row, index) => row.sourceIndex !== index || row.quantity !== String(data.items[index]?.quantity) || row.price !== String(data.items[index]?.price)));
  const valid = draft.length > 0 && draft.every(row => row.quantity.trim() !== '' && Number.isFinite(Number(row.quantity)) && Number(row.quantity) > 0 && row.price.trim() !== '' && Number.isFinite(Number(row.price)) && Number(row.price) >= 0);
  async function save() {
    if (!data || !valid || saving || !dirty) return;
    setSaving(true); setSaveError('');
    try {
      const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/products/${encodeURIComponent(product.documentId)}/combo`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipeId: data.recipeId, revision: data.revision, items: draft.map(row => ({ quantity: Number(row.quantity), price: Number(row.price), sourceIndex: row.sourceIndex })) }),
      });
      if (response.status === 401) { onSessionExpired(); throw new Error('Your session has expired. Please sign in again.'); }
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message || 'Unable to save the combo products.');
      setSaved(true);
    } catch (failure) { setSaveError((failure as Error).message); }
    finally { setSaving(false); }
  }
  useDataLoading(loading, 'Combo products');
  useEffect(() => {
    const element = dialog.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal(); element.querySelector<HTMLButtonElement>('.modal-close-btn')?.focus();
    return () => { if (element.open) element.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 16_000);
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/products/${encodeURIComponent(product.documentId)}/combo`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 401) { onSessionExpired(); throw new Error('Your session has expired. Please sign in again.'); }
        const result = await response.json() as { success?: boolean; data?: ComboDetails; message?: string };
        if (!response.ok || !result.success || !result.data || !Array.isArray(result.data.items)) throw new Error(result.message || 'Unable to load the combo products.');
        if (active) { setData(result.data); setDraft(result.data.items.map((item, sourceIndex) => ({ ...item, sourceIndex, quantity: String(item.quantity), price: String(item.price) }))); }
      } catch (failure) {
        if (active) setError(controller.signal.aborted ? 'Loading timed out. Please retry.' : (failure as Error).message);
      } finally { window.clearTimeout(timeout); if (active) setLoading(false); }
    })();
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [outletId, product.documentId, token, onSessionExpired, retry]);
  if (saved) return <SuccessPopup message="Updated successfully." onDismiss={onClose} />;
  return <dialog ref={dialog} className="category-modal combo-details-modal" aria-labelledby={titleId}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!saving) onClose(); }}>
    <header className="modal-header"><div><h2 id={titleId}><Boxes size={21} aria-hidden="true" />{data?.name || product.name}</h2><p>Products included in this combo</p></div>
      <button type="button" className="modal-close-btn" aria-label="Close combo details" disabled={saving} onClick={onClose}><X size={18} /></button></header>
    <div className="modal-body">
      {loading ? <p className="combo-details-state" role="status" data-inline-loading><RefreshCw size={18} />Loading included products…</p> : error ?
        <div className="combo-details-state"><p role="alert">{error}</p><button type="button" className="btn-secondary" onClick={() => { setLoading(true); setData(null); setError(''); setRetry(value => value + 1); }}>Retry</button></div> : data && <>
          <p className="combo-details-count">{draft.length} {draft.length === 1 ? 'entry' : 'entries'}</p>
          {draft.length ? <div className="combo-details-table"><table aria-label="Included combo products"><thead><tr><th>Product</th><th>Quantity</th><th>Price</th></tr></thead>
            <tbody>{draft.map((item, index) => <tr key={`${item.productId}-${index}`}><td><strong>{item.name}</strong>{!item.available && <small>{item.productId}</small>}</td><td><input type="number" step="any" min="0" aria-label={`Quantity for ${item.name}, row ${index + 1}`} value={draft[index]?.quantity ?? ''} disabled={saving} onChange={event => { const value = event.target.value; setDraft(rows => rows.map((row, i) => i === index ? { ...row, quantity: value } : row)); setSaveError(''); }} /></td><td><input type="number" step="any" min="0" aria-label={`Price for ${item.name}, row ${index + 1}`} value={draft[index]?.price ?? ''} disabled={saving} onChange={event => { const value = event.target.value; setDraft(rows => rows.map((row, i) => i === index ? { ...row, price: value } : row)); setSaveError(''); }} /></td></tr>)}</tbody>
          </table></div> : <p className="combo-details-state">This combo has no saved products.</p>}
        </>}
      {saveError && <p className="combo-details-error" role="alert">{saveError}</p>}
      {dirty && !valid && <p className="combo-details-error" role="alert">Enter a quantity greater than zero and a price of zero or more.</p>}
    </div>
    <footer className="modal-footer"><><button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>Close</button>{!!data && <button type="button" className="btn-primary-add" disabled={saving || !dirty || !valid} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>}</></footer>
  </dialog>;
}
