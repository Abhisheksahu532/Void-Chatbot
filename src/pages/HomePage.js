import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { pingEndpoint, fetchContextInfo } from '../lib/api';

export default function HomePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [testing, setTesting] = useState(false);

  // Get endpoint from localStorage or env
  const endpoint = localStorage.getItem('void_endpoint') || process.env.REACT_APP_MODAL_ENDPOINT || '';
  const apiKey = localStorage.getItem('void_api_key') || process.env.REACT_APP_API_KEY || '';

  const testConnection = async () => {
    if (!endpoint || !apiKey) {
      setStatus('err');
      setStatusMsg('Endpoint or API key not configured');
      return;
    }
    
    setTesting(true);
    setStatus(null);
    setStatusMsg('Testing connection... (may take a few minutes)');
    
    try {
      const model = await pingEndpoint(endpoint, apiKey);
      setStatus('ok');
      setStatusMsg(`✓ Connected — ${model}`);
      // Also fetch context info
      await fetchContextInfo();
    } catch (e) {
      setStatus('err');
      setStatusMsg(`✕ ${e.message}`);
    }
    setTesting(false);
  };

  const isConnected = status === 'ok';

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={s.logo}>⬡ VOID</div>
        <div style={s.userInfo}>
          <span style={s.userEmail}>{user?.email}</span>
          <button style={s.logoutBtn} onClick={signOut}>Sign Out</button>
        </div>
      </div>

      <div style={s.body}>
        <div style={s.hero}>
          <div style={s.heroIcon}>⬡</div>
          <div style={s.heroTitle}>VOID Workspace</div>
          <div style={s.heroSubtitle}>Self-hosted · Multimodal · 32K Context</div>
        </div>

        <div style={s.card}>
          <div style={s.cardTitle}>Server Status</div>
          <div style={s.statusRow}>
            <div style={{...s.statusDot, background: isConnected ? '#4fffb0' : '#6a6a88'}} />
            <span style={s.statusText}>
              {isConnected ? 'Connected' : 'Not connected'}
            </span>
          </div>
          
          {statusMsg && (
            <div style={{...s.statusMsg, color: status === 'ok' ? '#4fffb0' : '#ff6a9b'}}>
              {statusMsg}
            </div>
          )}

          <button 
            style={{...s.testBtn, opacity: testing ? 0.5 : 1}} 
            onClick={testConnection}
            disabled={testing}
          >
            {testing ? 'Testing...' : '⚡ Test Connection'}
          </button>
          
          <div style={s.hint}>
            First time? Connection may take 2-4 minutes while the server cold starts.
          </div>
        </div>

        <div style={s.actions}>
          <button style={s.actionBtn} onClick={() => navigate('/chat')}>
            <span style={s.actionIcon}>💬</span>
            <span>Open Chat</span>
          </button>
          <button style={s.actionBtn} onClick={() => navigate('/settings')}>
            <span style={s.actionIcon}>⚙</span>
            <span>Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const s = {
  root: { height: '100vh', background: '#0a0a0f', display: 'flex', flexDirection: 'column', fontFamily: "'Space Mono', monospace", color: '#e8e8f0' },
  header: { background: '#111118', borderBottom: '1px solid #2a2a3a', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  logo: { fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 20, background: 'linear-gradient(135deg,#7c6aff,#ff6a9b)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' },
  userInfo: { display: 'flex', alignItems: 'center', gap: 16 },
  userEmail: { fontSize: 12, color: '#6a6a88' },
  logoutBtn: { background: 'transparent', border: '1px solid #2a2a3a', color: '#6a6a88', fontFamily: "'Space Mono', monospace", fontSize: 11, padding: '5px 12px', borderRadius: 4, cursor: 'pointer' },
  body: { flex: 1, overflowY: 'auto', padding: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 },
  hero: { textAlign: 'center', padding: '40px 0 20px' },
  heroIcon: { fontSize: 64, lineHeight: 1 },
  heroTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 32, background: 'linear-gradient(135deg,#7c6aff,#ff6a9b)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', marginTop: 16 },
  heroSubtitle: { fontSize: 11, color: '#6a6a88', letterSpacing: 1, marginTop: 8 },
  card: { background: '#111118', border: '1px solid #2a2a3a', borderRadius: 10, padding: 24, width: '100%', maxWidth: 400 },
  cardTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 16 },
  statusRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  statusDot: { width: 10, height: 10, borderRadius: '50%' },
  statusText: { fontSize: 13 },
  statusMsg: { fontSize: 12, marginBottom: 16, lineHeight: 1.5 },
  testBtn: { width: '100%', background: 'linear-gradient(135deg,#7c6aff,#ff6a9b)', border: 'none', borderRadius: 8, color: '#fff', fontFamily: "'Space Mono', monospace", fontSize: 13, fontWeight: 700, padding: 12, cursor: 'pointer', letterSpacing: 1 },
  hint: { fontSize: 10, color: '#6a6a88', marginTop: 12, textAlign: 'center' },
  actions: { display: 'flex', gap: 12, width: '100%', maxWidth: 400 },
  actionBtn: { flex: 1, background: '#111118', border: '1px solid #2a2a3a', borderRadius: 10, color: '#e8e8f0', fontFamily: "'Space Mono', monospace", fontSize: 12, padding: '20px 16px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, transition: 'all 0.15s' },
  actionIcon: { fontSize: 24 },
};
