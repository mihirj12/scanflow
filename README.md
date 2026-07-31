# ScanFlow

Production-grade appointment scheduling for a radiology clinic. The hard part is
not finding a free slot — it is placing an **ordered chain of segments** with
clinical timing constraints, same-resource rules, and capacity-1 resources, while
making double-booking impossible under concurrency.

**Example chain (tracer uptake):**

```
Consult 45m → Inject 30m → [wait 60–90m] → Scan 30m → Scan 30m → Consult 30m
  physician      NMT room      no room         scanner      scanner    same physician
```

The engine proposes ranked placements; a human always chooses. Nothing auto-books.

---

## Executive summary

|                 |                                                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Problem**     | Multi-step nuclear-medicine visits are scheduled today as disconnected blocks; waits are clinical requirements, not slack; patients occupy time even when no room is in use. |
| **Approach**    | Pure scheduling engine + Postgres exclusion constraints + REST API + React scheduler UI. One Zod contract package shared by API and web.                                     |
| **Status**      | Phases M0–M6 complete: engine, API, schedule grid, booking wizard, management UI, auth/RBAC/audit/SSE.                                                                       |
| **Demo clinic** | Asia/Kolkata, 15-minute slots, 08:00–17:00. Seeded synthetic data only — no real PHI.                                                                                        |

---

## Quickstart

**Requires:** Node 22+, pnpm 11, Docker (Postgres + Redis).

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

| Service               | URL                                    |
| --------------------- | -------------------------------------- |
| Web UI                | http://localhost:5173                  |
| API                   | http://localhost:3000                  |
| **API docs (Scalar)** | **http://localhost:3000/api/docs**     |
| OpenAPI JSON          | http://localhost:3000/api/openapi.json |

**Demo logins** (password `ScanFlow!Demo1` unless overridden in `.env`):

| Email                      | Role                                            |
| -------------------------- | ----------------------------------------------- |
| `reception@scanflow.local` | RECEPTIONIST — book, manage schedule            |
| `admin@scanflow.local`     | ADMIN — templates, audit log, metrics           |
| Clinician accounts         | CLINICIAN — view schedule, set own availability |

**Quality gates:**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm db:verify          # proves exclusion constraints exist
pnpm test:integration   # needs Docker
pnpm bench              # engine p95 vs 50 ms budget
```

`packages/scheduling-core` is pure — unit tests and benchmarks need no Docker.

---

## API documentation

OpenAPI **3.1** is generated from the same Zod schemas in `packages/contracts` that
validate live requests (see [ADR 0002](docs/adr/0002-zod-contracts-over-generated-openapi.md)).

- **Interactive reference:** `/api/docs` (Scalar)
- **Machine-readable spec:** `/api/openapi.json`
- **Base path:** `/api/v1`

### Authentication

1. `POST /api/v1/auth/login` with `{ "email", "password" }` → access token in body.
2. Send `Authorization: Bearer <accessToken>` on protected routes.
3. Refresh token travels as httpOnly cookie `scanflow_refresh`; rotate with
   `POST /api/v1/auth/refresh`.

### Core flows

| Intent                          | Method    | Path                            |
| ------------------------------- | --------- | ------------------------------- |
| Day schedule grid               | GET       | `/schedule?date=YYYY-MM-DD`     |
| Live grid updates               | GET (SSE) | `/schedule/stream`              |
| Rank candidates                 | POST      | `/appointments/suggestions`     |
| Book chosen slot                | POST      | `/appointments`                 |
| Reschedule                      | POST      | `/appointments/{id}/reschedule` |
| Lifecycle (check-in, cancel, …) | POST      | `/appointments/{id}/{action}`   |

**Roles:** RECEPTIONIST and ADMIN can book; CLINICIAN is read-only for booking.
ADMIN-only: `/audit`, `/metrics`, `POST /appointment-templates`.

**Errors:** RFC 9457 `application/problem+json`. HTTP 409 on slot conflict may
include `freshCandidates` so the receptionist can pick an alternative without
restarting the wizard.

**Idempotency:** Optional `Idempotency-Key` header on `POST /appointments` and
reschedule — same key + same body replays the original response.

Full request/response shapes are in the interactive docs.

---

## Architecture

```
apps/web                 React 19 + Vite — schedule grid, booking wizard, management
apps/api                 Express 5 — http/ → modules/ → infra/, wired in container.ts
packages/scheduling-core Pure engine (no I/O, no async, zero dependencies)
packages/contracts       Zod schemas + inferred types (API + web)
PostgreSQL 16            tstzrange intervals; EXCLUDE constraints prevent overlap
Redis                    SSE fan-out across API instances
```

Dependencies point inward. Use cases never import Express or Drizzle; repository
**ports** sit beside use cases, **adapters** live in `apps/api/src/infra/repositories`.
All wiring is in `apps/api/src/container.ts` — no DI framework.

Deep dive: [docs/architecture.md](docs/architecture.md).

### Correctness guarantees

- **Engine:** nine property invariants (resource/patient overlap, gap bounds, same-resource, determinism, …) tested with `fast-check` at 1,000 runs each. Benchmark CI fails if p95 exceeds 50 ms.
- **Database:** `EXCLUDE USING gist` on resource and patient intervals — overlap is rejected with SQLSTATE `23P01`, mapped to HTTP 409. `pnpm db:verify` asserts constraints on every push.
- **Booked chains are snapshots:** steps copied to `appointment_step` at booking; template edits do not alter past appointments.

### Security and PHI

- JWT access tokens (short TTL) + httpOnly refresh cookies.
- Patient identifiers never appear in logs, error messages, or audit payloads.
- Cancelled appointments excluded from search; admin activity log via `GET /audit`.

---

## Repository layout

| Path                       | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `packages/scheduling-core` | Placement search, ranking, chain validation                   |
| `packages/contracts`       | Shared Zod API contracts                                      |
| `apps/api`                 | HTTP surface, use cases, Drizzle adapters, OpenAPI generation |
| `apps/web`                 | Scheduler UI                                                  |
| `docs/adr/`                | Architecture decision records                                 |
| `docs/OPEN-QUESTIONS.md`   | Ambiguities and judgement calls                               |

---

## Decision records

- [ADR 0001 — Postgres exclusion constraints](docs/adr/0001-postgres-exclusion-constraints.md)
- [ADR 0002 — Zod contracts (OpenAPI derived at runtime)](docs/adr/0002-zod-contracts-over-generated-openapi.md)
- [ADR 0003 — Patient as a resource](docs/adr/0003-patient-as-resource.md)
- [ADR 0004 — Express with explicit layering](docs/adr/0004-express-with-explicit-layering.md)

---

## Deliberately out of scope

- Multi-clinic tenancy (schema is tenant-ready; one clinic seeded)
- Billing, PACS, HL7/FHIR, SMS reminders
- Recurring appointments, waitlists, auto-booking
- Postgres portability (see ADR 0001)

---

## Agent / contributor orientation

See [AGENTS.md](AGENTS.md) for layering rules, commands, and skills. Conventional
Commits with scopes: `api`, `web`, `core`, `contracts`, `db`, etc.
