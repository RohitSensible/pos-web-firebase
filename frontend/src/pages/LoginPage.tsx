import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import crmIllustration from '../assets/crm-login-illustration-v2.png';
import './LoginPage.css';

export interface UserSession {
  id: string;
  email: string;
  name: string;
  role: string;
  terminal: string;
  token: string;
}

interface LoginPageProps {
  onLoginSuccess: (user: UserSession) => void;
}

export const LoginPage = ({ onLoginSuccess }: LoginPageProps) => {
  const [email, setEmail] = useState('');
  const [quickPin, setQuickPin] = useState('');
  const [showQuickPin, setShowQuickPin] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const activeRequest = useRef<{ controller: AbortController; timeout: ReturnType<typeof setTimeout> } | null>(null);
  const loginCompleted = useRef(false);

  useEffect(() => () => {
    const request = activeRequest.current;
    activeRequest.current = null;
    if (request) {
      clearTimeout(request.timeout);
      request.controller.abort();
    }
  }, []);

  const handleLoginSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (activeRequest.current || loginCompleted.current) return;
    const controller = new AbortController();
    const request = {
      controller,
      timeout: setTimeout(() => {
        if (activeRequest.current !== request) return;
        activeRequest.current = null;
        controller.abort();
        setError('Sign in timed out. Please check your connection and select Sign in to try again.');
        setIsSubmitting(false);
      }, 20_000),
    };
    activeRequest.current = request;
    setError('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), quickPin, terminal: 'POS Workspace' }),
        signal: controller.signal,
      });
      if (activeRequest.current !== request) return;
      const result = await response.json() as {
        success: boolean;
        message?: string;
        data?: { token: string; user: Omit<UserSession, 'token'> };
      };

      if (activeRequest.current !== request) return;
      if (!response.ok || !result?.data || result.success === false) {
        setError(result?.message || 'Unable to sign in. Please try again.');
        return;
      }

      loginCompleted.current = true;
      onLoginSuccess({ ...result.data.user, token: result.data.token });
    } catch (error) {
      if (activeRequest.current !== request) return;
      setError(error instanceof SyntaxError
        ? 'The login server returned an unreadable response. Please try again.'
        : 'Cannot reach the login server. Please try again.');
    } finally {
      if (activeRequest.current === request) {
        clearTimeout(request.timeout);
        activeRequest.current = null;
        if (!loginCompleted.current) setIsSubmitting(false);
      }
    }
  };

  return (
    <div className="crm-login-page">
      <div className="login-orbit login-orbit-top" />
      <div className="login-orbit login-orbit-bottom" />

      <div className="crm-login-shell">
        <header className="crm-login-brand">
          <span className="crm-brand-crop"><img src="/logo1.png" alt="Sensible Connect" /></span>
          <span className="crm-brand-divider" />
          <strong>POS WORKSPACE</strong>
        </header>

        <section className="crm-login-card">
          <div className="crm-login-form-panel">
            <div className="crm-login-heading">
              <span>SECURE WORKSPACE ACCESS</span>
              <h1>Welcome back</h1>
              <p>Sign in with your workspace credentials.</p>
            </div>

            <form className="crm-password-form" onSubmit={handleLoginSubmit} aria-busy={isSubmitting}>
              <label htmlFor="crm-email">Email</label>
              <div className="crm-input-wrap"><Mail /><input id="crm-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Enter your email" autoComplete="email" disabled={isSubmitting} aria-describedby={error ? 'crm-login-error' : undefined} required /></div>
              <label htmlFor="crm-quick-pin">Quick PIN</label>
              <div className="crm-input-wrap"><LockKeyhole /><input id="crm-quick-pin" type={showQuickPin ? 'text' : 'password'} value={quickPin} onChange={(event) => setQuickPin(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Enter your quick PIN" autoComplete="current-password" inputMode="numeric" pattern="[0-9]{4,6}" minLength={4} maxLength={6} disabled={isSubmitting} aria-describedby={error ? 'crm-login-error' : undefined} required /><button type="button" aria-label="Toggle quick PIN visibility" aria-pressed={showQuickPin} disabled={isSubmitting} onClick={() => setShowQuickPin((value) => !value)}>{showQuickPin ? <EyeOff /> : <Eye />}</button></div>
              {error && <p id="crm-login-error" className="crm-form-error" role="alert">{error}</p>}
              <button className="crm-sign-in-button" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</button>
            
            </form>

          </div>

          <aside className="crm-login-promo">
            <span className="crm-product-pill">SENSIBLE POS</span>
            <h2>Turn every lead into<br />a clear next step.</h2>
            <p>Organize opportunities, automate follow-ups, and keep<br className="desktop-only" /> your entire sales team aligned in one workspace.</p>
            <img src={crmIllustration} alt="Team reviewing POS sales analytics" />
          </aside>
        </section>

        <footer>Copyright 2026 Sensible Connect. All rights reserved.</footer>
      </div>
    </div>
  );
};
