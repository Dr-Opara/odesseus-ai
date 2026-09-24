import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import FaqAccordion from "@/components/faq-accordion";

/** Public FAQ. "Live" is intentionally not mentioned — see Odesseus Live privacy policy. */
export const FAQ_ITEMS = [
  ["How does job matching work?", "Odesseus compares your verified resume against a job description and scores fit before you apply."],
  ["Does Odesseus apply without my approval?", "No. You review and approve the tailored resume and application details before anything is submitted."],
  ["How does resume optimization work?", "Odesseus edits the resume you already have for a specific role — it never invents a resume from scratch."],
  ["What does an application cost?", "$0.99 per verified successful submission. Interview preparation is free."],
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
