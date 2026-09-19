"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

async function requireUserId() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");
  return { supabase, userId: userId as string };
}

export async function deleteResume(formData: FormData) {
  const resumeId = String(formData.get("resumeId") || "");
  if (!resumeId) redirect("/profile?error=Missing%20resume");

  const { supabase, userId } = await requireUserId();

  const { data: resume } = await supabase
    .from("resumes")
    .select("id,storage_path")
    .eq("id", resumeId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!resume) redirect("/profile?error=Resume%20not%20found");

  const { error } = await supabase
    .from("resumes")
    .delete()
    .eq("id", resumeId)
    .eq("user_id", userId);

  if (error) {
    const message = error.code === "23503"
      ? "This resume is attached to a submitted application and can't be deleted."
      : "Odysseus could not delete this resume.";
    redirect(`/profile?error=${encodeURIComponent(message)}`);
  }

  if (resume.storage_path) {
    await supabase.storage.from("resumes").remove([resume.storage_path]);
  }

  revalidatePath("/profile");
  redirect("/profile?status=resume_deleted");
}

export async function disconnectIntegration(formData: FormData) {
  const accountId = String(formData.get("accountId") || "");
  if (!accountId) redirect("/integrations?error=Missing%20account");

  const { supabase, userId } = await requireUserId();

  const { data: account } = await supabase
    .from("integration_accounts")
    .select("id,vault_secret_id")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!account) redirect("/integrations?error=Account%20not%20found");

  const { error } = await supabase
    .from("integration_accounts")
    .delete()
    .eq("id", accountId)
    .eq("user_id", userId);

  if (error) {
    redirect("/integrations?error=Odysseus%20could%20not%20disconnect%20this%20account");
  }

  revalidatePath("/integrations");
  redirect("/integrations?disconnected=1");
}

export async function deleteTranscript(formData: FormData) {
  const interviewId = String(formData.get("interviewId") || "");
  if (!interviewId) redirect("/interviews?error=Missing%20interview");

  const { supabase, userId } = await requireUserId();

  const { data: session } = await supabase
    .from("live_interview_sessions")
    .select("id")
    .eq("interview_id", interviewId)
    .eq("user_id", userId)
    .maybeSingle();

  if (session) {
    await supabase
      .from("live_transcript_items")
      .delete()
      .eq("session_id", session.id)
      .eq("user_id", userId);
  }

  revalidatePath(`/interviews/${interviewId}/analysis`);
  redirect(`/interviews/${interviewId}/analysis?status=transcript_deleted`);
}

export async function deleteAccount(formData: FormData) {
  const confirmation = String(formData.get("confirmation") || "");
  if (confirmation !== "DELETE") {
    redirect("/settings?error=Type%20DELETE%20to%20confirm%20account%20deletion");
  }

  const { supabase, userId } = await requireUserId();

  const { data: resumes } = await supabase
    .from("resumes")
    .select("storage_path")
    .eq("user_id", userId);

  const paths = (resumes || [])
    .map((r) => r.storage_path)
    .filter((p): p is string => Boolean(p));

  if (paths.length) {
    await supabase.storage.from("resumes").remove(paths);
  }

  const service = createServiceClient();
  const { error } = await service.auth.admin.deleteUser(userId);

  if (error) {
    redirect("/settings?error=Odysseus%20could%20not%20delete%20your%20account.%20Please%20contact%20support.");
  }

  await supabase.auth.signOut();
  redirect("/login?status=account_deleted");
}
