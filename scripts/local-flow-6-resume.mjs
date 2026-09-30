import { SUPA, SERVICE, PUBLISHABLE, admin, signIn, call, record, summary } from "./local-integration.mjs";

const PASSWORD = "Integration-Pass-1";
const N = (s) => `${s}-${Date.now()}`;
const hasKey = !!process.env.OPENAI_API_KEY;

// A small but genuinely parseable PDF. The point is not the text, it is that a
// real file goes through the real storage bucket, so the route's storage_path
// check is genuinely satisfied rather than bypassed.
const PDF = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 150>>stream
BT /F1 12 Tf 60 720 Td
(Grace Hopper) Tj 0 -20 Td
(Senior compiler engineer. Twenty years.) Tj 0 -20 Td
(COBOL, LLVM, Rust, Navy Rear Admiral.) Tj
ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF`,
  "latin1",
);

async function main() {
  console.log(`\n=== RESUME UPLOAD (8C) ===\n`);

  const candidate = await signIn(N("up") + "@example.com", PASSWORD);

  // The upload goes to the real storage bucket as the signed-in candidate,
  // which is also a check that the bucket's RLS lets a candidate write only
  // their own path.
  const path = `${candidate.userId}/resume-${Date.now()}.pdf`;

  const up = await fetch(`${SUPA}/storage/v1/object/resumes/${path}`, {
    method: "POST",
    headers: {
      apikey: PUBLISHABLE,
      Authorization: `Bearer ${candidate.accessToken}`,
      "Content-Type": "application/pdf",
    },
    body: PDF,
  });
  const upText = await up.text();
  record("storage", "the candidate can upload a resume to their own path", up.ok,
    `status=${up.status} ${upText.slice(0, 160)}`);

  // Somebody else's path must be refused, or the bucket is not scoped.
  const foreignPath = `${"00000000-0000-4000-8000-00000000ffff"}/someone-else-${Date.now()}.pdf`;
  const foreignUp = await fetch(`${SUPA}/storage/v1/object/resumes/${foreignPath}`, {
    method: "POST",
    headers: {
      apikey: PUBLISHABLE,
      Authorization: `Bearer ${candidate.accessToken}`,
      "Content-Type": "application/pdf",
    },
    body: PDF,
  });
  record("storage", "a candidate cannot write under another user's path", !foreignUp.ok,
    `status=${foreignUp.status} ${(await foreignUp.text()).slice(0, 160)}`);

  // An anonymous write must be refused outright.
  const anonUp = await fetch(`${SUPA}/storage/v1/object/resumes/anon/anon-${Date.now()}.pdf`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE, "Content-Type": "application/pdf" },
    body: PDF,
  });
  record("storage", "an anonymous upload is refused", !anonUp.ok, `status=${anonUp.status}`);

  if (!up.ok) return;

  // Register it as the master resume, which is what tailoring requires.
  const resume = await admin("/rest/v1/resumes", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: candidate.userId,
      file_name: "grace-hopper.pdf",
      storage_path: path,
      mime_type: "application/pdf",
      size_bytes: PDF.length,
      is_approved: true,
      is_master: true,
      parsed_data: {},
    }),
  });
  const resumeId = resume.json?.[0]?.id;
  record("resume", "the uploaded file is registered as the master resume", !!resumeId,
    `resumeId=${resumeId} status=${resume.status} ${String(resume.text).slice(0, 140)}`);

  // The candidate can list their own resumes.
  const exportRes = await call(candidate, "GET", "/api/account/export");
  record("resume", "the export lists the candidate's resume",
    exportRes.status === 200 && JSON.stringify(exportRes.json).includes("grace-hopper.pdf"),
    `status=${exportRes.status}`);

  // A tailored run against a real tracked job.
  const opp = await admin("/rest/v1/job_opportunities", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: candidate.userId, role_title: "Compiler Engineer", company_name: "Match Co",
      status: "discovered",
      description: "Design and maintain a production compiler toolchain. Rust, LLVM, strong typing systems.",
    }),
  });
  const oppId = opp.json?.[0]?.id;

  const tailor = await call(candidate, "POST", "/api/tailor", { jobId: oppId });
  if (hasKey) {
    record("tailor", "POST /api/tailor returns 200 with a real resume", tailor.status === 200,
      `status=${tailor.status} ${JSON.stringify(tailor.json ?? tailor.text).slice(0, 220)}`);
  } else {
    // The master-resume precondition is now genuinely satisfied, so this is the
    // provider refusing, not the route short-circuiting on a missing file.
    record("tailor", "with a real master resume, tailor reaches the provider and stops on the missing key (8F blocker)",
      tailor.status === 503 || tailor.status === 500,
      `status=${tailor.status} ${JSON.stringify(tailor.json ?? tailor.text).slice(0, 220)}`);
    record("tailor", "the refusal is not the missing-resume precondition",
      !/master resume/i.test(JSON.stringify(tailor.json ?? {})),
      JSON.stringify(tailor.json ?? {}).slice(0, 180));
  }
}

main()
  .then(() => { process.exitCode = summary() === 0 ? 0 : 1; })
  .catch((e) => { console.error("HARNESS ERROR:", e.message, e.stack); process.exitCode = 1; });
