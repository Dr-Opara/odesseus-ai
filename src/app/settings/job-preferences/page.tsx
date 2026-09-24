import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import JobPreferencesForm from "@/components/job-preferences-form";

/**
 * Job Preferences (screen 17). Candidate-only settings sub-page reusing the
 * exact same form/table the desktop Settings page uses — no separate
 * preferences implementation. A dedicated Figma-styled mobile layout (this
 * currently renders the same form markup as desktop) is follow-up work.
 */
export default async function JobPreferencesSettingsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: jobPreferences } = await supabase
    .from("job_preferences")
    .select("min_match_score,target_titles,target_locations,remote_only")
    .eq("user_id", userId)
    .maybeSingle();

  return (
    <main style={{ minHeight: "100vh", padding: "24px 16px 80px" }}>
      <JobPreferencesForm userId={userId} initial={jobPreferences} />
    </main>
  );
}
