import { createContext, useContext, type HTMLAttributes, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import './PageHeading.css';

const WorkspaceBackContext = createContext<(() => void) | null>(null);

export function WorkspaceBackProvider({ onBack, children }: { onBack: (() => void) | null; children: ReactNode }) {
  return <WorkspaceBackContext.Provider value={onBack}>{children}</WorkspaceBackContext.Provider>;
}

// Keep each page's existing heading level, text and styles. The workspace supplies
// the same Back action used for navigation and protected in-page editors.
export function PageHeading({ as: Heading = 'h1', onBack, backDisabled, className, children, ...props }: HTMLAttributes<HTMLHeadingElement> & {
  as?: 'h1' | 'h2' | 'h3'; onBack?: () => void; backDisabled?: boolean;
}) {
  const workspaceBack = useContext(WorkspaceBackContext);
  const back = onBack ?? workspaceBack;
  return <Heading {...props} className={['workspace-page-heading', className].filter(Boolean).join(' ')}>
    {back && <button type="button" className="workspace-back" aria-label="Back to previous screen" title="Back"
      disabled={backDisabled} onClick={back}><ArrowLeft aria-hidden="true" /></button>}
    {children}
  </Heading>;
}
