import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import JobPreferencesForm from "@/components/job-preferences-form";
import MobileJobPreferences from "@/components/mobile/mobile-job-preferences";

/**
 * Job Preferences (screen 17). Candidate-only settings sub-page. Reads the
 * real `job_preferences` row once server-side, then renders the shared
 * desktop form on wide viewports and the phone-width mobile presentation on
 * small screens — both write the same columns through the user-scoped
 * Supabase client.
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
    <>
      <main
        className="odesseus-desktop-only"
        style={{ minHeight: "100vh", padding: "24px 16px 80px" }}
      >
        <JobPreferencesForm userId={userId} initial={jobPreferences} />
      </main>
      <MobileJobPreferences userId={userId} initial={jobPreferences} />
    </>
  );
}