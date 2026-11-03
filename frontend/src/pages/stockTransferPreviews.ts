// In-memory display records only. No API, database or browser-storage access.
export type PreviewOutlet = { id: string; name: string };
export type StockTransferPreviewProduct = {
  id: string; name: string; code: string; availableStock: number;
  allocations: { outletId: string; outletName: string; quantity: number }[];
};
export type StockTransferPreview = {
  id: string; reference: string; date: string; createdAt: number;
  source: PreviewOutlet; destinations: PreviewOutlet[]; note: string;
  products: StockTransferPreviewProduct[];
};
export function createStockTransferPreview(input: Omit<StockTransferPreview, 'id' | 'reference' | 'createdAt'>): StockTransferPreview {
  const id = crypto.randomUUID();
  return {
    id, reference: `PREVIEW-${id.slice(0, 8).toUpperCase()}`, createdAt: Date.now(),
    date: input.date, note: input.note, source: { ...input.source },
    destinations: input.destinations.map(outlet => ({ ...outlet })),
    products: input.products.map(product => ({ ...product, allocations: product.allocations.map(allocation => ({ ...allocation })) })),
  };
}
export const previewQuantity = (preview: StockTransferPreview) => preview.products.reduce((sum, product) => sum + product.allocations.reduce((quantity, allocation) => quantity + allocation.quantity, 0), 0);
export function matchesPreview(preview: StockTransferPreview, startDate: string, endDate: string, search: string) {
  const query = search.trim().toLowerCase();
  return preview.date >= startDate && preview.date <= endDate && (!query || [
    preview.reference, preview.source.id, preview.source.name, preview.note,
    ...preview.destinations.flatMap(outlet => [outlet.id, outlet.name]),
    ...preview.products.flatMap(product => [product.id, product.name, product.code]),
  ].some(value => value.toLowerCase().includes(query)));
}
