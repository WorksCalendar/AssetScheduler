/**
 * The dispatch board — header chrome + tactical map + asset sidebar +
 * time slider + footer status. Asset-agnostic: events with `meta.lat/lng`
 * + `meta.facilityCode` (and optional `assets` rows with `meta.color`)
 * drive everything.
 *
 * Wired into WorksCalendar via `src/views/DispatchView.tsx` — that
 * adapter pulls normalized events + assets from the calendar context
 * and hands them off here.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { startOfDay, endOfDay } from 'date-fns';
import '../../styles/tailwind.css';
import './tactical.css';
import { TacticalMap } from './TacticalMap';
import { AssetSidebar } from './AssetSidebar';
import { TimeSlider } from './TimeSlider';
import { deriveDispatchData } from './deriveData';
import { deriveConflicts } from './deriveConflicts';
import { DatePickerDropdown } from '../../ui/DatePickerDropdown';
import type { MapLayer } from './types';
import type { NormalizedEvent } from 'works-calendar-engine';

export interface DispatchAssetEntry {
  readonly id: string;
  readonly label: string;
  readonly group?: string;
  readonly meta?: Record<string, unknown>;
}

export interface DispatchBoardProps {
  readonly events: readonly NormalizedEvent[];
  readonly assets?: readonly DispatchAssetEntry[];
  /** Initial "now" — only consulted when no controlled `currentDate` is
   *  supplied. Defaults to current wall clock. */
  readonly initialDate?: Date;
  /** Controlled "as of" timestamp. When provided, the board uses this as
   *  its single source of truth and any slider / date-picker change
   *  emits via `onCurrentDateChange`. Keeps the dispatch view in sync
   *  with the host calendar's currentDate when both are rendered. */
  readonly currentDate?: Date;
  readonly onCurrentDateChange?: (d: Date) => void;
  /** Optional view-switcher tabs to render inline in the board header,
   *  used when the host calendar hands over its full chrome to this view. */
  readonly viewSwitcher?: ReactNode;
  /** Optional host-provided route-waypoint lookup. When present and the
   *  lookup returns a non-empty list for a leg's `from`/`to` facility
   *  codes, the breadcrumb traces those waypoints as a polyline. */
  readonly getRouteWaypoints?: (fromCode: string, toCode: string) => readonly { lat: number; lng: number }[] | null;
  /** Geographic route overlay (committed assignment legs) for the map. */
  readonly dispatchRoutes?: readonly import('../../map').RouteFeature[];
}

const LAYERS: { id: MapLayer; label: string }[] = [
  { id: 'region', label: 'Region' },
  { id: 'state', label: 'State' },
  { id: '5k', label: '5k ft' },
  { id: '1k', label: '1k ft' },
];

export function DispatchBoard({
  events, assets = [], initialDate, currentDate, onCurrentDateChange, viewSwitcher,
  getRouteWaypoints, dispatchRoutes,
}: DispatchBoardProps) {
  const [uncontrolledDate, setUncontrolledDate] = useState<Date>(() => {
    if (currentDate) return currentDate;
    if (initialDate) return initialDate;
    // Default: median event time so the slider lands inside the dataset's
    // window. Falls through to real "now" only when there are no events.
    if (events.length === 0) return new Date();
    const sorted = [...events].map((e) => e.start.getTime()).sort((a, b) => a - b);
    return new Date(sorted[Math.floor(sorted.length / 2)]!);
  });
  // Track whether the uncontrolled default still represents the mount-time
  // guess, so we can re-anchor once events arrive asynchronously. Hosts that
  // load events via `fetchEvents` were getting the real-clock default (no
  // events at mount) and never re-anchoring — the slider window then sat
  // months away from the actual data and the map looked empty.
  const userAnchoredRef = useRef<boolean>(
    currentDate !== undefined || initialDate !== undefined || events.length > 0,
  );
  useEffect(() => {
    if (userAnchoredRef.current) return;
    if (events.length === 0) return;
    const sorted = [...events].map((e) => e.start.getTime()).sort((a, b) => a - b);
    setUncontrolledDate(new Date(sorted[Math.floor(sorted.length / 2)]!));
    userAnchoredRef.current = true;
  }, [events]);
  const selectedDate = currentDate ?? uncontrolledDate;
  const setSelectedDate = (next: Date) => {
    // Any deliberate scrub locks in the user's choice — don't override it
    // when a later batch of events trickles in.
    userAnchoredRef.current = true;
    if (onCurrentDateChange) onCurrentDateChange(next);
    if (currentDate === undefined) setUncontrolledDate(next);
  };
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [layer, setLayer] = useState<MapLayer>('region');
  // Comet-tail length (hours) shown when nothing is selected; 0 = off.
  // Cycled from the map legend.
  const TAIL_STEPS = [3, 6, 12, 0] as const;
  const [tailHours, setTailHours] = useState<number>(3);
  const cycleTail = () =>
    setTailHours((h) => {
      const i = TAIL_STEPS.indexOf(h as (typeof TAIL_STEPS)[number]);
      return TAIL_STEPS[(i + 1) % TAIL_STEPS.length]!;
    });

  const derived = useMemo(() => deriveDispatchData(events, assets), [events, assets]);
  const conflicts = useMemo(
    () => deriveConflicts(derived.facilities, derived.stopsByAsset),
    [derived.facilities, derived.stopsByAsset],
  );

  const todayConflicts = useMemo(() => {
    // Bucket conflicts by the viewer's wall-clock day rather than the UTC
    // day — a 23:30 PHX conflict belongs in the dispatcher's "today" even
    // when its UTC instant has rolled to tomorrow.
    const dayStart = startOfDay(selectedDate).getTime();
    const dayEnd = endOfDay(selectedDate).getTime();
    return conflicts.filter((c) => {
      const t = c.timeA.getTime();
      return t >= dayStart && t <= dayEnd;
    });
  }, [conflicts, selectedDate]);

  const conflictFacilities = useMemo(
    () => new Set(todayConflicts.map((c) => c.facilityCode)),
    [todayConflicts],
  );

  // Roll up driver HOS / duty-day totals for the currently-selected day so
  // the sidebar can surface FMCSA-style violations alongside the dock
  // conflict badge. Reads shift-class events (kind === 'shift') emitted
  // by the host alongside the stop / leg event streams.
  const hosByAsset = useMemo(() => {
    // Use the viewer's wall-clock day so HOS flags and the dock-conflict
    // badges (which already bucket by startOfDay/endOfDay) agree on what
    // "today" means — otherwise a late-evening shift would surface as a
    // conflict on day X and an HOS risk on day X+1.
    const dayStartMs = startOfDay(selectedDate).getTime();
    const dayEndMs = endOfDay(selectedDate).getTime();
    const map = new Map<string, { dutyHours: number; drivingHours: number; flags: string[] }>();
    for (const ev of events) {
      const meta = (ev.meta ?? {}) as Record<string, unknown>;
      if (meta['kind'] !== 'shift') continue;
      const start = ev.start instanceof Date ? ev.start : new Date(ev.start as string);
      const t = start.getTime();
      if (t < dayStartMs || t > dayEndMs) continue;
      const flags = Array.isArray(meta['hosFlags']) ? (meta['hosFlags'] as string[]) : [];
      const dutyHours = typeof meta['dutyHours'] === 'number' ? (meta['dutyHours'] as number) : 0;
      const drivingHours = typeof meta['drivingHours'] === 'number' ? (meta['drivingHours'] as number) : 0;
      const key = ev.resource ?? '';
      if (key) map.set(key, { dutyHours, drivingHours, flags });
    }
    return map;
  }, [events, selectedDate]);

  return (
    <div className="dispatchBoard h-full w-full flex flex-col overflow-hidden" style={{ background: 'var(--tac-bg)' }}>
      {/* Header */}
      <header className="h-10 flex items-center px-3 border-b-2 border-[color:var(--tac-line)] bg-[var(--tac-bg-2)] flex-shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {viewSwitcher}
          <DatePickerDropdown
            currentDate={selectedDate}
            label={selectedDate.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              timeZone: 'UTC',
            })}
            onDateChange={(d) => {
              // Preserve the current hour/minute when picking a new month —
              // we want to scrub to the same time-of-day in a different week.
              const next = new Date(d);
              next.setUTCHours(selectedDate.getUTCHours(), selectedDate.getUTCMinutes(), 0, 0);
              setSelectedDate(next);
            }}
            onToday={() => setSelectedDate(new Date())}
            onPrev={() => {
              const d = new Date(selectedDate);
              d.setUTCDate(d.getUTCDate() - 1);
              setSelectedDate(d);
            }}
            onNext={() => {
              const d = new Date(selectedDate);
              d.setUTCDate(d.getUTCDate() + 1);
              setSelectedDate(d);
            }}
          />
        </div>
        <div className="flex items-center gap-4">
          {todayConflicts.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#c0392b]">
              <span className="w-2 h-2 rounded-full bg-[#c0392b] animate-pulse" />
              {todayConflicts.length} CONFLICTS
              <span className="text-[var(--tac-ink-soft)] font-normal ml-1">
                ({conflictFacilities.size} facilities)
              </span>
            </div>
          )}
          <div className="flex gap-1">
            <button
              type="button"
              className="h-6 text-[10px] px-2 bg-transparent border border-[color:var(--tac-line)] text-[var(--tac-ink)] hover:bg-[var(--tac-hover)] rounded-sm"
              onClick={() => setSelectedAsset(null)}
            >
              CLEAR
            </button>
          </div>
        </div>
      </header>

      {/* Main body */}
      <div className="flex-1 flex overflow-hidden">
        <div className="w-56 flex-shrink-0">
          <AssetSidebar
            assets={derived.assets}
            facilities={derived.facilities}
            stopsByAsset={derived.stopsByAsset}
            conflicts={conflicts}
            selectedDate={selectedDate}
            selectedAsset={selectedAsset}
            onSelectAsset={setSelectedAsset}
            hosByAsset={hosByAsset}
          />
        </div>

        <div className="flex-1 relative">
          <TacticalMap
            assets={derived.assets}
            facilities={derived.facilities}
            stopsByAsset={derived.stopsByAsset}
            segmentsByAsset={derived.segmentsByAsset}
            conflicts={conflicts}
            selectedDate={selectedDate}
            selectedAsset={selectedAsset}
            onSelectAsset={setSelectedAsset}
            layer={layer}
            tailHours={tailHours}
            {...(getRouteWaypoints ? { getRouteWaypoints } : {})}
            {...(dispatchRoutes ? { dispatchRoutes } : {})}
          />

          {/* Layer switcher */}
          <div className="absolute top-3 right-3 flex flex-col gap-1">
            {LAYERS.map((l) => {
              const active = layer === l.id;
              return (
                <button
                  key={l.id}
                  className={[
                    'px-2 py-1 text-[10px] font-bold border border-[color:var(--tac-line)] transition-colors rounded-sm',
                    active
                      ? 'bg-[var(--tac-sel)] text-[var(--tac-sel-ink)]'
                      : 'bg-[var(--tac-panel)] text-[var(--tac-ink)] hover:bg-[var(--tac-hover)]',
                  ].join(' ')}
                  onClick={() => setLayer(l.id)}
                >
                  {l.label}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="absolute bottom-3 left-3 bg-[var(--tac-panel)] border border-[color:var(--tac-line)] p-2 rounded-sm text-[9px] text-[var(--tac-ink-soft)]">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="inline-block w-3 h-1 bg-[var(--tac-sel)]" />
              <span>Traveled</span>
            </div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="inline-block w-3 h-0 border-t-2 border-dashed border-[#999]" />
              <span>Scheduled</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0 border-t-2 border-dashed border-[#c0392b]" />
              <span className="text-[#c0392b] font-bold">Conflict</span>
            </div>
            <button
              type="button"
              onClick={cycleTail}
              title="Toggle the recent-travel tail length"
              className="flex items-center gap-1.5 mt-1 pt-1 w-full border-t border-[color:var(--tac-line-soft)] cursor-pointer text-[var(--tac-ink-soft)] hover:text-[var(--tac-ink)]"
            >
              <span
                className="inline-block w-3 h-1 rounded-full"
                style={{
                  background: tailHours > 0
                    ? 'linear-gradient(90deg, transparent, var(--tac-ink))'
                    : 'transparent',
                  border: tailHours > 0 ? 'none' : '1px dashed var(--tac-line)',
                }}
              />
              <span className="font-bold">Tail{tailHours > 0 ? ` · ${tailHours}h` : ': Off'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom: time slider + per-asset Gantt */}
      <div className="h-44 flex-shrink-0">
        <TimeSlider
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          selectedAsset={selectedAsset}
          assets={derived.assets}
          segmentsByAsset={derived.segmentsByAsset}
        />
      </div>

      {/* Footer */}
      <div className="h-7 flex items-center justify-between px-4 border-t-2 border-[color:var(--tac-line)] bg-[var(--tac-bg-2)] flex-shrink-0">
        <div className="flex items-center gap-3 text-[9px] text-[var(--tac-ink-soft)]">
          <span>{derived.assets.length} ASSETS</span>
          <span>{derived.facilities.length} FACILITIES</span>
          <span>{todayConflicts.length} ACTIVE CONFLICTS</span>
        </div>
        <div className="text-[9px] text-[#7a6e5b] font-mono">works-calendar-engine</div>
      </div>
    </div>
  );
}
