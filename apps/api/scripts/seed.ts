import 'dotenv/config';

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { and, eq } from 'drizzle-orm';

import { createDb, closeDb } from '../src/infra/db/client.js';
import {
  appointmentTemplate,
  clinic,
  patient,
  resource,
  resourceWorkingHours,
  serviceType,
  templateStep,
} from '../src/infra/db/schema.js';

import {
  DEFAULT_SEED_PASSWORD,
  DEMO_BUSY_DATE,
  DEMO_NORMAL_DATE,
  SEED_USERS,
  seedDemoDays,
  seedUsers,
} from './seed-demo-days.js';

/** Stable id so local .env and CI share the same CLINIC_ID. */
export const SEED_CLINIC_ID = '11111111-1111-4111-8111-111111111111';

/** Synthetic identifiers used only in seed data — never log these. */
export const SEED_PATIENT_IDENTIFIERS = {
  mrn: 'SF-0001',
  fullName: 'Test Patient',
  dateOfBirth: '1980-01-15',
  phone: '+10000000000',
} as const;

export const SERVICE = {
  CONSULT: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  INJECT: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  SCAN: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  PROCESS: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
} as const;

export const RESOURCE = {
  DOCTOR: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  NMT: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  SCAN: '99999999-9999-4999-8999-999999999999',
} as const;

export async function seedDatabase(databaseUrl: string): Promise<void> {
  const db = createDb(databaseUrl, 1);

  try {
    await db
      .insert(clinic)
      .values({
        id: SEED_CLINIC_ID,
        name: 'ScanFlow Demo Clinic',
        timezone: 'Asia/Kolkata',
        dayStart: '08:00:00',
        dayEnd: '17:00:00',
        slotMinutes: 15,
      })
      .onConflictDoNothing();

    await db
      .insert(resource)
      .values([
        {
          id: RESOURCE.DOCTOR,
          clinicId: SEED_CLINIC_ID,
          type: 'DOCTOR',
          name: 'Dr. Ada',
          modalities: [],
          displayOrder: 1,
          active: true,
        },
        {
          id: RESOURCE.NMT,
          clinicId: SEED_CLINIC_ID,
          type: 'NMT_ROOM',
          name: 'NMT Room 1',
          modalities: [],
          displayOrder: 2,
          active: true,
        },
        {
          id: RESOURCE.SCAN,
          clinicId: SEED_CLINIC_ID,
          type: 'SCAN_ROOM',
          name: 'Scanner 1',
          modalities: ['SPECT'],
          displayOrder: 3,
          active: true,
        },
      ])
      .onConflictDoNothing();

    // Mon–Fri 08:00–17:00 for every resource.
    for (const resourceId of Object.values(RESOURCE)) {
      for (const weekday of [1, 2, 3, 4, 5]) {
        const existing = await db
          .select()
          .from(resourceWorkingHours)
          .where(
            and(
              eq(resourceWorkingHours.resourceId, resourceId),
              eq(resourceWorkingHours.weekday, weekday),
            ),
          )
          .limit(1);
        if (existing.length === 0) {
          await db.insert(resourceWorkingHours).values({
            resourceId,
            weekday,
            startsAt: '08:00:00',
            endsAt: '17:00:00',
          });
        }
      }
    }

    await db
      .insert(serviceType)
      .values([
        {
          id: SERVICE.CONSULT,
          clinicId: SEED_CLINIC_ID,
          code: 'CONSULT',
          name: 'Consultation',
          resourceType: 'DOCTOR',
          requiredModality: null,
        },
        {
          id: SERVICE.INJECT,
          clinicId: SEED_CLINIC_ID,
          code: 'INJECT',
          name: 'Tracer injection',
          resourceType: 'NMT_ROOM',
          requiredModality: null,
        },
        {
          id: SERVICE.SCAN,
          clinicId: SEED_CLINIC_ID,
          code: 'SCAN',
          name: 'Scan',
          resourceType: 'SCAN_ROOM',
          requiredModality: null,
        },
        {
          id: SERVICE.PROCESS,
          clinicId: SEED_CLINIC_ID,
          code: 'PROCESS',
          name: 'Post-scan processing',
          resourceType: 'NMT_ROOM',
          requiredModality: null,
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(patient)
      .values({
        clinicId: SEED_CLINIC_ID,
        mrn: SEED_PATIENT_IDENTIFIERS.mrn,
        fullName: SEED_PATIENT_IDENTIFIERS.fullName,
        dateOfBirth: SEED_PATIENT_IDENTIFIERS.dateOfBirth,
        phone: SEED_PATIENT_IDENTIFIERS.phone,
      })
      .onConflictDoNothing();

    interface StepSeed {
      seq: number;
      serviceTypeId: string;
      durationMin: number;
      minGapMin: number;
      maxGapMin: number;
      sameResourceAsSeq?: number;
    }

    const presets: {
      code: string;
      name: string;
      steps: StepSeed[];
    }[] = [
      {
        code: 'P1',
        name: 'Consult only',
        steps: [
          {
            seq: 1,
            serviceTypeId: SERVICE.CONSULT,
            durationMin: 30,
            minGapMin: 0,
            maxGapMin: 0,
          },
        ],
      },
      {
        code: 'P2',
        name: 'Scan only',
        steps: [
          {
            seq: 1,
            serviceTypeId: SERVICE.SCAN,
            durationMin: 30,
            minGapMin: 0,
            maxGapMin: 0,
          },
        ],
      },
      {
        code: 'P3',
        name: 'Standard scan',
        steps: [
          {
            seq: 1,
            serviceTypeId: SERVICE.CONSULT,
            durationMin: 15,
            minGapMin: 0,
            maxGapMin: 0,
          },
          {
            seq: 2,
            serviceTypeId: SERVICE.SCAN,
            durationMin: 30,
            minGapMin: 0,
            maxGapMin: 0,
          },
          {
            seq: 3,
            serviceTypeId: SERVICE.PROCESS,
            durationMin: 30,
            minGapMin: 0,
            maxGapMin: 0,
          },
        ],
      },
      {
        code: 'P4',
        name: 'Uptake study',
        steps: [
          {
            seq: 1,
            serviceTypeId: SERVICE.CONSULT,
            durationMin: 45,
            minGapMin: 0,
            maxGapMin: 0,
          },
          {
            seq: 2,
            serviceTypeId: SERVICE.INJECT,
            durationMin: 30,
            minGapMin: 0,
            maxGapMin: 0,
          },
          {
            seq: 3,
            serviceTypeId: SERVICE.SCAN,
            durationMin: 30,
            minGapMin: 60,
            maxGapMin: 90,
          },
          {
            seq: 4,
            serviceTypeId: SERVICE.SCAN,
            durationMin: 30,
            minGapMin: 0,
            maxGapMin: 0,
            sameResourceAsSeq: 3,
          },
          {
            seq: 5,
            serviceTypeId: SERVICE.CONSULT,
            durationMin: 30,
            minGapMin: 0,
            maxGapMin: 0,
            sameResourceAsSeq: 1,
          },
        ],
      },
      {
        code: 'P5',
        name: 'Two-phase delayed study',
        steps: [
          {
            seq: 1,
            serviceTypeId: SERVICE.CONSULT,
            durationMin: 30,
            minGapMin: 0,
            maxGapMin: 0,
          },
          {
            seq: 2,
            serviceTypeId: SERVICE.INJECT,
            durationMin: 15,
            minGapMin: 0,
            maxGapMin: 0,
          },
          {
            seq: 3,
            serviceTypeId: SERVICE.SCAN,
            durationMin: 30,
            minGapMin: 30,
            maxGapMin: 30,
          },
          {
            seq: 4,
            serviceTypeId: SERVICE.SCAN,
            durationMin: 30,
            minGapMin: 0,
            maxGapMin: 0,
            sameResourceAsSeq: 3,
          },
          {
            seq: 5,
            serviceTypeId: SERVICE.CONSULT,
            durationMin: 15,
            minGapMin: 0,
            maxGapMin: 0,
            sameResourceAsSeq: 1,
          },
        ],
      },
      {
        code: 'P6',
        name: 'Injection and same-day imaging',
        steps: [
          {
            seq: 1,
            serviceTypeId: SERVICE.INJECT,
            durationMin: 30,
            minGapMin: 0,
            maxGapMin: 0,
          },
          {
            seq: 2,
            serviceTypeId: SERVICE.SCAN,
            durationMin: 45,
            minGapMin: 30,
            maxGapMin: 30,
          },
          {
            seq: 3,
            serviceTypeId: SERVICE.CONSULT,
            durationMin: 30,
            minGapMin: 0,
            maxGapMin: 0,
          },
        ],
      },
    ];

    for (const preset of presets) {
      const existing = await db
        .select()
        .from(appointmentTemplate)
        .where(
          and(
            eq(appointmentTemplate.clinicId, SEED_CLINIC_ID),
            eq(appointmentTemplate.code, preset.code),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

      const inserted = await db
        .insert(appointmentTemplate)
        .values({
          clinicId: SEED_CLINIC_ID,
          code: preset.code,
          name: preset.name,
          isPreset: true,
          active: true,
        })
        .returning();
      const header = inserted[0];
      if (header === undefined) continue;
      await db.insert(templateStep).values(
        preset.steps.map((step) => ({
          templateId: header.id,
          seq: step.seq,
          serviceTypeId: step.serviceTypeId,
          durationMin: step.durationMin,
          minGapMin: step.minGapMin,
          maxGapMin: step.maxGapMin,
          setupMin: 0,
          teardownMin: 0,
          sameResourceAsSeq: step.sameResourceAsSeq,
        })),
      );
    }

    const password = process.env['SEED_USER_PASSWORD'] ?? DEFAULT_SEED_PASSWORD;
    const users = await seedUsers(
      db,
      SEED_CLINIC_ID,
      password,
      RESOURCE.DOCTOR,
    );
    const days = await seedDemoDays(db, {
      clinicId: SEED_CLINIC_ID,
      services: SERVICE,
      resources: RESOURCE,
    });

    process.stdout.write(
      `seed complete\n` +
        `  CLINIC_ID=${SEED_CLINIC_ID}\n` +
        `  resources=3 serviceTypes=4 presets=6\n` +
        `  users created=${String(users)} (login with ${SEED_USERS[0].email})\n` +
        `  demo days: ${DEMO_NORMAL_DATE} normal (+${String(days.normal)}), ` +
        `${DEMO_BUSY_DATE} near-full (+${String(days.busy)})\n`,
    );
  } finally {
    await closeDb(db);
  }
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined) throw new Error('DATABASE_URL is required');
  await seedDatabase(url);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
