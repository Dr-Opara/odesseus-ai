import EmployerStatePanel from "@/components/employers/state-panel";

/** F13-P loading state for the whole authenticated employer route tree — shown automatically by Next.js while a server component page is fetching data. */
export default function EmployersLoading() {
  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <EmployerStatePanel kind="loading" />
        </section>
      </div>
    </main>
  );
}
