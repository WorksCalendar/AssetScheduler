/**
 * OpsConsole — the new ops-console layout wrapping WorksCalendar.
 *
 * The bottom tab bar drives the calendar's active view through its imperative
 * ref (Map → dispatch, Schedule, Assets, Allocate → planner). The "Locations"
 * tab has no calendar view, so it renders an overlay panel on top of the
 * (still-mounted) calendar. The shell's light/dark toggle also flips the
 * calendar's inner theme via the ops-light / ops-dark theme pair.
 */
import { useMemo, useRef, useState } from 'react';
import { Boxes, CalendarDays, ClipboardList, Map as MapIcon, MapPin } from 'lucide-react';
import { WorksCalendar, OpsShell, LocationsView } from '../src/index';
import type {
  CalendarApi,
  WorksCalendarProps,
  OpsBanner,
  OpsPersona,
  OpsTab,
  OpsThemeMode,
  LocationItem,
  LocationAsset,
} from '../src/index';

const TABS: readonly OpsTab[] = [
  { id: 'dispatch', label: 'Map', icon: <MapIcon size={20} /> },
  { id: 'schedule', label: 'Schedule', icon: <CalendarDays size={20} /> },
  { id: 'assets', label: 'Assets', icon: <Boxes size={20} /> },
  { id: 'locations', label: 'Locations', icon: <MapPin size={20} /> },
  { id: 'planner', label: 'Allocate', icon: <ClipboardList size={20} /> },
];

export interface OpsConsoleProps {
  /** Props forwarded to the embedded WorksCalendar (data, assets, etc.). */
  calendar: WorksCalendarProps;
  banner: OpsBanner;
  persona?: OpsPersona;
  locations: readonly LocationItem[];
  locationAssets: readonly LocationAsset[];
  initialMode?: OpsThemeMode;
}

export function OpsConsole({
  calendar,
  banner,
  persona,
  locations,
  locationAssets,
  initialMode = 'dark',
}: OpsConsoleProps) {
  const [mode, setMode] = useState<OpsThemeMode>(initialMode);
  const [activeTab, setActiveTab] = useState<string>('dispatch');
  const apiRef = useRef<CalendarApi>(null);

  const calendarTabIds = useMemo(
    () => new Set(TABS.map((t) => t.id).filter((id) => id !== 'locations')),
    [],
  );

  const handleTabChange = (id: string) => {
    setActiveTab(id);
    if (calendarTabIds.has(id)) {
      apiRef.current?.setView(id as WorksCalendarProps['initialView']);
    }
  };

  return (
    <OpsShell
      banner={banner}
      persona={persona}
      tabs={TABS}
      activeTab={activeTab}
      mode={mode}
      onToggleMode={() => setMode((m) => (m === 'dark' ? 'light' : 'dark'))}
      onTabChange={handleTabChange}
    >
      <div style={{ position: 'relative', height: '100%', width: '100%' }}>
        <WorksCalendar
          {...calendar}
          ref={apiRef}
          initialView="dispatch"
          theme={mode === 'dark' ? 'ops-dark' : 'ops-light'}
          showToolbar={false}
          showLeftRail={false}
          showRightPanel={false}
          showViewSwitcher={false}
        />
        {activeTab === 'locations' && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 5 }}>
            <LocationsView
              locations={locations}
              assets={locationAssets}
              onAssetClick={(assetId) => {
                // Jump to the map and let the host highlight the asset.
                handleTabChange('dispatch');
                apiRef.current?.openEvent(assetId);
              }}
            />
          </div>
        )}
      </div>
    </OpsShell>
  );
}

export default OpsConsole;
