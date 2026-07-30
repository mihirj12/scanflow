## What this delivers

<!-- One paragraph. What can someone do after this PR that they could not before? -->

## Acceptance criteria

<!--
Paste the phase's acceptance list. For each item, paste the evidence — actual
command output, not a claim. An item you did not run is stated as not run.
-->

| Criterion | Verified by | Evidence |
| --------- | ----------- | -------- |
|           |             |          |

## Decisions

<!--
Architectural decision? Link the ADR.
Ambiguity resolved by judgement? Link the docs/OPEN-QUESTIONS.md entry.
-->

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` all pass locally
- [ ] Integration tests pass against Testcontainers
- [ ] No `any`, no unexplained `@ts-ignore`, no `!` outside tests
- [ ] `scheduling-core` still has zero dependencies and zero async
- [ ] No use case imports express or drizzle
- [ ] New shapes are Zod schemas in `packages/contracts`, imported by both sides
- [ ] Migration is reversible and idempotent
- [ ] No patient identifier in logs or error messages
- [ ] Mutations write an audit row
- [ ] Engine change? Matching property test added and benchmark re-run
- [ ] Architectural decision? ADR written
- [ ] Conventional Commit messages

## Verified versus assumed

<!--
Required. State plainly which criteria above you executed and which you believe
to be true but did not run, and why. One unverified claim presented as verified
costs the reader trust in all the others.
-->
