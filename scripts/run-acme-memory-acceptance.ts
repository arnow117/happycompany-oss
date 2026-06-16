import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

process.env.LOG_LEVEL ??= 'silent';

interface Args {
  dataDir: string;
  corpDir: string;
  tenant: string;
  output?: string;
}

const repoRoot = resolve(import.meta.dirname, '..');

function stamp(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(argv: string[]): Args {
  const profile = `acme-memory-${stamp()}`;
  const args: Args = {
    dataDir: resolve(repoRoot, '.runtime', profile, 'data'),
    corpDir: resolve(repoRoot, '.runtime', profile, 'corp'),
    tenant: 'acme-happycompany',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--data-dir') {
      args.dataDir = resolve(readFlagValue(argv, i, item));
      i += 1;
    } else if (item === '--corp-dir') {
      args.corpDir = resolve(readFlagValue(argv, i, item));
      i += 1;
    } else if (item === '--tenant') {
      args.tenant = readFlagValue(argv, i, item);
      i += 1;
    } else if (item === '--output') {
      args.output = resolve(readFlagValue(argv, i, item));
      i += 1;
    } else if (item === '--help') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  process.stdout.write([
    'Usage:',
    '  npx tsx scripts/run-acme-memory-acceptance.ts [--output report.json]',
    '',
    'Writes and searches Acme Flow A / Flow B memories using the real MemoryManager API.',
    '',
  ].join('\n'));
}

try {
  const args = parseArgs(process.argv.slice(2));
  const { runAcmeMemoryAcceptance } = await import('../src/acme-memory-acceptance.js');
  const report = runAcmeMemoryAcceptance(args);

  if (args.output) {
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
