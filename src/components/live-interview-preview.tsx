export default function LiveInterviewPreview() {
  return (
    <div className="live-preview card" aria-label="Odesseus Live interview preview">
      <div className="live-preview-topbar">
        <div>
          <span className="live-preview-kicker">Odesseus Live</span>
          <h3>Senior Compliance Analyst</h3>
          <p>Live interview · Round 2</p>
        </div>
        <div className="live-preview-status">
          <span className="live-preview-pulse" />
          Live
        </div>
      </div>

      <div className="live-preview-body">
        <div className="live-preview-transcript">
          <div className="live-preview-section-label">Interviewer</div>
          <p>
            Tell me about a time you had to influence a team to close a high-priority compliance gap.
          </p>
        </div>

        <div className="live-preview-guidance">
          <div className="live-preview-guidance-head">
            <span className="live-preview-section-label">Odesseus guidance</span>
            <span className="live-preview-context-chip">Grounded in your resume</span>
          </div>

          <div className="live-preview-answer-block">
            <strong>Lead with the outcome.</strong>
            <p>
              Use your DOJ compliance work: explain the gap, how you aligned the system owner and technical team,
              and how the remediation moved forward without losing delivery momentum.
            </p>
          </div>

          <div className="live-preview-coach-row">
            <span>STAR structure</span>
            <span>Keep it to ~60 sec</span>
            <span>Emphasize ownership</span>
          </div>
        </div>

        <div className="live-preview-context">
          <div>
            <span className="live-preview-section-label">Context loaded</span>
            <strong>Resume + job description + application</strong>
          </div>
          <span className="live-preview-ready">Ready</span>
        </div>
      </div>
    </div>
  );
}
