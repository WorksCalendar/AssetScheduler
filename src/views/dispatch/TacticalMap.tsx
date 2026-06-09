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
}

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
}: Props) {
  const bounds = DEFAULT_LAYER_BOUNDS[layer];
  const proj = (lat: number, lng: number): [number, number] =>
    project(bounds, lat, lng, VW, VH);

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
