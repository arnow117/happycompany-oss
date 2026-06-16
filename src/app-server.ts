import { spawn, type ChildProcess } from 'node:child_process';
import { sanitizeEnv } from './env-guard.js';
import { logger } from './logger.js';

export interface ServerConfig {
  cwd: string;
  entry: string;
  python?: string;
}

export interface ServerStatus {
  running: boolean;
  pid?: number;
  startedAt?: number;
  restartCount: number;
}

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

interface ManagedServer {
  process: ChildProcess | null;
  config: ServerConfig;
  startedAt: number;
  restartCount: number;
  pendingRequests: Map<string, PendingRequest>;
  nextId: number;
  stderrBuf: string;
}

export class AppServerMgr {
  private servers = new Map<string, ManagedServer>();
  private static instance: AppServerMgr | null = null;

  static getInstance(): AppServerMgr | null {
    return AppServerMgr.instance;
  }

  constructor() {
    AppServerMgr.instance = this;
  }

  async startServer(appName: string, config: ServerConfig): Promise<void> {
    if (this.servers.has(appName)) {
      logger.warn({ appName }, 'Server already running, stopping first');
      this.stopServer(appName);
    }

    const proc = spawn(
      config.python ?? 'python3',
      [config.entry],
      {
        cwd: config.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: sanitizeEnv(process.env as Record<string, string>),
      },
    );

    const managed: ManagedServer = {
      process: proc,
      config,
      startedAt: Date.now(),
      restartCount: 0,
      pendingRequests: new Map(),
      nextId: 1,
      stderrBuf: '',
    };

    proc.stdout.on('data', (data: Buffer) => {
      this.handleServerOutput(managed, data.toString());
    });

    proc.stderr.on('data', (data: Buffer) => {
      managed.stderrBuf += data.toString();
      if (managed.stderrBuf.length > 1000) {
        managed.stderrBuf = managed.stderrBuf.slice(-500);
      }
      logger.warn({ appName, stderr: data.toString().trim() }, 'Server stderr');
    });

    proc.on('close', (code) => {
      logger.warn({ appName, code }, 'Server process exited');
      managed.process = null;
      for (const [, req] of managed.pendingRequests) {
        clearTimeout(req.timer);
        req.reject(new Error(`Server process exited (code: ${code})`));
      }
      managed.pendingRequests.clear();
    });

    proc.on('error', (err) => {
      logger.error({ appName, err }, 'Server process error');
      managed.process = null;
      for (const [, req] of managed.pendingRequests) {
        clearTimeout(req.timer);
        req.reject(err);
      }
      managed.pendingRequests.clear();
    });

    this.servers.set(appName, managed);
    logger.info({ appName, pid: proc.pid }, 'Server started');
  }

  async call(appName: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const managed = this.servers.get(appName);
    if (!managed?.process) {
      throw new Error(`Server "${appName}" is not running`);
    }

    const id = String(managed.nextId++);
    const request = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        managed.pendingRequests.delete(id);
        reject(new Error(`Server call timeout: ${appName}.${method}`));
      }, 30_000);

      managed.pendingRequests.set(id, { resolve, reject, timer });

      managed.process?.stdin?.write(JSON.stringify(request) + '\n', (err) => {
        if (err) {
          clearTimeout(timer);
          managed.pendingRequests.delete(id);
          reject(new Error(`Failed to write to server stdin: ${err.message}`));
        }
      });
    });
  }

  async callCli(options: {
    cwd: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    timeoutMs?: number;
  }): Promise<unknown> {
    const { cwd, command, args, env, timeoutMs = 30_000 } = options;

    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...sanitizeEnv(process.env as Record<string, string>), ...(env ?? {}) },
      });

      let stdout = '';
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`CLI timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch {
          reject(new Error(`CLI output is not valid JSON (exit code: ${code}): ${stdout.slice(0, 200)}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      proc.stdin!.end();
    });
  }

  stopServer(appName: string): void {
    const managed = this.servers.get(appName);
    if (!managed) return;

    if (managed.process && !managed.process.killed) {
      managed.process.kill('SIGTERM');
    }
    this.servers.delete(appName);
    logger.info({ appName }, 'Server stopped');
  }

  stopAll(): void {
    for (const appName of this.servers.keys()) {
      this.stopServer(appName);
    }
  }

  getServerStatus(appName: string): ServerStatus {
    const managed = this.servers.get(appName);
    if (!managed) return { running: false, restartCount: 0 };

    return {
      running: !!managed.process && !managed.process.killed,
      pid: managed.process?.pid,
      startedAt: managed.startedAt,
      restartCount: managed.restartCount,
    };
  }

  private handleServerOutput(managed: ManagedServer, output: string): void {
    for (const line of output.split('\n')) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && managed.pendingRequests.has(String(msg.id))) {
          const req = managed.pendingRequests.get(String(msg.id))!;
          clearTimeout(req.timer);
          managed.pendingRequests.delete(String(msg.id));
          if (msg.error) {
            req.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            req.resolve(msg.result);
          }
        }
      } catch {
        // Non-JSON line from server, ignore
      }
    }
  }
}
