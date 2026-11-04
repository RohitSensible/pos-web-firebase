import { Plus } from 'lucide-react';
import './MobileAddButton.css';

export function MobileAddButton({ label, onClick, disabled = false, className = '' }: { label: string; onClick: () => void; disabled?: boolean; className?: string }) {
  return <button type="button" className={`${className} mobile-add-trigger`} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
    <Plus size={16} aria-hidden="true" /><span className="mobile-add-label">{label}</span>
  </button>;
}
