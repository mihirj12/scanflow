/**
 * Applies every pending migration in `drizzle/`.
 *
 * Drizzle's migrator records each applied file's hash in `__drizzle_migrations`,
 * so running this twice is a no-op rather than an error — which is what makes it
 * safe to run unconditionally on container start.
 *
 * Writes through process.stdout rather than console because `no-console` is on
 * everywhere: a stray debug log is a real risk in a codebase that must never
 * print a patient identifier, and a migration CLI is not a good reason to weaken
 * the rule.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * Apply pending migrations against `databaseUrl`. Safe to call from tests —
 * nesting another `pnpm` process under Turbo deadlocks the store lock.
 */
export async function applyMigrations(databaseUrl: string): Promise<void> {
  // A single connection: concurrent DDL from a pool would deadlock on the
  // migration lock, and there is nothing to parallelise.
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl === '') {
    process.stderr.write(
      'DATABASE_URL is not set. Copy .env.example to .env and start Postgres with `docker compose up -d`.\n',
    );
    process.exit(1);
  }

  try {
    await applyMigrations(databaseUrl);
    process.stdout.write('Migrations applied.\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Migration failed: ${message}\n`);
    process.exitCode = 1;
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectRun) {
  void main();
}
