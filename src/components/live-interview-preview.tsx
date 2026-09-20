export default function LiveInterviewPreview({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <div className={`live-preview card${compact ? " live-preview-compact" : ""}`}>
      <div className="live-preview-topbar">
        <div className="live-preview-window-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="live-preview-session">
          <span className="live-preview-live-dot" />
          LIVE INTERVIEW
        </div>
        <div className="live-preview-timer">18:42</div>
      </div>

      <div className="live-preview-context">
        <div>
          <div className="live-preview-eyebrow">Senior Compliance Analyst</div>
          <strong>Federal Cloud & AI Governance</strong>
        </div>
        <div className="live-preview-platform">Microsoft Teams</div>
      </div>

      <div className="live-preview-transcript">
        <span className="live-preview-speaker">Interviewer</span>
        <p>
          Tell me about a time you had to move a system through an authorization
          process while balancing delivery pressure.
        </p>
      </div>

      <div className="live-preview-guidance">
        <div className="live-preview-guidance-head">
          <span>Odesseus Live</span>
          <span className="live-preview-private">Private guidance</span>
        </div>

        <div className="live-preview-answer-label">Suggested structure</div>
        <p className="live-preview-answer">
          <strong>Situation:</strong> A cloud service needed an ATO while the
          delivery team was working against a compressed release timeline.
        </p>
        <p className="live-preview-answer">
          <strong>Action:</strong> I aligned the control owners, prioritized
          evidence gaps, tracked POA&amp;M items, and kept leadership updated on
          risks and decisions.
        </p>

        <div className="live-preview-actions" aria-hidden="true">
          <span>STAR</span>
          <span>Shorter</span>
          <span>More Technical</span>
          <span>Follow-Up</span>
        </div>
      </div>

      <div className="live-preview-footer">
        <span>Grounded in your submitted resume + application</span>
        <span className="live-preview-listening">
          <span className="live-preview-live-dot" />
          Listening
        </span>
      </div>
    </div>
  );
}
