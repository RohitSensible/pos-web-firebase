import { useActionConfirmation } from '../utils/useActionConfirmation.tsx';
import { useEffect, useRef, useState } from 'react';
import { useWorkspaceBack } from '../utils/useWorkspaceBack.ts';
import { SuccessPopup } from './SuccessPopup.tsx';
import { X } from 'lucide-react';
import './CategoryPage.css';
export interface UpdatedCategoryNames { id: string; name: string; regionalName: string; imagePath?: string; imageRemoved?: boolean }
interface Props {
  category: UpdatedCategoryNames & { code: string; imagePath?: string }; outletId: string; token: string;
  onCancel: () => void; onUpdated: (category: UpdatedCategoryNames) => void; onSessionExpired: () => void;
}
export function EditCategoryForm({ category, outletId, token, onCancel, onUpdated, onSessionExpired }: Props) {
  const { confirmAction, confirmation } = useActionConfirmation();
  const [name, setName] = useState(category.name);
  const [regionalName, setRegionalName] = useState(category.regionalName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  useWorkspaceBack(true, () => { if (!busy.current) onCancel(); });
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy.current) onCancel(); };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [onCancel]);
  const update = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current) return;
    if (!name.trim()) { setError('Category Name is required.'); return; }
    if (!await confirmAction('update', name.trim())) return;
    busy.current = true; setSaving(true); setError('');
    try {
      const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/categories/${encodeURIComponent(category.id)}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), regionalName: regionalName.trim() }),
      });
      if (response.status === 401) { onSessionExpired(); return; }
      const result = await response.json() as { success?: boolean; data?: UpdatedCategoryNames; message?: string };
      if (!response.ok || !result.success || !result.data) throw new Error(result.message || 'Unable to update category.');
      onUpdated(result.data);
    } catch (error) { setError((error as Error).message); }
    finally { busy.current = false; setSaving(false); }
  };
  return <section className="category-modal category-edit-page" aria-labelledby="edit-category-title">
    <form onSubmit={event => void update(event)} noValidate>{confirmation}
      <div className="modal-header"><h3 id="edit-category-title">Edit Category</h3>
        <button type="button" className="modal-close-btn" aria-label="Close edit category" disabled={saving} onClick={onCancel}><X size={18} /></button></div>
      <div className="modal-body">
        <div className="form-field"><label htmlFor="edit-category-name">Category Name</label><input id="edit-category-name" autoFocus maxLength={200} disabled={saving} value={name} onChange={event => setName(event.target.value)} /></div>
        <div className="form-field"><label htmlFor="edit-category-regional">Regional Name</label><input id="edit-category-regional" maxLength={200} disabled={saving} value={regionalName} onChange={event => setRegionalName(event.target.value)} /></div>
        <div className="form-field"><label htmlFor="edit-category-number">Category Number</label><input id="edit-category-number" readOnly value={category.code} /></div>
        {error && <p className="category-form-error" role="alert">{error}</p>}
      </div>
      <div className="modal-footer"><button type="button" className="btn-secondary" disabled={saving} onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary-add" disabled={saving}>{saving ? 'Updating…' : 'Update'}</button></div>
    </form>
  </section>;
}
export function CategoryUpdatedPopup({ onDismiss }: { onDismiss: () => void }) {
  return <SuccessPopup message="Updated successfully." onDismiss={onDismiss} />;
}
