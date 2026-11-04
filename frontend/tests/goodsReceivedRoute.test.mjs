import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import jwt from '../../backend/node_modules/jsonwebtoken/index.js';
import { ProductCreationError } from '../../backend/src/productCreation.js';

const source = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const reader = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'readAccessToken');
const key = 'isolated-goods-received-session-key';
function fixture(method, failure, path = '/api/outlets/:outletId/goods-received') {
  const route = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(tree) === `app.${method}` && node.expression.arguments[0]?.text === path);
  assert.ok(route);
  const calls = [];
  const dependencies = { jwt, JWT_SECRET: key, ProductCreationError, assignedOutletIds: () => [],
    getFirestoreDb: () => { calls.push('database'); const ref = { id: 'N'.repeat(20), collection: () => ref, doc: () => ref }; return ref; },
    getFirestoreRestContext: () => { calls.push('context'); return { database: 'mock', accessToken: 'mock' }; },
    premisesTransactionRunner: () => 'mock runner',
    loadGoodsReceived: async (...args) => { calls.push(args); if (failure) throw failure; return { suppliers: [], receipts: [] }; },
    loadGoodsReceiptHistory: async (...args) => { calls.push(args); if (failure) throw failure; return { receipts: [], nextCursor: null }; },
    createOutletSupplier: async (...args) => { calls.push(args); if (failure) throw failure; return { documentId: 'supplier', fields: { id: null }, alreadySaved: false }; },
    updateOutletSupplier: async (...args) => { calls.push(args); if (failure) throw failure; return { documentId: 'supplier', fields: { id: null, name: 'Updated' } }; },
    saveGoodsReceived: async (...args) => { calls.push(args); if (failure) throw failure; return { documentId: 'saved', alreadySaved: false }; } };
  const js = ts.transpileModule(`${reader.getText(tree)}\nconst handler = ${route.expression.arguments[1].getText(tree)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  const handler = new Function(...Object.keys(dependencies), `${js}; return handler;`)(...Object.values(dependencies));
  return { calls, async request(token = jwt.sign({ profileDocId: 'signed-user' }, key), query = {}) {
    const req = { header: name => name === 'authorization' && token ? `Bearer ${token}` : undefined,
      params: { outletId: 'selected-outlet', documentId: 'supplier' }, query, body: { profileDocId: 'forged-user' } };
    const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await handler(req, res); return res;
  } };
}
test('goods receipt routes reject expired or missing sessions before accessing Firebase', async () => {
  for (const method of ['get','post']) for (const token of ['', 'invalid', jwt.sign({ profileDocId: 'signed-user' }, key, { expiresIn: -1 })]) {
    const f = fixture(method); assert.equal((await f.request(token)).statusCode, 401); assert.deepEqual(f.calls, []);
  }
});
test('goods routes pass the selected outlet and signed identity to the authorized services', async () => {
  for (const method of ['get','post']) {
    const f = fixture(method), response = await f.request(); assert.equal(response.statusCode, 200);
    assert.equal(f.calls[1][1], 'selected-outlet'); assert.equal(f.calls[1][2], 'signed-user');
  }
});

test('receipt history routes keep signed identity and forward only bounded read filters', async () => {
  const f = fixture('get');
  const query = { history: '1', from: '2026-11-01', to: '2026-11-04', cursor: 'page', limit: '25', profileDocId: 'forged-user' };
  assert.equal((await f.request('', query)).statusCode, 401); assert.deepEqual(f.calls, []);
  const response = await f.request(undefined, query);
  assert.equal(response.statusCode, 200);
  assert.equal(f.calls[1][1], 'selected-outlet'); assert.equal(f.calls[1][2], 'signed-user');
  assert.deepEqual(f.calls[1][4], { from: query.from, to: query.to, cursor: query.cursor, limit: query.limit });
  assert.equal(response.body.data.nextCursor, null);
});
test('goods save returns truthful validation and uncertain-failure responses without leaking errors', async () => {
  for (const error of [new ProductCreationError(409, 'Receipt conflict'), new Error('PRIVATE DATABASE ERROR')]) {
    const response = await fixture('post', error).request(); assert.equal(response.statusCode, error instanceof ProductCreationError ? 409 : 503);
    assert.equal(response.body.success, false); assert.ok(!response.body.message.includes('PRIVATE'));
  }
});

 test('supplier route uses signed outlet authorization and returns a new draft ID only after a confirmed save', async () => {
   const f = fixture('post', undefined, '/api/outlets/:outletId/suppliers');
   assert.equal((await f.request('')).statusCode, 401); assert.deepEqual(f.calls, []);
   const response = await f.request(); assert.equal(response.statusCode, 200);
   assert.equal(f.calls[1][1], 'selected-outlet'); assert.equal(f.calls[1][2], 'signed-user');
   assert.equal(response.body.data.fields.id, null); assert.equal(response.body.data.nextDocumentId, 'N'.repeat(20));
 });
 test('supplier route does not report success on validation or uncertain database failures', async () => {
   for (const error of [new ProductCreationError(422, 'Invalid supplier'), new Error('PRIVATE')]) {
     const response = await fixture('post', error, '/api/outlets/:outletId/suppliers').request();
     assert.equal(response.statusCode, error instanceof ProductCreationError ? 422 : 503); assert.equal(response.body.success, false);
     assert.ok(!response.body.message.includes('PRIVATE'));
   }
 });

test('supplier update route uses the signed profile and selected document, rejecting missing sessions first', async () => {
  const f = fixture('patch', undefined, '/api/outlets/:outletId/suppliers/:documentId');
  assert.equal((await f.request('')).statusCode, 401); assert.deepEqual(f.calls, []);
  const response = await f.request(); assert.equal(response.statusCode, 200);
  assert.deepEqual(f.calls[1].slice(1, 4), ['selected-outlet', 'supplier', 'signed-user']);
  assert.equal(response.body.data.fields.name, 'Updated');
});

test('supplier update route reports conflicts and uncertain failures without leaking private errors', async () => {
  for (const error of [new ProductCreationError(409, 'Supplier details changed'), new Error('PRIVATE DATABASE ERROR')]) {
    const response = await fixture('patch', error, '/api/outlets/:outletId/suppliers/:documentId').request();
    assert.equal(response.statusCode, error instanceof ProductCreationError ? 409 : 503);
    assert.equal(response.body.success, false); assert.ok(!response.body.message.includes('PRIVATE'));
  }
});
