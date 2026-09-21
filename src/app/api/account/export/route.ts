import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const [
    { data: profile },
    { data: jobPreferences },
    { data: jobOpportunities },
    { data: applications },
    { data: resumeTailorings },
    { data: interviews },
    { data: resumes },
    { data: integrationAccounts },
    { data: creditBalances },
    { data: creditTransactions },
    { data: answerVault },
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("job_preferences").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("job_opportunities").select("*").eq("user_id", userId),
    supabase.from("applications").select("*").eq("user_id", userId),
    supabase.from("resume_tailorings").select("*").eq("user_id", userId),
    supabase.from("interviews").select("*").eq("user_id", userId),
    supabase.from("resumes").select("id,file_name,mime_type,size_bytes,is_master,is_approved,created_at").eq("user_id", userId),
    supabase.from("integration_accounts").select("id,service_type,provider,account_email,status,connected_at").eq("user_id", userId),
    supabase.from("credit_balances").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("credit_transactions").select("*").eq("user_id", userId),
    supabase.from("application_answer_vault").select("*").eq("user_id", userId),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    profile,
    jobPreferences,
    jobOpportunities,
    applications,
    resumeTailorings,
    interviews,
    resumes,
    integrationAccounts,
    creditBalances,
    creditTransactions,
    answerVault,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="odesseus-data-export-${userId}.json"`,
    },
  });
}
