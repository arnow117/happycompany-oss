import type { NormalizedMessage, BotConfig } from './types.js';

export interface BotInfo {
  name: string;
  displayName: string;
  status: 'running' | 'stopped';
  channel: string;
  workdir: string;
  model: string;
  tenant?: string;
  routingMode?: 'direct' | 'employee-director';
}

import type { ChannelAdapter } from './channel.js';
import type { MessageBus } from './bus.js';
import type { MessageStore } from './store.js';
import type { DedupCache } from './dedup.js';
import { logger } from './logger.js';
import { recordToolStart, recordToolEnd } from './skill-analytics.js';
import { createCommandHandler } from './commands.js';
import type { BotInfo as CommandBotInfo } from './command-utils.js';
import { MessageIngressRuntime } from './ingress/runtime.js';
import type { IngressMessageInput } from './ingress/types.js';
import { RuntimeResolveError, RuntimeResolver, type RuntimeEmployeeDirectory } from './runtime-resolver.js';
import type {
  AgentObservabilityInit,
  AgentObservabilitySummary,
  AgentObservabilityUsage,
} from './agent-observability.js';

interface BotInstance {
  name: string;
  config: BotConfig;
  channel: ChannelAdapter;
}

export interface AgentFactory {
  respond(
    prompt: string,
    chatId: string,
    botName: string,
    opts?: RespondOptions,
  ): Promise<string>;
  clearSession(chatId: string, botName: string, userId?: string): boolean;
  clearAllSessions(botName: string): number;
  listSessions(botName: string): string[];
}

export interface RespondOptions {
  onText?: (text: string) => void;
  onToolStart?: (info: { toolName: string; toolUseId: string; toolInput?: Record<string, unknown> }) => void;
  onToolEnd?: (info: { toolName: string; toolUseId: string; elapsedMs: number }) => void;
  onInit?: (info: AgentObservabilityInit) => void;
  onUsage?: (info: AgentObservabilityUsage) => void;
  onResultSummary?: (info: AgentObservabilitySummary) => void;
  abortController?: AbortController;
  timeoutMs?: number;
  /** Per-call agent management dir for draft/runtime overlays. */
  runtimeAgentDir?: string;
  /** Per-call Claude SDK cwd for draft/runtime overlays. Defaults to runtimeAgentDir. */
  runtimeCwd?: string;
  /** Optional user ID for per-user session isolation within the same chat. */
  userId?: string;
  /** Optional tenant scope for resolving duplicate employee IDs across tenants. */
  tenant?: string;
  /**
   * Ingress trace hooks. Optional — the agent factory emits routing / handoff /
   * memory events here so the MessageIngressRuntime's TraceRecorder can capture
   * them. Production code uses these for structured assertion in the harness;
   * unrelated callers can leave them undefined.
   */
  onRoutingDecision?: (info: {
    mode?: string;
    selectedEmployee?: string;
    boundEmployee?: string;
    selectorShown?: boolean;
  }) => void;
  onHandoff?: (info: { from: string; to: string; reason?: string }) => void;
  onMemoryOp?: (info: {
    operation: 'append' | 'search' | 'read' | 'write';
    subject: string;
    workspace?: string;
    status?: 'ok' | 'error';
  }) => void;
  onBusinessArtifact?: (info: {
    type: string;
    id?: string;
    status?: 'created' | 'updated' | 'triggered';
  }) => void;
  /**
   * Controls whether an explicitly selected employee may enter the multi-agent
   * handoff loop. Harness StepRun uses disabled to test one workflow step
   * without keyword routing jumping to the next employee.
   */
  handoffMode?: 'auto' | 'disabled';
}

interface BotManagerDeps {
  config: { bots: Record<string, BotConfig> };
  agentFactory: AgentFactory;
  bus: MessageBus;
  store: MessageStore;
  dedup: DedupCache;
  corpDir?: string;
  employeeManager?: RuntimeEmployeeDirectory;
}

/** Check if a message is a group chat (non-DM). */
function isGroupChat(chatId: string): boolean {
  if (chatId.startsWith('dingtalk:group:') || chatId.startsWith('cid')) return true;
  if (chatId.startsWith('dingtalk:c2c:')) return false;
  // Feishu chat IDs: oc_ prefix = group, ou_ prefix = user DM
  if (chatId.startsWith('oc_')) return true;
  // Default: treat unknown as DM (respond to everything)
  return false;
}

/**
 * Simple 1:1 bot manager. Each bot = one channel + one agent.
 * No fan-out, no topology DAG, no anti-recursion -- just direct routing.
 * This is the key simplification vs bot-swarm's swarm.ts (800+ lines).
 */
export class BotManager {
  private bots = new Map<string, BotInstance>();
  private chatLocks = new Map<string, Promise<void>>();
  private readonly runtime: MessageIngressRuntime;
  private commandHandler = createCommandHandler(
    (): CommandBotInfo[] => {
      const result: CommandBotInfo[] = [];
      for (const [name, instance] of this.bots) {
        result.push({
          name,
          displayName: instance.config.displayName,
          channel: instance.config.channel,
          sessionCount: 0,
        });
      }
      return result;
    },
    (botName: string, chatId: string) => {
      this.deps.agentFactory.clearSession(chatId, botName);
      return true;
    },
    (chatId: string, limit: number) => {
      return this.deps.store.getMessagesForChat(chatId, limit);
    },
  );

  constructor(private deps: BotManagerDeps) {
    this.runtime = new MessageIngressRuntime({
      agentFactory: deps.agentFactory,
      store: deps.store,
      bus: deps.bus,
    });
  }

  async addBot(name: string, channel: ChannelAdapter): Promise<void> {
    const config = this.deps.config.bots[name];
    if (!config) throw new Error(`No config for bot "${name}"`);

    const instance: BotInstance = { name, config, channel };
    this.bots.set(name, instance);

    channel.onMessage((msg) => {
      const chatKey = `${name}:${msg.chatId}`;
      const prev = this.chatLocks.get(chatKey) ?? Promise.resolve();
      let resolve: () => void;
      const next = new Promise<void>((r) => { resolve = r; });
      this.chatLocks.set(chatKey, next);
      return prev.then(async () => {
        try {
          await this.handleMessage(instance, msg);
        } finally {
          resolve!();
        }
      });
    });
    await channel.start();
    this.deps.bus.publish({ type: 'bot_connected', botName: name });
    logger.info({ bot: name, channel: config.channel }, 'Bot added (hot reload)');
  }

  async removeBot(name: string): Promise<void> {
    const instance = this.bots.get(name);
    if (!instance) return;
    try {
      await instance.channel.stop();
    } catch (err) {
      logger.warn({ err, bot: name }, 'Error stopping channel during hot reload');
    }
    this.bots.delete(name);
    this.deps.bus.publish({ type: 'bot_disconnected', botName: name });
    logger.info({ bot: name }, 'Bot removed (hot reload)');
  }

  updateBotConfig(bots: Record<string, BotConfig>): void {
    this.deps.config = { bots };
  }

  async start(channels: Record<string, ChannelAdapter>): Promise<void> {
    for (const [name, config] of Object.entries(this.deps.config.bots)) {
      const channel = channels[name];
      if (!channel) throw new Error(`No channel for bot "${name}"`);

      const instance: BotInstance = { name, config, channel };
      this.bots.set(name, instance);

      channel.onMessage((msg) => {
        const chatKey = `${name}:${msg.chatId}`;
        const prev = this.chatLocks.get(chatKey) ?? Promise.resolve();
        let resolve: () => void;
        const next = new Promise<void>((r) => { resolve = r; });
        this.chatLocks.set(chatKey, next);
        return prev.then(async () => {
          try {
            await this.handleMessage(instance, msg);
          } finally {
            resolve!();
          }
        });
      });
      await channel.start();

      this.deps.bus.publish({ type: 'bot_connected', botName: name });
      logger.info({ bot: name, channel: config.channel }, 'Bot started');
    }
  }

  async stop(): Promise<void> {
    for (const [name, instance] of this.bots) {
      try {
        await instance.channel.stop();
      } catch (err) {
        logger.warn({ err, bot: name }, 'Bot stop error');
      }
      this.deps.bus.publish({ type: 'bot_disconnected', botName: name });
    }
    this.bots.clear();
  }

  listBots(): string[] {
    return [...this.bots.keys()];
  }

  isBotRunning(name: string): boolean {
    return this.bots.has(name);
  }

  getBotConfig(name: string): BotConfig | undefined {
    return this.deps.config.bots[name];
  }

  getBotInfos(): BotInfo[] {
    return Object.entries(this.deps.config.bots)
      .filter(([, cfg]) => !cfg.hidden)
      .map(([name, cfg]) => ({
        name,
        displayName: cfg.displayName || name,
        status: this.bots.has(name) ? 'running' as const : 'stopped' as const,
        channel: cfg.channel,
        workdir: cfg.cwd || cfg.agentDir,
        model: cfg.model || 'default',
        tenant: cfg.tenant,
        routingMode: cfg.routingMode,
      }));
  }

  clearBotSessions(botName: string): number {
    return this.deps.agentFactory.clearAllSessions(botName);
  }

  listSessions(botName: string): string[] {
    return this.deps.agentFactory.listSessions(botName);
  }

  clearSessionSingle(botName: string, chatId: string): boolean {
    return this.deps.agentFactory.clearSession(chatId, botName);
  }

  async handleCommand(botName: string, chatId: string, text: string): Promise<string | null> {
    return this.commandHandler(botName, chatId, text);
  }

  /** Clear sessions for all bots whose cwd matches the given workdir. */
  clearSessionsForWorkdir(workdir: string): number {
    let total = 0;
    for (const [name, botConfig] of Object.entries(this.deps.config.bots)) {
      const botWorkdir = botConfig.cwd ?? botConfig.agentDir;
      if (botWorkdir === workdir) {
        total += this.clearBotSessions(name);
      }
    }
    return total;
  }

  private async resolveFiles(
    bot: BotInstance,
    msg: NormalizedMessage,
  ): Promise<NormalizedMessage['files']> {
    const files = msg.files;
    if (!files?.length) return files;

    const resolved = await Promise.all(
      files.map(async (f) => {
        if (f.textContent) return f;
        try {
          const downloaded = await bot.channel.downloadFile({
            messageId: msg.id,
            fileName: f.name,
          });
          return { ...f, textContent: downloaded.textContent, base64: downloaded.base64 };
        } catch (err) {
          logger.warn({ err, bot: bot.name, file: f.name }, 'File download failed');
          return f;
        }
      }),
    );
    return resolved;
  }

  private shouldRespond(bot: BotInstance, msg: NormalizedMessage): boolean {
    if (!isGroupChat(msg.chatId)) return true;
    if (bot.config.groupReplyMode === 'all') return true;

    // In group chat, check if the bot is mentioned
    const mentionPatterns = [
      `@${bot.config.displayName}`,
      `@${bot.name}`,
    ];
    return mentionPatterns.some((p) => msg.text.includes(p));
  }

  private async handleMessage(bot: BotInstance, msg: NormalizedMessage): Promise<void> {
    const dedupKey = `${bot.name}:${msg.id}`;
    logger.info(
      {
        bot: bot.name,
        chatId: msg.chatId,
        messageId: msg.id,
        textLen: msg.text.length,
        routingMode: bot.config.routingMode,
      },
      'BotManager received message',
    );
    if (!this.deps.dedup.claim(dedupKey)) {
      logger.info({ bot: bot.name, messageId: msg.id }, 'BotManager skipped duplicate message');
      return;
    }

    // Slash commands. In employee-director mode, /list and /{employee}
    // belong to the digital employee router, not the global bot command list.
    if (bot.config.routingMode !== 'employee-director') {
      const cmdReply = await this.commandHandler(bot.name, msg.chatId, msg.text);
      if (cmdReply !== null) {
        await bot.channel.send(msg.chatId, cmdReply);
        return;
      }
    }

    const isEmployeeDirectorSlash =
      bot.config.routingMode === 'employee-director' && msg.text.trim().startsWith('/');

    // Group chat: only respond if this bot is @mentioned. Employee-director
    // slash commands are explicit routing commands, so allow them without @.
    if (!isEmployeeDirectorSlash && !this.shouldRespond(bot, msg)) {
      logger.info(
        { bot: bot.name, chatId: msg.chatId, messageId: msg.id },
        'BotManager skipped group message without mention',
      );
      return;
    }

    const reactionEmoji = bot.config.reactionEmoji ?? 'thinking';
    bot.channel.react(msg.id, reactionEmoji).catch((err: unknown) => {
      logger.warn({ err, bot: bot.name, messageId: msg.id }, 'Message reaction failed');
    });

    // Download files that have no textContent yet (e.g. Feishu attachments)
    const files = await this.resolveFiles(bot, msg);

    let runtimeInput: IngressMessageInput = {
      channel: bot.config.channel,
      botName: bot.name,
      tenant: bot.config.tenant,
      userId: msg.fromUserId,
      chatId: msg.chatId,
      messageId: msg.id,
      text: msg.text,
      files,
      receivedAt: msg.receivedAt,
    };
    if (bot.config.tenant && msg.fromUserId && this.deps.corpDir && this.deps.employeeManager) {
      try {
        const profile = new RuntimeResolver({
          corpDir: this.deps.corpDir,
          config: this.deps.config,
          employeeManager: this.deps.employeeManager,
        }).resolve({
          tenant: bot.config.tenant,
          entryId: bot.name,
          actorId: msg.fromUserId,
          chatId: msg.chatId,
          text: msg.text,
        });
        runtimeInput = {
          ...runtimeInput,
          botName: profile.employee.id,
          tenant: profile.tenant,
          entryId: profile.entry.id,
          actorId: profile.actor.actorId,
          sessionId: profile.instance.sdkSessionScope,
          employeeId: profile.employee.id,
          instanceId: profile.instance.instanceId,
          workdir: profile.instance.workdir,
          sdkSessionScope: profile.instance.sdkSessionScope,
          mode: 'single_employee',
          userId: profile.actor.peopleUserId ?? profile.actor.actorId,
        };
      } catch (err) {
        if (err instanceof RuntimeResolveError) {
          logger.warn(
            { bot: bot.name, chatId: msg.chatId, userId: msg.fromUserId, code: err.code },
            'BotManager runtime resolve failed',
          );
          const bindingPrompt = err.code === 'actor_not_found' || err.code === 'binding_required'
            ? '您尚未绑定个人数字员工，请在企业员工页面完成绑定后重试。'
            : `消息入口解析失败：${err.message}`;
          await bot.channel.send(msg.chatId, bindingPrompt);
          return;
        }
        throw err;
      }
    }

    // Channel-specific streaming card; tool status + finalize stay in adapter.
    const handle = bot.channel.sendStreaming(msg.chatId);
    const ac = new AbortController();
    try {
      const { reply } = await this.runtime.handle(
        runtimeInput,
        {
          abortController: ac,
          timeoutMs: 60_000,
          onText: (text) => handle.update(text),
          onToolStart: (info) => {
            recordToolStart(bot.name, msg.chatId, info.toolName);
            handle.updateToolStatus({ ...info, status: 'running' });
          },
          onToolEnd: (info) => {
            recordToolEnd(bot.name, msg.chatId, info.toolName, info.elapsedMs);
            handle.updateToolStatus({
              ...info,
              status: 'complete',
              elapsedMs: info.elapsedMs,
            });
          },
        },
      );
      logger.info(
        { bot: bot.name, chatId: msg.chatId, messageId: msg.id, replyLen: reply.length },
        'BotManager agent reply ready',
      );
      handle.finalize(reply);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err: errMsg, bot: bot.name, chatId: msg.chatId }, 'Agent respond failed');
      handle.finalize('抱歉，处理消息时出现错误，请稍后重试。');
    }
  }
}
