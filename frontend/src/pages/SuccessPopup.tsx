import { Check } from 'lucide-react';
import { ActionPopup } from './ActionPopup.tsx';

export function successMessage(message: string): string {
  const action = /\b(deleted|removed|updated|added|created|uploaded|saved|assigned|transferred|downloaded)\b/i.exec(message)?.[1]?.toLowerCase();
  if (action) {
    const label = action === 'created' ? 'Added' : action.charAt(0).toUpperCase() + action.slice(1);
    return `${label} successfully.`;
  }
  return message.endsWith('.') ? message : `${message}.`;
}

export function SuccessPopup({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return <ActionPopup title="Success!" onCancel={onDismiss} className="action-success category-updated-popup"
    footer={<button type="button" data-initial-focus className="btn-primary-add success-done" onClick={onDismiss}>Done</button>}>
    <span className="success-checkmark" aria-hidden="true"><Check size={34} strokeWidth={2} /></span>
    <p className="success-message" role="status">{successMessage(message)}</p>
  </ActionPopup>;
}
