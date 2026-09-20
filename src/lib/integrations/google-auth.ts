import { getToken, startAuthorization } from "@vercel/connect";

function connectorId() {
  const connector = process.env.ODESSEUS_CONNECT_GOOGLE_CONNECTOR;
  if (!connector) {
    throw new Error("Google connector is not configured.");
  }
  return connector;
}

export async function getGoogleAccessToken(userId: string) {
  return getToken(connectorId(), {
    subject: { type: "user", id: userId },
  });
}

export async function startGoogleAuthorization(userId: string, callbackUrl: string) {
  return startAuthorization(
    connectorId(),
    { subject: { type: "user", id: userId } },
    { callbackUrl }
  );
}
