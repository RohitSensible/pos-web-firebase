import { PageHeading } from '../components/PageHeading.tsx';
import { useMobileSearch, searchRecords } from '../utils/useMobileSearch.ts';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { MobileAddButton } from './MobileAddButton.tsx';
import { ArrowRight, ArrowRightLeft, CalendarDays, CheckCircle2, Coffee, Droplets, Eye, Flame, FlaskConical, Info, MapPin, Package, Search, Store, Trash2, Wheat, X } from 'lucide-react';
import { ActionPopup } from './ActionPopup.tsx';
import { useWorkspaceBack } from '../utils/useWorkspaceBack.ts';
import { formatDemoDate, todayInIndia, type DemoTransfer, type TransferRow } from './stockTransferDemo.ts';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import { useStockTransferRead, type StockTransferProduct, type StockTransferCategory } from './useStockTransferRead.ts';
import { createStockTransferPreview, type StockTransferPreview } from './stockTransferPreviews.ts';
import './DevicesPage.css';
import './StockTransferPage.css';

const validQuantity = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const allocatedQuantity = (row: TransferRow) => Object.values(row.allocations).reduce((sum, value) => sum + (validQuantity(value) ? Number(value) : 0), 0);
const totalQuantity = (rows: TransferRow[]) => rows.reduce((sum, row) => sum + allocatedQuantity(row), 0);
const count = (value: number) => value.toLocaleString('en-IN');
const categoryIcons: Record<string, ReactNode> = { Spices: <Flame size={21} />, Staples: <Wheat size={21} />, 'Cooking Oils': <Droplets size={21} />, Beverages: <Coffee size={21} /> };

export function StockTransferPage({ outlet, token, onSessionExpired, onPreviewConfirmed, onViewReport }: {
  outlet: OutletSummary; token: string; onSessionExpired: () => void;
  onPreviewConfirmed?: (preview: StockTransferPreview) => void;
  onViewReport?: (date: string) => void;
}) {
  const [source, setSource] = useState(outlet.id);
  const [destinations, setDestinations] = useState<string[]>([]);
  const [date, setDate] = useState(todayInIndia);
  const note = ''; // No note field is established in the supplied stock-log format.
  const [rows, setRows] = useState<TransferRow[]>([]);
  const mobileSearch = useMobileSearch();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'review' | 'confirm' | 'done' | 'reset' | null>(null);
  const sourceInput = useRef<HTMLSelectElement>(null);
  const lastConfirmed = useRef<{ signature: string; preview: StockTransferPreview } | null>(null);
  const [completedPreview, setCompletedPreview] = useState<StockTransferPreview | null>(null);
  useWorkspaceBack(!!dialog, () => setDialog(null));
  const outletRead = useStockTransferRead<OutletSummary>('/api/auth/outlets', token, 'outlets', onSessionExpired);
  const outlets = outletRead.data ?? [];
  const authorizedSource = outlets.some(item => item.id === source);
  const base = authorizedSource ? `/api/outlets/${encodeURIComponent(source)}` : null;
  const productRead = useStockTransferRead<StockTransferProduct>(base ? `${base}/products` : null, token, 'products', onSessionExpired);
  const categoryRead = useStockTransferRead<StockTransferCategory>(base ? `${base}/categories` : null, token, 'categories', onSessionExpired);
  const loading = outletRead.loading || productRead.loading || categoryRead.loading;
  const loadError = outletRead.error || productRead.error || categoryRead.error;
  const categoryNames = new Map((categoryRead.data ?? []).map(item => [item.id, item.name]));
  const stockableProducts = !loading && !loadError ? (productRead.data ?? []).filter(product => product.fields.stockable === true).map(product => ({
    id: product.documentId,
    name: typeof product.fields.name === 'string' && product.fields.name.trim() ? product.fields.name : 'Unnamed product',
    code: typeof product.fields.code === 'string' || typeof product.fields.code === 'number' ? String(product.fields.code) : '—',
    category: typeof product.fields.category === 'string' && product.fields.category ? categoryNames.get(product.fields.category) || 'Unknown category' : 'Uncategorized',
    stock: typeof product.fields.currentStock === 'number' && Number.isFinite(product.fields.currentStock) && Math.abs(product.fields.currentStock) <= Number.MAX_SAFE_INTEGER ? product.fields.currentStock : null,
  })) : [];
  const availableStock = (id: string) => stockableProducts.find(product => product.id === id)?.stock ?? null;
  const outletName = (id: string) => outlets.find(item => item.id === id)?.name ?? id;
  const destinationError = (row: TransferRow, id: string) => {
    const value = row.allocations[id];
    if (!validQuantity(value)) return 'Enter a whole-unit quantity greater than zero (up to the safe integer limit).';
    const available = availableStock(row.productId);
    if (available === null) return 'Source stock is unavailable. Reload the products.';
    const otherQuantity = allocatedQuantity({ ...row, allocations: Object.fromEntries(Object.entries(row.allocations).filter(([key]) => key !== id)) });
    const capacity = Math.max(0, Math.floor(available - otherQuantity));
    return Number(value) > capacity ? `Allocation exceeds available stock. Maximum for ${outletName(id)}: ${count(capacity)} units after other allocations.` : '';
  };
  const allocationError = (row: TransferRow) => {
    const available = availableStock(row.productId);
    if (available === null) return 'Source stock is unavailable. Reload the products.';
    const values = Object.values(row.allocations);
    if (!values.length) return 'Add at least one destination allocation.';
    if (values.some(value => !validQuantity(value))) return 'Enter a whole-unit quantity greater than zero for each allocation.';
    return !Number.isSafeInteger(allocatedQuantity(row)) || allocatedQuantity(row) > available ? 'Allocated quantity exceeds available stock. Reduce the quantities to continue.' : '';
  };
  const categories = [...new Set(stockableProducts.map(product => product.category))];
  const products = mobileSearch ? searchRecords(stockableProducts.filter(product => (!selectedOnly || rows.some(row => row.productId === product.id)) && (!category || product.category === category)), search, product => ({ primary: [product.name], text: [product.name, product.code, product.category], identifiers: [product.code] })) : stockableProducts.filter(product => (!selectedOnly || rows.some(row => row.productId === product.id)) && (!category || product.category === category) && `${product.name} ${product.code} ${product.category}`.toLowerCase().includes(search.trim().toLowerCase()));
  const updateRow = (productId: string, update: (row: TransferRow) => TransferRow) => {
    setRows(current => current.map(row => row.productId === productId ? update(row) : row)); setError('');
  };
  const reset = () => {
    lastConfirmed.current = null; setCompletedPreview(null);
    setSource(outlet.id); setDestinations([]); setDate(todayInIndia()); setRows([]); setSearch(''); setCategory(''); setSelectedOnly(false); setError(''); setDialog(null);
    setNotice('New local preview ready.'); sourceInput.current?.focus();
  };
  const validate = () => {
    const message = !authorizedSource ? 'Choose a source outlet.'
      : loading || loadError ? 'Wait for outlet and product data to load successfully.'
      : destinations.length !== 1 || !outlets.some(item => item.id === destinations[0]) ? 'Select one destination outlet.'
      : destinations.includes(source) || new Set(destinations).size !== destinations.length ? 'Choose distinct destinations different from the source.'
      : !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || date < '2000-01-01' || date > '2099-12-31' || new Date(date).toISOString().slice(0, 10) !== date ? 'Choose a valid transfer date.'
      : !rows.length ? 'Add at least one product to review.'
      : rows.some(row => Object.keys(row.allocations).some(id => !destinations.includes(id))) ? 'Each allocation must use a selected destination.'
      : rows.map(row => allocationError(row)).find(Boolean) || (!Number.isSafeInteger(totalQuantity(rows)) ? 'Total preview quantity exceeds the safe integer limit. Reduce the quantities.' : '');
    setError(message); return !message;
  };
  const confirmPreview = () => {
    if (!validate()) { setDialog(null); return; }
    const signature = JSON.stringify({ source, destinations, date, note, rows });
    let preview = lastConfirmed.current?.signature === signature ? lastConfirmed.current.preview : null;
    if (!preview) {
      preview = createStockTransferPreview({
        date, note, source: { id: source, name: outletName(source) },
        destinations: destinations.map(id => ({ id, name: outletName(id) })),
        products: rows.map(row => {
          const product = stockableProducts.find(item => item.id === row.productId)!;
          return { id: product.id, name: product.name, code: product.code, availableStock: product.stock!,
            allocations: Object.entries(row.allocations).map(([id, value]) => ({ outletId: id, outletName: outletName(id), quantity: Number(value) })) };
        }),
      });
      lastConfirmed.current = { signature, preview };
    }
    onPreviewConfirmed?.(preview);
    setCompletedPreview(preview); setDialog('done');
  };
  const review = (event: FormEvent) => { event.preventDefault(); setNotice(''); if (validate()) setDialog('review'); };
  const currentTransfer: DemoTransfer = { id: 'Demonstration preview', date, source, destinations, note, status: 'Pending', rows };

  return <section className="devices-page stock-transfer-page">
    <header className="devices-heading"><div><span>INVENTORY</span><PageHeading><ArrowRightLeft aria-hidden="true" />Stock Transfer</PageHeading><p>Preview stock transfers.</p></div>
      <MobileAddButton label="New Stock Transfer" className="st-button st-primary" onClick={() => { if (rows.length || destinations.length || note || source !== outlet.id || date !== todayInIndia()) setDialog('reset'); else reset(); }} />
    </header>
    <div className="st-demo-notice"><FlaskConical size={16} aria-hidden="true" /><p><strong>Preview mode</strong> Live outlet and product data. Allocations stay local; no stock is moved or saved to the server. The form resets when you leave; confirmed previews remain in the report for this login session.</p><span className="st-badge">Local preview</span></div>
    {notice && <p className="st-notice" role="status">{notice}</p>}
    <form className="st-form" noValidate onSubmit={review}>
      <section className="st-panel" aria-labelledby="st-route-title">
        <div className="st-panel-heading"><div><span className="st-step">01</span><div><h2 id="st-route-title">Stock log details</h2><p>Choose one sending outlet and one receiving outlet.</p></div></div><span className="st-section-caption">OUTLET DETAILS</span></div>
        <div className="st-route-grid">
          <div className="st-outlet-card st-source-card"><div className="st-outlet-label"><span className="st-outlet-icon"><Store size={19} /></span><div><strong>Sending from</strong><small>Stock will be allocated from this outlet</small></div></div>
            <label className="st-field"><span>From Outlet</span><select ref={sourceInput} disabled={outletRead.loading || !!outletRead.error} value={authorizedSource ? source : ''} onChange={event => {
              const id = event.target.value; setSource(id); setDestinations(current => current.filter(value => value !== id)); setRows([]); setSearch(''); setCategory(''); setSelectedOnly(false); setError('');
              setNotice('Source changed. Product selections and quantities were cleared to use the new source’s stock.');
            }}><option value="" disabled>Choose source outlet</option>{outlets.map(item => <option key={item.id} value={item.id}>{item.name}{item.branch ? ` · ${item.branch}` : ''}</option>)}</select></label>
          </div>
          <span className="st-flow-arrow" aria-hidden="true"><ArrowRight size={20} /></span>
          <div className="st-outlet-card"><div className="st-outlet-label"><span className="st-outlet-icon"><MapPin size={19} /></span><div><strong>Sending to</strong><small>Choose one receiving outlet</small></div></div>
            <div className="st-field"><label htmlFor="st-destination">To Outlet</label><select id="st-destination" disabled={outletRead.loading || !!outletRead.error || !authorizedSource} value={destinations[0] ?? ''} onChange={event => {
              const id = event.target.value;
              setDestinations(id ? [id] : []);
              setRows(current => current.map(row => ({ ...row, allocations: id ? { [id]: '' } : {} })));
              setError('');
              setNotice('Receiving outlet changed. Enter quantities for this outlet.');
            }}><option value="">Choose receiving outlet</option>{outlets.filter(outlet => outlet.id !== source).map(outlet => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></div>
          </div>
        </div>
        <div className="st-meta-grid">
          <label className="st-field"><span><CalendarDays size={14} />Day ID</span><input type="date" required min="2000-01-01" max="2099-12-31" value={date} onChange={event => { setDate(event.target.value); setError(''); }} /></label>
          <label className="st-field"><span>Month ID</span><input readOnly value={date.slice(0, 7)} /></label>
          <label className="st-field"><span>Stock Type</span><input readOnly value="TRANSFER" /></label>
          <label className="st-field"><span>Status</span><input readOnly value="LOCAL PREVIEW" /><small>No completed transfer is recorded.</small></label>
          <label className="st-field"><span>Request ID</span><input disabled value="Not assigned" /><small>Unavailable in local preview.</small></label>
          <label className="st-field"><span>Request Count</span><input disabled value="Not assigned" /><small>Existing request-count rules have not been verified.</small></label>
        </div>
      </section>
      {loading && <p className="st-selection-help" role="status">Loading {outletRead.loading ? 'your outlets' : 'stockable products and categories'}…</p>}
      {loadError && <div className="st-selection-help" role="alert"><span>{loadError}</span><button type="button" className="st-button" onClick={() => { setRows([]); setDialog(null); if (outletRead.error) outletRead.retry(); if (productRead.error) productRead.retry(); if (categoryRead.error) categoryRead.retry(); }}>Retry Data</button></div>}
      {!outletRead.loading && !outletRead.error && !outlets.length && <p className="st-selection-help">No authorized outlets are available.</p>}
      <section className="st-panel st-products-panel" aria-labelledby="st-products-title">
        <div className="st-panel-heading"><div><span className="st-step">02</span><div><h2 id="st-products-title">Product details & quantities</h2><p>Only stock-tracked products are shown. Select a product to enter quantities.</p></div></div><span className="st-badge">{rows.length} selected</span></div>
        <div className="st-product-toolbar"><label className="st-field st-search"><span><Search size={14} />Product search</span><input type="search" placeholder="Search product name or code…" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <label className="st-field">Category<select value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
          <button type="button" className={`st-button st-selected-filter${selectedOnly ? ' active' : ''}`} aria-pressed={selectedOnly} onClick={() => setSelectedOnly(value => !value)}>Selected ({rows.length})</button>
        </div>
        {!destinations.length && <p className="st-selection-help"><Info size={16} />Choose a receiving outlet above to start selecting products.</p>}
        <div className="st-catalog" role="group" aria-label="Source outlet stockable products">{products.map(product => {
          const row = rows.find(item => item.productId === product.id);
          const available = availableStock(product.id);
          const amount = row ? allocatedQuantity(row) : 0;
          const quantitiesValid = !row || Object.values(row.allocations).length > 0 && Object.values(row.allocations).every(validQuantity) && Number.isSafeInteger(amount);
          const issue = row ? allocationError(row) : '';
          const warning = issue && row && (Object.values(row.allocations).some(value => value.trim()) || error) ? issue : '';
          return <article className={`st-product-card${row ? ' st-added' : ''}`} key={product.id} data-product-id={product.id} data-category={product.category}>
            <div className="st-product-header"><label className="st-product-choice"><input type="checkbox" aria-label={`Select ${product.name}`} checked={!!row} disabled={!row && (!destinations.length || available === null || available < 1)} onChange={event => {
              const checked = event.target.checked;
              setRows(current => checked ? current.some(item => item.productId === product.id) ? current : [...current, { productId: product.id, allocations: Object.fromEntries(destinations.map(id => [id, ''])) }] : current.filter(item => item.productId !== product.id));
              setError(''); setNotice('');
            }} /><span className="st-product-icon" aria-hidden="true"><>{categoryIcons[product.category] ?? <Package size={21} />}</></span><span className="st-product-name"><strong>{product.name}</strong><small>{product.code}<span className="st-category-tag">{product.category}</span></small></span></label>
              <div className="st-stock"><small>Available stock</small><strong>{available === null ? 'Unavailable' : count(available)} <span>{available === null ? '' : available <= 0 ? '· Out of stock' : available < 1 ? '· Below one whole unit' : 'units'}</span></strong></div>
              {row && <button type="button" className="st-icon-button st-remove" aria-label={`Remove product ${product.name}`} onClick={() => { setRows(current => current.filter(item => item.productId !== product.id)); setError(''); }}><Trash2 size={16} /></button>}
            </div>
            {row && <div className="st-product-editor"><div className="st-editor-heading"><span>QUANTITY TO TRANSFER</span><span className={`st-readiness${!issue ? ' ready' : ''}`}>{!issue ? <><CheckCircle2 size={13} />Ready</> : 'Enter units for the receiving outlet'}</span></div>
              <div className="st-allocations">{Object.entries(row.allocations).map(([id, value]) => {
                const fieldIssue = destinationError(row, id);
                const showIssue = !!fieldIssue && (!!value || !!error);
                const otherAmount = allocatedQuantity({ ...row, allocations: Object.fromEntries(Object.entries(row.allocations).filter(([key]) => key !== id)) });
                const capacity = available === null ? null : Math.max(0, Math.floor(available - otherAmount));
                const helpId = `st-qty-help-${product.id}-${id}`;
                return <div className="st-allocation" key={id}>
                <label htmlFor={`st-qty-${product.id}-${id}`}><Store size={14} />{outletName(id)}</label>
                <div className="st-quantity-control"><input id={`st-qty-${product.id}-${id}`} type="text" placeholder="Qty" inputMode="numeric" pattern="[0-9]+" autoComplete="off" value={value} aria-label={`${product.name} quantity for ${outletName(id)}`} aria-invalid={showIssue} aria-describedby={helpId} onChange={event => updateRow(product.id, current => ({ ...current, allocations: { ...current.allocations, [id]: event.target.value } }))} /><span>units</span></div>
                <button type="button" className="st-icon-button" aria-label={`Remove ${outletName(id)} allocation for ${product.name}`} onClick={() => updateRow(product.id, current => ({ ...current, allocations: Object.fromEntries(Object.entries(current.allocations).filter(([key]) => key !== id)) }))}><X size={14} /></button>
                <small id={helpId} className={showIssue ? 'st-error' : 'st-allocation-help'}>{showIssue ? fieldIssue : capacity === null ? 'Source stock unavailable' : `Up to ${count(capacity)} units after other allocations`}</small>
              </div>; })}
              {destinations.some(id => !(id in row.allocations)) && <label className="st-field st-add-allocation"><span>Add outlet allocation</span><select aria-label={`Add destination allocation for ${product.name}`} value="" onChange={event => { const id = event.target.value; if (id && destinations.includes(id) && !(id in row.allocations)) updateRow(product.id, current => ({ ...current, allocations: { ...current.allocations, [id]: '' } })); }}><option value="">+ Choose outlet</option>{destinations.filter(id => !(id in row.allocations)).map(id => <option key={id} value={id}>{outletName(id)}</option>)}</select></label>}
              </div>
              {warning && <p className="st-error" id={`st-error-${product.id}`} role="alert">{warning}</p>}
              <div className="st-product-balance"><span>Total to transfer <strong data-value="allocated">{quantitiesValid ? `${count(amount)} units` : 'Incomplete'}</strong></span><ArrowRight size={14} aria-hidden="true" /><span>Remaining at {outletName(source)} <strong data-value="remaining" className={available !== null && amount > available ? 'st-error' : ''}>{available === null ? 'Unavailable' : !quantitiesValid ? 'Enter valid quantities' : amount > available ? `${count(amount - available)} units over stock` : `${count(available - amount)} units`}</strong></span></div>
            </div>}
          </article>;
        })}{!loading && !loadError && authorizedSource && !products.length && <div className="st-empty"><Search size={24} /><strong>{!stockableProducts.length ? 'No stockable products in this outlet' : selectedOnly && !rows.length ? 'No products selected' : 'No products match your search'}</strong><p>{!stockableProducts.length ? 'Only products marked Stockable are displayed here.' : selectedOnly && !rows.length ? 'Switch off the Selected filter to browse products.' : 'Try a different name or category, or clear your filters.'}</p><button type="button" className="st-button" onClick={() => { setSearch(''); setCategory(''); setSelectedOnly(false); }}>Show All Products</button></div>}</div>
        {error && <p role="alert" className="st-error">{error}</p>}
      </section>
      {!!rows.length && <div className="st-footer"><div className="st-footer-count"><span className="st-footer-icon"><Package size={19} /></span><div><strong>{rows.length} {rows.length === 1 ? 'product' : 'products'}<span>·</span>{rows.every(row => Object.values(row.allocations).length > 0 && Object.values(row.allocations).every(validQuantity) && Number.isSafeInteger(allocatedQuantity(row))) && Number.isSafeInteger(totalQuantity(rows)) ? `${count(totalQuantity(rows))} units` : 'Quantities incomplete'}</strong><small>{destinations.length} receiving {destinations.length === 1 ? 'outlet' : 'outlets'} · Local preview only</small></div></div><div className="st-footer-actions"><button type="button" className="st-button" onClick={() => setDialog('reset')}>Cancel</button><button type="submit" className="st-button st-primary"><Eye size={16} />Review Transfer<ArrowRight size={16} /></button></div></div>}
    </form>
    {(dialog === 'review' || dialog === 'confirm') && <ActionPopup className="st-dialog" title={dialog === 'review' ? 'Review Transfer' : 'Confirm local preview'} onCancel={() => setDialog(null)} footer={<><button type="button" className="btn-secondary" data-initial-focus onClick={() => setDialog(dialog === 'confirm' ? 'review' : null)}>{dialog === 'confirm' ? 'Back to Review' : 'Cancel'}</button><button type="button" className="st-button st-primary" onClick={() => {
      if (!validate()) { setDialog(null); return; }
      if (dialog === 'review') setDialog('confirm'); else confirmPreview();
    }}>{dialog === 'review' ? 'Continue to Confirmation' : 'Confirm Transfer'}</button></>}>
      <p className="st-demo-caption">{dialog === 'confirm' ? 'Confirm this local preview? No stock will be moved or saved to the server.' : 'Check the outlet quantities below before continuing. Stock values are read from the source outlet. Allocations are a local preview only.'}</p><TransferDetails transfer={currentTransfer} products={stockableProducts} outletName={outletName} />
    </ActionPopup>}
    {dialog === 'done' && <ActionPopup title="Local preview confirmed" onCancel={() => setDialog(null)} footer={<><button type="button" className="btn-secondary" data-initial-focus onClick={() => setDialog(null)}>Done</button>{onViewReport && completedPreview && <button type="button" className="st-button st-primary" onClick={() => { setDialog(null); onViewReport(completedPreview.date); }}>View Stock Transfer Report</button>}</>}><p role="status">Local preview confirmed. No stock was moved or saved to the server.</p>{onPreviewConfirmed && completedPreview && <p>Preview <strong>{completedPreview.reference}</strong> is available in the Stock Transfer Report for this login session.</p>}<p>Your preview allocations remain available for editing. Actual stock values are unchanged.</p></ActionPopup>}
    {dialog === 'reset' && <ActionPopup title="Clear local preview form?" onCancel={() => setDialog(null)} footer={<><button type="button" className="btn-secondary" data-initial-focus onClick={() => setDialog(null)}>Keep Editing</button><button type="button" className="st-button st-primary" onClick={reset}>Clear Transfer</button></>}><p>This clears the current form and its local allocations.</p></ActionPopup>}

  </section>;
}

function TransferDetails({ transfer, products, outletName }: { transfer: DemoTransfer; products: { id: string; name: string; stock: number | null }[]; outletName: (id: string) => string }) {
  return <div className="st-details"><dl><div><dt>From outlet</dt><dd>{outletName(transfer.source)}</dd></div><div><dt>To outlet</dt><dd>{transfer.destinations.map(outletName).join(', ')}</dd></div><div><dt>Day ID</dt><dd>{formatDemoDate(transfer.date)}</dd></div><div><dt>Total quantity</dt><dd>{count(totalQuantity(transfer.rows))} units · {transfer.rows.length} products</dd></div><div><dt>Month ID</dt><dd>{transfer.date.slice(0, 7)}</dd></div><div><dt>Stock type</dt><dd>TRANSFER</dd></div><div><dt>Status</dt><dd>LOCAL PREVIEW</dd></div><div><dt>Request ID / Count</dt><dd>Not assigned</dd></div></dl>
    {transfer.rows.map(row => { const product = products.find(item => item.id === row.productId); if (!product || product.stock === null) return <p key={row.productId}>Product stock is unavailable. Reload before reviewing.</p>; const available = product.stock; return <article key={row.productId}><h4>{product.name}</h4><p>Available: {count(available)} units · Total allocated: {count(allocatedQuantity(row))} units</p><ul>{Object.entries(row.allocations).map(([id, value]) => <li key={id}><span>{outletName(id)}</span><strong>{count(Number(value))} units</strong></li>)}</ul><p>Estimated remaining source stock: <strong>{count(available - allocatedQuantity(row))} units</strong></p></article>; })}
  </div>;
}

