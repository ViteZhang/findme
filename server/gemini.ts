import net from 'node:net';
import { GoogleGenAI } from '@google/genai';

let cachedClient: GoogleGenAI | null = null;
let proxyChecked = false;
let networkUnreachableUntil = 0;

export function isGeminiNetworkTemporarilyDown(): boolean {
  return Date.now() < networkUnreachableUntil;
}

export function markGeminiNetworkFailure(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '');
  const causeCode = String((err as any)?.cause?.code || '');
  const isNetErr =
    /fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|UND_ERR_CONNECT_TIMEOUT|timed out|AbortError/i.test(
      `${msg} ${causeCode}`,
    );
  if (isNetErr) {
    networkUnreachableUntil = Date.now() + 60_000;
  }
  return isNetErr;
}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Gemini request timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function ensureLocalProxyIfReachable(): Promise<void> {
  if (proxyChecked) return;
  proxyChecked = true;
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!proxyUrl || process.env.VERCEL) return;

  try {
    const parsed = new URL(proxyUrl);
    const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
    const host = parsed.hostname;
    const reachable = await new Promise<boolean>((resolve) => {
      const sock = net.createConnection({ host, port, timeout: 400 });
      sock.once('connect', () => {
        sock.destroy();
        resolve(true);
      });
      sock.once('error', () => resolve(false));
      sock.once('timeout', () => {
        sock.destroy();
        resolve(false);
      });
    });
    if (reachable) {
      process.env.NODE_USE_ENV_PROXY = '1';
    }
  } catch {
    // ignore malformed proxy env
  }
}

export async function getGeminiClient(): Promise<GoogleGenAI | null> {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  await ensureLocalProxyIfReachable();
  if (!cachedClient) {
    cachedClient = apiKey.startsWith('AQ.')
      ? new GoogleGenAI({ vertexai: true, apiKey })
      : new GoogleGenAI({ apiKey });
  }
  return cachedClient;
}

export function getModelChain(tier: 'safety' | 'chat' | 'portrait'): string[] {
  if (tier === 'safety') {
    const primary = process.env.GEMINI_SAFETY_MODEL || 'gemini-4-hydrogen';
    return [...new Set([primary, 'gemini-4-neon', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'])];
  }
  if (tier === 'portrait') {
    const primary = process.env.GEMINI_PORTRAIT_MODEL || 'gemini-4-carbon';
    return [...new Set([primary, 'gemini-4-neon', 'gemini-2.5-pro', 'gemini-2.5-flash'])];
  }
  const primary = process.env.GEMINI_CHAT_MODEL || 'gemini-4-neon';
  return [...new Set([primary, 'gemini-4-hydrogen', 'gemini-4-carbon', 'gemini-2.5-flash'])];
}

export interface StructuredGenResult<T> {
  data: T;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
}

export async function generateStructuredJson<T>(params: {
  tier: 'safety' | 'chat' | 'portrait';
  systemInstruction: string;
  contents: any;
  temperature?: number;
}): Promise<StructuredGenResult<T>> {
  if (isGeminiNetworkTemporarilyDown()) {
    throw new Error('Gemini network temporarily unreachable');
  }

  const ai = await getGeminiClient();
  if (!ai) {
    throw new Error('大模型密钥 GEMINI_API_KEY 尚未配置');
  }

  const models = getModelChain(params.tier);
  const timeoutMs = params.tier === 'safety' ? 2500 : params.tier === 'chat' ? 6000 : 9000;
  let lastErr: unknown = null;

  for (const model of models) {
    try {
      const resp = await withTimeout(
        ai.models.generateContent({
          model,
          contents: params.contents,
          config: {
            systemInstruction: params.systemInstruction,
            temperature: params.temperature ?? 0.35,
            responseMimeType: 'application/json',
          },
        }),
        timeoutMs,
      );
      const rawText = (resp.text || '{}').trim();
      const cleaned = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(cleaned) as T;
      return {
        data: parsed,
        modelUsed: model,
        inputTokens: resp.usageMetadata?.promptTokenCount || 0,
        outputTokens: resp.usageMetadata?.candidatesTokenCount || 0,
      };
    } catch (err) {
      lastErr = err;
      if (markGeminiNetworkFailure(err)) {
        break;
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('模型服务暂时不可用，请稍后重试');
}
