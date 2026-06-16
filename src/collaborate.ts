import type { EmployeeManager } from './orchestrator/employee-colony.js';

export interface CollaborateRequest {
  tenant: string;
  sourceEmployeeId: string;
  target: string;
  message: string;
  mode: 'sync' | 'async';
}

export interface CollaborateResult {
  success: boolean;
  reply?: string;
  error?: string;
}

export class CollaborateService {
  constructor(private readonly deps: { employeeManager: EmployeeManager }) {}

  async send(req: CollaborateRequest): Promise<CollaborateResult> {
    let employee = this.deps.employeeManager.get(req.target);

    if (!employee) {
      employee = this.deps.employeeManager.findByRole(req.target);
    }

    if (!employee) {
      return { success: false, error: `Employee '${req.target}' not found` };
    }

    const chatId = `collab:${req.sourceEmployeeId}->${employee.app.id}:${Date.now()}`;

    try {
      const response = await employee.protocol.execute(req.message, { chatId });
      return { success: true, reply: response.text };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: `Collaboration failed: ${msg}` };
    }
  }
}
