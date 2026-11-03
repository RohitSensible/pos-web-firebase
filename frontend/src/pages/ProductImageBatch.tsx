import { useDataLoading } from '../utils/useDataLoading.ts';
import { useActionConfirmation } from '../utils/useActionConfirmation.tsx';
import { SuccessPopup } from './SuccessPopup.tsx';
import { ActionConfirmation } from './ActionPopup.tsx';
import { useWorkspaceBack } from '../utils/useWorkspaceBack.ts';
import { useEffect, useRef, useState } from 'react';
import { createRequestId } from '../utils/requestId.ts';
import { ProductImageCropper } from './ProductImageCropper.tsx';
import { ProductCategoryPicker, type PickerCategory } from './ProductCategoryPicker.tsx';
import { decodeProductImage, processProductImage } from './productImageProcessing.ts';
import { assignProductImage } from './productImageAssignmentApi.ts';
import { conflictingProducts, imageCandidates, imageTarget, MAX_BATCH_IMAGES, needsReplacement, normalizedImageName,
  readImageZip, runImageWorkers, type ImageProduct, type ImageResult, type ImageTarget } from './productImageBatch.ts';
import './ProductImageBatch.css';
import './CategoryPage.css';

interface Row {
  id: string; original: File; processed: File | null; included: boolean; targets: string[]; confirmed: string[];
  status: 'preparing' | 'ready' | 'uploading' | 'complete' | 'failed'; error: string; warning: string;
  requestId: string; approved?: ImageTarget[]; results: ImageResult[];
}

function ProcessedPreview({ file }: { file: File }) {
  const preview = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const value = URL.createObjectURL(file);
    if (preview.current) preview.current.src = value;
    return () => URL.revokeObjectURL(value);
  }, [file]);
  return <img ref={preview} className="batch-image-preview" alt="Processed upload preview" />;
}

const productName = (product: ImageProduct) => String(product.fields.name ?? 'Unnamed product');
const productLabel = (product: ImageProduct) => `${productName(product)}${product.fields.code === undefined ? '' : ` · Code ${String(product.fields.code)}`}`;
const statusLabel = (status: Row['status'] | ImageResult['status']) => ({ preparing: 'Preparing', ready: 'Ready', uploading: 'Uploading', complete: 'Complete', failed: 'Failed', saved: 'Complete', unchanged: 'Complete' })[status];

export function ProductImageBatch({ mode, products, categories = [], outletId, token, imageGrant, onClose, onSaved, onSessionExpired }: {
  mode: 'bulk' | 'shared'; products: ImageProduct[]; categories?: PickerCategory[]; outletId: string; token: string; imageGrant: string;
  onClose: () => void; onSaved: (documentId: string, image: string) => void; onSessionExpired: () => void;
}) {
  const { confirmAction, confirmation: actionConfirmation } = useActionConfirmation();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  useDataLoading(loading, 'Product Images');
  const [running, setRunning] = useState(false);
  useWorkspaceBack(true, () => { if (!running && !loading) onClose(); });
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [cropId, setCropId] = useState<string | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const alive = useRef(true), busy = useRef(false);
  const confirmation = useRef<HTMLParagraphElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const update = (id: string, patch: Partial<Row>) => {
    if (alive.current) {
      setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row));
      if (patch.status === 'failed' || patch.targets?.length === 0) setReviewOpen(true);
    }
  };
  const load = async (file?: File) => {
    if (!file || busy.current) return;
    busy.current = true; setLoading(true); setError(''); setRows([]);
    try {
      const files = mode === 'bulk' ? await readImageZip(file) : [file];
      if (!alive.current) return;
      const counts = new Map<string, number>();
      files.forEach(item => { const name = normalizedImageName(item.name); counts.set(name, (counts.get(name) ?? 0) + 1); });
      const prepared: Row[] = files.map(original => {
        const candidates = imageCandidates(original.name, products);
        const duplicate = counts.get(normalizedImageName(original.name))! > 1;
        return { id: createRequestId(), original, processed: null, included: true,
          targets: !duplicate && candidates.length === 1 ? [candidates[0]!.documentId] : [], confirmed: [], status: 'preparing', error: '',
          warning: duplicate ? 'Duplicate filename: choose a product manually or exclude this image.'
            : candidates.length > 1 ? 'Ambiguous name: choose a product explicitly.' : candidates.length === 0 ? 'No exact match: choose products manually.' : '',
          requestId: createRequestId(), results: [] };
      });
      setRows(prepared);
      setReviewOpen(mode === 'shared' || prepared.some(row => row.warning || row.targets.some(id => products.some(product => product.documentId === id && needsReplacement(product)))));
      // Decode one source at a time; retain only the original files and small output blobs.
      for (const row of prepared) {
        if (!alive.current) return;
        let bitmap: ImageBitmap | undefined;
        try {
          bitmap = await decodeProductImage(row.original);
          const processed = await processProductImage(bitmap, { x: 0, y: 0, size: Math.max(bitmap.width, bitmap.height), width: bitmap.width, height: bitmap.height }, row.original);
          update(row.id, { processed, status: 'ready' });
        } catch (reason) { update(row.id, { status: 'failed', error: (reason as Error).message }); }
        finally { bitmap?.close(); }
      }
    } catch (reason) { if (alive.current) setError((reason as Error).message); }
    finally { busy.current = false; if (alive.current) setLoading(false); }
  };
  const conflicts = conflictingProducts(rows);
  // Products that already have an image and whose replacement is not yet confirmed.
  const unconfirmedReplacements = (row: Row) => row.targets.filter(id => !row.confirmed.includes(id)
    && products.some(product => product.documentId === id && needsReplacement(product)));
  const blocked = (row: Row, list: Row[]) => !row.processed || !row.targets.length
    || row.targets.some(id => conflictingProducts(list).has(id) || !products.some(product => product.documentId === id));
  const unresolvedIn = (list: Row[]) => list.filter(row => row.included && !row.approved
    && (blocked(row, list) || unconfirmedReplacements(row).length > 0));
  const unresolved = unresolvedIn(rows);
  // Bulk uploads confirm every replacement at once from the Upload Images dialog.
  const blocking = rows.filter(row => row.included && !row.approved && blocked(row, rows));
  const pendingReplacements = rows.filter(row => row.included && !row.approved).flatMap(unconfirmedReplacements);
  const run = async (onlyId?: string, onlyProductId?: string, source = rows) => {
    if (busy.current || unresolvedIn(source).length) return;
    const pending = source.filter(row => row.included && row.processed && row.status !== 'complete' && (!onlyId || onlyId === row.id));
    if (!pending.length) return;
    busy.current = true; setRunning(true); setError('');
    await runImageWorkers(pending, async row => {
      if (!alive.current) return;
      const approved = row.approved ?? row.targets.map(id => imageTarget(products.find(product => product.documentId === id)!, row.confirmed.includes(id)));
      const targets = approved.filter(target => (!onlyProductId || onlyProductId === target.documentId)
        && !row.results.some(result => result.documentId === target.documentId && result.status !== 'failed'));
      update(row.id, { approved, status: 'uploading', error: '' });
      try {
        const data = await assignProductImage(outletId, token, row.requestId, row.processed!, targets, imageGrant);
        if (!alive.current) return;
        const results = [...row.results.filter(result => !targets.some(target => target.documentId === result.documentId)), ...data.results];
        for (const result of data.results) if (result.status !== 'failed') onSaved(result.documentId, data.image);
        update(row.id, { results, status: results.some(result => result.status === 'failed') ? 'failed' : 'complete' });
      } catch (reason) {
        if ((reason as { status?: number }).status === 401) onSessionExpired();
        update(row.id, { status: 'failed', error: (reason as Error).message });
      }
    });
    busy.current = false; if (alive.current) setRunning(false);
  };
  const crop = rows.find(row => row.id === cropId);
  const successes = rows.flatMap(row => row.results).filter(result => result.status !== 'failed').length;
  const failures = rows.reduce((count, row) => count + (row.error && row.approved
    ? row.approved.filter(target => !row.results.some(result => result.documentId === target.documentId && result.status !== 'failed')).length
    : row.results.filter(result => result.status === 'failed').length), 0);
  const uploadFinished = !running && rows.some(row => row.approved) && !rows.some(row => row.status === 'uploading');
  const allSucceeded = rows.filter(row => row.included).every(row => row.status === 'complete');
  useEffect(() => {
    if (uploadFinished) {
      confirmation.current?.scrollIntoView({ block: 'nearest' });
      confirmation.current?.focus({ preventScroll: true });
    }
  }, [uploadFinished, successes, failures]);
  const entries = rows.filter(row => row.included).flatMap(row => (row.targets.length ? row.targets : ['']).map(documentId => ({
    row, documentId, product: products.find(product => product.documentId === documentId),
  })));
  const canUpload = !loading && !running && !(mode === 'bulk' ? blocking : unresolved).length
    && rows.some(row => row.included && row.status !== 'complete');
  const upload = async () => {
    if (!rows.length) { fileInput.current?.click(); return; }
    if (mode === 'bulk' && pendingReplacements.length) { setReplaceOpen(true); return; }
    if (!await confirmAction('add', 'product images')) return;
    void run();
  };
  const confirmReplacements = () => {
    const next = rows.map(row => row.included && !row.approved
      ? { ...row, confirmed: [...new Set([...row.confirmed, ...unconfirmedReplacements(row)])] } : row);
    setRows(next); setReplaceOpen(false); void run(undefined, undefined, next);
  };
  const chooseAnother = mode === 'bulk' ? 'Choose another ZIP' : 'Choose another image';
  return <section className="products-page-shell product-image-batch" aria-label={mode === 'bulk' ? 'Bulk Upload Images' : 'One Image for Multiple Products'}>
    {actionConfirmation}
    <div className="products-header batch-header"><h1>Product Images</h1>
      <div className="batch-header-actions">
        <button type="button" className="btn-primary-add batch-upload" disabled={loading || running || (rows.length > 0 && !canUpload)}
          onClick={upload}>Upload Images</button>
        {rows.length > 0 && <button type="button" className="btn-secondary batch-choose" disabled={loading || running}
          onClick={() => fileInput.current?.click()}>{chooseAnother}</button>}
        <span className="batch-image-count" aria-label="Total product images">{entries.length} {entries.length === 1 ? 'image' : 'images'}</span>
      </div>
    </div>
    <input ref={fileInput} hidden type="file" aria-label={mode === 'bulk' ? 'Choose image ZIP' : 'Choose shared image'}
      accept={mode === 'bulk' ? '.zip,application/zip' : 'image/jpeg,image/png,image/webp'} disabled={loading || running}
      onChange={event => { void load(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
    {!rows.length && !loading && <p className="batch-empty">{mode === 'bulk' ? 'Choose a ZIP of JPEG, PNG or WebP images.' : 'Choose an image to share with your products.'}</p>}
    {loading && <p role="status" data-inline-loading>Reading and preparing images…</p>}
    {error && <p className="local-image-error" role="alert">{error}</p>}
    {rows.length > 0 && <>
      <div className="products-table-card batch-image-list"><table className="products-table batch-image-table" aria-label="Product images">
        <thead><tr><th>Image</th><th>Product Name</th><th>Status</th><th className="products-actions-heading">Actions</th></tr></thead>
        <tbody>{entries.map(({ row, documentId, product }) => {
          const result = row.results.find(result => result.documentId === documentId);
          const failure = result?.status === 'failed' ? result.message : row.status === 'failed' ? row.error : '';
          return <tr key={`${row.id}:${documentId}`} data-filename={row.original.name}>
            <td>{row.processed ? <ProcessedPreview file={row.processed} /> : <span className="batch-preview-pending">—</span>}</td>
            <td className="products-name">{mode === 'bulk' && !row.approved
              ? <select className="batch-product-select" aria-label={`Product for ${row.original.name}`} disabled={running} value={row.targets[0] ?? ''}
                onChange={event => update(row.id, { targets: event.target.value ? [event.target.value] : [], confirmed: [] })}>
                <option value="">Choose a product…</option>
                {products.map(product => <option key={product.documentId} value={product.documentId}>{productLabel(product)}</option>)}
              </select>
              : product ? productName(product) : 'Select a product'}
              {mode === 'bulk' && !row.approved && !row.targets.length && row.warning && <small className="batch-row-note">{row.warning}</small>}
              {mode === 'bulk' && conflicts.has(documentId) && <small className="batch-row-error">Multiple images target this product. Remove an image or choose another product.</small>}
              {mode === 'bulk' && !row.approved && product && needsReplacement(product) && <small className="batch-row-note">Replaces the current image</small>}
            </td>
            <td><span className={`batch-status ${result?.status ?? row.status}`} role="status">{statusLabel(result?.status ?? row.status)}</span>
              {mode === 'bulk' && failure && <small className="batch-row-error" role="alert">{failure}</small>}</td>
            <td><div className="batch-row-actions">
              {mode === 'bulk' && row.approved && row.status === 'failed'
                ? <button type="button" className="btn-secondary" aria-label={`Retry failed assignments for ${row.original.name}`} disabled={running} onClick={() => void run(row.id)}>Retry</button>
                : <button type="button" className="btn-secondary" disabled={loading || running || !!row.approved || !row.processed} onClick={() => setCropId(row.id)}>Crop / Adjust</button>}
              <button type="button" className="btn-secondary" disabled={running || !!row.approved || (mode === 'shared' && !documentId)}
                onClick={() => update(row.id, mode === 'bulk' ? { included: false }
                  : { targets: row.targets.filter(target => target !== documentId), confirmed: row.confirmed.filter(target => target !== documentId) })}>Remove</button>
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>
      {mode === 'bulk' && <p className="batch-review-help">Choose the product for each image. ZIPs support up to 50 images (25 MB ZIP, 100 MB expanded).</p>}
      {mode === 'shared' && <details className="batch-assignment-review" open={reviewOpen} onToggle={event => setReviewOpen(event.currentTarget.open)}>
        <summary>Review assignments{unresolved.length > 0 ? ' · Action required' : ''}</summary>
        <div className="batch-review-toolbar">
          <label>Search products<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
        </div>
        <p className="batch-review-help">Select up to 50 products and approve any replacements.</p>
        {rows.map(row => <div key={row.id} className="batch-assignment-item" data-filename={row.original.name}>
          <label className="batch-include"><input type="checkbox" checked={row.included} disabled={running || !!row.approved} onChange={event => update(row.id, { included: event.target.checked })} />Include {row.original.name}</label>
          {row.warning && <p className="batch-review-warning">{row.warning}</p>}
          {!row.approved && <ProductCategoryPicker products={products} categories={categories} selected={row.targets} max={MAX_BATCH_IMAGES}
            search={search} disabled={running} outletId={outletId} token={token} onSessionExpired={onSessionExpired}
            onChange={targets => update(row.id, { targets, confirmed: row.confirmed.filter(id => targets.includes(id)) })} />}
          <ul className="batch-replacement-approvals">{row.targets.filter(id => conflicts.has(id) || (!row.approved && products.some(product => product.documentId === id && needsReplacement(product)))).map(id => {
            const product = products.find(value => value.documentId === id);
            return <li key={id}>
              {conflicts.has(id) && <p className="local-image-error">Multiple images target this product. Exclude an image or change its target.</p>}
              {product && needsReplacement(product) && !row.approved && <label><input type="checkbox" checked={row.confirmed.includes(id)} disabled={running}
                onChange={event => update(row.id, { confirmed: event.target.checked ? [...row.confirmed, id] : row.confirmed.filter(target => target !== id) })} />Confirm replacement for {productName(product)}</label>}
            </li>;
          })}</ul>
          {row.error && <p className="local-image-error" role="alert">{row.error}</p>}
          {row.status === 'failed' && <p className="local-image-error">Failed</p>}
          {row.results.filter(result => result.status === 'failed').map(result => <div key={result.documentId} className="batch-failed-result">
            <p role="alert">{products.some(product => product.documentId === result.documentId) ? productName(products.find(product => product.documentId === result.documentId)!) : 'Product unavailable'}: {result.message}</p>
            <button type="button" className="btn-secondary" disabled={running || !!unresolved.length}
              onClick={() => void run(row.id, result.documentId)}>Retry {products.find(product => product.documentId === result.documentId) ? productName(products.find(product => product.documentId === result.documentId)!) : 'product'}</button>
          </div>)}
          {row.approved && row.status === 'failed' && <button type="button" className="btn-secondary" disabled={running || !!unresolved.length} onClick={() => void run(row.id)}>Retry failed assignments for {row.original.name}</button>}
        </div>)}
      </details>}
      {uploadFinished && !allSucceeded && <p ref={confirmation} tabIndex={-1} className="category-form-error" role="alert">Some images could not be uploaded. Review the failed items and retry.</p>}
    </>}
    <button type="button" className="btn-secondary batch-back" disabled={running || loading} onClick={onClose}>Back to Products</button>
    {uploadFinished && allSucceeded && successes > 0 && <UploadSuccessDialog count={successes} onClose={onClose} />}
    {replaceOpen && <ReplaceImagesDialog count={pendingReplacements.length} onCancel={() => setReplaceOpen(false)} onConfirm={confirmReplacements} />}
    {crop && <ProductImageCropper file={crop.original} onCancel={() => setCropId(null)} onApply={file => {
      update(crop.id, { processed: file, error: '', status: 'ready', requestId: createRequestId() }); setCropId(null);
    }} />}
  </section>;
}

function ReplaceImagesDialog({ count, onCancel, onConfirm }: { count: number; onCancel: () => void; onConfirm: () => void }) {
  return <ActionConfirmation action="replace" item={`${count} product ${count === 1 ? 'image' : 'images'}`} onCancel={onCancel} onConfirm={onConfirm} confirmLabel="Replace and Upload" />;
}

function UploadSuccessDialog({ count, onClose }: { count: number; onClose: () => void }) {
  return <SuccessPopup message={`Images uploaded successfully for ${count} products.`} onDismiss={onClose} />;
}
