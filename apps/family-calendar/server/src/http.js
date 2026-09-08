/**
 * A very small HTTP layer: enough routing to serve this calendar and nothing
 * more. A framework would be four times the size of the app it is serving.
 */

/**
 * @typedef {Object} Ctx
 * @property {import('node:http').IncomingMessage} req
 * @property {import('node:http').ServerResponse} res
 * @property {URL} url
 * @property {Record<string, string>} params
 * @property {() => Promise<unknown>} body
 */

/**
 * @typedef {Object} Route
 * @property {string} method
 * @property {RegExp} pattern
 * @property {string[]} keys
 * @property {(ctx: Ctx) => unknown | Promise<unknown>} handler
 */

/** Largest request body accepted, so a runaway client cannot exhaust memory. */
const MAX_BODY_BYTES = 512 * 1024;

/** Thrown by handlers to answer with a specific status. */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Build a router.
 *
 * @returns {{
 *   get: (path: string, h: Route['handler']) => void,
 *   post: (path: string, h: Route['handler']) => void,
 *   patch: (path: string, h: Route['handler']) => void,
 *   del: (path: string, h: Route['handler']) => void,
 *   routes: Route[],
 * }}
 */
export function createRouter() {
  /** @type {Route[]} */
  const routes = [];

  /**
   * `/events/:id` becomes a pattern with a named capture.
   *
   * @param {string} method
   * @param {string} path
   * @param {Route['handler']} handler
   */
  function add(method, path, handler) {
    /** @type {string[]} */
    const keys = [];
    const pattern = new RegExp(
      `^${path.replace(/:[A-Za-z_]\w*/g, (m) => {
        keys.push(m.slice(1));
        return '([^/]+)';
      })}/?$`,
    );
    routes.push({ method, pattern, keys, handler });
  }

  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    patch: (p, h) => add('PATCH', p, h),
    del: (p, h) => add('DELETE', p, h),
    routes,
  };
}

/**
 * Read and parse a JSON request body.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<unknown>}
 */
async function readJson(req) {
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'request body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'request body is not valid JSON');
  }
}

/**
 * Turn a router into a Node request listener.
 *
 * @param {ReturnType<typeof createRouter>} router
 * @param {{ apiToken: string, onError?: (err: unknown) => void }} opts
 * @returns {import('node:http').RequestListener}
 */
export function createHandler(router, opts) {
  return async function handle(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // The wall display, the phones and the dev server are all different
    // origins on the same home network, so the API answers all of them. The
    // token below — not the origin — is what actually guards the data.
    res.setHeader('Access-Control-Allow-Origin', '*');
    // X-Family-Member has to be listed or the browser fails the preflight and
    // the app never gets to send it — a header the server merely tolerates is
    // still a header the browser refuses to send.
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, If-None-Match, X-Family-Member',
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'ETag');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    try {
      if (opts.apiToken !== '' && !isAuthorized(req, url, opts.apiToken)) {
        throw new HttpError(401, 'missing or invalid API token');
      }

      for (const route of router.routes) {
        if (route.method !== req.method) continue;
        const m = route.pattern.exec(url.pathname);
        if (!m) continue;

        /** @type {Record<string, string>} */
        const params = {};
        route.keys.forEach((k, i) => {
          params[k] = decodeURIComponent(m[i + 1]);
        });

        const result = await route.handler({
          req,
          res,
          url,
          params,
          body: () => readJson(req),
        });

        // A handler that wrote its own response (a 304, say) returns nothing.
        if (res.writableEnded) return;
        sendJson(res, 200, result === undefined ? {} : result);
        return;
      }

      throw new HttpError(404, `no route for ${req.method} ${url.pathname}`);
    } catch (err) {
      if (opts.onError && !(err instanceof HttpError)) opts.onError(err);
      const status = statusFor(err);
      if (!res.writableEnded) {
        sendJson(res, status, { error: err instanceof Error ? err.message : 'unknown error' });
      }
    }
  };
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {URL} url
 * @param {string} token
 * @returns {boolean}
 */
function isAuthorized(req, url, token) {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ') && header.slice(7).trim() === token) return true;
  // A query parameter as well as a header, because a microcontroller firmware
  // fetching one URL should not need a header builder to read the calendar.
  return url.searchParams.get('token') === token;
}

/**
 * Map an error to a status. Store errors carry their meaning in their name so
 * the store never has to know it is being served over HTTP.
 *
 * @param {unknown} err
 * @returns {number}
 */
function statusFor(err) {
  if (err instanceof HttpError) return err.status;
  if (err instanceof Error) {
    if (err.name === 'ValidationError') return 400;
    if (err.name === 'NotFoundError') return 404;
    if (err instanceof TypeError) return 400;
  }
  return 500;
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 * @param {Record<string, string>} [headers]
 */
export function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}
