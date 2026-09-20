import styles from "./live-interview-preview.module.css";

export default function LiveInterviewPreview() {
  return (
    <div className={`card ${styles.preview}`} aria-label="Odesseus Live video interview preview">
      <div className={styles.stage}>
        <div className={styles.feed} role="img" aria-label="Candidate in a live video interview">
          <div className={styles.topbar}>
            <span className={styles.pill}><span className={styles.liveDot} /> Live Preview</span>
            <span className={styles.pill}>00:12</span>
          </div>

          <div className={styles.person} aria-hidden="true">
            <div className={styles.head} />
            <div className={styles.body} />
          </div>

          <div className={styles.interviewer}>
            <div className={styles.avatar}>I</div>
            <span>Interviewer</span>
          </div>

          <div className={styles.name}>
            <span>You</span>
            <span className={styles.audio}>▮▮▮</span>
          </div>

          <div className={styles.controls} aria-hidden="true">
            <span className={styles.control}>●</span>
            <span className={styles.control}>▣</span>
            <span className={styles.control}>⌁</span>
            <span className={styles.control}>•••</span>
            <span className={`${styles.control} ${styles.end}`}>⌕</span>
          </div>
        </div>

        <aside className={styles.assistant}>
          <div className={styles.tabs}>
            <strong>AI Assistant</strong>
            <span>Job Details</span>
            <span>My Resume</span>
          </div>

          <div className={styles.suggestion}>
            <div className={styles.suggestionLabel}>Real-time suggestion</div>
            <p>
              Lead with the outcome, then explain how you aligned the system owner and technical team
              to close the compliance gap.
            </p>
          </div>

          <div className={styles.question}>Tell me about yourself</div>
          <div className={styles.question}>Why are you a great fit for this role?</div>
          <div className={styles.question}>How do you handle tight deadlines?</div>
          <div className={styles.question}>Give an example of a challenge you solved</div>

          <div className={styles.prompt}>
            <span>Ask Odesseus anything...</span>
            <strong className={styles.send}>➜</strong>
          </div>

          <div className={styles.context}>
            Resume, job description, and application context loaded.
          </div>
        </aside>
      </div>
    </div>
  );
}
