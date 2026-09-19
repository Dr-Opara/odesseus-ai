-- billing_events previously had only a service_role policy, so an
-- authenticated user's own session (used by the Billing page to read
-- Odysseus Live Annual purchase history, since that SKU never writes a
-- credit_transactions row) could not SELECT their own rows — RLS would
-- silently return zero rows rather than error, making the purchase
-- invisible in "Recent activity" despite being real. Mirrors the existing
-- read-only credit_balances_select_own policy: users may read but never
-- write their own billing_events.

CREATE POLICY "billing_events_select_own" ON "public"."billing_events"
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

GRANT SELECT ON TABLE "public"."billing_events" TO "authenticated";
