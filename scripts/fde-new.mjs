#!/usr/bin/env node
/**
 * fde-new — scaffold a new tenant (digital-employee organization) from an industry template.
 *
 * Usage:
 *   node scripts/fde-new.mjs <client-name> [--from-template <industry>] [--display-name <name>]
 *   npm run fde:new -- <client-name> [...]
 *
 * Creates corp/<client-name>/ by copying corp/templates/industries/<industry>/
 * and generating tenant-level app.json + empty people.json.
 *
 * The created directory is gitignored (per .gitignore rule `corp/*` + `!corp/templates/`),
 * so client data stays on the FDE's machine or in the client's private repo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');

const NAME_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;
const RESERVED_NAMES = new Set(['templates', 'roles']);

// ── arg parsing ─────────────────────────────────────────

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        die(`--${key} requires a value`);
      }
      opts[key] = next;
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { positional, opts };
}

function die(msg, code = 1) {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

function isEnvPlaceholder(value) {
  return /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function expandConfigValue(value) {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!match) return value;
  return process.env[match[1]];
}

function readConfigCorpDir() {
  if (!fs.existsSync(CONFIG_PATH)) return undefined;
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return expandConfigValue(config.corpDir);
  } catch {
    return undefined;
  }
}

function normalizeCorpDir(value) {
  const trimmed = value?.trim();
  if (!trimmed || isEnvPlaceholder(trimmed)) return undefined;
  return path.resolve(ROOT, trimmed);
}

function resolveCorpDir(opts) {
  return normalizeCorpDir(opts['corp-dir'])
    ?? normalizeCorpDir(process.env.HAPPYCOMPANY_CORP_DIR)
    ?? normalizeCorpDir(readConfigCorpDir())
    ?? path.join(ROOT, 'corp');
}

function formatPath(filePath) {
  const rel = path.relative(ROOT, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return filePath;
  return rel;
}

function listTemplates(templatesDir) {
  if (!fs.existsSync(templatesDir)) return [];
  return fs
    .readdirSync(templatesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function usage(corpDir) {
  const templatesDir = path.join(corpDir, 'templates', 'industries');
  const available = listTemplates(templatesDir);
  console.log(`
fde-new — scaffold a new tenant (digital-employee organization)

  node scripts/fde-new.mjs <client-name> [options]
  npm run fde:new -- <client-name> [options]

Arguments:
  <client-name>             Lowercase identifier matching ${NAME_PATTERN}.
                            Becomes corp/<client-name>/

Options:
  --from-template <id>      Industry template to copy from.
                            Available: ${available.length ? available.join(', ') : '(none — corp/templates/industries/ is empty)'}
                            Default: general
  --display-name <name>     Human-readable tenant name shown in UI.
                            Default: <client-name>
  --corp-dir <path>         Tenant/template root. Overrides HAPPYCOMPANY_CORP_DIR.
                            Current: ${formatPath(corpDir)}
  -h, --help                Show this help.

Examples:
  node scripts/fde-new.mjs acme --from-template professional-service
  node scripts/fde-new.mjs acme --display-name "Acme Consulting"
  HAPPYCOMPANY_CORP_DIR=/srv/happycompany/corp npm run fde:new -- acme --from-template med-device
`);
}

// ── fs helpers ──────────────────────────────────────────

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(sp, dp);
    else if (entry.isFile()) fs.copyFileSync(sp, dp);
  }
}

function safeJsonRead(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function listDirFiles(dir, filterFn = () => true) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => !f.startsWith('.') && filterFn(f));
}

// ── org-structure report ────────────────────────────────

function summarize(tenantDir) {
  const roles = safeJsonRead(path.join(tenantDir, 'roles.json'));
  return {
    roles: roles?.roles ?? {},
    employees: listDirFiles(path.join(tenantDir, 'employees'), (f) => f.endsWith('.yaml')),
    contracts: listDirFiles(path.join(tenantDir, 'contracts'), (f) => f.endsWith('.yaml')).length,
    workflows: listDirFiles(path.join(tenantDir, 'workflows'), (f) => f.endsWith('.yaml')).length,
  };
}

function describeTools(tools) {
  if (tools === '*') return '*all*';
  if (Array.isArray(tools)) return `${tools.length} tool${tools.length === 1 ? '' : 's'}`;
  return 'no tools';
}

function printOrgTree(name, summary) {
  const roleEntries = Object.entries(summary.roles);
  console.log(`\n✓ Created tenant: ${name}\n`);
  console.log('  Organization structure');
  console.log('  │');
  console.log(`  ├─ Roles (${roleEntries.length})`);
  roleEntries.forEach(([id, def], i) => {
    const last = i === roleEntries.length - 1;
    const branch = last ? '└─' : '├─';
    const label = def?.displayName ?? id;
    console.log(`  │  ${branch} ${id.padEnd(18)} ${label} (${describeTools(def?.tools)})`);
  });
  console.log('  │');
  console.log(`  ├─ Employees (${summary.employees.length})`);
  summary.employees.forEach((file, i) => {
    const last = i === summary.employees.length - 1;
    const branch = last ? '└─' : '├─';
    console.log(`  │  ${branch} ${file}`);
  });
  console.log('  │');
  console.log(`  ├─ Contracts: ${summary.contracts}  (inter-employee handoff rules)`);
  console.log(`  └─ Workflows: ${summary.workflows}  (cross-employee processes)`);
}

// ── main ────────────────────────────────────────────────

function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const corpDir = resolveCorpDir(opts);
  const templatesDir = path.join(corpDir, 'templates', 'industries');

  if (opts.help) {
    usage(corpDir);
    process.exit(0);
  }

  const clientName = positional[0];
  if (!clientName) {
    usage(corpDir);
    die('Missing <client-name> argument');
  }
  if (!NAME_PATTERN.test(clientName)) {
    die(`Invalid name "${clientName}". Must match ${NAME_PATTERN}`);
  }
  if (RESERVED_NAMES.has(clientName)) {
    die(`Reserved name: "${clientName}"`);
  }

  const tenantDir = path.join(corpDir, clientName);
  if (fs.existsSync(tenantDir)) {
    die(`Tenant already exists: ${formatPath(tenantDir)}/  (delete it first or pick another name)`);
  }

  const templateId = opts['from-template'] ?? 'general';
  const templateDir = path.join(templatesDir, templateId);
  if (!fs.existsSync(templateDir)) {
    die(`Unknown template "${templateId}". Available: ${listTemplates(templatesDir).join(', ') || '(none)'}`);
  }

  const displayName = opts['display-name'] ?? clientName;

  // 1. Recursively copy template → corp/<name>/
  copyDir(templateDir, tenantDir);

  // 2. Generate app.json (TenantMgr.scan requires it; templates use template.json instead)
  const templateMeta = safeJsonRead(path.join(templateDir, 'template.json')) ?? {};
  const appJson = {
    displayName,
    description: templateMeta.description ?? `Tenant scaffolded from template "${templateId}"`,
  };
  fs.writeFileSync(
    path.join(tenantDir, 'app.json'),
    JSON.stringify(appJson, null, 2) + '\n',
    'utf-8',
  );

  // 3. Remove template-only metadata that has no role in a runtime tenant
  const templateOnlyFiles = ['template.json'];
  for (const f of templateOnlyFiles) {
    const p = path.join(tenantDir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  // 4. Initialize empty people.json (gitignored; runtime expects the file to exist)
  fs.writeFileSync(path.join(tenantDir, 'people.json'), '[]\n', 'utf-8');

  // 4. Report org structure
  const summary = summarize(tenantDir);
  printOrgTree(clientName, summary);

  console.log(`
Next steps:
  1. Edit ${formatPath(path.join(tenantDir, 'app.json'))}  (displayName / description)
  2. Review ${formatPath(path.join(tenantDir, 'employees'))}/*.yaml and tune prompts to the client's domain
  3. Bind real users in ${formatPath(path.join(tenantDir, 'people.json'))} (gitignored — local only)
  4. Start the server:   npm run dev
  5. Open http://localhost:8888 and switch to tenant: ${clientName}

Note: ${formatPath(tenantDir)}/ is runtime/customer state. Maintain it in the client's private repo or local only.
`);
}

main();
