/**
 * OpsConsole — the new ops-console layout wrapping WorksCalendar.
 *
 * The bottom tab bar drives the calendar's active view through its imperative
 * ref (Map → dispatch, Schedule, Assets). The "Locations" and "Allocate" tabs
 * have no calendar view, so they render an overlay panel on top of the
 * (still-mounted) calendar. The shell's light/dark toggle also flips the
 * calendar's inner theme via the ops-light / ops-dark theme pair.
 */
import { useMemo, useRef, useState } from 'react';
import { Boxes, CalendarDays, ClipboardList, Map as MapIcon, MapPin } from 'lucide-react';
import { WorksCalendar, OpsShell, OpsViewHeader, LocationsView, AllocateView } from '../src/index';
import type {
  CalendarApi,
  WorksCalendarProps,
  OpsBanner,
  OpsPersona,
  OpsTab,
  OpsThemeMode,
  LocationItem,
  LocationAsset,
  ResourceCandidate,
  DispatchRequirements,
} from '../src/index';

const TABS: readonly OpsTab[] = [
  { id: 'dispatch', label: 'Map', icon: <MapIcon size={20} /> },
  { id: 'schedule', label: 'Schedule', icon: <CalendarDays size={20} /> },
  { id: 'assets', label: 'Assets', icon: <Boxes size={20} /> },
  { id: 'locations', label: 'Locations', icon: <MapPin size={20} /> },
  { id: 'allocate', label: 'Allocate', icon: <ClipboardList size={20} /> },
];

// Tabs that render an overlay panel instead of a calendar view.
const OVERLAY_TABS = new Set(['locations', 'allocate']);

export interface OpsConsoleProps {
  /** Props forwarded to the embedded WorksCalendar (data, assets, etc.). */
  calendar: WorksCalendarProps;
  banner: OpsBanner;
  persona?: OpsPersona;
  locations: readonly LocationItem[];
  locationAssets: readonly LocationAsset[];
  dispatches: readonly DispatchRequirements[];
  resources: readonly ResourceCandidate[];
  initialMode?: OpsThemeMode;
}

export function OpsConsole({
  calendar,
  banner,
  persona,
  locations,
  locationAssets,
  dispatches,
  resources,
  initialMode = 'dark',
}: OpsConsoleProps) {
  const [mode, setMode] = useState<OpsThemeMode>(initialMode);
  const [activeTab, setActiveTab] = useState<string>('dispatch');
  const apiRef = useRef<CalendarApi>(null);

  const handleTabChange = (id: string) => {
    setActiveTab(id);
    if (!OVERLAY_TABS.has(id)) {
      apiRef.current?.setView(id as WorksCalendarProps['initialView']);
    }
  };

  const subHeader = useMemo(() => {
    if (activeTab === 'locations') {
      return (
        <OpsViewHeader
          icon={<MapPin size={18} />}
          title="Locations"
          subtitle={`${locations.length} location${locations.length === 1 ? '' : 's'} · ${
            locationAssets.length
          } asset${locationAssets.length === 1 ? '' : 's'}`}
        />
      );
    }
    if (activeTab === 'allocate') {
      return (
        <OpsViewHeader
          icon={<ClipboardList size={18} />}
          title="Resource Allocation"
          subtitle={`${resources.length} resources · ${dispatches.length} dispatch${
            dispatches.length === 1 ? '' : 'es'
          }`}
        />
      );
    }
    return undefined;
  }, [activeTab, locations.length, locationAssets.length, resources.length, dispatches.length]);

  return (
    <OpsShell
      banner={banner}
      persona={persona}
      tabs={TABS}
      activeTab={activeTab}
      mode={mode}
      onToggleMode={() => setMode((m) => (m === 'dark' ? 'light' : 'dark'))}
      onTabChange={handleTabChange}
      {...(subHeader ? { subHeader } : {})}
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
              showHeader={false}
              onAssetClick={(assetId) => {
                // Jump to the map and let the host highlight the asset.
                handleTabChange('dispatch');
                apiRef.current?.openEvent(assetId);
              }}
            />
          </div>
        )}
        {activeTab === 'allocate' && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 5 }}>
            <AllocateView dispatches={dispatches} candidates={resources} />
          </div>
        )}
      </div>
    </OpsShell>
  );
}

export default OpsConsole;
