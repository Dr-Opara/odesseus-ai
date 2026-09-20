import { getToken } from "@vercel/connect";

type SendInput = {
  userId: string;
  provider: "google";
  recipient: string;
  subject: string;
  body: string;
};

function base64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sendGoogle(input: SendInput) {
  const connector = process.env.ODYSSEUS_CONNECT_GOOGLE_SEND_CONNECTOR;
  if (!connector) {
    throw new Error("Google follow-up sending is not configured.");
  }

  const token = await getToken(connector, {
    subject: { type: "user", id: input.userId },
  });

  const raw = [
    `To: ${input.recipient}`,
    `Subject: ${input.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.body,
  ].join("\r\n");

  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: base64Url(raw) }),
    }
  );

  if (!response.ok) {
    throw new Error(`Google send failed: ${response.status}`);
  }
}

export async function sendFollowUp(input: SendInput) {
  await sendGoogle(input);
}
