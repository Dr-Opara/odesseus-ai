export default function HomepageHeroProductVisual() {
  return (
    <div className="oh-hero-product" aria-label="Odesseus product preview">
      <div className="oh-hero-product-glow" aria-hidden="true" />
      <div className="oh-hero-product-shell">
        <aside className="oh-hero-product-sidebar" aria-hidden="true">
          <span className="oh-mini-brand">O.</span>
          <span>⌂</span>
          <span>▣</span>
          <span>◫</span>
          <span>◎</span>
        </aside>

        <div className="oh-hero-product-main">
          <div className="oh-hero-search">⌕&nbsp;&nbsp; Find your next opportunity...</div>

          <div className="oh-hero-job-preview">
            <div className="oh-hero-job-top">
              <div className="oh-hero-job-logo">A</div>
              <div>
                <strong>Senior Security Engineer</strong>
                <span>Amazon</span>
                <small>Austin, TX · Remote</small>
              </div>
              <b>92% Match</b>
            </div>
            <div className="oh-hero-job-salary">$145K – $178K</div>
            <div className="oh-hero-job-tags">
              <span>Full-time</span>
              <span>Remote</span>
            </div>
            <div className="oh-hero-job-actions">
              <span className="is-primary">Apply with Odesseus</span>
              <span>View Details</span>
            </div>
          </div>
        </div>

        <div className="oh-hero-status-stack" aria-hidden="true">
          <div><span>▣</span><strong>Resume Optimized</strong></div>
          <div><span>✓</span><strong>Application Submitted</strong></div>
          <div><span>♥</span><strong>Interview Prep Ready</strong></div>
        </div>

        <div className="oh-hero-live-pill" aria-hidden="true">
          <span className="oh-live-mark">O</span>
          <div>
            <strong>Odesseus Live</strong>
            <small>Get interview support<br />and earn while you search.</small>
          </div>
          <b>›</b>
        </div>
      </div>
    </div>
  );
}
