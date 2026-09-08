import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { expandRRule, parseRRule, describeRRule } from '../src/recurrence.js';
import { formatWall, parseWall } from '../src/time.js';

/**
 * Expand and return wall-clock strings, which is what the assertions read
 * against — comparing Date objects hides the timezone question these tests
 * exist to answer.
 *
 * @param {string} start
 * @param {string} rrule
 * @param {string} from
 * @param {string} to
 * @param {string[]} [exdates]
 * @returns {string[]}
 */
function expand(start, rrule, from, to, exdates = []) {
  return expandRRule(parseWall(start), rrule, exdates, parseWall(from), parseWall(to))
    .map(formatWall);
}

describe('parseRRule', () => {
  it('reads the parts a family calendar can express', () => {
    const rule = parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6');
    assert.equal(rule.freq, 'WEEKLY');
    assert.equal(rule.interval, 2);
    assert.equal(rule.count, 6);
    assert.deepEqual(rule.byDay, [{ ordinal: null, day: 1 }, { ordinal: null, day: 3 }]);
  });

  it('tolerates the RRULE: prefix and lowercase', () => {
    assert.equal(parseRRule('rrule:freq=daily').freq, 'DAILY');
  });

  it('returns null when there is no usable FREQ', () => {
    assert.equal(parseRRule(''), null);
    assert.equal(parseRRule('INTERVAL=2'), null);
    assert.equal(parseRRule('FREQ=HOURLY'), null);
  });

  it('reads ordinal BYDAY values', () => {
    assert.deepEqual(parseRRule('FREQ=MONTHLY;BYDAY=3SA').byDay, [{ ordinal: 3, day: 6 }]);
    assert.deepEqual(parseRRule('FREQ=MONTHLY;BYDAY=-1FR').byDay, [{ ordinal: -1, day: 5 }]);
  });
});

describe('expandRRule', () => {
  const cases = [
    {
      name: 'weekly on one weekday',
      start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU',
      from: '2026-09-01T00:00', to: '2026-09-30T23:59',
      want: ['2026-09-08T16:00', '2026-09-15T16:00', '2026-09-22T16:00', '2026-09-29T16:00'],
    },
    {
      name: 'weekly on several weekdays',
      start: '2026-09-07T07:30', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      from: '2026-09-07T00:00', to: '2026-09-13T23:59',
      want: ['2026-09-07T07:30', '2026-09-09T07:30', '2026-09-11T07:30'],
    },
    {
      name: 'every other week',
      start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
      from: '2026-09-01T00:00', to: '2026-10-31T23:59',
      want: ['2026-09-08T16:00', '2026-09-22T16:00', '2026-10-06T16:00', '2026-10-20T16:00'],
    },
    {
      name: 'daily with an interval',
      start: '2026-09-01T08:00', rrule: 'FREQ=DAILY;INTERVAL=3',
      from: '2026-09-01T00:00', to: '2026-09-10T23:59',
      want: ['2026-09-01T08:00', '2026-09-04T08:00', '2026-09-07T08:00', '2026-09-10T08:00'],
    },
    {
      name: 'weekdays only',
      start: '2026-09-07T07:00', rrule: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
      from: '2026-09-07T00:00', to: '2026-09-13T23:59',
      want: [
        '2026-09-07T07:00', '2026-09-08T07:00', '2026-09-09T07:00',
        '2026-09-10T07:00', '2026-09-11T07:00',
      ],
    },
    {
      name: 'third Saturday of the month',
      start: '2026-09-19T09:00', rrule: 'FREQ=MONTHLY;BYDAY=3SA',
      from: '2026-09-01T00:00', to: '2026-12-31T23:59',
      want: ['2026-09-19T09:00', '2026-10-17T09:00', '2026-11-21T09:00', '2026-12-19T09:00'],
    },
    {
      name: 'last Friday of the month',
      start: '2026-09-25T18:00', rrule: 'FREQ=MONTHLY;BYDAY=-1FR',
      from: '2026-09-01T00:00', to: '2026-11-30T23:59',
      want: ['2026-09-25T18:00', '2026-10-30T18:00', '2026-11-27T18:00'],
    },
    {
      name: 'monthly on a day short months do not have',
      start: '2026-01-31T10:00', rrule: 'FREQ=MONTHLY;BYMONTHDAY=31',
      from: '2026-01-01T00:00', to: '2026-05-31T23:59',
      want: ['2026-01-31T10:00', '2026-03-31T10:00', '2026-05-31T10:00'],
    },
    {
      name: 'monthly on the last day, however long the month is',
      start: '2026-01-31T10:00', rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
      from: '2026-01-01T00:00', to: '2026-04-30T23:59',
      want: ['2026-01-31T10:00', '2026-02-28T10:00', '2026-03-31T10:00', '2026-04-30T10:00'],
    },
    {
      name: 'a birthday, yearly',
      start: '2026-04-12T00:00', rrule: 'FREQ=YEARLY',
      from: '2026-01-01T00:00', to: '2029-12-31T23:59',
      want: ['2026-04-12T00:00', '2027-04-12T00:00', '2028-04-12T00:00', '2029-04-12T00:00'],
    },
    {
      name: 'UNTIL is inclusive of its own day',
      start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20260922T235959Z',
      from: '2026-09-01T00:00', to: '2026-12-31T23:59',
      want: ['2026-09-08T16:00', '2026-09-15T16:00', '2026-09-22T16:00'],
    },
    {
      name: 'a single non-recurring event inside the window',
      start: '2026-09-08T16:00', rrule: '',
      from: '2026-09-01T00:00', to: '2026-09-30T23:59',
      want: ['2026-09-08T16:00'],
    },
    {
      name: 'a single non-recurring event outside the window',
      start: '2026-08-08T16:00', rrule: '',
      from: '2026-09-01T00:00', to: '2026-09-30T23:59',
      want: [],
    },
    {
      name: 'occurrences before the window are not returned',
      start: '2026-01-06T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU',
      from: '2026-09-08T00:00', to: '2026-09-15T23:59',
      want: ['2026-09-08T16:00', '2026-09-15T16:00'],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      assert.deepEqual(expand(c.start, c.rrule, c.from, c.to), c.want);
    });
  }

  it('counts COUNT from the first occurrence, not from the window', () => {
    // Ten swim lessons starting in January. Looking at September must show
    // none of them — not ten more.
    const rrule = 'FREQ=WEEKLY;BYDAY=TU;COUNT=10';
    const all = expand('2026-01-06T16:00', rrule, '2026-01-01T00:00', '2026-12-31T23:59');
    assert.equal(all.length, 10);
    assert.equal(all.at(-1), '2026-03-10T16:00');

    const later = expand('2026-01-06T16:00', rrule, '2026-09-01T00:00', '2026-09-30T23:59');
    assert.deepEqual(later, []);
  });

  it('skips dates listed in EXDATE, by day or by exact time', () => {
    const rrule = 'FREQ=WEEKLY;BYDAY=TU';
    assert.deepEqual(
      expand('2026-09-08T16:00', rrule, '2026-09-01T00:00', '2026-09-30T23:59', ['2026-09-15']),
      ['2026-09-08T16:00', '2026-09-22T16:00', '2026-09-29T16:00'],
    );
    assert.deepEqual(
      expand('2026-09-08T16:00', rrule, '2026-09-01T00:00', '2026-09-30T23:59', ['2026-09-22T16:00']),
      ['2026-09-08T16:00', '2026-09-15T16:00', '2026-09-29T16:00'],
    );
  });

  it('does not let an EXDATE hand back an extra occurrence', () => {
    // COUNT applies to what the rule generates; the exception list is applied
    // afterwards. Cancelling one of four leaves three, not four.
    const got = expand(
      '2026-09-08T16:00', 'FREQ=WEEKLY;BYDAY=TU;COUNT=4',
      '2026-09-01T00:00', '2026-12-31T23:59', ['2026-09-15'],
    );
    assert.deepEqual(got, ['2026-09-08T16:00', '2026-09-22T16:00', '2026-09-29T16:00']);
  });

  it('is bounded when a rule would otherwise run forever', () => {
    const got = expand('2020-01-01T00:00', 'FREQ=DAILY', '2020-01-01T00:00', '2039-12-31T23:59');
    assert.ok(got.length > 0);
    assert.ok(got.length <= 2000, `expected a capped result, got ${got.length}`);
  });
});

describe('daylight saving', () => {
  it('keeps the wall-clock time across a spring-forward', () => {
    // US DST began 2026-03-08. Practice is at 16:00 before and after.
    const got = expand('2026-03-03T16:00', 'FREQ=WEEKLY;BYDAY=TU', '2026-03-01T00:00', '2026-03-31T23:59');
    assert.deepEqual(got, [
      '2026-03-03T16:00', '2026-03-10T16:00', '2026-03-17T16:00',
      '2026-03-24T16:00', '2026-03-31T16:00',
    ]);
  });

  it('keeps the wall-clock time across a fall-back', () => {
    // US DST ended 2026-11-01.
    const got = expand('2026-10-27T16:00', 'FREQ=WEEKLY;BYDAY=TU', '2026-10-01T00:00', '2026-11-30T23:59');
    assert.deepEqual(got, [
      '2026-10-27T16:00', '2026-11-03T16:00', '2026-11-10T16:00',
      '2026-11-17T16:00', '2026-11-24T16:00',
    ]);
  });

  it('keeps a daily 7am at 7am across the change', () => {
    const got = expand('2026-03-06T07:00', 'FREQ=DAILY', '2026-03-06T00:00', '2026-03-10T23:59');
    assert.deepEqual(got, [
      '2026-03-06T07:00', '2026-03-07T07:00', '2026-03-08T07:00',
      '2026-03-09T07:00', '2026-03-10T07:00',
    ]);
  });
});

describe('describeRRule', () => {
  it('summarises rules in words', () => {
    assert.equal(describeRRule('FREQ=WEEKLY;BYDAY=TU'), 'Weekly on Tue');
    assert.equal(describeRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE'), 'Every 2 weeks on Mon, Wed');
    assert.equal(describeRRule('FREQ=DAILY'), 'Daily');
    assert.equal(describeRRule('FREQ=YEARLY'), 'Yearly');
    assert.equal(describeRRule('FREQ=WEEKLY;BYDAY=TU;COUNT=10'), 'Weekly on Tue, 10 times');
    assert.equal(describeRRule(''), '');
  });
});
