import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type WalletAdjustmentResult = {
  balanceCentsAfter: number;
  applied: boolean;
};

export type WalletAdjustmentInput = {
  userId: string;
  amountCents: number;
  reference: string;
  reason: string;
  actor: {
    userId: string;
    role: "admin" | "finance_admin" | "marketing_admin";
    email: string | null;
  };
};

export async function adjustWallet(
  client: SupabaseClient<Database>,
  input: WalletAdjustmentInput
): Promise<{ ok: boolean; error?: string; balanceCentsAfter?: number; applied?: boolean }> {
  // The amount must be non-zero and the reference/reason must be present.
  // The route validates these, but the RPC also re-checks.
  const { data, error } = await client.rpc("odesseus_admin_adjust_wallet", {
    p_user_id: input.userId,
    p_amount_cents: input.amountCents,
    p_reference: input.reference,
    p_reason: input.reason,
    p_actor_user_id: input.actor.userId,
    p_actor_role: input.actor.role,
    p_actor_email: input.actor.email as string | undefined,
  });

  if (error) {
    const msg = error.message;
    if (msg.includes("insufficient wallet balance")) {
      return { ok: false, error: "Insufficient wallet balance for this debit." };
    }
    if (msg.includes("role marketing_admin may not adjust a wallet")) {
      return { ok: false, error: "Marketing admins may not adjust candidate wallets." };
    }
    if (msg.includes("unknown admin role")) {
      return { ok: false, error: "Unrecognised admin role." };
    }
    if (msg.includes("an adjustment must be a non-zero amount")) {
      return { ok: false, error: "Adjustment amount must be non-zero." };
    }
    if (msg.includes("an adjustment reference is required")) {
      return { ok: false, error: "An adjustment reference is required." };
    }
    if (msg.includes("an adjustment reason is required")) {
      return { ok: false, error: "An adjustment reason is required." };
    }
    if (msg.includes("adjustment reason is too long")) {
      return { ok: false, error: "Adjustment reason is too long (max 500 characters)." };
    }
    if (msg.includes("no wallet for user")) {
      return { ok: false, error: "Candidate wallet not found." };
    }
    return { ok: false, error: "Could not adjust wallet." };
  }

  if (!data || data.length === 0) {
    return { ok: false, error: "No result from wallet adjustment." };
  }

  const row = data[0] as { balance_cents_after: number; applied: boolean };
  return { ok: true, balanceCentsAfter: row.balance_cents_after, applied: row.applied };
}

export async function getAdminAuditTrail(
  client: SupabaseClient<Database>,
  subjectType: string,
  subjectId: string,
  limit = 50
): Promise<Array<{
  id: string;
  actorUserId: string;
  actorEmail: string | null;
  actorRole: string;
  action: string;
  details: unknown;
  createdAt: string;
}>> {
  const { data, error } = await client.rpc("odesseus_admin_audit_trail", {
    p_subject_type: subjectType,
    p_subject_id: subjectId,
    p_limit: limit,
  });

  if (error) {
    throw new Error(`Could not load admin audit trail: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    actorRole: row.actor_role,
    action: row.action,
    details: row.details,
    createdAt: row.created_at,
  }));
}