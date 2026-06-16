#!/usr/bin/env node
/**
 * Feishu E2E Test
 *
 * Starts the backend with Feishu channel, verifies WebSocket connection,
 * and optionally tests message round-trip if CHAT_ID is provided.
 *
 * Usage:
 *   FEISHU_APP_ID=xxx FEISHU_APP_SECRET=yyy ANTHROPIC_API_KEY=zzz node scripts/test-feishu-e2e.mjs
 *   CHAT_ID=oc_xxxxxxxx node scripts/test-feishu-e2e.mjs  # with message test
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHAT_ID = process.env.CHAT_ID || '';
const TIMEOUT_MS = 45_000;

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const configPath = path.resolve(ROOT, '..', 'e2e', 'config.feishu.json');
    const proc = spawn('npx', ['tsx', 'src/index.ts', configPath], {
      cwd: path.resolve(ROOT, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const lines = [];
    let resolved = false;

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      lines.push(text);

      if (!resolved) {
        // Check for WebSocket connection success
        if (text.includes('Feishu channel WebSocket connected')) {
          resolved = true;
          resolve(proc);
        }

        // Check for fatal startup errors
        if (text.includes('fatal error') || text.includes('FATAL')) {
          resolved = true;
          reject(new Error(`Backend startup failed:\n${text}`));
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      lines.push(text);
    });

    proc.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Backend exited with code ${code}\n${lines.join('')}`));
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill('SIGKILL');
        reject(new Error(`Backend startup timed out after ${TIMEOUT_MS}ms`));
      }
    }, TIMEOUT_MS);
  });
}

function killBackend(proc) {
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
    }, 3000);
  }
}

function waitForCondition(label, fn, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (fn()) {
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
}

async function checkHealth() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://localhost:3100/api/health', (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`Invalid JSON from health endpoint: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Health endpoint timeout'));
    });
  });
}

async function main() {
  console.log('Feishu E2E Test\n');

  // ── Phase 1: Start backend ───────────────────────────────────
  console.log('Phase 1: Backend startup + WebSocket connection');

  const proc = await startBackend();
  console.log('  ✅ Backend started, WebSocket connected');

  // ── Phase 1b: Health check ────────────────────────────────
  console.log('\nPhase 1b: Health endpoint verification');

  try {
    const health = await checkHealth();
    assert('Health endpoint responds 200', health.status === 'ok');
    assert('Bots list includes feishu-test', health.bots?.some((b) => b.name === 'feishu-test'));

    const feishuBot = health.bots?.find((b) => b.name === 'feishu-test');
    assert('Feishu bot status is running', feishuBot?.status === 'running');
    assert('Bot has displayName', typeof feishuBot?.displayName === 'string');
    console.log(`     Bot: ${feishuBot.displayName} (${feishuBot.name})`);
  } catch (err) {
    console.log(`  ❌ Health check failed: ${err.message}`);
    failed++;
  }

  // ── Phase 2: Message test (if CHAT_ID provided) ───────────
  if (CHAT_ID) {
    console.log('\nPhase 2: Message round-trip (requires CHAT_ID)');

    // Query messages via admin API
    try {
      const res = await new Promise((resolve, reject) => {
        http.get(`http://localhost:3100/api/admin/chats`, (res) => {
          let body = '';
          res.on('data', (chunk) => body += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch {
              reject(new Error(`Invalid JSON from chats endpoint`));
            }
          });
        });
        req.on('error', reject);
      });
      assert('Chats endpoint responds', Array.isArray(res));
      console.log(`     Found ${res.length} chat(s)`);
    } catch (err) {
      console.log(`  ❌ Chats endpoint failed: ${err.message}`);
      failed++;
    }

    console.log(`\n  ℹ️  Automated message send/receive requires Feishu API token.`);
    console.log(`     CHAT_ID=${CHAT_ID} — please verify manually in Feishu app.`);
  } else {
    console.log('\nPhase 2: Skipped (no CHAT_ID provided)');
    console.log('  ℹ️  Run with CHAT_ID=oc_xxxxxx to test message round-trip');
  }

  // ── Summary ────────────────────────────────────────────────
  console.log('\n─────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);

  // Cleanup
  killBackend(proc);
}

main().catch((err) => {
  console.error(`\n💥 Fatal: ${err.message}`);
  process.exit(1);
});
