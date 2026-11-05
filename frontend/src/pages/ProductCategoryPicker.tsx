import { useMobileSearch, searchRecords, rankSearchResults } from '../utils/useMobileSearch.ts';
import { useId, useState } from 'react';
import { categoryReferenceMap } from '../../../shared/categoryReferences.ts';
import { Check, ChevronDown, Image as ImageIcon } from 'lucide-react';
import { AuthenticatedImagePreview } from './AuthenticatedImagePreview.tsx';
import { masterImageUrl, productImageReference } from './imageApi.ts';
import { needsReplacement, type ImageProduct } from './productImageBatch.ts';
import './ProductCategoryPicker.css';

export interface PickerCategory { id: string; name: string }

const UNCATEGORIZED = '__uncategorized__';
const DOT_COLORS = ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6'];
const productName = (product: ImageProduct) => String(product.fields.name ?? 'Unnamed product');
const priceLabel = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  ? `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '';

// Category-wise product selection for the "One Image for Multiple Products" screen.
// Selection stays a flat list of product IDs; categories only group and bulk-toggle it.
export function ProductCategoryPicker({ products, categories, selected, max, search, disabled, outletId, token, onSessionExpired, onChange }: {
  products: ImageProduct[]; categories: PickerCategory[]; selected: string[]; max: number; search: string; disabled: boolean;
  outletId: string; token: string; onSessionExpired: () => void; onChange: (selected: string[]) => void;
}) {
  const mobileSearch = useMobileSearch();
  const instanceId = useId();
  const query = search.trim().toLowerCase();
  const categoryGroups = new Map(categories.map((category, index) => [category.id, {
    id: category.id, name: category.name || 'Unnamed category', color: DOT_COLORS[index % DOT_COLORS.length]!, items: [] as ImageProduct[],
  }]));
  const uncategorized = { id: UNCATEGORIZED, name: 'Uncategorized', color: DOT_COLORS[categories.length % DOT_COLORS.length]!, items: [] as ImageProduct[] };
  const categoryReferences = categoryReferenceMap(categories);
  for (const product of products) {
    const categoryId = typeof product.fields.category === 'string' ? categoryReferences.get(product.fields.category) : undefined;
    const group = categoryId ? categoryGroups.get(categoryId) : undefined;
    (group ?? uncategorized).items.push(product);
  }
  const groups = [...categoryGroups.values(), uncategorized].filter(group => group.items.length > 0);
  const matches = (item: ImageProduct) => `${productName(item)} ${String(item.fields.code ?? '')}`.toLowerCase().includes(query);
  const productFields = (item: ImageProduct) => ({ text: [productName(item)], identifiers: [item.fields.code] });
  const matchingGroups = groups.map(group => ({ ...group, visible: mobileSearch ? searchRecords(group.items, search, productFields) : query ? group.items.filter(matches) : group.items }))
    .filter(group => group.visible.length > 0);
  const visibleGroups = mobileSearch ? rankSearchResults(matchingGroups, search, group => ({ text: group.visible.flatMap(item => productFields(item).text), identifiers: group.visible.flatMap(item => productFields(item).identifiers) })) : matchingGroups;
  // Open the categories that already hold a selection; the rest start collapsed.
  const [open, setOpen] = useState(() => new Set(groups.filter(group => group.items.some(item => selected.includes(item.documentId))).map(group => group.id)));
  const [notice, setNotice] = useState('');
  const chosen = new Set(selected);

  const toggleCategory = (items: ImageProduct[], checked: boolean) => {
    if (disabled) return;
    const ids = new Set(items.map(item => item.documentId));
    const current = [...chosen];
    if (!checked) { setNotice(''); onChange(current.filter(value => !ids.has(value))); return; }
    const additions = [...ids].filter(id => !chosen.has(id));
    const room = Math.max(0, max - chosen.size);
    setNotice(additions.length > room ? `Only ${max} products can share one image. ${room} more ${room === 1 ? 'was' : 'were'} selected.` : '');
    onChange([...current, ...additions.slice(0, room)]);
  };
  const toggleProduct = (product: ImageProduct, checked: boolean) => toggleCategory([product], checked);

  return <div className="batch-product-choices category-picker" aria-label="Available products">
    {notice && <p className="category-picker-notice" role="status">{notice}</p>}
    {!visibleGroups.length && <p className="category-picker-notice" role="status">{query ? 'No products match your search. Try a different name or code.' : 'No products available.'}</p>}
    {visibleGroups.map((group, index) => {
      const { visible } = group;
      const count = visible.filter(item => chosen.has(item.documentId)).length;
      const all = count === visible.length, some = count > 0 && !all;
      const expanded = !!query || groups.length === 1 || open.has(group.id);
      const bodyId = `${instanceId}-category-picker-${index}`;
      return <section key={group.id} className="category-picker-card">
        <header className="category-picker-header">
          <input type="checkbox" value={`category:${group.id}`} aria-label={`Select all ${query ? 'matching ' : ''}products in ${group.name}`} checked={all}
            ref={node => { if (node) node.indeterminate = some; }}
            disabled={disabled}
            onChange={event => toggleCategory(visible, event.target.checked)} />
          <button type="button" className="category-picker-toggle" aria-expanded={expanded} aria-controls={bodyId} disabled={disabled}
            onClick={() => { if (disabled) return; setOpen(current => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; }); }}>
            <span className="category-picker-dot" style={{ background: group.color }} aria-hidden="true" />
            <span className="category-picker-name">{group.name}</span>
            <span className="category-picker-count">{visible.length} {query ? (visible.length === 1 ? 'match' : 'matches') : (visible.length === 1 ? 'item' : 'items')}</span>
            <span className={`category-picker-pill${count ? ' active' : ''}`}>{count} {query ? 'Matching Selected' : 'Selected'}</span>
            <ChevronDown className={`category-picker-chevron${expanded ? ' open' : ''}`} size={18} aria-hidden="true" />
          </button>
        </header>
        {expanded && <ul id={bodyId} className="category-picker-items">{visible.map(product => {
          const isChosen = chosen.has(product.documentId);
          const image = productImageReference(product.fields);
          const price = priceLabel(product.fields.price);
          return <li key={product.documentId} className={isChosen ? 'chosen' : ''}>
            <label>
              <input type="checkbox" value={product.documentId} checked={isChosen} disabled={disabled || (!isChosen && chosen.size >= max)}
                onChange={event => toggleProduct(product, event.target.checked)} />
              <span className="category-picker-thumb">{image
                ? <AuthenticatedImagePreview endpoint={masterImageUrl(outletId, 'products', product.documentId)} imagePath={image} token={token}
                  alt={`${productName(product)} image`} onSessionExpired={onSessionExpired} />
                : <span className="category-picker-placeholder" aria-hidden="true"><ImageIcon size={16} /></span>}</span>
              <span className="category-picker-product">
                <strong>{productName(product)}</strong>
                <small>{product.fields.code !== undefined && `Code: ${String(product.fields.code)}`}{product.fields.code !== undefined && price && ' · '}{price}</small>
              </span>
              {isChosen
                ? <span className="category-picker-status ready"><Check size={13} aria-hidden="true" />Ready for Apply</span>
                : <span className="category-picker-status">{needsReplacement(product) ? 'Has Image' : 'No Image'}</span>}
            </label>
          </li>;
        })}</ul>}
      </section>;
    })}
  </div>;
}
