---
name: db-migration
description: Conventions for changing the Postgres schema with Drizzle. Use whenever adding or altering a table, column, index, enum, or constraint.
---

# Database migrations

- Migrations are forward-only and never edited after being committed. Drizzle
  records each file's hash, so editing an applied migration breaks every
  environment that already ran it.
- Every migration has a matching down script under `apps/api/drizzle/down/`, even
  though it is never run automatically. If you cannot write the down script, the
  change needs rethinking.
- snake_case for tables and columns. Singular table names.
- `clinic_id` on every tenant-scoped table. The two exceptions,
  `resource_working_hours` and `resource_exception`, reach the tenant through
  `resource_id` and are recorded in `docs/OPEN-QUESTIONS.md`.
- Timestamps are `timestamptz`. Never `timestamp`.
- Intervals are `tstzrange`. Never a start/end column pair — a pair cannot be
  indexed for overlap and permits a backwards interval.
- Ranges are half-open `[start, end)`, so a segment ending at 09:00 and one
  starting at 09:00 do not overlap.

## How migrations are written and applied here

**By hand, as SQL.** `drizzle-kit` is not a dependency and there is no
`drizzle.config.ts`. Drizzle's schema builder cannot express `EXCLUDE USING
gist`, so `drizzle-kit generate` would diff against a snapshot the hand-written
migration never produced and try to recreate the schema.

To add a migration:

1. Write `apps/api/drizzle/NNNN_short_name.sql`, separating statements with
   `--> statement-breakpoint`. The migrator sends each statement separately, and
   a multi-statement string fails as a prepared query.
2. Write `apps/api/drizzle/down/NNNN_short_name.down.sql`.
3. Add an entry to `apps/api/drizzle/meta/_journal.json` with the next `idx` and a
   `tag` exactly matching the filename without `.sql`.
4. Mirror any column change in `apps/api/src/infra/db/schema.ts`, which exists
   only to type queries. The SQL is authoritative.
5. Run `pnpm db:migrate`. Drizzle tracks applied files in `__drizzle_migrations`,
   which is what makes a second run a no-op.

## Exclusion constraints

Overlap prevention lives in the database (ADR 0001). Write it as raw SQL in the
migration with a comment explaining what it guarantees:

```sql
CONSTRAINT no_resource_double_book EXCLUDE USING gist (
  resource_id WITH =, resource_during WITH &&
) WHERE (status <> 'CANCELLED' AND resource_id IS NOT NULL)
```

Requires `btree_gist`, which is what lets uuid equality and range overlap share
one GiST index. Any new overlap rule follows the same pattern and needs an
integration test asserting SQLSTATE `23P01` on violation.

## Index expressions must be IMMUTABLE

`timestamptz::date` depends on the session TimeZone, so it is `STABLE` and
Postgres refuses it in an index expression. Index `lower(during)` and scan a
half-open instant range for the day instead. This bit us once already; see D1 in
`docs/OPEN-QUESTIONS.md`.

## Before committing

- Migration applies cleanly to an empty database.
- Migration applies cleanly on top of the previous one.
- Running it twice is a no-op.
- Seed script still succeeds.
