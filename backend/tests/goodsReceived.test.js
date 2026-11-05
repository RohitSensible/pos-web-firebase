import assert from 'node:assert/strict';
import test from 'node:test';
import { saveGoodsReceived, loadGoodsReceived } from '../src/goodsReceived.js';
import { premisesTransactionRunner } from '../src/premisesFirestore.js';
import { saveStockAdjustment } from '../src/stockAdjustment.js';
function decode(value) {
    if ('nullValue' in value)
        return null;
    if ('integerValue' in value)
        return Number(value.integerValue);
    if ('doubleValue' in value)
        return value.doubleValue;
    if ('booleanValue' in value)
        return value.booleanValue;
    if ('mapValue' in value)
        return Object.fromEntries(Object.entries(value.mapValue.fields).map(([key, entry]) => [key, decode(entry)]));
    if ('arrayValue' in value)
        return value.arrayValue.values.map(decode);
    return 'stringValue' in value ? value.stringValue : value.timestampValue;
}
const assigned = (profile) => profile.outlets;
const supplier = { id: 'S'.repeat(20), name: 'Gulbarga ', mobile: '00000', address: '', alternateNumber: null, email: '', gstin: '' };
const input = { documentId: 'R'.repeat(20), goodsReceivedNo: '38', supplier, items: [{ productId: 'product', quantity: 58, cost: 0, price: 23 }] };
const base = 'OUTLET/outlet/GOODS_RECEIVED';
function fixture() {
    const records = new Map([
        ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }],
        [`OUTLET/outlet/SUPPLIER/${supplier.id}`, { ...supplier, id: null, alternateNumber: '' }], ['OUTLET/outlet', { active: true }],
        ['OUTLET/outlet/PRODUCT/product', { name: 'IDLY', stockable: true, weighable: false, currentStock: 3, costPrice: 9, price: 23 }],
    ]);
    const writes = [];
    let fail = false, lost = false, queue = Promise.resolve();
    const run = work => {
        const operation = queue.then(async () => {
            const pending = [];
            const result = await work({ read: async (path) => { assert.equal(pending.length, 0, 'All reads precede writes'); return structuredClone(records.get(path)); },
                list: async (path) => [...records].filter(([key]) => key.startsWith(`${path}/`)).map(([key, fields]) => ({ documentId: key.split('/').at(-1), fields: structuredClone(fields) })),
                create: (path, fields) => { pending.push({ path, fields, create: true }); }, update: (path, fields) => { pending.push({ path, fields, create: false }); } });
            if (fail)
                throw new Error('Commit failed');
            for (const write of pending) {
                assert.equal(records.has(write.path), !write.create);
                const patch = Object.fromEntries(Object.entries(write.fields).map(([key, value]) => [key, decode(value)]));
                records.set(write.path, write.create ? patch : { ...records.get(write.path), ...patch });
                writes.push(write);
            }
            if (lost) {
                lost = false;
                throw new Error('Response lost');
            }
            return result;
        });
        queue = operation.then(() => undefined, () => undefined);
        return operation;
    };
    return { records, writes, run, fail: () => { fail = true; }, loseResponse: () => { lost = true; },
        save: (body = input, outlet = 'outlet', profile = 'user') => saveGoodsReceived(run, outlet, profile, assigned, body, () => new Date('2026-10-25T20:00:00Z')) };
}
test('receipt and stock commit together, preserving legacy fields, numeric types and other product data', async () => {
    const f = fixture(), before = structuredClone(f.records);
    await f.save();
    assert.equal(f.writes.length, 2);
    assert.equal(f.writes[0].path, `${base}/${input.documentId}`);
    for (const [path, fields] of before)
        assert.deepEqual(f.records.get(path), path === 'OUTLET/outlet/PRODUCT/product' ? { ...fields, currentStock: 61 } : fields);
    const fields = f.writes[0].fields;
    assert.deepEqual(Object.keys(fields).sort(), ['addType', 'createDate', 'dayID', 'finalTotal', 'formattedDate', 'goodsReceivedItemBeanList', 'goodsReceivedNo', 'id', 'quantity', 'remark', 'roundOff', 'state', 'supplier', 'total', 'type'].sort());
    assert.deepEqual(fields.createDate, { integerValue: String(Date.parse('2026-10-25T20:00:00Z')) });
    assert.deepEqual(fields.dayID, { stringValue: '2026-10-26' });
    for (const key of ['quantity', 'finalTotal', 'total', 'roundOff'])
        assert.deepEqual(fields[key], { doubleValue: 0 });
    for (const key of ['formattedDate', 'id', 'remark'])
        assert.deepEqual(fields[key], { nullValue: null });
    assert.deepEqual(fields.state, { integerValue: '0' });
    const line = fields.goodsReceivedItemBeanList.arrayValue.values[0].mapValue.fields;
    assert.deepEqual(Object.keys(line).sort(), ['canWeight', 'cost', 'currentStock', 'id', 'name', 'price', 'productid', 'quantity', 'selected', 'state', 'total'].sort());
    assert.deepEqual(line.quantity, { doubleValue: 58 });
    assert.deepEqual(line.currentStock, { doubleValue: 3 });
    assert.deepEqual(line.price, { doubleValue: 23 });
    assert.deepEqual(line.cost, { doubleValue: 0 });
    assert.deepEqual(line.canWeight, { booleanValue: false });
    assert.deepEqual(line.selected, { booleanValue: true });
    assert.deepEqual(f.records.get(`${base}/${input.documentId}`).supplier, supplier);
});
test('supplier can be omitted or null without creating a supplier; lost-response retries still save once', async () => {
    for (const includeNull of [false, true]) {
        const f = fixture();
        f.records.delete(`OUTLET/outlet/SUPPLIER/${supplier.id}`);
        const { supplier: _supplier, ...withoutSupplier } = input;
        const body = includeNull ? { ...withoutSupplier, supplier: null } : withoutSupplier;
        const before = structuredClone(f.records);
        f.loseResponse();
        await assert.rejects(f.save(body), /Response lost/);
        assert.equal((await f.save(body)).alreadySaved, true);
        assert.equal(f.writes.length, 2);
        assert.deepEqual(f.writes[0].fields.supplier, { nullValue: null });
        for (const [path, fields] of before)
            assert.deepEqual(f.records.get(path), path === 'OUTLET/outlet/PRODUCT/product' ? { ...fields, currentStock: 61 } : fields);
        await assert.rejects(f.save(input), /different receipt/);
    }
});
test('retry, simultaneous double-click and lost response create exactly one receipt', async () => {
    const f = fixture();
    f.loseResponse();
    await assert.rejects(f.save(), /Response lost/);
    const results = await Promise.all([f.save(), f.save()]);
    assert.ok(results.every(result => result.alreadySaved));
    assert.equal(f.writes.length, 2);
    for (const body of [{ ...input, goodsReceivedNo: '39' }, { ...input, items: [{ ...input.items[0], quantity: 59 }] }, { ...input, supplier: { ...supplier, name: 'Other' } }])
        await assert.rejects(f.save(body), /different receipt/);
});
test('duplicate receipt numbers, malformed fields, foreign/inactive outlets and invalid products cause no writes', async () => {
    const invalid = [{ ...input, items: [{ ...input.items[0], quantity: 0 }] }, { ...input, items: [{ ...input.items[0], cost: -1 }] },
        { ...input, items: [{ ...input.items[0], quantity: 0.0001 }] }, { ...input, items: [input.items[0], input.items[0]] },
        { ...input, supplier: { ...supplier, alternateNumber: '123' } }, { ...input, total: 100 }, { ...input, documentId: '../other' }];
    for (const body of invalid) {
        const f = fixture();
        await assert.rejects(f.save(body));
        assert.equal(f.writes.length, 0);
    }
    for (const mode of ['session', 'foreign', 'inactive', 'outlet', 'missing', 'stockable', 'stock']) {
        const f = fixture();
        if (mode === 'inactive')
            f.records.get('USER_PROFILE/user').active = false;
        if (mode === 'outlet')
            f.records.get('OUTLET/outlet').active = false;
        if (mode === 'missing')
            f.records.delete('OUTLET/outlet/PRODUCT/product');
        if (mode === 'stockable')
            f.records.get('OUTLET/outlet/PRODUCT/product').stockable = false;
        if (mode === 'stock')
            f.records.get('OUTLET/outlet/PRODUCT/product').currentStock = '3';
        await assert.rejects(f.save(input, mode === 'foreign' ? 'other' : 'outlet', mode === 'session' ? null : 'user'));
        assert.equal(f.writes.length, 0);
    }
    const f = fixture();
    await f.save();
    await assert.rejects(f.save({ ...input, documentId: 'AnotherReceipt123456' }), /receipt number/);
    assert.equal(f.writes.length, 2);
});
test('commit failures retain all existing data', async () => {
    const f = fixture(), before = structuredClone(f.records);
    f.fail();
    await assert.rejects(f.save(), /Commit failed/);
    assert.deepEqual(f.records, before);
    assert.equal(f.writes.length, 0);
});
test('receipt loader reads the supplier master and generates IDs without any writes', async () => {
    let generated = 0;
    const ref = (path) => ({ id: path.split('/').at(-1), collection: (name) => ref(`${path}/${name}`),
        doc: (id) => ref(`${path}/${id ?? `GeneratedAutoId12345${++generated}`}`),
        get: async () => path.endsWith('/SUPPLIER') ? { docs: [{ id: supplier.id, data: () => ({ ...supplier, id: null, alternateNumber: '' }) }] } : path.endsWith('/GOODS_RECEIVED') ? { docs: [{ id: 'existing', data: () => ({ supplier, createDate: 123, goodsReceivedNo: '37' }) }] }
            : { exists: true, data: () => path.startsWith('USER_PROFILE/') ? { active: true, outlets: ['outlet'] } : { active: true } }, });
    const db = { collection: (path) => ref(path) };
    const data = await loadGoodsReceived(db, 'outlet', 'user', assigned);
    assert.deepEqual(data.suppliers, [supplier]);
    assert.equal(data.receipts.length, 0);
    assert.equal(generated, 2);
});
test('REST transport atomically creates receipt and masks stock updates with explicit doubles', async () => {
    const calls = [];
    const fetcher = async (url, init) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        calls.push({ url: String(url), body });
        if (String(url).endsWith(':beginTransaction'))
            return Response.json({ transaction: 'transaction' });
        if (String(url).endsWith(':runQuery'))
            return Response.json([]);
        if (String(url).endsWith(':commit'))
            return Response.json({});
        if (String(url).includes('USER_PROFILE/user?'))
            return Response.json({ fields: { active: { booleanValue: true }, outlets: { arrayValue: { values: [{ stringValue: 'outlet' }] } } } });
        if (String(url).includes(`/SUPPLIER/${supplier.id}?`))
            return Response.json({ fields: { id: { nullValue: null }, name: { stringValue: supplier.name }, mobile: { stringValue: supplier.mobile }, address: { stringValue: '' }, alternateNumber: { stringValue: '' }, email: { stringValue: '' }, gstin: { stringValue: '' } } });
        if (String(url).includes('/PRODUCT/product?'))
            return Response.json({ fields: { name: { stringValue: 'IDLY' }, currentStock: { doubleValue: 3 }, stockable: { booleanValue: true }, weighable: { booleanValue: false } } });
        if (String(url).includes('/OUTLET/outlet?'))
            return Response.json({ fields: { active: { booleanValue: true } } });
        return Response.json({}, { status: 404 });
    };
    await saveGoodsReceived(premisesTransactionRunner('projects/test/databases/(default)', async () => 'test', fetcher), 'outlet', 'user', assigned, input);
    const commit = calls.find(call => call.url.endsWith(':commit')).body;
    assert.equal(commit.writes.length, 2);
    assert.deepEqual(commit.writes[0].currentDocument, { exists: false });
    assert.ok(commit.writes[0].update.name.endsWith(`${base}/${input.documentId}`));
    assert.deepEqual(commit.writes[0].update.fields.goodsReceivedItemBeanList.arrayValue.values[0].mapValue.fields.quantity, { doubleValue: 58 });
    assert.ok(!commit.writes[0].updateMask);
    assert.deepEqual(commit.writes[1], { update: { name: 'projects/test/databases/(default)/documents/OUTLET/outlet/PRODUCT/product', fields: { currentStock: { doubleValue: 61 } } }, updateMask: { fieldPaths: ['currentStock'] }, currentDocument: { exists: true } });
});
test('receipt save rejects missing, foreign or changed supplier masters without writing', async () => {
    for (const mode of ['missing', 'changed', 'invalid']) {
        const f = fixture();
        if (mode === 'missing')
            f.records.delete(`OUTLET/outlet/SUPPLIER/${supplier.id}`);
        if (mode === 'changed')
            f.records.get(`OUTLET/outlet/SUPPLIER/${supplier.id}`).name = 'Changed';
        if (mode === 'invalid')
            f.records.get(`OUTLET/outlet/SUPPLIER/${supplier.id}`).id = supplier.id;
        await assert.rejects(f.save());
        assert.equal(f.writes.length, 0);
    }
});
test('receipts accumulate 20 + 50 = 70, then 70 + 30 = 100, without changing other outlet or product fields', async () => {
    const f = fixture(), path = 'OUTLET/outlet/PRODUCT/product';
    f.records.get(path).currentStock = 20;
    f.records.set('OUTLET/other/PRODUCT/product', { currentStock: 800, price: 99 });
    const before = structuredClone(f.records.get(path));
    const first = { ...input, items: [{ ...input.items[0], quantity: 50 }] };
    const second = { ...first, documentId: 'T'.repeat(20), goodsReceivedNo: '39', items: [{ ...first.items[0], quantity: 30 }] };
    await f.save(first);
    assert.equal(f.records.get(path).currentStock, 70);
    await f.save(second);
    assert.deepEqual(f.records.get(path), { ...before, currentStock: 100 });
    assert.equal((await f.save(first)).alreadySaved, true);
    assert.equal(f.records.get(path).currentStock, 100);
    assert.deepEqual(f.records.get('OUTLET/other/PRODUCT/product'), { currentStock: 800, price: 99 });
    assert.deepEqual(f.writes.filter(write => !write.create).map(write => write.fields), [{ currentStock: { doubleValue: 70 } }, { currentStock: { doubleValue: 100 } }]);
});
test('distinct simultaneous receipts add from the persisted balance, including fractional quantities', async () => {
    const f = fixture();
    f.records.get('OUTLET/outlet/PRODUCT/product').currentStock = 20;
    await Promise.all([50, 30, 0.125].map((quantity, index) => f.save({ ...input, documentId: String(index).repeat(20), goodsReceivedNo: String(index), items: [{ ...input.items[0], quantity }] })));
    assert.equal(f.records.get('OUTLET/outlet/PRODUCT/product').currentStock, 100.125);
    assert.equal(f.writes.filter(write => write.create).length, 3);
});
test('receiving in another assigned outlet updates only that outlet, even with the same product ID', async () => {
    const f = fixture();
    f.records.get('USER_PROFILE/user').outlets = ['outlet', 'other'];
    f.records.set('OUTLET/other', { active: true });
    f.records.set('OUTLET/other/PRODUCT/product', { name: 'Other IDLY', stockable: true, weighable: false, currentStock: 20, price: 10 });
    await f.save({ ...input, supplier: null, items: [{ ...input.items[0], quantity: 50 }] }, 'other');
    assert.equal(f.records.get('OUTLET/other/PRODUCT/product').currentStock, 70);
    assert.equal(f.records.get('OUTLET/outlet/PRODUCT/product').currentStock, 3);
    assert.equal(f.records.has(`OUTLET/outlet/GOODS_RECEIVED/${input.documentId}`), false);
    assert.equal(f.records.has(`OUTLET/other/GOODS_RECEIVED/${input.documentId}`), true);
});
test('multiple products commit atomically and an invalid or overflowing item prevents every write', async () => {
    for (const invalid of [false, true, 'overflow']) {
        const f = fixture();
        const path = 'OUTLET/outlet/PRODUCT/second';
        f.records.set(path, { name: 'Tea', currentStock: invalid === 'overflow' ? 1e9 : 20, stockable: !invalid || invalid === 'overflow', weighable: false, price: 9 });
        const before = structuredClone(f.records);
        const body = { ...input, items: [...input.items, { productId: 'second', quantity: 0.5, cost: 1, price: 9 }] };
        if (invalid) {
            await assert.rejects(f.save(body));
            assert.deepEqual(f.records, before);
            assert.equal(f.writes.length, 0);
        }
        else {
            await f.save(body);
            assert.equal(f.records.get(path).currentStock, 20.5);
            assert.equal(f.records.get('OUTLET/outlet/PRODUCT/product').currentStock, 61);
            assert.equal(f.writes.length, 3);
        }
    }
});
test('Goods Received, Stock In and Stock Out share the same persisted balance and retry identities', async () => {
    const f = fixture(), path = 'OUTLET/outlet/PRODUCT/product';
    f.records.get(path).currentStock = 20;
    function encode(value) {
        if (value === null)
            return { nullValue: null };
        if (typeof value === 'number')
            return { doubleValue: value };
        if (typeof value === 'boolean')
            return { booleanValue: value };
        if (typeof value === 'string')
            return { stringValue: value };
        if (Array.isArray(value))
            return { arrayValue: { values: value.map(encode) } };
        return { mapValue: { fields: encodeFields(value) } };
    }
    const encodeFields = (fields) => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encode(value)]));
    const ref = (path) => ({ path, id: path.split('/').at(-1), collection: (name) => ref(`${path}/${name}`), doc: (id) => ref(`${path}/${id}`) });
    // Both real services share this in-memory transaction store; no Firebase connection.
    const db = { collection: ref, runTransaction: (work) => f.run(transaction => work({
            get: async (reference) => { const data = await transaction.read(reference.path); return { exists: !!data, data: () => data }; },
            create: (reference, fields) => transaction.create(reference.path, encodeFields(fields)),
            update: (reference, fields) => transaction.update(reference.path, encodeFields(fields)),
        })) };
    const receipt = { ...input, items: [{ ...input.items[0], quantity: 50 }] };
    await f.save(receipt);
    assert.equal(f.records.get(path).currentStock, 70);
    const adjustment = { requestId: 'A'.repeat(20), direction: 'in', items: [{ productId: 'product', quantity: 30, expectedStock: 70, remark: '' }] };
    f.loseResponse();
    await assert.rejects(saveStockAdjustment(db, 'outlet', 'user', assigned, adjustment), /Response lost/);
    assert.equal((await saveStockAdjustment(db, 'outlet', 'user', assigned, adjustment)).alreadySaved, true);
    assert.equal(f.records.get(path).currentStock, 100);
    await saveStockAdjustment(db, 'outlet', 'user', assigned, { ...adjustment, requestId: 'B'.repeat(20), direction: 'out', items: [{ ...adjustment.items[0], quantity: 5, expectedStock: 100, remark: 'Damaged' }] });
    assert.equal(f.records.get(path).currentStock, 95);
    assert.equal((await f.save(receipt)).alreadySaved, true);
    assert.equal(f.records.get(path).currentStock, 95);
    assert.equal(f.writes.filter(write => write.create).length, 3);
});
test('an aborted REST transaction rereads concurrent stock before retrying the receipt increment', async () => {
    let stock = 20, attempts = 0, commits = 0;
    const fetcher = async (url, init) => {
        const path = String(url), body = JSON.parse(String(init?.body ?? '{}'));
        if (path.endsWith(':beginTransaction'))
            return Response.json({ transaction: `transaction-${++attempts}` });
        if (path.endsWith(':runQuery'))
            return Response.json([]);
        if (path.endsWith(':rollback'))
            return Response.json({});
        if (path.endsWith(':commit')) {
            commits++;
            assert.equal(body.transaction, `transaction-${commits}`);
            assert.equal(body.writes.length, 2);
            assert.deepEqual(body.writes[1].update.fields, { currentStock: { doubleValue: commits === 1 ? 70 : 90 } });
            if (commits === 1) {
                stock = 40;
                return Response.json({ error: { status: 'ABORTED' } }, { status: 409 });
            }
            stock = body.writes[1].update.fields.currentStock.doubleValue;
            return Response.json({});
        }
        if (path.includes('/USER_PROFILE/user?'))
            return Response.json({ fields: { active: { booleanValue: true }, outlets: { arrayValue: { values: [{ stringValue: 'outlet' }] } } } });
        if (path.includes('/OUTLET/outlet?'))
            return Response.json({ fields: { active: { booleanValue: true } } });
        if (path.includes('/PRODUCT/product?'))
            return Response.json({ fields: { name: { stringValue: 'Tea' }, stockable: { booleanValue: true }, weighable: { booleanValue: false }, currentStock: { doubleValue: stock } } });
        return Response.json({}, { status: 404 });
    };
    await saveGoodsReceived(premisesTransactionRunner('projects/test/databases/(default)', async () => 'test', fetcher), 'outlet', 'user', assigned, { ...input, supplier: null, items: [{ ...input.items[0], quantity: 50 }] });
    assert.equal(stock, 90);
    assert.equal(attempts, 2);
    assert.equal(commits, 2);
});
test('new receipt refuses a Firestore document ID as the bill number without changing stock', async () => {
    for (const body of [
        { ...input, documentId: 'vW33EnzGPalfb910csEg', goodsReceivedNo: 'vW33EnzGPalfb910csEg' },
        { ...input, goodsReceivedNo: supplier.id },
        { ...input, goodsReceivedNo: ` ${input.documentId} ` },
    ]) {
        const f = fixture(), before = structuredClone(f.records);
        await assert.rejects(f.save(body), /document ID cannot be used as a bill number/i);
        assert.deepEqual(f.records, before);
        assert.equal(f.writes.length, 0);
    }
});
test('a legitimate supplied bill number is saved unchanged and survives report reads and retries', async () => {
    const f = fixture();
    const body = { ...input, goodsReceivedNo: '00038' };
    f.loseResponse();
    await assert.rejects(f.save(body), /Response lost/);
    const saved = structuredClone(f.records.get(`${base}/${input.documentId}`));
    assert.equal(saved.goodsReceivedNo, '00038');
    assert.notEqual(saved.goodsReceivedNo, input.documentId);
    const { stockMovementRecord } = await import('../src/stockMovementReport.js');
    assert.equal(stockMovementRecord(input.documentId, saved).transactionNo, '00038');
    assert.equal((await f.save(body)).alreadySaved, true);
    assert.deepEqual(f.records.get(`${base}/${input.documentId}`), saved);
    assert.equal(f.records.get('OUTLET/outlet/PRODUCT/product').currentStock, 61);
    assert.equal(f.writes.length, 2);
});
test('legacy ID-as-number receipts acknowledge retries without rewriting history or incrementing stock', async () => {
    const f = fixture();
    await f.save();
    f.records.get(`${base}/${input.documentId}`).goodsReceivedNo = input.documentId;
    const before = structuredClone(f.records), writes = f.writes.length;
    assert.equal((await f.save({ ...input, goodsReceivedNo: input.documentId })).alreadySaved, true);
    assert.deepEqual(f.records, before);
    assert.equal(f.writes.length, writes);
});
//# sourceMappingURL=goodsReceived.test.js.map