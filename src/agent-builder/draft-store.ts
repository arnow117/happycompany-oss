import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { agentDraftSchema, type AgentDraft } from './schema.js';

export class AgentDraftStore {
  private readonly draftsDir: string;

  constructor(dataDir: string) {
    this.draftsDir = resolve(dataDir, 'agent-builder', 'drafts');
    mkdirSync(this.draftsDir, { recursive: true });
  }

  list(): AgentDraft[] {
    if (!existsSync(this.draftsDir)) return [];
    return readdirSync(this.draftsDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => this.readFile(join(this.draftsDir, file)))
      .filter((draft): draft is AgentDraft => draft !== null);
  }

  get(id: string): AgentDraft | null {
    const file = this.pathFor(id);
    if (!existsSync(file)) return null;
    return this.readFile(file);
  }

  save(draft: AgentDraft): AgentDraft {
    const parsed = agentDraftSchema.parse(draft);
    const file = this.pathFor(parsed.id);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
    renameSync(tmp, file);
    return parsed;
  }

  private readFile(file: string): AgentDraft | null {
    try {
      return agentDraftSchema.parse(JSON.parse(readFileSync(file, 'utf-8')) as unknown);
    } catch {
      return null;
    }
  }

  private pathFor(id: string): string {
    const safe = id.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return join(this.draftsDir, `${safe}.json`);
  }
}
