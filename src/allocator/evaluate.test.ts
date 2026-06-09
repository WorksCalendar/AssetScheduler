/**
 * Resource allocator grading — green/amber/red per check, worst-of rollup.
 */
import { describe, it, expect } from 'vitest';
import { evaluateCandidate, evaluateAll, compareByStatus } from './evaluate';
import type { DispatchRequirements, ResourceCandidate } from './types';

// Fixed "now" so currency/inspection thresholds are deterministic.
const NOW = new Date('2026-06-01T00:00:00Z');

const JOB: DispatchRequirements = {
  id: 'job-1',
  label: 'PHX → LAX reefer',
  start: '2026-06-10T08:00:00Z',
  end: '2026-06-10T16:00:00Z', // 8h job
  distanceMiles: 400,
  loadWeight: 27_000,
  hazmatClasses: ['class-3'],
  requireInspectionValid: true,
};

const CREW_JOB: DispatchRequirements = {
  id: 'job-2',
  label: 'Drive',
  start: '2026-06-10T08:00:00Z',
  end: '2026-06-10T16:00:00Z',
  requiredLicenseType: 'CDL-A',
  requiredCertifications: ['hazmat-endorsement'],
};

function asset(over: Partial<ResourceCandidate['attributes']> = {}): ResourceCandidate {
  return {
    id: 'a1',
    label: 'Truck 1',
    kind: 'asset',
    attributes: {
      rangeMiles: 800,
      loadCapacity: 32_000,
      hazmatCerts: ['class-3'],
      nextInspection: '2026-09-01',
      ...over,
    },
  };
}

function crew(over: Partial<ResourceCandidate['attributes']> = {}): ResourceCandidate {
  return {
    id: 'c1',
    label: 'Driver 1',
    kind: 'crew',
    role: 'Driver',
    attributes: {
      licenseType: 'CDL-A',
      dutyHoursRemaining: 11,
      medicalValidThrough: '2027-01-01',
      licenseValidThrough: '2027-01-01',
      certificationsValidThrough: { 'hazmat-endorsement': '2027-01-01' },
      ...over,
    },
  };
}

describe('asset checks', () => {
  it('grades a fully-qualified asset green', () => {
    const r = evaluateCandidate(JOB, asset(), { now: NOW });
    expect(r.status).toBe('green');
    expect(r.blockers).toBe(0);
    expect(r.warnings).toBe(0);
  });

  it('reds out when range < distance', () => {
    const r = evaluateCandidate(JOB, asset({ rangeMiles: 300 }), { now: NOW });
    expect(r.status).toBe('red');
    expect(r.checks.find((c) => c.key === 'range')?.status).toBe('red');
  });

  it('ambers a tight range within the margin', () => {
    const r = evaluateCandidate(JOB, asset({ rangeMiles: 410 }), { now: NOW });
    expect(r.checks.find((c) => c.key === 'range')?.status).toBe('amber');
    expect(r.status).toBe('amber');
  });

  it('reds out on insufficient capacity', () => {
    const r = evaluateCandidate(JOB, asset({ loadCapacity: 26_000 }), { now: NOW });
    expect(r.checks.find((c) => c.key === 'capacity')?.status).toBe('red');
  });

  it('reds out on missing HAZMAT cert', () => {
    const r = evaluateCandidate(JOB, asset({ hazmatCerts: ['class-8'] }), { now: NOW });
    const hz = r.checks.find((c) => c.key === 'hazmat');
    expect(hz?.status).toBe('red');
    expect(hz?.detail).toContain('class-3');
  });

  it('reds out when inspection comes due before job end', () => {
    const r = evaluateCandidate(JOB, asset({ nextInspection: '2026-06-09' }), { now: NOW });
    expect(r.checks.find((c) => c.key === 'inspection')?.status).toBe('red');
  });

  it('ambers an inspection due soon after the job', () => {
    const r = evaluateCandidate(JOB, asset({ nextInspection: '2026-06-15' }), { now: NOW });
    expect(r.checks.find((c) => c.key === 'inspection')?.status).toBe('amber');
  });

  it('does not run crew checks on an asset', () => {
    const r = evaluateCandidate(CREW_JOB, asset(), { now: NOW });
    expect(r.checks.some((c) => c.key === 'license')).toBe(false);
  });
});

describe('crew checks', () => {
  it('grades a current driver green', () => {
    const r = evaluateCandidate(CREW_JOB, crew(), { now: NOW });
    expect(r.status).toBe('green');
  });

  it('reds out an insufficient licence class', () => {
    const r = evaluateCandidate(CREW_JOB, crew({ licenseType: 'CDL-B' }), { now: NOW });
    expect(r.checks.find((c) => c.key === 'license')?.status).toBe('red');
  });

  it('accepts a higher licence class for a lower requirement', () => {
    const job = { ...CREW_JOB, requiredLicenseType: 'CDL-B' };
    const r = evaluateCandidate(job, crew({ licenseType: 'CDL-A' }), { now: NOW });
    expect(r.checks.find((c) => c.key === 'license')?.status).toBe('green');
  });

  it('reds out when duty hours cannot cover the job', () => {
    const r = evaluateCandidate(CREW_JOB, crew({ dutyHoursRemaining: 4 }), { now: NOW });
    expect(r.checks.find((c) => c.key === 'duty')?.status).toBe('red');
  });

  it('ambers tight duty hours', () => {
    const r = evaluateCandidate(CREW_JOB, crew({ dutyHoursRemaining: 8.5 }), { now: NOW });
    expect(r.checks.find((c) => c.key === 'duty')?.status).toBe('amber');
  });

  it('reds out an expired medical', () => {
    const r = evaluateCandidate(CREW_JOB, crew({ medicalValidThrough: '2026-01-01' }), { now: NOW });
    expect(r.checks.find((c) => c.key === 'medical')?.status).toBe('red');
  });

  it('reds out a missing required certification', () => {
    const r = evaluateCandidate(CREW_JOB, crew({ certificationsValidThrough: {} }), { now: NOW });
    expect(r.checks.find((c) => c.key === 'certCurrency')?.status).toBe('red');
  });

  it('ambers a certification expiring soon after the job', () => {
    const r = evaluateCandidate(
      CREW_JOB,
      crew({ certificationsValidThrough: { 'hazmat-endorsement': '2026-06-20' } }),
      { now: NOW },
    );
    expect(r.checks.find((c) => c.key === 'certCurrency')?.status).toBe('amber');
  });
});

describe('rollup + helpers', () => {
  it('status is the worst of the checks', () => {
    const r = evaluateCandidate(JOB, asset({ rangeMiles: 410, loadCapacity: 26_000 }), { now: NOW });
    // range amber + capacity red → red overall
    expect(r.status).toBe('red');
    expect(r.warnings).toBe(1);
    expect(r.blockers).toBe(1);
  });

  it('evaluateAll grades every candidate', () => {
    const evals = evaluateAll(JOB, [asset(), asset({ rangeMiles: 100 })], { now: NOW });
    expect(evals).toHaveLength(2);
    expect(evals[1]!.status).toBe('red');
  });

  it('compareByStatus orders green < amber < red', () => {
    expect([...['red', 'green', 'amber'] as const].sort(compareByStatus)).toEqual([
      'green',
      'amber',
      'red',
    ]);
  });

  it('is green when no requirements apply', () => {
    const empty: DispatchRequirements = { id: 'j', label: 'none', start: JOB.start, end: JOB.end };
    expect(evaluateCandidate(empty, asset(), { now: NOW }).status).toBe('green');
  });
});
