import { useLayoutEffect, useRef, useSyncExternalStore, useEffect } from 'react';

type Guard = { dirty: boolean; busy: boolean };
const guards = new Map<symbol, Guard>();
const listeners = new Set<() => void>();
let pending: { action: () => void; owners: symbol[] } | null = null;
let acceptedDepth = 0;
let revision = 0;
const emit = () => { revision++; listeners.forEach(listener => listener()); };
const busy = () => [...guards.values()].some(guard => guard.busy);
export const hasUnsavedChanges = (): boolean => [...guards.values()].some(guard => guard.dirty || guard.busy);

// Only explicit user navigation uses this broker. Forced session changes bypass it.
export function requestUnsavedNavigation(action: () => void): void {
  if (acceptedDepth || !hasUnsavedChanges()) { action(); return; }
  if (pending) return; // Repeated clicks retain the first requested destination.
  pending = { action, owners: [...guards].filter(([, guard]) => guard.dirty || guard.busy).map(([id]) => id) };
  emit();
}

export function useUnsavedChanges(dirty: boolean, inFlight = false): void {
  const id = useRef(Symbol('unsaved draft'));
  useLayoutEffect(() => {
    guards.set(id.current, { dirty, busy: inFlight });
    if (!dirty && !inFlight && pending?.owners.includes(id.current)) pending = null;
    emit();
  }, [dirty, inFlight]);
  useLayoutEffect(() => () => {
    guards.delete(id.current);
    // Never run a callback captured for a form that no longer exists.
    if (pending?.owners.includes(id.current)) pending = null;
    emit();
  }, []);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', event => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  });
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function UnsavedChangesPrompt() {
  useSyncExternalStore(subscribe, () => revision, () => 0);
  const dialog = useRef<HTMLDialogElement>(null);
  const stay = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pending) return;
    dialog.current?.showModal();
    stay.current?.focus();
  }, [!!pending]);
  if (!pending) return null;
  const dismiss = () => { pending = null; emit(); };
  const discard = () => {
    if (busy() || !pending) return;
    const action = pending.action;
    pending = null;
    emit();
    acceptedDepth++;
    try { action(); } finally { acceptedDepth--; }
  };
  return <dialog ref={dialog} className="category-modal action-popup" aria-modal="true" onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }} aria-labelledby="unsaved-changes-title" aria-describedby="unsaved-changes-description" onCancel={event => { event.preventDefault(); dismiss(); }}>
    <div className="modal-header"><h2 id="unsaved-changes-title">Discard unsaved changes?</h2></div>
    <div className="modal-body"><p id="unsaved-changes-description">{busy() ? 'A save is in progress. Please wait before leaving.' : 'Your changes will be lost if you leave.'}</p></div>
    <div className="modal-footer"><button ref={stay} type="button" className="btn-secondary" onClick={dismiss}>Stay</button>
    <button type="button" className="btn-primary-add" disabled={busy()} onClick={discard}>Discard</button></div>
  </dialog>;
}
