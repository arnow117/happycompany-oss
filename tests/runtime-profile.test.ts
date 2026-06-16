import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  applyRuntimeProfileDefaults,
  resolveRuntimeDataDir,
  resolveRuntimeProfile,
} from '../src/runtime-config-profile.js';
import type { Config } from '../src/config.js';

const cwd = '/repo/happycompany';

function baseConfig(): Config {
  return {
    bots: {
      'web-bot': {
        channel: 'web',
        credentials: {},
        displayName: 'Web Bot',
        agentDir: 'agents/web-bot',
      },
    },
    claude: {},
    web: { port: 3100 },
    webChat: {
      welcomeTitle: 'hello',
      welcomeSubtitle: 'start',
      inputPlaceholder: 'message',
      historyLimit: 50,
      enableImageUpload: true,
      showSessionPicker: true,
      showQuickPrompts: true,
    },
    dataDir: 'data',
  };
}

describe('runtime profile resolution', () => {
  it('keeps the existing default config path when no profile is selected', () => {
    const profile = resolveRuntimeProfile([], cwd, {});

    expect(profile).toEqual({
      source: 'default',
      rootDir: cwd,
      configPath: resolve(cwd, 'config.json'),
    });
  });

  it('supports the legacy positional config path', () => {
    const profile = resolveRuntimeProfile(['config.e2e.json'], cwd, {});

    expect(profile.source).toBe('config');
    expect(profile.configPath).toBe(resolve(cwd, 'config.e2e.json'));
    expect(profile.rootDir).toBe(cwd);
  });

  it('resolves --profile to an isolated .runtime config path', () => {
    const profile = resolveRuntimeProfile(['--profile', 'feat-builder'], cwd, {});

    expect(profile.source).toBe('profile');
    expect(profile.name).toBe('feat-builder');
    expect(profile.rootDir).toBe(resolve(cwd, '.runtime/feat-builder'));
    expect(profile.configPath).toBe(resolve(cwd, '.runtime/feat-builder/config.json'));
  });

  it('lets explicit config path win over environment profile', () => {
    const profile = resolveRuntimeProfile([], cwd, {
      HAPPYCOMPANY_PROFILE: 'feat-a',
      HAPPYCOMPANY_CONFIG: 'local/config.json',
    });

    expect(profile.source).toBe('config');
    expect(profile.name).toBe('feat-a');
    expect(profile.configPath).toBe(resolve(cwd, 'local/config.json'));
  });

  it('rejects profile names that would escape the runtime root', () => {
    expect(() => resolveRuntimeProfile(['--profile', '../prod'], cwd, {})).toThrow(/Invalid runtime profile/);
  });

  it('keeps dataDir unchanged for non-profile config paths', () => {
    const profile = resolveRuntimeProfile(['config.json'], cwd, {});
    const config = applyRuntimeProfileDefaults(baseConfig(), profile);

    expect(config.dataDir).toBe('data');
    expect(config.corpDir).toBeUndefined();
  });

  it('defaults profile dataDir and corpDir under the profile root', () => {
    const profile = resolveRuntimeProfile(['--profile=feat-builder'], cwd, {});
    const config = applyRuntimeProfileDefaults(baseConfig(), profile);

    expect(config.dataDir).toBe(resolve(cwd, '.runtime/feat-builder/data'));
    expect(config.corpDir).toBe(resolve(cwd, '.runtime/feat-builder/corp'));
  });

  it('resolves relative profile paths from the profile root', () => {
    const profile = resolveRuntimeProfile(['--profile=feat-builder'], cwd, {});
    const config = applyRuntimeProfileDefaults(
      {
        ...baseConfig(),
        dataDir: 'state',
        corpDir: 'tenants',
      },
      profile,
    );

    expect(config.dataDir).toBe(resolve(cwd, '.runtime/feat-builder/state'));
    expect(config.corpDir).toBe(resolve(cwd, '.runtime/feat-builder/tenants'));
  });

  it('uses profile-root dataDir for key creation when raw config omits dataDir', () => {
    const profile = resolveRuntimeProfile(['--profile=feat-builder'], cwd, {});

    expect(resolveRuntimeDataDir({}, profile)).toBe(resolve(cwd, '.runtime/feat-builder/data'));
  });

  it('expands raw dataDir env placeholder before key creation', () => {
    const profile = resolveRuntimeProfile(['--profile=feat-builder'], cwd, {});

    expect(resolveRuntimeDataDir({ dataDir: '$PROFILE_DATA' }, profile, {
      PROFILE_DATA: 'state-from-env',
    })).toBe(resolve(cwd, '.runtime/feat-builder/state-from-env'));
  });
});
