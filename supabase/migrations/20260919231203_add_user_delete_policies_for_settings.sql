-- The new Settings "disconnect integration" and "delete transcript" actions
-- (src/app/actions/account.ts) run as the requesting user, not the service
-- role. integration_accounts and live_transcript_items previously only
-- granted SELECT to authenticated -- every write/delete on them was
-- system-managed (OAuth callbacks, sync jobs) via the service client. Add
-- matching own-row DELETE policies + grants, following the same pattern
-- already used for resumes_delete_own.

CREATE POLICY "integration_accounts_delete_own" ON "public"."integration_accounts"
  FOR DELETE
  TO "authenticated"
  USING ((SELECT auth.uid()) = user_id);

GRANT DELETE ON TABLE "public"."integration_accounts" TO "authenticated";

CREATE POLICY "live_transcript_delete_own" ON "public"."live_transcript_items"
  FOR DELETE
  TO "authenticated"
  USING ((SELECT auth.uid()) = user_id);

GRANT DELETE ON TABLE "public"."live_transcript_items" TO "authenticated";
