import type { AgentProtocol, AgentResponse } from './types.js';
import { extractHandoffRequest } from './handoff.js';
import { WorkflowContext, AllowedTargets } from './context.js';
import { OrchestrationConfig } from './config.js';
import { ContractStore, type Contract } from './contract-store.js';
import type { AgentMeta } from './director-router.js';
import { routeHandoff } from './director-router.js';
import {
  SecurityError,
  AgentNotFoundError,
  MaxIterationsError,
  LoopDetectionError,
} from './errors.js';

export interface OrchestrationResult {
  success: boolean;
  finalResponse: AgentResponse | null;
  data: Record<string, unknown>;
  history: {
    totalSteps: number;
    route: string[];
    steps: Array<{ from: string; to: string; timestamp: number; task?: string; payload?: Record<string, unknown> }>;
  };
  stats: {
    handoffCount: number;
    iterationCount: number;
  };
}

export type OrchestrationEvent =
  | { type: 'agent_start'; agentName: string }
  | { type: 'handoff'; from: string; to: string; reason?: string }
  | { type: 'cue_user'; prompt?: string }
  | { type: 'tool_use_start'; agentName: string; toolName: string; toolUseId: string }
  | { type: 'tool_use_end'; agentName: string; toolName: string; toolUseId: string; elapsedMs: number }
  | { type: 'done'; success: boolean; summary?: string }
  // Contract lifecycle
  | { type: 'contract_created'; contractId: string; parentId?: string | null; fromAgent: string; toAgent?: string | null; task: string }
  | { type: 'contract_assigned'; contractId: string; agentId: string; method?: string; reason?: string }
  | { type: 'contract_active'; contractId: string }
  | { type: 'contract_completed'; contractId: string; parentId?: string | null; toAgent?: string | null; result?: string | null }
  | { type: 'contract_failed'; contractId: string; parentId?: string | null; toAgent?: string | null; reason?: string }
  | { type: 'director_decision'; contractId: string; routingMethod: string; decisionReason?: string; candidates?: string };

export class DynamicHandoffOrchestrator {
  private readonly agents: Map<string, AgentProtocol> = new Map();
  private readonly agentMetas: Map<string, AgentMeta> = new Map();
  private readonly allowedTargets: AllowedTargets;
  public config: OrchestrationConfig;
  private readonly contractStore: ContractStore | null;

  constructor(
    allowedTargetNames: string[],
    config?: OrchestrationConfig,
    contractStore?: ContractStore,
  ) {
    this.allowedTargets = AllowedTargets.fromList(allowedTargetNames);
    this.config = config ?? new OrchestrationConfig();
    this.contractStore = contractStore ?? null;
  }

  register(agent: AgentProtocol): void {
    this.agents.set(agent.name, agent);
  }

  registerMultiple(agents: AgentProtocol[]): void {
    for (const agent of agents) {
      this.register(agent);
    }
  }

  registerAgentMeta(meta: AgentMeta): void {
    this.agentMetas.set(meta.id, meta);
  }

  isRegistered(name: string): boolean {
    return this.agents.has(name);
  }

  getRegisteredAgents(): string[] {
    return [...this.agents.keys()];
  }

  async run(
    entryAgent: string,
    initialInput: string,
    initialContext?: Record<string, unknown>,
    onEvent?: (event: OrchestrationEvent) => void,
  ): Promise<OrchestrationResult> {
    // Fall back to legacy path when no contract store is configured
    if (!this.contractStore) {
      return this.runLegacy(entryAgent, initialInput, initialContext, onEvent);
    }
    return this.runWithContractTree(entryAgent, initialInput, initialContext, onEvent);
  }

  // ── Legacy path (no ContractStore) ──────────────────────────────

  private async runLegacy(
    entryAgent: string,
    initialInput: string,
    initialContext?: Record<string, unknown>,
    onEvent?: (event: OrchestrationEvent) => void,
  ): Promise<OrchestrationResult> {
    if (!this.allowedTargets.isAllowed(entryAgent)) {
      throw new SecurityError(`Entry agent "${entryAgent}" is not authorized`);
    }

    const entryAgentInstance = this.agents.get(entryAgent);
    if (!entryAgentInstance) {
      throw new AgentNotFoundError(`Agent "${entryAgent}" is not registered`);
    }

    const ctx = new WorkflowContext(entryAgent, initialInput, initialContext ?? {});
    let currentAgent: AgentProtocol = entryAgentInstance;
    let currentInput: string = initialInput;
    let lastResponse: AgentResponse | null = null;

    try {
      while (true) {
        ctx.incrementIteration();
        if (ctx.iterationCount > this.config.maxIterations) {
          throw new MaxIterationsError(
            `Exceeded max iterations (${this.config.maxIterations})`,
          );
        }

        onEvent?.({ type: 'agent_start', agentName: currentAgent.name });

        const response = await currentAgent.execute(currentInput, ctx.context, (e) => {
          onEvent?.(e.phase === 'start'
            ? { type: 'tool_use_start', agentName: currentAgent.name, toolName: e.toolName, toolUseId: e.toolUseId }
            : { type: 'tool_use_end', agentName: currentAgent.name, toolName: e.toolName, toolUseId: e.toolUseId, elapsedMs: e.elapsedMs ?? 0 });
        });
        lastResponse = response;

        if (response.done) {
          onEvent?.({ type: 'done', success: true, summary: response.text });
          return {
            success: true,
            finalResponse: response,
            data: response.data,
            history: {
              totalSteps: ctx.history.totalSteps,
              route: ctx.history.getRoute(),
              steps: [...ctx.history.steps],
            },
            stats: {
              handoffCount: ctx.handoffCount,
              iterationCount: ctx.iterationCount,
            },
          };
        }

        if (response.handoff) {
          const targetName = response.handoff.targetAgent;

          onEvent?.({ type: 'handoff', from: currentAgent.name, to: targetName });

          if (!this.allowedTargets.isAllowed(targetName)) {
            throw new SecurityError(
              `Handoff target "${targetName}" is not authorized`,
            );
          }

          const targetAgent = this.agents.get(targetName);
          if (!targetAgent) {
            throw new AgentNotFoundError(
              `Agent "${targetName}" is not registered`,
            );
          }

          ctx.history.record(
            currentAgent.name,
            targetName,
            response.handoff.payload.event,
            response.handoff.payload.context as Record<string, unknown> | undefined,
          );
          ctx.incrementHandoff();

          if (ctx.handoffCount > this.config.maxHandoffs) {
            throw new LoopDetectionError(
              `Exceeded max handoffs (${this.config.maxHandoffs})`,
            );
          }

          currentAgent = targetAgent;
          currentInput = response.handoff.payload.event ?? response.text;
          ctx.currentAgent = targetName;
        } else {
          currentInput = response.text;
        }
      }
    } catch (error: unknown) {
      if (
        error instanceof SecurityError ||
        error instanceof AgentNotFoundError ||
        error instanceof MaxIterationsError ||
        error instanceof LoopDetectionError
      ) {
        throw error;
      }

      return {
        success: false,
        finalResponse: null,
        data: {},
        history: {
          totalSteps: ctx.history.totalSteps,
          route: ctx.history.getRoute(),
          steps: [...ctx.history.steps],
        },
        stats: {
          handoffCount: ctx.handoffCount,
          iterationCount: ctx.iterationCount,
        },
      };
    }
  }

  // ── Contract tree path (with ContractStore) ─────────────────────

  private async runWithContractTree(
    entryAgent: string,
    initialInput: string,
    initialContext?: Record<string, unknown>,
    onEvent?: (event: OrchestrationEvent) => void,
  ): Promise<OrchestrationResult> {
    if (!this.allowedTargets.isAllowed(entryAgent)) {
      throw new SecurityError(`Entry agent "${entryAgent}" is not authorized`);
    }

    if (!this.agents.has(entryAgent)) {
      throw new AgentNotFoundError(`Agent "${entryAgent}" is not registered`);
    }

    const ctx = new WorkflowContext(entryAgent, initialInput, initialContext ?? {});
    const store = this.contractStore!;

    // Create root contract
    const rootContract = store.create({
      parentId: null,
      fromAgent: 'user',
      toAgent: entryAgent,
      task: initialInput,
      status: 'pending',
    });
    onEvent?.({
      type: 'contract_created',
      contractId: rootContract.id,
      parentId: null,
      fromAgent: 'user',
      toAgent: entryAgent,
      task: initialInput,
    });

    let currentContract = rootContract;
    let currentInput = initialInput;
    let lastResponse: AgentResponse | null = null;

    try {
      while (true) {
        // Max iterations guard
        ctx.incrementIteration();
        if (ctx.iterationCount > this.config.maxIterations) {
          throw new MaxIterationsError(
            `Exceeded max iterations (${this.config.maxIterations})`,
          );
        }

        // Depth guard
        const depth = this.getDepth(currentContract.id);
        if (depth > this.config.maxStackDepth) {
          throw new Error(`Max stack depth ${this.config.maxStackDepth} exceeded`);
        }

        const agentName = currentContract.toAgent;
        if (!agentName) {
          throw new Error(`Contract ${currentContract.id} has no assigned agent`);
        }

        const agent = this.agents.get(agentName);
        if (!agent) {
          throw new AgentNotFoundError(`Agent "${agentName}" is not registered`);
        }

        // Activate the contract
        store.updateStatus(currentContract.id, 'active');
        onEvent?.({ type: 'contract_active', contractId: currentContract.id });
        onEvent?.({ type: 'agent_start', agentName });

        const response = await agent.execute(currentInput, ctx.context, (e) => {
          onEvent?.(e.phase === 'start'
            ? { type: 'tool_use_start', agentName, toolName: e.toolName, toolUseId: e.toolUseId }
            : { type: 'tool_use_end', agentName, toolName: e.toolName, toolUseId: e.toolUseId, elapsedMs: e.elapsedMs ?? 0 });
        });
        lastResponse = response;

        const handoff = response.handoff;

        if (handoff) {
          // ── Handoff requested ──────────────────────────────
          const handoffTo = handoff.targetAgent || '<director>';
          onEvent?.({
            type: 'handoff',
            from: agentName,
            to: handoffTo,
            reason: handoff.payload.event,
          });

          let targetAgentName: string | null = null;
          let routingMethod: string | undefined;
          let routingReason: string | undefined;

          if (handoff.targetAgent) {
            // Direct route — agent knows the target
            if (!this.allowedTargets.isAllowed(handoff.targetAgent)) {
              throw new SecurityError(
                `Handoff target "${handoff.targetAgent}" is not authorized`,
              );
            }
            if (!this.agents.has(handoff.targetAgent)) {
              throw new AgentNotFoundError(
                `Agent "${handoff.targetAgent}" is not registered`,
              );
            }
            targetAgentName = handoff.targetAgent;
            routingMethod = 'direct';
            routingReason = 'Agent-specified target';
          } else if (this.config.directorEnabled) {
            // Director routing
            const allAgents = this.getAllAgentMeta();
            const result = await routeHandoff(handoff.payload.event, allAgents, {
              apiKey: this.config.directorApiKey ?? '',
              baseUrl: this.config.directorBaseUrl,
              model: this.config.directorModel,
              enabled: true,
            });

            routingMethod = result.method;
            routingReason = result.reason;

            onEvent?.({
              type: 'director_decision',
              contractId: currentContract.id,
              routingMethod: result.method,
              decisionReason: result.reason,
              candidates: result.candidates ? JSON.stringify(result.candidates) : undefined,
            });

            if (result.agentId) {
              targetAgentName = result.agentId;
              onEvent?.({
                type: 'contract_assigned',
                contractId: currentContract.id,
                agentId: result.agentId,
                method: result.method,
                reason: result.reason,
              });
            } else {
              // No match — mark contract failed, bubble up
              this.handleNoMatch(
                currentContract,
                `Director could not find an agent: ${result.reason}`,
                onEvent,
              );
              if (currentContract.parentId) {
                const parent = store.getById(currentContract.parentId);
                if (parent) {
                  currentContract = parent;
                  currentInput = `[Subtask could not be routed: ${result.reason}]`;
                  continue;
                }
              }
              return this.buildFailureResult(ctx);
            }
          } else {
            throw new Error(
              'Handoff has no target agent and Director routing is disabled',
            );
          }

          // Create sub-contract for the handoff
          const subContract = store.create({
            parentId: currentContract.id,
            fromAgent: agentName,
            toAgent: targetAgentName,
            task: handoff.payload.event,
            status: 'pending',
          });
          onEvent?.({
            type: 'contract_created',
            contractId: subContract.id,
            parentId: currentContract.id,
            fromAgent: agentName,
            toAgent: targetAgentName,
            task: handoff.payload.event,
          });

          // Mark parent as waiting for child
          store.updateStatus(currentContract.id, 'waiting');

          // Record handoff
          ctx.history.record(
            agentName,
            targetAgentName,
            handoff.payload.event,
            handoff.payload.context as Record<string, unknown> | undefined,
          );
          ctx.incrementHandoff();

          if (ctx.handoffCount > this.config.maxHandoffs) {
            throw new LoopDetectionError(
              `Exceeded max handoffs (${this.config.maxHandoffs})`,
            );
          }

          // Switch to sub-contract
          currentContract = subContract;
          currentInput = handoff.payload.event;
          ctx.currentAgent = targetAgentName;
        } else if (response.done) {
          // ── Agent finished ─────────────────────────────────
          store.updateStatus(currentContract.id, 'done', response.text);
          onEvent?.({
            type: 'contract_completed',
            contractId: currentContract.id,
            parentId: currentContract.parentId,
            toAgent: currentContract.toAgent,
            result: response.text,
          });

          if (!currentContract.parentId) {
            // Root contract done — final result
            onEvent?.({ type: 'done', success: true, summary: response.text });
            return {
              success: true,
              finalResponse: response,
              data: response.data,
              history: {
                totalSteps: ctx.history.totalSteps,
                route: ctx.history.getRoute(),
                steps: [...ctx.history.steps],
              },
              stats: {
                handoffCount: ctx.handoffCount,
                iterationCount: ctx.iterationCount,
              },
            };
          }

          // Bubble up to parent
          const parent = store.getById(currentContract.parentId);
          if (!parent) {
            throw new Error(`Parent contract ${currentContract.parentId} not found`);
          }

          const siblings = store.getChildren(parent.id);
          const allDone = siblings.every(
            (s) => s.status === 'done' || s.status === 'failed',
          );

          if (allDone) {
            // Re-invoke parent with aggregated children results
            currentContract = parent;
            const childResults = siblings
              .filter((s) => s.result)
              .map((s) => `[${s.toAgent ?? 'agent'}] ${s.result}`)
              .join('\n');
            currentInput = [
              `Results from delegated subtasks:`,
              childResults,
              '',
              `Please continue with your original task considering these results.`,
            ].join('\n');
          } else {
            // Partial result — shouldn't happen in synchronous execution
            onEvent?.({ type: 'done', success: true, summary: response.text });
            return this.buildPartialResult(response, ctx);
          }
        } else {
          // ── Intermediate output — continue with same agent ─
          currentInput = response.text;
        }
      }
    } catch (error: unknown) {
      if (
        error instanceof SecurityError ||
        error instanceof AgentNotFoundError ||
        error instanceof MaxIterationsError ||
        error instanceof LoopDetectionError
      ) {
        throw error;
      }

      if (currentContract) {
        store.updateStatus(currentContract.id, 'failed');
        onEvent?.({
          type: 'contract_failed',
          contractId: currentContract.id,
          parentId: currentContract.parentId,
          toAgent: currentContract.toAgent,
          reason: String(error),
        });
      }

      return this.buildFailureResult(ctx);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────

  private getDepth(contractId: string): number {
    let depth = 0;
    let current: Contract | undefined = this.contractStore!.getById(contractId);
    while (current?.parentId) {
      depth++;
      current = this.contractStore!.getById(current.parentId);
      if (depth > this.config.maxStackDepth + 1) break;
    }
    return depth;
  }

  private getAllAgentMeta(): AgentMeta[] {
    return Array.from(this.agents.keys()).map((id) => {
      const stored = this.agentMetas.get(id);
      return stored ?? { id, capabilities: [], role: '', description: id };
    });
  }

  private handleNoMatch(
    contract: Contract,
    reason: string,
    onEvent?: (event: OrchestrationEvent) => void,
  ): void {
    this.contractStore!.updateStatus(contract.id, 'failed', reason);
    onEvent?.({ type: 'contract_failed', contractId: contract.id, reason });
  }

  private buildFailureResult(ctx: WorkflowContext): OrchestrationResult {
    return {
      success: false,
      finalResponse: null,
      data: {},
      history: {
        totalSteps: ctx.history.totalSteps,
        route: ctx.history.getRoute(),
        steps: [...ctx.history.steps],
      },
      stats: {
        handoffCount: ctx.handoffCount,
        iterationCount: ctx.iterationCount,
      },
    };
  }

  private buildPartialResult(
    response: AgentResponse,
    ctx: WorkflowContext,
  ): OrchestrationResult {
    return {
      success: true,
      finalResponse: response,
      data: response.data,
      history: {
        totalSteps: ctx.history.totalSteps,
        route: ctx.history.getRoute(),
        steps: [...ctx.history.steps],
      },
      stats: {
        handoffCount: ctx.handoffCount,
        iterationCount: ctx.iterationCount,
      },
    };
  }
}
