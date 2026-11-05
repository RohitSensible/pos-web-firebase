import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from '../../frontend/node_modules/typescript/lib/typescript.js';
import { productRate, stockDirection, stockMovementRecord, unpricedProductIds } from '../src/stockMovementReport.js';
import { goodsTransactionRecord } from '../src/goodsTransaction.js';
import { stockTransferRecord } from '../src/stockTransferReport.js';

const generatedId = 'o58S8RcWG347If8gjHo6';
const receipt = (type: 'STOCK-IN' | 'STOCK-OUT', fields: Record<string, unknown> = {}) => ({
  addType: 'POS', type, dayID: '2026-11-05', createDate: 1793853000000,
  goodsReceivedNo: '2611055', finalTotal: 6000, total: 6000, quantity: 2, roundOff: 0,
  supplier: { name: 'samiksha' }, goodsReceivedItemBeanList: [{ productid: 'rice', name: 'Rice', quantity: 2, price: 3000, cost: 2500, total: 6000 }],
  ...fields,
});

for (const type of ['STOCK-IN', 'STOCK-OUT'] as const) {
  test(`${type}: preserves existing goodsReceivedNo, supplier, dates, quantities and amounts`, () => {
    const data = receipt(type), before = structuredClone(data);
    const result = stockMovementRecord(generatedId, data);
    assert.equal(result.transactionNo, '2611055');
    assert.equal(result.supplier, 'samiksha');
    assert.equal(result.documentId, generatedId);
    assert.deepEqual({ ...result, direction: undefined }, { ...goodsTransactionRecord(generatedId, data), direction: undefined });
    assert.deepEqual(data, before, 'report mapping cannot modify the historical receipt');
  });

  test(`${type}: missing or invalid numbers never fall back to a document ID`, () => {
    for (const goodsReceivedNo of [undefined, null, '', '  ', NaN, Infinity, {}, [], false]) {
      const result = stockMovementRecord(generatedId, receipt(type, { goodsReceivedNo }));
      assert.equal(result.transactionNo, '—');
      assert.equal(result.documentId, generatedId);
    }
  });

  test(`${type}: copied document, device, request and transaction IDs are not bill numbers`, () => {
    for (const fields of [
      { goodsReceivedNo: generatedId },
      { goodsReceivedNo: ` ${generatedId} ` },
      { goodsReceivedNo: 'device-1', deviceId: 'device-1' },
      { goodsReceivedNo: 'request-1', requestId: 'request-1' },
      { goodsReceivedNo: 'transaction-1', transactionId: 'transaction-1' },
      { goodsReceivedNo: 'internal-1', id: 'internal-1' },
    ]) {
      const data = receipt(type, fields), before = structuredClone(data);
      assert.equal(stockMovementRecord(generatedId, data).transactionNo, '—');
      assert.deepEqual(data, before);
    }
  });

  test(`${type}: preserves numeric values, leading zeroes and stored references without guessing a format`, () => {
    for (const [value, expected] of [[2611055, '2611055'], [0, '0'], [' 2611055 ', '2611055'], ['0002611055', '0002611055'], ['GR-2611055', 'GR-2611055']] as const) {
      assert.equal(stockMovementRecord(generatedId, receipt(type, { goodsReceivedNo: value })).transactionNo, expected);
    }
  });
}

test('an ID-only web receipt keeps existing rate lookup and total calculations unchanged', () => {
  const data = receipt('STOCK-IN', { goodsReceivedNo: generatedId, quantity: 0, total: 0, finalTotal: 0,
    goodsReceivedItemBeanList: [{ productid: 'rice', name: 'Rice', quantity: 2, price: 0, cost: 0, total: 0 }] });
  const result = stockMovementRecord(generatedId, data, new Map([['rice', { price: 3000, cost: 2500 }]]));
  assert.equal(result.transactionNo, '—');
  assert.equal(result.quantity, 2); assert.equal(result.total, 6000); assert.equal(result.finalTotal, 6000);
});

test('stock report correction does not change the separate stock-transfer reference mapping', () => {
  const data = { type: 'TRANSFER' };
  assert.equal(stockTransferRecord(generatedId, data).transferNo, generatedId);
  assert.equal(goodsTransactionRecord(generatedId, data).transactionNo, generatedId);
});

// Exercise the actual read-only report handler without starting Express or
// initializing Firebase. Only the fixture's in-memory get() methods exist.
const source = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node)
  && ['assignedOutletIds', 'datesBetween', 'readReportDays'].includes(node.name?.text ?? ''));
const route = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(ast) === 'app.get' && ts.isStringLiteral(node.expression.arguments[0]!)
  && node.expression.arguments[0].text === '/api/outlets/:outletId/reports/stock-movements') as ts.ExpressionStatement;
assert.ok(route);
const js = ts.transpileModule(`${helpers.map(node => node.getText(ast)).join('\n')}\nreturn (${(route.expression as ts.CallExpression).arguments[1]!.getText(ast)});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2023 },
}).outputText;

function apiFixture() {
  const records = new Map<string, Record<string, unknown>>([
    ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }],
    ['OUTLET/outlet/GOODS_RECEIVED/numbered-in', receipt('STOCK-IN')],
    [`OUTLET/outlet/GOODS_RECEIVED/${generatedId}`, receipt('STOCK-IN', { goodsReceivedNo: generatedId, finalTotal: 0 })],
    ['OUTLET/outlet/GOODS_RECEIVED/numbered-out', receipt('STOCK-OUT', { goodsReceivedNo: '2611056' })],
    ['OUTLET/outlet/GOODS_RECEIVED/unnumbered-out', receipt('STOCK-OUT', { goodsReceivedNo: undefined })],
    ['OUTLET/outlet/GOODS_RECEIVED/outside-date', receipt('STOCK-IN', { goodsReceivedNo: '2611071', dayID: '2026-11-07' })],
    ['OUTLET/other/GOODS_RECEIVED/foreign', receipt('STOCK-IN', { goodsReceivedNo: '999' })],
  ]);
  const before = structuredClone(records), reads: string[] = [];
  const ref = (path: string, filters: [string, unknown][] = []): any => ({
    path, collection: (name: string) => ref(`${path}/${name}`), doc: (id: string) => ref(`${path}/${id}`),
    where: (field: string, operator: string, value: unknown) => { assert.equal(operator, '=='); return ref(path, [...filters, [field, value]]); },
    get: async () => {
      reads.push(path);
      if (path === 'USER_PROFILE/user') return { exists: true, data: () => structuredClone(records.get(path)) };
      assert.equal(path, 'OUTLET/outlet/GOODS_RECEIVED', 'No unrelated collection or guessed bill relationship is queried');
      return { docs: [...records].filter(([key, fields]) => key.startsWith(`${path}/`) && filters.every(([field, value]) => fields[field] === value))
        .map(([key, fields]) => ({ id: key.split('/').at(-1), data: () => structuredClone(fields) })) };
    },
  });
  const db = { collection: ref, getAll: async () => { throw new Error('Saved item rates need no extra product read.'); } };
  const deps = { readAccessToken: () => ({ profileDocId: 'user' }), getFirestoreDb: () => db,
    productRate, stockDirection, stockMovementRecord, unpricedProductIds };
  const handler = new Function(...Object.keys(deps), js)(...Object.values(deps));
  return { reads, request: async (query: Record<string, string>, outletId = 'outlet') => {
    const res: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; } };
    await handler({ params: { outletId }, query: { startDate: '2026-11-05', endDate: '2026-11-06', ...query } }, res);
    assert.deepEqual(records, before, 'Report requests never write or repair historical records');
    return res;
  } };
}

test('Stock In API returns the stored goods number and a dash for the copied ID, preserving supplier and totals', async () => {
  const f = apiFixture(), result = await f.request({ direction: 'in' });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.data.movements.map((row: any) => [row.transactionNo, row.supplier]), [['2611055', 'samiksha'], ['—', 'samiksha']]);
  assert.deepEqual(result.body.data.summary, { totalTransactions: 2, stockInQuantity: 4, stockOutQuantity: 0, totalAmount: 12000, netQuantity: 4 });
});

test('Stock Out API and supplier searches use the same corrected number mapping', async () => {
  const f = apiFixture(), result = await f.request({ direction: 'out', search: 'samiksha' });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.data.movements.map((row: any) => [row.transactionNo, row.supplier]), [['2611056', 'samiksha'], ['—', 'samiksha']]);
  assert.deepEqual(result.body.data.summary, { totalTransactions: 2, stockInQuantity: 0, stockOutQuantity: 4, totalAmount: 12000, netQuantity: -4 });
});

test('report number searches never match internal ID substitutions and outlet access remains enforced', async () => {
  const f = apiFixture();
  assert.equal((await f.request({ direction: 'in', search: '2611055' })).body.data.movements.length, 1);
  assert.equal((await f.request({ direction: 'in', search: generatedId })).body.data.movements.length, 0);
  assert.equal((await f.request({ direction: 'in' }, 'other')).statusCode, 403);
  assert.ok(!f.reads.some(path => path.startsWith('OUTLET/other/')));
});
