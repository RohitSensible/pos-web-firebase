import { useSyncExternalStore } from 'react';

export { createSearchMatcher, rankSearchResults, searchRecords } from './smartSearch.ts';

// Match the existing phone presentation breakpoint, including phone landscape.
const phoneQuery = 'screen and (max-width: 600px), screen and (max-width: 1024px) and (max-height: 500px)';
const snapshot = () => typeof window !== 'undefined' && window.matchMedia(phoneQuery).matches;
const serverSnapshot = () => false;
function subscribe(onChange: () => void) {
  const media = window.matchMedia(phoneQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export const useMobileSearch = () => useSyncExternalStore(subscribe, snapshot, serverSnapshot);
