/**
 * Great-circle helpers. A straight [lng,lat]→[lng,lat] segment looks wrong (or
 * cuts the projection seam) at low zoom over long distances, so we densify each
 * leg into many points along the great circle before projecting. Endpoints are
 * always preserved exactly.
 */
import type { LngLat } from './MapAdapter';

const R_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in km. */
export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Point at fraction `f` (0..1) along the great circle from a to b.
 * Falls back to linear interpolation for near-coincident points.
 */
export function interpolateGreatCircle(a: LngLat, b: LngLat, f: number): LngLat {
  // Keep the endpoints exact (avoids float drift at f=0/1).
  if (f <= 0) return { lng: a.lng, lat: a.lat };
  if (f >= 1) return { lng: b.lng, lat: b.lat };
  const lat1 = toRad(a.lat);
  const lng1 = toRad(a.lng);
  const lat2 = toRad(b.lat);
  const lng2 = toRad(b.lng);

  const d =
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin((lat2 - lat1) / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2,
        ),
      ),
    );
  if (d === 0) return { lng: a.lng, lat: a.lat };

  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
  const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  return { lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), lng: toDeg(Math.atan2(y, x)) };
}

export interface DensifyOptions {
  /** Target spacing between interpolated points, in km. Default 200. */
  maxSegmentKm?: number;
  /** Clamp the number of segments per leg. Defaults 1..256. */
  minSegments?: number;
  maxSegments?: number;
}

/** Densify one leg into great-circle points (inclusive of both endpoints). */
export function densifyLeg(a: LngLat, b: LngLat, opts: DensifyOptions = {}): LngLat[] {
  const { maxSegmentKm = 200, minSegments = 1, maxSegments = 256 } = opts;
  const dist = haversineKm(a, b);
  const segs = Math.max(minSegments, Math.min(maxSegments, Math.ceil(dist / maxSegmentKm) || 1));
  if (segs <= 1) return [{ ...a }, { ...b }];
  const out: LngLat[] = [];
  for (let i = 0; i <= segs; i++) out.push(interpolateGreatCircle(a, b, i / segs));
  return out;
}

/** Densify a multi-point path, de-duplicating shared vertices between legs. */
export function densifyPath(path: readonly LngLat[], opts?: DensifyOptions): LngLat[] {
  if (path.length < 2) return path.map((p) => ({ ...p }));
  const out: LngLat[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const leg = densifyLeg(path[i]!, path[i + 1]!, opts);
    out.push(...(i === 0 ? leg : leg.slice(1)));
  }
  return out;
}
