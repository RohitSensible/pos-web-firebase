import { useEffect } from 'react';
import { beginDataLoading } from './dataLoading.ts';

export function useDataLoading(loading: boolean, label: string) {
  useEffect(() => {
    if (loading) return beginDataLoading(label);
  }, [loading, label]);
}
