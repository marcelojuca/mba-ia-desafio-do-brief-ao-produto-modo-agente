// npm run check — checagem de sintaxe (node --check) de todo .js/.mjs em src, test e scripts.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['src', 'test', 'scripts'];
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(m?js)$/.test(entry)) files.push(full);
  }
}

for (const root of roots) if (existsSync(root)) walk(root);

let failed = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    process.stderr.write(`✘ ${file}\n${r.stderr}\n`);
  }
}

console.log(`check: ${files.length} arquivos verificados, ${failed} com erro`);
process.exit(failed ? 1 : 0);
