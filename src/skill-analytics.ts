import fs from 'node:fs';
import path from 'node:path';

export interface SkillCallRecord {
  botName: string;
  skillName: string;
  chatId: string;
  timestamp: number;
  success: boolean;
  durationMs: number;
}

interface AnalyticsData {
  calls: SkillCallRecord[];
}

const PENDING = new Map<string, { toolName: string; startTime: number }>();

function dataPath(dataDir: string): string {
  return path.join(dataDir, 'skill-analytics.json');
}

function loadData(dataDir: string): AnalyticsData {
  const p = dataPath(dataDir);
  if (!fs.existsSync(p)) return { calls: [] };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as AnalyticsData;
  } catch {
    return { calls: [] };
  }
}

function saveData(dataDir: string, data: AnalyticsData): void {
  fs.writeFileSync(dataPath(dataDir), JSON.stringify(data, null, 2), 'utf-8');
}

export function recordToolStart(botName: string, chatId: string, toolName: string): void {
  PENDING.set(`${toolName}:${chatId}`, { toolName, startTime: Date.now() });
}

export function recordToolEnd(botName: string, chatId: string, toolName: string, elapsedMs: number): void {
  const key = `${toolName}:${chatId}`;
  const pending = PENDING.get(key);
  PENDING.delete(key);

  const startTime = pending?.startTime ?? Date.now() - elapsedMs;
  const record: SkillCallRecord = {
    botName,
    skillName: toolName,
    chatId,
    timestamp: startTime,
    success: true,
    durationMs: elapsedMs,
  };

  // Buffer in-memory, flush periodically
  callBuffer.push(record);
  if (callBuffer.length >= FLUSH_THRESHOLD) {
    flushBuffer();
  }
}

const callBuffer: SkillCallRecord[] = [];
const FLUSH_THRESHOLD = 10;
let currentDataDir = 'data';

export function initAnalytics(dataDir: string): void {
  currentDataDir = dataDir;
}

export function flushBuffer(): void {
  if (callBuffer.length === 0) return;
  const data = loadData(currentDataDir);
  data.calls.push(...callBuffer);
  // Keep last 1000 records
  if (data.calls.length > 1000) {
    data.calls = data.calls.slice(-1000);
  }
  saveData(currentDataDir, data);
  callBuffer.length = 0;
}

export interface SkillStats {
  skillName: string;
  callCount: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
  lastCalledAt: number | null;
}

export function getSkillStats(dataDir: string): SkillStats[] {
  flushBuffer();
  const data = loadData(dataDir);
  const map = new Map<string, { calls: number; successes: number; failures: number; totalDuration: number; lastAt: number }>();

  for (const call of data.calls) {
    const existing = map.get(call.skillName) ?? { calls: 0, successes: 0, failures: 0, totalDuration: 0, lastAt: 0 };
    existing.calls++;
    if (call.success) existing.successes++;
    else existing.failures++;
    existing.totalDuration += call.durationMs;
    if (call.timestamp > existing.lastAt) existing.lastAt = call.timestamp;
    map.set(call.skillName, existing);
  }

  return Array.from(map.entries())
    .map(([skillName, s]) => ({
      skillName,
      callCount: s.calls,
      successCount: s.successes,
      failureCount: s.failures,
      avgDurationMs: s.calls > 0 ? Math.round(s.totalDuration / s.calls) : 0,
      lastCalledAt: s.lastAt > 0 ? s.lastAt : null,
    }))
    .sort((a, b) => b.callCount - a.callCount);
}
