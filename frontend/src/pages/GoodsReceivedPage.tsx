import { useMobileSearch, searchRecords } from '../utils/useMobileSearch.ts';
import { useDataLoading } from '../utils/useDataLoading.ts';
import { ActionConfirmation } from './ActionPopup.tsx';
import { SuccessPopup } from './SuccessPopup.tsx';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMasterSync } from '../utils/useMasterSync.ts';
import { invalidateMasterSnapshots } from '../utils/masterSnapshots.ts';
import { Package, ReceiptText, Search } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import { loadProductList, ProductListRequestError } from './productListApi.ts';
import { goodsReceiptRequest, GoodsReceiptError, type ReceiptSupplier, type GoodsReceiptOptions, type GoodsReceiptPayload } from './goodsReceivedApi.ts';
import './DevicesPage.css';
import './StockAdjustmentPage.css';
import './GoodsReceivedPage.css';
import './MobileRecords.css';
import { GoodsReceiptHistory } from './GoodsReceiptHistory.tsx';
import type { ReplenishmentDraft } from './stockPlanning.ts';

type Product = { id: string; code: string; barcode: string; name: string; category: string; stock: number | null; unit: string; cost: number; price: number };
const unitNames: Record<number, string> = { 0: 'Kilogram', 1: 'Liter', 2: 'Number', 3: 'Millilitre', 4: 'Box', 5: 'Tin', 6: 'Jar', 7: 'Bottle', 8: 'Gram', 9: 'Meter', 10: 'Dozen', 11: 'Bag', 12: 'Piece' };
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
type Row = { productId: string; quantity: string; cost: string; price: string };
const validQuantity = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 1e9 && Math.abs(Number(value) * 1000 - Math.round(Number(value) * 1000)) < 1e-6;
const validPrice = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1e9;
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
const formatQuantity = (value: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 6 }).format(value);
const savedStock = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

export function GoodsReceivedPage({ outlet, token, onSessionExpired, onCancel, initialDraft, onDraftConsumed }: { outlet: OutletSummary; token: string; onSessionExpired: () => void; onCancel: () => void;
  initialDraft?: ReplenishmentDraft; onDraftConsumed?: () => void }) {
  const draftToApply = useRef(initialDraft);
  const draftConsumed = useRef(onDraftConsumed); draftConsumed.current = onDraftConsumed;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<ReceiptSupplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [identity, setIdentity] = useState('');
  const [loading, setLoading] = useState(true);
  useDataLoading(loading, 'Goods Receipts');
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const busy = useRef(false);
  const pending = useRef<GoodsReceiptPayload | null>(null);
  const base = `/api/outlets/${encodeURIComponent(outlet.id)}`;
  const locked = saving || uncertain;
  const [stockError, setStockError] = useState('');
  const stockRequest = useRef<AbortController | null>(null);
  const stockRead = useRef(0);
  useLayoutEffect(() => {
    stockRead.current++;
    stockRequest.current?.abort(); stockRequest.current = null;
    return () => { stockRead.current++; stockRequest.current?.abort(); stockRequest.current = null; };
  }, [base, token, reload, locked, confirming]);
  const readStock = useCallback(async (signal: AbortSignal) => {
    const revision = ++stockRead.current;
    try {
      const records = await loadProductList<{ documentId: string; fields: Record<string, unknown> }>(`${base}/products`, token, signal, 'products');
      signal.throwIfAborted();
      if (revision !== stockRead.current) throw new Error('A newer stock read is in progress.');
      const stocks = new Map(records.map(record => [record.documentId, savedStock(record.fields.currentStock)]));
      // Existing stock comes from PRODUCT.currentStock, never from draft quantities
      // or a sum of receipt history (which could count stock adjustments twice).
      setProducts(current => current.map(product => ({ ...product, stock: stocks.get(product.id) ?? null })));
      setStockError('');
    } catch (failure) {
      if (!signal.aborted && revision === stockRead.current) {
        if (failure instanceof ProductListRequestError && failure.status === 401) onSessionExpired();
        setStockError((failure as Error).message);
      }
      throw failure;
    }
  }, [base, token, onSessionExpired]);
  const refreshStock = useCallback(async () => {
    if (stockRequest.current) return;
    const controller = new AbortController(); stockRequest.current = controller;
    try { await readStock(controller.signal); }
    catch { /* readStock reports the error; manual refresh has no retry loop. */ }
    finally { if (stockRequest.current === controller) stockRequest.current = null; }
  }, [readStock]);
  useMasterSync(outlet.id, token, 'products', !loading && !loadError && !locked && !confirming, readStock);
  useEffect(() => {
    if (loading || locked || confirming) return;
    const refresh = () => { if (document.visibilityState !== 'hidden') void refreshStock(); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [loading, locked, confirming, refreshStock]);
  useEffect(() => {
    const controller = new AbortController();
    // Clear loading errors when explicitly refreshing the authorized outlet's data.
    // eslint-disable-next-line react/set-state-in-effect
    setLoading(true); setLoadError('');
    void Promise.all([
      loadProductList<{ documentId: string; fields: Record<string, unknown> }>(`${base}/products`, token, controller.signal, 'products'),
      loadProductList<{ id: string; name: string }>(`${base}/categories`, token, controller.signal, 'categories'),
      goodsReceiptRequest<GoodsReceiptOptions>(`${base}/goods-received`, token, controller.signal),
    ]).then(([records, categories, options]) => {
      if (controller.signal.aborted) return;
      setProducts(records.filter(record => record.fields.stockable === true).map(record => ({
        id: record.documentId, code: text(record.fields.code), barcode: text(record.fields.barcode), name: text(record.fields.name),
        category: categories.find(entry => entry.id === record.fields.category)?.name ?? 'Uncategorized', stock: savedStock(record.fields.currentStock),
        unit: typeof record.fields.unitId === 'number' ? unitNames[record.fields.unitId] ?? '—' : '—',
        cost: typeof record.fields.costPrice === 'number' ? record.fields.costPrice : 0, price: typeof record.fields.price === 'number' ? record.fields.price : 0,
      })));
      setSuppliers(options.suppliers); setIdentity(options.documentId);
      if (draftToApply.current) {
        const draft = draftToApply.current; draftToApply.current = undefined;
        const available = records.filter(record => record.fields.stockable === true);
        const nextRows = draft.items.flatMap(item => {
          const product = available.find(record => record.documentId === item.productId);
          return product ? [{ productId: item.productId, quantity: String(item.quantity), cost: String(typeof product.fields.costPrice === 'number' ? product.fields.costPrice : 0), price: String(typeof product.fields.price === 'number' ? product.fields.price : 0) }] : [];
        });
        setRows(nextRows);
        setSupplier(options.suppliers.some(entry => entry.id === draft.supplierId) ? draft.supplierId : '');
        if (nextRows.length !== draft.items.length) setError('Some planned products are no longer available. Review the remaining receipt items.');
        setNotice('Replenishment draft prepared. Review quantities and prices before saving.');
        draftConsumed.current?.();
      }
    }).catch(failure => {
      if (controller.signal.aborted) return;
      if ((failure instanceof GoodsReceiptError || failure instanceof ProductListRequestError) && failure.status === 401) onSessionExpired();
      setLoadError((failure as Error).message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [base, token, onSessionExpired, reload]);
  const [supplier, setSupplier] = useState('');
  const mobileSearch = useMobileSearch();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const visibleProducts = mobileSearch ? searchRecords(products.filter(product => !category || product.category === category), search, product => ({ text: [product.name], identifiers: [product.code, product.barcode] })) : products.filter(product => (!category || product.category === category)
    && [product.name, product.code, product.barcode].some(value => value.toLowerCase().includes(search.trim().toLowerCase())));
  const validAmounts = rows.every(row => validPrice(row.cost) && validPrice(row.price) && Number.isFinite(Number(row.quantity) * Number(row.cost)));
  const toggleProduct = (product: Product) => {
    if (locked) return;
    if (!rows.some(row => row.productId === product.id) && rows.length >= 100) { setError('A receipt can contain up to 100 products.'); return; }
    setRows(current => current.some(row => row.productId === product.id)
      ? current.filter(row => row.productId !== product.id)
      : [...current, { productId: product.id, quantity: '1', cost: String(product.cost), price: String(product.price) }]);
    setError(''); setNotice('');
  };
  const reset = () => {
    setSupplier(''); setSearch(''); setCategory('');
    setRows([]); setError(''); setNotice('');
  };
  const review = () => {
    setNotice('');
    if (supplier && !suppliers.some(entry => entry.id === supplier)) { setError('Select a supplier.'); return; }
    if (!rows.length) { setError('Add at least one product.'); return; }
    if (rows.some(row => !validQuantity(row.quantity))) { setError('Enter a positive received quantity up to 1,000,000,000 with up to three decimal places for every product.'); return; }
    if (!validAmounts) { setError('Enter finite, nonnegative prices.'); return; }
    if (!identity) { setError('Reload receipts before saving.'); return; }
    setError(''); setConfirming(true);
  };

  const save = async () => {
    if (busy.current) return;
    if (!pending.current) {
      const selectedSupplier = suppliers.find(entry => entry.id === supplier) ?? null;
      if ((supplier && !selectedSupplier) || !identity || !rows.length) return;
      pending.current = { documentId: identity, supplier: selectedSupplier,
        items: rows.map(row => ({ productId: row.productId, quantity: Number(row.quantity), cost: Number(row.cost), price: Number(row.price) })) };
    }
    busy.current = true; setSaving(true); setError('');
    try {
      // The receipt transaction allocates the number once. An uncertain response
      // retries this same document ID and reads its saved number without reallocating.
      const saved = await goodsReceiptRequest<{ documentId: string; goodsReceivedNo: string }>(`${base}/goods-received`, token, undefined, pending.current);
      pending.current.goodsReceivedNo = saved.goodsReceivedNo;
      invalidateMasterSnapshots(`${base}/products`);
      pending.current = null; setUncertain(false); setConfirming(false); reset();
      setNotice('Goods receipt added successfully.'); setReload(value => value + 1);
    } catch (failure) {
      if (failure instanceof GoodsReceiptError && failure.status === 401) onSessionExpired();
      if (failure instanceof GoodsReceiptError && [400, 403, 404, 409, 422].includes(failure.status)) {
        pending.current = null; setUncertain(false); setConfirming(false);
      } else setUncertain(true);
      setError((failure as Error).message);
    } finally { busy.current = false; setSaving(false); }
  };
  if (loading || loadError) return <section className="devices-page"><header className="devices-heading"><div><span>MASTERS</span><h1><ReceiptText />Goods Received</h1></div></header>
    {notice && <SuccessPopup message={notice} onDismiss={() => setNotice('')} />}<div className="devices-state" data-inline-loading={loading ? '' : undefined}>{loading ? 'Loading outlet products, suppliers and receipts…' : <><p role="alert">{loadError}</p><button type="button" className="devices-refresh" onClick={() => setReload(value => value + 1)}>Retry loading</button></>}</div></section>;

  return <section className="devices-page stock-adjustment-page goods-received-page">
    <header className="devices-heading"><div><span>MASTERS</span><h1><ReceiptText />Goods Received</h1><p>Record products received from suppliers.</p></div>
      <div className="goods-supplier-select">
        <button type="button" className="devices-refresh" disabled={locked} onClick={() => setHistoryOpen(true)}>Receipt history</button>
        <label>Supplier (optional)<select disabled={locked} value={supplier} onChange={event => { setSupplier(event.target.value); setNotice(''); }}>
          <option value="">No supplier</option>{suppliers.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select></label>
      </div>
    </header>
    <fieldset className="goods-form-fieldset" disabled={locked}>
    <section className="goods-unified-card" aria-label="Goods received entry">
      <div className="goods-search-row"><label className="goods-search-field">Search products<div><Search aria-hidden="true" /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by code, barcode or name" /></div></label></div>
      <div className="goods-products-heading"><div><h2>Products</h2><p>Select the products received, then enter quantities and prices.</p></div>
      </div>
      {stockError && <p role="alert" className="stock-error goods-entry-message">Stock refresh failed: {stockError} Previously loaded stock is still shown.</p>}
      <nav className="goods-category-tabs" aria-label="Product categories">{['', ...new Set(products.map(product => product.category))].map(value => <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value || 'All'}</button>)}</nav>
      <label className="goods-mobile-category">Category<select aria-label="Filter received products by category" value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{[...new Set(products.map(product => product.category))].map(value => <option key={value} value={value}>{value || 'Uncategorised'}</option>)}</select></label>
      <div className="devices-table-scroll stock-entry-table goods-products-table"><table className="mobile-record-table" aria-label="Stockable products">
        <thead><tr><th>Select</th><th>Code</th><th>Product</th><th>Current stock</th><th>Received qty</th><th>Cost price</th><th>Price</th><th>Line total</th></tr></thead>
        <tbody>{visibleProducts.map(product => {
          const row = rows.find(entry => entry.productId === product.id);
          return <tr key={product.id} className={row ? 'goods-product-selected' : ''}>
            <td className="mobile-record-wide"><label className="goods-include-control"><input type="checkbox" className="goods-row-checkbox" aria-label={`Include ${product.name}`} checked={!!row} onChange={() => toggleProduct(product)} /><span>Include in receipt</span></label></td>
            <td data-label="Code"><span className="goods-code">{product.code || '—'}</span></td>
            <td data-label="Product" className="mobile-record-name"><button type="button" className="goods-product-select" aria-label={`Select product ${product.name}`} aria-pressed={!!row} onClick={() => toggleProduct(product)}>{product.name}</button><small className="goods-help">{product.category} · {product.unit}</small></td>
            <td data-label="Current stock"><span className="goods-stock-value" aria-label={`Current stock for ${product.name}`}>{product.stock === null ? 'Unavailable' : formatQuantity(product.stock)}</span></td>
            <td data-label="Received quantity" className="goods-edit-field"><input type="number" min="0.001" step="0.001" disabled={!row} aria-label={`Received quantity for ${product.name}`} aria-invalid={!!row && !validQuantity(row.quantity)} value={row?.quantity ?? ''} placeholder="0" onChange={event => { setRows(current => current.map(entry => entry.productId === product.id ? { ...entry, quantity: event.target.value } : entry)); setNotice(''); }} />{row && !validQuantity(row.quantity) && <small className="stock-error">Enter a positive quantity with up to three decimal places.</small>}</td>
            {(['cost', 'price'] as const).map(field => <td key={field} data-label={field === 'cost' ? 'Cost price' : 'Price'} className="goods-edit-field"><input type="number" min="0" step="any" disabled={!row} aria-label={`${field === 'cost' ? 'Cost price' : 'Price'} for ${product.name}`} aria-invalid={!!row && !validPrice(row[field])} value={row?.[field] ?? String(product[field])} onChange={event => { setRows(current => current.map(entry => entry.productId === product.id ? { ...entry, [field]: event.target.value } : entry)); setNotice(''); }} />{row && !validPrice(row[field]) && <small className="stock-error">Enter zero or a positive price.</small>}</td>)}
            <td data-label="Line total" className="goods-line-total goods-edit-field">{row && validQuantity(row.quantity) && validPrice(row.price) && Number.isFinite(Number(row.quantity) * Number(row.price)) ? money(Number(row.quantity) * Number(row.price)) : '—'}</td>
          </tr>;
        })}
        {!visibleProducts.length && <tr><td colSpan={8}><div className="stock-empty"><Package aria-hidden="true" /><strong>{products.length ? 'No products match your search' : 'No stockable products yet'}</strong><span>{products.length ? 'Try another name, barcode, code or category.' : 'Mark products as Stockable in Products to get started.'}</span></div></td></tr>}
        </tbody>
      </table></div>
      {error && <p role="alert" className="stock-error goods-entry-message">{error}</p>}
      {notice && <SuccessPopup message={notice} onDismiss={() => setNotice('')} />}
      <footer className="goods-entry-footer goods-actions">
        <strong className="goods-receipt-total" aria-live="polite">Total: {rows.every(row => validQuantity(row.quantity) && validPrice(row.price)) ? money(rows.reduce((total, row) => total + Number(row.quantity) * Number(row.price), 0)) : '—'}</strong>
        <button type="button" className="devices-refresh" onClick={onCancel}>Cancel</button>
        <button type="button" className="stock-primary" onClick={review}>Save</button>
      </footer>
    </section>
    </fieldset>
    {historyOpen && <GoodsReceiptHistory key={`${outlet.id}:${token}`} outletId={outlet.id} token={token} onSessionExpired={onSessionExpired} onClose={() => setHistoryOpen(false)} />}
    {confirming && <ActionConfirmation action="add" item="goods receipt" busy={saving} cancelDisabled={uncertain} error={error}
      onCancel={() => { if (!locked) setConfirming(false); }} onConfirm={() => void save()} confirmLabel={uncertain ? 'Retry confirmation' : 'Add'}>
      {uncertain && <p role="status">Save unconfirmed. Retry to check the outcome.</p>}
    </ActionConfirmation>}
  </section>;
}
