import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { loadGoodsReceiptHistory } from '../src/goodsReceiptHistory.js';

function fixture() {
  const calls: unknown[][] = [];
  const instant = Date.parse('2026-11-04T00:00:00+05:30');
  const rows = Array.from({ length: 60 }, (_, i) => ({ id: `receipt${String(i).padStart(3, '0')}`, fields: { createDate: instant + Math.floor(i / 2) * 1000 } }));
  let authorized = true;
  const reference = (path: string): any => ({
    doc: (id: string) => reference(`${path}/${id}`), collection: (name: string) => reference(`${path}/${name}`),
    get: async () => {
      calls.push(['read', path]);
      assert(!path.endsWith('GOODS_RECEIVED'), 'no unbounded receipt reads');
      return { data: () => path.startsWith('USER_PROFILE') ? { active: true, outlets: authorized ? ['a'] : [] } : { active: true } };
    },
    where: (...args: unknown[]) => { calls.push(['where', ...args]); return query; },
  });
  let after: [number, string] | undefined, count = 0;
  const query: any = {
    where: (...args: unknown[]) => { calls.push(['where', ...args]); return query; },
    orderBy: (...args: unknown[]) => { calls.push(['orderBy', ...args]); return query; },
    startAfter: (date: number, id: string) => { after = [date, id]; calls.push(['startAfter', date, id]); return query; },
    limit: (value: number) => { count = value; calls.push(['limit', value]); return query; },
    get: async () => {
      assert(count > 0 && count <= 101);
      return { docs: rows.filter(row => !after || row.fields.createDate < after[0] || row.fields.createDate === after[0] && row.id < after[1])
        .sort((a, b) => b.fields.createDate - a.fields.createDate || b.id.localeCompare(a.id)).slice(0, count)
        .map(row => ({ id: row.id, data: () => row.fields })) };
    },
  };
  const db = { collection: reference } as unknown as Firestore;
  return { calls, forbid: () => { authorized = false; },
    read: (input: Record<string, unknown> = {}) => { after = undefined; count = 0; return loadGoodsReceiptHistory(db, 'a', 'user', p => p.outlets as string[], { from: '2026-11-04', to: '2026-11-04', ...input }); } };
}

test('receipt history bounds reads, applies India-time dates and pages tied timestamps without duplicates', async () => {
  const f = fixture(), first = await f.read();
  assert.equal(first.receipts.length, 25); assert(first.nextCursor);
  assert(f.calls.some(call => call[0] === 'limit' && call[1] === 26));
  assert(f.calls.some(call => call[0] === 'where' && call[2] === '>=' && call[3] === Date.parse('2026-11-04T00:00:00+05:30')));
  const second = await f.read({ cursor: first.nextCursor }); assert(second.nextCursor);
  const third = await f.read({ cursor: second.nextCursor });
  const ids = [...first.receipts, ...second.receipts, ...third.receipts].map(row => row.documentId);
  assert.equal(ids.length, 60); assert.equal(new Set(ids).size, 60); assert.equal(third.nextCursor, null);
});

test('receipt history rejects malformed dates, limits, cursors and mismatched cursor scope', async () => {
  for (const input of [{ from: '2026-02-30' }, { to: '2026-11-03' }, { from: '2020-01-01' }, { limit: '101' }, { limit: '0' }, { cursor: 'bad-json' }]) {
    const f = fixture(); await assert.rejects(f.read(input), { status: 400 }); assert.equal(f.calls.length, 0);
  }
  const f = fixture(), first = await f.read();
  const parsed = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString());
  for (const patch of [{ outlet: 'other' }, { from: '2026-11-03' }, { id: '../other' }, { date: 0 }]) {
    await assert.rejects(f.read({ cursor: Buffer.from(JSON.stringify({ ...parsed, ...patch })).toString('base64url') }), { status: 400 });
  }
});

test('receipt history enforces assigned outlet before reading receipt queries', async () => {
  const f = fixture(); f.forbid(); await assert.rejects(f.read(), { status: 403 });
  assert.equal(f.calls.filter(call => call[0] === 'where').length, 0);
});
