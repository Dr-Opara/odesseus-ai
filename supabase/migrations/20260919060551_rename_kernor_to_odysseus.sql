-- Renames active Kernor-branded database identifiers to Odysseus as part of
-- the full product rename. This is a forward migration only: the baseline
-- and apply-finalization migrations that originally created these objects
-- are left untouched for migration-history integrity. After this migration,
-- every active schema/function name and every user-facing or internal
-- string embedded in these functions uses the Odysseus naming.
--
-- ALTER SCHEMA / ALTER FUNCTION ... RENAME TO preserve the underlying object
-- OID, ownership, and existing GRANT/REVOKE privileges, so those do not need
-- to be re-applied. What rename alone cannot fix is text baked into a
-- function's stored config or body: a SET search_path referencing the old
-- schema name literally, a schema-qualified reference inside a plpgsql body,
-- or a Kernor-branded string literal returned to the app or written to the
-- Vault. Those are corrected with a follow-up CREATE OR REPLACE FUNCTION on
-- the same (already renamed) object, which updates its definition in place
-- without changing its OID or grants.

-- 1. Schema rename. Moves both private tables (billing_customers,
--    credit_ledger), their RLS policies, and the four trigger functions
--    defined inside this schema automatically.
ALTER SCHEMA "kernor_private" RENAME TO "odysseus_private";

-- 2. Private trigger functions now living in odysseus_private.

-- apply_credit_transaction: search_path config and an explicit
-- schema-qualified body reference to kernor_private.credit_ledger both
-- need updating; a schema-qualified name inside a plpgsql body is stored as
-- literal text and is not rewritten by the schema rename above.
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

-- freeze_application_context and fulfill_billing_event only need their
-- search_path config repointed; neither body references kernor_private.
ALTER FUNCTION odysseus_private.freeze_application_context()
  SET search_path TO 'public', 'odysseus_private', 'pg_temp';

ALTER FUNCTION odysseus_private.fulfill_billing_event()
  SET search_path TO 'public', 'odysseus_private', 'pg_temp';

-- log_application_status_event: search_path config plus a Kernor-branded
-- string literal that is written into application_status_events.detail and
-- shown to the user in the application timeline.
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

-- 3. Public RPCs. Rename first (preserves OID/grants), then repoint
--    search_path or body content where it references the old schema name
--    or old brand string literally.

ALTER FUNCTION public.kernor_activate_live_session(uuid, uuid, text)
  RENAME TO odysseus_activate_live_session;

ALTER FUNCTION public.odysseus_activate_live_session(uuid, uuid, text)
  SET search_path TO 'public', 'odysseus_private', 'pg_temp';

-- kernor_end_live_session's search_path ('public','pg_temp') and body never
-- referenced kernor_private; rename alone is sufficient.
ALTER FUNCTION public.kernor_end_live_session(uuid, uuid)
  RENAME TO odysseus_end_live_session;

-- kernor_get_integration_secret's search_path ('vault','public','pg_temp')
-- and body never referenced kernor_private; rename alone is sufficient.
ALTER FUNCTION public.kernor_get_integration_secret(uuid)
  RENAME TO odysseus_get_integration_secret;

-- kernor_store_integration_secret: rename, then replace the body in place
-- to move the Vault secret label prefix and description off the old brand
-- so newly stored secrets use a clean Odysseus runtime namespace, per the
-- project's Vault-prefix rename guidance (no production data exists yet,
-- so no historical Vault labels need to be migrated).
ALTER FUNCTION public.kernor_store_integration_secret(uuid, text, text)
  RENAME TO odysseus_store_integration_secret;

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

-- kernor_finalize_successful_application: rename, then repoint search_path
-- (its body has no direct kernor_private text reference of its own; it
-- relies on the odysseus_private trigger functions above via search_path
-- resolution when public.credit_transactions is inserted into).
ALTER FUNCTION public.kernor_finalize_successful_application(uuid, uuid, text, text)
  RENAME TO odysseus_finalize_successful_application;

ALTER FUNCTION public.odysseus_finalize_successful_application(uuid, uuid, text, text)
  SET search_path TO 'public', 'odysseus_private', 'pg_temp';
