/**
 * Tactical map — fixed-zoom SVG projection of asset positions, breadcrumb
 * trails between stops, and animated conflict pulses at facilities.
 *
 * Ported from `demo/app/src/components/TacticalMap.tsx`. Asset-agnostic:
 * works for trucks, planes, employees, anything with a lat/lng-tagged
 * event stream.
 */
import { useMemo } from 'react';
import { project, DEFAULT_LAYER_BOUNDS } from './projection';
import { positionAt } from './deriveData';
import { DEFAULT_LAYER_ZOOM, tilesForBounds } from './tileLayer';
import { projectRoutes, toPolylinePoints } from '../../map';
import type { MapAdapter, RouteFeature, RouteStatus } from '../../map';
import type {
  DispatchAsset,
  DispatchConflict,
  DispatchFacility,
  DispatchSegment,
  DispatchStop,
  MapLayer,
} from './types';

interface Props {
  readonly assets: readonly DispatchAsset[];
  readonly facilities: readonly DispatchFacility[];
  readonly stopsByAsset: ReadonlyMap<string, DispatchStop[]>;
  readonly segmentsByAsset: ReadonlyMap<string, DispatchSegment[]>;
  readonly conflicts: readonly DispatchConflict[];
  readonly selectedDate: Date;
  readonly selectedAsset: string | null;
  readonly onSelectAsset: (id: string) => void;
  readonly layer: MapLayer;
  /** Render an OSM raster tile basemap underneath. Default true. */
  readonly showTiles?: boolean;
  /** Override the slippy-map tile URL ({z}/{x}/{y}). */
  readonly tileUrl?: string;
  /** Host-provided waypoint lookup for road-following breadcrumbs.
   *  Returns the ordered list of lat/lng points (endpoints inclusive)
   *  the leg passes through. When null/missing, the leg falls back to a
   *  3D quadratic-arch breadcrumb between the two endpoint stops. */
  readonly getRouteWaypoints?: (fromCode: string, toCode: string) => readonly { lat: number; lng: number }[] | null;
  /** Geographic route overlay (e.g. committed assignment legs) drawn through
   *  the MapAdapter abstraction so the same data renders on any host map. */
  readonly dispatchRoutes?: readonly RouteFeature[];
  /** When no asset is selected, draw a fading "comet tail" of each asset's
   *  travel over the last this-many hours instead of the full breadcrumb
   *  spaghetti. Default 3. */
  readonly tailHours?: number;
}

const TAIL_SAMPLES = 14;

const ROUTE_STATUS_COLOR: Record<RouteStatus, string> = {
  green: '#16a34a',
  amber: '#d97706',
  red: '#dc2626',
};

const VW = 1000;
const VH = 800;

export function TacticalMap({
  assets,
  facilities,
  stopsByAsset,
  segmentsByAsset,
  conflicts,
  selectedDate,
  selectedAsset,
  onSelectAsset,
  layer,
  showTiles = true,
  tileUrl,
  getRouteWaypoints,
  dispatchRoutes,
  tailHours = 3,
}: Props) {
  const bounds = DEFAULT_LAYER_BOUNDS[layer];
  const proj = (lat: number, lng: number): [number, number] =>
    project(bounds, lat, lng, VW, VH);

  // Wrap this SVG's fixed-zoom projection as a MapAdapter, then project the
  // geographic route overlay to viewBox space. Changing the layer (the SVG's
  // "zoom") re-runs this via the memo dependency — the BYO-map equivalent of
  // an onViewChange reproject.
  const projectedRoutes = useMemo(() => {
    if (!dispatchRoutes || dispatchRoutes.length === 0) return [];
    const adapter: MapAdapter = {
      project: ({ lat, lng }) => {
        const [x, y] = proj(lat, lng);
        return { x, y };
      },
      getZoom: () => DEFAULT_LAYER_ZOOM[layer],
      getSize: () => ({ width: VW, height: VH }),
      onViewChange: () => () => {},
    };
    return projectRoutes(adapter, dispatchRoutes, { cullMarginPx: 200 });
  }, [dispatchRoutes, layer]);

  const tiles = useMemo(
    () =>
      showTiles
        ? tilesForBounds(bounds, DEFAULT_LAYER_ZOOM[layer], tileUrl)
        : [],
    [bounds, layer, showTiles, tileUrl],
  );

  const conflictsAtTime = useMemo(() => {
    const dayStart = new Date(
      Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), selectedDate.getUTCDate()),
    );
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    return conflicts.filter((c) => {
      const t = c.timeA.getTime();
      return t >= dayStart.getTime() && t < dayEnd.getTime();
    });
  }, [conflicts, selectedDate]);

  const assetColorById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assets) m.set(a.id, a.color);
    return m;
  }, [assets]);

  // Comet tails (only when nothing is selected): sample each asset's position
  // over the last `tailHours` and keep the distinct points, head = current
  // position at the slider time. Geographic only — projection happens in render
  // so it re-runs on layer change.
  const assetTails = useMemo(() => {
    if (selectedAsset) return [];
    const endMs = selectedDate.getTime();
    const startMs = endMs - tailHours * 3_600_000;
    const out: { id: string; color: string; pts: { lat: number; lng: number }[] }[] = [];
    for (const asset of assets) {
      const stops = stopsByAsset.get(asset.id);
      if (!stops) continue;
      const pts: { lat: number; lng: number }[] = [];
      for (let k = 0; k <= TAIL_SAMPLES; k++) {
        const p = positionAt(stops, new Date(startMs + ((endMs - startMs) * k) / TAIL_SAMPLES));
        if (!p) continue;
        const last = pts[pts.length - 1];
        // Drop consecutive ~identical samples so a parked asset draws nothing.
        if (!last || Math.abs(last.lat - p.lat) > 1e-6 || Math.abs(last.lng - p.lng) > 1e-6) {
          pts.push({ lat: p.lat, lng: p.lng });
        }
      }
      if (pts.length >= 2) {
        out.push({ id: asset.id, color: assetColorById.get(asset.id) ?? '#3d2b1f', pts });
      }
    }
    return out;
  }, [assets, stopsByAsset, selectedDate, selectedAsset, tailHours, assetColorById]);

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full h-full" style={{ background: 'var(--tac-bg)' }}>
      <defs>
        <filter id="dispatch-ink">
          <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves={2} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={2} />
        </filter>
        {/* Soft drop shadow for the arched breadcrumbs to read as
            lifted above the ground plane. */}
        <filter id="dispatch-arch-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceAlpha" stdDeviation={1.2} />
          <feOffset dy={1.5} result="off" />
          <feComponentTransfer>
            <feFuncA type="linear" slope={0.35} />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Glow ring for conflict pulses — a wide red diffusion that
            survives behind the dashed outline so the alert reads from
            across the screen rather than disappearing under route
            breadcrumbs. */}
        <filter id="dispatch-conflict-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={5} result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width={VW} height={VH} fill="var(--tac-bg)" />

      {/* OSM raster tile basemap — each tile is placed by projecting its
          NW/SE corners through the current layer's bounds. Tiles render in
          their natural OSM colors (no tint overlay). */}
      {tiles.length > 0 && (
        <g>
          {tiles.map((t) => {
            const [x1, y1] = proj(t.nw.lat, t.nw.lng);
            const [x2, y2] = proj(t.se.lat, t.se.lng);
            const w = x2 - x1;
            const h = y2 - y1;
            return (
              <image
                key={`${t.z}-${t.x}-${t.y}`}
                href={t.url}
                x={x1}
                y={y1}
                width={w}
                height={h}
                preserveAspectRatio="none"
                crossOrigin="anonymous"
                style={{ imageRendering: 'auto' }}
              />
            );
          })}
        </g>
      )}

      {/* Layer-name watermark for the non-region zoom presets, since the
          hand-traced state outlines are gone now. */}
      {layer !== 'region' && (
        <text
          x={VW / 2}
          y={36}
          textAnchor="middle"
          fontFamily="serif"
          fontSize={12}
          fill="var(--tac-ink-soft)"
          letterSpacing={2}
          opacity={0.55}
        >
          {layer.toUpperCase()} VIEW
        </text>
      )}

      {/* Breadcrumb segments. When the host supplies `getRouteWaypoints`
          and the leg's from/to pair resolves to a road-corridor path
          with at least one intermediate stop, render the route as an
          SVG polyline tracing those waypoints (so a PHX→ELP leg follows
          I-10 through TUS instead of crow's-flighting). Otherwise fall
          back to the prior quadratic-arch breadcrumb — lifts off the
          ground plane, gives an origin→destination "flight path" feel
          without needing real road routing.

          Off-screen culling: at zoomed-in layers (5k / 1k) most legs
          have endpoints far outside the viewBox; drop any whose entire
          bounding box sits beyond a generous margin. Avoids painting
          hundreds of paths with multi-thousand-pixel coordinates +
          stops iOS Safari OOMing on the filter region. */}
      {assets.flatMap((asset) => {
        // No selection → the comet tails carry recent progress instead of the
        // full breadcrumb network, keeping the map calm.
        if (!selectedAsset) return [];
        const segs = segmentsByAsset.get(asset.id) ?? [];
        const isSelected = asset.id === selectedAsset;
        const baseOpacity = selectedAsset ? (isSelected ? 1 : 0.015) : 0.35;
        return segs.map((seg, i) => {
          const [x1, y1] = proj(seg.from.lat, seg.from.lng);
          const [x2, y2] = proj(seg.to.lat, seg.to.lng);
          const MARGIN = 200;
          const minX = Math.min(x1, x2);
          const maxX = Math.max(x1, x2);
          const minY = Math.min(y1, y2);
          const maxY = Math.max(y1, y2);
          if (maxX < -MARGIN || minX > VW + MARGIN || maxY < -MARGIN || minY > VH + MARGIN) {
            return null;
          }
          const past = seg.to.time.getTime() <= selectedDate.getTime();
          const stroke = isSelected ? 2.5 : 1.5;
          const opacity = past
            ? isSelected
              ? 1
              : (0.55 * baseOpacity) / 0.35
            : isSelected
              ? 0.55
              : (0.18 * baseOpacity) / 0.35;

          // Try the host's waypoint lookup first. A path with more than
          // two points means the corridor pulled in intermediates worth
          // drawing; two-or-fewer points reduces to a straight line and
          // we prefer the arch fallback for visual interest.
          const waypoints = getRouteWaypoints?.(seg.from.facilityCode, seg.to.facilityCode) ?? null;
          const followsRoad = !!waypoints && waypoints.length > 2;
          let d: string;
          if (followsRoad && waypoints) {
            const projected = waypoints.map((w) => proj(w.lat, w.lng));
            d = `M ${projected[0]![0]} ${projected[0]![1]}` +
              projected.slice(1).map(([x, y]) => ` L ${x} ${y}`).join('');
          } else {
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy);
            const archH = Math.min(Math.max(len * 0.22, 12), 80);
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const nx = len === 0 ? 0 : -dy / len;
            const ny = len === 0 ? -1 : dx / len;
            const upBias = ny < 0 ? 1 : -1;
            const cx = midX + nx * archH * upBias;
            const cy = midY + ny * archH * upBias;
            d = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
          }
          return (
            <g key={`${asset.id}-${i}`} opacity={opacity}>
              {/* Ground shadow — slim guide along the straight base
                  between facility endpoints. Only drawn for arch legs;
                  road-following legs already lay flat. */}
              {!followsRoad && (isSelected || !selectedAsset) && (
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="var(--tac-ink)"
                  strokeWidth={0.8}
                  strokeDasharray="1,4"
                  opacity={0.25}
                />
              )}
              <path
                d={d}
                fill="none"
                stroke={asset.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={past ? 'none' : '5,4'}
                {...(isSelected ? { filter: 'url(#dispatch-arch-shadow)' } : {})}
              />
            </g>
          );
        });
      })}

      {/* Facility anchors */}
      {facilities.map((fac) => {
        const [x, y] = proj(fac.lat, fac.lng);
        return (
          <g key={fac.code} transform={`translate(${x},${y})`}>
            <circle r={8} fill="var(--tac-panel)" stroke="var(--tac-ink)" strokeWidth={1.5} filter="url(#dispatch-ink)" />
            <text y={-12} textAnchor="middle" fontFamily="serif" fontSize={12} fill="var(--tac-ink)" fontWeight="bold">
              {fac.code}
            </text>
            {fac.capacity != null && (
              <text y={20} textAnchor="middle" fontFamily="sans-serif" fontSize={8} fill="var(--tac-ink-soft)">
                {fac.capacity} docks
              </text>
            )}
          </g>
        );
      })}

      {/* Comet tails — recent travel behind each asset when nothing is
          selected. Tapers + fades from the head (current position) back, so
          direction and progress read at a glance without route spaghetti. */}
      {assetTails.map((tail) => {
        const pp = tail.pts.map((p) => proj(p.lat, p.lng));
        const xs = pp.map((p) => p[0]);
        const ys = pp.map((p) => p[1]);
        const M = 200;
        if (Math.max(...xs) < -M || Math.min(...xs) > VW + M || Math.max(...ys) < -M || Math.min(...ys) > VH + M) {
          return null;
        }
        const n = pp.length - 1;
        return (
          <g key={`tail-${tail.id}`}>
            {pp.slice(1).map(([x2, y2], i) => {
              const [x1, y1] = pp[i]!;
              const f = (i + 1) / n; // 0 (tail) → 1 (head)
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={tail.color}
                  strokeWidth={0.6 + 2.4 * f}
                  strokeOpacity={0.1 + 0.65 * f}
                  strokeLinecap="round"
                />
              );
            })}
          </g>
        );
      })}

      {/* Asset markers — interpolated position at the selected time */}
      {assets.map((asset) => {
        const pos = positionAt(stopsByAsset.get(asset.id), selectedDate);
        if (!pos) return null;
        const [x, y] = proj(pos.lat, pos.lng);
        const isSelected = asset.id === selectedAsset;
        const color = assetColorById.get(asset.id) ?? '#3d2b1f';
        return (
          <g
            key={asset.id}
            transform={`translate(${x},${y})`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectAsset(isSelected ? '' : asset.id);
            }}
            style={{ cursor: 'pointer', opacity: selectedAsset ? (isSelected ? 1 : 0.15) : 1 }}
          >
            <title>{`${asset.id} — ${asset.name}\n${pos.moving ? 'En route' : `@ ${pos.facilityCode ?? 'unknown'}`}`}</title>
            <circle
              r={isSelected ? 12 : selectedAsset ? 5 : 8}
              fill={color}
              stroke="#fff"
              strokeWidth={isSelected ? 3 : 2}
            >
              {isSelected && <animate attributeName="r" values="10;14;10" dur="1.5s" repeatCount="indefinite" />}
            </circle>
            {/* Label only on the selected truck — without this, 30 ids float
                on top of each other and the map turns into typographic
                confetti. Hover state surfaces the id via the <title>. */}
            {isSelected && (
              <text y={-16} textAnchor="middle" fontFamily="sans-serif" fontSize={11} fill="var(--tac-ink)" fontWeight="bold">
                {asset.id}
              </text>
            )}
          </g>
        );
      })}

      {/* Assignment route overlay — committed dispatch legs, colour-coded by
          allocation health (green/amber/red). Projected via the MapAdapter so
          the identical RouteFeature data renders on Leaflet/Google/etc. too. */}
      {projectedRoutes.map((r) => {
        const color = r.color ?? ROUTE_STATUS_COLOR[r.status];
        const pts = toPolylinePoints(r);
        return (
          <g key={`route-${r.id}`} opacity={r.selected ? 1 : 0.95}>
            <polyline
              points={pts}
              fill="none"
              stroke={color}
              strokeWidth={r.selected ? 8 : 6}
              strokeOpacity={0.22}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={pts}
              fill="none"
              stroke={color}
              strokeWidth={r.selected ? 3.5 : 2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {r.start && (
              <circle cx={r.start.x} cy={r.start.y} r={5} fill="var(--tac-panel)" stroke={color} strokeWidth={2} />
            )}
            {r.end && <circle cx={r.end.x} cy={r.end.y} r={5} fill={color} stroke="#fff" strokeWidth={1.5} />}
            {r.label && r.midpoint && (
              <text
                x={r.midpoint.x}
                y={r.midpoint.y - 7}
                textAnchor="middle"
                fontSize={10}
                fontFamily="sans-serif"
                fontWeight="bold"
                fill={color}
                stroke="var(--tac-bg)"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {r.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Conflict pulses rendered LAST so they overlay every breadcrumb,
          facility label, and truck marker. Without this they vanish under
          the route spaghetti and a dispatcher can scan past an active
          dock collision without realising it. Bigger radius + glow filter
          push the alert past the ambient parchment noise. */}
      {(() => {
        const byFac: Record<string, number> = {};
        for (const c of conflictsAtTime) {
          byFac[c.facilityCode] = (byFac[c.facilityCode] ?? 0) + 1;
        }
        return (
          <g filter="url(#dispatch-conflict-glow)">
            {Object.entries(byFac).map(([code, count]) => {
              const fac = facilities.find((f) => f.code === code);
              if (!fac) return null;
              const [x, y] = proj(fac.lat, fac.lng);
              return (
                <g key={`conflict-${code}`}>
                  <circle cx={x} cy={y} r={30} fill="none" stroke="#c0392b" strokeWidth={3} strokeDasharray="5,3" opacity={0.9}>
                    <animate attributeName="r" values="26;34;26" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.9;0.55;0.9" dur="2s" repeatCount="indefinite" />
                  </circle>
                  <circle cx={x} cy={y} r={12} fill="#c0392b" opacity={1} stroke="#fff" strokeWidth={2} />
                  <text y={y + 3} x={x} textAnchor="middle" fontSize={10} fill="#fff" fontWeight="bold" fontFamily="sans-serif">
                    {count}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })()}
    </svg>
  );
}
