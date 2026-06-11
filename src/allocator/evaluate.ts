/**
 * Resource allocator — the grading engine.
 *
 * `evaluateCandidate` is a pure function: given a dispatch's requirements and
 * one candidate, it runs every applicable check and returns a green/amber/red
 * grade with human-readable reasons. No global state, no I/O — so it's trivial
 * to unit-test and reuse headless.
 */
import type {
  CandidateEvaluation,
  CheckResult,
  CheckStatus,
  DispatchRequirements,
  EvaluateOptions,
  ResourceCandidate,
} from './types';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const DEFAULTS = {
  rangeMarginPct: 0.1,
  capacityMarginPct: 0.05,
  dutyBufferHours: 1,
  currencyWarnDays: 30,
  inspectionWarnDays: 14,
  licenseHierarchy: ['CDL-A', 'CDL-B', 'CDL-C'] as readonly string[],
};

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rank(s: CheckStatus): number {
  return s === 'red' ? 2 : s === 'amber' ? 1 : 0;
}

function worst(a: CheckStatus, b: CheckStatus): CheckStatus {
  return rank(b) > rank(a) ? b : a;
}

/** Shared green/amber/red currency check for a "valid through" date. */
function currencyCheck(
  key: string,
  label: string,
  validThrough: string | Date | undefined,
  jobEnd: Date,
  warnMs: number,
): CheckResult {
  if (validThrough == null) {
    return { key, label, status: 'red', detail: `${label} unknown` };
  }
  const vt = toDate(validThrough);
  if (vt.getTime() < jobEnd.getTime()) {
    return { key, label, status: 'red', detail: `${label} expired ${fmtDate(vt)}` };
  }
  if (vt.getTime() < jobEnd.getTime() + warnMs) {
    return { key, label, status: 'amber', detail: `${label} expires ${fmtDate(vt)} (soon)` };
  }
  return { key, label, status: 'green', detail: `${label} current through ${fmtDate(vt)}` };
}

export function evaluateCandidate(
  req: DispatchRequirements,
  candidate: ResourceCandidate,
  options: EvaluateOptions = {},
): CandidateEvaluation {
  const o = { ...DEFAULTS, ...options };
  const attrs = candidate.attributes;
  const jobEnd = toDate(req.end);
  const jobStart = toDate(req.start);
  const warnMs = o.currencyWarnDays * DAY_MS;
  const checks: CheckResult[] = [];

  // ── Asset checks ──────────────────────────────────────────────────────────
  if (candidate.kind === 'asset') {
    if (req.distanceMiles != null) {
      const r = attrs.rangeMiles;
      if (r == null) {
        checks.push({ key: 'range', label: 'Range', status: 'red', detail: 'Range unknown' });
      } else if (r < req.distanceMiles) {
        checks.push({ key: 'range', label: 'Range', status: 'red', detail: `Range ${r} mi < ${req.distanceMiles} mi required` });
      } else if (r < req.distanceMiles * (1 + o.rangeMarginPct)) {
        checks.push({ key: 'range', label: 'Range', status: 'amber', detail: `Range ${r} mi — tight for ${req.distanceMiles} mi` });
      } else {
        checks.push({ key: 'range', label: 'Range', status: 'green', detail: `Range ${r} mi ≥ ${req.distanceMiles} mi` });
      }
    }

    if (req.loadWeight != null) {
      const c = attrs.loadCapacity;
      if (c == null) {
        checks.push({ key: 'capacity', label: 'Capacity', status: 'red', detail: 'Capacity unknown' });
      } else if (c < req.loadWeight) {
        checks.push({ key: 'capacity', label: 'Capacity', status: 'red', detail: `Capacity ${c} < ${req.loadWeight} load` });
      } else if (c < req.loadWeight * (1 + o.capacityMarginPct)) {
        checks.push({ key: 'capacity', label: 'Capacity', status: 'amber', detail: `Capacity ${c} — near ${req.loadWeight} load` });
      } else {
        checks.push({ key: 'capacity', label: 'Capacity', status: 'green', detail: `Capacity ${c} ≥ ${req.loadWeight}` });
      }
    }

    if (req.hazmatClasses && req.hazmatClasses.length > 0) {
      const held = new Set(attrs.hazmatCerts ?? []);
      const missing = req.hazmatClasses.filter((cl) => !held.has(cl));
      if (missing.length > 0) {
        checks.push({ key: 'hazmat', label: 'HAZMAT', status: 'red', detail: `Missing HAZMAT: ${missing.join(', ')}` });
      } else {
        checks.push({ key: 'hazmat', label: 'HAZMAT', status: 'green', detail: `Certified: ${req.hazmatClasses.join(', ')}` });
      }
    }

    if (req.requireInspectionValid) {
      const insp = attrs.nextInspection;
      if (insp == null) {
        checks.push({ key: 'inspection', label: 'Inspection', status: 'red', detail: 'Inspection date unknown' });
      } else {
        const due = toDate(insp);
        if (due.getTime() < jobEnd.getTime()) {
          checks.push({ key: 'inspection', label: 'Inspection', status: 'red', detail: `Inspection due ${fmtDate(due)} — before job end` });
        } else if (due.getTime() < jobEnd.getTime() + o.inspectionWarnDays * DAY_MS) {
          checks.push({ key: 'inspection', label: 'Inspection', status: 'amber', detail: `Inspection due ${fmtDate(due)} (soon)` });
        } else {
          checks.push({ key: 'inspection', label: 'Inspection', status: 'green', detail: `Inspection due ${fmtDate(due)}` });
        }
      }
    }
  }

  // ── Crew checks ───────────────────────────────────────────────────────────
  if (candidate.kind === 'crew') {
    if (req.requiredTypeRating) {
      const rated = (attrs.typeRatings ?? []).includes(req.requiredTypeRating);
      checks.push(
        rated
          ? { key: 'typeRating', label: 'Type rating', status: 'green', detail: `Rated for ${req.requiredTypeRating}` }
          : { key: 'typeRating', label: 'Type rating', status: 'red', detail: `Not type-rated for ${req.requiredTypeRating}` },
      );
    }

    if (req.requiredLicenseType) {
      const held = attrs.licenseType;
      const reqIdx = o.licenseHierarchy.indexOf(req.requiredLicenseType);
      const heldIdx = held ? o.licenseHierarchy.indexOf(held) : -1;
      // Lower index = higher capability. Holder qualifies when at least as
      // capable as required. Unknown classes fall outside the hierarchy → red.
      const ok = heldIdx !== -1 && reqIdx !== -1 && heldIdx <= reqIdx;
      checks.push(
        ok
          ? { key: 'license', label: 'Licence', status: 'green', detail: `${held} satisfies ${req.requiredLicenseType}` }
          : { key: 'license', label: 'Licence', status: 'red', detail: `${held ?? 'No licence'} — requires ${req.requiredLicenseType}` },
      );
    }

    // Duty hours always apply to crew (the job has a duration).
    {
      const jobHours = Math.max(0, (jobEnd.getTime() - jobStart.getTime()) / HOUR_MS);
      const rem = attrs.dutyHoursRemaining;
      const r1 = Math.round(jobHours * 10) / 10;
      if (rem == null) {
        checks.push({ key: 'duty', label: 'Duty hours', status: 'red', detail: 'Duty hours unknown' });
      } else if (rem < jobHours) {
        checks.push({ key: 'duty', label: 'Duty hours', status: 'red', detail: `${rem}h left < ${r1}h job` });
      } else if (rem < jobHours + o.dutyBufferHours) {
        checks.push({ key: 'duty', label: 'Duty hours', status: 'amber', detail: `${rem}h left — tight for ${r1}h job` });
      } else {
        checks.push({ key: 'duty', label: 'Duty hours', status: 'green', detail: `${rem}h left ≥ ${r1}h job` });
      }
    }

    // Medical / licence currency are intrinsic gates: run them whenever the
    // attribute is tracked, regardless of what this particular job lists.
    if (attrs.medicalValidThrough !== undefined) {
      checks.push(currencyCheck('medical', 'Medical', attrs.medicalValidThrough, jobEnd, warnMs));
    }

    if (attrs.licenseValidThrough !== undefined) {
      checks.push(currencyCheck('licenseCurrency', 'Licence currency', attrs.licenseValidThrough, jobEnd, warnMs));
    }

    if (req.requiredCertifications && req.requiredCertifications.length > 0) {
      const map = attrs.certificationsValidThrough ?? {};
      let st: CheckStatus = 'green';
      const notes: string[] = [];
      for (const cert of req.requiredCertifications) {
        const vt = Object.prototype.hasOwnProperty.call(map, cert) ? map[cert] : undefined;
        const r = currencyCheck('cert', cert, vt, jobEnd, warnMs);
        st = worst(st, r.status);
        if (r.status !== 'green') notes.push(r.detail);
      }
      checks.push({
        key: 'certCurrency',
        label: 'Certifications',
        status: st,
        detail: st === 'green' ? `All current: ${req.requiredCertifications.join(', ')}` : notes.join('; '),
      });
    }
  }

  const status = checks.reduce<CheckStatus>((acc, c) => worst(acc, c.status), 'green');
  const blockers = checks.filter((c) => c.status === 'red').length;
  const warnings = checks.filter((c) => c.status === 'amber').length;
  return { candidateId: candidate.id, status, checks, blockers, warnings };
}

/** Evaluate every candidate against a dispatch. */
export function evaluateAll(
  req: DispatchRequirements,
  candidates: readonly ResourceCandidate[],
  options?: EvaluateOptions,
): CandidateEvaluation[] {
  return candidates.map((c) => evaluateCandidate(req, c, options));
}

/** Sort order for triage: ready first, then caution, then unavailable. */
export function compareByStatus(a: CheckStatus, b: CheckStatus): number {
  return rank(a) - rank(b);
}
