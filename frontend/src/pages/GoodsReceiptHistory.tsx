import { useEffect, useRef, useState } from 'react';
import { ActionPopup } from './ActionPopup.tsx';
import { GoodsReceiptError, goodsReceiptRequest } from './goodsReceivedApi.ts';
import './StockPlanning.css';
import './MobileRecords.css';

export type HistoryReceipt = { documentId: string; fields: { goodsReceivedNo?: string; createDate?: number; type?: string;
  supplier?: { name?: string } | null; goodsReceivedItemBeanList?: { productid?: string; name?: string; quantity?: number; currentStock?: number }[] } };
type HistoryPage = { receipts: HistoryReceipt[]; nextCursor: string | null };
const day = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export function GoodsReceiptHistory({ outletId, token, onSessionExpired, onClose, productId }: {
  outletId: string; token: string; onSessionExpired: () => void; onClose: () => void; productId?: string;
}) {
  const [dates, setDates] = useState(() => ({ from: day(new Date(Date.now() - 29 * 86400000)), to: day(new Date()) }));
  const [applied, setApplied] = useState(dates);
  const [cursors, setCursors] = useState(['']);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<HistoryPage | null>(null);
  const [error, setError] = useState('');
  const sessionExpired = useRef(onSessionExpired); sessionExpired.current = onSessionExpired;
  const cursor = cursors.at(-1)!;
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const timeout = setTimeout(() => { controller.abort(); if (current) setError('Receipt history timed out. Retry loading this page.'); }, 20000);
    setData(null); setError('');
    const query = new URLSearchParams({ history: '1', ...applied, limit: '25', ...(cursor ? { cursor } : {}) });
    void goodsReceiptRequest<HistoryPage>(`/api/outlets/${encodeURIComponent(outletId)}/goods-received?${query}`, token, controller.signal)
      .then(page => { if (current && !controller.signal.aborted) setData(page); })
      .catch(reason => { if (!current || controller.signal.aborted) return;
        if (reason instanceof GoodsReceiptError && reason.status === 401) sessionExpired.current();
        setError(reason instanceof Error ? reason.message : 'Unable to load receipt history.');
      }).finally(() => clearTimeout(timeout));
    return () => { current = false; controller.abort(); clearTimeout(timeout); };
  }, [outletId, token, applied, cursor, reload]);
  const changePage = (next: string[]) => { setData(null); setError(''); setCursors(next); };
  const receipts = data?.receipts.filter(receipt => !productId || receipt.fields.goodsReceivedItemBeanList?.some(item => item.productid === productId)) ?? [];
  return <ActionPopup className="stock-planning-dialog" title={productId ? 'Recorded product movements' : 'Receipt history'} onCancel={onClose}
    footer={<button type="button" className="btn-secondary" data-initial-focus onClick={onClose}>Close history</button>}>
    <form className="stock-planning-filters" onSubmit={event => { event.preventDefault(); setData(null); setApplied({ ...dates }); setCursors(['']); }}>
      <label>From date<input type="date" required value={dates.from} max={dates.to} onChange={event => setDates(value => ({ ...value, from: event.target.value }))} /></label>
      <label>To date<input type="date" required value={dates.to} min={dates.from} onChange={event => setDates(value => ({ ...value, to: event.target.value }))} /></label>
      <button type="submit" className="btn-secondary">Apply dates</button>
    </form>
    <p className="stock-planning-help">Dates use India time. Shows up to 25 records per page. {productId ? 'Only matching items from this page are shown; continue through pages to inspect earlier records. Receipts and movements are supporting records, not a complete stock ledger.' : 'Receipts record deliveries; they do not automatically update product stock.'}</p>
    {!data && !error && <p role="status">Loading history…</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => { setError(''); setReload(value => value + 1); }}>Retry history</button></p>}
    {data && <><div className="stock-planning-scroll"><table className="mobile-record-table"><thead><tr><th>Reference / date</th><th>Type / supplier</th><th>Products and quantities</th></tr></thead><tbody>
      {receipts.map(receipt => <tr key={receipt.documentId}><td data-label="Reference / date" className="mobile-record-name">{receipt.fields.goodsReceivedNo || receipt.documentId}<small>{typeof receipt.fields.createDate === 'number' ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(receipt.fields.createDate)) : 'Date unavailable'}</small></td><td data-label="Type / supplier">{receipt.fields.type || 'Unspecified'}<small>{receipt.fields.supplier?.name || 'No supplier'}</small></td><td data-label="Products and quantities" className="mobile-record-wide">{receipt.fields.goodsReceivedItemBeanList?.filter(item => !productId || item.productid === productId).map((item, index) => <div key={index}>{item.name || item.productid || 'Unnamed product'}: {typeof item.quantity === 'number' ? item.quantity : 'Unavailable'}{typeof item.currentStock === 'number' && <small>Stock captured at entry: {item.currentStock}</small>}</div>)}</td></tr>)}
    </tbody></table></div>{!receipts.length && <p>No matching records on this page.</p>}
      <div className="stock-planning-actions"><button type="button" className="btn-secondary" disabled={cursors.length <= 1} onClick={() => changePage(cursors.slice(0, -1))}>Previous history page</button><span>Page {cursors.length}</span><button type="button" className="btn-secondary" disabled={!data.nextCursor} onClick={() => changePage([...cursors, data.nextCursor!])}>Next history page</button></div></>}
  </ActionPopup>;
}
