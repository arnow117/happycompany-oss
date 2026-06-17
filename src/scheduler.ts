import { CronExpressionParser } from 'cron-parser';
import { logger } from './logger.js';

/* ── Types ─────────────────────────────────────────────────── */

export type ScheduleType = 'cron' | 'interval' | 'once' | 'event';

export interface ScheduledTask {
  id: string;
  name: string;
  botName: string;
  scheduleType: ScheduleType;
  scheduleValue: string; // cron expr / ISO 8601 duration / ISO datetime
  prompt: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  runCount: number;
  /** Agent ID to route orchestrated tasks to. Defaults to botName if unset. */
  entryAgent?: string;
}

export interface CreateTaskInput {
  name: string;
  botName: string;
  scheduleType: ScheduleType;
  scheduleValue: string;
  prompt: string;
  enabled?: boolean;
  /** Route task through the orchestrator using this agent as entry point. */
  entryAgent?: string;
}

/* ── Duration parser (ISO 8601) ─────────────────────────────── */

export function parseDuration(iso: string): number | null {
  const match = iso.match(
    /^P(?:(\d+(?:\.\d+)?)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/,
  );
  if (!match) return null;
  const days = parseFloat(match[1] ?? '0') * 86400000;
  const hours = parseFloat(match[2] ?? '0') * 3600000;
  const minutes = parseFloat(match[3] ?? '0') * 60000;
  const seconds = parseFloat(match[4] ?? '0') * 1000;
  return days + hours + minutes + seconds;
}

/* ── Next-run computation (standalone, no class dependency) ── */

export function computeNextRun(
  scheduleType: ScheduleType,
  scheduleValue: string,
  lastRunAt: number | null,
  after: number,
): number | null {
  if (scheduleType === 'event') {
    return null; // Event-driven: not scheduled by time
  }

  if (scheduleType === 'once') {
    return null;
  }

  if (scheduleType === 'cron') {
    try {
      const interval = CronExpressionParser.parse(scheduleValue);
      const next = interval.next().getTime();
      return next > after ? next : interval.next().getTime();
    } catch {
      return null;
    }
  }

  if (scheduleType === 'interval') {
    const ms = parseDuration(scheduleValue);
    if (ms === null) return null;
    const base = lastRunAt ?? after;
    let next = base + ms;
    while (next <= after) next += ms;
    return next;
  }

  return null;
}

/** Compute nextRunAt for a newly created task. */
export function computeInitialNextRun(task: CreateTaskInput): number | null {
  if (task.scheduleType === 'once') {
    const ts = new Date(task.scheduleValue).getTime();
    return isNaN(ts) ? null : ts;
  }
  return computeNextRun(task.scheduleType, task.scheduleValue, null, Date.now());
}

/* ── Store interface (adapter pattern, no circular deps) ───── */

export interface TaskStore {
  createTask(task: CreateTaskInput): ScheduledTask;
  listTasks(): ScheduledTask[];
  getTask(id: string): ScheduledTask | null;
  updateTask(id: string, patch: Partial<ScheduledTask>): ScheduledTask | null;
  deleteTask(id: string): boolean;
}

export interface AgentRespond {
  respond(prompt: string, chatId: string, botName: string): Promise<string>;
}

export interface OrchestrationRunResult {
  success: boolean;
  summary: string;
  history: {
    route: string[];
    handoffCount: number;
    iterationCount: number;
  };
}

export interface OrchestratorRunner {
  run(prompt: string, entryAgent: string): Promise<OrchestrationRunResult>;
  respond(prompt: string, chatId: string, entryAgent: string, options?: { preRoute?: boolean }): Promise<string>;
}

/* ── TaskScheduler ─────────────────────────────────────────── */

export class TaskScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly store: TaskStore,
    private readonly agent: AgentRespond,
    private readonly orchestrator?: OrchestratorRunner,
    pollIntervalMs = 60_000,
  ) {
    this.pollIntervalMs = pollIntervalMs;
  }

  start(): void {
    if (this.timer) return;
    this.reconcileMissedRuns();
    this.timer = setInterval(() => this.tick(), this.pollIntervalMs);
    // Don't hold the process open
    if (this.timer.unref) this.timer.unref();
    logger.info('Task scheduler started (poll every %dms)', this.pollIntervalMs);
  }

  /**
   * On startup, skip missed recurring runs forward instead of replaying them.
   * Without this, every overdue cron/interval task fires at once on the first
   * tick (a startup "thundering herd" of model calls). One-shot (`once`) tasks
   * are left untouched so a job scheduled during downtime still runs once.
   */
  private reconcileMissedRuns(): void {
    const now = Date.now();
    let skipped = 0;
    for (const task of this.store.listTasks()) {
      if (!task.enabled || task.nextRunAt === null || task.nextRunAt > now) continue;
      if (task.scheduleType !== 'cron' && task.scheduleType !== 'interval') continue;
      const next = computeNextRun(task.scheduleType, task.scheduleValue, now, now);
      this.store.updateTask(task.id, { nextRunAt: next });
      skipped += 1;
    }
    if (skipped > 0) {
      logger.info({ skipped }, 'Scheduler skipped missed recurring runs forward on startup');
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('Task scheduler stopped');
  }

  /** Expose store operations for MCP tools. */
  listTasks(): ScheduledTask[] {
    return this.store.listTasks();
  }

  createTask(input: CreateTaskInput): ScheduledTask {
    const task = this.store.createTask(input);
    logger.info({ taskId: task.id, name: task.name }, 'Task created via MCP tool');
    return task;
  }

  deleteTask(id: string): boolean {
    return this.store.deleteTask(id);
  }

  async triggerTask(taskId: string): Promise<{ success: boolean; error?: string }> {
    const task = this.store.getTask(taskId);
    if (!task) return { success: false, error: 'Task not found' };
    await this.executeTask(task);
    return { success: true };
  }

  private async tick(): Promise<void> {
    const tasks = this.store.listTasks();
    const now = Date.now();
    for (const task of tasks) {
      if (!task.enabled || task.nextRunAt === null || task.nextRunAt > now) continue;
      // Fire-and-forget: don't block other tasks on one failure
      this.executeTask(task).catch((err) => {
        logger.error({ taskId: task.id, err }, 'Scheduled task execution failed');
      });
    }
  }

  private async executeTask(task: ScheduledTask): Promise<void> {
    logger.info(
      { taskId: task.id, name: task.name, botName: task.botName, entryAgent: task.entryAgent },
      'Executing scheduled task',
    );
    try {
      if (task.entryAgent && this.orchestrator) {
        const result = await this.orchestrator.run(task.prompt, task.entryAgent);
        logger.info(
          { taskId: task.id, success: result.success, route: result.history.route },
          'Orchestrated task completed',
        );
      } else {
        await this.agent.respond(task.prompt, `__scheduled__:${task.id}`, task.botName);
      }

      const now = Date.now();
      const nextRun = computeNextRun(task.scheduleType, task.scheduleValue, now, now);
      this.store.updateTask(task.id, {
        lastRunAt: now,
        nextRunAt: nextRun,
        runCount: task.runCount + 1,
        enabled: task.scheduleType === 'once' ? false : task.enabled,
      });
    } catch (err) {
      logger.error({ taskId: task.id, err }, 'Scheduled task execution failed');
    }
  }
}
