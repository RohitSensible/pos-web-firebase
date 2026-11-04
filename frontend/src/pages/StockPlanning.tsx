import { useEffect, useRef, useState } from 'react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import { goodsReceiptRequest, GoodsReceiptError, type GoodsReceiptOptions, type ReceiptSupplier } from './goodsReceivedApi.ts';
import { GoodsReceiptHistory } from './GoodsReceiptHistory.tsx';
import { suggestedReplenishment, stockVariance, type PlanningProduct, type ReplenishmentDraft } from './stockPlanning.ts';
import { downloadReportExcel } from '../utils/reportExcel.ts';
import './StockPlanning.css';

export function StockPlanning({ products, outlet, token, onSessionExpired, onPrepareReceipt }: {
  products: PlanningProduct[]; outlet: OutletSummary; token: string; onSessionExpired: () => void;
  onPrepareReceipt?: (draft: ReplenishmentDraft) => void;
}) {
  const [tool, setTool] = useState<'count' | 'reorder' | null>(null);
  const tracked = products.filter(product => product.tracked);
  const suggestions = suggestedReplenishment(products);
  const [productId, setProductId] = useState(tracked[0]?.productId ?? '');
  const [counted, setCounted] = useState('');
  const [history, setHistory] = useState(false);
  const [suppliers, setSuppliers] = useState<ReceiptSupplier[]>([]);
  const [supplierError, setSupplierError] = useState('');
  const [supplierReload, setSupplierReload] = useState(0);
  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [plan, setPlan] = useState(() => new Map(suggestions.map(product => [product.productId, { included: true, quantity: String(product.suggested), supplierId: '' }])));
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const exportRequest = useRef<AbortController | null>(null);
  const sessionExpired = useRef(onSessionExpired); sessionExpired.current = onSessionExpired;
  useEffect(() => () => exportRequest.current?.abort(), []);
  useEffect(() => {
    if (tool !== 'reorder') return;
    const controller = new AbortController(); let current = true;
    setSuppliersLoading(true); setSupplierError('');
    const timeout = setTimeout(() => { controller.abort(); if (current) { setSupplierError('Supplier loading timed out.'); setSuppliersLoading(false); } }, 20000);
    void goodsReceiptRequest<GoodsReceiptOptions>(`/api/outlets/${encodeURIComponent(outlet.id)}/goods-received`, token, controller.signal)
      .then(data => { if (current && !controller.signal.aborted) setSuppliers(data.suppliers); })
      .catch(reason => { if (!current || controller.signal.aborted) return;
        if (reason instanceof GoodsReceiptError && reason.status === 401) sessionExpired.current();
        setSupplierError(reason instanceof Error ? reason.message : 'Unable to load suppliers.');
      }).finally(() => { clearTimeout(timeout); if (current && !controller.signal.aborted) setSuppliersLoading(false); });
    return () => { current = false; controller.abort(); clearTimeout(timeout); };
  }, [tool, outlet.id, token, supplierReload]);
  const product = tracked.find(entry => entry.productId === productId);
  const variance = product ? stockVariance(product.currentStock, counted) : null;
  const selected = suggestions.filter(entry => plan.get(entry.productId)?.included);
  const validPlan = selected.length > 0 && selected.every(entry => {
    const row = plan.get(entry.productId)!;
    return /^\d+(?:\.\d{1,3})?$/.test(row.quantity) && Number(row.quantity) > 0 && Number(row.quantity) <= 1e9
      && (!row.supplierId || suppliers.some(supplier => supplier.id === row.supplierId));
  });
  const groups = [...new Set(selected.map(entry => plan.get(entry.productId)!.supplierId))].map(supplierId => ({ supplierId,
    name: suppliers.find(supplier => supplier.id === supplierId)?.name ?? 'No supplier selected',
    items: selected.filter(entry => plan.get(entry.productId)!.supplierId === supplierId).map(entry => ({ productId: entry.productId, quantity: Number(plan.get(entry.productId)!.quantity) })),
  }));
  const update = (id: string, patch: Partial<{ included: boolean; quantity: string; supplierId: string }>) => {
    setPlan(current => new Map(current).set(id, { ...current.get(id)!, ...patch })); setExportError('');
  };
  const exportPlan = async () => {
    if (!validPlan || exportRequest.current) return;
    const controller = new AbortController(); exportRequest.current = controller; setExporting(true); setExportError('');
    try {
      await downloadReportExcel({ signal: controller.signal, name: 'Suggested Replenishment', outlet, summary: {}, rows: [
        ['Supplier', 'Code', 'Product', 'Recorded stock', 'Reorder level', 'Suggested quantity', 'Planned quantity'],
        ...groups.flatMap(group => group.items.map(item => { const entry = suggestions.find(row => row.productId === item.productId)!;
          return [group.name, entry.code, entry.name, entry.currentStock, entry.reorderLevel, entry.suggested, item.quantity]; })),
      ] });
    } catch (reason) { if (!controller.signal.aborted) setExportError(reason instanceof Error ? reason.message : 'Export failed.'); }
    finally { if (!controller.signal.aborted) setExporting(false); exportRequest.current = null; }
  };
  return <section className="stock-planning" aria-label="Stock planning tools">
    <header><h2>Plan and check your stock</h2><span className="stock-planning-help">Read-only tools · Stock stays unchanged</span></header>
    <div className="stock-planning-tabs"><button type="button" className="btn-secondary" aria-pressed={tool === 'count'} onClick={() => setTool(tool === 'count' ? null : 'count')}>Compare stock count</button>
      <button type="button" className="btn-secondary" aria-pressed={tool === 'reorder'} onClick={() => setTool(tool === 'reorder' ? null : 'reorder')}>Plan replenishment ({suggestions.length})</button></div>
    {tool === 'count' && <div><p className="stock-planning-help">Enter a physical count to compare with recorded stock. Review differences and supporting records before making a separate stock adjustment.</p>
      <div className="stock-planning-filters"><label>Counted product<select value={productId} onChange={event => { setProductId(event.target.value); setCounted(''); }}>{tracked.map(entry => <option key={entry.productId} value={entry.productId}>{entry.code} · {entry.name}</option>)}</select></label>
      <label>Physical count<input type="number" min="0" max="1000000000" step="0.001" value={counted} onChange={event => setCounted(event.target.value)} /></label></div>
      {product && <p>Recorded stock: <strong>{product.currentStock}</strong></p>}
      {counted && variance === null && <p role="alert">Enter a nonnegative count with up to three decimal places.</p>}
      {variance !== null && <p className="stock-planning-result" data-different={variance !== 0} role="status">{variance === 0 ? 'Count matches recorded stock' : `Difference: ${variance > 0 ? '+' : ''}${variance}`}</p>}
      <div><button type="button" className="btn-secondary" disabled={!product} onClick={() => setHistory(true)}>View recorded movements</button></div>
      <p className="stock-planning-help">Recorded movements can omit sales and other stock changes. This comparison uses your physical count and does not calculate an opening balance from partial history.</p>
    </div>}
    {tool === 'reorder' && <div><p className="stock-planning-help">Suggestions top up tracked products to their configured reorder level. Adjust quantities and choose suppliers for this plan. Nothing is ordered or saved until you review and confirm a receipt separately.</p>
      {suppliersLoading && <p role="status">Loading suppliers…</p>}
      {supplierError && <p role="alert">{supplierError} <button type="button" onClick={() => setSupplierReload(value => value + 1)}>Retry suppliers</button></p>}
      {!suggestions.length ? <p>No replenishment suggested. Products need a positive reorder level to appear here.</p> : <>
      <div className="stock-planning-scroll"><table aria-label="Replenishment plan"><thead><tr><th>Include</th><th>Product</th><th>Recorded / target</th><th>Planned qty</th><th>Supplier</th></tr></thead><tbody>{suggestions.map(entry => {
        const row = plan.get(entry.productId)!;
        return <tr key={entry.productId}><td><input type="checkbox" aria-label={`Replenish ${entry.name}`} checked={row.included} onChange={event => update(entry.productId, { included: event.target.checked })} /></td><td>{entry.name}<small>{entry.code}</small></td><td>{entry.currentStock} / {entry.reorderLevel}</td><td><input type="number" aria-label={`Order quantity for ${entry.name}`} min="0.001" max="1000000000" step="0.001" value={row.quantity} onChange={event => update(entry.productId, { quantity: event.target.value })} /></td><td><select aria-label={`Supplier for ${entry.name}`} value={row.supplierId} disabled={suppliersLoading || !!supplierError} onChange={event => update(entry.productId, { supplierId: event.target.value })}><option value="">No supplier selected</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></td></tr>;
      })}</tbody></table></div>
      {!validPlan && <p role="status">Include products and enter positive quantities with up to three decimal places.</p>}
      <div className="stock-planning-actions"><button type="button" className="btn-secondary" disabled={!validPlan || exporting} onClick={() => void exportPlan()}>{exporting ? 'Exporting plan…' : 'Export replenishment plan'}</button></div>
      {exportError && <p role="alert">{exportError}</p>}
      {groups.map(group => <div className="stock-planning-actions" key={group.supplierId}><strong>{group.name} · {group.items.length} products</strong>{onPrepareReceipt && <button type="button" className="btn-secondary" disabled={!validPlan || group.items.length > 100 || suppliersLoading || !!supplierError} onClick={() => onPrepareReceipt({ supplierId: group.supplierId, items: group.items })}>Prepare Goods Received draft</button>}{group.items.length > 100 && <span>Limit each receipt to 100 products.</span>}</div>)}
      </>}
    </div>}
    {history && <GoodsReceiptHistory key={`${outlet.id}:${token}`} outletId={outlet.id} token={token} productId={productId} onSessionExpired={onSessionExpired} onClose={() => setHistory(false)} />}
  </section>;
}
