# ADR 0004 — Express 5 with hand-wired layering, not NestJS

- **Status:** Accepted
- **Date:** 2026-07-29
- **Phase:** M0

## Context

The API needs dependency injection, request validation, a consistent error
format, and a layering discipline that keeps business logic out of controllers
and SQL out of use cases. NestJS provides all four out of the box and is the
default answer for a structured TypeScript API.

The relevant feature of this codebase is that the domain is already framework
independent by construction:

- `packages/scheduling-core` is pure: no framework, no I/O, no async, and no
  dependencies at all. It is enforced mechanically by
  `packages/scheduling-core/scripts/check-purity.mjs`.
- Validation lives in `packages/contracts` as Zod schemas shared with the web app
  (ADR 0002), so it cannot live in framework-specific decorators.
- Repositories are ports declared next to the use case that needs them, with
  Drizzle adapters in `infra/`. The dependency direction is already inverted
  without a container.

So the structure Nest would impose is structure this codebase has already
committed to elsewhere. What is left for the framework to do is route, parse,
serialise, and map errors.

## Decision

Express 5 with layering wired by hand.

- **One composition root.** `apps/api/src/container.ts` is the only file that
  constructs a repository or a use case. No DI library, no service locator, no
  module-level singletons imported across files. Wiring is a function call, and
  the whole object graph is readable top to bottom on one screen.
- **Ports beside use cases.** A use case declares the repository interface it
  needs in its own module's `ports.ts`; the Drizzle implementation lives in
  `infra/repositories`. Use cases import the interface only.
- **Controllers parse, delegate, serialise.** No business logic, no SQL.
- **Validation as middleware.** `validate(schema)` runs a schema from
  `packages/contracts` and turns a failure into a `400 application/problem+json`.
- **Errors as typed domain errors.** Use cases throw domain errors, never
  `new Error(...)`. One `errorHandler` maps each to an RFC 9457 response with a
  stable `type` URI, and every `detail` says what the user should do next.

The layering rules are enforced by ESLint rather than by convention:
`import-x/no-restricted-paths` forbids `src/modules` from importing `src/infra` or
`src/http`, and `no-restricted-imports` forbids `express` outside the HTTP layer.
`container.ts` is the one exemption, because reaching across layers is its job.

## Consequences

**Positive.**

- The layering is visible in the file tree and checked by the linter, not
  described in a wiki. A reviewer can verify rule compliance with `grep`.
- No framework in the domain. A use case is a function taking plain input and
  returning plain output; its unit test needs no HTTP mock and no database.
- Small dependency surface and no decorator metadata, no `reflect-metadata`, no
  build-time transform.
- Express 5's native async error propagation removes the wrapper that made
  Express 4 error handling awkward.

**Negative.**

- **DI, validation, and error mapping are written by hand** — roughly 150 lines
  in total. Small, but it is code we own and must test rather than code a
  framework maintains.
- Nothing stops a future contributor from constructing a repository outside
  `container.ts` except a lint rule and a review checklist. Nest's module system
  would make it structurally awkward.
- No built-in interceptors, guards, or pipes vocabulary, so a new contributor who
  knows Nest has to read this codebase's conventions instead of transferring
  theirs.

## Alternatives considered

**NestJS.** The right choice for a larger team, a longer-lived API, or one where
the domain is not already framework independent: its module system makes layering
violations structurally hard, and its conventions mean less to agree on. Rejected
here because the structure it provides is redundant with structure this repo
already has, and it would add a decorator-based DI container, a second validation
idiom competing with the shared Zod schemas, and a framework abstraction between
the reader and roughly 150 lines of wiring.

**Fastify.** Faster, with first-class JSON-schema validation. Rejected because the
validation story pulls against ADR 0002 — the shared Zod schemas would either be
converted to JSON Schema or bypassed — and the throughput difference is
irrelevant for a single clinic.

**Express 4.** Rejected on async error handling alone. Express 5 propagates
rejections from async handlers to the error middleware natively, which is the one
thing that made Express 4 layering ugly.
