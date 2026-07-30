import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll } from 'vitest';

import { applyMigrations } from '../scripts/migrate.js';
import {
  DEFAULT_SEED_PASSWORD,
  SEED_USERS,
} from '../scripts/seed-demo-days.js';
import { SEED_CLINIC_ID, seedDatabase } from '../scripts/seed.js';
import { loadConfig } from '../src/config.js';
import { createContainer, type AppContainer } from '../src/container.js';
import { createApp } from '../src/http/app.js';
import { closeDb } from '../src/infra/db/client.js';

export let pgContainer: StartedPostgreSqlContainer;
export let appContainer: AppContainer;
/** Authenticated as the seeded receptionist. */
export let agent: ReturnType<typeof request>;
/** No credentials attached. Use this to assert a 401. */
export let rawAgent: ReturnType<typeof request>;

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
  process.env['JWT_SECRET'] = 'test-secret-that-is-long-enough-32chars';
  // No REDIS_URL: the event bus stays in-process, which is what a single test
  // instance needs and keeps the suite free of a second container.
  delete process.env['REDIS_URL'];

  // In-process — spawning `pnpm` under Turbo deadlocks the store lock in CI.
  await applyMigrations(url);
  await seedDatabase(url);

  const config = loadConfig(process.env);
  appContainer = await createContainer(config);
  const { app } = createApp(appContainer);
  rawAgent = request(app);
  agent = authenticatedAgent(rawAgent, await signIn(rawAgent, 'RECEPTIONIST'));
}, 180_000);

/**
 * Every test written before M6 assumes it can call the API. Rather than edit
 * hundreds of lines, `agent` is now a receptionist-authenticated proxy: the same
 * supertest surface, with an Authorization header attached. `rawAgent` is there
 * for the tests that need to prove an unauthenticated call is rejected.
 */
export async function signIn(
  on: ReturnType<typeof request>,
  role: 'RECEPTIONIST' | 'CLINICIAN' | 'ADMIN',
): Promise<string> {
  const session = await loginSession(on, role);
  return session.accessToken;
}

export async function loginSession(
  on: ReturnType<typeof request>,
  role: 'RECEPTIONIST' | 'CLINICIAN' | 'ADMIN',
): Promise<{ accessToken: string; refreshCookie: string }> {
  const user = SEED_USERS.find((candidate) => candidate.role === role);
  if (user === undefined) throw new Error(`no seeded ${role}`);
  const response = await on
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: DEFAULT_SEED_PASSWORD })
    .expect(200);
  const refreshCookie = extractRefreshCookie(response.headers['set-cookie']);
  return {
    accessToken: (response.body as { accessToken: string }).accessToken,
    refreshCookie,
  };
}

function extractRefreshCookie(
  setCookie: string | string[] | undefined,
): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (header === undefined) throw new Error('login did not set refresh cookie');
  const match = /^scanflow_refresh=([^;]+)/.exec(header);
  if (match?.[1] === undefined) {
    throw new Error('refresh cookie missing from Set-Cookie');
  }
  return `scanflow_refresh=${match[1]}`;
}

type Agent = ReturnType<typeof request>;

function authenticatedAgent(on: Agent, accessToken: string): Agent {
  const wrap =
    (method: 'get' | 'post' | 'put' | 'patch' | 'delete') => (url: string) =>
      on[method](url).set('Authorization', `Bearer ${accessToken}`);
  return {
    ...on,
    get: wrap('get'),
    post: wrap('post'),
    put: wrap('put'),
    patch: wrap('patch'),
    delete: wrap('delete'),
  } as Agent;
}

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
