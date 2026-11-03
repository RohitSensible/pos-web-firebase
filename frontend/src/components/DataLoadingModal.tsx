import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { getDataLoadingSnapshot, subscribeDataLoading } from '../utils/dataLoading.ts';
import './DataLoadingModal.css';

export function DataLoadingModal() {
  const { tasks, batch } = useSyncExternalStore(subscribeDataLoading, getDataLoadingSnapshot, getDataLoadingSnapshot);
  const [visibleBatch, setVisibleBatch] = useState(0);
  const [dismissedBatch, setDismissedBatch] = useState(0);
  const titleId = useId();
  const pending = tasks.length > 0;
  // Reads inside an existing native dialog must render in its top layer too.
  const parentDialog = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]:not([data-outlet-access-notice])')].at(-1);
  const container = parentDialog ?? document.body;
  // Avoid flashing a dialog for reads that finish immediately; never delay completion.
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setVisibleBatch(batch), 180);
    return () => window.clearTimeout(timer);
  }, [pending, batch]);
  const foregroundTasks = tasks.filter(task => !task.background);
  const expanded = foregroundTasks.length > 0 && dismissedBatch !== batch;
  useEffect(() => {
    if (!pending || !expanded || visibleBatch !== batch) return;
    const escape = (event: KeyboardEvent) => {
      // Leave Escape to a form/confirmation opened above this workspace overlay.
      const topDialog = [...document.querySelectorAll('dialog[open]')].at(-1);
      if (event.key === 'Escape' && (!topDialog || topDialog === parentDialog) && !document.querySelector('.bill-detail-backdrop')) {
        event.preventDefault(); event.stopImmediatePropagation(); setDismissedBatch(batch);
      }
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [pending, expanded, batch, visibleBatch, parentDialog]);
  if (!expanded || visibleBatch !== batch) return null;
  const labels = [...new Set(foregroundTasks.map(task => task.label))];
  const label = labels.length < 4 ? labels.join(', ') : 'Data';
  const message = `Loading ${label}… Please Wait`;
  const dismiss = () => setDismissedBatch(batch);
  return createPortal(<div className="data-loading-overlay" data-loading-root>
    <section className="data-loading-modal" role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <button type="button" className="data-loading-dismiss" aria-label="Dismiss loading dialog" onClick={dismiss}><X size={16} /></button>
      <span className="data-loading-spinner" aria-hidden="true" />
      <p id={titleId} className="data-loading-message" role="status" aria-live="polite">{message}</p>
    </section>
  </div>, container);
}
