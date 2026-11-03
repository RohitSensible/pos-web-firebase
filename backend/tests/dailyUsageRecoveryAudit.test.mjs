// Run from repository root:
// node --import ./backend/node_modules/tsx/dist/loader.mjs backend/tests/dailyUsageRecoveryAudit.test.mjs
// Import the TS engine explicitly: generated dailyUsage.js may be stale.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { operateOutletDailyUsage } from '../src/dailyUsage.ts';

const usagePath = 'OUTLET/a/SESSION/dailyUsage';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const operation = (session, action, sequence = session.sequence + (action === 'heartbeat' ? 1 : 0)) => ({
  action, sessionId: session.sessionId, generation: session.generation, ...(action === 'check' ? {} : { sequence }),
});

// No app initialization, credentials or default Firestore instance. Transactions
// serialize against this Map and stage writes until the callback succeeds.
function fixture(zone = 'Asia/Kolkata', initial = '2026-10-19T10:00:00Z') {
  const records = new Map([
    ['USER_PROFILE/user', { active: true, outlets: ['a'] }],
    ['OUTLET/a', { active: true, eraseOutlet: false, country: { timezone: zone } }],
  ]);
  const originals = new Map(records);
  let now = Timestamp.fromDate(new Date(initial)), queue = Promise.resolve(), conflict;
  const writes = [];
  const ref = path => ({ path, collection: name => ({ doc: key => ref(`${path}/${name}/${key}`) }) });
  const db = {
    collection: name => ({ doc: key => ref(`${name}/${key}`) }),
    runTransaction(callback) {
      const result = queue.then(async () => {
        let pending = [];
        const transaction = {
          getAll: async (...refs) => {
            assert.equal(pending.length, 0, 'all reads precede writes');
            return refs.map(reference => ({ data: () => records.get(reference.path) }));
          },
          set(reference, value) {
            assert.equal(reference.path, usagePath, 'only the in-memory usage document can be written');
            assert.ok(FieldValue.serverTimestamp().isEqual(value.updatedAt));
            pending.push(value);
          },
        };
        let outcome = await callback(transaction);
        if (conflict) {
          const retry = conflict; conflict = undefined; pending = []; retry();
          outcome = await callback(transaction);
        }
        for (const value of pending) {
          const committed = { ...value, updatedAt: now };
          records.set(usagePath, committed); writes.push(committed);
        }
        for (const [path, value] of originals) assert.equal(records.get(path), value, 'profile and outlet stay untouched');
        return outcome;
      });
      queue = result.catch(() => undefined);
      return result;
    },
  };
  const run = raw => operateOutletDailyUsage(db, 'a', 'user', p => p.outlets, raw, () => now);
  return { run, writes, usage: () => records.get(usagePath),
    start: (key = 1) => run({ action: 'start', requestId: id(key) }),
    at: value => { now = Timestamp.fromDate(new Date(value)); },
    retry: callback => { conflict = callback; },
  };
}

test('recovery audit: active leases rotate exactly at IANA midnight, including both DST offsets', async () => {
  for (const [zone, before, midnight, date] of [
    ['Asia/Kolkata', '2026-10-19T18:29:59.999Z', '2026-10-19T18:30:00Z', '2026-10-20'],
    ['America/New_York', '2026-03-08T04:59:59.999Z', '2026-03-08T05:00:00Z', '2026-03-08'],
    ['America/New_York', '2026-11-01T03:59:59.999Z', '2026-11-01T04:00:00Z', '2026-11-01'],
    ['America/New_York', '2026-11-02T04:59:59.999Z', '2026-11-02T05:00:00Z', '2026-11-02'],
  ]) {
    const f = fixture(zone, before), yesterday = await f.start();
    await f.run(operation(yesterday, 'check'));
    f.at(midnight);
    await assert.rejects(f.run(operation(yesterday, 'heartbeat')), { code: 'USAGE_SESSION_REQUIRED' });
    const today = await f.start();
    assert.equal(today.date, date); assert.equal(today.timeZone, zone); assert.equal(today.usedSeconds, 0);
    assert.notEqual(today.generation, yesterday.generation);
    await assert.rejects(f.run(operation(yesterday, 'stop')), { code: 'USAGE_SESSION_REQUIRED' });
    await f.run(operation(today, 'check'));
    assert.deepEqual(Object.keys(f.usage().sessions), [today.sessionId]);
  }
});

test('recovery audit: DST repeated/skipped local hours settle elapsed instants without resetting the day', async () => {
  for (const [before, after, date] of [
    ['2026-03-08T06:59:50Z', '2026-03-08T07:00:10Z', '2026-03-08'],
    ['2026-11-01T05:59:50Z', '2026-11-01T06:00:10Z', '2026-11-01'],
  ]) {
    const f = fixture('America/New_York', before), first = await f.start();
    f.at(after); const next = await f.run(operation(first, 'heartbeat'));
    assert.equal(next.date, date); assert.equal(next.usedSeconds, 20);
    assert.equal(next.generation, first.generation);
    assert.equal(next.expiresAt, Date.parse(after) + 30_000);
  }
});

test('recovery audit: a heartbeat transaction retried over midnight cannot carry an old lease into the new period', async () => {
  const f = fixture('Asia/Kolkata', '2026-10-19T18:29:50Z'), old = await f.start();
  f.at('2026-10-19T18:29:59Z');
  f.retry(() => f.at('2026-10-19T18:30:00Z'));
  await assert.rejects(f.run(operation(old, 'heartbeat')), { code: 'USAGE_SESSION_REQUIRED' });
  assert.equal(f.usage().date, '2026-10-20'); assert.equal(f.usage().usedSeconds, 0);
  assert.deepEqual(f.usage().sessions, {});
  assert.equal(f.writes.length, 2, 'only the retried outcome commits');
  const next = await f.start(); assert.notEqual(next.generation, old.generation);
});

test('recovery audit: offline expiry settles only the lease, then fresh admission resumes the existing balance', async () => {
  const f = fixture(), old = await f.start();
  f.at('2026-10-19T10:00:30Z');
  await assert.rejects(f.run(operation(old, 'heartbeat')), { code: 'USAGE_SESSION_EXPIRED' });
  assert.equal(f.usage().usedSeconds, 30); assert.deepEqual(f.usage().sessions, {});
  f.at('2026-10-19T12:00:00Z');
  await assert.rejects(f.run(operation(old, 'check')), { code: 'USAGE_SESSION_REQUIRED' });
  const resumed = await f.start(2);
  assert.equal(resumed.usedSeconds, 30); assert.equal(resumed.remainingSeconds, 1770);
  assert.equal(resumed.generation, old.generation);
  f.at('2026-10-19T12:00:10Z'); const stopped = await f.run(operation(resumed, 'stop'));
  assert.equal(stopped.usedSeconds, 40);
});

test('recovery audit: lost start response and refresh/heartbeat race keep one lease and reject older sequence cleanup', async () => {
  const f = fixture(); await f.start(); // Simulate a committed start whose response was lost.
  f.at('2026-10-19T10:00:05Z'); const restored = await f.start();
  assert.equal(restored.sequence, 1); assert.equal(restored.usedSeconds, 5);
  f.at('2026-10-19T10:00:10Z');
  const [renewed, refreshed] = await Promise.all([f.run(operation(restored, 'heartbeat')), f.start()]);
  assert.equal(renewed.sequence, 2); assert.equal(refreshed.sequence, 3);
  assert.equal(refreshed.sessionId, restored.sessionId);
  assert.equal(refreshed.usedSeconds, 10); assert.equal(Object.keys(f.usage().sessions).length, 1);
  await assert.rejects(f.run(operation(renewed, 'stop')), { code: 'USAGE_STALE_HEARTBEAT' });
  await assert.rejects(f.run(operation(restored, 'heartbeat')), { code: 'USAGE_STALE_HEARTBEAT' });
  await f.run(operation(refreshed, 'check'));
  assert.equal(f.usage().sessions[refreshed.sessionId].lastSequence, 3);
});

test('recovery audit: a lost heartbeat response settles time once and requires a fresh start after duplicate rejection', async () => {
  const f = fixture(), first = await f.start();
  f.at('2026-10-19T10:00:10Z');
  const lost = await f.run(operation(first, 'heartbeat'));
  f.at('2026-10-19T10:00:15Z');
  await assert.rejects(f.run(operation(first, 'heartbeat')), { code: 'USAGE_STALE_HEARTBEAT' });
  assert.equal(f.usage().usedSeconds, 15);
  assert.equal(f.usage().sessions[first.sessionId].expiresAt.toMillis(), lost.expiresAt, 'duplicate does not extend expiry');
  const resumed = await f.start();
  assert.equal(resumed.usedSeconds, 15); assert.equal(resumed.sequence, 2);
  f.at('2026-10-19T10:00:20Z');
  assert.equal((await f.run(operation(resumed, 'stop'))).usedSeconds, 20);
});

test('recovery audit: overlapping tabs charge the union through independent expiry/release, excluding the offline gap', async () => {
  const f = fixture(), a = await f.start(1);
  f.at('2026-10-19T10:00:10Z'); const b = await f.start(2);
  assert.notEqual(a.sessionId, b.sessionId);
  f.at('2026-10-19T10:00:20Z'); const active = await f.run(operation(a, 'heartbeat'));
  f.at('2026-10-19T10:00:35Z');
  assert.equal((await f.run(operation(active, 'stop'))).usedSeconds, 35);
  assert.deepEqual(Object.keys(f.usage().sessions), [b.sessionId], 'closing one tab retains the other lease');
  f.at('2026-10-19T10:00:40Z');
  await assert.rejects(f.run(operation(b, 'heartbeat')), { code: 'USAGE_SESSION_EXPIRED' });
  assert.equal(f.usage().usedSeconds, 40);
  f.at('2026-10-19T11:00:00Z'); const c = await f.start(3);
  assert.equal(c.usedSeconds, 40);
  f.at('2026-10-19T11:00:10Z'); assert.equal((await f.run(operation(c, 'stop'))).usedSeconds, 50);
});

test('recovery audit: delayed pre-expiry stop cannot release a same-key lease reacquired after offline expiry', async () => {
  const f = fixture(), abandoned = await f.start();
  f.at('2026-10-19T11:00:00Z');
  const restored = await f.start(); // Refresh retains the per-tab idempotency key.
  assert.equal(restored.usedSeconds, 30, 'offline time is bounded by the abandoned lease');
  // Confirmed backend defect: expiry pruning forgets lastSequence, so same-key
  // admission recreates the same session ID at sequence 0. A delayed old stop
  // then deletes the new lease. Keep this regression red: dailyUsage.ts belongs
  // to the backend owner and must not be changed by this recovery-audit task.
  await assert.rejects(f.run(operation(abandoned, 'stop')), { code: 'USAGE_STALE_HEARTBEAT' });
  await f.run(operation(restored, 'check'));
});
