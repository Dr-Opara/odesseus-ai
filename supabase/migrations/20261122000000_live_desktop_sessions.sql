-- Odesseus Live Windows launch + bearer-session bridge.
--
-- Browser credentials never leave the web app. The authenticated web app
-- creates a short-lived opaque launch ticket. Electron exchanges that ticket
-- once for a separate opaque bearer token. Only SHA-256 hashes are stored.
--
-- This table is service-role only. RLS is enabled as defense in depth and
-- browser roles have no table privileges.

create table if not exists public.live_desktop_sessions (
  id uuid primary key default gen_random_uuid(),
  live_session_id uuid not null references public.live_interview_sessions(id) on delete cascade,
  interview_id uuid not null references public.interviews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  launch_token_hash text not null unique,
  launch_expires_at timestamptz not null,
  launch_used_at timestamptz,

  access_token_hash text unique,
  access_expires_at timestamptz,

  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint live_desktop_sessions_launch_hash_not_blank
    check (length(trim(launch_token_hash)) >= 32),
  constraint live_desktop_sessions_access_pair
    check (
      (access_token_hash is null and access_expires_at is null)
      or
      (access_token_hash is not null and access_expires_at is not null)
    )
);

alter table public.live_desktop_sessions enable row level security;

revoke all on table public.live_desktop_sessions from public;
revoke all on table public.live_desktop_sessions from anon;
revoke all on table public.live_desktop_sessions from authenticated;
grant select, insert, update, delete on table public.live_desktop_sessions to service_role;

create index if not exists live_desktop_sessions_live_session_idx
  on public.live_desktop_sessions (live_session_id, created_at desc);

create index if not exists live_desktop_sessions_user_idx
  on public.live_desktop_sessions (user_id, created_at desc);

create index if not exists live_desktop_sessions_access_lookup_idx
  on public.live_desktop_sessions (access_token_hash)
  where access_token_hash is not null and revoked_at is null;
