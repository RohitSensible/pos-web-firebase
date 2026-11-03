import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { readComboDetails, updateComboDetails } from '../src/comboDetails.js';

const recipeId = 'X5mzZ8NaMZVkxFiuizxe';
const items = [{ product_id: 'bafebe9cf04910913152', qty: 1, price: 715, unit_id: 2 },
  { product_id: 'bafebe9cf04910913152', qty: 1, price: 715, unit_id: 2 },
  { product_id: '105ee9ebee16691d00d8', qty: 1, price: 700, unit_id: 2 }];
const assigned = (profile: Record<string, unknown>) => profile.outlets as string[];
function fixture(allowWrites = false) {
  const records = new Map<string, Record<string, unknown>>([
    ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }], ['OUTLET/outlet', { active: true }],
    ['OUTLET/outlet/PRODUCT/combo', { id: null, name: 'COMBO 1', category: 'COMBO', type: 2, active: false, code: 156, recipeId, price: 0, priceTable: '' }],
    [`OUTLET/outlet/RECIPE/${recipeId}`, { id: null, name: 'COMBO 1', type: 2, reverseStock: false, items: JSON.stringify(items) }],
    ['OUTLET/outlet/PRODUCT/bafebe9cf04910913152', { name: 'Product A', price: 999 }],
    ['OUTLET/outlet/PRODUCT/105ee9ebee16691d00d8', { name: 'Product B', price: 999 }],
  ]);
  const reads: string[] = [], batches: string[][] = [];
  const forbidden = () => { throw new Error('No database mutations permitted'); };
  const snapshot = (path: string) => ({ id: path.split('/').at(-1), exists: records.has(path), data: () => records.get(path) });
  const reference = (path: string): any => ({ path, collection: (name: string) => reference(`${path}/${name}`), doc: (id: string) => reference(`${path}/${id}`),
    get: async () => { reads.push(path); return snapshot(path); }, set: forbidden, update: forbidden, delete: forbidden, create: forbidden });
  const db = { collection: (name: string) => reference(name), getAll: async (...refs: { path: string }[]) => {
    batches.push(refs.map(ref => ref.path));
    return refs.map(ref => { reads.push(ref.path); return snapshot(ref.path); });
  }, batch: forbidden, runTransaction: allowWrites ? async (callback: (transaction: unknown) => Promise<unknown>) => {
    const pending: { path: string; value: Record<string, unknown> }[] = [];
    const result = await callback({ get: async (ref: { path: string }) => snapshot(ref.path), update: (ref: { path: string }, value: Record<string, unknown>) => pending.push({ path: ref.path, value }) });
    for (const update of pending) { assert.deepEqual(Object.keys(update.value), ['items']); records.set(update.path, { ...records.get(update.path), ...update.value }); }
    return result;
  } : forbidden } as unknown as Firestore;
  return { records, reads, batches, save: (input: unknown, profile: string | null = 'user') => updateComboDetails(db, 'outlet', 'combo', profile, assigned, input), load: (profile: string | null = 'user', outletId = 'outlet', productId = 'combo') => readComboDetails(db, outletId, productId, profile, assigned) };
}

test('reads the existing recipe, preserving duplicate rows, stored quantities/prices and all database fields', async () => {
  const f = fixture(), before = JSON.stringify([...f.records]);
  const result = await f.load();
  assert.equal(result.name, 'COMBO 1'); assert.equal(result.recipeId, recipeId);
  assert.deepEqual(result.items.map(item => [item.name, item.quantity, item.price, item.unitName]), [
    ['Product A', 1, 715, 'NUMBER'], ['Product A', 1, 715, 'NUMBER'], ['Product B', 1, 700, 'NUMBER']]);
  assert.deepEqual(f.batches.map(batch => batch.length), [2], 'duplicate products are fetched once');
  assert.ok(f.reads.includes(`OUTLET/outlet/RECIPE/${recipeId}`));
  assert.equal(JSON.stringify([...f.records]), before);
});

test('missing login, foreign/inactive users and invalid paths are denied before recipe reads', async () => {
  const noLogin = fixture(); await assert.rejects(noLogin.load(null), { status: 401 }); assert.deepEqual(noLogin.reads, []);
  const invalid = fixture(); await assert.rejects(invalid.load('user', 'outlet', '../other'), { status: 400 }); assert.deepEqual(invalid.reads, []);
  for (const profile of [{ active: true, outlets: ['foreign'] }, { active: false, outlets: ['outlet'] }]) {
    const f = fixture(); f.records.set('USER_PROFILE/user', profile);
    await assert.rejects(f.load(), { status: 403 }); assert.deepEqual(f.reads, ['USER_PROFILE/user']);
  }
});

test('inactive outlets and ordinary products cannot be used to read combo recipes', async () => {
  const inactive = fixture(); inactive.records.get('OUTLET/outlet')!.active = false;
  await assert.rejects(inactive.load(), { status: 403 });
  const normal = fixture(); normal.records.get('OUTLET/outlet/PRODUCT/combo')!.type = 0;
  await assert.rejects(normal.load(), { status: 422 });
  assert.ok(!normal.reads.some(path => path.includes('/RECIPE/')));
});

test('invalid recipe references and malformed JSON/items fail without reading referenced products', async () => {
  const invalidId = fixture(); invalidId.records.get('OUTLET/outlet/PRODUCT/combo')!.recipeId = 'foreign/recipe';
  await assert.rejects(invalidId.load(), { status: 422 }); assert.ok(!invalidId.reads.some(path => path.includes('/RECIPE/')));
  for (const value of ['not json', '{}', JSON.stringify([{ ...items[0], qty: -1 }]), JSON.stringify([{ ...items[0], product_id: 'foreign/item' }])]) {
    const f = fixture(); f.records.get(`OUTLET/outlet/RECIPE/${recipeId}`)!.items = value;
    await assert.rejects(f.load(), { status: 422 }); assert.deepEqual(f.batches, []);
  }
});

test('missing recipes report an error; missing component products retain their saved row', async () => {
  const missingRecipe = fixture(); missingRecipe.records.delete(`OUTLET/outlet/RECIPE/${recipeId}`);
  await assert.rejects(missingRecipe.load(), { status: 404 });
  const missingProduct = fixture(); missingProduct.records.delete('OUTLET/outlet/PRODUCT/bafebe9cf04910913152');
  const result = await missingProduct.load();
  assert.equal(result.items.length, 3); assert.equal(result.items[0]!.available, false);
  assert.equal(result.items[0]!.productId, items[0]!.product_id); assert.equal(result.items[0]!.price, 715);
  assert.equal(result.items[2]!.available, true);
});

test('empty recipes return an empty list and large recipes use bounded reads', async () => {
  const empty = fixture(); empty.records.get(`OUTLET/outlet/RECIPE/${recipeId}`)!.items = '[]';
  assert.deepEqual((await empty.load()).items, []); assert.deepEqual(empty.batches, []);
  const large = fixture(); large.records.get(`OUTLET/outlet/RECIPE/${recipeId}`)!.items = JSON.stringify(Array.from({ length: 201 }, (_, index) => ({ ...items[0], product_id: `p${index}` })));
  assert.equal((await large.load()).items.length, 201); assert.deepEqual(large.batches.map(batch => batch.length), [100, 100, 1]);
  assert.ok(large.reads.filter(path => path.includes('/PRODUCT/')).every(path => path.startsWith('OUTLET/outlet/')));
});

test('saving updates only quantities and prices, preserving duplicate rows, extra keys and other documents', async () => {
  const f = fixture(true), path = `OUTLET/outlet/RECIPE/${recipeId}`;
  const source = items.map(row => ({ ...row, extra: { retained: true } }));
  f.records.get(path)!.items = JSON.stringify(source);
  const before = structuredClone([...f.records]);
  const loaded = await f.load();
  await f.save({ recipeId, revision: loaded.revision, items: [{ quantity: 2, price: 720 }, { quantity: 3, price: 0 }, { quantity: 0.5, price: 700.25 }] });
  assert.deepEqual(JSON.parse(f.records.get(path)!.items as string), source.map((row, i) => ({ ...row, qty: [2,3,0.5][i], price: [720,0,700.25][i] })));
  for (const [key, value] of before) {
    if (key !== path) assert.deepEqual(f.records.get(key), value);
    else { const { items: _ignored, ...rest } = f.records.get(key)!; const { items: _previous, ...old } = value; assert.deepEqual(rest, old); }
  }
  await assert.rejects(f.save({ recipeId, revision: loaded.revision, items: loaded.items.map(row => ({ quantity: row.quantity, price: row.price })) }), { status: 409 });
});

test('saving rejects invalid values, stale references, changed row counts and unauthorized users without writes', async () => {
  const f = fixture(true), loaded = await f.load();
  const body = { recipeId, revision: loaded.revision, items: loaded.items.map(row => ({ quantity: row.quantity, price: row.price })) };
  const before = JSON.stringify([...f.records]);
  for (const invalid of [0, -1, null, '2']) await assert.rejects(f.save({ ...body, items: [{ quantity: invalid, price: 1 }] }), { status: 400 });
  await assert.rejects(f.save({ ...body, items: [{ quantity: 1, price: -1 }] }), { status: 400 });
  await assert.rejects(f.save({ ...body, items: body.items.slice(1) }), { status: 409 });
  await assert.rejects(f.save({ ...body, recipeId: 'another' }), { status: 409 });
  await assert.rejects(f.save(body, null), { status: 401 });
  assert.equal(JSON.stringify([...f.records]), before);
  f.records.set('USER_PROFILE/user', { active: true, outlets: ['foreign'] });
  const unauthorized = JSON.stringify([...f.records]);
  await assert.rejects(f.save(body), { status: 403 });
  assert.equal(JSON.stringify([...f.records]), unauthorized);
});

test('adds and removes individual rows using the existing recipe format without touching products or stock', async () => {
  const f = fixture(true), path = `OUTLET/outlet/RECIPE/${recipeId}`;
  f.records.set('OUTLET/outlet/PRODUCT/new', { name: 'New product', type: 0, unitId: 2, price: 25, currentStock: 100 });
  const original = items.map(row => ({ ...row, metadata: 'keep' }));
  f.records.get(path)!.items = JSON.stringify(original);
  const before = structuredClone([...f.records]);
  const loaded = await f.load();
  await f.save({ recipeId, revision: loaded.revision, items: [
    { sourceIndex: 1, quantity: 2, price: 715 }, { sourceIndex: 2, quantity: 1, price: 700 }, { productId: 'new', quantity: 3, price: 30 },
  ] });
  assert.deepEqual(JSON.parse(f.records.get(path)!.items as string), [
    { ...original[1], qty: 2 }, original[2], { product_id: 'new', qty: 3, price: 30, unit_id: 2 },
  ]);
  for (const [key, value] of before) if (key !== path) assert.deepEqual(f.records.get(key), value);
});

test('rejects invalid additions, repeated source rows and an empty combo without writing', async () => {
  const f = fixture(true), loaded = await f.load(), before = JSON.stringify([...f.records]);
  const body = { recipeId, revision: loaded.revision };
  for (const change of [
    { items: [] },
    { items: [{ productId: 'missing', quantity: 1, price: 1 }] },
    { items: [{ productId: 'combo', quantity: 1, price: 1 }] },
    { items: [{ sourceIndex: 99, quantity: 1, price: 1 }] },
    { items: [{ sourceIndex: 0, quantity: 1, price: 1 }, { sourceIndex: 0, quantity: 1, price: 1 }] },
  ]) await assert.rejects(f.save({ ...body, ...change }));
  assert.equal(JSON.stringify([...f.records]), before);
});
