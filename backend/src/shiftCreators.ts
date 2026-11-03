import type { Firestore } from 'firebase-admin/firestore';

// Call only with shifts from the already authorized outlet/day query.
export async function readShiftCreatorNames(
  db: Firestore, shifts: readonly Record<string, unknown>[],
): Promise<Map<string, string>> {
  const ids = [...new Set(shifts.map(shift => typeof shift.userId === 'string' ? shift.userId.trim() : '')
    .filter(id => id && !id.includes('/')))];
  const names = new Map<string, string>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    try {
      const refs = ids.slice(offset, offset + 100).map(id => db.collection('USER_PROFILE').doc(id));
      // Document IDs come from snapshot metadata; never fetch full profiles.
      const profiles = await db.getAll(...refs, { fieldMask: ['name'] });
      for (const profile of profiles) {
        const name: unknown = profile.data()?.name;
        if (profile.exists && typeof name === 'string' && name.trim()) names.set(profile.id, name.trim());
      }
    } catch {
      // Optional identity enrichment must not make sales totals unavailable.
    }
  }
  return names;
}
