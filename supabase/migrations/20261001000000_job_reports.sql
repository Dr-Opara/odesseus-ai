-- Job reports + moderation queue (M7). Additive migration; local stack.
--
-- The Report Job flow (screen 33) currently ends in a local-only confirmation;
-- its component documents "BACKEND TODO (Phase 5): a real job_reports table +
-- moderation queue." This migration lands that backend slice:
--
--   1. public.job_reports — a candidate-owned report about a job or company,
--      with the exact reason set the UI offers (Scam, Fake Company, Misleading
--      Job Description, Misleading Salary, Requests Payment, Phishing Attempt,
--      Duplicate Listing, Incorrect Location, Other) plus optional details and
--      a moderation status + internal note. The row is own-row-scoped by RLS
--      (select + insert only; no client update/delete), and job_id follows the
--      referenced opportunity with ON DELETE SET NULL so the report survives a
--      job's removal.
--   2. public.odesseus_update_job_report_status() — a service-role-only
--      SECURITY DEFINER RPC that moves a report through its moderation queue
--      (reviewing / resolved / dismissed). It fails closed on unknown statuses
--      and missing reports, so a malformed webhook or tool call can never
--      silently alter a report. All params are consumed; nothing is unused.
--
-- Invariants preserved: additive-only; RLS extended, never weakened; reports
-- are private candidate data (never readable by anon or other candidates);
-- candidate wallet, apply settlement, employer billing, and Live pricing are
-- untouched.

-- ---------------------------------------------------------------------------
-- 1. public.job_reports
-- ---------------------------------------------------------------------------

CREATE TABLE public.job_reports (
  id              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  user_id         uuid                     NOT NULL,
  job_id          uuid,
  reason          text                     NOT NULL,
  details         text,
  status          text                     NOT NULL DEFAULT 'open'::text,
  moderation_note text,
  created_at      timestamp with time zone NOT NULL DEFAULT now(),
  updated_at      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT job_reports_pkey PRIMARY KEY (id),
  CONSTRAINT job_reports_reason_check CHECK (
    reason IN (
      'Scam',
      'Fake Company',
      'Misleading Job Description',
      'Misleading Salary',
      'Requests Payment',
      'Phishing Attempt',
      'Duplicate Listing',
      'Incorrect Location',
      'Other')),
  CONSTRAINT job_reports_details_length_check CHECK (details IS NULL OR char_length(details) <= 2000),
  CONSTRAINT job_reports_moderation_note_length_check CHECK (moderation_note IS NULL OR char_length(moderation_note) <= 2000),
  CONSTRAINT job_reports_status_check CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed'))
);

ALTER TABLE public.job_reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.job_reports
  ADD CONSTRAINT job_reports_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.job_reports
  ADD CONSTRAINT job_reports_job_id_fkey
  FOREIGN KEY (job_id) REFERENCES public.job_opportunities(id) ON DELETE SET NULL;

CREATE INDEX job_reports_user_idx ON public.job_reports (user_id);
CREATE INDEX job_reports_status_idx ON public.job_reports (status);
CREATE INDEX job_reports_job_idx ON public.job_reports (job_id);

COMMENT ON TABLE public.job_reports IS
  'Candidate-submitted reports about a job or company, scoped to the reporting user and triaged through a server-side moderation queue.';
COMMENT ON CONSTRAINT job_reports_job_id_fkey ON public.job_reports IS
  'The reported opportunity. Deletions null the reference so a report outlives the job.';

-- RLS: the reporting user may read and file their own reports; moderation is
-- server-side only (no client UPDATE/DELETE paths).
CREATE POLICY "job_reports_select_own" ON public.job_reports
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "job_reports_insert_own" ON public.job_reports
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.job_reports FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.job_reports TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.job_reports TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 2. Moderation status transition (service role only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.odesseus_update_job_report_status (
  p_report_id uuid,
  p_status    text,
  p_note      text DEFAULT NULL
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
begin
  if p_status not in ('reviewing', 'resolved', 'dismissed') then
    raise exception 'unknown job report moderation status: %', p_status;
  end if;

  if not exists (select 1 from public.job_reports where id = p_report_id) then
    raise exception 'job report not found';
  end if;

  update public.job_reports
     set status          = p_status,
         moderation_note = coalesce(p_note, moderation_note),
         updated_at      = now()
   where id = p_report_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_update_job_report_status(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_update_job_report_status(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_update_job_report_status(uuid, text, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.odesseus_update_job_report_status(uuid, text, text) TO postgres, service_role;