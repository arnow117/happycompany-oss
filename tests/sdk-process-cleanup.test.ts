import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import type { ClaudeAgent } from '../src/agent.js';

/**
 * Test: SDK subprocess lifecycle verification
 *
 * Verifies that claude-agent-sdk subprocesses spawned by ClaudeAgent.respond()
 * are properly cleaned up after the query completes or is aborted.
 *
 * The fix in agent.ts uses query.interrupt() after the for-await loop ends,
 * which signals the SDK to clean up its internal subprocesses.
 */

function countSdkProcesses(): number {
  try {
    // Match only SDK subprocess children: path contains claude-agent-sdk-darwin-arm64
    // AND has --output-format stream-json (the actual spawned subprocess).
    // Avoid matching the current Claude CLI session itself.
    const out = execSync(
      'ps aux | grep "claude-agent-sdk-darwin-arm64/claude.*--output-format stream-json" | grep -v grep | wc -l',
      { encoding: 'utf8' },
    );
    return parseInt(out.trim(), 10);
  } catch {
    return 0;
  }
}

function pkillSdk(): void {
  try {
    execSync('pkill -f "claude-agent-sdk-darwin-arm64/claude.*--output-format stream-json"', {
      stdio: 'ignore',
    });
  } catch {
    // no processes to kill
  }
}

describe('SDK subprocess cleanup', () => {
  let ClaudeAgent: typeof import('../src/agent.js').ClaudeAgent;
  let agent: ClaudeAgent;
  const testDir = '/tmp/__sdk_cleanup_test__';

  beforeAll(async () => {
    // Kill any pre-existing SDK subprocesses (from globalSetup server, prior runs, etc.)
    pkillSdk();
    await new Promise((r) => setTimeout(r, 2000));

    execSync(`mkdir -p "${testDir}"`, { stdio: 'ignore' });
    const mod = await import('../src/agent.js');
    ClaudeAgent = mod.ClaudeAgent;

    agent = new ClaudeAgent({
      name: 'test-bot',
      agentDir: testDir,
      cwd: testDir,
      model: 'test',
    });

    pkillSdk();
  });

  afterAll(() => {
    pkillSdk();
    try {
      execSync(`rm -rf "${testDir}"`, { stdio: 'ignore' });
    } catch {
      // ignore
    }
  });

  it('should not leave orphan SDK processes after respond() completes', async () => {
    const before = countSdkProcesses();

    // Use agent.ts built-in timeout (5min default) + interrupt cleanup.
    // The test timeout is shorter so abort fires first — this is expected.
    try {
      await agent.respond('Reply with exactly: hello', 'test-cleanup-chat', {
        timeoutMs: 15_000,
      });
    } catch {
      // abort/interrupt errors are expected
    }

    // Wait for OS process cleanup after interrupt()
    await new Promise((r) => setTimeout(r, 2000));

    const after = countSdkProcesses();
    const leaked = after - before;

    expect(leaked, `SDK process leak detected: ${leaked} orphan processes remain after respond()`).toBe(0);
  }, 30_000);

  it('should not accumulate processes across multiple respond() calls', async () => {
    pkillSdk();
    await new Promise((r) => setTimeout(r, 1000));

    const calls = 3;
    for (let i = 0; i < calls; i++) {
      // Each call uses short timeout; agent.ts calls interrupt() in finally block
      try {
        await agent.respond(`Say "test ${i}" and nothing else`, `multi-test-${i}`, {
          timeoutMs: 10_000,
        });
      } catch {
        // timeout/abort is acceptable
      }
    }

    // Wait for OS process cleanup — SDK subprocesses may linger briefly
    // after interrupt(). Poll with backoff up to 10s.
    const maxWait = 10_000;
    const pollInterval = 500;
    let elapsed = 0;
    let remaining = countSdkProcesses();
    while (remaining > 0 && elapsed < maxWait) {
      await new Promise((r) => setTimeout(r, pollInterval));
      elapsed += pollInterval;
      remaining = countSdkProcesses();
    }

    expect(remaining, `SDK process accumulation: ${remaining} processes remain after ${calls} sequential calls (waited ${elapsed}ms)`).toBe(0);
  }, 60_000);
});
