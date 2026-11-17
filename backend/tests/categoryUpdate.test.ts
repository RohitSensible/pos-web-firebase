import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { updateCategoryNames, CategoryUpdateError } from '../src/categoryUpdate.js';
class Ref {
  constructor(public path: string, public query = false) {}
  get id() { return this.path.split('/').at(-1)!; }
  collection(name: string) { return new Ref(`${this.path}/${name}`, true); }
  doc(id: string) { return new Ref(`${this.path}/${id}`); }
}
function fixture() {
  const records = new Map<string, Record<string, unknown>>([
    ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }],
    ['OUTLET/outlet/CATEGORY/c1', { id: 'c1', categoryNo: 13, name: 'Food', regionalName: '', dayType: 'Lunch', onlineSynced: true, selected: true, extra: { preserve: true } }],
    ['OUTLET/outlet/CATEGORY/c2', { id: 'c2', categoryNo: 14, name: 'Drinks' }],
    ['OUTLET/foreign/CATEGORY/c1', { name: 'Foreign', categoryNo: 99 }],
    ['OUTLET/outlet/PRODUCT/p1', { category: 'c1', name: 'Meal' }],
  ]);
  const reads: string[] = [];
  const updates: { path: string; fields: Record<string, unknown> }[] = [];
  const updateCalls: typeof updates = [];
  let fail = false;
  let retry: (() => void) | undefined;
  const db = {
    collection: (path: string) => new Ref(path, true),
    async runTransaction(callback: (transaction: unknown) => Promise<unknown>): Promise<unknown> {
      const pending: typeof updates = [];
      const result = await callback({
        get: async (ref: Ref) => {
          assert.equal(pending.length, 0); reads.push(ref.path);
          return ref.query ? { docs: [...records].filter(([path]) => path.startsWith(`${ref.path}/`) && path.split('/').length === ref.path.split('/').length + 1)
            .map(([path, fields]) => ({ id: path.split('/').at(-1)!, data: () => fields })) }
            : { data: () => records.get(ref.path) };
        },
        update: (ref: Ref, fields: Record<string, unknown>) => {
          const update = { path: ref.path, fields };
          updateCalls.push(update); pending.push(update);
        },
      });
      if (retry) {
        const conflict = retry; retry = undefined; conflict();
        return this.runTransaction(callback);
      }
      if (fail) throw new Error('database failure');
      for (const update of pending) {
        assert.ok(records.has(update.path), 'updates cannot create records');
        records.set(update.path, { ...records.get(update.path), ...update.fields }); updates.push(update);
      }
      return result;
    },
  };
  return { db: db as unknown as Firestore, records, reads, updates, updateCalls,
    fail: () => { fail = true; }, retryBeforeCommit: (conflict: () => void) => { retry = conflict; } };
}
const assigned = (profile: Record<string, unknown>) => profile.outlets as string[];
const names = { name: ' Food Updated ', regionalName: ' Local ' };

for (const input of [{ name: 'Food', regionalName: '' }, { name: ' Food ', regionalName: ' ' }]) {
  test(`unchanged parsed names skip update calls: ${JSON.stringify(input)}`, async () => {
    const f = fixture(); const before = structuredClone(f.records);
    const result = await updateCategoryNames(f.db, 'outlet', 'c1', 'user', assigned, input);
    assert.deepEqual(result, { id: 'c1', name: 'Food', regionalName: '' });
    assert.deepEqual(f.reads, ['USER_PROFILE/user', 'OUTLET/outlet/CATEGORY']);
    assert.deepEqual(f.updateCalls, []); assert.deepEqual(f.records, before);
  });
}

for (const input of [
  { name: 'New Food', regionalName: '' },
  { name: 'Food', regionalName: 'Local' },
  { name: 'New Food', regionalName: 'Local' },
  { name: 'food', regionalName: '' },
]) {
  test(`changed names submit exactly one update: ${JSON.stringify(input)}`, async () => {
    const f = fixture(); const expected = structuredClone(f.records);
    expected.set('OUTLET/outlet/CATEGORY/c1', { ...expected.get('OUTLET/outlet/CATEGORY/c1'), ...input });
    assert.deepEqual(await updateCategoryNames(f.db, 'outlet', 'c1', 'user', assigned, input), { id: 'c1', ...input });
    assert.deepEqual(f.updateCalls, [{ path: 'OUTLET/outlet/CATEGORY/c1', fields: input }]);
    assert.deepEqual(f.records, expected);
  });
}

for (const value of [undefined, null, 0, false]) {
  test(`stored regionalName ${String(value)} is distinct from an empty string`, async () => {
    const f = fixture(); const stored = f.records.get('OUTLET/outlet/CATEGORY/c1')!;
    if (value === undefined) delete stored.regionalName; else stored.regionalName = value;
    const input = { name: 'Food', regionalName: '' };
    await updateCategoryNames(f.db, 'outlet', 'c1', 'user', assigned, input);
    assert.deepEqual(f.updateCalls, [{ path: 'OUTLET/outlet/CATEGORY/c1', fields: input }]);
    await updateCategoryNames(f.db, 'outlet', 'c1', 'user', assigned, input);
    assert.equal(f.updateCalls.length, 1);
  });
}

test('unchanged names still reject an existing duplicate after the normal reads', async () => {
  const f = fixture(); f.records.get('OUTLET/outlet/CATEGORY/c2')!.name = ' FOOD ';
  const before = structuredClone(f.records);
  await assert.rejects(updateCategoryNames(f.db, 'outlet', 'c1', 'user', assigned,
    { name: 'Food', regionalName: '' }), { status: 409 });
  assert.deepEqual(f.reads, ['USER_PROFILE/user', 'OUTLET/outlet/CATEGORY']);
  assert.deepEqual(f.updateCalls, []); assert.deepEqual(f.records, before);
});

test('updates only both names on the selected document and preserves all other fields and records', async () => {
  const f = fixture(); const expected = structuredClone(f.records);
  const result = await updateCategoryNames(f.db, 'outlet', 'c1', 'user', assigned, names);
  assert.deepEqual(result, { id: 'c1', name: 'Food Updated', regionalName: 'Local' });
  assert.deepEqual(f.updates, [{ path: 'OUTLET/outlet/CATEGORY/c1', fields: { name: 'Food Updated', regionalName: 'Local' } }]);
  expected.set('OUTLET/outlet/CATEGORY/c1', { ...expected.get('OUTLET/outlet/CATEGORY/c1'), name: 'Food Updated', regionalName: 'Local' });
  assert.deepEqual(f.records, expected);
  await updateCategoryNames(f.db, 'outlet', 'c1', 'user', assigned, { name: 'Food Updated', regionalName: '' });
  assert.equal(f.records.get('OUTLET/outlet/CATEGORY/c1')!.regionalName, '');
  assert.equal(f.records.get('OUTLET/outlet/CATEGORY/c1')!.dayType, 'Lunch');
});

test('number, ID and other field injection, invalid names and duplicates never write', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  for (const raw of [{ ...names, categoryNo: 999 }, { ...names, id: 'bad' }, { ...names, onlineSynced: false },
    { name: '', regionalName: '' }, { name: 'a'.repeat(201), regionalName: '' }, { name: 'New', regionalName: null },
    { name: 'New' }, { name: ' drinks ', regionalName: '' }]) {
    await assert.rejects(updateCategoryNames(f.db, 'outlet', 'c1', 'user', assigned, raw), error => error instanceof CategoryUpdateError && [409, 422].includes(error.status));
  }
  assert.deepEqual(f.updates, []); assert.deepEqual(f.records, before);
});

test('missing sessions, inactive users, foreign outlets and invalid paths cannot update categories', async () => {
  const f = fixture();
  for (const [outlet, id, user, status] of [['outlet', 'c1', null, 401], ['foreign', 'c1', 'user', 403],
    ['outlet', 'c1', 'missing', 403], ['outlet', 'a/b', 'user', 400], ['a/b', 'c1', 'user', 400]] as const) {
    await assert.rejects(updateCategoryNames(f.db, outlet, id, user, assigned, names), error => error instanceof CategoryUpdateError && error.status === status);
  }
  f.records.set('USER_PROFILE/user', { active: false, outlets: ['outlet'] });
  await assert.rejects(updateCategoryNames(f.db, 'outlet', 'c1', 'user', assigned, names), error => error instanceof CategoryUpdateError && error.status === 403);
  assert.ok(f.reads.every(path => path.startsWith('USER_PROFILE/'))); assert.deepEqual(f.updates, []);
});

test('missing/deleted category cannot be recreated by update', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  await assert.rejects(updateCategoryNames(f.db, 'outlet', 'absent', 'user', assigned, names), error => error instanceof CategoryUpdateError && error.status === 404);
  assert.deepEqual(f.records, before); assert.deepEqual(f.updates, []);
});

test('failed transaction leaves names intact; retry of the same names does not duplicate categories', async () => {
  const f = fixture(); const before = structuredClone(f.records); f.fail();
  await assert.rejects(updateCategoryNames(f.db, 'outlet', 'c1', 'user', assigned, names), /database failure/);
  assert.deepEqual(f.records, before);
  const good = fixture(); await updateCategoryNames(good.db, 'outlet', 'c1', 'user', assigned, names);
  const saved = structuredClone(good.records);
  await updateCategoryNames(good.db, 'outlet', 'c1', 'user', assigned, names);
  assert.deepEqual(good.records, saved); assert.equal(good.updateCalls.length, 1);
});

test('transaction retry rechecks an initially unchanged category against fresh values', async () => {
  const f = fixture(); const input = { name: 'Food', regionalName: '' };
  f.retryBeforeCommit(() => { f.records.get('OUTLET/outlet/CATEGORY/c1')!.name = 'Concurrent'; });
  assert.deepEqual(await updateCategoryNames(f.db, 'outlet', 'c1', 'user', assigned, input), { id: 'c1', ...input });
  assert.deepEqual(f.reads, ['USER_PROFILE/user', 'OUTLET/outlet/CATEGORY', 'USER_PROFILE/user', 'OUTLET/outlet/CATEGORY']);
  assert.deepEqual(f.updateCalls, [{ path: 'OUTLET/outlet/CATEGORY/c1', fields: input }]);
  assert.equal(f.updates.length, 1);
});

test('transaction retry skips the update when another writer already saved the requested names', async () => {
  const f = fixture(); const input = { name: 'New Food', regionalName: 'Local' };
  f.retryBeforeCommit(() => { Object.assign(f.records.get('OUTLET/outlet/CATEGORY/c1')!, input); });
  assert.deepEqual(await updateCategoryNames(f.db, 'outlet', 'c1', 'user', assigned, input), { id: 'c1', ...input });
  assert.equal(f.reads.length, 4); assert.equal(f.updateCalls.length, 1);
  assert.deepEqual(f.updates, [], 'the abandoned attempt must not commit');
});

test('transaction retry revalidates authorization before an unchanged return', async () => {
  const f = fixture(); const input = { name: 'Food', regionalName: '' };
  f.retryBeforeCommit(() => { f.records.get('USER_PROFILE/user')!.active = false; });
  await assert.rejects(updateCategoryNames(f.db, 'outlet', 'c1', 'user', assigned, input), { status: 403 });
  assert.deepEqual(f.reads, ['USER_PROFILE/user', 'OUTLET/outlet/CATEGORY', 'USER_PROFILE/user']);
  assert.deepEqual(f.updateCalls, []);
});
