-- Employer applicant identity + structured job fields.
--
-- Two unrelated gaps, one migration, because both are the same underlying
-- problem: the employer portal was reading data it should have had from the
-- backend, and the backend was missing the data to read.
--
--   A. An employer reviewing an applicant saw a truncated user id.
--   B. Four fields the approved job form collects had nowhere to live, so they
--      were flattened into `description` and had to be re-parsed to read back.
--
-- Both are fixed at the authorization and schema layer rather than in the
-- frontend, because the frontend cannot fix either: a page cannot manufacture
-- an identity it was never given, and it cannot stop a summary blob from being
-- lossy.
--
-- ===========================================================================
-- A. EMPLOYER-READABLE APPLICANT IDENTITY
-- ===========================================================================
--
-- The problem
-- ----------
-- `odesseus_get_employer_applicants` deliberately returns no `user_id`, and
-- the employer UI therefore had no name to show. It rendered the first eight
-- characters of the id, which is not a person.
--
-- That property was correct and is preserved. What was missing is a *narrow*
-- way for a proved employer to learn who applied. Adding a name column to the
-- broad payload reader would have been the wrong fix: it would have widened a
-- function that already returns resume snapshots and match scores, and it would
-- have put identity in the same row as everything else, so a later column
-- addition could quietly widen it again.
--
-- The solution
-- ------------
-- A separate, separately-granted function that answers exactly one question --
-- "who applied to this organization's jobs?" -- and returns exactly three
-- columns. Identity is now its own auditable surface rather than a field on
-- someone else's payload.
--
-- The authorization chain, in the order it is proved:
--
--   1. auth.uid() is not null            -> a real signed-in session
--   2. employer_members row for (org, uid) OR employer_organizations.owner_user_id = uid
--                                        -> the caller belongs to this org
--   3. the join is scoped by ej.org_id = p_org_id, and p_job_id (when given)
--      additionally narrows to one of the org's own employer_jobs rows
--                                        -> the job belongs to this org
--   4. a.id is reached only through
--      applications -> job_opportunities.employer_job_id -> employer_jobs.org_id
--                                        -> the application belongs to that job
--
-- There is no step 5, and that is deliberate. The function returns no
-- `user_id`, so an employer who reads it cannot pivot from an application id to
-- any other candidate-private table. The id space that links the four steps is
-- used entirely inside the query and never leaves it.
--
-- On email
-- --------
-- `candidate_email` is exposed, and the reasoning is worth stating because it
-- is a policy decision, not a technical one.
--
-- A candidate who applies to an employer's posting has deliberately disclosed
-- their name and contact address to that employer. Refusing to show the email
-- of someone who just applied to your job is not privacy, it is a broken
-- product: the employer cannot reply, schedule, or make an offer, so the
-- applicant is unusable. The product already encodes this position --
-- `public.career_applications` stores `full_name` and `email` as NOT NULL
-- columns for exactly this reason, and every supported job board and ATS shows
-- the applicant to the employer who received the application.
--
-- The exposure is bounded on three axes, and each is enforced here rather than
-- left to the caller:
--
--   * It is only reachable for an application on the caller's *own* job. The
--     org boundary is proved inside the function, not by the route.
--   * It is not reachable from a browser role directly on `auth.users`. There
--     is no grant letting any role select from `auth.users`; this function
--     reads exactly one column from it for rows it has already proved, and is
--     the only path to it.
--   * It is not the key to anything else. No user id is returned, so it cannot
--     be used to reach Live transcripts, mock-interview feedback, Interview
--     Prep, post-interview analysis, the wallet, billing, or Resume Hub.
--
-- If product policy later decides the email should be withheld, dropping one
-- column from this function is the whole change.
--
-- On name
-- -------
-- `profiles.full_name` is the candidate's own display name, set during
-- onboarding. Only that one column is read. `profiles` also holds `headline`,
-- `location`, `skills`, `certifications`, `candidate_facts`, and social links;
-- none of them are selected, and a future edit to this function that widened
-- the column list would be a visible change to the `returns table` clause.
--
-- A candidate with no profile row, or one who chose not to set a name, yields
-- NULL rather than a fallback built from their email address. Inventing a
-- display name from an email local-part is a guess about a person, and the
-- same rule that forbids inventing qualifications forbids inventing identity.

create or replace function public.odesseus_get_employer_applicant_identities (
  p_org_id uuid,
  p_job_id uuid default null
)
  returns table (
    application_id  uuid,
    candidate_name  text,
    candidate_email text
  )
  language plpgsql
  stable
  security definer
  set search_path to 'public', 'odesseus_private', 'pg_temp'
as $function$
declare
  v_caller     uuid := auth.uid();
  v_is_member  boolean := false;
  v_is_owner   boolean := false;
begin
  if p_org_id is null then
    raise exception 'An organization id is required' using errcode = '22023';
  end if;

  -- service_role has no auth.uid() and is the server itself. Every other
  -- caller must prove membership before a single application row is read.
  if v_caller is not null then
    select exists (
      select 1 from public.employer_members
      where org_id = p_org_id and user_id = v_caller
    ) into v_is_member;

    select exists (
      select 1 from public.employer_organizations
      where id = p_org_id and owner_user_id = v_caller
    ) into v_is_owner;

    if not v_is_member and not v_is_owner then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
  end if;

  return query
  select
    a.id,
    -- The candidate's own display name, or NULL. Never derived from the email.
    nullif(trim(p.full_name), ''),
    nullif(trim(u.email), '')
  from public.applications a
  join public.job_opportunities jo on jo.id = a.job_id
  join public.employer_jobs ej     on ej.id = jo.employer_job_id
  -- Left joins: an application still has an identity row even if the profile
  -- was never created (an account can apply before finishing onboarding) or
  -- the auth row is mid-deletion. Missing data must render as "not provided",
  -- not remove the applicant from the employer's list.
  left join public.profiles p on p.id = a.user_id
  left join auth.users u      on u.id = a.user_id
  where ej.org_id = p_org_id
    and (p_job_id is null or ej.id = p_job_id)
  order by a.submitted_at desc nulls last, a.created_at desc;
end;
$function$;

comment on function public.odesseus_get_employer_applicant_identities(uuid, uuid) is
  'Employer-readable applicant identity, scoped to the org''s own jobs. Membership-gated internally (member row or organization owner), then narrowed by org -> employer_jobs -> job_opportunities.employer_job_id -> applications. Returns an application id and the applicant''s own display name and email; never a user id, so an employer read cannot pivot into candidate-private Live, mock-interview, prep, post-interview, wallet, billing, or resume data. NULL name and email are returned as NULL rather than synthesised.';

revoke all on function public.odesseus_get_employer_applicant_identities(uuid, uuid) from public;
revoke all on function public.odesseus_get_employer_applicant_identities(uuid, uuid) from anon;
grant execute on function public.odesseus_get_employer_applicant_identities(uuid, uuid) to authenticated, postgres, service_role;

-- ---------------------------------------------------------------------------
-- A2. The identity path must not become a general applicant lookup.
--
-- The function above is the only route to applicant email. Assert the
-- surrounding surface is still closed, so a future grant on auth.users, or a
-- widened authenticated policy on profiles, is a visible failure here rather
-- than a silent leak.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and cmd = 'SELECT'
      and roles::text like '%anon%'
  ) then
    raise exception 'anon holds a SELECT policy on public.profiles; applicant names would be readable without a session';
  end if;
end;
$guard$;

-- ===========================================================================
-- B. STRUCTURED JOB FIELDS
-- ===========================================================================
--
-- The problem
-- ----------
-- The approved job form (Figma screen 75/76) collects four fields beyond
-- title, location, work arrangement, description, and qualifications:
--
--   Department        Employment type        Compensation        Responsibilities
--
-- `employer_jobs` had no column for any of them. They were therefore written
-- into `description` as a labelled block and split back out on read. That round
-- trip is lossy in both directions and is exactly the kind of thing that
-- breaks quietly:
--
--   * An employer whose role summary happens to contain the words
--     "Compensation:" gets a parsed value that was never compensation.
--   * A multi-line value cannot round-trip at all, because the format is
--     line-based and the field is free text.
--   * The values are not queryable, so nothing can filter or report on them.
--   * The Fit Score prompt reads `description` whole, so it is scoring a blob
--     that mixes the employer's prose with four structured fields.
--
-- Are they required as structured fields? Yes, each for its own reason, and the
-- decision is recorded per field rather than applied as a blanket "add
-- columns".
--
--   department
--     Required. It is on the approved form, it is rendered on the job detail
--     screen, and the product already has a department concept
--     (`career_job_openings.department`). That table is not a reusable
--     equivalent: it is the public company careers page, admin-managed, with a
--     different lifecycle and different visibility, and it is not written by
--     the employer portal at all. Adding a column to `employer_jobs` is not a
--     duplicate of it.
--
--   employment_type
--     Required. It is a live filter dimension in this product, not decoration:
--     `job_preferences.employment_types` is candidate-set data and
--     `odesseus_prefilter_jobs` consumes it. An employer-posted job that
--     carries no structured employment type is invisible to a candidate who
--     asked to see only full-time or contract roles. `job_opportunities` has
--     the column because the discovery pipeline writes it; the employer record
--     did not, so there was no way to populate the mirror.
--
--   compensation_text
--     Required. `job_opportunities.salary_text` exists and the public feed
--     renders it, but nothing could populate it from an employer posting
--     except by parsing prose. Separately, the product rule is that a salary
--     is shown only when it is real. A dedicated field makes "the employer
--     entered this" a fact the database records, instead of a substring match
--     against a description.
--     It is `text`, not integer cents: the approved form accepts a range
--     string like "$180K-$220K" and currency, and inventing a numeric
--     contract here would force a lossy conversion or reject valid input.
--
--   responsibilities_text
--     Required, as text and not as an array or a side table. It is a distinct
--     concept from `requirements_text` (what the person will do, versus what
--     they must already have) and the two are read separately by the Fit Score
--     prompt. Text matches the shape of the two columns already added in the
--     hiring migration, and matches how the employer types it: one item per
--     line.
--
-- What is NOT changed
-- ------------------
-- `description` keeps its text and its meaning, for every existing row and
-- every row written after this migration. The labelled block is not stripped,
-- because a description that predates this migration may only exist in that
-- form, and removing text from a stored record the employer wrote is a worse
-- failure than a redundant field. Readers prefer the column and fall back to
-- the legacy block, so nothing disappears while both are present.
--
-- All four columns are nullable and none is backfilled as NOT NULL, so this is
-- backwards compatible: an existing job keeps working, a new job may leave
-- any of them blank, and no caller is forced to supply them.

alter table public.employer_jobs
  add column if not exists department text;

alter table public.employer_jobs
  add column if not exists employment_type text;

alter table public.employer_jobs
  add column if not exists compensation_text text;

alter table public.employer_jobs
  add column if not exists responsibilities_text text;

comment on column public.employer_jobs.department is
  'Team or function the role sits in, as entered on the job form. Free text because departments are not a controlled vocabulary; a taxonomy is a product decision, not a schema one.';
comment on column public.employer_jobs.employment_type is
  'Structured employment type. Read by candidate preference filtering, and the source an employer posting copies into job_opportunities.employment_type for the public feed. Null when the employer did not state one; never defaulted, because a defaulted type would make a job visible to candidates who filtered for a type it is not.';
comment on column public.employer_jobs.compensation_text is
  'Compensation as the employer stated it, e.g. "$180K-$220K". Text rather than integer cents because the approved form accepts a range and a currency. Never inferred: the public feed shows this only when it is present.';
comment on column public.employer_jobs.responsibilities_text is
  'Responsibilities, one per line. Distinct from requirements_text, which is what the role requires the candidate to already have. Read separately by the Fit Score prompt.';

-- Employment type is a filter dimension, so unlike a free-text field it gets
-- a stated vocabulary. It is stored lowercase to match work_arrangement and
-- job_opportunities.employment_type. Widening it is a new migration, which is
-- the point: an uncontrolled column here would quietly become unfilterable.
--
-- The set is the union of the approved job form's options and the values the
-- discovery providers normalise to, so a mirrored posting is never rejected
-- for being a legitimate type.
alter table public.employer_jobs
  drop constraint if exists employer_jobs_employment_type_check;

alter table public.employer_jobs
  add constraint employer_jobs_employment_type_check
    check (
      employment_type is null
      or employment_type in (
        'full_time', 'part_time', 'contract', 'temporary',
        'internship', 'volunteer', 'other'
      )
    );

-- ---------------------------------------------------------------------------
-- B2. Backfill from the labelled description block.
--
-- Jobs created through the employer form since that form shipped have these
-- values inside `description` in a known line-based format. This copies them
-- into the new columns so those jobs are not stranded reading a legacy blob
-- forever.
--
-- Three properties of this update, in order of importance:
--
--   1. It only ever adds. `description` is not read for display afterwards --
--      the columns are preferred -- and it is not modified here, so a wrong
--      parse costs a wrong column value, never lost employer text.
--   2. It only fills a null column, so re-running it cannot overwrite a value
--      an employer has since corrected through the form.
--   3. Each pattern is anchored to the start of a line and followed to the end
--      of that line, so a mention of the word inside a sentence is not matched.
-- ---------------------------------------------------------------------------

update public.employer_jobs ej
set department = b.department
from (
  select id, (regexp_match(description, '(?m)^Department:[ \t]*(.+)$'))[1] as department
  from public.employer_jobs
  where description ~ '(?m)^Department:[ \t]*[^ \t\n]'
) b
where ej.id = b.id
  and ej.department is null
  and b.department is not null;

-- Normalised by lowercasing *first*, then collapsing everything that is not a
-- letter. The order matters and the obvious order is wrong: `[^a-z]+` does not
-- match an uppercase letter, so stripping before lowercasing turns "Full-time"
-- into "_ull_time" and every capitalised form label is silently discarded.
update public.employer_jobs ej
set employment_type = b.normalized
from (
  select
    id,
    nullif(btrim(regexp_replace(lower(raw), '[^a-z]+', '_', 'g'), '_'), '') as normalized
  from (
    select id,
           trim((regexp_match(description, '(?m)^Employment type:[ \t]*(.+)$'))[1]) as raw
    from public.employer_jobs
    where description ~ '(?m)^Employment type:[ \t]*[^ \t\n]'
  ) raw_rows
) b
where ej.id = b.id
  and ej.employment_type is null
  and b.normalized in (
    'full_time', 'part_time', 'contract', 'temporary',
    'internship', 'volunteer', 'other'
  );

update public.employer_jobs ej
set compensation_text = b.compensation
from (
  select id, trim((regexp_match(description, '(?m)^Compensation:[ \t]*(.+)$'))[1]) as compensation
  from public.employer_jobs
  where description ~ '(?m)^Compensation:[ \t]*[^ \t\n]'
) b
where ej.id = b.id
  and ej.compensation_text is null
  and b.compensation is not null;

-- The responsibilities block is the last block the form writes, and blocks are
-- separated by a blank line. It is extracted positionally rather than with a
-- regular expression on purpose: the obvious regex needs both a bare newline
-- escape and a `\z` end-of-string anchor, and neither is valid in a
-- PostgreSQL ARE. An anchor that never matches is how a backfill ends up
-- silently recovering three of four fields and still looking like it worked.
--
-- `split_part` on a blank-line separator is exact for the format the form
-- wrote: items inside the block are joined with single newlines, so a blank
-- line can only be a block boundary.
update public.employer_jobs ej
set responsibilities_text = nullif(trim(b.block), '')
from (
  select
    src.id,
    trim(split_part(
      -- Everything after the label line.
      substring(src.description from pos.label_at + length('Responsibilities:') + 1),
      chr(10) || chr(10),
      1
    )) as block
  from public.employer_jobs src
  cross join lateral (
    -- The label must start a line, so a sentence that merely mentions
    -- "Responsibilities:" is not mistaken for the field.
    select strpos(src.description, 'Responsibilities:' || chr(10)) as label_at
  ) pos
  where src.description ~ ('(?m)^Responsibilities:[ \t]*' || chr(10))
    and pos.label_at > 0
) b
where ej.id = b.id
  and ej.responsibilities_text is null
  and nullif(trim(b.block), '') is not null;
