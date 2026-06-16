import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');

export default async function globalSetup() {
  execFileSync('node', ['scripts/seed-e2e.mjs'], { cwd: root, stdio: 'inherit' });
}
