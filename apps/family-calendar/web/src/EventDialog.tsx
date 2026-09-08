import { useEffect, useMemo, useState } from 'react';

import { RepeatPicker } from './RepeatPicker';
import type { EditScope, EventDraft, Member, Occurrence, Series } from './types';

/** Reminder offsets offered in the form, in minutes before the start. */
const REMINDER_CHOICES: Array<{ minutes: number; label: string }> = [
  { minutes: 0, label: 'At start' },
  { minutes: 10, label: '10 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 180, label: '3 hours' },
  { minutes: 1440, label: '1 day' },
  { minutes: 2880, label: '2 days' },
];

interface Props {
  /** The occurrence being edited, or null when adding. */
  occurrence: Occurrence | null;
  /** The series behind it, which carries the repeat rule. */
  series: Series | null;
  /** Pre-filled start for a new event, from clicking a day. */
  initialStart: string;
  members: Member[];
  onSave: (draft: EventDraft, scope: EditScope, recurrenceId: string) => Promise<void>;
  onDelete: (seriesId: string, scope: EditScope, recurrenceId: string) => Promise<void>;
  onClose: () => void;
}

export function EventDialog({
  occurrence, series, initialStart, members, onSave, onDelete, onClose,
}: Props) {
  const editing = occurrence !== null;
  const isRecurring = series?.rrule !== undefined && series.rrule !== '';

  const [title, setTitle] = useState(occurrence?.title ?? '');
  const [allDay, setAllDay] = useState(occurrence?.allDay ?? false);
  const [start, setStart] = useState(occurrence?.start ?? initialStart);
  const [end, setEnd] = useState(occurrence?.end ?? addHour(initialStart));
  const [location, setLocation] = useState(occurrence?.location ?? '');
  const [notes, setNotes] = useState(occurrence?.notes ?? '');
  const [memberIds, setMemberIds] = useState<string[]>(occurrence?.memberIds ?? []);
  const [reminders, setReminders] = useState<number[]>(occurrence?.reminders ?? []);
  const [rrule, setRrule] = useState(series?.rrule ?? '');
  const [scope, setScope] = useState<EditScope>(isRecurring ? 'this' : 'all');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Editing the repeat rule itself only makes sense for the whole series; a
  // single occurrence cannot have its own recurrence.
  const repeatEditable = !editing || scope !== 'this';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const endsBeforeStart = useMemo(() => end < start, [start, end]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim() === '') {
      setProblem('Give it a name.');
      return;
    }
    if (endsBeforeStart) {
      setProblem('It cannot end before it starts.');
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      const draft: EventDraft = {
        ...(occurrence ? { id: occurrence.seriesId } : {}),
        title: title.trim(),
        start: allDay ? `${start.slice(0, 10)}T00:00` : start,
        end: allDay ? `${end.slice(0, 10)}T23:59` : end,
        allDay,
        location: location.trim(),
        notes: notes.trim(),
        memberIds,
        reminders,
        rrule: repeatEditable ? rrule : (series?.rrule ?? ''),
      };
      await onSave(draft, editing ? scope : 'all', occurrence?.recurrenceId ?? '');
      onClose();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!occurrence) return;
    setBusy(true);
    setProblem(null);
    try {
      await onDelete(occurrence.seriesId, scope, occurrence.recurrenceId);
      onClose();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-label={editing ? 'Edit event' : 'New event'}>
        <header className="dialog-head">
          <h2>{editing ? 'Edit event' : 'New event'}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="dialog-body">
          <div className="field">
            <label className="field-label" htmlFor="ev-title">What</label>
            <input
              id="ev-title"
              className="input"
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Soccer practice"
            />
          </div>

          <div className="field">
            <span className="field-label">Who</span>
            <div className="chip-row">
              {members.map((m) => {
                const on = memberIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`chip ${on ? 'chip-on' : ''}`}
                    style={on ? { background: m.color, borderColor: m.color } : { borderColor: m.color, color: m.color }}
                    onClick={() =>
                      setMemberIds((cur) => (cur.includes(m.id) ? cur.filter((x) => x !== m.id) : [...cur, m.id]))
                    }
                    aria-pressed={on}
                  >
                    {m.displayName}
                  </button>
                );
              })}
            </div>
            {memberIds.length === 0 && (
              <p className="field-hint">Nobody picked — this counts as an event for the whole family.</p>
            )}
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
            />
            All day
          </label>

          <div className="field-pair">
            <div className="field">
              <label className="field-label" htmlFor="ev-start">Starts</label>
              <input
                id="ev-start"
                className="input"
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? start.slice(0, 10) : start}
                onChange={(e) => {
                  const next = allDay ? `${e.target.value}T00:00` : e.target.value;
                  setStart(next);
                  if (end < next) setEnd(allDay ? `${e.target.value}T23:59` : addHour(next));
                }}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="ev-end">Ends</label>
              <input
                id="ev-end"
                className="input"
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? end.slice(0, 10) : end}
                onChange={(e) => setEnd(allDay ? `${e.target.value}T23:59` : e.target.value)}
              />
            </div>
          </div>
          {endsBeforeStart && <p className="field-error">It cannot end before it starts.</p>}

          <RepeatPicker
            start={start}
            value={repeatEditable ? rrule : (series?.rrule ?? '')}
            onChange={setRrule}
            disabled={!repeatEditable}
          />
          {!repeatEditable && (
            <p className="field-hint">
              Switch to “this and future” or “all” below to change how often it repeats.
            </p>
          )}

          <div className="field">
            <span className="field-label">Remind</span>
            <div className="chip-row">
              {REMINDER_CHOICES.map((r) => {
                const on = reminders.includes(r.minutes);
                return (
                  <button
                    key={r.minutes}
                    type="button"
                    className={`chip ${on ? 'chip-on chip-neutral' : ''}`}
                    onClick={() =>
                      setReminders((cur) =>
                        cur.includes(r.minutes) ? cur.filter((x) => x !== r.minutes) : [...cur, r.minutes],
                      )
                    }
                    aria-pressed={on}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            <p className="field-hint">
              {reminders.length === 0
                ? 'No push notifications for this one.'
                : `Pushed to ${memberIds.length === 0 ? 'everyone' : memberIds.length === 1 ? 'one phone' : `${memberIds.length} phones`}.`}
            </p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="ev-location">Where</label>
            <input
              id="ev-location"
              className="input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Field 3"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="ev-notes">Notes</label>
            <textarea
              id="ev-notes"
              className="input"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {editing && isRecurring && (
            <fieldset className="field scope">
              <legend className="field-label">This change applies to</legend>
              {([
                ['this', 'Only this one'],
                ['following', 'This one and everything after it'],
                ['all', 'Every one in the series'],
              ] as Array<[EditScope, string]>).map(([value, label]) => (
                <label key={value} className="radio">
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === value}
                    onChange={() => setScope(value)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}

          {problem && <p className="field-error" role="alert">{problem}</p>}
        </div>

        <footer className="dialog-foot">
          {editing && (
            <button type="button" className="button button-danger" onClick={remove} disabled={busy}>
              Delete
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </form>
    </div>
  );
}

/** Wall-clock string an hour later; used for a sensible default end time. */
function addHour(wall: string): string {
  const [date, time] = wall.split('T');
  const [h, m] = (time ?? '09:00').split(':').map(Number);
  const next = new Date(2000, 0, 1, h + 1, m);
  // Rolling past midnight would move the day, which is more surprise than a
  // default is worth — clamp instead.
  if (next.getDate() !== 1) return `${date}T23:59`;
  return `${date}T${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
}
