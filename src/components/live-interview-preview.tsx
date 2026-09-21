const icons = {
  video: "M23 7l-7 5 7 5V7z M1 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H1a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  document: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h6 M9 17h6 M9 9h1",
  chat: "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z",
  chart: "M18 20V10 M12 20V4 M6 20v-6",
  mic: "M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v4 M8 23h8",
  camera: "M23 7l-7 5 7 5V7z M1 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H1a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  screen: "M8 21h8 M12 17v4 M2 5h20v10H2z",
  more: "M5 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M12 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M19 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 2 .7 2.9a2 2 0 0 1-.4 2.1L8 10a16 16 0 0 0 6 6l1.3-1.4a2 2 0 0 1 2.1-.4c.9.4 1.9.6 2.9.7a2 2 0 0 1 1.7 2.1z",
  pin: "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2",
  send: "M22 2 11 13 M22 2l-7 20-4-9-9-4 20-7z",
};

function PersonSilhouette({ className, id }: { className?: string; id: string }) {
  return (
    <svg viewBox="0 0 200 240" className={className} preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3f4a63" />
          <stop offset="100%" stopColor="#1a1f2b" />
        </linearGradient>
        <linearGradient id={`${id}-head`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#66718a" />
          <stop offset="100%" stopColor="#394154" />
        </linearGradient>
      </defs>
      <path d="M6 240c0-62 41-99 94-99s94 37 94 99" fill={`url(#${id}-body)`} />
      <circle cx="100" cy="88" r="58" fill={`url(#${id}-head)`} />
    </svg>
  );
}

function Icon({ name, size = 18 }: { name: keyof typeof icons; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[name]} />
    </svg>
  );
}

const features = [
  { icon: "video" as const, title: "Live AI Support", body: "Get real-time guidance during your interview" },
  { icon: "document" as const, title: "Your Materials Ready", body: "Resume, job description, and talking points at your fingertips" },
  { icon: "chat" as const, title: "Smart Suggestions", body: "Context-aware answers and follow-up prompts" },
  { icon: "chart" as const, title: "Stay Confident", body: "Focus on the conversation, we've got the rest" },
];

const quickPrompts = [
  { icon: "pin" as const, text: "Tell me about yourself" },
  { icon: "document" as const, text: "Why are you a great fit for this role?" },
  { icon: "clock" as const, text: "How do you handle tight deadlines?" },
  { icon: "chat" as const, text: "Can you give an example of a challenge..." },
];

export default function LiveInterviewPreview() {
  return (
    <div className="live-preview-grid">
      <div className="live-preview-copy-col">
        <div className="live-preview-eyebrow">
          <span className="live-preview-eyebrow-dot" />
          Live Interview Preview
        </div>
        <h1 className="font-display live-preview-heading">
          Go into your interview with your entire application behind you.
        </h1>
        <p className="muted live-preview-body">
          The resume you submitted, the job you applied to, and everything Odesseus prepared — all in one place when it matters.
        </p>

        <div className="live-preview-features">
          {features.map((f) => (
            <div className="live-preview-feature" key={f.title}>
              <span className="live-preview-feature-icon">
                <Icon name={f.icon} />
              </span>
              <div>
                <strong>{f.title}</strong>
                <p className="muted">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="live-preview-panel">
        <div className="live-video-card">
          <PersonSilhouette id="live-preview-self" className="live-video-self-avatar" />
          <div className="live-video-badge">
            <span className="live-video-live-dot" />
            Live Preview
            <span className="live-video-timer">00:12</span>
          </div>

          <div className="live-video-interviewer">
            <div className="live-video-interviewer-photo">
              <PersonSilhouette id="live-preview-interviewer" className="live-video-avatar" />
            </div>
            <span className="live-video-interviewer-tag">
              <Icon name="pin" size={11} /> Interviewer
            </span>
          </div>

          <div className="live-video-self-tag">
            You <Icon name="mic" size={13} />
          </div>

          <div className="live-video-controls">
            <span className="live-video-control-btn">
              <Icon name="mic" size={17} />
            </span>
            <span className="live-video-control-btn">
              <Icon name="camera" size={17} />
            </span>
            <span className="live-video-control-btn">
              <Icon name="screen" size={17} />
            </span>
            <span className="live-video-control-btn">
              <Icon name="more" size={17} />
            </span>
            <span className="live-video-control-btn live-video-control-end">
              <Icon name="phone" size={17} />
            </span>
          </div>
        </div>

        <div className="live-assistant-panel">
          <div className="live-assistant-tabs">
            <span className="live-assistant-tab is-active">AI Assistant</span>
            <span className="live-assistant-tab">Job Details</span>
            <span className="live-assistant-tab">My Resume</span>
          </div>

          <div className="live-suggestion-card">
            <strong>Real-time Suggestion</strong>
            <p>
              Great answer! You can also mention your experience with risk management and regulatory compliance to strengthen this point.
            </p>
          </div>

          <div className="live-quick-prompts">
            {quickPrompts.map((p) => (
              <div className="live-quick-prompt" key={p.text}>
                <Icon name={p.icon} size={15} />
                <span>{p.text}</span>
              </div>
            ))}
          </div>

          <div className="live-assistant-input">
            <span>Ask Odesseus anything…</span>
            <span className="live-assistant-send">
              <Icon name="send" size={15} />
            </span>
          </div>
          <p className="live-assistant-hint muted">Get real-time answers, talking points, and more.</p>
        </div>
      </div>
    </div>
  );
}
