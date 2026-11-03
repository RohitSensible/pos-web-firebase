import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LockKeyhole } from 'lucide-react';
import './QuickPinModal.css';

// The one Quick PIN verification pop-up used everywhere in Web POS. One real
// (masked) input sits over the boxes, so typing advances box to box and
// Backspace and paste behave naturally. Shows 4 boxes; a 5th or 6th box appears
// only when maxDigits allows longer login PINs and the user keeps typing.
// Cancel stays available while verifying; callers abort the in-flight request.
export function QuickPinModal({ inputId, pin, onPinChange, maxDigits = 4, busy, error, onCancel, onSubmit }: {
  inputId: string; pin: string; onPinChange: (pin: string) => void; maxDigits?: 4 | 6;
  busy: boolean; error: string; onCancel: () => void; onSubmit: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(true);
  useEffect(() => { dialog.current?.showModal(); input.current?.focus(); }, []);
  useEffect(() => { if (!busy) input.current?.focus(); }, [busy, error]);
  const boxes = Math.min(maxDigits, Math.max(4, pin.length));
  const active = Math.min(pin.length, boxes - 1);
  const ready = pin.length >= 4 && pin.length <= maxDigits;
  const submit = (event: FormEvent) => { event.preventDefault(); if (ready && !busy) onSubmit(); };
  return <dialog ref={dialog} className="quick-pin-modal" aria-labelledby={`${inputId}-title`} aria-describedby={`${inputId}-help`}
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    <span className="quick-pin-lock" aria-hidden="true"><LockKeyhole size={20} /></span>
    <form onSubmit={submit}>
      <h2 id={`${inputId}-title`}>Verify Quick PIN</h2>
      <p id={`${inputId}-help`}>Enter your 4-digit security PIN</p>
      <div className="quick-pin-boxes" onClick={() => input.current?.focus()}>
        <input ref={input} id={inputId} type="password" inputMode="numeric" autoComplete="off" aria-label="Quick PIN"
          pattern={maxDigits === 4 ? '[0-9]{4}' : '[0-9]{4,6}'} minLength={4} maxLength={maxDigits} value={pin} disabled={busy}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onChange={event => onPinChange(event.target.value.replace(/\D/g, '').slice(0, maxDigits))} />
        {Array.from({ length: boxes }, (_, index) => <span key={index} aria-hidden="true"
          className={`quick-pin-box${index < pin.length ? ' filled' : ''}${focused && !busy && index === active ? ' active' : ''}`}>
          {index < pin.length ? '●' : ''}
        </span>)}
      </div>
      {error && <p className="quick-pin-error" role="alert">{error}</p>}
      <div className="quick-pin-actions">
        <button type="button" className="quick-pin-cancel" onClick={onCancel}>Cancel</button>
        <button type="submit" className="quick-pin-verify" disabled={busy || !ready}>{busy ? 'Verifying…' : 'Verify'}</button>
      </div>
    </form>
  </dialog>;
}
