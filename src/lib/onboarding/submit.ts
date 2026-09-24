/**
 * Shared onboarding submission logic (resume upload + profile/preferences
 * save). Used by both the desktop onboarding form and the mobile onboarding
 * wizard so there is exactly one implementation of what "finishing setup"
 * does, regardless of which surface collected the input.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

const ALLOWED_RESUME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_RESUME_BYTES = 10 * 1024 * 1024;

export function validateResumeFile(file: File | null): string | null {
  if (!file) return "Choose your resume to continue.";
  if (!ALLOWED_RESUME_TYPES.includes(file.type)) return "Use a PDF or DOCX resume.";
  if (file.size > MAX_RESUME_BYTES) return "Your resume must be 10 MB or smaller.";
  return null;
}

/** Uploads the candidate's master resume and records it. Caller validates the file first.
 * Any previously-master resume is demoted to a regular document so exactly one master
 * exists (tailoring resolves the master with `.maybeSingle()`). */
export async function uploadMasterResume(
  supabase: Client,
  userId: string,
  file: File
): Promise<{ error?: string; resumeId?: string }> {
  const extension = file.name.split(".").pop()?.toLowerCase() || "pdf";
  const path = `${userId}/master-${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("resumes")
    .upload(path, file, { upsert: false });
  if (uploadError) return { error: uploadError.message };

  await supabase
    .from("resumes")
    .update({ is_master: false })
    .eq("user_id", userId)
    .eq("is_master", true);

  const { data: inserted, error: resumeError } = await supabase
    .from("resumes")
    .insert({
      user_id: userId,
      file_name: file.name,
      storage_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      is_master: true,
      is_approved: true,
    })
    .select("id")
    .single();
  if (resumeError) {
    await supabase.storage.from("resumes").remove([path]);
    return { error: resumeError.message };
  }

  return { resumeId: inserted?.id };
}

export type OnboardingPreferences = {
  fullName: string | null;
  targetRole: string;
  location: string;
  workPreference: string;
  minimumSalary: string;
};

/** Marks onboarding complete and saves the candidate's initial job preferences. */
export async function saveProfileAndPreferences(
  supabase: Client,
  userId: string,
  input: OnboardingPreferences
): Promise<{ error?: string }> {
  const { fullName, targetRole, location, workPreference, minimumSalary } = input;

  const profileResult = await supabase.from("profiles").upsert({
    id: userId,
    full_name: fullName,
    location: location || null,
    work_preference: workPreference,
    onboarding_completed: true,
  });

  const preferenceResult = await supabase.from("job_preferences").upsert({
    user_id: userId,
    target_titles: targetRole ? [targetRole] : [],
    target_locations: location ? [location] : [],
    remote_only: workPreference === "remote",
    minimum_salary: minimumSalary ? Number(minimumSalary) : null,
    min_match_score: 85,
  });

  const error = profileResult.error?.message || preferenceResult.error?.message;
  return error ? { error } : {};
}
