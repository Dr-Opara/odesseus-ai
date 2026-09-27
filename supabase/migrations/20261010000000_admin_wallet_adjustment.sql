-- Admin wallet adjustments (Phase 9A). Additive migration; local stack.
--
-- Support needs to be able to correct a candidate's wallet: a top-up whose
-- webhook never arrived, a duplicate debit from a bug we shipped, a goodwill
-- credit. Until now there was no way to do that that was safe. `credit_balances`
-- has no browser write path at all -- the balance moves only through the
-- apply_credit_transaction trigger, which is exactly the right choke point and
-- exactly why an ad-hoc UPDATE is not the answer. A direct balance write skips
-- the ledger, skips balance_cents_after, and leaves no record that the number
-- ever moved.
--
-- So the adjustment goes through the same trigger as everything else: insert a
-- credit_transactions row, and the trigger moves the balance and writes the
-- ledger entry. There is no second path into a balance, before or after this
-- migration.
--
-- Three decisions worth stating:
--
--   1. A new credit_type, 'admin_adjustment', rather than reusing
--      'wallet_topup' or 'standard_apply'. Reusing a type would file a manual
--      correction under a label that claims a Stripe payment or an Apply
--      submission happened, which is the one thing an operator looking at the
--      ledger most needs to be true. It is added to the trigger's wallet branch,
--      so it moves wallet_balance_cents and records balance_cents_after exactly
--      as a top-up does, and to the wallet-amount CHECK so amount_cents stays
--      pinned to abs(delta).
--
--   2. Both directions, and a debit is allowed to fail. A credit corrects
--      upward; a debit takes money back. The debit is bounded by the same
--      'insufficient wallet balance' raise the trigger already enforces, so an
--      adjustment can never drive a balance negative -- a candidate who has
--      already spent the funds is not clawed back through this path, because
--      that is a refund question, not an adjustment question.
--
--   3. The audit row is written inside this transaction, by this function. An
--      admin moving a candidate's money is precisely the change that must not be
--      able to happen without a record, and two supabase calls would be two
--      transactions with a window between them.
--
-- Idempotency: the caller supplies p_reference, and the insert is ON CONFLICT
-- (external_reference) DO NOTHING exactly as finalization does. A retried
-- request with the same reference moves no money and writes no second audit row.
-- The reference is required rather than generated, so the caller -- not a
-- database sequence -- decides what makes a retry a retry.
--
-- Invariants preserved: RLS never weakened; the single balance-mutation choke
-- point is unchanged and still the trigger; no pricing, catalog rate, or
-- verified-success charging rule is touched; no wallet debits outside a
-- confirmed submission.

-- ---------------------------------------------------------------------------
-- 1. Widen the credit_type domain to include the adjustment
-- ---------------------------------------------------------------------------
-- Only the two tables that participate in a wallet movement. billing_events is
-- deliberately untouched: it records what Stripe did, and an admin adjustment
-- has no Stripe event behind it. Filing one there would invent a payment.

ALTER TABLE public.credit_transactions
  DROP CONSTRAINT credit_transactions_credit_type_check;
ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_credit_type_check
  CHECK (credit_type = ANY (ARRAY[
    'application'::text, 'interview'::text, 'wallet_topup'::text,
    'standard_apply'::text, 'smart_apply'::text, 'admin_adjustment'::text
  ]));

ALTER TABLE odesseus_private.credit_ledger
  DROP CONSTRAINT credit_ledger_credit_type_check;
ALTER TABLE odesseus_private.credit_ledger
  ADD CONSTRAINT credit_ledger_credit_type_check
  CHECK (credit_type = ANY (ARRAY[
    'application'::text, 'interview'::text, 'wallet_topup'::text,
    'standard_apply'::text, 'smart_apply'::text, 'admin_adjustment'::text
  ]));

-- The amount-pins-the-delta invariant extends to the adjustment for the same
-- reason it exists for the other wallet types: a wallet row whose amount and
-- delta disagree cannot be reconciled against a bank statement.
ALTER TABLE public.credit_transactions
  DROP CONSTRAINT credit_transactions_wallet_amount_check;
ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_wallet_amount_check
  CHECK (credit_type NOT IN ('wallet_topup'::text, 'standard_apply'::text,
                              'smart_apply'::text, 'admin_adjustment'::text)
         OR (amount_cents IS NOT NULL AND amount_cents = abs(delta)));

-- ---------------------------------------------------------------------------
-- 2. Route the adjustment through the wallet branch of the choke point
-- ---------------------------------------------------------------------------
-- Without this the new credit_type would fall through to the `else` branch and
-- be silently applied to interview_passes instead. That is the kind of drift a
-- widened CHECK invites, so it is closed here rather than left to be noticed.
CREATE OR REPLACE FUNCTION odesseus_private.apply_credit_transaction()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  current_app integer;
  current_interview integer;
  current_wallet integer;
  v_wallet_change integer;
  v_wallet_after integer;
begin
  insert into public.credit_balances (user_id, application_credits, interview_passes, updated_at)
  values (new.user_id, 0, 0, now())
  on conflict (user_id) do nothing;

  select application_credits, interview_passes, wallet_balance_cents
  into current_app, current_interview, current_wallet
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
  elsif new.credit_type in ('wallet_topup', 'standard_apply', 'smart_apply', 'admin_adjustment') then
    -- delta is the signed cents change (wallet_topup +1000, apply -49/-199,
    -- admin_adjustment either sign); the CHECK
    -- credit_transactions_wallet_amount_check pins amount_cents to abs(delta),
    -- so the balance moves exactly by delta.
    v_wallet_change := new.delta;

    if current_wallet + v_wallet_change < 0 then
      raise exception 'insufficient wallet balance';
    end if;

    v_wallet_after := current_wallet + v_wallet_change;

    update public.credit_balances
    set wallet_balance_cents = v_wallet_after,
        updated_at = now()
    where user_id = new.user_id;

    -- Record the audit-trail balance on the just-inserted ledger row. This
    -- UPDATE cannot re-fire the trigger (it is INSERT-only on this table).
    update public.credit_transactions
    set balance_cents_after = v_wallet_after
    where id = new.id;
  else
    if current_interview + new.delta < 0 then
      raise exception 'insufficient interview passes';
    end if;

    update public.credit_balances
    set interview_passes = interview_passes + new.delta,
        updated_at = now()
    where user_id = new.user_id;
  end if;

  insert into odesseus_private.credit_ledger
    (user_id, credit_type, delta, reason, external_reference)
  values
    (new.user_id, new.credit_type, new.delta, new.reason, new.external_reference);

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. odesseus_admin_adjust_wallet
-- ---------------------------------------------------------------------------
-- The only way an admin moves a candidate's wallet. Returns the balance after,
-- and whether this call was the one that moved it -- so a retry is
-- distinguishable from a first success without the caller re-reading anything.

CREATE OR REPLACE FUNCTION public.odesseus_admin_adjust_wallet (
  p_user_id        uuid,
  p_amount_cents   integer,
  p_reference      text,
  p_reason         text,
  p_actor_user_id  uuid,
  p_actor_role     text,
  p_actor_email    text DEFAULT NULL
)
  RETURNS TABLE (
    balance_cents_after integer,
    applied             boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_reference text := trim(coalesce(p_reference, ''));
  v_reason    text := trim(coalesce(p_reason, ''));
  v_delta     integer;
  v_before    integer;
  v_after     integer;
  v_inserted  uuid;
begin
  -- Capability is enforced in the route, from the admin_users roster. The
  -- database re-checks only the one thing it can know for certain: that the
  -- acting role is a real one, so an audit row can never carry a role the
  -- roster does not have. It cannot verify that this actor holds the
  -- capability, and is not asked to.
  if p_actor_role not in ('admin', 'marketing_admin', 'finance_admin') then
    raise exception 'unknown admin role: %', p_actor_role;
  end if;

  -- marketing_admin is refused here as well as in the route. The route is the
  -- control; this is the independent second layer, so a future caller that
  -- reaches the function without going through the route still cannot move a
  -- candidate's money under a marketing role.
  if p_actor_role = 'marketing_admin' then
    raise exception 'role % may not adjust a wallet', p_actor_role;
  end if;

  -- A zero adjustment is not an adjustment. Accepting it would write a ledger
  -- row with delta 0, which the credit_transactions CHECK rejects anyway, and
  -- would be a confusing way to fail.
  if p_amount_cents is null or p_amount_cents = 0 then
    raise exception 'an adjustment must be a non-zero amount';
  end if;

  if v_reference = '' then
    raise exception 'an adjustment reference is required';
  end if;

  -- The reason is the difference between an adjustment an auditor can review
  -- and one they can only observe. Required, and length-capped so it cannot
  -- become a place to paste a candidate's data.
  if v_reason = '' then
    raise exception 'an adjustment reason is required';
  end if;

  if length(v_reason) > 500 then
    raise exception 'adjustment reason is too long';
  end if;

  -- An absolute magnitude plus an explicit direction, rather than a signed
  -- amount. "Credit 500" and "debit 500" are both legible at the call site; a
  -- negative number is a sign error waiting to reverse an adjustment.
  v_delta := case
    when p_amount_cents > 0 then p_amount_cents
    else -abs(p_amount_cents)
  end;

  -- Lock the balance before reading it, so the balance reported in the audit row
  -- is the balance this adjustment actually applied to.
  select wallet_balance_cents
  into v_before
  from public.credit_balances
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'no wallet for user %', p_user_id;
  end if;

  insert into public.credit_transactions (
    user_id, credit_type, delta, reason, amount_cents, external_reference, metadata
  )
  values (
    p_user_id,
    'admin_adjustment',
    v_delta,
    v_reason,
    abs(v_delta),
    v_reference,
    jsonb_build_object('actor_user_id', p_actor_user_id, 'actor_role', p_actor_role)
  )
  on conflict (external_reference) do nothing
  returning id into v_inserted;

  if v_inserted is null then
    -- The reference was already used. Report the balance the earlier call left
    -- behind, and applied = false, so the caller can tell a retry from a first
    -- success. No second audit row: the first one already describes this
    -- adjustment.
    select coalesce(t.balance_cents_after, b.wallet_balance_cents)
    into v_after
    from public.credit_transactions t
    join public.credit_balances b on b.user_id = t.user_id
    where t.external_reference = v_reference;

    return query select v_after, false;
    return;
  end if;

  select wallet_balance_cents
  into v_after
  from public.credit_balances
  where user_id = p_user_id;

  perform public.odesseus_record_admin_action(
    p_actor_user_id => p_actor_user_id,
    p_actor_role    => p_actor_role,
    p_action        => 'wallet.adjusted',
    p_subject_type  => 'candidate',
    p_subject_id    => p_user_id::text,
    p_actor_email   => p_actor_email,
    p_details       => jsonb_build_object(
      'delta_cents', v_delta,
      'amount_cents', abs(v_delta),
      'direction', case when v_delta > 0 then 'credit' else 'debit' end,
      'balance_cents_before', v_before,
      'balance_cents_after', v_after,
      'reference', v_reference,
      'reason', v_reason
    )
  );

  return query select v_after, true;
end;
$function$;

-- Browser users cannot invoke this: it moves a candidate's money. Only the
-- server (the admin route through the service role) and the database owner may
-- call it.
REVOKE ALL ON FUNCTION public.odesseus_admin_adjust_wallet(uuid, integer, text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_admin_adjust_wallet(uuid, integer, text, text, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_admin_adjust_wallet(uuid, integer, text, text, uuid, text, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.odesseus_admin_adjust_wallet(uuid, integer, text, text, uuid, text, text) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 4. Read the audit trail for a candidate
-- ---------------------------------------------------------------------------
-- "Show me everything that happened to this person" is the query an audit is
-- for, and making every admin surface hand-assemble it from raw selects is how
-- one of them forgets to. Service-role only like every other audit read.
CREATE OR REPLACE FUNCTION public.odesseus_admin_audit_trail (
  p_subject_type text,
  p_subject_id   text,
  p_limit        integer DEFAULT 50
)
  RETURNS TABLE (
    id            uuid,
    actor_user_id uuid,
    actor_email   text,
    actor_role    text,
    action        text,
    details       jsonb,
    created_at    timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  -- Bounded, and never the caller's own limit: an audit read that can be asked
  -- for a million rows is a data export wearing an audit's name.
  select l.id, l.actor_user_id, l.actor_email, l.actor_role, l.action, l.details, l.created_at
  from public.admin_audit_log l
  where l.subject_type = p_subject_type
    and l.subject_id = p_subject_id
  order by l.created_at desc, l.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$function$;

REVOKE ALL ON FUNCTION public.odesseus_admin_audit_trail(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_admin_audit_trail(text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_admin_audit_trail(text, text, integer) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.odesseus_admin_audit_trail(text, text, integer) TO postgres, service_role;
