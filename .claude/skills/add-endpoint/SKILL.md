---
name: add-endpoint
description: The required sequence for adding or changing an HTTP endpoint in apps/api. Use whenever creating a route, changing a request or response shape, or adding a use case.
---

# Adding an endpoint

Follow in order. Skipping a step breaks the type chain between web and api.

1. Define request and response Zod schemas in `packages/contracts`. Export the
   inferred types from the same declaration — never hand-write a type beside a
   schema.
2. Define the use case in `apps/api/src/modules/<module>/`. It takes plain input,
   returns plain output, and imports nothing from express or drizzle.
3. Declare any repository it needs as an interface in that module's `ports.ts`.
4. Implement the interface in `apps/api/src/infra/repositories/`.
5. Wire both into `container.ts`. This is the only place construction happens.
6. Add the controller: parse, delegate, serialize. No logic.
7. Register the route with the `validate(schema)` middleware.
8. Map any new domain error in `errorHandler.ts` to an RFC 9457 response with a
   stable `type` URI under `https://scanflow.local/problems/`. The `detail` must
   tell the user what to do next.
9. Write an integration test against Testcontainers Postgres, covering the happy
   path and at least one failure.
10. If the endpoint mutates, assert it writes exactly one audit_log row.

## Why the layering rules are lint rules

`apps/api/eslint.config.js` forbids `src/modules` from importing `src/infra` or
`src/http`, and forbids `express` outside the HTTP layer. If your import is
rejected, the fix is a port in `ports.ts` — not an eslint-disable comment.
`container.ts` and `main.ts` are exempt because joining the layers is their job.

## Errors

Use cases throw typed domain errors from `src/errors/domain-errors.ts`. Never
`throw new Error("...")` in a use case: the HTTP layer needs to map the failure to
a status and a stable problem type, and it cannot do that from a string.

An error that only says what went wrong makes the receptionist start over. A 409
on a booking conflict carries `freshCandidates` so that one click retries.

## Checks before you finish

- Any endpoint accepting a chain runs the shared validation refinement from
  `packages/contracts`. Never validate a chain ad hoc in a controller.
- No patient identifier in any log line or error message.
- Mutating endpoints accept an Idempotency-Key and replay the original response.
- Endpoints reading a clinic-day return the current scheduleVersion.
- Endpoints writing a clinic-day bump it, inside the same transaction.
