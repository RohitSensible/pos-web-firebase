import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';
import type { PremisesTransactionRunner, TypedFields } from './premises.js';

const pathId = z.string().min(1).max(200).refine(value => !value.includes('/') && value !== '.' && value !== '..');
const supplierFields = z.object({
  name: z.string().min(1).max(200).refine(value => !!value.trim()),
  mobile: z.string().min(1).max(200).refine(value => !!value.trim()),
  address: z.string().max(500), alternateNumber: z.string().max(200),
  email: z.string().max(320), gstin: z.string().max(200),
}).strict();
const schema = z.object({ documentId: z.string().regex(/^[A-Za-z0-9]{20}$/), fields: supplierFields }).strict();

// A master stores id:null and alternateNumber:string. The existing goods receipt
// format stores its document ID in the embedded supplier.id and alternateNumber:null.
// Keep these two representations separate rather than rewriting either schema.
export function receiptSupplierFromMaster(documentId: string, fields: Record<string, unknown> | undefined) {
  if (!fields || fields.id !== null) return null;
  const { id: _id, ...values } = fields;
  const parsed = supplierFields.safeParse(values);
  if (!parsed.success) return null;
  return { ...parsed.data, id: documentId, alternateNumber: null };
}

export async function createOutletSupplier(run: PremisesTransactionRunner, outletId: string, profileId: string | null,
  assigned: (profile: Record<string, unknown>) => string[], raw: unknown) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  const parsed = schema.safeParse(raw);
  if (!pathId.safeParse(outletId).success || !parsed.success) throw new ProductCreationError(422, 'Enter a supplier name, mobile and valid supplier details.');
  const { documentId, fields: values } = parsed.data;
  return run(async transaction => {
    requireProductOutlet(profileId, outletId, await transaction.read(`USER_PROFILE/${profileId}`), assigned);
    if ((await transaction.read(`OUTLET/${outletId}`))?.active !== true) throw new ProductCreationError(403, 'This outlet is inactive or unavailable.');
    const path = `OUTLET/${outletId}/SUPPLIER/${documentId}`;
    const previous = await transaction.read(path);
    const stored = { ...values, id: null };
    if (previous) {
      if (!isDeepStrictEqual(previous, stored)) throw new ProductCreationError(409, 'This confirmation already saved different supplier details.');
      return { documentId, fields: stored, alreadySaved: true };
    }
    const fields: TypedFields = { ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { stringValue: value }])), id: { nullValue: null } };
    transaction.create(path, fields);
    return { documentId, fields: stored, alreadySaved: false };
  });
}

const supplierPatch = supplierFields.partial().refine(fields => Object.keys(fields).length > 0);
const updateSchema = z.object({ fields: supplierPatch, previous: supplierPatch }).strict()
  .refine(input => isDeepStrictEqual(Object.keys(input.fields).sort(), Object.keys(input.previous).sort()));

export async function updateOutletSupplier(run: PremisesTransactionRunner, outletId: string, documentId: string,
  profileId: string | null, assigned: (profile: Record<string, unknown>) => string[], raw: unknown) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  if (![outletId, documentId].every(value => pathId.safeParse(value).success)) throw new ProductCreationError(400, 'A valid outlet and supplier ID are required.');
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) throw new ProductCreationError(422, 'Enter valid supplier details and their original values.');
  const { fields, previous } = parsed.data;
  return run(async transaction => {
    requireProductOutlet(profileId, outletId, await transaction.read(`USER_PROFILE/${profileId}`), assigned);
    if ((await transaction.read(`OUTLET/${outletId}`))?.active !== true) throw new ProductCreationError(403, 'This outlet is inactive or unavailable.');
    const path = `OUTLET/${outletId}/SUPPLIER/${documentId}`;
    const stored = await transaction.read(path);
    if (!stored) throw new ProductCreationError(404, 'This supplier no longer exists.');
    if (!receiptSupplierFromMaster(documentId, stored)) throw new ProductCreationError(422, 'This supplier has an unsupported format.');
    const changes = Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    // A response-lost retry is successful when the requested values already exist.
    if (changes.every(([key, value]) => stored[key] === value)) return { documentId, fields: stored };
    if (changes.some(([key]) => stored[key] !== previous[key as keyof typeof previous])) {
      throw new ProductCreationError(409, 'Supplier details changed. Close the form, refresh the list and try again.');
    }
    // Patch existing fields only; keep id:null, other fields and receipt snapshots intact.
    transaction.update(path, Object.fromEntries(changes.map(([key, value]) => [key, { stringValue: value }])));
    return { documentId, fields: { ...stored, ...fields } };
  });
}
