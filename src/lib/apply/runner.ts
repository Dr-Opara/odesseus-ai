import { chromium, type Locator, type Page } from "playwright-core";
import {
  createApplicationBrowserSession,
  getApplicationBrowserSession,
  releaseApplicationBrowserSession,
} from "@/lib/apply/browserbase";
import { createServiceClient } from "@/lib/supabase/service";
import { decideField, type ApplyContext } from "@/lib/apply/field-rules";
import type { Json } from "@/types/database";

type ApplyCommand = "continue" | "submit" | "cancel";

type FieldDescriptor = {
  index: number;
  tag: string;
  type: string;
  name: string;
  id: string;
  label: string;
  placeholder: string;
  value: string;
  checked: boolean;
};

async function logEvent(
  runId: string,
  userId: string,
  eventType: string,
  summary: string,
  metadata: Record<string, unknown> = {}
) {
  const supabase = createServiceClient();
  await supabase.from("application_run_events").insert({
    run_id: runId,
    user_id: userId,
    event_type: eventType,
    summary,
    metadata: metadata as Json,
  });
}

function cleanLabel(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 600);
}

async function pageHasHumanGate(page: Page) {
  const captcha = await page
    .locator(
      'iframe[src*="captcha" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[src*="turnstile" i], [class*="captcha" i], [id*="captcha" i]'
    )
    .count();

  if (captcha > 0) {
    return "CAPTCHA or human-verification step detected.";
  }

  const authField = page.locator(
    'input[type="password"], input[autocomplete="one-time-code"], input[name*="otp" i], input[placeholder*="verification code" i]'
  );

  if ((await authField.count()) > 0) {
    return "Login, MFA, or verification step detected.";
  }

  const text = (await page.locator("body").innerText().catch(() => "")).slice(0, 5000);
  if (/verify you are human|security verification|enter verification code|two[- ]factor|multi[- ]factor/i.test(text)) {
    return "Authentication or human-verification step detected.";
  }

  return null;
}

async function collectFields(page: Page): Promise<FieldDescriptor[]> {
  const selector =
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select';

  return page.locator(selector).evaluateAll((elements) =>
    elements.map((element, index) => {
      const input = element as HTMLInputElement;
      const fieldset = element.closest("fieldset");
      const legend = fieldset?.querySelector("legend")?.textContent || "";
      const labels = Array.from((input as HTMLInputElement).labels || [])
        .map((label) => label.textContent || "")
        .join(" ");
      const aria = element.getAttribute("aria-label") || "";
      const describedBy = element.getAttribute("aria-describedby");
      const described = describedBy
        ? describedBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent || "")
            .join(" ")
        : "";
      const nearby = element.parentElement?.textContent || "";

      return {
        index,
        tag: element.tagName.toLowerCase(),
        type: (input.type || "").toLowerCase(),
        name: input.name || "",
        id: input.id || "",
        label: [legend, labels, aria, described, input.placeholder || "", nearby]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 1000),
        placeholder: input.placeholder || "",
        value: input.value || "",
        checked: Boolean(input.checked),
      };
    })
  );
}

function fieldKey(field: FieldDescriptor) {
  return [field.name, field.id, field.label]
    .filter(Boolean)
    .join("|")
    .toLowerCase()
    .replace(/[^a-z0-9|]+/g, "_")
    .slice(0, 240);
}

async function resolveField(
  locator: Locator,
  field: FieldDescriptor,
  context: ApplyContext,
  userAnswers: Map<string, string>
) {
  const key = fieldKey(field);
  const answered = userAnswers.get(key);

  if (answered) {
    if (field.tag === "select") {
      await locator.selectOption({ label: answered }).catch(async () => {
        await locator.selectOption({ value: answered }).catch(() => undefined);
      });
    } else if (field.type === "checkbox") {
      const yes = /^(yes|true|1)$/i.test(answered);
      if (yes) await locator.check().catch(() => undefined);
      else await locator.uncheck().catch(() => undefined);
    } else if (field.type === "radio") {
      const label = field.label.toLowerCase();
      if (label.includes(answered.toLowerCase())) {
        await locator.check().catch(() => undefined);
      }
    } else {
      await locator.fill(answered).catch(() => undefined);
    }

    return { filled: true, pause: null, source: "user" as const };
  }

  const decision = decideField(field.label || field.name || field.placeholder, field.type, context);

  if (decision.action === "skip") {
    return { filled: false, pause: null, source: null };
  }

  if (decision.action === "pause") {
    return {
      filled: false,
      pause: {
        fieldKey: key,
        question: cleanLabel(field.label || field.name || field.placeholder || "Application question"),
        category: decision.category,
        reason: decision.reason,
      },
      source: null,
    };
  }

  try {
    if (field.tag === "select") {
      await locator.selectOption({ label: decision.value }).catch(async () => {
        await locator.selectOption({ value: decision.value });
      });
    } else if (field.type === "checkbox") {
      if (/^(yes|true|1)$/i.test(decision.value)) await locator.check();
      else if (/^(no|false|0)$/i.test(decision.value)) await locator.uncheck();
      else {
        return {
          filled: false,
          pause: {
            fieldKey: key,
            question: cleanLabel(field.label || field.name || "Checkbox question"),
            category: "custom",
            reason: "Odysseus needs the user to confirm this checkbox.",
          },
          source: null,
        };
      }
    } else if (field.type === "radio") {
      const label = field.label.toLowerCase();
      if (label.includes(decision.value.toLowerCase())) {
        await locator.check();
      }
    } else {
      await locator.fill(decision.value);
    }

    return { filled: true, pause: null, source: decision.source };
  } catch {
    return {
      filled: false,
      pause: {
        fieldKey: key,
        question: cleanLabel(field.label || field.name || field.placeholder || "Application question"),
        category: "custom",
        reason: "Odysseus could not confidently complete this field.",
      },
      source: null,
    };
  }
}

async function findApplicationAction(page: Page) {
  const finalPatterns = [
    /^submit application$/i,
    /^submit$/i,
    /^send application$/i,
    /^complete application$/i,
  ];
  const progressPatterns = [
    /^next$/i,
    /^continue$/i,
    /^save and continue$/i,
    /^review$/i,
    /^review application$/i,
    /^apply now$/i,
    /^apply$/i,
  ];

  for (const pattern of finalPatterns) {
    const candidate = page.getByRole("button", { name: pattern }).first();
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      return { kind: "final" as const, locator: candidate };
    }
  }

  for (const pattern of progressPatterns) {
    const candidate = page.getByRole("button", { name: pattern }).first();
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      return { kind: "progress" as const, locator: candidate };
    }
  }

  const fallback = page.locator('button[type="submit"], input[type="submit"]').last();
  if ((await fallback.count()) > 0 && (await fallback.isVisible().catch(() => false))) {
    const text = cleanLabel(
      (await fallback.textContent().catch(() => "")) ||
      (await fallback.getAttribute("value").catch(() => "")) ||
      ""
    );

    if (finalPatterns.some((pattern) => pattern.test(text))) {
      return { kind: "final" as const, locator: fallback };
    }

    if (progressPatterns.some((pattern) => pattern.test(text))) {
      return { kind: "progress" as const, locator: fallback };
    }
  }

  return null;
}

async function saveQuestions(
  runId: string,
  userId: string,
  questions: Array<{ fieldKey: string; question: string; category: string; reason: string }>
) {
  if (!questions.length) return;

  const supabase = createServiceClient();

  for (const question of questions) {
    const { data: existing } = await supabase
      .from("application_run_questions")
      .select("id,status")
      .eq("run_id", runId)
      .eq("field_key", question.fieldKey)
      .maybeSingle();

    if (existing?.status === "resolved") continue;
    if (existing) continue;

    await supabase.from("application_run_questions").insert({
      run_id: runId,
      user_id: userId,
      field_key: question.fieldKey,
      question_text: question.question,
      category: question.category === "sensitive" ? "sensitive" : question.category,
      status: "needs_user",
    });
  }
}


// Delegates all finalization writes (application upsert, exactly-one
// credit debit, job/run status) to a single atomic RPC — see
// supabase/migrations/*_apply_finalization_rpc.sql. Re-running this for
// the same run (e.g. after a network failure that lost the response) is
// safe: the RPC returns already_finalized=true and does not re-charge.
export async function finalizeConfirmedExistingSubmission(input: {
  run: any;
  confirmation: string;
  pageUrl: string;
  browserSessionId: string;
}) {
  const supabase = createServiceClient();

  const { error } = await supabase.rpc("odysseus_finalize_successful_application", {
    p_run_id: input.run.id,
    p_user_id: input.run.user_id,
    p_confirmation_text: input.confirmation,
    p_page_url: input.pageUrl,
  });

  if (error) {
    throw new Error("Application confirmed, but Odysseus could not finalize it: " + error.message);
  }

  await logEvent(input.run.id, input.run.user_id, "submitted", "Application submission confirmed.", {
    url: input.pageUrl,
  });
  await logEvent(input.run.id, input.run.user_id, "credit_consumed", "One application credit consumed.");
  await releaseApplicationBrowserSession(input.browserSessionId).catch(() => undefined);

  return { terminal: true, status: "submitted" as const };
}

export async function runApplicationPass(runId: string, command: ApplyCommand) {
  const supabase = createServiceClient();

  const { data: run } = await supabase
    .from("application_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();

  if (!run) throw new Error("Application run not found.");

  if (command === "cancel") {
    if (run.browser_session_id) {
      await releaseApplicationBrowserSession(run.browser_session_id).catch(() => undefined);
    }

    await supabase
      .from("application_runs")
      .update({
        status: "cancelled",
        stop_reason: "Cancelled by user.",
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        resume_token: null,
      })
      .eq("id", runId);

    await logEvent(runId, run.user_id, "cancelled", "Application run cancelled by user.");
    return { terminal: true, status: "cancelled" as const };
  }

  const [
    { data: profile },
    { data: preferences },
    { data: vault },
    { data: resume },
    authUser,
    { data: resolvedQuestions },
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", run.user_id).maybeSingle(),
    supabase.from("job_preferences").select("*").eq("user_id", run.user_id).maybeSingle(),
    supabase
      .from("application_answer_vault")
      .select("answer_key,label,category,answer_text,auto_use_allowed")
      .eq("user_id", run.user_id),
    supabase.from("resumes").select("*").eq("id", run.approved_resume_id).maybeSingle(),
    supabase.auth.admin.getUserById(run.user_id),
    supabase
      .from("application_run_questions")
      .select("field_key,answer_text,status")
      .eq("run_id", runId)
      .eq("status", "resolved"),
  ]);

  if (!profile || !resume?.storage_path || !resume.is_approved) {
    throw new Error("Approved profile or resume is missing.");
  }

  const userAnswers = new Map<string, string>();
  for (const question of resolvedQuestions || []) {
    if (question.field_key && question.answer_text) {
      userAnswers.set(question.field_key, question.answer_text);
    }
  }

  const context: ApplyContext = {
    profile,
    preferences,
    vault: vault || [],
    email: authUser.data.user?.email || null,
  };

  let browserSession: {
    id: string;
    connectUrl: string;
    liveViewUrl: string;
  };

  if (run.browser_session_id) {
    browserSession = await getApplicationBrowserSession(run.browser_session_id);
  } else {
    browserSession = await createApplicationBrowserSession({
      runId,
      userId: run.user_id,
      targetUrl: run.target_url,
    });

    await supabase
      .from("application_runs")
      .update({
        browser_provider: "browserbase",
        browser_session_id: browserSession.id,
        live_view_url: browserSession.liveViewUrl,
        status: "running",
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);

    await logEvent(runId, run.user_id, "browser_started", "Secure application browser started.");
  }

  const browser = await chromium.connectOverCDP(browserSession.connectUrl);

  try {
    const browserContext = browser.contexts()[0] || (await browser.newContext());
    const pages = browserContext.pages();
    const page = pages[0] || (await browserContext.newPage());

    if (page.url() === "about:blank") {
      await page.goto(run.target_url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await logEvent(runId, run.user_id, "navigated", "Opened employer application page.", {
        url: page.url(),
      });
    }

    await supabase
      .from("application_runs")
      .update({
        current_url: page.url(),
        live_view_url: browserSession.liveViewUrl,
        status: "running",
        stop_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);

    const currentBody = (await page.locator("body").innerText().catch(() => "")).slice(0, 12000);
    const resumedConfirmation = currentBody.match(
      /thank you for applying|application (?:has been )?submitted|application received|successfully applied|we received your application|thanks for applying/i
    );

    if (resumedConfirmation && run.status !== "queued" && run.status !== "preflight") {
      return finalizeConfirmedExistingSubmission({
        run,
        confirmation: resumedConfirmation[0],
        pageUrl: page.url(),
        browserSessionId: browserSession.id,
      });
    }

    const gate = await pageHasHumanGate(page);
    if (gate) {
      await supabase
        .from("application_runs")
        .update({
          status: "needs_user",
          stop_reason: gate,
          current_url: page.url(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId);

      await logEvent(runId, run.user_id, "paused", gate, { url: page.url() });
      return { terminal: false, status: "needs_user" as const, reason: gate };
    }

    const fileInputs = page.locator('input[type="file"]');
    const { data: resumeBlob, error: resumeError } = await supabase.storage
      .from("resumes")
      .download(resume.storage_path);

    if (resumeError || !resumeBlob) {
      throw new Error("Approved resume file could not be loaded.");
    }

    const resumeBuffer = Buffer.from(await resumeBlob.arrayBuffer());

    for (let i = 0; i < (await fileInputs.count()); i++) {
      const input = fileInputs.nth(i);
      const details = await input.evaluate((element) => {
        const el = element as HTMLInputElement;
        const labels = Array.from(el.labels || [])
          .map((label) => label.textContent || "")
          .join(" ");
        return `${labels} ${el.name || ""} ${el.id || ""} ${el.accept || ""}`;
      });

      if (/resume|cv|curriculum|pdf|doc/i.test(details)) {
        await input.setInputFiles({
          name: resume.file_name,
          mimeType: "application/pdf",
          buffer: resumeBuffer,
        });
        await logEvent(runId, run.user_id, "resume_uploaded", "Approved resume uploaded.");
        break;
      }
    }

    const descriptors = await collectFields(page);
    const selector =
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select';
    const locators = page.locator(selector);
    const pauses: Array<{ fieldKey: string; question: string; category: string; reason: string }> = [];

    for (const field of descriptors) {
      const locator = locators.nth(field.index);
      const visible = await locator.isVisible().catch(() => false);
      const enabled = await locator.isEnabled().catch(() => false);

      if (!visible || !enabled || field.type === "file") continue;

      const alreadyAnswered =
        (field.type !== "checkbox" && field.type !== "radio" && field.value.trim().length > 0) ||
        ((field.type === "checkbox" || field.type === "radio") && field.checked);

      if (alreadyAnswered) continue;

      const result = await resolveField(locator, field, context, userAnswers);

      if (result.pause) {
        pauses.push(result.pause);
      } else if (result.filled) {
        await logEvent(runId, run.user_id, "field_filled", "Application field completed.", {
          field: field.label.slice(0, 180),
          source: result.source,
        });
      }
    }

    if (pauses.length) {
      await saveQuestions(runId, run.user_id, pauses);

      const reason =
        pauses.some((item) => item.category === "sensitive")
          ? "Sensitive or unverified application questions need your input."
          : "Odysseus needs your input for one or more application questions.";

      await supabase
        .from("application_runs")
        .update({
          status: "needs_user",
          stop_reason: reason,
          current_url: page.url(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId);

      await logEvent(runId, run.user_id, "paused", reason, { count: pauses.length });
      return { terminal: false, status: "needs_user" as const, reason };
    }

    const actionButton = await findApplicationAction(page);

    if (actionButton?.kind === "progress") {
      await actionButton.locator.click();
      await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
      await page.waitForTimeout(800);

      await supabase
        .from("application_runs")
        .update({
          status: "running",
          current_url: page.url(),
          stop_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId);

      await logEvent(runId, run.user_id, "navigated", "Moved to the next application step.", {
        url: page.url(),
      });

      return { terminal: false, status: "running" as const, autoContinue: true };
    }

    if (!actionButton) {
      const reason = "Odysseus could not identify the next or final application control. Review the page in the live browser.";
      await supabase
        .from("application_runs")
        .update({
          status: "needs_user",
          stop_reason: reason,
          current_url: page.url(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId);

      await logEvent(runId, run.user_id, "paused", reason);
      return { terminal: false, status: "needs_user" as const, reason };
    }

    const submitButton = actionButton.locator;

    if (command !== "submit") {
      await supabase
        .from("application_runs")
        .update({
          status: "ready_to_submit",
          stop_reason: "Review complete. Waiting for your approval to submit.",
          current_url: page.url(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId);

      await logEvent(runId, run.user_id, "ready_to_submit", "Application is ready for final submission.");
      return { terminal: false, status: "ready_to_submit" as const };
    }

    await supabase
      .from("application_runs")
      .update({
        status: "submitting",
        stop_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);

    const beforeUrl = page.url();
    await submitButton.click();
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);

    const afterUrl = page.url();
    const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 12000);
    const confirmationMatch = bodyText.match(
      /thank you for applying|application (?:has been )?submitted|application received|successfully applied|we received your application|thanks for applying/i
    );

    if (!confirmationMatch) {
      const reason =
        "The submit action completed, but Odysseus could not verify a success confirmation. Please review the live browser before any credit is charged.";

      await supabase
        .from("application_runs")
        .update({
          status: "needs_user",
          stop_reason: reason,
          current_url: afterUrl,
          submission_evidence: {
            before_url: beforeUrl,
            after_url: afterUrl,
            confirmation_detected: false,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId);

      await logEvent(runId, run.user_id, "paused", reason);
      return { terminal: false, status: "needs_user" as const, reason };
    }

    const { error: finalizeError } = await supabase.rpc(
      "odysseus_finalize_successful_application",
      {
        p_run_id: runId,
        p_user_id: run.user_id,
        p_confirmation_text: confirmationMatch[0],
        p_page_url: afterUrl,
      }
    );

    if (finalizeError) {
      throw new Error(
        "Application submitted, but Odysseus could not finalize it: " + finalizeError.message
      );
    }

    await logEvent(runId, run.user_id, "submitted", "Application submission confirmed.", {
      url: afterUrl,
    });
    await logEvent(runId, run.user_id, "credit_consumed", "One application credit consumed.");

    await releaseApplicationBrowserSession(browserSession.id).catch(() => undefined);

    return { terminal: true, status: "submitted" as const };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
