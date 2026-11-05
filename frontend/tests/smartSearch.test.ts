import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSearchMatcher, normalizeSearch, rankSearchResults, searchRecords } from '../src/utils/smartSearch.ts';

const records = [
  { name: 'Plain Roti', code: '0012' },
  { name: 'Rotisserie', code: '12' },
  { name: 'Roti Roll', code: '001' },
  { name: 'Roti', code: '89' },
  { name: 'Tandoori Roti', code: '8901234567890' },
  { name: 'Carotino', code: '555' },
];
const fields = (row: typeof records[number]) => ({ text: [row.name], identifiers: [row.code] });
const names = (query: string) => searchRecords(records, query, fields).map(row => row.name);

test('exact names precede prefixes, whole words, and substrings with stable ties', () => {
  assert.deepEqual(names('Roti'), ['Roti', 'Rotisserie', 'Roti Roll', 'Plain Roti', 'Tandoori Roti', 'Carotino']);
});
test('matching ignores case, edge whitespace, and repeated whitespace in query and records', () => {
  assert.equal(names('  tAnDoOrI   RoTi  ')[0], 'Tandoori Roti');
  assert.equal(searchRecords([{ name: '  Tandoori  Roti ' }], 'tandoori roti', row => ({ text: [row.name] })).length, 1);
  assert.equal(normalizeSearch(123), '123');
});
test('identifiers retain leading zeroes and exact identifiers beat prefix matches', () => {
  assert.deepEqual(names('001'), ['Roti Roll', 'Plain Roti']);
  assert.deepEqual(names('8901234567890'), ['Tandoori Roti']);
});
test('full names outrank exact identifiers while both precede prefixes', () => {
  const data = [{ name: 'Food', code: 'Roti' }, { name: 'Roti Roll', code: '2' }, { name: 'Roti', code: '3' }];
  assert.deepEqual(searchRecords(data, 'roti', fields).map(row => row.name), ['Roti', 'Food', 'Roti Roll']);
});
test('exact primary names take precedence over matching categories or addresses', () => {
  const data = [{ name: 'Plain Roti', category: 'Roti' }, { name: 'Roti', category: 'Food' }];
  assert.deepEqual(searchRecords(data, 'Roti', row => ({ primary: [row.name], text: [row.name, row.category] })).map(row => row.name), ['Roti', 'Plain Roti']);
});
test('multi-word queries match actual words, including across configured fields, without fuzzy matches', () => {
  assert.deepEqual(names('roti tandoori'), ['Tandoori Roti']);
  assert.deepEqual(searchRecords([{ name: 'Tandoori', code: '12' }], '12 tandoori', fields).map(row => row.code), ['12']);
  assert.deepEqual(names('rotie'), []);
});
test('identifier punctuation remains significant; special characters are literal', () => {
  const data = [{ name: 'C language', code: '123' }, { name: 'C++', code: '123-4' }];
  assert.deepEqual(searchRecords(data, 'C++', fields).map(row => row.name), ['C++']);
  assert.deepEqual(searchRecords(data, '123-', fields).map(row => row.code), ['123-4']);
  assert.deepEqual(searchRecords(data, '[', fields), []);
});
test('existing concatenated product/code searches remain valid, including punctuation', () => {
  const data = [{ name: 'Roti/', code: '1', category: 'Food' }];
  assert.equal(searchRecords(data, 'oti/ 1', row => ({ primary: [row.name], text: [row.name, row.code, row.category], identifiers: [row.code] })).length, 1);
});
test('Unicode word boundaries support regional names', () => {
  const data = [{ name: 'तंदूरी रोटी' }, { name: 'रोटी' }, { name: 'रोटी रोल' }];
  assert.deepEqual(searchRecords(data, 'रोटी', row => ({ text: [row.name] })).map(row => row.name), ['रोटी', 'रोटी रोल', 'तंदूरी रोटी']);
});
test('empty queries restore the supplied default order', () => {
  assert.deepEqual(names('  '), records.map(row => row.name));
  assert.equal(createSearchMatcher(' ')(fields(records[0]!)), true);
});
test('ranking does not mutate or duplicate source records and retains unknown server matches', () => {
  const before = JSON.stringify(records);
  const result = rankSearchResults(records, 'Roti', fields);
  assert.equal(JSON.stringify(records), before);
  assert.equal(new Set(result).size, records.length);
  assert.equal(result.length, records.length);
  assert.deepEqual(rankSearchResults(records, 'server-only match', fields), records);
});
test('large lists are ranked before batching, including an exact record at the end', () => {
  const data = Array.from({ length: 20_000 }, (_, index) => ({ name: `Roti ${index}`, code: String(index) }));
  data.push({ name: 'Roti', code: 'last' });
  const started = performance.now();
  const result = searchRecords(data, 'roti', fields);
  assert.equal(result[0]!.code, 'last');
  assert.equal(result.length, data.length);
  console.log(`Ranked ${data.length} records in ${(performance.now() - started).toFixed(1)}ms`);
});
