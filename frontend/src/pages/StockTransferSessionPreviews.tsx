import { useMobileSearch, searchRecords } from '../utils/useMobileSearch.ts';
import { useState } from 'react';
import { Eye, FlaskConical } from 'lucide-react';
import { ActionPopup } from './ActionPopup.tsx';
import { useWorkspaceBack } from '../utils/useWorkspaceBack.ts';
import { formatDemoDate } from './stockTransferDemo.ts';
import { matchesPreview, previewQuantity, type StockTransferPreview } from './stockTransferPreviews.ts';

const quantity = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 3 });
export function StockTransferSessionPreviews({ previews, startDate, endDate, search }: {
  previews: StockTransferPreview[]; startDate: string; endDate: string; search: string;
}) {
  const mobileSearch = useMobileSearch();
  const [selected, setSelected] = useState<StockTransferPreview | null>(null);
  useWorkspaceBack(!!selected, () => setSelected(null));
  if (!previews.length) return null;
  const datedPreviews = previews.filter(preview => matchesPreview(preview, startDate, endDate, mobileSearch ? '' : search)).toSorted((a, b) => b.createdAt - a.createdAt);
  const filtered = mobileSearch ? searchRecords(datedPreviews, search, preview => ({ text: [preview.source.name, preview.note, ...preview.destinations.map(outlet => outlet.name), ...preview.products.map(product => product.name)], identifiers: [preview.reference, preview.source.id, ...preview.destinations.map(outlet => outlet.id), ...preview.products.flatMap(product => [product.id, product.code])] })) : datedPreviews;
  return <section className="stock-transfer-session-previews" aria-labelledby="session-previews-title">
    <header><div><h2 id="session-previews-title"><FlaskConical size={18} aria-hidden="true" />Session Previews <span className="transfer-preview-label">Not saved</span></h2><p>Local to this login session · across outlets used in your previews. Previews do not save database records or move stock. Reloading or signing out clears them.</p></div><span className="transfer-preview-label">{filtered.length} of {previews.length} previews</span></header>
    <p className="session-preview-help">Applied dates match the transfer date. Search matches preview reference, source / destination outlet, product name / code or note. The selected report outlet does not restrict previews. Excluded from saved-record totals, Excel and Print / PDF.</p>
    <div className="session-preview-scroll" tabIndex={0} role="region" aria-label="Session transfer previews"><table className="mobile-report-table"><thead><tr><th>Preview reference</th><th>Transfer date</th><th>Source outlet</th><th>Destination outlets</th><th>Products</th><th>Preview quantity</th><th>Status</th><th>Action</th></tr></thead><tbody>{filtered.map(preview => <tr key={preview.id}><td data-label="Preview reference" data-mobile-primary="true"><strong>{preview.reference}</strong></td><td data-label="Transfer date">{formatDemoDate(preview.date)}</td><td data-label="Source outlet">{preview.source.name}</td><td data-label="Destination outlets">{preview.destinations.map(outlet => outlet.name).join(', ')}</td><td data-label="Products">{preview.products.length}</td><td data-label="Preview quantity">{quantity(previewQuantity(preview))} units</td><td data-label="Status"><span className="transfer-preview-label">Preview only</span></td><td data-label="Action"><button type="button" aria-label={`View preview ${preview.reference}`} onClick={() => setSelected(preview)}><Eye size={14} />View Details</button></td></tr>)}</tbody></table>{!filtered.length && <div role="status"><p className="session-preview-empty">No session previews match the current date and search filters.</p><p className="session-preview-empty-help">Your {previews.length} {previews.length === 1 ? 'preview is' : 'previews are'} still in this session. Widen the dates and choose Apply, or clear the search. Reset returns to today.</p></div>}</div>
    {selected && <ActionPopup className="stock-transfer-preview-dialog" title={`Transfer preview · ${selected.reference}`} onCancel={() => setSelected(null)} footer={<button type="button" className="btn-secondary" data-initial-focus onClick={() => setSelected(null)}>Close Preview</button>}>
      <p className="session-preview-help">Preview only · This record exists in memory for the current login session. Stock and database records are unchanged. Reloading or signing out clears this preview; it is excluded from saved totals, Excel and Print / PDF.</p>
      <dl className="session-preview-meta"><div><dt>Source</dt><dd>{selected.source.name}</dd></div><div><dt>Destinations</dt><dd>{selected.destinations.map(outlet => outlet.name).join(', ')}</dd></div><div><dt>Transfer date</dt><dd>{formatDemoDate(selected.date)}</dd></div><div><dt>Preview quantity</dt><dd>{quantity(previewQuantity(selected))} units</dd></div><div><dt>Note</dt><dd>{selected.note.trim() || 'No note provided'}</dd></div></dl>
      {selected.products.map(product => {
        const total = product.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
        return <article className="session-preview-product" key={product.id}><h4>{product.name}</h4><p>Source available stock at preview: {quantity(product.availableStock)} units</p><ul>{product.allocations.map(allocation => <li key={allocation.outletId}><span>{allocation.outletName}</span><strong>{quantity(allocation.quantity)} units</strong></li>)}</ul><p>Total allocated: <strong>{quantity(total)} units</strong> · Estimated remaining: <strong>{quantity(product.availableStock - total)} units</strong></p></article>;
      })}
    </ActionPopup>}
  </section>;
}
