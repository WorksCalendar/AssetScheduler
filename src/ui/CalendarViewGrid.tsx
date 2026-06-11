import { lazy, Suspense } from 'react';
import type { ReactNode, MutableRefObject, ComponentProps } from 'react';
import ActiveFilterStrip from './ActiveFilterStrip';
import MonthView from '../views/MonthView';
import WeekView from '../views/WeekView';
import ScheduleView from '../views/ScheduleView';

const DayView         = lazy(() => import('../views/DayView'));
const AgendaView      = lazy(() => import('../views/AgendaView'));
const AssetsView      = lazy(() => import('../views/AssetsView'));
const BaseGanttView   = lazy(() => import('../views/BaseGanttView'));
const DispatchView    = lazy(() => import('../views/DispatchView'));
const PlannerView     = lazy(() => import('../views/PlannerView'));
const RequestQueueView = lazy(() => import('../views/RequestQueueView'));
import styles from '../WorksCalendar.module.css';
import type { CalObject } from '../hooks/useCalendarSetup';
import type { OwnerCfgHandle } from '../hooks/useOwnerConfig';
import type { PermissionCaps } from '../types/ui';
import type { FilterField } from '../filters/filterSchema';
import type { NormalizedEvent } from '../types/events';
import type {
  OwnerConfig,
  WorksCalendarProps,
  EmployeeRecord,
  EmployeeId,
  EmployeeActionInput,
  DispatchMissionCandidate,
  DispatchEvaluator,
} from '../WorksCalendar.types';
import type { GroupLevel } from './GroupsPanel';
import type { ResolvedLabels } from '../core/config/resolveLabels';
import type { ScheduleTemplateV1 } from '../api/v1/templates';
import type { GroupByInput } from '../hooks/useNormalizedConfig';
import type { SortConfig } from '../types/grouping';
import type {
  AssetsZoomLevel,
  LocationProvider,
  LocationData,
} from '../types/assets';
import type { ResourcePool } from 'works-calendar-engine';
import type { FormEventDraft } from '../hooks/useModalState';

interface SharedViewProps {
  currentDate: Date;
  events: NormalizedEvent[];
  onEventClick?: ((event: NormalizedEvent) => void) | undefined;
  onEventMove?: ((event: NormalizedEvent, newStart: Date, newEnd: Date) => void) | undefined;
  onEventResize?: ((event: NormalizedEvent, newStart: Date, newEnd: Date) => void) | undefined;
  onEventGroupChange?: ((event: NormalizedEvent, patch: Record<string, unknown>) => void) | undefined;
  onDateSelect?: ((start: Date, end: Date, resourceId?: string) => void) | undefined;
  config?: OwnerConfig | undefined;
  weekStartDay?: number | undefined;
  pillHoverTitle?: boolean | undefined;
  groupBy?: GroupByInput | undefined;
  sort?: SortConfig[] | null | undefined;
  showAllGroups?: boolean | undefined;
}

export interface CalendarViewGridProps {
  cal: CalObject;
  ownerCfg: OwnerCfgHandle;
  perms: PermissionCaps;
  schema: FilterField[];
  filterBarSchema: FilterField[];
  // Sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  sidebarGroupLevels: GroupLevel[];
  // Add buttons
  hasAddButton: boolean;
  hasScheduleTemplates: boolean;
  hasImport: boolean;
  profileLabels: ResolvedLabels;
  visibleScheduleTemplates: ScheduleTemplateV1[];
  onScheduleTemplateAnalytics: ((payload: Record<string, unknown>) => void) | undefined;
  // Events
  visibleEvents: NormalizedEvent[];
  expandedEvents: NormalizedEvent[];
  approvalRequestEvents: NormalizedEvent[];
  isEmpty: boolean;
  emptyState: ReactNode;
  sharedViewProps: SharedViewProps;
  // Swipe / edit
  swipeAreaRef: MutableRefObject<HTMLDivElement | null>;
  lastClickCoordsRef: MutableRefObject<{ x: number; y: number }>;
  editMode: boolean;
  // Groups
  activeGroupBy: GroupByInput;
  activeSort: SortConfig[] | null;
  activeShowAllGroups: boolean;
  // People
  configuredEmployees: EmployeeRecord[];
  // Assets / dispatch
  effectiveAssets: Array<{ id: string; label: string; group?: string | undefined; meta?: Record<string, unknown> | undefined }> | undefined;
  configuredBases: Record<string, unknown>[];
  configuredRegions: Record<string, unknown>[];
  locationLabel: string;
  assetsLabel: string;
  selectedBaseIds: string[];
  setSelectedBaseIds: (ids: string[]) => void;
  categoriesConfig: WorksCalendarProps['categoriesConfig'];
  rawPools: ResourcePool[] | undefined;
  strictAssetFiltering: boolean | undefined;
  resolveResourceLabel: ((resourceId: string) => string) | undefined;
  activeAssetsZoom: AssetsZoomLevel;
  setActiveAssetsZoom: (zoom: AssetsZoomLevel) => void;
  activeAssetsCollapsed: Set<string>;
  setActiveAssetsCollapsed: (v: Set<string>) => void;
  effectiveLocationProvider: LocationProvider | undefined;
  renderAssetLocation: ((locationData: LocationData | null, asset: { id: string }) => ReactNode) | undefined;
  renderPoolLocation: ((pool: { id: string; memberIds: readonly string[] }) => ReactNode) | undefined;
  renderAssetBadges: ((asset: { id: string }) => ReactNode) | undefined;
  dispatchMissions: DispatchMissionCandidate[] | undefined;
  dispatchEvaluator: DispatchEvaluator | undefined;
  onDispatchAssign: ((assetId: string, missionId: string | null, asOf: Date) => void) | undefined;
  getRouteWaypoints?: WorksCalendarProps['getRouteWaypoints'];
  dispatchRoutes?: WorksCalendarProps['dispatchRoutes'];
  onApprovalAction: WorksCalendarProps['onApprovalAction'];
  canRequestAsset: boolean;
  // Handlers
  setFormEvent: (ev: FormEventDraft | null) => void;
  setScheduleOpen: (v: boolean) => void;
  setImportOpen: (v: boolean) => void;
  setAssetRequestOpen: (v: boolean) => void;
  setActiveGroupBy: (v: GroupByInput) => void;
  handleClearFilters: () => void;
  handleScheduleDateSelect: (start: Date, end: Date, resourceId: string) => void;
  handlePoolDateSelect: (start: Date, end: Date, poolId: string) => void;
  handleEmployeeAddInternal: (member: EmployeeRecord) => void;
  handleEmployeeDeleteInternal: (id: EmployeeId) => void;
  handleShiftStatusChange: (ev: NormalizedEvent, status: string | null | undefined) => void;
  handleCoverageAssign: (ev: NormalizedEvent, coveringEmployeeId: string | number | null | undefined) => void;
  handleEmployeeAction: (empId: EmployeeId, actionInput: string | EmployeeActionInput) => void;
  handleEventClick: (ev: NormalizedEvent) => void;
  /** True when the current view paints its own full pane chrome. Skips
   *  the SubToolbar + active-filter strip the standard views use. */
  viewOwnsChrome?: boolean;
  /** Ready-to-render view switcher node, passed to chrome-owning views
   *  so they can slot it into their own header. */
  viewSwitcher?: ReactNode;
}

export default function CalendarViewGrid({
  cal, ownerCfg, perms, schema, filterBarSchema: _filterBarSchema,
  sidebarOpen, setSidebarOpen, sidebarGroupLevels,
  hasAddButton, hasScheduleTemplates, hasImport, profileLabels,
  visibleScheduleTemplates, onScheduleTemplateAnalytics,
  visibleEvents, expandedEvents, approvalRequestEvents, isEmpty, emptyState,
  sharedViewProps, swipeAreaRef, lastClickCoordsRef, editMode,
  activeGroupBy, activeSort, activeShowAllGroups,
  configuredEmployees, effectiveAssets, configuredBases, configuredRegions,
  locationLabel, assetsLabel, selectedBaseIds, setSelectedBaseIds,
  categoriesConfig, rawPools, strictAssetFiltering, resolveResourceLabel,
  activeAssetsZoom, setActiveAssetsZoom, activeAssetsCollapsed, setActiveAssetsCollapsed,
  effectiveLocationProvider, renderAssetLocation, renderPoolLocation, renderAssetBadges,
  dispatchMissions, dispatchEvaluator, onDispatchAssign, getRouteWaypoints, dispatchRoutes, onApprovalAction, canRequestAsset,
  setFormEvent, setScheduleOpen, setImportOpen, setAssetRequestOpen, setActiveGroupBy,
  handleClearFilters, handleScheduleDateSelect, handlePoolDateSelect,
  handleEmployeeAddInternal, handleEmployeeDeleteInternal, handleShiftStatusChange,
  handleCoverageAssign, handleEmployeeAction, handleEventClick,
  viewOwnsChrome, viewSwitcher,
}: CalendarViewGridProps) {
  // Suppress these calls to unused props (sub-toolbar + filter-strip were
  // removed in favor of single-band header + left-rail actions, but the
  // prop interface stays stable for the embedder API).
  void hasAddButton; void hasScheduleTemplates; void hasImport;
  void profileLabels; void visibleScheduleTemplates; void onScheduleTemplateAnalytics;
  void sidebarOpen; void setSidebarOpen; void sidebarGroupLevels;
  void setFormEvent; void setScheduleOpen; void setImportOpen;
  void handleClearFilters;
  return (
    <div className={styles['mainPane']} data-wc-chrome={viewOwnsChrome ? 'view-owned' : undefined}>
      <div className={styles['calendarCard']} data-wc-chrome={viewOwnsChrome ? 'view-owned' : undefined}>
        {!viewOwnsChrome && (
          <ActiveFilterStrip
            filters={cal.filters as Record<string, unknown>}
            schema={schema}
            onChange={(key, value) => cal.setFilter(key, value)}
            onClear={(key) => cal.clearFilter(key)}
            onClearAll={handleClearFilters}
          />
        )}
        <div
          ref={swipeAreaRef}
          className={styles['viewArea']}
          onClickCapture={editMode ? (e) => {
            lastClickCoordsRef.current = { x: e.clientX, y: e.clientY };
          } : undefined}
        >
          {isEmpty && emptyState ? (
            <div className={styles['emptyStateWrap']}>{emptyState}</div>
          ) : (
            <Suspense fallback={null}>
              {/* Cast: SharedViewProps uses NormalizedEvent callbacks; the time-grid views use their own internal event aliases */}
              {cal.view === 'month'    && <MonthView    {...(sharedViewProps as unknown as ComponentProps<typeof MonthView>)} />}
              {cal.view === 'week'     && <WeekView     {...(sharedViewProps as unknown as ComponentProps<typeof WeekView>)} />}
              {cal.view === 'day'      && <DayView      {...(sharedViewProps as unknown as ComponentProps<typeof DayView>)} />}
              {cal.view === 'agenda'   && <AgendaView {...({
                currentDate: cal.currentDate,
                events: visibleEvents,
                onEventClick: handleEventClick,
                onEventGroupChange: sharedViewProps.onEventGroupChange,
                groupBy: activeGroupBy,
                sort: activeSort,
                showAllGroups: activeShowAllGroups,
                employees: configuredEmployees,
              } as unknown as ComponentProps<typeof AgendaView>)} />}
              {cal.view === 'schedule' && (
                <ScheduleView
                  currentDate={cal.currentDate}
                  events={visibleEvents}
                  onEventClick={handleEventClick as unknown as (ev: unknown) => void}
                  onEventGroupChange={sharedViewProps.onEventGroupChange as unknown as ComponentProps<typeof ScheduleView>['onEventGroupChange']}
                  onDateSelect={handleScheduleDateSelect as unknown as ComponentProps<typeof ScheduleView>['onDateSelect']}
                  employees={configuredEmployees as unknown as ComponentProps<typeof ScheduleView>['employees']}
                  onEmployeeAdd={perms.canManagePeople ? handleEmployeeAddInternal : undefined}
                  onEmployeeDelete={perms.canManagePeople ? handleEmployeeDeleteInternal as unknown as ComponentProps<typeof ScheduleView>['onEmployeeDelete'] : undefined}
                  onShiftStatusChange={handleShiftStatusChange as unknown as ComponentProps<typeof ScheduleView>['onShiftStatusChange']}
                  onCoverageAssign={handleCoverageAssign as unknown as ComponentProps<typeof ScheduleView>['onCoverageAssign']}
                  onEmployeeAction={handleEmployeeAction as unknown as ComponentProps<typeof ScheduleView>['onEmployeeAction']}
                  groupBy={activeGroupBy}
                  sort={activeSort}
                  roles={(ownerCfg.config.team?.roles as unknown as string[] | undefined) ?? []}
                  bases={(ownerCfg.config.team?.bases as unknown as Array<{ id: string; name: string }> | undefined) ?? []}
                  dayWindow={cal.dayWindow}
                />
              )}
              {cal.view === 'base' && (
                <BaseGanttView {...({
                  currentDate: cal.currentDate,
                  events: visibleEvents,
                  onEventClick: handleEventClick,
                  employees: configuredEmployees,
                  assets: effectiveAssets ?? [],
                  bases: configuredBases,
                  regions: configuredRegions,
                  locationLabel,
                  assetsLabel,
                  selectedBaseIds,
                  onBaseSelectionChange: setSelectedBaseIds,
                  dayWindow: cal.dayWindow,
                } as unknown as ComponentProps<typeof BaseGanttView>)} />
              )}
              {cal.view === 'assets' && (
                <AssetsView
                  currentDate={cal.currentDate}
                  events={visibleEvents}
                  onEventClick={handleEventClick as unknown as (ev: unknown) => void}
                  onDateSelect={handleScheduleDateSelect as unknown as ComponentProps<typeof AssetsView>['onDateSelect']}
                  onPoolDateSelect={handlePoolDateSelect as unknown as ComponentProps<typeof AssetsView>['onPoolDateSelect']}
                  groupBy={activeGroupBy}
                  onGroupByChange={setActiveGroupBy}
                  categoriesConfig={(categoriesConfig ?? ownerCfg.config.categoriesConfig) as unknown as ComponentProps<typeof AssetsView>['categoriesConfig']}
                  assets={effectiveAssets as unknown as ComponentProps<typeof AssetsView>['assets']}
                  pools={rawPools ?? []}
                  strictAssetFiltering={strictAssetFiltering}
                  resolveResourceLabel={resolveResourceLabel}
                  zoomLevel={activeAssetsZoom}
                  onZoomChange={setActiveAssetsZoom}
                  collapsedGroups={activeAssetsCollapsed}
                  onCollapsedGroupsChange={setActiveAssetsCollapsed}
                  locationProvider={effectiveLocationProvider}
                  renderAssetLocation={renderAssetLocation}
                  renderPoolLocation={renderPoolLocation}
                  renderAssetBadges={renderAssetBadges}
                  onEditAssets={ownerCfg.isOwner ? () => ownerCfg.openConfigToTab('assets') : undefined}
                  onRequestAsset={canRequestAsset ? () => setAssetRequestOpen(true) : undefined}
                  approvalsConfig={ownerCfg.config.approvals}
                  onApprovalAction={onApprovalAction as unknown as ComponentProps<typeof AssetsView>['onApprovalAction']}
                  label={assetsLabel}
                  dayWindow={cal.dayWindow}
                />
              )}
              {cal.view === 'dispatch' && (
                <DispatchView {...({
                  events: expandedEvents,
                  employees: configuredEmployees,
                  assets: effectiveAssets ?? [],
                  bases: configuredBases,
                  locationLabel,
                  label: assetsLabel,
                  onEventClick: handleEventClick,
                  missions: dispatchMissions,
                  evaluateForMission: dispatchEvaluator,
                  onAssign: onDispatchAssign,
                  // Share `cal.currentDate` with the dispatch board so the
                  // calendar's source of truth flows both ways — scrubbing
                  // the dispatch slider updates the date that Month / Week /
                  // Day all read from, and vice-versa.
                  currentDate: cal.currentDate,
                  onCurrentDateChange: cal.setCurrentDate,
                  getRouteWaypoints,
                  dispatchRoutes,
                  onAsOfChange: cal.setCurrentDate,
                  viewSwitcher,
                } as unknown as ComponentProps<typeof DispatchView>)} />
              )}
              {cal.view === 'planner' && (
                <PlannerView viewSwitcher={viewSwitcher} />
              )}
              {cal.view === 'requests' && (
                <RequestQueueView
                  events={approvalRequestEvents as unknown as ComponentProps<typeof RequestQueueView>['events']}
                  approvalsConfig={ownerCfg.config.approvals}
                  onApprovalAction={onApprovalAction as unknown as ComponentProps<typeof RequestQueueView>['onApprovalAction']}
                  onEventClick={handleEventClick as unknown as ComponentProps<typeof RequestQueueView>['onEventClick']}
                />
              )}
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
