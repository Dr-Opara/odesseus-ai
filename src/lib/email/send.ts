/**
 * The single outbound email transport.
 *
 * Extracted from the Partner Program sender so a second caller (employer team
 * invitations) reuses one implementation instead of a second copy of the Resend
 * request. `sendPartnerEmail` is now a thin wrapper over this and behaves
 * exactly as before, including its log prefix.
 *
 * Everything here is server-only. `RESEND_API_KEY` must never reach the browser,
 * and the module is only ever imported from route handlers and server actions.
 */

export type EmailInput = {
  to: string;
  subject: string;
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaHref?: string;
};

export type EmailResult =
  | { sent: true }
  | {
      sent: false;
      /**
       * `not_configured` means no key or no from address, which is a
       * deployment state rather than a failure. The callers distinguish it
       * from `provider_error`/`network_error` because an unconfigured transport
       * is not something a retry can fix.
       */
      reason: "not_configured" | "provider_error" | "network_error";
    };

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendEmail(
  input: EmailInput,
  logPrefix = "[ODESSEUS_EMAIL]"
): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.ODESSEUS_PARTNER_FROM_EMAIL?.trim();

  if (!apiKey || !from) {
    return { sent: false, reason: "not_configured" };
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://odesseus.ai").replace(/\/$/, "");
  const ctaHref = input.ctaHref
    ? input.ctaHref.startsWith("http")
      ? input.ctaHref
      : siteUrl + input.ctaHref
    : null;

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:620px;margin:0 auto;padding:28px;color:#0f172a">
      <div style="font-weight:800;letter-spacing:.08em;font-size:13px;margin-bottom:32px">ODESSEUS</div>
      <h1 style="font-size:30px;line-height:1.15;margin:0 0 16px">${escapeHtml(input.heading)}</h1>
      <p style="font-size:16px;line-height:1.65;color:#475569;white-space:pre-line">${escapeHtml(input.body)}</p>
      ${ctaHref && input.ctaLabel ? `
        <p style="margin-top:28px">
          <a href="${escapeHtml(ctaHref)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">
            ${escapeHtml(input.ctaLabel)}
          </a>
        </p>
      ` : ""}
      <p style="margin-top:36px;color:#94a3b8;font-size:12px">Odesseus · Your next move, handled.</p>
    </div>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(`${logPrefix} email provider returned`, response.status);
      return { sent: false, reason: "provider_error" };
    }

    return { sent: true };
  } catch (error) {
    console.error(`${logPrefix} email delivery failed`, error);
    return { sent: false, reason: "network_error" };
  }
}
