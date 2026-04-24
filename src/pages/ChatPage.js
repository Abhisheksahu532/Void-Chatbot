import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../context/AuthContext';
import { useThreads, useMessages } from '../hooks/useDB';
import { chatCompletion, analyzeThread, uploadFileToModal, estimateTokens, estimateFileTokens, fetchContextInfo } from '../lib/api';

export default function ChatPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { threads, loading: threadsLoading, createThread, updateThread, deleteThread } = useThreads();
  const [activeThreadId, setActiveThreadId] = useState(null);
  const { messages, addMessage } = useMessages(activeThreadId);

  const [sending, setSending] = useState(false);
  const [safeMode, setSafeMode] = useState(true);
  const [webSearch, setWebSearch] = useState(false);
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
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [inputText, setInputText] = useState('');
  // Per-thread token cache — avoids recalculating for every thread in sidebar
  const [threadTokens, setThreadTokens] = useState({});
  const [showTokenTooltip, setShowTokenTooltip] = useState(false);

  const messagesEndRef = useRef(null);
  const fileInputRef   = useRef(null);
  const textareaRef    = useRef(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);
  useEffect(() => {
    if (!activeThreadId && threads.length > 0) setActiveThreadId(threads[0].id);
  }, [threads, activeThreadId]);

  // Fetch context info from server on mount
  useEffect(() => {
    fetchContextInfo().catch(e => console.warn('[VOID] Context info fetch failed:', e));
  }, []);

  // ── Token estimate — recomputes whenever messages, input, or files change ──
  const tokenInfo = useMemo(() => {
    return estimateTokens(messages, inputText, attachedPreviews);
  }, [messages, inputText, attachedPreviews]);

  // ── Per-thread token estimates for sidebar — update when threads or their messages change ──
  useEffect(() => {
    if (threads.length === 0) return;
    const cache = {};
    threads.forEach(t => {
      // For now we only have messages for active thread; others get placeholder
      if (t.id === activeThreadId) {
        const estimate = estimateTokens(messages, '', []);
        cache[t.id] = { used: estimate.used, status: estimate.status };
      } else {
        // Placeholder — you'd need to fetch thread message counts from DB for accuracy
        cache[t.id] = { used: 0, status: 'ok' };
      }
    });
    setThreadTokens(cache);
  }, [threads, messages, activeThreadId]);

  const handleNewThread = async () => {
    const t = await createThread('New Session');
    setActiveThreadId(t.id);
    setAnalysis(null);
    setAttachedFiles([]);
    setAttachedPreviews([]);
    setInputText('');
    if (textareaRef.current) { textareaRef.current.value = ''; textareaRef.current.style.height = 'auto'; }
  };

  const handleSend = async () => {
    const text = (textareaRef.current?.value || '').trim();
    if (sending || (!text && attachedFiles.length === 0)) return;
    if (tokenInfo.status === 'over') return; // block send if over limit

    if (textareaRef.current) { textareaRef.current.value = ''; textareaRef.current.style.height = 'auto'; }
    setInputText('');
    setSending(true);

    let threadId = activeThreadId;
    if (!threadId) {
      const t = await createThread(text.slice(0, 40) || 'New Session');
      setActiveThreadId(t.id);
      threadId = t.id;
    }

    let uploadedFiles = [];
    if (attachedFiles.length > 0) {
      setUploading(true);
      try {
        uploadedFiles = await Promise.all(attachedFiles.map(f => uploadFileToModal(f, user.id)));
      } catch (e) {
        await addMessage('assistant', `⚠ File upload failed: ${e.message}`, [], threadId);
        setSending(false); setUploading(false); return;
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
        : '⚠ Model returned empty response.';
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

  // Uncontrolled textarea — tracks value in inputText state only for token counter
  const handleTextareaChange = useCallback((e) => {
    const val = e.target.value;
    setInputText(val);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
  }, []);

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    setAttachedFiles(prev => [...prev, ...files]);
    const previews = files.map(f => {
      const estimate = estimateFileTokens(f);
      return {
        name: f.name,
        mimeType: f.type,
        previewUrl: URL.createObjectURL(f),
        isImage: f.type.startsWith('image/'),
        isVideo: f.type.startsWith('video/'),
        // NEW: include token estimate
        tokenEstimate: estimate.tokens,
        tokenBreakdown: estimate.breakdown,
      };
    });
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

  const startRename  = (t) => { setRenaming(t.id); setRenamVal(t.name); };
  const submitRename = async (id) => { await updateThread(id, { name: renamVal }); setRenaming(null); };
  const confirmDelete = (t, e) => { e.stopPropagation(); setDeleteConfirm(t); };
  const doDelete = async () => {
    if (!deleteConfirm) return;
    await deleteThread(deleteConfirm.id);
    if (deleteConfirm.id === activeThreadId) setActiveThreadId(null);
    setDeleteConfirm(null);
  };

  const activeThread  = threads.find(t => t.id === activeThreadId);
  const isUnrestricted = !safeMode;

  // Token counter color
  const tkColor = tokenInfo.status === 'over' ? C.red
    : tokenInfo.status === 'danger' ? C.accent2
    : tokenInfo.status === 'warning' ? '#f5a623'
    : C.muted;

  // Format numbers with K/M suffix
  const formatNum = (n) => {
    if (n >= 1000000) return `${(n/1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n/1000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  return (
    <div style={s.root}>

      {/* DELETE CONFIRM */}
      {deleteConfirm && (
        <div style={s.overlay} onClick={() => setDeleteConfirm(null)}>
          <div style={s.popup} onClick={e => e.stopPropagation()}>
            <div style={s.popupTitle}>Delete Thread?</div>
            <div style={s.popupBody}>
              "<strong>{deleteConfirm.name}</strong>" and all messages will be permanently deleted.
            </div>
            <div style={s.popupActions}>
              <button style={s.popupCancel} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button style={s.popupDelete} onClick={doDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* SIDEBAR */}
      <div style={{ ...s.sidebar, ...(sidebarOpen ? {} : { width:0, overflow:'hidden', borderRight:'none' }) }}>
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
            ? <div style={s.threadEmpty}>No threads yet.<br/>Start chatting!</div>
            : threads.map(t => {
                const tTokens = threadTokens[t.id] || { used: 0, status: 'ok' };
                const tColor = tTokens.status === 'over' ? C.red
                  : tTokens.status === 'danger' ? C.accent2
                  : tTokens.status === 'warning' ? '#f5a623'
                  : C.green;
                return (
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
                        <span style={{...s.threadDot, background: tColor}}/>
                        <span style={s.threadName}>{t.name}</span>
                        {/* NEW: Show token indicator for active thread */}
                        {t.id === activeThreadId && tTokens.used > 0 && (
                          <span style={{...s.threadTokenBadge, color: tColor}}>
                            {formatNum(tTokens.used)}
                          </span>
                        )}
                        <div style={s.threadActions}>
                          <button style={s.tinyBtn} onClick={e => { e.stopPropagation(); startRename(t); }}>✎</button>
                          <button style={{...s.tinyBtn,...s.tinyBtnDel}} onClick={e => confirmDelete(t,e)}>✕</button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })
          }
        </div>
        <div style={s.sidebarFooter}>
          <div style={s.userBadge}><div style={s.userDot}/><span style={s.userEmail}>{user?.email}</span></div>
          <button style={s.signoutBtn} onClick={signOut}>Sign Out</button>
        </div>
      </div>

      {/* MAIN */}
      <div style={s.main}>
        {/* Header */}
        <div style={s.header}>
          <div style={s.headerLeft}>
            <button style={s.sidebarToggle} onClick={() => setSidebarOpen(p => !p)}>☰</button>
            <div style={s.headerTitle}>{activeThread?.name || 'New Thread'}</div>
          </div>
          <div style={s.headerRight}>
            <div style={isUnrestricted ? s.badgeUnsafe : s.badgeSafe}>
              {isUnrestricted ? '🔓 Unrestricted' : '🛡 Safe'}
            </div>
            {webSearch && <div style={s.searchBadge}>🌐 Web</div>}
            <button style={s.hBtn} onClick={handleAnalyze}>⚡ Analyze</button>
            <button style={s.hBtn} onClick={() => navigate('/settings')}>⚙ Settings</button>
          </div>
        </div>

        {/* Messages */}
        <div style={s.messages}>
          {!activeThreadId || messages.length === 0
            ? <Welcome onQuick={(q) => {
                if (textareaRef.current) { textareaRef.current.value = q; textareaRef.current.focus(); }
                setInputText(q);
              }}/>
            : messages.map(m => <Message key={m.id} msg={m} onCopy={copyText}/>)
          }
          {sending && <TypingIndicator/>}
          <div ref={messagesEndRef}/>
        </div>

        {/* File previews — NOW WITH TOKEN ESTIMATES */}
        {attachedPreviews.length > 0 && (
          <div style={s.filesPreview}>
            {attachedPreviews.map((f,i) => (
              <div key={i} style={s.previewThumb}>
                {f.isImage ? <img src={f.previewUrl} alt={f.name} style={s.thumbImg}/>
                  : f.isVideo ? <video src={f.previewUrl} style={s.thumbImg} muted/>
                  : <div style={s.thumbDoc}>
                      <span style={{fontSize:22}}>{f.mimeType==='application/pdf'?'📄':'📎'}</span>
                      <span style={s.thumbDocName}>{f.name.slice(0,12)}</span>
                    </div>
                }
                {/* NEW: Token estimate badge */}
                <div style={s.thumbTokenBadge} title={f.tokenBreakdown}>
                  ⚡{formatNum(f.tokenEstimate)}
                </div>
                <button style={s.thumbRemove} onClick={() => removeFile(i)}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Input area */}
        <div style={s.inputArea}>
          <div style={s.toggleRow}>
            <button style={isUnrestricted ? s.modeToggleUnsafe : s.modeToggleSafe}
              onClick={() => setSafeMode(p => !p)}>
              {isUnrestricted ? '🔓 Unrestricted' : '🛡 Safe Mode'}
            </button>
            <button style={{...s.toggle,...(webSearch?s.toggleActive:{})}}
              onClick={() => setWebSearch(p => !p)}>
              🌐 Web: <strong>{webSearch?'ON':'OFF'}</strong>
            </button>
            <div style={s.toggleSep}/>
            <button style={s.attachBtn} onClick={() => fileInputRef.current?.click()}>📎 Attach</button>
            <input ref={fileInputRef} type="file" multiple
              accept="image/*,video/*,.pdf,.doc,.docx,.txt"
              style={{display:'none'}} onChange={handleFileChange}/>
          </div>

          <div style={s.inputRow}>
            <textarea ref={textareaRef} style={{
              ...s.textarea,
              borderColor: tokenInfo.status === 'over' ? C.red
                : tokenInfo.status === 'danger' ? C.accent2
                : tokenInfo.status === 'warning' ? '#f5a623'
                : C.border,
            }}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder={isUnrestricted ? 'Unrestricted mode — no content limits…' : 'Safe mode — standard guidelines apply…'}
              rows={1}
            />
            <button style={{...s.sendBtn, opacity:(sending||uploading||tokenInfo.status==='over')?0.5:1}}
              onClick={handleSend} disabled={sending||uploading||tokenInfo.status==='over'}
              title={tokenInfo.status==='over'?'Context window full — start a new thread':''}>
              {(sending||uploading)?'…':'↑'}
            </button>
          </div>

          {/* ── ENHANCED TOKEN COUNTER ─────────────────────────────────────────── */}
          <div style={s.inputFooter}>
            <div style={s.inputHints}>
              <span><kbd style={s.kbd}>Enter</kbd> send</span>
              <span><kbd style={s.kbd}>Shift+Enter</kbd> newline</span>
              {webSearch && <span style={{color:C.green}}>🌐 Tavily active</span>}
              {isUnrestricted && <span style={{color:C.accent2}}>⚠ Unrestricted</span>}
            </div>

            {/* Token bar — right side of input footer */}
            <div style={s.tokenWrapper}
              onMouseEnter={() => setShowTokenTooltip(true)}
              onMouseLeave={() => setShowTokenTooltip(false)}>
              
              {/* Status warning */}
              {tokenInfo.status === 'over' && (
                <span style={{...s.tokenLabel, color: C.red, fontWeight:700}}>⚠ Context full</span>
              )}
              {tokenInfo.status === 'danger' && (
                <span style={{...s.tokenLabel, color: C.accent2}}>Almost full</span>
              )}
              {tokenInfo.status === 'warning' && (
                <span style={{...s.tokenLabel, color: '#f5a623'}}>Filling up</span>
              )}
              
              {/* Main count */}
              <span style={{...s.tokenCount, color: tkColor}}>
                ⚡ {formatNum(tokenInfo.used)} / {formatNum(tokenInfo.max)}
              </span>
              
              {/* Progress bar */}
              <div style={s.tokenBar}>
                <div style={{
                  ...s.tokenFill,
                  width: `${Math.min(tokenInfo.pct, 100)}%`,
                  background: tokenInfo.status === 'over' ? C.red
                    : tokenInfo.status === 'danger' ? C.accent2
                    : tokenInfo.status === 'warning' ? '#f5a623'
                    : C.accent,
                }}/>
              </div>

              {/* Tooltip with breakdown */}
              {showTokenTooltip && tokenInfo.breakdown && (
                <div style={s.tokenTooltip}>
                  <div style={s.tooltipRow}>
                    <span>History:</span>
                    <span style={{color:C.muted}}>{formatNum(tokenInfo.breakdown.history)}</span>
                  </div>
                  <div style={s.tooltipRow}>
                    <span>Input:</span>
                    <span style={{color:C.muted}}>{formatNum(tokenInfo.breakdown.input)}</span>
                  </div>
                  <div style={s.tooltipRow}>
                    <span>Files:</span>
                    <span style={{color:C.muted}}>{formatNum(tokenInfo.breakdown.files)}</span>
                  </div>
                  <div style={s.tooltipRow}>
                    <span>System:</span>
                    <span style={{color:C.muted}}>{formatNum(tokenInfo.breakdown.system)}</span>
                  </div>
                  <div style={{...s.tooltipRow, borderTop:`1px solid ${C.border}`, paddingTop:6, marginTop:6, fontWeight:700}}>
                    <span>Total:</span>
                    <span style={{color:tkColor}}>{formatNum(tokenInfo.used)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ANALYZE PANEL */}
      {showAnalyze && (
        <div style={s.analyzePanel}>
          <div style={s.analyzePanelHeader}>
            <div style={s.analyzePanelTitle}>Analysis</div>
            <button style={s.closeBtn} onClick={() => setShowAnalyze(false)}>✕</button>
          </div>
          <div style={s.analyzeTabs}>
            {['summary','prompts','topics'].map(tab => (
              <button key={tab} style={{...s.aTab,...(analyzeTab===tab?s.aTabActive:{})}}
                onClick={() => setAnalyzeTab(tab)}>
                {tab.charAt(0).toUpperCase()+tab.slice(1)}
              </button>
            ))}
          </div>
          <div style={s.analyzeContent}>
            {analyzing ? <div style={s.analyzeLoading}>⚡ Analyzing...</div>
              : !analysis ? <div style={s.analyzeEmpty}>Hit Analyze to extract insights.</div>
              : <>
                  {analyzeTab==='summary' && <>
                    <Card label="Summary" text={analysis.summary}/>
                    {(analysis.key_ideas||[]).map((idea,i) => <Card key={i} label="Key Idea" text={idea}/>)}
                  </>}
                  {analyzeTab==='prompts' && (analysis.prompt_snippets||[]).map((p,i) => (
                    <div key={i} style={s.promptSnippet} onClick={() => copyText(p)}>
                      <div style={s.snippetText}>{p}</div>
                      <div style={s.snippetHint}>{copied===p?'✓ Copied!':'Click to copy'}</div>
                    </div>
                  ))}
                  {analyzeTab==='topics' && <div style={s.topicsWrap}>
                    {(analysis.topics||[]).map((t,i) => (
                      <span key={i} style={{...s.topicTag,...(t.toLowerCase()===(analysis.hot_topic||'').toLowerCase()?s.topicHot:{})}}>
                        {t}{t.toLowerCase()===(analysis.hot_topic||'').toLowerCase()?' 🔥':''}
                      </span>
                    ))}
                  </div>}
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
function guessTypeFromUrl(url='') {
  const u = url.toLowerCase().split('?')[0];
  if (/\.(jpg|jpeg|png|webp|gif|bmp)$/.test(u)||u.startsWith('data:image/')) return 'image';
  if (/\.(mp4|mov|avi|mkv|webm)$/.test(u)||u.startsWith('data:video/')) return 'video';
  if (/\.pdf$/.test(u)) return 'pdf';
  return 'file';
}

function FileAttachment({ url, index }) {
  const type = guessTypeFromUrl(url);
  const [videoErr, setVideoErr] = useState(false);
  if (type==='image') return (
    <a href={url} target="_blank" rel="noreferrer" style={sf.imgWrap}>
      <img src={url} alt={`Attachment ${index+1}`} style={sf.img}/>
    </a>
  );
  if (type==='video'&&!videoErr) return (
    <div style={sf.videoWrap}>
      <video src={url} controls style={sf.video} onError={()=>setVideoErr(true)}/>
    </div>
  );
  const icon  = type==='pdf'?'📄':'📎';
  const label = decodeURIComponent(url.split('/').pop().split('?')[0]||`Attachment ${index+1}`).slice(0,40);
  return (
    <a href={url} target="_blank" rel="noreferrer" style={sf.docCard}>
      <span style={{fontSize:20}}>{icon}</span>
      <span style={sf.docLabel}>{label}</span>
      <span style={{color:C.accent,fontSize:14,flexShrink:0}}>↗</span>
    </a>
  );
}

function Message({ msg, onCopy }) {
  const isAI    = msg.role==='assistant';
  const time    = new Date(msg.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  const fileUrls = msg.file_urls||[];
  return (
    <div style={{...sm.wrap,...(isAI?sm.wrapAI:sm.wrapUser)}}>
      <div style={{...sm.avatar,...(isAI?sm.avatarAI:sm.avatarUser)}}>{isAI?'AI':'U'}</div>
      <div style={isAI?sm.aiSide:sm.userSide}>
        {fileUrls.length>0 && (
          <div style={sf.attachGrid}>
            {fileUrls.map((url,i)=><FileAttachment key={i} url={url} index={i}/>)}
          </div>
        )}
        {(msg.content&&msg.content!=='[File attached]')&&(
          <div style={{...sm.bubble,...(isAI?sm.bubbleAI:sm.bubbleUser)}}>
            {isAI?(
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                code({inline,children}){return inline?<code style={sm.inlineCode}>{children}</code>:<pre style={sm.codeBlock}><code>{children}</code></pre>;},
                p({children}){return <p style={{margin:'0 0 8px',lineHeight:1.8}}>{children}</p>;},
                ul({children}){return <ul style={{margin:'0 0 8px',paddingLeft:18}}>{children}</ul>;},
                ol({children}){return <ol style={{margin:'0 0 8px',paddingLeft:18}}>{children}</ol>;},
                li({children}){return <li style={{margin:'3px 0',lineHeight:1.7}}>{children}</li>;},
                h1({children}){return <h1 style={{fontFamily:"'Syne',sans-serif",fontSize:18,margin:'10px 0 6px'}}>{children}</h1>;},
                h2({children}){return <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:15,margin:'8px 0 5px'}}>{children}</h2>;},
                h3({children}){return <h3 style={{fontFamily:"'Syne',sans-serif",fontSize:13,margin:'6px 0 4px',color:C.accent}}>{children}</h3>;},
                strong({children}){return <strong style={{color:C.text,fontWeight:700}}>{children}</strong>;},
              }}>{msg.content}</ReactMarkdown>
            ):(
              <div style={sm.userText}>{msg.content}</div>
            )}
          </div>
        )}
        <div style={sm.meta}>
          <span style={sm.time}>{time}</span>
          {isAI&&msg.content&&<button style={sm.copyBtn} onClick={()=>onCopy(msg.content)}>copy</button>}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={sm.wrap}>
      <div style={{...sm.avatar,...sm.avatarAI}}>AI</div>
      <div style={sm.aiSide}>
        <div style={{...sm.bubble,...sm.bubbleAI,width:'auto',display:'inline-block'}}>
          <div style={{display:'flex',gap:5,alignItems:'center',padding:'2px 0'}}>
            {[0,0.2,0.4].map((d,i)=>(
              <div key={i} style={{width:6,height:6,borderRadius:'50%',background:C.accent,animation:'blink 1.2s infinite',animationDelay:`${d}s`}}/>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({label,text}) {
  return (
    <div style={s.card}>
      <div style={s.cardLabel}>{label}</div>
      <div style={s.cardText}>{text}</div>
    </div>
  );
}

// NEW: General-purpose welcome prompts (removed lingerie-specific ones)
function Welcome({onQuick}) {
  const quickPrompts = [
    'Explain quantum computing in simple terms',
    'Help me debug this Python error I am getting',
    'Write a professional email to decline a meeting',
    'What are the key differences between React and Vue?',
    'Analyze this image and describe what you see',
    'Suggest a workout routine for beginners',
  ];
  return (
    <div style={sw.root}>
      <div style={{fontSize:52,lineHeight:1}}>⬡</div>
      <div style={sw.title}>VOID Workspace</div>
      <div style={{fontSize:11,color:C.muted,letterSpacing:1}}>Self-hosted · Multimodal · 32K Context</div>
      <div style={sw.grid}>
        {quickPrompts.map((q,i)=><div key={i} style={sw.card} onClick={()=>onQuick(q)}>{q}</div>)}
      </div>
    </div>
  );
}

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  bg:'#0a0a0f', surface:'#111118', surface2:'#1a1a24',
  border:'#2a2a3a', accent:'#7c6aff', accent2:'#ff6a9b',
  text:'#e8e8f0', muted:'#6a6a88', green:'#4fffb0', red:'#ff4444',
  font:"'Space Mono', monospace", display:"'Syne', sans-serif",
};

const s = {
  root:{display:'flex',height:'100vh',background:C.bg,color:C.text,fontFamily:C.font,overflow:'hidden'},
  overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'},
  popup:{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:24,width:320,boxShadow:'0 8px 32px rgba(0,0,0,0.6)'},
  popupTitle:{fontFamily:C.display,fontWeight:700,fontSize:16,marginBottom:10},
  popupBody:{fontSize:13,color:C.muted,lineHeight:1.6,marginBottom:20},
  popupActions:{display:'flex',gap:10,justifyContent:'flex-end'},
  popupCancel:{background:'transparent',border:`1px solid ${C.border}`,color:C.muted,fontFamily:C.font,fontSize:12,padding:'8px 16px',borderRadius:6,cursor:'pointer'},
  popupDelete:{background:'#ff4444',border:'none',color:'#fff',fontFamily:C.font,fontSize:12,fontWeight:700,padding:'8px 16px',borderRadius:6,cursor:'pointer'},
  sidebar:{width:260,background:C.surface,borderRight:`1px solid ${C.border}`,display:'flex',flexDirection:'column',flexShrink:0,transition:'width 0.2s',overflow:'hidden'},
  sidebarHeader:{padding:'18px 14px 10px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'},
  logo:{fontFamily:C.display,fontWeight:800,fontSize:20,background:'linear-gradient(135deg,#7c6aff,#ff6a9b)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text'},
  iconBtn:{background:'transparent',border:'none',color:C.muted,fontSize:16,cursor:'pointer',padding:4},
  newBtn:{margin:'10px 12px',background:'linear-gradient(135deg,#7c6aff,#ff6a9b)',border:'none',borderRadius:6,color:'#fff',fontFamily:C.font,fontSize:11,fontWeight:700,padding:9,cursor:'pointer',letterSpacing:1},
  threadSection:{fontSize:9,letterSpacing:2,color:C.muted,textTransform:'uppercase',padding:'10px 14px 4px'},
  threadList:{flex:1,overflowY:'auto',padding:'0 6px'},
  threadLoading:{fontSize:11,color:C.muted,padding:'20px 8px',textAlign:'center'},
  threadEmpty:{fontSize:11,color:C.muted,padding:'20px 8px',textAlign:'center',lineHeight:1.8},
  threadItem:{display:'flex',alignItems:'center',gap:7,padding:'8px',borderRadius:6,cursor:'pointer',fontSize:11,color:C.muted,border:'1px solid transparent',marginBottom:2,transition:'all 0.15s'},
  threadActive:{background:C.surface2,color:C.accent,borderColor:C.border},
  threadDot:{width:6,height:6,borderRadius:'50%',background:C.accent,flexShrink:0},
  threadName:{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},
  // NEW: Token badge in sidebar threads
  threadTokenBadge:{fontSize:8,fontWeight:700,letterSpacing:0.3,opacity:0.7,flexShrink:0},
  threadActions:{display:'flex',gap:2,flexShrink:0},
  tinyBtn:{background:'transparent',border:'1px solid transparent',color:C.muted,fontSize:12,cursor:'pointer',padding:'2px 5px',borderRadius:4,transition:'all 0.15s'},
  tinyBtnDel:{color:'#ff6a6a'},
  renameInput:{flex:1,background:C.bg,border:`1px solid ${C.accent}`,borderRadius:3,color:C.text,fontFamily:C.font,fontSize:11,padding:'2px 6px',outline:'none'},
  sidebarFooter:{borderTop:`1px solid ${C.border}`,padding:'12px 14px'},
  userBadge:{display:'flex',alignItems:'center',gap:8,marginBottom:8},
  userDot:{width:7,height:7,borderRadius:'50%',background:C.green},
  userEmail:{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},
  signoutBtn:{background:'transparent',border:`1px solid ${C.border}`,color:C.muted,fontFamily:C.font,fontSize:10,padding:'5px 10px',borderRadius:4,cursor:'pointer',width:'100%',letterSpacing:1},
  main:{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'},
  header:{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:'12px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0},
  headerLeft:{display:'flex',alignItems:'center',gap:12},
  sidebarToggle:{background:'transparent',border:'none',color:C.muted,fontSize:18,cursor:'pointer',padding:'0 4px'},
  headerTitle:{fontFamily:C.display,fontWeight:600,fontSize:14,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:300},
  headerRight:{display:'flex',alignItems:'center',gap:8},
  badgeSafe:{background:'rgba(79,255,176,0.1)',border:`1px solid ${C.green}`,borderRadius:6,padding:'4px 10px',fontSize:10,color:C.green},
  badgeUnsafe:{background:'rgba(255,106,155,0.1)',border:`1px solid ${C.accent2}`,borderRadius:6,padding:'4px 10px',fontSize:10,color:C.accent2},
  searchBadge:{background:'rgba(124,106,255,0.1)',border:`1px solid ${C.accent}`,borderRadius:6,padding:'4px 10px',fontSize:10,color:C.accent},
  hBtn:{background:C.surface2,border:`1px solid ${C.border}`,color:C.muted,fontFamily:C.font,fontSize:10,padding:'5px 12px',borderRadius:4,cursor:'pointer'},
  messages:{flex:1,overflowY:'auto',padding:'24px 32px',display:'flex',flexDirection:'column',gap:24},
  filesPreview:{display:'flex',flexWrap:'wrap',gap:8,padding:'10px 20px 0',borderTop:`1px solid ${C.border}`},
  previewThumb:{position:'relative',borderRadius:8,overflow:'hidden',border:`1px solid ${C.border}`,width:80,height:80,flexShrink:0,background:C.surface2},
  thumbImg:{width:'100%',height:'100%',objectFit:'cover',display:'block'},
  thumbDoc:{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',gap:4},
  thumbDocName:{fontSize:8,color:C.muted,textAlign:'center',padding:'0 4px',wordBreak:'break-all'},
  // NEW: Token badge on file preview thumbnails
  thumbTokenBadge:{position:'absolute',bottom:3,left:3,background:'rgba(0,0,0,0.85)',border:`1px solid ${C.accent}`,borderRadius:4,padding:'1px 5px',fontSize:8,color:C.accent,fontWeight:700,letterSpacing:0.3},
  thumbRemove:{position:'absolute',top:3,right:3,background:'rgba(0,0,0,0.75)',border:'none',color:'#fff',fontSize:9,width:18,height:18,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'},
  inputArea:{borderTop:`1px solid ${C.border}`,padding:'12px 20px 10px',background:C.surface,flexShrink:0},
  toggleRow:{display:'flex',alignItems:'center',gap:8,marginBottom:10,flexWrap:'wrap'},
  modeToggleSafe:{background:'rgba(79,255,176,0.1)',border:`1px solid ${C.green}`,color:C.green,fontFamily:C.font,fontSize:10,fontWeight:700,padding:'5px 12px',borderRadius:20,cursor:'pointer',letterSpacing:0.5},
  modeToggleUnsafe:{background:'rgba(255,106,155,0.15)',border:`1px solid ${C.accent2}`,color:C.accent2,fontFamily:C.font,fontSize:10,fontWeight:700,padding:'5px 12px',borderRadius:20,cursor:'pointer',letterSpacing:0.5},
  toggle:{background:C.surface2,border:`1px solid ${C.border}`,color:C.muted,fontFamily:C.font,fontSize:10,padding:'4px 10px',borderRadius:20,cursor:'pointer',letterSpacing:0.5},
  toggleActive:{borderColor:C.accent,color:C.accent,background:'rgba(124,106,255,0.1)'},
  toggleSep:{flex:1},
  attachBtn:{background:C.surface2,border:`1px solid ${C.border}`,color:C.muted,fontFamily:C.font,fontSize:10,padding:'4px 12px',borderRadius:4,cursor:'pointer'},
  inputRow:{display:'flex',gap:10,alignItems:'flex-end',marginBottom:8},
  textarea:{flex:1,background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,color:C.text,fontFamily:C.font,fontSize:13,padding:'10px 12px',resize:'none',minHeight:42,maxHeight:160,lineHeight:1.5,outline:'none',transition:'border-color 0.2s'},
  sendBtn:{background:'linear-gradient(135deg,#7c6aff,#ff6a9b)',border:'none',borderRadius:6,color:'#fff',width:42,height:42,fontSize:18,cursor:'pointer',flexShrink:0,transition:'opacity 0.2s'},
  // Input footer — hints left, token counter right
  inputFooter:{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12},
  inputHints:{fontSize:9,color:C.muted,display:'flex',gap:12,flexWrap:'wrap',flexShrink:0},
  kbd:{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:3,padding:'1px 5px',fontSize:9,fontFamily:C.font},
  // ENHANCED Token counter
  tokenWrapper:{position:'relative',display:'flex',alignItems:'center',gap:8,flexShrink:0},
  tokenLabel:{fontSize:9,letterSpacing:0.3,whiteSpace:'nowrap'},
  tokenCount:{fontSize:10,fontFamily:C.font,fontWeight:700,whiteSpace:'nowrap',letterSpacing:0.3},
  tokenBar:{width:100,height:5,background:C.surface2,borderRadius:3,overflow:'hidden',flexShrink:0},
  tokenFill:{height:'100%',borderRadius:3,transition:'width 0.3s, background 0.3s'},
  // NEW: Token tooltip
  tokenTooltip:{position:'absolute',bottom:'calc(100% + 8px)',right:0,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:10,fontSize:10,minWidth:160,boxShadow:'0 4px 16px rgba(0,0,0,0.6)',zIndex:100},
  tooltipRow:{display:'flex',justifyContent:'space-between',gap:16,marginBottom:4,fontSize:10},
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

const sf = {
  attachGrid:{display:'flex',flexWrap:'wrap',gap:8,marginBottom:8},
  imgWrap:{display:'block',borderRadius:10,overflow:'hidden',border:`1px solid ${C.border}`,maxWidth:320,cursor:'pointer'},
  img:{display:'block',maxWidth:'100%',maxHeight:320,objectFit:'cover'},
  videoWrap:{borderRadius:10,overflow:'hidden',border:`1px solid ${C.border}`,maxWidth:380,background:'#000'},
  video:{display:'block',maxWidth:'100%',maxHeight:280},
  docCard:{display:'inline-flex',alignItems:'center',gap:10,background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 14px',textDecoration:'none',color:C.text,maxWidth:280},
  docLabel:{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:11,color:C.muted},
};

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
  copyBtn:{background:'transparent',border:'none',color:C.muted,fontSize:10,cursor:'pointer',fontFamily:C.font},
};

const sw = {
  root:{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:14,textAlign:'center',padding:40},
  title:{fontFamily:C.display,fontWeight:800,fontSize:32,background:'linear-gradient(135deg,#7c6aff,#ff6a9b)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text',letterSpacing:-1},
  grid:{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8,maxWidth:600,marginTop:8},
  card:{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 14px',fontSize:11,color:C.muted,cursor:'pointer',textAlign:'left',lineHeight:1.5,transition:'all 0.15s',':hover':{borderColor:C.accent,color:C.text}},
};
