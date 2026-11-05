import type { Firestore } from 'firebase-admin/firestore';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';
import type { PremisesRecord, PremisesTransactionRunner, TypedFields } from './premises.js';
import { receiptSupplierFromMaster } from './suppliers.js';
import { stockBalanceAfter } from './stockAdjustment.js';

const recordId = z.string().min(1).max(200).refine(id => !id.includes('/') && id !== '.' && id !== '..');
const autoId = z.string().regex(/^[A-Za-z0-9]{20}$/);
const price = z.number().finite().nonnegative().max(1e9);
export const receiptSupplierSchema = z.object({
  id: recordId, name: z.string().min(1).max(200).refine(value => !!value.trim()),
  mobile: z.string().min(1).max(200).refine(value => !!value.trim()), address: z.string().max(500),
  alternateNumber: z.null(), email: z.string().max(320), gstin: z.string().max(200),
}).strict();
const inputSchema = z.object({
  documentId: autoId, goodsReceivedNo: z.string().trim().min(1).max(100).optional(), supplier: receiptSupplierSchema.nullish().transform(value => value ?? null),
  items: z.array(z.object({ productId: recordId, quantity: z.number().finite().positive().max(1e9).multipleOf(0.001), cost: price, price }).strict()).min(1).max(100),
}).strict();
type Assigned = (profile: Record<string, unknown>) => string[];

const receiptNumber = (value: unknown) => typeof value === 'string' ? value.trim()
  : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';

function nextPurchaseNumber(records: PremisesRecord[], dayId: string): string {
  // There is no shared Android counter. Continue the default-format sequences
  // visible in this outlet's committed receipts, across dates, in this transaction.
  let last = 0n;
  for (const { documentId, fields } of records) {
    const number = receiptNumber(fields.goodsReceivedNo);
    const internalIds = [documentId, fields.id, fields.deviceId, fields.transactionId, fields.requestId,
      (fields.supplier as { id?: unknown } | null)?.id];
    if (internalIds.some(value => typeof value === 'string' && value.trim() === number)) continue;
    const match = /^(\d{2})(\d{2})(\d{2})([1-9]\d*)$/.exec(number);
    if (!match) continue; // Prefixes, estimates and missing numbers are not default-format counters.
    const year = 2000 + Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
    const sequence = BigInt(match[4]!);
    if (sequence > last) last = sequence;
  }
  if (last >= 9223372036854775807n) throw new ProductCreationError(422, 'The goods-received purchase sequence is outside the supported range.');
  return dayId.slice(2).replaceAll('-', '') + String(last + 1n);
}

// Suppliers come from the verified outlet-specific SUPPLIER master.
export async function loadGoodsReceived(db: Firestore, outletId: string, profileId: string | null, assigned: Assigned) {
  if (!recordId.safeParse(outletId).success) throw new ProductCreationError(400, 'A valid outlet is required.');
  requireProductOutlet(profileId, outletId, profileId ? (await db.collection('USER_PROFILE').doc(profileId).get()).data() : undefined, assigned);
  const outlet = db.collection('OUTLET').doc(outletId);
  if ((await outlet.get()).data()?.active !== true) throw new ProductCreationError(403, 'This outlet is inactive or unavailable.');
  const goods = outlet.collection('GOODS_RECEIVED');
  // Entry and supplier screens need options, not an unbounded receipt history.
  const supplierSnapshot = await outlet.collection('SUPPLIER').get();
  const suppliers = supplierSnapshot.docs.flatMap(document => {
    const supplier = receiptSupplierFromMaster(document.id, document.data());
    return supplier ? [supplier] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));
  // Allocating references generates auto-IDs locally and writes no documents.
  return { documentId: goods.doc().id, supplierDraftId: outlet.collection('SUPPLIER').doc().id, suppliers, receipts: [] };
}

export async function saveGoodsReceived(run: PremisesTransactionRunner, outletId: string, profileId: string | null,
  assigned: Assigned, raw: unknown, clock = () => new Date()) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  const parsed = inputSchema.safeParse(raw);
  if (!recordId.safeParse(outletId).success || !parsed.success) throw new ProductCreationError(422, 'Enter a receipt number and positive quantities with up to three decimal places; prices must be zero or more.');
  const input = parsed.data;
  if (new Set(input.items.map(item => item.productId)).size !== input.items.length) throw new ProductCreationError(422, 'Each product can appear only once.');
  const collection = `OUTLET/${outletId}/GOODS_RECEIVED`;
  const path = `${collection}/${input.documentId}`;
  return run(async transaction => {
    requireProductOutlet(profileId, outletId, await transaction.read(`USER_PROFILE/${profileId}`), assigned);
    if ((await transaction.read(`OUTLET/${outletId}`))?.active !== true) throw new ProductCreationError(403, 'This outlet is inactive or unavailable.');
    const previous = await transaction.read(path);
    if (previous) {
      const items = Array.isArray(previous.goodsReceivedItemBeanList) ? previous.goodsReceivedItemBeanList as Record<string, unknown>[] : [];
      const same = previous.type === 'STOCK-IN' && previous.addType === 'POS'
        && (input.goodsReceivedNo === undefined || previous.goodsReceivedNo === input.goodsReceivedNo)
        && isDeepStrictEqual(previous.supplier ?? null, input.supplier) && items.length === input.items.length
        && input.items.every((item, index) => items[index]?.productid === item.productId && items[index]?.quantity === item.quantity
          && items[index]?.cost === item.cost && items[index]?.price === item.price);
      if (!same) throw new ProductCreationError(409, 'This confirmation already saved different receipt details.');
      return { documentId: input.documentId, goodsReceivedNo: receiptNumber(previous.goodsReceivedNo), alreadySaved: true };
    }
    const records = await transaction.list(collection);
    const now = clock();
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type: string) => parts.find(value => value.type === type)!.value;
    const dayId = `${part('year')}-${part('month')}-${part('day')}`;
    const goodsReceivedNo = input.goodsReceivedNo ?? nextPurchaseNumber(records, dayId);
    // An existing receipt is acknowledged above; new numbers must stay separate
    // from the document/supplier identity, including on the automatic save path.
    if (goodsReceivedNo === input.documentId || goodsReceivedNo === input.supplier?.id) {
      throw new ProductCreationError(422, 'The goods-received bill number is missing. A document ID cannot be used as a bill number.');
    }
    if (records.some(record => receiptNumber(record.fields.goodsReceivedNo) === goodsReceivedNo)) throw new ProductCreationError(409, 'This receipt number already exists in this outlet. Enter a different number.');
    if (input.supplier) {
      const supplierMaster = await transaction.read(`OUTLET/${outletId}/SUPPLIER/${input.supplier.id}`);
      const supplier = receiptSupplierFromMaster(input.supplier.id, supplierMaster);
      if (!supplier) throw new ProductCreationError(422, 'Select an existing supplier from this outlet.');
      if (!isDeepStrictEqual(supplier, input.supplier)) throw new ProductCreationError(409, 'Supplier details changed. Reload and select the supplier again.');
    }
    const products = await Promise.all(input.items.map(item => transaction.read(`OUTLET/${outletId}/PRODUCT/${item.productId}`)));
    const changes = input.items.map((item, index) => {
      const product = products[index];
      if (!product) throw new ProductCreationError(404, 'A selected product no longer exists in this outlet.');
      if (product.stockable !== true) throw new ProductCreationError(422, 'Only stockable products can be received.');
      if (typeof product.currentStock !== 'number' || !Number.isFinite(product.currentStock) || Math.abs(product.currentStock) > 1e9) throw new ProductCreationError(422, 'A selected product has an invalid stock value.');
      if (typeof product.name !== 'string' || !product.name.trim() || typeof product.weighable !== 'boolean') throw new ProductCreationError(422, 'A selected product has unsupported name or weighable data.');
      return { productId: item.productId, nextStock: stockBalanceAfter(product.currentStock, item.quantity, 'in'), line: { mapValue: { fields: {
        canWeight: { booleanValue: product.weighable }, cost: { doubleValue: item.cost }, currentStock: { doubleValue: product.currentStock },
        id: { nullValue: null }, name: { stringValue: product.name }, price: { doubleValue: item.price },
        productid: { stringValue: item.productId }, quantity: { doubleValue: item.quantity }, selected: { booleanValue: true },
        state: { integerValue: '0' }, total: { doubleValue: 0 },
      } } } };
    });
    const fields: TypedFields = {
      addType: { stringValue: 'POS' }, createDate: { integerValue: String(now.getTime()) }, dayID: { stringValue: dayId },
      finalTotal: { doubleValue: 0 }, formattedDate: { nullValue: null }, goodsReceivedItemBeanList: { arrayValue: { values: changes.map(change => change.line) } },
      goodsReceivedNo: { stringValue: goodsReceivedNo }, id: { nullValue: null }, quantity: { doubleValue: 0 }, remark: { nullValue: null },
      roundOff: { doubleValue: 0 }, state: { integerValue: '0' }, supplier: input.supplier ? { mapValue: { fields: Object.fromEntries(Object.entries(input.supplier).map(([key, value]) => [key, value === null ? { nullValue: null } : { stringValue: value }])) } } : { nullValue: null },
      total: { doubleValue: 0 }, type: { stringValue: 'STOCK-IN' },
    };
    // Receipt and balances commit together. An existing confirmation returns above,
    // so a lost response or repeated click cannot add the same quantities twice.
    transaction.create(path, fields);
    for (const { productId, nextStock } of changes) {
      transaction.update(`OUTLET/${outletId}/PRODUCT/${productId}`, { currentStock: { doubleValue: nextStock } });
    }
    return { documentId: input.documentId, goodsReceivedNo, alreadySaved: false };
  });
}
