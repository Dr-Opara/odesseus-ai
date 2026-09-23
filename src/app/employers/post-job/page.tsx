import { redirect } from "next/navigation";
import EmployerNav from "@/components/employer-nav";
import { createClient } from "@/lib/supabase/server";

export default async function EmployerPostJobPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    redirect("/employers/signup?next=/employers/post-job");
  }

  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/signup?error=Create%20an%20employer%20account%20with%20your%20company%20email%20to%20post%20a%20job.");
  }

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerNav />
        <section style={{ width: "min(860px,100%)", margin: "54px auto 90px" }}>
          <span className="figma-eyebrow">FOR EMPLOYERS</span>
          <h1>Post a Job</h1>
          <p className="muted">Publish a role and let Odesseus surface qualified candidates.</p>

          <form className="figma-info-card white" style={{ padding: 32, marginTop: 28 }}>
            <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>Job title<input className="input" placeholder="e.g. GenAI Security Engineer" /></label>
            <div className="figma-two-grid" style={{ marginTop: 18 }}>
              <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>City<input className="input" placeholder="e.g. Lagos" /></label>
              <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>Country<select className="input" defaultValue="Nigeria"><option>Nigeria</option><option>United States</option><option>Canada</option><option>United Kingdom</option></select></label>
            </div>
            <div className="figma-two-grid" style={{ marginTop: 18 }}>
              <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>Work arrangement<select className="input"><option>Remote</option><option>Hybrid</option><option>On-site</option></select></label>
              <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>Employment type<select className="input"><option>Full-time</option><option>Contract</option><option>Part-time</option></select></label>
            </div>
            <div className="figma-three-grid" style={{ marginTop: 18 }}>
              <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>Currency<select className="input"><option>USD ($)</option><option>NGN (₦)</option><option>GBP (£)</option><option>CAD ($)</option></select></label>
              <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>Min salary<input className="input" type="number" /></label>
              <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>Max salary<input className="input" type="number" /></label>
            </div>
            <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>Job description<textarea className="input" rows={9} placeholder="Describe the role, responsibilities and requirements…" /></label>
            <label style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center" }}><input type="checkbox" /> Auto-renew this job for another 30 days when it expires.</label>
            <div className="figma-info-card peach" style={{ marginTop: 20 }}><strong>Publishing this job uses 1 credit.</strong><p>Your listing will be live for 30 days from the moment it publishes.</p></div>
            <button className="figma-btn figma-btn-orange" type="button" style={{ width: "100%", marginTop: 22 }}>Publish Job — Uses 1 Credit</button>
          </form>
        </section>
      </div>
    </main>
  );
}
