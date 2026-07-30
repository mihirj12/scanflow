# ADR 0001 — Interval integrity lives in Postgres exclusion constraints

- **Status:** Accepted
- **Date:** 2026-07-29
- **Phase:** M0

## Context

ScanFlow's single hardest correctness requirement is negative: no resource and no
patient may ever be in two places at once. A nuclear medicine appointment is a
chain of five or six segments competing for capacity-1 resources, so a single
booking writes several intervals at once and any one of them can collide with
someone else's.

Two properties make this hard to enforce in application code:

1. **Concurrency.** Two receptionists booking the same 09:00 scanner slot both
   read an empty schedule, both decide the slot is free, and both insert. A
   check-then-insert in application code has a window between the check and the
   insert, and that window is exactly where the double-booking appears. Under
   Postgres's default `READ COMMITTED` isolation, neither transaction sees the
   other's uncommitted row.
2. **Bypass.** Even a perfect application check protects only the code paths
   that call it. A seed script, a data migration, a support engineer running an
   `UPDATE` in psql, or next year's second service all write to the same table.

Postgres can express this constraint directly. An `EXCLUDE USING gist`
constraint rejects a row whose key matches an existing row on `=` and whose range
overlaps on `&&`, and it does so as an index operation inside the transaction, so
it is immune to both problems above.

## Decision

Overlap prevention is a database constraint, not application logic.

`appointment_segment` stores intervals as `tstzrange` columns and carries two
exclusion constraints:

```sql
CONSTRAINT no_resource_double_book EXCLUDE USING gist (
  resource_id WITH =, resource_during WITH &&
) WHERE (status <> 'CANCELLED' AND resource_id IS NOT NULL),

CONSTRAINT no_patient_double_book EXCLUDE USING gist (
  patient_id WITH =, during WITH &&
) WHERE (status <> 'CANCELLED')
```

Consequences of that choice, all deliberate:

- The `btree_gist` extension is required, because a GiST index cannot compare
  `uuid` for equality without it.
- Intervals are stored as range types, never as a `starts_at` / `ends_at` column
  pair. A pair cannot be indexed for overlap and permits a backwards interval.
- The partial `WHERE` clause is what makes cancellation cheap: a cancelled
  segment leaves the index and its slot becomes bookable again, with no row
  deleted and no history lost.
- Application code still checks availability before inserting, because a
  receptionist needs a list of workable times rather than a rejection. But that
  check is a user-experience feature. The constraint is the correctness
  guarantee, and the booking path is written to expect SQLSTATE `23P01` and
  translate it into fresh suggestions.

## Consequences

**Positive.**

- Double-booking is impossible rather than unlikely. The guarantee holds under
  any level of concurrency, against any client, including psql.
- The race-condition path is small and testable: catch `23P01`, recompute
  suggestions, return 409 with alternatives.
- No distributed lock, no advisory lock around bookings, no serializable
  transaction retry loop.

**Negative.**

- **Postgres is no longer swappable.** Exclusion constraints are not in the SQL
  standard and have no equivalent in MySQL or SQLite. This is accepted
  explicitly: for a scheduling system the constraint is worth more than portable
  SQL, and a clinic is not going to migrate engines.
- Testing the constraint needs a real Postgres, which is why integration tests
  run against Testcontainers rather than an in-memory fake.
- The constraint is invisible to Drizzle's schema builder, so migrations are
  hand-written SQL and `drizzle-kit generate` is not used. See
  `.claude/skills/db-migration/SKILL.md`.
- Range boundary conventions must be exact. All intervals are half-open
  `[start, end)` so that a segment ending at 09:00 and one starting at 09:00 do
  not overlap.

## Alternatives considered

**Application-level check before insert.** Rejected. It cannot close the
read-decide-write window without additional locking, and it protects only the
paths that remember to call it. A bug or a manual SQL edit produces silently
corrupt clinical data that nobody notices until a patient is double-booked in
person.

**Advisory locks or `SELECT … FOR UPDATE` over the clinic-day.** We do in fact
lock the `schedule_version` row per clinic-day, but as an optimistic-concurrency
and serialisation mechanism, not as the integrity guarantee. Relying on it alone
would mean every writer must remember to take the lock, which is the same bypass
problem in a new coat.

**`SERIALIZABLE` isolation.** Would detect the conflict, but as a serialisation
failure requiring a retry loop on every booking, with a much broader blast radius
and worse throughput than a targeted index constraint — and it still says nothing
about a manual `INSERT`.
