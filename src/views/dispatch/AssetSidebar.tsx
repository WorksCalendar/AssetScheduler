/**
 * Asset sidebar — list of dispatchable assets with a conflict badge and
 * a "current location" hint, driven by the time slider's selected
 * timestamp. Click an asset to focus it on the map.
 *
 * Ported from `demo/app/src/components/TruckSidebar.tsx`. Renamed for
 * the asset-agnostic positioning.
 */
import { startOfDay, endOfDay } from 'date-fns';
import { positionAt } from './deriveData';
import type {
  DispatchAsset,
  DispatchConflict,
  DispatchFacility,
  DispatchStop,
} from './types';

const HOS_FLAG_LABEL: Record<string, string> = {
  'on-duty-over': 'Over 14h on-duty cap',
  'driving-over': 'Over 11h driving cap',
  'short-rest': 'Under 10h rest from prior shift',
};

function hosFlagsToTooltip(flags: readonly string[]): string {
  return flags.map((f) => HOS_FLAG_LABEL[f] ?? f).join(' · ');
}

interface Props {
  readonly assets: readonly DispatchAsset[];
  readonly facilities: readonly DispatchFacility[];
  readonly stopsByAsset: ReadonlyMap<string, DispatchStop[]>;
  readonly conflicts: readonly DispatchConflict[];
  readonly selectedDate: Date;
  readonly selectedAsset: string | null;
  readonly onSelectAsset: (id: string) => void;
  /** Per-asset HOS / duty-day summary for the selected day. When a row's
   *  entry has `flags.length > 0`, an HOS RISK badge renders alongside the
   *  conflict badge and surfaces the specific cap that's over. */
  readonly hosByAsset?: ReadonlyMap<string, {
    readonly dutyHours: number;
    readonly drivingHours: number;
    readonly flags: readonly string[];
  }>;
}

export function AssetSidebar({
  assets,
  facilities,
  stopsByAsset,
  conflicts,
  selectedDate,
  selectedAsset,
  onSelectAsset,
  hosByAsset,
}: Props) {
  // Bucket conflicts in the viewer's wall-clock day so the sidebar's
  // CONFLICT badges line up with what the dispatcher would call "today",
  // not the UTC day of the cursor.
  const dayStartMs = startOfDay(selectedDate).getTime();
  const dayEndMs = endOfDay(selectedDate).getTime();

  const todayConflicts = conflicts.filter((c) => {
    const t = c.timeA.getTime();
    return t >= dayStartMs && t <= dayEndMs;
  });
  // Pick the earliest conflict per asset so the sidebar can name the
  // specific facility + time instead of stamping a generic "CONFLICT"
  // word on every other row.
  const firstConflictByAsset = new Map<string, DispatchConflict>();
  for (const c of todayConflicts) {
    for (const id of [c.assetA, c.assetB]) {
      const existing = firstConflictByAsset.get(id);
      if (!existing || c.timeA.getTime() < existing.timeA.getTime()) {
        firstConflictByAsset.set(id, c);
      }
    }
  }
  const conflictedAssets = new Set(firstConflictByAsset.keys());
  const fmtConflictTime = (d: Date) =>
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC', hour12: false });

  const facilitiesByCode = new Map(facilities.map((f) => [f.code, f]));

  return (
    <div className="h-full flex flex-col border-r-2 border-[color:var(--tac-line)] bg-[var(--tac-panel)]">
      <div className="px-3 py-2 border-b border-[color:var(--tac-line)]">
        <h2 className="font-serif text-sm font-bold text-[var(--tac-ink)] tracking-wider uppercase">
          Fleet Status
        </h2>
        <div className="flex gap-2 mt-1 text-[10px] text-[var(--tac-ink-soft)]">
          <span>{assets.length} active</span>
          <span className="text-[#c0392b] font-bold">{conflictedAssets.size} conflicted</span>
          {hosByAsset && (() => {
            let hosCount = 0;
            for (const v of hosByAsset.values()) if (v.flags.length > 0) hosCount++;
            return hosCount > 0 ? (
              <span className="text-[#b7791f] font-bold">{hosCount} HOS risk</span>
            ) : null;
          })()}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        <div className="py-1">
          {assets.map((asset) => {
            const pos = positionAt(stopsByAsset.get(asset.id), selectedDate);
            const fac = pos?.facilityCode ? facilitiesByCode.get(pos.facilityCode) : null;
            const hasConflict = conflictedAssets.has(asset.id);
            const firstConflict = firstConflictByAsset.get(asset.id);
            const hos = hosByAsset?.get(asset.id);
            const hosViolation = (hos?.flags.length ?? 0) > 0;
            const isSelected = selectedAsset === asset.id;

            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => onSelectAsset(isSelected ? '' : asset.id)}
                className={[
                  'w-full text-left px-3 py-2 border-b border-[color:var(--tac-line-soft)] transition-all',
                  isSelected
                    ? 'bg-[var(--tac-sel)] text-white shadow-inner'
                    : 'hover:bg-[var(--tac-hover)]',
                ].join(' ')}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0 border border-white/50"
                    style={{ backgroundColor: asset.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className={`text-[11px] font-bold truncate ${isSelected ? 'text-white' : 'text-[var(--tac-ink)]'}`}>
                        {asset.id}
                      </span>
                      {hasConflict && firstConflict && (
                        <span
                          className="text-[9px] bg-[#c0392b] text-white px-1 rounded"
                          title={`Dock conflict with ${firstConflict.assetA === asset.id ? firstConflict.assetB : firstConflict.assetA} at ${firstConflict.facilityCode}`}
                        >
                          @ {firstConflict.facilityCode} {fmtConflictTime(firstConflict.timeA)}
                        </span>
                      )}
                      {hosViolation && (
                        <span
                          className="text-[9px] bg-[#b7791f] text-white px-1 rounded"
                          title={hosFlagsToTooltip(hos?.flags ?? [])}
                        >
                          HOS
                        </span>
                      )}
                    </div>
                    <div className={`text-[10px] truncate ${isSelected ? 'text-white/80' : 'text-[var(--tac-ink-soft)]'}`}>
                      {asset.name}
                    </div>
                    <div className={`text-[9px] mt-0.5 ${isSelected ? 'text-white/60' : 'text-[#7a6e5b]'}`}>
                      {pos?.moving ? 'En route' : fac ? `@ ${fac.code}` : 'Unknown'}
                      {hos && (
                        <span className={`ml-1.5 ${isSelected ? 'text-white/50' : 'text-[#7a6e5b]'}`}>
                          · {hos.drivingHours}h drive / {hos.dutyHours}h duty
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
