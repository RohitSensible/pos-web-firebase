import { ActionPopup, ActionConfirmation } from './ActionPopup.tsx';
import { SuccessPopup } from './SuccessPopup.tsx';
import { useEffect, useRef, useState } from 'react';
import { removeMasterImage } from './imageApi.ts';
import { runImageWorkers, type ImageProduct } from './productImageBatch.ts';

interface RemovalRow {
  documentId: string; name: string; image: string | null; imagePath: string | null;
  status: 'pending' | 'removing' | 'removed' | 'failed'; message: string;
}

export function ProductImageRemoval({ products, outletId, outletName, token, imageGrant, onRemoved, onClose, onSessionExpired }: {
  products: ImageProduct[]; outletId: string; outletName: string; token: string; imageGrant: string;
  onRemoved: (documentId: string) => void;
  onClose: (summary?: { removed: number; failed: number }) => void; onSessionExpired: () => void;
}) {
  const [rows, setRows] = useState<RemovalRow[]>(() => products.map(product => ({ documentId: product.documentId,
    name: String(product.fields.name ?? product.documentId), image: typeof product.fields.image === 'string' && product.fields.image ? product.fields.image : null,
    imagePath: typeof product.fields.imagePath === 'string' && product.fields.imagePath ? product.fields.imagePath : null, status: 'pending', message: '' })));
  const [started, setStarted] = useState(false), [running, setRunning] = useState(false);
  const busy = useRef(false), active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const removed = rows.filter(row => row.status === 'removed').length;
  const failed = rows.filter(row => row.status === 'failed').length;
  const update = (id: string, status: RemovalRow['status'], message = '') => {
    if (active.current) setRows(current => current.map(row => row.documentId === id ? { ...row, status, message } : row));
  };
  const run = async () => {
    if (busy.current) return;
    busy.current = true; setStarted(true); setRunning(true);
    await runImageWorkers(rows.filter(row => row.status === 'pending' || row.status === 'failed'), async row => {
      if (!active.current) return;
      update(row.documentId, 'removing');
      try {
        await removeMasterImage(outletId, 'products', row.documentId, token, { image: row.image, imagePath: row.imagePath }, imageGrant);
        if (active.current) { onRemoved(row.documentId); update(row.documentId, 'removed'); }
      } catch (reason) {
        if ((reason as { status?: number }).status === 401) onSessionExpired();
        update(row.documentId, 'failed', (reason as Error).message);
      }
    });
    busy.current = false; if (active.current) setRunning(false);
  };
  const close = () => { if (!busy.current) onClose(started ? { removed, failed } : undefined); };
  if (started && !running && removed > 0 && failed === 0) return <SuccessPopup message="Removed successfully." onDismiss={close} />;
  if (!started) return <ActionConfirmation action="remove" item={`images from ${rows.length} products in ${outletName}`} title="Remove product images?" onCancel={close} onConfirm={() => void run()} />;
  return <ActionPopup title={running ? 'Removing product images…' : 'Image removal results'} onCancel={close} busy={running}
    footer={<><button type="button" data-initial-focus className="btn-secondary" disabled={running} onClick={close}>Done</button>
      {failed > 0 && <button type="button" className="btn-primary-add action-confirm-button" disabled={running} onClick={() => void run()}>Retry failed removals</button>}</>}>
    <p role="status">{removed} removed; {failed} failed.</p>
    {failed > 0 && <ul>{rows.filter(row => row.status === 'failed').map(row => <li key={row.documentId}>{row.name}: {row.message}</li>)}</ul>}
  </ActionPopup>;
}
