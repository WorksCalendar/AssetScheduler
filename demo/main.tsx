/**
 * works-calendar — public demo deployed to workscalendar.com.
 *
 * One dataset, every tab. Trucks (assets), drivers (employees), facilities
 * (bases) all share IDs / hub codes so the Month / Week / Schedule / Base /
 * Assets / Dispatch tabs all read off the same source of truth. The
 * dispatch board is just one window onto the fleet — switch tabs and you
 * see the same trucks and drivers grouped a different way.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import type { WorksCalendarEvent } from '../src/index';
import { OpsConsole } from './OpsConsole';
import { TRUCKS, TRUCK_ROUTES, DRIVERS, BASES, REGIONS } from './truckDemoData';
import { ALLOCATOR_CANDIDATES, ALLOCATOR_DISPATCHES } from './allocatorData';
import { getWaypoints } from './highways';

const CALENDAR_ID = 'dispatch-demo-v3';

// The static dataset is anchored at 2025-07-07 UTC for human-readability.
// Shift every event by (today − anchor) at load so the demo always lands
// on the current week — otherwise the slider window sits in 2025 and the
// map is empty for anyone visiting the deployed demo.
const DATASET_ANCHOR_MS = Date.UTC(2025, 6, 7); // months are 0-indexed
const todayMidnight = new Date();
todayMidnight.setUTCHours(0, 0, 0, 0);
const DEMO_TIME_OFFSET_MS = todayMidnight.getTime() - DATASET_ANCHOR_MS;

function shift(value: Date | string): Date {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return new Date(t + DEMO_TIME_OFFSET_MS);
}

const ASSETS = TRUCKS.map((t) => {
  const driver = DRIVERS.find((d) => d.id === t.id);
  return {
    id: t.id,
    label: `${t.id} — ${t.name}`,
    group: t.hub,
    meta: {
      color: driver?.color,
      type: t.type,
      capacity: t.capacity,
      base: t.hub,
      hub: t.hub,
      driverId: t.id,
      driverName: driver?.name ?? '',
    },
  };
});

// One event stream covers the whole demo, in three layers:
//
//   STOP_EVENTS — one per arrival/departure (zero duration). Carries the
//     facility + lat/lng meta the dispatch board needs to plot breadcrumbs
//     and conflict pulses on the map. Invisible in Month/Week/Day grids
//     because they render bars and a zero-width bar has nothing to paint.
//
//   LEG_EVENTS — one per travel segment, start = depart, end = arrive.
//     Carries from/to facility codes in meta. These ARE non-zero-duration
//     so they render as bars in Month / Week / Day / Agenda and on the
//     Base view's truck/driver rows. Deliberately *no* meta.facilityCode
//     at the event root so the dispatch board's stop reader skips them.
//
//   SHIFT_EVENTS — one per driver per calendar day (category='shift').
//     The Schedule view scope predicate (`isScheduleWorkflowEvent`) only
//     admits events with this category, so these are what populate the
//     driver shift bars; Month / Week / Day intentionally filter them
//     back out so the leg events don't get duplicated there.
//
// Same trucks, same drivers, same facilities — one source of truth, three
// projections that each tab consumes the slice it needs.

// Real-world dispatch: each arrival has a dock dwell (unload) window
// proportional to the load type. Two trucks landing on the same facility
// with overlapping unload windows is the canonical dock conflict the
// engine surfaces. Driver duty totals roll up off the same numbers.
const UNLOAD_MINUTES_BY_TYPE: Record<string, number> = {
  dry_van: 45,
  reefer: 75,   // cold-chain handling
  flatbed: 90,  // strapping + tarping
};

// FMCSA HOS caps used to flag duty-overrun and short-rest conflicts.
const HOS_MAX_ON_DUTY_HOURS = 14;
const HOS_MAX_DRIVING_HOURS = 11;
const HOS_REST_REQUIRED_HOURS = 10;

const STOP_EVENTS: WorksCalendarEvent[] = TRUCK_ROUTES.flatMap((r) => {
  const unloadMin = UNLOAD_MINUTES_BY_TYPE[r.truck.type] ?? 60;
  return r.events.map((ev) => {
    const stopType = (ev.meta?.['stopType'] as string | undefined) ?? 'arrival';
    // Stops stay zero-duration so they don't surface as extra bars in
    // Month/Week/Day/Agenda (those scopes only filter out schedule-class
    // events). The dwell window for dock-conflict detection lives in
    // `meta.unloadMinutes` and is read by deriveConflicts on the dispatch
    // side. `meta.kind: 'stop'` lets a host disambiguate these from the
    // leg/shift records sharing the same stream.
    return {
      id: ev.id,
      title: ev.title,
      start: shift(ev.start),
      end: shift(ev.end),
      allDay: false,
      resource: ev.resource,
      meta: {
        ...ev.meta,
        kind: 'stop',
        ...(stopType === 'arrival' ? { unloadMinutes: unloadMin, loadType: r.truck.type } : {}),
      },
    };
  });
});

const LEG_EVENTS: WorksCalendarEvent[] = TRUCK_ROUTES.flatMap((r) => {
  const driver = DRIVERS.find((d) => d.id === r.truck.id);
  return r.segments.map((seg, i) => ({
    id: `leg-${r.truck.id}-w${r.weekIndex}-${i}`,
    title: `${seg.from} → ${seg.to}`,
    start: shift(seg.depart),
    end: shift(seg.arrive),
    allDay: false,
    resource: r.truck.id,
    category: 'delivery',
    meta: {
      kind: 'leg',
      truckId: r.truck.id,
      fromCode: seg.from,
      toCode: seg.to,
      fromLat: seg.fromLat,
      fromLng: seg.fromLng,
      toLat: seg.toLat,
      toLng: seg.toLng,
      distanceMiles: seg.distanceMiles,
      status: seg.status,
      base: r.truck.hub,
      color: driver?.color,
    },
  }));
});

// Synthesize one duty-shift event per (driver × calendar day) from the
// segment depart/arrive times so the Schedule view lights up with each
// driver's daily window.
function dayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

// Per-driver, per-day duty totals. `dutyHours` is wall-clock on-duty time
// (first depart → last arrive + last unload); `drivingHours` is the sum of
// the actual leg durations. Either crossing its HOS cap is what surfaces
// the HOS-violation badge on the dispatch sidebar.
interface ShiftAggregate {
  start: Date;
  end: Date;
  drivingHours: number;
  lastArrive: Date;
}

const SHIFT_EVENTS: WorksCalendarEvent[] = TRUCK_ROUTES.flatMap((r) => {
  const driverId = r.truck.id;
  const unloadMin = UNLOAD_MINUTES_BY_TYPE[r.truck.type] ?? 60;
  const byDay = new Map<string, ShiftAggregate>();
  for (const seg of r.segments) {
    const depart = shift(seg.depart);
    const arrive = shift(seg.arrive);
    const drive = (arrive.getTime() - depart.getTime()) / 3_600_000;
    const key = dayKey(depart);
    const existing = byDay.get(key);
    if (!existing) {
      byDay.set(key, { start: depart, end: arrive, drivingHours: drive, lastArrive: arrive });
    } else {
      if (depart < existing.start) existing.start = depart;
      if (arrive > existing.end) {
        existing.end = arrive;
        existing.lastArrive = arrive;
      }
      existing.drivingHours += drive;
    }
  }
  // Track prior-day shift end so we can flag short-rest violations
  // (< HOS_REST_REQUIRED_HOURS between consecutive shifts).
  const ordered = Array.from(byDay.entries()).sort((a, b) => a[1].start.getTime() - b[1].start.getTime());
  let prevEndPlusUnload: number | null = null;
  return ordered.map(([key, win]) => {
    const shiftEnd = new Date(win.lastArrive.getTime() + unloadMin * 60_000);
    const dutyHours = (shiftEnd.getTime() - win.start.getTime()) / 3_600_000;
    const restGapHours = prevEndPlusUnload === null
      ? null
      : (win.start.getTime() - prevEndPlusUnload) / 3_600_000;
    prevEndPlusUnload = shiftEnd.getTime();
    const hosFlags: string[] = [];
    if (dutyHours > HOS_MAX_ON_DUTY_HOURS) hosFlags.push('on-duty-over');
    if (win.drivingHours > HOS_MAX_DRIVING_HOURS) hosFlags.push('driving-over');
    if (restGapHours !== null && restGapHours < HOS_REST_REQUIRED_HOURS) hosFlags.push('short-rest');
    return {
      id: `shift-${driverId}-${key}`,
      title: `${r.truck.name} — duty${hosFlags.length > 0 ? ' (HOS)' : ''}`,
      start: win.start,
      end: shiftEnd,
      allDay: false,
      resource: driverId,
      category: 'shift',
      meta: {
        kind: 'shift',
        truckId: driverId,
        base: r.truck.hub,
        dutyHours: Math.round(dutyHours * 10) / 10,
        drivingHours: Math.round(win.drivingHours * 10) / 10,
        restGapHours: restGapHours === null ? null : Math.round(restGapHours * 10) / 10,
        hosCapHours: HOS_MAX_ON_DUTY_HOURS,
        drivingCapHours: HOS_MAX_DRIVING_HOURS,
        restRequiredHours: HOS_REST_REQUIRED_HOURS,
        hosFlags,
        hosViolation: hosFlags.length > 0,
      },
    };
  });
});

const FLEET_EVENTS: WorksCalendarEvent[] = [...STOP_EVENTS, ...LEG_EVENTS, ...SHIFT_EVENTS];

// Seed the calendar's owner config so the Base + Schedule views have a
// bases/regions registry to draw rows from. The config layer is normally
// editable through the in-app gear panel + persisted to localStorage; for
// the demo we just write straight to the same localStorage key on boot so
// the data is there before WorksCalendar's first render.
try {
  const key = `wc-config-${CALENDAR_ID}`;
  if (typeof window !== 'undefined' && !window.localStorage.getItem(key)) {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        title: 'Fleet Dispatch Demo',
        team: {
          locationLabel: 'Base',
          assetsLabel: 'Truck',
          roles: ['Driver', 'Dispatcher', 'Mechanic'],
          bases: BASES.map((b) => ({ id: b.id, name: b.name, regionId: b.regionId })),
          regions: REGIONS,
        },
      }),
    );
  }
} catch {
  // localStorage unavailable (private mode / SSR) — fall through; the
  // tabs that read bases/regions will just render empty.
}

// ── Locations tab data ───────────────────────────────────────────────────────
const REGION_NAME = new Map(REGIONS.map((r) => [r.id, r.name]));
const DEMO_LOCATIONS = BASES.map((b) => ({
  id: b.id,
  name: b.name,
  code: b.id,
  region: REGION_NAME.get(b.regionId) ?? '',
}));
const DEMO_LOCATION_ASSETS = ASSETS.map((a) => ({
  id: a.id,
  label: a.label,
  locationId: String(a.meta.hub ?? a.group ?? ''),
  color: a.meta.color,
  meta: String(a.meta.type ?? ''),
}));

function DemoApp() {
  return (
    <div style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <OpsConsole
        banner={{
          title: 'AssetScheduler',
          subtitle: 'Ops Console',
          logoText: 'AS',
        }}
        persona={{ name: 'Billy Ortega', role: 'Director' }}
        locations={DEMO_LOCATIONS}
        locationAssets={DEMO_LOCATION_ASSETS}
        dispatches={ALLOCATOR_DISPATCHES}
        resources={ALLOCATOR_CANDIDATES}
        initialMode="dark"
        calendar={{
          calendarId: CALENDAR_ID,
          events: FLEET_EVENTS,
          assets: ASSETS,
          employees: DRIVERS.map((d) => ({
            id: d.id,
            name: d.name,
            base: d.base,
            role: d.role,
            color: d.color,
          })),
          // Demo-side highway corridor lookup. The dispatch view falls
          // back to a straight-line / arch breadcrumb when this returns
          // null, so it's safe to leave undefined for hosts that don't
          // ship their own routing data.
          getRouteWaypoints: (from, to) => {
            const wps = getWaypoints(from, to);
            return wps ? wps.map((w) => ({ lat: w.lat, lng: w.lng })) : null;
          },
          showCalendarLegend: false,
          showOfflineIndicator: false,
        }}
      />
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<DemoApp />);
