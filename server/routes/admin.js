import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Router } from 'express';
import multer from 'multer';
import { db, now, transaction } from '../db.js';
import * as settings from '../settings.js';
import { config } from '../config.js';
import { HttpError, requireAdmin, hashPassword, validateCredentials, validateEmail, randomId } from '../auth.js';
import { cleanup, deleteShares, diskInfo } from '../storage.js';
import { serializeShare, SHARE_LIST_SQL } from './shares.js';

const router = Router();
router.use('/api/admin', requireAdmin);

const startedAt = now();
const DAY = 86400000;

router.get('/api/admin/stats', async (_req, res) => {
  const t = now();
  const one = sql => db.prepare(sql).get();
  const since = t - 13 * DAY;
  const startOfDay = new Date(since).setHours(0, 0, 0, 0);
  const rows = db.prepare(`SELECT s.created_at AS t, COALESCE(SUM(f.size), 0) AS bytes FROM shares s
                           LEFT JOIN files f ON f.share_id = s.id WHERE s.created_at >= ? GROUP BY s.id`).all(startOfDay);
  const days = Array.from({ length: 14 }, (_, i) => ({ day: new Date(startOfDay + i * DAY + DAY / 2).toISOString().slice(0, 10), shares: 0, bytes: 0 }));
  for (const r of rows) {
    const idx = Math.floor((r.t - startOfDay) / DAY);
    if (days[idx]) { days[idx].shares++; days[idx].bytes += r.bytes; }
  }
  res.json({
    users: one('SELECT COUNT(*) AS n FROM users').n,
    admins: one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").n,
    shares: one('SELECT COUNT(*) AS n FROM shares').n,
    protectedShares: one('SELECT COUNT(*) AS n FROM shares WHERE password_hash IS NOT NULL').n,
    guestShares: one('SELECT COUNT(*) AS n FROM shares WHERE owner_id IS NULL').n,
    files: one('SELECT COUNT(*) AS n FROM files').n,
    storageBytes: one('SELECT COALESCE(SUM(size), 0) AS n FROM files').n,
    downloads: one('SELECT COALESCE(SUM(download_count), 0) AS n FROM shares').n,
    expiringSoon: db.prepare('SELECT COUNT(*) AS n FROM shares WHERE expires_at BETWEEN ? AND ?').get(t, t + DAY).n,
    activeSessions: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?').get(t).n,
    days,
    disk: await diskInfo(),
    system: {
      version: config.version,
      node: process.version,
      platform: `${os.type()} ${os.arch()}`,
      uptime: t - startedAt,
      dataDir: config.dataDir,
      memory: process.memoryUsage().rss,
    },
  });
});

// ---------------------------------------------------------------------------
// Settings

router.get('/api/admin/settings', (_req, res) => {
  res.json({ schema: settings.SCHEMA, values: settings.all() });
});

router.put('/api/admin/settings', (req, res) => {
  const values = req.body || {};
  if (typeof values !== 'object' || Array.isArray(values)) throw new HttpError(400, 'Invalid settings payload.');
  try {
    settings.update(values);
  } catch (err) {
    throw new HttpError(400, err.message, 'invalid_setting');
  }
  res.json({ values: settings.all() });
});

const BRANDING = {
  backgroundImage: { exts: ['jpg', 'jpeg', 'png', 'webp', 'avif'], maxMB: 25 },
  backgroundPoster: { exts: ['jpg', 'jpeg', 'png', 'webp', 'avif'], maxMB: 10 },
  backgroundVideo: { exts: ['mp4', 'webm'], maxMB: 200 },
  logo: { exts: ['png', 'webp', 'jpg', 'jpeg'], maxMB: 5 },
};

async function removeBranding(slot) {
  for (const name of await fs.readdir(config.brandingDir)) {
    if (name.startsWith(`${slot}.`)) await fs.rm(path.join(config.brandingDir, name), { force: true });
  }
}

router.post('/api/admin/branding/:slot', (req, res, next) => {
  const slot = req.params.slot;
  const spec = BRANDING[slot];
  if (!spec) return next(new HttpError(404, 'Unknown branding slot.'));
  const upload = multer({
    storage: multer.diskStorage({
      destination: config.brandingDir,
      filename: (_req, _file, cb) => cb(null, `_upload-${randomId(9)}`), // never matches removeBranding()
    }),
    limits: { fileSize: spec.maxMB * 1048576, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(1).toLowerCase();
      if (!spec.exts.includes(ext)) return cb(new HttpError(415, `Allowed formats: ${spec.exts.join(', ')}`));
      file.ext = ext;
      cb(null, true);
    },
  }).single('file');

  upload(req, res, async err => {
    try {
      if (err) throw err instanceof multer.MulterError ? new HttpError(413, `File too large (max ${spec.maxMB} MB).`) : err;
      if (!req.file) throw new HttpError(400, 'No file received.');
      await removeBranding(slot);
      const finalName = `${slot}.${req.file.ext}`;
      await fs.rename(req.file.path, path.join(config.brandingDir, finalName));
      const url = `/branding/${finalName}?v=${Date.now().toString(36)}`;
      settings.setRaw(slot, url);
      res.json({ slot, url });
    } catch (e) {
      if (req.file) await fs.rm(req.file.path, { force: true });
      next(e);
    }
  });
});

// Background images that ship with ShareHost (public/assets/backgrounds).
const BACKGROUND_PRESETS = ['glass', 'aurora'];

router.post('/api/admin/branding/backgroundImage/preset', async (req, res) => {
  const name = req.body?.name;
  if (!BACKGROUND_PRESETS.includes(name)) throw new HttpError(404, 'Unknown preset.');
  await removeBranding('backgroundImage');
  const url = `/assets/backgrounds/${name}.webp`;
  settings.setRaw('backgroundImage', url);
  res.json({ slot: 'backgroundImage', url });
});

router.delete('/api/admin/branding/:slot', async (req, res) => {
  const slot = req.params.slot;
  if (!BRANDING[slot]) throw new HttpError(404, 'Unknown branding slot.');
  await removeBranding(slot);
  settings.setRaw(slot, '');
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Users

const serializeUser = u => ({
  id: u.id, username: u.username, email: u.email, role: u.role, quotaMB: u.quota_mb,
  disabled: !!u.disabled, createdAt: u.created_at, lastLogin: u.last_login,
  shares: u.shares, usedBytes: u.used_bytes,
});

const USER_SQL = `
  SELECT u.*,
    (SELECT COUNT(*) FROM shares s WHERE s.owner_id = u.id) AS shares,
    (SELECT COALESCE(SUM(f.size), 0) FROM files f JOIN shares s ON s.id = f.share_id WHERE s.owner_id = u.id) AS used_bytes
  FROM users u`;

router.get('/api/admin/users', (_req, res) => {
  res.json({
    users: db.prepare(`${USER_SQL} ORDER BY u.created_at ASC`).all().map(serializeUser),
    defaultQuotaMB: settings.get('defaultUserQuotaMB'),
  });
});

function parseQuota(value) {
  if (value === null || value === '' || value === undefined) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'Quota must be a whole number of MB (0 = unlimited).');
  return n;
}

router.post('/api/admin/users', async (req, res) => {
  const { username, email, password, role = 'user', quotaMB } = req.body || {};
  validateCredentials({ username, password, email });
  if (!['admin', 'user'].includes(role)) throw new HttpError(400, 'Invalid role.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'This username is already taken.', 'username_taken');
  const info = db.prepare('INSERT INTO users (username, email, password_hash, role, quota_mb, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(username, email || null, await hashPassword(password), role, parseQuota(quotaMB), now());
  res.status(201).json({ user: serializeUser(db.prepare(`${USER_SQL} WHERE u.id = ?`).get(info.lastInsertRowid)) });
});

const otherActiveAdmins = id => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?").get(id).n;

router.patch('/api/admin/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new HttpError(404, 'User not found.');
  const b = req.body || {};
  const losesAdmin = (b.role && b.role !== 'admin') || b.disabled === true;
  if (user.role === 'admin' && losesAdmin && otherActiveAdmins(id) === 0) {
    throw new HttpError(400, 'There must always be at least one active administrator.', 'last_admin');
  }
  const updates = {};
  if (b.role !== undefined) {
    if (!['admin', 'user'].includes(b.role)) throw new HttpError(400, 'Invalid role.');
    updates.role = b.role;
  }
  if (b.disabled !== undefined) updates.disabled = b.disabled ? 1 : 0;
  if (b.quotaMB !== undefined) updates.quota_mb = parseQuota(b.quotaMB);
  if (b.email !== undefined) {
    validateEmail(b.email);
    updates.email = b.email || null;
  }
  if (b.password) {
    validateCredentials({ username: user.username, password: b.password });
    updates.password_hash = await hashPassword(b.password);
  }
  const keys = Object.keys(updates);
  if (keys.length) {
    db.prepare(`UPDATE users SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => updates[k]), id);
  }
  if (updates.disabled || updates.password_hash) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  res.json({ user: serializeUser(db.prepare(`${USER_SQL} WHERE u.id = ?`).get(id)) });
});

router.delete('/api/admin/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new HttpError(404, 'User not found.');
  if (id === req.user.id) throw new HttpError(400, 'You cannot delete your own account.');
  if (user.role === 'admin' && otherActiveAdmins(id) === 0) throw new HttpError(400, 'There must always be at least one active administrator.', 'last_admin');
  const shareIds = db.prepare('SELECT id FROM shares WHERE owner_id = ?').all(id).map(r => r.id);
  await deleteShares(shareIds);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Shares

router.get('/api/admin/shares', (req, res) => {
  const q = String(req.query.q || '').trim();
  const where = q ? `WHERE s.id LIKE ?1 OR s.title LIKE ?1 OR u.username LIKE ?1
                     OR EXISTS (SELECT 1 FROM files f WHERE f.share_id = s.id AND f.name LIKE ?1)` : '';
  const stmt = db.prepare(`${SHARE_LIST_SQL} ${where} ORDER BY s.created_at DESC LIMIT 500`);
  const rows = q ? stmt.all(`%${q}%`) : stmt.all();
  res.json({ shares: rows.map(serializeShare) });
});

router.delete('/api/admin/shares/:id', async (req, res) => {
  await deleteShares([String(req.params.id)]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Invites

router.get('/api/admin/invites', (_req, res) => {
  const rows = db.prepare(`SELECT i.*, u.username AS used_by_name FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC`).all();
  res.json({
    invites: rows.map(i => ({
      code: i.code, note: i.note, createdAt: i.created_at, expiresAt: i.expires_at, usedBy: i.used_by_name, usedAt: i.used_at,
    })),
  });
});

router.post('/api/admin/invites', (req, res) => {
  const days = Number(req.body?.expiresInDays || 0);
  const count = Math.min(Math.max(Number(req.body?.count) || 1, 1), 50);
  const note = String(req.body?.note || '').trim().slice(0, 120) || null;
  if (!Number.isInteger(days) || days < 0 || days > 3650) throw new HttpError(400, 'Invalid expiry.');
  const codes = transaction(() => Array.from({ length: count }, () => {
    const code = randomId(8).replace(/[-_]/g, 'x');
    db.prepare('INSERT INTO invites (code, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(code, note, req.user.id, now(), days ? now() + days * DAY : null);
    return code;
  }));
  res.status(201).json({ codes });
});

router.delete('/api/admin/invites/:code', (req, res) => {
  db.prepare('DELETE FROM invites WHERE code = ?').run(req.params.code);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Maintenance

router.post('/api/admin/maintenance/cleanup', async (_req, res) => {
  res.json(await cleanup());
});

router.post('/api/admin/maintenance/sessions', (req, res) => {
  const info = db.prepare('DELETE FROM sessions WHERE user_id != ?').run(req.user.id);
  res.json({ revoked: info.changes });
});

router.get('/api/admin/maintenance/export', (_req, res) => {
  res.attachment(`sharehost-settings-${new Date().toISOString().slice(0, 10)}.json`);
  res.json({ sharehost: config.version, exportedAt: new Date().toISOString(), settings: settings.all() });
});

router.post('/api/admin/maintenance/import', (req, res) => {
  const incoming = req.body?.settings;
  if (!incoming || typeof incoming !== 'object') throw new HttpError(400, 'Invalid settings file.');
  const values = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (settings.SCHEMA[key] && settings.SCHEMA[key].type !== 'media') values[key] = value;
  }
  try {
    settings.update(values);
  } catch (err) {
    throw new HttpError(400, err.message, 'invalid_setting');
  }
  res.json({ imported: Object.keys(values).length });
});

export default router;
