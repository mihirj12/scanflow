---
name: pr-checklist
description: Run through this before opening any pull request or declaring a phase complete. Use at the end of every unit of work.
---

# Pre-PR checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` all pass locally
- [ ] Integration tests pass against Testcontainers
- [ ] No `any`, no unexplained `@ts-ignore`, no `!` outside tests
- [ ] `scheduling-core` still has zero dependencies and zero async
      (`pnpm --filter @scanflow/scheduling-core lint` runs the purity check)
- [ ] No use case imports express or drizzle
- [ ] New shapes are Zod schemas in `packages/contracts`, imported by both sides
- [ ] Migration is reversible and idempotent
- [ ] No patient identifier in logs or error messages
- [ ] Mutations write an audit row
- [ ] Engine change? Matching property test added and benchmark re-run
- [ ] Architectural decision? ADR written
- [ ] Ambiguity resolved by judgement? Recorded in `docs/OPEN-QUESTIONS.md`
- [ ] Conventional Commit message
- [ ] Honest statement of what was verified by running versus assumed

## On that last item

State plainly which acceptance criteria you executed and which you believe to be
true but did not run. A reviewer who finds one unverified claim presented as
verified will stop trusting the other nineteen. "Verified in CI, not locally — no
Docker on this machine" costs nothing and buys everything.
