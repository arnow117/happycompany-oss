import { DynamicHandoffOrchestrator, type OrchestrationEvent } from './handoff-engine.js';
import { OrchestrationConfig } from './config.js';
import { EmployeeManager } from './employee-colony.js';
import { ContractStore } from './contract-store.js';
import { ContractChainTracker } from './contract-chain.js';
import type { MessageBus } from '../bus.js';
import { logger } from '../logger.js';
import type { OrchestratorRunner, OrchestrationRunResult } from '../scheduler.js';
import type { TraceStore } from './trace-store.js';
import type { AgentMeta } from './director-router.js';
import { routeHandoff } from './director-router.js';

export interface OrchestratorRunnerDeps {
  employeeManager: EmployeeManager;
  chainTracker: ContractChainTracker;
  bus: MessageBus;
  contractStore: ContractStore;
  traceStore?: TraceStore;
  directorEnabled?: boolean;
  directorApiKey?: string;
  directorBaseUrl?: string;
  directorModel?: string;
  defaultMaxHandoffs?: number;
  defaultMaxIterations?: number;
  maxStackDepth?: number;
}

export interface OrchestratorRunOptions {
  preRoute?: boolean;
  chatId?: string;
  onHandoff?: (info: { from: string; to: string; reason?: string }) => void;
  onToolStart?: (info: { toolName: string; toolUseId: string }) => void;
  onToolEnd?: (info: { toolName: string; toolUseId: string; elapsedMs: number }) => void;
}

/**
 * Bridges the TaskScheduler / agentFactory to the DynamicHandoffOrchestrator.
 *
 * Each agent is a "digital employee". The runner collects all registered agents
 * from the colony, builds their shared allowedTargets list, and runs the
 * orchestrator handoff loop until the entry agent signals done.
 */
export class PMOOrchestratorRunner implements OrchestratorRunner {
  private readonly defaultMaxHandoffs: number;
  private readonly defaultMaxIterations: number;
  private readonly defaultMaxStackDepth: number;

  constructor(private readonly deps: OrchestratorRunnerDeps) {
    this.defaultMaxHandoffs = deps.defaultMaxHandoffs ?? 10;
    this.defaultMaxIterations = deps.defaultMaxIterations ?? 50;
    this.defaultMaxStackDepth = deps.maxStackDepth ?? 5;
  }

  /** For scheduler use — returns structured result. */
  async run(prompt: string, entryAgent: string, options: OrchestratorRunOptions = {}): Promise<OrchestrationRunResult> {
    const protocols = this.deps.employeeManager.getProtocols();
    const allowedTargets = protocols.map((p) => p.name);
    const agentMetas = this.getAgentMetas();
    const entryMeta = agentMetas.find((meta) => meta.id === entryAgent);
    const entryTargets = this.getAllowedTargets(entryAgent, allowedTargets);
    const shouldPreRoute = options.preRoute !== false && !!entryMeta && entryTargets.length > 0;

    if (shouldPreRoute) {
      const routed = await this.runPreRouted(prompt, entryAgent, entryTargets, agentMetas, options);
      if (routed) return routed;
    }

    const config = new OrchestrationConfig({
      maxHandoffs: this.defaultMaxHandoffs,
      maxIterations: this.defaultMaxIterations,
      maxStackDepth: this.defaultMaxStackDepth,
      directorEnabled: this.deps.directorEnabled,
      directorApiKey: this.deps.directorApiKey,
      directorBaseUrl: this.deps.directorBaseUrl,
      directorModel: this.deps.directorModel,
    });

    const orchestrator = new DynamicHandoffOrchestrator(allowedTargets, config, this.deps.contractStore);
    orchestrator.registerMultiple(protocols);

    // Register rich agent metadata for director routing
    for (const ca of this.deps.employeeManager.getEmployees()) {
      orchestrator.registerAgentMeta({
        id: ca.app.id,
        capabilities: ca.app.capabilities || [],
        role: ca.app.role || '',
        description: ca.app.description || '',
      });
    }

    const onEvent = (ev: OrchestrationEvent) => {
      const chatId = options.chatId;
      switch (ev.type) {
        case 'agent_start':
          this.deps.bus.publish({
            type: 'orchestration_agent_start',
            botName: ev.agentName,
          });
          break;
        case 'handoff':
          options.onHandoff?.({
            from: ev.from,
            to: ev.to,
            reason: ev.reason,
          });
          this.deps.bus.publish({
            type: 'orchestration_handoff',
            handoffFrom: ev.from,
            handoffTo: ev.to,
            text: ev.reason,
          });
          break;
        case 'tool_use_start':
          options.onToolStart?.({ toolName: ev.toolName, toolUseId: ev.toolUseId });
          break;
        case 'tool_use_end':
          options.onToolEnd?.({ toolName: ev.toolName, toolUseId: ev.toolUseId, elapsedMs: ev.elapsedMs });
          break;
        case 'cue_user':
          this.deps.bus.publish({
            type: 'orchestration_cue_user',
            text: ev.prompt,
          });
          break;
        case 'done':
          this.deps.bus.publish({
            type: 'orchestration_done',
            text: ev.success ? ev.summary : undefined,
            meta: ev.success ? undefined : { error: ev.summary },
          });
          break;
        // Contract lifecycle events
        case 'contract_created':
          this.deps.bus.publish({
            type: 'contract_created',
            contractId: ev.contractId,
            parentId: ev.parentId ?? undefined,
            fromAgent: ev.fromAgent,
            toAgent: ev.toAgent ?? undefined,
            task: ev.task,
          });
          break;
        case 'contract_assigned':
          this.deps.bus.publish({
            type: 'contract_assigned',
            contractId: ev.contractId,
            toAgent: ev.agentId,
            routingMethod: ev.method,
            decisionReason: ev.reason,
          });
          break;
        case 'contract_active':
          this.deps.bus.publish({
            type: 'contract_active',
            contractId: ev.contractId,
          });
          break;
        case 'contract_completed':
          this.deps.bus.publish({
            type: 'contract_completed',
            botName: entryAgent,
            chatId,
            contractId: ev.contractId,
            parentId: ev.parentId ?? undefined,
            toAgent: ev.toAgent ?? undefined,
            result: ev.result ?? undefined,
          });
          if (chatId && ev.parentId && ev.toAgent) {
            this.deps.bus.publish({
              type: 'stream_event',
              botName: entryAgent,
              chatId,
              event: {
                eventType: 'handoff_result',
                handoffTo: ev.toAgent,
                handoffStatus: 'completed',
                handoffResult: ev.result ?? undefined,
                contractId: ev.contractId,
                parentContractId: ev.parentId,
              },
            });
          }
          break;
        case 'contract_failed':
          this.deps.bus.publish({
            type: 'contract_failed',
            botName: entryAgent,
            chatId,
            contractId: ev.contractId,
            parentId: ev.parentId ?? undefined,
            toAgent: ev.toAgent ?? undefined,
            result: ev.reason,
          });
          if (chatId && ev.parentId && ev.toAgent) {
            this.deps.bus.publish({
              type: 'stream_event',
              botName: entryAgent,
              chatId,
              event: {
                eventType: 'handoff_result',
                handoffTo: ev.toAgent,
                handoffStatus: 'failed',
                handoffResult: ev.reason,
                contractId: ev.contractId,
                parentContractId: ev.parentId,
              },
            });
          }
          break;
        case 'director_decision':
          this.deps.bus.publish({
            type: 'director_decision',
            contractId: ev.contractId,
            routingMethod: ev.routingMethod,
            decisionReason: ev.decisionReason,
            candidates: ev.candidates,
          });
          break;
      }
    };

    const result = await orchestrator.run(entryAgent, prompt, {
      chatId: options.chatId ?? `__orchestrated__:${Date.now()}`,
    }, onEvent);

    // Record chain events for audit
    const contractId = `orchestration:${Date.now()}`;
    for (const step of result.history.steps) {
      this.deps.chainTracker.recordEvent({
        contractId,
        agentId: step.from,
        action: 'handoff',
        targetAgent: step.to,
        detail: '',
      });
    }

    // Save orchestration trace for visualization
    if (this.deps.traceStore) {
      this.deps.traceStore.save({
        id: contractId,
        entryAgent,
        prompt,
        success: result.success,
        summary: result.finalResponse?.text ?? '',
        route: result.history.route,
        handoffCount: result.stats.handoffCount,
        iterationCount: result.stats.iterationCount,
        steps: result.history.steps.map((s) => ({
          from: s.from,
          to: s.to,
          action: 'handoff',
          timestamp: s.timestamp,
          task: s.task,
          payload: s.payload,
        })),
        startedAt: Date.now(),
        finishedAt: Date.now(),
      });
    }

    logger.info(
      {
        entryAgent,
        success: result.success,
        route: result.history.route,
        handoffCount: result.stats.handoffCount,
      },
      'Orchestration run complete',
    );

    return {
      success: result.success,
      summary: result.finalResponse?.text ?? '',
      history: {
        route: result.history.route,
        handoffCount: result.stats.handoffCount,
        iterationCount: result.stats.iterationCount,
      },
    };
  }

  /** For chat use — compatible with AgentFactory.respond signature. */
  async respond(prompt: string, chatId: string, entryAgent: string, options: OrchestratorRunOptions = {}): Promise<string> {
    const result = await this.run(prompt, entryAgent, { ...options, chatId });
    return result.summary;
  }

  private getAgentMetas(): AgentMeta[] {
    return this.deps.employeeManager.getEmployees()
      .map((employee) => ({
        id: employee.app.id,
        capabilities: employee.app.capabilities || [],
        role: employee.app.role || '',
        description: employee.app.description || '',
      }));
  }

  private getAllowedTargets(entryAgent: string, allAgents: string[]): string[] {
    const entry = this.deps.employeeManager.get(entryAgent);
    const targets = entry?.app.allowedTargets ?? [];
    return targets.filter((target) => target !== entryAgent && allAgents.includes(target));
  }

  private async runPreRouted(
    prompt: string,
    entryAgent: string,
    entryTargets: string[],
    allMetas: AgentMeta[],
    options: OrchestratorRunOptions,
  ): Promise<OrchestrationRunResult | null> {
    const candidates = allMetas.filter((meta) => entryTargets.includes(meta.id));
    if (candidates.length === 0) return null;

    const decision = await routeHandoff(prompt, candidates, {
      apiKey: this.deps.directorApiKey ?? '',
      baseUrl: this.deps.directorBaseUrl,
      model: this.deps.directorModel,
      enabled: this.deps.directorEnabled ?? false,
    });
    if (!decision.agentId) return null;

    const target = this.deps.employeeManager.get(decision.agentId);
    const targetProtocol = target?.protocol;
    if (!targetProtocol) return null;

    const targetName = target.app.displayName || target.app.id;
    const task = prompt;
    const reason = `${targetName}职责: ${[
      target.app.role,
      ...(target.app.capabilities || []),
    ].filter(Boolean).join('、')}；${decision.reason}`;

    options.onHandoff?.({
      from: entryAgent,
      to: decision.agentId,
      reason,
    });

    this.deps.bus.publish({
      type: 'orchestration_handoff',
      handoffFrom: entryAgent,
      handoffTo: decision.agentId,
      text: reason,
    });

    const response = await targetProtocol.execute(task, {
      chatId: `__orchestrated__:${Date.now()}`,
      routedBy: entryAgent,
      routingReason: reason,
    }, (e) => {
      if (e.phase === 'start') options.onToolStart?.({ toolName: e.toolName, toolUseId: e.toolUseId });
      else options.onToolEnd?.({ toolName: e.toolName, toolUseId: e.toolUseId, elapsedMs: e.elapsedMs ?? 0 });
    });

    const contractId = `orchestration:${Date.now()}`;
    this.deps.chainTracker.recordEvent({
      contractId,
      agentId: entryAgent,
      action: 'auto_route',
      targetAgent: decision.agentId,
      detail: reason,
    });

    const route = [`${entryAgent}->${decision.agentId}`];
    if (this.deps.traceStore) {
      this.deps.traceStore.save({
        id: contractId,
        entryAgent,
        prompt,
        success: true,
        summary: response.text,
        route,
        handoffCount: 1,
        iterationCount: 1,
        steps: [{
          from: entryAgent,
          to: decision.agentId,
          action: 'auto_route',
          task,
          reason,
          timestamp: Date.now(),
        }],
        startedAt: Date.now(),
        finishedAt: Date.now(),
      });
    }

    logger.info(
      { entryAgent, targetAgent: decision.agentId, routingMethod: decision.method },
      'Dispatcher pre-routed orchestration task',
    );

    return {
      success: true,
      summary: response.text,
      history: {
        route,
        handoffCount: 1,
        iterationCount: 1,
      },
    };
  }
}
