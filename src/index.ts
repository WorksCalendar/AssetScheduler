/**
 * WorksCalendar — public npm exports
 */

// Default theme CSS — auto-bundled by Vite into dist/style.css
import './styles/corporate.css';

// ── Versioned public schema (engine types + serialization helpers) ───────────
export * from './api/v1/index';

export type {
  WorksCalendarEvent,
  NormalizedEvent,
  EventStatus,
  EventLifecycleState,
  EventVisualPriority,
  ReminderDef,
} from './types/events';
export { isVisualPriority, isLifecycleState, EVENT_LIFECYCLE_STATES } from './types/events';
export { default as EventStatusBadge } from './ui/EventStatusBadge';
export type { EventStatusBadgeProps } from './ui/EventStatusBadge';

// ── Ops-console shell (new layout) ───────────────────────────────────────────
export { OpsShell, OpsViewHeader, default as OpsShellDefault } from './ui/OpsShell';
export type {
  OpsShellProps, OpsViewHeaderProps, OpsTab, OpsBanner, OpsPersona, OpsThemeMode,
} from './ui/OpsShell';
export { LocationsView } from './views/LocationsView';
export type {
  LocationsViewProps, LocationItem, LocationAsset,
} from './views/LocationsView';

// ── Resource allocator (Allocate tab) ────────────────────────────────────────
export { AllocateView } from './views/AllocateView';
export type { AllocateViewProps } from './views/AllocateView';
export { evaluateCandidate, evaluateAll, compareByStatus } from './allocator/evaluate';
export type {
  CheckStatus, ResourceKind, ResourceAttributes, ResourceCandidate,
  DispatchRequirements, CheckResult, CandidateEvaluation, EvaluateOptions,
} from './allocator/types';

export type { BillableMeta, InvoiceLineItem, InvoiceStatus } from './types/billing';
export type {
  AssetHealth,
  AssetHealthStatus,
  MaintenanceMeta,
  MaintenanceRule,
  MaintenanceInterval,
  MaintenanceLifecycle,
  MeterReading,
  MeterType,
} from './types/maintenance';
export {
  computeDueStatus,
  projectNextDue,
  completeMaintenance,
} from './core/maintenance';
export type {
  DueStatus,
  DueResult,
  CurrentState,
  LastService,
  NextDueProjection,
} from './core/maintenance';
export { MaintenanceBadge }       from './ui/MaintenanceBadge';
export type { MaintenanceBadgeProps } from './ui/MaintenanceBadge';
export { AssetMaintenanceBadges } from './ui/AssetMaintenanceBadges';
export type { AssetMaintenanceBadgesProps } from './ui/AssetMaintenanceBadges';
export { MaintenanceSection }     from './ui/EventFormSections/MaintenanceSection';
export type { MaintenanceSectionProps } from './ui/EventFormSections/MaintenanceSection';
export type {
  ConfigPanelProps,
  ConfigPanelTabId,
  SaveViewHandler,
  SaveViewOptions,
  SavedViewDraft,
  SavedViewUpdateHandler,
  SourceDraft,
  ScheduleTemplateDraft,
  CalendarViewEvent,
  UpdateConfig,
  WorksCalendarConfig,
} from './types/ui';

export { WorksCalendar }                  from './WorksCalendar.tsx';
export { default as ScheduleView }        from './views/ScheduleView';

export { default as MissionHoverCard, allRequirementsMet, meetsAircraftReqs } from './ui/MissionHoverCard';
export type {
  MissionHoverCardProps,
  MissionRequest,
  MissionCrewMember,
  MissionAircraft,
  MissionLeg,
  MissionComplianceItem,
  MissionSlotKind,
} from './ui/MissionHoverCard';

// Embedder slot helpers — paired with the WorksCalendar `leftRailExtras` /
// `rightPanelExtras` props. Consumer apps wrap their custom widgets in
// these so the appended content blends with the stock chrome (theme
// tokens, section headers, icon-button styling) instead of looking
// pasted-on.
export { RightPanel, RightPanelSection } from './ui/RightPanel';
export type { RightPanelSectionProps }   from './ui/RightPanel';
export type { LeftRailAction }           from './ui/LeftRail';
export { normalizeEvent, normalizeEvents } from 'works-calendar-engine';
export { loadConfig, saveConfig, DEFAULT_CONFIG, FIELD_TYPES } from './core/configSchema';
export { applyFilters, getCategories, getResources } from './filters/filterEngine';
// CSV export is dependency-free and lives in the core entry. The .xlsx
// exporter (which needs the optional `exceljs` peer) is published under
// the `works-calendar/xlsx` subpath so it never enters the core bundle.
export { exportToCsv }                    from './export/csvExport';
export {
  toInvoiceLineItems,
  invoiceLineItemsToCSV,
  downloadInvoicesCSV,
} from './export/invoiceExport';
export type {
  InvoiceLineItemsOptions,
  InvoiceQuantitySource,
} from './export/invoiceExport';
export {
  toMaintenanceLog,
  maintenanceLogToCSV,
  downloadMaintenanceLogCSV,
} from './export/maintenanceExport';
export type {
  MaintenanceLogEntry,
  MaintenanceLogOptions,
} from './export/maintenanceExport';
export { useOwnerConfig }                 from './hooks/useOwnerConfig';
export { useRealtimeEvents }              from './hooks/useRealtimeEvents';
export { useSavedViews, serializeFilters, deserializeFilters } from './hooks/useSavedViews';
export {
  DEFAULT_FILTER_SCHEMA,
  statusField, priorityField, ownerField, tagsField, metaSelectField,
} from './filters/filterSchema';
export { createInitialFilters, buildActiveFilterPills, isEmptyFilterValue } from './filters/filterState';
export {
  THEMES,
  THEMES_BY_ID,
  THEME_IDS,
  THEME_FAMILIES,
  THEME_META,
  DEFAULT_THEME,
  buildThemeId,
  normalizeTheme,
  resolveCssTheme,
} from './styles/themes';
export type { ThemeId, ThemeFamily, ThemeMode, ThemeMeta, ThemePreview } from './styles/themes';
export {
  default as CalendarExternalForm,
  SUPPORTED_EXTERNAL_FORM_FIELD_TYPES,
} from './ui/CalendarExternalForm';
export { default as FocusChips, DEFAULT_FOCUS_CHIPS } from './ui/FocusChips';
export type { FocusChipDef, FocusChipsProps } from './ui/FocusChips';
export { default as CalendarErrorBoundary } from './ui/CalendarErrorBoundary';
export { default as CalendarLegend } from './ui/CalendarLegend';
export type { CalendarLegendProps, LegendSource } from './ui/CalendarLegend';
export { default as OfflineIndicator } from './ui/OfflineIndicator';
export { useNetworkStatus } from './hooks/useNetworkStatus';
export { useReminders } from './hooks/useReminders';
export { createLocalStorageDataAdapter } from './external/localStorageDataAdapter';
export { parseICS, fetchAndParseICS }     from './core/icalParser';
export { useDrag }                        from './hooks/useDrag';
export { useFeedEvents }                  from './hooks/useFeedEvents';
export { layoutOverlaps, layoutSpans, displayEndDay } from './core/layout';
export { validateChange }                 from './core/validator';
export { groupRows }                      from './grouping/groupRows';
export { buildFieldAccessor }             from './grouping/buildFieldAccessor';
export { useGrouping }                    from './hooks/useGroupingRows.ts';
export { createManualLocationProvider }   from './providers/ManualLocationProvider.ts';
export { DEFAULT_CATEGORIES }             from './types/assets.ts';

// ── Approvals + Workflow DSL (#209, #215, #219) ─────────────────────────────
export { transitionApproval, legalActionsFrom, LEGAL_TRANSITIONS } from './core/approvals/transitions';
export type { TransitionInput, TransitionResult, TransitionError, TransitionErrorCode } from './core/approvals/transitions';
export { verifyAuditChain, appendAuditEntry } from 'works-calendar-engine';
export { advance as advanceWorkflow, tick as tickWorkflow } from './core/workflow/advance';
export type {
  WorkflowAction, WorkflowEmitEvent, AdvanceInput, AdvanceResult,
} from './core/workflow/advance';
export { useWorkflowTicker } from './hooks/useWorkflowTicker';
export type { UseWorkflowTickerOptions } from './hooks/useWorkflowTicker';
export { evaluate as evaluateExpression, evaluateBool as evaluateExpressionBool, ExpressionError } from './core/workflow/expression';
export { interpolateTemplate, tryInterpolateTemplate, TemplateError } from './core/workflow/templateInterpolate';
export {
  createChannelRegistry, dispatchWorkflowEvents,
  createSlackChannel, createEmailChannel, createWebhookChannel,
} from './core/workflow/channels';
export type {
  WorkflowChannelAdapter, WorkflowChannelRegistry,
  ChannelDispatchPayload, ChannelDispatchOutcome, WorkflowDispatchReport,
  SlackChannelOptions, EmailChannelOptions, WebhookChannelOptions,
} from './core/workflow/channels';
export { validateWorkflow, validateExpressionSyntax, validateTemplateSyntax, hasBlockingErrors } from './core/workflow/validate';
export type {
  ValidationCode, ValidationIssue, ValidationSeverity, ValidateWorkflowOptions,
} from './core/workflow/validate';
export type {
  Workflow, WorkflowNode, WorkflowEdge, WorkflowInstance, WorkflowInstanceStatus,
  WorkflowHistoryEntry, WorkflowOutcome, WorkflowTrigger, EdgeGuard,
  WorkflowConditionNode, WorkflowApprovalNode, WorkflowNotifyNode, WorkflowTerminalNode,
  WorkflowParallelNode, WorkflowJoinNode, ParallelMode,
  ParallelBranchState, WorkflowParallelFrame,
  TimeoutBehavior,
} from './core/workflow/workflowSchema';
export { findNode as findWorkflowNode, resolveNextEdge as resolveWorkflowEdge } from './core/workflow/workflowSchema';
export {
  WORKFLOW_TEMPLATES,
  singleApproverWorkflow, twoTierApproverWorkflow, conditionalByCostWorkflow,
  slaEscalationWorkflow, parallelSecurityAndFinanceApproval,
} from './core/workflow/templates';

// ── Booking holds (#211) ────────────────────────────────────────────────────
export { createHoldRegistry, findBlockingHold } from 'works-calendar-engine';
export type {
  Hold, HoldWindow, HoldRegistry,
  AcquireHoldInput, AcquireHoldResult, AcquireHoldError, AcquireHoldErrorCode,
  CreateHoldRegistryOptions,
} from 'works-calendar-engine';
export { useBookingHold } from './hooks/useBookingHold';
export type { UseBookingHoldOptions, UseBookingHoldState } from './hooks/useBookingHold';

// ── Resource pools (#212) ───────────────────────────────────────────────────
export { loadPools, loadPoolsDetailed, savePools, clearPools, poolStorageKey } from './core/pools/poolStore';
export type { LoadPoolsResult } from './core/pools/poolStore';
export { validatePools } from 'works-calendar-engine';
export type { PoolIntegrityIssue, PoolIntegrityReport } from 'works-calendar-engine';
export type { ResourcePool, PoolStrategy, PoolType } from 'works-calendar-engine';
// ── Resource pools v2 — query DSL (#386) ───────────────────────────────────
export { evaluateQuery } from 'works-calendar-engine';
export type { QueryContext, QueryEvaluation, QueryExclusion } from 'works-calendar-engine';
export type { ResourceQuery, ResourceQueryValue, DistanceFrom, WithinDistance } from 'works-calendar-engine';
// ── Resource pools v2 — geo + location adapters (#386) ─────────────────────
export { haversineKm, haversineMiles, isLatLon } from 'works-calendar-engine';
export type { LatLon } from 'works-calendar-engine';
export {
  attachLocations,
  createStaticLocationAdapter,
  createMetaPathLocationAdapter,
} from 'works-calendar-engine';
export type { ResourceLocation, ResourceLocationAdapter } from 'works-calendar-engine';
// ── Resource pools v2 — UI components (#386) ──────────────────────────────
export { default as PoolCard }    from './ui/pools/PoolCard';
export type { PoolCardProps }      from './ui/pools/PoolCard';
export { default as PoolBuilder } from './ui/pools/PoolBuilder';
export type { PoolBuilderProps, CapabilityOption } from './ui/pools/PoolBuilder';
export { default as ClauseEditor } from './ui/pools/ClauseEditor';
export type { ClauseEditorProps } from './ui/pools/ClauseEditor';
export { default as AdvancedRulesEditor } from './ui/pools/AdvancedRulesEditor';
export type { AdvancedRulesEditorProps } from './ui/pools/AdvancedRulesEditor';
export { summarizePool, summarizeQuery } from './ui/pools/poolSummary';
export type { PoolSummary } from './ui/pools/poolSummary';
export { derivePathSuggestions } from './ui/pools/pathSuggestions';
export { validateClausePaths } from './ui/pools/validateClausePaths';
export type { ValidateClausePathsResult, ClausePathIssue } from './ui/pools/validateClausePaths';
export type { CapabilityRange } from './ui/pools/PoolBuilder';
// ── CalendarConfig — standard config.json shape (#386 wizard) ─────────────
export { parseConfig } from './core/config/parseConfig';
export type { ParseConfigResult } from './core/config/parseConfig';
export { serializeConfig } from './core/config/serializeConfig';
export type {
  CalendarConfig, ConfigLabels, ConfigResourceType, ConfigRole,
  ConfigResource, ConfigRequirement, ConfigRequirementSlot,
  ConfigRequirementSeverity,
  ConfigSeedEvent, ConfigSettings, ChromeSettings,
} from './core/config/calendarConfig';
export { validateConfig } from './core/config/validateConfig';
export type {
  ValidateConfigResult, ConfigIssue, ConfigIssueSeverity,
} from './core/config/validateConfig';
export {
  PROFILE_PRESETS, listProfilePresets, applyProfilePreset,
} from './core/config/profilePresets';
export type { ProfileId, ProfilePreset } from './core/config/profilePresets';
export { getProfileSampleData, applyProfileSampleData } from './core/config/profilePresets';
export { resolveLabels } from './core/config/resolveLabels';
export type { ResolvedLabels } from './core/config/resolveLabels';
export { default as ConfigWizard } from './ui/wizard/ConfigWizard';
export type { ConfigWizardProps, ConfigWizardStepId } from './ui/wizard/ConfigWizard';
// ── Requirements engine — runtime consumer for the templates (#386) ──────
export { evaluateRequirements } from 'works-calendar-engine';
export type {
  EvaluateRequirementsInput, RequirementsEvaluation, RequirementShortfall,
} from 'works-calendar-engine';
export { gateEventRequirements } from 'works-calendar-engine';
export type { GateEventRequirementsInput } from 'works-calendar-engine';

// ── Lifecycle event bus (#216) ──────────────────────────────────────────────
export { EventBus, channelForApprovalTransition } from 'works-calendar-engine';
export type {
  EventBusChannel, BookingChannel, AssignmentChannel,
  BookingLifecyclePayload, AssignmentLifecyclePayload,
  EventBusPayload, EventBusHandler, EventBusUnsubscribe, EventBusOptions,
} from 'works-calendar-engine';

export { evaluateGeoConflicts, geoConflictRules } from 'works-calendar-engine';
export type {
  GeoConflictRule, GeoTravelFeasibilityRule,
  GeoEventInput, GeoConflictViolation,
} from 'works-calendar-engine';

// ── Travel-mode "time to arrive" — car / walking / aircraft profiles ────────
export {
  estimateTravelMinutes,
  effectiveSpeedKph,
  resolveTravelProfile,
  CAR_PROFILE,
  WALKING_PROFILE,
  LIGHT_PISTON,
  TURBOPROP,
  BUSINESS_JET,
  AIRLINER,
  AIRCRAFT_PROFILES,
  DEFAULT_AIRCRAFT_PROFILE,
  TRAVEL_PROFILE_BY_MODE,
  evaluateTravelFeasibility,
  travelFeasibilityRule,
} from './core/travel';
export type {
  TravelMode,
  TravelProfile,
  SurfaceTravelProfile,
  AircraftPerformanceProfile,
  AircraftProfileId,
  TravelFeasibilityRule,
  TravelFeasibilityViolation,
} from './core/travel';

export { evaluateConflicts, CONFLICT_RULE_TYPES } from 'works-calendar-engine';
export type {
  ConflictRule,
  ConflictEvent,
  ConflictEvaluationResult,
  EvaluateConflictsInput,
  ResourceOverlapRule,
  CategoryMutexRule,
  MinRestRule,
  CapacityOverflowRule,
  OutsideBusinessHoursRule,
  PolicyViolationRule,
  HoldConflictRule,
  AvailabilityViolationRule,
} from 'works-calendar-engine';
