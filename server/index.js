import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { db } from './db.js';
import { HttpError, loadUser, csrfGuard } from './auth.js';
import { cleanup } from './storage.js';
import authRoutes from './routes/auth.js';
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

app.use(loadUser);
app.use('/api', express.json({ limit: '256kb' }), csrfGuard);

app.use(authRoutes);
app.use(shareRoutes);
app.use(adminRoutes);

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

// Static assets
const fontDir = name => path.join(config.root, 'node_modules', '@fontsource-variable', name, 'files');
app.use('/fonts', express.static(fontDir('geist'), { maxAge: '30d', immutable: true }));
app.use('/fonts', express.static(fontDir('geist-mono'), { maxAge: '30d', immutable: true }));
app.use('/branding', express.static(config.brandingDir, { maxAge: '7d' }));
app.get('/s/:id', (_req, res) => res.sendFile(path.join(config.publicDir, 'share.html')));
app.use(express.static(config.publicDir, { extensions: ['html'], index: 'index.html', maxAge: '1h' }));

app.use((req, res) => {
  res.status(404).sendFile(path.join(config.publicDir, '404.html'));
});

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
