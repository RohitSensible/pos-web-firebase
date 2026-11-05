import { searchRecords } from '../utils/useMobileSearch.ts';
import { markDataLoadingBackground } from '../utils/dataLoading.ts';
import { categoryReferenceMap } from '../../../shared/categoryReferences.ts';
import { ComboDetailsDialog } from './ComboDetailsDialog.tsx';
import { readMasterSnapshot, masterSnapshotRevision } from '../utils/masterSnapshots.ts';
import { useMasterSync } from '../utils/useMasterSync.ts';
import { useRowBatches } from '../utils/useRowBatches.ts';
import { useTimedNotice } from '../utils/useTimedNotice.ts';
import { loadProductList, ProductListRequestError, streamProductList } from './productListApi.ts';
import { DeleteConfirmation } from './DeleteConfirmation.tsx';
import { DeleteAllError, deleteAllRecords } from './deleteAllApi.ts';
import { SuccessPopup } from './SuccessPopup.tsx';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDownUp, Check, ChevronDown, FileSpreadsheet, IndianRupee, ImagePlus, Images, MoreVertical, Package, PackageCheck, Pencil, Percent, ScanBarcode, Search, Trash2, X } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './ProductsPage.css';
import './MobileRecords.css';
import { MobileAddButton } from './MobileAddButton.tsx';
import { BarcodeScanner } from './BarcodeScanner.tsx';
import { AddProductForm } from './AddProductForm.tsx';
import { ProductImageUpload } from './ProductImageUpload.tsx';
import { productImageReference } from './imageApi.ts';
import { ProductImageBatch } from './ProductImageBatch.tsx';
import { ProductImagePinDialog, type ImageAction } from './ProductImagePinDialog.tsx';
import { ProductImageRemoval } from './ProductImageRemoval.tsx';
import { ProductFlagsBulkUpdate } from './ProductFlagsBulkUpdate.tsx';
import { ProductPriceBulkUpdate } from './ProductPriceBulkUpdate.tsx';
import { isProductSort, PRODUCT_SORTS, sortProducts, type ProductSort } from './productSort.ts';
import { ProductExcelDialog } from './ProductExcelDialog.tsx';
import { ProductServicePointAssignment } from './ProductServicePointAssignment.tsx';
import { ProductTaxSettings } from './ProductTaxSettings.tsx';
import { ProductDiscountSettings } from './ProductDiscountSettings.tsx';
import { PremisesPage } from './PremisesPage.tsx';

interface ProductDocument {
  documentId: string;
  fields: Record<string, unknown>;
}

interface ProductCategory {
  id: string;
  name: string;
}

interface ProductsPageProps {
  outlet: OutletSummary;
  token: string;
  onSessionExpired: () => void;
}

const phoneHeaderQuery = 'screen and (max-width: 600px), screen and (max-width: 1024px) and (max-height: 500px)';
const phoneHeaderSnapshot = () => window.matchMedia(phoneHeaderQuery).matches;
function subscribePhoneHeader(onChange: () => void) {
  const query = window.matchMedia(phoneHeaderQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function productText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
}


export function ProductsPage(props: ProductsPageProps) {
  return <ProductsPageContent key={`${props.outlet.id}:${props.token}`} {...props} />;
}

function ProductsPageContent({ outlet, token, onSessionExpired }: ProductsPageProps) {
  const phoneHeader = useSyncExternalStore(subscribePhoneHeader, phoneHeaderSnapshot);
  const [products, setProducts] = useState<ProductDocument[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveReady, setLiveReady] = useState(false);
  // Set while the product stream is still arriving; bulk actions need the full list.
  const [progress, setProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const busyLoading = loading || !!progress;
  const [openMenu, setOpenMenu] = useState<'images' | 'more' | null>(null);
  const headerActions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openMenu) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !headerActions.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [openMenu]);
  const toggleMenu = (menu: 'images' | 'more') => { setSortOpen(false); setOpenMenu(value => value === menu ? null : menu); };
  const sortStorageKey = `products-sort:${outlet.id}`;
  const [sortOpen, setSortOpen] = useState(false);
  // The chosen order is a per-browser convenience; storage may be unavailable.
  const [sort, setSort] = useState<ProductSort>(() => {
    try { const saved = localStorage.getItem(sortStorageKey); return isProductSort(saved) ? saved : 'code'; } catch { return 'code'; }
  });
  const chooseSort = (value: ProductSort) => {
    setSort(value); setSortOpen(false); setOpenMenu(null);
    try { localStorage.setItem(sortStorageKey, value); } catch { /* keep the in-memory choice */ }
  };
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [scanToAddOpen, setScanToAddOpen] = useState(false);
  const [newBarcode, setNewBarcode] = useState<string | undefined>();
  const [pendingImageAction, setPendingImageAction] = useState<ImageAction | null>(null);
  const [imageGrant, setImageGrant] = useState('');
  const requestImageAction = (action: ImageAction) => {
    if (pendingImageAction) return;
    setOpenMenu(null); setImageGrant(''); setPendingImageAction(action);
  };
  const [imageBatchMode, setImageBatchMode] = useState<'bulk' | 'shared' | null>(null);
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [taxOpen, setTaxOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [premisesOpen, setPremisesOpen] = useState(false);
  const [taxSuccess, setTaxSuccess] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [excelOpen, setExcelOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProductDocument | null>(null);
  const [scanEditOnOpen, setScanEditOnOpen] = useState(false);
  const [comboTarget, setComboTarget] = useState<{ documentId: string; name: string } | null>(null);
  const [noticeIsError, setNoticeIsError] = useState(false);
  const [notice, setNotice] = useTimedNotice(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [imageRemovalTargets, setImageRemovalTargets] = useState<ProductDocument[] | null>(null);
  const deleteBusy = useRef(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState('');
  const [deleteAllDone, setDeleteAllDone] = useState(false);
  const [flagsSuccess, setFlagsSuccess] = useState('');
  const deleteAllProducts = async () => {
    if (deleteBusy.current) return;
    deleteBusy.current = true; setDeletingAll(true); setDeleteAllError('');
    try {
      await deleteAllRecords(outlet.id, token, 'products');
      setProducts([]); setCategories([]); setSelectedCategory(null); setDeleteAllOpen(false); setDeleteAllDone(true);
      setReloadKey(value => value + 1);
    } catch (error) {
      if (error instanceof DeleteAllError && error.status === 401) { setDeleteAllOpen(false); onSessionExpired(); return; }
      setDeleteAllError((error as Error).message);
    } finally { deleteBusy.current = false; setDeletingAll(false); }
  };

  useEffect(() => {
    const controller = new AbortController();
    setLiveReady(false);
    async function loadProducts() {
      const base = `/api/outlets/${encodeURIComponent(outlet.id)}`;
      const cachedProducts = readMasterSnapshot<ProductDocument[]>(`${base}/products`, token);
      if (cachedProducts) markDataLoadingBackground(controller.signal);
      const cachedCategories = readMasterSnapshot<ProductCategory[]>(`${base}/categories#metadata`, token);
      const snapshotRevision = masterSnapshotRevision();
      // Objects that came from the server; anything else in the list is a local add or edit.
      const fromServer = new WeakSet<ProductDocument>(cachedProducts ?? []);
      const withLocalChanges = (loaded: ProductDocument[]) => (current: ProductDocument[]) =>
        [...new Map([...loaded, ...current.filter(product => !fromServer.has(product))].map(product => [product.documentId, product])).values()];
      setProducts(cachedProducts ?? []);
      setCategories(cachedCategories ?? []);
      setSelectedCategory(null);
      setLoading(!cachedProducts);
      setProgress(null);
      setError('');
      try {
        const categoriesLoaded = loadProductList<ProductCategory>(`${base}/categories`, token, controller.signal, 'categories', true)
          .then(loaded => { if (!controller.signal.aborted) setCategories(loaded); return loaded; });
        // Without a cached list, show products batch by batch while the rest streams in.
        const [loadedProducts] = await Promise.all([streamProductList<ProductDocument>(`${base}/products`, token, controller.signal, (loaded, total) => {
          if (controller.signal.aborted) return;
          setProgress({ loaded: loaded.length, total });
          if (cachedProducts || !loaded.length) return;
          for (const product of loaded) fromServer.add(product);
          setProducts(withLocalChanges(loaded.slice()));
          setLoading(false);
          markDataLoadingBackground(controller.signal);
        }).then(loaded => {
          if (!controller.signal.aborted) { setLoading(false); markDataLoadingBackground(controller.signal); }
          return loaded;
        }), categoriesLoaded]);
        if (!controller.signal.aborted) {
          if (snapshotRevision !== masterSnapshotRevision()) { setReloadKey(value => value + 1); return; }
          for (const product of loadedProducts) fromServer.add(product);
          setProducts(withLocalChanges(loadedProducts));
          setLiveReady(true);
        }
      } catch (requestError) {
        if (controller.signal.aborted) return;
        if (requestError instanceof ProductListRequestError && requestError.status === 401) { onSessionExpired(); return; }
        setError((requestError as Error).message);
      } finally {
        if (!controller.signal.aborted) { setLoading(false); setProgress(null); }
      }
    }

    void loadProducts();
    return () => controller.abort();
  }, [outlet.id, token, reloadKey, onSessionExpired]);

  useMasterSync(outlet.id, token, 'products', liveReady && !busyLoading && !error && !addOpen && !editTarget && !deleting && !deletingAll
    && !flagsOpen && !pricesOpen && !taxOpen && !discountOpen && !assignmentOpen && !imageBatchMode && !imageRemovalTargets
    && !pendingImageAction && !deleteTarget && !deleteAllOpen && !premisesOpen && !excelOpen && !comboTarget,
  async signal => {
    const revision = masterSnapshotRevision();
    const base = `/api/outlets/${encodeURIComponent(outlet.id)}`;
    try {
      const [freshProducts, freshCategories] = await Promise.all([
        streamProductList<ProductDocument>(`${base}/products`, token, signal, () => {}),
        loadProductList<ProductCategory>(`${base}/categories`, token, signal, 'categories', true),
      ]);
      if (!signal.aborted && revision === masterSnapshotRevision()) {
        setProducts(freshProducts); setCategories(freshCategories);
      }
    } catch (failure) {
      if (!signal.aborted && failure instanceof ProductListRequestError && failure.status === 401) onSessionExpired();
      else throw failure;
    }
  });

  const deleteProduct = async (documentId: string) => {
    if (deleteBusy.current) return;
    deleteBusy.current = true; setDeleting(true); setNotice(''); setNoticeIsError(false);
    try {
      const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/products/${encodeURIComponent(documentId)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) { onSessionExpired(); return; }
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message || 'Unable to delete product.');
      setProducts(current => current.filter(product => product.documentId !== documentId));
      setNotice('Product deleted successfully.');
    } catch (error) { setNoticeIsError(true); setNotice((error as Error).message); }
    finally { deleteBusy.current = false; setDeleting(false); setDeleteTarget(null); }
  };

  const categoryReferences = useMemo(() => categoryReferenceMap(categories), [categories]);
  const categoryProducts = useMemo(() => products.filter(product =>
    selectedCategory === null || (typeof product.fields.category === 'string'
      && categoryReferences.get(product.fields.category) === selectedCategory)
  ), [products, selectedCategory, categoryReferences]);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (phoneHeader) return searchRecords(sortProducts(categoryProducts, sort), search, product => ({ primary: [product.fields.name], text: [product.fields.name, product.fields.regionalName], identifiers: [product.fields.code, product.fields.barcode] }));
    return sortProducts(categoryProducts.filter(product =>
      !query || ['name', 'code', 'regionalName'].some(field =>
        productText(product.fields[field]).toLowerCase().includes(query))), sort);
  }, [categoryProducts, search, sort, phoneHeader]);

  const { rows: renderedProducts, hasMore: hasMoreRows, sentinelRef: moreRowsRef } =
    useRowBatches(visibleProducts, `${selectedCategory ?? ''}\u0000${search}\u0000${sort}`);

  if (imageBatchMode) return <ProductImageBatch key={`${outlet.id}:${imageBatchMode}`} mode={imageBatchMode} products={products} categories={categories}
    outletId={outlet.id} token={token} imageGrant={imageGrant} onSessionExpired={onSessionExpired} onClose={() => { setImageBatchMode(null); setImageGrant(''); }}
    onSaved={(documentId, image) => setProducts(current => current.map(product => product.documentId === documentId
      ? { ...product, fields: { ...product.fields, image } } : product))} />;

  if ((taxOpen || discountOpen || flagsOpen || pricesOpen || assignmentOpen) && (busyLoading || error)) return <section className="products-page-shell" aria-busy={busyLoading}>
    <div className="products-header"><h1>{taxOpen ? 'Tax Settings' : discountOpen ? 'Update Discount' : flagsOpen ? 'Update Stockable & Weighable' : pricesOpen ? 'Update Bulk Price' : 'Assign Service Point'}</h1>
      <button type="button" className="btn-secondary" onClick={() => { setTaxOpen(false); setDiscountOpen(false); setFlagsOpen(false); setPricesOpen(false); setAssignmentOpen(false); }}>Cancel</button></div>
    <div className="products-empty" data-inline-loading={loading || (progress && !error) ? '' : undefined} role={error ? 'alert' : 'status'}>{error || 'Loading products and categories…'}
      {error && <button type="button" className="btn-secondary" onClick={() => setReloadKey(value => value + 1)}>Retry</button>}</div>
  </section>;

  if (premisesOpen) return <PremisesPage outlet={outlet} token={token} onSessionExpired={onSessionExpired}
    onClose={() => setPremisesOpen(false)} />;

  if (discountOpen) return <ProductDiscountSettings products={products} categories={categories} outletId={outlet.id} token={token} onSessionExpired={onSessionExpired}
    onSaved={updated => setProducts(current => current.map(product => product.documentId === updated.documentId ? updated : product))}
    onClose={updatedCount => {
      setDiscountOpen(false);
      if (updatedCount) {
        setNoticeIsError(false);
        setNotice(`Discount updated successfully for ${updatedCount} ${updatedCount === 1 ? 'product' : 'products'}.`);
      }
    }} />;

  if (taxOpen) return <ProductTaxSettings products={products} categories={categories} outletId={outlet.id} token={token} onSessionExpired={onSessionExpired}
    onSaved={updated => setProducts(current => current.map(product => product.documentId === updated.documentId ? updated : product))}
    onClose={updatedCount => {
      setTaxOpen(false);
      if (updatedCount) setTaxSuccess(true);
    }} />;

  if (pricesOpen) return <ProductPriceBulkUpdate key={outlet.id} products={products} outletId={outlet.id} token={token} onSessionExpired={onSessionExpired}
    onSaved={updated => setProducts(current => current.map(product => product.documentId === updated.documentId ? updated : product))}
    onClose={updatedCount => {
      setPricesOpen(false);
      if (updatedCount) {
        setNoticeIsError(false);
        setNotice(`Prices updated successfully for ${updatedCount} ${updatedCount === 1 ? 'product' : 'products'}.`);
        setReloadKey(value => value + 1);
      }
    }} />;

  if (flagsOpen) return <ProductFlagsBulkUpdate key={outlet.id} products={products} outletId={outlet.id} token={token} onSessionExpired={onSessionExpired}
    onSaved={updated => setProducts(current => current.map(product => product.documentId === updated.documentId ? updated : product))}
    onClose={updatedCount => {
      setFlagsOpen(false);
      if (updatedCount) {
        setNoticeIsError(false);
        setFlagsSuccess(`Stockable & Weighable updated successfully for ${updatedCount} ${updatedCount === 1 ? 'product' : 'products'}.`);
      }
    }} />;

  if (editTarget) return <AddProductForm key={`edit-${editTarget.documentId}`} outletId={outlet.id} token={token}
    initialCategory={selectedCategory} product={editTarget} scanBarcodeOnOpen={scanEditOnOpen} onSessionExpired={onSessionExpired}
    onCancel={() => { setEditTarget(null); setScanEditOnOpen(false); }} onCreated={updated => {
      setProducts(current => current.map(product => product.documentId === updated.documentId ? updated : product));
      const imageChanged = productImageReference(updated.fields) !== productImageReference(editTarget.fields);
      setEditTarget(null); setScanEditOnOpen(false); setNoticeIsError(false);
      setNotice(`Product updated successfully.${imageChanged ? productImageReference(updated.fields) ? ' Image uploaded successfully.' : ' Image removed successfully.' : ''}`);
    }} />;

  if (addOpen) return (<AddProductForm key={outlet.id} outletId={outlet.id} token={token} initialCategory={selectedCategory} initialBarcode={newBarcode}
        onSessionExpired={onSessionExpired} onCancel={() => setAddOpen(false)} onCreated={product => {
          setProducts(current => [...current.filter(existing => existing.documentId !== product.documentId), product]);
          setAddOpen(false);
          setNoticeIsError(false);
          setNotice(`Product added successfully.${productImageReference(product.fields) ? ' Image uploaded successfully.' : ''}`);
        }} />
  );

  const categoryFilter = <select className="products-category-filter" aria-label="Filter by category" value={selectedCategory ?? ''}
    onChange={event => setSelectedCategory(event.target.value || null)}>
    <option value="">All Categories</option>
    {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
  </select>;

  return (
    <section className="products-page-shell" aria-label="Products" aria-busy={busyLoading}>
      {scanToAddOpen && <BarcodeScanner onCancel={() => setScanToAddOpen(false)} onUse={value => { setNewBarcode(value); setScanToAddOpen(false); setNotice(''); setAddOpen(true); }} />}
      {assignmentOpen && <ProductServicePointAssignment outletId={outlet.id} token={token} categories={categories} onSessionExpired={onSessionExpired}
        onCancel={() => setAssignmentOpen(false)} onAssigned={result => {
          setProducts(current => current.map(product => product.fields.category === result.categoryId ? { ...product, fields: { ...product.fields, kitchenId: result.servicePointId } } : product));
          setAssignmentOpen(false); setNoticeIsError(false);
          setNotice(`Successfully assigned the service point to ${result.assignedCount} ${result.assignedCount === 1 ? 'product' : 'products'}.`);
        }} />}
      {excelOpen && <ProductExcelDialog outletId={outlet.id} token={token} onSessionExpired={onSessionExpired}
        onCancel={() => setExcelOpen(false)} onComplete={message => { setExcelOpen(false); setNoticeIsError(false); setNotice(message); }} />}
      {pendingImageAction && <ProductImagePinDialog key={`${outlet.id}:${token}:${pendingImageAction}`} outletId={outlet.id} token={token} action={pendingImageAction}
        onSessionExpired={onSessionExpired} onCancel={() => setPendingImageAction(null)} onVerified={grant => {
          const action = pendingImageAction; setPendingImageAction(null); setImageGrant(grant);
          if (action === 'remove') setImageRemovalTargets(products.filter(product => productImageReference(product.fields)));
          else setImageBatchMode(action);
        }} />}
      {imageRemovalTargets && <ProductImageRemoval products={imageRemovalTargets} outletId={outlet.id} outletName={outlet.name} token={token} imageGrant={imageGrant}
        onSessionExpired={onSessionExpired} onRemoved={documentId => setProducts(current => current.map(product => {
          if (product.documentId !== documentId) return product;
          const fields = { ...product.fields }; delete fields.imagePath;
          if (typeof fields.image === 'string') fields.image = null;
          return { ...product, fields };
        }))} onClose={summary => {
          setImageRemovalTargets(null); setImageGrant('');
          if (summary) {
            setNoticeIsError(summary.failed > 0);
            setNotice(summary.failed ? `${summary.removed} product images removed; ${summary.failed} failed. Review the failed products and try again.`
              : '');
          }
        }} />}
      {comboTarget && <ComboDetailsDialog key={comboTarget.documentId} outletId={outlet.id} token={token} product={comboTarget} onSessionExpired={onSessionExpired} onClose={() => setComboTarget(null)} />}
      {deleteAllOpen && <DeleteConfirmation kind="product" name="all products" busy={deletingAll} error={deleteAllError}
        title="Delete all products?"
        onCancel={() => { if (!deleteBusy.current) setDeleteAllOpen(false); }} onConfirm={() => void deleteAllProducts()} />}
      {flagsSuccess && <SuccessPopup message={flagsSuccess} onDismiss={() => setFlagsSuccess('')} />}
      {deleteAllDone && <SuccessPopup message="All products and categories deleted successfully" onDismiss={() => setDeleteAllDone(false)} />}
      {deleteTarget && <DeleteConfirmation kind="product" name={deleteTarget.name} busy={deleting} error={noticeIsError ? notice : ''}
        onCancel={() => { if (!deleteBusy.current) setDeleteTarget(null); }} onConfirm={() => void deleteProduct(deleteTarget.id)} />}
      <div className="products-header">
        <div>
          <h1><Package size={25} />Products</h1>
          <p>Manage your product inventory and details.</p>
        </div>
        <div className="products-header-actions" ref={headerActions}>
          <MobileAddButton label="Add New Product" className="products-add" onClick={() => { setNotice(''); setNewBarcode(undefined); setAddOpen(true); }} />
          <div className="products-menu-anchor products-image-menu">
            <button type="button" className="products-images-toggle" aria-label="Product image options" aria-haspopup="menu" aria-expanded={openMenu === 'images'}
              aria-controls="products-images-menu" onClick={() => toggleMenu('images')}><Images size={15} />Product Images<ChevronDown size={14} className="products-chevron" /></button>
            {openMenu === 'images' && <div id="products-images-menu" className="products-options-menu" role="menu">
              <button type="button" role="menuitem" disabled={busyLoading || !!error} onClick={() => requestImageAction('bulk')}>
                <span className="products-menu-icon"><ImagePlus size={15} /></span>Bulk Upload Images</button>
              <button type="button" role="menuitem" disabled={busyLoading || !!error} onClick={() => requestImageAction('shared')}>
                <span className="products-menu-icon"><Images size={15} /></span>One Image for Multiple Products</button>
              <div className="products-menu-divider" role="separator" />
              <button type="button" role="menuitem" className="danger" disabled={busyLoading || !!error || !products.some(product => productImageReference(product.fields))}
                onClick={() => requestImageAction('remove')}><span className="products-menu-icon"><Trash2 size={15} /></span>Remove all product images</button>
            </div>}
          </div>
          {phoneHeader && categoryFilter}
          <div className="products-menu-anchor">
            <button type="button" className="products-menu-toggle" aria-label="More options" aria-haspopup="menu" aria-expanded={openMenu === 'more'}
              aria-controls="products-more-menu" onClick={() => toggleMenu('more')}><MoreVertical size={17} /></button>
            {openMenu === 'more' && <div id="products-more-menu" className="products-options-menu" role="menu">
              <button type="button" role="menuitem" className="products-sort-toggle" aria-haspopup="menu" aria-expanded={sortOpen}
                aria-controls="products-sort-menu" onClick={() => setSortOpen(value => !value)}>
                <span className="products-menu-icon"><ArrowDownUp size={15} /></span>Sort
                <span className="products-sort-current">{PRODUCT_SORTS.find(option => option.value === sort)!.label}</span>
                <ChevronDown size={14} className="products-chevron" /></button>
              {sortOpen && <div id="products-sort-menu" className="products-sort-menu" role="menu" aria-label="Sort products">
                {PRODUCT_SORTS.map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={sort === option.value}
                  onClick={() => chooseSort(option.value)}>{option.label}{sort === option.value && <Check size={14} className="products-sort-check" />}</button>)}
              </div>}
              <div className="products-menu-divider" role="separator" />
              <button type="button" role="menuitem" onClick={() => { setOpenMenu(null); setNotice(''); setExcelOpen(true); }}>
                <span className="products-menu-icon"><FileSpreadsheet size={15} /></span>Save Excel</button>
              <button type="button" role="menuitem" onClick={() => { setOpenMenu(null); setNotice(''); setFlagsOpen(true); }}>
                <span className="products-menu-icon"><PackageCheck size={15} /></span>Update Stockable &amp; Weighable</button>
              <button type="button" role="menuitem" onClick={() => { setOpenMenu(null); setNotice(''); setPricesOpen(true); }}>
                <span className="products-menu-icon"><IndianRupee size={15} /></span>Update Bulk Price</button>
              <button type="button" role="menuitem" onClick={() => { setOpenMenu(null); setNotice(''); setPremisesOpen(true); }}>
                <span className="products-menu-icon"><Pencil size={15} /></span>Update premise price</button>
              <button type="button" role="menuitem" onClick={() => { setOpenMenu(null); setNotice(''); setAssignmentOpen(true); }}>
                <span className="products-menu-icon"><PackageCheck size={15} /></span>Assign Service Point</button>
              <button type="button" role="menuitem" onClick={() => { setOpenMenu(null); setNotice(''); setTaxSuccess(false); setTaxOpen(true); }}>
                <span className="products-menu-icon"><PackageCheck size={15} /></span>Tax</button>
              <button type="button" role="menuitem" onClick={() => { setOpenMenu(null); setNotice(''); setDiscountOpen(true); }}>
                <span className="products-menu-icon"><Percent size={15} /></span>Update Discount</button>
              <div className="products-menu-divider" role="separator" />
              <button type="button" role="menuitem" className="danger" disabled={busyLoading || !!error || (!products.length && !categories.length)}
                onClick={() => { setOpenMenu(null); setNotice(''); setDeleteAllError(''); setDeleteAllOpen(true); }}>
                <span className="products-menu-icon"><Trash2 size={15} /></span>Delete All</button>
            </div>}
          </div>
        </div>
      </div>
      {notice && noticeIsError && <div className="products-feedback">
        <p className="category-form-error" role="alert">{notice}</p>
        <button type="button" className="products-feedback-close" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} aria-hidden="true" /></button>
      </div>}
      {notice && !noticeIsError && <SuccessPopup message={notice} onDismiss={() => setNotice('')} />}
      {taxSuccess && <SuccessPopup message="Updated successfully." onDismiss={() => setTaxSuccess(false)} />}
      <nav className="products-category-tabs" aria-label="Product categories">
        <button type="button" className={selectedCategory === null ? 'selected' : ''}
          aria-pressed={selectedCategory === null} onClick={() => setSelectedCategory(null)}>All</button>
        {categories.map(category => (
          <button type="button" key={category.id} className={selectedCategory === category.id ? 'selected' : ''}
            aria-pressed={selectedCategory === category.id} onClick={() => setSelectedCategory(category.id)}>
            {category.name}
          </button>
        ))}
      </nav>
      <div className="products-toolbar">
        <label className="products-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="Search products" placeholder="Search product name, code, regional name…"
            value={search} onChange={event => setSearch(event.target.value)} />
        </label>
        <article className="products-summary-card">
          <span className="products-summary-icon items"><Package size={20} aria-hidden="true" /></span>
          <div><span className="products-summary-label">Total Products</span><strong aria-live="polite">{loading || error ? '—' : categoryProducts.length}</strong></div>
          <button type="button" className="products-scan-add" aria-label="Scan barcode to add product" disabled={busyLoading || !!error} onClick={() => setScanToAddOpen(true)}><ScanBarcode size={18} aria-hidden="true" />Scan to add</button>
        </article>
        {!phoneHeader && categoryFilter}
      </div>
      {loading || error || visibleProducts.length === 0 ? (
        <div className="products-empty" data-inline-loading={loading || (progress && !error) ? '' : undefined} role={error ? 'alert' : 'status'}>
          {loading || (progress && !error) ? 'Loading products…' : error || (products.length ? 'No products in this category.' : 'No products found for this outlet.')}
          {error && <button type="button" className="products-refresh" onClick={() => setReloadKey(value => value + 1)}>Retry</button>}
        </div>
      ) : (
        <div className="products-table-card" role="region" aria-label="Product list" tabIndex={0}>
          <table className="products-table mobile-record-table">
            <thead><tr><th>Code</th><th>Product Name</th><th>Regional Name</th><th>Sale Price</th><th>Image Preview</th><th className="products-actions-heading">Actions</th></tr></thead>
            <tbody>
              {renderedProducts.map(product => (
                <tr key={product.documentId}>
                  <td data-label="Code"><span className="products-code">{productText(product.fields.code)}</span></td>
                  <td data-label="Product" className="products-name mobile-record-name">{product.fields.type === 2 ? <button type="button" className="products-combo-link" aria-label={`View products in ${productText(product.fields.name)}`}
                    onClick={event => { event.currentTarget.focus(); setComboTarget({ documentId: product.documentId, name: productText(product.fields.name) }); }}>{productText(product.fields.name)}<small>View items</small></button> : productText(product.fields.name)}
                    <button type="button" className="products-card-scan" disabled={deleting} aria-label={`Scan barcode for ${productText(product.fields.name)}`} title="Scan barcode"
                      onClick={() => { setNotice(''); setScanEditOnOpen(true); setEditTarget(product); }}><ScanBarcode size={20} aria-hidden="true" /></button>
                  </td>
                  <td data-label="Regional name">{productText(product.fields.regionalName) || '—'}</td>
                  <td data-label="Sale price"><span className="products-price"><Package size={15} />₹ {productText(product.fields.price)}</span></td>
                  <td data-label="Image"><ProductImageUpload name={productText(product.fields.name)} outletId={outlet.id} documentId={product.documentId}
                    image={productImageReference(product.fields)} token={token} paused={!!pendingImageAction} onSessionExpired={onSessionExpired}
                    onUploadStart={() => setNotice('')}
                    onSaved={image => {
                      setNoticeIsError(false); setNotice('Image uploaded successfully.');
                      setProducts(current => current.map(item => {
                        if (item.documentId !== product.documentId) return item;
                        const fields: Record<string, unknown> = { ...item.fields, image }; delete fields.imagePath;
                        return { ...item, fields };
                      }));
                    }} /></td>
                  <td className="mobile-record-actions"><div className="products-row-actions">
                    <button type="button" data-mobile-label="Edit" disabled={deleting} aria-label="Edit product" title="Edit product" onClick={() => { setNotice(''); setScanEditOnOpen(false); setEditTarget(product); }}><Pencil size={14} /></button>
                    <button type="button" data-mobile-label="Delete" disabled={deleting} aria-label="Delete product" title="Delete product" onClick={() => setDeleteTarget({ id: product.documentId, name: productText(product.fields.name) })}><Trash2 size={14} /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMoreRows && <div ref={moreRowsRef} className="products-more-rows" role="status">Showing {renderedProducts.length} of {visibleProducts.length} products…</div>}
        </div>
      )}
    </section>
  );
}
