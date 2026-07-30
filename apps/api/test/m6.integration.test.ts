import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SEED_PASSWORD,
  DEMO_BUSY_DATE,
  DEMO_NORMAL_DATE,
  SEED_USERS,
} from '../scripts/seed-demo-days.js';
import { closeDb } from '../src/infra/db/client.js';
import { appointment } from '../src/infra/db/schema.js';
import {
  agent,
  appContainer,
  loginSession,
  rawAgent,
  signIn,
} from './setup.js';

describe.sequential('M6 auth, RBAC, readiness, and seed polish', () => {
  it('returns 401 for unauthenticated /api/v1 routes but not /health', async () => {
    await rawAgent.get('/api/v1/health').expect(200, { status: 'ok' });
    await rawAgent.get('/api/v1/schedule?date=2026-08-03').expect(401);
    await rawAgent.get('/api/v1/patients').expect(401);
  });

  it('returns 403 when a RECEPTIONIST hits admin-only routes', async () => {
    const receptionist = await signIn(rawAgent, 'RECEPTIONIST');
    await rawAgent
      .get('/api/v1/audit')
      .set('Authorization', `Bearer ${receptionist}`)
      .expect(403);
    await rawAgent
      .get('/api/v1/metrics')
      .set('Authorization', `Bearer ${receptionist}`)
      .expect(403);

    const services = await agent.get('/api/v1/service-types').expect(200);
    const consult = (
      services.body as { items: { id: string; code: string }[] }
    ).items.find((service) => service.code === 'CONSULT');
    if (consult === undefined) throw new Error('CONSULT missing');

    await rawAgent
      .post('/api/v1/appointment-templates')
      .set('Authorization', `Bearer ${receptionist}`)
      .send({
        code: `X-${randomUUID().slice(0, 8)}`,
        name: 'Should fail',
        steps: [
          {
            seq: 1,
            serviceTypeId: consult.id,
            durationMin: 15,
            minGapMin: 0,
            maxGapMin: 0,
            setupMin: 0,
            teardownMin: 0,
          },
        ],
      })
      .expect(403);
  });

  it('allows an ADMIN to list audit rows', async () => {
    const admin = await signIn(rawAgent, 'ADMIN');
    const response = await rawAgent
      .get('/api/v1/audit?limit=5')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(Array.isArray((response.body as { items: unknown[] }).items)).toBe(
      true,
    );
  });

  it('rotates refresh tokens and revokes the family when a used token is replayed', async () => {
    const login = await loginSession(rawAgent, 'RECEPTIONIST');
    const rotated = await rawAgent
      .post('/api/v1/auth/refresh')
      .set('Cookie', login.refreshCookie)
      .expect(200);
    const rotatedCookie = extractCookie(rotated.headers['set-cookie']);

    const reuse = await rawAgent
      .post('/api/v1/auth/refresh')
      .set('Cookie', login.refreshCookie)
      .expect(401);
    expect((reuse.body as { detail: string }).detail).toMatch(/reused/i);

    await rawAgent
      .post('/api/v1/auth/refresh')
      .set('Cookie', rotatedCookie)
      .expect(401);
  });

  it('seeded demo days include a normal Monday and a near-full Tuesday', async () => {
    const normal = await agent
      .get(`/api/v1/schedule?date=${DEMO_NORMAL_DATE}`)
      .expect(200);
    const busy = await agent
      .get(`/api/v1/schedule?date=${DEMO_BUSY_DATE}`)
      .expect(200);

    const normalCount = (normal.body as { appointments: unknown[] })
      .appointments.length;
    const busyCount = (busy.body as { appointments: unknown[] }).appointments
      .length;

    expect(normalCount).toBeGreaterThanOrEqual(5);
    expect(busyCount).toBeGreaterThan(normalCount);

    const rows = await appContainer.db
      .select({ count: sql<number>`count(*)::int` })
      .from(appointment)
      .where(eq(appointment.onDate, DEMO_BUSY_DATE));
    expect(rows[0]?.count ?? 0).toBeGreaterThanOrEqual(10);
  });

  it('opens an SSE stream and delivers schedule-changed after a booking', async () => {
    const token = await signIn(rawAgent, 'RECEPTIONIST');
    const date = '2026-08-22';

    const patients = await agent.get('/api/v1/patients').expect(200);
    const patient = (patients.body as { items: { id: string }[] }).items[0];
    if (patient === undefined) throw new Error('no patient');

    const services = await agent.get('/api/v1/service-types').expect(200);
    const consult = (
      services.body as { items: { id: string; code: string }[] }
    ).items.find((service) => service.code === 'CONSULT');
    if (consult === undefined) throw new Error('CONSULT missing');

    const steps = [
      {
        seq: 1,
        serviceTypeId: consult.id,
        durationMin: 15,
        minGapMin: 0,
        maxGapMin: 0,
        setupMin: 0,
        teardownMin: 0,
      },
    ];

    const eventPromise = waitForSseEvent(
      rawAgent,
      `/api/v1/schedule/stream?date=${date}`,
      token,
      2_000,
    );

    const suggestions = await agent
      .post('/api/v1/appointments/suggestions')
      .send({ patientId: patient.id, date, steps })
      .expect(200);
    const suggested = suggestions.body as {
      scheduleVersion: number;
      candidates: {
        start: string;
        end: string;
        spanMinutes: number;
        incidentalGapMinutes: number;
        placements: unknown[];
      }[];
    };
    const candidate = suggested.candidates[0];
    if (candidate === undefined) throw new Error('no candidate');

    await agent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({
        patientId: patient.id,
        date,
        steps,
        candidate,
        scheduleVersion: suggested.scheduleVersion,
      })
      .expect(201);

    const payload = await eventPromise;
    expect(payload).toContain('schedule-changed');
    expect(payload).toContain(date);
  });

  it('returns 503 from /ready when Postgres is unreachable', async () => {
    await closeDb(appContainer.db);
    const response = await rawAgent.get('/api/v1/ready').expect(503);
    expect((response.body as { status: number }).status).toBe(503);
    expect((response.body as { title: string }).title).toBe('Not ready');
  });
});

function extractCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (header === undefined) throw new Error('missing Set-Cookie');
  return header.split(';')[0] ?? header;
}

function waitForSseEvent(
  on: ReturnType<typeof request>,
  path: string,
  accessToken: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error(`no SSE event within ${String(timeoutMs)}ms`));
    }, timeoutMs);

    void on
      .get(path)
      .set('Authorization', `Bearer ${accessToken}`)
      .buffer(false)
      .parse((res, callback) => {
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          if (buffer.includes('schedule-changed')) {
            clearTimeout(timer);
            res.destroy();
            callback(null, buffer);
            resolve(buffer);
          }
        });
        res.on('error', (error: Error) => {
          clearTimeout(timer);
          callback(error, null);
          reject(error);
        });
        res.on('end', () => {
          if (!buffer.includes('schedule-changed')) {
            clearTimeout(timer);
            callback(null, buffer);
            reject(new Error('stream ended before schedule-changed'));
          }
        });
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

/** Sanity: demo logins match the documented seed users. */
describe('M6 seeded users', () => {
  it('accepts the documented demo password for each role', async () => {
    for (const user of SEED_USERS) {
      await rawAgent
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: DEFAULT_SEED_PASSWORD })
        .expect(200);
    }
  });
});
