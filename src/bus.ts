import type { StreamEvent } from './stream-event.js';
import type { AgentObservability } from './agent-observability.js';

export type BusEventType =
  | 'message_received'
  | 'agent_thinking_start'
  | 'agent_reply_sent'
  | 'new_message'
  | 'stream_event'
  | 'runner_state'
  | 'bot_connected'
  | 'bot_disconnected'
  | 'config_reloaded'
  | 'domain_event'
  | 'orchestration_agent_start'
  | 'orchestration_handoff'
  | 'orchestration_cue_user'
  | 'orchestration_done'
  // Contract lifecycle
  | 'contract_created'
  | 'contract_assigned'
  | 'contract_active'
  | 'contract_completed'
  | 'contract_failed'
  // Director decisions
  | 'director_decision';

export interface BusChatMessage {
  id: string;
  chatId: string;
  text: string;
  source: 'user' | 'bot';
  botName?: string;
  timestamp: number;
  userId?: string;
  attachments?: Array<{ type: 'image'; data: string; mimeType: string }>;
  observability?: AgentObservability;
}

export interface BusEvent {
  type: BusEventType;
  timestamp: number;
  botName?: string;
  chatId?: string;
  messageId?: string;
  text?: string;
  fromBotName?: string;
  source?: string;
  meta?: Record<string, unknown>;
  domainEventType?: string;
  /** Orchestration: agent that handed off */
  handoffFrom?: string;
  /** Orchestration: agent that received the handoff */
  handoffTo?: string;
  /** Contract lifecycle: the contract this event is about */
  contractId?: string;
  /** Contract lifecycle: parent contract if this is a sub-contract */
  parentId?: string;
  /** Agent that created or handed off the contract */
  fromAgent?: string;
  /** Agent assigned to handle the contract */
  toAgent?: string;
  /** The task text */
  task?: string;
  /** Contract result when completed or failed */
  result?: string;
  /** "keyword" | "llm" | "direct" */
  routingMethod?: string;
  /** Why the director chose this agent */
  decisionReason?: string;
  /** JSON string of candidate agent info for director_decision events */
  candidates?: string;
  /** Web/IM chat message payload for unified chat rendering. */
  message?: BusChatMessage;
  /** Canonical streaming event for active agent turns. */
  event?: StreamEvent;
  /** Runner state for the chat turn lifecycle. */
  state?: 'idle' | 'running';
  /** Optional error text for WebSocket-facing failures. */
  error?: string;
}

export interface DomainEvent {
  type: 'domain_event';
  domainEventType: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

type Listener = (ev: BusEvent) => void;

const MAX_INBOX_SIZE = 100;

/**
 * In-process pub/sub + rolling buffer + agent inbox routing.
 * Serves the Web UI live feed over WebSocket. Nothing persistent.
 */
export class MessageBus {
  private readonly listeners = new Set<Listener>();
  private readonly buffer: BusEvent[] = [];
  private readonly maxBuffer: number;
  private readonly domainSubscriptions = new Map<string, Set<string>>(); // eventType -> Set<agentId>
  private readonly inboxes = new Map<string, DomainEvent[]>(); // agentId -> DomainEvent[]

  constructor(maxBuffer = 200) {
    this.maxBuffer = maxBuffer;
  }

  publish(event: Omit<BusEvent, 'timestamp'> & { timestamp?: number }): void {
    const full: BusEvent = {
      timestamp: Date.now(),
      ...event,
    };
    this.buffer.push(full);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.shift();
    }
    for (const listener of this.listeners) {
      try {
        listener(full);
      } catch {
        // swallow — one listener should never break others
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Replay buffered events (for a newly connected WS client). */
  snapshot(): BusEvent[] {
    return [...this.buffer];
  }

  size(): number {
    return this.buffer.length;
  }

  publishDomainEvent(eventType: string, payload: Record<string, unknown>): void {
    const event: DomainEvent = {
      type: 'domain_event',
      domainEventType: eventType,
      payload,
      timestamp: Date.now(),
    };

    // Also publish as a regular bus event for WebSocket feed
    this.publish({
      type: 'domain_event',
      domainEventType: eventType,
      meta: payload,
    });

    // Route to subscribed agent inboxes
    const subscribers = this.domainSubscriptions.get(eventType);
    if (subscribers) {
      for (const agentId of subscribers) {
        const inbox = this.inboxes.get(agentId) ?? [];
        inbox.push(event);
        if (inbox.length > MAX_INBOX_SIZE) {
          inbox.shift();
        }
        this.inboxes.set(agentId, inbox);
      }
    }
  }

  subscribeToDomainEvent(eventType: string, agentId: string): () => void {
    let subscribers = this.domainSubscriptions.get(eventType);
    if (!subscribers) {
      subscribers = new Set();
      this.domainSubscriptions.set(eventType, subscribers);
    }
    subscribers.add(agentId);
    return () => subscribers!.delete(agentId);
  }

  getInbox(agentId: string): DomainEvent[] {
    return this.inboxes.get(agentId) ?? [];
  }

  drainInbox(agentId: string): DomainEvent[] {
    const events = this.inboxes.get(agentId);
    this.inboxes.delete(agentId);
    return events ?? [];
  }
}
