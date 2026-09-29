import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import OnboardingReviewForm from "@/components/employers/onboarding-review-form";
import { EMPLOYER_PLANS } from "@/lib/pricing/candidate-pricing";
import type { EmployerPlanId } from "@/lib/employers/types";

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
  const planId = (carried.planId as EmployerPlanId | undefined) ?? "Starter";
  const plan = EMPLOYER_PLANS.find((p) => p.name === planId) ?? EMPLOYER_PLANS[0];

  return (
    <main className="figma-site figma-soft-page">
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
                {plan.name} · {plan.priceLabel}
                {plan.unit}
              </span>
            </div>
            <div className="emp-review-row">
              <span>Active job limit</span>
              <span>{plan.activeJobLimit}</span>
            </div>
            <div className="emp-review-row">
              <span>Recruiter seats</span>
              <span>{plan.name === "Business" ? "Multiple seats + add-ons" : "1 seat + add-ons"}</span>
            </div>

            <OnboardingReviewForm
              companyDetails={{
                companyName: carried.companyName ?? "",
                companyWebsite: carried.companyWebsite,
                industry: carried.industry,
                companySize: carried.companySize,
                description: carried.description,
              }}
              planId={plan.name as EmployerPlanId}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
