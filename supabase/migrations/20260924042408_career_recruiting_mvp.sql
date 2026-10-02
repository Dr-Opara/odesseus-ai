-- Historical production migration marker.
--
-- Version 20260924042408 was applied directly to the hosted project before the
-- current migration chain was consolidated. It created an early
-- career_roles/career_applications prototype that is not the schema used by the
-- release candidate.
--
-- Do not recreate that prototype on fresh databases. Existing hosted prototype
-- tables are preserved non-destructively by
-- 20261012500000_reconcile_legacy_careers.sql, after which the canonical
-- Phase 14B careers schema is created by 20261013000000_phase14b_growth_backend.sql.
--
-- Keeping this no-op marker in source control preserves migration-history
-- parity with the hosted project without reintroducing the superseded schema.

select 1;
