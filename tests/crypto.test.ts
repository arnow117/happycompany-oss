import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateKey,
  loadOrCreateKey,
  encrypt,
  decrypt,
  encryptCredentials,
  decryptCredentials,
  maskCredentials,
  hasPlaintextCredentials,
} from '../src/crypto.js';

describe('crypto', () => {
  let tempDir: string;
  let key: Buffer;

  beforeEach(() => {
    tempDir = join(tmpdir(), `crypto-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    key = generateKey();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('generateKey', () => {
    it('returns a 32-byte buffer', () => {
      const k = generateKey();
      expect(k).toBeInstanceOf(Buffer);
      expect(k.length).toBe(32);
    });

    it('produces unique keys on each call', () => {
      const a = generateKey();
      const b = generateKey();
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('loadOrCreateKey', () => {
    it('creates a new key file if none exists', () => {
      const keyPath = join(tempDir, 'new', 'keyfile');
      const k = loadOrCreateKey(keyPath);
      expect(k).toBeInstanceOf(Buffer);
      expect(k.length).toBe(32);
      expect(existsSync(keyPath)).toBe(true);
    });

    it('reads an existing key file', () => {
      const keyPath = join(tempDir, 'keyfile');
      const original = generateKey();
      writeFileSync(keyPath, original.toString('hex') + '\n', { mode: 0o600 });
      const loaded = loadOrCreateKey(keyPath);
      expect(loaded.equals(original)).toBe(true);
    });

    it('throws on invalid key file content', () => {
      const keyPath = join(tempDir, 'bad-key');
      writeFileSync(keyPath, 'not-a-valid-key\n');
      expect(() => loadOrCreateKey(keyPath)).toThrow(/Invalid encryption key/);
    });
  });

  describe('encrypt + decrypt round-trip', () => {
    it('encrypts and decrypts a string correctly', () => {
      const plaintext = 'my-secret-app-id-12345';
      const encrypted = encrypt(plaintext, key);
      expect(encrypted).toMatch(/^enc:/);
      const decrypted = decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertexts for the same plaintext', () => {
      const plaintext = 'same-value';
      const a = encrypt(plaintext, key);
      const b = encrypt(plaintext, key);
      expect(a).not.toBe(b);
      expect(decrypt(a, key)).toBe(plaintext);
      expect(decrypt(b, key)).toBe(plaintext);
    });

    it('handles empty string', () => {
      const encrypted = encrypt('', key);
      expect(decrypt(encrypted, key)).toBe('');
    });

    it('handles unicode content', () => {
      const plaintext = '医院CRM助手-中文测试-🎉';
      const encrypted = encrypt(plaintext, key);
      expect(decrypt(encrypted, key)).toBe(plaintext);
    });

    it('fails to decrypt with a different key', () => {
      const otherKey = generateKey();
      const encrypted = encrypt('secret', key);
      expect(() => decrypt(encrypted, otherKey)).toThrow();
    });
  });

  describe('encryptCredentials / decryptCredentials', () => {
    it('round-trips all credential values', () => {
      const creds = {
        appId: 'cli_abc123xyz',
        appSecret: 'super-secret-value-here',
      };
      const encrypted = encryptCredentials(creds, key);
      for (const v of Object.values(encrypted)) {
        expect(v).toMatch(/^enc:/);
      }
      const decrypted = decryptCredentials(encrypted, key);
      expect(decrypted).toEqual(creds);
    });

    it('handles multiple bots worth of credentials', () => {
      const creds = {
        feishuAppId: 'cli_a5f8b2c3d4e5',
        feishuAppSecret: 'xF8kL2mN9pQ3rS7tU1vW',
        dingClientId: 'ding1234567890abcdef',
        dingClientSecret: 'ABC123def456GHI789jkl012MNO345pqr678',
      };
      const encrypted = encryptCredentials(creds, key);
      const decrypted = decryptCredentials(encrypted, key);
      expect(decrypted).toEqual(creds);
    });

    it('skips values already encrypted (idempotent)', () => {
      const creds = { appId: 'plain-value' };
      const encrypted = encryptCredentials(creds, key);
      const doubleEncrypted = encryptCredentials(encrypted, key);
      expect(doubleEncrypted).toEqual(encrypted);
      expect(decryptCredentials(doubleEncrypted, key)).toEqual(creds);
    });
  });

  describe('decryptCredentials mixed state', () => {
    it('handles mixed encrypted and plaintext values', () => {
      const creds = {
        appId: 'cli_plaintext_value',
        appSecret: encrypt('real-secret', key),
      };
      const result = decryptCredentials(creds, key);
      expect(result.appId).toBe('cli_plaintext_value');
      expect(result.appSecret).toBe('real-secret');
    });

    it('falls back to plaintext if decryption fails', () => {
      const creds = {
        appId: 'enc:invalid-base64:not-valid:garbage',
        appSecret: 'plain-keeps-working',
      };
      const result = decryptCredentials(creds, key);
      expect(result.appId).toBe('enc:invalid-base64:not-valid:garbage');
      expect(result.appSecret).toBe('plain-keeps-working');
    });
  });

  describe('empty credentials', () => {
    it('handles empty object', () => {
      expect(encryptCredentials({}, key)).toEqual({});
      expect(decryptCredentials({}, key)).toEqual({});
    });
  });

  describe('maskCredentials', () => {
    it('masks long values correctly', () => {
      const creds = { appId: 'cli_a5f8b2c3d4e5', appSecret: 'xF8kL2mN9pQ3r' };
      const masked = maskCredentials(creds);
      expect(masked.appId).toBe('cli_***4e5');
      expect(masked.appSecret).toBe('xF8k***Q3r');
    });

    it('masks short values as ***', () => {
      const creds = { short: 'abc' };
      const masked = maskCredentials(creds);
      expect(masked.short).toBe('***');
    });

    it('masks 8-char values as *** (not > 8)', () => {
      const creds = { exact8: '12345678' };
      const masked = maskCredentials(creds);
      expect(masked.exact8).toBe('***');
    });

    it('masks 9-char values with pattern', () => {
      const creds = { nine: '123456789' };
      const masked = maskCredentials(creds);
      expect(masked.nine).toBe('1234***789');
    });

    it('handles empty object', () => {
      expect(maskCredentials({})).toEqual({});
    });

    it('does not mutate original', () => {
      const creds = { appId: 'cli_abcdefghijklmnop' };
      const copy = { ...creds };
      maskCredentials(creds);
      expect(creds).toEqual(copy);
    });
  });

  describe('hasPlaintextCredentials', () => {
    it('returns true when all values are plaintext', () => {
      expect(hasPlaintextCredentials({ a: 'plain', b: 'also-plain' })).toBe(true);
    });

    it('returns false when all values are encrypted', () => {
      expect(hasPlaintextCredentials({ a: encrypt('x', key), b: encrypt('y', key) })).toBe(false);
    });

    it('returns true when mixed', () => {
      expect(hasPlaintextCredentials({ a: encrypt('x', key), b: 'plain' })).toBe(true);
    });

    it('returns false for empty credentials', () => {
      expect(hasPlaintextCredentials({})).toBe(false);
    });
  });
});
