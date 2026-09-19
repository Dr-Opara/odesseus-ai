# Developing Odysseus with Codex in VS Code

Odysseus v0.1-v0.11 has been feature-built. The next Codex phase is **integration and stabilization**, not greenfield feature development.

Before changing code, read:

1. `AGENTS.md`
2. `docs/development/integration-audit.md`
3. `README.md`

## Recommended starting branch

Start from:

```bash
git checkout build/odysseus-post-interview-v0.11
git pull
git checkout -b stabilize/odysseus-v0.11
```

Do not merge the 11 stacked milestone PRs into `main` before the stabilization branch builds and passes tests.

## First local commands

Use the repository's selected package manager after installation creates its lockfile.

```bash
npm install
npm run lint
npx tsc --noEmit
npm run build
```

Commit the generated lockfile.

Then start the app:

```bash
npm run dev
```

## Supabase is the first infrastructure task

The current remote database contains the working schema, but there are no committed migrations and no Supabase migration history.

Use the Supabase CLI from the project root to link the project and create a clean baseline from the current remote schema. Follow the current CLI help/docs rather than guessing command flags.

Afterward:

- verify migrations locally
- create a fresh database from migrations
- generate TypeScript database types
- wire those types into browser/server/service clients
- run security and performance advisors again

## Codex first prompt

Use this prompt after opening the stabilization branch:

> Read AGENTS.md, docs/development/integration-audit.md, README.md, package.json, and the current branch before editing anything. Odysseus v0.1-v0.11 is already feature-built. Your job is to stabilize it for a real local build and Vercel Preview deployment without redesigning the product. Start with P0 items only. Install dependencies and commit a lockfile, run lint/typecheck/build, fix compile errors, baseline the current Supabase remote schema into reproducible migrations, generate Supabase TypeScript types, add tests/CI, fix the documented Odysseus Live state/WebRTC/order/graceful-close issues, and make Apply successful-submission plus credit accounting atomic. Preserve all product/security rules in AGENTS.md. Report every change, command run, test result, and remaining blocker.

## External services

Connect services only after the local build and database baseline are stable:

- Supabase
- Vercel
- OpenAI / Realtime
- Stripe
- Browserbase
- Google OAuth
- Microsoft OAuth
- Yahoo OAuth
- optional outbound email connectors

Use Vercel Preview first. Keep Production credentials separate.

## Git workflow

- Never commit directly to `main`.
- Make stabilization changes on `stabilize/odysseus-v0.11`.
- Review diffs before commit.
- Require passing build/lint/typecheck/tests before opening the final PR.
- Prefer one consolidated stabilization PR to `main` after the stacked feature chain has been validated.

## Product sequence already implemented

- v0.1 — Foundation / Auth / Onboarding
- v0.2 — Match
- v0.3 — Resume Tailoring
- v0.4 — Credits + Stripe
- v0.5 — Odysseus Apply
- v0.6 — Odysseus Track
- v0.7 — Provider-neutral Email + Calendar
- v0.8 — Interview Workspace / Readiness
- v0.9 — Multi-Round Interview Memory
- v0.10 — Odysseus Live
- v0.11 — Post-Interview Analysis + Follow-Up

The next milestone is **v0.11 stabilization + Preview deployment**, not v0.12 feature expansion.
