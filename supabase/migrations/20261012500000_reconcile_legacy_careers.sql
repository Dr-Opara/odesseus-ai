-- Reconcile the superseded hosted careers prototype before Phase 14B.
--
-- Production historically applied 20260924042408_career_recruiting_mvp, which
-- created public.career_roles plus a different public.career_applications
-- shape. The release candidate uses career_job_openings and the Phase 14B
-- career_applications contract instead.
--
-- Preserve the historical prototype and its five seeded role rows rather than
-- deleting them. On databases where the prototype exists, move both tables to
-- a locked legacy schema. On fresh databases the historical migration marker is
-- a no-op, so this migration is also a no-op and Phase 14B can create the
-- canonical tables directly.

create schema if not exists odesseus_legacy;

revoke all on schema odesseus_legacy from public;
revoke all on schema odesseus_legacy from anon, authenticated;

do $reconcile$
begin
  if to_regclass('public.career_applications') is not null then
    if to_regclass('odesseus_legacy.career_applications') is not null then
      raise exception 'Both public and legacy career_applications exist; manual reconciliation required';
    end if;
    alter table public.career_applications set schema odesseus_legacy;
  end if;

  if to_regclass('public.career_roles') is not null then
    if to_regclass('odesseus_legacy.career_roles') is not null then
      raise exception 'Both public and legacy career_roles exist; manual reconciliation required';
    end if;
    alter table public.career_roles set schema odesseus_legacy;
  end if;
end
$reconcile$;

-- The prototype trigger remains attached to the archived applications table.
-- Browser roles have no schema privileges, so the archive is not an active
-- application path. The canonical careers pipeline created next is independent
-- of the archived prototype.

comment on schema odesseus_legacy is
  'Read-only archive for superseded pre-Phase-14B schema objects preserved during release migration reconciliation.';
