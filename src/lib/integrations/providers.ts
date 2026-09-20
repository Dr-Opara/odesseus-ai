export type IntegrationService = "email" | "calendar";
export type IntegrationProvider =
  | "google"
  | "yahoo"
  | "icloud"
  | "imap";

export const integrationProviders: Record<
  IntegrationProvider,
  {
    label: string;
    services: IntegrationService[];
    authMethod: "oauth" | "imap_secret";
    emailConnectorEnv?: string;
    calendarConnectorEnv?: string;
  }
> = {
  google: {
    label: "Google",
    services: ["email", "calendar"],
    authMethod: "oauth",
    emailConnectorEnv: "ODYSSEUS_CONNECT_GOOGLE_CONNECTOR",
    calendarConnectorEnv: "ODYSSEUS_CONNECT_GOOGLE_CONNECTOR",
  },
  yahoo: {
    label: "Yahoo",
    services: ["email"],
    authMethod: "oauth",
    emailConnectorEnv: "ODYSSEUS_CONNECT_YAHOO_CONNECTOR",
  },
  icloud: {
    label: "iCloud Mail",
    services: ["email"],
    authMethod: "imap_secret",
  },
  imap: {
    label: "Other email",
    services: ["email"],
    authMethod: "imap_secret",
  },
};

export function connectorFor(
  provider: IntegrationProvider,
  service: IntegrationService
) {
  const definition = integrationProviders[provider];
  const env =
    service === "email"
      ? definition.emailConnectorEnv
      : definition.calendarConnectorEnv;

  if (!env) throw new Error("This provider does not use OAuth for that service.");

  const connector = process.env[env];
  if (!connector) {
    throw new Error(`${definition.label} connector is not configured.`);
  }

  return connector;
}

export function defaultImapSettings(provider: IntegrationProvider) {
  if (provider === "icloud") {
    return { host: "imap.mail.me.com", port: 993, secure: true };
  }

  if (provider === "yahoo") {
    return { host: "imap.mail.yahoo.com", port: 993, secure: true };
  }

  return null;
}
