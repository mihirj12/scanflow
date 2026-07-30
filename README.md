# ScanFlow

Appointment scheduling for a radiology clinic, built around the thing that makes
radiology scheduling hard: **an appointment is not a booking, it is an ordered
chain of segments with clinical constraints between them.**

A tracer uptake study looks like this:

```
Consult 45m → Inject 30m → [wait 60–90m] → Scan 30m → Scan 30m → Consult 30m
  doctor        NMT room      no room        scanner    scanner     same doctor
```

The wait is a radiotracer uptake period. It is a clinical requirement, not slack,
and a scheduler that compresses it to save time produces clinically invalid
appointments. Meanwhile the patient occupies that wait — they are sitting in the
clinic — so nothing else can be booked into it. Today the clinic runs this on a
colour-coded spreadsheet where a single patient's visit appears as five unrelated
blocks scattered down a column, and there is no way to tell they belong together.

ScanFlow models the chain as the primitive, proposes ranked placements that
respect every mandatory delay while minimising the wasted time around them, and
makes double-booking impossible at the database level rather than unlikely at the
application level.

## Status

Phases **M0 — Foundations**, **M1 — Scheduling engine**, and **M2 — API** are
complete. The engine proposes ranked placements; the Express API books them
transactionally against Postgres exclusion constraints, with Testcontainers
covering the concurrent race.

| Phase  | Deliverable                                              | State       |
| ------ | -------------------------------------------------------- | ----------- |
| M0     | Monorepo, tooling, CI, Compose, schema, migrations, ADRs | Complete    |
| M1     | Scheduling engine + property tests                       | Complete    |
| M2     | Express API, repositories, integration tests             | Complete    |
| **M3** | **Read-only schedule grid**                              | Next        |
| M4     | Suggestions, booking wizard, conflict recovery           | Not started |
| M5     | Management UI: drawer, kebab menu, command palette       | Not started |
| M6     | Auth, RBAC, audit, SSE, seed polish                      | Not started |

## Quickstart

Requires Node 22+, pnpm 11, and Docker.

```bash
pnpm install
cp .env.example .env
docker compose up -d      # Postgres 16 (btree_gist) and Redis
pnpm db:migrate           # idempotent — a second run is a no-op
pnpm db:verify            # asserts the exclusion constraints actually hold
```

Then `pnpm db:seed`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
`pnpm bench`. `pnpm --filter @scanflow/api dev` serves the API; `pnpm dev` starts
the web shell (schedule grid arrives in M3).

Nothing in `packages/scheduling-core` needs Docker — it is pure, so `pnpm test`
and `pnpm bench` run against no services at all. API integration tests need
Docker (`pnpm test:integration`); they run in CI when Docker Desktop is absent
locally.

## Architecture in ten lines

```
apps/web            React 19 + Vite. Schedule grid, booking wizard.
apps/api            Express 5. http/ → modules/ → infra/, wired in container.ts.
packages/scheduling-core   Pure engine. Zero dependencies, zero async, zero I/O.
packages/contracts  Zod schemas + inferred types, imported by both apps.
packages/config     Shared tsconfig, ESLint, Prettier.
PostgreSQL 16       Intervals as tstzrange; overlap prevented by EXCLUDE constraints.
Redis               SSE fan-out across API instances (M6).
```

Dependencies point inward. Use cases never import `express` or `drizzle`;
repositories are interfaces declared beside the use case that needs them, with
Drizzle adapters in `infra/`. Those boundaries are enforced by ESLint
(`import-x/no-restricted-paths`) rather than by convention, and
`packages/scheduling-core` has a purity check that fails the build on any
dependency, any `async`, or any call to `Math.random` or `Date.now`.

Full detail, including C4 diagrams and the concurrency model, in
[docs/architecture.md](docs/architecture.md).

## The scheduling problem, precisely

Given a chain of steps, each with a resource type, a duration, and a mandatory
delay window `[minGap, maxGap]` before it; a set of capacity-1 resources with
per-day availability; and the patient's own availability — find the placements
that minimise the total span of the visit.

- A day is 36 fifteen-minute slots. Occupancy is a `bigint` bitmask, one bit per
  slot, so a conflict check is a single `&`.
- Search is depth-first over the chain with branch-and-bound on the span.
- Because `Σ durations + Σ minGaps` is fixed for a given chain, minimising span is
  exactly minimising _incidental_ gap — the slack caused by a busy resource, as
  opposed to the clinically mandated wait.
- Same-resource constraints (`step 5 must use the same physician as step 1`) are
  resolved during the search, with a per-search overlay mask so the engine cannot
  overlap a resource with itself.
- The engine returns up to five ranked candidates and never books. A human always
  chooses.

Nine invariants are asserted as `fast-check` properties at 1,000 runs each:
no resource overlap, no patient overlap, gaps within bounds, everything inside the
day, same-resource honoured, durations preserved, determinism, sorted output, and
monotonicity. A tenth test measures the generator itself and fails if it drifts
into producing mostly unschedulable days, because a property suite that asserts
things about empty arrays proves nothing.

**Benchmark: p95 of 5.35 ms against a 50 ms budget** — 9× headroom. `pnpm bench`
measures 300 pseudo-random days per case from a fixed seed, so a regression is a
regression and not a bad roll. These are the numbers from a GitHub-hosted runner
rather than from a fast laptop, because a performance claim should be one anybody
can reproduce:

| Case            | Shape                                                                         | p95     | max     |
| --------------- | ----------------------------------------------------------------------------- | ------- | ------- |
| Spec worst case | 6 steps, 4 resources per type, wide gap windows, 50% occupancy                | 2.42 ms | 4.95 ms |
| Deep dead ends  | as above, but the last step needs a modality only one 95%-booked resource has | 5.35 ms | 8.22 ms |

The second case exists because the first turned out to be the easier one: with a
pool of four resources the engine usually finds a zero-slack layout immediately and
the bound prunes everything else. Making the _final_ step scarce forces the search
to explore to full depth and fail, with no good candidate to tighten the bound
against — which is the shape that would expose a wrong bound.

CI runs this on every push and fails the build if p95 reaches the budget, so the
figure above cannot quietly go stale.

## Why double-booking is impossible

Overlap prevention is a database constraint, not application code:

```sql
CONSTRAINT no_resource_double_book EXCLUDE USING gist (
  resource_id WITH =, resource_during WITH &&
) WHERE (status <> 'CANCELLED' AND resource_id IS NOT NULL)
```

There is an identical constraint on `patient_id`, because the patient is modelled
as a capacity-1 resource — so "patient double-booked" and "scanner double-booked"
are the same rule, enforced by the same mechanism. This holds under any level of
concurrency, and also against a seed script, a data migration, or an engineer
typing `INSERT` into psql. The booking path expects SQLSTATE `23P01` and turns it
into a 409 carrying fresh alternatives, so the receptionist re-enters nothing.

`pnpm db:verify` proves it, and runs on every push.

## Decision records

- [ADR 0001 — Postgres exclusion constraints](docs/adr/0001-postgres-exclusion-constraints.md) — why interval integrity belongs in the database, and the price (Postgres is not swappable)
- [ADR 0002 — Zod contracts over generated OpenAPI](docs/adr/0002-zod-contracts-over-generated-openapi.md) — one source of truth for runtime validation and static types
- [ADR 0003 — Patient as a resource](docs/adr/0003-patient-as-resource.md) — unifying two conflict rules into one
- [ADR 0004 — Express with explicit layering](docs/adr/0004-express-with-explicit-layering.md) — why not NestJS

Every judgement call made where the specification was ambiguous is recorded in
[docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md), including three questions still
open for the clinic.

## Deliberately out of scope

- **Setup and teardown buffers** are modelled in the schema and the engine but
  seeded as zero, with no UI. The abstraction exists because a mandatory delay is
  its mirror case; the feature does not.
- **One clinic is seeded**, though `clinic_id` is on every tenant-scoped table
  from the first migration. There is no tenant onboarding, and no row-level
  security.
- **No billing, no PACS, no HL7/FHIR, no SMS reminders.** Scheduling only.
- **No recurring appointments** and no waitlist.
- **One timezone per clinic.** Cross-timezone clinics are not modelled.
- **Postgres is not swappable.** See ADR 0001 — this is a considered trade, not an
  oversight.

## A note on data

All seed and test data is synthetic: generated names, fake MRNs, invented dates of
birth. **No real patient data is in this repository or ever will be.** In
production this system holds PHI, which is why patient identifiers are banned from
log output, error messages, and audit payloads, and why that ban is a review
checklist item rather than a good intention.
