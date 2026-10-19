import path from 'node:path';
import express from 'express';
import compression from 'compression';
import { config } from './config.js';
import { db } from './db.js';
import { HttpError, loadUser, csrfGuard } from './auth.js';
import { cleanup } from './storage.js';
import { assetMiddleware, hasPage, sendPage } from './assets.js';
import authRoutes, { clientConfig } from './routes/auth.js';
import shareRoutes from './routes/shares.js';
import adminRoutes from './routes/admin.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join('; '),
  });
  next();
});

// Static assets are served before the session lookup: they are the same for everyone.
app.use(assetMiddleware); // scripts + styles: hashed, pre-compressed, cached for a year
const fontDir = name => path.join(config.root, 'node_modules', '@fontsource-variable', name, 'files');
app.use('/fonts', express.static(fontDir('geist'), { maxAge: '1y', immutable: true }));
app.use('/fonts', express.static(fontDir('geist-mono'), { maxAge: '1y', immutable: true }));
// Branding URLs carry a ?v= that changes with every upload.
app.use('/branding', express.static(config.brandingDir, { maxAge: '1y', immutable: true }));
// Images and icons rarely change and may be cached for a week. HTML pages are rendered below.
const publicFiles = express.static(config.publicDir, { index: false, maxAge: '7d' });
app.use((req, res, next) => (/\.html$/i.test(req.path) ? next() : publicFiles(req, res, next)));

app.use(loadUser);
// Downloads (/d, /z) are streamed untouched: they may be huge and support range requests.
app.use(compression({ filter: (req, res) => !/^\/[dz]\//.test(req.path) && compression.filter(req, res) }));
app.use('/api', express.json({ limit: '256kb' }), csrfGuard);

app.use(authRoutes);
app.use(shareRoutes);
app.use(adminRoutes);

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

// Pages. Redirects that only depend on the session happen here, before any script loads.
const PAGE_AUTH = { dashboard: 'user', admin: 'admin' };
function page(name) {
  return (req, res) => {
    const cfg = clientConfig(req);
    if (cfg.setupRequired && name !== 'setup') return res.redirect(302, '/setup');
    if (!cfg.setupRequired && name === 'setup') return res.redirect(302, '/');
    const auth = PAGE_AUTH[name];
    if (auth && !cfg.user) return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (auth === 'admin' && cfg.user.role !== 'admin') return res.redirect(302, '/dashboard');
    sendPage(res, name, cfg);
  };
}
app.get('/s/:id', page('share'));
app.get('/', page('index'));
app.get(/^\/([\w-]+?)(?:\.html)?$/, (req, res, next) => {
  const name = req.params[0];
  return hasPage(name) && name !== '404' ? page(name)(req, res, next) : next();
});

app.use((req, res) => sendPage(res, '404', clientConfig(req), 404));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err instanceof HttpError ? err.status : err.type === 'entity.parse.failed' ? 400 : 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return res.destroy();
  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on the server.' : err.message,
    code: err.code || null,
  });
});

const runCleanup = () => cleanup().catch(err => console.error('Cleanup failed:', err));
runCleanup();
setInterval(runCleanup, 5 * 60000).unref();

const server = app.listen(config.port, config.host, () => {
  console.log(`ShareHost ${config.version} running on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
});
// Large uploads can take a while; don't cut them off.
server.requestTimeout = 0;
server.headersTimeout = 120000;

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
