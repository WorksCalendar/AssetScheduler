/**
 * Engine-agnostic route projection. Given a MapAdapter and geographic route
 * features, produces screen-space polylines ready to draw in an SVG overlay.
 * Call it once per view change (the adapter's onViewChange) so lines stay glued
 * to the basemap at every zoom/pan — including fractional zoom.
 */
import type { LngLat, MapAdapter, RouteFeature, RouteStatus, ScreenPoint } from './MapAdapter';
import { densifyPath, type DensifyOptions } from './geodesic';

export interface ProjectedRoute {
  id: string;
  status: RouteStatus;
  color?: string;
  label?: string;
  selected: boolean;
  /** Projected, densified polyline points in container pixels. */
  points: ScreenPoint[];
  /** Endpoints for origin/destination markers. */
  start?: ScreenPoint;
  end?: ScreenPoint;
  /** Mid-path point for an anchored label. */
  midpoint?: ScreenPoint;
}

export interface ProjectRoutesOptions extends DensifyOptions {
  /**
   * Cull features whose projected points all fall this many pixels outside the
   * container. Default 256 (keeps lines that pass through the viewport). Pass
   * Infinity to disable culling.
   */
  cullMarginPx?: number;
}

function within(p: ScreenPoint, w: number, h: number, m: number): boolean {
  return p.x >= -m && p.y >= -m && p.x <= w + m && p.y <= h + m;
}

export function projectRoutes(
  adapter: MapAdapter,
  features: readonly RouteFeature[],
  opts: ProjectRoutesOptions = {},
): ProjectedRoute[] {
  const { cullMarginPx = 256, ...densify } = opts;
  const { width, height } = adapter.getSize();
  const out: ProjectedRoute[] = [];

  for (const f of features) {
    if (f.path.length === 0) continue;
    const dense: LngLat[] = densifyPath(f.path, densify);
    const points: ScreenPoint[] = [];
    for (const g of dense) {
      const p = adapter.project(g);
      if (p) points.push(p);
    }
    if (points.length < 2) continue;

    // Cull whole feature only when nothing is near the viewport.
    if (cullMarginPx !== Infinity && !points.some((p) => within(p, width, height, cullMarginPx))) {
      continue;
    }

    const start = points[0];
    const end = points[points.length - 1];
    const midpoint = points[Math.floor(points.length / 2)];
    out.push({
      id: f.id,
      status: f.status,
      ...(f.color !== undefined ? { color: f.color } : {}),
      ...(f.label !== undefined ? { label: f.label } : {}),
      selected: f.selected ?? false,
      points,
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(midpoint ? { midpoint } : {}),
    });
  }

  // Selected routes render last (on top).
  out.sort((a, b) => Number(a.selected) - Number(b.selected));
  return out;
}

/** Build an SVG `points`/`d` string from a projected polyline. */
export function toPolylinePoints(route: ProjectedRoute): string {
  return route.points.map((p) => `${p.x},${p.y}`).join(' ');
}
