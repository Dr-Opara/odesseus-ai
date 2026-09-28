-- Application Agent: settings + explainable decision log (Phase 2F).
-- Additive migration; local stack. Nothing historical is rewritten.
--
-- Targeting rules (titles/companies/locations/salary/industries/work
-- arrangement/relocation) already live on job_preferences (Phase 2A), and
-- work-authorization/sponsorship facts already live on
-- candidate_work_authorization (Phase 2A). This does not duplicate either —
-- application_agent_settings holds only what is genuinely agent-specific:
-- mode, pause state, the agent's own match-score floor, the daily cap, and
-- the default apply method. The decision engine (src/lib/agent/decision-
-- engine.ts) reads job_preferences and candidate_work_authorization
-- directly when it evaluates rules.
--
-- application_agent_decisions is the explainability log the spec requires:
-- every decision persists the rules evaluated, the outcome, the reasons,
-- the score at decision time, the mode, the job, and the resume. The status
-- CHECK includes all ten spec statuses even though the decision engine
-- itself only ever produces six of them (AUTO_APPLY, REQUIRES_REVIEW,
-- RULE_MISMATCH, MISSING_DATA, DAILY_LIMIT_REACHED, AGENT_PAUSED) — the
-- remaining four (SENSITIVE_QUESTION, CAPTCHA_REQUIRED, MFA_REQUIRED,
-- UNSUPPORTED_FLOW) are execution-time outcomes discovered once a run is
-- actually in progress, not something knowable before it starts.

CREATE TABLE public.application_agent_settings (
  user_id                 uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  mode                    text NOT NULL DEFAULT 'review'
                            CHECK (mode IN ('review', 'hybrid', 'auto')),
  -- Starts paused: an agent that can auto-submit must be turned on
  -- deliberately, never on by default.
  paused                  boolean NOT NULL DEFAULT true,
  minimum_match_score     smallint NOT NULL DEFAULT 85
                            CHECK (minimum_match_score BETWEEN 0 AND 100),
  daily_application_limit smallint NOT NULL DEFAULT 10
                            CHECK (daily_application_limit > 0),
  default_apply_method    text NOT NULL DEFAULT 'apply'
                            CHECK (default_apply_method IN ('apply', 'smart_apply')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.application_agent_settings IS
  'Agent-specific settings only. Targeting rules live on job_preferences; work-authorization rules live on candidate_work_authorization.';

ALTER TABLE public.application_agent_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_agent_settings_select_own ON public.application_agent_settings
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY application_agent_settings_insert_own ON public.application_agent_settings
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY application_agent_settings_update_own ON public.application_agent_settings
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY application_agent_settings_delete_own ON public.application_agent_settings
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.application_agent_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.application_agent_settings TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.application_agent_settings TO postgres, service_role;

-- ---------------------------------------------------------------------------

CREATE TABLE public.application_agent_decisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id          uuid REFERENCES public.job_opportunities(id) ON DELETE SET NULL,
  resume_id       uuid REFERENCES public.resumes(id) ON DELETE SET NULL,
  mode            text NOT NULL CHECK (mode IN ('review', 'hybrid', 'auto')),
  apply_method    text CHECK (apply_method IS NULL OR apply_method IN ('apply', 'smart_apply')),
  decision        text NOT NULL CHECK (decision IN (
                    'AUTO_APPLY', 'REQUIRES_REVIEW', 'RULE_MISMATCH', 'MISSING_DATA',
                    'SENSITIVE_QUESTION', 'CAPTCHA_REQUIRED', 'MFA_REQUIRED',
                    'UNSUPPORTED_FLOW', 'DAILY_LIMIT_REACHED', 'AGENT_PAUSED'
                  )),
  match_score     smallint CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 100),
  rules_evaluated jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasons         text[] NOT NULL DEFAULT '{}'::text[],
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.application_agent_decisions IS
  'Append-only explainability log: every Application Agent decision, the rules it evaluated, and why. Never updated after insert.';

ALTER TABLE public.application_agent_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_agent_decisions_select_own ON public.application_agent_decisions
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Append-only: no UPDATE or DELETE policy for any browser role. Writes come
-- from the server-side decision engine via the service role.
REVOKE ALL ON TABLE public.application_agent_decisions FROM anon, authenticated;
GRANT SELECT ON TABLE public.application_agent_decisions TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.application_agent_decisions TO postgres, service_role;

CREATE INDEX application_agent_decisions_user_created_idx
  ON public.application_agent_decisions (user_id, created_at DESC);
CREATE INDEX application_agent_decisions_job_idx
  ON public.application_agent_decisions (job_id)
  WHERE job_id IS NOT NULL;

-- Used by the decision engine's daily-limit check: count of AUTO_APPLY
-- decisions already made today for a user.
CREATE INDEX application_agent_decisions_daily_count_idx
  ON public.application_agent_decisions (user_id, decision, created_at);
