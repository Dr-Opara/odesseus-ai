-- Odesseus notifications backend (Phase 2K).
--
-- One authoritative notification model for both surfaces, written by the same
-- trigger machinery that already owns the candidate activity stream, plus the
-- preference and delivery layers the product rules require.
--
-- What exists and is reused, not duplicated:
--
--   * notification_preferences (M8) is extended in place (new channels +
--     outbound-email switch) instead of being replaced.
--   * Outbound email reuses src/lib/email/send.ts + the email_delivery retry
--     job; this migration never calls a provider.
--   * retry_jobs is the durable queue; notification emails are enqueued as
--     email_delivery jobs with deterministic idempotency keys.
--   * candidate_activity_events stays the feed; notifications are a separate
--     surface with read state, preference gating and delivery state.
--
-- Writes, not reads: this phase records what the system did, at the transition
-- that did it, inside the same transaction. A notification the frontend invents
-- is not a notification; a notification the database never loses is.
--
-- Preference semantics (documented, mirrored in src/lib/notifications):
--
--   * Each channel boolean decides whether notifications of that channel are
--     RECORDED at all (in-app). A channel that is off is suppressed at the
--     source, not hidden at render time -- one row per logical event, and a
--     user who opted out of matches never sees a strong-match row.
--   * A small critical set is never suppressible: application blockers a
--     candidate must clear to keep applying (CAPTCHA / MFA / sensitive
--     question / manual action) and wallet low balance. Losing one of those
--     costs the candidate money or an application, so no preference can hide it.
--   * `email` (new column) is the outbound switch for the recipient. When it
--     is off, the in-app row still records; only the email is skipped. Marketing
--     (product) updates additionally require the product channel, which
--     defaults to off, so nothing promotional is ever emitted by default.
--
-- Email delivery is deliberately asynchronous: the business transition writes
-- the notification row with email_delivery_status = 'none', and the delivery
-- cron (src/lib/notifications/email.ts) enqueues email_delivery retry jobs
-- later. A down email provider can never roll back an application, a wallet
-- charge or a subscription sync.
--
-- No applicant inbox access: this phase sends, never reads. Google OAuth stays
-- authentication-only, and no mailbox, IMAP or email-response detection is
-- added here (see live-guests / integration rules).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Notifications records
--
-- One row is one notification to one recipient. Candidate notifications are
-- scoped by recipient_user_id only; employer notifications additionally carry
-- the organization so a member's feed can be org-scoped and cross-org reads
-- are impossible even for a user who belongs to two organizations.
-- ---------------------------------------------------------------------------

CREATE TABLE public.notifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_type       text NOT NULL CHECK (recipient_type IN ('candidate', 'employer_member')),
  organization_id      uuid REFERENCES public.employer_organizations(id) ON DELETE CASCADE,
  notification_type    text NOT NULL CHECK (notification_type IN (
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
    -- Employer catalog (11)
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
    'EMPLOYER_FEATURED_JOB_EXPIRED'
  )),
  title                text NOT NULL CHECK (length(btrim(title)) > 0),
  message              text,
  entity_type          text NOT NULL CHECK (entity_type IN (
    'application', 'application_run', 'job_opportunity', 'interview',
    'credit_transaction', 'employer_job', 'employer_organization',
    'featured_listing', 'account'
  )),
  entity_id            uuid NOT NULL,
  action_url           text,
  priority             text NOT NULL DEFAULT 'normal'
                       CHECK (priority IN ('normal', 'high', 'urgent')),
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz,
  dedupe_key           text,
  email_delivery_status text NOT NULL DEFAULT 'none'
                       CHECK (email_delivery_status IN ('none', 'skipped', 'queued', 'sent')),
  CHECK (recipient_type <> 'employer_member' OR organization_id IS NOT NULL),
  CHECK (recipient_type = 'employer_member' OR organization_id IS NULL)
);

COMMENT ON TABLE public.notifications IS
  'Authoritative notification records for candidates and employer members. '
  'Append-only from the browser: rows are written by triggers and server '
  'jobs, and a recipient may only SELECT their own rows and UPDATE read_at.';
COMMENT ON COLUMN public.notifications.dedupe_key IS
  'Deterministic per-recipient idempotency key. One logical event (a retried '
  'finalization, a replayed webhook, a repeated scoring pass) yields at most '
  'one row per recipient. See notifications_recipient_dedupe_key.';
COMMENT ON COLUMN public.notifications.email_delivery_status IS
  'none = not evaluated yet; skipped = email not wanted (opt-out or type not '
  'email-capable); queued = email_delivery retry job enqueued; sent = provider '
  'accepted. In-app delivery never depends on this column.';
COMMENT ON COLUMN public.notifications.expires_at IS
  'Optional shelf life for self-cleaning notifications. Currently unused by '
  'the Phase 2K wire-up; reserved for flows that need it.';

CREATE INDEX notifications_recipient_created_idx
  ON public.notifications (recipient_user_id, created_at DESC);
CREATE INDEX notifications_recipient_unread_idx
  ON public.notifications (recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX notifications_recipient_type_idx
  ON public.notifications (recipient_user_id, notification_type, created_at DESC);
CREATE UNIQUE INDEX notifications_recipient_dedupe_key
  ON public.notifications (recipient_user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- A recipient may read their own rows. Employer rows additionally require that
-- the reader still belongs to the organization: a former member whose auth
-- user id still matches a row must not read it after leaving.
CREATE POLICY "notifications_select_candidate_own" ON public.notifications
  FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid() AND recipient_type = 'candidate');

CREATE POLICY "notifications_select_employer_own" ON public.notifications
  FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid() AND recipient_type = 'employer_member'
         AND (odesseus_private.is_org_member(organization_id)
              OR odesseus_private.is_org_admin_or_owner(organization_id)));

-- Mark-read only. The UPDATE column grant caps write surface to read_at, so
-- a recipient cannot retitle, re-route, or re-type a row the system wrote.
CREATE POLICY "notifications_update_candidate_own" ON public.notifications
  FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid() AND recipient_type = 'candidate')
  WITH CHECK (recipient_user_id = auth.uid() AND recipient_type = 'candidate');

CREATE POLICY "notifications_update_employer_own" ON public.notifications
  FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid() AND recipient_type = 'employer_member'
         AND (odesseus_private.is_org_member(organization_id)
              OR odesseus_private.is_org_admin_or_owner(organization_id)))
  WITH CHECK (recipient_user_id = auth.uid() AND recipient_type = 'employer_member'
              AND (odesseus_private.is_org_member(organization_id)
                   OR odesseus_private.is_org_admin_or_owner(organization_id)));

REVOKE ALL ON TABLE public.notifications FROM anon, authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT UPDATE (read_at) ON TABLE public.notifications TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.notifications TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 2. Interview reminder schedule
--
-- A reminder is a due computation (scheduled_at - window) materialized at
-- scheduling time, in the interview's timezone, and fired by a cron when it
-- comes due. One row per (interview, window); cancelled/completed interviews
-- are reconciled to 'cancelled' so no future reminder can fire. Rows are
-- server-written (triggers + cron); no browser role has any privilege.
-- ---------------------------------------------------------------------------

CREATE TABLE public.notification_reminders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  interview_id         uuid NOT NULL REFERENCES public.interviews(id) ON DELETE CASCADE,
  reminder_type        text NOT NULL CHECK (reminder_type IN ('1_day', '1_hour')),
  due_at               timestamptz NOT NULL,
  timezone             text,
  status               text NOT NULL DEFAULT 'scheduled'
                       CHECK (status IN ('scheduled', 'fired', 'cancelled')),
  fired_notification_id uuid REFERENCES public.notifications(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interview_id, reminder_type)
);

COMMENT ON TABLE public.notification_reminders IS
  'Interview reminder schedule. due_at is anchored to the interview''s '
  'absolute time (scheduled_at - window) so the instant is timezone-correct '
  'regardless of where the interview sits. Reminder windows come from '
  'odesseus_private.notification_interview_reminder_minutes(), mirrored by '
  'INTERVIEW_REMINDER_MINUTES in src/lib/notifications/reminders.ts.';
COMMENT ON COLUMN public.notification_reminders.status IS
  'scheduled = not yet due; fired = cron materialized the notification; '
  'cancelled = interview cancelled/completed or rescheduled away. A fired '
  'reminder is never resurrected by a later reschedule (no second reminder '
  'for the same window).';

ALTER TABLE public.notification_reminders ENABLE ROW LEVEL SECURITY;

-- Deny all browser roles outright: reminders are server-written (triggers +
-- cron) and expose schedule timing that no client needs. This is a real deny
-- policy, not an absence of policies, so the RLS audit's "every public table
-- has at least one policy / is covered by scoping" rules hold.
CREATE POLICY "notification_reminders_deny_browser_access" ON public.notification_reminders
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.notification_reminders FROM anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.notification_reminders TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 3. Employer notification preferences
--
-- Organization-scoped: one row per org decides what the team is notified
-- about. Members may read it; only owners/admins may change it (mirrors the
-- employer_jobs ownership split). Notifications are sent per member, so this
-- is the org's notification policy -- individual employers can mute further
-- at the product layer; Phase 2K keeps one row per org, documented.
-- ---------------------------------------------------------------------------

CREATE TABLE public.employer_notification_preferences (
  org_id           uuid PRIMARY KEY REFERENCES public.employer_organizations(id) ON DELETE CASCADE,
  new_applicants   boolean NOT NULL DEFAULT true,
  strong_fit       boolean NOT NULL DEFAULT true,
  pipeline         boolean NOT NULL DEFAULT true,
  interview_events boolean NOT NULL DEFAULT true,
  capacity         boolean NOT NULL DEFAULT true,
  billing          boolean NOT NULL DEFAULT true,
  featured         boolean NOT NULL DEFAULT true,
  email            boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.employer_notification_preferences IS
  'Employer notification policy per organization. Channel columns gate '
  'recording for that org''s members; `email` gates outbound email. All on by '
  'default: employer notifications are transactional (applicants, capacity, '
  'billing), never marketing.';

ALTER TABLE public.employer_notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employer_notification_preferences_select_member" ON public.employer_notification_preferences
  FOR SELECT TO authenticated
  USING (odesseus_private.is_org_member(org_id)
         OR odesseus_private.is_org_admin_or_owner(org_id));

CREATE POLICY "employer_notification_preferences_insert_admin_owner" ON public.employer_notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (odesseus_private.is_org_admin_or_owner(org_id));

CREATE POLICY "employer_notification_preferences_update_admin_owner" ON public.employer_notification_preferences
  FOR UPDATE TO authenticated
  USING (odesseus_private.is_org_admin_or_owner(org_id))
  WITH CHECK (odesseus_private.is_org_admin_or_owner(org_id));

REVOKE ALL ON TABLE public.employer_notification_preferences FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.employer_notification_preferences TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.employer_notification_preferences TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 4. Candidate preferences: new channels + outbound email switch
-- ---------------------------------------------------------------------------

ALTER TABLE public.notification_preferences
  ADD COLUMN interview_reminders boolean NOT NULL DEFAULT true,
  ADD COLUMN wallet_billing boolean NOT NULL DEFAULT true,
  ADD COLUMN email boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.notification_preferences.interview_reminders IS
  'Interview reminders, prep-ready and mock-feedback notifications (on).';
COMMENT ON COLUMN public.notification_preferences.wallet_billing IS
  'Wallet top-ups, application charges, low balance, premium interview billing (on).';
COMMENT ON COLUMN public.notification_preferences.email IS
  'Master outbound-email switch for this candidate. Off keeps in-app rows; it '
  'only stops email delivery. Critical types still in-app regardless of channel.';

-- ---------------------------------------------------------------------------
-- 5. Catalog helpers: type -> channel, and the recording gates
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION odesseus_private.notification_candidate_channel(p_type text)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  select case p_type
    when 'JOB_STRONG_MATCH' then 'matches'
    when 'APPLICATION_NEEDS_REVIEW' then 'applications'
    when 'APPLICATION_NEEDS_INPUT' then 'applications'
    when 'APPLICATION_SUBMITTED' then 'applications'
    when 'APPLICATION_VERIFIED' then 'applications'
    when 'APPLICATION_FAILED' then 'applications'
    when 'APPLICATION_CAPTCHA_REQUIRED' then 'applications'
    when 'APPLICATION_MFA_REQUIRED' then 'applications'
    when 'APPLICATION_SENSITIVE_QUESTION' then 'applications'
    when 'APPLICATION_MANUAL_ACTION_REQUIRED' then 'applications'
    when 'INTERVIEW_REMINDER' then 'interview_reminders'
    when 'INTERVIEW_PREP_READY' then 'interview_reminders'
    when 'MOCK_INTERVIEW_FEEDBACK_READY' then 'interview_reminders'
    when 'WALLET_LOW_BALANCE' then 'wallet_billing'
    when 'WALLET_TOPUP_SUCCEEDED' then 'wallet_billing'
    when 'APPLICATION_CHARGE_POSTED' then 'wallet_billing'
    when 'PREMIUM_INTERVIEW_PURCHASED' then 'wallet_billing'
    when 'PREMIUM_INTERVIEW_RENEWAL' then 'wallet_billing'
    when 'PREMIUM_INTERVIEW_EXPIRING' then 'wallet_billing'
    when 'GUEST_ACCESS_CREATED' then 'activity'
    when 'GUEST_ACCESS_ACTIVATED' then 'activity'
    when 'GUEST_ACCESS_COMPLETED' then 'activity'
    when 'GUEST_ACCESS_REVOKED' then 'activity'
    when 'PRODUCT_UPDATE' then 'product'
    else null
  end;
$function$;

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
    else null
  end;
$function$;

-- Critical candidate types: never suppressible. Losing one of these costs the
-- candidate an application or money, so no preference toggle can hide it.
CREATE OR REPLACE FUNCTION odesseus_private.notification_candidate_is_critical(p_type text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  select p_type in (
    'APPLICATION_CAPTCHA_REQUIRED',
    'APPLICATION_MFA_REQUIRED',
    'APPLICATION_SENSITIVE_QUESTION',
    'APPLICATION_MANUAL_ACTION_REQUIRED',
    'WALLET_LOW_BALANCE'
  );
$function$;

-- Whether a candidate notification type may be recorded for p_user_id right
-- now. Critical types always pass; everything else asks the channel toggle,
-- with the documented defaults when the user has no preferences row yet.
CREATE OR REPLACE FUNCTION odesseus_private.notification_candidate_gate(p_user_id uuid, p_type text)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_channel text;
  v_prefs public.notification_preferences%rowtype;
begin
  if odesseus_private.notification_candidate_is_critical(p_type) then
    return true;
  end if;

  v_channel := odesseus_private.notification_candidate_channel(p_type);
  if v_channel is null then
    return false;
  end if;

  select * into v_prefs from public.notification_preferences
   where user_id = p_user_id;

  return case v_channel
    when 'applications'      then coalesce(v_prefs.applications, true)
    when 'matches'           then coalesce(v_prefs.matches, true)
    when 'activity'          then coalesce(v_prefs.activity, true)
    when 'interview_reminders' then coalesce(v_prefs.interview_reminders, true)
    when 'wallet_billing'    then coalesce(v_prefs.wallet_billing, true)
    when 'product'           then coalesce(v_prefs.product, false)
    else false
  end;
end;
$function$;

-- Employer counterpart: org-scoped preference row, all-on defaults.
CREATE OR REPLACE FUNCTION odesseus_private.notification_employer_gate(p_org_id uuid, p_type text)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_channel text;
  v_prefs public.employer_notification_preferences%rowtype;
begin
  v_channel := odesseus_private.notification_employer_channel(p_type);
  if v_channel is null then
    return false;
  end if;

  select * into v_prefs from public.employer_notification_preferences
   where org_id = p_org_id;

  return case v_channel
    when 'new_applicants'   then coalesce(v_prefs.new_applicants, true)
    when 'strong_fit'       then coalesce(v_prefs.strong_fit, true)
    when 'pipeline'         then coalesce(v_prefs.pipeline, true)
    when 'interview_events' then coalesce(v_prefs.interview_events, true)
    when 'capacity'         then coalesce(v_prefs.capacity, true)
    when 'billing'          then coalesce(v_prefs.billing, true)
    when 'featured'         then coalesce(v_prefs.featured, true)
    else false
  end;
end;
$function$;

-- Stable action target for a candidate notification, derived from the entity
-- type. Top-level pages only: no route is invented beyond what the app serves.
CREATE OR REPLACE FUNCTION odesseus_private.notification_action_url(p_recipient_type text, p_entity_type text)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  select case
    when p_recipient_type = 'employer_member' then '/employers'
    when p_entity_type = 'application_run' then '/apply'
    when p_entity_type = 'application' then '/applications'
    when p_entity_type = 'job_opportunity' then '/jobs'
    when p_entity_type = 'interview' then '/interviews'
    when p_entity_type = 'credit_transaction' then '/billing'
    else null
  end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. The single notification recorder
--
-- The only writer besides the server-side service. Like record_candidate_activity
-- it never raises: a missed notification is a cosmetic defect, a failed
-- application is not. Dedupe via (recipient_user_id, dedupe_key).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION odesseus_private.record_notification (
  p_recipient_user_id uuid,
  p_recipient_type text,
  p_organization_id uuid,
  p_notification_type text,
  p_title text,
  p_message text,
  p_entity_type text,
  p_entity_id uuid,
  p_action_url text,
  p_priority text DEFAULT 'normal',
  p_dedupe_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
begin
  if p_recipient_user_id is null then
    return;
  end if;

  if p_recipient_type = 'candidate' then
    if not odesseus_private.notification_candidate_gate(p_recipient_user_id, p_notification_type) then
      return;
    end if;
  else
    if p_organization_id is null
       or not odesseus_private.notification_employer_gate(p_organization_id, p_notification_type) then
      return;
    end if;
  end if;

  insert into public.notifications (
    recipient_user_id, recipient_type, organization_id, notification_type,
    title, message, entity_type, entity_id, action_url, priority,
    dedupe_key, metadata
  )
  values (
    p_recipient_user_id,
    p_recipient_type,
    p_organization_id,
    p_notification_type,
    left(coalesce(nullif(btrim(p_title), ''), 'Notification'), 200),
    case when p_message is null then null else left(p_message, 500) end,
    coalesce(p_entity_type, 'account'),
    coalesce(p_entity_id, p_recipient_user_id),
    coalesce(p_action_url, odesseus_private.notification_action_url(p_recipient_type, coalesce(p_entity_type, 'account'))),
    p_priority,
    p_dedupe_key,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (recipient_user_id, dedupe_key) where dedupe_key is not null do nothing;
exception
  when others then
    raise warning 'notifications: record_notification failed for % (%): %',
      p_recipient_user_id, p_notification_type, sqlerrm;
end;
$function$;

COMMENT ON FUNCTION odesseus_private.record_notification(
  uuid, text, uuid, text, text, text, text, uuid, text, text, text, jsonb
) IS
  'The trigger-side writer of public.notifications. Consults the recipient '
  'gate, deduplicates on (recipient_user_id, dedupe_key), and deliberately '
  'never raises so it can live inside wallet settlement and finalization.';

REVOKE ALL ON FUNCTION odesseus_private.record_notification(
  uuid, text, uuid, text, text, text, text, uuid, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION odesseus_private.record_notification(
  uuid, text, uuid, text, text, text, text, uuid, text, text, text, jsonb
) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 7. Config helpers with a mirrored TS constant
--
-- A documented threshold, not a hardcoded product decision scattered across
-- files. The TS side (src/lib/notifications/email.ts and reminders.ts) pins
-- the same values in tests against these functions.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION odesseus_private.notification_wallet_low_threshold_cents()
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  -- $5.00. Mirrored by WALLET_LOW_THRESHOLD_CENTS in
  -- src/lib/notifications/email.ts (pinned by migration-notifications.test.ts).
  select 500;
$function$;

CREATE OR REPLACE FUNCTION odesseus_private.notification_interview_reminder_minutes()
  RETURNS integer[]
  LANGUAGE sql
  STABLE
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  -- 24 hours before, then 1 hour before. Mirrored by INTERVIEW_REMINDER_MINUTES
  -- in src/lib/notifications/reminders.ts (pinned by a migration test).
  select array[1440, 60]::int[];
$function$;

-- ---------------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------------

-- 8.1 job_opportunities: JOB_STRONG_MATCH -----------------------------------
--
-- Emit only when the score first reaches the candidate's own strong-match
-- threshold (job_preferences.min_match_score, default 85). Re-scoring an
-- already-strong job is not a new match; the dedupe key makes that a hard
-- guarantee even if a recomputation crosses the branch again.
CREATE OR REPLACE FUNCTION odesseus_private.trg_notification_job_opportunity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_threshold int;
  v_role text := left(coalesce(nullif(btrim(new.role_title), ''), 'a role'), 120);
  v_company text := left(coalesce(nullif(btrim(new.company_name), ''), 'an employer'), 120);
begin
  if new.match_score is null then
    return new;
  end if;

  v_threshold := coalesce(
    (select min_match_score from public.job_preferences where user_id = new.user_id),
    85
  );

  -- Not a strong match for this candidate yet.
  if new.match_score < v_threshold then
    return new;
  end if;

  -- Already strong before this write; only the first crossing matters. The
  -- dedupe key below is the backstop for every path that reaches it twice.
  if tg_op = 'UPDATE' and old.match_score is not null and old.match_score >= v_threshold then
    return new;
  end if;

  perform odesseus_private.record_notification(
    new.user_id,
    'candidate',
    null,
    'JOB_STRONG_MATCH',
    'Strong match: ' || v_role || ' at ' || v_company,
    'Match score ' || new.match_score || ' of ' || v_threshold,
    'job_opportunity',
    new.id,
    null,
    'normal',
    'job:' || new.id::text || ':strong_match:' || new.user_id::text,
    jsonb_build_object('match_score', new.match_score, 'threshold', v_threshold, 'source', new.source)
  );

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_notification_job_opportunity ON public.job_opportunities;
CREATE TRIGGER trg_notification_job_opportunity
  AFTER INSERT OR UPDATE OF match_score ON public.job_opportunities
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.trg_notification_job_opportunity();

-- 8.2 applications: submitted / verified for the candidate, and
--     EMPLOYER_NEW_APPLICANT for the hiring org ------------------------------
--
-- submitted_at is the discriminator (the activity feed uses the same rule):
-- status keeps advancing long after submission, so an event keyed on status
-- would fire for every later update.
CREATE OR REPLACE FUNCTION odesseus_private.trg_notification_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_company text := left(coalesce(nullif(btrim(new.company_name), ''), 'an employer'), 120);
  v_role text := left(coalesce(nullif(btrim(new.role_title), ''), 'a role'), 120);
  v_verified boolean;
  v_employer_job_id uuid;
  v_org_id uuid;
  v_member record;
begin
  if new.submitted_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.submitted_at is not null then
    return new;
  end if;

  v_verified := coalesce(new.verification_evidence, '{}'::jsonb) <> '{}'::jsonb;

  perform odesseus_private.record_notification(
    new.user_id,
    'candidate',
    null,
    'APPLICATION_SUBMITTED',
    'Application submitted to ' || v_company,
    v_role,
    'application',
    new.id,
    null,
    'normal',
    'application:' || new.id::text || ':submitted',
    jsonb_build_object('verified', v_verified)
  );

  if v_verified then
    perform odesseus_private.record_notification(
      new.user_id,
      'candidate',
      null,
      'APPLICATION_VERIFIED',
      'Application to ' || v_company || ' verified',
      nullif(new.submission_confirmation, ''),
      'application',
      new.id,
      null,
      'normal',
      'application:' || new.id::text || ':verified',
      '{}'::jsonb
    );
  end if;

  -- Employer new-applicant: only when the job the application targets is an
  -- employer posting (job_opportunities.employer_job_id). Each member and the
  -- billing owner get their own row; the dedupe key is per recipient.
  select jo.employer_job_id into v_employer_job_id
    from public.job_opportunities jo
   where jo.id = new.job_id;

  if v_employer_job_id is not null then
    select org_id into v_org_id
      from public.employer_jobs
     where id = v_employer_job_id;

    if v_org_id is not null then
      for v_member in
        select user_id from public.employer_members where org_id = v_org_id
        union
        select owner_user_id from public.employer_organizations where id = v_org_id
      loop
        perform odesseus_private.record_notification(
          v_member.user_id,
          'employer_member',
          v_org_id,
          'EMPLOYER_NEW_APPLICANT',
          'New applicant: ' || v_role || ' at ' || v_company,
          'Applied through Odesseus',
          'application',
          new.id,
          null,
          'normal',
          'employer:' || v_org_id::text || ':new_applicant:' || new.id::text,
          jsonb_build_object('employer_job_id', v_employer_job_id)
        );
      end loop;
    end if;
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_notification_application ON public.applications;
CREATE TRIGGER trg_notification_application
  AFTER INSERT OR UPDATE OF submitted_at ON public.applications
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.trg_notification_application();

-- 8.3 application_runs: needs input / review / captcha / mfa / sensitive /
--     manual action / failed -------------------------------------------------
--
-- Mirrors the activity feed's transition rule: status and hold_category are
-- watched together so a hold escalation that leaves status alone still
-- notifies. Dedupe keys carry the run id so retried transitions do not
-- repeat; a run that moves between two manual-action holds notifies once per
-- hold because the key includes the category.
CREATE OR REPLACE FUNCTION odesseus_private.trg_notification_application_run()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_role text;
  v_company text;
begin
  if tg_op = 'INSERT' then
    return new;
  end if;
  if new.status is not distinct from old.status
     and new.hold_category is not distinct from old.hold_category then
    return new;
  end if;

  select left(coalesce(nullif(btrim(j.role_title), ''), 'a role'), 120),
         left(coalesce(nullif(btrim(j.company_name), ''), 'an employer'), 120)
    into v_role, v_company
    from public.job_opportunities j
   where j.id = new.job_id;

  if new.status = 'ready_to_submit' then
    perform odesseus_private.record_notification(
      new.user_id, 'candidate', null,
      'APPLICATION_NEEDS_REVIEW',
      'Ready to send to ' || coalesce(v_company, 'an employer') || ' — review it first',
      coalesce(v_role, null),
      'application_run', new.id, null, 'normal',
      'application_run:' || new.id::text || ':ready_to_submit',
      jsonb_build_object('execution_mode', new.execution_mode)
    );

  elsif new.status = 'needs_user' then
    case new.hold_category
      when 'captcha_required' then
        perform odesseus_private.record_notification(
          new.user_id, 'candidate', null,
          'APPLICATION_CAPTCHA_REQUIRED',
          'A CAPTCHA is blocking your application at ' || coalesce(v_company, 'an employer'),
          nullif(new.stop_reason, ''),
          'application_run', new.id, null, 'urgent',
          'application_run:' || new.id::text || ':captcha_required',
          jsonb_build_object('hold_category', new.hold_category)
        );
      when 'mfa_required' then
        perform odesseus_private.record_notification(
          new.user_id, 'candidate', null,
          'APPLICATION_MFA_REQUIRED',
          'Multi-factor authentication is required to continue at ' || coalesce(v_company, 'an employer'),
          nullif(new.stop_reason, ''),
          'application_run', new.id, null, 'urgent',
          'application_run:' || new.id::text || ':mfa_required',
          jsonb_build_object('hold_category', new.hold_category)
        );
      when 'sensitive_question' then
        perform odesseus_private.record_notification(
          new.user_id, 'candidate', null,
          'APPLICATION_SENSITIVE_QUESTION',
          'A sensitive question in the application at ' || coalesce(v_company, 'an employer') || ' needs your review',
          nullif(new.stop_reason, ''),
          'application_run', new.id, null, 'urgent',
          'application_run:' || new.id::text || ':sensitive_question',
          jsonb_build_object('hold_category', new.hold_category)
        );
      when 'insufficient_funds', 'unsupported_flow', 'unverified_submission' then
        perform odesseus_private.record_notification(
          new.user_id, 'candidate', null,
          'APPLICATION_MANUAL_ACTION_REQUIRED',
          'Your application at ' || coalesce(v_company, 'an employer') || ' needs a manual step',
          nullif(new.stop_reason, ''),
          'application_run', new.id, null, 'high',
          'application_run:' || new.id::text || ':manual_action_required:' || new.hold_category,
          jsonb_build_object('hold_category', new.hold_category)
        );
      else
        -- needs_review or unset: the run is waiting on a decision, not stuck.
        perform odesseus_private.record_notification(
          new.user_id, 'candidate', null,
          'APPLICATION_NEEDS_INPUT',
          'Needs your input to continue at ' || coalesce(v_company, 'an employer'),
          nullif(new.stop_reason, ''),
          'application_run', new.id, null, 'normal',
          'application_run:' || new.id::text || ':needs_input',
          jsonb_build_object('execution_mode', new.execution_mode)
        );
    end case;

  elsif new.status = 'failed' then
    perform odesseus_private.record_notification(
      new.user_id, 'candidate', null,
      'APPLICATION_FAILED',
      'Could not complete your application at ' || coalesce(v_company, 'an employer'),
      nullif(new.stop_reason, ''),
      'application_run', new.id, null, 'normal',
      'application_run:' || new.id::text || ':failed',
      jsonb_build_object('hold_category', new.hold_category)
    );
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_notification_application_run ON public.application_runs;
CREATE TRIGGER trg_notification_application_run
  AFTER INSERT OR UPDATE OF status, hold_category ON public.application_runs
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.trg_notification_application_run();

-- 8.4 credit_transactions: WALLET_TOPUP_SUCCEEDED / APPLICATION_CHARGE_POSTED /
--     WALLET_LOW_BALANCE ------------------------------------------------------
--
-- Low balance is a crossing, not a level: emit only when the balance falls
-- below the threshold from at or above it, so a candidate who stays low does
-- not get a notification for every charge. The before-balance is derived from
-- the recorded after-balance minus the signed delta -- the same arithmetic the
-- balance-sync trigger owns -- so the boundary is exact.
CREATE OR REPLACE FUNCTION odesseus_private.trg_notification_credit_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_threshold int := odesseus_private.notification_wallet_low_threshold_cents();
  v_before int;
begin
  if new.credit_type = 'wallet_topup' then
    perform odesseus_private.record_notification(
      new.user_id, 'candidate', null,
      'WALLET_TOPUP_SUCCEEDED',
      'Wallet topped up',
      nullif(new.reason, ''),
      'credit_transaction', new.id, null, 'normal',
      'wallet:' || new.id::text || ':topup',
      jsonb_build_object('credit_type', new.credit_type, 'delta', new.delta, 'amount_cents', new.amount_cents)
    );

  elsif new.credit_type in ('standard_apply', 'smart_apply', 'application')
        and new.delta < 0 then
    perform odesseus_private.record_notification(
      new.user_id, 'candidate', null,
      'APPLICATION_CHARGE_POSTED',
      case new.credit_type
        when 'smart_apply' then 'Charge posted for a smart application'
        when 'standard_apply' then 'Charge posted for a standard application'
        else 'Charge posted for an application'
      end,
      nullif(new.reason, ''),
      'credit_transaction', new.id, null, 'normal',
      'wallet:' || new.id::text || ':charge',
      jsonb_build_object('credit_type', new.credit_type, 'delta', new.delta, 'amount_cents', new.amount_cents)
    );
  end if;

  -- Low-balance crossing. balance_cents_after is set for wallet movements by
  -- the balance-sync trigger; guard null so legacy/unknown rows are skipped.
  if new.balance_cents_after is not null and new.delta < 0 then
    v_before := new.balance_cents_after - new.delta;
    if v_before >= v_threshold and new.balance_cents_after < v_threshold then
      perform odesseus_private.record_notification(
        new.user_id, 'candidate', null,
        'WALLET_LOW_BALANCE',
        'Your wallet balance is running low',
        'You have ' || new.balance_cents_after || ' cents left. Top up before your next application.',
        'credit_transaction', new.id, null, 'high',
        null,
        jsonb_build_object('balance_cents_after', new.balance_cents_after, 'threshold_cents', v_threshold)
      );
    end if;
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_notification_credit_transaction ON public.credit_transactions;
CREATE TRIGGER trg_notification_credit_transaction
  AFTER INSERT ON public.credit_transactions
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.trg_notification_credit_transaction();

-- 8.5 employer_jobs: EMPLOYER_JOB_CAPACITY_WARNING / REACHED -----------------
--
-- Capacity is subscription.job_posts_included minus published postings.
-- Emitted at the transition that crosses the boundary (into 1 remaining => n
-- warning; into 0 => reached), so a quiet period never re-notifies. The owner
-- and every member get a row.
CREATE OR REPLACE FUNCTION odesseus_private.trg_notification_employer_job_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_after int;
  v_before int;
  v_included int;
  v_remaining_after int;
  v_remaining_before int;
  v_type text;
  v_title text;
  v_member record;
begin
  select count(*) into v_after
    from public.employer_jobs
   where org_id = new.org_id and status = 'published';

  -- Reconstitute the count before this write: the AFTER row already includes
  -- the new value, so subtract the new row's contribution and add the old one.
  v_before := v_after
    - (case when new.status = 'published' then 1 else 0 end)
    + (case when tg_op = 'UPDATE' and old.status = 'published' then 1 else 0 end);

  select job_posts_included into v_included
    from public.employer_subscriptions
   where org_id = new.org_id
   limit 1;

  if v_included is null then
    return new;
  end if;

  v_remaining_before := v_included - v_before;
  v_remaining_after := v_included - v_after;

  -- Only crossings downward into the boundary notify.
  if v_remaining_after >= v_remaining_before then
    return new;
  end if;

  if v_remaining_after = 1 then
    v_type := 'EMPLOYER_JOB_CAPACITY_WARNING';
    v_title := 'About to reach your active job capacity';
  elsif v_remaining_after = 0 then
    v_type := 'EMPLOYER_JOB_CAPACITY_REACHED';
    v_title := 'Active job capacity reached';
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
      v_included - v_remaining_before || ' of ' || v_included || ' active jobs published',
      'employer_job', new.id, null,
      case when v_remaining_after = 0 then 'high' else 'normal' end,
      null,
      jsonb_build_object('jobs_published', v_after, 'job_posts_included', v_included)
    );
  end loop;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_notification_employer_job_capacity ON public.employer_jobs;
CREATE TRIGGER trg_notification_employer_job_capacity
  AFTER INSERT OR UPDATE OF status ON public.employer_jobs
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.trg_notification_employer_job_capacity();

-- 8.6 interviews: reminder schedule ------------------------------------------
--
-- Reconciliation on every status/scheduled_at write:
--   * cancelled/completed (or no longer scheduled): pending reminders are
--     cancelled, so nothing in the past or future can fire.
--   * a real future interview: per-window rows are upserted with due_at =
--     scheduled_at - window. Rows that already fired stay fired (no second
--     reminder for the same window); scheduled/cancelled rows are refreshed,
--     which is what makes a genuine reschedule re-arm the reminder.
CREATE OR REPLACE FUNCTION odesseus_private.trg_notification_interview()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_minutes int;
  v_type text;
begin
  if new.status in ('cancelled', 'completed') or new.scheduled_at is null then
    update public.notification_reminders
       set status = 'cancelled', updated_at = now()
     where interview_id = new.id and status = 'scheduled';
    return new;
  end if;

  -- Mock interviews are practice sessions; reminders are for real interviews.
  if new.interview_type = 'mock' then
    return new;
  end if;

  -- No reminders for an interview that is already underway or past.
  if new.scheduled_at <= now() then
    return new;
  end if;

  foreach v_minutes in array odesseus_private.notification_interview_reminder_minutes()
  loop
    v_type := case v_minutes
      when 1440 then '1_day'
      when 60 then '1_hour'
      else v_minutes::text
    end;

    insert into public.notification_reminders
      (user_id, interview_id, reminder_type, due_at, timezone, status)
    values
      (new.user_id, new.id, v_type, new.scheduled_at - (v_minutes || ' minutes')::interval, new.timezone, 'scheduled')
    on conflict (interview_id, reminder_type)
    do update
      set due_at = excluded.due_at,
          timezone = excluded.timezone,
          status = 'scheduled',
          updated_at = now()
      where notification_reminders.status is distinct from 'fired';
  end loop;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_notification_interview ON public.interviews;
CREATE TRIGGER trg_notification_interview
  AFTER INSERT OR UPDATE OF status, scheduled_at ON public.interviews
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.trg_notification_interview();

-- ---------------------------------------------------------------------------
-- 9. Privileges on the trigger functions
--
-- They live in odesseus_private, which no browser role can reach, and are
-- revoked from PUBLIC so that being granted the schema is never enough.
-- ---------------------------------------------------------------------------

DO $block$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'odesseus_private'
      AND p.proname LIKE 'trg_notification_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO postgres, service_role', r.sig);
  END LOOP;
END
$block$;

REVOKE ALL ON FUNCTION odesseus_private.notification_candidate_channel(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION odesseus_private.notification_employer_channel(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION odesseus_private.notification_candidate_is_critical(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION odesseus_private.notification_candidate_gate(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION odesseus_private.notification_employer_gate(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION odesseus_private.notification_action_url(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION odesseus_private.notification_wallet_low_threshold_cents() FROM PUBLIC;
REVOKE ALL ON FUNCTION odesseus_private.notification_interview_reminder_minutes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION odesseus_private.notification_candidate_channel(text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION odesseus_private.notification_employer_channel(text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION odesseus_private.notification_candidate_is_critical(text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION odesseus_private.notification_candidate_gate(uuid, text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION odesseus_private.notification_employer_gate(uuid, text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION odesseus_private.notification_action_url(text, text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION odesseus_private.notification_wallet_low_threshold_cents() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION odesseus_private.notification_interview_reminder_minutes() TO postgres, service_role;

COMMIT;