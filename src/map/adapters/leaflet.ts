/**
 * Leaflet MapAdapter — the default "bring your own OpenStreetMap" path.
 *
 * Leaflet projects in Web Mercator (EPSG:3857), the same projection OSM raster
 * tiles use, so geographic route data registers exactly. We type the map
 * structurally to avoid a hard dependency on `leaflet` / `@types/leaflet`; pass
 * your real `L.Map` instance.
 *
 *   import { createLeafletAdapter } from 'works-calendar';
 *   const adapter = createLeafletAdapter(map); // map = L.map(...)
 */
import type { LngLat, MapAdapter, ScreenPoint } from '../MapAdapter';

interface LeafletPoint { x: number; y: number }
interface LeafletSize { x: number; y: number }
export interface LeafletMapLike {
  latLngToContainerPoint(latlng: [number, number] | { lat: number; lng: number }): LeafletPoint;
  getZoom(): number;
  getSize(): LeafletSize;
  on(types: string, fn: () => void): unknown;
  off(types: string, fn: () => void): unknown;
}

// Pan + zoom (incl. inertial) all surface through these Leaflet events.
const VIEW_EVENTS = 'move zoom viewreset resize';

export function createLeafletAdapter(map: LeafletMapLike): MapAdapter {
  return {
    project(point: LngLat): ScreenPoint | null {
      const p = map.latLngToContainerPoint({ lat: point.lat, lng: point.lng });
      return Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
    },
    getZoom: () => map.getZoom(),
    getSize: () => {
      const s = map.getSize();
      return { width: s.x, height: s.y };
    },
    onViewChange(listener: () => void): () => void {
      map.on(VIEW_EVENTS, listener);
      return () => map.off(VIEW_EVENTS, listener);
    },
  };
}
