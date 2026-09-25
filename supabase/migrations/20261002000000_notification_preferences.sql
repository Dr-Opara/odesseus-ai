-- Notification preferences (M8). Additive migration; local stack.
--
-- The Notifications screen (screen 16) is currently a local-only demo state;
-- its component documents "BACKEND TODO (Phase 5): a real notification
-- preferences table + delivery pipeline." This migration lands the persistence
-- half of that slice:
--
--   public.notification_preferences — one row per user (user_id PK, mirroring
--   job_preferences), with a fixed boolean column per notification channel the
--   product actually offers (see mobile-notifications.tsx):
--
--     applications — submission and status changes       (default on)
--     documents    — resume and document changes         (default on)
--     matches      — new high-match opportunities        (default on)
--     activity     — important Odesseus Agent actions    (default on)
--     product      — new features and announcements      (default off)
--
-- The row is own-row-scoped by RLS with the standard candidate CRUD surface
-- (select/insert/update/delete own), consistent with job_preferences: users own
-- their notification settings and may change them freely; anon reads nothing.
-- The delivery pipeline itself stays out of scope for this slice (no outbound
-- channel here — that belongs to the integration milestones).
--
-- Invariants preserved: additive-only; RLS extended, never weakened; settings
-- are private candidate data; wallet, billing, employer, and Live surfaces are
-- untouched.

CREATE TABLE public.notification_preferences (
  user_id       uuid                     NOT NULL,
  applications  boolean                  NOT NULL DEFAULT true,
  documents     boolean                  NOT NULL DEFAULT true,
  matches       boolean                  NOT NULL DEFAULT true,
  activity      boolean                  NOT NULL DEFAULT true,
  product       boolean                  NOT NULL DEFAULT false,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  updated_at    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMENT ON TABLE public.notification_preferences IS
  'One row per user carrying the notification channels Odesseus may use. Defaults put candidate-relevant channels on and marketing off; users own and may edit their row.';

-- RLS mirrors job_preferences: full own-row CRUD for the user, nothing for anon.
CREATE POLICY "notification_preferences_select_own" ON public.notification_preferences
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "notification_preferences_insert_own" ON public.notification_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "notification_preferences_update_own" ON public.notification_preferences
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "notification_preferences_delete_own" ON public.notification_preferences
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.notification_preferences FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_preferences TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.notification_preferences TO postgres, service_role;