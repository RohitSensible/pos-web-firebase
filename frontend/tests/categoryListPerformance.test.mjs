import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { categoryReferenceMap } from '../../shared/categoryReferences.ts';
// Execute the real route without starting Express, Firebase or any service.
const source = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const route = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(tree) === 'app.get' && node.expression.arguments[0]?.text === '/api/outlets/:outletId/categories');
const code = ts.transpileModule(`return ${route.expression.arguments[1].getText(tree)}`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;
function fixture(omit = false, authorized = true, records = { categories: [{ id: 'cat', name: 'Food', categoryNo: 1 }], products: [{ category: 'cat' }] }) {
  const queries = [];
  const filters = [];
  const collection = kind => ({ get: async () => {
    queries.push(kind); if (kind === 'PRODUCT') throw new Error('Never download entire product documents to count categories');
    return { docs: records.categories.map(category => ({ id: category.id, data: () => category, createTime: undefined })) };
  }, where: (field, operator, value) => {
    assert.equal(kind, 'PRODUCT'); assert.equal(field, 'category'); assert.ok(['==', 'in'].includes(operator));
    filters.push({ operator, value });
    return { count: () => ({ get: async () => { queries.push('PRODUCT.count'); return { data: () => ({ count: records.products.filter(product =>
      operator === 'in' ? value.includes(product.category) : product.category === value).length }) }; } }) };
  } });
  const db = { collection: name => ({ doc: () => name === 'USER_PROFILE' ? { get: async () => ({ exists: true, data: () => ({ active: true, outlets: authorized ? ['outlet'] : [] }) }) }
    : { collection } }) };
  const handler = new Function('getFirestoreDb', 'readAccessToken', 'assignedOutletIds', 'stringValue', 'categoryReferenceMap', code)(() => db, () => ({ profileDocId: 'user' }), profile => profile.outlets, value => typeof value === 'string' ? value : '', categoryReferenceMap);
  let status = 200, body;
  const res = { status: value => { status = value; return res; }, json: value => { body = value; } };
  return { queries, filters, request: async () => { await handler({ params: { outletId: 'outlet' }, header: name => name === 'x-category-counts' && omit ? 'omit' : undefined }, res); return { status, body }; } };
}
test('metadata requests read categories without scanning products', async () => {
  const f = fixture(true), result = await f.request(); assert.equal(result.status, 200); assert.deepEqual(f.queries, ['CATEGORY']);
  assert.equal(result.body.data[0].name, 'Food'); assert.ok(!('productCount' in result.body.data[0]));
});
test('default category list preserves counts using aggregation without downloading products', async () => {
  const f = fixture(), result = await f.request(); assert.equal(result.body.data[0].productCount, 1); assert.deepEqual(f.queries.sort(), ['CATEGORY', 'PRODUCT.count']);
});
test('metadata optimization never bypasses outlet authorization', async () => {
  const f = fixture(true, false), result = await f.request(); assert.equal(result.status, 403); assert.ok(!result.body.data); assert.ok(!f.queries.some(query => query.startsWith('PRODUCT')));
});
test('category counts include mobile-created inactive type-2 combos by name and products by ID, with no data writes', async () => {
  const records = { categories: [{ id: 'combo-id', name: 'COMBO', categoryNo: 1 }], products: [
    { category: 'COMBO', type: 2, active: false, recipeId: 'original-recipe' },
    { category: 'combo-id', type: 0 }, { category: 'unrelated' }] };
  const before = JSON.stringify(records), f = fixture(false, true, records), result = await f.request();
  assert.equal(result.status, 200); assert.equal(result.body.data[0].productCount, 2);
  assert.equal(f.filters[0].operator, 'in');
  assert.ok(f.filters[0].value.includes('combo-id') && f.filters[0].value.includes('COMBO'));
  assert.equal(JSON.stringify(records), before);
});
