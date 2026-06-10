/**
 * DispatchView — thin adapter that renders the tactical dispatch board
 * inside WorksCalendar's view-routing chrome.
 *
 * The view itself lives in src/views/dispatch/. This file pulls the
 * calendar's normalized events + asset roster off the (loosely-typed)
 * props bag CalendarViewGrid hands in, and forwards them to DispatchBoard.
 *
 * Public types: `DispatchMissionCandidate` / `DispatchMissionReadiness`
 * remain re-exported via WorksCalendar.types for backward compatibility
 * with consumers that wired the old readiness-queue API. They're now
 * inert from the view's perspective — kept here as a stable type surface
 * until a major-version bump lets us remove them cleanly.
 */
import type { ReactNode } from 'react';
import type { NormalizedEvent } from 'works-calendar-engine';
import { DispatchBoard, type DispatchAssetEntry } from './dispatch/DispatchBoard';

// ── Public types (kept for backwards compat) ─────────────────────────────────

export type DispatchMissionCandidate = {
  readonly id: string;
  readonly label: string;
  readonly window?: { start: Date | string; end: Date | string };
  readonly meta?: Readonly<Record<string, unknown>>;
};

export type DispatchMissionReadiness = {
  readonly satisfied: boolean;
  readonly missing?: readonly { kind: string; label: string }[];
  readonly reason?: string;
};

// ── View adapter ─────────────────────────────────────────────────────────────

interface DispatchViewLooseProps {
  readonly events?: readonly NormalizedEvent[];
  readonly assets?: readonly DispatchAssetEntry[];
  readonly initialAsOf?: Date;
  /** Host calendar's currentDate, fed through so the slider and the
   *  Month/Week/Day views share a single source of truth. */
  readonly currentDate?: Date;
  readonly onCurrentDateChange?: (d: Date) => void;
  /** View-switcher node injected by the host when this view owns chrome. */
  readonly viewSwitcher?: ReactNode;
  /** Optional host-provided route-waypoint lookup (e.g. highway corridors).
   *  When present and a leg's from/to pair resolves to a waypoint list,
   *  the dispatch map draws a polyline through those points; otherwise the
   *  arch / straight-line fallback is used. */
  readonly getRouteWaypoints?: (fromCode: string, toCode: string) => readonly { lat: number; lng: number }[] | null;
  readonly dispatchRoutes?: readonly import('../map').RouteFeature[];
  // Legacy props (employees, bases, missions, evaluateForMission, onAssign, …)
  // are accepted to keep CalendarViewGrid's existing wiring stable but ignored
  // by the new board. The dispatch view derives everything it renders from
  // `events` + `assets`.
  readonly [k: string]: unknown;
}

export default function DispatchView(props: DispatchViewLooseProps) {
  const events = (props.events ?? []) as readonly NormalizedEvent[];
  const assets = (props.assets ?? []) as readonly DispatchAssetEntry[];
  return (
    <DispatchBoard
      events={events}
      assets={assets}
      {...(props.initialAsOf ? { initialDate: props.initialAsOf } : {})}
      {...(props.currentDate ? { currentDate: props.currentDate } : {})}
      {...(props.onCurrentDateChange ? { onCurrentDateChange: props.onCurrentDateChange } : {})}
      {...(props.viewSwitcher ? { viewSwitcher: props.viewSwitcher } : {})}
      {...(props.getRouteWaypoints ? { getRouteWaypoints: props.getRouteWaypoints } : {})}
      {...(props.dispatchRoutes ? { dispatchRoutes: props.dispatchRoutes } : {})}
    />
  );
}
