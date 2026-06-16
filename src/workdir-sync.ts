import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WorkdirScanner } from './workdir-scanner.js';
import type { ScanResult } from './workdir-scanner.js';

// --- Types ---

export interface SyncResult {
  added: string[];
  removed: string[];
  changed: string[];
  scanResult: ScanResult;
}

interface SyncState {
  [skillName: string]: string;
}

// --- WorkdirSyncService ---

export class WorkdirSyncService {
  private readonly stateFile: string;

  constructor(
    private readonly scanner: WorkdirScanner,
    syncDir: string,
  ) {
    this.stateFile = path.join(syncDir, 'workdir-sync.json');
  }

  sync(workdir: string): SyncResult {
    const scanResult = this.scanner.scan(workdir);
    const previousState = this.loadState();
    const currentState: SyncState = {};

    for (const skill of scanResult.skills) {
      const skillMdPath = path.join(skill.path, 'SKILL.md');
      currentState[skill.name] = this.hashFile(skillMdPath);
    }

    const added: string[] = [];
    const changed: string[] = [];
    const removed: string[] = [];

    for (const [name, hash] of Object.entries(currentState)) {
      if (!previousState[name]) {
        added.push(name);
      } else if (previousState[name] !== hash) {
        changed.push(name);
      }
    }

    for (const name of Object.keys(previousState)) {
      if (!currentState[name]) {
        removed.push(name);
      }
    }

    this.saveState(currentState);

    return { added, removed, changed, scanResult };
  }

  private hashFile(filePath: string): string {
    const content = fs.readFileSync(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private loadState(): SyncState {
    if (!fs.existsSync(this.stateFile)) return {};
    return JSON.parse(fs.readFileSync(this.stateFile, 'utf-8')) as SyncState;
  }

  private saveState(state: SyncState): void {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
  }
}
