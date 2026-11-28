import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const TOKEN_STORAGE_KEY = 'findme_auth_token_v05';
const EMAIL_STORAGE_KEY = 'findme_auth_email_v05';

let browserSupabase: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const pubKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !pubKey) return null;
  if (!browserSupabase) {
    browserSupabase = createClient(url, pubKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'findme_sb_session',
      },
    });
  }
  return browserSupabase;
}

export function getStoredAuthToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredAuthSession(token: string, email: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  localStorage.setItem(EMAIL_STORAGE_KEY, email);
}

export function clearStoredAuthSession(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(EMAIL_STORAGE_KEY);
  getBrowserSupabase()?.auth.signOut().catch(() => null);
}

export async function resolveClientToken(): Promise<string | null> {
  const sb = getBrowserSupabase();
  if (sb) {
    const { data } = await sb.auth.getSession();
    if (data?.session?.access_token) {
      return data.session.access_token;
    }
  }
  return getStoredAuthToken();
}

export async function checkEmailWhitelist(email: string): Promise<{
  allowed: boolean;
  allowLocalDirect?: boolean;
  localToken?: string;
}> {
  const res = await fetch('/api/app?public=check-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || '邮箱校验失败');
  }
  return json;
}

export async function fetchBootstrap(conversationId?: string): Promise<any> {
  const token = await resolveClientToken();
  if (!token) throw Object.assign(new Error('UNAUTHORIZED'), { unauthorized: true });

  const qs = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : '';
  const res = await fetch(`/api/app${qs}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (res.status === 401) {
    throw Object.assign(new Error(json.error || '请重新登录'), { unauthorized: true });
  }
  if (!res.ok) {
    throw new Error(json.error || '加载数据失败');
  }
  return json;
}

export async function callAppAction<T = any>(
  action: string,
  payload: Record<string, any> = {},
): Promise<T> {
  const token = await resolveClientToken();
  if (!token) throw new Error('登录已失效，请重新登录');

  const res = await fetch('/api/app', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || '操作未能完成');
  }
  return json as T;
}

export async function streamCoachTurn(params: {
  conversationId: string;
  text: string;
  skipLowTopic?: boolean;
  signal?: AbortSignal;
  onChunk: (chunk: string) => void;
}): Promise<{
  conversation: any;
  messages: any[];
  safetyTriggered: string;
  completedGoalSetup: boolean;
  state: any;
}> {
  const token = await resolveClientToken();
  if (!token) throw new Error('登录已失效，请重新登录');

  const res = await fetch('/api/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      conversationId: params.conversationId,
      text: params.text,
      skipLowTopic: params.skipLowTopic,
    }),
    signal: params.signal,
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || '连接中断，请重试');
  }

  if (!res.body) {
    throw new Error('流式响应不可用');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: any = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const evtBlock of events) {
      const lines = evtBlock.split('\n');
      let eventName = 'message';
      let dataLine = '';
      for (const line of lines) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) dataLine = line.slice(5).trim();
      }
      if (!dataLine) continue;
      const parsed = JSON.parse(dataLine);
      if (eventName === 'chunk' && parsed.text) {
        params.onChunk(parsed.text);
      } else if (eventName === 'complete') {
        finalResult = parsed;
      } else if (eventName === 'error') {
        throw new Error(parsed.error || '我刚才没想好，再试一次');
      }
    }
  }

  if (!finalResult) {
    throw new Error('回复未完整送达，请重试');
  }

  return finalResult;
}
