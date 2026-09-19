import { createServiceClient } from "@/lib/supabase/service";
import { getGoogleAccessToken } from "./google-auth";
import {
  detectMeetingProvider,
  extractMeetingUrl,
  heuristicSignalType,
  matchApplication,
  statusForSignal,
  type SignalType,
  type TrackedApplication,
} from "./google-detection";
import { extractEmailSignal } from "./google-extract";

function decodeBase64Url(value?: string) {
  if (!value) return "";
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function messageBody(payload: any): string {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  const plain = (payload.parts || []).find((part: any) => part.mimeType === "text/plain");
  if (plain?.body?.data) return decodeBase64Url(plain.body.data);

  for (const part of payload.parts || []) {
    const nested = messageBody(part);
    if (nested) return nested;
  }

  if (payload.mimeType === "text/html" && payload.body?.data) {
    return stripHtml(decodeBase64Url(payload.body.data));
  }

  if (payload.body?.data) return stripHtml(decodeBase64Url(payload.body.data));
  return "";
}

function header(payload: any, name: string) {
  return (
    payload?.headers?.find(
      (item: any) => String(item.name).toLowerCase() === name.toLowerCase()
    )?.value || ""
  );
}

async function googleFetch(token: string, url: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Google API request failed: ${response.status}`);
  }

  return response.json();
}

export async function updateApplicationFromSignal(input: {
  userId: string;
  application: TrackedApplication;
  signalId: string;
  signalType: SignalType;
  source: "email" | "calendar";
  detail: string;
}) {
  const status = statusForSignal(input.signalType);
  if (!status) return;

  const service = createServiceClient();
  const now = new Date().toISOString();

  if (input.application.status !== status) {
    await service
      .from("applications")
      .update({
        status,
        last_event_at: now,
        updated_at: now,
      })
      .eq("id", input.application.id)
      .eq("user_id", input.userId);
  }

  await service.from("application_status_events").insert({
    application_id: input.application.id,
    user_id: input.userId,
    event_type:
      input.source === "email"
        ? "email_detected"
        : "calendar_detected",
    from_status: input.application.status,
    to_status: status,
    title:
      input.signalType === "interview_invite"
        ? "Interview detected"
        : input.signalType === "assessment"
          ? "Assessment detected"
          : input.signalType === "offer"
            ? "Offer detected"
            : input.signalType === "rejection"
              ? "Employer update detected"
              : "Employer response detected",
    detail: input.detail,
    source: input.source,
    metadata: { signal_id: input.signalId },
  });
}

export async function upsertInterview(input: {
  userId: string;
  applicationId: string;
  source: "email" | "calendar";
  externalId: string;
  signalId: string;
  stage?: string | null;
  scheduledAt?: string | null;
  timezone?: string | null;
  meetingProvider?: string | null;
  meetingUrl?: string | null;
  interviewerName?: string | null;
  interviewerEmail?: string | null;
}) {
  const service = createServiceClient();

  const { data: existing } = await service
    .from("interviews")
    .select("id")
    .eq("user_id", input.userId)
    .eq("source", input.source)
    .eq("source_external_id", input.externalId)
    .maybeSingle();

  const values = {
    user_id: input.userId,
    application_id: input.applicationId,
    stage: input.stage || "Interview",
    scheduled_at: input.scheduledAt || null,
    timezone: input.timezone || null,
    meeting_provider: input.meetingProvider || null,
    meeting_url: input.meetingUrl || null,
    interviewer_details: {
      name: input.interviewerName || null,
      email: input.interviewerEmail || null,
    },
    status: input.scheduledAt ? "scheduled" : "invited",
    source: input.source,
    source_external_id: input.externalId,
    source_signal_id: input.signalId,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await service.from("interviews").update(values).eq("id", existing.id);
    return existing.id;
  }

  const { data: interview } = await service
    .from("interviews")
    .insert(values)
    .select("id")
    .single();

  if (interview) {
    await service.from("application_status_events").insert({
      application_id: input.applicationId,
      user_id: input.userId,
      event_type: "interview_created",
      to_status: "interview",
      title: "Interview workspace created",
      detail: input.scheduledAt
        ? "Odysseus connected the scheduled interview to this application."
        : "Odysseus created an interview workspace from the employer invitation.",
      source: input.source,
      metadata: { interview_id: interview.id, signal_id: input.signalId },
    });
  }

  return interview?.id || null;
}

export async function syncGoogleEmail(
  userId: string,
  token: string,
  applications: TrackedApplication[],
  accountId?: string | null
) {
  const service = createServiceClient();
  const query = encodeURIComponent(
    'newer_than:45d {interview application recruiter assessment "next steps" offer "phone screen"}'
  );

  const list = await googleFetch(
    token,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=${query}`
  );

  let processed = 0;

  for (const item of list.messages || []) {
    const { data: existing } = await service
      .from("external_signals")
      .select("id")
      .eq("user_id", userId)
      .eq("source", "email")
      .eq("external_id", `google:${item.id}`)
      .maybeSingle();

    if (existing) continue;

    const message = await googleFetch(
      token,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`
    );

    const subject = header(message.payload, "Subject");
    const sender = header(message.payload, "From");
    const body = messageBody(message.payload);
    const combined = `${subject}\n${sender}\n${body}`;
    const application = matchApplication(combined, applications);

    if (!application) continue;

    const heuristic = heuristicSignalType(combined);
    let extracted: Awaited<ReturnType<typeof extractEmailSignal>> | null = null;

    if (heuristic !== "unknown") {
      extracted = await extractEmailSignal({
        subject,
        sender,
        body,
        application,
      });
    }

    const signalType =
      extracted && extracted.confidence >= 0.72
        ? extracted.signalType
        : heuristic;

    const occurredAt = new Date(
      Number(message.internalDate || Date.now())
    ).toISOString();

    const { data: signal, error } = await service
      .from("external_signals")
      .insert({
        user_id: userId,
        application_id: application.id,
        integration_account_id: accountId || null,
        source: "email",
        external_id: `google:${item.id}`,
        signal_type: signalType,
        title: subject,
        sender,
        occurred_at: occurredAt,
        payload: {
          thread_id: message.threadId,
          summary: extracted?.conciseSummary || null,
          stage: extracted?.stage || null,
          scheduled_at: extracted?.scheduledAt || null,
          timezone: extracted?.timezone || null,
          meeting_provider:
            extracted?.meetingProvider || detectMeetingProvider(combined),
          meeting_url:
            extracted?.meetingUrl || extractMeetingUrl(combined),
          interviewer_name: extracted?.interviewerName || null,
          interviewer_email: extracted?.interviewerEmail || null,
        },
        processed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !signal) continue;

    if (signalType !== "unknown") {
      await updateApplicationFromSignal({
        userId,
        application,
        signalId: signal.id,
        signalType,
        source: "email",
        detail:
          extracted?.conciseSummary ||
          `Email detected: ${subject || "Employer message"}`,
      });
    }

    if (
      signalType === "interview_invite" ||
      signalType === "interview_update"
    ) {
      await upsertInterview({
        userId,
        applicationId: application.id,
        source: "email",
        externalId: `google:${item.id}`,
        signalId: signal.id,
        stage: extracted?.stage,
        scheduledAt: extracted?.scheduledAt,
        timezone: extracted?.timezone,
        meetingProvider:
          extracted?.meetingProvider || detectMeetingProvider(combined),
        meetingUrl:
          extracted?.meetingUrl || extractMeetingUrl(combined),
        interviewerName: extracted?.interviewerName,
        interviewerEmail: extracted?.interviewerEmail,
      });
    }

    processed += 1;
  }

  return processed;
}

export async function syncGoogleCalendar(
  userId: string,
  token: string,
  applications: TrackedApplication[],
  accountId?: string | null
) {
  const service = createServiceClient();
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const params = new URLSearchParams({
    timeMin: start,
    timeMax: end,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });

  const data = await googleFetch(
    token,
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`
  );

  let processed = 0;

  for (const event of data.items || []) {
    const externalId = `google:${event.id}`;
    if (!externalId || event.status === "cancelled") continue;

    const { data: existing } = await service
      .from("external_signals")
      .select("id")
      .eq("user_id", userId)
      .eq("source", "calendar")
      .eq("external_id", externalId)
      .maybeSingle();

    if (existing) continue;

    const attendees = (event.attendees || [])
      .map((item: any) => `${item.displayName || ""} ${item.email || ""}`)
      .join(" ");

    const combined = [
      event.summary || "",
      event.description || "",
      event.location || "",
      event.organizer?.email || "",
      attendees,
    ].join("\n");

    const application = matchApplication(combined, applications);
    if (!application) continue;

    const startAt = event.start?.dateTime || null;
    const meetingUrl =
      event.hangoutLink ||
      event.conferenceData?.entryPoints?.find(
        (entry: any) => entry.entryPointType === "video"
      )?.uri ||
      extractMeetingUrl(combined);

    const provider =
      event.conferenceData?.conferenceSolution?.name ||
      detectMeetingProvider(`${combined}\n${meetingUrl || ""}`);

    const { data: signal, error } = await service
      .from("external_signals")
      .insert({
        user_id: userId,
        application_id: application.id,
        integration_account_id: accountId || null,
        source: "calendar",
        external_id: externalId,
        signal_type: "interview_invite",
        title: event.summary || "Interview",
        sender: event.organizer?.email || null,
        occurred_at: event.created || event.updated || startAt || new Date().toISOString(),
        payload: {
          scheduled_at: startAt,
          timezone: event.start?.timeZone || null,
          meeting_provider: provider,
          meeting_url: meetingUrl,
          organizer: event.organizer || null,
          attendees: event.attendees || [],
        },
        processed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !signal) continue;

    await updateApplicationFromSignal({
      userId,
      application,
      signalId: signal.id,
      signalType: "interview_invite",
      source: "calendar",
      detail: startAt
        ? `Calendar interview detected for ${new Date(startAt).toLocaleString()}.`
        : "Calendar interview detected.",
    });

    await upsertInterview({
      userId,
      applicationId: application.id,
      source: "calendar",
      externalId,
      signalId: signal.id,
      stage: event.summary || "Interview",
      scheduledAt: startAt,
      timezone: event.start?.timeZone || null,
      meetingProvider: provider,
      meetingUrl,
      interviewerName: event.organizer?.displayName || null,
      interviewerEmail: event.organizer?.email || null,
    });

    processed += 1;
  }

  return processed;
}

export async function syncGoogleForUser(userId: string) {
  const service = createServiceClient();

  try {
    const token = await getGoogleAccessToken(userId);

    const { data: applications } = await service
      .from("applications")
      .select("id,company_name,role_title,status")
      .eq("user_id", userId)
      .in("status", [
        "applied",
        "employer_response",
        "assessment",
        "interview",
        "offer",
      ]);

    const tracked = (applications || []) as TrackedApplication[];

    const [emailCount, calendarCount] = await Promise.all([
      syncGoogleEmail(userId, token, tracked),
      syncGoogleCalendar(userId, token, tracked),
    ]);

    await service.from("integration_connections").upsert({
      user_id: userId,
      provider: "google",
      status: "connected",
      connector_id: process.env.VERCEL_CONNECT_GOOGLE_CONNECTOR || null,
      last_sync_at: new Date().toISOString(),
      last_error: null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    return { emailCount, calendarCount };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Google sync failed.";

    await service.from("integration_connections").upsert({
      user_id: userId,
      provider: "google",
      status: "error",
      connector_id: process.env.VERCEL_CONNECT_GOOGLE_CONNECTOR || null,
      last_error: message,
      updated_at: new Date().toISOString(),
    });

    throw error;
  }
}
