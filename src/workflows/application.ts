import { createHook } from "workflow";
import { runApplicationPass } from "@/lib/apply/runner";
import { createServiceClient } from "@/lib/supabase/service";

type ApplyCommand = {
  action: "continue" | "submit" | "cancel";
};

async function executePass(
  runId: string,
  action: ApplyCommand["action"]
) {
  "use step";
  return runApplicationPass(runId, action);
}

async function setResumeToken(runId: string, token: string | null) {
  "use step";
  const supabase = createServiceClient();
  await supabase
    .from("application_runs")
    .update({
      resume_token: token,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

async function markFailed(runId: string, message: string) {
  "use step";
  const supabase = createServiceClient();
  await supabase
    .from("application_runs")
    .update({
      status: "failed",
      stop_reason: message,
      // A terminal run is not waiting on anyone, so it carries no hold.
      hold_category: null,
      finished_at: new Date().toISOString(),
      resume_token: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

export async function applicationWorkflow(runId: string) {
  "use workflow";

  let action: ApplyCommand["action"] = "continue";

  try {
    for (let turn = 0; turn < 20; turn += 1) {
      const result = await executePass(runId, action);

      if (result.terminal) {
        await setResumeToken(runId, null);
        return result;
      }

      if ("autoContinue" in result && result.autoContinue) {
        action = "continue";
        continue;
      }

      const token = `apply:${runId}:${turn}`;
      await setResumeToken(runId, token);

      const hook = createHook<ApplyCommand>({ token });
      const next = await hook;
      action = next.action;
    }

    await markFailed(runId, "Application run exceeded the maximum number of pause/resume cycles.");
    return { terminal: true, status: "failed" as const };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Application workflow failed.";
    await markFailed(runId, message);
    throw error;
  }
}
