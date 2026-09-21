-- Removes Microsoft as a supported integration provider. Microsoft Connect
-- is not available to the product right now; Google, Yahoo, iCloud, and
-- custom IMAP remain the supported email/calendar providers.
--
-- integration_accounts rows represent a reusable connection slot (it can be
-- reconnected), not an audit log, so existing 'microsoft' rows are removed
-- outright — they can no longer function without a connector configured and
-- would otherwise linger as dead, unreconnectable entries.
--
-- follow_up_drafts.send_provider is a historical record of how a follow-up
-- was actually sent in the past. Any existing 'microsoft' rows there are a
-- true audit trail and must not be deleted or rewritten. The new CHECK
-- constraint is added NOT VALID so it applies to future inserts/updates
-- without validating (or breaking) historical rows.

DELETE FROM public.integration_accounts
WHERE provider = 'microsoft';

ALTER TABLE public.integration_accounts
  DROP CONSTRAINT integration_accounts_provider_check;

ALTER TABLE public.integration_accounts
  ADD CONSTRAINT integration_accounts_provider_check
  CHECK (provider = ANY (ARRAY['google'::text, 'yahoo'::text, 'icloud'::text, 'imap'::text]));

ALTER TABLE public.follow_up_drafts
  DROP CONSTRAINT follow_up_drafts_send_provider_check;

ALTER TABLE public.follow_up_drafts
  ADD CONSTRAINT follow_up_drafts_send_provider_check
  CHECK (send_provider IS NULL OR send_provider = ANY (ARRAY['google'::text, 'smtp'::text, 'mailto'::text]))
  NOT VALID;
