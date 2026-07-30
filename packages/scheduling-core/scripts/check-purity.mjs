#!/usr/bin/env node
/**
 * Mechanical enforcement of ground rule 1: scheduling-core is pure.
 *
 * ESLint cannot express "this package may not import anything at all", and a
 * rule that lives only in a document gets broken the first time someone is in a
 * hurry. So it lives here and runs as part of `pnpm lint`.
 *
 * Checks the non-test sources only. Test files legitimately import vitest and
 * fast-check, which are devDependencies and so never ship.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(packageRoot, 'src');

/**
 * Each of these makes the engine either impure or non-deterministic, both of
 * which break a property test in a way that is maddening to debug.
 */
const BANNED_PATTERNS = [
  { pattern: /\basync\b/, reason: 'the engine is synchronous' },
  { pattern: /\bawait\b/, reason: 'the engine is synchronous' },
  { pattern: /\bPromise\b/, reason: 'the engine is synchronous' },
  { pattern: /\bMath\.random\b/, reason: 'output must be deterministic' },
  { pattern: /\bDate\.now\b/, reason: 'output must be deterministic' },
  {
    pattern: /\bnew Date\b/,
    reason: 'the engine has no concept of clock time',
  },
  { pattern: /\bprocess\./, reason: 'the engine performs no I/O' },
  { pattern: /\bconsole\./, reason: 'the engine performs no I/O' },
  { pattern: /\bsetTimeout\b/, reason: 'the engine performs no I/O' },
];

const IMPORT_SPECIFIER =
  /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;

const failures = [];

async function collectSources(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSources(full)));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.bench.ts')
    ) {
      files.push(full);
    }
  }
  return files;
}

/** Comments describe the bans; they must not trip them. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const manifest = JSON.parse(
  await readFile(join(packageRoot, 'package.json'), 'utf8'),
);
const declaredDependencies = Object.keys(manifest.dependencies ?? {});
if (declaredDependencies.length > 0) {
  failures.push(
    `package.json declares runtime dependencies (${declaredDependencies.join(', ')}); scheduling-core must have none`,
  );
}

for (const file of await collectSources(sourceRoot)) {
  const where = relative(packageRoot, file).replaceAll('\\', '/');
  const code = stripComments(await readFile(file, 'utf8'));

  for (const match of code.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) {
      failures.push(
        `${where} imports '${specifier}'; only relative imports are allowed`,
      );
    }
  }

  for (const { pattern, reason } of BANNED_PATTERNS) {
    if (pattern.test(code)) {
      failures.push(`${where} uses ${String(pattern)} — ${reason}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `scheduling-core purity check failed:\n${failures.map((f) => `  - ${f}`).join('\n')}\n`,
  );
  process.exit(1);
}

process.stdout.write('scheduling-core purity check passed\n');
