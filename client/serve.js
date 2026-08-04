// Static file server for the built React bundle.
//
// Dependency-free on purpose: the only thing this container does is hand out
// the files Vite produced, and every dependency added here is one more thing
// to patch in an image whose job is to serve four files.
//
// It writes nothing, binds an unprivileged port and runs as a non-root user,
// so it is happy on a read-only root filesystem.
//
// It serves NO /api route. Requests to /api never reach this container: the
// ingress routes them to the `api` service by `expose.path`.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

// Vite fingerprints everything it emits into assets/, so those files are safe
// to cache forever; index.html is the mutable entry point and must not be.
const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';

/**
 * @param {string} root Directory to serve. Taken as an argument so the tests
 *   can point it at a fixture directory instead of the image's /www.
 */
export function createHandler(root) {
  const base = path.resolve(root);

  return async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed', {
        Allow: 'GET, HEAD',
      });
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return send(res, 400, 'text/plain; charset=utf-8', 'Bad Request');
    }

    if (pathname === '/health') {
      // Liveness/readiness probe for the platform. Static, so it stays true
      // whatever the api service is doing.
      return send(res, 200, 'application/json; charset=utf-8', '{"status":"ok"}');
    }

    // Resolve inside the root, then prove the result is still inside it, so
    // an encoded ../../etc/passwd cannot escape. Symlinks are not re-resolved:
    // /www holds only what Vite emitted, and contains none.
    const target = path.resolve(
      base,
      '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname),
    );
    if (target !== base && !target.startsWith(base + path.sep)) {
      return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
    }

    let filePath = target;
    let info;
    try {
      info = await stat(filePath);
      if (info.isDirectory()) {
        // No directory listings: unreferenced files in the bundle should not
        // become discoverable by browsing.
        filePath = path.join(filePath, 'index.html');
        info = await stat(filePath);
      }
    } catch {
      // Deliberately no SPA fallback to index.html. This template has no
      // client-side router, and a blanket fallback turns every typo into a
      // 200. If you add react-router, serve index.html here instead — and
      // only here, since /api never reaches this server.
      return send(res, 404, 'text/plain; charset=utf-8', 'Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Length': String(info.size),
      'Cache-Control': filePath.includes(path.sep + 'assets' + path.sep) ? IMMUTABLE : NO_CACHE,
    };
    writeHead(res, 200, MIME[ext] ?? 'application/octet-stream', headers);

    if (req.method === 'HEAD') return res.end();
    createReadStream(filePath).pipe(res);
  };
}

function writeHead(res, status, contentType, headers = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    // The bundle loads only its own assets and calls only its own /api, so
    // 'self' covers everything. Tighten or widen deliberately if your app
    // starts loading third-party scripts, fonts or images.
    'Content-Security-Policy':
      "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...headers,
  });
}

function send(res, status, contentType, body, headers = {}) {
  writeHead(res, status, contentType, {
    'Content-Length': String(Buffer.byteLength(body)),
    ...headers,
  });
  res.end(res.req?.method === 'HEAD' ? undefined : body);
}

export function createWebServer(root) {
  const server = createServer(createHandler(root));
  // A stalled client must not be able to hold a connection open forever.
  server.keepAliveTimeout = 10_000;
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  return server;
}

// Started directly (the container's CMD), not imported by a test.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  const root = process.env.WEB_ROOT ?? '/www';
  createWebServer(root).listen(port, () => {
    console.log(`web listening on :${port} serving ${root}`);
  });
}
