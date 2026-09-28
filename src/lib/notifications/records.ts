/**
 * Notification records service (Phase 2K).
 *
 * The in-app surface. Every read is scoped to the recipient's own rows
 * (candidate) or own rows within an organization (employer member); the user
 * id always comes from the auth session, never from request input. Writes in
 * this module are intentionally thin: marking read (read_at only) is the whole
 * browser write surface — the route UPDATE column grant backs this up.
 *
 * Server-side writes (cron reminders, webhook-emitted employer billing events)
 * use `createNotification` / `createNotificationOnce` with a service-role
 * client. `createNotificationOnce` dedupes on (recipient_user_id, dedupe_key)
 * by tolerating the partial-unique-index violation, which is exactly what the
 * SQL recorder (odesseus_private.record_notification) does with
 * `ON CONFLICT ... DO NOTHING`.
 */

import type { Database } from "@/types/database";
import type { NotificationType } from "./catalog";
import type { NotificationClient } from "./service";

export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];
export type NotificationInsert = Database["public"]["Tables"]["notifications"]["Insert"];

export type NotificationListOptions = {
  /** Page size; default 25, capped at 50. */
  limit?: number;
  /** Cursor: only rows strictly older than this created_at (descending feed). */
  before?: string;
  /** Unread only. */
  unreadOnly?: boolean;
  /** Filter by type. */
  type?: NotificationType;
  /** Employer feed: require this organization (member scoping). */
  organizationId?: string;
};

export type NotificationListPage = {
  items: NotificationRow[];
  /** Cursor for the next page, null when the feed is exhausted. */
  nextCursor: string | null;
};

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

/**
 * The recipient's notification feed, newest first.
 *
 * `before` is an exclusive created_at cursor so a client paging down can
 * request strictly-older rows without re-reading the last item. RLS enforces
 * that the returned rows are the caller's own; the filters here are
 * convenience, not security.
 */
export async function listNotifications(
  client: NotificationClient,
  userId: string,
  options: NotificationListOptions = {}
): Promise<NotificationListPage> {
  const limit = Math.min(
    Math.max(options.limit ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE
  );

  let query = client
    .from("notifications")
    .select("*")
    .eq("recipient_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit + 1); // fetch one extra row to learn whether a next page exists

  if (options.organizationId) query = query.eq("organization_id", options.organizationId);
  if (options.unreadOnly) query = query.is("read_at", null);
  if (options.type) query = query.eq("notification_type", options.type);
  if (options.before) query = query.lt("created_at", options.before);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Could not load notifications: ${error.message}`);
  }

  const rows = (data ?? []) as NotificationRow[];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].created_at : null;

  return { items, nextCursor };
}

/**
 * The recipient's unread count. Uses an exact head count so the browser never
 * downloads rows just to show a badge; falls back to the returned row count
 * only when the head-query count is not populated.
 */
export async function getUnreadNotificationCount(
  client: NotificationClient,
  userId: string,
  options: { organizationId?: string } = {}
): Promise<number> {
  let query = client
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", userId)
    .is("read_at", null);

  if (options.organizationId) query = query.eq("organization_id", options.organizationId);

  const { count, data, error } = await query;
  if (error) {
    throw new Error(`Could not count unread notifications: ${error.message}`);
  }
  return typeof count === "number" ? count : (data ?? []).length;
}

/** Marks the given notifications read. Only the recipient's own rows match. */
export async function markNotificationsRead(
  client: NotificationClient,
  userId: string,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", userId)
    .in("id", ids)
    .is("read_at", null); // never rewrites an already-read row

  if (error) {
    throw new Error(`Could not mark notifications read: ${error.message}`);
  }
}

/** Marks every unread notification of the recipient (optionally org-scoped) read. */
export async function markAllNotificationsRead(
  client: NotificationClient,
  userId: string,
  options: { organizationId?: string } = {}
): Promise<void> {
  let query = client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", userId)
    .is("read_at", null);

  if (options.organizationId) query = query.eq("organization_id", options.organizationId);

  const { error } = await query;
  if (error) {
    throw new Error(`Could not mark notifications read: ${error.message}`);
  }
}

export type CreateNotificationInput = Pick<
  NotificationInsert,
  | "recipient_user_id"
  | "recipient_type"
  | "notification_type"
  | "title"
  | "entity_type"
  | "entity_id"
> &
  Partial<
    Pick<
      NotificationInsert,
      | "organization_id"
      | "message"
      | "action_url"
      | "priority"
      | "metadata"
      | "dedupe_key"
    >
  >;

/** Server-side notification write (service-role client). */
export async function createNotification(
  client: NotificationClient,
  input: CreateNotificationInput
): Promise<NotificationRow> {
  const { data, error } = await client
    .from("notifications")
    .insert(input)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Could not create notification: ${error.message}`);
  }
  return data;
}

/**
 * Server-side notification write that tolerates the (recipient_user_id,
 * dedupe_key) partial-unique-index collision. Returns null when the dedupe key
 * already produced a notification for this recipient — replayed crons and
 * redelivered webhooks are the reason that happens.
 */
export async function createNotificationOnce(
  client: NotificationClient,
  input: CreateNotificationInput
): Promise<NotificationRow | null> {
  const { data, error } = await client
    .from("notifications")
    .insert(input)
    .select("*")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") return null;
    throw new Error(`Could not create notification: ${error.message}`);
  }
  return data;
}