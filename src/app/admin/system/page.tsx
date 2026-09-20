import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/partners/service";
import AdminSystemReadiness from "@/components/admin-system-readiness";

export const metadata = { title: "System Readiness — Odysseus Admin" };

const definitions = [
  ["NEXT_PUBLIC_SUPABASE_URL", "Supabase URL", "Core"],
  ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "Supabase publishable key", "Core"],
  ["SUPABASE_SERVICE_ROLE_KEY", "Supabase service role", "Core"],
  ["NEXT_PUBLIC_SITE_URL", "Canonical site URL", "Core"],
  ["OPENAI_API_KEY", "OpenAI API key", "AI"],
  ["ODYSSEUS_MATCH_MODEL", "Match model", "AI"],
  ["ODYSSEUS_LIVE_GUIDANCE_MODEL", "Live guidance model", "AI"],
  ["ODYSSEUS_POST_INTERVIEW_MODEL", "Post-interview model", "AI"],
  ["STRIPE_SECRET_KEY", "Stripe secret key", "Billing"],
  ["STRIPE_WEBHOOK_SECRET", "Stripe webhook secret", "Billing"],
  ["BROWSERBASE_API_KEY", "Browserbase API key", "Apply"],
  ["BROWSERBASE_PROJECT_ID", "Browserbase project ID", "Apply"],
  ["ODYSSEUS_JOB_SOURCES_JSON", "Job-source catalog", "Discovery"],
  ["CRON_SECRET", "Cron secret", "Discovery"],
  ["ODYSSEUS_CONNECT_GOOGLE_CONNECTOR", "Google connector", "Integrations"],
  ["ODYSSEUS_CONNECT_MICROSOFT_CONNECTOR", "Microsoft connector", "Integrations"],
  ["ODYSSEUS_CONNECT_YAHOO_CONNECTOR", "Yahoo connector", "Integrations"],
  ["ODYSSEUS_CONNECT_GOOGLE_SEND_CONNECTOR", "Google send connector", "Integrations"],
  ["ODYSSEUS_CONNECT_MICROSOFT_SEND_CONNECTOR", "Microsoft send connector", "Integrations"],
  ["ODYSSEUS_ADMIN_EMAILS", "Admin email allowlist", "Operations"],
  ["RESEND_API_KEY", "Resend API key", "Operations"],
  ["ODYSSEUS_PARTNER_FROM_EMAIL", "Partner sender address", "Operations"],
] as const;

export default async function AdminSystemPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");
  if (!(await isAdmin(userId))) redirect("/dashboard");

  const config = definitions.map(([key, label, group]) => ({
    key,
    label,
    group,
    configured: Boolean(process.env[key]?.trim()),
  }));

  const configured = config.filter((item) => item.configured).length;

  return (
    <main className="shell admin-system-shell">
      <div className="admin-system-heading">
        <div>
          <div className="badge">Admin · System Readiness</div>
          <h1>Know what is actually connected.</h1>
          <p className="muted">
            Configuration values stay hidden. Run controlled provider checks before launch or after infrastructure changes.
          </p>
        </div>
        <div className="admin-system-links">
          <Link className="btn btn-secondary" href="/admin/partners">Partner Admin</Link>
          <Link className="btn btn-secondary" href="/dashboard">Back to Odysseus</Link>
        </div>
      </div>

      <div className="card admin-system-summary">
        <div><strong>{configured}</strong><span className="muted">Configured</span></div>
        <div><strong>{config.length - configured}</strong><span className="muted">Missing</span></div>
        <div><strong>{config.length}</strong><span className="muted">Tracked variables</span></div>
      </div>

      <AdminSystemReadiness config={config} />
    </main>
  );
}
