import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import FaqAccordion from "@/components/faq-accordion";

/** Public FAQ. "Live" is intentionally not mentioned — see Odesseus Live privacy policy. */
export const FAQ_ITEMS = [
  ["How does job matching work?", "Odesseus compares your verified resume against a job description and scores fit before you apply."],
  ["Does Odesseus apply without my approval?", "No. You review and approve the tailored resume and application details before anything is submitted."],
  ["How does resume optimization work?", "Odesseus edits the resume you already have for a specific role — it never invents a resume from scratch."],
  ["What does an application cost?", "Standard Apply is $0.49 and Smart Apply is $1.99, both charged from your wallet only after a verified successful submission. Interview preparation is free."],
  ["What's the difference between Standard and Smart Apply?", "Standard Apply tailors your resume and submits the application. Smart Apply adds deeper role-specific tailoring and a closer pass on hard requirements before submission."],
  ["How does the wallet work?", "Add $10, $20, or $50 to your wallet, then Odesseus spends from it only when an application is successfully submitted. No more buying fixed credit packs upfront."],
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
