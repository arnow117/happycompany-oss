import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { EmployeeDefinition } from './employee-schema.js';

function listOrNone(values: string[] | undefined): string {
  const list = values?.filter((value) => value.trim().length > 0) ?? [];
  if (list.length === 0) return '- 无';
  return list.map((value) => `- ${value}`).join('\n');
}

export function renderEmployeeClaudeMd(def: EmployeeDefinition): string {
  const title = def.displayName || def.id;
  const lines = [
    `# ${title}`,
    '',
    '## 身份',
    '',
    `- 员工 ID: ${def.id}`,
    def.description ? `- 职责摘要: ${def.description}` : '- 职责摘要: 未配置',
    def.workspace ? `- 工作目录: ${def.workspace}` : '- 工作目录: 默认员工目录',
    '',
    '## 长期工作说明',
    '',
    def.systemPrompt?.trim() || '你是 HappyCompany 的数字员工。请根据职责边界处理用户请求。',
    '',
    '## 已绑定业务能力包',
    '',
    listOrNone(def.skills),
    '',
    '## 可执行业务动作',
    '',
    listOrNone(def.tools),
    '',
    '## 可转交对象',
    '',
    listOrNone(def.allowedTargets),
    '',
    '## 路由关键词与能力标签',
    '',
    listOrNone(def.capabilities),
    '',
    '## 工作边界',
    '',
    '- 处理租户业务数据时，只使用平台注入的授权业务工具。',
    '- 不要跨员工工作目录读取或写入文件。',
    '- 信息不足时先说明缺口，并请求用户补充。',
    '- 超出职责或权限时，转交给允许的数字员工或请求人工确认。',
    '',
    '## 记忆规则',
    '',
    '- 只把长期有效的偏好、决策、事实和后续事项写入当前员工 workspace 的 memory。',
    '- 不把一次性闲聊、敏感凭证或未经确认的推测写入长期记忆。',
    '',
  ];

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}`;
}

export function writeEmployeeClaudeMd(workspacePath: string, def: EmployeeDefinition): string {
  const promptPath = join(workspacePath, 'CLAUDE.md');
  mkdirSync(dirname(promptPath), { recursive: true });
  writeFileSync(promptPath, renderEmployeeClaudeMd(def), 'utf-8');
  return promptPath;
}
