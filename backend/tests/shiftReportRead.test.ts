import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from '../../frontend/node_modules/typescript/lib/typescript.js';
import { readShiftCreatorNames } from '../src/shiftCreators.js';

// Compile only the actual route and its pure helpers; never import the listening server.
const source = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const helperNames = new Set(['stringValue', 'numberValue', 'assignedOutletIds', 'parsePayment', 'datesBetween', 'readReportDays']);
const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && helperNames.has(node.name?.text ?? ''));
const route = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(ast) === 'app.get' && ts.isStringLiteral(node.expression.arguments[0]!)
  && node.expression.arguments[0].text === '/api/outlets/:outletId/reports/shifts') as ts.ExpressionStatement;
assert.ok(route, 'shift report route exists');
const handlerText = (route.expression as ts.CallExpression).arguments[1]!.getText(ast);
const js = ts.transpileModule(`${helpers.map(node => node.getText(ast)).join('\n')}\nreturn (${handlerText});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2023 },
}).outputText;

type Shift = Record<string, unknown> & { id: string; dayId: string };
const metricNames = ['billCount', 'billDeletesNumber', 'billDeletesAmount', 'openingAmt', 'totalSale', 'cashSale',
  'digitalSale', 'creditSale', 'subTotalBill', 'discount', 'tax', 'gstTotal', 'vatTotal', 'refundAmount',
  'extraCharges', 'serviceChargeAmount', 'roundOff', 'expensesAmtTotal', 'expCash', 'expDigital',
  'advanceAmtTotal', 'customerReceiveAmtTotal', 'receiveAmtTotal', 'swiggyTotal', 'zomatoTotal'];
const sales = Object.fromEntries(metricNames.map((name, index) => [name, index + 1]));
const sample: Shift[] = [
  { ...sales, id: 'first', dayId: '2026-10-01', shiftNo: 1, deviceId: 'Counter-A', userId: 'owner',
    inActive: true, startTime: 1, endTime: 2, lastBillTime: 3, startBillNo: 0, lastBillNo: 42,
    payments: { cash: 12, zero: 0, invalid: '9', infinite: Infinity, nan: NaN }, paymentJson: '{"ignored":500}' },
  { ...sales, id: 'last', dayId: '2026-10-31', shiftNo: 2, deviceId: 'Counter-B', userId: 'owner',
    startBillNo: null, lastBillNo: Infinity, payments: [], paymentJson: '{"card":7,"invalid":"8"}' },
  { ...sales, id: 'outside', dayId: '2026-11-01', shiftNo: 1, deviceId: 'Counter-A', userId: 'outside' },
];

async function report(options: {
  query?: Record<string, string>; shifts?: Shift[]; token?: boolean; active?: boolean;
  authorized?: boolean; profileExists?: boolean; failNames?: boolean;
} = {}) {
  const dayReads: string[] = [];
  const batches: string[][] = [];
  const collections: string[] = [];
  const shifts = options.shifts ?? sample;
  const db = {
    collection(name: string) {
      collections.push(name);
      if (name === 'USER_PROFILE') return { doc: (id: string) => ({ id, get: async () => {
        assert.equal(id, 'session');
        return { exists: options.profileExists !== false, data: () => ({ active: options.active !== false,
          outlets: options.authorized === false ? ['other'] : ['shop'], name: 'Session Name', quickPin: 'PRIVATE' }) };
      } }) };
      assert.equal(name, 'OUTLET');
      return { doc: (id: string) => {
        assert.equal(id, 'shop');
        return { collection: (child: string) => {
          assert.equal(child, 'SHIFT');
          return { where: (field: string, operator: string, day: string) => {
            assert.deepEqual([field, operator], ['dayId', '==']);
            return { get: async () => {
              dayReads.push(day);
              return { docs: shifts.filter(shift => shift.dayId === day).map(shift => ({ id: shift.id, data: () => shift })) };
            } };
          } };
        } };
      } };
    },
    async getAll(...args: unknown[]) {
      assert.deepEqual(args.pop(), { fieldMask: ['name'] });
      const ids = (args as { id: string }[]).map(ref => ref.id);
      batches.push(ids);
      assert.ok(ids.every(id => id !== 'session' && id !== 'outside'));
      if (options.failNames) throw new Error('mock optional read failure');
      return ids.map(id => ({ id, exists: id !== 'missing', data: () => ({
        name: id === 'owner' ? '  Shift Owner  ' : null, quickPin: 'PRIVATE', mobile: 'PRIVATE',
      }) }));
    },
    // Intentionally no writes, EMPLOYEE/device reads, credentials or real services.
  };
  const handler = new Function('getFirestoreDb', 'readAccessToken', 'readShiftCreatorNames', js)(
    () => db, () => options.token === false ? null : { profileDocId: 'session' }, readShiftCreatorNames,
  );
  let status = 200;
  let body: any;
  await handler({ params: { outletId: 'shop' }, query: options.query ?? { startDate: '2026-10-01', endDate: '2026-10-31' } }, {
    status(value: number) { status = value; return this; }, json(value: unknown) { body = value; },
  });
  return { status, body, dayReads, batches, collections };
}

test('requested month/outlet is scoped and repeated creators use one projected batch', async () => {
  const result = await report();
  assert.equal(result.status, 200);
  assert.deepEqual([...result.dayReads].sort(), Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`));
  assert.deepEqual(result.batches, [['owner']]);
  assert.deepEqual(result.body.data.shifts.map((shift: any) => [shift.id, shift.userId, shift.creatorName]), [
    ['last', 'owner', 'Shift Owner'], ['first', 'owner', 'Shift Owner'],
  ]);
  assert.ok(!JSON.stringify(result.body).includes('PRIVATE'));
  assert.ok(!JSON.stringify(result.body).includes('Session Name'));
});

test('authorization failures perform no shift or creator reads', async () => {
  for (const options of [{ token: false }, { active: false }, { authorized: false }, { profileExists: false }]) {
    const result = await report(options);
    assert.equal(result.status, options.token === false ? 401 : 403);
    assert.deepEqual(result.dayReads, []);
    assert.deepEqual(result.batches, []);
  }
});

test('day precedence, shift number and case-insensitive device filters apply before creator lookup', async () => {
  const result = await report({ shifts: [...sample,
    { ...sample[0]!, id: 'wrong-shift', shiftNo: 3, userId: 'excluded-shift' },
    { ...sample[0]!, id: 'wrong-device', deviceId: 'Other', userId: 'excluded-device' },
  ], query: { startDate: '2026-11-01', endDate: '2026-11-02', dayId: '2026-10-01', shiftNo: '1', deviceId: ' COUNTER-a ' } });
  assert.deepEqual(result.dayReads, ['2026-10-01']);
  assert.deepEqual(result.body.data.shifts.map((shift: any) => shift.id), ['first']);
  assert.deepEqual(result.batches, [['owner']]);
  for (const query of [{ shiftNo: '9' }, { deviceId: 'absent' }]) {
    const empty = await report({ query: { startDate: '2026-10-01', endDate: '2026-10-31', ...query } });
    assert.deepEqual(empty.body.data.shifts, []);
    assert.deepEqual(empty.batches, []);
    assert.deepEqual(empty.body.data.summary, { totalShifts: 0, totalBills: 0, totalSale: 0, cashSale: 0, digitalSale: 0, creditSale: 0, expenses: 0 });
  }
});

test('bill IDs retain finite numeric zero and payments match Dashboard normalization', async () => {
  const result = await report();
  const [last, first] = result.body.data.shifts;
  assert.deepEqual([first.startBillNo, first.lastBillNo, last.startBillNo, last.lastBillNo], ['0', '42', '', '']);
  assert.deepEqual(first.payments, { cash: 12, zero: 0, invalid: 0, infinite: 0, nan: 0 });
  assert.deepEqual(last.payments, { card: 7, invalid: 0 });
  const variants = await report({ shifts: [
    { ...sample[0]!, startBillNo: 'A001', lastBillNo: NaN, payments: null, paymentJson: { cash: 3, invalid: false } },
    { ...sample[1]!, startBillNo: false, lastBillNo: {}, payments: 'invalid', paymentJson: 'broken' },
  ] });
  assert.deepEqual(variants.body.data.shifts.map((shift: any) => [shift.startBillNo, shift.lastBillNo, shift.payments]), [
    ['', '', {}], ['A001', '', { cash: 3, invalid: 0 }],
  ]);
});

test('every sales metric and exact summary formula remain unchanged', async () => {
  const result = await report();
  for (const shift of result.body.data.shifts) {
    for (const key of metricNames) assert.equal(shift[key], sales[key], key);
  }
  const first = result.body.data.shifts.find((shift: any) => shift.id === 'first');
  assert.deepEqual([first.inActive, first.startTime, first.endTime, first.lastBillTime], [true, 1, 2, 3]);
  assert.deepEqual(result.body.data.summary, {
    totalShifts: 2, totalBills: 2, totalSale: 10, cashSale: 12, digitalSale: 14, creditSale: 16, expenses: 36,
  });
});

test('missing IDs, missing profiles and missing names use string fallbacks', async () => {
  const result = await report({ shifts: [undefined, null, '', 'missing', 'nameless'].map((userId, index) => ({
    ...sample[0]!, id: `shift-${index}`, shiftNo: index, userId,
  })) });
  assert.equal(result.status, 200);
  assert.deepEqual(result.batches, [['nameless', 'missing']]);
  assert.deepEqual(result.body.data.shifts.map((shift: any) => shift.userId), ['nameless', 'missing', 'Not Available', 'Not Available', 'Not Available']);
  assert.ok(result.body.data.shifts.every((shift: any) => shift.creatorName === 'Not Available'));
});

test('optional creator read failure preserves IDs, sales and successful response', async () => {
  const normal = await report();
  const failed = await report({ failNames: true });
  assert.equal(failed.status, 200);
  assert.deepEqual(failed.body.data.summary, normal.body.data.summary);
  assert.deepEqual(failed.body.data.shifts, normal.body.data.shifts.map((shift: any) => ({ ...shift, creatorName: 'Not Available' })));
});
