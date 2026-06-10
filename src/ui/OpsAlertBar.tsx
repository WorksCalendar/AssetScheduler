/**
 * OpsAlertBar — a persistent, paginated notification strip.
 *
 * Shows one issue at a time as "Conflict 1 of N" with prev/next paging, so a
 * stack of assignment conflicts/warnings can live in the app chrome and be
 * stepped through. Renders nothing when there are no items. Severity drives
 * the colour (red = conflict, amber = warning); when both are present the bar
 * leads with the conflicts.
 */
import { useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import cls from './OpsAlertBar.module.css';

export interface OpsAlertItem {
  id: string;
  severity: 'red' | 'amber';
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface OpsAlertBarProps {
  items: readonly OpsAlertItem[];
}

export function OpsAlertBar({ items }: OpsAlertBarProps) {
  const [index, setIndex] = useState(0);
  if (items.length === 0) return null;

  // Conflicts (red) lead, then warnings (amber); stable within a group.
  const ordered = [...items].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'red' ? -1 : 1));
  const safe = Math.min(index, ordered.length - 1);
  const cur = ordered[safe]!;
  const noun = cur.severity === 'red' ? 'Conflict' : 'Warning';

  return (
    <div className={cls['bar']} data-severity={cur.severity} role="alert">
      <span className={cls['icon']}>
        <AlertTriangle size={16} />
      </span>
      <span className={cls['count']}>
        {noun} {safe + 1} of {ordered.length}
      </span>
      <span className={cls['body']}>
        <span className={cls['title']}>{cur.title}</span>
        <span className={cls['detail']}>{cur.detail}</span>
      </span>
      {cur.onAction && (
        <button type="button" className={cls['action']} onClick={cur.onAction}>
          {cur.actionLabel ?? 'Review'}
        </button>
      )}
      {ordered.length > 1 && (
        <span className={cls['nav']}>
          <button
            type="button"
            className={cls['navBtn']}
            aria-label="Previous issue"
            disabled={safe === 0}
            onClick={() => setIndex(safe - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className={cls['navBtn']}
            aria-label="Next issue"
            disabled={safe === ordered.length - 1}
            onClick={() => setIndex(safe + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </span>
      )}
    </div>
  );
}

export default OpsAlertBar;
