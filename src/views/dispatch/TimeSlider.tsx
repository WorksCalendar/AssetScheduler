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

            {/* Gantt body — bars positioned as % of the windowDays timeline.
                 Day gridlines + today/selected cursors render as absolutely
                 positioned overlays so bars and grid stay aligned. */}
            <div className="h-12 relative overflow-hidden">
              {/* Day gridlines */}
              {Array.from({ length: windowDays + 1 }, (_, i) => (
                <div
                  key={`grid-${i}`}
                  className="absolute top-0 bottom-0 border-l border-[color:var(--tac-line-soft)]"
                  style={{ left: `${(i / windowDays) * 100}%` }}
                />
              ))}
              {/* Wall-clock "now" cursor (dashed red) */}
              {todayIndex >= 0 && (
                <div
                  className="absolute top-0 bottom-0 border-l border-dashed border-[#c0392b]/60 pointer-events-none"
                  style={{ left: `${(todayIndex / windowDays) * 100}%` }}
                  aria-hidden
                />
              )}
              {/* Selected-time cursor (solid black) */}
              <div
                className="absolute top-0 bottom-0 border-l-2 border-[color:var(--tac-ink)] pointer-events-none"
                style={{
                  left: `${
                    ((currentDay * HOURS_PER_DAY + selectedDate.getUTCHours()) /
                      (windowDays * HOURS_PER_DAY)) *
                    100
                  }%`,
                }}
                aria-hidden
              />
              {/* Route bars. Trucks visit one place at a time, so we stack
                   them on a single lane and let the bar take the full row
                   height — easier to read than the previous 3-lane SVG.
                   Segments entirely outside the visible window are skipped;
                   partially-visible ones are clipped to the window edges so
                   the bar doesn't overrun (or hug) the gantt origin. */}
              {(() => {
                const totalHours = windowDays * HOURS_PER_DAY;
                const bars = segments.flatMap((seg, i) => {
                  const startHour =
                    (seg.from.time.getTime() - origin.getTime()) / MS_PER_HOUR;
                  const endHour =
                    (seg.to.time.getTime() - origin.getTime()) / MS_PER_HOUR;
                  if (endHour <= 0 || startHour >= totalHours) return [];
                  const clippedStart = Math.max(0, startHour);
                  const clippedEnd = Math.min(totalHours, endHour);
                  const leftPct = (clippedStart / totalHours) * 100;
                  const widthPct = Math.max(
                    0.6,
                    ((clippedEnd - clippedStart) / totalHours) * 100,
                  );
                  const isPast = seg.to.time.getTime() <= selectedDate.getTime();
                  const isActive =
                    seg.from.time.getTime() <= selectedDate.getTime() &&
                    selectedDate.getTime() < seg.to.time.getTime();
                  const fmt = (d: Date) =>
                    d.toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true,
                      timeZone: 'UTC',
                    });
                  const durMins = Math.max(
                    0,
                    Math.round(
                      (seg.to.time.getTime() - seg.from.time.getTime()) / 60_000,
                    ),
                  );
                  const durLabel =
                    durMins >= 60
                      ? `${Math.floor(durMins / 60)}h ${(durMins % 60)
                          .toString()
                          .padStart(2, '0')}m`
                      : `${durMins}m`;
                  const driverPart = selectedAssetData.driverName
                    ? `\nDriver: ${selectedAssetData.driverName}`
                    : '';
                  const estPart = seg.estimate
                    ? `\nEst: ${
                        seg.estimate.minutes >= 60
                          ? `${Math.floor(seg.estimate.minutes / 60)}h ${Math.round(
                              seg.estimate.minutes % 60,
                            )
                              .toString()
                              .padStart(2, '0')}m`
                          : `${Math.round(seg.estimate.minutes)}m`
                      } by ${seg.estimate.profileLabel.toLowerCase()}`
                    : '';
                  return [
                    <button
                      key={i}
                      type="button"
                      onClick={() => onDateChange(new Date(seg.from.time))}
                      title={`${seg.from.facilityCode} → ${seg.to.facilityCode}\n${fmt(seg.from.time)} – ${fmt(seg.to.time)} (${durLabel})${estPart}${driverPart}`}
                      className="absolute rounded-sm text-[10px] font-semibold text-white overflow-hidden whitespace-nowrap px-1.5 border border-black/15 hover:ring-2 hover:ring-[color:var(--tac-ink)] hover:z-10 focus:outline-none focus:ring-2 focus:ring-[color:var(--tac-ink)] focus:z-10"
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        top: '6px',
                        bottom: '6px',
                        background: isPast ? selectedAssetData.color : '#999',
                        opacity: isPast ? 0.95 : 0.55,
                        boxShadow: isActive
                          ? '0 0 0 2px var(--tac-ink) inset, 0 0 0 1px var(--tac-panel)'
                          : undefined,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                      }}
                    >
                      <span>
                        {seg.from.facilityCode}→{seg.to.facilityCode}
                      </span>
                      <span className="opacity-80 font-normal">{durLabel}</span>
                    </button>,
                  ];
                });
                // Two empty cases worth distinguishing: the asset truly has
                // no legs to show, vs. it has legs but every one of them was
                // clipped out by the current window. The second case is easy
                // to hit by scrubbing the slider far enough away, and going
                // blank with no message leaves dispatchers wondering whether
                // the data loaded.
                if (bars.length === 0) {
                  return (
                    <div className="absolute inset-0 flex items-center justify-center text-[10px] text-[#7a6e5b] italic px-3 text-center">
                      {segments.length === 0
                        ? 'No route segments for this asset'
                        : 'All legs are outside the visible window — scrub the slider to bring them into view'}
                    </div>
                  );
                }
                return bars;
              })()}
            </div>
        </div>
      )}
    </div>
  );
}
