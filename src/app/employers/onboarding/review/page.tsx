import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import OnboardingReviewForm from "@/components/employers/onboarding-review-form";
import { EMPLOYER_PLANS } from "@/lib/pricing/candidate-pricing";

/** Employer Onboarding — Review (Figma screen 72). Step 3 of 3. */
export default async function EmployerOnboardingReviewPage({
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
  // The AI Starter Bundle is the only plan for sale.
  const plan = EMPLOYER_PLANS[0];

  return (
    <main className="figma-site figma-soft-page employer-portal">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(900px,100%)", margin: "54px auto 90px" }}>
          <span className="figma-eyebrow">STEP 3 OF 3</span>
          <h1>Ready to start hiring.</h1>

          <div className="figma-info-card white" style={{ padding: 32, marginTop: 24 }}>
            <div className="emp-review-row">
              <span>Company</span>
              <span>{carried.companyName || "—"}</span>
            </div>
            <div className="emp-review-row">
              <span>Plan</span>
              <span>
                {plan.name} · {plan.priceLabel} USD {plan.unit}
              </span>
            </div>
            <div className="emp-review-row">
              <span>Job-post credits</span>
              <span>{plan.activeJobLimit} every 30 days · additional posts $10 each</span>
            </div>
            <div className="emp-review-row">
              <span>Recruiter seats</span>
              <span>1 seat included · more at $20/month each</span>
            </div>

            <OnboardingReviewForm
              companyName={carried.companyName || "Your company"}
              planId={plan.name}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
