import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tailoredResumeSchema } from "@/lib/ai/schemas";
import { renderTailoredResumePdf } from "@/lib/apply/resume-pdf";

function slug(value: string) {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 70);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const { data: tailoring } = await supabase
    .from("resume_tailorings")
    .select("*,job_opportunities(company_name,role_title)")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!tailoring) {
    return NextResponse.json({ error: "Tailored resume not found." }, { status: 404 });
  }

  if (tailoring.status === "approved" && tailoring.approved_resume_id) {
    return NextResponse.json({ resumeId: tailoring.approved_resume_id });
  }

  const parsed = tailoredResumeSchema.safeParse(tailoring.tailored_resume);
  if (!parsed.success) {
    return NextResponse.json({ error: "This tailored resume is incomplete." }, { status: 400 });
  }

  const company = tailoring.job_opportunities?.company_name || "Company";
  const role = tailoring.job_opportunities?.role_title || "Role";
  const fileName = `${slug(company)}_${slug(role)}_Odysseus_v${tailoring.version_number}.pdf`;
  const storagePath = `${userId}/approved/${Date.now()}-${fileName}`;

  try {
    const pdfBytes = await renderTailoredResumePdf(parsed.data);

    const { error: uploadError } = await supabase.storage
      .from("resumes")
      .upload(storagePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data: approvedResume, error: resumeError } = await supabase
      .from("resumes")
      .insert({
        user_id: userId,
        file_name: fileName,
        storage_path: storagePath,
        mime_type: "application/pdf",
        size_bytes: pdfBytes.byteLength,
        is_master: false,
        is_approved: true,
        parsed_data: {
          type: "tailored",
          tailoring_id: tailoring.id,
          job_id: tailoring.job_id,
          content: parsed.data,
        },
      })
      .select("id")
      .single();

    if (resumeError || !approvedResume) {
      await supabase.storage.from("resumes").remove([storagePath]);
      throw new Error("Odysseus could not save the approved resume.");
    }

    const now = new Date().toISOString();

    const [{ error: tailoringError }, { error: jobError }] = await Promise.all([
      supabase
        .from("resume_tailorings")
        .update({
          status: "approved",
          approved_resume_id: approvedResume.id,
          approved_at: now,
          updated_at: now,
        })
        .eq("id", id)
        .eq("user_id", userId),
      supabase
        .from("job_opportunities")
        .update({ status: "approved", updated_at: now })
        .eq("id", tailoring.job_id)
        .eq("user_id", userId),
    ]);

    if (tailoringError || jobError) {
      throw new Error("Approval could not be finalized.");
    }

    return NextResponse.json({ resumeId: approvedResume.id });
  } catch (error) {
    console.error("Odysseus Resume approval failed:", error);
    return NextResponse.json(
      { error: "Odysseus could not approve this resume." },
      { status: 500 }
    );
  }
}
