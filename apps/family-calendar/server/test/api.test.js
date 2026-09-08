import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { openDatabase } from '../src/db.js';
import { startServer } from '../src/index.js';

/** @type {Awaited<ReturnType<typeof startServer>>} */
let app;
/** @type {Array<{ url: string, headers: Record<string, string>, body: string }>} */
let pushes;

/**
 * Stands in for ntfy so the tests never touch the network and can assert on
 * exactly what would have been sent.
 *
 * @type {typeof fetch}
 */
const fakeFetch = async (input, init) => {
  pushes.push({
    url: String(input),
    headers: /** @type {Record<string, string>} */ (init?.headers ?? {}),
    body: String(init?.body ?? ''),
  });
  return new Response('ok', { status: 200 });
};

before(async () => {
  pushes = [];
  app = await startServer({
    db: openDatabase(':memory:'),
    fetchImpl: fakeFetch,
    log: () => {},
    config: {
      port: 0,
      host: '127.0.0.1',
      apiToken: '',
      timezone: 'America/Chicago',
      displayDays: 3,
      // Long enough that the background loop never races an assertion; the
      // reminder path has its own tests that drive the tick directly.
      reminderTickMs: 60 * 60 * 1000,
      notifyOnChange: true,
      ntfyEnabled: true,
    },
  });
});

after(async () => {
  await app.close();
});

beforeEach(() => {
  pushes = [];
  app.db.exec('DELETE FROM events; DELETE FROM event_overrides; DELETE FROM reminder_log');
});

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<{ status: number, body: any, headers: Headers }>}
 */
async function call(path, init) {
  const res = await fetch(`http://127.0.0.1:${app.port}${path}`, init);
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    body: text === '' ? null : JSON.parse(text),
  };
}

/**
 * @param {Record<string, unknown>} event
 * @param {Record<string, string>} [headers]
 */
function post(event, headers = {}) {
  return call('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(event),
  });
}

describe('GET /healthz', () => {
  it('reports what the calendar actually holds, not just that it is up', async () => {
    await post({ title: 'Soccer', start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' });
    const { status, body } = await call('/healthz');

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.members, 3);
    assert.equal(body.events, 1);
    assert.equal(body.recurringEvents, 1);
    assert.equal(body.timezone, 'America/Chicago');
    assert.equal(typeof body.rev, 'number');
    assert.equal(body.notifications.enabled, true);
    assert.equal(body.mirror.enabled, false);
  });
});

describe('members', () => {
  it('lists the three of them with their topics', async () => {
    const { body } = await call('/api/members');
    assert.deepEqual(body.members.map((/** @type {any} */ m) => m.displayName), ['Dad', 'Mom', 'Redmond']);
    assert.ok(body.members.every((/** @type {any} */ m) => m.ntfyTopic.startsWith('fam-')));
  });

  it('renames one', async () => {
    const { status, body } = await call('/api/members/redmond', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Red' }),
    });
    assert.equal(status, 200);
    assert.equal(body.member.displayName, 'Red');
    await call('/api/members/redmond', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Redmond' }),
    });
  });

  it('404s on someone who is not in the family', async () => {
    const { status, body } = await call('/api/members/nobody', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'X' }),
    });
    assert.equal(status, 404);
    assert.match(body.error, /no such family member/);
  });
});

describe('events', () => {
  it('creates one and reads it back as an occurrence', async () => {
    const created = await post({
      title: 'Dentist', start: '2026-09-08T09:00', end: '2026-09-08T10:00', memberIds: ['redmond'],
    });
    assert.equal(created.status, 200);

    const { body } = await call('/api/events?from=2026-09-08T00:00&to=2026-09-08T23:59');
    assert.equal(body.occurrences.length, 1);
    assert.equal(body.occurrences[0].title, 'Dentist');
    assert.equal(body.occurrences[0].seriesId, created.body.event.id);
  });

  it('expands a repeat across the requested window', async () => {
    await post({ title: 'Soccer', start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' });
    const { body } = await call('/api/events?from=2026-09-01T00:00&to=2026-09-30T23:59');
    assert.equal(body.occurrences.length, 4);
    assert.equal(body.occurrences[0].repeatText, 'Weekly on Tue');
  });

  it('filters by family member', async () => {
    await post({ title: 'Dad trip', start: '2026-09-09T08:00', memberIds: ['dad'] });
    await post({ title: 'Redmond swim', start: '2026-09-09T17:00', memberIds: ['redmond'] });

    const { body } = await call('/api/events?from=2026-09-09T00:00&to=2026-09-09T23:59&members=redmond');
    assert.deepEqual(body.occurrences.map((/** @type {any} */ o) => o.title), ['Redmond swim']);
  });

  it('moves a single occurrence with scope=this', async () => {
    const created = await post({ title: 'Soccer', start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' });
    const id = created.body.event.id;

    const patched = await call(`/api/events/${id}?scope=this&recurrenceId=2026-09-15T16:00`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: '2026-09-15T18:00', end: '2026-09-15T19:30' }),
    });
    assert.equal(patched.status, 200);

    const { body } = await call('/api/events?from=2026-09-01T00:00&to=2026-09-30T23:59');
    assert.deepEqual(body.occurrences.map((/** @type {any} */ o) => o.start), [
      '2026-09-08T16:00', '2026-09-15T18:00', '2026-09-22T16:00', '2026-09-29T16:00',
    ]);
  });

  it('cancels a single occurrence with scope=this', async () => {
    const created = await post({ title: 'Soccer', start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' });
    const del = await call(
      `/api/events/${created.body.event.id}?scope=this&recurrenceId=2026-09-15T16:00`,
      { method: 'DELETE' },
    );
    assert.equal(del.status, 200);

    const { body } = await call('/api/events?from=2026-09-01T00:00&to=2026-09-30T23:59');
    assert.equal(body.occurrences.length, 3);
    assert.ok(!body.occurrences.some((/** @type {any} */ o) => o.start === '2026-09-15T16:00'));
  });

  it('rejects a bad repeat rule with a message a person can act on', async () => {
    const { status, body } = await post({ title: 'X', start: '2026-09-08T09:00', rrule: 'FREQ=FORTNIGHTLY' });
    assert.equal(status, 400);
    assert.match(body.error, /unsupported repeat rule/);
  });

  it('rejects a body that is not JSON', async () => {
    const { status, body } = await call('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{nope',
    });
    assert.equal(status, 400);
    assert.match(body.error, /not valid JSON/);
  });

  it('404s an unknown route', async () => {
    const { status } = await call('/api/nope');
    assert.equal(status, 404);
  });
});

describe('delta sync', () => {
  it('hands a phone only what it missed', async () => {
    await post({ title: 'First', start: '2026-09-08T09:00' });
    const mark = (await call('/api/changes?since_rev=0')).body.rev;

    await post({ title: 'Second', start: '2026-09-09T09:00' });
    const { body } = await call(`/api/changes?since_rev=${mark}`);

    assert.deepEqual(body.events.map((/** @type {any} */ e) => e.title), ['Second']);
    assert.ok(body.rev > mark);
  });

  it('rejects a nonsense cursor', async () => {
    const { status } = await call('/api/changes?since_rev=yesterday');
    assert.equal(status, 400);
  });
});

describe('GET /api/display', () => {
  it('groups by day for the wall screen', async () => {
    await post({ title: 'Soccer', start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU', memberIds: ['redmond'] });
    const { status, body } = await call('/api/display?days=3');

    assert.equal(status, 200);
    assert.equal(body.days.length, 3);
    assert.equal(body.tz, 'America/Chicago');
    assert.equal(body.days[0].today, true);
    assert.ok(Array.isArray(body.members));
    assert.match(body.days[0].label, /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}$/);
  });

  it('answers a repeat poll with 304 and no body', async () => {
    await post({ title: 'Soccer', start: '2026-09-08T16:00' });
    const first = await fetch(`http://127.0.0.1:${app.port}/api/display?days=3`);
    const etag = first.headers.get('etag');
    assert.ok(etag, 'the display feed must be ETagged or the screen re-downloads it all day');
    await first.text();

    const second = await fetch(`http://127.0.0.1:${app.port}/api/display?days=3`, {
      headers: { 'If-None-Match': etag },
    });
    assert.equal(second.status, 304);
    assert.equal(await second.text(), '');
  });

  it('changes its ETag when the calendar changes', async () => {
    const before = (await fetch(`http://127.0.0.1:${app.port}/api/display?days=3`));
    await before.text();
    const etagBefore = before.headers.get('etag');

    await post({ title: 'Something new', start: '2026-09-08T11:00' });

    const after = await fetch(`http://127.0.0.1:${app.port}/api/display?days=3`);
    await after.text();
    assert.notEqual(after.headers.get('etag'), etagBefore);
  });
});

describe('push notifications', () => {
  it('sends a test push to one person', async () => {
    const { status, body } = await call('/api/notify/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: 'mom' }),
    });
    assert.equal(status, 200);
    assert.equal(body.sent, true);
    assert.equal(pushes.length, 1);

    const mom = (await call('/api/members')).body.members.find((/** @type {any} */ m) => m.id === 'mom');
    assert.ok(pushes[0].url.endsWith(`/${mom.ntfyTopic}`), 'must go to that person, not a shared topic');
  });

  it('tells the other people when an event is added, but not the person adding it', async () => {
    await post(
      { title: 'Parent evening', start: '2026-09-10T18:00', memberIds: ['dad', 'mom'] },
      { 'X-Family-Member': 'dad' },
    );
    // The push is fire-and-forget; give the microtask queue a turn.
    await new Promise((r) => setTimeout(r, 50));

    const members = (await call('/api/members')).body.members;
    const dadTopic = members.find((/** @type {any} */ m) => m.id === 'dad').ntfyTopic;
    const momTopic = members.find((/** @type {any} */ m) => m.id === 'mom').ntfyTopic;

    const targets = pushes.map((p) => p.url);
    assert.ok(targets.some((u) => u.endsWith(`/${momTopic}`)), 'Mom needs to hear about it');
    assert.ok(!targets.some((u) => u.endsWith(`/${dadTopic}`)), 'Dad was the one who typed it in');
  });
});

describe('CORS', () => {
  it('allows every header the web app actually sends', async () => {
    // A preflight that omits one of these fails in the browser and the app
    // silently shows an empty calendar, which is how this was first found.
    const res = await fetch(`http://127.0.0.1:${app.port}/api/events`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:4180',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type, authorization, x-family-member',
      },
    });

    assert.equal(res.status, 204);
    const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    for (const header of ['content-type', 'authorization', 'if-none-match', 'x-family-member']) {
      assert.ok(allowed.includes(header), `preflight must allow ${header}, got: ${allowed}`);
    }
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  it('exposes the ETag header so the display client can read it', async () => {
    const res = await fetch(`http://127.0.0.1:${app.port}/api/display`);
    await res.text();
    assert.match((res.headers.get('access-control-expose-headers') ?? '').toLowerCase(), /etag/);
  });
});

describe('api token', () => {
  it('locks everything behind the token when one is set', async () => {
    const guarded = await startServer({
      db: openDatabase(':memory:'),
      fetchImpl: fakeFetch,
      log: () => {},
      config: { port: 0, host: '127.0.0.1', apiToken: 'hunter2', reminderTickMs: 60 * 60 * 1000 },
    });

    try {
      const anonymous = await fetch(`http://127.0.0.1:${guarded.port}/api/members`);
      assert.equal(anonymous.status, 401);

      const withHeader = await fetch(`http://127.0.0.1:${guarded.port}/api/members`, {
        headers: { Authorization: 'Bearer hunter2' },
      });
      assert.equal(withHeader.status, 200);

      // The wall display fetches one URL and has no header builder.
      const withQuery = await fetch(`http://127.0.0.1:${guarded.port}/api/display?token=hunter2`);
      assert.equal(withQuery.status, 200);
    } finally {
      await guarded.close();
    }
  });
});
