-- Admin capabilities and the admin audit log (Phase 9A). Additive migration;
-- local stack.
--
-- Until now, "is this person an admin?" was one boolean over three roles:
-- admin, marketing_admin, finance_admin. `isAdmin()` returned the role string
-- and every admin route accepted any of the three. A marketing admin could
-- therefore read a candidate's wallet balance and a finance admin could
-- dismiss a job report -- neither of which is a sensible reading of either
-- job title, and neither of which anyone chose on purpose.
--
-- This migration adds the two things that make the split enforceable and
-- reviewable:
--
--   1. public.admin_audit_log -- an append-only record of admin state changes.
--      It is not a general activity log: reads are not recorded, because a log
--      nobody reads is not an audit trail. Every row answers one question --
--      "who changed this, when, and why" -- for a change that a candidate, an
--      employer, or a later reviewer might dispute.
--
--   2. public.odesseus_update_job_report_status() is redefined to take the
--      acting admin and to write its audit row inside the same transaction as
--      the status change. Writing the audit from the route instead would leave
--      a window where the report has moved and the log does not say so, which
--      is the exact failure an audit log exists to prevent. A money movement
--      cannot tolerate that window at all, so the wallet-adjustment RPC added
--      later in this phase follows the same shape.
--
-- The role -> capability mapping deliberately does NOT live here. It is a
-- policy decision about what each job title may do, it is expressed in
-- TypeScript (src/lib/admin/capabilities.ts) where it is directly testable,
-- and the database's job is narrower and harder to bypass: browser roles can
-- reach none of this. A capability list in SQL would be a second copy of the
-- same policy with no way to keep the two in step.
--
-- Invariants preserved: RLS is enabled, never bypassed; admin_users and the
-- partner_* tables keep their server-only grant surface; no candidate wallet,
-- Apply settlement, employer billing, or Live pricing is touched.

-- ---------------------------------------------------------------------------
-- 1. public.admin_audit_log
-- ---------------------------------------------------------------------------
-- No foreign key on actor_user_id. An audit row is a record of a past event,
-- not a live reference: an FK would either delete the evidence when an admin
-- account is removed or silently blank the actor, and "we deleted the account"
-- is not an acceptable answer to "who changed this candidate's balance".
-- actor_email is a snapshot for the same reason -- it stays readable after the
-- person leaves.

CREATE TABLE public.admin_audit_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  uuid        NOT NULL,
  actor_email    text,
  actor_role     text        NOT NULL,
  action         text        NOT NULL,
  subject_type   text        NOT NULL,
  subject_id     text,
  details        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT admin_audit_log_action_check
    CHECK (action ~ '^[a-z][a-z0-9_]{0,39}(\.[a-z][a-z0-9_]{0,39})?$'),
  CONSTRAINT admin_audit_log_subject_type_check
    CHECK (subject_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  CONSTRAINT admin_audit_log_actor_role_check
    CHECK (actor_role IN ('admin', 'marketing_admin', 'finance_admin'))
);

COMMENT ON TABLE public.admin_audit_log IS
  'Append-only record of admin state changes. Rows are written inside the same '
  'transaction as the change they describe, so the log cannot drift from '
  'reality. Reads are service-role only; no role may update or delete a row.';

-- The subject is what a reviewer searches by ("everything that happened to this
-- candidate"), and created_at is what a reviewer sorts by.
CREATE INDEX admin_audit_log_subject_idx
  ON public.admin_audit_log (subject_type, subject_id);
CREATE INDEX admin_audit_log_created_at_idx
  ON public.admin_audit_log (created_at DESC);

-- Append-only is enforced by grants rather than by a trigger. There is no
-- UPDATE or DELETE privilege for any role, so an update is not merely
-- discouraged, it is impossible. The insert path is a SECURITY DEFINER RPC,
-- which writes as the table owner and therefore does not need INSERT here.
--
-- The explicit REVOKE of the write privileges matters: Supabase applies a
-- default privilege granting ALL on new public tables to service_role, so a
-- bare REVOKE ... FROM PUBLIC leaves service_role holding INSERT, UPDATE and
-- DELETE. `REVOKE ALL FROM PUBLIC` is not sufficient, and an append-only claim
-- that depends on a default we did not set is a claim that silently stops being
-- true. The rls-audit pgTAP file asserts the resulting grant surface so a later
-- migration that re-grants a write is caught rather than assumed impossible.
REVOKE ALL PRIVILEGES ON TABLE public.admin_audit_log FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.admin_audit_log FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.admin_audit_log FROM service_role;
GRANT SELECT ON TABLE public.admin_audit_log TO postgres, service_role;

-- RLS with a deny-everything policy. Same shape as admin_users: the grant
-- revocation above is the real control and this is the independent second
-- layer, so a future migration that re-grants a privilege still cannot expose
-- the table to a browser role.
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_audit_log_deny_browser_access" ON public.admin_audit_log
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- 2. odesseus_record_admin_action
-- ---------------------------------------------------------------------------
-- The single write path into the audit log, for admin changes that are not
-- already inside a domain RPC. State changes that DO have a domain RPC write
-- their audit row inside that RPC rather than calling this, because two calls
-- are two transactions.
--
-- Browser roles can never invoke it: it is the write side of the audit trail,
-- and an admin who could forge their own trail defeats the purpose.
CREATE OR REPLACE FUNCTION public.odesseus_record_admin_action (
  p_actor_user_id uuid,
  p_actor_role    text,
  p_action        text,
  p_subject_type  text,
  p_actor_email   text  DEFAULT NULL,
  p_subject_id    text  DEFAULT NULL,
  p_details       jsonb  DEFAULT '{}'::jsonb
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_id uuid;
begin
  if p_actor_role not in ('admin', 'marketing_admin', 'finance_admin') then
    raise exception 'unknown admin role: %', p_actor_role;
  end if;

  insert into public.admin_audit_log (
    actor_user_id, actor_email, actor_role, action, subject_type, subject_id, details
  )
  values (
    p_actor_user_id, nullif(trim(coalesce(p_actor_email, '')), ''), p_actor_role,
    trim(p_action), trim(p_subject_type),
    nullif(trim(coalesce(p_subject_id, '')), ''),
    coalesce(p_details, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_record_admin_action(uuid, text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_record_admin_action(uuid, text, text, text, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_record_admin_action(uuid, text, text, text, text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_record_admin_action(uuid, text, text, text, text, text, jsonb) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 3. odesseus_update_job_report_status gains an actor and an audit row
-- ---------------------------------------------------------------------------
-- Dropped and recreated rather than altered in place so the old four-argument
-- form stops existing: a leftover overload would let a caller reach the
-- un-audited behaviour, which is the whole point of this migration.
DROP FUNCTION IF EXISTS public.odesseus_update_job_report_status(uuid, text, text);

CREATE OR REPLACE FUNCTION public.odesseus_update_job_report_status (
  p_report_id      uuid,
  p_status         text,
  p_note           text,
  p_actor_user_id  uuid,
  p_actor_role     text     DEFAULT 'admin',
  p_actor_email    text     DEFAULT NULL
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_previous text;
begin
  if p_status not in ('reviewing', 'resolved', 'dismissed') then
    raise exception 'unknown job report moderation status: %', p_status;
  end if;

  -- The audit row records the transition, so the previous status has to be read
  -- before the update overwrites it. The row is also locked here, which is what
  -- makes "before" and "after" a true pair: two admins transitioning the same
  -- report at once cannot both record themselves as moving it out of `new`.
  select status
  into v_previous
  from public.job_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'job report not found';
  end if;

  -- Written first so a mid-transaction failure rolls the audit row back with
  -- the change. The reverse order would leave a log claiming a transition that
  -- then failed.
  --
  -- Named notation, not positional. Two adjacent text parameters is exactly
  -- where a positional call goes wrong silently: an earlier draft passed
  -- `p_report_id` into `p_actor_email` and vice versa, and the transaction
  -- succeeded with the actor's address recorded as the report and the report id
  -- recorded as the actor.
  perform public.odesseus_record_admin_action(
    p_actor_user_id => p_actor_user_id,
    p_actor_role    => p_actor_role,
    p_action        => 'job_report.status_changed',
    p_subject_type  => 'job_report',
    p_subject_id    => p_report_id::text,
    p_actor_email   => p_actor_email,
    p_details       => jsonb_build_object(
      'from', v_previous, 'to', p_status, 'note', p_note
    )
  );

  update public.job_reports
     set status          = p_status,
         moderation_note = coalesce(p_note, moderation_note),
         updated_at      = now()
   where id = p_report_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_update_job_report_status(uuid, text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_update_job_report_status(uuid, text, text, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_update_job_report_status(uuid, text, text, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_update_job_report_status(uuid, text, text, uuid, text, text) TO postgres, service_role;
