/**
 * Time slider + mini Gantt for the dispatch view.
 *
 * Day + hour sliders scrub the visibleAt timestamp; selecting an asset
 * draws its route legs in the mini Gantt strip. Past legs render solid;
 * future legs render dimmed.
 *
 * Ported from `demo/app/src/components/TimeSlider.tsx`. Window
 * (default 14 days) and origin date are configurable via props so
 * the slider doesn't hardcode the truck demo's July 2025 baseline.
 */
import { useEffect, useMemo, useState } from 'react';
import { Slider } from './Slider';
import { packLanes } from './ganttLanes';
import type { DispatchAsset, DispatchSegment } from './types';

interface Props {
  readonly selectedDate: Date;
  readonly onDateChange: (date: Date) => void;
  readonly selectedAsset: string | null;
  readonly assets: readonly DispatchAsset[];
  readonly segmentsByAsset: ReadonlyMap<string, DispatchSegment[]>;
  /** Origin (day 0) of the 14-day window. Defaults to selectedDate − 4 days. */
  readonly windowOrigin?: Date;
  /** Length of the day window. Default 14. */
  readonly windowDays?: number;
}

const HOURS_PER_DAY = 24;
const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

export function TimeSlider({
  selectedDate,
  onDateChange,
  selectedAsset,
  assets,
  segmentsByAsset,
  windowOrigin,
  windowDays = 14,
}: Props) {
  // Anchor the window once and only re-anchor when the consumer overrides
  // it explicitly OR the current selection scrubs outside the visible
  // range. Recomputing origin on every selectedDate change made the
  // window track the thumb, pinning the slider position visually even
  // though the underlying date was advancing.
  const [origin, setOrigin] = useState<Date>(() => {
    if (windowOrigin) return windowOrigin;
    const d = new Date(selectedDate);
    d.setUTCDate(d.getUTCDate() - Math.floor(windowDays / 2));
    d.setUTCHours(0, 0, 0, 0);
    return d;
  });
  // Sync to an externally-supplied origin if it changes.
  useEffect(() => {
    if (windowOrigin) setOrigin(windowOrigin);
  }, [windowOrigin]);
  // Re-anchor if the selection scrubs outside the current window — keeps
  // the thumb on-screen when the calendar jumps to a far-away date.
  useEffect(() => {
    const diffDays = Math.floor((selectedDate.getTime() - origin.getTime()) / MS_PER_DAY);
    if (diffDays < 0 || diffDays >= windowDays) {
      const d = new Date(selectedDate);
      d.setUTCDate(d.getUTCDate() - Math.floor(windowDays / 2));
      d.setUTCHours(0, 0, 0, 0);
      setOrigin(d);
    }
  }, [selectedDate, origin, windowDays]);

  // Index that today's wall-clock date falls on within the window — used
  // for the dashed red "now" cursor and the bottom-row TODAY tick.
  //
  // The grid columns are UTC-aligned, but "today" should mean the viewer's
  // wall-clock today. For a user east of UTC after local midnight (but
  // before UTC midnight), the UTC-of-now is still yesterday's column and
  // the TODAY marker would land in the wrong spot. Use the viewer's local
  // calendar components to build the matching UTC-midnight key instead.
  const todayIndex = useMemo(() => {
    const now = new Date();
    const localTodayUtcMidnight = Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const diff = Math.floor((localTodayUtcMidnight - origin.getTime()) / MS_PER_DAY);
    return diff >= 0 && diff < windowDays ? diff : -1;
  }, [origin, windowDays]);

  const days = useMemo(
    () =>
      Array.from({ length: windowDays }, (_, i) => {
        const d = new Date(origin);
        d.setUTCDate(d.getUTCDate() + i);
        return {
          index: i,
          date: d,
          label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
          isToday: i === todayIndex,
        };
      }),
    [origin, windowDays, todayIndex],
  );

  const currentDay = useMemo(() => {
    const diff = selectedDate.getTime() - origin.getTime();
    return Math.max(0, Math.min(windowDays - 1, Math.floor(diff / MS_PER_DAY)));
  }, [selectedDate, origin, windowDays]);

  const selectedAssetData = assets.find((a) => a.id === selectedAsset) ?? null;
  const segments = selectedAsset ? segmentsByAsset.get(selectedAsset) ?? [] : [];

  // Pack the visible legs into lanes so overlapping / multi-day jobs stack
  // vertically instead of colliding on a single row. Geometry only (no
  // selectedDate) so scrubbing the slider doesn't repack.
  const packed = useMemo(() => {
    const totalHours = windowDays * HOURS_PER_DAY;
    const visible = segments
      .map((seg, i) => {
        const startHour = (seg.from.time.getTime() - origin.getTime()) / MS_PER_HOUR;
        const endHour = (seg.to.time.getTime() - origin.getTime()) / MS_PER_HOUR;
        return {
          seg,
          i,
          startHour,
          endHour,
          start: Math.max(0, startHour),
          end: Math.min(totalHours, endHour),
        };
      })
      .filter((b) => b.endHour > 0 && b.startHour < totalHours);
    const { lanes, laneCount } = packLanes(visible);
    const items = lanes.map((l) => ({ ...l.item, lane: l.lane }));
    return { items, laneCount: Math.max(1, laneCount), totalHours };
  }, [segments, origin, windowDays]);

  const handleDayChange = (value: number[]) => {
    const dayIndex = value[0] ?? 0;
    const next = new Date(origin);
    next.setUTCDate(next.getUTCDate() + dayIndex);
    next.setUTCHours(selectedDate.getUTCHours(), selectedDate.getUTCMinutes(), 0, 0);
    onDateChange(next);
  };

  const handleHourChange = (value: number[]) => {
    const d = new Date(selectedDate);
    d.setUTCHours(value[0] ?? 0, 0, 0, 0);
    onDateChange(d);
  };

  return (
    <div className="absolute left-2 right-2 bottom-2 z-[4] flex flex-col-reverse rounded-md border border-[color:var(--tac-line)] bg-[color:color-mix(in_srgb,var(--tac-panel)_92%,transparent)] backdrop-blur-sm shadow-lg overflow-hidden">
      {/* Day + Hour scrubbers — wide and thin, side by side. */}
      <div className="flex items-center gap-5 px-3 py-1.5 border-t border-[color:var(--tac-line-soft)]">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-[10px] font-serif text-[var(--tac-ink-soft)] uppercase tracking-wider">Day</span>
          <Slider
            value={[currentDay]}
            onValueChange={handleDayChange}
            min={0}
            max={windowDays - 1}
            step={1}
            className="flex-1"
          />
          <span className="text-[10px] font-bold text-[var(--tac-ink)] w-16 text-right">
            {days[currentDay]?.label ?? ''}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-[10px] font-serif text-[var(--tac-ink-soft)] uppercase tracking-wider">Hr</span>
          <Slider
            value={[selectedDate.getUTCHours()]}
            onValueChange={handleHourChange}
            min={0}
            max={HOURS_PER_DAY - 1}
            step={1}
            className="flex-1"
          />
          <span className="text-[10px] font-bold text-[var(--tac-ink)] w-14 text-right">
            {selectedDate.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true, timeZone: 'UTC' })}
          </span>
        </div>
      </div>

      {/* Mini Gantt for the selected asset — only mounts when one is picked,
          so the overlay stays a thin scrubber otherwise. */}
      {selectedAssetData && (
        <div className="flex flex-col overflow-hidden min-w-0">
          {/* Title + active-leg one-liner. Tells dispatch who's driving,
               where the truck is, and what the next move is — readable
               even when the per-leg pills below are pixel-narrow. */}
          <div className="px-3 pt-2 flex items-baseline gap-2 min-w-0">
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: selectedAssetData.color }}
                aria-hidden
              />
              <span className="text-[10px] font-serif text-[var(--tac-ink)] uppercase tracking-wider truncate">
                {selectedAssetData.id} — {selectedAssetData.name}
              </span>
              {selectedAssetData.driverName && (
                <span className="text-[10px] text-[var(--tac-ink-soft)] truncate">
                  · {selectedAssetData.driverName}
                </span>
              )}
            </div>
            <div className="px-3 text-[10px] text-[var(--tac-ink-soft)] truncate">
              {(() => {
                if (segments.length === 0) {
                  return <span className="italic text-[#7a6e5b]">No legs in window</span>;
                }
                const tSel = selectedDate.getTime();
                const active = segments.find(
                  (s) =>
                    s.from.time.getTime() <= tSel && tSel < s.to.time.getTime(),
                );
                const upcoming = segments.find((s) => s.from.time.getTime() > tSel);
                const last = segments[segments.length - 1];
                const fmtTime = (d: Date) =>
                  d.toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                    timeZone: 'UTC',
                  });
                const fmtDuration = (ms: number) => {
                  const mins = Math.max(0, Math.round(ms / 60_000));
                  const h = Math.floor(mins / 60);
                  const m = mins % 60;
                  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
                };
                if (active) {
                  const remaining = fmtDuration(active.to.time.getTime() - tSel);
                  return (
                    <>
                      <span className="font-bold text-[var(--tac-ink)]">En route </span>
                      {active.from.facilityCode} → {active.to.facilityCode} ·
                      <span className="font-bold"> {remaining}</span> to arrival ({fmtTime(active.to.time)})
                    </>
                  );
                }
                if (upcoming) {
                  const until = fmtDuration(upcoming.from.time.getTime() - tSel);
                  const drive = fmtDuration(
                    upcoming.to.time.getTime() - upcoming.from.time.getTime(),
                  );
                  const est = upcoming.estimate
                    ? ` · est ${fmtDuration(upcoming.estimate.minutes * 60_000)} by ${upcoming.estimate.profileLabel.toLowerCase()}`
                    : '';
                  return (
                    <>
                      <span className="font-bold text-[var(--tac-ink)]">Next </span>
                      {upcoming.from.facilityCode} → {upcoming.to.facilityCode} · departs {fmtTime(upcoming.from.time)} (in <span className="font-bold">{until}</span>) · {drive} drive{est}
                    </>
                  );
                }
                if (last) {
                  return (
                    <>
                      <span className="font-bold text-[var(--tac-ink)]">Last </span>
                      {last.from.facilityCode} → {last.to.facilityCode} arrived {fmtTime(last.to.time)}
                    </>
                  );
                }
                return null;
              })()}
            </div>

            {/* Date headers strip — one cell per day, evenly distributed
                 across the timeline so bars align with their date column. */}
            <div className="flex border-b border-[color:var(--tac-line)] mt-1">
              {days.map((d) => (
                <div
                  key={d.index}
                  className="flex-1 px-1 py-0.5 text-center border-r border-[color:var(--tac-line-soft)] last:border-r-0 leading-tight"
                  style={{ minWidth: 0 }}
                >
                  <div
                    className="text-[9px] font-bold"
                    style={{ color: d.isToday ? '#c0392b' : 'var(--tac-ink)' }}
                  >
                    {d.date.getUTCDate()}
                  </div>
                  <div className="text-[7px] uppercase tracking-wide text-[#7a6e5b]">
                    {d.date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}
                  </div>
                </div>
              ))}
            </div>

            {/* Gantt body — bars positioned as % of the windowDays timeline and
                 packed into lanes (multi-day jobs span columns; overlapping
                 jobs stack). Day gridlines + cursors are full-height overlays
                 so bars and grid stay aligned; scrolls when lanes overflow. */}
            {(() => {
              const LANE_H = 24;
              const MAX_VISIBLE_LANES = 4;
              const contentH = packed.laneCount * LANE_H;
              const viewH = Math.min(packed.laneCount, MAX_VISIBLE_LANES) * LANE_H;
              const selX =
                ((currentDay * HOURS_PER_DAY + selectedDate.getUTCHours()) /
                  (windowDays * HOURS_PER_DAY)) *
                100;
              const fmt = (d: Date) =>
                d.toLocaleString('en-US', {
                  month: 'short', day: 'numeric', hour: 'numeric',
                  minute: '2-digit', hour12: true, timeZone: 'UTC',
                });
              return (
                <div className="relative overflow-x-hidden overflow-y-auto" style={{ height: viewH }}>
                  <div className="relative" style={{ height: contentH }}>
                    {/* Day gridlines */}
                    {Array.from({ length: windowDays + 1 }, (_, i) => (
                      <div
                        key={`grid-${i}`}
                        className="absolute top-0 bottom-0 border-l border-[color:var(--tac-line-soft)]"
                        style={{ left: `${(i / windowDays) * 100}%` }}
                      />
                    ))}
                    {todayIndex >= 0 && (
                      <div
                        className="absolute top-0 bottom-0 border-l border-dashed border-[#c0392b]/60 pointer-events-none"
                        style={{ left: `${(todayIndex / windowDays) * 100}%` }}
                        aria-hidden
                      />
                    )}
                    <div
                      className="absolute top-0 bottom-0 border-l-2 border-[color:var(--tac-ink)] pointer-events-none"
                      style={{ left: `${selX}%` }}
                      aria-hidden
                    />

                    {packed.items.length === 0 ? (
                      <div className="absolute inset-0 flex items-center justify-center text-[10px] text-[#7a6e5b] italic px-3 text-center">
                        {segments.length === 0
                          ? 'No route segments for this asset'
                          : 'All legs are outside the visible window — scrub the slider to bring them into view'}
                      </div>
                    ) : (
                      packed.items.map((b) => {
                        const leftPct = (b.start / packed.totalHours) * 100;
                        const widthPct = Math.max(
                          0.5,
                          ((b.end - b.start) / packed.totalHours) * 100,
                        );
                        const isPast = b.seg.to.time.getTime() <= selectedDate.getTime();
                        const isActive =
                          b.seg.from.time.getTime() <= selectedDate.getTime() &&
                          selectedDate.getTime() < b.seg.to.time.getTime();
                        const durMins = Math.max(
                          0,
                          Math.round((b.seg.to.time.getTime() - b.seg.from.time.getTime()) / 60_000),
                        );
                        const durLabel =
                          durMins >= 60
                            ? `${Math.floor(durMins / 60)}h ${(durMins % 60).toString().padStart(2, '0')}m`
                            : `${durMins}m`;
                        const driverPart = selectedAssetData.driverName
                          ? `\nDriver: ${selectedAssetData.driverName}`
                          : '';
                        // Only label when the bar is wide enough to read —
                        // otherwise mid-character clipping makes it gibberish.
                        const showCodes = widthPct >= 5;
                        const showDur = widthPct >= 12;
                        return (
                          <button
                            key={b.i}
                            type="button"
                            onClick={() => onDateChange(new Date(b.seg.from.time))}
                            title={`${b.seg.from.facilityCode} → ${b.seg.to.facilityCode}\n${fmt(b.seg.from.time)} – ${fmt(b.seg.to.time)} (${durLabel})${driverPart}`}
                            className="absolute rounded text-[10px] font-semibold text-white overflow-hidden whitespace-nowrap px-1.5 border border-black/20 flex items-center justify-center gap-1 hover:ring-2 hover:ring-[color:var(--tac-ink)] hover:z-10 focus:outline-none focus:ring-2 focus:ring-[color:var(--tac-ink)] focus:z-10"
                            style={{
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                              minWidth: '3px',
                              top: b.lane * LANE_H + 3,
                              height: LANE_H - 6,
                              background: isPast ? selectedAssetData.color : '#999',
                              opacity: isPast ? 0.95 : 0.6,
                              boxShadow: isActive
                                ? '0 0 0 2px var(--tac-ink) inset, 0 0 0 1px var(--tac-panel)'
                                : undefined,
                            }}
                          >
                            {showCodes && (
                              <span>{b.seg.from.facilityCode}→{b.seg.to.facilityCode}</span>
                            )}
                            {showDur && <span className="opacity-80 font-normal">{durLabel}</span>}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })()}
        </div>
      )}
    </div>
  );
}
