-- Final security: least-privilege grants on mock interview tables.
--
-- The Phase 2M migration enabled RLS with owner-only view/insert/update
-- policies but never revoked the Supabase platform default grants, leaving
-- anon (and over-broad authenticated) table privileges that RLS happened to
-- neutralize. Grants are not a second line of decoration: revoke everything,
-- then re-grant authenticated exactly the three verbs its policies need.
-- RLS behavior is unchanged; no policy is touched.

revoke all on table
  public.mock_interview_sessions,
  public.mock_interview_questions,
  public.mock_interview_answers,
  public.mock_interview_feedback
from anon, authenticated;

grant select, insert, update on table
  public.mock_interview_sessions,
  public.mock_interview_questions,
  public.mock_interview_answers,
  public.mock_interview_feedback
to authenticated;

grant all privileges on table
  public.mock_interview_sessions,
  public.mock_interview_questions,
  public.mock_interview_answers,
  public.mock_interview_feedback
to postgres, service_role;

-- End of 20261119000000_mock_least_privilege.sql
