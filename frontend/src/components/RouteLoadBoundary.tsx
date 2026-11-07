import { Component, Suspense, type ReactNode } from 'react';
import { PageHeading } from './PageHeading.tsx';
import './RouteLoadBoundary.css';

// A rejected lazy import stays cached by React. Reload the document to recover
// rather than offering a retry that would immediately throw the same rejection.
export class RouteLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return (
      <section className="route-load-notice" role="alert" aria-labelledby="route-load-error-title">
        <PageHeading as="h2" id="route-load-error-title">Unable to open this page</PageHeading>
        <p>The page could not load or display. You can choose another page or reload to try again. Reloading will lose unsaved edits.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload page</button>
      </section>
    );
    return <Suspense fallback={<div className="route-load-notice" role="status" aria-live="polite" aria-busy="true">Loading page…</div>}>
      {this.props.children}
    </Suspense>;
  }
}
