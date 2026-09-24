create table if not exists public.career_roles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title text not null,
  status text not null default 'open' check (status in ('draft','open','closed')),
  employment_type text not null default 'part_time',
  work_arrangement text not null default 'remote',
  location text not null default 'Worldwide',
  weekly_hours integer not null default 20 check (weekly_hours > 0 and weekly_hours <= 40),
  application_limit integer not null default 100 check (application_limit > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.career_roles enable row level security;
revoke all on table public.career_roles from anon, authenticated;
grant all on table public.career_roles to postgres, service_role;

create table if not exists public.career_applications (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.career_roles(id) on delete restrict,
  full_name text not null,
  email text not null,
  country text not null,
  time_zone text,
  linkedin_url text,
  portfolio_url text,
  github_url text,
  years_experience integer check (years_experience is null or years_experience >= 0),
  weekly_availability text not null,
  compensation_expectation text,
  why_odesseus text not null,
  screening_answers jsonb not null default '{}'::jsonb,
  resume_path text not null,
  status text not null default 'submitted' check (status in ('submitted','reviewing','shortlisted','interview','offer','hired','rejected','withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role_id, email)
);
alter table public.career_applications enable row level security;
revoke all on table public.career_applications from anon, authenticated;
grant all on table public.career_applications to postgres, service_role;
create index if not exists career_applications_role_created_idx on public.career_applications(role_id, created_at desc);
create index if not exists career_applications_status_idx on public.career_applications(status);

create or replace function odesseus_private.enforce_career_application_limit()
returns trigger language plpgsql
set search_path to 'public','odesseus_private','pg_temp'
as $$
declare v_status text; v_limit integer; v_count integer;
begin
  select status, application_limit into v_status, v_limit from public.career_roles where id = new.role_id for update;
  if not found then raise exception 'career role not found'; end if;
  if v_status <> 'open' then raise exception 'career role is not accepting applications'; end if;
  select count(*) into v_count from public.career_applications where role_id = new.role_id and status <> 'withdrawn';
  if v_count >= v_limit then raise exception 'career role application limit reached'; end if;
  return new;
end; $$;
drop trigger if exists career_application_limit_guard on public.career_applications;
create trigger career_application_limit_guard before insert on public.career_applications for each row execute function odesseus_private.enforce_career_application_limit();

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('career-resumes','career-resumes',false,5242880,array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types,updated_at=now();

insert into public.career_roles (slug,title,status,employment_type,work_arrangement,location,weekly_hours,application_limit) values
('founding-full-stack-product-engineer','Founding Senior Full-Stack / Product Engineer','open','part_time','remote','Worldwide',20,100),
('founding-applied-ai-engineer','Founding Applied AI Engineer','open','part_time','remote','Worldwide',20,100),
('founding-platform-devops-security-engineer','Founding Platform / DevOps & Security Engineer','open','part_time','remote','Worldwide',20,100),
('founding-growth-product-marketing-lead','Founding Growth & Product Marketing Lead','open','part_time','remote','Worldwide',20,100),
('founding-customer-success-employer-operations','Founding Customer Success & Employer Operations Lead','open','part_time','remote','Worldwide',20,100)
on conflict (slug) do update set title=excluded.title,status=excluded.status,employment_type=excluded.employment_type,work_arrangement=excluded.work_arrangement,location=excluded.location,weekly_hours=excluded.weekly_hours,application_limit=excluded.application_limit,updated_at=now();
