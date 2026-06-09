/**
 * AllocateView — the resource-allocation surface (the "Allocate" tab).
 *
 * Pick a dispatch; the view grades every candidate resource against its
 * requirements via the pure {@link evaluateCandidate} engine and lays them
 * out green / amber / red with the reasons behind each grade. Presentational:
 * the host supplies the dispatches + candidate roster; this view only selects,
 * evaluates, and renders. Themed with the OpsShell token set.
 */
import { useMemo, useState } from 'react';
import { evaluateCandidate, compareByStatus } from '../allocator/evaluate';
import type {
  CandidateEvaluation,
  CheckStatus,
  DispatchRequirements,
  EvaluateOptions,
  ResourceCandidate,
  ResourceKind,
} from '../allocator/types';
import cls from './AllocateView.module.css';

export interface AllocateViewProps {
  dispatches: readonly DispatchRequirements[];
  candidates: readonly ResourceCandidate[];
  options?: EvaluateOptions;
  /** Resource ids currently assigned to each dispatch, keyed by dispatch id. */
  assignments?: Readonly<Record<string, readonly string[]>>;
  /** Toggle a candidate's assignment to a dispatch (host writes it back to
   *  the calendar as a scheduled event). */
  onToggleAssign?: (dispatchId: string, candidateId: string) => void;
}

const STATUS_TAG: Record<CheckStatus, string> = {
  green: 'READY',
  amber: 'CAUTION',
  red: 'UNAVAILABLE',
};
const CHECK_ICON: Record<CheckStatus, string> = { green: '✓', amber: '!', red: '✕' };
const KIND_LABEL: Record<ResourceKind, string> = { asset: 'Assets', crew: 'Crew' };

function reqChips(d: DispatchRequirements): { label: string; value: string }[] {
  const chips: { label: string; value: string }[] = [];
  if (d.distanceMiles != null) chips.push({ label: 'Distance', value: `${d.distanceMiles} mi` });
  if (d.loadWeight != null) chips.push({ label: 'Load', value: `${d.loadWeight.toLocaleString()}` });
  if (d.hazmatClasses?.length) chips.push({ label: 'HAZMAT', value: d.hazmatClasses.join(', ') });
  if (d.requireInspectionValid) chips.push({ label: 'Inspection', value: 'current' });
  if (d.requiredTypeRating) chips.push({ label: 'Type rating', value: d.requiredTypeRating });
  if (d.requiredLicenseType) chips.push({ label: 'Licence', value: d.requiredLicenseType });
  if (d.requiredCertifications?.length) chips.push({ label: 'Certs', value: d.requiredCertifications.join(', ') });
  return chips;
}

function CandidateCard({
  candidate,
  evaluation,
  assigned,
  canAssign,
  onAssign,
}: {
  candidate: ResourceCandidate;
  evaluation: CandidateEvaluation;
  assigned: boolean;
  canAssign: boolean;
  onAssign: () => void;
}) {
  const [open, setOpen] = useState(false);
  const failing = evaluation.checks.filter((c) => c.status !== 'green');
  const passed = evaluation.checks.length - failing.length;
  const shown = open ? evaluation.checks : failing;

  return (
    <div className={cls['card']} data-status={evaluation.status} data-assigned={assigned || undefined}>
      <div className={cls['cardTop']}>
        <span className={cls['dot']} data-status={evaluation.status} />
        <span className={cls['cardName']}>{candidate.label}</span>
        {assigned && <span className={cls['assignedTag']}>ASSIGNED</span>}
        <span className={cls['statusTag']} data-status={evaluation.status}>
          {STATUS_TAG[evaluation.status]}
        </span>
      </div>
      {candidate.role && <div className={cls['cardRole']}>{candidate.role}</div>}

      {shown.length > 0 && (
        <div className={cls['checks']}>
          {shown.map((c) => (
            <div key={c.key} className={cls['checkRow']} data-status={c.status}>
              <span className={cls['checkIcon']} data-status={c.status}>
                {CHECK_ICON[c.status]}
              </span>
              <span className={cls['checkText']}>{c.detail}</span>
            </div>
          ))}
        </div>
      )}

      <div className={cls['cardFoot']}>
        <div className={cls['passNote']}>
          {evaluation.checks.length === 0
            ? 'No requirements'
            : failing.length === 0
              ? `All ${passed} checks passed`
              : `${failing.length} of ${evaluation.checks.length} flagged`}
        </div>
        <div className={cls['actions']}>
          {evaluation.checks.length > 0 && (
            <button type="button" className={cls['detailsBtn']} onClick={() => setOpen((v) => !v)}>
              {open ? 'Hide' : 'Details'}
            </button>
          )}
          {canAssign && (
            <button
              type="button"
              className={cls['assignBtn']}
              data-assigned={assigned || undefined}
              onClick={onAssign}
            >
              {assigned ? 'Assigned ✓' : 'Assign'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function AllocateView({
  dispatches,
  candidates,
  options,
  assignments,
  onToggleAssign,
}: AllocateViewProps) {
  const [selectedId, setSelectedId] = useState(dispatches[0]?.id ?? '');
  const selected = dispatches.find((d) => d.id === selectedId) ?? dispatches[0];
  const assignedHere = new Set(selected ? assignments?.[selected.id] ?? [] : []);

  const evaluations = useMemo(() => {
    if (!selected) return new Map<string, CandidateEvaluation>();
    const m = new Map<string, CandidateEvaluation>();
    for (const c of candidates) m.set(c.id, evaluateCandidate(selected, c, options));
    return m;
  }, [selected, candidates, options]);

  const byKind = useMemo(() => {
    const groups = new Map<ResourceKind, ResourceCandidate[]>();
    for (const c of candidates) {
      const list = groups.get(c.kind) ?? [];
      list.push(c);
      groups.set(c.kind, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) =>
        compareByStatus(evaluations.get(a.id)?.status ?? 'green', evaluations.get(b.id)?.status ?? 'green'),
      );
    }
    return groups;
  }, [candidates, evaluations]);

  const counts = useMemo(() => {
    let green = 0;
    let amber = 0;
    let red = 0;
    for (const e of evaluations.values()) {
      if (e.status === 'green') green++;
      else if (e.status === 'amber') amber++;
      else red++;
    }
    return { green, amber, red };
  }, [evaluations]);

  if (!selected) {
    return <div className={cls['root']}><div className={cls['empty']}>No dispatches to allocate.</div></div>;
  }

  return (
    <div className={cls['root']}>
      {dispatches.length > 1 && (
        <div className={cls['jobs']} role="tablist" aria-label="Dispatches">
          {dispatches.map((d) => (
            <button
              key={d.id}
              type="button"
              role="tab"
              aria-selected={d.id === selected.id}
              data-active={d.id === selected.id}
              className={cls['jobBtn']}
              onClick={() => setSelectedId(d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      <div className={cls['reqRow']}>
        {reqChips(selected).map((c) => (
          <span key={c.label} className={cls['reqChip']}>
            {c.label} <b>{c.value}</b>
          </span>
        ))}
      </div>

      <div className={cls['summary']}>
        <span className={cls['summaryItem']}>
          <span className={cls['dot']} data-status="green" />
          <span className={cls['summaryNum']}>{counts.green}</span> ready
        </span>
        <span className={cls['summaryItem']}>
          <span className={cls['dot']} data-status="amber" />
          <span className={cls['summaryNum']}>{counts.amber}</span> caution
        </span>
        <span className={cls['summaryItem']}>
          <span className={cls['dot']} data-status="red" />
          <span className={cls['summaryNum']}>{counts.red}</span> unavailable
        </span>
        {assignedHere.size > 0 && (
          <span className={cls['summaryItem']} data-assigned>
            <span className={cls['summaryNum']}>{assignedHere.size}</span> assigned
          </span>
        )}
      </div>

      {(['asset', 'crew'] as const).map((kind) => {
        const list = byKind.get(kind) ?? [];
        if (list.length === 0) return null;
        return (
          <div key={kind} className={cls['section']}>
            <div className={cls['sectionHead']}>{KIND_LABEL[kind]}</div>
            <div className={cls['cards']}>
              {list.map((c) => {
                const e = evaluations.get(c.id);
                return e ? (
                  <CandidateCard
                    key={c.id}
                    candidate={c}
                    evaluation={e}
                    assigned={assignedHere.has(c.id)}
                    canAssign={onToggleAssign != null}
                    onAssign={() => onToggleAssign?.(selected.id, c.id)}
                  />
                ) : null;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default AllocateView;
