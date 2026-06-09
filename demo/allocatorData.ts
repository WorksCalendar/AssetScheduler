/**
 * Demo data for the Allocate tab.
 *
 * Synthesizes resource attributes (range, capacity, inspection, HAZMAT,
 * licence + currency dates) on top of the trucking demo roster, plus a few
 * sample dispatches with different requirement profiles so the allocator
 * surfaces a realistic green/amber/red spread. All dates are relative to the
 * container clock and the spreads are deterministic per index.
 */
import { TRUCKS, DRIVERS } from './truckDemoData';
import type { ResourceCandidate, DispatchRequirements } from '../src/index';

const NOW = new Date();

function dayISO(offsetDays: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
function atHour(offsetDays: number, hour: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

// ── Assets (trucks) ──────────────────────────────────────────────────────────
const ASSET_CANDIDATES: ResourceCandidate[] = TRUCKS.map((t, i) => {
  const hazmat: string[] = [];
  if (i % 3 === 0) hazmat.push('class-3'); // flammable liquids
  if (i % 5 === 0) hazmat.push('class-8'); // corrosives

  return {
    id: t.id,
    label: `${t.id} — ${t.name}`,
    kind: 'asset',
    role: t.type.replace('_', ' '),
    attributes: {
      // 500–1349 mi spread; a few short-range units fail the long hauls.
      rangeMiles: 500 + ((i * 53) % 850),
      loadCapacity: t.capacity,
      hazmatCerts: hazmat,
      // −10 … +109 days: a handful overdue (red), some due soon (amber).
      nextInspection: dayISO(((i * 37) % 120) - 10),
    },
  };
});

// ── Crew (drivers) ───────────────────────────────────────────────────────────
const CREW_CANDIDATES: ResourceCandidate[] = DRIVERS.map((d, i) => ({
  id: `drv-${d.id}`,
  label: d.name,
  kind: 'crew',
  role: `${d.role} · ${d.base}`,
  color: d.color,
  attributes: {
    licenseType: i % 7 === 0 ? 'CDL-B' : 'CDL-A',
    dutyHoursRemaining: Math.max(0, 11 - d.dutyHoursToday),
    medicalValidThrough: dayISO(((i * 29) % 400) - 20),
    licenseValidThrough: dayISO(((i * 41) % 600) - 10),
    certificationsValidThrough: {
      'hazmat-endorsement': dayISO(((i * 23) % 300) - 15),
      tanker: dayISO(((i * 31) % 360) - 5),
    },
  },
}));

export const ALLOCATOR_CANDIDATES: ResourceCandidate[] = [...ASSET_CANDIDATES, ...CREW_CANDIDATES];

// ── Dispatches ───────────────────────────────────────────────────────────────
export const ALLOCATOR_DISPATCHES: DispatchRequirements[] = [
  {
    id: 'd-reefer-lax',
    label: 'PHX → LAX · reefer',
    start: atHour(1, 8),
    end: atHour(1, 16), // 8h
    distanceMiles: 372,
    loadWeight: 27_000,
    hazmatClasses: ['class-3'],
    requireInspectionValid: true,
    requiredLicenseType: 'CDL-A',
    requiredCertifications: ['hazmat-endorsement'],
  },
  {
    id: 'd-flatbed-den',
    label: 'ABQ → DEN · flatbed',
    start: atHour(2, 6),
    end: atHour(2, 16), // 10h
    distanceMiles: 450,
    loadWeight: 24_000,
    requireInspectionValid: true,
    requiredLicenseType: 'CDL-A',
  },
  {
    id: 'd-local-shuttle',
    label: 'Local PHX shuttle',
    start: atHour(1, 9),
    end: atHour(1, 13), // 4h
    distanceMiles: 60,
    loadWeight: 18_000,
    requiredLicenseType: 'CDL-B',
  },
];
