import type { LoadedEmployee } from './employee-loader.js';
import type { MessageBus } from '../bus.js';
import type { AgentRespond } from '../scheduler.js';
import { logger } from '../logger.js';

export interface EventBridgeDeps {
  bus: MessageBus;
  agent: AgentRespond;
}

interface RegisteredTrigger {
  eventType: string;
  agentId: string;
  prompt: string;
  unsubscribe: () => void;
}

/**
 * Bridges domain events on the MessageBus to agent execution.
 * When an EmployeeDefinition declares event triggers, the EventBridge
 * subscribes to those domain events and invokes the agent's respond
 * method with an interpolated prompt.
 */
export class EventBridge {
  private triggers: RegisteredTrigger[] = [];
  private busUnsubscribe: (() => void) | null = null;

  constructor(private deps: EventBridgeDeps) {}

  registerEmployeeEventTriggers(employees: LoadedEmployee[]): void {
    for (const app of employees) {
      const eventTriggers = app.schedule?.triggers?.filter(
        (t) => t.type === 'event' && t.enabled,
      ) ?? [];
      for (const trigger of eventTriggers) {
        const unsubscribe = this.deps.bus.subscribeToDomainEvent(trigger.value, app.id);
        this.triggers.push({
          eventType: trigger.value,
          agentId: app.id,
          prompt: trigger.prompt,
          unsubscribe,
        });
      }
    }

    // Listen to domain events published on the bus and trigger agents
    if (!this.busUnsubscribe) {
      this.busUnsubscribe = this.deps.bus.subscribe((ev) => {
        if (ev.type === 'domain_event' && ev.domainEventType) {
          this.handleDomainEvent(ev.domainEventType, ev.meta ?? {});
        }
      });
    }
  }

  removeAppEventTriggers(agentId: string): void {
    const toRemove = this.triggers.filter((t) => t.agentId === agentId);
    for (const t of toRemove) {
      t.unsubscribe();
    }
    this.triggers = this.triggers.filter((t) => t.agentId !== agentId);
    logger.info({ agentId, removed: toRemove.length }, 'EventBridge: removed triggers for agent');
  }

  private handleDomainEvent(eventType: string, payload: Record<string, unknown>): void {
    const matching = this.triggers.filter((t) => t.eventType === eventType);
    for (const trigger of matching) {
      const prompt = this.interpolatePrompt(trigger.prompt, payload);
      this.deps.agent
        .respond(prompt, `__event__:${eventType}`, trigger.agentId)
        .catch((err) => {
          logger.error(
            { agentId: trigger.agentId, eventType, err },
            'EventBridge: agent execution failed',
          );
        });
    }
  }

  private interpolatePrompt(template: string, payload: Record<string, unknown>): string {
    let result = template;
    for (const [key, value] of Object.entries(payload)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
    }
    return result;
  }

  stop(): void {
    for (const t of this.triggers) {
      t.unsubscribe();
    }
    this.triggers = [];
    if (this.busUnsubscribe) {
      this.busUnsubscribe();
      this.busUnsubscribe = null;
    }
  }
}
