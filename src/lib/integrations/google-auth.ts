import { getToken, revokeToken, startAuthorization } from "@vercel/connect";

export const GOOGLE_CONNECTOR =
  process.env.ODESSEUS_CONNECT_GOOGLE_CONNECTOR ||
  process.env.VERCEL_CONNECT_GOOGLE_CONNECTOR ||
  "google/odesseus-ai";

export const GOOGLE_READ_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];

function tokenParams(userId: string) {
  return {
    subject: { type: "user" as const, id: userId },
    scopes: GOOGLE_READ_SCOPES,
  };
}

export async function getGoogleAccessToken(userId: string) {
  return getToken(GOOGLE_CONNECTOR, tokenParams(userId));
}

export async function startGoogleAuthorization(
  userId: string,
  callbackUrl: string
) {
  return startAuthorization(
    GOOGLE_CONNECTOR,
    tokenParams(userId),
    {
      callbackUrl,
      prompt: "consent",
    }
  );
}

export async function revokeGoogleAccess(userId: string) {
  await revokeToken(GOOGLE_CONNECTOR, {
    subject: { type: "user", id: userId },
  });
}
