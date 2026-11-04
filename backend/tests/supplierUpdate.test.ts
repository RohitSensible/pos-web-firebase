import assert from 'node:assert/strict';
import test from 'node:test';
import { updateOutletSupplier } from '../src/suppliers.js';
import type { PremisesTransactionRunner, TypedFields } from '../src/premises.js';

const path = 'OUTLET/outlet/SUPPLIER/supplier';
const fields = { name: 'Original', mobile: '5874253698', address: '', email: '', gstin: 'Search Code', alternateNumber: '123456', id: null };
const input = { fields: { name: 'Updated', email: 'supplier@example.com' }, previous: { name: fields.name, email: fields.email } };
function fixture() {
  const records = new Map<string, Record<string, unknown>>([
    ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }], ['OUTLET/outlet', { active: true }], [path, structuredClone(fields)],
    ['OUTLET/outlet/GOODS_RECEIVED/receipt', { supplier: { ...fields, id: 'supplier', alternateNumber: null } }],
    ['OUTLET/outlet/PRODUCT/product', { currentStock: 80 }],
  ]);
  const writes: { path: string; fields: TypedFields }[] = [];
  let fail = false;
  const run: PremisesTransactionRunner = async work => {
    const pending: typeof writes = [];
    const result = await work({ read: async key => structuredClone(records.get(key)),
      list: async () => { throw new Error('No lists needed'); }, create: () => { throw new Error('No creates permitted'); },
      update: (key, patch) => pending.push({ path: key, fields: patch }) });
    if (fail) throw new Error('Commit failed');
    for (const update of pending) {
      records.set(update.path, { ...records.get(update.path), ...Object.fromEntries(Object.entries(update.fields).map(([key, value]) => {
        assert.ok('stringValue' in value); return [key, value.stringValue];
      })) });
      writes.push(update);
    }
    return result;
  };
  return { records, writes, fail: () => { fail = true; },
    save: (body: unknown = input, outlet = 'outlet', user: string | null = 'user', id = 'supplier') =>
      updateOutletSupplier(run, outlet, id, user, profile => profile.outlets as string[], body) };
}

test('supplier edits patch only selected existing fields and preserve identity, alternate number and receipt snapshots', async () => {
  const f = fixture(), before = structuredClone(f.records);
  const result = await f.save();
  assert.equal(result.documentId, 'supplier');
  assert.deepEqual(f.writes, [{ path, fields: { name: { stringValue: 'Updated' }, email: { stringValue: 'supplier@example.com' } } }]);
  assert.deepEqual(f.records.get(path), { ...fields, ...input.fields });
  for (const [key, value] of before) if (key !== path) assert.deepEqual(f.records.get(key), value);
  await f.save(); assert.equal(f.writes.length, 1, 'A lost-response retry performs no second write');
});

test('stale supplier edits cannot overwrite newer values, including on a later retry', async () => {
  const f = fixture(); f.records.get(path)!.name = 'Changed elsewhere';
  await assert.rejects(f.save(), /Supplier details changed/); assert.equal(f.writes.length, 0);
  const g = fixture(); await g.save(); g.records.get(path)!.name = 'Newer edit';
  await assert.rejects(g.save(), /Supplier details changed/); assert.equal(g.records.get(path)!.name, 'Newer edit');
});

test('supplier updates reject unsupported fields, missing original values, invalid types and invalid IDs', async () => {
  for (const body of [
    { fields: { balance: 1 }, previous: { balance: 0 } }, { fields: { id: null }, previous: { id: null } },
    { fields: { name: ' ' }, previous: { name: 'Original' } }, { fields: { mobile: 1 }, previous: { mobile: fields.mobile } },
    { fields: {}, previous: {} }, { fields: { name: 'Updated' }, previous: {} }, { ...input, unrelated: true },
  ]) {
    const f = fixture(); await assert.rejects(f.save(body)); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); await assert.rejects(f.save(input, 'outlet', 'user', '../invalid')); assert.equal(f.writes.length, 0);
});

test('supplier update checks the signed profile, assigned outlet, active outlet and existing document', async () => {
  for (const mode of ['session', 'foreign', 'inactive-profile', 'inactive-outlet', 'missing']) {
    const f = fixture();
    if (mode === 'inactive-profile') f.records.get('USER_PROFILE/user')!.active = false;
    if (mode === 'inactive-outlet') f.records.get('OUTLET/outlet')!.active = false;
    if (mode === 'missing') f.records.delete(path);
    await assert.rejects(f.save(input, mode === 'foreign' ? 'other' : 'outlet', mode === 'session' ? null : 'user'));
    assert.equal(f.writes.length, 0);
  }
});

test('failed supplier update commit leaves the in-memory records unchanged', async () => {
  const f = fixture(), before = structuredClone(f.records); f.fail();
  await assert.rejects(f.save(), /Commit failed/); assert.deepEqual(f.records, before);
});
