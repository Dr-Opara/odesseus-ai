import {
  matchApplication,
  statusForSignal,
  type TrackedApplication,
} from "./google-detection";
import { extractEmailSignal } from "./google-extract";
import { upsertInterview } from "./google-sync";
import { createServiceClient } from "@/lib/supabase/service";
import { getProviderToken } from "./oauth";

async function graphFetch(token: string, url: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Microsoft Graph request failed: ${response.status}`);
  }

  return response.json();
}

export async function syncMicrosoftEmail(
  userId: string,
  accountId: string,
  applications: TrackedApplication[]
) {
  const token = await getProviderToken(userId, "microsoft", "email");
  const service = createServiceClient();

  const params = new URLSearchParams({
    "$top": "30",
    "$orderby": "receivedDateTime desc",
    "$select": "id,subject,from,receivedDateTime,bodyPreview,body",
  });

  const data = await graphFetch(
    token,
    `https://graph.microsoft.com/v1.0/me/messages?${params.toString()}`
  );

  let processed = 0;

  for (const message of data.value || []) {
    const externalId = String(message.id || "");
    if (!externalId) continue;

    const { data: existing } = await service
      .from("external_signals")
      .select("id")
      .eq("user_id", userId)
      .eq("source", "email")
      .eq("external_id", `microsoft:${externalId}`)
      .maybeSingle();

    if (existing) continue;

    const sender =
      message.from?.emailAddress?.address ||
      message.from?.emailAddress?.name ||
      "";
    const body = message.body?.content || message.bodyPreview || "";
    const combined = `${message.subject || ""}\n${sender}\n${body}`;
    const application = matchApplication(combined, applications);
    if (!application) continue;

    const extracted = await extractEmailSignal({
      subject: message.subject || "",
      sender,
      body,
      application,
    });

    if (extracted.confidence < 0.72 || extracted.signalType === "unknown") {
      continue;
    }

    const { data: signal } = await service
      .from("external_signals")
      .insert({
        user_id: userId,
        application_id: application.id,
        integration_account_id: accountId,
        source: "email",
        external_id: `microsoft:${externalId}`,
        signal_type: extracted.signalType,
        title: message.subject || "",
        sender,
        occurred_at:
          message.receivedDateTime || new Date().toISOString(),
        payload: extracted,
        processed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (!signal) continue;

    const status = statusForSignal(extracted.signalType);

    if (status) {
      const now = new Date().toISOString();
      await service
        .from("applications")
        .update({ status, last_event_at: now, updated_at: now })
        .eq("id", application.id)
        .eq("user_id", userId);

      await service.from("application_status_events").insert({
        application_id: application.id,
        user_id: userId,
        event_type: "email_detected",
        from_status: application.status,
        to_status: status,
        title: "Employer update detected",
        detail: extracted.conciseSummary,
        source: "email",
        metadata: {
          signal_id: signal.id,
          provider: "microsoft",
        },
      });
    }

    if (
      extracted.signalType === "interview_invite" ||
      extracted.signalType === "interview_update"
    ) {
      await upsertInterview({
        userId,
        applicationId: application.id,
        source: "email",
        externalId: `microsoft:${externalId}`,
        signalId: signal.id,
        stage: extracted.stage,
        scheduledAt: extracted.scheduledAt,
        timezone: extracted.timezone,
        meetingProvider: extracted.meetingProvider,
        meetingUrl: extracted.meetingUrl,
        interviewerName: extracted.interviewerName,
        interviewerEmail: extracted.interviewerEmail,
      });
    }

    processed += 1;
  }

  return processed;
}

export async function syncMicrosoftCalendar(
  userId: string,
  accountId: string,
  applications: TrackedApplication[]
) {
  const token = await getProviderToken(userId, "microsoft", "calendar");
  const service = createServiceClient();

  const start = new Date(Date.now() - 7 * 86400000).toISOString();
  const end = new Date(Date.now() + 90 * 86400000).toISOString();

  const params = new URLSearchParams({
    startDateTime: start,
    endDateTime: end,
    "$top": "50",
    "$orderby": "start/dateTime",
    "$select":
      "id,subject,bodyPreview,start,end,location,organizer,attendees,onlineMeeting,isOnlineMeeting",
  });

  const data = await graphFetch(
    token,
    `https://graph.microsoft.com/v1.0/me/calendarView?${params.toString()}`
  );

  let processed = 0;

  for (const event of data.value || []) {
    const combined = [
      event.subject || "",
      event.bodyPreview || "",
      event.location?.displayName || "",
      event.organizer?.emailAddress?.address || "",
      ...(event.attendees || []).map(
        (a: any) =>
          `${a.emailAddress?.name || ""} ${a.emailAddress?.address || ""}`
      ),
    ].join("\n");

    const application = matchApplication(combined, applications);
    if (!application) continue;

    const externalId = `microsoft:${event.id}`;

    const { data: existing } = await service
      .from("external_signals")
      .select("id")
      .eq("user_id", userId)
      .eq("source", "calendar")
      .eq("external_id", externalId)
      .maybeSingle();

    if (existing) continue;

    const scheduledAt = event.start?.dateTime
      ? new Date(event.start.dateTime).toISOString()
      : null;

    const { data: signal } = await service
      .from("external_signals")
      .insert({
        user_id: userId,
        application_id: application.id,
        integration_account_id: accountId,
        source: "calendar",
        external_id: externalId,
        signal_type: "interview_invite",
        title: event.subject || "Interview",
        sender: event.organizer?.emailAddress?.address || null,
        occurred_at: scheduledAt || new Date().toISOString(),
        payload: {
          scheduled_at: scheduledAt,
          timezone: event.start?.timeZone || null,
          meeting_provider:
            event.onlineMeeting?.provider || "Microsoft Teams",
          meeting_url: event.onlineMeeting?.joinUrl || null,
          organizer: event.organizer || null,
          attendees: event.attendees || [],
        },
        processed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (!signal) continue;

    const now = new Date().toISOString();

    await service
      .from("applications")
      .update({ status: "interview", last_event_at: now, updated_at: now })
      .eq("id", application.id)
      .eq("user_id", userId);

    await service.from("application_status_events").insert({
      application_id: application.id,
      user_id: userId,
      event_type: "calendar_detected",
      from_status: application.status,
      to_status: "interview",
      title: "Interview detected",
      detail: scheduledAt
        ? `Calendar interview detected for ${scheduledAt}.`
        : "Calendar interview detected.",
      source: "calendar",
      metadata: {
        signal_id: signal.id,
        provider: "microsoft",
      },
    });

    const { data: existingInterview } = await service
      .from("interviews")
      .select("id")
      .eq("user_id", userId)
      .eq("source", "calendar")
      .eq("source_external_id", externalId)
      .maybeSingle();

    const interviewValues = {
      user_id: userId,
      application_id: application.id,
      stage: event.subject || "Interview",
      scheduled_at: scheduledAt,
      timezone: event.start?.timeZone || null,
      meeting_provider:
        event.onlineMeeting?.provider || "Microsoft Teams",
      meeting_url: event.onlineMeeting?.joinUrl || null,
      interviewer_details: {
        name: event.organizer?.emailAddress?.name || null,
        email: event.organizer?.emailAddress?.address || null,
      },
      status: scheduledAt ? "scheduled" : "invited",
      source: "calendar",
      source_external_id: externalId,
      source_signal_id: signal.id,
      updated_at: now,
    };

    if (existingInterview) {
      await service
        .from("interviews")
        .update(interviewValues)
        .eq("id", existingInterview.id);
    } else {
      const { data: created } = await service
        .from("interviews")
        .insert(interviewValues)
        .select("id")
        .single();

      if (created) {
        await service.from("application_status_events").insert({
          application_id: application.id,
          user_id: userId,
          event_type: "interview_created",
          to_status: "interview",
          title: "Interview workspace created",
          detail:
            "Odysseus connected the Microsoft Calendar interview to this application.",
          source: "calendar",
          metadata: { interview_id: created.id, signal_id: signal.id },
        });
      }
    }

    processed += 1;
  }

  return processed;
}
