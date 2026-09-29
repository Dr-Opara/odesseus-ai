import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import { EMPLOYER_PLANS } from "@/lib/pricing/candidate-pricing";

/** Employer Onboarding — Plan Selection (Figma screen 71). Step 2 of 3. */
export default async function EmployerOnboardingPlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const carried = await searchParams;

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(900px,100%)", margin: "54px auto 90px" }}>
          <span className="figma-eyebrow">STEP 2 OF 3</span>
          <h1>Choose your hiring plan.</h1>

          <form method="get" action="/employers/onboarding/review" className="figma-info-card white" style={{ padding: 32, marginTop: 24, display: "grid", gap: 14 }}>
            {Object.entries(carried).map(([key, value]) =>
              value ? <input key={key} type="hidden" name={key} value={value} /> : null
            )}

            {EMPLOYER_PLANS.map((plan, i) => (
              <label key={plan.name} className="emp-plan-option">
                <input type="radio" name="planId" value={plan.name} defaultChecked={i === 0} required />
                <span>
                  <strong>{plan.name}</strong>
                  <small>
                    {plan.priceLabel}
                    {plan.unit} · {plan.jobs}
                    {plan.name === "Growth" ? " + analytics" : plan.name === "Business" ? " + AI matching" : ""}
                  </small>
                </span>
              </label>
            ))}

            <button className="figma-btn figma-btn-orange" type="submit" style={{ width: "100%", marginTop: 6 }}>
              Continue
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
