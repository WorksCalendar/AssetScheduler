/**
 * Bing Maps MapAdapter.
 *
 * ⚠️ DEPRECATED PLATFORM: Microsoft has retired Bing Maps for Enterprise (free
 * tier ended 2025; enterprise winding down) and is not issuing new keys — new
 * builds should target **Azure Maps** instead. This adapter is provided for
 * existing Bing Maps V8 deployments; `createAzureMapsAdapter` below is the
 * forward-looking equivalent and is a drop-in swap.
 *
 * Typed structurally to avoid a hard dependency on the Bing/Azure SDKs.
 */
import type { LngLat, MapAdapter, ScreenPoint } from '../MapAdapter';

interface BingPoint { x: number; y: number }
interface BingLocationCtor {
  new (lat: number, lng: number): unknown;
}
export interface BingMapLike {
  tryLocationToPixel(location: unknown, reference?: unknown): BingPoint | null;
  getZoom(): number;
  getWidth(): number;
  getHeight(): number;
}
export interface BingEventsLike {
  addHandler(target: unknown, eventName: string, handler: () => void): unknown;
  removeHandler(handle: unknown): void;
}

export function createBingAdapter(
  map: BingMapLike,
  /** `Microsoft.Maps.Location` constructor. */
  Location: BingLocationCtor,
  /** `Microsoft.Maps.Events`. */
  Events: BingEventsLike,
): MapAdapter {
  return {
    project(point: LngLat): ScreenPoint | null {
      const p = map.tryLocationToPixel(new Location(point.lat, point.lng));
      return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
    },
    getZoom: () => map.getZoom(),
    getSize: () => ({ width: map.getWidth(), height: map.getHeight() }),
    onViewChange(listener: () => void): () => void {
      const handle = Events.addHandler(map, 'viewchange', listener);
      const handleEnd = Events.addHandler(map, 'viewchangeend', listener);
      return () => {
        Events.removeHandler(handle);
        Events.removeHandler(handleEnd);
      };
    },
  };
}

// ── Azure Maps (Bing's official successor) ───────────────────────────────────

interface AzurePixel { 0: number; 1: number }
export interface AzureMapLike {
  positionsToPixels(positions: [number, number][]): AzurePixel[];
  getCamera(): { zoom?: number };
  getCanvasContainer(): { clientWidth: number; clientHeight: number };
  events: {
    add(eventName: string, handler: () => void): void;
    remove(eventName: string, handler: () => void): void;
  };
}

/** Azure Maps adapter — the recommended replacement for Bing. */
export function createAzureMapsAdapter(map: AzureMapLike): MapAdapter {
  return {
    project(point: LngLat): ScreenPoint | null {
      // Azure uses [lng, lat] order.
      const [p] = map.positionsToPixels([[point.lng, point.lat]]);
      return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? { x: p[0], y: p[1] } : null;
    },
    getZoom: () => map.getCamera().zoom ?? 0,
    getSize: () => {
      const c = map.getCanvasContainer();
      return { width: c.clientWidth, height: c.clientHeight };
    },
    onViewChange(listener: () => void): () => void {
      map.events.add('move', listener);
      return () => map.events.remove('move', listener);
    },
  };
}
