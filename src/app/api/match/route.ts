import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseResume } from "@/lib/ai/resume";
import { resumeProfileSchema } from "@/lib/ai/schemas";
import { assessJobMatch } from "@/lib/ai/match";

export const runtime = "nodejs";

const requestSchema = z.object({
  companyName: z.string().trim().max(160).optional().default(""),
  roleTitle: z.string().trim().max(200).optional().default(""),
  jobDescription: z.string().trim().min(200).max(60000),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  let input: z.infer<typeof requestSchema>;

  try {
    input = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Paste the full job description before analyzing the match." },
      { status: 400 }
    );
  }

  const [
    { data: profile, error: profileError },
    { data: preferences },
    { data: resume, error: resumeError },
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("job_preferences").select("*").eq("user_id", userId).maybeSingle(),
    supabase
      .from("resumes")
      .select("*")
      .eq("user_id", userId)
      .eq("is_master", true)
      .maybeSingle(),
  ]);

  if (profileError || !profile?.onboarding_completed) {
    return NextResponse.json({ error: "Complete your Odysseus profile first." }, { status: 400 });
  }

  if (resumeError || !resume?.storage_path) {
    return NextResponse.json({ error: "Upload a master resume before matching a job." }, { status: 400 });
  }

  try {
    let resumeProfile = resumeProfileSchema.safeParse(resume.parsed_data);

    if (!resumeProfile.success) {
      const { data: file, error: downloadError } = await supabase.storage
        .from("resumes")
        .download(resume.storage_path);

      if (downloadError || !file) {
        throw new Error("Odysseus could not read your resume.");
      }

      const parsed = await parseResume({
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType: resume.mime_type || "application/pdf",
        fileName: resume.file_name,
      });

      resumeProfile = { success: true, data: parsed };

      const [resumeUpdate, profileUpdate] = await Promise.all([
        supabase
          .from("resumes")
          .update({ parsed_data: parsed, updated_at: new Date().toISOString() })
          .eq("id", resume.id)
          .eq("user_id", userId),
        supabase
          .from("profiles")
          .update({
            skills: parsed.skills,
            certifications: parsed.certifications,
            candidate_facts: {
              summary: parsed.summary,
              yearsExperience: parsed.yearsExperience,
              currentOrRecentTitle: parsed.currentOrRecentTitle,
              industries: parsed.industries,
              education: parsed.education,
              roles: parsed.roles,
              verifiedFacts: parsed.verifiedFacts,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId),
      ]);

      if (resumeUpdate.error || profileUpdate.error) {
        throw new Error("Odysseus parsed your resume but could not save the verified profile.");
      }
    }

    const match = await assessJobMatch({
      resume: resumeProfile.data,
      profile,
      preferences,
      companyName: input.companyName,
      roleTitle: input.roleTitle,
      jobDescription: input.jobDescription,
    });

    const companyName = input.companyName || match.assessment.companyName || "Company";
    const roleTitle = input.roleTitle || match.assessment.roleTitle || "Role";

    const { data: job, error: insertError } = await supabase
      .from("job_opportunities")
      .insert({
        user_id: userId,
        source: "manual",
        company_name: companyName,
        role_title: roleTitle,
        location: match.assessment.location,
        work_arrangement: match.assessment.workArrangement,
        employment_type: match.assessment.employmentType,
        salary_text: match.assessment.salaryText,
        description: input.jobDescription,
        match_score: match.score,
        match_breakdown: {
          ...match.assessment,
          calculatedScore: match.score,
          criticalMissing: match.criticalMissing,
          weights: match.weights,
        },
        status: "reviewing",
      })
      .select("id,match_score")
      .single();

    if (insertError || !job) {
      throw new Error("Odysseus could not save this match.");
    }

    return NextResponse.json({ id: job.id, score: job.match_score });
  } catch (error) {
    console.error("Odysseus Match failed:", error);
    return NextResponse.json({ error: "Odysseus could not analyze this role." }, { status: 500 });
  }
}
