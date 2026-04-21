import React, { useState, useEffect } from 'react';
import { pingEndpoint } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [tavilyKey, setTavilyKey] = useState('');
  const [r2PublicUrl, setR2PublicUrl] = useState('');
  const [r2BucketName, setR2BucketName] = useState('');
  const [r2AccountId, setR2AccountId] = useState('');
  const [status, setStatus] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setEndpoint(localStorage.getItem('void_endpoint') || process.env.REACT_APP_MODAL_ENDPOINT || '');
    setApiKey(localStorage.getItem('void_api_key') || process.env.REACT_APP_API_KEY || '');
    setTavilyKey(localStorage.getItem('void_tavily_key') || process.env.REACT_APP_TAVILY_API_KEY || '');
    setR2PublicUrl(localStorage.getItem('void_r2_public_url') || process.env.REACT_APP_R2_PUBLIC_URL || '');
    setR2BucketName(localStorage.getItem('void_r2_bucket') || process.env.REACT_APP_R2_BUCKET_NAME || 'void-media');
    setR2AccountId(localStorage.getItem('void_r2_account_id') || process.env.REACT_APP_R2_ACCOUNT_ID || '');
  }, []);

  const save = () => {
    localStorage.setItem('void_endpoint', endpoint);
    localStorage.setItem('void_api_key', apiKey);
    localStorage.setItem('void_tavily_key', tavilyKey);
    localStorage.setItem('void_r2_public_url', r2PublicUrl);
    localStorage.setItem('void_r2_bucket', r2BucketName);
    localStorage.setItem('void_r2_account_id', r2AccountId);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const ping = async () => {
    setStatus(null); setStatusMsg('Testing...');
    try {
      const model = await pingEndpoint(endpoint, apiKey);
      setStatus('ok'); setStatusMsg(`✓ Connected — ${model}`);
    } catch (e) {
      setStatus('err'); setStatusMsg(`✕ ${e.message}`);
    }
  };

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={s.title}>Settings</div>
        <div style={s.userInfo}>
          <span style={s.userEmail}>{user?.email}</span>
          <button style={s.logoutBtn} onClick={signOut}>Sign Out</button>
        </div>
      </div>

      <div style={s.body}>

        {/* Modal Endpoint */}
        <Section title="Modal Endpoint" desc="Your deployed vLLM server URL from Modal">
          <Field label="Endpoint URL">
            <input style={s.input} value={endpoint}
              onChange={e => setEndpoint(e.target.value)}
              placeholder="https://whyme--void-llm-server-serve.modal.run" />
          </Field>
          <Field label="API Key (X-API-Key header)">
            <input style={s.input} type="password" value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="void_sk_your_key_here" />
          </Field>
          <div style={s.row}>
            <button style={s.pingBtn} onClick={ping}>⚡ Test Connection</button>
            {statusMsg && (
              <span style={{ ...s.statusMsg, color: status === 'ok' ? '#4fffb0' : '#ff6a9b' }}>
                {statusMsg}
              </span>
            )}
          </div>
        </Section>

        {/* Web Search */}
        <Section title="Web Search — Tavily" desc="Live internet access for the AI. Toggle on/off per message in the chat.">
          <Field label="Tavily API Key">
            <input style={s.input} type="password" value={tavilyKey}
              onChange={e => setTavilyKey(e.target.value)}
              placeholder="tvly-xxxxxxxxxxxxxxxxxxxxxxxx" />
          </Field>
          <div style={s.hint}>
            Get a free key at <a href="https://tavily.com" target="_blank" rel="noreferrer" style={s.link}>tavily.com</a> — 1,000 searches/month free
          </div>
        </Section>

        {/* Cloudflare R2 */}
        <Section title="Cloudflare R2 — File Storage" desc="Stores uploaded images, videos, and documents. Falls back to Supabase Storage if not configured.">
          <Field label="R2 Account ID">
            <input style={s.input} value={r2AccountId}
              onChange={e => setR2AccountId(e.target.value)}
              placeholder="your_cloudflare_account_id" />
          </Field>
          <Field label="R2 Bucket Name">
            <input style={s.input} value={r2BucketName}
              onChange={e => setR2BucketName(e.target.value)}
              placeholder="void-media" />
          </Field>
          <Field label="R2 Public URL (from R2 bucket → Public Access)">
            <input style={s.input} value={r2PublicUrl}
              onChange={e => setR2PublicUrl(e.target.value)}
              placeholder="https://pub-xxxxxxxxxxxxxxxx.r2.dev" />
          </Field>
          <div style={s.hint}>
            ⚠ R2 Access Key ID and Secret are kept in your Modal backend secret (<code style={{ color: '#4fffb0' }}>void-app-secrets</code>) — never in the browser.
            File uploads are proxied through your Modal backend to keep credentials server-side.
            <br /><br />
            Free tier: <strong style={{ color: '#e8e8f0' }}>10GB storage + unlimited egress</strong>.
            Setup: <a href="https://cloudflare.com" target="_blank" rel="noreferrer" style={s.link}>cloudflare.com</a> → R2 → Create Bucket → Enable Public Access → Manage API Tokens.
          </div>
        </Section>

        {/* Account */}
        <Section title="Account" desc="Your VOID workspace account">
          <div style={s.accountRow}>
            <div>
              <div style={s.label}>Email</div>
              <div style={s.accountValue}>{user?.email}</div>
            </div>
            <div>
              <div style={s.label}>User ID</div>
              <div style={s.accountValue}>{user?.id?.slice(0, 16)}...</div>
            </div>
          </div>
          <button style={s.dangerBtn} onClick={signOut}>Sign Out of VOID</button>
        </Section>

        {/* Supabase SQL */}
        <Section title="Database Setup" desc="Run this SQL in your Supabase SQL editor once">
          <pre style={s.code}>{`-- Run once in Supabase SQL Editor
CREATE TABLE threads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT DEFAULT 'New Session',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID REFERENCES threads(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('user','assistant')),
  content TEXT,
  file_urls TEXT[],
  has_files BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);

ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own threads" ON threads FOR ALL
  USING (auth.uid() = user_id);
CREATE POLICY "own messages" ON messages FOR ALL
  USING (thread_id IN (
    SELECT id FROM threads WHERE user_id = auth.uid()
  ));`}</pre>
        </Section>

        <button style={s.saveBtn} onClick={save}>
          {saved ? '✓ Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, desc, children }) {
  return (
    <div style={s.section}>
      <div style={s.sectionTitle}>{title}</div>
      <div style={s.sectionDesc}>{desc}</div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={s.field}>
      <div style={s.label}>{label}</div>
      {children}
    </div>
  );
}

const s = {
  root: { height: '100vh', background: '#0a0a0f', display: 'flex', flexDirection: 'column', fontFamily: "'Space Mono', monospace", color: '#e8e8f0', overflow: 'hidden' },
  header: { background: '#111118', borderBottom: '1px solid #2a2a3a', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  title: { fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 18 },
  userInfo: { display: 'flex', alignItems: 'center', gap: 16 },
  userEmail: { fontSize: 12, color: '#6a6a88' },
  logoutBtn: { background: 'transparent', border: '1px solid #2a2a3a', color: '#6a6a88', fontFamily: "'Space Mono', monospace", fontSize: 11, padding: '5px 12px', borderRadius: 4, cursor: 'pointer' },
  body: { flex: 1, overflowY: 'auto', padding: '32px', maxWidth: 720, width: '100%', margin: '0 auto' },
  section: { background: '#111118', border: '1px solid #2a2a3a', borderRadius: 10, padding: 24, marginBottom: 20 },
  sectionTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 4 },
  sectionDesc: { fontSize: 11, color: '#6a6a88', marginBottom: 20, letterSpacing: 0.5 },
  field: { marginBottom: 16 },
  label: { fontSize: 10, color: '#6a6a88', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 },
  input: { width: '100%', background: '#0a0a0f', border: '1px solid #2a2a3a', borderRadius: 6, color: '#e8e8f0', fontFamily: "'Space Mono', monospace", fontSize: 13, padding: '10px 12px', outline: 'none', boxSizing: 'border-box' },
  row: { display: 'flex', alignItems: 'center', gap: 16, marginTop: 4 },
  pingBtn: { background: '#1a1a24', border: '1px solid #2a2a3a', color: '#7c6aff', fontFamily: "'Space Mono', monospace", fontSize: 11, padding: '8px 16px', borderRadius: 6, cursor: 'pointer', letterSpacing: 1 },
  statusMsg: { fontSize: 12 },
  hint: { fontSize: 11, color: '#6a6a88', marginTop: 8 },
  link: { color: '#7c6aff', textDecoration: 'none' },
  accountRow: { display: 'flex', gap: 32, marginBottom: 20 },
  accountValue: { fontSize: 13, color: '#e8e8f0', marginTop: 4 },
  dangerBtn: { background: 'transparent', border: '1px solid #ff6a9b', color: '#ff6a9b', fontFamily: "'Space Mono', monospace", fontSize: 11, padding: '8px 20px', borderRadius: 6, cursor: 'pointer', letterSpacing: 1 },
  code: { background: '#0a0a0f', border: '1px solid #2a2a3a', borderRadius: 6, padding: 16, fontSize: 11, color: '#4fffb0', overflowX: 'auto', lineHeight: 1.6, whiteSpace: 'pre-wrap' },
  saveBtn: { width: '100%', background: 'linear-gradient(135deg, #7c6aff, #ff6a9b)', border: 'none', borderRadius: 8, color: '#fff', fontFamily: "'Space Mono', monospace", fontSize: 13, fontWeight: 700, padding: 14, cursor: 'pointer', letterSpacing: 1, marginTop: 8 },
};
