import path from 'node:path';

export function employeeWorkdirPath(corpDir: string, tenant: string, employeeId: string): string {
  return path.join(corpDir, tenant, 'agents', employeeId);
}
