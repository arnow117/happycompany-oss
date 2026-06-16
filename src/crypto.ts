import crypto from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ENC_PREFIX = 'enc:';

export function generateKey(): Buffer {
  return crypto.randomBytes(32);
}

export function loadOrCreateKey(keyPath: string): Buffer {
  if (existsSync(keyPath)) {
    const raw = readFileSync(keyPath, 'utf-8').trim();
    const key = Buffer.from(raw, 'hex');
    if (key.length === 32) return key;
    throw new Error(`Invalid encryption key at ${keyPath}: expected 32 bytes (64 hex chars)`);
  }

  mkdirSync(dirname(keyPath), { recursive: true });
  const key = generateKey();
  writeFileSync(keyPath, key.toString('hex') + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
  return key;
}

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decrypt(encoded: string, key: Buffer): string {
  const withoutPrefix = encoded.startsWith(ENC_PREFIX)
    ? encoded.slice(ENC_PREFIX.length)
    : encoded;
  const parts = withoutPrefix.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted value format');

  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}

export function encryptCredentials(credentials: Record<string, string>, key: Buffer): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(credentials)) {
    result[k] = v.startsWith(ENC_PREFIX) ? v : encrypt(v, key);
  }
  return result;
}

export function decryptCredentials(credentials: Record<string, string>, key: Buffer): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(credentials)) {
    if (!v.startsWith(ENC_PREFIX)) {
      result[k] = v;
      continue;
    }
    try {
      result[k] = decrypt(v, key);
    } catch {
      result[k] = v;
    }
  }
  return result;
}

export function maskCredentials(credentials: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(credentials)) {
    result[k] = v.length > 8
      ? `${v.slice(0, 4)}***${v.slice(-3)}`
      : '***';
  }
  return result;
}

export function hasPlaintextCredentials(credentials: Record<string, string>): boolean {
  return Object.values(credentials).some((v) => !v.startsWith(ENC_PREFIX));
}
