/**
 * Vitest globalSetup — starts the test server once before any workers.
 *
 * Runs in the main process, not inside any worker.
 * Workers just connect via helpers.ts HTTP functions.
 */

import { spawn, execSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { existsSync, unlinkSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const BASE = 'http://127.0.0.1:3100';
const PID_FILE = join(PROJECT_ROOT, '.test-server-pid');

// Use a sandbox config file so integration tests never mutate config.json.
// The committed config.test.example.json makes a clean checkout / CI deterministic
// (it defines the web-bot and __test-bot__ the integration tests expect); a local
// config.json is only used as a fallback when the seed is absent.
const TEST_CONFIG = 'config.test.json';
const SEED_CONFIG = 'config.test.example.json';
const REAL_CONFIG = 'config.json';
const CONFIG_PATH = resolve(PROJECT_ROOT, TEST_CONFIG);
const SEED_CONFIG_PATH = resolve(PROJECT_ROOT, SEED_CONFIG);
const REAL_CONFIG_PATH = resolve(PROJECT_ROOT, REAL_CONFIG);
let stoppedPm2Backend = false;
let serverProcess: ChildProcess | undefined;
let tearingDown = false;

interface Pm2ProcessInfo {
  name?: string;
  pm2_env?: {
    status?: string;
  };
}

function isPm2ProcessInfo(value: unknown): value is Pm2ProcessInfo {
  return !!value && typeof value === 'object';
}

function getPm2Processes(): Pm2ProcessInfo[] {
  try {
    const output = execSync('pm2 jlist', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const parsed = JSON.parse(output) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPm2ProcessInfo);
  } catch {
    return [];
  }
}

function stopPm2BackendIfRunning(): void {
  const backend = getPm2Processes().find((processInfo) => processInfo.name === 'hc-backend');
  if (backend?.pm2_env?.status !== 'online') return;
  try {
    execSync('pm2 stop hc-backend', { stdio: 'ignore' });
    stoppedPm2Backend = true;
  } catch {
    stoppedPm2Backend = false;
  }
}

function restartPm2BackendIfStopped(): void {
  if (!stoppedPm2Backend) return;
  try {
    execSync('pm2 restart hc-backend', { stdio: 'ignore' });
  } catch { /* PM2 not available or app removed */ }
  stoppedPm2Backend = false;
}

function killPort(port = 3100): void {
  try {
    const pids = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim();
    if (pids) {
      for (const pid of pids.split('\n')) {
        try { process.kill(Number(pid.trim()), 'SIGKILL'); } catch { /* already dead */ }
      }
    }
  } catch { /* no process */ }
}

function ensureWebBuild(): void {
  const distEntry = join(PROJECT_ROOT, 'web', 'dist', 'index.html');
  if (existsSync(distEntry)) return;
  // Clean checkout / CI: build the SPA once so static-serving routes work.
  execSync('npm run build', {
    cwd: join(PROJECT_ROOT, 'web'),
    stdio: 'inherit',
  });
}

function waitForServer(url: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server not ready after ${timeoutMs}ms`)), timeoutMs);
    const check = () => {
      fetch(url, { signal: AbortSignal.timeout(1000) })
        .then((r) => { if (r.ok || r.status === 404) { clearTimeout(timer); resolve(); } else { setTimeout(check, 300); } })
        .catch(() => setTimeout(check, 300));
    };
    check();
  });
}

async function stopServerProcess(): Promise<void> {
  if (!serverProcess || serverProcess.killed) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
      resolve();
    }, 1000);
    serverProcess?.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    serverProcess?.kill('SIGTERM');
  });
  serverProcess = undefined;
}

async function globalTeardown(): Promise<void> {
  tearingDown = true;
  await stopServerProcess();

  if (existsSync(PID_FILE)) {
    try {
      const pid = Number(readFileSync(PID_FILE, 'utf8').trim());
      if (pid) process.kill(pid, 'SIGTERM');
    } catch { /* already dead */ }
    try { unlinkSync(PID_FILE); } catch { /* already removed */ }
  }

  try { unlinkSync(join(PROJECT_ROOT, '.test-server-lock')); } catch { /* already removed */ }
  killPort(3100);
  restartPm2BackendIfStopped();
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  stopPm2BackendIfRunning();

  // Always kill anything on the port — never reuse a possibly-stale server.
  killPort(3100);

  // Ensure the web frontend is built — server-integration tests serve web/dist.
  ensureWebBuild();

  // Materialize the sandbox config from the committed deterministic seed
  // (falls back to a local config.json only if the seed is missing).
  if (!existsSync(CONFIG_PATH)) {
    const source = existsSync(SEED_CONFIG_PATH)
      ? SEED_CONFIG_PATH
      : REAL_CONFIG_PATH;
    if (!existsSync(source)) {
      throw new Error(
        `No test config available: expected ${SEED_CONFIG} (committed) or ${REAL_CONFIG}.`,
      );
    }
    copyFileSync(source, CONFIG_PATH);
  }

  // Run TypeScript source directly via tsx against the sandbox config
  const server = spawn('npx', [
    'tsx',
    resolve(PROJECT_ROOT, 'src/index.ts'),
    CONFIG_PATH,
  ], {
    cwd: PROJECT_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, LOG_LEVEL: 'silent', NODE_ENV: 'test' },
  });
  serverProcess = server;

  server.stdout?.on('data', () => { /* suppress server stdout */ });
  server.stderr?.on('data', () => { /* suppress server stderr */ });
  server.on('error', (err) => { console.error('[globalSetup] Server spawn error:', err); });
  server.on('exit', (code) => {
    if (!tearingDown) console.error(`[globalSetup] Server exited with code ${code}`);
  });

  writeFileSync(PID_FILE, `${server.pid}`);

  await waitForServer(`${BASE}/api/health`, 20000);
  return globalTeardown;
}
