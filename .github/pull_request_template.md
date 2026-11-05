## Summary

## Constitution checklist

- [ ] Principle I: scheduling uses the published FSRS algorithm via `packages/domain`; no clock, randomness or UI reads in the scheduler
- [ ] Principle I: gamification does not change scheduling or reward harmful behaviour
- [ ] Principle I: review history stays lossless (append-only; state recomputable)
- [ ] Principle II: a failing test was written first
- [ ] Principle II: a regression test is included for bug fixes
- [ ] Migrations keep history intact (migration test passes)
- [ ] `pnpm verify` passes
