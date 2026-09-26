-- Wallet/ledger reversal RPC (Phase wallet milestone). Additive migration.
--
-- Implements the documented "refund/reversal / administrative adjustment"
-- wallet capability as a server-side, service-role-only primitive:
--
--   odesseus_reverse_credit_transaction(p_external_reference, p_reason)
--
-- Semantics:
--   * Looks up the original credit_transactions row FOR UPDATE (serializing
--     with concurrent settlement), then posts an opposite-delta row using a
--     deterministic unique reference  'reversal:<original_ref>'. Replaying
--     the same reversal is a no-op (ON CONFLICT) — exactly one reversal per
--     original transaction, enforced by the unique external_reference.
--   * Posting the reversal through the normal insert path means the shared
--     apply_credit_transaction() trigger moves the wallet by the opposite
--     delta and records balance_cents_after + a credit_ledger row, so the
--     audit trail stays complete and the balance can never drift from the
--     ledger.
--   * Reversing a wallet top-up debits the wallet by the credit amount. If
--     the candidate has already spent those funds, the 'insufficient wallet
--     balance' raise rolls the reversal back — money that left the wallet
--     goes back to the original payment method via the Stripe refund path,
--     not by clawing back the wallet. Reversing an Apply debit credits the
--     wallet by the charged amount (e.g. a submission later found invalid).
--   * The original transaction is never modified or deleted — reversal is
--     purely additive, matching the "deactivate, do not delete" ledger
--     discipline.
--
-- Browser users cannot invoke this: it moves money. Only the server (service
-- role) and the database owner may call it, mirroring the finalization RPC.

CREATE OR REPLACE FUNCTION public.odesseus_reverse_credit_transaction (
  p_external_reference text,
  p_reason            text DEFAULT 'reversal'
)
  RETURNS TABLE (
    reversal_reference text,
    original_delta     integer,
    reversal_delta     integer,
    already_reversed   boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_row     public.credit_transactions%rowtype;
  v_ref     text;
  v_delta   integer;
  v_reason  text;
  v_applied integer;
begin
  if p_external_reference is null or length(trim(p_external_reference)) = 0 then
    raise exception 'an external reference is required to reverse a transaction';
  end if;

  v_reason := coalesce(nullif(trim(p_reason), ''), 'reversal');

  select *
  into v_row
  from public.credit_transactions
  where external_reference = p_external_reference
  for update;

  if not found then
    raise exception 'credit transaction not found: %', p_external_reference;
  end if;

  if v_row.delta = 0 then
    raise exception 'credit transaction has a zero delta and cannot be reversed';
  end if;

  v_ref := 'reversal:' || p_external_reference;
  v_delta := -v_row.delta;

  insert into public.credit_transactions (
    user_id, credit_type, delta, reason, amount_cents, external_reference, metadata
  )
  values (
    v_row.user_id,
    v_row.credit_type,
    v_delta,
    v_reason,
    abs(v_row.delta),
    v_ref,
    jsonb_build_object(
      'reverses', v_row.external_reference,
      'original_delta', v_row.delta,
      'original_reason', v_row.reason
    )
  )
  on conflict (external_reference) do nothing;

  -- ON CONFLICT DO NOTHING reports 0 rows when the reference already exists:
  -- that is the replay case, and it must not re-apply the reversal. ROW_COUNT
  -- is the unambiguous signal (RETURNING would not distinguish a no-op).
  get diagnostics v_applied = row_count;

  if v_applied > 0 then
    return query
    select v_ref, v_row.delta, v_delta, false;
    return;
  end if;

  select delta
  into v_delta
  from public.credit_transactions
  where external_reference = v_ref;

  return query
  select v_ref, v_row.delta, coalesce(v_delta, 0), true;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_reverse_credit_transaction(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_reverse_credit_transaction(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_reverse_credit_transaction(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_reverse_credit_transaction(text, text) TO postgres, service_role;