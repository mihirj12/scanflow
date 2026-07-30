import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll } from 'vitest';

import { applyMigrations } from '../scripts/migrate.js';
import { SEED_CLINIC_ID, seedDatabase } from '../scripts/seed.js';
import { loadConfig } from '../src/config.js';
import { createContainer, type AppContainer } from '../src/container.js';
import { createApp } from '../src/http/app.js';
import { closeDb } from '../src/infra/db/client.js';

export let pgContainer: StartedPostgreSqlContainer;
export let appContainer: AppContainer;
export let agent: ReturnType<typeof request>;

/** A fixed Monday in Asia/Kolkata so working-hours fixtures apply. */
export const FIXTURE_DATE = '2026-08-03';

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('scanflow_test')
    .withUsername('scanflow')
    .withPassword('scanflow')
    .start();

  const url = pgContainer.getConnectionUri();
  const sql = postgres(url, { max: 1 });
  await sql`CREATE EXTENSION IF NOT EXISTS btree_gist`;
  await sql.end({ timeout: 5 });

  process.env['DATABASE_URL'] = url;
  process.env['CLINIC_ID'] = SEED_CLINIC_ID;
  // Supertest never listens; any positive port satisfies config validation.
  process.env['PORT'] = '3099';
  process.env['LOG_LEVEL'] = 'silent';
  process.env['NODE_ENV'] = 'test';
  process.env['CORS_ORIGIN'] = 'http://localhost:5173';

  // In-process — spawning `pnpm` under Turbo deadlocks the store lock in CI.
  await applyMigrations(url);
  await seedDatabase(url);

  const config = loadConfig(process.env);
  appContainer = createContainer(config);
  const { app } = createApp(appContainer);
  agent = request(app);
}, 180_000);

afterAll(async () => {
  // Close the pool so Vitest can exit; an open postgres.js client keeps the
  // event loop alive and hangs CI for the full job timeout.
  if (appContainer !== undefined) {
    await closeDb(appContainer.db);
  }
  if (pgContainer !== undefined) {
    await pgContainer.stop();
  }
}, 60_000);
