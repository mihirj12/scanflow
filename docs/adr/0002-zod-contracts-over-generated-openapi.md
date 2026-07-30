# ADR 0002 — Zod schemas in a shared package, not a generated OpenAPI spec

- **Status:** Accepted
- **Date:** 2026-07-29
- **Phase:** M0

## Context

`apps/api` and `apps/web` need to agree on every request and response shape.
Both are TypeScript, both live in this repository, and both are deployed
together. There is no third-party consumer.

Two of the shapes are not merely structural. The nine chain-validation rules
(spec 2.9) — contiguous `seq` values, durations that are multiples of the
clinic's slot size, `same_resource_as_seq` pointing at an earlier step _of the
same resource type_, a minimum span that fits inside the working day — are
conditional rules across a whole array. The booking wizard needs to run them on
every keystroke to give inline feedback, and the API must run them again because
a client is untrusted input.

If the client and server each own their own copy of those rules, they will
diverge, and the failure mode is the worst kind: the wizard says a chain is fine
and the API rejects it, or worse, the wizard blocks something the API would have
accepted.

## Decision

`packages/contracts` holds a Zod schema for every request and response shape and
for the chain-validation refinement. Both apps import from it. Types are always
derived with `z.infer`, never hand-written alongside a schema.

The enum labels are declared once as `const` tuples in that package, and the Zod
schema, the TypeScript union, and Drizzle's `pgEnum` are all derived from the
same tuple. Migration SQL spells the labels out literally — a migration must not
depend on code that can change after it has been applied — and an integration
test asserts the database labels and the tuples still agree.

No OpenAPI document is authored or generated in M0.

## Consequences

**Positive.**

- One definition per shape. A field cannot be added on one side and forgotten on
  the other; the build fails instead.
- Validation and typing come from the same declaration, so a schema that
  compiles is a schema that runs. This is the specific thing hand-written types
  cannot give: `interface BookRequest` is erased at runtime and validates
  nothing.
- The nine chain rules are written once. The wizard gets live inline feedback and
  the server stays authoritative, from identical logic.
- Zero build-time codegen. No generated directory to keep in sync, review, or
  gitignore.

**Negative.**

- **No machine-readable API description for third parties.** Anyone integrating
  from outside this repository has to read the code. Acceptable while the only
  clients are `apps/web` and curl.
- Zod is a runtime dependency of both apps and its validation cost is on the
  request path. Negligible next to a database round trip.
- Coupling the two apps to one package means a breaking schema change breaks the
  build of both at once. This is the intended behaviour, but it does mean the
  two cannot be versioned independently.

**Reversal path.** `zod-to-openapi` derives a spec from these same schemas in
roughly twenty lines, because the schemas already carry everything a spec needs.
That is scheduled as an optional M6 item and is explicitly not blocked by this
decision — which is the main reason the decision is safe to make now.

## Alternatives considered

**Spec-first OpenAPI with generated clients and server types.** The standard
choice when the API is a product, teams are separate, or consumers are external.
Rejected here: it adds a generator to the build, a generated directory to review,
and a drift risk between spec and implementation, in exchange for a benefit
(language-neutral contract) that nobody in this system can use.

**Hand-written shared TypeScript interfaces.** Cheapest option and the most
common mistake. Gives compile-time agreement and no runtime validation, so the
API would still need a separate validation layer — which is a second definition
of every shape, and therefore the drift problem again.

**tRPC.** Would give end-to-end type safety with less ceremony. Rejected because
it makes the HTTP surface an implementation detail, and this API's shape is part
of what is being demonstrated: explicit REST endpoints, RFC 9457 problem
responses, and idempotency keys.
