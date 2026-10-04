export type TrackedApplication = {
  id: string;
  company_name: string;
  role_title: string;
  status: string;
};

export type SignalType =
  | "employer_response"
  | "assessment"
  | "interview_invite"
  | "interview_update"
  | "rejection"
  | "offer"
  | "unknown";

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function roleTokens(role: string) {
  return normalize(role)
    .split(" ")
    .filter((token) => token.length >= 4)
    .filter(
      (token) =>
        ![
          "senior",
          "lead",
          "manager",
          "engineer",
          "analyst",
          "specialist",
        ].includes(token)
    );
}

export function matchApplication(
  text: string,
  applications: TrackedApplication[]
): TrackedApplication | null {
  const haystack = normalize(text);
  let best: { app: TrackedApplication; score: number } | null = null;

  for (const app of applications) {
    const company = normalize(app.company_name);
    const tokens = roleTokens(app.role_title);
    let score = 0;

    if (company.length >= 3 && haystack.includes(company)) score += 6;

    const matchedTokens = tokens.filter((token) => haystack.includes(token));
    score += Math.min(matchedTokens.length, 4);

    if (!best || score > best.score) best = { app, score };
  }

  return best && best.score >= 5 ? best.app : null;
}

export function heuristicSignalType(text: string): SignalType {
  const value = normalize(text);

  if (/offer letter|pleased to offer|employment offer|offer package/.test(value)) {
    return "offer";
  }

  if (
    /unfortunately|not moving forward|other candidates|will not be proceeding|position has been filled/.test(
      value
    )
  ) {
    return "rejection";
  }

  if (
    /interview|phone screen|screening call|meet with|schedule.*call|schedule.*meeting|availability.*interview/.test(
      value
    )
  ) {
    return "interview_invite";
  }

  if (
    /assessment|coding challenge|take home|technical exercise|skills test|case study/.test(
      value
    )
  ) {
    return "assessment";
  }

  if (
    /application|recruiter|talent acquisition|next steps|hiring team|hiring manager/.test(
      value
    )
  ) {
    return "employer_response";
  }

  return "unknown";
}

export function statusForSignal(type: SignalType) {
  switch (type) {
    case "assessment":
      return "assessment";
    case "interview_invite":
    case "interview_update":
      return "interview";
    case "rejection":
      return "rejected";
    case "offer":
      return "offer";
    case "employer_response":
      return "employer_response";
    default:
      return null;
  }
}

export function detectMeetingProvider(text: string) {
  const value = text.toLowerCase();
  if (
    value.includes("teams.microsoft.com") ||
    value.includes("microsoft teams")
  )
    return "Microsoft Teams";
  if (value.includes("zoom.us") || value.includes("zoom meeting")) return "Zoom";
  if (value.includes("meet.google.com") || value.includes("google meet"))
    return "Google Meet";
  if (value.includes("webex.com") || value.includes("webex")) return "Webex";
  return null;
}

export function extractMeetingUrl(text: string) {
  const urls = text.match(/https?:\/\/[^\s<>"')]+/g) || [];
  return (
    urls.find((url) =>
      /teams\.microsoft\.com|zoom\.us|meet\.google\.com|webex\.com/i.test(
        url
      )
    ) || null
  );
}
