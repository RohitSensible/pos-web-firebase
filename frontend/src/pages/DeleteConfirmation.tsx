import { ActionConfirmation } from './ActionPopup.tsx';

export function DeleteConfirmation({ kind, name, busy, onCancel, onConfirm, displayOnly = false, error, title }: {
  kind: 'product' | 'category' | 'service point' | 'premises' | 'employee' | 'customer'; name: string; busy: boolean; onCancel: () => void; onConfirm: () => void;
  displayOnly?: boolean; error?: string;
  title?: string;
}) {
  return <ActionConfirmation action={displayOnly ? 'clear' : 'delete'} item={name} title={title ?? (displayOnly ? 'Clear displayed categories?' : `Delete ${kind}?`)}
    busy={busy} error={error} onCancel={onCancel} onConfirm={onConfirm} className="delete-confirmation" />;
}
