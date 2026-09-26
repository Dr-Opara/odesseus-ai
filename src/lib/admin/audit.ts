/**
 * Admin audit writes (Phase 9A).
 *
 * The important property is that an audit row and the change it describes are
 * the same fact. Where a domain RPC exists, the RPC writes the audit row inside
 * its own transaction -- `odesseus_update_job_report_status` does, and the
 * wallet-adjustment RPC does -- because two supabase calls are two transactions
 * and a log that can be missing is not a log.
 *
 * `recordAdminAction` is for the case where there is no domain RPC to hang the
 * write on. It goes through `odesseus_record_admin_action` rather than an
 * insert so the append-only grant surface holds: the table grants no INSERT to
 * any role, and the SECURITY DEFINER function writes as its owner.
 *
 * A failure here is logged and swallowed, deliberately. The change has already
 * been applied, so returning an error to the operator would invite a retry
 * against work that is already done -- the same hazard the seat-sync path
 * documents. A missing audit row is bad; a doubled refund is worse. The
 * structured log is the signal that one needs backfilling.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AdminRole } from "@/lib/admin/capabilities";

export type AdminAuditEntry = {
  actorUserId: string;
  actorEmail: string | null;
  actorRole: AdminRole;
  /** Snake_case, matching the CHECK constraint: `job_report.status_changed`. */
  action: string;
  /** The kind of thing acted on: `job_report`, `candidate`, `employer`. */
  subjectType: string;
  subjectId: string | null;
  details?: Record<string, unknown>;
};

export async function recordAdminAction(
  client: SupabaseClient<Database>,
  entry: AdminAuditEntry
): Promise<{ ok: boolean; id: string | null }> {
  const { data, error } = await client.rpc("odesseus_record_admin_action", {
    p_actor_user_id: entry.actorUserId,
    p_actor_email: entry.actorEmail,
    p_actor_role: entry.actorRole,
    p_action: entry.action,
    p_subject_type: entry.subjectType,
    p_subject_id: entry.subjectId,
    p_details: (entry.details ?? {}) as Database["public"]["Functions"]["odesseus_record_admin_action"]["Args"]["p_details"],
  });

  if (error) {
    console.error("[ODESSEUS_ADMIN_AUDIT] could not record admin action", {
      action: entry.action,
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      error: error.message,
    });
    return { ok: false, id: null };
  }

  return { ok: true, id: (data as string | null) ?? null };
}
