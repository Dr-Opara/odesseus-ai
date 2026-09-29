# Employer data contracts

Two gaps closed together in one migration, because both were the same problem
from opposite ends: the employer portal was reading data it should have had
from the backend, and the backend was missing the data to read.

- Migration: `supabase/migrations/20261120000000_employer_applicant_identity_and_job_fields.sql`
- pgTAP: `supabase/tests/employer-applicant-identity.test.sql` (47 assertions)

---

## 1. Employer-readable applicant identity

### The problem

`odesseus_get_employer_applicants` returns no `user_id` — deliberately, so an
employer read cannot pivot into candidate-private data. The employer UI therefore
had no name and rendered the first eight characters of an application id, which
is not a person.

### The solution

A separate function, `public.odesseus_get_employer_applicant_identities(org, job?)`,
returning exactly three columns: `application_id`, `candidate_name`,
`candidate_email`.

It is a **separate** accessor rather than two more columns on the payload reader
for two reasons:

1. The payload reader already returns resume snapshots, match scores, and
   verification evidence. Adding identity there widens a function whose width is
   a review question, and puts a person's identity in the same row as everything
   else so a later column addition can widen it again unnoticed.
2. As its own surface, identity is independently auditable and independently
   grantable. `supabase/tests/employer-applicant-identity.test.sql` asserts the
   exact return type, so adding a fourth column fails the suite.

### Authorization chain

Proved in this order, all inside the function:

| # | Proof | Mechanism |
| - | ----- | --------- |
| 1 | Signed-in session | `auth.uid()` is not null |
| 2 | Belongs to the org | `employer_members` row for `(org_id, uid)`, **or** `employer_organizations.owner_user_id = uid` |
| 3 | The job belongs to the org | the join is scoped `ej.org_id = p_org_id`, and `p_job_id` narrows to one of the org's own `employer_jobs` rows |
| 4 | The application belongs to that job | `applications -> job_opportunities.employer_job_id -> employer_jobs` |

A caller failing any step raises `42501` and receives nothing. The org check
runs **before** the job filter, so passing a job id you own cannot buy you a
different org's applicants.

### What is deliberately not returned

**No `user_id`.** The id space that links the four proof steps is used entirely
inside the query and never leaves it. This is the load-bearing property: a user
id in the return would let any employer join an application to a candidate's
Live transcripts, mock-interview feedback, Interview Prep, post-interview
analysis, wallet, billing, or Resume Hub with one more function call. The pgTAP
suite asserts the return type, and separately asserts that the two `a.user_id`
mentions in the body are join predicates and never projected values.

**No other `profiles` column.** Only `full_name` is read. `headline`,
`location`, `skills`, `certifications`, `candidate_facts`, `linkedin_url`,
`github_url`, and `portfolio_url` are not selected, and the suite asserts their
absence from the function body.

**No broad `auth.users` access.** There is no grant letting any role select from
`auth.users`. This function reads exactly one column from it, for rows it has
already proved, and is the only path to it. The suite asserts `anon` holds no
privileges on `auth.users`.

### Why email is exposed

This is a policy decision, not a technical one, so the reasoning is recorded
here and in the migration.

A candidate who applies to an employer's posting has deliberately disclosed
their name and contact address **to that employer**. Refusing to show the email
of someone who just applied to your job is not privacy, it is a broken product:
the employer cannot reply, schedule, or make an offer, so the applicant is
unusable.

The product already encodes this position. `public.career_applications` stores
`full_name` and `email` as `NOT NULL` columns for exactly this reason, and every
supported job board and ATS (Greenhouse, Lever, Workday, Ashby) shows the
applicant to the employer who received the application.

The exposure is bounded on three axes, each enforced rather than left to the
caller:

- Only reachable for an application on the caller's **own** job, proved inside
  the function.
- Not reachable from a browser role on `auth.users`; no such grant exists.
- Not a key into anything else, because no user id is returned.

If product policy later decides the email should be withheld, dropping one
column from the function is the whole change.

### A name is never invented

A candidate with no profile row, or one who cleared the field, yields `NULL`.
Deriving a display name from an email local-part is a guess about a person. The
rule that forbids inventing qualifications forbids inventing identity just as
much. The UI falls back to the role the candidate applied for, which is real
context the employer already has.

Verified behaviour (pgTAP):

| Case | Result |
| ---- | ------ |
| Owning org, profiled applicant | name and email returned |
| Non-owner member, own org | returned (a recruiter seat is not useless) |
| Other org's owner | `42501` |
| Owning a job in the foreign org | `42501` |
| Viewer of a different org | `42501` |
| Candidate, no membership | `42501` |
| Candidate naming their own application id | `42501` |
| `anon` | `42501`, no execute privilege |
| Shared applicant on both orgs' jobs | visible only to the org they applied to |
| No profile row | listed, name `NULL` |
| Whitespace-only name | `NULL`, not a blank identity |

---

## 2. Structured job fields

### The problem

The approved job form (Figma 75/76) collects four fields beyond title, location,
work arrangement, description, and qualifications: **department**,
**employment type**, **compensation**, **responsibilities**. `employer_jobs` had
no column for any of them, so they were written into `description` as a labelled
block and split back out on read.

That round trip is lossy in both directions:

- An employer whose role summary contains the words `Compensation:` gets a parsed
  value that was never compensation.
- A multi-line value cannot round-trip at all, because the format is line-based
  and the field is free text.
- The values are not queryable.
- The Fit Score prompt reads `description` whole, so it is scoring a blob that
  mixes the employer's prose with four structured fields.

### Decision, per field

Not a blanket "add columns" — each field was assessed against the approved form
and its real downstream consumers.

| Field | Column | Why |
| ----- | ------ | --- |
| `department` | `employer_jobs.department text` | On the approved form, rendered on job detail, and the product already has the concept (`career_job_openings.department`). That table is **not** a reusable equivalent: it is the public company careers page, admin-managed, different lifecycle, different visibility, and not written by the employer portal. |
| `employment_type` | `employer_jobs.employment_type text` | A live filter dimension, not decoration. `job_preferences.employment_types` is candidate-set data and `odesseus_prefilter_jobs` consumes it. An employer posting with no structured type is invisible to a candidate who asked to see only full-time or contract roles. `job_opportunities.employment_type` exists because the discovery pipeline writes it; the employer record had no way to populate the mirror. |
| `compensation` | `employer_jobs.compensation_text text` | `job_opportunities.salary_text` exists and the public feed renders it, but nothing could populate it from an employer posting except by parsing prose. Separately, the rule is that a salary is shown only when it is real; a dedicated field makes "the employer entered this" a fact the database records. **Text, not integer cents:** the approved form accepts a range and a currency (`$180K-$220K`), and inventing a numeric contract would force a lossy conversion or reject valid input. |
| `responsibilities` | `employer_jobs.responsibilities_text text` | Distinct from `requirements_text` (what the person will do vs. what they must already have) and read separately by the Fit Score prompt. **Text, not an array or side table:** matches the two columns already added in the hiring migration and matches how the employer types it, one item per line. |

**Employment-type vocabulary** (constrained, lowercase, mirroring
`work_arrangement`): `full_time`, `part_time`, `contract`, `temporary`,
`internship`, `volunteer`, `other`.

A filter dimension cannot be free text — an uncontrolled column there quietly
becomes unfilterable. The set is the union of the approved form's options and the
values the discovery providers normalise to, so a mirrored posting is never
refused for being a legitimate type. Widening it is a new migration, deliberately.

**Fit Score does not read any of the four.** `computeFitScore` selects
`title, description, location, requirements_text, preferred_text,
work_arrangement`. These four are display and filter concerns, not scoring
inputs. That is recorded here so a future change does not assume the scorer
depends on them.

### Backwards compatibility

All four are **nullable**, and the migration adds nothing that is `NOT NULL`. An
existing job is valid before and after; a new job may leave any of them blank; no
caller is forced to supply them.

`description` **keeps its text and meaning**, for every existing row and every
row written after this migration. The labelled block is not stripped: a
description predating the migration may exist only in that form, and removing text
an employer wrote is a worse failure than a redundant field.

A backfill copies what it can recognise out of the block into the columns. Three
properties, each tested:

1. **It only ever adds.** `description` is not modified, so a wrong parse costs a
   wrong column value, never lost employer text.
2. **It only fills a null column**, so re-running cannot overwrite a value the
   employer has since corrected.
3. **Each pattern is anchored to the start of a line.** An employer whose prose
   contains "Ask about Compensation: it is negotiable" gets `NULL`, not a
   compensation value.

Two bugs the tests caught during development, both of which would have shipped
silent:

- `\z` is **not** a valid PostgreSQL ARE anchor. The responsibilities backfill
  needed it and matched nothing, recovering three of four fields while appearing
  to work. It is now positional (`strpos` + `split_part` on a blank-line
  separator), which is exact for the format the form wrote.
- Normalising employment type must lowercase **before** stripping non-letters.
  `[^a-z]+` does not match an uppercase letter, so stripping first turned
  `Full-time` into `_ull_time` and every capitalised form label was discarded.

### Read and write paths

Reads prefer the column and fall back to the legacy block. The fallback earns
its place: a row with a null column but a recognisable block is one the backfill
did not reach, and dropping the parse would turn those jobs' fields into silently
missing values. The column always wins once an employer edits through the form.

Writes no longer flatten anything. `src/lib/employers/job-description.ts` keeps
`parseJobDescription` as a read-only legacy path and **no longer exports
`buildJobDescription`**, so the format cannot be reintroduced.

The employment-type form options are generated from
`JOB_EMPLOYMENT_TYPES` in `@/lib/employer/service`, so the form cannot offer a
value the check constraint would refuse. The post-job form's first option is
"Not stated" (empty string, stored as `NULL`) rather than a default: defaulting
to full-time would put a job in front of candidates who filtered for full-time
roles.

`src/lib/employer/service.ts` now declares its `employer_jobs` column list once as
`JOB_COLUMNS` instead of repeating it verbatim at six call sites — the shape of
bug where a column is added to the table, three call sites learn about it, and
the other three return a row with the field silently missing.

---

## Where it is wired

| Layer | File |
| ----- | ---- |
| Migration | `supabase/migrations/20261120000000_employer_applicant_identity_and_job_fields.sql` |
| pgTAP | `supabase/tests/employer-applicant-identity.test.sql` |
| DB types | `src/types/database.ts` (`employer_jobs` Row/Insert/Update, new RPC) |
| Identity read | `src/lib/employer/hiring.ts` — `listApplicantIdentities`, `EmployerApplicantIdentity` |
| Job service | `src/lib/employer/service.ts` — `JOB_COLUMNS`, `JOB_EMPLOYMENT_TYPES`, `toStoredEmploymentType`, `toFormEmploymentType` |
| Candidate adapters | `src/lib/employers/candidates-adapter.ts`, `pipeline-adapter.ts` |
| Job adapter | `src/lib/employers/jobs-adapter.ts` — `toStructuredFields`, column-first with legacy fallback |
| Legacy read | `src/lib/employers/job-description.ts` — read-only, no serialiser |
| Client actions | `src/lib/employers/actions.ts` |
| API | `src/app/api/employer/orgs/[orgId]/candidates/route.ts`, `.../candidates/[applicationId]/route.ts`, `.../jobs/route.ts`, `.../jobs/[jobId]/route.ts` |
| UI | `src/app/employers/candidates/page.tsx`, `candidates/[id]/page.tsx`, `jobs/[id]/page.tsx`, `src/components/employers/post-job-form.tsx`, `edit-job-form.tsx` |

---

## Verifying

```bash
supabase db reset --local
supabase test db --local
supabase db lint --local --level warning
npx tsc --noEmit
npm run lint
npm test
npm run build
```
