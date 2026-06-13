/**
 * AssetConsole — the turnkey embeddable asset-scheduler.
 *
 * Wraps the dispatch map, schedule, assets, locations, and the resource
 * allocator in one ops-console shell (banner + bottom tabs + light/dark).
 * Committing a resource in the Allocate tab writes a scheduled event back onto
 * the calendar and draws the dispatch's leg on the map, colour-coded by the
 * worst grade among its assignees; unmet requirements and double-bookings
 * surface in a persistent conflict banner.
 *
 * Assignments and the light/dark mode are controlled-or-uncontrolled, so a host
 * can either let the console own that state or drive + persist it.
 */
import { useMemo, useRef, useState } from 'react';
import { Boxes, CalendarDays, ClipboardList, Map as MapIcon, MapPin } from 'lucide-react';
import { WorksCalendar } from './WorksCalendar';
import { OpsShell, OpsViewHeader } from './ui/OpsShell';
import { OpsAlertBar } from './ui/OpsAlertBar';
import { LocationsView } from './views/LocationsView';
import { AllocateView } from './views/AllocateView';
import { AssignmentsPanel } from './views/AssignmentsPanel';
import { evaluateCandidate } from './allocator/evaluate';
import type { CalendarApi, CalendarView, WorksCalendarProps } from './WorksCalendar.types';
import type { WorksCalendarEvent } from './types/events';
import type { OpsBanner, OpsPersona, OpsTab, OpsThemeMode } from './ui/OpsShell';
import type { OpsAlertItem } from './ui/OpsAlertBar';
import type { LocationItem, LocationAsset } from './views/LocationsView';
import type { AssignmentRow } from './views/AssignmentsPanel';
import type { ResourceCandidate, DispatchRequirements } from './allocator/types';
import type { RouteFeature, RouteStatus, LngLat } from './map/MapAdapter';

const TABS: readonly OpsTab[] = [
  { id: 'dispatch', label: 'Map', icon: <MapIcon size={20} /> },
  { id: 'schedule', label: 'Schedule', icon: <CalendarDays size={20} /> },
  { id: 'assets', label: 'Assets', icon: <Boxes size={20} /> },
  { id: 'locations', label: 'Locations', icon: <MapPin size={20} /> },
  { id: 'allocate', label: 'Allocate', icon: <ClipboardList size={20} /> },
];

// Tabs that render an overlay panel instead of a calendar view.
const OVERLAY_TABS = new Set(['locations', 'allocate']);

export type AssignmentMap = Record<string, readonly string[]>;

export interface AssetConsoleProps {
  // ── Data ──────────────────────────────────────────────────────────────────
  events?: readonly WorksCalendarEvent[];
  assets?: WorksCalendarProps['assets'];
  employees?: WorksCalendarProps['employees'];
  /** Jobs to allocate resources against (the Allocate tab). */
  dispatches?: readonly DispatchRequirements[];
  /** Candidate resources (assets + crew) the allocator grades. */
  resources?: readonly ResourceCandidate[];
  locations?: readonly LocationItem[];
  locationAssets?: readonly LocationAsset[];
  /** Geographic leg per dispatch id, drawn on the map for committed jobs. */
  dispatchPaths?: Record<string, readonly LngLat[]>;

  // ── Assignment state (controlled or uncontrolled) ───────────────────────────
  /** Controlled assignment map (dispatch id → resource ids). */
  assignments?: AssignmentMap;
  /** Initial assignments when uncontrolled. */
  defaultAssignments?: AssignmentMap;
  onAssignmentsChange?: (assignments: Record<string, string[]>) => void;
  /** Map an assigned resource to the calendar `resource` id used for the
   *  scheduled write-back event. Defaults to the resource's own id. */
  resolveScheduleResource?: (resource: ResourceCandidate, dispatch: DispatchRequirements) => string;

  // ── Chrome ──────────────────────────────────────────────────────────────────
  banner: OpsBanner;
  persona?: OpsPersona;
  /** Controlled light/dark mode. */
  mode?: OpsThemeMode;
  /** Initial mode when uncontrolled. Default 'dark'. */
  defaultMode?: OpsThemeMode;
  onModeChange?: (mode: OpsThemeMode) => void;

  // ── Calendar passthrough ────────────────────────────────────────────────────
  calendarId?: string;
  getRouteWaypoints?: WorksCalendarProps['getRouteWaypoints'];
  /** Extra props forwarded to the embedded calendar / dispatch view. */
  calendarProps?: Partial<WorksCalendarProps>;
}

const EMPTY_ASSIGNMENTS: AssignmentMap = {};

function toMutable(a: AssignmentMap): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(a)) out[k] = [...v];
  return out;
}

export function AssetConsole({
  events,
  assets,
  employees,
  dispatches = [],
  resources = [],
  locations = [],
  locationAssets = [],
  dispatchPaths,
  assignments,
  defaultAssignments,
  onAssignmentsChange,
  resolveScheduleResource,
  banner,
  persona,
  mode,
  defaultMode = 'dark',
  onModeChange,
  calendarId,
  getRouteWaypoints,
  calendarProps,
}: AssetConsoleProps) {
  const [activeTab, setActiveTab] = useState<string>('dispatch');
  const apiRef = useRef<CalendarApi>(null);

  // ── Controlled / uncontrolled light-dark mode ──
  const [internalMode, setInternalMode] = useState<OpsThemeMode>(defaultMode);
  const currentMode = mode ?? internalMode;
  const toggleMode = () => {
    const next: OpsThemeMode = currentMode === 'dark' ? 'light' : 'dark';
    if (mode === undefined) setInternalMode(next);
    onModeChange?.(next);
  };

  // ── Controlled / uncontrolled assignments ──
  const [internalAssignments, setInternalAssignments] = useState<Record<string, string[]>>(() =>
    toMutable(defaultAssignments ?? EMPTY_ASSIGNMENTS),
  );
  const currentAssignments = assignments !== undefined ? toMutable(assignments) : internalAssignments;
  const commitAssignments = (next: Record<string, string[]>) => {
    if (assignments === undefined) setInternalAssignments(next);
    onAssignmentsChange?.(next);
  };

  const handleTabChange = (id: string) => {
    setActiveTab(id);
    if (!OVERLAY_TABS.has(id)) {
      apiRef.current?.setView(id as CalendarView);
    }
  };

  const handleToggleAssign = (dispatchId: string, candidateId: string) => {
    const current = currentAssignments[dispatchId] ?? [];
    const nextList = current.includes(candidateId)
      ? current.filter((id) => id !== candidateId)
      : [...current, candidateId];
    commitAssignments({ ...currentAssignments, [dispatchId]: nextList });
  };

  const dispatchById = useMemo(() => new Map(dispatches.map((d) => [d.id, d])), [dispatches]);
  const resourceById = useMemo(() => new Map(resources.map((r) => [r.id, r])), [resources]);

  // Each assignment becomes a scheduled calendar event on the resource's row,
  // so committing it shows up live on the Schedule tab.
  const assignmentEvents = useMemo<WorksCalendarEvent[]>(() => {
    const out: WorksCalendarEvent[] = [];
    for (const [dispatchId, ids] of Object.entries(currentAssignments)) {
      const d = dispatchById.get(dispatchId);
      if (!d) continue;
      for (const candidateId of ids) {
        const r = resourceById.get(candidateId);
        if (!r) continue;
        const rowId = resolveScheduleResource ? resolveScheduleResource(r, d) : r.id;
        out.push({
          id: `assign-${dispatchId}-${candidateId}`,
          title: `${d.label} — ${r.label}`,
          start: new Date(d.start),
          end: new Date(d.end),
          allDay: false,
          resource: rowId,
          category: 'shift',
          meta: {
            kind: 'shift',
            assignment: true,
            dispatchId,
            resourceId: candidateId,
            status: 'scheduled',
            ...(r.color ? { color: r.color } : {}),
          },
        });
      }
    }
    return out;
  }, [currentAssignments, dispatchById, resourceById, resolveScheduleResource]);

  const mergedEvents = useMemo<WorksCalendarEvent[]>(
    () => [...(events ?? []), ...assignmentEvents],
    [events, assignmentEvents],
  );

  // Flatten + grade every assignment — one source of truth for the banner,
  // the map HUD, and the route overlay.
  const assignmentRows = useMemo(() => {
    const rows: {
      key: string;
      dispatch: DispatchRequirements;
      resource: ResourceCandidate;
      status: RouteStatus;
      reasons: string;
    }[] = [];
    for (const [dispatchId, ids] of Object.entries(currentAssignments)) {
      const d = dispatchById.get(dispatchId);
      if (!d) continue;
      for (const candidateId of ids) {
        const r = resourceById.get(candidateId);
        if (!r) continue;
        const e = evaluateCandidate(d, r);
        rows.push({
          key: `${dispatchId}::${candidateId}`,
          dispatch: d,
          resource: r,
          status: e.status,
          reasons: e.checks.filter((c) => c.status !== 'green').map((c) => c.detail).join('; '),
        });
      }
    }
    return rows;
  }, [currentAssignments, dispatchById, resourceById]);

  const issues = useMemo<OpsAlertItem[]>(() => {
    const out: OpsAlertItem[] = [];
    for (const row of assignmentRows) {
      if (row.status === 'green') continue;
      out.push({
        id: `req-${row.key}`,
        severity: row.status === 'red' ? 'red' : 'amber',
        title: `${row.resource.label} → ${row.dispatch.label}`,
        detail: row.reasons,
        actionLabel: 'Review',
        onAction: () => handleTabChange('allocate'),
      });
    }
    // Double-booking: same resource on overlapping dispatches.
    const byResource = new Map<string, typeof assignmentRows>();
    for (const row of assignmentRows) {
      const list = byResource.get(row.resource.id) ?? [];
      list.push(row);
      byResource.set(row.resource.id, list);
    }
    for (const list of byResource.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          const as = new Date(a.dispatch.start).getTime();
          const ae = new Date(a.dispatch.end).getTime();
          const bs = new Date(b.dispatch.start).getTime();
          const be = new Date(b.dispatch.end).getTime();
          if (as < be && bs < ae) {
            out.push({
              id: `dbl-${a.key}-${b.key}`,
              severity: 'red',
              title: `${a.resource.label} double-booked`,
              detail: `${a.dispatch.label} overlaps ${b.dispatch.label}`,
              actionLabel: 'Review',
              onAction: () => handleTabChange('allocate'),
            });
          }
        }
      }
    }
    return out;
  }, [assignmentRows]);

  const assignmentPanelRows = useMemo<AssignmentRow[]>(
    () =>
      assignmentRows.map((row) => ({
        id: row.key,
        title: row.resource.label,
        subtitle: row.dispatch.label,
        status: row.status,
      })),
    [assignmentRows],
  );

  const notice = issues.length > 0 ? <OpsAlertBar items={issues} /> : undefined;

  const routeFeatures = useMemo<RouteFeature[]>(() => {
    if (!dispatchPaths) return [];
    const rank: Record<RouteStatus, number> = { green: 0, amber: 1, red: 2 };
    const byDispatch = new Map<string, { status: RouteStatus; label: string }>();
    for (const row of assignmentRows) {
      const path = dispatchPaths[row.dispatch.id];
      if (!path || path.length < 2) continue;
      const prev = byDispatch.get(row.dispatch.id);
      const status = !prev || rank[row.status] > rank[prev.status] ? row.status : prev.status;
      byDispatch.set(row.dispatch.id, { status, label: row.dispatch.label });
    }
    return [...byDispatch.entries()].map(([id, v]) => ({
      id,
      path: [...(dispatchPaths[id] ?? [])],
      status: v.status,
      label: v.label,
    }));
  }, [assignmentRows, dispatchPaths]);

  const subHeader = useMemo(() => {
    if (activeTab === 'locations') {
      return (
        <OpsViewHeader
          icon={<MapPin size={18} />}
          title="Locations"
          subtitle={`${locations.length} location${locations.length === 1 ? '' : 's'} · ${
            locationAssets.length
          } asset${locationAssets.length === 1 ? '' : 's'}`}
        />
      );
    }
    if (activeTab === 'allocate') {
      return (
        <OpsViewHeader
          icon={<ClipboardList size={18} />}
          title="Resource Allocation"
          subtitle={`${resources.length} resources · ${dispatches.length} dispatch${
            dispatches.length === 1 ? '' : 'es'
          }`}
        />
      );
    }
    return undefined;
  }, [activeTab, locations.length, locationAssets.length, resources.length, dispatches.length]);

  return (
    <OpsShell
      banner={banner}
      tabs={TABS}
      activeTab={activeTab}
      mode={currentMode}
      onToggleMode={toggleMode}
      onTabChange={handleTabChange}
      {...(persona ? { persona } : {})}
      {...(notice ? { notice } : {})}
      {...(subHeader ? { subHeader } : {})}
    >
      <div style={{ position: 'relative', height: '100%', width: '100%' }}>
        {/* Calendar stays mounted (state + map persist) but hidden under an
            overlay tab so its sticky headers can't steal clicks. */}
        <div style={{ height: '100%', display: OVERLAY_TABS.has(activeTab) ? 'none' : 'block' }}>
          <WorksCalendar
            {...calendarProps}
            {...(calendarId ? { calendarId } : {})}
            {...(assets ? { assets } : {})}
            {...(employees ? { employees } : {})}
            {...(getRouteWaypoints ? { getRouteWaypoints } : {})}
            events={mergedEvents}
            dispatchRoutes={routeFeatures}
            ref={apiRef}
            initialView="dispatch"
            theme={currentMode === 'dark' ? 'ops-dark' : 'ops-light'}
            showToolbar={false}
            showLeftRail={false}
            showRightPanel={false}
            showViewSwitcher={false}
          />
        </div>
        {activeTab === 'locations' && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 5 }}>
            <LocationsView
              locations={locations}
              assets={locationAssets}
              showHeader={false}
              onAssetClick={(assetId) => {
                handleTabChange('dispatch');
                apiRef.current?.openEvent(assetId);
              }}
            />
          </div>
        )}
        {activeTab === 'allocate' && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 5 }}>
            <AllocateView
              dispatches={dispatches}
              candidates={resources}
              assignments={currentAssignments}
              onToggleAssign={handleToggleAssign}
            />
          </div>
        )}
        {activeTab === 'dispatch' && assignmentPanelRows.length > 0 && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', right: 16, bottom: 24, pointerEvents: 'auto' }}>
              <AssignmentsPanel rows={assignmentPanelRows} onRowClick={() => handleTabChange('allocate')} />
            </div>
          </div>
        )}
      </div>
    </OpsShell>
  );
}

export default AssetConsole;
