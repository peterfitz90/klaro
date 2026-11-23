import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State { error: Error | null }

// Any render error shows a real error page, never a blank screen.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // No PII in logs: the message and component stack only.
    console.error('[ui] render error:', error.message, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="page" role="alert">
        <h1 className="topbar-title" style={{ margin: '24px 0 12px' }}>Something went wrong</h1>
        <p className="msg msg-error">This page could not be shown. Please reload, or try again in a minute.</p>
        <p style={{ marginTop: 16 }}><a href="/">Back to Klaro</a></p>
      </main>
    );
  }
}
