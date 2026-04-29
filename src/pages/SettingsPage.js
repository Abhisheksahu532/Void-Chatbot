import React from 'react';
import { useAuth } from '../context/AuthContext';

export default function SettingsPage() {
  const { user, signOut } = useAuth();

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
  label: { fontSize: 10, color: '#6a6a88', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 },
  accountRow: { display: 'flex', gap: 32, marginBottom: 20 },
  accountValue: { fontSize: 13, color: '#e8e8f0', marginTop: 4 },
  dangerBtn: { background: 'transparent', border: '1px solid #ff6a9b', color: '#ff6a9b', fontFamily: "'Space Mono', monospace", fontSize: 11, padding: '8px 20px', borderRadius: 6, cursor: 'pointer', letterSpacing: 1 },
};
