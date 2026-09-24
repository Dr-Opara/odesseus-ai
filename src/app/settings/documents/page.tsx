import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/app-shell";
import MobileDocuments from "@/components/mobile/mobile-documents";
import { deleteResume, uploadResume } from "@/app/actions/account";
import {
  getCandidateProfile,
  getCandidateUserId,
  getCreditBalance,
  getDocuments,
} from "@/lib/candidate/service";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const { status, error } = await searchParams;
  const supabase = await createClient();
  const userId = await getCandidateUserId(supabase);
  if (!userId) redirect("/login");

  const [profile, credits, documents] = await Promise.all([
    getCandidateProfile(supabase, userId),
    getCreditBalance(supabase, userId),
    getDocuments(supabase, userId),
  ]);

  const notice =
    status === "resume_uploaded"
      ? "Resume uploaded. Your new master resume is ready to tailor."
      : status === "resume_deleted"
        ? "Resume deleted."
        : null;

  return (
    <AppShell
      fullName={profile?.full_name}
      applicationCredits={credits.application_credits}
      interviewPasses={credits.interview_passes}
    >
      <section className="shell odesseus-desktop-only" style={{ padding: "54px 0 100px" }}>
        <div style={{ width: "min(760px,100%)", margin: "20px auto 0" }}>
          <div className="muted" style={{ fontSize: 14 }}>Settings</div>
          <h1 style={{ fontSize: 46, letterSpacing: "-0.05em", margin: "10px 0 6px" }}>
            Documents.
          </h1>
          <p className="muted" style={{ fontSize: 18, lineHeight: 1.6, marginBottom: 30 }}>
            Your master resume and any approved PDFs are kept here. Documents
            beyond resumes (cover letters, certificates) are not supported yet.
          </p>

          {notice ? <div className="billing-success" style={{ marginBottom: 18 }}>{notice}</div> : null}
          {error ? (
            <div style={{ marginBottom: 18, padding: 14, borderRadius: 12, background: "#fff1ef" }}>{error}</div>
          ) : null}

          <div className="card" style={{ padding: 26, marginBottom: 18 }}>
            <div className="muted" style={{ fontSize: 13 }}>Upload</div>
            <h2 style={{ fontSize: 22, margin: "7px 0 16px" }}>Add a new master resume</h2>
            <p className="muted" style={{ margin: "0 0 16px", lineHeight: 1.55 }}>
              The new file becomes your current master resume — the copy Odesseus
              tailors from. Older resumes stay listed as documents unless you delete them.
            </p>
            <form action={uploadResume} style={{ display: "grid", gap: 12, maxWidth: 420 }}>
              <input
                type="file"
                name="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                required
                style={{ fontSize: 13 }}
              />
              <button type="submit" className="btn btn-primary">Upload resume</button>
            </form>
          </div>

          <div className="card" style={{ padding: 26 }}>
            <div className="muted" style={{ fontSize: 13 }}>Documents</div>
            <h2 style={{ fontSize: 22, margin: "7px 0 16px" }}>Uploaded documents</h2>
            {documents.length ? (
              <div style={{ display: "grid", gap: 10 }}>
                {documents.map((document) => (
                  <div
                    key={document.id}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, padding: "10px 0", borderTop: "1px solid var(--line)" }}
                  >
                    <div>
                      <strong>{document.file_name}</strong>
                      <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                        {document.is_master ? "Master resume · " : ""}
                        {document.is_approved ? "Approved · " : ""}
                        {new Date(document.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <form action={deleteResume}>
                      <input type="hidden" name="resumeId" value={document.id} />
                      <input type="hidden" name="next" value="/settings/documents" />
                      <button type="submit" className="account-menu-logout" style={{ width: "auto", padding: "8px 14px", border: "1px solid var(--line)" }}>
                        Delete
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>No documents yet. Upload your resume to get started.</p>
            )}
          </div>
        </div>
      </section>

      <MobileDocuments documents={documents} notice={notice} />
    </AppShell>
  );
}