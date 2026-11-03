import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionConfirmation } from '../pages/ActionPopup.tsx';

export function useActionConfirmation(active = true) {
  const [pending, setPending] = useState<{ action: string; item: string } | null>(null);
  const resolve = useRef<((confirmed: boolean) => void) | null>(null);
  useEffect(() => () => { resolve.current?.(false); resolve.current = null; }, []);
  useEffect(() => {
    if (active || !resolve.current) return;
    resolve.current(false); resolve.current = null; setPending(null);
  }, [active]);
  const confirmAction = useCallback((action: string, item: string): Promise<boolean> => {
    if (resolve.current) return Promise.resolve(false);
    return new Promise(complete => { resolve.current = complete; setPending({ action, item }); });
  }, []);
  const finish = (confirmed: boolean) => {
    const complete = resolve.current;
    resolve.current = null; setPending(null); complete?.(confirmed);
  };
  return { confirmAction, confirmation: pending && <ActionConfirmation action={pending.action} item={pending.item}
    onCancel={() => finish(false)} onConfirm={() => finish(true)} /> };
}
