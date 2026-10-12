'use client';

import { useActionState } from 'react';
import { LogIn } from 'lucide-react';
import { signIn, type FormMsg } from '../actions';

export function LoginForm() {
  const [state, action, pending] = useActionState<FormMsg, FormData>(signIn, null);
  return (
    <form action={action} style={{ display: 'grid', gap: 14 }}>
      <div className="field">
        <label htmlFor="email">E-posta</label>
        <input id="email" name="email" type="email" className="input" autoComplete="username" required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="password">Parola</label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      {state?.error && <div className="note err" role="alert">{state.error}</div>}
      <button className="btn primary" disabled={pending}><LogIn /> {pending ? 'Giriş yapılıyor…' : 'Giriş yap'}</button>
    </form>
  );
}
