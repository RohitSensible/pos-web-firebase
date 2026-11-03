export interface LoadingTask { id: number; label: string; background: boolean }
interface LoadingSnapshot { batch: number; tasks: readonly LoadingTask[] }
let nextId = 0;
let snapshot: LoadingSnapshot = { batch: 0, tasks: [] };
const listeners = new Set<() => void>();
const backgroundSignals = new WeakSet<AbortSignal>();
const taskSignals = new Map<number, AbortSignal>();

/** Ready lists may keep refreshing without covering usable data with a modal. */
export function markDataLoadingBackground(signal: AbortSignal): void {
  backgroundSignals.add(signal);
  if (!snapshot.tasks.some(task => !task.background && taskSignals.get(task.id) === signal)) return;
  snapshot = { ...snapshot, tasks: snapshot.tasks.map(task => taskSignals.get(task.id) === signal ? { ...task, background: true } : task) };
  listeners.forEach(listener => listener());
}
export const getDataLoadingSnapshot = () => snapshot;
export const subscribeDataLoading = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function dataLoadingLabel(resource: string): string {
  const path = resource.split('?')[0]?.split('/').filter(Boolean).at(-1) ?? resource;
  const labels: Record<string, string> = { categories: 'Categories', products: 'Products', employees: 'Employees', customers: 'Customers', premises: 'Premises',
    'service-points': 'Service Points', outlets: 'Outlets', devices: 'Devices', dashboard: 'Dashboard', account: 'Account Details', 'goods-received': 'Goods Receipts',
    'stock-movements': 'Stock Movements', 'stock-transfers': 'Stock Transfers', bills: 'Sales Report', gst: 'GST Report', shifts: 'Shift Summary', stock: 'Stock Report' };
  return labels[path] ?? resource;
}

/** Track the complete read/parse operation, with idempotent cleanup on abort. */
export function beginDataLoading(resource: string, signal?: AbortSignal): () => void {
  if (signal?.aborted) return () => {};
  const id = ++nextId;
  const background = !!signal && backgroundSignals.has(signal);
  const task = { id, label: dataLoadingLabel(resource), background };
  if (signal) taskSignals.set(id, signal);
  const newBatch = !snapshot.tasks.length || (!background && !snapshot.tasks.some(task => !task.background));
  snapshot = { batch: newBatch ? snapshot.batch + 1 : snapshot.batch, tasks: [...snapshot.tasks, task] };
  const finish = () => {
    if (!snapshot.tasks.some(task => task.id === id)) return;
    signal?.removeEventListener('abort', finish);
    taskSignals.delete(id);
    snapshot = { ...snapshot, tasks: snapshot.tasks.filter(task => task.id !== id) };
    listeners.forEach(listener => listener());
  };
  signal?.addEventListener('abort', finish, { once: true });
  listeners.forEach(listener => listener());
  return finish;
}
