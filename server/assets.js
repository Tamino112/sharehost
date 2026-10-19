import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { config } from './config.js';

/**
 * In-memory asset pipeline for the front end (no build step needed):
 * - every script and stylesheet gets a content hash; HTML and module imports reference the
 *   hashed URL, so browsers cache them for a year and never revalidate (`immutable`)
 * - files are pre-compressed once at startup (brotli + gzip)
 * - each page lists its whole module graph as <link rel="modulepreload">, so all scripts load
 *   in parallel instead of one import level at a time
 * Files are read once at startup; `npm run dev` restarts the server when public/ changes.
 */

const YEAR = 'public, max-age=31536000, immutable';
const hashOf = buf => crypto.createHash('sha256').update(buf).digest('base64url').slice(0, 10);
// Relative static imports: `from './x.js'` and `import './x.js'`.
const IMPORT_RE = /(\bfrom\s*|\bimport\s*)(['"])\.\/([\w.-]+\.js)\2/g;

function compressAll(body) {
  return {
    raw: body,
    br: zlib.brotliCompressSync(body, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length },
    }),
    gzip: zlib.gzipSync(body, { level: 9 }),
  };
}

function build() {
  const files = new Map(); // url path -> { hash, type, bodies, deps }
  const jsDir = path.join(config.publicDir, 'assets', 'js');

  const buildJs = (name, stack = []) => {
    const url = `/assets/js/${name}`;
    if (files.has(url)) return files.get(url);
    let src = fs.readFileSync(path.join(jsDir, name), 'utf8');
    const deps = new Set();
    src = src.replace(IMPORT_RE, (match, kw, quote, dep) => {
      if (stack.includes(dep) || !fs.existsSync(path.join(jsDir, dep))) return match; // cycle or unknown: leave as is
      const d = buildJs(dep, [...stack, name]);
      deps.add(`/assets/js/${dep}`);
      for (const sub of d.deps) deps.add(sub);
      return `${kw}${quote}./${dep}?v=${d.hash}${quote}`;
    });
    const body = Buffer.from(src);
    const entry = { hash: hashOf(body), type: 'text/javascript; charset=utf-8', bodies: compressAll(body), deps };
    files.set(url, entry);
    return entry;
  };
  for (const name of fs.readdirSync(jsDir)) if (name.endsWith('.js')) buildJs(name);

  const cssDir = path.join(config.publicDir, 'assets', 'css');
  for (const name of fs.readdirSync(cssDir)) {
    if (!name.endsWith('.css')) continue;
    const body = fs.readFileSync(path.join(cssDir, name));
    files.set(`/assets/css/${name}`, { hash: hashOf(body), type: 'text/css; charset=utf-8', bodies: compressAll(body), deps: new Set() });
  }

  const versioned = url => `${url}?v=${files.get(url).hash}`;
  const pages = new Map(); // page name -> html template
  for (const name of fs.readdirSync(config.publicDir)) {
    if (!name.endsWith('.html')) continue;
    let html = fs.readFileSync(path.join(config.publicDir, name), 'utf8');
    html = html.replace(/(href|src)="(\/assets\/(?:css|js)\/[\w.-]+\.(?:css|js))"/g, (m, attr, url) => (files.has(url) ? `${attr}="${versioned(url)}"` : m));
    html = html.replace(/<script type="module" src="(\/assets\/js\/[\w.-]+\.js)\?v=\w+"><\/script>/, (tag, url) => {
      const preloads = [...files.get(url).deps].map(dep => `\n  <link rel="modulepreload" href="${versioned(dep)}">`).join('');
      return tag + preloads;
    });
    pages.set(name.slice(0, -5), html);
  }
  return { files, pages };
}

const { files, pages } = build();

function pickEncoding(req) {
  const accept = String(req.get('accept-encoding') || '');
  if (/\bbr\b/.test(accept)) return 'br';
  if (/\bgzip\b/.test(accept)) return 'gzip';
  return null;
}

/** Serves /assets/js/* and /assets/css/* from memory. */
export function assetMiddleware(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const file = files.get(req.path);
  if (!file) return next();
  const etag = `"${file.hash}"`;
  res.set({
    'Content-Type': file.type,
    'Cache-Control': req.query.v === file.hash ? YEAR : 'no-cache',
    ETag: etag,
    Vary: 'Accept-Encoding',
  });
  if (req.get('if-none-match') === etag) return res.status(304).end();
  const enc = pickEncoding(req);
  const body = enc ? file.bodies[enc] : file.bodies.raw;
  if (enc) res.set('Content-Encoding', enc);
  res.set('Content-Length', String(body.length));
  res.status(200).end(req.method === 'HEAD' ? undefined : body);
}

export const hasPage = name => pages.has(name);

// JSON inside <script> must not be able to close the tag or open a comment (it is only read by JSON.parse).
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
const attr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Sends an HTML page with the instance config embedded, so the page can render without first
 * fetching /api/config, and with the appearance attributes set before any script runs.
 */
export function sendPage(res, name, clientConfig, status = 200) {
  const s = clientConfig.settings;
  const htmlAttrs = [
    `data-style="${attr(s.designStyle || 'glass')}"`,
    `data-motion="${s.animations ? 'on' : 'off'}"`,
    // "system" depends on the visitor's device; core.js resolves it.
    s.theme === 'system' ? '' : `data-theme="${s.theme === 'light' ? 'light' : 'dark'}"`,
  ].filter(Boolean).join(' ');

  // Start downloading the background before the scripts that place it have even run.
  const bg = s.backgroundMode === 'image' ? s.backgroundImage : s.backgroundMode === 'video' ? s.backgroundPoster : '';
  const head = [
    bg ? `<link rel="preload" as="image" href="${attr(bg)}" fetchpriority="high">` : '',
    `<script type="application/json" id="sh-config">${safeJson(clientConfig)}</script>`,
  ].filter(Boolean).join('\n  ');

  const html = pages.get(name)
    .replace('<html lang="en">', `<html lang="en" ${htmlAttrs}>`)
    .replace('</head>', `  ${head}\n</head>`);
  res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-cache' }).send(html);
}
