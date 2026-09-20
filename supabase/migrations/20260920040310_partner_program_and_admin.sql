SET local check_function_bodies = off;

CREATE TABLE "public"."admin_users" (
  "user_id"    uuid                     NOT NULL,
  "role"       text                     NOT NULL DEFAULT 'admin'::text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "admin_users_pkey" PRIMARY KEY (user_id),
  CONSTRAINT "admin_users_role_check" CHECK ((role = ANY (ARRAY['admin'::text, 'marketing_admin'::text, 'finance_admin'::text])))
);

ALTER TABLE "public"."admin_users"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."partner_applications" (
  "id"                        uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "full_name"                 text                     NOT NULL,
  "email"                     text                     NOT NULL,
  "country"                   text                     NOT NULL,
  "city_state"                text,
  "primary_niche"             text                     NOT NULL,
  "audience_description"      text                     NOT NULL,
  "motivation"                text                     NOT NULL,
  "sample_links"              text[]                   NOT NULL DEFAULT '{}'::text[],
  "previous_brand_experience" text,
  "expected_rate"             text,
  "preferred_partnerships"    text[]                   NOT NULL DEFAULT '{}'::text[],
  "status"                    text                     NOT NULL DEFAULT 'submitted'::text,
  "internal_notes"            text,
  "proposed_commission_bps"   integer,
  "approved_partnership_type" text,
  "reviewed_by"               uuid,
  "reviewed_at"               timestamp with time zone,
  "terms_accepted_at"         timestamp with time zone NOT NULL,
  "created_at"                timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"                timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "partner_applications_pkey" PRIMARY KEY (id),
  CONSTRAINT "partner_applications_proposed_commission_bps_check"
    CHECK (((proposed_commission_bps IS NULL) OR ((proposed_commission_bps >= 0) AND (proposed_commission_bps <= 10000)))),
  CONSTRAINT "partner_applications_status_check" CHECK ((status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'approved'::text, 'waitlisted'::text, 'rejected'::text])))
);

ALTER TABLE "public"."partner_applications"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."partner_campaign_members" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "campaign_id"  uuid                     NOT NULL,
  "partner_id"   uuid                     NOT NULL,
  "status"       text                     NOT NULL DEFAULT 'assigned'::text,
  "assigned_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone,
  CONSTRAINT "partner_campaign_members_campaign_id_partner_id_key" UNIQUE (campaign_id, partner_id),
  CONSTRAINT "partner_campaign_members_pkey" PRIMARY KEY (id),
  CONSTRAINT "partner_campaign_members_status_check" CHECK ((status = ANY (ARRAY['assigned'::text, 'accepted'::text, 'declined'::text, 'submitted'::text, 'completed'::text])))
);

ALTER TABLE "public"."partner_campaign_members"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."partner_campaigns" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "title"        text                     NOT NULL,
  "description"  text                     NOT NULL,
  "brief"        text,
  "platforms"    text[]                   NOT NULL DEFAULT '{}'::text[],
  "requirements" text,
  "reward_terms" text,
  "status"       text                     NOT NULL DEFAULT 'draft'::text,
  "starts_at"    timestamp with time zone,
  "ends_at"      timestamp with time zone,
  "created_by"   uuid,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "partner_campaigns_pkey" PRIMARY KEY (id),
  CONSTRAINT "partner_campaigns_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text, 'ended'::text])))
);

ALTER TABLE "public"."partner_campaigns"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."partner_content" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "partner_id"  uuid                     NOT NULL,
  "campaign_id" uuid,
  "platform"    text                     NOT NULL,
  "content_url" text                     NOT NULL,
  "posted_at"   timestamp with time zone,
  "notes"       text,
  "status"      text                     NOT NULL DEFAULT 'submitted'::text,
  "admin_notes" text,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "partner_content_pkey" PRIMARY KEY (id),
  CONSTRAINT "partner_content_platform_check" CHECK ((platform = ANY (ARRAY['instagram'::text, 'facebook'::text, 'tiktok'::text]))),
  CONSTRAINT "partner_content_status_check" CHECK ((status = ANY (ARRAY['submitted'::text, 'approved'::text, 'changes_requested'::text, 'rejected'::text])))
);

ALTER TABLE "public"."partner_content"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."partner_conversions" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "partner_id"       uuid                     NOT NULL,
  "referral_id"      uuid,
  "user_id"          uuid                     NOT NULL,
  "billing_event_id" uuid                     NOT NULL,
  "amount_cents"     integer                  NOT NULL,
  "currency"         text                     NOT NULL DEFAULT 'usd'::text,
  "commission_cents" integer                  NOT NULL DEFAULT 0,
  "status"           text                     NOT NULL DEFAULT 'qualified'::text,
  "qualified_at"     timestamp with time zone,
  "reversed_at"      timestamp with time zone,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "partner_conversions_amount_cents_check" CHECK ((amount_cents >= 0)),
  CONSTRAINT "partner_conversions_billing_event_id_key" UNIQUE (billing_event_id),
  CONSTRAINT "partner_conversions_commission_cents_check" CHECK ((commission_cents >= 0)),
  CONSTRAINT "partner_conversions_pkey" PRIMARY KEY (id),
  CONSTRAINT "partner_conversions_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'qualified'::text, 'reversed'::text])))
);

ALTER TABLE "public"."partner_conversions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."partner_earnings" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "partner_id"    uuid                     NOT NULL,
  "conversion_id" uuid,
  "campaign_id"   uuid,
  "amount_cents"  integer                  NOT NULL,
  "currency"      text                     NOT NULL DEFAULT 'usd'::text,
  "status"        text                     NOT NULL DEFAULT 'pending'::text,
  "reason"        text,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "partner_earnings_amount_cents_check" CHECK ((amount_cents >= 0)),
  CONSTRAINT "partner_earnings_pkey" PRIMARY KEY (id),
  CONSTRAINT "partner_earnings_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'reversed'::text, 'paid'::text])))
);

ALTER TABLE "public"."partner_earnings"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."partner_payouts" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "partner_id"   uuid                     NOT NULL,
  "amount_cents" integer                  NOT NULL,
  "currency"     text                     NOT NULL DEFAULT 'usd'::text,
  "method"       text,
  "reference"    text,
  "notes"        text,
  "paid_at"      timestamp with time zone NOT NULL,
  "recorded_by"  uuid,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "partner_payouts_amount_cents_check" CHECK ((amount_cents > 0)),
  CONSTRAINT "partner_payouts_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."partner_payouts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."partner_referrals" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "partner_id"     uuid                     NOT NULL,
  "referral_code"  text                     NOT NULL,
  "visitor_id"     uuid                     NOT NULL,
  "landing_path"   text,
  "signup_user_id" uuid,
  "signup_at"      timestamp with time zone,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "partner_referrals_pkey" PRIMARY KEY (id),
  CONSTRAINT "partner_referrals_visitor_id_key" UNIQUE (visitor_id)
);

ALTER TABLE "public"."partner_referrals"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."partner_social_accounts" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "application_id"   uuid,
  "partner_id"       uuid,
  "platform"         text                     NOT NULL,
  "handle"           text                     NOT NULL,
  "profile_url"      text                     NOT NULL,
  "follower_count"   integer                  NOT NULL DEFAULT 0,
  "average_reach"    integer,
  "audience_country" text,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "partner_social_accounts_average_reach_check" CHECK (((average_reach IS NULL) OR (average_reach >= 0))),
  CONSTRAINT "partner_social_accounts_follower_count_check" CHECK ((follower_count >= 0)),
  CONSTRAINT "partner_social_accounts_pkey" PRIMARY KEY (id),
  CONSTRAINT "partner_social_accounts_platform_check" CHECK ((platform = ANY (ARRAY['instagram'::text, 'facebook'::text, 'tiktok'::text]))),
  CONSTRAINT "partner_social_parent_check" CHECK (((application_id IS NOT NULL) OR (partner_id IS NOT NULL)))
);

ALTER TABLE "public"."partner_social_accounts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."partners" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "application_id"   uuid,
  "user_id"          uuid,
  "email"            text                     NOT NULL,
  "full_name"        text                     NOT NULL,
  "status"           text                     NOT NULL DEFAULT 'approved'::text,
  "partnership_type" text                     NOT NULL DEFAULT 'affiliate'::text,
  "referral_code"    text                     NOT NULL,
  "commission_bps"   integer,
  "attribution_days" integer                  NOT NULL DEFAULT 30,
  "start_date"       date                     NOT NULL DEFAULT CURRENT_DATE,
  "end_date"         date,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "partners_application_id_key" UNIQUE (application_id),
  CONSTRAINT "partners_attribution_days_check" CHECK (((attribution_days >= 1) AND (attribution_days <= 90))),
  CONSTRAINT "partners_commission_bps_check" CHECK (((commission_bps IS NULL) OR ((commission_bps >= 0) AND (commission_bps <= 10000)))),
  CONSTRAINT "partners_pkey" PRIMARY KEY (id),
  CONSTRAINT "partners_referral_code_key" UNIQUE (referral_code),
  CONSTRAINT "partners_status_check" CHECK ((status = ANY (ARRAY['approved'::text, 'suspended'::text, 'terminated'::text])))
);

ALTER TABLE "public"."partners"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION odysseus_private.apply_credit_transaction()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'odysseus_private', 'pg_temp'
  AS $function$
declare
  current_app integer;
  current_interview integer;
begin
  insert into public.credit_balances (user_id, application_credits, interview_passes, updated_at)
  values (new.user_id, 0, 0, now())
  on conflict (user_id) do nothing;

  select application_credits, interview_passes
  into current_app, current_interview
  from public.credit_balances
  where user_id = new.user_id
  for update;

  if new.credit_type = 'application' then
    if current_app + new.delta < 0 then
      raise exception 'insufficient application credits';
    end if;

    update public.credit_balances
    set application_credits = application_credits + new.delta,
        updated_at = now()
    where user_id = new.user_id;
  else
    if current_interview + new.delta < 0 then
      raise exception 'insufficient interview passes';
    end if;

    update public.credit_balances
    set interview_passes = interview_passes + new.delta,
        updated_at = now()
    where user_id = new.user_id;
  end if;

  insert into odysseus_private.credit_ledger
    (user_id, credit_type, delta, reason, external_reference)
  values
    (new.user_id, new.credit_type, new.delta, new.reason, new.external_reference);

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION odysseus_private.freeze_application_context()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'odysseus_private', 'pg_temp'
  AS $function$
declare
  job_row public.job_opportunities%rowtype;
  resume_row public.resumes%rowtype;
begin
  if new.job_id is not null then
    select * into job_row
    from public.job_opportunities
    where id = new.job_id;

    if found then
      if new.match_score_snapshot is null then
        new.match_score_snapshot := job_row.match_score;
      end if;

      if new.job_snapshot = '{}'::jsonb then
        new.job_snapshot := jsonb_build_object(
          'company_name', job_row.company_name,
          'role_title', job_row.role_title,
          'location', job_row.location,
          'work_arrangement', job_row.work_arrangement,
          'employment_type', job_row.employment_type,
          'salary_text', job_row.salary_text,
          'description', job_row.description,
          'match_score', job_row.match_score,
          'match_breakdown', job_row.match_breakdown,
          'source', job_row.source,
          'source_url', job_row.source_url
        );
      end if;
    end if;
  end if;

  if new.tailored_resume_id is not null and new.resume_snapshot = '{}'::jsonb then
    select * into resume_row
    from public.resumes
    where id = new.tailored_resume_id;

    if found then
      new.resume_snapshot := jsonb_build_object(
        'resume_id', resume_row.id,
        'file_name', resume_row.file_name,
        'storage_path', resume_row.storage_path,
        'mime_type', resume_row.mime_type,
        'parsed_data', resume_row.parsed_data,
        'approved', resume_row.is_approved
      );
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION odysseus_private.log_application_status_event()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'odysseus_private', 'pg_temp'
  AS $function$
begin
  if tg_op = 'INSERT' then
    insert into public.application_status_events (
      application_id, user_id, event_type, to_status, title, detail, source, metadata
    ) values (
      new.id,
      new.user_id,
      'created',
      new.status,
      'Application added',
      case
        when new.submitted_at is not null then 'Odysseus is now tracking this application.'
        else 'Application tracking started.'
      end,
      'system',
      jsonb_build_object(
        'company_name', new.company_name,
        'role_title', new.role_title
      )
    );

    if new.tailored_resume_id is not null then
      insert into public.application_status_events (
        application_id, user_id, event_type, to_status, title, detail, source, metadata
      ) values (
        new.id,
        new.user_id,
        'resume_frozen',
        new.status,
        'Resume version frozen',
        'The exact approved resume used for this application is attached to the record.',
        'system',
        jsonb_build_object('resume_id', new.tailored_resume_id)
      );
    end if;

    if new.submitted_at is not null then
      insert into public.application_status_events (
        application_id, user_id, event_type, to_status, title, detail, source, metadata
      ) values (
        new.id,
        new.user_id,
        'submission_confirmed',
        new.status,
        'Application submitted',
        coalesce(new.submission_confirmation, 'Employer submission confirmed.'),
        'system',
        jsonb_build_object('submitted_at', new.submitted_at)
      );
    end if;
  elsif old.status is distinct from new.status then
    insert into public.application_status_events (
      application_id, user_id, event_type, from_status, to_status, title, detail, source
    ) values (
      new.id,
      new.user_id,
      'status_change',
      old.status,
      new.status,
      'Status changed',
      'Application moved from ' || replace(old.status, '_', ' ') ||
        ' to ' || replace(new.status, '_', ' ') || '.',
      'system'
    );
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.odysseus_end_live_session (
  p_session_id uuid,
  p_user_id    uuid
)
  RETURNS public.live_interview_sessions
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_session public.live_interview_sessions%rowtype;
  v_now timestamptz := now();
begin
  update public.live_interview_sessions
  set status = 'ended',
      ended_at = coalesce(ended_at, v_now),
      updated_at = v_now
  where id = p_session_id
    and user_id = p_user_id
    and status in ('active','prepared','failed')
  returning * into v_session;

  if not found then
    select *
    into v_session
    from public.live_interview_sessions
    where id = p_session_id
      and user_id = p_user_id;

    if not found then
      raise exception 'live session not found';
    end if;
  end if;

  update public.interviews
  set status = 'completed',
      ended_at = coalesce(ended_at, v_now),
      updated_at = v_now
  where id = v_session.interview_id
    and user_id = p_user_id
    and status in ('live','ready','scheduled','invited');

  return v_session;
end;
$function$;

CREATE OR REPLACE FUNCTION public.odysseus_finalize_successful_application (
  p_run_id            uuid,
  p_user_id           uuid,
  p_confirmation_text text,
  p_page_url          text DEFAULT NULL::text
)
  RETURNS TABLE (
    application_id    uuid,
    run_id            uuid,
    already_finalized boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odysseus_private', 'pg_temp'
  AS $function$
declare
  v_run public.application_runs%rowtype;
  v_job public.job_opportunities%rowtype;
  v_application_id uuid;
  v_now timestamptz := now();
begin
  select *
  into v_run
  from public.application_runs
  where id = p_run_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'application run not found';
  end if;

  -- Idempotent replay: this run was already fully finalized (by an
  -- earlier attempt, or a retry that landed after a crash but whose
  -- response never reached the caller). Do not re-charge or re-mutate
  -- anything — just report what already happened.
  if v_run.status = 'submitted' then
    select id
    into v_application_id
    from public.applications
    where user_id = p_user_id
      and job_id = v_run.job_id
    limit 1;

    return query select v_application_id, v_run.id, true;
    return;
  end if;

  -- A run that has already been marked failed or cancelled must never be
  -- finalized into a charged, "submitted" application after the fact.
  if v_run.status in ('failed', 'cancelled') then
    raise exception 'application run cannot be finalized from status %', v_run.status;
  end if;

  if p_confirmation_text is null or length(trim(p_confirmation_text)) = 0 then
    raise exception 'a confirmed submission message is required to finalize';
  end if;

  select *
  into v_job
  from public.job_opportunities
  where id = v_run.job_id;

  select id
  into v_application_id
  from public.applications
  where user_id = p_user_id
    and job_id = v_run.job_id
  limit 1;

  if v_application_id is not null then
    update public.applications
    set tailored_resume_id = v_run.approved_resume_id,
        application_url = v_run.target_url,
        status = 'applied',
        submission_confirmation = p_confirmation_text,
        submitted_at = v_now,
        last_event_at = v_now,
        updated_at = v_now
    where id = v_application_id;
  else
    insert into public.applications (
      user_id, job_id, tailored_resume_id, company_name, role_title,
      application_url, status, submission_confirmation, submitted_at, last_event_at
    )
    values (
      p_user_id,
      v_run.job_id,
      v_run.approved_resume_id,
      coalesce(v_job.company_name, 'Company'),
      coalesce(v_job.role_title, 'Role'),
      v_run.target_url,
      'applied',
      p_confirmation_text,
      v_now,
      v_now
    )
    returning id into v_application_id;
  end if;

  -- Exactly one application-credit debit per run, enforced by the unique
  -- constraint on credit_transactions.external_reference: a retried call
  -- for the same run_id collides here and is silently skipped rather than
  -- charging twice. If the balance is insufficient, apply_credit_transaction()
  -- raises and this entire transaction rolls back — including the
  -- application upsert above — so no half-updated state is left behind.
  insert into public.credit_transactions (
    user_id, credit_type, delta, reason, external_reference, metadata
  )
  values (
    p_user_id,
    'application',
    -1,
    'successful_application',
    'application:' || p_run_id::text,
    jsonb_build_object('application_run_id', p_run_id, 'job_id', v_run.job_id)
  )
  on conflict (external_reference) do nothing;

  update public.job_opportunities
  set status = 'applied',
      updated_at = v_now
  where id = v_run.job_id;

  update public.application_runs
  set status = 'submitted',
      stop_reason = null,
      submission_confirmation = p_confirmation_text,
      submission_evidence = jsonb_build_object(
        'after_url', p_page_url,
        'confirmation_detected', true,
        'confirmation_text', p_confirmation_text
      ),
      current_url = coalesce(p_page_url, v_run.current_url),
      submitted_at = v_now,
      finished_at = v_now,
      resume_token = null,
      updated_at = v_now
  where id = p_run_id;

  return query select v_application_id, p_run_id, false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.odysseus_get_integration_secret (
  p_secret_id uuid
)
  RETURNS text
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'vault', 'public', 'pg_temp'
  AS $function$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = p_secret_id;
$function$;

CREATE OR REPLACE FUNCTION public.odysseus_store_integration_secret (
  p_user_id uuid,
  p_secret  text,
  p_name    text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'vault', 'pg_temp'
  AS $function$
declare
  v_id uuid;
begin
  if p_secret is null or length(p_secret) < 1 then
    raise exception 'secret required';
  end if;

  v_id := vault.create_secret(
    p_secret,
    'odysseus:' || p_user_id::text || ':' || p_name,
    'Odysseus per-user integration credential'
  );

  return v_id;
end;
$function$;

ALTER TABLE "public"."admin_users"
  ADD CONSTRAINT "admin_users_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."partner_applications"
  ADD CONSTRAINT "partner_applications_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."partner_campaigns"
  ADD CONSTRAINT "partner_campaigns_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."partner_campaign_members"
  ADD CONSTRAINT "partner_campaign_members_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.partner_campaigns(id) ON DELETE CASCADE;

ALTER TABLE "public"."partner_content"
  ADD CONSTRAINT "partner_content_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.partner_campaigns(id) ON DELETE SET NULL;

ALTER TABLE "public"."partner_content"
  ADD CONSTRAINT "partner_content_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."partner_conversions"
  ADD CONSTRAINT "partner_conversions_billing_event_id_fkey" FOREIGN KEY (billing_event_id) REFERENCES public.billing_events(id) ON DELETE RESTRICT;

ALTER TABLE "public"."partner_conversions"
  ADD CONSTRAINT "partner_conversions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."partner_earnings"
  ADD CONSTRAINT "partner_earnings_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.partner_campaigns(id) ON DELETE SET NULL;

ALTER TABLE "public"."partner_earnings"
  ADD CONSTRAINT "partner_earnings_conversion_id_fkey" FOREIGN KEY (conversion_id) REFERENCES public.partner_conversions(id) ON DELETE SET NULL;

ALTER TABLE "public"."partner_payouts"
  ADD CONSTRAINT "partner_payouts_recorded_by_fkey" FOREIGN KEY (recorded_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."partner_conversions"
  ADD CONSTRAINT "partner_conversions_referral_id_fkey" FOREIGN KEY (referral_id) REFERENCES public.partner_referrals(id) ON DELETE SET NULL;

ALTER TABLE "public"."partner_referrals"
  ADD CONSTRAINT "partner_referrals_signup_user_id_fkey" FOREIGN KEY (signup_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."partner_social_accounts"
  ADD CONSTRAINT "partner_social_accounts_application_id_fkey" FOREIGN KEY (application_id) REFERENCES public.partner_applications(id) ON DELETE CASCADE;

ALTER TABLE "public"."partners"
  ADD CONSTRAINT "partners_application_id_fkey" FOREIGN KEY (application_id) REFERENCES public.partner_applications(id) ON DELETE SET NULL;

ALTER TABLE "public"."partner_campaign_members"
  ADD CONSTRAINT "partner_campaign_members_partner_id_fkey" FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;

ALTER TABLE "public"."partner_content"
  ADD CONSTRAINT "partner_content_partner_id_fkey" FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;

ALTER TABLE "public"."partner_conversions"
  ADD CONSTRAINT "partner_conversions_partner_id_fkey" FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;

ALTER TABLE "public"."partner_earnings"
  ADD CONSTRAINT "partner_earnings_partner_id_fkey" FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;

ALTER TABLE "public"."partner_payouts"
  ADD CONSTRAINT "partner_payouts_partner_id_fkey" FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;

ALTER TABLE "public"."partner_referrals"
  ADD CONSTRAINT "partner_referrals_partner_id_fkey" FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;

ALTER TABLE "public"."partner_social_accounts"
  ADD CONSTRAINT "partner_social_accounts_partner_id_fkey" FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;

ALTER TABLE "public"."partners"
  ADD CONSTRAINT "partners_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX partner_applications_email_idx ON public.partner_applications USING btree (lower(email));

CREATE INDEX partner_applications_reviewed_by_idx ON public.partner_applications USING btree (reviewed_by);

CREATE INDEX partner_applications_status_created_idx ON public.partner_applications USING btree (status, created_at DESC);

CREATE INDEX partner_campaign_members_partner_idx ON public.partner_campaign_members USING btree (partner_id, assigned_at DESC);

CREATE INDEX partner_campaigns_created_by_idx ON public.partner_campaigns USING btree (created_by);

CREATE INDEX partner_campaigns_status_idx ON public.partner_campaigns USING btree (status, starts_at);

CREATE INDEX partner_content_campaign_idx ON public.partner_content USING btree (campaign_id);

CREATE INDEX partner_content_partner_created_idx ON public.partner_content USING btree (partner_id, created_at DESC);

CREATE INDEX partner_content_reviewed_by_idx ON public.partner_content USING btree (reviewed_by);

CREATE INDEX partner_content_status_idx ON public.partner_content USING btree (status, created_at DESC);

CREATE INDEX partner_conversions_partner_created_idx ON public.partner_conversions USING btree (partner_id, created_at DESC);

CREATE INDEX partner_conversions_referral_idx ON public.partner_conversions USING btree (referral_id);

CREATE INDEX partner_conversions_user_idx ON public.partner_conversions USING btree (user_id);

CREATE INDEX partner_earnings_campaign_idx ON public.partner_earnings USING btree (campaign_id);

CREATE UNIQUE INDEX partner_earnings_conversion_unique ON public.partner_earnings USING btree (conversion_id)
  WHERE (conversion_id IS NOT NULL);

CREATE INDEX partner_earnings_partner_status_idx ON public.partner_earnings USING btree (partner_id, status, created_at DESC);

CREATE INDEX partner_payouts_partner_paid_idx ON public.partner_payouts USING btree (partner_id, paid_at DESC);

CREATE INDEX partner_payouts_recorded_by_idx ON public.partner_payouts USING btree (recorded_by);

CREATE INDEX partner_referrals_partner_created_idx ON public.partner_referrals USING btree (partner_id, created_at DESC);

CREATE INDEX partner_referrals_signup_user_idx ON public.partner_referrals USING btree (signup_user_id);

CREATE INDEX partner_social_application_idx ON public.partner_social_accounts USING btree (application_id);

CREATE INDEX partner_social_partner_idx ON public.partner_social_accounts USING btree (partner_id);

CREATE UNIQUE INDEX partner_social_partner_platform_unique ON public.partner_social_accounts USING btree (partner_id, platform)
  WHERE (partner_id IS NOT NULL);

CREATE UNIQUE INDEX partners_email_unique_lower ON public.partners USING btree (lower(email));

CREATE INDEX partners_status_idx ON public.partners USING btree (status);

CREATE INDEX partners_user_idx ON public.partners USING btree (user_id);

CREATE POLICY "admin_users_deny_browser_access" ON "public"."admin_users"
  FOR ALL
  TO "anon", "authenticated"
  USING (false)
  WITH CHECK (false);

CREATE POLICY "partner_applications_deny_browser_access" ON "public"."partner_applications"
  FOR ALL
  TO "anon", "authenticated"
  USING (false)
  WITH CHECK (false);

CREATE POLICY "partner_campaign_members_deny_browser_access" ON "public"."partner_campaign_members"
  FOR ALL
  TO "anon", "authenticated"
  USING (false)
  WITH CHECK (false);

CREATE POLICY "partner_campaigns_deny_browser_access" ON "public"."partner_campaigns"
  FOR ALL
  TO "anon", "authenticated"
  USING (false)
  WITH CHECK (false);

CREATE POLICY "partner_content_deny_browser_access" ON "public"."partner_content"
  FOR ALL
  TO "anon", "authenticated"
  USING (false)
  WITH CHECK (false);

CREATE POLICY "partner_conversions_deny_browser_access" ON "public"."partner_conversions"
  FOR ALL
  TO "anon", "authenticated"
  USING (false)
  WITH CHECK (false);

CREATE POLICY "partner_earnings_deny_browser_access" ON "public"."partner_earnings"
  FOR ALL
  TO "anon", "authenticated"
  USING (false)
  WITH CHECK (false);

CREATE POLICY "partner_payouts_deny_browser_access" ON "public"."partner_payouts"
  FOR ALL
  TO "anon", "authenticated"
  USING (false)
  WITH CHECK (false);

CREATE POLICY "partner_referrals_deny_browser_access" ON "public"."partner_referrals"
  FOR ALL
  TO "anon", "authenticated"
  USING (false)
  WITH CHECK (false);

CREATE POLICY "partner_social_accounts_deny_browser_access" ON "public"."partner_social_accounts"
  FOR ALL
  TO "anon", "authenticated"
  USING (false)
  WITH CHECK (false);

CREATE POLICY "partners_deny_browser_access" ON "public"."partners"
  FOR ALL
  TO "anon", "authenticated"
  USING (false)
  WITH CHECK (false);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_users" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."partner_applications" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."partner_campaign_members" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."partner_campaigns" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."partner_content" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."partner_conversions" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."partner_earnings" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."partner_payouts" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."partner_referrals" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."partner_social_accounts" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."partners" TO "postgres", "service_role";

