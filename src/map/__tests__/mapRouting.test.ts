/**
 * Map routing — geodesic densification + engine-agnostic projection.
 * Uses a mock adapter (a simple linear projection) so the orchestration is
 * tested without any real map engine.
 */
import { describe, it, expect } from 'vitest';
import { densifyLeg, densifyPath, haversineKm, interpolateGreatCircle } from '../geodesic';
import { projectRoutes, toPolylinePoints } from '../projectRoutes';
import type { LngLat, MapAdapter, RouteFeature } from '../MapAdapter';

const PHX: LngLat = { lng: -112.074, lat: 33.4484 };
const LAX: LngLat = { lng: -118.4085, lat: 33.9416 };

describe('geodesic', () => {
  it('haversine ~matches the known PHX→LAX distance', () => {
    const km = haversineKm(PHX, LAX);
    expect(km).toBeGreaterThan(560);
    expect(km).toBeLessThan(620);
  });

  it('interpolateGreatCircle endpoints are exact and midpoint is between', () => {
    expect(interpolateGreatCircle(PHX, LAX, 0)).toMatchObject({ lng: PHX.lng });
    const mid = interpolateGreatCircle(PHX, LAX, 0.5);
    expect(mid.lng).toBeLessThan(PHX.lng);
    expect(mid.lng).toBeGreaterThan(LAX.lng);
  });

  it('interpolate handles coincident points without NaN', () => {
    const p = interpolateGreatCircle(PHX, PHX, 0.5);
    expect(Number.isNaN(p.lat)).toBe(false);
    expect(p).toMatchObject({ lat: PHX.lat, lng: PHX.lng });
  });

  it('densifyLeg preserves endpoints and adds points for long legs', () => {
    const pts = densifyLeg(PHX, LAX, { maxSegmentKm: 100 });
    expect(pts[0]).toMatchObject(PHX);
    expect(pts[pts.length - 1]).toMatchObject(LAX);
    expect(pts.length).toBeGreaterThan(2);
  });

  it('densifyLeg returns just the endpoints for a short leg', () => {
    const a = { lng: 0, lat: 0 };
    const b = { lng: 0.01, lat: 0.01 };
    expect(densifyLeg(a, b)).toHaveLength(2);
  });

  it('densifyPath de-duplicates shared vertices between legs', () => {
    const mid = { lng: -115, lat: 33.7 };
    const out = densifyPath([PHX, mid, LAX], { maxSegmentKm: 100 });
    // No consecutive duplicate points at the join.
    for (let i = 1; i < out.length; i++) {
      expect(out[i]).not.toEqual(out[i - 1]);
    }
  });
});

// Linear mock: lng -180..180 → x 0..360, lat 90..-90 → y 0..180, scaled by zoom.
function mockAdapter(zoom = 1, size = { width: 360, height: 180 }): MapAdapter {
  return {
    project: (p) => ({ x: (p.lng + 180) * zoom, y: (90 - p.lat) * zoom }),
    getZoom: () => zoom,
    getSize: () => size,
    onViewChange: () => () => {},
  };
}

const ROUTE: RouteFeature = { id: 'r1', path: [PHX, LAX], status: 'amber', label: 'PHX → LAX' };

describe('projectRoutes', () => {
  it('projects a feature into a polyline with endpoints + midpoint', () => {
    const [pr] = projectRoutes(mockAdapter(), [ROUTE], { cullMarginPx: Infinity });
    expect(pr).toBeDefined();
    expect(pr!.points.length).toBeGreaterThan(2);
    expect(pr!.start).toEqual(pr!.points[0]);
    expect(pr!.end).toEqual(pr!.points[pr!.points.length - 1]);
    expect(pr!.midpoint).toBeDefined();
    expect(pr!.status).toBe('amber');
    expect(pr!.label).toBe('PHX → LAX');
  });

  it('reprojects under a different zoom (points scale)', () => {
    const a = projectRoutes(mockAdapter(1), [ROUTE], { cullMarginPx: Infinity })[0]!;
    const b = projectRoutes(mockAdapter(2), [ROUTE], { cullMarginPx: Infinity })[0]!;
    expect(b.start!.x).toBeCloseTo(a.start!.x * 2, 5);
  });

  it('culls a feature entirely outside the viewport + margin', () => {
    // Tiny viewport far from the projected coords.
    const adapter = mockAdapter(1, { width: 5, height: 5 });
    expect(projectRoutes(adapter, [ROUTE], { cullMarginPx: 10 })).toHaveLength(0);
  });

  it('keeps a feature when culling is disabled', () => {
    const adapter = mockAdapter(1, { width: 5, height: 5 });
    expect(projectRoutes(adapter, [ROUTE], { cullMarginPx: Infinity })).toHaveLength(1);
  });

  it('drops degenerate features with < 2 projectable points', () => {
    const empty: RouteFeature = { id: 'x', path: [], status: 'green' };
    expect(projectRoutes(mockAdapter(), [empty], { cullMarginPx: Infinity })).toHaveLength(0);
  });

  it('orders selected routes last so they render on top', () => {
    const a: RouteFeature = { id: 'a', path: [PHX, LAX], status: 'green' };
    const b: RouteFeature = { id: 'b', path: [PHX, LAX], status: 'red', selected: true };
    const out = projectRoutes(mockAdapter(), [a, b], { cullMarginPx: Infinity });
    expect(out[out.length - 1]!.id).toBe('b');
  });

  it('toPolylinePoints renders an SVG points string', () => {
    const [pr] = projectRoutes(mockAdapter(), [ROUTE], { cullMarginPx: Infinity });
    const s = toPolylinePoints(pr!);
    expect(s).toMatch(/^[\d.,\s-]+$/);
    expect(s.split(' ').length).toBe(pr!.points.length);
  });
});
