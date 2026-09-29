-- Interview Workspace backend (Phase 2L). Additive migration only.
--
-- Makes application_id nullable on interviews (and linked tables) to allow
-- manual interview creation without requiring a real application.
-- Adds columns for manual interview metadata: company, role_title, location,
-- meeting_type, notes, application_url.

-- ---------------------------------------------------------------------------
-- 1. Make interviews.application_id nullable (was NOT NULL FK to applications)
-- ---------------------------------------------------------------------------

ALTER TABLE public.interviews
  ALTER COLUMN application_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Add manual-interview metadata columns to interviews (all nullable)
-- ---------------------------------------------------------------------------

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS company text;

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS role_title text;

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS location text;

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS meeting_type text CHECK (meeting_type IN ('video','phone','onsite','async'));

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS application_url text;

-- ---------------------------------------------------------------------------
-- 3. Make application_id nullable on linked tables for manual interview support
-- ---------------------------------------------------------------------------

ALTER TABLE public.interview_round_memory
  ALTER COLUMN application_id DROP NOT NULL;

ALTER TABLE public.live_interview_sessions
  ALTER COLUMN application_id DROP NOT NULL;

ALTER TABLE public.post_interview_analyses
  ALTER COLUMN application_id DROP NOT NULL;

ALTER TABLE public.follow_up_drafts
  ALTER COLUMN application_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Add index for faster lookups on manual-interview columns
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS interviews_company_idx ON public.interviews(company);
CREATE INDEX IF NOT EXISTS interviews_role_title_idx ON public.interviews(role_title);
CREATE INDEX IF NOT EXISTS interviews_notes_idx ON public.interviews(notes);

-- ---------------------------------------------------------------------------
-- 5. Update comments on interviews to reflect the new nullable conventions
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.interviews.application_id IS
  'FK to applications(id) ON DELETE SET NULL; nullable for manual interviews without an application';

COMMENT ON COLUMN public.interviews.company IS
  'Company name for manual interviews; may be null when linked to an application';

COMMENT ON COLUMN public.interviews.role_title IS
  'Role title for manual interviews; maps to applications.role_title when linked';

COMMENT ON COLUMN public.interviews.location IS
  'Physical or virtual meeting location';

COMMENT ON COLUMN public.interviews.meeting_type IS
  'Meeting type: video, phone, onsite, or async';

COMMENT ON COLUMN public.interviews.notes IS
  'Interviewer notes';

COMMENT ON COLUMN public.interviews.application_url IS
  'Optional application link (e.g. job posting URL)';

-- ---------------------------------------------------------------------------
-- 6. Audit note: update src/types/database.ts to make interviews.application_id
-- nullable and add the new columns. The migration above relaxes the constraint;
-- the type must also change from `application_id: string` to `application_id: string | null`.
-- (Manual update required outside this migration — see src/types/database.ts line 1713)

-- End of 20261030000000_interview_workspace.sql