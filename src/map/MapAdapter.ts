/**
 * Map adapter contract — lets route lines render on any host map engine.
 *
 * The golden rule: route data is geographic (lng/lat), never pixels. The host
 * map owns the projection; we re-project on every view change. An adapter is a
 * thin wrapper a host builds around its own map instance (Leaflet, Google,
 * Bing/Azure, …) so our rendering code never depends on a specific engine.
 */

export type LngLat = { lng: number; lat: number };
export type ScreenPoint = { x: number; y: number };
export type RouteStatus = 'green' | 'amber' | 'red';

/** A geographic route to draw, e.g. an assignment's dispatch leg(s). */
export interface RouteFeature {
  id: string;
  /** Ordered waypoints, origin → destination (2+ points). */
  path: readonly LngLat[];
  status: RouteStatus;
  /** Optional accent override (else derived from status). */
  color?: string;
  label?: string;
  selected?: boolean;
}

export interface MapAdapter {
  /**
   * Project a geographic point to container pixels (origin = map top-left).
   * May return points outside the container so lines entering/leaving the
   * viewport still render. Returns null when projection is unavailable.
   */
  project(point: LngLat): ScreenPoint | null;
  /** Current zoom level (fractional values are fine). */
  getZoom(): number;
  /** Container size in CSS pixels, used for culling + the overlay viewBox. */
  getSize(): { width: number; height: number };
  /**
   * Subscribe to any view change (pan, zoom — including inertial/fractional).
   * Returns an unsubscribe function. The overlay reprojects on each call.
   */
  onViewChange(listener: () => void): () => void;
}
