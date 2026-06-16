/**
 * Seed E2E test data: apps, skills, workdir, messages.
 * Run once before E2E tests: node scripts/seed-e2e.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(ROOT, '..');

// Materialize the gitignored E2E config from the committed example so a clean
// checkout / CI can run Playwright without a hand-written config.e2e.json.
const E2E_CONFIG = path.join(REPO_ROOT, 'config.e2e.json');
const E2E_CONFIG_EXAMPLE = path.join(REPO_ROOT, 'config.e2e.example.json');
if (!fs.existsSync(E2E_CONFIG) && fs.existsSync(E2E_CONFIG_EXAMPLE)) {
  fs.copyFileSync(E2E_CONFIG_EXAMPLE, E2E_CONFIG);
  console.log('  Created config.e2e.json from config.e2e.example.json');
}

const DATA_DIR = path.join(ROOT, '..', 'e2e', 'data');
const WORKDIR = path.join(DATA_DIR, 'acme-workdir');
const AGENTS_DIR = path.join(ROOT, '..', 'e2e', 'agents', 'acme');
const APPS_DIR = path.join(DATA_DIR, 'apps');
const SKILLS_DIR = path.join(DATA_DIR, 'skills');
const MESSAGES_DB = path.join(DATA_DIR, 'messages.db');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Skills ──────────────────────────────────────────────

const skills = [
  {
    id: 'kb-manage',
    name: 'Knowledge Manager',
    description: 'Manage knowledge base — document ingestion and retrieval',
    SKILL_MD: `---
name: kb-manage
description: Manage knowledge base operations
argumentHint: <operation> <query>
allowedTools:
  - Read
  - Write
  - Bash
  - Glob
---

# Knowledge Manager

Manage and query the knowledge base.

## Operations

- **ingest**: Ingest a document into the knowledge base
- **query**: Search the knowledge base
- **list**: List all documents
`,
  },
];

ensureDir(SKILLS_DIR);
for (const skill of skills) {
  const skillDir = path.join(SKILLS_DIR, skill.id);
  ensureDir(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skill.SKILL_MD);
}
console.log(`  Seeded ${skills.length} skills`);

// ── Apps ────────────────────────────────────────────────

const apps = [
  {
    name: 'kb-management',
    description: '知识库管理 — 文档入库与检索',
    versions: [{ version: 'v1.0', publishedAt: '2026-05-03T10:00:00Z', dir: 'e2e/data/apps/kb-management' }],
  },
  {
    name: 'hospital-crm',
    description: '医疗器械报修流程管理',
    versions: [{ version: 'v1.0', publishedAt: '2026-05-03T14:00:00Z', dir: 'e2e/data/apps/hospital-crm' }],
  },
  {
    name: 'python-example',
    description: 'Python 示例 App',
    versions: [{ version: 'v1.0', publishedAt: '2026-05-03T10:30:00Z', dir: 'e2e/data/apps/python-example' }],
  },
];

ensureDir(DATA_DIR);
const registryFile = path.join(DATA_DIR, 'registry.json');
const registry = { apps: {} };
for (const app of apps) {
  registry.apps[app.name] = {
    name: app.name,
    currentVersion: app.versions[0].version,
    description: app.description,
    versions: app.versions,
  };
}
writeJson(registryFile, registry);
console.log(`  Seeded ${apps.length} apps into registry`);

// Create app skeleton dirs
for (const app of apps) {
  const appDir = path.join(APPS_DIR, app.name);
  ensureDir(appDir);
  writeJson(path.join(appDir, 'app.json'), {
    name: app.name,
    description: app.description,
    currentVersion: app.versions[0].version,
    versions: app.versions,
  });
  writeJson(path.join(appDir, 'manifest.json'), { files: ['README.md', 'CLAUDE.md', 'SKILL.md'] });
  fs.writeFileSync(path.join(appDir, 'README.md'), `# ${app.name}\n\n${app.description}.`);
  fs.writeFileSync(path.join(appDir, 'CLAUDE.md'), `# CLAUDE.md\n\nThis is ${app.name}.`);
  fs.writeFileSync(path.join(appDir, 'SKILL.md'), `---\nname: ${app.name}\ndescription: ${app.description}\n---\n\n# ${app.name}\n\n${app.description}.\n`);
}

// Python example: add bin/run and src/hello.py for runnable app
const pythonAppDir = path.join(APPS_DIR, 'python-example');
ensureDir(path.join(pythonAppDir, 'src'));
ensureDir(path.join(pythonAppDir, 'bin'));
fs.writeFileSync(path.join(pythonAppDir, 'src', 'hello.py'),
  `import sys

def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "World"
    print(f"Hello, {name}!")

if __name__ == "__main__":
    main()
`);
fs.writeFileSync(path.join(pythonAppDir, 'bin', 'run'),
  `#!/bin/sh
exec python3 "$(dirname "$0")/../src/hello.py" "$@"
`);
fs.chmodSync(path.join(pythonAppDir, 'bin', 'run'), 0o755);
fs.writeFileSync(path.join(pythonAppDir, 'requirements.txt'), '');
console.log('  Added python-example runnable files (bin/run + src/hello.py)');
console.log('  Seeded app skeleton files');

// ── Workdir ─────────────────────────────────────────────

ensureDir(WORKDIR);
ensureDir(path.join(WORKDIR, '.claude', 'skills', 'kb-management'));
ensureDir(path.join(WORKDIR, '.claude', 'skills', 'python-example'));
fs.writeFileSync(
  path.join(WORKDIR, '.claude', 'skills', 'kb-management', 'SKILL.md'),
  skills[0].SKILL_MD,
);

// Copy python-example runnable files into workdir skills
const wdPythonApp = path.join(WORKDIR, '.claude', 'skills', 'python-example');
ensureDir(path.join(wdPythonApp, 'src'));
ensureDir(path.join(wdPythonApp, 'bin'));
fs.writeFileSync(path.join(wdPythonApp, 'src', 'hello.py'),
  fs.readFileSync(path.join(pythonAppDir, 'src', 'hello.py')));
fs.writeFileSync(path.join(wdPythonApp, 'bin', 'run'),
  fs.readFileSync(path.join(pythonAppDir, 'bin', 'run')));
fs.chmodSync(path.join(wdPythonApp, 'bin', 'run'), 0o755);
fs.writeFileSync(path.join(wdPythonApp, 'SKILL.md'),
  `---
name: python-example
description: Python 示例 App
---
`);
fs.writeFileSync(path.join(wdPythonApp, 'requirements.txt'), '');

writeJson(path.join(WORKDIR, 'installed.json'), {
  path: WORKDIR,
  apps: [
    { name: 'kb-management', version: 'v1.0', installedAt: '2026-05-03T10:00:00Z' },
    { name: 'hospital-crm', version: 'v1.0', installedAt: '2026-05-03T14:00:00Z' },
    { name: 'python-example', version: 'v1.0', installedAt: '2026-05-03T10:30:00Z' },
  ],
});
console.log('  Seeded workdir with installed apps');

// ── Agent Dir ───────────────────────────────────────────

ensureDir(AGENTS_DIR);
ensureDir(path.join(ROOT, '..', 'e2e', 'agents', 'feishu-test'));

fs.writeFileSync(path.join(AGENTS_DIR, 'CLAUDE.md'), `# 示例医疗助手 (acme)

你是示例医疗的 CRM 助手，负责医疗器械报修流程管理。

## 技能
- 管理报修工单
- 查询器械库存
- 回复客户咨询
`);
fs.writeFileSync(
  path.join(ROOT, '..', 'e2e', 'agents', 'feishu-test', 'CLAUDE.md'),
  `# 飞书测试Bot

你是飞书测试机器人，用于验证平台消息链路。

## 行为

- 收到消息后简短回复确认
- 不要执行任何工具调用
- 回复保持在一句话以内
`,
);
console.log('  Seeded agent CLAUDE.md');

// ── Clean messages.db and WAL sidecars if exists ────────
for (const file of [MESSAGES_DB, `${MESSAGES_DB}-wal`, `${MESSAGES_DB}-shm`]) {
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}
console.log('  Cleaned old messages.db artifacts');

console.log('\nE2E data seeded successfully.');
