-- Spec employer pricing: AI Starter Bundle, $10 add-on posts, two clocks.
--
-- Contract:
--   * AI Starter Bundle — $100 USD every 30 days, 5 base job-post credits per
--     billing cycle. Base credits must be used in that cycle; unused ones
--     expire at the cycle end (no rollover).
--   * Additional job posts — $10 each, purchasable only while the bundle is
--     active. Each add-on credit expires 30 days after its own purchase
--     timestamp and stays valid even if the bundle later lapses.
--
-- Two independent clocks:
--   * CREDIT clock — employer_job_post_credits.expires_at (cycle end for base
--     credits, purchase + 30 days for add-ons).
--   * JOB POST clock — employer_jobs.expires_at, a fresh 30 days from the
--     moment a credit is consumed to publish.
--
-- Job states:
--   * published (Active) — public; its 30-day clock runs.
--   * paused — hidden; the original clock keeps running; reactivating inside
--     the window is free. No refund.
--   * closed (Filled / Closed) — permanent, applicant data archived, no
--     refund, cannot be reopened (post it again as a new job).
--   * expired — the 30-day window ended. Reposting consumes a new credit and
--     starts a new 30-day clock. With auto_renew on, expiry consumes a credit
--     and relaunches automatically when one is available.
--
-- Earlier plans (Starter $79 / Growth $149 / Business $299) are no longer
-- sold. Existing subscribers keep renewing on their tier and keep their
-- credits; the tier vocabulary only grows.
--
-- Additive: nothing is deleted; RLS is unchanged.

-- ---------------------------------------------------------------------------
-- 1. Catalog
-- ---------------------------------------------------------------------------
UPDATE public.pricing_products
SET active = true, display_name = 'AI Starter Bundle', updated_at = now()
WHERE product_key = 'employer_starter_bundle';
UPDATE public.pricing_products
SET active = true, display_name = 'Additional job post', updated_at = now()
WHERE product_key = 'employer_addon_post';
UPDATE public.pricing_prices
SET active = true, updated_at = now()
WHERE product_key IN ('employer_starter_bundle', 'employer_addon_post');

UPDATE public.pricing_products
SET active = false, updated_at = now()
WHERE product_key IN ('employer_starter', 'employer_growth', 'employer_business');
UPDATE public.pricing_prices
SET active = false, updated_at = now()
WHERE product_key IN ('employer_starter', 'employer_growth', 'employer_business');

UPDATE public.pricing_prices AS p
SET amount_minor = v.amount_minor, updated_at = now()
FROM (VALUES
  ('employer_starter_bundle', 10000),
  ('employer_addon_post',      1000)
) AS v(product_key, amount_minor)
WHERE p.product_key = v.product_key
  AND p.market_key = 'USD_US';

-- ---------------------------------------------------------------------------
-- 2. Subscription tier + credit kinds
-- ---------------------------------------------------------------------------
ALTER TABLE public.employer_subscriptions
  DROP CONSTRAINT IF EXISTS employer_subscriptions_tier_check;
ALTER TABLE public.employer_subscriptions
  ADD CONSTRAINT employer_subscriptions_tier_check
  CHECK (tier IN ('ai_starter', 'starter', 'growth', 'business'));

COMMENT ON COLUMN public.employer_subscriptions.tier IS
  'ai_starter = AI Starter Bundle ($100 / 30 days, 5 base credits). starter / growth / business are earlier plans kept for existing subscribers.';

ALTER TABLE public.employer_job_post_credits
  ADD COLUMN kind text NOT NULL DEFAULT 'base'
    CHECK (kind IN ('base', 'addon'));
ALTER TABLE public.employer_job_post_credits
  ADD COLUMN external_reference text UNIQUE;

COMMENT ON COLUMN public.employer_job_post_credits.kind IS
  'base = granted by a paid billing cycle, expires at the cycle end; addon = a $10 purchase, expires 30 days after purchase.';
COMMENT ON COLUMN public.employer_job_post_credits.expires_at IS
  'The CREDIT clock. Independent of employer_jobs.expires_at (the JOB POST clock).';

CREATE INDEX IF NOT EXISTS employer_job_post_credits_usable_idx
  ON public.employer_job_post_credits (org_id, expires_at)
  WHERE used < total;

-- ---------------------------------------------------------------------------
-- 3. Job post lifecycle columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.employer_jobs
  DROP CONSTRAINT IF EXISTS employer_jobs_status_check;
ALTER TABLE public.employer_jobs
  ADD CONSTRAINT employer_jobs_status_check
  CHECK (status IN ('draft', 'published', 'paused', 'closed', 'expired'));

ALTER TABLE public.employer_jobs
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN auto_renew boolean NOT NULL DEFAULT false,
  ADD COLUMN post_cycle integer NOT NULL DEFAULT 0 CHECK (post_cycle >= 0),
  ADD COLUMN credit_grant_id uuid REFERENCES public.employer_job_post_credits(id),
  ADD COLUMN closed_reason text CHECK (closed_reason IS NULL OR closed_reason IN ('filled', 'closed'));

COMMENT ON COLUMN public.employer_jobs.status IS
  'draft (no credit), published (Active, public), paused (hidden, clock keeps running), closed (Filled/Closed, permanent), expired (30-day window ended).';
COMMENT ON COLUMN public.employer_jobs.expires_at IS
  'The JOB POST clock: 30 days from the moment a credit was consumed to publish. Pausing never moves it.';
COMMENT ON COLUMN public.employer_jobs.auto_renew IS
  'When true, expiry consumes an available credit and relaunches the post for a fresh 30 days.';
COMMENT ON COLUMN public.employer_jobs.post_cycle IS
  'How many 30-day posting windows this job has paid for. Keys the per-window credit ledger reference.';

CREATE INDEX IF NOT EXISTS employer_jobs_live_expiry_idx
  ON public.employer_jobs (expires_at)
  WHERE status IN ('published', 'paused');

-- Existing published jobs paid for one window under the earlier contract.
-- Give them a full 30 days from now rather than expiring them abruptly.
UPDATE public.employer_jobs
SET expires_at = now() + interval '30 days',
    post_cycle = 1,
    updated_at = now()
WHERE status = 'published' AND expires_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Credit consumption on publish (JOB POST clock)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION odesseus_private.claim_job_post_credit()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_grant_id uuid;
  v_ref      text;
begin
  -- Filled / Closed is permanent: the listing ended and its applicant data
  -- is archived. A new opening is a new job.
  if tg_op = 'UPDATE' and old.status = 'closed' and new.status <> 'closed' then
    raise exception 'a closed job cannot be reopened';
  end if;

  if new.status <> 'published' then
    return new;
  end if;

  -- Reactivating a paused job (or re-saving an active one) inside its
  -- original 30-day window is free and never extends the window.
  if tg_op = 'UPDATE'
     and old.status in ('published', 'paused')
     and old.expires_at is not null
     and old.expires_at > now() then
    new.expires_at := old.expires_at;
    new.posted_at := coalesce(old.posted_at, new.posted_at);
    new.credit_grant_id := old.credit_grant_id;
    new.post_cycle := old.post_cycle;
    return new;
  end if;

  -- A new 30-day posting window: consume exactly one credit.
  new.post_cycle := (case when tg_op = 'UPDATE' then old.post_cycle else 0 end) + 1;
  v_ref := 'job_post:' || new.id::text || ':' || new.post_cycle::text;

  -- Spend the credit that expires soonest, so a credit is never wasted while
  -- a longer-lived one is consumed first. FOR UPDATE serializes concurrent
  -- publishers; SKIP LOCKED avoids waiting behind another publish.
  select c.id
  into v_grant_id
  from public.employer_job_post_credits c
  where c.org_id = new.org_id
    and c.used < c.total
    and (c.expires_at is null or c.expires_at > now())
  order by c.expires_at asc nulls last, c.granted_at asc, c.id asc
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
  values (new.org_id, -1, 'job_post', v_ref);

  new.credit_grant_id := v_grant_id;
  new.posted_at := now();
  new.expires_at := now() + interval '30 days';
  new.closed_reason := null;
  return new;
end;
$function$;

-- Same trigger; re-created so it is explicit which function it runs.
DROP TRIGGER IF EXISTS trg_employer_jobs_claim_credit ON public.employer_jobs;
CREATE TRIGGER trg_employer_jobs_claim_credit
  BEFORE INSERT OR UPDATE OF status ON public.employer_jobs
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.claim_job_post_credit();

-- ---------------------------------------------------------------------------
-- 5. Base credits: the AI Starter Bundle grants 5 per paid cycle
-- ---------------------------------------------------------------------------
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
    when 'ai_starter' then 5
    when 'starter'    then 3
    when 'growth'     then 10
    when 'business'   then 25
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
        period_start = coalesce(excluded.period_start, employer_subscriptions.period_start),
        period_end = coalesce(excluded.period_end, employer_subscriptions.period_end),
        stripe_customer_id = excluded.stripe_customer_id
  returning id into v_sub_id;

  -- Base credits: one grant per fresh, money-verified, active period. They
  -- expire at the period end — unused base credits never roll over.
  if p_grant_credits and p_status = 'active' and p_period_start is not null then
    v_ref := 'tier_grant:' || p_org_id::text || ':' || p_tier || ':' || p_period_start::text;

    insert into public.job_post_credit_ledger (org_id, delta, reason, external_reference)
    values (p_org_id, v_jobs, 'tier_grant', v_ref)
    on conflict (external_reference) do nothing;

    get diagnostics v_granted = row_count;

    if v_granted > 0 then
      insert into public.employer_job_post_credits (org_id, total, granted_at, expires_at, kind, external_reference)
      values (p_org_id, v_jobs, now(), coalesce(p_period_end, now() + interval '30 days'), 'base', v_ref);
      v_granted := v_jobs;
    end if;
  end if;

  return query select v_sub_id, v_granted, v_jobs;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Add-on credits ($10 each, own 30-day clock from purchase)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.odesseus_grant_employer_addon_credits (
  p_org_id       uuid,
  p_quantity     integer,
  p_reference    text,
  p_purchased_at timestamptz DEFAULT now()
)
  RETURNS TABLE (
    credits_granted integer,
    expires_at      timestamptz,
    already_granted boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_purchased timestamptz := coalesce(p_purchased_at, now());
  v_expires   timestamptz := coalesce(p_purchased_at, now()) + interval '30 days';
  v_inserted  integer;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then
    raise exception 'add-on quantity must be between 1 and 100';
  end if;

  if p_reference is null or length(trim(p_reference)) = 0 then
    raise exception 'a purchase reference is required';
  end if;

  if not exists (select 1 from public.employer_organizations where id = p_org_id) then
    raise exception 'employer organization not found';
  end if;

  insert into public.job_post_credit_ledger (org_id, delta, reason, external_reference)
  values (p_org_id, p_quantity, 'addon_purchase', 'addon:' || p_reference)
  on conflict (external_reference) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return query
    select c.total, c.expires_at, true
    from public.employer_job_post_credits c
    where c.external_reference = 'addon:' || p_reference;
    return;
  end if;

  insert into public.employer_job_post_credits (org_id, total, granted_at, expires_at, kind, external_reference)
  values (p_org_id, p_quantity, v_purchased, v_expires, 'addon', 'addon:' || p_reference);

  return query select p_quantity, v_expires, false;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_grant_employer_addon_credits(uuid, integer, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_grant_employer_addon_credits(uuid, integer, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_grant_employer_addon_credits(uuid, integer, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_grant_employer_addon_credits(uuid, integer, text, timestamptz) TO postgres, service_role;

-- Whether the org may buy $10 add-ons right now: only with an active (or
-- trialing) AI Starter Bundle inside its paid period.
CREATE OR REPLACE FUNCTION public.odesseus_employer_can_buy_addons(p_org_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  select exists (
    select 1 from public.employer_subscriptions s
    where s.org_id = p_org_id
      and s.tier = 'ai_starter'
      and s.status in ('active', 'trialing')
      and (s.period_end is null or s.period_end > now())
  );
$function$;

REVOKE ALL ON FUNCTION public.odesseus_employer_can_buy_addons(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_employer_can_buy_addons(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_employer_can_buy_addons(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_employer_can_buy_addons(uuid) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 7. Expiry + auto-renew (scheduled)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.odesseus_process_expired_employer_jobs(p_limit integer DEFAULT 500)
  RETURNS TABLE (
    job_id     uuid,
    org_id     uuid,
    title      text,
    outcome    text,
    expires_at timestamptz
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_job public.employer_jobs%rowtype;
begin
  for v_job in
    select j.*
    from public.employer_jobs j
    where j.status in ('published', 'paused')
      and j.expires_at is not null
      and j.expires_at <= now()
    order by j.expires_at asc
    limit greatest(coalesce(p_limit, 500), 1)
    for update skip locked
  loop
    if v_job.status = 'published' and v_job.auto_renew then
      begin
        -- Expire, then publish again: the claim trigger sees a new window and
        -- consumes a credit. Without one it raises, this block rolls back
        -- both updates, and the job is expired below instead.
        update public.employer_jobs set status = 'expired', updated_at = now() where id = v_job.id;
        update public.employer_jobs set status = 'published', updated_at = now() where id = v_job.id;

        return query
        select v_job.id, v_job.org_id, v_job.title, 'renewed'::text,
               (select e.expires_at from public.employer_jobs e where e.id = v_job.id);
        continue;
      exception when others then
        update public.employer_jobs set status = 'expired', updated_at = now() where id = v_job.id;

        return query
        select v_job.id, v_job.org_id, v_job.title, 'renewal_failed'::text, v_job.expires_at;
        continue;
      end;
    end if;

    update public.employer_jobs set status = 'expired', updated_at = now() where id = v_job.id;

    return query
    select v_job.id, v_job.org_id, v_job.title, 'expired'::text, v_job.expires_at;
  end loop;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_process_expired_employer_jobs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_process_expired_employer_jobs(integer) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_process_expired_employer_jobs(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_process_expired_employer_jobs(integer) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 8. Notifications: three lifecycle emails + credit-based capacity
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_notification_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_notification_type_check
  CHECK (notification_type IN (
    -- Candidate catalog (24)
    'JOB_STRONG_MATCH',
    'APPLICATION_NEEDS_REVIEW',
    'APPLICATION_NEEDS_INPUT',
    'APPLICATION_SUBMITTED',
    'APPLICATION_VERIFIED',
    'APPLICATION_FAILED',
    'APPLICATION_CAPTCHA_REQUIRED',
    'APPLICATION_MFA_REQUIRED',
    'APPLICATION_SENSITIVE_QUESTION',
    'APPLICATION_MANUAL_ACTION_REQUIRED',
    'INTERVIEW_REMINDER',
    'INTERVIEW_PREP_READY',
    'MOCK_INTERVIEW_FEEDBACK_READY',
    'WALLET_LOW_BALANCE',
    'WALLET_TOPUP_SUCCEEDED',
    'APPLICATION_CHARGE_POSTED',
    'PREMIUM_INTERVIEW_PURCHASED',
    'PREMIUM_INTERVIEW_RENEWAL',
    'PREMIUM_INTERVIEW_EXPIRING',
    'GUEST_ACCESS_CREATED',
    'GUEST_ACCESS_ACTIVATED',
    'GUEST_ACCESS_COMPLETED',
    'GUEST_ACCESS_REVOKED',
    'PRODUCT_UPDATE',
    -- Employer catalog (14)
    'EMPLOYER_NEW_APPLICANT',
    'EMPLOYER_STRONG_FIT',
    'EMPLOYER_PIPELINE_UPDATED',
    'EMPLOYER_INTERVIEW_EVENT',
    'EMPLOYER_JOB_CAPACITY_WARNING',
    'EMPLOYER_JOB_CAPACITY_REACHED',
    'EMPLOYER_RECRUITER_SEAT_WARNING',
    'EMPLOYER_SUBSCRIPTION_EVENT',
    'EMPLOYER_PAYMENT_FAILED',
    'EMPLOYER_FEATURED_JOB_EXPIRING',
    'EMPLOYER_FEATURED_JOB_EXPIRED',
    'EMPLOYER_BASE_CREDITS_EXPIRING',
    'EMPLOYER_ADDON_CREDIT_EXPIRING',
    'EMPLOYER_JOB_POST_EXPIRED'
  ));

CREATE OR REPLACE FUNCTION odesseus_private.notification_employer_channel(p_type text)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  select case p_type
    when 'EMPLOYER_NEW_APPLICANT' then 'new_applicants'
    when 'EMPLOYER_STRONG_FIT' then 'strong_fit'
    when 'EMPLOYER_PIPELINE_UPDATED' then 'pipeline'
    when 'EMPLOYER_INTERVIEW_EVENT' then 'interview_events'
    when 'EMPLOYER_JOB_CAPACITY_WARNING' then 'capacity'
    when 'EMPLOYER_JOB_CAPACITY_REACHED' then 'capacity'
    when 'EMPLOYER_RECRUITER_SEAT_WARNING' then 'capacity'
    when 'EMPLOYER_SUBSCRIPTION_EVENT' then 'billing'
    when 'EMPLOYER_PAYMENT_FAILED' then 'billing'
    when 'EMPLOYER_FEATURED_JOB_EXPIRING' then 'featured'
    when 'EMPLOYER_FEATURED_JOB_EXPIRED' then 'featured'
    when 'EMPLOYER_BASE_CREDITS_EXPIRING' then 'billing'
    when 'EMPLOYER_ADDON_CREDIT_EXPIRING' then 'billing'
    when 'EMPLOYER_JOB_POST_EXPIRED' then 'capacity'
    else null
  end;
$function$;

-- Capacity is now "usable job-post credits", not a count of live jobs: a
-- publish that leaves exactly 1 or 0 usable credits warns the team.
CREATE OR REPLACE FUNCTION odesseus_private.trg_notification_employer_job_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_remaining int;
  v_type text;
  v_title text;
  v_member record;
begin
  -- Only a publish that opened a new paid window spends a credit.
  if new.status <> 'published' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.post_cycle = new.post_cycle then
    return new;
  end if;

  select coalesce(sum(c.total - c.used), 0)::int into v_remaining
    from public.employer_job_post_credits c
   where c.org_id = new.org_id
     and c.used < c.total
     and (c.expires_at is null or c.expires_at > now());

  if v_remaining = 1 then
    v_type := 'EMPLOYER_JOB_CAPACITY_WARNING';
    v_title := '1 job-post credit left';
  elsif v_remaining = 0 then
    v_type := 'EMPLOYER_JOB_CAPACITY_REACHED';
    v_title := 'No job-post credits left';
  else
    return new;
  end if;

  for v_member in
    select user_id from public.employer_members where org_id = new.org_id
    union
    select owner_user_id from public.employer_organizations where id = new.org_id
  loop
    perform odesseus_private.record_notification(
      v_member.user_id, 'employer_member', new.org_id,
      v_type,
      v_title,
      case when v_remaining = 0
        then 'Buy additional job posts or wait for your next AI Starter Bundle cycle to publish again.'
        else 'You can publish one more job with your current credits.'
      end,
      'employer_job', new.id, null,
      case when v_remaining = 0 then 'high' else 'normal' end,
      null,
      jsonb_build_object('credits_remaining', v_remaining)
    );
  end loop;

  return new;
end;
$function$;
