import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppServerMgr } from '../src/app-server.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('AppServerMgr', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-server-'));
  });

  afterEach(() => {
    const mgr = AppServerMgr.getInstance();
    if (mgr) mgr.stopAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeServerScript(appName: string, script: string): string {
    const dir = path.join(tmpDir, appName);
    fs.mkdirSync(dir, { recursive: true });
    const scriptPath = path.join(dir, 'server.py');
    fs.writeFileSync(scriptPath, script);
    return dir;
  }

  it('starts a server process and calls via JSON-RPC', async () => {
    const serverDir = writeServerScript('test_app', [
      'import sys, json',
      'for line in sys.stdin:',
      '  req = json.loads(line)',
      '  resp = {"jsonrpc": "2.0", "id": req.get("id"), "result": {"echo": req.get("params", {})}}',
      '  print(json.dumps(resp), flush=True)',
    ].join('\n'));

    const mgr = new AppServerMgr();
    await mgr.startServer('test_app', { cwd: serverDir, entry: 'server.py' });

    const result = await mgr.call('test_app', 'echo', { message: 'hello' });
    expect(result).toEqual({ echo: { message: 'hello' } });

    mgr.stopServer('test_app');
  });

  it('returns error when calling a non-running server', async () => {
    const mgr = new AppServerMgr();
    await expect(mgr.call('nonexistent', 'test', {})).rejects.toThrow('not running');
  });

  it('handles server process crash and reports status', async () => {
    const dir = writeServerScript('crash_app', 'import sys; sys.exit(1)');

    const mgr = new AppServerMgr();
    await mgr.startServer('crash_app', { cwd: dir, entry: 'server.py' });

    // Wait for process to exit
    await new Promise((r) => setTimeout(r, 100));

    const status = mgr.getServerStatus('crash_app');
    expect(status.running).toBe(false);
  });

  it('calls CLI fallback when no server is available', async () => {
    const dir = path.join(tmpDir, 'cli_app');
    fs.mkdirSync(dir, { recursive: true });
    const cliPath = path.join(dir, 'cli.py');
    fs.writeFileSync(cliPath, [
      'import sys, json',
      'print(json.dumps({"result": "cli_ok"}))',
    ].join('\n'));

    const mgr = new AppServerMgr();
    const result = await mgr.callCli({
      cwd: dir,
      command: 'python3',
      args: [cliPath],
      timeoutMs: 5000,
    });
    expect(result).toEqual({ result: 'cli_ok' });
  });

  it('reports status for unknown app', () => {
    const mgr = new AppServerMgr();
    const status = mgr.getServerStatus('unknown');
    expect(status.running).toBe(false);
    expect(status.restartCount).toBe(0);
  });
});
