-- RLS audit hardening (M9). Additive migration; local stack.
--
-- The M9 RLS audit swept every table in the public schema and confirmed the
-- posture: all 51 public tables have ROW LEVEL SECURITY enabled and at least
-- one policy; candidate-owned tables are auth.uid()-scoped; employer tables
-- are org-helper-scoped; the resumes storage bucket is private and covered by
-- resume_files_* own-scoped policies on storage.objects.
--
-- One drift surfaced. admin_users and the ten partner_* tables are
-- server-only: their baseline deny-browser-access policies (USING false WITH
-- CHECK false) already stop anon/authenticated at the row level. But the
-- tables still carry the default grant surface that Supabase applies to every
-- freshly created table (ALL to anon + authenticated). Functional reads and
-- writes were never possible — RLS denied them — yet a privilege-level ALL
-- grant contradicts the deny policies and invites confusion (and future
-- permissive-policy additions that would silently widen real access).
--
-- This migration closes that gap by revoking anon/authenticated privileges on
-- those eleven tables, leaving them reachable only by postgres and
-- service_role. It never touches any permissive policy, never enables RLS
-- bypass, and only narrows the grant surface. RLS on every existing table is
-- preserved exactly as-is.
--
-- Invariants preserved: RLS never weakened; candidate wallet, apply
-- settlement, employer billing, and Live pricing untouched; the resumes
-- bucket policies untouched.

-- ---------------------------------------------------------------------------
-- 1. Revoke the default anon/authenticated grants on server-only tables
-- ---------------------------------------------------------------------------
REVOKE ALL PRIVILEGES ON TABLE public.admin_users FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.partner_applications FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.partner_campaign_members FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.partner_campaigns FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.partner_content FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.partner_conversions FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.partner_earnings FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.partner_payouts FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.partner_referrals FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.partner_social_accounts FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.partners FROM anon, authenticated;

-- The deny-browser-access policies stay in place as a second, independent
-- layer: even if a future migration re-grants privileges, RLS still returns
-- zero rows for anon/authenticated on these tables.
COMMENT ON TABLE public.admin_users IS
  'Server-only admin roster. RLS deny-browser-access + no anon/authenticated grants (M9).';
COMMENT ON TABLE public.partners IS
  'Server-only partner registry. RLS deny-browser-access + no anon/authenticated grants (M9).';