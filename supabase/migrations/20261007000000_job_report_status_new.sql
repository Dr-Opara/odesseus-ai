-- Job report status: 'new' replaces 'open' (additive migration; local stack).
--
-- The approved contract names the four moderation states:
--
--   new, reviewing, resolved, dismissed
--
-- M7 (20261001000000) shipped the filing state as 'open'. The state is
-- semantically identical -- a report that has not been triaged -- but 'new' is
-- the approved name and the rest of the product refers to a moderation queue
-- of *new* reports. This migration aligns the database with that name.
--
-- Data-preserving by construction: the status is rewritten in place rather
-- than the table being dropped and rebuilt, so report ids, created_at, the
-- reporting user's identity, and any moderation notes all survive. The UPDATE
-- is a no-op on an empty table, which is the normal pre-production case.
--
-- Also closes a real hole found while renaming: `authenticated` holds INSERT on
-- public.job_reports, and the insert policy only pinned user_id. A client
-- calling PostgREST directly could therefore file a report already marked
-- 'resolved' or 'dismissed', pre-judging its own moderation outcome. The
-- policy now pins the birth status as well. This is a tightening, never a
-- relaxation, and the service has always sent the filing status explicitly, so
-- no legitimate write path changes.
--
-- Invariants preserved: report RLS remains own-row-scoped for candidates;
-- moderation stays server-side only (no client UPDATE/DELETE); the
-- odesseus_update_job_report_status RPC keeps its exact guard and its
-- service-role-only grant; candidate wallet, apply settlement, employer
-- billing, and Live pricing are untouched.

-- ---------------------------------------------------------------------------
-- 1. Move existing reports onto the approved name
-- ---------------------------------------------------------------------------

UPDATE public.job_reports SET status = 'new' WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- 2. Swap the status domain
-- ---------------------------------------------------------------------------
--
-- Dropped and re-added rather than altered: PostgreSQL cannot relax a CHECK
-- in place, and the replacement covers the same four states with 'open'
-- removed. No row is dropped or recreated.

ALTER TABLE public.job_reports
  DROP CONSTRAINT job_reports_status_check;

ALTER TABLE public.job_reports
  ADD CONSTRAINT job_reports_status_check
  CHECK (status IN ('new', 'reviewing', 'resolved', 'dismissed'));

ALTER TABLE public.job_reports
  ALTER COLUMN status SET DEFAULT 'new'::text;

-- ---------------------------------------------------------------------------
-- 3. A report is born unreviewed
-- ---------------------------------------------------------------------------
--
-- The insert policy previously constrained only ownership, so a client could
-- self-file a report in a terminal state. Pinning the birth status means the
-- moderation outcome can only ever be set by the service-role RPC.

DROP POLICY "job_reports_insert_own" ON public.job_reports;

CREATE POLICY "job_reports_insert_own" ON public.job_reports
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id AND status = 'new');

-- ---------------------------------------------------------------------------
-- 4. Documentation
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.job_reports.status IS
  'Moderation state. A report is born ''new'' and only the service-role odesseus_update_job_report_status RPC may move it to reviewing, resolved, or dismissed; the authenticated insert policy pins new reports to ''new'' so a filer cannot pre-judge their own report.';

COMMENT ON FUNCTION public.odesseus_update_job_report_status(uuid, text, text) IS
  'Moves a report through its moderation queue. ''new'' is the filing state and is deliberately not a valid target: a report is triaged forward, never back into unreviewed. Service-role only, so a report''s status can only ever move through this function.';

-- The triage index now covers a value that actually appears in the queue.
CREATE INDEX IF NOT EXISTS job_reports_new_idx
  ON public.job_reports (created_at)
  WHERE status = 'new';
