import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sanitizeEnv } from './env-guard.js';

// --- Types ---

export type AppLanguage = 'typescript' | 'python' | 'shell' | 'unknown';

export interface AppRunResult {
  output: string;
  exitCode: number;
  durationMs: number;
}

export interface AppRunOptions {
  appName: string;
  workdir: string;
  args: string[];
  input?: string;
  timeoutMs?: number;
}

// --- Internal Helpers ---

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

function cliEntryPath(workdir: string, appName: string): string {
  return path.join(workdir, '.claude', 'skills', appName, 'bin', 'run');
}

function skillsDir(workdir: string): string {
  return path.join(workdir, '.claude', 'skills');
}

function appSourceDir(workdir: string, appName: string): string {
  return path.join(workdir, '.claude', 'skills', appName);
}

function hasPythonFiles(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
    return entries.some(
      (entry) => entry.isFile() && entry.name.endsWith('.py'),
    );
  } catch {
    return false;
  }
}

// --- Public API ---

/**
 * Check if an app has a CLI entry point.
 * Returns true when `{workdir}/.claude/skills/{appName}/bin/run` exists and is executable.
 */
export function hasCliEntry(workdir: string, appName: string): boolean {
  const cliPath = cliEntryPath(workdir, appName);
  try {
    fs.accessSync(cliPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all installed apps that have a CLI entry point.
 * Scans `{workdir}/.claude/skills/` for subdirectories containing `bin/run`.
 */
export function listCliApps(workdir: string): string[] {
  const sd = skillsDir(workdir);
  if (!fs.existsSync(sd)) return [];

  const apps: string[] = [];
  try {
    const entries = fs.readdirSync(sd, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (hasCliEntry(workdir, entry.name)) {
        apps.push(entry.name);
      }
    }
  } catch {
    // Directory not readable
  }

  return apps;
}

/**
 * Detect the language/framework of an installed app.
 *
 * Detection order:
 * 1. `package.json` present → 'typescript' (Node/TS ecosystem)
 * 2. `requirements.txt` or `*.py` files → 'python'
 * 3. `bin/run` exists (without Python or package.json signals) → 'shell'
 * 4. None of the above → 'unknown'
 */
export function detectAppLanguage(
  workdir: string,
  appName: string,
): AppLanguage {
  const appDir = appSourceDir(workdir, appName);
  if (!fs.existsSync(appDir)) return 'unknown';

  if (fs.existsSync(path.join(appDir, 'package.json'))) {
    return 'typescript';
  }

  if (
    fs.existsSync(path.join(appDir, 'requirements.txt')) ||
    hasPythonFiles(appDir)
  ) {
    return 'python';
  }

  if (hasCliEntry(workdir, appName)) {
    return 'shell';
  }

  return 'unknown';
}

/**
 * Run an app's CLI entry point.
 *
 * Looks for `{workdir}/.claude/skills/{appName}/bin/run` and executes it
 * with the provided args. If the CLI entry does not exist, returns an
 * error result with exitCode 1.
 *
 * Uses `spawn` (not `exec` or `spawn` with shell) to avoid shell injection.
 * The `input` option is written to the child process's stdin.
 */
export function runAppCli(options: AppRunOptions): Promise<AppRunResult> {
  const { appName, workdir, args, input, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const cliPath = cliEntryPath(workdir, appName);
  if (!hasCliEntry(workdir, appName)) {
    return Promise.resolve({
      output: `No CLI entry point found for app "${appName}". Expected: ${cliPath}`,
      exitCode: 1,
      durationMs: 0,
    });
  }

  return new Promise<AppRunResult>((resolve) => {
    const start = process.hrtime.bigint();
    let timedOut = false;
    let settled = false;

    let bufferTotal = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child = spawn(cliPath, args, {
      cwd: workdir,
      env: sanitizeEnv(process.env as Record<string, string>),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const settle = (result: AppRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      // Give a small grace period for the close event; if it doesn't fire, resolve here
      setTimeout(() => {
        if (!settled) {
          const end = process.hrtime.bigint();
          settle({
            output: `CLI timed out after ${timeoutMs}ms`,
            exitCode: 124,
            durationMs: Number(end - start) / 1_000_000,
          });
        }
      }, 100);
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      bufferTotal += chunk.length;
      if (bufferTotal <= MAX_BUFFER) {
        stdoutChunks.push(chunk);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      bufferTotal += chunk.length;
      if (bufferTotal <= MAX_BUFFER) {
        stderrChunks.push(chunk);
      }
    });

    // Pipe input to stdin if provided
    if (input) {
      child.stdin.write(input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    child.on('close', (code) => {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;

      if (timedOut) {
        settle({
          output: `CLI timed out after ${timeoutMs}ms`,
          exitCode: 124,
          durationMs,
        });
        return;
      }

      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');

      settle({
        output,
        exitCode: code ?? 1,
        durationMs,
      });
    });

    child.on('error', (err) => {
      const end = process.hrtime.bigint();
      settle({
        output: `CLI execution failed: ${err.message}`,
        exitCode: 1,
        durationMs: Number(end - start) / 1_000_000,
      });
    });
  });
}
