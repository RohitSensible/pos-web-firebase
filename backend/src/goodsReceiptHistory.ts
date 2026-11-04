import { FieldPath, type Firestore, type Query } from 'firebase-admin/firestore';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';

const dateMillis = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const utc = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(utc) && new Date(utc).toISOString().slice(0, 10) === value ? utc - 330 * 60_000 : NaN;
};

// Bounded, read-only pages use the existing createDate index. Dates follow the
// Asia/Kolkata day used by goods receipt creation. No totals or stock are derived.
export async function loadGoodsReceiptHistory(db: Firestore, outletId: string, profileId: string | null,
  assigned: (profile: Record<string, unknown>) => string[], input: { from?: unknown; to?: unknown; cursor?: unknown; limit?: unknown }) {
  if (!outletId || outletId.length > 200 || outletId.includes('/') || outletId === '.' || outletId === '..') throw new ProductCreationError(400, 'A valid outlet is required.');
  const from = dateMillis(input.from), to = dateMillis(input.to);
  const limit = input.limit === undefined ? 25 : Number(input.limit);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 366 * 86400000
    || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ProductCreationError(400, 'Choose valid receipt dates within one year and a page size from 1 to 100.');
  let cursor: { date: number; id: string } | undefined;
  if (input.cursor !== undefined && input.cursor !== '') {
    try {
      if (typeof input.cursor !== 'string' || input.cursor.length > 2000) throw new Error();
      const parsed = JSON.parse(Buffer.from(input.cursor, 'base64url').toString());
      if (parsed.outlet !== outletId || parsed.from !== input.from || parsed.to !== input.to
        || !Number.isFinite(parsed.date) || parsed.date < from || parsed.date >= to + 86400000
        || typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > 200 || parsed.id.includes('/')) throw new Error();
      cursor = parsed;
    } catch { throw new ProductCreationError(400, 'Invalid receipt page. Apply the date filters again.'); }
  }
  requireProductOutlet(profileId, outletId, profileId ? (await db.collection('USER_PROFILE').doc(profileId).get()).data() : undefined, assigned);
  const outlet = db.collection('OUTLET').doc(outletId);
  if ((await outlet.get()).data()?.active !== true) throw new ProductCreationError(403, 'This outlet is inactive or unavailable.');
  let query: Query = outlet.collection('GOODS_RECEIVED').where('createDate', '>=', from).where('createDate', '<', to + 86400000)
    .orderBy('createDate', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (cursor) query = query.startAfter(cursor.date, cursor.id);
  const snapshot = await query.limit(limit + 1).get();
  const page = snapshot.docs.slice(0, limit);
  const last = page.at(-1);
  return { receipts: page.map(document => ({ documentId: document.id, fields: document.data() })),
    nextCursor: snapshot.docs.length > limit && last ? Buffer.from(JSON.stringify({ outlet: outletId, from: input.from, to: input.to,
      date: last.data().createDate, id: last.id })).toString('base64url') : null };
}
