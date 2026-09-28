/**
 * The candidate dashboard aggregation layer.
 *
 * One function, one call, one answer. Before this existed the dashboard page
 * issued seven parallel reads and then counted the rows it happened to get
 * back:
 *
 *     const jobs = await listJobs(client, userId, 5);
 *     const applications = await listApplications(client, userId, 20);
 *     const strongMatches = jobs.filter((j) => (j.match_score ?? 0) >= threshold).length;
 *
 * A candidate with four hundred discovered jobs and thirty of them above the
 * threshold saw a strong-match count between zero and five, presented with the
 * same confidence as a count that was actually complete. That is the specific
 * failure this module removes: every number here is counted in the database,
 * over every matching row, in one transaction-consistent pass.
 *
 * It reads native Odesseus data only. No external_signals, no
 * application_status_events, no integration tables, no provider of any kind. A
 * candidate who has never connected a mailbox sees the same dashboard as one
 * who has, which is both a product requirement and the reason the numbers are
 * trustworthy rather than dependent on somebody's OAuth grant.
 *
 * The layer deliberately does not own the candidate, wallet, application,
 * interview, resume or job tables. It reads them through the same database
 * types every other service uses, so this file is a composition of the existing
 * architecture rather than a parallel copy of it.
 */

import {
  CANDIDATE_ACTIVITY_ATTENTION_TYPES,
  candidateActivityHref,
  isCandidateActivityAttention,
  isCandidateActivityEventType,
  type CandidateActivityEntityType,
  type CandidateActivityEventType,
} from "./activity";
import { getRecommendedJobs, type CandidateClient } from "./service";
import type { CandidateJob } from "./types";

/**
 * The strong-match threshold used when the candidate has not set one.
 *
 * Not a new number. `job_preferences.minimum_match_score` defaults to 85 in
 * every surface that already applies the idea -- discovery, the job list, the
 * old dashboard page -- so a candidate who never touched the setting has
 * already agreed to this threshold everywhere else they can see it. Inventing a
 * different default here would make the same candidate look qualified on one
 * page and unqualified on another.
 */
export const DEFAULT_STRONG_MATCH_SCORE = 85;

/** How many rows the dashboard's lists return. Counts are never affected. */
const RECENT_APPLICATION_LIMIT = 5;
const ACTIVITY_LIMIT = 12;
const WALLET_ACTIVITY_LIMIT = 5;
const UPCOMING_INTERVIEW_LIMIT = 3;
const TOP_STRONG_MATCH_LIMIT = 5;

export type CandidateDashboardCounts = {
  jobsDiscovered: number;
  /** At or above the candidate's own `job_preferences.minimum_match_score`. */
  strongMatches: number;
  savedJobs: number;
  reviewingJobs: number;

  applicationsTotal: number;
  applicationsSubmitted: number;
  applicationsVerified: number;

  /**
   * Application queue buckets. These partition: inFlight + needsReview +
   * needsInput + held === total.
   *
   * `application_runs_one_active_per_user` permits at most one run per candidate
   * in an active status, so in practice every one of these is 0 or 1. The
   * counts are still reported as counts because that is what they are, and
   * because the dashboard presents a single current application rather than a
   * backlog -- a number that can only ever be 0 or 1 should not be dressed up
   * as a queue length.
   */
  queueTotal: number;
  queueInFlight: number;
  queueNeedsReview: number;
  queueNeedsInput: number;
  queueHeld: number;
  queueFailed: number;

  interviewsTotal: number;
  interviewsUpcoming: number;
  interviewsCompleted: number;

  /** Interview-readiness briefings generated. `lastGeneratedAt` is when. */
  prepGenerated: number;
  prepLastGeneratedAt: string | null;

  resumesTotal: number;
  resumesApproved: number;
  hasPrimaryResume: boolean;

  /** Application Agent decisions recorded since midnight UTC. */
  agentDecisionsToday: number;
};

/** The agent's operating mode, as stored in `application_agent_settings.mode`. */
export type ApplicationAgentMode = "review" | "hybrid" | "auto";

export type CandidateDashboardAgent = {
  mode: ApplicationAgentMode;
  paused: boolean;
  /**
   * A single word for the top of the page. `paused` is the fact the candidate
   * most needs; it is a separate field rather than derived from `paused`
   * because a paused agent and a zero-limit agent are different situations and
   * the UI should be able to say which.
   */
  status: "paused" | "active";
  /** The agent's real ceiling for the day, from the same row. */
  dailyApplicationLimit: number;
  minimumMatchScore: number;
  defaultApplyMethod: "apply" | "smart_apply";
  decisionsToday: number;
};

export type CandidateDashboardResume = {
  total: number;
  approved: number;
  /**
   * Whether the Resume Hub has what it needs to apply.
   *
   * Both parts are real, and the product needs both: a candidate with an
   * uploaded but unapproved resume cannot have it sent anywhere, so `total > 0`
   * alone would report them as ready when they are not. This is a readiness
   * fact read from the rows, never an inference about the file's contents.
   */
  ready: boolean;
  primaryResumeId: string | null;
  primaryFileName: string | null;
};

export type CandidateDashboardWallet = {
  /** The spendable applications balance, in cents. */
  balanceCents: number;
  /**
   * A candidate with less than the cost of a Standard Apply cannot start one.
   * The comparison is against the smallest chargeable amount in the catalogue
   * rather than against zero, so "you have money" and "you can apply" stay
   * different statements.
   */
  canApply: boolean;
  /** Live passes are a separate balance, still drawn from the same row. */
  interviewPasses: number;
  /** Set only while an Odesseus Live annual entitlement is active. */
  liveUnlimitedUntil: string | null;
  recent: CandidateWalletMovement[];
};

export type CandidateWalletMovement = {
  id: string;
  creditType: string;
  /** Signed: negative is a charge, positive is a credit. */
  delta: number;
  amountCents: number;
  reason: string | null;
  at: string;
};

export type CandidateDashboardApplication = {
  id: string;
  companyName: string;
  roleTitle: string;
  status: string;
  matchScore: number | null;
  submittedAt: string | null;
  lastEventAt: string | null;
};

export type CandidateDashboardInterview = {
  id: string;
  stage: string | null;
  roundNumber: number | null;
  status: string;
  scheduledAt: string | null;
  /**
   * The application this interview belongs to.
   *
   * An `interviews` row carries no company or role of its own; those live on
   * the application. The id is returned so the UI can link to it, and the
   * interview card shows the stage, round and time -- which is what a candidate
   * needs to act on -- rather than a company name that is not in the row.
   * Fetching the application to decorate it would be a second query per
   * interview whose result the dashboard then has to join by hand, and the
   * interview page it links to already shows the application.
   */
  applicationId: string | null;
};

export type CandidateDashboardActivityItem = {
  id: string;
  eventType: CandidateActivityEventType;
  title: string;
  detail: string | null;
  occurredAt: string;
  href: string | null;
  /** True when the candidate has to do something about this line. */
  needsAttention: boolean;
};

export type CandidateDashboard = {
  candidate: {
    name: string | null;
    headline: string | null;
    onboardingCompleted: boolean;
  };
  counts: CandidateDashboardCounts;
  agent: CandidateDashboardAgent | null;
  resume: CandidateDashboardResume;
  wallet: CandidateDashboardWallet;
  /**
   * The top strong matches, for the match cards and the "next up" slot.
   *
   * This is a display list, never a count source: it is bounded at five rows,
   * while `counts.strongMatches` is the exact figure from the counts RPC. A
   * row list and a total have different jobs, and each is allowed to be good
   * at its own.
   */
  topStrongMatches: CandidateJob[];
  recentApplications: CandidateDashboardApplication[];
  upcomingInterviews: CandidateDashboardInterview[];
  activity: CandidateDashboardActivityItem[];
  /** The subset of `activity` that is waiting on the candidate. */
  needsAttention: CandidateDashboardActivityItem[];
  /** When this answer was computed, so a stale render can be identified. */
  generatedAt: string;
};

const ACTIVITY_COLUMNS =
  "id,event_type,title,detail,entity_type,entity_id,occurred_at";

type Database = import("@/types/database").Database;

/** The row shape the counts RPC returns, taken from the generated types. */
type DashboardCountsRow =
  Database["public"]["Functions"]["odesseus_get_candidate_dashboard_counts"]["Returns"][number];

/**
 * Counts arrive as loose JSON at runtime: PostgREST returns a `bigint` column
 * as a string, and a test double may omit a key entirely. Every field is
 * therefore read as `unknown` and funnelled through `toCount`, which is the
 * only place that decides what a missing or malformed number becomes.
 */
type CountRow = Partial<Record<keyof DashboardCountsRow, unknown>>;

/**
 * Reads a count.
 *
 * PostgREST returns a `bigint` column as a string, because a JS number cannot
 * hold a 64-bit integer exactly. Counts are small in practice, so the honest
 * conversion is a parse with a floor at zero -- and anything unparseable
 * becomes 0 rather than NaN, because a dashboard that shows "NaN" instead of a
 * count is worse than one that shows a missing count.
 *
 * A negative count is not a real state, so it collapses to 0. That is why this
 * is not also used for signed money: see `toSignedAmount`.
 */
function toCount(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Reads a signed amount, such as a wallet movement's `delta`.
 *
 * Sign carries the meaning here: negative is a charge, positive is a credit.
 * Funnelling a delta through `toCount` would report every charge as 0 and
 * every refund as 0, which is not a rounding difference but the opposite of
 * what happened to the candidate's money.
 */
function toSignedAmount(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function firstRow<T>(rows: T[] | null | undefined): T | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0] ?? null;
}

const AGENT_MODES: readonly ApplicationAgentMode[] = ["review", "hybrid", "auto"];
const APPLY_METHODS = ["apply", "smart_apply"] as const;

type AgentRow = {
  mode: string | null;
  paused: boolean | null;
  daily_application_limit: number | null;
  minimum_match_score: number | null;
  default_apply_method: string | null;
};

/**
 * The agent section.
 *
 * `null` means the candidate has never opened the agent settings, which is a
 * normal state rather than an error: the default is a paused agent with no
 * automation configured, and returning a fabricated settings row would claim
 * configuration that does not exist.
 */
function projectAgent(
  row: AgentRow | null,
  decisionsToday: number
): CandidateDashboardAgent | null {
  if (!row) return null;

  const mode = AGENT_MODES.includes(row.mode as ApplicationAgentMode)
    ? (row.mode as ApplicationAgentMode)
    : "review";
  const defaultApplyMethod = APPLY_METHODS.includes(
    row.default_apply_method as (typeof APPLY_METHODS)[number]
  )
    ? (row.default_apply_method as (typeof APPLY_METHODS)[number])
    : "apply";

  // A null `paused` is treated as paused. The column defaults to true, and an
  // agent whose pause state is unknown must be assumed stopped: assuming the
  // opposite would let a settings row with a missing column read as permission
  // to apply without anyone having given it.
  const paused = row.paused !== false;

  return {
    mode,
    paused,
    status: paused ? "paused" : "active",
    dailyApplicationLimit: row.daily_application_limit ?? 0,
    minimumMatchScore: row.minimum_match_score ?? DEFAULT_STRONG_MATCH_SCORE,
    defaultApplyMethod,
    decisionsToday,
  };
}

/**
 * Projects an activity row to a display item.
 *
 * Returns `null` for a row whose event type is not in the vocabulary. The
 * database constrains the column, so this cannot happen against a real
 * database; it guards the service against a row shaped by a test double or
 * read through a client that did not validate, and it prefers dropping an
 * unlabelled line over rendering a blank one.
 */
export function projectActivityItem(
  row: Record<string, unknown>
): CandidateDashboardActivityItem | null {
  if (!isCandidateActivityEventType(row.event_type)) return null;
  const eventType = row.event_type;
  const entityType = row.entity_type;
  const entityId = row.entity_id;

  return {
    id: typeof row.id === "string" ? row.id : String(row.id ?? ""),
    eventType,
    title: typeof row.title === "string" ? row.title : "",
    detail: typeof row.detail === "string" ? row.detail : null,
    occurredAt:
      typeof row.occurred_at === "string" ? row.occurred_at : new Date().toISOString(),
    href:
      typeof entityType === "string" && typeof entityId === "string"
        ? candidateActivityHref(entityType as CandidateActivityEntityType, entityId)
        : null,
    needsAttention: isCandidateActivityAttention(eventType),
  };
}

/** The empty wallet a candidate has before their first balance row exists. */
function emptyWallet(): CandidateDashboardWallet {
  return {
    balanceCents: 0,
    canApply: false,
    interviewPasses: 0,
    liveUnlimitedUntil: null,
    recent: [],
  };
}

/** The wallet section for a candidate with no resume uploaded. */
function emptyResume(): CandidateDashboardResume {
  return {
    total: 0,
    approved: 0,
    ready: false,
    primaryResumeId: null,
    primaryFileName: null,
  };
}

/**
 * The smallest chargeable application, in cents.
 *
 * Standard Apply is priced at $0.49 per the billing rules, and the wallet is
 * drawn in whole cents, so a candidate with 48 cents cannot start one. Kept as
 * a named constant rather than inlined at the comparison so the reason the
 * threshold is not zero is legible next to the number.
 */
const MINIMUM_APPLY_CHARGE_CENTS = 49;

/**
 * Builds the whole dashboard for one candidate.
 *
 * The reads run concurrently and are deliberately independent: the counts come
 * from one RPC, the lists from their own tables. A failure in any one of them
 * throws rather than degrading to a partial dashboard, because a dashboard that
 * silently omits the wallet is worse than one that does not load -- a candidate
 * would see no balance and conclude they had none.
 */
export async function getCandidateDashboard(
  client: CandidateClient,
  userId: string
): Promise<CandidateDashboard> {
  if (!userId) {
    throw new Error("A user id is required to build the candidate dashboard");
  }

  // The threshold is the candidate's own setting, read before the counts are
  // requested so the RPC can use it. `job_preferences.min_match_score` is the
  // same value discovery and the job list already apply, so the strong-match
  // count on the dashboard agrees with the one on the page they click through
  // to. Reading it after the RPC would mean every count came back using the
  // default and the candidate's own setting silently did nothing.
  const preferencesResult = await client
    .from("job_preferences")
    .select("min_match_score")
    .eq("user_id", userId)
    .maybeSingle();

  if (preferencesResult.error) {
    throw new Error(
      `Could not load job preferences: ${preferencesResult.error.message}`
    );
  }

  const preferences = (preferencesResult.data ?? null) as {
    min_match_score?: number | null;
  } | null;
  const threshold = Number.isFinite(preferences?.min_match_score)
    ? Number(preferences?.min_match_score)
    : DEFAULT_STRONG_MATCH_SCORE;

  const countsResult = await client.rpc("odesseus_get_candidate_dashboard_counts", {
    p_user_id: userId,
    p_strong_match_threshold: threshold,
  });

  if (countsResult.error) {
    throw new Error(
      `Could not load candidate dashboard counts: ${countsResult.error.message}`
    );
  }

  const countsRow = firstRow(countsResult.data as CountRow[] | null) ?? {};

  const counts: CandidateDashboardCounts = {
    jobsDiscovered: toCount(countsRow.jobs_discovered),
    strongMatches: toCount(countsRow.jobs_strong_matches),
    savedJobs: toCount(countsRow.jobs_saved),
    reviewingJobs: toCount(countsRow.jobs_reviewing),
    applicationsTotal: toCount(countsRow.applications_total),
    applicationsSubmitted: toCount(countsRow.applications_submitted),
    applicationsVerified: toCount(countsRow.applications_verified),
    queueTotal: toCount(countsRow.queue_total),
    queueInFlight: toCount(countsRow.queue_in_flight),
    queueNeedsReview: toCount(countsRow.queue_needs_review),
    queueNeedsInput: toCount(countsRow.queue_needs_input),
    queueHeld: toCount(countsRow.queue_held),
    queueFailed: toCount(countsRow.queue_failed),
    interviewsTotal: toCount(countsRow.interviews_total),
    interviewsUpcoming: toCount(countsRow.interviews_upcoming),
    interviewsCompleted: toCount(countsRow.interviews_completed),
    prepGenerated: toCount(countsRow.prep_generated),
    prepLastGeneratedAt:
      typeof countsRow.prep_last_generated_at === "string"
        ? countsRow.prep_last_generated_at
        : null,
    resumesTotal: toCount(countsRow.resumes_total),
    resumesApproved: toCount(countsRow.resumes_approved),
    hasPrimaryResume: countsRow.has_primary_resume === true,
    agentDecisionsToday: toCount(countsRow.agent_decisions_today),
  };

  const [profileRes, agentRes, balanceRes, walletRes, applicationsRes, interviewsRes, activityRes, masterResumeRes, topMatchesRes] =
    await Promise.all([
      client
        .from("profiles")
        .select("full_name,headline,onboarding_completed")
        .eq("id", userId)
        .maybeSingle(),
      client
        .from("application_agent_settings")
        .select(
          "mode,paused,daily_application_limit,minimum_match_score,default_apply_method"
        )
        .eq("user_id", userId)
        .maybeSingle(),
      client
        .from("credit_balances")
        .select("wallet_balance_cents,interview_passes,live_unlimited_until")
        .eq("user_id", userId)
        .maybeSingle(),
      client
        .from("credit_transactions")
        .select("id,credit_type,delta,amount_cents,reason,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(WALLET_ACTIVITY_LIMIT),
      client
        .from("applications")
        .select(
          "id,company_name,role_title,status,match_score_snapshot,submitted_at,last_event_at"
        )
        .eq("user_id", userId)
        .order("last_event_at", { ascending: false })
        .limit(RECENT_APPLICATION_LIMIT),
      client
        .from("interviews")
        .select(
          "id,stage,round_number,status,scheduled_at,application_id"
        )
        .eq("user_id", userId)
        .in("status", ["invited", "scheduled", "ready"])
        .order("scheduled_at", { ascending: true })
        .limit(UPCOMING_INTERVIEW_LIMIT),
      client
        .from("candidate_activity_events")
        .select(ACTIVITY_COLUMNS)
        .eq("user_id", userId)
        .order("occurred_at", { ascending: false })
        .limit(ACTIVITY_LIMIT),
      client
        .from("resumes")
        .select("id,file_name,is_master,is_approved")
        .eq("user_id", userId)
        .eq("is_master", true)
        .maybeSingle(),
      getRecommendedJobs(client, userId, { limit: TOP_STRONG_MATCH_LIMIT }),
    ]);

  const firstError = [
    profileRes,
    agentRes,
    balanceRes,
    walletRes,
    applicationsRes,
    interviewsRes,
    activityRes,
    masterResumeRes,
  ].find((r) => r.error);
  if (firstError?.error) {
    throw new Error(
      `Could not load the candidate dashboard: ${firstError.error.message}`
    );
  }

  const profile = (profileRes.data ?? null) as {
    full_name?: string | null;
    headline?: string | null;
    onboarding_completed?: boolean | null;
  } | null;

  const balanceRow = (balanceRes.data ?? null) as {
    wallet_balance_cents?: number | null;
    interview_passes?: number | null;
    live_unlimited_until?: string | null;
  } | null;
  const walletBalanceCents = toCount(balanceRow?.wallet_balance_cents);

  const recentWallet: CandidateWalletMovement[] = (
    (walletRes.data ?? []) as Array<Record<string, unknown>>
  ).map((t) => ({
    id: String(t.id ?? ""),
    creditType: typeof t.credit_type === "string" ? t.credit_type : "unknown",
    delta: toSignedAmount(t.delta),
    amountCents: toCount(t.amount_cents),
    reason: typeof t.reason === "string" ? t.reason : null,
    at: typeof t.created_at === "string" ? t.created_at : new Date().toISOString(),
  }));

  const recentApplications: CandidateDashboardApplication[] = (
    (applicationsRes.data ?? []) as Array<Record<string, unknown>>
  ).map((a) => ({
    id: String(a.id ?? ""),
    companyName: typeof a.company_name === "string" ? a.company_name : "An employer",
    roleTitle: typeof a.role_title === "string" ? a.role_title : "A role",
    status: typeof a.status === "string" ? a.status : "unknown",
    matchScore:
      typeof a.match_score_snapshot === "number" ? a.match_score_snapshot : null,
    submittedAt: typeof a.submitted_at === "string" ? a.submitted_at : null,
    lastEventAt: typeof a.last_event_at === "string" ? a.last_event_at : null,
  }));

  const upcomingInterviews: CandidateDashboardInterview[] = (
    (interviewsRes.data ?? []) as Array<Record<string, unknown>>
  ).map((i) => ({
    id: String(i.id ?? ""),
    stage: typeof i.stage === "string" ? i.stage : null,
    roundNumber: typeof i.round_number === "number" ? i.round_number : null,
    status: typeof i.status === "string" ? i.status : "unknown",
    scheduledAt: typeof i.scheduled_at === "string" ? i.scheduled_at : null,
    applicationId: typeof i.application_id === "string" ? i.application_id : null,
  }));

  const activity: CandidateDashboardActivityItem[] = (
    (activityRes.data ?? []) as Array<Record<string, unknown>>
  )
    .map(projectActivityItem)
    .filter((item): item is CandidateDashboardActivityItem => item !== null);

  // The attention list is a subset of the feed, not a second query: an event
  // that needs the candidate to act is one the feed already contains. Reading
  // it twice would let the two disagree.
  const needsAttention = activity.filter((item) =>
    CANDIDATE_ACTIVITY_ATTENTION_TYPES.includes(item.eventType)
  );

  const masterResume = (masterResumeRes.data ?? null) as {
    id?: string | null;
    file_name?: string | null;
  } | null;

  // The list is filtered at the candidate's own threshold, the same number that
  // produced `counts.strongMatches`, so the few cards the page shows and the
  // exact figure it reports come from the same rule. A display list and a total
  // have different jobs; the list is allowed to be short, the total is not.
  const topStrongMatches = (topMatchesRes as CandidateJob[]).filter(
    (job) => (job.match_score ?? 0) >= threshold
  );

  return {
    candidate: {
      name: profile?.full_name ?? null,
      headline: profile?.headline ?? null,
      onboardingCompleted: profile?.onboarding_completed === true,
    },
    counts,
    agent: projectAgent(
      (agentRes.data ?? null) as AgentRow | null,
      counts.agentDecisionsToday
    ),
    resume: {
      total: counts.resumesTotal,
      approved: counts.resumesApproved,
      // Ready means an uploaded, approved resume exists -- not merely a file.
      ready: counts.resumesApproved > 0,
      primaryResumeId: masterResume?.id ?? null,
      primaryFileName: masterResume?.file_name ?? null,
    },
    wallet: {
      balanceCents: walletBalanceCents,
      canApply: walletBalanceCents >= MINIMUM_APPLY_CHARGE_CENTS,
      interviewPasses: toCount(balanceRow?.interview_passes),
      liveUnlimitedUntil:
        typeof balanceRow?.live_unlimited_until === "string"
          ? balanceRow.live_unlimited_until
          : null,
      recent: recentWallet,
    },
    topStrongMatches,
    recentApplications,
    upcomingInterviews,
    activity,
    needsAttention,
    generatedAt: new Date().toISOString(),
  };
}

export { emptyResume, emptyWallet };
