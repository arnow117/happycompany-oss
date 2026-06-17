import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Opt-in real chat round-trip over the WebSocket transport — the path that the
 * mocked story-q/E2E tests never actually exercise (they mock the socket).
 *
 * Skipped unless HC_REAL_WS_TEST=1 and a model token is provided, so CI stays
 * deterministic. To run it:
 *   HC_REAL_WS_TEST=1 \
 *   ANTHROPIC_AUTH_TOKEN=... ANTHROPIC_BASE_URL=https://... HC_REAL_WS_MODEL=glm-5.1 \
 *   npx vitest run tests/real-ws-chat.test.ts
 */
const ENABLED = process.env.HC_REAL_WS_TEST === '1';
const TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
const BASE_URL = process.env.ANTHROPIC_BASE_URL;
const MODEL = process.env.HC_REAL_WS_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const PORT = Number(process.env.HC_REAL_WS_PORT || 3199);

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not become healthy within ${timeoutMs}ms`);
}

function wsRoundTrip(wsUrl: string, frame: Record<string, unknown>, timeoutMs: number): Promise<string> {
  return new Promise((resolveReply, reject) => {
    const ws = new WebSocket(wsUrl);
    let streamed = '';
    let final = '';
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`no reply within ${timeoutMs}ms`));
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      ws.close();
      resolveReply(final || streamed);
    };
    ws.on('open', () => ws.send(JSON.stringify(frame)));
    ws.on('message', (raw) => {
      let m: Record<string, any>;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'stream_event' && m.event?.type === 'text_delta' && m.event.text) streamed += m.event.text;
      if (m.type === 'new_message' && m.message?.source === 'bot') final = m.message.text || m.message.content || '';
      if (m.type === 'error') { clearTimeout(timer); ws.close(); reject(new Error(`WS error: ${JSON.stringify(m)}`)); }
      if (m.type === 'runner_state' && m.state === 'idle') done();
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

describe.skipIf(!ENABLED || !TOKEN)('real WebSocket chat round-trip (opt-in: HC_REAL_WS_TEST=1)', () => {
  let proc: ChildProcess | undefined;
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'hc-realws-'));
    mkdirSync(join(root, 'agent'), { recursive: true });
    mkdirSync(join(root, 'corp'), { recursive: true });
    writeFileSync(join(root, 'agent', 'CLAUDE.md'), '你是 HappyCompany 的测试数字员工，用一句话简洁回答，不要调用工具。\n');
    const cfg = {
      web: { port: PORT },
      dataDir: join(root, 'data'),
      corpDir: join(root, 'corp'),
      claude: { apiKey: TOKEN, authToken: TOKEN, ...(BASE_URL ? { baseUrl: BASE_URL } : {}), model: MODEL, directorEnabled: false },
      bots: { smoke: { channel: 'web', displayName: 'Smoke', agentDir: join(root, 'agent'), routingMode: 'direct' } },
    };
    const cfgPath = join(root, 'config.json');
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    proc = spawn('npx', ['tsx', resolve(process.cwd(), 'src/index.ts'), cfgPath], {
      cwd: process.cwd(),
      env: { ...process.env, LOG_LEVEL: 'silent', NODE_ENV: 'test' },
      stdio: 'ignore',
    });
    await waitForHealth(`http://127.0.0.1:${PORT}/api/health`, 30_000);
  }, 60_000);

  afterAll(() => {
    proc?.kill('SIGKILL');
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('send_message reaches the real LLM and returns a non-empty new_message reply', async () => {
    const reply = await wsRoundTrip(
      `ws://127.0.0.1:${PORT}/api/ws`,
      { type: 'send_message', workdirId: 'smoke', chatId: 'rt-1', content: '你好，请用一句话简单介绍你自己。' },
      90_000,
    );
    expect(reply.trim().length).toBeGreaterThan(0);
  }, 120_000);
});
