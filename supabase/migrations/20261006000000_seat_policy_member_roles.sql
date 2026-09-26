-- Seat policy: every additional active member consumes a paid seat.
--
-- The M5 migration (20261005000000) introduced a team model where only the
-- 'recruiter' role consumed a paid seat, on the reading that admin and viewer
-- were "account-management roles". That reading has a hole: a user could avoid
-- seat billing entirely by assigning a teammate the 'admin' or 'viewer' role,
-- which is functionally identical access for most team usage. The approved
-- product decision is therefore:
--
--   The organization owner is included and consumes no paid seat. Every
--   additional ACTIVE organization member consumes one $20/month seat, whatever
--   their role. Paid roles: admin, recruiter, viewer.
--
--   Concretely:
--     owner only                 -> 0 paid seats
--     owner + 1 recruiter        -> 1 paid seat ($20/month)
--     owner + 1 admin            -> 1 paid seat ($20/month)
--     owner + 1 viewer           -> 1 paid seat ($20/month)
--     owner + 1 admin + 2 recs   -> 3 paid seats ($60/month)
--
-- The role list remains the single place the policy is expressed:
-- public.odesseus_metered_org_roles() below, mirrored by METERED_ROLES in
-- src/lib/employer/service.ts. Changing the policy is a one-line change in each
-- rather than an audit across the API, the RPC, and the tests.
--
-- The public.recruiter_seats table, its name, and the
-- odesseus_recruiter_seats / odesseus_seat_count checkout metadata are
-- deliberately NOT renamed. "Recruiter seat" remains the product name in the
-- catalog ("Recruiter Seat", $20/month, one per additional employer-team seat)
-- and the Stripe metadata is the fulfillment contract; renaming it would churn
-- a paid billing path to change a noun.
--
-- Also adds the one place a required seat count is derived, so the read side,
-- the accept-time cap, and the post-removal Stripe sync cannot disagree.
--
-- Invariants preserved: additive-only; no data is dropped or rewritten;
-- employer_members, employer_organizations, recruiter_seats, and their RLS
-- and grants are untouched; candidate wallet, apply settlement, employer plan
-- quotas, featured listings, and Live pricing are unaffected.

-- ---------------------------------------------------------------------------
-- 1. Metered roles: every role an invitation can grant
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.odesseus_metered_org_roles()
  RETURNS text[]
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  select array['admin', 'recruiter', 'viewer']::text[];
$function$;

COMMENT ON FUNCTION public.odesseus_metered_org_roles() IS
  'Employer team roles that consume one paid seat ($20/month) per active member. Every role an invitation can grant is metered; the organization owner is excluded by identity, not by role, so the owner is never charged for a seat even if they also hold a member row. Plan tiers price job posts, not seats, so the included allowance is 0.';

-- ---------------------------------------------------------------------------
-- 2. Required seat count for an org
-- ---------------------------------------------------------------------------
--
-- "How many seats does this team currently need?", derived from the roster
-- rather than tracked. Deriving is what makes seat synchronization idempotent:
-- recomputing the target after a membership change yields the same answer no
-- matter how many times it runs, so a retried or duplicated request cannot
-- double-adjust the Stripe subscription. An increment/decrement counter could.
--
-- The owner is excluded by comparing against employer_organizations.owner_user_id
-- rather than by filtering on the 'owner' role, because the owner is not
-- required to hold an employer_members row at all, and could hold one with a
-- metered role.

CREATE OR REPLACE FUNCTION public.odesseus_org_required_seat_count(p_org_id uuid)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  select count(*)::integer
  from public.employer_members em
  join public.employer_organizations o
    on o.id = em.org_id
  where em.org_id = p_org_id
    and em.role = any (public.odesseus_metered_org_roles())
    and em.user_id <> o.owner_user_id;
$function$;

COMMENT ON FUNCTION public.odesseus_org_required_seat_count(uuid) IS
  'Paid seats an org currently requires: one per active member in a metered role, excluding the organization owner. Reads employer_members, whose authenticated grants are SELECT-only behind RLS, so it is SECURITY DEFINER; it returns a count scoped to one org, never member data.';

REVOKE ALL ON FUNCTION public.odesseus_org_required_seat_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_org_required_seat_count(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.odesseus_org_required_seat_count(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Accept an invitation: cap every metered role, and say "seat" not
--    "recruiter seat"
-- ---------------------------------------------------------------------------
--
-- The body is unchanged apart from the rejection message, which named the
-- recruiter role specifically. The capacity check is still written against
-- odesseus_metered_org_roles() rather than hardcoded, so this function keeps
-- agreeing with the policy if the role list changes again.

CREATE OR REPLACE FUNCTION public.odesseus_accept_employer_invitation (
  p_token text
)
  RETURNS TABLE (
    joined_org_id  uuid,
    org_name       text,
    joined_role    text,
    invitation_id  uuid
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_invitation   public.employer_member_invitations%rowtype;
  v_user_id      uuid := auth.uid();
  v_caller_email text;
  v_org          public.employer_organizations%rowtype;
  v_used         integer;
  v_capacity     integer;
  v_metered      text[] := public.odesseus_metered_org_roles();
begin
  if v_user_id is null then
    raise exception 'sign in to accept this invitation';
  end if;

  if p_token is null or length(trim(p_token)) < 16 then
    raise exception 'invalid invitation link';
  end if;

  select * into v_invitation
  from public.employer_member_invitations
  where token = trim(p_token);

  if not found then
    raise exception 'invalid invitation link';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception 'this invitation has already been %', v_invitation.status;
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'this invitation has expired';
  end if;

  -- Token possession is not identity. Compare against the verified JWT email so
  -- only the person actually invited can redeem the link.
  v_caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_caller_email = '' or v_caller_email <> lower(trim(v_invitation.email)) then
    raise exception 'this invitation was sent to a different email address';
  end if;

  -- Serialize concurrent accepts for this org. Everything below reads state
  -- that the other accept may be about to change.
  select * into v_org
  from public.employer_organizations
  where id = v_invitation.org_id
  for update;

  if not found then
    raise exception 'employer organization not found';
  end if;

  -- An owner is never seat-metered, even if they also hold a metered role: the
  -- organization owner is account staff by definition.
  if v_invitation.role = any (v_metered)
     and not (v_org.owner_user_id = v_user_id) then

    v_used := (
      select count(*)::integer
      from public.employer_members em
      where em.org_id = v_invitation.org_id
        and em.role = any (v_metered)
        and em.user_id <> v_user_id
    );

    v_capacity := public.odesseus_org_live_seat_count(v_invitation.org_id);

    if v_used >= v_capacity then
      raise exception 'this team has no paid seats left; add a seat to invite another member';
    end if;
  end if;

  -- Membership is the (org_id, user_id) primary key, so re-accepting is an
  -- update rather than a constraint violation. A user who is already a member
  -- under a different role gets the invited role. The conflict target names the
  -- constraint explicitly, so it cannot be captured by an OUT parameter.
  insert into public.employer_members (org_id, user_id, role)
  values (v_invitation.org_id, v_user_id, v_invitation.role)
  on conflict on constraint employer_members_pkey do update
    set role = excluded.role;

  update public.employer_member_invitations
  set status = 'accepted',
      accepted_at = now(),
      accepted_user_id = v_user_id
  where id = v_invitation.id;

  return query
  select v_org.id, v_org.name, v_invitation.role, v_invitation.id;
end;
$function$;

COMMENT ON FUNCTION public.odesseus_accept_employer_invitation(text) IS
  'Redeems a team invitation into membership. The one and only invite-to-member path: the seat cap is a check-then-act that only the database can make atomic, and the org row is locked FOR UPDATE so two concurrent accepts cannot oversell a seat. Token possession is necessary but not sufficient -- the caller''s verified email must match the invitation.';

-- ---------------------------------------------------------------------------
-- 4. Documented role/seat relationship
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.employer_members.role IS
  'Employer team role. Every role except the organization owner is seat-metered (see public.odesseus_metered_org_roles): one $20/month paid seat per active member, whatever the role. The owner is excluded by identity -- employer_organizations.owner_user_id -- not by this column, so an owner who also holds a member row is still not charged.';

COMMENT ON TABLE public.recruiter_seats IS
  'Paid recruiter seats per org. "Recruiter seat" is the product name for one additional employer-team seat at $20/month; every additional active member consumes one, whatever their role. Written by the billing webhook (service role); org members read-only.';
