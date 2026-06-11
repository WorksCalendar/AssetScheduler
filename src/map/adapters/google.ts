/**
 * Google Maps MapAdapter.
 *
 * Google only exposes pixel projection through an OverlayView's
 * MapCanvasProjection, so the host creates a (typically empty) OverlayView,
 * adds it to the map, and passes both here. We type structurally to avoid a
 * hard dependency on `@types/google.maps`.
 *
 *   const overlay = new google.maps.OverlayView();
 *   overlay.onAdd = overlay.draw = overlay.onRemove = () => {};
 *   overlay.setMap(map);
 *   const adapter = createGoogleAdapter(map, overlay);
 */
import type { LngLat, MapAdapter, ScreenPoint } from '../MapAdapter';

interface GooglePoint { x: number; y: number }
interface GoogleProjection {
  fromLatLngToContainerPixel(latLng: unknown): GooglePoint | null;
}
interface GoogleLatLngCtor {
  new (lat: number, lng: number): unknown;
}
export interface GoogleOverlayLike {
  getProjection(): GoogleProjection | null;
}
export interface GoogleMapLike {
  getZoom(): number | undefined;
  getDiv(): { clientWidth: number; clientHeight: number };
  addListener(eventName: string, handler: () => void): { remove: () => void };
}

export function createGoogleAdapter(
  map: GoogleMapLike,
  overlay: GoogleOverlayLike,
  /** Pass `google.maps.LatLng` so we can build the projection input. */
  LatLng: GoogleLatLngCtor,
): MapAdapter {
  return {
    project(point: LngLat): ScreenPoint | null {
      const proj = overlay.getProjection();
      if (!proj) return null;
      const p = proj.fromLatLngToContainerPixel(new LatLng(point.lat, point.lng));
      return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
    },
    getZoom: () => map.getZoom() ?? 0,
    getSize: () => {
      const d = map.getDiv();
      return { width: d.clientWidth, height: d.clientHeight };
    },
    onViewChange(listener: () => void): () => void {
      // bounds_changed fires continuously during pan/zoom; idle catches the end.
      const handles = ['bounds_changed', 'zoom_changed', 'idle'].map((e) =>
        map.addListener(e, listener),
      );
      return () => handles.forEach((h) => h.remove());
    },
  };
}
