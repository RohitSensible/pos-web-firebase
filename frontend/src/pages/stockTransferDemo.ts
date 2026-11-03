// Static demonstration fixtures only. This module has no service or storage dependencies.
export const demoOutlets = [
  { id: 'main', name: 'Main Outlet', location: 'Central warehouse' },
  { id: 'anna', name: 'Anna Nagar', location: 'Chennai' },
  { id: 'adyar', name: 'Adyar', location: 'Chennai' },
  { id: 'velachery', name: 'Velachery', location: 'Chennai' },
];
export type DemoProduct = { id: string; name: string; category: string; code: string; stocks: number[]; stockable?: boolean };
export const demoProducts: DemoProduct[] = [
  { id: 'turmeric', name: 'Turmeric Powder · 100 g', category: 'Spices', code: 'SP-001', stockable: true, stocks: [100, 60, 45, 30] },
  { id: 'chilli', name: 'Chilli Powder · 100 g', category: 'Spices', code: 'SP-002', stockable: true, stocks: [150, 75, 50, 40] },
  { id: 'rice', name: 'Ponni Rice · 1 kg', category: 'Staples', code: 'ST-001', stockable: true, stocks: [240, 120, 90, 80] },
  { id: 'dal', name: 'Toor Dal · 500 g', category: 'Staples', code: 'ST-002', stockable: true, stocks: [180, 80, 65, 50] },
  { id: 'oil', name: 'Groundnut Oil · 1 L', category: 'Cooking Oils', code: 'CO-001', stockable: true, stocks: [96, 48, 36, 24] },
  { id: 'tea', name: 'Premium Tea · 250 g', category: 'Beverages', code: 'BV-001', stockable: true, stocks: [120, 54, 42, 36] },
];
export type TransferRow = { productId: string; allocations: Record<string, string> };
export type DemoTransfer = {
  id: string; date: string; source: string; destinations: string[]; note: string;
  status: 'Completed' | 'Pending' | 'Cancelled'; rows: TransferRow[];
};
export const demoHistory: DemoTransfer[] = [
  { id: 'DEMO-ST-0104', date: '2026-11-03', source: 'main', destinations: ['anna', 'adyar'], status: 'Completed', note: 'Weekly spice replenishment.',
    rows: [{ productId: 'turmeric', allocations: { anna: '50', adyar: '50' } }, { productId: 'chilli', allocations: { anna: '30', adyar: '20' } }] },
  { id: 'DEMO-ST-0103', date: '2026-11-02', source: 'main', destinations: ['velachery'], status: 'Pending', note: 'Planned weekend stock.',
    rows: [{ productId: 'rice', allocations: { velachery: '40' } }, { productId: 'dal', allocations: { velachery: '30' } }] },
  { id: 'DEMO-ST-0102', date: '2026-11-01', source: 'anna', destinations: ['adyar'], status: 'Completed', note: 'Beverage and oil replenishment.',
    rows: [{ productId: 'tea', allocations: { adyar: '30' } }, { productId: 'oil', allocations: { adyar: '28' } }] },
  { id: 'DEMO-ST-0101', date: '2026-10-30', source: 'adyar', destinations: ['velachery'], status: 'Cancelled', note: 'Demonstration of a cancelled request.',
    rows: [{ productId: 'dal', allocations: { velachery: '20' } }] },
];
export const outletName = (id: string) => demoOutlets.find(outlet => outlet.id === id)?.name ?? id;
export const availableStock = (productId: string, source: string) => demoProducts.find(product => product.id === productId)?.stocks[demoOutlets.findIndex(outlet => outlet.id === source)] ?? 0;
export const allocatedQuantity = (row: TransferRow) => Object.values(row.allocations).reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
export const totalQuantity = (rows: TransferRow[]) => rows.reduce((sum, row) => sum + allocatedQuantity(row), 0);
export function allocationError(row: TransferRow, source: string) {
  const quantities = Object.values(row.allocations);
  if (!quantities.length) return 'Add at least one destination allocation.';
  if (quantities.some(value => !value.trim() || !Number.isSafeInteger(Number(value)) || Number(value) <= 0)) return 'Enter a whole-unit quantity greater than zero for each allocation.';
  if (allocatedQuantity(row) > availableStock(row.productId, source)) return 'Allocated quantity exceeds available stock. Reduce the quantities to continue.';
  return '';
}
export function todayInIndia() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export const formatDemoDate = (date: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(`${date}T00:00:00+05:30`));
