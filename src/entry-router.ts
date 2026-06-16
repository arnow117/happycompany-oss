import type { BotConfig } from './types.js';

export interface EmployeeDirectory {
  has(employeeId: string): boolean;
  findByHumanUserId?(tenantName: string, userId: string, prompt?: string): string | null;
}

export interface SlashCommandResult {
  handled: boolean;
  response?: string;
  targetEmployeeId?: string;
}

export interface VisibleEmployee {
  id: string;
  displayName: string;
  oneLiner?: string;
}

/**
 * Parse slash commands from user message text.
 *
 * Commands:
 * - `/list` → List all visible employees with their one-liners
 * - `1` / `1.` / `1、` / `/1` → Pick employee by selector index
 * - `/{name}` / `{name}` → Fuzzy match against employee displayName or id
 *
 * Returns null if the text is not a slash command.
 */
export function parseSlashCommand(
  text: string,
  visibleEmployees: VisibleEmployee[],
): SlashCommandResult | null {
  const trimmed = text.trim();
  const normalized = normalizeCommandText(trimmed);

  if (normalized === '/list') {
    const response = buildSelectorResponse(visibleEmployees);
    return { handled: true, response };
  }

  const indexQuery = parseEmployeeIndex(normalized);
  if (indexQuery !== null) {
    const match = visibleEmployees[indexQuery - 1];
    return match
      ? { handled: true, response: `已为您切换到 ${match.displayName}`, targetEmployeeId: match.id }
      : { handled: true, response: `没有第 ${indexQuery} 个数字员工，请回复 /list 查看可选对象。` };
  }

  const query = normalized.startsWith('/') ? normalized.slice(1) : normalized;
  if (!query) return null;

  const match = visibleEmployees.find((emp) =>
    emp.displayName.toLowerCase().includes(query.toLowerCase()) || emp.id.toLowerCase().includes(query.toLowerCase()),
  );
  if (match) {
    return { handled: true, response: `已为您切换到 ${match.displayName}`, targetEmployeeId: match.id };
  }

  return null;
}

function normalizeCommandText(text: string): string {
  return text.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10));
}

function parseEmployeeIndex(text: string): number | null {
  const match = /^\/?(\d+)(?:[.。、\s])?$/.exec(text);
  if (!match) return null;

  const index = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(index) && index > 0 ? index : null;
}

/**
 * Resolve which employee agent should handle a message for a given user.
 *
 * ADR-003: The dispatcher is no longer an agent. Routing is pure code:
 *   1. people.json binding hit → return the bound employee ID
 *   2. No binding → return null (caller should prompt user to bind or show selector)
 */
export function resolveEnterpriseEntryAgent(
  botConfig: { routingMode?: string; tenant?: string },
  employees: EmployeeDirectory,
  userId?: string,
  prompt?: string,
): string | null {
  if (botConfig?.routingMode !== 'employee-director') {
    return null;
  }

  if (botConfig.tenant && userId && employees.findByHumanUserId) {
    const personalAssistant = employees.findByHumanUserId(botConfig.tenant, userId, prompt);
    if (personalAssistant && employees.has(personalAssistant)) {
      return personalAssistant;
    }
  }

  return null;
}

/**
 * Build a formatted selector response showing available employees.
 *
 * Example output:
 * ```
 * 请选择对话对象：
 * 1. 销售小张 — 查医院、查设备、记录销售活动
 * 2. 财务小王 — 开票、报销审批、合同审核
 *
 * 回复数字或名字即可。
 * ```
 */
export function buildSelectorResponse(employees: VisibleEmployee[]): string {
  if (employees.length === 0) {
    return '当前没有可用的数字员工。';
  }

  const lines = ['请选择对话对象：'];
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const oneLiner = emp.oneLiner ? ` — ${emp.oneLiner}` : '';
    lines.push(`${i + 1}. ${emp.displayName}${oneLiner}`);
  }
  lines.push('\n回复数字或名字即可。');

  return lines.join('\n');
}
