import type { Member } from './types';

interface Props {
  members: Member[];
  visibleMemberIds: string[];
  onToggle: (id: string) => void;
  onShowAll: () => void;
}

/**
 * The row of people across the top. Tapping a name shows only their events;
 * tapping "Everyone" brings the whole household back.
 */
export function MemberBar({ members, visibleMemberIds, onToggle, onShowAll }: Props) {
  const allOn = visibleMemberIds.length === members.length;

  return (
    <div className="member-bar" role="group" aria-label="Show events for">
      <button
        type="button"
        className={`chip ${allOn ? 'chip-on chip-neutral' : ''}`}
        onClick={onShowAll}
        aria-pressed={allOn}
      >
        Everyone
      </button>
      {members.map((m) => {
        const on = visibleMemberIds.includes(m.id);
        return (
          <button
            key={m.id}
            type="button"
            className={`chip ${on ? 'chip-on' : ''}`}
            style={on
              ? { background: m.color, borderColor: m.color }
              : { borderColor: m.color, color: m.color }}
            onClick={() => onToggle(m.id)}
            aria-pressed={on}
          >
            {m.displayName}
          </button>
        );
      })}
    </div>
  );
}
