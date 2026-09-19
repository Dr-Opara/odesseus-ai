-- Odysseus Partner Program v1
-- Public applications and partner operations are mediated by validated server routes/actions.
-- Browser roles receive no direct table grants; all exposed tables still have RLS enabled.

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin','marketing_admin','finance_admin')),
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;

create table public.partner_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  country text not null,
  city_state text,
  primary_niche text not null,
  audience_description text not null,
  motivation text not null,
  sample_links text[] not null default '{}',
  previous_brand_experience text,
  expected_rate text,
  preferred_partnerships text[] not null default '{}',
  status text not null default 'submitted'
    check (status in ('submitted','under_review','approved','waitlisted','rejected')),
  internal_notes text,
  proposed_commission_bps integer check (proposed_commission_bps is null or (proposed_commission_bps >= 0 and proposed_commission_bps <= 10000)),
  approved_partnership_type text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  terms_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.partner_applications enable row level security;
create index partner_applications_status_created_idx on public.partner_applications(status, created_at desc);
create index partner_applications_email_idx on public.partner_applications(lower(email));

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  application_id uuid unique references public.partner_applications(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  full_name text not null,
  status text not null default 'approved'
    check (status in ('approved','suspended','terminated')),
  partnership_type text not null default 'affiliate',
  referral_code text not null unique,
  commission_bps integer check (commission_bps is null or (commission_bps >= 0 and commission_bps <= 10000)),
  attribution_days integer not null default 30 check (attribution_days between 1 and 90),
  start_date date not null default current_date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.partners enable row level security;
create unique index partners_email_unique_lower on public.partners(lower(email));
create index partners_user_idx on public.partners(user_id);
create index partners_status_idx on public.partners(status);

create table public.partner_social_accounts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.partner_applications(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete cascade,
  platform text not null check (platform in ('instagram','facebook','tiktok')),
  handle text not null,
  profile_url text not null,
  follower_count integer not null default 0 check (follower_count >= 0),
  average_reach integer check (average_reach is null or average_reach >= 0),
  audience_country text,
  created_at timestamptz not null default now(),
  constraint partner_social_parent_check check (application_id is not null or partner_id is not null)
);
alter table public.partner_social_accounts enable row level security;
create index partner_social_application_idx on public.partner_social_accounts(application_id);
create index partner_social_partner_idx on public.partner_social_accounts(partner_id);
create unique index partner_social_partner_platform_unique
  on public.partner_social_accounts(partner_id, platform)
  where partner_id is not null;

create table public.partner_referrals (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  referral_code text not null,
  visitor_id uuid not null unique,
  landing_path text,
  signup_user_id uuid references auth.users(id) on delete set null,
  signup_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.partner_referrals enable row level security;
create index partner_referrals_partner_created_idx on public.partner_referrals(partner_id, created_at desc);
create index partner_referrals_signup_user_idx on public.partner_referrals(signup_user_id);

create table public.partner_conversions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  referral_id uuid references public.partner_referrals(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  billing_event_id uuid not null unique references public.billing_events(id) on delete restrict,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  commission_cents integer not null default 0 check (commission_cents >= 0),
  status text not null default 'qualified'
    check (status in ('pending','qualified','reversed')),
  qualified_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.partner_conversions enable row level security;
create index partner_conversions_partner_created_idx on public.partner_conversions(partner_id, created_at desc);
create index partner_conversions_user_idx on public.partner_conversions(user_id);

create table public.partner_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  brief text,
  platforms text[] not null default '{}',
  requirements text,
  reward_terms text,
  status text not null default 'draft' check (status in ('draft','active','paused','ended')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.partner_campaigns enable row level security;
create index partner_campaigns_status_idx on public.partner_campaigns(status, starts_at);

create table public.partner_campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.partner_campaigns(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete cascade,
  status text not null default 'assigned'
    check (status in ('assigned','accepted','declined','submitted','completed')),
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(campaign_id, partner_id)
);
alter table public.partner_campaign_members enable row level security;
create index partner_campaign_members_partner_idx on public.partner_campaign_members(partner_id, assigned_at desc);

create table public.partner_content (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  campaign_id uuid references public.partner_campaigns(id) on delete set null,
  platform text not null check (platform in ('instagram','facebook','tiktok')),
  content_url text not null,
  posted_at timestamptz,
  notes text,
  status text not null default 'submitted'
    check (status in ('submitted','approved','changes_requested','rejected')),
  admin_notes text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.partner_content enable row level security;
create index partner_content_partner_created_idx on public.partner_content(partner_id, created_at desc);
create index partner_content_status_idx on public.partner_content(status, created_at desc);

create table public.partner_earnings (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  conversion_id uuid references public.partner_conversions(id) on delete set null,
  campaign_id uuid references public.partner_campaigns(id) on delete set null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  status text not null default 'pending'
    check (status in ('pending','approved','reversed','paid')),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.partner_earnings enable row level security;
create unique index partner_earnings_conversion_unique on public.partner_earnings(conversion_id) where conversion_id is not null;
create index partner_earnings_partner_status_idx on public.partner_earnings(partner_id, status, created_at desc);

create table public.partner_payouts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  method text,
  reference text,
  notes text,
  paid_at timestamptz not null,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.partner_payouts enable row level security;
create index partner_payouts_partner_paid_idx on public.partner_payouts(partner_id, paid_at desc);

revoke all on table
  public.admin_users,
  public.partner_applications,
  public.partners,
  public.partner_social_accounts,
  public.partner_referrals,
  public.partner_conversions,
  public.partner_campaigns,
  public.partner_campaign_members,
  public.partner_content,
  public.partner_earnings,
  public.partner_payouts
from anon, authenticated;

grant all on table
  public.admin_users,
  public.partner_applications,
  public.partners,
  public.partner_social_accounts,
  public.partner_referrals,
  public.partner_conversions,
  public.partner_campaigns,
  public.partner_campaign_members,
  public.partner_content,
  public.partner_earnings,
  public.partner_payouts
to postgres, service_role;
