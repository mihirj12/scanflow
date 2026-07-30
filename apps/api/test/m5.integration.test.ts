import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { SEED_PATIENT_IDENTIFIERS } from '../scripts/seed.js';
import { agent, appContainer } from './setup.js';

interface Candidate {
  start: string;
  end: string;
}

async function seedPatient(): Promise<{ id: string; mrn: string }> {
  const patients = await agent.get('/api/v1/patients').expect(200);
  const first = (patients.body as { items: { id: string; mrn: string }[] })
    .items[0];
  if (first === undefined) throw new Error('seed patient missing');
  return first;
}

async function consultServiceId(): Promise<string> {
  const services = await agent.get('/api/v1/service-types').expect(200);
  const consult = (
    services.body as { items: { id: string; code: string }[] }
  ).items.find((service) => service.code === 'CONSULT');
  if (consult === undefined) throw new Error('CONSULT service type missing');
  return consult.id;
}

function singleConsultChain(serviceTypeId: string) {
  return [
    {
      seq: 1,
      serviceTypeId,
      durationMin: 15,
      minGapMin: 0,
      maxGapMin: 0,
      setupMin: 0,
      teardownMin: 0,
    },
  ];
}

/** Books one consult on `date` and returns the new appointment id. */
async function bookConsult(date: string): Promise<string> {
  const patient = await seedPatient();
  const steps = singleConsultChain(await consultServiceId());

  const suggestions = await agent
    .post('/api/v1/appointments/suggestions')
    .send({ patientId: patient.id, date, steps })
    .expect(200);
  const suggested = suggestions.body as {
    scheduleVersion: number;
    candidates: Candidate[];
  };

  const booked = await agent
    .post('/api/v1/appointments')
    .set('Idempotency-Key', randomUUID())
    .send({
      patientId: patient.id,
      date,
      steps,
      candidate: suggested.candidates[0],
      scheduleVersion: suggested.scheduleVersion,
    })
    .expect(201);

  return (booked.body as { appointmentId: string }).appointmentId;
}

async function auditCount(): Promise<number> {
  const rows = await appContainer.db.execute(
    sql`SELECT count(*)::int AS n FROM audit_log`,
  );
  return (rows[0] as { n: number }).n;
}

describe('M5 management endpoints', () => {
  it('GET /patients/:id returns the patient and 404s for an unknown id', async () => {
    const patient = await seedPatient();
    const found = await agent.get(`/api/v1/patients/${patient.id}`).expect(200);
    expect((found.body as { mrn: string }).mrn).toBe(patient.mrn);

    const missing = await agent
      .get(`/api/v1/patients/${randomUUID()}`)
      .expect(404);
    expect((missing.body as { type: string }).type).toMatch(/not-found/);
  });

  it('searches patients by phone as well as name and MRN', async () => {
    const { phone, mrn } = SEED_PATIENT_IDENTIFIERS;
    const byPhone = await agent
      .get(`/api/v1/patients?q=${encodeURIComponent(phone.slice(-6))}`)
      .expect(200);
    expect(
      (byPhone.body as { items: { mrn: string }[] }).items.map((p) => p.mrn),
    ).toContain(mrn);
  });

  it('filters GET /appointments by a patient query', async () => {
    const date = '2026-08-17';
    const appointmentId = await bookConsult(date);

    const matching = await agent
      .get(
        `/api/v1/appointments?date=${date}&q=${encodeURIComponent(SEED_PATIENT_IDENTIFIERS.mrn)}`,
      )
      .expect(200);
    expect(
      (matching.body as { items: { id: string }[] }).items.map((i) => i.id),
    ).toContain(appointmentId);

    const nonMatching = await agent
      .get(`/api/v1/appointments?date=${date}&q=zzz-no-such-patient`)
      .expect(200);
    expect((nonMatching.body as { items: unknown[] }).items).toHaveLength(0);
  });

  it('walks the full status path, one audit row per transition', async () => {
    const appointmentId = await bookConsult('2026-08-18');
    const before = await auditCount();

    for (const [path, expected] of [
      ['check-in', 'CHECKED_IN'],
      ['start', 'IN_PROGRESS'],
      ['complete', 'COMPLETED'],
    ] as const) {
      const response = await agent
        .post(`/api/v1/appointments/${appointmentId}/${path}`)
        .send({})
        .expect(200);
      expect((response.body as { status: string }).status).toBe(expected);
    }

    expect(await auditCount()).toBe(before + 3);
  });

  it('rejects an illegal transition with a 409 problem document', async () => {
    const appointmentId = await bookConsult('2026-08-19');

    // SCHEDULED → COMPLETED skips check-in, so the table must refuse it.
    const rejected = await agent
      .post(`/api/v1/appointments/${appointmentId}/complete`)
      .send({})
      .expect(409);
    expect((rejected.body as { type: string }).type).toMatch(
      /invalid-status-transition/,
    );
  });

  it('cancelling frees the slot for a new booking at the same time', async () => {
    const date = '2026-08-20';
    const patient = await seedPatient();
    const steps = singleConsultChain(await consultServiceId());

    const first = await agent
      .post('/api/v1/appointments/suggestions')
      .send({ patientId: patient.id, date, steps })
      .expect(200);
    const firstBody = first.body as {
      scheduleVersion: number;
      candidates: Candidate[];
    };
    const slot = firstBody.candidates[0];
    if (slot === undefined) throw new Error('no candidate for cancel fixture');

    const booked = await agent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({
        patientId: patient.id,
        date,
        steps,
        candidate: slot,
        scheduleVersion: firstBody.scheduleVersion,
      })
      .expect(201);
    const appointmentId = (booked.body as { appointmentId: string })
      .appointmentId;

    const cancelled = await agent
      .post(`/api/v1/appointments/${appointmentId}/cancel`)
      .send({ reason: 'Patient rang to postpone' })
      .expect(200);
    const version = (cancelled.body as { scheduleVersion: number })
      .scheduleVersion;

    // The freed slot must be offered again and accept a booking.
    const rebooked = await agent
      .post('/api/v1/appointments')
      .set('Idempotency-Key', randomUUID())
      .send({
        patientId: patient.id,
        date,
        steps,
        candidate: slot,
        scheduleVersion: version,
      })
      .expect(201);
    expect((rebooked.body as { appointmentId: string }).appointmentId).not.toBe(
      appointmentId,
    );

    const schedule = await agent
      .get(`/api/v1/schedule?date=${date}`)
      .expect(200);
    const active = (
      schedule.body as {
        appointments: { id: string; status: string }[];
      }
    ).appointments.filter((appointment) => appointment.status !== 'CANCELLED');
    expect(active.map((appointment) => appointment.id)).not.toContain(
      appointmentId,
    );
  });
});
