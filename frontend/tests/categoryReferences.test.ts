import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryReferenceMap } from '../../shared/categoryReferences.ts';

test('mobile names and web document IDs resolve to the same category without changing input', () => {
  const categories = Object.freeze([{ id: 'combo-id', name: 'COMBO' }, { id: 'food-id', name: 'Food' }]);
  const mobile = Object.freeze({ category: 'COMBO', type: 2, active: false, recipeId: 'dEBWQPggUeFmrrS47oE0', priceTable: '' });
  const before = JSON.stringify({ categories, mobile });
  const references = categoryReferenceMap(categories);
  for (const value of ['COMBO', 'combo', 'combo-id']) assert.equal(references.get(value), 'combo-id');
  assert.equal(references.get('Food'), 'food-id');
  assert.equal(references.get(mobile.category), 'combo-id');
  assert.equal(references.get('missing'), undefined);
  assert.equal(JSON.stringify({ categories, mobile }), before);
});

test('category IDs win over colliding names and ambiguous aliases are never assigned arbitrarily', () => {
  const references = categoryReferenceMap([{ id: 'COMBO', name: 'Other' }, { id: 'name-id', name: 'COMBO' },
    { id: 'a', name: 'Duplicate' }, { id: 'b', name: 'Duplicate' }]);
  assert.equal(references.get('COMBO'), 'COMBO');
  assert.equal(references.get('Duplicate'), undefined);
  assert.equal(references.get('a'), 'a');
  assert.equal(references.get('b'), 'b');
});

test('blank names do not capture unassigned products', () => {
  const references = categoryReferenceMap([{ id: 'empty', name: '   ' }]);
  assert.equal(references.get(''), undefined);
  assert.equal(references.get('   '), undefined);
  assert.equal(references.get('empty'), 'empty');
});
