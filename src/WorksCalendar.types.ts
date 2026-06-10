import type { ReactNode } from 'react';
import type { LeftRailAction } from './ui/LeftRail';
import type { FocusChipDef } from './ui/FocusChips';
import type { GroupByInput } from './hooks/useNormalizedConfig.ts';
import type { SortConfig } from './types/grouping.ts';
import type { FilterField } from './filters/filterSchema';
import type { LocationData, LocationProvider } from './types/assets';
import type { ViewId } from './core/viewScope';
import type { WorksCalendarEvent } from './types/events';
import type { DispatchMissionCandidate, DispatchMissionReadiness } from './views/DispatchView';
import type { ResourcePool } from 'works-calendar-engine';
import type { CascadeConfig } from './ui/CascadePanel';
import type { MaintenanceRule } from './types/maintenance';

export type { WorksCalendarEvent, DispatchMissionCandidate, DispatchMissionReadiness };

export type DispatchEvaluator = (
  assetId: string,
  missionId: string,
  asOf: Date,
) => DispatchMissionReadiness;

export type CalendarView = ViewId;
export type CalendarRole = 'admin' | 'user' | 'readonly';

export type ScheduleInstantiationLimits = {
  previewMax?: number;
  createMax?: number;
};

type UnknownRecord = Record<string, unknown>;

/**
 * Persisted host-configurable settings — the blob behind ConfigPanel, stored
 * per `calendarId` (localStorage by default). A handful of well-known top-level
 * keys are typed; everything else is surfaced as `unknown` through the index
 * signature, so values read off ad-hoc keys should be narrowed with a cast or
 * guard at the call site. Treat it as a loosely-validated bag, not a strict
 * schema — the host app owns the source of truth.
 */
export type WorksCalendarConfig = {
  /** Calendar display name shown in the toolbar. */
  title?: string;
  /** Category name treated as "on-call" by the scheduling views. */
  onCallCategory?: string;
  /** First-run / setup wizard state (preferred theme, completion flag, …). */
  setup?: { preferredTheme?: string; completed?: boolean; [key: string]: unknown };
  /** Display preferences (start-of-week, default view, enabled views, …). */
  display?: {
    weekStartDay?: number;
    defaultView?: string;
    enabledViews?: string[];
    dayStart?: number;
    dayEnd?: number;
    showWeekNumbers?: boolean;
    enlargeMonthRowOnHover?: boolean;
    /**
     * Which top-level chrome regions render. Each flag defaults to `true`
     * when omitted (full chrome). The matching `show*` props on
     * `WorksCalendar` override these per-render when provided.
     */
    chrome?: {
      leftRail?: boolean;
      rightPanel?: boolean;
      toolbar?: boolean;
      viewSwitcher?: boolean;
    };
    [key: string]: unknown;
  };
  /** Filter UI label overrides (group labels for Categories/People/Sources/More). */
  filterUi?: {
    groupLabels?: {
      categories?: string;
      resources?: string;
      sources?: string;
      more?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Hover card field visibility toggles. */
  hoverCard?: {
    showTime?: boolean;
    showCategory?: boolean;
    showResource?: boolean;
    showMeta?: boolean;
    showNotes?: boolean;
    [key: string]: unknown;
  };
  /** Per-category custom field definitions used by the EventForm. */
  eventFields?: Record<string, UnknownRecord[]>;
  /** Team registry — roles, bases, regions, member records and label overrides. */
  team?: {
    /** Display labels for role dropdowns (e.g. "Team Lead", "Software Engineer"). */
    roles?: string[];
    /** Named locations (bases / buildings / regions). Shape `{ id, name, regionId? }`. */
    bases?: UnknownRecord[];
    /** Top-level regions that bases roll up to. Shape `{ id, name }`. */
    regions?: UnknownRecord[];
    members?: EmployeeRecord[];
    locationLabel?: string;
    assetsLabel?: string;
    [key: string]: unknown;
  };
  /** Owner-configured conflict rules consumed by `evaluateConflicts`. */
  conflicts?: { enabled?: boolean; rules?: UnknownRecord[]; [key: string]: unknown };
  /** Asset registry. */
  assets?: unknown;
  /** Asset-type definitions. */
  assetTypes?: unknown;
  /** Per-event-type requirement templates. */
  requirementTemplates?: unknown;
  /** Category definitions (colours, policies, …). */
  categoriesConfig?: unknown;
  /** Tiered approval workflow configuration. */
  approvals?: UnknownRecord;
  /** Owner-configurable request-form schema. */
  requestForm?: { fields?: UnknownRecord[]; [key: string]: unknown };
  [key: string]: unknown;
};

/**
 * @deprecated Use `WorksCalendarConfig`. Retained as an alias for internal
 * call sites that haven't migrated yet (and for the `useOwnerConfig` API).
 */
export type OwnerConfig = WorksCalendarConfig;

export type ScheduleTemplateAdapter = {
  listScheduleTemplates?: () => Promise<unknown>;
  createScheduleTemplate?: (template: UnknownRecord) => Promise<unknown>;
  deleteScheduleTemplate?: (templateId: string) => Promise<unknown>;
  [key: string]: unknown;
};
export type EmployeeId = string | number;
export type EmployeeRecord = { id: EmployeeId; name?: string; [key: string]: unknown };
export type EmployeeActionInput = { type?: string; [key: string]: unknown };
type EventGroupPatch = Record<string, unknown>;
type AssetLocationData = LocationData | null;
export type AvailabilitySavePayload = {
  status?: string;
  coveredBy?: string | null;
  [key: string]: unknown;
};

export type CalendarApi = {
  navigateTo: (date: Date) => void;
  setView: (view: CalendarView) => void;
  goToToday: () => void;
  openEvent: (id: string) => void;
  getVisibleEvents: () => WorksCalendarEvent[];
  clearFilters: () => void;
  addEvent: (defaults?: Partial<WorksCalendarEvent>) => void;
  undo: () => boolean;
  redo: () => boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Trigger the browser's print dialog, styled via @media print. */
  printView: () => void;
  /** Currently selected event IDs (bulk-select mode). */
  readonly selectedEventIds: ReadonlySet<string>;
  /** Toggle/add/clear an event from the bulk selection. */
  selectEvent: (id: string, mode?: 'toggle' | 'add' | 'clear' | 'set') => void;
  /** Select all currently visible events. */
  selectAll: () => void;
  /** Clear all bulk selections. */
  clearSelection: () => void;
};

export type WorksCalendarProps = {
  events?: WorksCalendarEvent[];
  fetchEvents?: (...args: unknown[]) => Promise<WorksCalendarEvent[]>;
  icalFeeds?: UnknownRecord[];
  /** Convenience shorthand: plain webcal/https ICS URLs auto-converted to feed objects. */
  icsSubscriptions?: string[];
  onImport?: (events: WorksCalendarEvent[]) => void;
  scheduleTemplates?: UnknownRecord[];
  scheduleTemplateAdapter?: ScheduleTemplateAdapter;
  scheduleInstantiationLimits?: ScheduleInstantiationLimits;
  onScheduleTemplateAnalytics?: (payload: UnknownRecord) => void;
  calendarId?: string;
  onConfigSave?: (config: OwnerConfig) => void;
  /**
   * Local development escape hatch. When `true`, the calendar treats the
   * current user as an owner regardless of `role` — every role/permission
   * check is bypassed. Intended only for local dev and demos; **never pass
   * `true` in production**, where access must be gated by `role` (driven by
   * the host app's auth).
   */
  devMode?: boolean;
  /**
   * Force the chrome into the compact layout regardless of the calendar's
   * container width. Useful when the calendar is wide enough to keep the
   * default desktop chrome but the host wants the slimmer toolbar / hidden
   * right panel anyway (sidebar widgets, embeds with their own chrome, etc.).
   *
   * Default (`'comfortable'` / undefined) lets container queries pick the
   * layout from the calendar's own width — `≤ 768px` → tablet rules,
   * `≤ 480px` → mobile rules. `'compact'` forces the tablet rules on at
   * any width and hides the right panel.
   */
  density?: 'comfortable' | 'compact';
  notes?: UnknownRecord;
  onNoteSave?: (note: UnknownRecord) => void;
  onNoteDelete?: (noteId: string) => void;
  onEventClick?: (event: WorksCalendarEvent) => void;
  onEventSave?: (event: WorksCalendarEvent) => void;
  onEventMove?: (event: WorksCalendarEvent, newStart: Date, newEnd: Date) => void;
  onEventResize?: (event: WorksCalendarEvent, newStart: Date, newEnd: Date) => void;
  onEventDelete?: (eventId: string) => void;
  onEventGroupChange?: (event: WorksCalendarEvent, patch: EventGroupPatch) => void;
  /** Unified change callback fired on every create, update, move, or delete. */
  onEventChange?: (event: WorksCalendarEvent, action: 'created' | 'updated' | 'deleted' | 'moved') => void;
  onCommentAdd?: (event: WorksCalendarEvent, comment: import('./types/events').EventComment) => void;
  /** Fired when a scheduled reminder fires for the current user (method: 'callback'). */
  onReminder?: (event: WorksCalendarEvent, reminder: import('./types/events').ReminderDef) => void;
  /** Display name shown as the author of new comments added by the current user. */
  currentUserName?: string;
  onDateSelect?: (start: Date, end: Date, resourceId?: string) => void;
  onViewChange?: (view: CalendarView) => void;
  enableApprovalFlowsTab?: boolean;
  supabaseUrl?: string;
  supabaseKey?: string;
  supabaseTable?: string;
  supabaseFilter?: string;
  role?: CalendarRole;
  employees?: EmployeeRecord[];
  onEmployeeAdd?: (member: EmployeeRecord) => void;
  onEmployeeDelete?: (employeeId: EmployeeId) => void;
  onEmployeeAction?: (employeeId: EmployeeId, action: EmployeeActionInput) => void;
  onAvailabilitySave?: (payload: AvailabilitySavePayload) => void;
  onScheduleSave?: (payload: WorksCalendarEvent) => void;
  blockedWindows?: UnknownRecord[];
  /**
   * IANA timezone identifier (e.g. "America/New_York") used to display all
   * event times. Defaults to the browser's local timezone when omitted.
   */
  timezone?: string;
  /** Show a timezone selector in the toolbar that lets users change the display timezone. */
  showTimezonePicker?: boolean;
  /** Fired when the user changes the display timezone via the toolbar picker. */
  onTimezoneChange?: (timezone: string) => void;
  theme?: string;
  colorRules?: UnknownRecord[];
  businessHours?: UnknownRecord;
  renderEvent?: (event: WorksCalendarEvent, context?: UnknownRecord) => ReactNode;
  renderHoverCard?: (event: WorksCalendarEvent, onClose: () => void) => ReactNode;
  renderToolbar?: (api: CalendarApi) => ReactNode;
  /** Extra icon-button actions appended to the LeftRail after the built-in
   *  Saved-views / Focus-filters / Settings buttons. */
  leftRailExtras?: LeftRailAction[];
  /** ReactNode appended to the RightPanel after the built-in Region map
   *  + Crew on shift sections. */
  rightPanelExtras?: ReactNode;
  renderFilterBar?: (args: UnknownRecord) => ReactNode;
  renderSavedViewsBar?: (args: UnknownRecord) => ReactNode;
  /**
   * Visible quick-filter chips rendered above the view area. Opt-in:
   *   - omitted (default) → no chip row renders
   *   - `true`            → renders the library's DEFAULT_FOCUS_CHIPS
   *   - `FocusChipDef[]`  → renders that custom chip list
   */
  focusChips?: FocusChipDef[] | boolean;
  /**
   * Pending missions/requests offered as the "For mission" picker on the
   * Dispatch view.
   */
  dispatchMissions?: DispatchMissionCandidate[];
  /**
   * Per-(asset, mission) readiness evaluator for the Dispatch view.
   */
  dispatchEvaluator?: DispatchEvaluator;
  /**
   * Called when the dispatcher clicks "Assign" on an available asset row.
   */
  onDispatchAssign?: (assetId: string, missionId: string | null, asOf: Date) => void;
  emptyState?: ReactNode;
  filterSchema?: FilterField[];
  /**
   * Optional cascade scope picker for the Focus tab of the View Controls sidebar.
   */
  cascadeConfig?: CascadeConfig;
  showAddButton?: boolean;
  /** Show the full-text search bar in the toolbar. */
  showSearch?: boolean;
  /** Show a mini month calendar at the top of the sidebar for date navigation. */
  showMiniCalendar?: boolean;
  /** Show a source legend (calendar list with colour dots + toggles) at the bottom of the sidebar. */
  showCalendarLegend?: boolean;
  /** Show a banner when the browser reports no network connectivity. */
  showOfflineIndicator?: boolean;
  /**
   * Chrome visibility overrides. Each defaults to the persisted
   * `display.chrome.*` setting (editable via the setup wizard / ConfigPanel),
   * then to `true` (full chrome). Pass `false` to force a region off
   * regardless of the saved config — e.g. embedding the calendar inside a
   * host that already provides its own toolbar or side navigation.
   *
   * Note: a view that "owns its chrome" (e.g. Dispatch) still suppresses the
   * host toolbar/rails on its own; these props only widen what's hidden.
   */
  showToolbar?: boolean;
  /** Show the left icon rail (Add / Saved views / Focus / Settings). */
  showLeftRail?: boolean;
  /** Show the right panel (region map + crew on shift). */
  showRightPanel?: boolean;
  /** Show the Month / Week / Day / … view-switcher tabs. */
  showViewSwitcher?: boolean;
  /**
   * Host-defined quick-create event templates surfaced in the toolbar "New from template" dropdown.
   * Each template pre-fills the EventForm via api.addEvent(defaults).
   */
  eventTemplates?: import('./api/v1/templates').EventTemplateV1[];
  /**
   * Hide the event-template dropdown in the Add/Edit Event form.
   */
  hideEventTemplates?: boolean;
  /**
   * Category-aware resource suggester for the Add/Edit Event form.
   */
  eventResourceSuggestions?: (category: string) => Array<{ value: string; label: string }>;
  /**
   * Opt-in interactive setup landing page.
   */
  showSetupLanding?: boolean;
  initialView?: CalendarView;
  weekStartDay?: 0 | 1;
  groupBy?: GroupByInput;
  sort?: SortConfig | SortConfig[];
  showAllGroups?: boolean;

  // ── Assets view ──
  locationProvider?: LocationProvider;
  categoriesConfig?: Record<string, unknown>;
  assets?: { id: string; label: string; group?: string; meta?: Record<string, unknown> }[];
  /**
   * Dispatch view: lookup from a (from, to) facility-code pair to an
   * ordered list of lat/lng waypoints. When provided and the lookup
   * returns a non-empty path, the dispatch board's breadcrumb traces
   * those waypoints as an SVG polyline (e.g. following I-10) instead
   * of the default straight-line / 3D-arch fallback. Pure presentation
   * concern — the engine never sees it.
   */
  getRouteWaypoints?: (fromCode: string, toCode: string) => readonly { lat: number; lng: number }[] | null;
  strictAssetFiltering?: boolean;
  assetRequestCategories?: string[];
  onConflictCheck?: (event: WorksCalendarEvent, candidate: WorksCalendarEvent) => Promise<unknown>;
  onApprovalAction?: (event: WorksCalendarEvent, action: string) => void | Promise<void>;
  renderAssetLocation?: (locationData: AssetLocationData, asset: { id: string }) => ReactNode;
  /**
   * Optional renderer for the location banner of a pool row.
   */
  renderPoolLocation?: (pool: { id: string; memberIds: readonly string[] }) => ReactNode;
  renderAssetBadges?: (asset: { id: string }) => ReactNode;
  /** Maintenance rules offered in the EventForm. */
  maintenanceRules?: readonly MaintenanceRule[];
  renderConflictBody?: (args: UnknownRecord) => ReactNode;

  /**
   * Resource pools (#212). Bookings can target a pool id via
   * `event.resourcePoolId`; the engine resolves a concrete member at
   * submit time and advances the round-robin cursor.
   */
  pools?: ResourcePool[];
  /**
   * Fires whenever the engine commits a pool state change.
   */
  onPoolsChange?: (pools: ResourcePool[], meta: { sequence: number }) => void;

  /** Optional logo image displayed at the left of the toolbar. */
  logoSrc?: string;
  /** Alt text for the logo image. Treated as decorative if omitted. */
  logoAlt?: string;
  /** Optional background image URL applied to the calendar root. */
  backgroundImage?: string;
};
