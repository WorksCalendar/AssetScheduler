/**
 * Resource allocator — type surface.
 *
 * The model is capability-oriented, not link-oriented: a resource declares
 * the attributes it carries (range, capacity, certs, licence currency …) and
 * a dispatch declares what it requires. The allocator matches the two and
 * grades each candidate. Adding a new requirement is additive — no row-to-row
 * wiring to keep in sync — which is the whole point of the "framework to
 * reduce flaky dependencies".
 */

export type CheckStatus = 'green' | 'amber' | 'red';

export type ResourceKind = 'asset' | 'crew';

/** Attributes a resource carries. All optional — a check only runs when both
 *  the dispatch requires it and the candidate's kind can satisfy it. */
export interface ResourceAttributes {
  // ── Assets ──
  /** Operating range before refuel/recharge. */
  rangeMiles?: number;
  /** Maximum payload the asset can carry. */
  loadCapacity?: number;
  /** Date the next required inspection comes due. */
  nextInspection?: string | Date;
  /** HAZMAT classes the asset is certified to carry (e.g. 'class-3'). */
  hazmatCerts?: readonly string[];

  // ── Crew / employees ──
  /** Aircraft/equipment types a pilot is type-rated on. */
  typeRatings?: readonly string[];
  /** Licence class held (e.g. 'CDL-A'). */
  licenseType?: string;
  /** Duty hours still available before the HOS cap. */
  dutyHoursRemaining?: number;
  /** Medical certificate validity. */
  medicalValidThrough?: string | Date;
  /** Licence validity. */
  licenseValidThrough?: string | Date;
  /** Per-certification expiry, keyed by cert id. */
  certificationsValidThrough?: Readonly<Record<string, string | Date>>;
}

export interface ResourceCandidate {
  id: string;
  label: string;
  kind: ResourceKind;
  /** e.g. 'Pilot', 'Driver' — informational. */
  role?: string;
  color?: string;
  attributes: ResourceAttributes;
}

/** What a dispatch/job needs. Only the populated fields are evaluated. */
export interface DispatchRequirements {
  id: string;
  label: string;
  start: string | Date;
  end: string | Date;
  /** Trip distance — checked against asset range. */
  distanceMiles?: number;
  /** Payload weight — checked against asset capacity. */
  loadWeight?: number;
  /** HAZMAT classes the load requires the asset to be certified for. */
  hazmatClasses?: readonly string[];
  /** Asset must stay inspection-valid through the job. */
  requireInspectionValid?: boolean;
  /** Pilot type rating the job requires. */
  requiredTypeRating?: string;
  /** Minimum licence class a driver must hold. */
  requiredLicenseType?: string;
  /** Certifications the crew member must hold and keep current. */
  requiredCertifications?: readonly string[];
}

export interface CheckResult {
  /** Stable key — 'range', 'capacity', 'hazmat', 'inspection', 'typeRating',
   *  'license', 'duty', 'medical', 'licenseCurrency', 'certCurrency'. */
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface CandidateEvaluation {
  candidateId: string;
  /** Worst status across all applicable checks; 'green' when none apply. */
  status: CheckStatus;
  checks: CheckResult[];
  /** Count of red checks. */
  blockers: number;
  /** Count of amber checks. */
  warnings: number;
}

export interface EvaluateOptions {
  /** "Now" reference for currency / inspection checks. Defaults to new Date(). */
  now?: Date;
  /** Amber when range < distance × (1 + margin). Default 0.10. */
  rangeMarginPct?: number;
  /** Amber when capacity < load × (1 + margin). Default 0.05. */
  capacityMarginPct?: number;
  /** Amber when remaining duty < jobHours + buffer. Default 1. */
  dutyBufferHours?: number;
  /** Currency expiring within this many days of job end → amber. Default 30. */
  currencyWarnDays?: number;
  /** Inspection due within this many days after job end → amber. Default 14. */
  inspectionWarnDays?: number;
  /** Licence classes, most-capable first. A higher class satisfies a lower
   *  requirement. Default ['CDL-A', 'CDL-B', 'CDL-C']. */
  licenseHierarchy?: readonly string[];
}
