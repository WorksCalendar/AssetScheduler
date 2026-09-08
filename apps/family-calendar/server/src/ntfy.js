/**
 * Push notifications via ntfy (https://ntfy.sh or a self-hosted server).
 *
 * Each family member has their own topic; a phone subscribes to that one topic
 * in the ntfy app and gets that person's reminders and nothing else. The topic
 * name is the only secret involved — ntfy has no per-topic auth on the public
 * server — so topics are generated random and are rotatable from the API.
 *
 * Delivery is best effort and is treated that way everywhere it is called: the
 * calendar in SQLite is the record of what is happening, and a push is only a
 * courtesy copy. A failed push must never fail the write that caused it.
 */

/** @typedef {1|2|3|4|5} Priority */

/**
 * @typedef {Object} Push
 * @property {string} topic
 * @property {string} title
 * @property {string} body
 * @property {Priority} [priority]
 * @property {string[]} [tags]     ntfy emoji shortcodes, e.g. ['calendar']
 * @property {string} [click]      URL opened when the notification is tapped
 */

/**
 * @typedef {Object} Publisher
 * @property {(push: Push) => Promise<{ ok: boolean, status: number, error?: string }>} publish
 * @property {boolean} enabled
 */

/**
 * Build a publisher.
 *
 * @param {{ baseUrl: string, token: string, enabled: boolean, fetchImpl?: typeof fetch }} opts
 * @returns {Publisher}
 */
export function createPublisher(opts) {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');

  return {
    enabled: opts.enabled,

    async publish(push) {
      if (!opts.enabled) return { ok: false, status: 0, error: 'notifications disabled' };
      if (!push.topic) return { ok: false, status: 0, error: 'no topic' };
      // ntfy rejects an empty body, so refuse it here rather than spending a
      // round trip to be told.
      if (!push.body || push.body.trim() === '') return { ok: false, status: 0, error: 'empty message' };

      /** @type {Record<string, string>} */
      const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
      if (push.title) headers['Title'] = asciiHeader(push.title);
      if (push.priority) headers['Priority'] = String(push.priority);
      if (push.tags && push.tags.length > 0) headers['Tags'] = push.tags.join(',');
      if (push.click) headers['Click'] = push.click;
      if (opts.token !== '') headers['Authorization'] = `Bearer ${opts.token}`;

      try {
        const res = await doFetch(`${base}/${encodeURIComponent(push.topic)}`, {
          method: 'POST',
          headers,
          body: push.body,
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          return { ok: false, status: res.status, error: `ntfy responded ${res.status}` };
        }
        return { ok: true, status: res.status };
      } catch (err) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/**
 * HTTP headers are latin-1; an emoji or a curly quote in an event title would
 * otherwise throw inside fetch and lose the notification entirely. The body
 * keeps the original text — only the header copy is folded.
 *
 * @param {string} s
 * @returns {string}
 */
function asciiHeader(s) {
  // eslint-disable-next-line no-control-regex
  return s.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').trim() || 'Family calendar';
}
