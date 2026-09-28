/**
 * The authoritative candidate activity event vocabulary.
 *
 * This list is the TypeScript half of a two-sided contract. The other half is
 * the `candidate_activity_events_event_type_check` constraint added in
 * migration 20261027000000. `tests/integration/migration-candidate-activity-events.test.ts`
 * compares the two sets in both directions, so a status added on one side
 * without the other fails the build rather than quietly widening the domain.
 *
 * Every value below is emitted by a trigger on the table that records the fact,
 * so the list is a description of what the system does rather than a wish list.
 * Where the wording matters, the reason is in the migration comment beside the
 * trigger.
 *
 * The grouping is the candidate's own mental model of their search, which is
 * not the same as the order the events occur in:
 *
 *   finding work       job_matched, job_saved
 *   preparing          resume_uploaded, resume_optimized
 *   applying           application_queued, application_needs_review,
 *                      application_needs_input, application_held,
 *                      application_submitted, application_verified,
 *                      application_failed
 *   interviewing       interview_added, mock_interview_completed
 *   money              wallet_charged, wallet_topped_up
 *   automation         agent_paused, agent_resumed
 */
export const CANDIDATE_ACTIVITY_EVENT_TYPES = [
  "job_matched",
  "job_saved",
  "resume_uploaded",
  "resume_optimized",
  "application_queued",
  "application_needs_review",
  "application_needs_input",
  "application_held",
  "application_submitted",
  "application_verified",
  "application_failed",
  "interview_added",
  "mock_interview_completed",
  "wallet_charged",
  "wallet_topped_up",
  "agent_paused",
  "agent_resumed",
] as const;

export type CandidateActivityEventType =
  (typeof CANDIDATE_ACTIVITY_EVENT_TYPES)[number];

/** True when the database will accept `value` for candidate_activity_events.event_type. */
export function isCandidateActivityEventType(
  value: unknown
): value is CandidateActivityEventType {
  return (
    typeof value === "string" &&
    (CANDIDATE_ACTIVITY_EVENT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Events that mean the candidate has to do something.
 *
 * This is the set the dashboard surfaces as "needs your attention", and the
 * only reason the dashboard is allowed a call-to-action at all. It is
 * deliberately a list of event types rather than a computed condition: an event
 * is written by the transition that created the obligation, so the obligation
 * and the record of it cannot drift apart the way a re-derived flag would.
 *
 * `application_held` is included because a CAPTCHA or an MFA prompt stops the
 * run until the candidate answers it. `application_needs_review` is included
 * because the rules require explicit approval before a tailored resume is
 * submitted, and a queue row that is ready to send is waiting on that decision.
 */
export const CANDIDATE_ACTIVITY_ATTENTION_TYPES: readonly CandidateActivityEventType[] =
  [
    "application_needs_review",
    "application_needs_input",
    "application_held",
  ];

/**
 * Events that mark progress in the search, as opposed to events that describe
 * a moment in it. Used for the "your search is moving" summary line, never for
 * a count the candidate did not ask for.
 */
export const CANDIDATE_ACTIVITY_MILESTONE_TYPES: readonly CandidateActivityEventType[] = [
  "application_submitted",
  "application_verified",
  "interview_added",
  "mock_interview_completed",
];

/** Events that come out of the wallet rather than the job search. */
export const CANDIDATE_ACTIVITY_WALLET_TYPES: readonly CandidateActivityEventType[] = [
  "wallet_charged",
  "wallet_topped_up",
];

export function isCandidateActivityAttention(
  eventType: CandidateActivityEventType
): boolean {
  return CANDIDATE_ACTIVITY_ATTENTION_TYPES.includes(eventType);
}

export function isCandidateActivityMilestone(
  eventType: CandidateActivityEventType
): boolean {
  return CANDIDATE_ACTIVITY_MILESTONE_TYPES.includes(eventType);
}

/**
 * The entity a feed line can link to.
 *
 * Mirrors `candidate_activity_events_entity_type_check`. It is exported because
 * the aggregation layer turns an `entity_type` into a route, and a route table
 * typed against a closed union cannot quietly accept an unhandled value.
 */
export const CANDIDATE_ACTIVITY_ENTITY_TYPES = [
  "job_opportunity",
  "resume",
  "resume_tailoring",
  "application_run",
  "application",
  "interview",
  "credit_transaction",
  "application_agent_settings",
] as const;

export type CandidateActivityEntityType =
  (typeof CANDIDATE_ACTIVITY_ENTITY_TYPES)[number];

/**
 * Where a feed line points, per entity type.
 *
 * The dashboard returns these rather than a stored URL. Routes move; a feed
 * that has been building links for a year should start 404ing on the new route
 * rather than keeping stale ones. `application_agent_settings` has no page: the
 * setting lives on the Application Agent surface, and a pause line is still
 * useful without a link.
 *
 * Returning `null` is a normal outcome, not a failure. A candidate who has
 * never opened the agent settings has no agent settings page to go to.
 */
export function candidateActivityHref(
  entityType: CandidateActivityEntityType,
  entityId: string
): string | null {
  switch (entityType) {
    case "job_opportunity":
      return `/jobs/${entityId}`;
    case "resume":
      return `/settings/documents`;
    case "resume_tailoring":
      return `/resume-tailoring/${entityId}`;
    case "application_run":
    case "application":
      return `/applications/${entityId}`;
    case "interview":
      return `/interviews/${entityId}`;
    case "credit_transaction":
    case "application_agent_settings":
      return null;
    default: {
      // Compile-time exhaustiveness: adding an entity type without deciding
      // where it links is an error here rather than a silent no-link.
      const unreachable: never = entityType;
      return unreachable;
    }
  }
}
