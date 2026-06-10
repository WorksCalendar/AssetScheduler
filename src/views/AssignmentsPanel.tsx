/**
 * AssignmentsPanel — a compact HUD card listing committed assignments.
 *
 * Used as a floating overlay on the Map so dispatchers can see what's been
 * allocated without leaving the map. Presentational: the host supplies the
 * rows (already graded) and an optional click handler. Themed with the
 * OpsShell token set.
 */
import { ClipboardCheck } from 'lucide-react';
import type { CheckStatus } from '../allocator/types';
import cls from './AssignmentsPanel.module.css';

export interface AssignmentRow {
  id: string;
  /** Primary line — e.g. the resource label. */
  title: string;
  /** Secondary line — e.g. the dispatch label. */
  subtitle: string;
  status: CheckStatus;
}

export interface AssignmentsPanelProps {
  rows: readonly AssignmentRow[];
  onRowClick?: (id: string) => void;
}

export function AssignmentsPanel({ rows, onRowClick }: AssignmentsPanelProps) {
  return (
    <div className={cls['panel']}>
      <div className={cls['head']}>
        <span className={cls['headIcon']}>
          <ClipboardCheck size={15} />
        </span>
        Assignments
        <span className={cls['count']}>{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className={cls['empty']}>Nothing allocated yet.</div>
      ) : (
        <div className={cls['list']}>
          {rows.map((r) => (
            <button key={r.id} type="button" className={cls['row']} onClick={() => onRowClick?.(r.id)}>
              <span className={cls['dot']} data-status={r.status} />
              <span className={cls['rowText']}>
                <span className={cls['rowTitle']}>{r.title}</span>
                <span className={cls['rowSub']}>{r.subtitle}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default AssignmentsPanel;
