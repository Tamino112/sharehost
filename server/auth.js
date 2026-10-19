import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db, now } from './db.js';
import * as settings from './settings.js';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_COOKIE = 'sh_session';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT_OPTS);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT_OPTS);
  return crypto.timingSafeEqual(expected, actual);
}

export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const randomId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(part.slice(idx + 1).trim()); } catch { /* skip malformed */ }
  }
  return out;
}

export function cookieOptions(req, maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies || req.secure,
    path: '/',
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}

export function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const lifetime = settings.get('sessionLifetimeDays') * 86400000;
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha256(token), userId, now(), now() + lifetime, req.ip || null, String(req.get('user-agent') || '').slice(0, 300));
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now(), userId);
  res.cookie(SESSION_COOKIE, token, cookieOptions(req, lifetime));
}

export function destroySession(req, res) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

const sessionLookup = db.prepare(`
  SELECT u.id, u.username, u.email, u.role, u.quota_mb, u.disabled, s.expires_at
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.id = ?
`);

/** Populates req.cookies and req.user on every request. */
export function loadUser(req, _res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  req.user = null;
  const token = req.cookies[SESSION_COOKIE];
  if (token) {
    const row = sessionLookup.get(sha256(token));
    if (row && row.expires_at > now() && !row.disabled) {
      req.user = { id: row.id, username: row.username, email: row.email, role: row.role, quotaMB: row.quota_mb };
    }
  }
  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in first.', 'auth_required'));
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in first.', 'auth_required'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Administrator access required.', 'forbidden'));
  next();
}

/**
 * CSRF protection: every state-changing API call must carry a custom header.
 * Browsers will not send custom headers cross-origin without a CORS preflight, which we never grant.
 */
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-sharehost') !== '1') return next(new HttpError(403, 'Missing request header.', 'csrf'));
  next();
}

/** Tiny in-memory fixed-window rate limiter. */
export function rateLimit({ windowMs, max, key = req => req.ip }) {
  const hits = new Map();
  setInterval(() => {
    const t = now();
    for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
  }, windowMs).unref();
  return (req, _res, next) => {
    const limit = typeof max === 'function' ? max() : max;
    const k = key(req);
    const t = now();
    let entry = hits.get(k);
    if (!entry || entry.reset < t) {
      entry = { count: 0, reset: t + windowMs };
      hits.set(k, entry);
    }
    entry.count++;
    if (entry.count > limit) return next(new HttpError(429, 'Too many attempts. Please wait a moment.', 'rate_limited'));
    next();
  };
}

export function validateCredentials({ username, password, email }) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    throw new HttpError(400, 'Username must be 3–32 characters: letters, numbers, dot, dash or underscore.', 'invalid_username');
  }
  const min = settings.get('minPasswordLength');
  if (typeof password !== 'string' || password.length < min || password.length > 256) {
    throw new HttpError(400, `Password must be at least ${min} characters long.`, 'weak_password');
  }
  validateEmail(email);
}

export function validateEmail(email) {
  if (email != null && email !== '' && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)) {
    throw new HttpError(400, 'Please enter a valid email address.', 'invalid_email');
  }
}

/** Signed cookie value proving a visitor entered a share's password. */
export function shareUnlockToken(shareId, passwordHash) {
  return crypto.createHmac('sha256', settings.secret()).update(`${shareId}:${passwordHash}`).digest('base64url');
}

export function isShareUnlocked(req, share) {
  if (!share.password_hash) return true;
  if (req.user && (req.user.role === 'admin' || req.user.id === share.owner_id)) return true;
  const cookie = req.cookies[`sh_u_${share.id}`];
  if (!cookie) return false;
  const actual = Buffer.from(cookie);
  const expected = Buffer.from(shareUnlockToken(share.id, share.password_hash));
  // Compare byte lengths: a cookie with non-ASCII characters would otherwise make timingSafeEqual throw.
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
