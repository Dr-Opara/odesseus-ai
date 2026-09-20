import { createServiceClient } from "@/lib/supabase/service";
import { getProviderToken } from "./oauth";
import {
  syncGoogleCalendar,
  syncGoogleEmail,
} from "./google-sync";
import { syncImapEmailAccount } from "./imap-sync";
import type {
  IntegrationProvider,
  IntegrationService,
} from "./providers";
import type { TrackedApplication } from "./google-detection";

export type IntegrationAccount = {
  id: string;
  user_id: string;
  service_type: IntegrationService;
  provider: IntegrationProvider;
  account_email: string | null;
  auth_method: "oauth" | "imap_secret";
  connector_id: string | null;
  vault_secret_id: string | null;
  imap_host: string | null;
  imap_port: number | null;
  status: string;
};

async function trackedApplications(userId: string) {
  const service = createServiceClient();
  const { data } = await service
    .from("applications")
    .select("id,company_name,role_title,status")
    .eq("user_id", userId)
    .in("status", [
      "applied",
      "employer_response",
      "assessment",
      "interview",
      "offer",
    ]);

  return (data || []) as TrackedApplication[];
}

export async function syncIntegrationAccount(
  account: IntegrationAccount
) {
  const service = createServiceClient();
  const applications = await trackedApplications(account.user_id);

  try {
    let count = 0;

    if (account.provider === "google") {
      const token = await getProviderToken(
        account.user_id,
        "google",
        account.service_type
      );

      count =
        account.service_type === "email"
          ? await syncGoogleEmail(
              account.user_id,
              token,
              applications,
              account.id
            )
          : await syncGoogleCalendar(
              account.user_id,
              token,
              applications,
              account.id
            );
    } else if (
      account.service_type === "email" &&
      ["yahoo", "icloud", "imap"].includes(account.provider)
    ) {
      count = await syncImapEmailAccount(
        account as IntegrationAccount & {
          provider: "yahoo" | "icloud" | "imap";
        },
        applications
      );
    } else {
      throw new Error("Unsupported integration account.");
    }

    await service
      .from("integration_accounts")
      .update({
        status: "connected",
        last_sync_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id);

    return count;
  } catch (error) {
    await service
      .from("integration_accounts")
      .update({
        status: "error",
        last_error:
          error instanceof Error ? error.message : "Sync failed.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id);

    throw error;
  }
}

export async function syncAllAccountsForUser(userId: string) {
  const service = createServiceClient();
  const { data: accounts } = await service
    .from("integration_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "connected");

  let synced = 0;
  let failed = 0;

  for (const account of (accounts || []) as IntegrationAccount[]) {
    try {
      await syncIntegrationAccount(account);
      synced += 1;
    } catch {
      failed += 1;
    }
  }

  return { synced, failed };
}
