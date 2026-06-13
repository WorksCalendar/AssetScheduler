# Asset Scheduler

**An embeddable React component for visually tracking and scheduling assets.** Drop it into your app to get a live map of where your assets are and where they're headed, a resource allocator that grades and assigns crew/equipment to jobs, and schedule / asset / location views — all in one ops console, driven by your own data.

Built for fleets, dispatch, field operations, and anything else where you need to see assets moving in space and time and commit them to work without double-booking.

## What you get

- **Live asset map** — assets plotted on a basemap with **fading comet tails** showing recent movement and direction, **status-coloured route overlays** for committed jobs (green / amber / red), conflict pulses at facilities, and a thin time-scrubber overlay with a mini-Gantt.
- **Bring your own map** — route lines and markers render through a small `MapAdapter` contract, so the same geographic data draws correctly at every zoom on **Leaflet, Google Maps, Bing/Azure Maps**, or the built-in SVG basemap. Geography in, projection delegated to the host map.
- **Resource allocator** — grade every candidate resource **green / amber / red** against a job's requirements (range, capacity, HAZMAT certs, inspection currency, pilot type-rating, licence class, duty-day hours, medical / licence / certification currency), then **assign** — which writes the job back onto the schedule. Double-booking and unmet requirements surface in a persistent **conflict banner**.
- **Ops-console shell** — a configurable top banner, light/dark, and a bottom tab bar across **Map · Schedule · Assets · Locations · Allocate**.
- **Backend-agnostic** — feed data via the `events` prop, a `fetchEvents` callback, or the built-in Supabase connector.
- **Strict TypeScript** — ships generated `.d.ts` so consumer types stay in lockstep with the implementation.

## Installation

```bash
npm install asset-scheduler
```

**Peer dependencies:** React 18 or 19.

```bash
npm install react react-dom
```

It's an ES-module library — works with Vite, webpack, Parcel, Rollup, and any modern bundler.

## Quick start

> **CSS required.** Import the base styles once, anywhere in your app — the component renders unstyled without them.

```jsx
import { AssetScheduler } from 'asset-scheduler';
import 'asset-scheduler/styles';

export function App() {
  const assets = [
    { id: 'T001', label: 'Phoenix Runner 1', group: 'PHX', meta: { type: 'reefer', color: '#ef4444' } },
  ];

  const events = [
    {
      id: 'leg-1',
      title: 'PHX → LAX',
      start: new Date('2026-05-05T06:00:00Z'),
      end:   new Date('2026-05-05T12:00:00Z'),
      resource: 'T001',
      meta: {
        kind: 'leg',
        fromLat: 33.43, fromLng: -112.01,
        toLat: 33.94,  toLng: -118.41,
      },
    },
  ];

  return (
    <div style={{ height: '100vh' }}>
      <AssetScheduler
        banner={{ title: 'Fleet Ops', subtitle: 'Dispatch', logoText: 'FO' }}
        defaultMode="dark"            // "light" | "dark"
        assets={assets}
        events={events}
        // dispatches={...} + resources={...} power the Allocate tab (optional)
      />
    </div>
  );
}
```

`AssetScheduler` is the turnkey console — banner, light/dark, and a bottom tab bar across **Map · Schedule · Assets · Locations · Allocate**, with assignment write-back and the conflict banner wired up. Assignment state and light/dark are controlled-or-uncontrolled: pass `assignments` + `onAssignmentsChange` (and `mode` + `onModeChange`) to own and persist them, or omit them and the console manages its own.

Need just the calendar/dispatch view without the shell? `WorksCalendar` is the lower-level component the console wraps.

## Bring your own map

Route data is geographic (`lng`/`lat`), never pixels — the host map owns the projection, and the overlay re-projects on every pan/zoom so lines stay glued at any zoom level. Wrap your map instance in an adapter:

```ts
import { createLeafletAdapter, projectRoutes } from 'asset-scheduler';

const adapter = createLeafletAdapter(map); // map = L.map(...)

// Project graded routes to screen-space polylines on each view change.
const drawn = projectRoutes(adapter, [
  { id: 'job-1', path: [{ lng: -112.0, lat: 33.4 }, { lng: -118.4, lat: 33.9 }], status: 'amber', label: 'PHX → LAX' },
]);
```

Adapters ship for **Leaflet** (`createLeafletAdapter`), **Google Maps** (`createGoogleAdapter`), **Bing** (`createBingAdapter`), and **Azure Maps** (`createAzureMapsAdapter` — the recommended successor to Bing). Each is typed structurally, so the library never hard-depends on a map SDK; you pass your own map object. `densifyPath` / `interpolateGreatCircle` keep long legs curving correctly (great-circle) instead of cutting the projection seam.

## Allocate resources to a job

The allocator is a pure, headless engine plus a presentational view. Each resource declares the capabilities/attributes it carries; a dispatch declares what it requires; `evaluateCandidate` grades the match.

```ts
import { evaluateCandidate } from 'asset-scheduler';

const result = evaluateCandidate(
  {
    id: 'job-1', label: 'PHX → LAX reefer',
    start: '2026-05-05T08:00:00Z', end: '2026-05-05T16:00:00Z',
    distanceMiles: 372, loadWeight: 27000,
    hazmatClasses: ['class-3'], requireInspectionValid: true,
  },
  {
    id: 'T001', label: 'Phoenix Runner 1', kind: 'asset',
    attributes: { rangeMiles: 800, loadCapacity: 32000, hazmatCerts: ['class-3'], nextInspection: '2026-09-01' },
  },
);

result.status; // 'green' | 'amber' | 'red'
result.checks; // per-requirement reasons, e.g. "Range 800 mi ≥ 372 mi"
```

Drop in the `AllocateView` for the full UI (dispatch selector, requirement chips, ready/caution/unavailable summary, a **Committed** lane, and assign buttons), or read `evaluateAll` headless and build your own. Capabilities are matched by tags, so adding a new requirement is additive — no brittle row-to-row wiring.

## Event shape

```ts
interface WorksCalendarEvent {
  id?:        string;
  title:      string;
  start:      Date | string;       // ISO string or Date
  end?:       Date | string;
  allDay?:    boolean;
  resource?:  string;              // links to an asset / employee id
  category?:  string;
  color?:     string;
  meta?:      Record<string, unknown>; // route/stop geo data, status, host fields
}
```

`resource` links an event to an asset or employee (match the `id` in your `assets` / `employees` props). The dispatch map reads geographic legs from `meta` (`kind: 'leg'` with `fromLat/Lng` + `toLat/Lng`).

## Data sources

Static array, async loader, or Supabase:

```jsx
// Async
<AssetScheduler fetchEvents={async () => (await fetch('/api/events')).json()} />

// Supabase (npm install @supabase/supabase-js)
<AssetScheduler
  supabaseUrl={import.meta.env.VITE_SUPABASE_URL}
  supabaseKey={import.meta.env.VITE_SUPABASE_KEY}
  supabaseTable="events"
/>
```

## Theming

```jsx
import 'asset-scheduler/styles'; // required base styles
```

A single neutral theme in two modes — pass `theme="light"` or `theme="dark"`. The ops-console shell (`OpsShell`) also exposes a light/dark toggle.

## Demo

```bash
npm install
npm run dev   # http://localhost:5173 — the ops-console demo (map, allocator, schedule)
```

## License

MIT. See [LICENSE](./LICENSE).
