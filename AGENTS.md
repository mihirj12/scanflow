# ScanFlow — orientation for coding agents

## What this is

Appointment scheduling for a radiology clinic. The thing that makes it
interesting: an appointment is not a booking, it is an **ordered chain of
segments** with temporal constraints between them, competing for capacity-1
resources.

A tracer uptake study is `consult 45m → inject 30m → wait 60–90m → scan 30m →
scan 30m → consult 30m`, where the wait is a clinical requirement (radiotracer
uptake), the two consults must resolve to the same physician, and the patient
occupies the wait even though no room does.

Read `docs/architecture.md` before your first change. Read
`.claude/skills/clinic-domain/SKILL.md` before naming anything.

## Layering — the rules most often broken

Dependencies point inward.

```
http/        controllers, middleware, routes     knows Express
modules/     use cases + ports (interfaces)      knows nothing about I/O
core         scheduling-core + contracts         pure
infra/       Drizzle adapters for the ports
container.ts the one place the layers are joined
```

1. `packages/scheduling-core` is **pure**: no framework, no I/O, no `async`, and
   an empty `dependencies` object.
2. Use cases never import `express` or `drizzle`.
3. Controllers parse, delegate, serialize. No business logic, no SQL.
4. Repositories are interfaces in the use case's own `ports.ts`; Drizzle
   implementations live in `apps/api/src/infra/repositories`.
5. All wiring happens in `apps/api/src/container.ts`. No DI library.
6. Every request/response shape is a Zod schema in `packages/contracts`, imported
   by both apps.

Rules 1–4 are enforced by lint, not convention. If an import is rejected, the fix
is a port — not a disable comment.

## Two things that will bite you

**Overlap prevention is a database constraint, not application code.** Two
`EXCLUDE USING gist` constraints on `appointment_segment` make double-booking
impossible — for resources and, identically, for patients. The booking path
expects SQLSTATE `23P01` and turns it into a 409 with fresh alternatives. See
ADR 0001 and ADR 0003.

**Booked appointments own their chain.** Steps are copied into `appointment_step`
at booking time; `appointment.template_id` is provenance only. Never join a booked
appointment back to `template_step`. A template edited in March must not alter an
appointment booked in February.

## Where things live

| Path                       | What                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `packages/scheduling-core` | Pure engine. Zero dependencies, zero async.                                           |
| `packages/contracts`       | Zod schemas and inferred types, shared by both apps.                                  |
| `packages/config`          | Shared tsconfig, ESLint, Prettier.                                                    |
| `apps/api`                 | Express 5 API, Drizzle, hand-written SQL migrations.                                  |
| `apps/web`                 | React 19 + Vite. Schedule grid and booking wizard.                                    |
| `docs/adr`                 | Four decision records. Read these to understand the _why_.                            |
| `docs/OPEN-QUESTIONS.md`   | Every judgement call and deviation, with reasons.                                     |
| `.claude/skills`           | Six skills: domain, engine invariants, endpoint recipe, migrations, UI, PR checklist. |
| `.cursor/rules`            | Ground rules plus thin glob-scoped pointers to the skills.                            |

## Commands

```bash
pnpm install            # requires pnpm 11, Node 22+
docker compose up -d    # Postgres 16 (btree_gist) and Redis
pnpm db:migrate         # idempotent; a second run is a no-op
pnpm dev                # all apps via Turborepo
pnpm lint               # ESLint + the scheduling-core purity check
pnpm typecheck
pnpm test               # unit and property tests
pnpm test:integration   # Testcontainers; needs Docker
pnpm build
```

## Conventions

- Conventional Commits, enforced by commitlint. Scopes: `api`, `web`, `core`,
  `contracts`, `config`, `db`, `ci`, `docs`, `repo`.
- One branch and one PR per phase, squash-merged.
- Write the test first for anything in `scheduling-core`.
- Do not scaffold future phases. Do not create placeholder files.
- Resolve an ambiguity by judgement? Record it in `docs/OPEN-QUESTIONS.md`.
- **Never put a patient identifier** — name, MRN, phone, date of birth — in a log
  line, an error message, or an audit payload.
- Before opening a PR, run `.claude/skills/pr-checklist/SKILL.md` and state which
  criteria you verified by running versus assumed.
