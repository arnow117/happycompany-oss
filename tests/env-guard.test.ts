import { describe, it, expect, vi } from 'vitest';
import {
  DANGEROUS_ENV_VARS,
  RESERVED_CLAUDE_ENV_KEYS,
  MAX_CUSTOM_ENV_ENTRIES,
  sanitizeEnv,
} from '../src/env-guard.js';

describe('env-guard', () => {
  // -----------------------------------------------------------------------
  // DANGEROUS_ENV_VARS
  // -----------------------------------------------------------------------
  describe('DANGEROUS_ENV_VARS', () => {
    it('contains exactly 35 entries', () => {
      expect(DANGEROUS_ENV_VARS.size).toBe(35);
    });

    it('covers all dangerous vars from every category', () => {
      const representative = [
        // Code execution / preload
        'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT',
        'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'DYLD_FRAMEWORK_PATH',
        'NODE_OPTIONS', 'JAVA_TOOL_OPTIONS', 'PERL5OPT',
        // Path manipulation
        'PATH', 'PYTHONPATH', 'RUBYLIB', 'PERL5LIB', 'GIT_EXEC_PATH', 'CDPATH',
        // Shell behavior
        'BASH_ENV', 'ENV', 'PROMPT_COMMAND', 'ZDOTDIR',
        // Editor / terminal
        'EDITOR', 'VISUAL', 'PAGER',
        // SSH / Git credentials
        'SSH_AUTH_SOCK', 'SSH_AGENT_PID', 'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_ASKPASS',
        // Sensitive dirs
        'HOME', 'TMPDIR', 'TEMP', 'TMP',
        // Platform internal
        'UNIFIED_PLATFORM_WORKSPACE_GROUP', 'UNIFIED_PLATFORM_WORKSPACE_GLOBAL',
        'UNIFIED_PLATFORM_WORKSPACE_IPC', 'CLAUDE_CONFIG_DIR',
      ];
      for (const key of representative) {
        expect(DANGEROUS_ENV_VARS.has(key)).toBe(true);
      }
    });

    it('iterates all 35 dangerous vars without duplicates', () => {
      const seen = new Set<string>();
      for (const key of DANGEROUS_ENV_VARS) {
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      expect(seen.size).toBe(35);
    });
  });

  // -----------------------------------------------------------------------
  // RESERVED_CLAUDE_ENV_KEYS
  // -----------------------------------------------------------------------
  describe('RESERVED_CLAUDE_ENV_KEYS', () => {
    it('contains the reserved Claude keys', () => {
      expect(RESERVED_CLAUDE_ENV_KEYS.has('CLAUDE_CODE_OAUTH_TOKEN')).toBe(true);
      expect(RESERVED_CLAUDE_ENV_KEYS.has('ANTHROPIC_MODEL')).toBe(true);
    });

    it('has exactly 2 entries', () => {
      expect(RESERVED_CLAUDE_ENV_KEYS.size).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // MAX_CUSTOM_ENV_ENTRIES
  // -----------------------------------------------------------------------
  describe('MAX_CUSTOM_ENV_ENTRIES', () => {
    it('is 50', () => {
      expect(MAX_CUSTOM_ENV_ENTRIES).toBe(50);
    });
  });

  // -----------------------------------------------------------------------
  // sanitizeEnv
  // -----------------------------------------------------------------------
  describe('sanitizeEnv', () => {
    it('removes dangerous vars such as LD_PRELOAD', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const env = { LD_PRELOAD: '/evil.so', SAFE_VAR: 'ok' };
      const result = sanitizeEnv(env);

      expect(result).not.toHaveProperty('LD_PRELOAD');
      expect(result.SAFE_VAR).toBe('ok');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('LD_PRELOAD'),
      );
      warnSpy.mockRestore();
    });

    it('removes reserved Claude keys', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const env = { CLAUDE_CODE_OAUTH_TOKEN: 'secret', MY_VAR: 'safe' };
      const result = sanitizeEnv(env);

      expect(result).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
      expect(result.MY_VAR).toBe('safe');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('CLAUDE_CODE_OAUTH_TOKEN'),
      );
      warnSpy.mockRestore();
    });

    it('passes safe vars through unchanged', () => {
      const env = { APP_NAME: 'demo', LOG_LEVEL: 'info', PORT: '3000' };
      const result = sanitizeEnv(env);

      expect(result).toEqual(env);
    });

    it('returns an empty object when given an empty object', () => {
      expect(sanitizeEnv({})).toEqual({});
    });

    it('warns for every blocked key', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const env = { LD_PRELOAD: '/evil.so', PATH: '/hijacked', BASH_ENV: '/trap' };
      const result = sanitizeEnv(env);

      expect(result).toEqual({});
      expect(warnSpy).toHaveBeenCalledTimes(3);
      warnSpy.mockRestore();
    });

    it('does not mutate the input object', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const env = { LD_PRELOAD: '/evil.so', SAFE: 'yes' };
      const result = sanitizeEnv(env);

      expect(env).toHaveProperty('LD_PRELOAD');
      expect(env).toHaveProperty('SAFE');
      expect(result).not.toHaveProperty('LD_PRELOAD');
      expect(result).toHaveProperty('SAFE');
      warnSpy.mockRestore();
    });

    it('removes all 35 dangerous vars', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const env: Record<string, string> = {};
      for (const key of DANGEROUS_ENV_VARS) {
        env[key] = 'blocked';
      }
      // also add a safe key to prove we do not strip everything
      env.APP_NAME = 'kept';

      const result = sanitizeEnv(env);

      for (const key of DANGEROUS_ENV_VARS) {
        expect(result).not.toHaveProperty(key);
      }
      expect(result.APP_NAME).toBe('kept');
      warnSpy.mockRestore();
    });
  });
});
