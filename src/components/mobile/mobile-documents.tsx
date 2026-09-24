import MobileScreen from "@/components/mobile/mobile-screen";
import { deleteResume, uploadResume } from "@/app/actions/account";
import type { CandidateDocument } from "@/lib/candidate/types";

function fileDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

/**
 * Mobile Documents screen (screen 18) — the candidate's real uploaded
 * resumes. Uploads use the shared upload server action (the new file becomes
 * the current master); deletes reuse the same `deleteResume` action the
 * desktop profile uses. Documents beyond resumes do not exist in the schema
 * yet, so the screen only lists resumes and says so.
 */
export default function MobileDocuments({
  documents,
  notice,
}: {
  documents: CandidateDocument[];
  notice: string | null;
}) {
  const master = documents.find((document) => document.is_master);

  return (
    <MobileScreen
      index="18"
      title="Documents"
      lead="Your master resume and any tailored versions are kept here."
      minHeight={844}
    >
      {notice ? <div className="m-notice">{notice}</div> : null}

      <form action={uploadResume} className="m-upload-area">
        <span className="m-upload-icon" aria-hidden="true">+</span>
        <strong>Upload a resume</strong>
        <span className="m-upload-hint">PDF or DOCX · up to 10 MB · private to your account</span>
        <input
          type="file"
          name="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          required
        />
        <button type="submit" className="m-btn-primary m-btn-full">
          Upload resume
        </button>
      </form>

      <section className="m-section">
        <div className="m-section-heading">
          <h2>Uploaded documents</h2>
        </div>

        {documents.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {documents.map((document) => (
              <div className="m-card" key={document.id}>
                <span className="m-icon" aria-hidden="true">▤</span>
                <span className="m-copy">
                  <strong>{document.file_name}</strong>
                  <small>{fileDate(document.created_at)}</small>
                </span>
                <div className="m-doc-tags">
                  {document.is_master ? <b className="m-tag m-status-met">Master</b> : null}
                  {document.is_approved ? <b className="m-tag">Approved</b> : null}
                  <form action={deleteResume}>
                    <input type="hidden" name="resumeId" value={document.id} />
                    <input type="hidden" name="next" value="/settings/documents" />
                    <button type="submit" className="m-delete" aria-label={`Delete ${document.file_name}`}>
                      ✕
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="m-empty">
            No documents yet. Upload your resume to get started.
          </div>
        )}
      </section>

      {master ? (
        <div className="m-note">
          Uploading a new resume makes it your current master resume — the
          fresh copy Odesseus tailors from. Older resumes stay listed as
          documents unless you delete them.
        </div>
      ) : null}
    </MobileScreen>
  );
}