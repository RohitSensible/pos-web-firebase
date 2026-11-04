import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './CategoryPage.css';
import './ActionPopup.css';

export function ActionPopup({ title, children, footer, onCancel, busy = false, cancelDisabled = false, className = '' }: {
  title: ReactNode; children: ReactNode; footer: ReactNode; onCancel: () => void; busy?: boolean; cancelDisabled?: boolean; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    dialog.current?.querySelector<HTMLButtonElement>('[data-initial-focus]')?.focus();
  }, []);
  return <dialog ref={dialog} className={`category-modal action-popup ${className}`} role="alertdialog" aria-modal="true"
    aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`} aria-busy={busy}
    onClose={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy && !cancelDisabled) onCancel(); }}>
    <div className="modal-header"><h3 id={`${id}-title`}>{title}</h3><button type="button" className="modal-close-btn" aria-label="Close popup" disabled={busy || cancelDisabled} onClick={onCancel}><X size={18} /></button></div>
    <div id={`${id}-body`} className="modal-body">{children}</div>
    <div className="modal-footer">{footer}</div>
  </dialog>;
}

export function ActionConfirmation({ action, item, onConfirm, onCancel, busy = false, error, children, title, confirmLabel, cancelDisabled = false, className = '' }: {
  action: string; item: string; onConfirm: () => void; onCancel: () => void; busy?: boolean; error?: string | undefined;
  cancelDisabled?: boolean; children?: ReactNode; title?: string | undefined; confirmLabel?: string | undefined; className?: string;
}) {
  const label = action.charAt(0).toUpperCase() + action.slice(1);
  return <ActionPopup title={title ?? `${label} ${item}?`} onCancel={onCancel} busy={busy} cancelDisabled={cancelDisabled} className={`action-confirmation ${className}`}
    footer={<><button type="button" data-initial-focus className="btn-secondary delete-confirmation-cancel" disabled={busy || cancelDisabled} onClick={onCancel}>Cancel</button>
      <button type="button" className="btn-primary-add action-confirm-button delete-confirmation-confirm" disabled={busy} onClick={onConfirm}>{busy ? 'Please wait…' : confirmLabel ?? label}</button></>}>
    <p className="action-popup-question">Are you sure you want to {action} <strong>{item}</strong>?</p>
    {children}
    {error && <p className="category-form-error" role="alert">{error}</p>}
  </ActionPopup>;
}
