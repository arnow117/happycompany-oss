import { describe, test, expect } from 'vitest';
import {
  OrchestrationError,
  SecurityError,
  LoopDetectionError,
  MaxIterationsError,
  AgentNotFoundError,
  HandoffValidationError,
} from '../../src/orchestrator/errors.js';

describe('OrchestrationError', () => {
  test('is instance of Error', () => {
    const error = new OrchestrationError('test message');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(OrchestrationError);
  });

  test('carries message', () => {
    const error = new OrchestrationError('something went wrong');
    expect(error.message).toBe('something went wrong');
  });

  test('carries name property', () => {
    const error = new OrchestrationError('test');
    expect(error.name).toBe('OrchestrationError');
  });
});

describe('SecurityError', () => {
  test('extends OrchestrationError', () => {
    const error = new SecurityError('unauthorized');
    expect(error).toBeInstanceOf(OrchestrationError);
    expect(error).toBeInstanceOf(SecurityError);
  });

  test('carries name property', () => {
    const error = new SecurityError('unauthorized');
    expect(error.name).toBe('SecurityError');
  });

  test('carries message', () => {
    const error = new SecurityError('agent lacks required permissions');
    expect(error.message).toBe('agent lacks required permissions');
  });
});

describe('LoopDetectionError', () => {
  test('extends OrchestrationError', () => {
    const error = new LoopDetectionError('loop detected');
    expect(error).toBeInstanceOf(OrchestrationError);
    expect(error).toBeInstanceOf(LoopDetectionError);
  });

  test('carries name property', () => {
    const error = new LoopDetectionError('loop detected');
    expect(error.name).toBe('LoopDetectionError');
  });

  test('carries message', () => {
    const error = new LoopDetectionError('agent A -> B -> A cycle');
    expect(error.message).toBe('agent A -> B -> A cycle');
  });
});

describe('MaxIterationsError', () => {
  test('extends OrchestrationError', () => {
    const error = new MaxIterationsError('max reached');
    expect(error).toBeInstanceOf(OrchestrationError);
    expect(error).toBeInstanceOf(MaxIterationsError);
  });

  test('carries name property', () => {
    const error = new MaxIterationsError('max reached');
    expect(error.name).toBe('MaxIterationsError');
  });

  test('carries message', () => {
    const error = new MaxIterationsError('exceeded 100 iterations');
    expect(error.message).toBe('exceeded 100 iterations');
  });
});

describe('AgentNotFoundError', () => {
  test('extends OrchestrationError', () => {
    const error = new AgentNotFoundError('not found');
    expect(error).toBeInstanceOf(OrchestrationError);
    expect(error).toBeInstanceOf(AgentNotFoundError);
  });

  test('carries name property', () => {
    const error = new AgentNotFoundError('not found');
    expect(error.name).toBe('AgentNotFoundError');
  });

  test('carries message', () => {
    const error = new AgentNotFoundError('agent "billing" not registered');
    expect(error.message).toBe('agent "billing" not registered');
  });
});

describe('HandoffValidationError', () => {
  test('extends OrchestrationError', () => {
    const error = new HandoffValidationError('validation failed');
    expect(error).toBeInstanceOf(OrchestrationError);
    expect(error).toBeInstanceOf(HandoffValidationError);
  });

  test('carries name property', () => {
    const error = new HandoffValidationError('validation failed');
    expect(error.name).toBe('HandoffValidationError');
  });

  test('carries message', () => {
    const error = new HandoffValidationError('missing required context fields');
    expect(error.message).toBe('missing required context fields');
  });
});
