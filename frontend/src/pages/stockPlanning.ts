export interface PlanningProduct { productId: string; code: string; name: string; tracked: boolean; currentStock: number; reorderLevel: number }
export type ReplenishmentDraft = { supplierId: string; items: { productId: string; quantity: number }[] };

export function stockVariance(recorded: number, counted: string): number | null {
  if (!counted.trim() || !Number.isFinite(recorded) || !/^\d+(?:\.\d{1,3})?$/.test(counted.trim())) return null;
  const value = Number(counted);
  return value <= 1e9 ? Math.round((value - recorded) * 1e6) / 1e6 : null;
}

// Reorder level is the only configured target available. Never invent a supplier,
// minimum order or safety-stock rule; quantity remains an editable local plan.
export function suggestedReplenishment(products: PlanningProduct[]) {
  return products.filter(product => product.tracked && Number.isFinite(product.currentStock)
    && Number.isFinite(product.reorderLevel) && product.reorderLevel > 0 && product.currentStock < product.reorderLevel)
    .map(product => {
      const thousandths = (product.reorderLevel - product.currentStock) * 1000;
      return { ...product, suggested: Math.ceil(thousandths - Number.EPSILON * Math.abs(thousandths) * 8) / 1000 };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
