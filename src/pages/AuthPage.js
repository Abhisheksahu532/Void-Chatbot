import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';

export default function AuthPage() {
  const { user, signIn, signUp } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState('');
  const [success, setSuccess] = useState('');

  if (user) return <Navigate to="/" replace />;

  const handle = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        await signUp(email, password, name);
        setSuccess('Account created! Check your email to confirm, then log in.');
        setMode('login');
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div style={styles.root}>
      <div style={styles.noise} />
      <div style={styles.glow} />

      <div style={styles.card}>
        <div style={styles.logo}>⬡ VOID</div>
        <div style={styles.logoSub}>Private AI Workspace</div>

        <div style={styles.tabs}>
          <button style={{ ...styles.tab, ...(mode === 'login' ? styles.tabActive : {}) }}
            onClick={() => { setMode('login'); setError(''); setSuccess(''); }}>
            Sign In
          </button>
          <button style={{ ...styles.tab, ...(mode === 'signup' ? styles.tabActive : {}) }}
            onClick={() => { setMode('signup'); setError(''); setSuccess(''); }}>
            Sign Up
          </button>
        </div>

        <form onSubmit={handle} style={styles.form}>
          {mode === 'signup' && (
            <div style={styles.field}>
              <label style={styles.label}>Full Name</label>
              <input style={styles.input} type="text" placeholder="Your name"
                value={name} onChange={e => setName(e.target.value)} required />
            </div>
          )}
          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input style={styles.input} type="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input style={styles.input} type="password" placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
          </div>

          {error && <div style={styles.error}>{error}</div>}
          {success && <div style={styles.successMsg}>{success}</div>}

          <button type="submit" style={styles.btn} disabled={loading}>
            {loading ? '...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div style={styles.footer}>
          Powered by Qwen2.5-VL 72B · Self-hosted on Modal
        </div>
      </div>
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100vh', background: '#0a0a0f',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative', overflow: 'hidden', fontFamily: "'Space Mono', monospace",
  },
  noise: {
    position: 'fixed', inset: 0, opacity: 0.03,
    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
    pointerEvents: 'none', zIndex: 0,
  },
  glow: {
    position: 'fixed', top: '20%', left: '50%', transform: 'translateX(-50%)',
    width: 600, height: 600, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(124,106,255,0.08) 0%, transparent 70%)',
    pointerEvents: 'none', zIndex: 0,
  },
  card: {
    position: 'relative', zIndex: 1,
    background: '#111118', border: '1px solid #2a2a3a',
    borderRadius: 12, padding: '40px 36px',
    width: '100%', maxWidth: 400,
    boxShadow: '0 0 60px rgba(124,106,255,0.08)',
  },
  logo: {
    fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 28,
    background: 'linear-gradient(135deg, #7c6aff, #ff6a9b)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
    backgroundClip: 'text', letterSpacing: -1, textAlign: 'center',
  },
  logoSub: {
    fontSize: 10, color: '#6a6a88', letterSpacing: 3,
    textTransform: 'uppercase', textAlign: 'center', marginTop: 4, marginBottom: 28,
  },
  tabs: { display: 'flex', background: '#1a1a24', borderRadius: 6, padding: 3, marginBottom: 24 },
  tab: {
    flex: 1, padding: '8px 0', background: 'transparent', border: 'none',
    color: '#6a6a88', fontFamily: "'Space Mono', monospace", fontSize: 12,
    cursor: 'pointer', borderRadius: 4, transition: 'all 0.15s', letterSpacing: 1,
  },
  tabActive: { background: '#2a2a3a', color: '#7c6aff' },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 10, color: '#6a6a88', letterSpacing: 2, textTransform: 'uppercase' },
  input: {
    background: '#0a0a0f', border: '1px solid #2a2a3a', borderRadius: 6,
    color: '#e8e8f0', fontFamily: "'Space Mono', monospace", fontSize: 13,
    padding: '10px 12px', outline: 'none', transition: 'border-color 0.15s',
  },
  error: {
    background: 'rgba(255,106,155,0.1)', border: '1px solid rgba(255,106,155,0.3)',
    borderRadius: 6, padding: '10px 12px', fontSize: 12, color: '#ff6a9b',
  },
  successMsg: {
    background: 'rgba(79,255,176,0.1)', border: '1px solid rgba(79,255,176,0.3)',
    borderRadius: 6, padding: '10px 12px', fontSize: 12, color: '#4fffb0',
  },
  btn: {
    background: 'linear-gradient(135deg, #7c6aff, #ff6a9b)',
    border: 'none', borderRadius: 6, color: '#fff',
    fontFamily: "'Space Mono', monospace", fontSize: 13, fontWeight: 700,
    padding: '12px', cursor: 'pointer', marginTop: 4, letterSpacing: 1,
    transition: 'opacity 0.2s',
  },
  footer: { fontSize: 10, color: '#3a3a50', textAlign: 'center', marginTop: 24, letterSpacing: 1 },
};
