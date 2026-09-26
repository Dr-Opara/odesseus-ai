-- Employer jobs + subscription quota sync (M4). Additive migration; local stack.
--
-- Builds the employer-side job posting table that the pricing contract's
-- featured_listings.job_id was deferred to (see 20260924000000_current_pricing_contract.sql,
-- where job_id is a bare uuid with a comment documenting the deferral):
--   1. public.employer_jobs — the real employer job posting table, org-scoped
--      and RLS-protected. Posting a job (status -> 'published') consumes one
--      job-post credit; featured ownership and recruiter access now bind to a
--      real row instead of a bare uuid.
--   2. odesseus_private.claim_job_post_credit() — a SECURITY DEFINER trigger
--      that atomically consumes a job-post credit from the org's oldest
--      eligible grant (employer_job_post_credits), writing an immutable
--      job_post_credit_ledger row with a unique ref 'job_post:<job_id>' so a
--      job can never consume twice and concurrency cannot oversell.
--   3. public.odesseus_sync_employer_subscription() — a service-role-only RPC
--      the billing webhook calls on invoice.paid / subscription lifecycle
--      events. It upserts employer_subscriptions and, for an active paid
--      period, grants the tier's job-post credits exactly once per period
--      ('tier_grant:<org>:<tier>:<period_start>' ledger ref). Replays of the
--      same period are no-ops.
--   4. featured_listings.job_id FK now binds to employer_jobs(id).
--
-- Invariants preserved: additive-only; RLS extended, never weakened; credits
-- and balances server-side only; employer pricing ($79/$149/$299) unchanged
-- and verified against pricing_prices in the webhook; candidate wallet and
-- apply settlement untouched; Live pricing untouched.

-- ---------------------------------------------------------------------------
-- 1. Employer jobs
-- ---------------------------------------------------------------------------

CREATE TABLE public.employer_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.employer_organizations(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (length(trim(title)) > 0),
  description text,
  location    text,
  status      text NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'published', 'closed')),
  posted_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.employer_jobs IS
  'Employer job posting. Publishing consumes one job-post credit from the org''s plan grant.';
COMMENT ON COLUMN public.employer_jobs.status IS
  'draft (no credit consumed), published (one credit consumed), closed (expired/paused posting).';

CREATE INDEX employer_jobs_org_idx ON public.employer_jobs (org_id);
CREATE INDEX employer_jobs_org_status_idx ON public.employer_jobs (org_id, status);

ALTER TABLE public.employer_jobs ENABLE ROW LEVEL SECURITY;

-- Members (owner, admin, recruiter, viewer) may read the org's postings.
CREATE POLICY "employer_jobs_select_member" ON public.employer_jobs
  FOR SELECT TO authenticated
  USING (odesseus_private.is_org_member(org_id));

-- Owners and admins manage postings (is_org_admin_or_owner includes the org
-- owner via employer_organizations.owner_user_id). The claim trigger is the
-- credit gate; a publisher without credits gets a clear rollback, never a
-- partial row.
CREATE POLICY "employer_jobs_insert_admin_owner" ON public.employer_jobs
  FOR INSERT TO authenticated
  WITH CHECK (odesseus_private.is_org_admin_or_owner(org_id));

CREATE POLICY "employer_jobs_update_admin_owner" ON public.employer_jobs
  FOR UPDATE TO authenticated
  USING (odesseus_private.is_org_admin_or_owner(org_id))
  WITH CHECK (odesseus_private.is_org_admin_or_owner(org_id));

CREATE POLICY "employer_jobs_delete_admin_owner" ON public.employer_jobs
  FOR DELETE TO authenticated
  USING (odesseus_private.is_org_admin_or_owner(org_id));

REVOKE ALL ON TABLE public.employer_jobs FROM anon, authenticated;
GRANT SELECT ON TABLE public.employer_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.employer_jobs TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 2. Job-post credit claim trigger (quota enforcement)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION odesseus_private.claim_job_post_credit()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_grant_id uuid;
begin
  -- Only publishing consumes a credit; drafts and closes never do. This lets
  -- teams build a posting in draft before spending an employer plan credit.
  if new.status <> 'published' then
    return new;
  end if;

  -- Exactly one credit per job posting. The unique ledger ref makes this
  -- idempotent: re-saving a published job, or replaying a lost response,
  -- never consumes a second credit.
  if exists (
    select 1 from public.job_post_credit_ledger
    where external_reference = 'job_post:' || new.id::text
  ) then
    return new;
  end if;

  -- Lock the org's eligible grant with the oldest grant first (FIFO reuse).
  -- FOR UPDATE serializes concurrent publishers so two posts cannot both
  -- see the same last credit, and skipping already-locked rows via the
  -- eligibility predicate below prevents lock waits across exhausted grants.
  select c.id
  into v_grant_id
  from public.employer_job_post_credits c
  where c.org_id = new.org_id
    and c.used < c.total
    and (c.expires_at is null or c.expires_at > now())
  order by c.granted_at asc, c.id asc
  limit 1
  for update of c skip locked;

  if v_grant_id is null then
    raise exception 'no job post credits available for this employer';
  end if;

  update public.employer_job_post_credits
  set used = used + 1
  where id = v_grant_id and used < total;

  if not found then
    raise exception 'no job post credits available for this employer';
  end if;

  insert into public.job_post_credit_ledger (org_id, delta, reason, external_reference)
  values (new.org_id, -1, 'job_post', 'job_post:' || new.id::text);

  return new;
end;
$function$;

CREATE TRIGGER trg_employer_jobs_claim_credit
  BEFORE INSERT OR UPDATE OF status ON public.employer_jobs
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.claim_job_post_credit();

-- ---------------------------------------------------------------------------
-- 3. Subscription webhook sync (service-role only)
-- ---------------------------------------------------------------------------

-- Idempotent plan sync driven by the Stripe webhook (invoice.paid and
-- customer.subscription.* events). Upserts employer_subscriptions and, when
-- the subscription is active for a fresh paid period, grants the tier's
-- job-post credits exactly once per period. Replaying the same webhook event
-- (or a redundant invoice.paid + subscription.updated pair) is a no-op.
-- Browser roles can never invoke it: it writes billing-owned rows.
CREATE OR REPLACE FUNCTION public.odesseus_sync_employer_subscription (
  p_org_id                uuid,
  p_tier                  text,
  p_status                text,
  p_stripe_subscription_id text,
  p_stripe_customer_id    text,
  p_period_start          timestamptz,
  p_period_end            timestamptz DEFAULT NULL,
  p_grant_credits         boolean DEFAULT true
)
  RETURNS TABLE (
    subscription_id  uuid,
    credits_granted  integer,
    job_posts_total  integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_jobs        integer := case p_tier
    when 'starter'  then 3
    when 'growth'   then 10
    when 'business' then 25
    else null
  end;
  v_sub_id      uuid;
  v_granted     integer := 0;
  v_ref         text;
begin
  if v_jobs is null then
    raise exception 'unknown employer tier: %', p_tier;
  end if;

  if p_status not in ('active', 'past_due', 'canceled', 'trialing', 'incomplete') then
    raise exception 'unknown subscription status: %', p_status;
  end if;

  if not exists (select 1 from public.employer_organizations where id = p_org_id) then
    raise exception 'employer organization not found';
  end if;

  if p_stripe_subscription_id is null or length(trim(p_stripe_subscription_id)) = 0 then
    raise exception 'a stripe subscription id is required to sync';
  end if;

  insert into public.employer_subscriptions (
    org_id, tier, status, job_posts_included, period_start, period_end,
    stripe_subscription_id, stripe_customer_id
  )
  values (
    p_org_id, p_tier, p_status, v_jobs, p_period_start, p_period_end,
    p_stripe_subscription_id, p_stripe_customer_id
  )
  on conflict (stripe_subscription_id) do update
    set tier = excluded.tier,
        status = excluded.status,
        job_posts_included = excluded.job_posts_included,
        -- Status-only lifecycle events carry no period; preserve the paid
        -- period recorded by invoice.paid rather than wiping it to NULL.
        period_start = coalesce(excluded.period_start, employer_subscriptions.period_start),
        period_end = coalesce(excluded.period_end, employer_subscriptions.period_end),
        stripe_customer_id = excluded.stripe_customer_id
  returning id into v_sub_id;

  -- Grant credits only for a fresh, active paid period and only when the
  -- caller is the money-verified path (invoice.paid passes p_grant_credits
  -- true; status-only subscription.updated/deleted passes false).
  if p_grant_credits and p_status = 'active' and p_period_start is not null then
    v_ref := 'tier_grant:' || p_org_id::text || ':' || p_tier || ':' || p_period_start::text;

    insert into public.job_post_credit_ledger (org_id, delta, reason, external_reference)
    values (p_org_id, v_jobs, 'tier_grant', v_ref)
    on conflict (external_reference) do nothing;

    get diagnostics v_granted = row_count;

    if v_granted > 0 then
      insert into public.employer_job_post_credits (org_id, total, granted_at, expires_at)
      values (p_org_id, v_jobs, now(), coalesce(p_period_end, now() + interval '30 days'));
      -- Row count mirrors how many ledger rows (1) were inserted, but the
      -- contract is the number of job-post credits actually granted.
      v_granted := v_jobs;
    end if;
  end if;

  return query select v_sub_id, v_granted, v_jobs;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_sync_employer_subscription(uuid, text, text, text, text, timestamptz, timestamptz, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_sync_employer_subscription(uuid, text, text, text, text, timestamptz, timestamptz, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_sync_employer_subscription(uuid, text, text, text, text, timestamptz, timestamptz, boolean) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.odesseus_sync_employer_subscription(uuid, text, text, text, text, timestamptz, timestamptz, boolean) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 4. Featured listings now reference a real job posting
-- ---------------------------------------------------------------------------

-- The pricing contract left featured_listings.job_id as a bare uuid because
-- the employer job postings table did not exist yet. It exists now, so the
-- deferred ownership FK is added. Empty-table add in the local stack; dev
-- rows (Path A fixtures) always carry job ids and are unaffected.
ALTER TABLE public.featured_listings
  ADD CONSTRAINT featured_listings_job_id_fkey
  FOREIGN KEY (job_id) REFERENCES public.employer_jobs(id);

COMMENT ON CONSTRAINT featured_listings_job_id_fkey ON public.featured_listings IS
  'Featured listings reference a real employer job posting (added with employer_jobs in M4).';