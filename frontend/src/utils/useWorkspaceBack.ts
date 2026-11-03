import { useEffect, useLayoutEffect, useRef } from 'react';
import { requestUnsavedNavigation } from './unsavedChanges.tsx';

// Sub-screens that live inside a page (product edit form, bulk updates, master
// forms) are not browser-history entries. While one is open it registers how to
// leave it, and the workspace Back arrow uses that before changing screens.
const handlers: (() => void)[] = [];

export function useWorkspaceBack(active: boolean, onBack: () => void) {
  const latest = useRef(onBack);
  useLayoutEffect(() => { latest.current = onBack; });
  useEffect(() => {
    if (!active) return;
    const handler = () => latest.current();
    handlers.push(handler);
    return () => { const index = handlers.lastIndexOf(handler); if (index >= 0) handlers.splice(index, 1); };
  }, [active]);
}

// Runs the most recently opened sub-screen's Back action. Returns false when no
// sub-screen is open, so the caller can go back to the previous screen instead.
export function runWorkspaceBack(): boolean {
  const handler = handlers.at(-1);
  if (!handler) return false;
  requestUnsavedNavigation(() => { if (handlers.includes(handler)) handler(); });
  return true;
}
