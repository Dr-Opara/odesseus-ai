export default function LiveInterviewPreview() {
  return (
    <div className="live-video-preview card" aria-label="Odesseus Live video interview preview">
      <div className="live-video-stage">
        <div className="live-video-feed" role="img" aria-label="Candidate in a live video interview">
          <div className="live-video-topbar">
            <span className="live-video-live"><span /> Live Preview</span>
            <span className="live-video-timer">00:12</span>
          </div>

          <div className="live-video-person" aria-hidden="true">
            <div className="live-video-person-head" />
            <div className="live-video-person-body" />
          </div>

          <div className="live-video-interviewer">
            <div className="live-video-interviewer-avatar">I</div>
            <span>Interviewer</span>
          </div>

          <div className="live-video-name">
            <span>You</span>
            <span className="live-video-audio">▮▮▮</span>
          </div>

          <div className="live-video-controls" aria-hidden="true">
            <span>●</span>
            <span>▣</span>
            <span>⌁</span>
            <span>•••</span>
            <span className="live-video-end">⌕</span>
          </div>
        </div>

        <aside className="live-video-assistant">
          <div className="live-video-tabs">
            <strong>AI Assistant</strong>
            <span>Job Details</span>
            <span>My Resume</span>
          </div>

          <div className="live-video-suggestion">
            <div className="live-video-suggestion-label">Real-time suggestion</div>
            <p>
              Lead with the outcome, then explain how you aligned the system owner and technical team
              to close the compliance gap.
            </p>
          </div>

          <div className="live-video-question">Tell me about yourself</div>
          <div className="live-video-question">Why are you a great fit for this role?</div>
          <div className="live-video-question">How do you handle tight deadlines?</div>
          <div className="live-video-question">Give an example of a challenge you solved</div>

          <div className="live-video-prompt">
            <span>Ask Odesseus anything...</span>
            <strong>➜</strong>
          </div>

          <div className="live-video-context-note">
            Resume, job description, and application context loaded.
          </div>
        </aside>
      </div>
    </div>
  );
}
