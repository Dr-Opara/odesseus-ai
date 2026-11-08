import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import FaqAccordion from "@/components/faq-accordion";
import { APPLY_TIERS } from "@/lib/pricing/candidate-pricing";

/** Public FAQ. "Live" is intentionally not mentioned — see Odesseus Live privacy policy. */
export const FAQ_ITEMS = [
  ["How does job matching work?", "Odesseus compares your verified resume against a job description and scores fit before you apply."],
  ["Does Odesseus apply without my approval?", "No. You review and approve the tailored resume and application details before anything is submitted."],
  ["How does resume optimization work?", "Odesseus edits the resume you already have for a specific role — it never invents a resume from scratch."],
  ["What does an application cost?", `One application credit — ${APPLY_TIERS.standard.priceLabel} — per verified successful submission, for ${APPLY_TIERS.standard.label} or ${APPLY_TIERS.smart.label}. Packs bring it lower: 25 for $20, 50 for $35, 100 for $59 (USD). Failed or unconfirmed applications use nothing. Interview preparation is free.`],
  ["What's the difference between Apply and Smart Apply?", `${APPLY_TIERS.standard.label} tailors your resume and submits the application. ${APPLY_TIERS.smart.label} adds deeper automation for multi-page applications. Both cost the same and both need your approval before submission.`],
  ["How do application credits work?", "One application credit pays for one successfully submitted application. Buy them one at a time ($0.99 USD) or in packs of 25 ($20), 50 ($35) or 100 ($59). Credits don't expire, and failed, unsupported, cancelled, closed-role or unconfirmed applications never use one."],
  ["Is interview preparation free?", "Yes. Role-specific questions, STAR stories and technical prep are included at no cost."],
  ["How do I manage my documents?", "Upload, replace, or remove resumes from Documents in your account settings."],
] as const;

export default function FaqPage() {
  return (
    <>
      <main className="figma-site figma-soft-page odesseus-desktop-only">
        <div className="figma-page-wrap">
          <MarketingNav />
          <section className="figma-page-hero">
            <span className="figma-eyebrow">FAQ</span>
            <h1>Quick answers about Odesseus.ai.</h1>
          </section>
          <FaqAccordion items={FAQ_ITEMS} variant="desktop" />
        </div>
        <MarketingFooter />
      </main>

      <FaqAccordion items={FAQ_ITEMS} variant="mobile" />
    </>
  );
}
