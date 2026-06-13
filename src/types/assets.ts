/**
 * Assets Tab — type contracts.
 *
 * These types describe the public surface of the Assets (Gantt/resource
 * timeline) view:
 *   - ApprovalStage / ApprovalHistoryEntry — workflow on event.meta
 *   - LocationProvider / LocationData      — swappable live-location plugin
 *   - ConflictCheckRequest / Result        — submit-flow conflict contract
 *   - CategoryDef / CategoriesConfig       — owner-configured categories
 *   - AssetsZoomLevel                      — zoom enum persisted on SavedView
 *
 * Runtime export: DEFAULT_CATEGORIES. Everything else is type-only.
 */
import type { NormalizedEvent } from './events.ts'

// ── Approval workflow ──────────────────────────────────────────────────────────

/**
 * The 5-state workflow. Lives on event.meta.approvalStage; the top-level
 * event.status field is untouched. Views other than Assets render events
 * using status; the Assets view reads approvalStage and falls back to
 * status when approvalStage is absent.
 */
export type ApprovalStageId =
  | 'requested'        // Translucent pill, "REQUESTED" label
  | 'approved'         // Solid pill (1 of 2 approvals), title as-is
  | 'finalized'        // Solid pill (2 of 2), "FINALIZED" label
  | 'pending_higher'   // Translucent + dashed border, split-decision tier-2
  | 'denied';          // Strikethrough + faded; stays visible; click → audit

export type ApprovalActionId =
  | 'submit' | 'approve' | 'deny' | 'downgrade' | 'finalize';

/**
 * Superset of `ApprovalActionId` that the history log records. `revoke`
 * is a reducer-level action (reopen a terminal stage) that does not
 * appear in the owner-configurable action menu but IS persisted in the
 * audit trail when the reducer is invoked.
 */
export type ApprovalHistoryActionId = ApprovalActionId | 'revoke';

export interface ApprovalHistoryEntry {
  action: ApprovalHistoryActionId;
  /** ISO timestamp. */
  at: string;
  /** Actor display name or id. Optional — host may redact. */
  actor?: string;
  /** Approval tier (1 or 2 for IHC-style; undefined for single-tier hosts). */
  tier?: number;
  /** Free-text rationale. Required on 'deny'; optional otherwise. */
  reason?: string;
  /**
   * Hash-chain linkage — issue #215. `prevHash` is the hash of the
   * previous entry (empty string for the first). `hash` is
   * sha256(canonicalize(entry-without-hash)). Populated by
   * `appendAuditEntry`; verified by `verifyAuditChain`. Entries without
   * these fields predate the chain and are skipped by verification.
   */
  prevHash?: string;
  hash?: string;
}

export interface ApprovalStage {
  stage: ApprovalStageId;
  /** ISO timestamp of the most recent stage transition. */
  updatedAt: string;
  /**
   * Ordered audit trail. Host app appends; calendar renders in the detail
   * drawer. Calendar never mutates this array — it's read-only from the
   * view's perspective.
   */
  history: ApprovalHistoryEntry[];
  /**
   * Optional denormalized counts for fast pill rendering. Host may populate
   * to avoid scanning history on every render. Calendar recomputes from
   * history when absent.
   */
  counts?: {
    approvals: number;
    denials: number;
    /** e.g. 2 for IHC two-tier; 1 for single-approval rental workflow. */
    requiredApprovals: number;
  };
}

// ── Location provider ──────────────────────────────────────────────────────────

/**
 * Live per-asset location data. Rendered in the sticky-column banner. Host
 * can override the banner via a renderAssetLocation render prop; default
 * renders `text`.
 */
export interface LocationData {
  /** Human-readable location string (e.g. "KPHX", "Depot 3", "In transit"). */
  text: string;
  /** Optional structured coordinates for hosts that want a map link. */
  coords?: { lat: number; lon: number } | undefined;
  /** ISO timestamp — used to show staleness in the banner. */
  asOf: string;
  /** Provider-specific status flag. */
  status: 'live' | 'stale' | 'unknown' | 'error';
  /** Optional provider-specific metadata (speed, heading, battery, etc). */
  meta?: Record<string, unknown> | undefined;
}

/**
 * LocationProvider — implemented by integrators (SkyRouter, Samsara, custom
 * HTTP, Manual). Shipped default is ManualLocationProvider, which reads
 * from resource/event meta and never polls.
 *
 * Polling (fetchLocation + refreshIntervalMs) is required.
 * Subscribe (push updates) is optional. When a provider implements
 * subscribe, the Assets view uses it and skips polling for that resource;
 * otherwise it polls at refreshIntervalMs.
 */
export interface LocationProvider {
  /** Stable id used for logs and debugging. */
  readonly id: string;

  /**
   * One-shot fetch for a single resource. Called on mount, on resource
   * visibility change, and on the polling interval when subscribe is
   * unavailable for this resource.
   */
  fetchLocation(resourceId: string, signal?: AbortSignal): Promise<LocationData>;

  /**
   * Polling cadence in ms. Applied per-resource when subscribe is
   * unavailable. Calendar clamps to a safe minimum (default 5000ms).
   * Set to 0 to disable polling (manual provider).
   */
  readonly refreshIntervalMs: number;

  /**
   * Optional push-update channel. When present, the Assets view calls
   * subscribe(resourceId, cb) instead of polling that resource. The
   * returned function must unsubscribe cleanly.
   */
  subscribe?: ((
    resourceId: string,
    onUpdate: (data: LocationData) => void,
  ) => () => void) | undefined;

  /**
   * Optional lifecycle hook called once per provider instance when the
   * Assets view mounts. Use for auth handshakes, socket connection, etc.
   */
  init?: (() => Promise<void>) | undefined;

  /** Optional cleanup hook called on unmount or provider swap. */
  dispose?: (() => void) | undefined;
}

export interface ManualLocationProviderOptions {
  /** Override the meta key location data is read from. Default 'location'. */
  metaKey?: string;
}

// ── Conflict check ─────────────────────────────────────────────────────────────

/**
 * Payload the host receives when the user submits a new request from the
 * Assets view. Host runs its own conflict query (DB, business rules,
 * overlapping approvals, etc) and returns ConflictCheckResult.
 */
export interface ConflictCheckRequest {
  resourceId: string;
  /** ISO. */
  start: string;
  /** ISO. */
  end: string;
  /** Matches CategoriesConfig.categories[].id. */
  category: string;
  /** The draft event as it would be submitted (id may be absent). */
  draft: Record<string, unknown>;
  /** Actor id/name for audit. Host may ignore. */
  requestedBy?: string;
}

export interface ConflictingEvent {
  id: string;
  title: string;
  /** ISO. */
  start: string;
  /** ISO. */
  end: string;
  requestedBy?: string;
  stage?: ApprovalStageId;
  /** Resource id this conflict belongs to — may differ from draft's. */
  resourceId?: string;
}

export interface ConflictCheckAction {
  id: 'cancel' | 'force_submit' | string;
  label: string;
  variant?: 'primary' | 'danger' | 'secondary';
  /** If true, this action suppresses the submit (host-owned workflow). */
  cancelSubmit?: boolean;
}

/**
 * Response the host returns to the calendar. If hasConflict is true,
 * calendar shows the ConflictModal with `conflicts` in the body and
 * `actions` as the button row. User can confirm to submit anyway, which
 * fires onRequestSubmit a second time with `force: true`.
 */
export interface ConflictCheckResult {
  hasConflict: boolean;
  conflicts: ConflictingEvent[];
  /**
   * Warning-level messages that don't block submission but are surfaced
   * in the modal (e.g. "Resource is in scheduled maintenance").
   */
  warnings?: string[];
  /**
   * Optional action overrides. Defaults are Cancel + "Submit Anyway".
   * Host may suppress "Submit Anyway" for hard conflicts.
   */
  actions?: ConflictCheckAction[];
}

// ── Categories ─────────────────────────────────────────────────────────────────

/**
 * Category definition. Owner configures via ConfigPanel → Categories tab.
 * Stored in calendar config (same persistence path as themes/feeds).
 * Categories drive pill hue on the Assets view and appear as a filter
 * dimension across all views.
 */
export interface CategoryDef {
  /** Stable id. Referenced by event.category. */
  id: string;
  label: string;
  /** Hex color — drives pill hue. Required; ConfigPanel enforces. */
  color: string;
  description?: string;
  /**
   * Approver-routing hint for the host. Calendar does not use this; it
   * passes through to onApprovalAction payloads.
   */
  approvalTier?: 1 | 2;
  /** Disabled categories stay in historical data but can't be selected new. */
  disabled?: boolean;
  /**
   * Booking policy — enforced by the `policy-violation` conflict rule
   * (issue #213). Host surfaces violations in the conflict drawer just
   * like overlap/capacity rules; keeps lead-time / duration / blackouts
   * as *data* so owners tune them from ConfigPanel without host JS.
   */
  policy?: BookingPolicy;
}

/**
 * Per-category booking constraints. Every field is optional; a category
 * with no policy is unconstrained. Checked by the `policy-violation`
 * conflict rule (see `src/core/conflictEngine.ts`).
 */
export interface BookingPolicy {
  /**
   * Minimum time between "now" and the event start, in minutes. Blocks
   * last-minute bookings. `0` or unset disables the check.
   */
  minLeadTimeMinutes?: number;
  /**
   * Maximum event duration in minutes. Blocks over-long holds. Unset
   * disables the check; `0` is treated as unset (any duration allowed).
   */
  maxDurationMinutes?: number;
  /**
   * Maximum days in advance the event can be booked — i.e., the event
   * start must be ≤ now + `maxAdvanceDays`. Unset disables the check.
   */
  maxAdvanceDays?: number;
  /**
   * Calendar dates on which this category may not be booked. Strings in
   * `YYYY-MM-DD` form, interpreted in the *resource's* timezone when one
   * is available, else UTC. Intended for holidays + corporate blackouts.
   */
  blackoutDates?: readonly string[];
}

export interface CategoriesConfig {
  /** Ordered list. Order drives legend + filter dropdown order. */
  categories: CategoryDef[];
  /**
   * Fallback category applied when event.category is unset or unknown.
   * Defaults to the first enabled category.
   */
  defaultCategoryId?: string | undefined;
  /**
   * Pill render style: 'hue' (full fill), 'stripe' (left edge),
   * 'border' (thin border only). Default 'hue'.
   */
  pillStyle?: 'hue' | 'stripe' | 'border' | undefined;
}

/**
 * Seed categories shipped for aviation/ops use cases. Owners edit via
 * ConfigPanel. Categories are calendar-wide, not per-view.
 */
export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { id: 'training',    label: 'Training',    color: '#4C9AFF' },
  { id: 'pr',          label: 'PR',          color: '#9F7AEA' },
  { id: 'maintenance', label: 'Maintenance', color: '#F59E0B' },
  { id: 'coverage',    label: 'Coverage',    color: '#10B981' },
  { id: 'other',       label: 'Other',       color: '#6B7280' },
];

// ── Zoom ───────────────────────────────────────────────────────────────────────

/**
 * Assets-view zoom level. Persisted on SavedView.zoomLevel; defaults to
 * 'month' when unset. Day → pxPerDay 80, Week → 30, Month → 10,
 * Quarter → 4 (see AssetsView Sprint 2).
 */
export type AssetsZoomLevel = 'day' | 'week' | 'month' | 'quarter';

// ── Render-prop helper types ───────────────────────────────────────────────────

/**
 * Signature for the optional renderAssetLocation render prop. Called once
 * per rendered sticky-column banner with the latest LocationData for that
 * resource. `resource` is the host-side resource record (see
 * EngineResource for the canonical shape).
 */
export type RenderAssetLocation = (
  data: LocationData | null,
  resource: { id: string; name?: string; meta?: Record<string, unknown> },
) => unknown

/**
 * Signature for the optional onApprovalAction callback. Calendar emits;
 * host mutates meta.approvalStage and echoes the updated event back via
 * its normal save path.
 */
export type OnApprovalAction = (
  event: NormalizedEvent,
  action: ApprovalActionId,
  payload?: { tier?: number; reason?: string },
) => void
