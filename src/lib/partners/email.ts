type PartnerEmailInput = {
  to: string;
  subject: string;
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaHref?: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendPartnerEmail(input: PartnerEmailInput) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.ODESSEUS_PARTNER_FROM_EMAIL?.trim();

  if (!apiKey || !from) {
    return { sent: false as const, reason: "not_configured" as const };
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
      console.error("[ODESSEUS_PARTNERS] email provider returned", response.status);
      return { sent: false as const, reason: "provider_error" as const };
    }

    return { sent: true as const };
  } catch (error) {
    console.error("[ODESSEUS_PARTNERS] email delivery failed", error);
    return { sent: false as const, reason: "network_error" as const };
  }
}
