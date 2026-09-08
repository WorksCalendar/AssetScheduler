import { useMemo } from 'react';

import { describeRRule, parseRRule } from '@shared/recurrence.js';
import { parseWall } from '@shared/time.js';

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINALS = ['first', 'second', 'third', 'fourth', 'last'];

interface Preset {
  /** The rule this option produces, minus any COUNT/UNTIL. */
  rrule: string;
  label: string;
}

/**
 * The repeat options offered for an event starting on `start`.
 *
 * They are built from the date rather than being a fixed list, because "every
 * Tuesday" is only a sensible offer for an event that starts on a Tuesday.
 */
function presetsFor(start: string): Preset[] {
  let date: Date;
  try {
    date = parseWall(start);
  } catch {
    return [{ rrule: '', label: 'Does not repeat' }];
  }

  const dow = date.getDay();
  const dayCode = WEEKDAY_CODES[dow];
  const dayName = WEEKDAY_NAMES[dow];
  const dayOfMonth = date.getDate();
  const weekOfMonth = Math.ceil(dayOfMonth / 7);
  const isLastOfKind = date.getMonth() !== new Date(date.getFullYear(), date.getMonth(), dayOfMonth + 7).getMonth();
  const ordinal = isLastOfKind ? -1 : weekOfMonth;
  const ordinalName = isLastOfKind ? 'last' : ORDINALS[weekOfMonth - 1];

  return [
    { rrule: '', label: 'Does not repeat' },
    { rrule: 'FREQ=DAILY', label: 'Every day' },
    { rrule: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', label: 'Every weekday (Mon–Fri)' },
    { rrule: `FREQ=WEEKLY;BYDAY=${dayCode}`, label: `Every ${dayName}` },
    { rrule: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${dayCode}`, label: `Every other ${dayName}` },
    { rrule: `FREQ=MONTHLY;BYMONTHDAY=${dayOfMonth}`, label: `Monthly on the ${dayOfMonth}${ordinalSuffix(dayOfMonth)}` },
    { rrule: `FREQ=MONTHLY;BYDAY=${ordinal}${dayCode}`, label: `Monthly on the ${ordinalName} ${dayName}` },
    { rrule: 'FREQ=YEARLY', label: 'Every year' },
  ];
}

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  if (n % 10 === 1) return 'st';
  if (n % 10 === 2) return 'nd';
  if (n % 10 === 3) return 'rd';
  return 'th';
}

/** Strip COUNT and UNTIL, which the "ends" control owns separately. */
function baseOf(rrule: string): string {
  return rrule
    .split(';')
    .filter((part) => {
      const key = part.split('=')[0]?.toUpperCase();
      return key !== 'COUNT' && key !== 'UNTIL' && part.trim() !== '';
    })
    .join(';');
}

function withEnding(base: string, mode: EndMode, count: number, until: string): string {
  if (base === '') return '';
  if (mode === 'count') return `${base};COUNT=${Math.max(1, count)}`;
  if (mode === 'until' && until !== '') return `${base};UNTIL=${until.replace(/-/g, '')}T235959`;
  return base;
}

type EndMode = 'never' | 'count' | 'until';

function endingOf(rrule: string): { mode: EndMode; count: number; until: string } {
  const rule = parseRRule(rrule);
  if (!rule) return { mode: 'never', count: 10, until: '' };
  if (rule.count !== null) return { mode: 'count', count: rule.count, until: '' };
  if (rule.until) {
    const d = rule.until;
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { mode: 'until', count: 10, until: iso };
  }
  return { mode: 'never', count: 10, until: '' };
}

interface Props {
  /** The event's start, which decides which options make sense. */
  start: string;
  value: string;
  onChange: (rrule: string) => void;
  disabled?: boolean;
}

export function RepeatPicker({ start, value, onChange, disabled }: Props) {
  const presets = useMemo(() => presetsFor(start), [start]);
  const base = baseOf(value);
  const ending = endingOf(value);

  const matched = presets.find((p) => p.rrule === base);
  const isCustom = base !== '' && matched === undefined;
  const selected = isCustom ? '__custom' : base;

  const summary = value === '' ? '' : describeRRule(value);
  const customIsValid = !isCustom || parseRRule(value) !== null;

  return (
    <div className="field">
      <label className="field-label" htmlFor="repeat-select">Repeats</label>
      <select
        id="repeat-select"
        className="input"
        value={selected}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          if (next === '__custom') {
            onChange(base === '' ? 'FREQ=WEEKLY;BYDAY=MO' : value);
            return;
          }
          onChange(withEnding(next, ending.mode, ending.count, ending.until));
        }}
      >
        {presets.map((p) => (
          <option key={p.rrule || 'none'} value={p.rrule}>{p.label}</option>
        ))}
        <option value="__custom">Custom rule…</option>
      </select>

      {isCustom && (
        <>
          <input
            className={`input mono ${customIsValid ? '' : 'input-invalid'}`}
            value={value}
            aria-label="Custom repeat rule"
            spellCheck={false}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            placeholder="FREQ=WEEKLY;BYDAY=TU,TH"
          />
          {!customIsValid && (
            <p className="field-error">
              Needs FREQ=DAILY, WEEKLY, MONTHLY or YEARLY. You can add INTERVAL, BYDAY,
              BYMONTHDAY, COUNT or UNTIL.
            </p>
          )}
        </>
      )}

      {base !== '' && (
        <div className="repeat-ends">
          <span className="field-label">Ends</span>
          <div className="repeat-ends-row">
            <label className="radio">
              <input
                type="radio"
                name="repeat-ends"
                checked={ending.mode === 'never'}
                disabled={disabled}
                onChange={() => onChange(withEnding(base, 'never', ending.count, ending.until))}
              />
              Never
            </label>

            <label className="radio">
              <input
                type="radio"
                name="repeat-ends"
                checked={ending.mode === 'count'}
                disabled={disabled}
                onChange={() => onChange(withEnding(base, 'count', ending.count, ending.until))}
              />
              After
              <input
                type="number"
                className="input input-tiny"
                min={1}
                max={500}
                value={ending.count}
                disabled={disabled || ending.mode !== 'count'}
                onChange={(e) => onChange(withEnding(base, 'count', Number(e.target.value), ending.until))}
              />
              times
            </label>

            <label className="radio">
              <input
                type="radio"
                name="repeat-ends"
                checked={ending.mode === 'until'}
                disabled={disabled}
                onChange={() => onChange(withEnding(base, 'until', ending.count, ending.until || start.slice(0, 10)))}
              />
              On
              <input
                type="date"
                className="input input-small"
                value={ending.until}
                disabled={disabled || ending.mode !== 'until'}
                onChange={(e) => onChange(withEnding(base, 'until', ending.count, e.target.value))}
              />
            </label>
          </div>
        </div>
      )}

      {summary !== '' && <p className="field-hint">{summary}</p>}
    </div>
  );
}
