-- Employer organization provisioning + company profile (Phase 2P).
--
-- Blocker fixed: employer signup created only the auth user, leaving every
-- new employer in the needsOrganization dead end with no code path to close
-- the loop. This migration adds company-profile columns and the single
-- authoritative provisioning function. It creates nothing twice and never
-- orphans rows.
--
-- grant_employer_tier_job_posts (Path A credit grant) stays untouched as
-- deprecated history: no caller references it. Current enforcement is
-- plan-capacity-via-credits through odesseus_sync_employer_subscription and
-- the claim_job_post_credit trigger; this migration does not add a parallel
-- credit model.

-- ---------------------------------------------------------------------------
-- 1. Company profile columns on employer_organizations (all nullable).
--    The org row previously carried only name/owner; the Company Profile
--    screen needs the rest. Existing rows are untouched.
-- ---------------------------------------------------------------------------

alter table public.employer_organizations
  add column if not exists website text;

alter table public.employer_organizations
  add column if not exists industry text;

alter table public.employer_organizations
  add column if not exists company_size text;

alter table public.employer_organizations
  add column if not exists description text;

comment on column public.employer_organizations.website is
  'Company website URL, as supplied during onboarding or profile edit';
comment on column public.employer_organizations.industry is
  'Company industry, as supplied during onboarding or profile edit';
comment on column public.employer_organizations.company_size is
  'Company size band, as supplied during onboarding or profile edit';
comment on column public.employer_organizations.description is
  'Company description, as supplied during onboarding or profile edit';

-- ---------------------------------------------------------------------------
-- 2. Idempotent, concurrency-safe organization provisioning.
--
-- One transaction, one advisory lock per user, three converging paths:
--   a. user already owns an org -> ensure the owner member row, return org
--   b. user is a member of an org (joined via invitation) -> return it
--   c. otherwise -> create org + owner member row, return org
--
-- Retries, double submits, and concurrent onboarding requests all converge
-- on a single org with a single owner membership: the lock serializes
-- concurrent calls, and the member insert uses ON CONFLICT DO NOTHING on
-- the (org_id, user_id) primary key. Paths (a) and (b) also heal
-- historically half-provisioned accounts (org without membership).
-- ---------------------------------------------------------------------------

create or replace function public.odesseus_ensure_employer_organization (
  p_user_id uuid,
  p_company_name text
)
  returns public.employer_organizations
  language plpgsql
  security definer
  set search_path to 'public', 'odesseus_private', 'pg_temp'
as $function$
declare
  v_org public.employer_organizations%rowtype;
  v_member_org_id uuid;
  v_name text;
begin
  if p_user_id is null then
    raise exception 'A user id is required' using errcode = '22023';
  end if;

  v_name := btrim(coalesce(p_company_name, ''));
  if v_name = '' then
    raise exception 'A company name is required' using errcode = '22023';
  end if;

  -- Serialize concurrent provisioning attempts for the same user. The lock
  -- is transaction-scoped: it is always released at commit/rollback, so a
  -- crashed caller cannot wedge later attempts.
  perform pg_advisory_xact_lock(hashtext('employer-org:' || p_user_id::text));

  -- Path (a): already an owner. Heal a missing member row, then return.
  select * into v_org
  from public.employer_organizations
  where owner_user_id = p_user_id
  order by created_at asc
  limit 1;

  if found then
    insert into public.employer_members (org_id, user_id, role)
    values (v_org.id, p_user_id, 'owner')
    on conflict on constraint employer_members_pkey do nothing;
    return v_org;
  end if;

  -- Path (b): already a member (invited before ever onboarding). No new org.
  select org_id into v_member_org_id
  from public.employer_members
  where user_id = p_user_id
  order by created_at asc
  limit 1;

  if found then
    select * into v_org
    from public.employer_organizations
    where id = v_member_org_id;

    if found then
      return v_org;
    end if;
    -- Member row points at a deleted org: fall through and provision fresh.
  end if;

  -- Path (c): first-time provisioning. Both rows, one transaction.
  insert into public.employer_organizations (name, owner_user_id)
  values (v_name, p_user_id)
  returning * into v_org;

  insert into public.employer_members (org_id, user_id, role)
  values (v_org.id, p_user_id, 'owner')
  on conflict on constraint employer_members_pkey do nothing;

  return v_org;
end;
$function$;

comment on function public.odesseus_ensure_employer_organization(uuid, text) is
  'Authoritative employer onboarding: idempotently ensures exactly one organization plus owner membership per user. Service-role only; called by POST /api/employer/orgs.';

revoke all on function public.odesseus_ensure_employer_organization(uuid, text) from public;
revoke all on function public.odesseus_ensure_employer_organization(uuid, text) from anon;
revoke all on function public.odesseus_ensure_employer_organization(uuid, text) from authenticated;
grant execute on function public.odesseus_ensure_employer_organization(uuid, text) to postgres, service_role;

-- ---------------------------------------------------------------------------
-- 3. Stats
-- ---------------------------------------------------------------------------
analyze public.employer_organizations;
analyze public.employer_members;

-- End of 20261116000000_employer_provisioning.sql
