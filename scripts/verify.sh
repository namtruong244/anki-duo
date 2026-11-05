#!/usr/bin/env bash
# Full gate (constitution: Development Workflow & Quality Gates). k6 is a release check, not run here.
set -euo pipefail
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:int
pnpm test:contract
pnpm test:i18n
pnpm test:e2e
