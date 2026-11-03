import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import './ReportDateInput.css';
import './ReportMonthInput.css';

interface ReportMonthInputProps {
  value: string;
  onChange: (value: string) => void;
  'aria-label'?: string;
}

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthId = (date: Date) => `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const monthDate = (year: number, month: number) => {
  const date = new Date(0);
  date.setFullYear(year, month, 1);
  date.setHours(12, 0, 0, 0);
  return date;
};

function parseMonth(value: string): Date | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match || Number(match[1]) < 1) return null;
  return monthDate(Number(match[1]), Number(match[2]) - 1);
}

export function ReportMonthInput({ value, onChange, 'aria-label': label = 'Month and year' }: ReportMonthInputProps) {
  const calendarId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const monthRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusMonth = useRef(false);
  const selected = parseMonth(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => selected ?? new Date());
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320 });
  const today = monthId(new Date());
  const display = selected?.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) ?? 'Choose month';
  const years = Array.from({ length: 121 }, (_, index) => new Date().getFullYear() - 100 + index)
    .filter(year => year >= 1 && year <= 9999);
  if (!years.includes(view.getFullYear())) years.push(view.getFullYear());

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  const show = () => {
    focusMonth.current = true;
    setView(selected ?? new Date());
    setOpen(true);
  };
  const choose = (month: string) => {
    onChange(month);
    close(true);
  };
  const changeView = (year: number, month: number, moveFocus = false) => {
    focusMonth.current = moveFocus;
    setView(monthDate(Math.max(1, Math.min(9999, year)), month));
  };
  const navigateMonth = (event: KeyboardEvent<HTMLButtonElement>, month: number) => {
    const current = (view.getFullYear() - 1) * 12 + month;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': next = current - 1; break;
      case 'ArrowRight': next = current + 1; break;
      case 'ArrowUp': next = current - 3; break;
      case 'ArrowDown': next = current + 3; break;
      case 'Home': next = current - month; break;
      case 'End': next = current - month + 11; break;
      case 'PageUp': next = view.getFullYear() > 1 ? current - 12 : current; break;
      case 'PageDown': next = view.getFullYear() < 9999 ? current + 12 : current; break;
      default: return;
    }
    event.preventDefault();
    next = Math.max(0, Math.min(9999 * 12 - 1, next));
    changeView(Math.floor(next / 12) + 1, next % 12, true);
  };

  useLayoutEffect(() => {
    if (open && focusMonth.current) {
      focusMonth.current = false;
      monthRefs.current[view.getMonth()]?.focus();
    }
  }, [open, view]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 24);
      const height = calendarRef.current?.offsetHeight || 330;
      const top = rect.bottom + 8 + height <= window.innerHeight - 12
        ? rect.bottom + 8 : Math.max(12, rect.top - height - 8);
      setPosition({ top, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !calendarRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) close(true);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  return <div className="report-date-control">
    <button ref={triggerRef} type="button" className={`report-date-trigger${selected ? '' : ' is-empty'}`}
      aria-label={`${label}: ${display}`} aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? calendarId : undefined}
      onClick={() => open ? close() : show()}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); show(); } }}>
      <CalendarDays aria-hidden="true" /><span>{display}</span><ChevronDown aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={calendarRef} id={calendarId} className="report-date-calendar report-month-calendar" role="dialog"
      aria-label={`${label} calendar`} style={{ top: position.top, left: position.left, width: position.width }}>
      <div className="report-date-caption"><CalendarDays aria-hidden="true" /><span>{label}</span><small>MMM YYYY</small></div>
      <div className="report-date-navigation">
        <button type="button" aria-label="Previous year" disabled={view.getFullYear() === 1} onClick={() => changeView(view.getFullYear() - 1, view.getMonth(), true)}><ChevronLeft /></button>
        <div className="report-date-month-selects">
          <select aria-label="Month" value={view.getMonth()} onChange={event => changeView(view.getFullYear(), Number(event.target.value))}>
            {months.map((month, index) => <option key={month} value={index}>{month}</option>)}
          </select>
          <select aria-label="Year" value={view.getFullYear()} onChange={event => changeView(Number(event.target.value), view.getMonth())}>
            {years.sort((a, b) => a - b).map(year => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>
        <button type="button" aria-label="Next year" disabled={view.getFullYear() === 9999} onClick={() => changeView(view.getFullYear() + 1, view.getMonth(), true)}><ChevronRight /></button>
      </div>
      <div className="report-month-grid" role="group" aria-label="Select a month">
        {months.map((month, index) => {
          const key = monthId(monthDate(view.getFullYear(), index));
          return <button type="button" key={index} ref={element => { monthRefs.current[index] = element; }}
            tabIndex={index === view.getMonth() ? 0 : -1}
            onFocus={() => { if (index !== view.getMonth()) changeView(view.getFullYear(), index); }}
            onKeyDown={event => navigateMonth(event, index)} aria-pressed={key === value} aria-label={month}
            className={[key === value ? 'is-selected' : '', key === today ? 'is-current' : ''].join(' ')}
            onClick={() => choose(key)}>{month.slice(0, 3)}</button>;
        })}
      </div>
      <div className="report-date-footer"><span>{display}</span><button type="button" onClick={() => choose(today)}>This month</button></div>
    </div>, document.body)}
  </div>;
}
