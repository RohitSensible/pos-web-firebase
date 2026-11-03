import { useEffect, useId, useRef, useState } from 'react';
import { Printer, X } from 'lucide-react';
import { dashboardShiftStatus } from '../../../shared/shiftStatus.ts';
import { printDocument } from '../utils/printDocument.ts';
import { useWorkspaceBack } from '../utils/useWorkspaceBack.ts';
import type { ShiftRecord } from './shiftReportTypes.ts';
import './ShiftDetailsDialog.css';

const unavailable = 'Not Available';
const text = (value?: string) => value?.trim() ? value : unavailable;
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
function dateTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(new Date(value).getTime())) return unavailable;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}
function paymentLabel(mode: string) {
  const labels: Record<string, string> = {
    cash: 'Cash', card: 'Card', digital: 'Digital', googlepay: 'Google Pay', phonepe: 'PhonePe',
    paytm: 'Paytm', upi: 'UPI', credit: 'Credit', cheque_payment_mode: 'Cheque', other: 'Other',
  };
  return labels[mode.toLowerCase()] || mode;
}

export function ShiftDetailsDialog({ shift, outletName, onClose }: {
  shift: ShiftRecord; outletName: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const lifecycle = useRef(0);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState('');
  const titleId = useId();
  const status = dashboardShiftStatus(shift);
  const end = shift.endTime === 0 && status === 'Active' ? 'In progress' : dateTime(shift.endTime);
  useWorkspaceBack(true, onClose);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = dialog.current!;
    if (!modal.open) modal.showModal();
    closeButton.current?.focus();
    return () => {
      lifecycle.current++;
      modal.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  async function printShift() {
    if (pending.current || !content.current) return;
    pending.current = true;
    const request = lifecycle.current;
    setPrinting(true);
    setPrintError('');
    try {
      await printDocument(content.current, `${outletName} · Shift ${shift.shiftNo} · ${shift.dayId} · ${shift.deviceId}`);
    } catch {
      if (lifecycle.current === request) setPrintError('Unable to print shift details. Please try again.');
    } finally {
      pending.current = false;
      if (lifecycle.current === request) setPrinting(false);
    }
  }
  const payments = Object.entries(shift.payments).filter(([, amount]) => amount > 0);
  return <dialog ref={dialog} className="shift-details-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <article ref={content} className="bill-detail-modal shift-details-card">
      <header>
        <div><span>SHIFT SUMMARY</span><h2 id={titleId}>Shift {shift.shiftNo} · {text(shift.dayId)}</h2>
          <strong className="shift-details-outlet">{text(outletName)}</strong>
          <p>{dateTime(shift.startTime)} → {end}</p></div>
        <button ref={closeButton} type="button" aria-label="Close shift details" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="shift-details-scroll" tabIndex={0} role="region" aria-label="Shift details">
        <div className="bill-detail-meta shift-details-meta">
          {[
            ['Status', status], ['Day ID', text(shift.dayId)], ['Shift ID', text(shift.id)],
            ['Device', text(shift.deviceId)], ['Created by', text(shift.creatorName)], ['Creator ID', text(shift.userId)],
            ['Start time', dateTime(shift.startTime)], ['End time', end],
            ['Bill range', `${text(shift.startBillNo)} – ${text(shift.lastBillNo)}`],
            ['Last bill time', dateTime(shift.lastBillTime)], ['Bill count', shift.billCount],
            ['Deleted bills', `${shift.billDeletesNumber} · ${money(shift.billDeletesAmount)}`],
          ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        <div className="shift-details-columns">
          <section className="shift-details-figures"><h3>Payments</h3>
            <div><span>Cash sale</span><strong>{money(shift.cashSale)}</strong></div>
            <div><span>Digital sale</span><strong>{money(shift.digitalSale)}</strong></div>
            <div><span>Credit sale</span><strong>{money(shift.creditSale)}</strong></div>
            {payments.map(([mode, amount]) => <div key={mode}><span>{paymentLabel(mode)}</span><strong>{money(amount)}</strong></div>)}
            {!payments.length && <div><span>No payments recorded</span><strong>{money(0)}</strong></div>}
            <div><span>Swiggy</span><strong>{money(shift.swiggyTotal)}</strong></div>
            <div><span>Zomato</span><strong>{money(shift.zomatoTotal)}</strong></div>
          </section>
          <section className="shift-details-figures"><h3>Cash Drawer</h3>
            {[
              ['Opening amount', shift.openingAmt], ['Cash sale', shift.cashSale], ['Cash expenses', shift.expCash],
              ['Digital expenses', shift.expDigital], ['Total expenses', shift.expensesAmtTotal],
              ['Advance received', shift.advanceAmtTotal], ['Customer receipts', shift.customerReceiveAmtTotal],
              ['Total receipts', shift.receiveAmtTotal], ['Cash in hand', shift.openingAmt + shift.cashSale - shift.expCash],
            ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{money(value as number)}</strong></div>)}
          </section>
        </div>
        <section className="shift-details-figures shift-details-totals"><h3>Sales</h3>
          {[
            ['Sub total', shift.subTotalBill], ['Discount', shift.discount], ['Tax', shift.tax],
            ['GST', shift.gstTotal], ['VAT', shift.vatTotal], ['Service charge', shift.serviceChargeAmount],
            ['Extra charges', shift.extraCharges], ['Refunds', shift.refundAmount], ['Round off', shift.roundOff],
          ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{money(value as number)}</strong></div>)}
          <div className="grand-total"><span>Total Sale</span><strong>{money(shift.totalSale)}</strong></div>
        </section>
      </div>
      <footer>{printError && <p role="alert">{printError}</p>}
        <button type="button" disabled={printing} onClick={() => void printShift()}><Printer size={16} />{printing ? 'Preparing print…' : 'Print / Save PDF'}</button>
      </footer>
    </article>
  </dialog>;
}
