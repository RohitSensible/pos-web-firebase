import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { PRODUCT_UNITS, ProductCreationError, requireProductOutlet } from './productCreation.js';

const revision = (items: string) => createHash('sha256').update(items).digest('hex');
const recordId = z.string().min(1).max(200).refine(value => !value.includes('/') && value !== '.' && value !== '..');
const itemsSchema = z.array(z.object({
  product_id: recordId, qty: z.number().finite().positive(), price: z.number().finite().nonnegative(), unit_id: z.number().int(),
})).max(1000);

export async function readComboDetails(db: Firestore, outletId: string, productId: string, profileId: string | null,
  assigned: (profile: Record<string, unknown>) => string[]) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  if (!recordId.safeParse(outletId).success || !recordId.safeParse(productId).success) throw new ProductCreationError(400, 'A valid outlet and product are required.');
  requireProductOutlet(profileId, outletId, (await db.collection('USER_PROFILE').doc(profileId).get()).data(), assigned);
  const outlet = db.collection('OUTLET').doc(outletId);
  if ((await outlet.get()).data()?.active !== true) throw new ProductCreationError(403, 'This outlet is inactive or unavailable.');
  const product = (await outlet.collection('PRODUCT').doc(productId).get()).data();
  if (!product) throw new ProductCreationError(404, 'This combo no longer exists.');
  if (product.type !== 2) throw new ProductCreationError(422, 'This product is not a combo.');
  const recipeId = recordId.safeParse(product.recipeId);
  if (!recipeId.success) throw new ProductCreationError(422, 'This combo has no valid recipe reference.');
  const recipe = (await outlet.collection('RECIPE').doc(recipeId.data).get()).data();
  if (!recipe) throw new ProductCreationError(404, 'The saved recipe for this combo is unavailable.');
  if (recipe.type !== 2 || typeof recipe.items !== 'string') throw new ProductCreationError(422, 'This combo has an unsupported saved recipe.');
  let rawItems: unknown;
  try { rawItems = JSON.parse(recipe.items); }
  catch { throw new ProductCreationError(422, 'This combo’s saved product list is invalid.'); }
  const parsed = itemsSchema.safeParse(rawItems);
  if (!parsed.success) throw new ProductCreationError(422, 'This combo’s saved products contain invalid IDs, quantities, prices or units.');
  // Read unique products in bounded batches, then return every saved recipe row
  // in its original order, including repeated product IDs and stored prices.
  const ids = [...new Set(parsed.data.map(item => item.product_id))];
  const products = new Map<string, Record<string, unknown> | undefined>();
  for (let start = 0; start < ids.length; start += 100) {
    const snapshots = await db.getAll(...ids.slice(start, start + 100).map(id => outlet.collection('PRODUCT').doc(id)));
    for (const snapshot of snapshots) products.set(snapshot.id, snapshot.data());
  }
  return { documentId: productId, name: typeof product.name === 'string' ? product.name : 'Combo', recipeId: recipeId.data, revision: revision(recipe.items),
    items: parsed.data.map(item => {
      const included = products.get(item.product_id);
      return { productId: item.product_id, name: typeof included?.name === 'string' && included.name.trim() ? included.name : 'Product unavailable',
        available: !!included, quantity: item.qty, price: item.price, unitId: item.unit_id,
        unitName: PRODUCT_UNITS.find(unit => unit.id === item.unit_id)?.name ?? '—' };
    }) };
}

const editsSchema = z.object({
  recipeId: recordId, revision: z.string().regex(/^[a-f0-9]{64}$/),
  items: z.array(z.object({ quantity: z.number().finite().positive(), price: z.number().finite().nonnegative(), sourceIndex: z.number().int().nonnegative().optional(), productId: recordId.optional() }).strict().refine(row => row.sourceIndex === undefined || row.productId === undefined)).min(1).max(1000),
}).strict();

export async function updateComboDetails(db: Firestore, outletId: string, productId: string, profileId: string | null,
  assigned: (profile: Record<string, unknown>) => string[], input: unknown) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  if (!recordId.safeParse(outletId).success || !recordId.safeParse(productId).success) throw new ProductCreationError(400, 'A valid outlet and product are required.');
  const edit = editsSchema.safeParse(input);
  if (!edit.success) throw new ProductCreationError(400, 'Enter a positive quantity and a non-negative price for every item.');
  const outlet = db.collection('OUTLET').doc(outletId);
  return db.runTransaction(async transaction => {
    const profile = await transaction.get(db.collection('USER_PROFILE').doc(profileId));
    requireProductOutlet(profileId, outletId, profile.data(), assigned);
    if ((await transaction.get(outlet)).data()?.active !== true) throw new ProductCreationError(403, 'This outlet is inactive or unavailable.');
    const product = (await transaction.get(outlet.collection('PRODUCT').doc(productId))).data();
    if (!product) throw new ProductCreationError(404, 'This combo no longer exists.');
    if (product.type !== 2) throw new ProductCreationError(422, 'This product is not a combo.');
    if (product.recipeId !== edit.data.recipeId) throw new ProductCreationError(409, 'This combo changed. Close and reopen it before editing.');
    const ref = outlet.collection('RECIPE').doc(edit.data.recipeId);
    const recipe = (await transaction.get(ref)).data();
    if (!recipe) throw new ProductCreationError(404, 'The saved recipe for this combo is unavailable.');
    if (recipe.type !== 2 || typeof recipe.items !== 'string') throw new ProductCreationError(422, 'This combo has an unsupported saved recipe.');
    if (revision(recipe.items) !== edit.data.revision) throw new ProductCreationError(409, 'This combo changed. Close and reopen it before editing.');
    let raw: unknown;
    try { raw = JSON.parse(recipe.items); } catch { throw new ProductCreationError(422, 'This combo’s saved product list is invalid.'); }
    if (!itemsSchema.safeParse(raw).success) throw new ProductCreationError(422, 'This combo’s saved product list is invalid.');
    const rows = raw as Record<string, unknown>[];
    const legacy = edit.data.items.every(row => row.sourceIndex === undefined && row.productId === undefined);
    if (legacy && rows.length !== edit.data.items.length) throw new ProductCreationError(409, 'This combo changed. Close and reopen it before editing.');
    const retained = new Set<number>();
    const next: Record<string, unknown>[] = [];
    for (const [index, change] of edit.data.items.entries()) {
      const sourceIndex = legacy ? index : change.sourceIndex;
      if (sourceIndex !== undefined) {
        if (sourceIndex >= rows.length || retained.has(sourceIndex)) throw new ProductCreationError(400, 'Invalid combo row reference.');
        retained.add(sourceIndex);
        next.push({ ...rows[sourceIndex], qty: change.quantity, price: change.price });
      } else {
        if (!change.productId || change.productId === productId) throw new ProductCreationError(400, 'Select a valid product to add.');
        const included = (await transaction.get(outlet.collection('PRODUCT').doc(change.productId))).data();
        if (!included || included.type === 2 || !Number.isInteger(included.unitId)) throw new ProductCreationError(422, 'The selected product is unavailable or cannot be included in a combo.');
        next.push({ product_id: change.productId, qty: change.quantity, price: change.price, unit_id: included.unitId });
      }
    }
    // Retained rows keep all saved metadata. New rows use the existing recipe format.
    const items = JSON.stringify(next);
    transaction.update(ref, { items });
    return { revision: revision(items) };
  });
}
