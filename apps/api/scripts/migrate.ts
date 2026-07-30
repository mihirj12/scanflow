/**
 * Applies every pending migration in `drizzle/`, then exits.
 *
 * Drizzle's migrator records each applied file's hash in `__drizzle_migrations`,
 * so running this twice is a no-op rather than an error -- which is what makes it
 * safe to run unconditionally on container start.
 *
 * Writes through process.stdout rather than console because `no-console` is on
 * everywhere: a stray debug log is a real risk in a codebase that must never
 * print a patient identifier, and a migration CLI is not a good reason to weaken
 * the rule.
 */
import { fileURLToPath } from 'node:url';

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl === '') {
  process.stderr.write(
    'DATABASE_URL is not set. Copy .env.example to .env and start Postgres with `docker compose up -d`.\n',
  );
  process.exit(1);
}

// A single connection: concurrent DDL from a pool would deadlock on the
// migration lock, and there is nothing to parallelise.
const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

try {
  await migrate(drizzle(sql), { migrationsFolder });
  process.stdout.write('Migrations applied.\n');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Migration failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
