import { useEffect, useRef, useState } from 'react';
import { QuickPinModal } from './QuickPinModal.tsx';

export type ImageAction = 'bulk' | 'shared' | 'remove';

export function ProductImagePinDialog({ outletId, token, action, onCancel, onVerified, onSessionExpired }: {
  outletId: string; token: string; action: ImageAction; onCancel: () => void;
  onVerified: (grant: string) => void; onSessionExpired: () => void;
}) {
  const request = useRef<AbortController | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => request.current?.abort(), []);
  const cancel = () => { request.current?.abort(); setPin(''); onCancel(); };
  const verify = async () => {
    if (request.current) return;
    if (!/^\d{4}$/.test(pin)) { setError('Enter your 4-digit login Quick PIN.'); return; }
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    const body = JSON.stringify({ action, quickPin: pin }); setPin('');
    try {
      const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/product-images/verify-quick-pin`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        cache: 'no-store', priority: 'high', signal: controller.signal, body,
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      const result = await response.json() as { success?: boolean; message?: string; data?: { verified?: boolean; action?: string; imageToken?: string } };
      if (controller.signal.aborted) return;
      if (!response.ok || result.success !== true || result.data?.verified !== true || result.data.action !== action || !result.data.imageToken)
        throw new Error(result.message || 'Unable to verify your Quick PIN.');
      onVerified(result.data.imageToken);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to verify your Quick PIN.');
    } finally { if (!controller.signal.aborted) { request.current = null; setBusy(false); } }
  };
  return <QuickPinModal inputId="image-quick-pin" pin={pin} onPinChange={setPin} busy={busy} error={error}
    onCancel={cancel} onSubmit={() => void verify()} />;
}
