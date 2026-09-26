-- Recruiter seat invitations and membership (M5). Additive migration; local stack.
--
-- The pricing contract (20260924000000) already models a paid seat as an
-- ORG-LEVEL QUOTA: public.recruiter_seats is one row per Stripe subscription
-- holding `count`, written only by the billing webhook and read-only to members.
-- The M5 sync migration (20260929000000) maintains that quota. What did not
-- exist was the other half of the seat: actually giving a seat to a person.
--
-- public.employer_members.user_id has an auth.users FK, so a team member must
-- already have an account. An invite for someone who has not signed up yet
-- therefore cannot be a member row. This migration adds the pending-invite
-- table and the single atomic RPC that turns an invite into membership.
--
-- Seat policy, stated explicitly because the contract prices the product but
-- does not define which roles consume a seat:
--
--   The 'recruiter' role consumes one paid seat per active member. 'owner',
--   'admin', and 'viewer' are account-management roles and do not consume a
--   seat. The plan tiers (Starter/Growth/Business) price job posts, not seats,
--   so the included-seat allowance is 0 and every recruiter must be backed by a
--   live public.recruiter_seats entitlement.
--
--   The role list is deliberately the single place that policy is expressed:
--   METERED_ORG_ROLES below, and a matching comment on
--   public.employer_members.role, so changing the policy is a one-line change
--   rather than an audit across the API, the RPC, and the tests.
--
-- Invariants preserved: additive-only; recruiter_seats, employer_members,
-- employer_organizations, and their RLS/grants are untouched; no changes to
-- candidate wallet, apply settlement, employer plan quotas, featured listings,
-- or Live pricing. The existing invitation-free paths (an owner adding an
-- existing account directly through employer_members) keep working unchanged.

-- ---------------------------------------------------------------------------
-- 1. Pending team invitations
-- ---------------------------------------------------------------------------

CREATE TABLE public.employer_member_invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.employer_organizations(id) ON DELETE CASCADE,
  -- Lowercased on write by the API and compared case-insensitively by the accept
  -- RPC, so "Ada@Example.com" and "ada@example.com" are one invitee.
  email         text NOT NULL CHECK (length(trim(email)) > 3),
  -- 'owner' is intentionally absent: ownership is set on the organization row,
  -- not handed out by invitation.
  role          text NOT NULL CHECK (role IN ('admin', 'recruiter', 'viewer')),
  -- Single-use bearer secret. The accept RPC treats the token as necessary but
  -- NOT sufficient: it also requires the caller's verified email to match, so a
  -- leaked or guessed link cannot be redeemed by a different account.
  token         text NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by    uuid NOT NULL REFERENCES auth.users(id),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  accepted_user_id uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.employer_member_invitations IS
  'Pending employer team invitations. Seats are enforced at accept time, not at invite time, so an invite can never itself grant capacity.';
COMMENT ON COLUMN public.employer_member_invitations.token IS
  'Single-use bearer secret. Redemption additionally requires the caller''s email to equal the invitation email.';
COMMENT ON COLUMN public.employer_member_invitations.status IS
  'pending (redeemable until expires_at), accepted (redeemed once), revoked (withdrawn by an admin).';

-- One outstanding invite per person per org. Retrying an invite after a revoke
-- therefore creates a fresh row rather than colliding with the old one.
CREATE UNIQUE INDEX employer_member_invitations_pending_idx
  ON public.employer_member_invitations (org_id, lower(email))
  WHERE status = 'pending';

-- Invitation tokens are looked up by their secret, so that lookup must be
-- indexed regardless of the org-scoped access pattern.
CREATE UNIQUE INDEX employer_member_invitations_token_idx
  ON public.employer_member_invitations (token);

CREATE INDEX employer_member_invitations_org_idx
  ON public.employer_member_invitations (org_id, created_at DESC);

-- The org-scoped queue view ("who have I invited, and is it still pending?").
CREATE INDEX employer_member_invitations_pending_queue_idx
  ON public.employer_member_invitations (org_id, created_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.employer_member_invitations ENABLE ROW LEVEL SECURITY;

-- An invitation contains a team member's email address, so it is admin-scoped:
-- owners and admins manage the org's invitations, ordinary members do not see
-- them, and no policy exposes a row to the invitee. The invitee redeems a token
-- through the SECURITY DEFINER RPC below, which never returns the table.
CREATE POLICY "employer_member_invitations_select_admin_owner"
  ON public.employer_member_invitations
  FOR SELECT TO authenticated
  USING (odesseus_private.is_org_admin_or_owner(org_id));

CREATE POLICY "employer_member_invitations_insert_admin_owner"
  ON public.employer_member_invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    odesseus_private.is_org_admin_or_owner(org_id)
    AND invited_by = auth.uid()
  );

-- Only the status columns move, and only an admin may move them. Withdrawn
-- invitations are kept (not deleted) so an audit can show who was invited and
-- when; the partial unique index above means a revoked row no longer blocks a
-- fresh invite.
CREATE POLICY "employer_member_invitations_update_admin_owner"
  ON public.employer_member_invitations
  FOR UPDATE TO authenticated
  USING (odesseus_private.is_org_admin_or_owner(org_id))
  WITH CHECK (odesseus_private.is_org_admin_or_owner(org_id));

-- The accept RPC flips accepted_* through SECURITY DEFINER, so a client can
-- never mark an invitation accepted for someone else. The DELETE policy exists
-- for org teardown (ON DELETE CASCADE is service-role/postgres anyway) and is
-- admin-scoped to match.
CREATE POLICY "employer_member_invitations_delete_admin_owner"
  ON public.employer_member_invitations
  FOR DELETE TO authenticated
  USING (odesseus_private.is_org_admin_or_owner(org_id));

REVOKE ALL ON TABLE public.employer_member_invitations FROM anon, authenticated;
REVOKE ALL ON TABLE public.employer_member_invitations FROM PUBLIC;

-- authenticated gets RLS-scoped SELECT plus the INSERT/UPDATE/DELETE the admin
-- policies describe. Token reads are harmless only because no policy returns a
-- row to anyone who is not already an org admin, and the accept RPC is the only
-- path that acts on a token.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.employer_member_invitations
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.employer_member_invitations
  TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 2. Metered roles
-- ---------------------------------------------------------------------------
--
-- The single expression of "which team roles consume a paid recruiter seat".
-- Kept as a SQL array so the accept RPC below and any reporting query agree.

CREATE OR REPLACE FUNCTION public.odesseus_metered_org_roles()
  RETURNS text[]
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  select array['recruiter']::text[];
$function$;

COMMENT ON FUNCTION public.odesseus_metered_org_roles() IS
  'Employer team roles that consume one paid recruiter seat per active member. Plan tiers price job posts, not seats, so the included allowance is 0.';

REVOKE ALL ON FUNCTION public.odesseus_metered_org_roles() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_metered_org_roles() FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_metered_org_roles() FROM authenticated;

-- ---------------------------------------------------------------------------
-- 3. Live seat capacity for an org
-- ---------------------------------------------------------------------------
--
-- A seat is live when the webhook has written a positive count for an
-- unexpired period. Rows the webhook voided (canceled/incomplete => count 0)
-- and rows whose paid period has lapsed contribute nothing, so capacity shrinks
-- on its own when a subscription lapses and nobody has to remember to
-- decrement it.

CREATE OR REPLACE FUNCTION public.odesseus_org_live_seat_count(p_org_id uuid)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  select coalesce(sum(rs.count), 0)::integer
  from public.recruiter_seats rs
  where rs.org_id = p_org_id
    and rs.count > 0
    and (rs.active_until is null or rs.active_until > now());
$function$;

COMMENT ON FUNCTION public.odesseus_org_live_seat_count(uuid) IS
  'Paid recruiter seats currently live for an org. Reads recruiter_seats, which members may not read directly, so it is SECURITY DEFINER and callable by any signed-in user; the value is a count, not user data.';

REVOKE ALL ON FUNCTION public.odesseus_org_live_seat_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_org_live_seat_count(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.odesseus_org_live_seat_count(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Accept an invitation (authenticated)
-- ---------------------------------------------------------------------------
--
-- The one and only path from a pending invite to team membership. It is a
-- function rather than route code for one reason: the seat cap is a
-- check-then-act, and only the database can make it atomic.
--
--   * The org row is locked FOR UPDATE, so two simultaneous accepts are
--     serialized and the second sees the first's member row. Doing this in the
--     API would let two concurrent requests both read "1 of 2 seats used" and
--     both insert, overselling a paid seat.
--   * Capacity is re-read inside the lock, so a seat that lapsed or was refunded
--     between the invite and the accept is honoured immediately.
--   * The token alone is not authority. The caller's verified email must match
--     the invited address, so a forwarded or guessed link cannot be redeemed by
--     a different account.

-- Output column names are deliberately prefixed: an OUT parameter becomes a
-- PL/pgSQL variable inside the body, so a column named `org_id` or `role` would
-- make `on conflict (org_id, user_id)` ambiguous and fail at runtime.
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
      raise exception 'this team has no recruiter seats left; add a seat to invite another recruiter';
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

REVOKE ALL ON FUNCTION public.odesseus_accept_employer_invitation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_accept_employer_invitation(text) FROM anon;
-- Deliberately granted to authenticated: accepting your own invitation is the
-- whole point of the function, and it is gated on the caller's own verified
-- email. It reads and writes membership and invitations under SECURITY
-- DEFINER, so the org admin policies are not the authorization here -- the
-- email match plus the org lock are.
GRANT EXECUTE ON FUNCTION public.odesseus_accept_employer_invitation(text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Documented role/seat relationship
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.employer_members.role IS
  'Employer team role. ''recruiter'' is seat-metered (see public.odesseus_metered_org_roles): one paid seat per active recruiter. ''owner'', ''admin'', and ''viewer'' are account-management roles and consume no seat.';
