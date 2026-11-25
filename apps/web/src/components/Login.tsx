import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { ErrorBox } from './FieldError';

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting || !password) return;
    setSubmitting(true);
    setError(undefined);
    const r = await api.login(password);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.message);
      if (r.code === 'invalid_credentials') setPassword('');
      return;
    }
    setPassword('');
    onSignedIn();
  }

  return (
    <form className="card form" onSubmit={onSubmit} aria-label="உள்நுழைவு">
      <h2>உள்நுழைவு</h2>
      {/* Lets iOS Keychain / password managers remember the owner password. */}
      <input
        className="visually-hidden"
        type="text"
        name="username"
        autoComplete="username"
        value="thiran-owner"
        readOnly
        tabIndex={-1}
        aria-hidden="true"
      />
      <ErrorBox message={error} />
      <label>
        கடவுச்சொல்
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
        />
      </label>
      <button type="submit" className="button" disabled={submitting || !password}>
        {submitting ? 'சரிபார்க்கிறது…' : 'உள்நுழை'}
      </button>
    </form>
  );
}

export function SetupRequired({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="card">
      <h2>முதல் அமைப்பு தேவை</h2>
      <p>
        பாதுகாப்புக்காக, owner கடவுச்சொல்லை server இயங்கும் கணினியில் மட்டுமே அமைக்க முடியும். அந்தக் கணினியின்
        terminal-இல் இதை ஓட்டுங்கள்:
      </p>
      <pre className="code">pnpm set-password</pre>
      <button type="button" className="button" onClick={onRetry}>
        அமைத்துவிட்டேன், மீண்டும் சரிபார்
      </button>
    </section>
  );
}
