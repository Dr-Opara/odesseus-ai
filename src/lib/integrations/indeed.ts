import { getToken } from "@vercel/connect";

// Server-only: this token must never be sent to the browser. Callers should
// only invoke this from server components, route handlers, or server actions.
export async function getIndeedAppToken() {
  const connector = process.env.ODESSEUS_CONNECT_INDEED_CONNECTOR;
  if (!connector) {
    throw new Error("Indeed connector is not configured.");
  }

  return getToken(connector, {
    subject: { type: "app" },
  });
}
