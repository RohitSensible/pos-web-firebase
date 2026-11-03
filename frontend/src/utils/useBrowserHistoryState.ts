import { useCallback, useEffect, useState } from 'react';
import { hasUnsavedChanges, requestUnsavedNavigation } from './unsavedChanges.tsx';

// All workspace and nested upload entries share an index. A denied traversal is
// compensated before asking, leaving the draft and the forward stack intact.
const tag = '__workspaceNavigation';
const savedTag = typeof window !== 'undefined' ? window.history.state?.[tag] : null;
const session = typeof savedTag?.session === 'string' ? savedTag.session : Math.random().toString(36).slice(2);
let index = 0;
let listening = false;
const subscribers = new Set<(state: Record<string, unknown> | null) => void>();
let traversal: { origin: number; target: number; restoring: boolean; accepted: boolean } | null = null;
const entryIndex = (state: any): number | null => state?.[tag]?.session === session && Number.isInteger(state[tag].index) ? state[tag].index : null;
const publish = () => subscribers.forEach(listener => listener(window.history.state));
function initialize() {
  if (listening) return;
  listening = true;
  index = entryIndex(window.history.state) ?? 0;
  window.history.replaceState({ ...window.history.state, [tag]: { session, index } }, '');
  window.addEventListener('popstate', event => {
    const destination = entryIndex(event.state);
    if (destination === null) { traversal = null; publish(); return; }
    if (traversal?.restoring) {
      if (destination !== traversal.origin) { window.history.go(traversal.origin - destination); return; }
      const transaction = traversal;
      transaction.restoring = false;
      traversal = null;
      // A forced scope change or confirmed save during compensation cancels it.
      if (!hasUnsavedChanges()) return;
      requestUnsavedNavigation(() => {
        traversal = transaction;
        transaction.accepted = true;
        window.history.go(transaction.target - transaction.origin);
      });
      return;
    }
    if (traversal?.accepted && destination === traversal.target) {
      index = destination; traversal = null; publish(); return;
    }
    traversal = null;
    if (destination !== index && hasUnsavedChanges()) {
      traversal = { origin: index, target: destination, restoring: true, accepted: false };
      window.history.go(index - destination);
      return;
    }
    index = destination;
    publish();
  });
}

// Only validated screen names enter history. Auth and outlet admission are
// never restored from history, and their forced state changes bypass this hook.
export function useBrowserHistoryState<T extends string>(key: string, initial: T, valid: (value: unknown) => value is T, restoreOnMount = true) {
  const [value, setValue] = useState<T>(() => restoreOnMount && valid(window.history.state?.[key]) ? window.history.state[key] : initial);
  useEffect(() => {
    initialize();
    if (!restoreOnMount || !valid(window.history.state?.[key])) {
      window.history.replaceState({ ...window.history.state, [key]: initial }, '');
    }
    const restore = (state: Record<string, unknown> | null) => setValue(valid(state?.[key]) ? state[key] : initial);
    subscribers.add(restore);
    return () => { subscribers.delete(restore); };
  }, [key, initial, valid, restoreOnMount]);

  const navigate = useCallback((next: T) => {
    if (!valid(next)) return;
    if (window.history.state?.[key] === next) { setValue(next); return; }
    requestUnsavedNavigation(() => {
      initialize();
      traversal = null;
      if (window.history.state?.[key] !== next) {
        index++;
        window.history.pushState({ ...window.history.state, [key]: next, [tag]: { session, index } }, '');
      }
      setValue(next);
    });
  }, [key, valid]);
  const back = useCallback(() => {
    requestUnsavedNavigation(() => {
      const current = window.history.state?.[key];
      // The popstate coordinator owns the prompt for actual traversal. Calling
      // history.back here needs no second asynchronous discard confirmation.
      if (valid(current) && current !== initial) {
        initialize();
        if (traversal?.accepted) return;
        traversal = { origin: index, target: index - 1, restoring: false, accepted: true };
        window.history.back();
      } else setValue(initial);
    });
  }, [key, initial, valid]);
  return [value, navigate, back] as const;
}
