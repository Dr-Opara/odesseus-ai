import { notFound } from "next/navigation";
import Link from "next/link";
import { resolveQaMobilePath } from "@/lib/mobile/screen-map";

export const metadata = {
  title: "Odesseus QA — Mobile Preview",
};

export default async function QaMobilePreview({
  params,
}: {
  params: Promise<{ segments?: string[] }>;
}) {
  const { segments } = await params;
  const pathname = `/qa/mobile${segments?.length ? "/" + segments.join("/") : ""}`;
  const resolution = resolveQaMobilePath(pathname);
  if (!resolution) notFound();

  const { screen, realPath } = resolution;

  // Real routes render Figma Mobile v1 only under the mobile CSS breakpoint.
  // An <iframe> has its own independent viewport for media-query purposes,
  // so pointing it at the real route (at a ~390px frame width) reuses the
  // exact production rendering path — same component, same auth check, same
  // data fetching — with no separate mobile implementation to maintain.
  // Screens tied to a specific record (Match Results, Resume Review) have no
  // context-free real path; those fall back to the dedicated per-screen demo
  // preview at /mobile/{index}.
  const framePath = realPath ?? `/mobile/${screen.index}`;
  const sourceLabel = realPath ?? `Screen ${screen.index} — ${screen.name}`;

  return (
    <div className="qa-mobile-page">
      <div className="qa-mobile-bar">
        <span className="qa-mobile-bar-label">Mobile Preview · {sourceLabel}</span>
        {realPath ? (
          <Link className="qa-mobile-bar-link" href={realPath}>
            Open desktop version →
          </Link>
        ) : null}
      </div>
      <div className="qa-mobile-frame">
        <iframe
          className="qa-mobile-frame-iframe"
          src={framePath}
          title={`Mobile preview: ${sourceLabel}`}
        />
      </div>
    </div>
  );
}
