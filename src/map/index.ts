/**
 * Map abstraction — render route lines on any host map engine.
 *
 * Store geography, project on demand: route features carry lng/lat, an adapter
 * wraps the host map, and `projectRoutes` turns features into screen-space
 * polylines on every view change so lines stay correct at every zoom.
 */
export type {
  MapAdapter,
  LngLat,
  ScreenPoint,
  RouteStatus,
  RouteFeature,
} from './MapAdapter';
export {
  haversineKm,
  interpolateGreatCircle,
  densifyLeg,
  densifyPath,
  type DensifyOptions,
} from './geodesic';
export {
  projectRoutes,
  toPolylinePoints,
  type ProjectedRoute,
  type ProjectRoutesOptions,
} from './projectRoutes';

export { createLeafletAdapter, type LeafletMapLike } from './adapters/leaflet';
export {
  createGoogleAdapter,
  type GoogleMapLike,
  type GoogleOverlayLike,
} from './adapters/google';
export {
  createBingAdapter,
  createAzureMapsAdapter,
  type BingMapLike,
  type BingEventsLike,
  type AzureMapLike,
} from './adapters/bing';
