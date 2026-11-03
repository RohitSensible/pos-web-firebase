import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { readShiftCreatorNames } from '../src/shiftCreators.js';
import { readFileSync } from 'node:fs';
import ts from '../../frontend/node_modules/typescript/lib/typescript.js';
import { summarizeDay } from '../src/daywiseSummary.js';

function fixture(fail = false) {
  const batches: string[][] = [];
  const db = {
    collection(name: string) {
      assert.equal(name, 'USER_PROFILE');
      return { doc: (id: string) => ({ id }) };
    },
    async getAll(...args: unknown[]) {
      assert.deepEqual(args.pop(), { fieldMask: ['name'] });
      const ids = (args as { id: string }[]).map(ref => ref.id);
      batches.push(ids);
      if (fail) throw new Error('mock lookup failure');
      return ids.map(id => ({ id, exists: id !== 'missing', data: () => ({ name: id === 'creator' ? '  Shift Owner  ' : null, quickPin: 'PRIVATE' }) }));
    },
    // No write methods or live services.
  } as unknown as Firestore;
  return { db, batches };
}

test('deduplicates SHIFT.userId document references, projects names and returns no profile data', async () => {
  const f = fixture();
  const result = await readShiftCreatorNames(f.db, [{ userId: 'creator' }, { userId: 'creator' }, { userId: 'missing' }, { userId: 'nameless' }]);
  assert.deepEqual(f.batches, [['creator', 'missing', 'nameless']]);
  assert.deepEqual([...result], [['creator', 'Shift Owner']]);
  assert.ok(!JSON.stringify([...result]).includes('PRIVATE'));
});

test('absent or invalid user IDs make no extra reads; session names are ignored', async () => {
  const f = fixture();
  assert.equal((await readShiftCreatorNames(f.db, [{}, { userId: '' }, { userId: null }, { userId: 12 }, { userId: 'bad/path' }, { name: 'Session User' }])).size, 0);
  assert.deepEqual(f.batches, []);
});

test('lookup failure is optional and leaves IDs available on the unchanged shift records', async () => {
  const f = fixture(true);
  const shifts = [{ userId: 'creator', totalSale: 250 }];
  const before = structuredClone(shifts);
  assert.equal((await readShiftCreatorNames(f.db, shifts)).size, 0);
  assert.deepEqual(shifts, before);
});

test('large sets are bounded batches and repeated IDs never cause extra reads', async () => {
  const f = fixture();
  const shifts = Array.from({ length: 205 }, (_, i) => ({ userId: `user-${i}` }));
  await readShiftCreatorNames(f.db, [...shifts, ...shifts]);
  assert.deepEqual(f.batches.map(batch => batch.length), [100, 100, 5]);
});

// Exercise the actual dashboard handler without importing the listening server.
async function dashboard(failLookup = false, authorized = true) {
  const source = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
  const helperNames = new Set(['stringValue', 'numberValue', 'assignedOutletIds', 'parsePayment']);
  const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && helperNames.has(node.name?.text ?? '')).map(node => node.getText(ast));
  const route = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === 'app.get' && ts.isStringLiteral(node.expression.arguments[0]!)
    && node.expression.arguments[0].text === '/api/outlets/:outletId/dashboard') as ts.ExpressionStatement;
  const handlerSource = (route.expression as ts.CallExpression).arguments[1]!.getText(ast);
  const js = ts.transpileModule(`${helpers.join('\n')}\nreturn (${handlerSource});`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;
  const f = fixture(failLookup);
  let shiftQueries = 0;
  const shifts = [
    { id: 'one', userId: 'creator', dayId: '2026-10-19', shiftNo: 1, totalSale: 100, startBillNo: 0, lastBillNo: 42 },
    { id: 'two', userId: 'missing', dayId: '2026-10-19', shiftNo: 2, totalSale: 200, startBillNo: null, lastBillNo: null },
  ];
  const db = {
    getAll: f.db.getAll.bind(f.db),
    collection(name: string) {
      if (name === 'USER_PROFILE') return { doc: (id: string) => ({ id, get: async () => ({ exists: true,
        data: () => ({ active: true, outlets: authorized ? ['shop'] : [] }) }) }) };
      assert.equal(name, 'OUTLET');
      return { doc: (id: string) => {
        assert.equal(id, 'shop');
        return { collection: (child: string) => {
          assert.equal(child, 'SHIFT');
          return { where: (field: string, op: string, day: string) => {
            assert.deepEqual([field, op, day], ['dayId', '==', '2026-10-19']);
            return { get: async () => { shiftQueries++; return { empty: false, docs: shifts.map(shift => ({ id: shift.id, data: () => shift })) }; } };
          } };
        } };
      } };
    },
  };
  const handler = new Function('getFirestoreDb', 'readAccessToken', 'summarizeDay', 'readShiftCreatorNames', js)(
    () => db, () => ({ profileDocId: 'signed-in' }), summarizeDay, readShiftCreatorNames,
  );
  let status = 200;
  let body: any;
  await handler({ params: { outletId: 'shop' }, query: { dayId: '2026-10-19' } }, {
    status(code: number) { status = code; return this; }, json(value: unknown) { body = value; },
  });
  return { status, body, batches: f.batches, shiftQueries };
}

test('dashboard retains creator IDs, numeric bill text and totals, reusing the authorized shift query', async () => {
  const result = await dashboard();
  assert.equal(result.status, 200);
  assert.equal(result.shiftQueries, 1);
  assert.deepEqual(result.batches, [['creator', 'missing']]);
  assert.equal(result.body.data.totalSale, 300);
  const [first, second] = result.body.data.shifts;
  assert.deepEqual([first.userId, first.creatorName, first.startBillNo, first.lastBillNo], ['creator', 'Shift Owner', '0', '42']);
  assert.deepEqual([second.userId, second.creatorName, second.startBillNo, second.lastBillNo], ['missing', 'Not Available', '', '']);
  assert.ok(!JSON.stringify(result.body).includes('PRIVATE'));
});

test('dashboard sales survive creator lookup failure and unauthorized requests never enrich', async () => {
  const failed = await dashboard(true);
  assert.equal(failed.status, 200);
  assert.equal(failed.body.data.totalSale, 300);
  assert.equal(failed.body.data.shifts[0].creatorName, 'Not Available');
  assert.equal(failed.body.data.shifts[0].userId, 'creator');
  const denied = await dashboard(false, false);
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.batches, []);
});
