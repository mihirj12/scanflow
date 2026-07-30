# Open questions and deviations

Where the build specification was ambiguous, self-contradictory, or not
implementable as literally written, the simplest correct interpretation was
implemented and recorded here. Nothing in this list was decided silently.

Entries are grouped by whether they need a human answer or are simply a
documented deviation.

---

## Needs a decision from the clinic

### Q1 — Do `resource_working_hours` and `resource_exception` need `clinic_id`?

The convention is `clinic_id` on every tenant-scoped table, no exceptions. These
two tables are the exception: they reach the tenant through `resource_id`.

Implemented as specified (no `clinic_id`), because both are always queried
through a resource that has already been scoped to a clinic, so the column would
be redundant and could disagree with `resource.clinic_id`.

**Revisit if** row-level security is ever added, which would want the tenant key
present on every table it protects.

### Q2 — Is a 20-minute step ever clinically necessary?

Validation rule 4 requires every duration and gap to be a multiple of the
clinic's `slot_minutes` (15). A 20-minute step is therefore not representable.
The stated resolution is that `slot_minutes` becomes 5 clinic-wide rather than
adding a per-step workaround.

Needs confirmation that no real protocol uses a duration outside the 15-minute
grid before the presets are treated as final.

### Q3 — Are `setup_min` / `teardown_min` ever non-zero in practice?

Columns and engine support exist; every seeded value is 0 and there is no UI, per
spec 2.4. Worth asking whether scanner turnaround or room cleaning time should be
modelled here, because if so the two intervals per segment stop being identical
and the grid needs to show the difference.

---

## Deviations from the specification, with reasons

### D1 — The `(lower(during)::date)` index expression cannot be created

Spec 3.4 asks for:

```sql
CREATE INDEX ON appointment_segment (clinic_id, (lower(during)::date));
```

Postgres rejects this. Casting `timestamptz` to `date` depends on the session
`TimeZone` setting, which makes it `STABLE` rather than `IMMUTABLE`, and an index
expression must be `IMMUTABLE`. The statement fails with _"functions in index
expression must be marked IMMUTABLE"_.

**Implemented instead:**

```sql
CREATE INDEX appointment_segment_clinic_start_idx
  ON appointment_segment (clinic_id, lower(during));
```

`lower(anyrange)` is immutable. Day queries scan a half-open instant range for the
clinic-day rather than comparing a cast date, which is more index-friendly anyway.
The alternative, indexing `((lower(during) AT TIME ZONE 'UTC')::date)`, is
immutable but bakes UTC into the index and reads worse.

### D2 — `drizzle-kit` is not used, and there is no `drizzle.config.ts`

Migrations are hand-written SQL, as spec 3.4 requires, because Drizzle's schema
builder cannot express `EXCLUDE USING gist`. Given that, `drizzle-kit generate`
would be actively harmful: it would diff against a snapshot the hand-written
migration never produced and try to recreate the schema.

`drizzle-orm`'s own migrator applies the SQL and tracks applied files by hash in
`__drizzle_migrations`, which is what makes `pnpm db:migrate` idempotent. So
`drizzle-kit` is not a dependency at all, and `apps/api/src/infra/db/schema.ts`
exists only to type queries. A comment at the top of that file says so.

### D3 — `docker-compose.yml` defines only `postgres` and `redis`

Spec 3.3 lists four services. The `api` and `web` services are added in M2 and M3
alongside their Dockerfiles, when there is an application to run. Defining them
now would mean either a service whose `command` does not exist or a Dockerfile
building nothing, both of which are the placeholder files the ground rules ban.

The M0 acceptance criterion — "`docker compose up` brings up Postgres and Redis" —
is met exactly.

### D4 — TypeScript is pinned to 5.9.3, not 7.x

TypeScript 7.0.2 is current, but `typescript-eslint@8.65.0` declares
`typescript: '>=4.8.4 <6.1.0'`. Type-aware linting is load-bearing here: the ban
on `any`, the ban on unexplained `@ts-expect-error`, and the layering rules all
depend on it. Losing the linter to gain a compiler version this project does not
need is the wrong trade.

5.9.3 rather than 6.0.3 (which would also satisfy the peer range) for the plainer
reason that Drizzle, Vite 8, and Vitest 4 are all well exercised against it.

**Revisit when** typescript-eslint supports TypeScript 7.

### D5 — `eslint-plugin-import-x` instead of `eslint-plugin-import`

Spec 3.2 names the `import/no-restricted-paths` rule. `eslint-plugin-import@2.32`
does not declare support for ESLint 10, which is current. `eslint-plugin-import-x`
is the maintained fork, supports ESLint 10, and provides the same rule as
`import-x/no-restricted-paths`. The architecture boundary is enforced identically.

### D6 — React 18, not 19

Spec 3.1 says React 18, so React 18.3.1 is installed, though React 19.2 is
current. Flagged because a reviewer will notice, and it is a one-line change if the
answer is "use 19".

### D7 — `pnpm test:integration` currently does nothing

No package declares that script yet; integration tests arrive with the API in M2.
The Turbo task and the CI job exist now so that branch protection can require the
`test:integration` check from the first commit rather than being edited later.

### D8 — What M0 puts in `scheduling-core` and `contracts`

M0 is specified as "no application logic", but the ground rules also ban
placeholder files and empty directories. Both packages therefore contain the
smallest genuinely useful, tested thing that M1 and M2 build directly on:

- `scheduling-core` — the slot bitmask primitives (`slotRange`, `isFree`,
  `occupy`) given verbatim in spec 4.2, with unit tests.
- `contracts` — the four enum label tuples from spec 2.11, with the Zod schemas,
  TypeScript unions, and Drizzle `pgEnum` all derived from them.

Nothing else from M1 or M2 is scaffolded. The `Candidate` / `EngineStep` /
`PlacementRequest` API is deliberately absent.

### D9 — Local verification of the database constraints was deferred to CI

Docker is not installed on the development machine used for M0 (no Docker
Desktop, no WSL2), so `docker compose up`, `pnpm db:migrate` against a live
Postgres, and the two `psql` exclusion-constraint checks in the M0 acceptance list
have **not** been run locally. The CI workflow runs the migration against a real
Postgres 16 service container and asserts SQLSTATE `23P01` for both the resource
and the patient constraint, so these are verified — by CI, not by hand. See the
verification table in the M0 pull request.

### D10 — `audit_log.clinic_id` has no foreign key

As specified. Audit rows must survive the deletion of anything they describe, so
the absence of the constraint is deliberate rather than an oversight.

### D11 — Prettier does not format migration SQL

Prettier has no SQL parser. `apps/api/drizzle/**/*.sql` is in `.prettierignore`,
which is also what we want independently: the column alignment in the DDL is read
as a specification and should not be reflowed.

### D12 — The Vitest project list covers `packages/*` only

`apps/api` joins in M2 and `apps/web` in M3, when they have tests. Listing a
directory with no test files makes the runner fail rather than pass vacuously.
