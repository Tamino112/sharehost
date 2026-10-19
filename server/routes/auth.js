import { Router } from 'express';
import { db, now, transaction } from '../db.js';
import * as settings from '../settings.js';
import { config } from '../config.js';
import {
  HttpError, hashPassword, verifyPassword, createSession, destroySession,
  requireUser, rateLimit, validateCredentials, sha256,
} from '../auth.js';

const router = Router();

const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
const loginLimiter = rateLimit({ windowMs: 15 * 60000, max: () => settings.get('loginRateLimit') });
const setupLimiter = rateLimit({ windowMs: 15 * 60000, max: 20 });

export const publicUser = u => u && { id: u.id, username: u.username, email: u.email, role: u.role };

// Public instance configuration used by every page.
router.get('/api/config', (req, res) => {
  const s = settings.all();
  const guest = !req.user;
  res.json({
    version: config.version,
    setupRequired: userCount() === 0,
    user: publicUser(req.user),
    settings: settings.publicSettings(),
    upload: {
      allowed: !guest || s.guestUploads,
      maxFileSizeMB: guest ? s.guestMaxFileSizeMB : s.maxFileSizeMB,
      maxFiles: guest ? s.guestMaxFiles : s.maxFilesPerShare,
      defaultExpiryHours: guest ? Math.min(s.defaultExpiryHours, s.guestMaxExpiryHours) : s.defaultExpiryHours,
      maxExpiryHours: guest ? s.guestMaxExpiryHours : s.maxExpiryHours,
      allowNeverExpire: !guest && s.allowNeverExpire,
      allowPassword: s.allowPasswordShares,
      allowedExtensions: settings.extensionList('allowedExtensions'),
      blockedExtensions: settings.extensionList('blockedExtensions'),
    },
    registrationMode: s.registrationMode,
    minPasswordLength: s.minPasswordLength,
  });
});

// Shipped background images the setup offers besides 'aurora' and 'none' (public/assets/backgrounds).
const SETUP_BACKGROUNDS = ['image:glass', 'image:aurora'];

// First-run setup: creates the administrator account. Only works while no user exists.
router.post('/api/setup', setupLimiter, async (req, res) => {
  const { username, email, password, siteName, registrationMode, guestUploads, language, designStyle, background } = req.body || {};
  validateCredentials({ username, password, email });
  const hash = await hashPassword(password);

  const userId = transaction(() => {
    if (userCount() > 0) throw new HttpError(409, 'Setup has already been completed.', 'setup_done');
    const info = db.prepare(`INSERT INTO users (username, email, password_hash, role, quota_mb, created_at)
                             VALUES (?, ?, ?, 'admin', 0, ?)`).run(username, email || null, hash, now());
    return Number(info.lastInsertRowid);
  });

  const initial = {};
  if (typeof siteName === 'string' && siteName.trim()) initial.siteName = siteName;
  if (registrationMode) initial.registrationMode = registrationMode;
  if (typeof guestUploads === 'boolean') initial.guestUploads = guestUploads;
  if (language) initial.defaultLanguage = language;
  if (designStyle) initial.designStyle = designStyle;
  if (background === 'aurora' || background === 'none') initial.backgroundMode = background;
  try {
    settings.update(initial);
  } catch (err) {
    throw new HttpError(400, err.message, 'invalid_setting');
  }
  // The shipped background images are set directly: uploads need a signed-in admin.
  if (SETUP_BACKGROUNDS.includes(background)) {
    settings.setRaw('backgroundImage', `/assets/backgrounds/${background.slice(6)}.webp`);
    settings.update({ backgroundMode: 'image' });
  }

  createSession(req, res, userId);
  res.status(201).json({ ok: true });
});

router.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') throw new HttpError(400, 'Username and password are required.');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  // Always run a hash comparison so response time does not reveal whether the user exists.
  const ok = await verifyPassword(password, user?.password_hash || 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86));
  if (!user || !ok) throw new HttpError(401, 'Wrong username or password.', 'bad_credentials');
  if (user.disabled) throw new HttpError(403, 'This account has been disabled.', 'disabled');
  createSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/api/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

router.post('/api/auth/register', loginLimiter, async (req, res) => {
  const mode = settings.get('registrationMode');
  if (mode === 'closed') throw new HttpError(403, 'Registration is closed on this instance.', 'registration_closed');
  const { username, email, password, inviteCode } = req.body || {};
  validateCredentials({ username, password, email });
  const hash = await hashPassword(password);

  const userId = transaction(() => {
    let invite = null;
    if (mode === 'invite') {
      invite = db.prepare('SELECT * FROM invites WHERE code = ?').get(String(inviteCode || '').trim());
      if (!invite || invite.used_by || (invite.expires_at && invite.expires_at < now())) {
        throw new HttpError(400, 'This invite code is invalid or has already been used.', 'invalid_invite');
      }
    }
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      throw new HttpError(409, 'This username is already taken.', 'username_taken');
    }
    const info = db.prepare(`INSERT INTO users (username, email, password_hash, role, created_at) VALUES (?, ?, ?, 'user', ?)`)
      .run(username, email || null, hash, now());
    const id = Number(info.lastInsertRowid);
    if (invite) db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?').run(id, now(), invite.code);
    return id;
  });

  createSession(req, res, userId);
  res.status(201).json({ ok: true });
});

router.get('/api/account', requireUser, (req, res) => {
  const usage = db.prepare(`
    SELECT COUNT(DISTINCT s.id) AS shares, COALESCE(SUM(f.size), 0) AS bytes, COALESCE(SUM(f.download_count), 0) AS downloads
    FROM shares s LEFT JOIN files f ON f.share_id = s.id WHERE s.owner_id = ?
  `).get(req.user.id);
  const quotaMB = req.user.quotaMB ?? settings.get('defaultUserQuotaMB');
  res.json({ user: publicUser(req.user), usage: { ...usage, quotaBytes: quotaMB * 1048576 } });
});

router.post('/api/account/password', requireUser, loginLimiter, async (req, res) => {
  const { current, next } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!(await verifyPassword(current, row.password_hash))) throw new HttpError(400, 'Your current password is incorrect.', 'bad_credentials');
  validateCredentials({ username: req.user.username, password: next });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), req.user.id);
  // Sign out every other session.
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, sha256(req.cookies.sh_session || ''));
  res.json({ ok: true });
});

export default router;
