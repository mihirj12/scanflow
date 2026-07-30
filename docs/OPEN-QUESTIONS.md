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

### D6 — React 19, not the React 18 the spec names

Spec 3.1 says React 18, and M0 shipped 18.3.1 to match it. The question was then
asked directly and the answer was "use 19", so Dependabot's 19.2.8 bump was taken.

Absorbing a React major costs nothing while `apps/web` is still a shell — this is
the cheapest the migration will ever be, and it means M3 onward is written against
19 rather than migrated to it afterwards. Nothing in the tree depended on 18-only
behaviour: the entry point already used `createRoot` from `react-dom/client`, and
format, lint, typecheck, the 26 unit tests and the build were all green on 19
before the merge.

### D7 — Integration tests live in `apps/api` and need Docker

`pnpm test:integration` runs the Testcontainers suite in `@scanflow/api`. The CI
job has a Docker daemon; the development machine used for M2 still does not, so
the suite is verified in CI rather than locally (same arrangement as M0's `db`
job). Unit tests for the API do not need Docker and run everywhere.

### D8 — Contracts grew HTTP schemas and chain validation in M2

M0 shipped enums only. M2 added `parseAppointmentChain` (spec 2.9) and every
request/response Zod schema the API and the future wizard share. The engine
types (`Candidate`, `EngineStep`, …) stay in `scheduling-core` in slot units;
contracts speak minutes and ISO instants.

### D21 — `POST /appointment-templates` is open until M6 auth

Spec 5.3 marks template creation ADMIN-only. There is no auth layer yet (M6), so
the endpoint is reachable without a role check. Documented rather than stubbing
a fake admin gate that would have to be ripped out.

### D22 — Idempotency lives in its own table (migration 0001)

Spec 5.3 requires `Idempotency-Key` replay. No store existed in 0000, so 0001
adds `idempotency_record` keyed by `(clinic_id, key)` with a request hash that
409s when the same key is reused with a different body.

### D23 — Single-clinic process via `CLINIC_ID` env

Every table is tenant-scoped, but the process serves one clinic configured by
`CLINIC_ID`. Multi-clinic routing is out of scope; the seed writes a stable id
that `.env.example` documents.

### D24 — Schedule response includes `timezone` for the time gutter

`GET /schedule` returns day bounds as UTC ISO instants. The grid's time labels
must be clinic-local, so M3 added `timezone` (IANA) to `GetScheduleResponse`
rather than hardcoding Asia/Kolkata in the web app.

### D9 — Local verification of the database constraints was deferred to CI

Docker is not installed on the development machine used for M0 (no Docker
Desktop, no WSL2), so `docker compose up`, `pnpm db:migrate` against a live
Postgres, and the two `psql` exclusion-constraint checks in the M0 acceptance list
have **not** been run locally. The CI workflow runs the migration against a real
Postgres 16 service container and asserts SQLSTATE `23P01` for both the resource
and the patient constraint, so these are verified — by CI, not by hand. The
evidence is attached to the M0 acceptance-criteria issues as CI output.

One criterion cannot honestly be closed this way and is still open: a service
container is not `docker compose up`, so the compose file, the `btree_gist` init
script and the Redis service remain unverified until Docker Desktop is installed.

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

### D13 — The repository is public, where spec 14.1 says private

Spec 14.1 asks for a private repository. It also asks for secret scanning and push
protection, and 14.2 asks for a ruleset on `main`. On GitHub Free none of those three
exist for a private repository: the rulesets endpoint answers `403 Upgrade to GitHub
Pro or make this repository public`, and secret scanning answers `422 not available`.
Paying for Pro would buy the ruleset and still not secret scanning, which needs
Advanced Security.

Public was chosen over giving up the merge gate, because the gate is what 14.2 is
really protecting. `main` now requires a pull request, six passing checks, a branch
up to date with `main`, and resolved conversations, and it blocks force pushes and
deletion — with no bypass actors, including its owner. Secret scanning and push
protection are on.

The trade is safe here for the reason the README states out loud: all seed and test
data is synthetic and no PHI is in the repository or its history. That was audited
before the switch — the only tracked env file is `.env.example`, and its credentials
are the local container's `scanflow:scanflow`. Were this repository ever to hold real
data, private plus Advanced Security would be the only acceptable configuration.

### D14 — A `DELAY` placement carries the `seq` of the step it precedes

Spec 4.1 gives `Placement` a single `seq` field and does not say what a `DELAY`
should put in it. A delay is not an independent thing: it exists because the
following step declares a `[minGapSlots, maxGapSlots]` window, and it is that
step's gap. So it takes that step's `seq`, and a delay and its step are told apart
by `kind`.

This matches how the segments are stored: `appointment_segment` carries both
`seq` and `kind` and deliberately has no unique constraint on
`(appointment_id, seq)`, so the pair persists without renumbering in M2.

The alternative — numbering every segment 1..n across services and delays —
would make `Placement.seq` mean something different from `EngineStep.seq` and
break the direct lookup that `sameResourceAsSeq` needs.

### D15 — The engine ignores the gap fields on the first step rather than rejecting them

Spec 4.3's pseudocode forces `gapLo = gapHi = 0` when `i == 0`, while validation
rule 2.9.3 says step 1 must have `min_gap_min = max_gap_min = 0`. Both are
satisfied by treating the first step's window as zero regardless of what it
contains, which is what the pseudocode does, and the TSDoc on `EngineStep` says
so explicitly.

Rejecting a non-zero value here was considered and not done: 2.9 places that rule
in `packages/contracts`, where the wizard and the API both run it, and there is no
sensible answer to "how long to wait before the first step" for the engine to
enforce independently. A delay is measured from the previous step's end, and the
first step has no previous step.

### D16 — The engine re-validates `sameResourceAsSeq`, which spec 2.9 puts in contracts

Rule 2.9.7 — a `same_resource_as_seq` must reference an earlier step of the same
resource type — belongs to the Zod refinement in `packages/contracts`. The engine
checks it too, along with `seq` contiguity, because it resolves the reference by
looking up an already-assigned step and a dangling or forward reference would
otherwise be undefined behaviour inside a pure function.

This is defence in depth rather than duplication of intent: the contracts
refinement gives the receptionist live feedback in the wizard, and this makes
`suggestPlacements` total for every input it accepts.

### D17 — The bound is an admissible tail bound, and prunes on `>` not `>=`

Spec 4.3 suggests `if (end - startSlot) >= worstKeptSpan and best.isFull(): break`.
Two changes:

The bound compares `start + minTail` rather than `end`, where `minTail` is the
fewest slots the rest of the chain can occupy — every remaining duration plus
every remaining _minimum_ gap. This is admissible (no completion can finish
sooner) and strictly stronger than bounding on the current step's end alone, so it
prunes earlier while never discarding a better answer.

The comparison is strict. With `>=`, a candidate that ties on `spanSlots` would be
pruned before its secondary tie-breaks — start, then resource load, then resource
ids — were ever considered, so the returned set could omit the candidate that the
ranking in 4.4 says should win a tie. Strict `>` explores ties and lets the
comparator decide, which is what makes "best five by that ranking" true rather
than approximately true.

### D18 — The benchmark reports two cases, not one

Spec 4.7 names one worst case: 6 steps, 4 resources per type, wide gap windows,
50% occupancy. Measured, it is not the worst case — with four resources per type
the engine almost always finds a zero-slack layout at the first few starts, and
the bound then prunes the entire remaining search. p95 is 2.42 ms.

A second case was added where the last step requires a modality only one 95%-booked
resource provides. Steps 1 to 5 explore freely and the search fails at full depth
with almost no candidates to tighten the bound against, which is the shape that
would actually expose a wrong bound. It is roughly twice as slow, at 5.35 ms.

Both figures are quoted from a GitHub-hosted runner rather than a development
machine, which measures about 1.6× faster. A stated bound is more useful when it
comes from the environment anyone can reproduce.

Both are reported and both are asserted against the 50 ms budget. Reporting only
the spec's case would have overstated the engine by flattering it with the easier
input.

### D19 — The load tie-break counts each resource once

Ranking criterion 4.4.3 is "total load of the assigned resources ascending". Where
one resource serves several steps of a chain — the same physician consulting and
reviewing — its load is counted once, not once per step. Summing per step would
make reusing a resource look expensive, which is the opposite of the intent: the
criterion exists to spread work across a pool, and reuse is what the same-resource
constraint often requires.

### D20 — The property suite is guarded by a test that measures the generator

Every one of the nine invariants is phrased "for every candidate returned", so all
nine pass trivially when `suggestPlacements` returns an empty array. A generator
that drifted toward unschedulable days would leave the suite green and worthless.

A tenth test samples 400 requests from a fixed seed and asserts that most are
schedulable and that the structural features the engine is most likely to get
wrong actually occur — currently 76% schedulable at 2.1 candidates each, 78% of
chains carrying a same-resource pin, 97% with non-zero setup or teardown, 97% with
more than one resource of some type. The thresholds are deliberately far below the
measured values: this catches a degenerate generator, not ordinary variation.

The suite was also checked by breaking the engine three ways on purpose — dropping
the overlay mask, allowing a mandatory delay to be compressed, and ignoring
`sameResourceAsSeq` — and confirming that properties 1, 3 and 5 respectively
failed, each within milliseconds. Properties that have never been seen to fail are
not yet evidence of anything.
