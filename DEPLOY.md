# VOID Workspace — Deployment Guide

## Deploy to Vercel (5 minutes)

### Option A — Vercel CLI (recommended)
```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Inside this folder
cd void-workspace
vercel

# 3. Follow prompts — it auto-detects React
# 4. Add environment variables when asked, or add in dashboard after
```

### Option B — GitHub + Vercel Dashboard
1. Push this folder to a GitHub repo
2. Go to vercel.com → New Project → Import your repo
3. Framework: Create React App (auto-detected)
4. Add environment variables (see below)
5. Deploy

---

## Environment Variables (add in Vercel Dashboard)

Go to: Vercel → Your Project → Settings → Environment Variables

| Variable | Value |
|----------|-------|
| `REACT_APP_SUPABASE_URL` | Your Supabase project URL |
| `REACT_APP_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `REACT_APP_MODAL_ENDPOINT` | Your Modal endpoint URL |
| `REACT_APP_API_KEY` | Your custom API key (MY_API_KEY from Modal secret) |

---

## Supabase Setup (run once)

1. Go to supabase.com → your project → SQL Editor
2. Paste and run this:

```sql
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

CREATE POLICY "own threads" ON threads FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own messages" ON messages FOR ALL
  USING (thread_id IN (SELECT id FROM threads WHERE user_id = auth.uid()));
```

3. Go to Storage → Create bucket named `void-media` → set to Public
4. Go to Authentication → Settings → disable email confirmation for easier team onboarding

---

## Add Team Members

Go to Supabase → Authentication → Users → Invite User
Enter their email — they get a magic link to set their password.

---

## Local Development

```bash
# Copy env file
cp .env.example .env.local
# Fill in your values in .env.local

npm install
npm start
# Opens at http://localhost:3000
```

---

## File Structure

```
void-workspace/
├── public/
│   └── index.html
├── src/
│   ├── context/
│   │   └── AuthContext.js     # Global auth state, JWT persistence
│   ├── hooks/
│   │   └── useDB.js           # Supabase threads, messages, file upload
│   ├── lib/
│   │   ├── supabase.js        # Supabase client
│   │   └── api.js             # Modal endpoint calls, Tavily search
│   ├── pages/
│   │   ├── AuthPage.js        # Login / Signup
│   │   ├── ChatPage.js        # Main workspace
│   │   └── SettingsPage.js    # Settings + DB setup guide
│   ├── App.js                 # Router
│   └── index.js               # Entry point + global styles
├── vercel.json                # Vercel routing config
├── package.json
└── .env.example               # Copy to .env.local for local dev
```

---

## What's Included

- ✅ Login / Signup with email + password (Supabase Auth)
- ✅ Persistent login — JWT in localStorage, survives refresh
- ✅ Persistent chat history — saved to Supabase, loads from any device
- ✅ Multiple threads — create, rename, delete
- ✅ File upload — images, videos, PDFs (stored in Supabase Storage)
- ✅ Web search toggle — Tavily API, live internet access
- ✅ Safe mode toggle — switches between unrestricted and ChatGPT-style
- ✅ Analyze panel — summary, prompt snippets, topic tags
- ✅ Markdown rendering with code highlighting
- ✅ Settings page — configure endpoint, API key, Tavily key
- ✅ Supabase SQL setup guide built into Settings page
- ✅ Copy message / copy prompt snippet
- ✅ Collapsible sidebar
- ✅ Vercel deployment ready
