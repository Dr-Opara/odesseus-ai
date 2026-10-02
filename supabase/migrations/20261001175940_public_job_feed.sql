-- Historical production migration marker.
--
-- Version 20261001175940 was applied directly to the hosted project before the
-- current migration chain was consolidated. The hosted table it created is
-- already present in production.
--
-- Fresh databases intentionally do not recreate that historical copy here.
-- The canonical, idempotent public job feed schema is defined by
-- 20261118000000_public_job_feed.sql (CREATE TABLE/INDEX IF NOT EXISTS), which
-- also converges safely with the already-existing hosted table.
--
-- This no-op marker exists only to keep local and hosted migration histories
-- aligned.

select 1;
