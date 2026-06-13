/**
 * CalendarAdapter — the formal integration contract.
 *
 * Every external data-source adapter implements this interface.  The
 * calendar host imports a concrete adapter and passes it wherever it needs
 * to load or mutate remote event data.
 *
 * Method availability:
 *   loadRange   — required; all adapters must implement read
 *   createEvent  — optional; read-only sources (ICS, public feeds) omit this
 *   updateEvent  — optional
 *   deleteEvent  — optional
 *   subscribe    — optional; polling or push sources implement this
 *   importFeed   — optional; batch-import (ICS download, JSON export, etc.)
 *   exportFeed   — optional; batch-export to the adapter's native format
 *
 * @example
 *   const adapter = new RestAdapter({ baseUrl: '/api/events' });
 *   const events  = await adapter.loadRange(start, end);
 *   await adapter.createEvent({ title: 'Sprint kick-off', start, end });
 *   const unsub = adapter.subscribe?.(change => render(change));
 */

import type { CalendarEventV1 } from '../types';
import type {
  ScheduleTemplateV1,
  ScheduleInstantiationRequestV1,
  ScheduleInstantiationResultV1,
} from '../templates';
import type { EventBus } from 'works-calendar-engine';
import type { AcquireHoldInput, AcquireHoldResult } from 'works-calendar-engine';

// ─── Change notification types ────────────────────────────────────────────────

/**
 * A single change emitted by `subscribe()`.
 *
 * `reload`  — replace the entire visible event set (used after polling)
 * `insert`  — a new event appeared in the data source
 * `update`  — an existing event was modified
 * `delete`  — an event was removed
 */
export type AdapterChange =
  | { readonly type: 'reload'; readonly events: CalendarEventV1[] }
  | { readonly type: 'insert'; readonly event:  CalendarEventV1 }
  | { readonly type: 'update'; readonly event:  CalendarEventV1 }
  | { readonly type: 'delete'; readonly id:     string };

/** Callback for live event changes. */
export type AdapterChangeCallback = (change: AdapterChange) => void;

/** Call to stop receiving change notifications. */
export type AdapterUnsubscribe = () => void;

/** Connection status used by adapters that maintain persistent connections. */
export type AdapterStatus = 'idle' | 'connecting' | 'live' | 'error' | 'disabled';

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface CalendarAdapter {
  /**
   * Load all events overlapping the [start, end) range.
   *
   * Called whenever the calendar navigates to a new range.
   * `signal` is provided for cancellation — abort in-flight requests when the
   * range changes before the previous request completes.
   */
  loadRange(start: Date, end: Date, signal?: AbortSignal): Promise<CalendarEventV1[]>;

  /**
   * Create a new event in the remote data source.
   * Returns the created event (may include server-assigned id, timestamps, etc.).
   */
  createEvent?(event: CalendarEventV1): Promise<CalendarEventV1>;

  /**
   * Update an existing event.  `patch` contains only the fields to change.
   * Returns the full updated event.
   */
  updateEvent?(id: string, patch: Partial<CalendarEventV1>): Promise<CalendarEventV1>;

  /**
   * Permanently remove an event from the remote data source.
   */
  deleteEvent?(id: string): Promise<void>;

  /**
   * Subscribe to live changes from the data source.
   *
   * Returns an unsubscribe function — call it to stop receiving events and
   * tear down any persistent connections (WS, Supabase channel, polling timer).
   *
   * The callback receives an `AdapterChange`:
   *   - Realtime adapters emit `insert` / `update` / `delete` per row.
   *   - Polling adapters emit `reload` with the full refreshed event list.
   */
  subscribe?(callback: AdapterChangeCallback): AdapterUnsubscribe;

  /**
   * Batch-import events from the adapter's native source format.
   *
   * For ICS adapters this fetches and parses the feed URL.
   * For REST adapters this might download a bulk JSON export.
   *
   * `options.rangeStart` / `options.rangeEnd` scope the import window.
   * Returns the full list of imported events.
   */
  importFeed?(options?: {
    rangeStart?: Date;
    rangeEnd?: Date;
  }): Promise<CalendarEventV1[]>;

  /**
   * Batch-export the given events to the adapter's native serialization format.
   *
   * For ICS adapters, returns an RFC 5545 VCALENDAR string.
   * For REST adapters, returns a JSON string.
   *
   * The string is suitable for file download or transmission to another system.
   */
  exportFeed?(events: CalendarEventV1[]): Promise<string>;

  /** List reusable schedule templates (for Add Schedule flows). */
  listScheduleTemplates?(): Promise<ScheduleTemplateV1[]>;

  /** Create a schedule template. */
  createScheduleTemplate?(template: Omit<ScheduleTemplateV1, 'id'>): Promise<ScheduleTemplateV1>;

  /** Update a schedule template. */
  updateScheduleTemplate?(id: string, patch: Partial<ScheduleTemplateV1>): Promise<ScheduleTemplateV1>;

  /** Delete a schedule template. */
  deleteScheduleTemplate?(id: string): Promise<void>;

  /** Instantiate a schedule template into concrete master events. */
  instantiateScheduleTemplate?(request: ScheduleInstantiationRequestV1): Promise<ScheduleInstantiationResultV1>;

  /**
   * Acquire a short-lived soft lock on a `(resource, window)` pair
   * (issue #211). While the hold is active, other holders that attempt
   * the same slot see a soft `hold-conflict` violation through the
   * conflict engine. The submit flow typically acquires on form open
   * and releases on submit/close.
   *
   * Single-process hosts back this with an in-memory
   * `createHoldRegistry()`. Multi-process hosts forward to a shared
   * store (Redis, Postgres row lock, etc.) so sibling nodes see the
   * hold.
   *
   * Returns the acquired `Hold` on success or an `AcquireHoldError`
   * when a different holder already owns an overlapping live hold.
   * Same-holder re-acquisition refreshes the TTL in place.
   */
  acquireHold?(input: AcquireHoldInput): Promise<AcquireHoldResult> | AcquireHoldResult;

  /**
   * Release a previously-acquired hold by id (issue #211). Idempotent —
   * missing ids, already-expired holds, and double-release are silent
   * no-ops. Safe to call on submit success and on form close.
   */
  releaseHold?(holdId: string): Promise<void> | void;

  /**
   * Subscribe to the engine's lifecycle `EventBus` (issue #216).
   *
   * Called once during adapter registration when the host has configured a
   * `bus` on the engine. Adapters implement this to fan out
   * `booking.requested | approved | denied | cancelled | completed` (and
   * `assignment.created | removed`) to Slack, webhooks, billing, etc.
   *
   * Separate from `subscribe` (which delivers `AdapterChange` from the
   * remote data source) because the two run in opposite directions —
   * `subscribe` is ingress, `subscribeLifecycle` is egress.
   *
   * Handlers run async (next microtask) and are error-isolated — a throw
   * in one subscriber does not affect siblings.
   */
  subscribeLifecycle?(bus: EventBus): void;
}
