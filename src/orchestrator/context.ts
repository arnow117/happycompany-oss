export interface HistoryStep {
  from: string;
  to: string;
  timestamp: number;
  task?: string;
  payload?: Record<string, unknown>;
}

export class WorkflowHistory {
  readonly steps: HistoryStep[] = [];

  get totalSteps(): number {
    return this.steps.length;
  }

  record(from: string, to: string, task?: string, payload?: Record<string, unknown>): void {
    this.steps.push({ from, to, timestamp: Date.now(), task, payload });
  }

  getRoute(): string[] {
    return this.steps.map((step) => `${step.from}->${step.to}`);
  }
}

export class WorkflowContext {
  readonly entryAgent: string;
  currentAgent: string;
  readonly inputText: string;
  readonly context: Record<string, unknown>;
  handoffCount: number;
  iterationCount: number;
  readonly history: WorkflowHistory;

  constructor(
    entryAgent: string,
    inputText: string,
    context: Record<string, unknown> = {},
  ) {
    this.entryAgent = entryAgent;
    this.currentAgent = entryAgent;
    this.inputText = inputText;
    this.context = context;
    this.handoffCount = 0;
    this.iterationCount = 0;
    this.history = new WorkflowHistory();
  }

  incrementIteration(): void {
    this.iterationCount += 1;
  }

  incrementHandoff(): void {
    this.handoffCount += 1;
  }
}

export class AllowedTargets {
  private readonly targets: Set<string>;

  private constructor(targets: ReadonlySet<string>) {
    this.targets = new Set(targets);
  }

  static fromList(agents: string[]): AllowedTargets {
    return new AllowedTargets(new Set(agents));
  }

  add(agent: string): void {
    this.targets.add(agent);
  }

  remove(agent: string): void {
    this.targets.delete(agent);
  }

  isAllowed(agent: string): boolean {
    return this.targets.has(agent);
  }

  getAll(): string[] {
    return [...this.targets];
  }

  get size(): number {
    return this.targets.size;
  }

  [Symbol.iterator](): Iterator<string> {
    return this.targets[Symbol.iterator]();
  }
}
