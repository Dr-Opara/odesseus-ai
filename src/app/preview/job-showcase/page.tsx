import JobDiscoveryShowcase from "@/components/job-discovery-showcase";

export const metadata = {
  robots: { index: false, follow: false },
};

export default function JobShowcasePreviewPage() {
  return (
    <main style={{ minHeight: "100vh", background: "var(--surface-subtle)", padding: "48px 0 100px" }}>
      <div className="shell">
        <p className="muted" style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 18 }}>
          Internal preview — not linked from the site
        </p>
        <JobDiscoveryShowcase />
      </div>
    </main>
  );
}
