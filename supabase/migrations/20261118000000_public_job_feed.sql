-- Public homepage job feed store (Phase: homepage job feed).
--
-- Shared, provider-sourced job postings plus mirrored Odesseus employer
-- postings. This table is the ONLY job store readable without a user id;
-- per-user discovery rows (job_opportunities) stay private as before.
--
-- Freshness model: ingestion refreshes last_seen_at on every sighting and
-- keeps is_active true; rows unseen for longer than the staleness window
-- (applied by the ingestion service, default 30 days) are flipped inactive,
-- as are employer rows whose posting is no longer published. Nothing is
-- deleted: history stays queryable for audit and dedupe.
--
-- Dedupe identity is (source_key, external_id): provider slug feeds use
-- "provider:slug" + the provider's id; the employer mirror uses
-- source_key 'employer' + the employer_jobs id. Upserts converge repeats.
--
-- Salary, logo, and tags appear only when the source supplies them. Missing
-- values stay null; nothing is fabricated or defaulted.

create table if not exists public.public_job_posts (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  external_id text not null,
  provider text not null,
  company_name text not null check (length(trim(company_name)) > 0),
  title text not null check (length(trim(title)) > 0),
  location text,
  work_arrangement text,
  employment_type text,
  salary_text text,
  description text not null,
  source_url text,
  apply_url text,
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_job_posts_unique_source_external
    unique (source_key, external_id)
);

comment on table public.public_job_posts is
  'Shared public job feed: normalized provider postings plus mirrored published employer jobs. Served through GET /api/jobs/home-feed only; no direct anonymous reads.';

create index if not exists public_job_posts_active_seen_idx
  on public.public_job_posts (is_active, last_seen_at desc);
create index if not exists public_job_posts_provider_idx
  on public.public_job_posts (provider);
create index if not exists public_job_posts_company_idx
  on public.public_job_posts (company_name);

-- No direct reads by any client role: the feed API serves an allowlisted
-- projection through the service role, which bypasses RLS. Least privilege:
-- no grants to anon or authenticated at all.
alter table public.public_job_posts enable row level security;

revoke all on table public.public_job_posts from anon, authenticated;
grant all privileges on table public.public_job_posts to postgres, service_role;

analyze public.public_job_posts;

-- End of 20261118000000_public_job_feed.sql
