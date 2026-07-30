import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import pino from 'pino';
import postgres from 'postgres';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { SEED_PATIENT_IDENTIFIERS } from '../scripts/seed.js';
import { createApp } from '../src/http/app.js';
import { formatTstzrange } from '../src/infra/db/tstzrange.js';
import { agent, appContainer, FIXTURE_DATE, signIn } from './setup.js';

function sqlStateOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

async function patientId(): Promise<string> {
  const patients = await agent.get('/api/v1/patients').expect(200);
  const first = (patients.body as { items: { id: string }[] }).items[0];
  if (first === undefined) throw new Error('seed patient missing');
  return first.id;
}

async function p4Steps() {
  const templates = await agent
    .get('/api/v1/appointment-templates')
    .expect(200);
  const p4 = (
    templates.body as { items: { id: string; code: string }[] }
  ).items.find((t) => t.code === 'P4');
  if (p4 === undefined) throw new Error('P4 preset missing');
  const detail = await agent
    .get(`/api/v1/appointment-templates/${p4.id}`)
    .expect(200);
  return {
    templateId: p4.id,
    steps: (detail.body as { steps: unknown[] }).steps,
  };
}

describe('M2 API integration', () => {
  it('GET /health and /ready', async () => {
    await agent.get('/api/v1/health').expect(200, { status: 'ok' });
    await agent.get('/api/v1/ready').expect(200, { status: 'ready' });
  });

  it('books P4 into an empty day with 5 SERVICE + 1 DELAY segments', async () => {
    const pid = await patientId();
    const { templateId, steps } = await p4Steps();

    const suggestions = await agent
      .post('/api/v1/appointments/suggestions')
      .send({ patientId: pid, date: FIXTURE_DATE, steps, templateId })
      .expect(200);

    const body = suggestions.body as {
      scheduleVersion: number;
      candidates: unknown[];
    };
    expect(body.candidates.length).toBeGreaterThan(0);
    const candidate = body.candidates[0];

    const booked = await agent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({
        patientId: pid,
        date: FIXTURE_DATE,
        steps,
        templateId,
        candidate,
        scheduleVersion: body.scheduleVersion,
      })
      .expect(201);

    const segments = (booked.body as { segments: { kind: string }[] }).segments;
    expect(segments.filter((s) => s.kind === 'SERVICE')).toHaveLength(5);
    expect(segments.filter((s) => s.kind === 'DELAY')).toHaveLength(1);
  });

  it('books an ad-hoc chain with no templateId and snapshots steps', async () => {
    const pid = await patientId();
    const services = await agent.get('/api/v1/service-types').expect(200);
    const consult = (
      services.body as { items: { id: string; code: string }[] }
    ).items.find((s) => s.code === 'CONSULT');
    if (consult === undefined) throw new Error('CONSULT missing');

    const steps = [
      {
        seq: 1,
        serviceTypeId: consult.id,
        durationMin: 30,
        minGapMin: 0,
        maxGapMin: 0,
        setupMin: 0,
        teardownMin: 0,
      },
    ];

    const suggestions = await agent
      .post('/api/v1/appointments/suggestions')
      .send({ patientId: pid, date: '2026-08-04', steps })
      .expect(200);
    const candidate = (
      suggestions.body as { candidates: unknown[]; scheduleVersion: number }
    ).candidates[0];
    const scheduleVersion = (suggestions.body as { scheduleVersion: number })
      .scheduleVersion;

    const booked = await agent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({
        patientId: pid,
        date: '2026-08-04',
        steps,
        candidate,
        scheduleVersion,
      })
      .expect(201);

    const detail = await agent
      .get(
        `/api/v1/appointments/${(booked.body as { appointmentId: string }).appointmentId}`,
      )
      .expect(200);
    expect(
      (detail.body as { templateId: string | null }).templateId,
    ).toBeNull();
    expect((detail.body as { steps: unknown[] }).steps).toHaveLength(1);
  });

  it('rejects a chain that violates gap-on-step-1 with 400 naming the step', async () => {
    const pid = await patientId();
    const services = await agent.get('/api/v1/service-types').expect(200);
    const consult = (
      services.body as { items: { id: string; code: string }[] }
    ).items.find((s) => s.code === 'CONSULT');
    if (consult === undefined) throw new Error('CONSULT missing');

    const response = await agent
      .post('/api/v1/appointments/suggestions')
      .send({
        patientId: pid,
        date: FIXTURE_DATE,
        steps: [
          {
            seq: 1,
            serviceTypeId: consult.id,
            durationMin: 30,
            minGapMin: 15,
            maxGapMin: 15,
            setupMin: 0,
            teardownMin: 0,
          },
        ],
      })
      .expect(400);

    expect(response.headers['content-type']).toMatch(/problem\+json/);
    expect(JSON.stringify(response.body)).toMatch(/first step/i);
  });

  it('editing a template after booking leaves appointment_step unchanged', async () => {
    const pid = await patientId();
    const { templateId, steps } = await p4Steps();

    // Book from P4 on a fresh day.
    const date = '2026-08-05';
    const suggestions = await agent
      .post('/api/v1/appointments/suggestions')
      .send({ patientId: pid, date, steps, templateId })
      .expect(200);
    const sug = suggestions.body as {
      scheduleVersion: number;
      candidates: unknown[];
    };
    const booked = await agent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({
        patientId: pid,
        date,
        steps,
        templateId,
        candidate: sug.candidates[0],
        scheduleVersion: sug.scheduleVersion,
      })
      .expect(201);

    const before = await agent
      .get(
        `/api/v1/appointments/${(booked.body as { appointmentId: string }).appointmentId}`,
      )
      .expect(200);
    const stepsBefore = (before.body as { steps: { durationMin: number }[] })
      .steps;

    // Mutate the template's first step duration.
    await appContainer.db.execute(
      sql`UPDATE template_step SET duration_min = 90 WHERE template_id = ${templateId} AND seq = 1`,
    );

    const after = await agent
      .get(
        `/api/v1/appointments/${(booked.body as { appointmentId: string }).appointmentId}`,
      )
      .expect(200);
    expect((after.body as { steps: { durationMin: number }[] }).steps).toEqual(
      stepsBefore,
    );
  });

  it('two concurrent bookings for the same slot: one 201, one 409 with alternatives', async () => {
    const pid = await patientId();
    const { steps } = await p4Steps();
    const date = '2026-08-06';

    const suggestions = await agent
      .post('/api/v1/appointments/suggestions')
      .send({ patientId: pid, date, steps })
      .expect(200);
    const sug = suggestions.body as {
      scheduleVersion: number;
      candidates: unknown[];
    };
    const payload = {
      patientId: pid,
      date,
      steps,
      candidate: sug.candidates[0],
      scheduleVersion: sug.scheduleVersion,
    };

    const [a, b] = await Promise.all([
      agent
        .post('/api/v1/appointments')
        .set('Idempotency-Key', randomUUID())
        .send(payload),
      agent
        .post('/api/v1/appointments')
        .set('Idempotency-Key', randomUUID())
        .send(payload),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = a.status === 409 ? a : b;
    expect(
      (conflict.body as { freshCandidates?: unknown[] }).freshCandidates
        ?.length,
    ).toBeGreaterThan(0);
  });

  it('direct SQL overlap on a resource fails with 23P01', async () => {
    const resources = await agent.get('/api/v1/resources').expect(200);
    const doctor = (
      resources.body as { items: { id: string; type: string }[] }
    ).items.find((r) => r.type === 'DOCTOR');
    if (doctor === undefined) throw new Error('doctor missing');

    const start = new Date('2026-08-07T02:30:00.000Z'); // 08:00 IST
    const end = new Date('2026-08-07T03:00:00.000Z');
    const during = formatTstzrange(start, end);
    const pid = await patientId();
    const clinicId = appContainer.config.CLINIC_ID;

    // Raw postgres.js — same path as verify-schema; Drizzle wraps SQLSTATE.
    const raw = postgres(process.env['DATABASE_URL'] ?? '', { max: 1 });
    try {
      const inserted = await raw<[{ id: string }]>`
        INSERT INTO appointment (clinic_id, patient_id, on_date, status)
        VALUES (${clinicId}::uuid, ${pid}::uuid, '2026-08-07', 'SCHEDULED')
        RETURNING id
      `;
      const appointmentId = inserted[0]?.id;
      if (appointmentId === undefined)
        throw new Error('appointment insert failed');

      await raw`
        INSERT INTO appointment_segment (
          appointment_id, clinic_id, patient_id, seq, kind,
          resource_id, during, resource_during, status
        ) VALUES (
          ${appointmentId}::uuid, ${clinicId}::uuid, ${pid}::uuid,
          1, 'SERVICE', ${doctor.id}::uuid,
          ${during}::tstzrange, ${during}::tstzrange, 'ACTIVE'
        )
      `;

      let code: string | undefined;
      try {
        await raw`
          INSERT INTO appointment_segment (
            appointment_id, clinic_id, patient_id, seq, kind,
            resource_id, during, resource_during, status
          ) VALUES (
            ${appointmentId}::uuid, ${clinicId}::uuid, ${pid}::uuid,
            2, 'SERVICE', ${doctor.id}::uuid,
            ${during}::tstzrange, ${during}::tstzrange, 'ACTIVE'
          )
        `;
      } catch (error) {
        code = sqlStateOf(error);
      }
      expect(code).toBe('23P01');
    } finally {
      await raw.end({ timeout: 5 });
    }
  });

  it('direct SQL overlap on a patient fails with 23P01', async () => {
    const resources = await agent.get('/api/v1/resources').expect(200);
    const items = resources.body as { items: { id: string; type: string }[] };
    const doctor = items.items.find((r) => r.type === 'DOCTOR');
    const scan = items.items.find((r) => r.type === 'SCAN_ROOM');
    if (doctor === undefined || scan === undefined) {
      throw new Error('doctor or scanner missing');
    }

    // Use a date the demo-day seed never touches — 2026-08-10 is DEMO_NORMAL_DATE.
    const constraintDate = '2099-03-15';
    const start = new Date('2099-03-15T02:30:00.000Z');
    const end = new Date('2099-03-15T03:00:00.000Z');
    const during = formatTstzrange(start, end);
    const pid = await patientId();
    const clinicId = appContainer.config.CLINIC_ID;

    const raw = postgres(process.env['DATABASE_URL'] ?? '', { max: 1 });
    try {
      const inserted = await raw<[{ id: string }]>`
        INSERT INTO appointment (clinic_id, patient_id, on_date, status)
        VALUES (${clinicId}::uuid, ${pid}::uuid, ${constraintDate}, 'SCHEDULED')
        RETURNING id
      `;
      const appointmentId = inserted[0]?.id;
      if (appointmentId === undefined)
        throw new Error('appointment insert failed');

      await raw`
        INSERT INTO appointment_segment (
          appointment_id, clinic_id, patient_id, seq, kind,
          resource_id, during, resource_during, status
        ) VALUES (
          ${appointmentId}::uuid, ${clinicId}::uuid, ${pid}::uuid,
          1, 'SERVICE', ${doctor.id}::uuid,
          ${during}::tstzrange, ${during}::tstzrange, 'ACTIVE'
        )
      `;

      // Different resource, same patient interval — patient EXCLUDE must fire.
      let code: string | undefined;
      try {
        await raw`
          INSERT INTO appointment_segment (
            appointment_id, clinic_id, patient_id, seq, kind,
            resource_id, during, resource_during, status
          ) VALUES (
            ${appointmentId}::uuid, ${clinicId}::uuid, ${pid}::uuid,
            2, 'SERVICE', ${scan.id}::uuid,
            ${during}::tstzrange, ${during}::tstzrange, 'ACTIVE'
          )
        `;
      } catch (error) {
        code = sqlStateOf(error);
      }
      expect(code).toBe('23P01');
    } finally {
      await raw.end({ timeout: 5 });
    }
  });

  it('cancelling frees slots for a subsequent booking', async () => {
    const pid = await patientId();
    const services = await agent.get('/api/v1/service-types').expect(200);
    const consult = (
      services.body as { items: { id: string; code: string }[] }
    ).items.find((s) => s.code === 'CONSULT');
    if (consult === undefined) throw new Error('CONSULT missing');
    const steps = [
      {
        seq: 1,
        serviceTypeId: consult.id,
        durationMin: 45,
        minGapMin: 0,
        maxGapMin: 0,
        setupMin: 0,
        teardownMin: 0,
      },
    ];
    const date = '2099-03-16';

    const firstSug = await agent
      .post('/api/v1/appointments/suggestions')
      .send({ patientId: pid, date, steps })
      .expect(200);
    const first = firstSug.body as {
      scheduleVersion: number;
      candidates: { start: string }[];
    };
    const booked = await agent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({
        patientId: pid,
        date,
        steps,
        candidate: first.candidates[0],
        scheduleVersion: first.scheduleVersion,
      })
      .expect(201);

    await agent
      .post(
        `/api/v1/appointments/${(booked.body as { appointmentId: string }).appointmentId}/cancel`,
      )
      .send({})
      .expect(200);

    const secondSug = await agent
      .post('/api/v1/appointments/suggestions')
      .send({ patientId: pid, date, steps })
      .expect(200);
    expect(
      (secondSug.body as { candidates: unknown[] }).candidates.length,
    ).toBeGreaterThan(0);
  });

  it('replaying the same Idempotency-Key returns the original 201', async () => {
    const pid = await patientId();
    const services = await agent.get('/api/v1/service-types').expect(200);
    const consult = (
      services.body as { items: { id: string; code: string }[] }
    ).items.find((s) => s.code === 'CONSULT');
    if (consult === undefined) throw new Error('CONSULT missing');
    const steps = [
      {
        seq: 1,
        serviceTypeId: consult.id,
        durationMin: 30,
        minGapMin: 0,
        maxGapMin: 0,
        setupMin: 0,
        teardownMin: 0,
      },
    ];
    const date = '2026-08-11';
    const sug = await agent
      .post('/api/v1/appointments/suggestions')
      .send({ patientId: pid, date, steps })
      .expect(200);
    const body = sug.body as {
      scheduleVersion: number;
      candidates: unknown[];
    };
    const key = randomUUID();
    const payload = {
      patientId: pid,
      date,
      steps,
      candidate: body.candidates[0],
      scheduleVersion: body.scheduleVersion,
    };

    const first = await agent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    const second = await agent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);

    expect(second.body).toEqual(first.body);
  });

  it('a stale scheduleVersion produces 409, not a silent overwrite', async () => {
    const pid = await patientId();
    const services = await agent.get('/api/v1/service-types').expect(200);
    const consult = (
      services.body as { items: { id: string; code: string }[] }
    ).items.find((s) => s.code === 'CONSULT');
    if (consult === undefined) throw new Error('CONSULT missing');
    const steps = [
      {
        seq: 1,
        serviceTypeId: consult.id,
        durationMin: 30,
        minGapMin: 0,
        maxGapMin: 0,
        setupMin: 0,
        teardownMin: 0,
      },
    ];
    const date = '2026-08-12';
    const sug = await agent
      .post('/api/v1/appointments/suggestions')
      .send({ patientId: pid, date, steps })
      .expect(200);
    const body = sug.body as {
      scheduleVersion: number;
      candidates: unknown[];
    };

    await agent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({
        patientId: pid,
        date,
        steps,
        candidate: body.candidates[0],
        scheduleVersion: body.scheduleVersion,
      })
      .expect(201);

    const conflict = await agent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({
        patientId: pid,
        date,
        steps,
        candidate: body.candidates[1] ?? body.candidates[0],
        scheduleVersion: body.scheduleVersion, // stale
      })
      .expect(409);

    expect((conflict.body as { type: string }).type).toMatch(
      /stale-schedule|slot-conflict/,
    );
  });

  it('every mutation writes exactly one audit_log row', async () => {
    const before = await appContainer.db.execute(
      sql`SELECT count(*)::int AS n FROM audit_log`,
    );
    const nBefore = (before[0] as { n: number }).n;

    const pid = await patientId();
    const services = await agent.get('/api/v1/service-types').expect(200);
    const consult = (
      services.body as { items: { id: string; code: string }[] }
    ).items.find((s) => s.code === 'CONSULT');
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
    const date = '2026-08-13';
    const sug = await agent
      .post('/api/v1/appointments/suggestions')
      .send({ patientId: pid, date, steps })
      .expect(200);
    const body = sug.body as {
      scheduleVersion: number;
      candidates: unknown[];
    };
    await agent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({
        patientId: pid,
        date,
        steps,
        candidate: body.candidates[0],
        scheduleVersion: body.scheduleVersion,
      })
      .expect(201);

    const after = await appContainer.db.execute(
      sql`SELECT count(*)::int AS n FROM audit_log`,
    );
    expect((after[0] as { n: number }).n).toBe(nBefore + 1);
  });

  it('no patient identifier appears in captured log output', async () => {
    const lines: string[] = [];
    const log = pino(
      { level: 'info' },
      {
        write(chunk: string) {
          lines.push(chunk);
        },
      },
    );
    const { app } = createApp(appContainer, { log });
    const localRaw = request(app);
    const token = await signIn(localRaw, 'RECEPTIONIST');
    const pid = await patientId();

    // Bodies carry identifiers; the req serializer must not echo them.
    await localRaw
      .get('/api/v1/patients')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await localRaw
      .post('/api/v1/appointments/suggestions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId: pid,
        date: '2099-01-06',
        steps: [
          {
            seq: 1,
            serviceTypeId: randomUUID(),
            durationMin: 30,
            minGapMin: 0,
            maxGapMin: 0,
            setupMin: 0,
            teardownMin: 0,
          },
        ],
      })
      .expect(400);

    const blob = lines.join('\n');
    expect(blob).not.toContain(SEED_PATIENT_IDENTIFIERS.fullName);
    expect(blob).not.toContain(SEED_PATIENT_IDENTIFIERS.mrn);
    expect(blob).not.toContain(SEED_PATIENT_IDENTIFIERS.phone);
    expect(blob).not.toContain(SEED_PATIENT_IDENTIFIERS.dateOfBirth);
  });
});

describe('concurrent booking stress', () => {
  it('passes 20 consecutive dual-booking races', async () => {
    const pid = await patientId();
    const { steps } = await p4Steps();

    for (let i = 0; i < 20; i++) {
      const date = `2027-01-${String(4 + (i % 20)).padStart(2, '0')}`;
      // Skip weekends roughly by using weekdays in January 2027 starting Mon 4th.
      const day = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (day === 0 || day === 6) continue;

      const suggestions = await agent
        .post('/api/v1/appointments/suggestions')
        .send({ patientId: pid, date, steps })
        .expect(200);
      const sug = suggestions.body as {
        scheduleVersion: number;
        candidates: unknown[];
      };
      if (sug.candidates.length === 0) continue;

      const payload = {
        patientId: pid,
        date,
        steps,
        candidate: sug.candidates[0],
        scheduleVersion: sug.scheduleVersion,
      };
      const [a, b] = await Promise.all([
        agent
          .post('/api/v1/appointments')
          .set('Idempotency-Key', randomUUID())
          .send(payload),
        agent
          .post('/api/v1/appointments')
          .set('Idempotency-Key', randomUUID())
          .send(payload),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
    }
  }, 180_000);
});
