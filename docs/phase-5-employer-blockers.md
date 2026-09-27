# Phase 5 — Employer frontend: what shipped, and what is blocked

Branch: `frontend/pricing-wallet-ui`
Base commit: `8937c21` (Phase 3)

This records the employer frontend work so the next lane does not have to
rediscover the schema limits, and so nobody reads a missing card as a bug in the
frontend.

## What shipped

| Area | Surface |
| --- | --- |
| Typed schema | 9 employer tables + 2 seat RPCs added to `src/types/database.ts` |
| Plan and pricing data | `src/lib/employer/plans.ts` — approved terms keyed by the stored tier vocabulary |
| Read service | `src/lib/employer/service.ts` — one `getEmployerOverview` for every employer surface |
| Contracts | `src/lib/employer/types.ts` |
| Desktop portal | `/employers/dashboard`, `/jobs`, `/team`, `/billing` |
| Phone portal | Read-only overview/jobs/team/billing, reached from Business Login |
| Sign-in / sign-up split | Sign-up desktop-only; Business Login available at every width |
| Post a job | Honest, disabled form; see blocker 4 |
| Tests | `tests/unit/employer-pricing.test.ts` (17), `tests/unit/employer-service.test.ts` (36), `tests/unit/employer-portal-ui.test.ts` (26), `tests/e2e/employer-portal.spec.ts` |

The previous employer dashboard was a fully hardcoded placeholder. It rendered
`4 Active Jobs`, `156 Applicants`, `31 Strong Matches`,
`83 Applicants · 14 Strong Matches · 7 Reviewed · 3 Shortlisted`,
`Credits Remaining 3 / 5` and `AI Starter Bundle`. None of those numbers came
from a record, and the plan label did not exist in the approved pricing. All of
it is gone; every number is now read from the organization's own rows.

## Verified against the live database

Column names, types, nullability, check-constraint vocabularies, foreign keys,
RLS policies and RPC privileges were read from the local Supabase instance
(`supabase_db_Odysseus-ai`) before being typed. Specifically:

- `employer_organizations`, `employer_members`, `employer_member_invitations`,
  `employer_jobs`, `employer_subscriptions`, `recruiter_seats`,
  `employer_seat_adjustments`, `employer_job_post_credits`, `featured_listings`
- Member role `owner|admin|recruiter|viewer`; job status
  `draft|published|closed`; subscription tier `starter|growth|business`;
  subscription status `incomplete|active|past_due|canceled|trialing`; featured
  tier `featured_7d|featured_14d|ai_30d`
- `odesseus_org_required_seat_count(uuid)` and
  `odesseus_org_live_seat_count(uuid)` are `security definer` and executable by
  `authenticated`; both are called with only the org id Postgres already
  authorised for the session.

## Blocker 1 — there is no employer → applicant link

`applications` is candidate-owned: its only select policy is
`applications_select_own` (`user_id = auth.uid()`), and `applications.job_id`
references `job_opportunities` (the candidate's own saved roles), **not**
`employer_jobs`. There is no table joining an employer organization to an
applicant, and no shortlist, review or matching record.

Consequence: the employer portal shows no applicant count, no strong-match
count, no shortlist and no pipeline. Those are exactly the four figures the old
placeholder invented, which is the specific failure this phase exists to remove.

Fixing it needs either a new table plus policies, or a relaxation of
`applications_select_own`. Both are backend/schema work and both are out of the
frontend lane's scope. **Do not fix it by widening RLS.**

## Blocker 2 — employer tables are absent from this branch's migrations

`supabase/migrations/` on this branch contains no `create table employer_*`
statement, so the tables exist in the local database but cannot be recreated
from this tree. `src/types/database.ts` was hand-extended to match the live
schema rather than regenerated, because regeneration is a backend-owned step.

Before this branch merges, someone who owns the schema must add the employer
migrations so a fresh `supabase db reset` produces the same tables.

## Blocker 3 — employer signup never provisions an organization

`employerSignup` in `src/app/employers/actions.ts` creates the auth user with
`account_type: "employer"` and the company name in user metadata, then
redirects. It does **not** insert an `employer_organizations` row or an
`employer_members` row. Every employer table therefore reads back empty for a
newly signed-up employer, because all the org-scoped policies are
`is_org_member(org_id)` (or admin/owner) and there is no membership.

This is reachable in production, so it is not papered over:

- `EmployerOverview.needsOrganization` is true for exactly this state.
- The portal renders a named empty state that says the sign-in works but the
  company workspace is not linked yet, with a contact link — not an all-zero
  dashboard.
- `tests/unit/employer-service.test.ts` pins the state explicitly.

The fix is a two-row insert after signup. It is an auth-adjacent write, so it
belongs to the backend lane; the frontend has been built to render the result
either way.

## Blocker 4 — publishing a job cannot be wired from the browser

Publishing has to consume one job post from `employer_job_post_credits`. The
only grant function in the schema, `grant_employer_tier_job_posts(uuid, text)`,
is `security definer` and **not** executable by `authenticated`. Writing the
`used` column from the browser would let a client grant itself allowance, which
is the same class of bug as a client-side credit grant.

So `/employers/post-job` keeps the form but disables it, quoting the
organization's real plan and remaining allowance, and stating that publishing is
not connected. Nothing is submitted and nothing is deducted.

The wallet ledger and employer billing backends are likewise unshipped on this
branch (`src/lib/wallet/adapter.ts` is an honest "unavailable" stub), so
`/employers/dashboard/billing` displays real state and links to the published
pricing rather than wiring checkout buttons to a backend that would fail.

## Deliberate product decisions

- **Sign-up is desktop-only.** The phone business flow is Business Login →
  portal. Enforced in the page (`odesseus-desktop-only`) *and* kept safe in the
  server action, so a direct POST still passes the company-email check, the
  minimum password length and the signup rate limit.
- **No employer menu at any width.** The public employer marketing header stays
  desktop-only with no hamburger, and the portal's phone screens carry their own
  bottom navigation. There is no collapsed employer menu that could hide an
  entry. `tests/unit/employer-portal-ui.test.ts` fails if one appears.
- **Live is never reachable from an employer session.** No link, price or word
  in the portal, on either form factor. Live remains intact for signed-in
  applicants; `tests/unit/live-public-surface.test.ts` now walks the whole
  `/employers/dashboard` subtree as part of its public-surface audit.
- **Desktop-first administration.** Job creation, seat administration,
  subscription changes and featured purchases are desktop actions. The phone
  portal states where they are rather than showing a control that would do
  nothing.
- **No fabricated fallback for unknown data.** An unrecognised stored plan tier
  renders "Plan not recognised" and never defaults to another plan's price or
  job allowance. A missing seat entitlement renders "Seat count unavailable"
  rather than substituting a number.
