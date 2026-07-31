import { hash } from '@node-rs/argon2';
import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';

import type { Db } from '../src/infra/db/client.js';
import {
  appointment,
  appointmentSegment,
  appointmentStep,
  appUser,
  patient,
} from '../src/infra/db/schema.js';
import { formatTstzrange } from '../src/infra/db/tstzrange.js';
import { ARGON2ID } from '../src/modules/auth/ports.js';

/**
 * Demo data that needs the whole schema: staff logins, extra patients, and two
 * contrasting clinic-days. Kept out of `seed.ts` so that file stays the minimal
 * reference data every test relies on.
 */

export const SEED_ZONE = 'Asia/Kolkata';

/** A quiet, realistic Monday, and the near-full Tuesday that follows it. */
export const DEMO_NORMAL_DATE = '2026-08-10';
export const DEMO_BUSY_DATE = '2026-08-11';

/**
 * Demo passwords are seed data, not secrets — they exist so a reviewer can sign
 * in. Override with SEED_USER_PASSWORD; a real deployment creates users through
 * an invite flow instead of a seed script.
 */
export const SEED_USERS = [
  {
    email: 'reception@scanflow.local',
    displayName: 'Reception Desk',
    role: 'RECEPTIONIST',
  },
  {
    email: 'clinician@scanflow.local',
    displayName: 'Dr. Ada Lovelace',
    role: 'CLINICIAN',
  },
  {
    email: 'admin@scanflow.local',
    displayName: 'Clinic Administrator',
    role: 'ADMIN',
  },
] as const;

export const DEFAULT_SEED_PASSWORD = 'ScanFlow!Demo1';

interface Ids {
  clinicId: string;
  services: { CONSULT: string; INJECT: string; SCAN: string; PROCESS: string };
  resources: { DOCTOR: string; NMT: string; SCAN: string };
}

interface SeededStep {
  seq: number;
  serviceTypeId: string;
  resourceId: string | null;
  /** Minutes after 08:00 clinic-local. */
  startMin: number;
  durationMin: number;
  kind: 'SERVICE' | 'DELAY';
}

function instant(date: string, minutesFromOpen: number): Date {
  const open = DateTime.fromISO(`${date}T08:00`, { zone: SEED_ZONE });
  return open.plus({ minutes: minutesFromOpen }).toJSDate();
}

export async function seedUsers(
  db: Db,
  clinicId: string,
  password: string,
  doctorResourceId: string,
): Promise<number> {
  let created = 0;
  for (const user of SEED_USERS) {
    const resourceId = user.role === 'CLINICIAN' ? doctorResourceId : null;
    const existing = await db
      .select({ id: appUser.id })
      .from(appUser)
      .where(and(eq(appUser.clinicId, clinicId), eq(appUser.email, user.email)))
      .limit(1);
    if (existing.length > 0) {
      if (resourceId !== null) {
        await db
          .update(appUser)
          .set({ resourceId })
          .where(eq(appUser.id, existing[0]?.id ?? ''));
      }
      continue;
    }

    await db.insert(appUser).values({
      clinicId,
      email: user.email,
      passwordHash: await hash(password, { algorithm: ARGON2ID }),
      displayName: user.displayName,
      role: user.role,
      resourceId,
      active: true,
    });
    created += 1;
  }
  return created;
}

/** Synthetic patients. Names and MRNs are fictional; never log them. */
async function seedDemoPatients(
  db: Db,
  clinicId: string,
  count: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 2; index < 2 + count; index++) {
    const mrn = `SF-${String(index).padStart(4, '0')}`;
    const existing = await db
      .select({ id: patient.id })
      .from(patient)
      .where(and(eq(patient.clinicId, clinicId), eq(patient.mrn, mrn)))
      .limit(1);
    const found = existing[0];
    if (found !== undefined) {
      ids.push(found.id);
      continue;
    }
    const inserted = await db
      .insert(patient)
      .values({
        clinicId,
        mrn,
        fullName: `Demo Patient ${String(index)}`,
        dateOfBirth: '1975-06-01',
        phone: `+1000000${String(index).padStart(4, '0')}`,
      })
      .returning({ id: patient.id });
    const row = inserted[0];
    if (row === undefined) throw new Error('patient insert returned no row');
    ids.push(row.id);
  }
  return ids;
}

async function insertAppointment(
  db: Db,
  args: {
    clinicId: string;
    patientId: string;
    date: string;
    steps: SeededStep[];
  },
): Promise<void> {
  const headers = await db
    .insert(appointment)
    .values({
      clinicId: args.clinicId,
      patientId: args.patientId,
      // Null template: this is demo data assembled directly, and a booked
      // appointment owns its chain regardless of where the chain came from.
      templateId: null,
      templateNameAtBooking: null,
      onDate: args.date,
      status: 'SCHEDULED',
      notes: null,
      createdBy: null,
    })
    .returning({ id: appointment.id });
  const header = headers[0];
  if (header === undefined)
    throw new Error('appointment insert returned no row');

  const serviceSteps = args.steps.filter((step) => step.kind === 'SERVICE');
  await db.insert(appointmentStep).values(
    serviceSteps.map((step, index) => {
      const previous = serviceSteps[index - 1];
      const gap =
        previous === undefined
          ? 0
          : step.startMin - (previous.startMin + previous.durationMin);
      return {
        appointmentId: header.id,
        seq: index + 1,
        serviceTypeId: step.serviceTypeId,
        durationMin: step.durationMin,
        minGapMin: gap,
        maxGapMin: gap,
        setupMin: 0,
        teardownMin: 0,
      };
    }),
  );

  await db.insert(appointmentSegment).values(
    args.steps.map((step) => {
      const from = instant(args.date, step.startMin);
      const to = instant(args.date, step.startMin + step.durationMin);
      return {
        appointmentId: header.id,
        clinicId: args.clinicId,
        patientId: args.patientId,
        seq: step.seq,
        kind: step.kind,
        serviceTypeId: step.kind === 'DELAY' ? null : step.serviceTypeId,
        resourceId: step.resourceId,
        during: formatTstzrange(from, to),
        // A DELAY holds the patient and no resource, so it has no resource range.
        resourceDuring:
          step.resourceId === null ? null : formatTstzrange(from, to),
      };
    }),
  );
}

/**
 * Two days a reviewer can compare side by side: a Monday with room to breathe,
 * and a Tuesday where the scanner is nearly solid, so the engine visibly has to
 * work to place an uptake study.
 */
export async function seedDemoDays(
  db: Db,
  ids: Ids,
): Promise<{ normal: number; busy: number }> {
  const alreadySeeded = await db
    .select({ id: appointment.id })
    .from(appointment)
    .where(
      and(
        eq(appointment.clinicId, ids.clinicId),
        eq(appointment.onDate, DEMO_BUSY_DATE),
      ),
    )
    .limit(1);
  if (alreadySeeded.length > 0) return { normal: 0, busy: 0 };

  const patients = await seedDemoPatients(db, ids.clinicId, 16);
  const nextPatient = (() => {
    let cursor = 0;
    return (): string => {
      const id = patients[cursor % patients.length];
      cursor += 1;
      if (id === undefined) throw new Error('no demo patients seeded');
      return id;
    };
  })();

  // --- A normal Monday: five appointments, one of them a full uptake study ---
  let normal = 0;

  await insertAppointment(db, {
    clinicId: ids.clinicId,
    patientId: nextPatient(),
    date: DEMO_NORMAL_DATE,
    steps: [
      {
        seq: 1,
        serviceTypeId: ids.services.CONSULT,
        resourceId: ids.resources.DOCTOR,
        startMin: 0,
        durationMin: 45,
        kind: 'SERVICE',
      },
      {
        seq: 2,
        serviceTypeId: ids.services.INJECT,
        resourceId: ids.resources.NMT,
        startMin: 45,
        durationMin: 30,
        kind: 'SERVICE',
      },
      {
        seq: 3,
        serviceTypeId: ids.services.SCAN,
        resourceId: null,
        startMin: 75,
        durationMin: 75,
        kind: 'DELAY',
      },
      {
        seq: 4,
        serviceTypeId: ids.services.SCAN,
        resourceId: ids.resources.SCAN,
        startMin: 150,
        durationMin: 30,
        kind: 'SERVICE',
      },
      {
        seq: 5,
        serviceTypeId: ids.services.SCAN,
        resourceId: ids.resources.SCAN,
        startMin: 180,
        durationMin: 30,
        kind: 'SERVICE',
      },
      {
        seq: 6,
        serviceTypeId: ids.services.CONSULT,
        resourceId: ids.resources.DOCTOR,
        startMin: 210,
        durationMin: 30,
        kind: 'SERVICE',
      },
    ],
  });
  normal += 1;

  for (const startMin of [270, 330, 420]) {
    await insertAppointment(db, {
      clinicId: ids.clinicId,
      patientId: nextPatient(),
      date: DEMO_NORMAL_DATE,
      steps: [
        {
          seq: 1,
          serviceTypeId: ids.services.CONSULT,
          resourceId: ids.resources.DOCTOR,
          startMin,
          durationMin: 30,
          kind: 'SERVICE',
        },
      ],
    });
    normal += 1;
  }

  await insertAppointment(db, {
    clinicId: ids.clinicId,
    patientId: nextPatient(),
    date: DEMO_NORMAL_DATE,
    steps: [
      {
        seq: 1,
        serviceTypeId: ids.services.SCAN,
        resourceId: ids.resources.SCAN,
        startMin: 300,
        durationMin: 45,
        kind: 'SERVICE',
      },
    ],
  });
  normal += 1;

  // --- A near-full Tuesday: the scanner and the doctor are almost solid ---
  let busy = 0;

  // Scanner: 08:00–16:30 in 45-minute blocks with one 45-minute hole at 12:15.
  for (const startMin of [0, 45, 90, 135, 180, 315, 360, 405, 450, 495]) {
    await insertAppointment(db, {
      clinicId: ids.clinicId,
      patientId: nextPatient(),
      date: DEMO_BUSY_DATE,
      steps: [
        {
          seq: 1,
          serviceTypeId: ids.services.SCAN,
          resourceId: ids.resources.SCAN,
          startMin,
          durationMin: 45,
          kind: 'SERVICE',
        },
      ],
    });
    busy += 1;
  }

  // Doctor: consults back to back through the morning, thinning after lunch.
  for (const startMin of [0, 30, 60, 90, 120, 150, 300, 330, 480]) {
    await insertAppointment(db, {
      clinicId: ids.clinicId,
      patientId: nextPatient(),
      date: DEMO_BUSY_DATE,
      steps: [
        {
          seq: 1,
          serviceTypeId: ids.services.CONSULT,
          resourceId: ids.resources.DOCTOR,
          startMin,
          durationMin: 30,
          kind: 'SERVICE',
        },
      ],
    });
    busy += 1;
  }

  // NMT room: injections in the morning, leaving the afternoon for uptake waits.
  for (const startMin of [30, 90, 150, 210]) {
    await insertAppointment(db, {
      clinicId: ids.clinicId,
      patientId: nextPatient(),
      date: DEMO_BUSY_DATE,
      steps: [
        {
          seq: 1,
          serviceTypeId: ids.services.INJECT,
          resourceId: ids.resources.NMT,
          startMin,
          durationMin: 30,
          kind: 'SERVICE',
        },
      ],
    });
    busy += 1;
  }

  return { normal, busy };
}
