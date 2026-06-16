export class OrchestrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestrationError';
  }
}

export class SecurityError extends OrchestrationError {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

export class LoopDetectionError extends OrchestrationError {
  constructor(message: string) {
    super(message);
    this.name = 'LoopDetectionError';
  }
}

export class MaxIterationsError extends OrchestrationError {
  constructor(message: string) {
    super(message);
    this.name = 'MaxIterationsError';
  }
}

export class AgentNotFoundError extends OrchestrationError {
  constructor(message: string) {
    super(message);
    this.name = 'AgentNotFoundError';
  }
}

export class HandoffValidationError extends OrchestrationError {
  constructor(message: string) {
    super(message);
    this.name = 'HandoffValidationError';
  }
}
