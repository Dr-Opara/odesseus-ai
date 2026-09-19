# Odysseus v0.11 Integration Audit

Date: 2026-09-18

Odysseus is feature-complete through the planned v0.11 product lifecycle, but it has not yet completed a real local build, runtime integration test, or production deployment. Treat the next phase as **stabilization**, not new feature development.

## Current product coverage

Implemented in the stacked v0.1-v0.11 branches:

- Authentication, onboarding, candidate profile, private resume storage
- Match analysis and deterministic score calculation
- Resume tailoring, review, approval, and frozen approved resume artifacts
- Stripe prepaid application credits and interview passes
- Browser-assisted application workflow with Browserbase + Playwright
- Application lifecycle tracking and frozen application context
- Provider-neutral email/calendar detection
- Interview workspace and readiness brief
- Multi-round interview memory
- Odysseus Live realtime transcription and grounded guidance
- Post-interview analysis, round-memory enrichment, and follow-up drafts

## P0 — blockers before merge/deploy

### 1. Create reproducible Supabase migrations

The remote Supabase schema was built directly during development. The project currently has no migration history in Supabase and no migration SQL committed in the repository.

Before merging:
- link the local repo to the current Supabase project
- pull/baseline the complete remote schema into migrations
- inspect all tables, RLS policies, storage policies, triggers, grants, Vault helpers, and private-schema functions
- verify a fresh local/test database can be created from migrations only
- generate and commit Supabase TypeScript database types
- run Supabase security/performance advisors again

Do not treat the existing remote database as the migration source forever.

### 2. Install dependencies and commit a lockfile

There is currently no package lockfile.

Run the package manager install locally, commit the resulting lockfile, and make future installs deterministic.

### 3. Run real compile/lint/type checks

Required before merge:
- npm install
- npm run build
- npm run lint
- npx tsc --noEmit

Fix every build/type error before runtime testing.

### 4. Fix Odysseus Live state/realtime issues

Known issues to address:

- The realtime data-channel event listener can close over a stale React `sessionId` value. Use a ref or pass the prepared session ID directly to transcript handlers.
- Retry after a Live startup error currently conflicts with the `canStart` idle-state guard.
- Wait for ICE gathering to complete before sending the WebRTC SDP offer.
- End the realtime session gracefully and allow final transcription events to drain before closing the peer/data channel.
- Preserve a stable turn/order field. Realtime transcription completion events can arrive out of order.
- Consider activating/charging the interview pass after confirmed realtime session start rather than only SDP exchange.
- Test shared-tab audio, mixed audio, and microphone-only capture on supported browsers/OS combinations.
- Do not assume mixed-audio transcription has speaker labels.

### 5. Make successful application finalization atomic

A confirmed employer submission, application record update, timeline event, and application-credit debit should be one database transaction/RPC.

Current idempotent credit references help, but partial database state is still possible if one step fails after the external employer submission succeeds.

### 6. Add automated tests and CI

There are currently no committed automated tests and no GitHub Actions workflow.

Minimum:
- unit tests for match scoring
- unit tests for email/application signal classification
- unit tests for Apply field rules
- unit tests for billing/credit idempotency helpers
- integration tests for authenticated API routes
- Playwright E2E for onboarding -> match -> tailor -> approve
- Playwright/E2E tests for application tracking/interview workspace
- mocked Realtime tests for Live state transitions
- CI: install, lint, typecheck, test, build

### 7. Stabilize the stacked PR history

PRs #1 through #11 are all open and stacked.

Do not blindly merge them one at a time before validation.

Recommended:
1. checkout `build/odysseus-post-interview-v0.11`
2. create `stabilize/odysseus-v0.11`
3. perform all build/test/migration/runtime fixes there
4. open one final stabilization PR to `main`
5. after that PR is accepted, close/supersede the old stacked milestone PRs or preserve them only as historical references

## P1 — important product gaps / improvements

### Automated job discovery

The product vision includes Odysseus finding strong-match jobs automatically. The current Match MVP is still primarily manual/pasted-job-description driven.

Add a compliant job-ingestion layer beginning with official/public ATS sources where feasible, such as Greenhouse, Lever, and Ashby. Include:
- provenance/source URL
- freshness
- deduplication
- saved/ignored jobs
- filters/preferences
- automatic match queue
- 85%+ surfacing policy

Do not depend on unauthorized scraping or bypass site restrictions.

### Candidate Professional Graph completeness

Expand the profile progressively without making the UI noisy:
- work authorization
- sponsorship
- relocation
- clearance
- target industries
- compensation preferences
- LinkedIn
- GitHub
- portfolio
- detailed education/certifications
- availability/start date
- reusable application Q&A

The Q&A vault exists, but it should have a dedicated user-facing management surface.

### Resume review controls

Verify/add the complete intended controls:
- Approve
- Edit
- Regenerate
- Reject job

Add an explicit manual resume editor if it is not already present. Visually test generated PDFs for multipage layout, links, spacing, and ATS compatibility.

### Integration lifecycle

Add:
- disconnect
- reconnect/reauthorize
- credential rotation
- remove account
- Vault secret cleanup
- integration error recovery
- user review/reassignment/dismissal of ambiguous signals
- cancelled/rescheduled interview handling
- incremental provider sync tokens/cursors instead of repeated bounded scans

Remove the legacy Google-only routes/components and the legacy `integration_connections` model after confirming nothing still depends on them.

### Manual recovery paths

Allow users to:
- add an application manually
- add an interview manually
- correct a wrongly matched recruiter signal
- mark a follow-up as sent when mailto fallback is used
- manually refund/restore an interview pass after verified product failure through an admin/support path

## P1 — runtime/provider setup still required

Configure and test real environments for:

- Vercel project + Preview/Production environment variables
- Vercel OIDC / Vercel Connect
- Google read-only Email + Calendar connector
- Microsoft read-only Mail + Calendar connector
- Yahoo OAuth connector
- optional Google send connector
- optional Microsoft send connector
- Stripe test/live keys + webhook endpoint
- Browserbase project/key
- OpenAI API billing/quota + Realtime
- Supabase production auth URLs/redirects/SMTP as needed
- Vercel Cron cadence
- Odysseus domain

Test OAuth callback URLs in Preview and Production separately.

## P1 — Apply agent hardening

Test against several real ATS families:
- Greenhouse
- Lever
- Workday
- iCIMS
- Ashby

Improve:
- custom React/select/widget handling
- session expiration/recovery
- stale Browserbase session cleanup
- stronger submission-success evidence
- human confirmation fallback when success detection is uncertain
- employer/ATS target URL allow/deny validation, including blocking unsafe/private/local destinations

## P1 — Live quality

Measure:
- transcription latency
- guidance latency
- transcript accuracy
- question-detection precision
- guidance grounding accuracy
- realtime cost per interview

Potential improvement:
- separate shared interview audio and candidate microphone streams so source is known instead of relying on mixed audio with uncertain speaker attribution.

## P2 — production hardening

### Security / privacy

Add or review:
- request rate limiting
- abuse controls
- Origin/CSRF checks for sensitive mutations
- CSP and security headers
- transcript/data retention policy
- transcript deletion controls
- account deletion
- user data export
- OAuth disconnect/revoke
- Terms/Privacy language for audio transcription and interview-assistant use
- jurisdiction-aware consent guidance

Prefer moving privileged SECURITY DEFINER helpers out of the exposed `public` schema into a private schema where practical, even though execution is already restricted.

### Observability / support

Add:
- structured server logging
- error monitoring
- workflow/browser run diagnostics
- provider sync error visibility
- Realtime usage/cost telemetry
- AI token/cost telemetry
- Stripe fulfillment monitoring
- admin/support tools for credit correction and failed sessions

### UI / accessibility

The visual direction is implemented but has not been rendered/QA'd end-to-end.

Review:
- mobile layouts
- keyboard navigation
- focus states
- labels/ARIA
- color contrast
- empty/loading/error states
- consistent app shell/navigation
- dark mode if retained as a product requirement

The global stylesheet is now large; consider breaking repeated patterns into components/design tokens after the product is visually stable.

## Database / repository cleanup

- Generate Supabase migrations.
- Generate TypeScript DB types and use them in all Supabase clients.
- Remove legacy Google-only integration routes after replacement verification.
- Remove or migrate the legacy `integration_connections` table.
- Review unused indexes after realistic data exists; do not remove them based on an empty database.
- Update README/AGENTS/Codex docs after stabilization.
- Add a dependency update strategy and security audit step.

## VS Code + Codex first-session checklist

1. Clone/open the repo.
2. Checkout `build/odysseus-post-interview-v0.11`.
3. Create `stabilize/odysseus-v0.11`.
4. Read `AGENTS.md`, this audit, and `README.md`.
5. Install dependencies and commit the lockfile.
6. Run lint/typecheck/build.
7. Fix compile/runtime blockers without changing product behavior unnecessarily.
8. Link Supabase and create the baseline migration.
9. Generate Supabase TypeScript types.
10. Add test framework + CI.
11. Fix the P0 Live issues.
12. Make Apply success + credit accounting atomic.
13. Run local UI and browser QA.
14. Configure Vercel Preview environment.
15. Connect external providers one at a time and test.
16. Run the entire candidate lifecycle end to end.
17. Open one stabilization PR to `main`.

## Definition of integration-ready

Odysseus is integration-ready when:

- fresh install succeeds from a committed lockfile
- fresh database can be reproduced from committed migrations
- build, lint, typecheck, and automated tests pass
- core lifecycle succeeds end to end
- external-provider failures degrade safely
- credits cannot be double-spent/double-charged
- Live reconnect/end behavior is reliable
- no unresolved Supabase security findings exist
- Preview deployment passes visual and functional QA
