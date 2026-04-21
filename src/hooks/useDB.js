import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// ── Threads ───────────────────────────────────────────────────────────────────
export function useThreads() {
  const { user } = useAuth();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchThreads = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('threads')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (!error) setThreads(data || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  const createThread = async (name = 'New Session') => {
    const { data, error } = await supabase
      .from('threads')
      .insert({ user_id: user.id, name })
      .select()
      .single();
    if (error) throw error;
    setThreads(prev => [data, ...prev]);
    return data;
  };

  const updateThread = async (id, updates) => {
    const { error } = await supabase
      .from('threads')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (!error) setThreads(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const deleteThread = async (id) => {
    await supabase.from('threads').delete().eq('id', id);
    setThreads(prev => prev.filter(t => t.id !== id));
  };

  return { threads, loading, createThread, updateThread, deleteThread, refetch: fetchThreads };
}

// ── Messages ──────────────────────────────────────────────────────────────────
export function useMessages(threadId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchMessages = useCallback(async () => {
    if (!threadId) { setMessages([]); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    if (!error) setMessages(data || []);
    setLoading(false);
  }, [threadId]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  const addMessage = async (role, content, fileUrls = [], overrideThreadId = null) => {
    // FIX: overrideThreadId bypasses React state timing race on first message
    const tid = overrideThreadId || threadId;
    if (!tid) {
      console.error('[VOID] addMessage: no threadId available');
      throw new Error('No threadId for addMessage');
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({
        thread_id: tid,
        role,
        content,
        file_urls: fileUrls,
        has_files: fileUrls.length > 0,
      })
      .select()
      .single();

    if (error) {
      console.error('[VOID] Supabase insert error:', error);
      throw error;
    }

    setMessages(prev => [...prev, data]);
    return data;
  };

  const clearMessages = async () => {
    await supabase.from('messages').delete().eq('thread_id', threadId);
    setMessages([]);
  };

  return { messages, loading, addMessage, clearMessages, refetch: fetchMessages };
}