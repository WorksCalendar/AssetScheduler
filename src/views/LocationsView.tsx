/**
 * LocationsView — presentational roster of operating locations (bases /
 * facilities) and the assets homed at each. Themed with the OpsShell token
 * set so it drops into the ops-console body cleanly. Headless: the host
 * supplies locations + assets; this view only groups and renders them.
 */
import { useMemo } from 'react';
import { MapPin } from 'lucide-react';
import cls from './LocationsView.module.css';

export interface LocationItem {
  id: string;
  name: string;
  /** Short code (e.g. airport / hub identifier). */
  code?: string;
  region?: string;
}

export interface LocationAsset {
  id: string;
  label: string;
  /** Id of the location this asset is homed at. */
  locationId: string;
  /** Optional accent colour for the row dot. */
  color?: string;
  /** Optional short status / type line. */
  meta?: string;
}

export interface LocationsViewProps {
  locations: readonly LocationItem[];
  assets: readonly LocationAsset[];
  onAssetClick?: (assetId: string) => void;
}

export function LocationsView({ locations, assets, onAssetClick }: LocationsViewProps) {
  const byLocation = useMemo(() => {
    const map = new Map<string, LocationAsset[]>();
    for (const a of assets) {
      const list = map.get(a.locationId);
      if (list) list.push(a);
      else map.set(a.locationId, [a]);
    }
    return map;
  }, [assets]);

  return (
    <div className={cls['root']}>
      <div className={cls['head']}>
        <div className={cls['headIcon']}>
          <MapPin size={18} />
        </div>
        <div>
          <div className={cls['headTitle']}>Locations</div>
          <div className={cls['headSub']}>
            {locations.length} location{locations.length === 1 ? '' : 's'} · {assets.length} asset
            {assets.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      <div className={cls['grid']}>
        {locations.map((loc) => {
          const here = byLocation.get(loc.id) ?? [];
          return (
            <div key={loc.id} className={cls['card']}>
              <div className={cls['cardHead']}>
                <div>
                  <div className={cls['cardName']}>{loc.name}</div>
                  {loc.region && <div className={cls['cardRegion']}>{loc.region}</div>}
                </div>
                {loc.code && <div className={cls['cardCode']}>{loc.code}</div>}
              </div>

              <div className={cls['count']}>
                {here.length} asset{here.length === 1 ? '' : 's'}
              </div>

              {here.length === 0 ? (
                <div className={cls['empty']}>No assets homed here</div>
              ) : (
                <div className={cls['assetList']}>
                  {here.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={cls['assetRow']}
                      onClick={() => onAssetClick?.(a.id)}
                      style={{ cursor: onAssetClick ? 'pointer' : 'default' }}
                    >
                      <span className={cls['dot']} style={a.color ? { background: a.color } : undefined} />
                      <span className={cls['assetLabel']}>{a.label}</span>
                      {a.meta && <span className={cls['assetMeta']}>{a.meta}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default LocationsView;
