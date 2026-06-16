export interface OrchestrationConfigOptions {
  maxHandoffs?: number;
  maxIterations?: number;
  sessionTimeout?: number;
  enableLoopDetection?: boolean;
  enableAuditLog?: boolean;
  maxStackDepth?: number;
  directorEnabled?: boolean;
  directorApiKey?: string;
  directorBaseUrl?: string;
  directorModel?: string;
}

export class OrchestrationConfig {
  readonly maxHandoffs: number;
  readonly maxIterations: number;
  readonly sessionTimeout: number;
  readonly enableLoopDetection: boolean;
  readonly enableAuditLog: boolean;
  readonly maxStackDepth: number;
  readonly directorEnabled: boolean;
  readonly directorApiKey?: string;
  readonly directorBaseUrl?: string;
  readonly directorModel: string;

  constructor(options?: OrchestrationConfigOptions) {
    this.maxHandoffs = options?.maxHandoffs ?? 10;
    this.maxIterations = options?.maxIterations ?? 50;
    this.sessionTimeout = options?.sessionTimeout ?? 300;
    this.enableLoopDetection = options?.enableLoopDetection ?? true;
    this.enableAuditLog = options?.enableAuditLog ?? true;
    this.maxStackDepth = options?.maxStackDepth ?? 5;
    this.directorEnabled = options?.directorEnabled ?? false;
    this.directorApiKey = options?.directorApiKey;
    this.directorBaseUrl = options?.directorBaseUrl;
    this.directorModel = options?.directorModel ?? 'claude-haiku-4-5';
  }
}
