import { createServiceClient } from "@/lib/supabase/service";
import { fetchRecentImapMessages } from "./imap";
import { getProviderToken } from "./oauth";
import {
  matchApplication,
  type TrackedApplication,
} from "./google-detection";
import { extractEmailSignal } from "./google-extract";
import {
  updateApplicationFromSignal,
  upsertInterview,
} from "./google-sync";

type IntegrationAccount = {
  id: string;
  user_id: string;
  provider: "yahoo" | "icloud" | "imap";
  account_email: string | null;
  auth_method: "oauth" | "imap_secret";
  vault_secret_id: string | null;
  imap_host: string | null;
  imap_port: number | null;
};

async function getVaultSecret(secretId: string) {
  const service = createServiceClient();
  const { data, error } = await service.rpc(
    "odysseus_get_integration_secret",
    { p_secret_id: secretId }
  );

  if (error || !data) {
    throw new Error("Odysseus could not retrieve the mail credential.");
  }

  return String(data);
}

export async function syncImapEmailAccount(
  account: IntegrationAccount,
  applications: TrackedApplication[]
) {
  if (!account.account_email || !account.imap_host || !account.imap_port) {
    throw new Error("Email account settings are incomplete.");
  }

  const credential = {
    email: account.account_email,
    host: account.imap_host,
    port: account.imap_port,
  };

  let auth: { pass?: string; accessToken?: string };

  if (account.auth_method === "oauth") {
    if (account.provider !== "yahoo") {
      throw new Error("This IMAP OAuth provider is not supported.");
    }

    auth = {
      accessToken: await getProviderToken(
        account.user_id,
        "yahoo",
        "email"
      ),
    };
  } else {
    if (!account.vault_secret_id) {
      throw new Error("Email credential is missing.");
    }
    auth = {
      pass: await getVaultSecret(account.vault_secret_id),
    };
  }

  const messages = await fetchRecentImapMessages(
    { ...credential, ...auth },
    new Date(Date.now() - 45 * 86400000)
  );

  const service = createServiceClient();
  let processed = 0;

  for (const message of messages) {
    const externalId =
      `${account.provider}:${account.id}:${message.externalId}`;

    const { data: existing } = await service
      .from("external_signals")
      .select("id")
      .eq("user_id", account.user_id)
      .eq("source", "email")
      .eq("external_id", externalId)
      .maybeSingle();

    if (existing) continue;

    const combined =
      `${message.subject}\n${message.sender}\n${message.body}`;

    const application = matchApplication(combined, applications);
    if (!application) continue;

    const extracted = await extractEmailSignal({
      subject: message.subject,
      sender: message.sender,
      body: message.body,
      application,
    });

    if (
      extracted.confidence < 0.72 ||
      extracted.signalType === "unknown"
    ) {
      continue;
    }

    const { data: signal, error } = await service
      .from("external_signals")
      .insert({
        user_id: account.user_id,
        application_id: application.id,
        integration_account_id: account.id,
        source: "email",
        external_id: externalId,
        signal_type: extracted.signalType,
        title: message.subject,
        sender: message.sender,
        occurred_at: message.occurredAt,
        payload: {
          ...extracted,
          provider: account.provider,
        },
        processed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !signal) continue;

    await updateApplicationFromSignal({
      userId: account.user_id,
      application,
      signalId: signal.id,
      signalType: extracted.signalType,
      source: "email",
      detail: extracted.conciseSummary,
    });

    if (
      extracted.signalType === "interview_invite" ||
      extracted.signalType === "interview_update"
    ) {
      await upsertInterview({
        userId: account.user_id,
        applicationId: application.id,
        source: "email",
        externalId,
        signalId: signal.id,
        stage: extracted.stage,
        scheduledAt: extracted.scheduledAt,
        timezone: extracted.timezone,
        meetingProvider: extracted.meetingProvider,
        meetingUrl: extracted.meetingUrl,
        interviewerName: extracted.interviewerName,
        interviewerEmail: extracted.interviewerEmail,
      });
    }

    processed += 1;
  }

  return processed;
}
