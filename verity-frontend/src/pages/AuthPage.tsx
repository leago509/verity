import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isLogin = mode === 'login';

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isLogin && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      if (isLogin) await login(email, password);
      else await register(name, email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded-md border px-3 py-2 text-sm';
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold">Verity</h1>
          <p className="text-sm text-slate-500">{isLogin ? 'Log in to your account' : 'Create your account'}</p>
        </div>
        {!isLogin && (
          <label className="block text-sm">Name
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        )}
        <label className="block text-sm">Email
          <input type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block text-sm">Password
          <input type="password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? 'Please wait…' : isLogin ? 'Log in' : 'Register'}
        </button>
        <p className="text-center text-sm text-slate-600">
          {isLogin ? (
            <>No account? <Link className="text-blue-700 underline" to="/register">Register</Link></>
          ) : (
            <>Already registered? <Link className="text-blue-700 underline" to="/login">Log in</Link></>
          )}
        </p>
      </form>
    </div>
  );
}
