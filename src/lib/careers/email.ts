type CareerEmailInput = { to: string; subject: string; heading: string; body: string; };

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

async function send(input: CareerEmailInput) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = (process.env.ODESSEUS_CAREERS_FROM_EMAIL || process.env.ODESSEUS_PARTNER_FROM_EMAIL)?.trim();
  if (!apiKey || !from) return { sent: false as const, reason: "not_configured" as const };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from, to: [input.to], subject: input.subject,
      html: `<div style="font-family:Inter,Arial,sans-serif;max-width:620px;margin:0 auto;padding:28px;color:#0f172a"><div style="font-weight:800;letter-spacing:.08em;font-size:13px;margin-bottom:32px">ODESSEUS</div><h1 style="font-size:30px;line-height:1.15;margin:0 0 16px">${escapeHtml(input.heading)}</h1><p style="font-size:16px;line-height:1.65;color:#475569;white-space:pre-line">${escapeHtml(input.body)}</p><p style="margin-top:36px;color:#94a3b8;font-size:12px">Odesseus · Careers</p></div>`
    }), cache: "no-store",
  });
  return response.ok ? { sent: true as const } : { sent: false as const, reason: "provider_error" as const };
}

export async function sendCareerReceipt(to: string, roleTitle: string) {
  return send({ to, subject: `Application received — ${roleTitle}`, heading: "We received your application.", body: `Thanks for your interest in joining Odesseus. Your application for ${roleTitle} is now in our hiring queue. We review every application independently. Purchasing Odesseus Live is optional and has no effect on hiring consideration.` });
}

export async function sendCareerAdminNotice(applicant: string, roleTitle: string) {
  const inbox = process.env.ODESSEUS_CAREERS_INBOX?.trim();
  if (!inbox) return { sent: false as const, reason: "not_configured" as const };
  return send({ to: inbox, subject: `New Odesseus career application — ${roleTitle}`, heading: "New career application.", body: `${applicant} applied for ${roleTitle}. Open the Odesseus Careers admin dashboard to review the application and resume.` });
}
