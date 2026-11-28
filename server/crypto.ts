import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

function resolveKey(secret?: string): Buffer {
  const raw = secret || process.env.DATA_ENCRYPTION_KEY || 'findme-dev-fallback-key-do-not-use-in-prod';
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return createHash('sha256').update(raw).digest();
}

export function encryptText(plaintext: string | null | undefined, secret?: string): string {
  if (plaintext === null || plaintext === undefined || plaintext === '') return '';
  if (plaintext.startsWith(PREFIX)) return plaintext;
  const key = resolveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptText(payload: string | null | undefined, secret?: string): string {
  if (!payload) return '';
  if (!payload.startsWith(PREFIX)) return payload;
  const parts = payload.slice(PREFIX.length).split('.');
  if (parts.length !== 3) {
    throw new Error('加密数据格式损坏');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const key = resolveKey(secret);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function encryptJson<T>(value: T, secret?: string): string {
  return encryptText(JSON.stringify(value), secret);
}

export function decryptJson<T>(payload: string | null | undefined, fallback: T, secret?: string): T {
  if (!payload) return fallback;
  try {
    const raw = decryptText(payload, secret);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
