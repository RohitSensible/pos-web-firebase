import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { listOutletEmployees, createOutletEmployee, updateOutletEmployee } from '../src/employees.js';

const assigned = (profile: Record<string, unknown>) => [...new Set([
  ...(Array.isArray(profile.outlets) ? profile.outlets : []),
  ...(Array.isArray(profile.outletList) ? profile.outletList : []), profile.outletId,
].filter((id): id is string => typeof id === 'string'))];
const employee = { name: 'Existing Person', mobile: '9876543210', searchCode: 1, shortName: 'E',
  balanceAmt: '0', dateOfJoining: '2026-10-19', userId: '', id: null, allowadvancepayment: false };
const draft = { requestId: '11111111-1111-4111-8111-111111111111', name: 'New Person', mobile: '+91 98765 43211',
  searchCode: 2, shortName: 'N', balanceAmt: '25.50', dateOfJoining: '2026-10-19', userId: 'colleague' };
function fixture() {
  const records = new Map<string, Record<string, unknown>>([
    ['OUTLET/outlet', { active: true }], ['OUTLET/foreign', { active: true }],
    ['USER_PROFILE/current', { active: true, outletId: 'outlet', name: 'Signed User', quickPin: 'SECRET' }],
    ['USER_PROFILE/colleague', { active: true, outlets: ['outlet'], outletList: ['outlet'], name: 'Colleague', quickPin: 'SECRET' }],
    ['USER_PROFILE/foreign-user', { active: true, outletId: 'foreign', name: 'Foreign User' }],
    ['USER_PROFILE/inactive', { active: false, outletId: 'outlet', name: 'Inactive User' }],
    ['OUTLET/outlet/EMPLOYEE/existing', structuredClone(employee)],
    ['OUTLET/foreign/EMPLOYEE/other', { ...employee, name: 'Foreign Person' }],
  ]);
  const reads: string[] = [], writes: { path: string; fields: Record<string, unknown> }[] = [];
  const updateCalls: typeof writes = [];
  let failCommit = false;
  let retry: (() => void) | undefined;
  function collection(path: string, filters: [string, string, unknown][] = [], fields?: string[]): any {
    return { path, isCollection: true,
      doc: (id: string) => doc(`${path}/${id}`),
      where: (key: string, op: string, value: unknown) => collection(path, [...filters, [key, op, value]], fields),
      select: (...selected: string[]) => collection(path, filters, selected),
      get: async () => {
        reads.push(path);
        const docs = [...records].filter(([key, value]) => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1
          && filters.every(([field, op, expected]) => op === 'array-contains' ? Array.isArray(value[field]) && value[field].includes(expected) : value[field] === expected))
          .map(([key, value]) => {
            const saved = structuredClone(value);
            return { id: key.split('/').at(-1), data: () => fields ? Object.fromEntries(fields.filter(f => f in saved).map(f => [f, saved[f]])) : structuredClone(saved) };
          });
        return { docs, size: docs.length, empty: !docs.length };
      },
    };
  }
  function doc(path: string): any {
    return { path, id: path.split('/').at(-1), collection: (name: string) => collection(`${path}/${name}`),
      get: async () => {
        reads.push(path); const exists = records.has(path), saved = structuredClone(records.get(path));
        return { exists, data: () => structuredClone(saved) };
      },
    };
  }
  const db = { collection,
    runTransaction: async (work: (tx: unknown) => unknown): Promise<unknown> => {
      for (;;) {
        const pending: { path: string; fields: Record<string, unknown> }[] = [];
        const result = await work({ get: (ref: any) => ref.get(), create: (ref: any, fields: Record<string, unknown>) => {
          assert.ok(!records.has(ref.path), 'Never overwrite existing employee'); pending.push({ path: ref.path, fields });
        }, update: (ref: any, fields: Record<string, unknown>) => {
          assert.ok(records.has(ref.path), 'Only update existing employees');
          updateCalls.push({ path: ref.path, fields: structuredClone(fields) });
          pending.push({ path: ref.path, fields: { ...records.get(ref.path), ...fields } });
        } });
        if (retry) {
          const conflict = retry; retry = undefined; conflict();
          continue;
        }
        if (failCommit) throw new Error('DATABASE FAILURE');
        for (const write of pending) { records.set(write.path, structuredClone(write.fields)); writes.push(write); }
        return result;
      }
    },
  } as unknown as Firestore;
  return { db, records, reads, writes, updateCalls, fail: () => { failCommit = true; },
    retryBeforeCommit: (conflict: () => void) => { retry = conflict; } };
}
test('lists only the authorized outlet pool and safe assigned account options', async () => {
  const f = fixture(); const result = await listOutletEmployees(f.db, 'outlet', 'current', assigned);
  assert.deepEqual(result.employees, [{ documentId: 'existing', ...Object.fromEntries(Object.entries(employee).filter(([key]) => !['id', 'allowadvancepayment'].includes(key))) }]);
  assert.equal(result.nextSearchCode, 2);
  assert.deepEqual(result.userAccounts.map(row => row.userId).sort(), ['colleague', 'current']);
  assert.ok(!JSON.stringify(result).includes('SECRET')); assert.deepEqual(f.writes, []);
});
test('empty list provides the first search code and does not create records', async () => {
  const f = fixture(); f.records.delete('OUTLET/outlet/EMPLOYEE/existing');
  const result = await listOutletEmployees(f.db, 'outlet', 'current', assigned);
  assert.deepEqual(result.employees, []); assert.equal(result.nextSearchCode, 1); assert.deepEqual(f.writes, []);
});
test('creates exactly the established nine-field employee document without changing other records', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  const result = await createOutletEmployee(f.db, 'outlet', 'current', assigned, draft);
  assert.equal(f.writes.length, 1); assert.match(result.documentId, /^[a-z0-9]{20}$/);
  assert.equal(f.writes[0]!.path, `OUTLET/outlet/EMPLOYEE/${result.documentId}`);
  const { requestId: _requestId, ...fields } = draft;
  assert.deepEqual(f.writes[0]!.fields, { ...fields, id: result.documentId, allowadvancepayment: false });
  for (const [path, original] of before) assert.deepEqual(f.records.get(path), original);
  const listed = await listOutletEmployees(f.db, 'outlet', 'current', assigned);
  assert.ok(listed.employees.some(row => row.documentId === result.documentId));
});
test('retrying a confirmed save does not duplicate the employee or overwrite changes', async () => {
  const f = fixture(); const first = await createOutletEmployee(f.db, 'outlet', 'current', assigned, draft);
  assert.deepEqual(await createOutletEmployee(f.db, 'outlet', 'current', assigned, draft), first);
  assert.equal(f.writes.length, 1);
  await assert.rejects(createOutletEmployee(f.db, 'outlet', 'current', assigned, { ...draft, name: 'Changed' }), { status: 409 });
  assert.equal(f.writes.length, 1);
});
test('prevents duplicate search codes and normalized mobile numbers', async () => {
  for (const patch of [{ searchCode: 1 }, { mobile: '98765 43210' }]) {
    const f = fixture(); await assert.rejects(createOutletEmployee(f.db, 'outlet', 'current', assigned, { ...draft, ...patch }), { status: 409 });
    assert.deepEqual(f.writes, []);
  }
});
test('rejects unauthenticated, inactive, unassigned or missing outlet access', async () => {
  for (const [outlet, user, status] of [['outlet', null, 401], ['foreign', 'current', 403], ['outlet', 'inactive', 403], ['outlet', 'missing', 403], ['bad/path', 'current', 400]] as const) {
    const f = fixture();
    await assert.rejects(listOutletEmployees(f.db, outlet, user, assigned), { status });
    await assert.rejects(createOutletEmployee(f.db, outlet, user, assigned, draft), { status });
    assert.deepEqual(f.writes, []);
  }
  const f = fixture(); f.records.delete('OUTLET/outlet');
  await assert.rejects(listOutletEmployees(f.db, 'outlet', 'current', assigned), { status: 404 });
  await assert.rejects(createOutletEmployee(f.db, 'outlet', 'current', assigned, draft), { status: 404 });
});
test('assignments are limited to active accounts belonging to the same outlet', async () => {
  for (const userId of ['foreign-user', 'inactive', 'missing']) {
    const f = fixture(); await assert.rejects(createOutletEmployee(f.db, 'outlet', 'current', assigned, { ...draft, userId }), { status: 422 }); assert.deepEqual(f.writes, []);
  }
  const f = fixture(); await createOutletEmployee(f.db, 'outlet', 'current', assigned, { ...draft, userId: '' }); assert.equal(f.writes.length, 1);
});
test('validates required fields, dates, balances and protected fields', async () => {
  for (const patch of [{ name: '' }, { mobile: '' }, { mobile: 'bad' }, { mobile: '---' }, { shortName: '' }, { balanceAmt: 'NaN' },
    { dateOfJoining: '2026-02-30' }, { searchCode: 0 }, { searchCode: 1.2 }, { type: 'captain' }, { allowadvancepayment: true }, { id: 'other' }]) {
    const f = fixture(); await assert.rejects(createOutletEmployee(f.db, 'outlet', 'current', assigned, { ...draft, ...patch }), { status: 422 }); assert.deepEqual(f.writes, []);
  }
});
test('failed database commit is not reported as a successful create', async () => {
  const f = fixture(); f.fail();
  await assert.rejects(createOutletEmployee(f.db, 'outlet', 'current', assigned, draft), /DATABASE FAILURE/);
  assert.deepEqual(f.writes, []); assert.equal(f.records.size, 8);
});

const { requestId: _updateRequest, ...updateFields } = draft;
const { id: _employeeId, allowadvancepayment: _employeeAdvance, ...existingFields } = employee;
const employeePath = 'OUTLET/outlet/EMPLOYEE/existing';

test('unchanged employee fields return the existing response without attempted updates', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  assert.deepEqual(await updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, existingFields),
    { documentId: 'existing', ...existingFields });
  assert.deepEqual(f.reads, ['USER_PROFILE/current', 'OUTLET/outlet', employeePath, 'OUTLET/outlet/EMPLOYEE']);
  assert.deepEqual(f.updateCalls, []); assert.deepEqual(f.writes, []); assert.deepEqual(f.records, before);
});

test('existing input trimming still runs before the exact stored-value comparison', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  const input = { ...existingFields, name: ' Existing Person ', mobile: ' 9876543210 ', shortName: ' E ', balanceAmt: ' 0 ' };
  assert.deepEqual(await updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, input),
    { documentId: 'existing', ...existingFields });
  assert.deepEqual(f.updateCalls, []); assert.deepEqual(f.records, before);
});

for (const [field, value] of [
  ['name', 'Edited Person'], ['mobile', '9876543211'], ['searchCode', 3], ['shortName', 'EP'],
  ['balanceAmt', '25.50'], ['dateOfJoining', ''], ['userId', 'colleague'],
] as const) {
  test(`changing only ${field} submits one update with the complete seven-field payload`, async () => {
    const f = fixture(); const input = { ...existingFields, [field]: value };
    const before = structuredClone(f.records);
    assert.deepEqual(await updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, input),
      { documentId: 'existing', ...input });
    assert.deepEqual(f.updateCalls, [{ path: employeePath, fields: input }]); assert.equal(f.writes.length, 1);
    before.set(employeePath, { ...employee, ...input }); assert.deepEqual(f.records, before);
    assert.equal(typeof f.records.get(employeePath)!.balanceAmt, 'string');
  });
}

test('multiple changed fields write once and preserve protected and unrelated stored fields', async () => {
  const f = fixture();
  Object.assign(f.records.get(employeePath)!, { id: 'legacy-id', allowadvancepayment: true,
    extra: { values: [0, false, null, ''] }, updatedAt: 'existing-timestamp' });
  const before = structuredClone(f.records);
  const input = { ...existingFields, name: 'Changed', balanceAmt: '-100.00', userId: 'colleague' };
  await updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, input);
  assert.deepEqual(f.updateCalls, [{ path: employeePath, fields: input }]); assert.equal(f.writes.length, 1);
  before.set(employeePath, { ...before.get(employeePath), ...input }); assert.deepEqual(f.records, before);
});

for (const field of ['dateOfJoining', 'userId'] as const) {
  for (const stored of [undefined, null, false, 0]) {
    test(`stored ${field} ${String(stored)} is distinct from a submitted empty string`, async () => {
      const f = fixture();
      if (stored === undefined) delete f.records.get(employeePath)![field]; else f.records.get(employeePath)![field] = stored;
      const input = { ...existingFields, [field]: '' };
      await updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, input);
      assert.deepEqual(f.updateCalls, [{ path: employeePath, fields: input }]); assert.equal(f.writes.length, 1);
      await updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, input);
      assert.equal(f.updateCalls.length, 1);
    });
  }
}

for (const stored of [undefined, null, false, 0, '', '0.00']) {
  test(`stored balanceAmt ${JSON.stringify(stored)} is distinct from the string zero`, async () => {
    const f = fixture();
    if (stored === undefined) delete f.records.get(employeePath)!.balanceAmt; else f.records.get(employeePath)!.balanceAmt = stored;
    await updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, existingFields);
    assert.deepEqual(f.updateCalls, [{ path: employeePath, fields: existingFields }]);
    assert.equal(f.records.get(employeePath)!.balanceAmt, '0');
  });
}

test('balance strings with equal numeric values retain their distinct representation', async () => {
  const f = fixture(); f.records.get(employeePath)!.balanceAmt = '100';
  const input = { ...existingFields, balanceAmt: '100.00' };
  await updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, input);
  assert.deepEqual(f.updateCalls, [{ path: employeePath, fields: input }]);
  assert.equal(f.records.get(employeePath)!.balanceAmt, '100.00');
});

for (const patch of [{ name: 'existing person' }, { mobile: '98765 43210' }, { searchCode: '1' }]) {
  test(`raw stored fields are compared without case, mobile or type coercion: ${JSON.stringify(patch)}`, async () => {
    const f = fixture(); Object.assign(f.records.get(employeePath)!, patch);
    await updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, existingFields);
    assert.deepEqual(f.updateCalls, [{ path: employeePath, fields: existingFields }]);
  });
}

for (const patch of [{ searchCode: 1, mobile: '9876543211' }, { searchCode: 2, mobile: '98765 43210' }]) {
  test(`unchanged target fields still reject another employee's duplicate: ${JSON.stringify(patch)}`, async () => {
    const f = fixture(); f.records.set('OUTLET/outlet/EMPLOYEE/duplicate', { ...employee, ...patch });
    const before = structuredClone(f.records);
    await assert.rejects(updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, existingFields), { status: 409 });
    assert.deepEqual(f.updateCalls, []); assert.deepEqual(f.records, before);
  });
}

test('unchanged assigned user is still read and validated', async () => {
  const f = fixture(); const input = { ...existingFields, userId: 'colleague' };
  Object.assign(f.records.get(employeePath)!, input);
  await updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, input);
  assert.deepEqual(f.reads, ['USER_PROFILE/current', 'OUTLET/outlet', employeePath, 'OUTLET/outlet/EMPLOYEE', 'USER_PROFILE/colleague']);
  assert.deepEqual(f.updateCalls, []);
});

for (const userId of ['inactive', 'missing', 'foreign-user']) {
  test(`unchanged user assignment ${userId} still rejects invalid access`, async () => {
    const f = fixture(); f.records.get(employeePath)!.userId = userId;
    await assert.rejects(updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned,
      { ...existingFields, userId }), { status: 422 });
    assert.deepEqual(f.updateCalls, []);
  });
}

test('unchanged input still requires authorization and existing outlet and employee records', async () => {
  for (const profile of [null, 'inactive', 'missing']) {
    const f = fixture();
    await assert.rejects(updateOutletEmployee(f.db, 'outlet', 'existing', profile, assigned, existingFields),
      { status: profile === null ? 401 : 403 });
    assert.deepEqual(f.updateCalls, []);
  }
  for (const path of ['OUTLET/outlet', employeePath]) {
    const f = fixture(); f.records.delete(path);
    await assert.rejects(updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, existingFields), { status: 404 });
    assert.deepEqual(f.updateCalls, []);
  }
});

test('employee updates retain strict input types and reject protected fields', async () => {
  for (const patch of [{ balanceAmt: 0 }, { balanceAmt: null }, { balanceAmt: false }, { balanceAmt: '' },
    { searchCode: '1' }, { searchCode: 0 }, { dateOfJoining: null }, { userId: false },
    { name: '' }, { id: null }, { allowadvancepayment: false }]) {
    const f = fixture();
    await assert.rejects(updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned,
      { ...existingFields, ...patch }), { status: 422 });
    assert.deepEqual(f.reads, []); assert.deepEqual(f.updateCalls, []);
  }
});

test('retrying an already applied employee update skips a second attempted update', async () => {
  const f = fixture(); const input = { ...existingFields, name: 'Changed' };
  const first = await updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, input);
  assert.deepEqual(await updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, input), first);
  assert.equal(f.updateCalls.length, 1); assert.equal(f.writes.length, 1);
});

test('transaction retry rereads an initially unchanged employee and updates fresh differing values', async () => {
  const f = fixture(); f.retryBeforeCommit(() => { f.records.get(employeePath)!.name = 'Concurrent'; });
  await updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, existingFields);
  const attemptReads = ['USER_PROFILE/current', 'OUTLET/outlet', employeePath, 'OUTLET/outlet/EMPLOYEE'];
  assert.deepEqual(f.reads, [...attemptReads, ...attemptReads]);
  assert.deepEqual(f.updateCalls, [{ path: employeePath, fields: existingFields }]); assert.equal(f.writes.length, 1);
});

test('transaction retry abandons its first write and skips an update already applied by another writer', async () => {
  const f = fixture(); const input = { ...existingFields, name: 'Changed' };
  f.retryBeforeCommit(() => { Object.assign(f.records.get(employeePath)!, input); });
  assert.deepEqual(await updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, input),
    { documentId: 'existing', ...input });
  assert.equal(f.reads.length, 8); assert.deepEqual(f.updateCalls, [{ path: employeePath, fields: input }]);
  assert.deepEqual(f.writes, []); assert.equal(f.records.get(employeePath)!.name, 'Changed');
});

test('transaction retry rechecks authorization before an unchanged return', async () => {
  const f = fixture(); f.retryBeforeCommit(() => { f.records.get('USER_PROFILE/current')!.active = false; });
  await assert.rejects(updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, existingFields), { status: 403 });
  assert.equal(f.reads.length, 5); assert.deepEqual(f.updateCalls, []); assert.deepEqual(f.writes, []);
});

test('transaction retry rechecks employee existence and duplicates against fresh snapshots', async () => {
  for (const conflict of ['deleted', 'duplicate'] as const) {
    const f = fixture(); const input = { ...existingFields, name: 'Changed' };
    f.retryBeforeCommit(() => {
      if (conflict === 'deleted') f.records.delete(employeePath);
      else f.records.set('OUTLET/outlet/EMPLOYEE/duplicate', { ...employee, mobile: '9876543211' });
    });
    await assert.rejects(updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, input),
      { status: conflict === 'deleted' ? 404 : 409 });
    assert.equal(f.updateCalls.length, 1); assert.deepEqual(f.writes, []);
  }
});

test('employee edits retain the document ID and protected fields, and allow unchanged unique values', async () => {
  const f = fixture();
  const before = structuredClone(f.records);
  const { id: _id, allowadvancepayment: _advance, ...existing } = employee;
  const result = await updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, { ...existing, name: 'Edited Person' });
  assert.equal(result.documentId, 'existing');
  assert.equal(result.name, 'Edited Person');
  assert.deepEqual(f.records.get('OUTLET/outlet/EMPLOYEE/existing'), { ...employee, name: 'Edited Person' });
  assert.equal(f.records.size, before.size);
  for (const [path, original] of before) if (path !== 'OUTLET/outlet/EMPLOYEE/existing') assert.deepEqual(f.records.get(path), original);
});
test('employee updates reject duplicate values belonging to other employees', async () => {
  for (const patch of [{ searchCode: 2 }, { mobile: '+91 98765 43211' }]) {
    const f = fixture();
    await createOutletEmployee(f.db, 'outlet', 'current', assigned, draft);
    const writes = f.writes.length;
    const { id: _id, allowadvancepayment: _advance, ...existing } = employee;
    await assert.rejects(updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, { ...existing, ...patch }), { status: 409 });
    assert.equal(f.writes.length, writes);
  }
});
test('employee updates enforce access, record existence and account assignment', async () => {
  for (const [outlet, documentId, profile, fields, status] of [
    ['outlet', 'existing', null, updateFields, 401],
    ['foreign', 'other', 'current', updateFields, 403],
    ['outlet', 'missing', 'current', updateFields, 404],
    ['outlet', '../bad', 'current', updateFields, 400],
    ['outlet', 'existing', 'inactive', updateFields, 403],
    ['outlet', 'existing', 'current', { ...updateFields, userId: 'foreign-user' }, 422],
    ['outlet', 'existing', 'current', { ...updateFields, id: 'changed' }, 422],
  ] as const) {
    const f = fixture();
    await assert.rejects(updateOutletEmployee(f.db, outlet, documentId, profile, assigned, fields), { status });
    assert.deepEqual(f.writes, []);
  }
});
test('failed employee update commit leaves stored fields unchanged', async () => {
  const f = fixture(); f.fail();
  await assert.rejects(updateOutletEmployee(f.db, 'outlet', 'existing', 'current', assigned, updateFields), /DATABASE FAILURE/);
  assert.deepEqual(f.records.get('OUTLET/outlet/EMPLOYEE/existing'), employee);
});
