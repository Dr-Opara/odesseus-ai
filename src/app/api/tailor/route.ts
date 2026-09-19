import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { tailorResume } from "@/lib/ai/tailor";
import { parseResume } from "@/lib/ai/resume";
import { resumeProfileSchema } from "@/lib/ai/schemas";

export const runtime = "nodejs";

const bodySchema = z.object({
  jobId: z.string().uuid(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  let jobId: string;

  try {
    jobId = bodySchema.parse(await request.json()).jobId;
  } catch {
    return NextResponse.json({ error: "Invalid job." }, { status: 400 });
  }

  const [{ data: job }, { data: resume }] = await Promise.all([
    supabase
      .from("job_opportunities")
      .select("id,company_name,role_title,description,match_score,match_breakdown")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("resumes")
      .select("*")
      .eq("user_id", userId)
      .eq("is_master", true)
      .maybeSingle(),
  ]);

  if (!job?.description) {
    return NextResponse.json({ error: "Odysseus could not find this job description." }, { status: 404 });
  }

  if (!resume?.storage_path) {
    return NextResponse.json({ error: "Upload a master resume first." }, { status: 400 });
  }

  try {
    let parsed = resumeProfileSchema.safeParse(resume.parsed_data);

    if (!parsed.success) {
      const { data: file, error: downloadError } = await supabase.storage
        .from("resumes")
        .download(resume.storage_path);

      if (downloadError || !file) throw new Error("Odysseus could not read your resume.");

      const extracted = await parseResume({
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType: resume.mime_type || "application/pdf",
        fileName: resume.file_name,
      });

      parsed = { success: true, data: extracted };

      const { error: cacheError } = await supabase
        .from("resumes")
        .update({ parsed_data: extracted, updated_at: new Date().toISOString() })
        .eq("id", resume.id)
        .eq("user_id", userId);

      if (cacheError) throw new Error("Odysseus could not save the parsed resume.");
    }

    const tailored = await tailorResume({
      resume: parsed.data,
      jobDescription: job.description,
      matchBreakdown: job.match_breakdown,
      companyName: job.company_name,
      roleTitle: job.role_title,
    });

    const { data: latest } = await supabase
      .from("resume_tailorings")
      .select("version_number")
      .eq("user_id", userId)
      .eq("job_id", jobId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const versionNumber = (latest?.version_number ?? 0) + 1;

    const { data: tailoring, error: insertError } = await supabase
      .from("resume_tailorings")
      .insert({
        user_id: userId,
        job_id: jobId,
        source_resume_id: resume.id,
        version_number: versionNumber,
        tailored_resume: tailored.tailoredResume,
        changes: tailored.changes,
        improvement_count: tailored.changes.length,
        status: "draft",
      })
      .select("id,version_number")
      .single();

    if (insertError || !tailoring) {
      throw new Error("Odysseus could not save the tailored resume.");
    }

    return NextResponse.json({
      id: tailoring.id,
      version: tailoring.version_number,
    });
  } catch (error) {
    console.error("Odysseus Resume tailoring failed:", error);
    return NextResponse.json(
      { error: "Odysseus could not tailor this resume." },
      { status: 500 }
    );
  }
}
