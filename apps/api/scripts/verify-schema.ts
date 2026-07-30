/**
 * Verifies the M0 database acceptance criteria against a real Postgres.
 *
 * These claims cannot be checked by a type system or a unit test — they are
 * assertions about what Postgres itself will refuse to store — so they are
 * checked here and run in CI against a Postgres 16 service container.
 *
 * This is not the integration test suite. That arrives in M2 with the API, using
 * Testcontainers. This script exists because the guarantees in ADR 0001 are the
 * foundation everything else is built on, and shipping M0 without evidence that
 * they hold would mean taking the schema on faith.
 *
 * Run against a throwaway database: it writes rows and does not clean up.
 */
import { fileURLToPath } from 'node:url';

import { ENUM_VALUES } from '@scanflow/contracts';
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl === '') {
  process.stderr.write('DATABASE_URL is not set.\n');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string | undefined;
}
const checks: Check[] = [];

function record(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
}

/** postgres.js attaches the SQLSTATE to `code`; narrow rather than cast to any. */
function sqlStateOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

function constraintOf(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'constraint_name' in error
  ) {
    const { constraint_name: name } = error;
    if (typeof name === 'string') return name;
  }
  return undefined;
}

async function expectRejection(
  name: string,
  expectedSqlState: string,
  expectedConstraint: string,
  attempt: () => Promise<unknown>,
): Promise<void> {
  try {
    await attempt();
    record(name, false, 'the insert succeeded; it should have been rejected');
  } catch (error) {
    const state = sqlStateOf(error);
    const constraint = constraintOf(error);
    if (state !== expectedSqlState) {
      record(
        name,
        false,
        `expected SQLSTATE ${expectedSqlState}, got ${String(state)}`,
      );
      return;
    }
    if (constraint !== expectedConstraint) {
      record(
        name,
        false,
        `expected constraint ${expectedConstraint}, got ${String(constraint)}`,
      );
      return;
    }
    record(name, true, `SQLSTATE ${state} from ${constraint}`);
  }
}

/**
 * Unwraps a `RETURNING id`. Returning a plain `string` rather than
 * `string | undefined` matters: TypeScript does not carry a narrowing from an
 * `if (x === undefined) throw` into a nested closure, so the ids would go back to
 * being optional inside the helpers below and every query using them would fail
 * to typecheck.
 */
function requireId(rows: readonly { id: string }[], what: string): string {
  const row = rows[0];
  if (row === undefined) throw new Error(`${what} insert returned no id`);
  return row.id;
}

async function expectSuccess(
  name: string,
  attempt: () => Promise<unknown>,
): Promise<void> {
  try {
    await attempt();
    record(name, true, undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record(name, false, message);
  }
}

try {
  // --- Migrations -----------------------------------------------------------
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder });
  record('migrations apply to an empty database', true, undefined);

  const [firstCount] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations
  `;
  await migrate(db, { migrationsFolder });
  const [secondCount] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations
  `;
  record(
    'a second `db:migrate` is a no-op',
    firstCount?.count === secondCount?.count,
    `applied rows before=${String(firstCount?.count)} after=${String(secondCount?.count)}`,
  );

  const [ext] = await sql<{ installed: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') AS installed
  `;
  record('btree_gist is installed', ext?.installed === true, undefined);

  // --- Enum labels match the contracts package -----------------------------
  for (const [typeName, expected] of Object.entries(ENUM_VALUES)) {
    const rows = await sql<{ label: string }[]>`
      SELECT e.enumlabel AS label
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = ${typeName}
      ORDER BY e.enumsortorder
    `;
    const actual = rows.map((r) => r.label);
    record(
      `enum ${typeName} matches @scanflow/contracts`,
      actual.length === expected.length &&
        actual.every((l, i) => l === expected[i]),
      `db=[${actual.join(',')}] contracts=[${expected.join(',')}]`,
    );
  }

  // --- Fixtures ------------------------------------------------------------
  // Synthetic throughout. Real patient data never goes near this repository.
  const clinicId = requireId(
    await sql<{ id: string }[]>`
      INSERT INTO clinic (name, timezone) VALUES ('Verify Clinic', 'Asia/Kolkata')
      RETURNING id
    `,
    'clinic',
  );
  const patientAId = requireId(
    await sql<{ id: string }[]>`
      INSERT INTO patient (clinic_id, mrn, full_name)
      VALUES (${clinicId}, 'MRN-A', 'Patient A')
      RETURNING id
    `,
    'patient A',
  );
  const patientBId = requireId(
    await sql<{ id: string }[]>`
      INSERT INTO patient (clinic_id, mrn, full_name)
      VALUES (${clinicId}, 'MRN-B', 'Patient B')
      RETURNING id
    `,
    'patient B',
  );
  const scannerId = requireId(
    await sql<{ id: string }[]>`
      INSERT INTO resource (clinic_id, type, name)
      VALUES (${clinicId}, 'SCAN_ROOM', 'Scanner 1')
      RETURNING id
    `,
    'scanner',
  );
  const doctorId = requireId(
    await sql<{ id: string }[]>`
      INSERT INTO resource (clinic_id, type, name)
      VALUES (${clinicId}, 'DOCTOR', 'Dr Ainsley')
      RETURNING id
    `,
    'doctor',
  );

  async function newAppointment(patientId: string): Promise<string> {
    return requireId(
      await sql<{ id: string }[]>`
        INSERT INTO appointment (clinic_id, patient_id, on_date)
        VALUES (${clinicId}, ${patientId}, '2026-08-03')
        RETURNING id
      `,
      'appointment',
    );
  }

  function insertServiceSegment(args: {
    appointmentId: string;
    patientId: string;
    resourceId: string;
    seq: number;
    from: string;
    to: string;
    status?: 'ACTIVE' | 'CANCELLED';
  }): Promise<unknown> {
    const range = `[${args.from},${args.to})`;
    return sql`
      INSERT INTO appointment_segment
        (appointment_id, clinic_id, patient_id, seq, kind, resource_id, during, resource_during, status)
      VALUES
        (${args.appointmentId}, ${clinicId}, ${args.patientId}, ${args.seq}, 'SERVICE',
         ${args.resourceId}, ${range}::tstzrange, ${range}::tstzrange,
         ${args.status ?? 'ACTIVE'})
    `;
  }

  const apptA = await newAppointment(patientAId);
  const apptB = await newAppointment(patientBId);

  await expectSuccess('a first SERVICE segment inserts', () =>
    insertServiceSegment({
      appointmentId: apptA,
      patientId: patientAId,
      resourceId: scannerId,
      seq: 1,
      from: '2026-08-03 09:00:00+00',
      to: '2026-08-03 09:30:00+00',
    }),
  );

  // --- The two guarantees from ADR 0001 ------------------------------------
  await expectRejection(
    'overlapping ACTIVE segments on one resource are rejected',
    '23P01',
    'no_resource_double_book',
    () =>
      insertServiceSegment({
        appointmentId: apptB,
        patientId: patientBId,
        resourceId: scannerId,
        seq: 1,
        from: '2026-08-03 09:15:00+00',
        to: '2026-08-03 09:45:00+00',
      }),
  );

  await expectRejection(
    'overlapping ACTIVE segments for one patient are rejected',
    '23P01',
    'no_patient_double_book',
    () =>
      insertServiceSegment({
        appointmentId: apptA,
        patientId: patientAId,
        resourceId: doctorId,
        seq: 2,
        from: '2026-08-03 09:15:00+00',
        to: '2026-08-03 09:45:00+00',
      }),
  );

  // Half-open ranges: a segment ending at 09:30 and one starting at 09:30 must
  // not be treated as overlapping, or every back-to-back chain breaks.
  await expectSuccess(
    'an abutting segment at the same instant is allowed',
    () =>
      insertServiceSegment({
        appointmentId: apptB,
        patientId: patientBId,
        resourceId: scannerId,
        seq: 1,
        from: '2026-08-03 09:30:00+00',
        to: '2026-08-03 10:00:00+00',
      }),
  );

  // The partial WHERE clause is what makes cancellation free the slot without
  // deleting the row.
  await sql`
    UPDATE appointment_segment SET status = 'CANCELLED'
    WHERE appointment_id = ${apptA} AND seq = 1
  `;
  await expectSuccess('cancelling a segment frees its slot', () =>
    insertServiceSegment({
      appointmentId: apptB,
      patientId: patientBId,
      resourceId: scannerId,
      seq: 2,
      from: '2026-08-03 09:00:00+00',
      to: '2026-08-03 09:30:00+00',
    }),
  );

  // --- Shape checks the CHECK constraints own ------------------------------
  await expectRejection(
    'a DELAY carrying a resource is rejected',
    '23514',
    'appointment_segment_check',
    () =>
      sql`
        INSERT INTO appointment_segment
          (appointment_id, clinic_id, patient_id, seq, kind, resource_id, during, resource_during)
        VALUES
          (${apptA}, ${clinicId}, ${patientAId}, 9, 'DELAY', ${doctorId},
           '[2026-08-03 14:00:00+00,2026-08-03 15:00:00+00)'::tstzrange,
           '[2026-08-03 14:00:00+00,2026-08-03 15:00:00+00)'::tstzrange)
      `,
  );

  await expectSuccess(
    'a DELAY with no resource inserts',
    () =>
      sql`
      INSERT INTO appointment_segment
        (appointment_id, clinic_id, patient_id, seq, kind, during)
      VALUES
        (${apptA}, ${clinicId}, ${patientAId}, 10, 'DELAY',
         '[2026-08-03 14:00:00+00,2026-08-03 15:00:00+00)'::tstzrange)
    `,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  record('script completed without an unexpected error', false, message);
} finally {
  await sql.end();
}

const failed = checks.filter((c) => !c.ok);
const lines = checks.map(
  (c) =>
    `  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail === undefined ? '' : ` — ${c.detail}`}`,
);
process.stdout.write(
  `Schema verification (${String(checks.length)} checks)\n${lines.join('\n')}\n`,
);

if (failed.length > 0) {
  process.stderr.write(`\n${String(failed.length)} check(s) failed.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('\nAll schema checks passed.\n');
}
