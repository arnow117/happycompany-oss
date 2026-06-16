import { ToolRegistry } from '../src/tool-registry.js';

interface Args {
  corpDir?: string;
  tenant?: string;
  tools: string[];
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { tools: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--corp-dir') {
      args.corpDir = readFlagValue(argv, i, item);
      i += 1;
    } else if (item === '--tenant') {
      args.tenant = readFlagValue(argv, i, item);
      i += 1;
    } else if (item === '--tool') {
      args.tools.push(readFlagValue(argv, i, item));
      i += 1;
    } else if (item === '--help') {
      printHelp();
      process.exit(0);
    }
  }
  if (!args.corpDir) throw new Error('--corp-dir is required');
  if (!args.tenant) throw new Error('--tenant is required');
  return args;
}

function printHelp(): void {
  process.stdout.write([
    'Usage:',
    '  npx tsx scripts/scan-tool-registry.ts --corp-dir <path> --tenant <tenant> --tool <skill:tool>',
    '',
    'Scans a corp directory with the real ToolRegistry and reports whether selected tools are registered.',
    '',
  ].join('\n'));
}

try {
  const args = parseArgs(process.argv.slice(2));
  const registry = new ToolRegistry(args.corpDir!);
  registry.scan();
  const tools = args.tools.map((name) => ({
    name,
    found: Boolean(registry.lookup(args.tenant!, name)),
  }));
  const report = {
    status: tools.every((tool) => tool.found) ? 'passed' : 'failed',
    tenant: args.tenant,
    corpDir: args.corpDir,
    toolCount: registry.getToolsForTenant(args.tenant!).length,
    tools,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
