import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../context/AuthContext';
import { useThreads, useMessages } from '../hooks/useDB';
import { chatCompletion, analyzeThread, uploadFileToModal } from '../lib/api';

export default function ChatPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { threads, loading: threadsLoading, createThread, updateThread, deleteThread } = useThreads();
  const [activeThreadId, setActiveThreadId] = useState(null);
  const { messages, addMessage } = useMessages(activeThreadId);

  //const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  // ── FIX: safe mode ON by default ─────────────────────────────────────────
  const [safeMode, setSafeMode] = useState(true);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [attachedPreviews, setAttachedPreviews] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [showAnalyze, setShowAnalyze] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [analyzeTab, setAnalyzeTab] = useState('summary');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copied, setCopied] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [renamVal, setRenamVal] = useState('');
  // ── Delete confirm popup state ────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState(null); // thread object to delete

  const messagesEndRef = useRef(null);
  const fileInputRef   = useRef(null);
  const textareaRef    = useRef(null);
  // ── FIX: use ref for textarea height to avoid re-renders on every keystroke
  const inputRef = useRef('');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    if (!activeThreadId && threads.length > 0) setActiveThreadId(threads[0].id);
  }, [threads, activeThreadId]);

  const handleNewThread = async () => {
    const t = await createThread('New Session');
    setActiveThreadId(t.id);
    setAnalysis(null);
    setAttachedFiles([]);
    setAttachedPreviews([]);
  };

  // ── FIX: typing lag — use uncontrolled textarea + ref for value ───────────
  // Only sync to React state on send, not on every keystroke
  const handleTextareaChange = useCallback((e) => {
    inputRef.current = e.target.value;
    // Auto-resize height without triggering component re-render
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
  }, []);

  const handleSend = async () => {
    const text = (textareaRef.current?.value || '').trim();
    if (sending || (!text && attachedFiles.length === 0)) return;

    // Clear textarea immediately — fast, no state update needed
    if (textareaRef.current) {
      textareaRef.current.value = '';
      textareaRef.current.style.height = 'auto';
    }
    inputRef.current = '';
    setSending(true);

    // ── threadId race fix: use local var ─────────────────────────────────
    let threadId = activeThreadId;
    if (!threadId) {
      const t = await createThread(text.slice(0, 40) || 'New Session');
      setActiveThreadId(t.id);
      threadId = t.id;
    }

    // Upload files
    let uploadedFiles = [];
    if (attachedFiles.length > 0) {
      setUploading(true);
      try {
        uploadedFiles = await Promise.all(
          attachedFiles.map(f => uploadFileToModal(f, user.id))
        );
      } catch (e) {
        console.error('Upload failed:', e);
        await addMessage('assistant', `⚠ File upload failed: ${e.message}`, [], threadId);
        setSending(false);
        setUploading(false);
        return;
      }
      setUploading(false);
      attachedPreviews.forEach(p => URL.revokeObjectURL(p.previewUrl));
      setAttachedFiles([]);
      setAttachedPreviews([]);
    }

    const fileUrls = uploadedFiles.map(f => f.url);
    await addMessage('user', text || '[File attached]', fileUrls, threadId);

    if (messages.length === 0) {
      await updateThread(threadId, { name: text.slice(0, 42) || 'File conversation' });
    }

    const history = messages.map(m => ({ role: m.role, content: m.content }));
    history.push({ role: 'user', content: text || 'Please analyze the attached files.' });

    try {
      const reply = await chatCompletion({ messages: history, uploadedFiles, webSearch, safeMode });
      const safeReply = (typeof reply === 'string' && reply.trim())
        ? reply.trim()
        : '⚠ Model returned empty response. Check browser console.';
      await addMessage('assistant', safeReply, [], threadId);
      await updateThread(threadId, { updated_at: new Date().toISOString() });
    } catch (e) {
      console.error('[VOID] chatCompletion error:', e);
      await addMessage('assistant', `⚠ Error: ${e.message}`, [], threadId);
    }

    setSending(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    setAttachedFiles(prev => [...prev, ...files]);
    const previews = files.map(f => ({
      name: f.name,
      mimeType: f.type,
      previewUrl: URL.createObjectURL(f),
      isImage: f.type.startsWith('image/'),
      isVideo: f.type.startsWith('video/'),
    }));
    setAttachedPreviews(prev => [...prev, ...previews]);
    e.target.value = '';
  };

  const removeFile = (idx) => {
    URL.revokeObjectURL(attachedPreviews[idx]?.previewUrl);
    setAttachedFiles(prev => prev.filter((_, i) => i !== idx));
    setAttachedPreviews(prev => prev.filter((_, i) => i !== idx));
  };

  const handleAnalyze = async () => {
    if (messages.length < 2) return;
    setAnalyzing(true); setShowAnalyze(true);
    try {
      const result = await analyzeThread(messages.map(m => ({ role: m.role, content: m.content })));
      setAnalysis(result);
    } catch (e) { console.error(e); }
    setAnalyzing(false);
  };

  const copyText = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(''), 2000);
  };

  const startRename = (t) => { setRenaming(t.id); setRenamVal(t.name); };
  const submitRename = async (id) => { await updateThread(id, { name: renamVal }); setRenaming(null); };

  // ── Delete with confirmation ───────────────────────────────────────────────
  const confirmDelete = (t, e) => {
    e.stopPropagation();
    setDeleteConfirm(t);
  };
  const doDelete = async () => {
    if (!deleteConfirm) return;
    await deleteThread(deleteConfirm.id);
    if (deleteConfirm.id === activeThreadId) setActiveThreadId(null);
    setDeleteConfirm(null);
  };

  const activeThread = threads.find(t => t.id === activeThreadId);
  const isUnrestricted = !safeMode;

  return (
    <div style={s.root}>

      {/* ── DELETE CONFIRM POPUP ─────────────────────────────────────────── */}
      {deleteConfirm && (
        <div style={s.popupOverlay} onClick={() => setDeleteConfirm(null)}>
          <div style={s.popup} onClick={e => e.stopPropagation()}>
            <div style={s.popupTitle}>Delete Thread?</div>
            <div style={s.popupBody}>
              "<strong>{deleteConfirm.name}</strong>" and all its messages will be permanently deleted.
            </div>
            <div style={s.popupActions}>
              <button style={s.popupCancel} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button style={s.popupDelete} onClick={doDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── SIDEBAR ─────────────────────────────────────────────────────── */}
      <div style={{ ...s.sidebar, ...(sidebarOpen ? {} : { width: 0, overflow: 'hidden', borderRight: 'none' }) }}>
        <div style={s.sidebarHeader}>
          <div style={s.logo}>⬡ VOID</div>
          <button style={s.iconBtn} onClick={() => navigate('/settings')}>⚙</button>
        </div>

        <button style={s.newBtn} onClick={handleNewThread}>+ NEW THREAD</button>

        <div style={s.threadSection}>THREADS</div>
        <div style={s.threadList}>
          {threadsLoading
            ? <div style={s.threadLoading}>Loading...</div>
            : threads.length === 0
            ? <div style={s.threadEmpty}>No threads yet.<br />Start chatting!</div>
            : threads.map(t => (
            <div key={t.id}
              style={{ ...s.threadItem, ...(t.id === activeThreadId ? s.threadActive : {}) }}
              onClick={() => { setActiveThreadId(t.id); setAnalysis(null); }}>
              {renaming === t.id ? (
                <input style={s.renameInput} value={renamVal}
                  onChange={e => setRenamVal(e.target.value)}
                  onBlur={() => submitRename(t.id)}
                  onKeyDown={e => e.key === 'Enter' && submitRename(t.id)}
                  autoFocus onClick={e => e.stopPropagation()} />
              ) : (
                <>
                  <span style={s.threadDot} />
                  <span style={s.threadName}>{t.name}</span>
                  {/* ── FIX: always visible action buttons, styled properly */}
                  <div style={s.threadActions}>
                    <button style={s.tinyBtn} title="Rename"
                      onClick={e => { e.stopPropagation(); startRename(t); }}>✎</button>
                    <button style={{ ...s.tinyBtn, ...s.tinyBtnDelete }} title="Delete"
                      onClick={e => confirmDelete(t, e)}>✕</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div style={s.sidebarFooter}>
          <div style={s.userBadge}>
            <div style={s.userDot} />
            <span style={s.userEmail}>{user?.email}</span>
          </div>
          <button style={s.signoutBtn} onClick={signOut}>Sign Out</button>
        </div>
      </div>

      {/* ── MAIN ────────────────────────────────────────────────────────── */}
      <div style={s.main}>

        {/* Header */}
        <div style={s.header}>
          <div style={s.headerLeft}>
            <button style={s.sidebarToggle} onClick={() => setSidebarOpen(p => !p)}>☰</button>
            <div style={s.headerTitle}>{activeThread?.name || 'New Thread'}</div>
          </div>
          <div style={s.headerRight}>
            {/* Mode badge */}
            <div style={isUnrestricted ? s.badgeUnsafe : s.badgeSafe}>
              {isUnrestricted ? '🔓 Unrestricted' : '🛡 Safe Mode'}
            </div>
            {webSearch && <div style={s.searchBadge}>🌐 Web ON</div>}
            <button style={s.hBtn} onClick={handleAnalyze}>⚡ Analyze</button>
            <button style={s.hBtn} onClick={() => navigate('/settings')}>⚙ Settings</button>
          </div>
        </div>

        {/* Messages */}
        <div style={s.messages}>
          {!activeThreadId || messages.length === 0
            ? <Welcome onQuick={(q) => {
                if (textareaRef.current) { textareaRef.current.value = q; textareaRef.current.focus(); }
              }} />
            : messages.map(m => <Message key={m.id} msg={m} onCopy={copyText} />)
          }
          {sending && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>

        {/* Rich file previews before sending */}
        {attachedPreviews.length > 0 && (
          <div style={s.filesPreview}>
            {attachedPreviews.map((f, i) => (
              <div key={i} style={s.previewThumb}>
                {f.isImage
                  ? <img src={f.previewUrl} alt={f.name} style={s.thumbImg} />
                  : f.isVideo
                  ? <video src={f.previewUrl} style={s.thumbImg} muted />
                  : <div style={s.thumbDoc}>
                      <span style={{fontSize:22}}>{f.mimeType==='application/pdf'?'📄':'📎'}</span>
                      <span style={s.thumbDocName}>{f.name.slice(0,12)}{f.name.length>12?'…':''}</span>
                    </div>
                }
                <button style={s.thumbRemove} onClick={() => removeFile(i)}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Input area */}
        <div style={s.inputArea}>
          <div style={s.toggleRow}>
            {/* ── Mode toggle — prominent, shows current state ─────────── */}
            <button
              style={isUnrestricted ? s.modeToggleUnsafe : s.modeToggleSafe}
              onClick={() => setSafeMode(p => !p)}
              title={isUnrestricted ? 'Click to enable Safe Mode' : 'Click to enable Unrestricted Mode'}
            >
              {isUnrestricted ? '🔓 Unrestricted' : '🛡 Safe Mode'}
            </button>

            <button
              style={{ ...s.toggle, ...(webSearch ? s.toggleActive : {}) }}
              onClick={() => setWebSearch(p => !p)}
              title="Toggle web search via Tavily"
            >
              🌐 Web: <strong>{webSearch ? 'ON' : 'OFF'}</strong>
            </button>

            <div style={s.toggleSep} />

            <button style={s.attachBtn} onClick={() => fileInputRef.current?.click()}>
              📎 Attach
            </button>
            <input ref={fileInputRef} type="file" multiple
              accept="image/*,video/*,.pdf,.doc,.docx,.txt"
              style={{ display: 'none' }} onChange={handleFileChange} />
          </div>

          <div style={s.inputRow}>
            {/* ── FIX: uncontrolled textarea — no value prop, uses ref ── */}
            <textarea
              ref={textareaRef}
              style={s.textarea}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder={isUnrestricted
                ? 'Unrestricted mode — no content limits…'
                : 'Safe mode — standard guidelines apply…'}
              rows={1}
            />
            <button
              style={{ ...s.sendBtn, opacity: (sending || uploading) ? 0.5 : 1 }}
              onClick={handleSend}
              disabled={sending || uploading}
            >
              {(sending || uploading) ? '…' : '↑'}
            </button>
          </div>

          <div style={s.inputHints}>
            <span><kbd style={s.kbd}>Enter</kbd> send</span>
            <span><kbd style={s.kbd}>Shift+Enter</kbd> newline</span>
            {webSearch && <span style={{color:C.green}}>🌐 Tavily web search active</span>}
            {isUnrestricted && <span style={{color:C.accent2}}>⚠ Unrestricted mode — no content filters</span>}
          </div>
        </div>
      </div>

      {/* ── ANALYZE PANEL ───────────────────────────────────────────────── */}
      {showAnalyze && (
        <div style={s.analyzePanel}>
          <div style={s.analyzePanelHeader}>
            <div style={s.analyzePanelTitle}>Analysis</div>
            <button style={s.closeBtn} onClick={() => setShowAnalyze(false)}>✕</button>
          </div>
          <div style={s.analyzeTabs}>
            {['summary','prompts','topics'].map(tab => (
              <button key={tab}
                style={{ ...s.aTab, ...(analyzeTab===tab ? s.aTabActive : {}) }}
                onClick={() => setAnalyzeTab(tab)}>
                {tab.charAt(0).toUpperCase()+tab.slice(1)}
              </button>
            ))}
          </div>
          <div style={s.analyzeContent}>
            {analyzing
              ? <div style={s.analyzeLoading}>⚡ Analyzing...</div>
              : !analysis
              ? <div style={s.analyzeEmpty}>Hit Analyze to extract insights.</div>
              : <>
                  {analyzeTab==='summary' && (
                    <><Card label="Summary" text={analysis.summary} />
                    {(analysis.key_ideas||[]).map((idea,i) => <Card key={i} label="Key Idea" text={idea} />)}</>
                  )}
                  {analyzeTab==='prompts' && (analysis.prompt_snippets||[]).map((p,i) => (
                    <div key={i} style={s.promptSnippet} onClick={() => copyText(p)}>
                      <div style={s.snippetText}>{p}</div>
                      <div style={s.snippetHint}>{copied===p?'✓ Copied!':'Click to copy'}</div>
                    </div>
                  ))}
                  {analyzeTab==='topics' && (
                    <div style={s.topicsWrap}>
                      {(analysis.topics||[]).map((t,i) => (
                        <span key={i} style={{...s.topicTag,...(t.toLowerCase()===(analysis.hot_topic||'').toLowerCase()?s.topicHot:{})}}>
                          {t}{t.toLowerCase()===(analysis.hot_topic||'').toLowerCase()?' 🔥':''}
                        </span>
                      ))}
                    </div>
                  )}
                </>
            }
          </div>
        </div>
      )}

      {copied && <div style={s.copiedToast}>✓ Copied!</div>}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function guessTypeFromUrl(url = '') {
  const u = url.toLowerCase().split('?')[0];
  if (/\.(jpg|jpeg|png|webp|gif|bmp)$/.test(u) || u.startsWith('data:image/')) return 'image';
  if (/\.(mp4|mov|avi|mkv|webm)$/.test(u) || u.startsWith('data:video/')) return 'video';
  if (/\.pdf$/.test(u)) return 'pdf';
  return 'file';
}

function FileAttachment({ url, index }) {
  const type = guessTypeFromUrl(url);
  const [videoErr, setVideoErr] = useState(false);

  if (type === 'image') {
    return (
      <a href={url} target="_blank" rel="noreferrer" style={sf.imgWrap}>
        <img src={url} alt={`Attachment ${index+1}`} style={sf.img} />
      </a>
    );
  }
  if (type === 'video' && !videoErr) {
    return (
      <div style={sf.videoWrap}>
        <video src={url} controls style={sf.video} onError={() => setVideoErr(true)} />
      </div>
    );
  }
  const icon  = type === 'pdf' ? '📄' : '📎';
  const label = decodeURIComponent(url.split('/').pop().split('?')[0] || `Attachment ${index+1}`).slice(0,40);
  return (
    <a href={url} target="_blank" rel="noreferrer" style={sf.docCard}>
      <span style={{fontSize:20}}>{icon}</span>
      <span style={sf.docLabel}>{label}</span>
      <span style={{color:C.accent,fontSize:14,flexShrink:0}}>↗</span>
    </a>
  );
}

function Message({ msg, onCopy }) {
  const isAI    = msg.role === 'assistant';
  const time    = new Date(msg.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const fileUrls = msg.file_urls || [];

  return (
    <div style={{ ...sm.wrap, ...(isAI ? sm.wrapAI : sm.wrapUser) }}>
      <div style={{ ...sm.avatar, ...(isAI ? sm.avatarAI : sm.avatarUser) }}>{isAI?'AI':'U'}</div>
      <div style={isAI ? sm.aiSide : sm.userSide}>
        {fileUrls.length > 0 && (
          <div style={sf.attachGrid}>
            {fileUrls.map((url,i) => <FileAttachment key={i} url={url} index={i} />)}
          </div>
        )}
        {(msg.content && msg.content !== '[File attached]') && (
          <div style={{ ...sm.bubble, ...(isAI ? sm.bubbleAI : sm.bubbleUser) }}>
            {isAI ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                code({ inline, children }) {
                  return inline
                    ? <code style={sm.inlineCode}>{children}</code>
                    : <pre style={sm.codeBlock}><code>{children}</code></pre>;
                },
                p({ children })      { return <p style={{margin:'0 0 8px',lineHeight:1.8}}>{children}</p>; },
                ul({ children })     { return <ul style={{margin:'0 0 8px',paddingLeft:18}}>{children}</ul>; },
                ol({ children })     { return <ol style={{margin:'0 0 8px',paddingLeft:18}}>{children}</ol>; },
                li({ children })     { return <li style={{margin:'3px 0',lineHeight:1.7}}>{children}</li>; },
                h1({ children })     { return <h1 style={{fontFamily:"'Syne',sans-serif",fontSize:18,margin:'10px 0 6px'}}>{children}</h1>; },
                h2({ children })     { return <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:15,margin:'8px 0 5px'}}>{children}</h2>; },
                h3({ children })     { return <h3 style={{fontFamily:"'Syne',sans-serif",fontSize:13,margin:'6px 0 4px',color:C.accent}}>{children}</h3>; },
                strong({ children }) { return <strong style={{color:C.text,fontWeight:700}}>{children}</strong>; },
              }}>
                {msg.content}
              </ReactMarkdown>
            ) : (
              <div style={sm.userText}>{msg.content}</div>
            )}
          </div>
        )}
        <div style={sm.meta}>
          <span style={sm.time}>{time}</span>
          {isAI && msg.content && (
            <button style={sm.copyBtn} onClick={() => onCopy(msg.content)}>copy</button>
          )}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={sm.wrap}>
      <div style={{ ...sm.avatar, ...sm.avatarAI }}>AI</div>
      <div style={sm.aiSide}>
        <div style={{ ...sm.bubble, ...sm.bubbleAI, width:'auto', display:'inline-block' }}>
          <div style={{display:'flex',gap:5,alignItems:'center',padding:'2px 0'}}>
            {[0,0.2,0.4].map((d,i) => (
              <div key={i} style={{
                width:6,height:6,borderRadius:'50%',background:C.accent,
                animation:'blink 1.2s infinite',animationDelay:`${d}s`,
              }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ label, text }) {
  return (
    <div style={s.card}>
      <div style={s.cardLabel}>{label}</div>
      <div style={s.cardText}>{text}</div>
    </div>
  );
}

function Welcome({ onQuick }) {
  const quickPrompts = [
    'Write a detailed Flux prompt for a silk lingerie campaign shoot',
    'Describe a photorealistic innerwear model pose for ComfyUI',
    'Generate 5 video prompt ideas for a lingerie brand reel',
    'Write SEO product copy for a lace bralette',
    'What lighting setup works best for innerwear photography?',
    'Analyze this reference image and give me a Flux recreation prompt',
  ];
  return (
    <div style={sw.root}>
      <div style={{fontSize:52,lineHeight:1}}>⬡</div>
      <div style={sw.title}>VOID Workspace</div>
      <div style={{fontSize:11,color:C.muted,letterSpacing:1}}>Self-hosted · Multimodal · Your GPU, Your Rules</div>
      <div style={sw.grid}>
        {quickPrompts.map((q,i) => (
          <div key={i} style={sw.card} onClick={() => onQuick(q)}>{q}</div>
        ))}
      </div>
    </div>
  );
}

// ── Color tokens ──────────────────────────────────────────────────────────────
const C = {
  bg:'#0a0a0f', surface:'#111118', surface2:'#1a1a24',
  border:'#2a2a3a', accent:'#7c6aff', accent2:'#ff6a9b',
  text:'#e8e8f0', muted:'#6a6a88', green:'#4fffb0',
  font:"'Space Mono', monospace", display:"'Syne', sans-serif",
};

// ── Layout styles ─────────────────────────────────────────────────────────────
const s = {
  root:{display:'flex',height:'100vh',background:C.bg,color:C.text,fontFamily:C.font,overflow:'hidden'},

  // Delete popup
  popupOverlay:{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'},
  popup:{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:24,width:320,boxShadow:'0 8px 32px rgba(0,0,0,0.5)'},
  popupTitle:{fontFamily:C.display,fontWeight:700,fontSize:16,marginBottom:10},
  popupBody:{fontSize:13,color:C.muted,lineHeight:1.6,marginBottom:20},
  popupActions:{display:'flex',gap:10,justifyContent:'flex-end'},
  popupCancel:{background:'transparent',border:`1px solid ${C.border}`,color:C.muted,fontFamily:C.font,fontSize:12,padding:'8px 16px',borderRadius:6,cursor:'pointer'},
  popupDelete:{background:'#ff4444',border:'none',color:'#fff',fontFamily:C.font,fontSize:12,fontWeight:700,padding:'8px 16px',borderRadius:6,cursor:'pointer'},

  // Sidebar
  sidebar:{width:260,background:C.surface,borderRight:`1px solid ${C.border}`,display:'flex',flexDirection:'column',flexShrink:0,transition:'width 0.2s',overflow:'hidden'},
  sidebarHeader:{padding:'18px 14px 10px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'},
  logo:{fontFamily:C.display,fontWeight:800,fontSize:20,background:'linear-gradient(135deg,#7c6aff,#ff6a9b)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text'},
  iconBtn:{background:'transparent',border:'none',color:C.muted,fontSize:16,cursor:'pointer',padding:4},
  newBtn:{margin:'10px 12px',background:'linear-gradient(135deg,#7c6aff,#ff6a9b)',border:'none',borderRadius:6,color:'#fff',fontFamily:C.font,fontSize:11,fontWeight:700,padding:9,cursor:'pointer',letterSpacing:1},
  threadSection:{fontSize:9,letterSpacing:2,color:C.muted,textTransform:'uppercase',padding:'10px 14px 4px'},
  threadList:{flex:1,overflowY:'auto',padding:'0 6px'},
  threadLoading:{fontSize:11,color:C.muted,padding:'20px 8px',textAlign:'center'},
  threadEmpty:{fontSize:11,color:C.muted,padding:'20px 8px',textAlign:'center',lineHeight:1.8},
  threadItem:{display:'flex',alignItems:'center',gap:7,padding:'8px 8px',borderRadius:6,cursor:'pointer',fontSize:11,color:C.muted,border:'1px solid transparent',marginBottom:2,transition:'all 0.15s',position:'relative'},
  threadActive:{background:C.surface2,color:C.accent,borderColor:C.border},
  threadDot:{width:6,height:6,borderRadius:'50%',background:C.accent,flexShrink:0},
  threadName:{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},
  threadActions:{display:'flex',gap:2,flexShrink:0},
  tinyBtn:{background:'transparent',border:`1px solid transparent`,color:C.muted,fontSize:12,cursor:'pointer',padding:'2px 5px',borderRadius:4,transition:'all 0.15s',lineHeight:1},
  tinyBtnDelete:{color:'#ff6a6a'},
  renameInput:{flex:1,background:C.bg,border:`1px solid ${C.accent}`,borderRadius:3,color:C.text,fontFamily:C.font,fontSize:11,padding:'2px 6px',outline:'none'},
  sidebarFooter:{borderTop:`1px solid ${C.border}`,padding:'12px 14px'},
  userBadge:{display:'flex',alignItems:'center',gap:8,marginBottom:8},
  userDot:{width:7,height:7,borderRadius:'50%',background:C.green},
  userEmail:{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},
  signoutBtn:{background:'transparent',border:`1px solid ${C.border}`,color:C.muted,fontFamily:C.font,fontSize:10,padding:'5px 10px',borderRadius:4,cursor:'pointer',width:'100%',letterSpacing:1},

  // Main
  main:{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'},
  header:{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:'12px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0},
  headerLeft:{display:'flex',alignItems:'center',gap:12},
  sidebarToggle:{background:'transparent',border:'none',color:C.muted,fontSize:18,cursor:'pointer',padding:'0 4px'},
  headerTitle:{fontFamily:C.display,fontWeight:600,fontSize:14,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:300},
  headerRight:{display:'flex',alignItems:'center',gap:8},
  badgeSafe:{background:'rgba(79,255,176,0.1)',border:`1px solid ${C.green}`,borderRadius:6,padding:'4px 10px',fontSize:10,color:C.green,letterSpacing:0.5},
  badgeUnsafe:{background:'rgba(255,106,155,0.1)',border:`1px solid ${C.accent2}`,borderRadius:6,padding:'4px 10px',fontSize:10,color:C.accent2,letterSpacing:0.5},
  searchBadge:{background:'rgba(124,106,255,0.1)',border:`1px solid ${C.accent}`,borderRadius:6,padding:'4px 10px',fontSize:10,color:C.accent},
  hBtn:{background:C.surface2,border:`1px solid ${C.border}`,color:C.muted,fontFamily:C.font,fontSize:10,padding:'5px 12px',borderRadius:4,cursor:'pointer',letterSpacing:0.5},
  messages:{flex:1,overflowY:'auto',padding:'24px 32px',display:'flex',flexDirection:'column',gap:24},

  // File previews
  filesPreview:{display:'flex',flexWrap:'wrap',gap:8,padding:'10px 20px 0',borderTop:`1px solid ${C.border}`},
  previewThumb:{position:'relative',borderRadius:8,overflow:'hidden',border:`1px solid ${C.border}`,width:80,height:80,flexShrink:0,background:C.surface2},
  thumbImg:{width:'100%',height:'100%',objectFit:'cover',display:'block'},
  thumbDoc:{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',gap:4},
  thumbDocName:{fontSize:8,color:C.muted,textAlign:'center',padding:'0 4px',wordBreak:'break-all'},
  thumbRemove:{position:'absolute',top:3,right:3,background:'rgba(0,0,0,0.75)',border:'none',color:'#fff',fontSize:9,width:18,height:18,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',lineHeight:1},

  // Input
  inputArea:{borderTop:`1px solid ${C.border}`,padding:'12px 20px 14px',background:C.surface,flexShrink:0},
  toggleRow:{display:'flex',alignItems:'center',gap:8,marginBottom:10,flexWrap:'wrap'},
  modeToggleSafe:{background:'rgba(79,255,176,0.1)',border:`1px solid ${C.green}`,color:C.green,fontFamily:C.font,fontSize:10,fontWeight:700,padding:'5px 12px',borderRadius:20,cursor:'pointer',letterSpacing:0.5,transition:'all 0.2s'},
  modeToggleUnsafe:{background:'rgba(255,106,155,0.15)',border:`1px solid ${C.accent2}`,color:C.accent2,fontFamily:C.font,fontSize:10,fontWeight:700,padding:'5px 12px',borderRadius:20,cursor:'pointer',letterSpacing:0.5,transition:'all 0.2s'},
  toggle:{background:C.surface2,border:`1px solid ${C.border}`,color:C.muted,fontFamily:C.font,fontSize:10,padding:'4px 10px',borderRadius:20,cursor:'pointer',letterSpacing:0.5,transition:'all 0.15s'},
  toggleActive:{borderColor:C.accent,color:C.accent,background:'rgba(124,106,255,0.1)'},
  toggleSep:{flex:1},
  attachBtn:{background:C.surface2,border:`1px solid ${C.border}`,color:C.muted,fontFamily:C.font,fontSize:10,padding:'4px 12px',borderRadius:4,cursor:'pointer',letterSpacing:0.5},
  inputRow:{display:'flex',gap:10,alignItems:'flex-end'},
  // ── FIX: no controlled value prop — uncontrolled textarea is lag-free
  textarea:{flex:1,background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,color:C.text,fontFamily:C.font,fontSize:13,padding:'10px 12px',resize:'none',minHeight:42,maxHeight:160,lineHeight:1.5,outline:'none',transition:'border-color 0.15s'},
  sendBtn:{background:'linear-gradient(135deg,#7c6aff,#ff6a9b)',border:'none',borderRadius:6,color:'#fff',width:42,height:42,fontSize:18,cursor:'pointer',flexShrink:0,transition:'opacity 0.2s'},
  inputHints:{fontSize:9,color:C.muted,marginTop:7,display:'flex',gap:14,flexWrap:'wrap'},
  kbd:{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:3,padding:'1px 5px',fontSize:9,fontFamily:C.font},

  // Analyze panel
  analyzePanel:{width:300,background:C.surface,borderLeft:`1px solid ${C.border}`,display:'flex',flexDirection:'column',flexShrink:0},
  analyzePanelHeader:{padding:'14px 16px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'},
  analyzePanelTitle:{fontFamily:C.display,fontWeight:700,fontSize:14},
  closeBtn:{background:'transparent',border:'none',color:C.muted,fontSize:16,cursor:'pointer'},
  analyzeTabs:{display:'flex',borderBottom:`1px solid ${C.border}`},
  aTab:{flex:1,padding:'10px 4px',background:'transparent',border:'none',color:C.muted,fontFamily:C.font,fontSize:9,letterSpacing:1,textTransform:'uppercase',cursor:'pointer',borderBottom:'2px solid transparent',transition:'all 0.15s'},
  aTabActive:{color:C.accent,borderBottomColor:C.accent},
  analyzeContent:{flex:1,overflowY:'auto',padding:14},
  analyzeLoading:{color:C.accent,fontSize:12,textAlign:'center',padding:24},
  analyzeEmpty:{color:C.muted,fontSize:12,textAlign:'center',padding:24,lineHeight:1.7},
  card:{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:6,padding:'10px 12px',marginBottom:10},
  cardLabel:{fontSize:9,letterSpacing:2,textTransform:'uppercase',color:C.accent,marginBottom:5},
  cardText:{fontSize:12,lineHeight:1.6},
  promptSnippet:{background:C.bg,border:`1px solid ${C.border}`,borderRadius:4,padding:10,marginBottom:8,cursor:'pointer'},
  snippetText:{fontSize:11,color:C.green,lineHeight:1.6},
  snippetHint:{fontSize:9,color:C.muted,marginTop:5,letterSpacing:1},
  topicsWrap:{paddingTop:8},
  topicTag:{display:'inline-block',background:C.surface2,border:`1px solid ${C.border}`,borderRadius:20,padding:'3px 12px',margin:'3px',fontSize:10,color:C.muted},
  topicHot:{borderColor:C.accent2,color:C.accent2},
  copiedToast:{position:'fixed',bottom:24,right:24,background:C.accent,color:'#fff',fontSize:12,padding:'8px 16px',borderRadius:6,fontFamily:C.font,zIndex:999},
};

// File attachment styles
const sf = {
  attachGrid:{display:'flex',flexWrap:'wrap',gap:8,marginBottom:8},
  imgWrap:{display:'block',borderRadius:10,overflow:'hidden',border:`1px solid ${C.border}`,maxWidth:320,cursor:'pointer'},
  img:{display:'block',maxWidth:'100%',maxHeight:320,objectFit:'cover'},
  videoWrap:{borderRadius:10,overflow:'hidden',border:`1px solid ${C.border}`,maxWidth:380,background:'#000'},
  video:{display:'block',maxWidth:'100%',maxHeight:280},
  docCard:{display:'inline-flex',alignItems:'center',gap:10,background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 14px',textDecoration:'none',color:C.text,fontSize:12,maxWidth:280},
  docLabel:{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:11,color:C.muted},
};

// Message layout
const sm = {
  wrap:{display:'flex',gap:12,alignItems:'flex-start'},
  wrapAI:{flexDirection:'row'},
  wrapUser:{flexDirection:'row-reverse'},
  aiSide:{flex:1,minWidth:0,display:'flex',flexDirection:'column',alignItems:'flex-start'},
  userSide:{maxWidth:'72%',display:'flex',flexDirection:'column',alignItems:'flex-end'},
  avatar:{width:32,height:32,borderRadius:8,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,marginTop:2},
  avatarAI:{background:'linear-gradient(135deg,#7c6aff,#ff6a9b)',color:'#fff'},
  avatarUser:{background:C.surface2,border:`1px solid ${C.border}`,color:C.muted},
  bubble:{padding:'12px 16px',borderRadius:10,fontSize:13,lineHeight:1.8,wordBreak:'break-word'},
  bubbleAI:{background:C.surface,border:`1px solid ${C.border}`,width:'100%',boxSizing:'border-box'},
  bubbleUser:{background:C.surface2,border:`1px solid ${C.accent}`,maxWidth:'100%'},
  userText:{whiteSpace:'pre-wrap',wordBreak:'break-word'},
  inlineCode:{background:C.bg,border:`1px solid ${C.border}`,borderRadius:3,padding:'1px 6px',fontSize:11,fontFamily:C.font,color:C.green},
  codeBlock:{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:'12px 14px',overflowX:'auto',fontSize:11,lineHeight:1.6,margin:'8px 0',color:C.green},
  meta:{display:'flex',alignItems:'center',gap:10,marginTop:6},
  time:{fontSize:9,color:C.muted},
  copyBtn:{background:'transparent',border:'none',color:C.muted,fontSize:10,cursor:'pointer',fontFamily:C.font,letterSpacing:0.5},
};

const sw = {
  root:{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:14,textAlign:'center',padding:40},
  title:{fontFamily:C.display,fontWeight:800,fontSize:32,background:'linear-gradient(135deg,#7c6aff,#ff6a9b)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text',letterSpacing:-1},
  grid:{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8,maxWidth:600,marginTop:8},
  card:{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 14px',fontSize:11,color:C.muted,cursor:'pointer',textAlign:'left',lineHeight:1.5},
};