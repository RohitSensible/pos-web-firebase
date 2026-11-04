import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestedReplenishment, stockVariance } from '../src/pages/stockPlanning.ts';
const product = patch => ({ productId: 'rice', code: '1', name: 'Rice', tracked: true, currentStock: 2, reorderLevel: 10, ...patch });
test('replenishment includes only tracked finite shortages with an explicit target', () => {
  const rows = suggestedReplenishment([product({}), product({ productId: 'over', currentStock: 12 }), product({ productId: 'untracked', tracked: false }),
    product({ productId: 'no-level', reorderLevel: 0 }), product({ productId: 'bad', currentStock: NaN })]);
  assert.deepEqual(rows.map(row => [row.productId, row.suggested]), [['rice', 8]]);
});
test('replenishment handles negative stock and fractional gaps without floating point under-ordering', () => {
  assert.equal(suggestedReplenishment([product({ currentStock: -2 })])[0].suggested, 12);
  assert.equal(suggestedReplenishment([product({ currentStock: 0.1, reorderLevel: 0.3 })])[0].suggested, 0.2);
  assert.equal(suggestedReplenishment([product({ currentStock: 0.0001, reorderLevel: 0.002 })])[0].suggested, 0.002);
});
test('count comparison accepts zero, exposes shortages and rejects invalid physical counts', () => {
  assert.equal(stockVariance(3, '0'), -3); assert.equal(stockVariance(3, '3'), 0); assert.equal(stockVariance(-2, '2.125'), 4.125);
  for (const value of ['', ' ', '-1', 'Infinity', 'NaN', '1.0001', '1e3', '1000000001']) assert.equal(stockVariance(3, value), null);
  assert.equal(stockVariance(NaN, '1'), null);
  assert.equal(stockVariance(1.0001, '1'), -0.0001, 'small differences must not be marked as matching');
});
