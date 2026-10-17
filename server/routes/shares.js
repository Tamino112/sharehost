import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { db, now, transaction } from '../db.js';
import * as settings from '../settings.js';
import { config } from '../config.js';
import {
  HttpError, hashPassword, verifyPassword, requireUser, rateLimit, randomId, sha256,
  shareUnlockToken, isShareUnlocked, cookieOptions,
} from '../auth.js';
import {
  extOf, mimeFor, isInlineSafe, filePath, crc32File, removeFiles, deleteShares, zipPlan, streamZip,
} from '../storage.js';

const router = Router();
const MB = 1048576;

const storage = multer.diskStorage({
  destination: config.uploadDir,
  filename: (_req, _file, cb) => cb(null, randomId(18)),
});

function cleanName(name) {
  const base = path.basename(String(name || 'file').replace(/\\/g, '/'));
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  return cleaned || 'file';
}

/** Relative paths sent with a folder upload, one per file in upload order. */
function relPaths(body) {
  try {
    const list = JSON.parse(body.paths || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Builds the stored name for a file from a folder upload: the client's relative path, reduced to
 * safe folder segments (no "..", no absolute paths, no control characters), plus the real file name.
 */
function folderPath(rel, fileName) {
  if (typeof rel !== 'string') return fileName;
  const dirs = rel.replace(/\\/g, '/').split('/').slice(0, -1)
    .map(s => s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120))
    .filter(s => s && s !== '.' && s !== '..')
    .slice(0, 24);
  return [...dirs, fileName].join('/');
}

function fileFilter(_req, file, cb) {
  file.originalname = cleanName(file.originalname);
  const ext = extOf(file.originalname);
  const allowed = settings.extensionList('allowedExtensions');
  const blocked = settings.extensionList('blockedExtensions');
  if ((allowed.length && !allowed.includes(ext)) || (ext && blocked.includes(ext))) {
    return cb(new HttpError(415, `Files of type ".${ext || '?'}" are not allowed on this instance.`, 'file_type'));
  }
  cb(null, true);
}

function usedBytes(userId) {
  return db.prepare('SELECT COALESCE(SUM(f.size), 0) AS n FROM files f JOIN shares s ON s.id = f.share_id WHERE s.owner_id = ?').get(userId).n;
}

function quotaBytes(user) {
  const mb = user.quotaMB ?? settings.get('defaultUserQuotaMB');
  return mb > 0 ? mb * MB : Infinity;
}

const uploadLimiter = rateLimit({ windowMs: 60000, max: 30 });

router.post('/api/shares', uploadLimiter, (req, res, next) => {
  const guest = !req.user;
  if (guest && !settings.get('guestUploads')) return next(new HttpError(401, 'Please sign in to upload files.', 'auth_required'));

  // Fail fast when the request alone would blow the user's quota.
  if (!guest) {
    const declared = Number(req.get('content-length')) || 0;
    if (usedBytes(req.user.id) + declared > quotaBytes(req.user) + MB) {
      return next(new HttpError(413, 'This upload would exceed your storage quota.', 'quota'));
    }
  }

  const maxFiles = guest ? settings.get('guestMaxFiles') : settings.get('maxFilesPerShare');
  const maxMB = guest ? settings.get('guestMaxFileSizeMB') : settings.get('maxFileSizeMB');
  const upload = multer({
    storage,
    fileFilter,
    defParamCharset: 'utf8',
    // fieldSize leaves room for the JSON list of relative paths of a folder upload
    limits: { fileSize: maxMB * MB, files: maxFiles, fields: 20, fieldSize: 2 * MB },
  }).array('files', maxFiles);

  upload(req, res, err => {
    if (err) {
      if (err instanceof multer.MulterError) {
        const messages = {
          LIMIT_FILE_SIZE: `A file is larger than the ${maxMB} MB limit.`,
          LIMIT_FILE_COUNT: `You can upload at most ${maxFiles} files at once.`,
          LIMIT_UNEXPECTED_FILE: `You can upload at most ${maxFiles} files at once.`,
        };
        return next(new HttpError(413, messages[err.code] || err.message, err.code.toLowerCase()));
      }
      return next(err);
    }
    createShare(req, res).catch(async e => {
      await removeFiles((req.files || []).map(f => f.filename));
      next(e);
    });
  });
});

async function createShare(req, res) {
  const guest = !req.user;
  const files = req.files || [];
  if (!files.length) throw new HttpError(400, 'Please choose at least one file.', 'no_files');
  const body = req.body || {};

  const paths = relPaths(body);
  const names = files.map((f, i) => folderPath(paths[i], f.originalname));
  // A single uploaded folder names the share unless a title was given.
  const roots = new Set(names.map(n => (n.includes('/') ? n.split('/')[0] : null)));
  const folderTitle = roots.size === 1 && !roots.has(null) ? [...roots][0] : null;
  const title = String(body.title || '').trim().slice(0, 120) || folderTitle?.slice(0, 120) || null;
  const message = String(body.message || '').trim().slice(0, 1000) || null;

  let passwordHash = null;
  if (body.password) {
    if (!settings.get('allowPasswordShares')) throw new HttpError(400, 'Password protected shares are disabled.', 'password_disabled');
    if (String(body.password).length > 200) throw new HttpError(400, 'Password is too long.');
    passwordHash = await hashPassword(String(body.password));
  }

  const hours = Number(body.expiresInHours ?? settings.get('defaultExpiryHours'));
  let expiresAt;
  if (hours === 0) {
    if (guest || !settings.get('allowNeverExpire')) throw new HttpError(400, 'Shares must have an expiry date.', 'expiry_required');
    expiresAt = null;
  } else {
    const maxHours = guest ? settings.get('guestMaxExpiryHours') : settings.get('maxExpiryHours');
    if (!Number.isFinite(hours) || hours < 0 || (maxHours > 0 && hours > maxHours)) {
      throw new HttpError(400, `Expiry must be at most ${maxHours} hours.`, 'expiry_too_long');
    }
    expiresAt = now() + Math.round(hours * 3600000);
  }

  let maxDownloads = null;
  if (body.maxDownloads) {
    maxDownloads = Number(body.maxDownloads);
    if (!Number.isInteger(maxDownloads) || maxDownloads < 1 || maxDownloads > 1000000) throw new HttpError(400, 'Invalid download limit.');
  }

  if (!guest) {
    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (usedBytes(req.user.id) + total > quotaBytes(req.user)) throw new HttpError(413, 'This upload would exceed your storage quota.', 'quota');
  }

  // One at a time: a folder upload can hold thousands of files, too many to open at once.
  const crcs = [];
  for (const f of files) crcs.push(await crc32File(f.path));
  const id = randomId(9);
  const manageToken = guest ? randomId(24) : null;
  const t = now();

  transaction(() => {
    db.prepare(`INSERT INTO shares (id, owner_id, title, message, password_hash, expires_at, max_downloads, manage_token_hash, uploader_ip, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, req.user?.id ?? null, title, message, passwordHash, expiresAt, maxDownloads, manageToken && sha256(manageToken), req.ip || null, t);
    const insert = db.prepare('INSERT INTO files (id, share_id, name, size, mime, crc32, storage_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    files.forEach((f, i) => insert.run(randomId(9), id, names[i], f.size, mimeFor(f.originalname), crcs[i], f.filename, t));
  });

  res.status(201).json({ id, url: `/s/${id}`, manageToken, expiresAt, fileCount: files.length });
}

export function serializeShare(s) {
  return {
    id: s.id,
    title: s.title,
    message: s.message,
    protected: !!s.password_hash,
    expiresAt: s.expires_at,
    maxDownloads: s.max_downloads,
    downloadCount: s.download_count,
    viewCount: s.view_count,
    createdAt: s.created_at,
    fileCount: s.file_count,
    totalSize: s.total_size,
    firstName: s.first_name,
    owner: s.owner_name,
  };
}

export const SHARE_LIST_SQL = `
  SELECT s.*, u.username AS owner_name,
         (SELECT COUNT(*) FROM files f WHERE f.share_id = s.id) AS file_count,
         (SELECT COALESCE(SUM(size), 0) FROM files f WHERE f.share_id = s.id) AS total_size,
         (SELECT name FROM files f WHERE f.share_id = s.id ORDER BY f.rowid LIMIT 1) AS first_name
  FROM shares s LEFT JOIN users u ON u.id = s.owner_id`;

router.get('/api/shares', requireUser, (req, res) => {
  const rows = db.prepare(`${SHARE_LIST_SQL} WHERE s.owner_id = ? ORDER BY s.created_at DESC`).all(req.user.id);
  res.json({ shares: rows.map(serializeShare) });
});

router.delete('/api/shares/:id', async (req, res) => {
  const share = db.prepare('SELECT * FROM shares WHERE id = ?').get(req.params.id);
  if (!share) throw new HttpError(404, 'Share not found.', 'not_found');
  const token = req.get('x-manage-token');
  const allowed = (req.user && (req.user.role === 'admin' || req.user.id === share.owner_id))
    || (token && share.manage_token_hash && sha256(token) === share.manage_token_hash);
  if (!allowed) throw new HttpError(403, 'You cannot delete this share.', 'forbidden');
  await deleteShares([share.id]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Public share access

const isGone = s => (s.expires_at && s.expires_at < now()) || (s.max_downloads && s.download_count >= s.max_downloads);

function loadShare(req) {
  const share = db.prepare('SELECT * FROM shares WHERE id = ?').get(String(req.params.id));
  if (!share) throw new HttpError(404, 'This share does not exist.', 'not_found');
  if (isGone(share)) throw new HttpError(410, 'This share has expired.', 'expired');
  if (settings.get('requireLoginToDownload') && !req.user) throw new HttpError(401, 'Please sign in to access this share.', 'login_required');
  return share;
}

router.get('/api/s/:id', (req, res) => {
  const share = loadShare(req);
  const unlocked = isShareUnlocked(req, share);
  if (!unlocked) return res.json({ id: share.id, protected: true, unlocked: false, expiresAt: share.expires_at });

  db.prepare('UPDATE shares SET view_count = view_count + 1 WHERE id = ?').run(share.id);
  const files = db.prepare('SELECT * FROM files WHERE share_id = ? ORDER BY rowid').all(share.id);
  const owner = share.owner_id ? db.prepare('SELECT username FROM users WHERE id = ?').get(share.owner_id)?.username : null;
  res.json({
    id: share.id,
    title: share.title,
    message: share.message,
    owner,
    protected: !!share.password_hash,
    unlocked: true,
    createdAt: share.created_at,
    expiresAt: share.expires_at,
    maxDownloads: share.max_downloads,
    downloadCount: share.download_count,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    zip: files.length > 1 && zipPlan(files).supported,
    canDelete: !!(req.user && (req.user.role === 'admin' || req.user.id === share.owner_id)),
    files: files.map(f => ({
      id: f.id,
      name: f.name,
      size: f.size,
      mime: f.mime,
      preview: isInlineSafe(f.mime) && !share.max_downloads,
      downloads: f.download_count,
    })),
  });
});

const unlockLimiter = rateLimit({ windowMs: 15 * 60000, max: 20, key: req => `${req.ip}:${req.params.id}` });

router.post('/api/s/:id/unlock', unlockLimiter, async (req, res) => {
  const share = loadShare(req);
  if (!share.password_hash) return res.json({ ok: true });
  if (!(await verifyPassword(String(req.body?.password || ''), share.password_hash))) {
    throw new HttpError(401, 'Wrong password.', 'bad_password');
  }
  res.cookie(`sh_u_${share.id}`, shareUnlockToken(share.id, share.password_hash), cookieOptions(req, 12 * 3600000));
  res.json({ ok: true });
});

/** Atomically counts a download, refusing it if the limit has been reached meanwhile. */
function countDownload(share, fileId) {
  const info = db.prepare(`UPDATE shares SET download_count = download_count + 1
                           WHERE id = ? AND (max_downloads IS NULL OR download_count < max_downloads)`).run(share.id);
  if (!info.changes) return false;
  if (fileId) db.prepare('UPDATE files SET download_count = download_count + 1 WHERE id = ?').run(fileId);
  else db.prepare('UPDATE files SET download_count = download_count + 1 WHERE share_id = ?').run(share.id);
  return true;
}

/** Download routes are opened directly by the browser, so errors redirect back to the share page. */
function downloadGuard(handler) {
  return async (req, res, next) => {
    try {
      const share = loadShare(req);
      if (!isShareUnlocked(req, share)) return res.redirect(303, `/s/${encodeURIComponent(share.id)}`);
      res.set('Content-Security-Policy', "default-src 'none'; media-src 'self'; img-src 'self'; sandbox");
      await handler(req, res, share);
    } catch (err) {
      if (err instanceof HttpError && !res.headersSent) return res.redirect(303, `/s/${encodeURIComponent(req.params.id)}`);
      next(err);
    }
  };
}

router.get('/d/:id/:fileId', downloadGuard(async (req, res, share) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND share_id = ?').get(req.params.fileId, share.id);
  if (!file) throw new HttpError(404, 'File not found.');
  const preview = req.query.preview === '1' && isInlineSafe(file.mime) && !share.max_downloads;

  if (preview) {
    res.type(file.mime);
    res.set('Content-Disposition', 'inline');
  } else {
    // Only count the first request of a (possibly resumed / ranged) download.
    const range = req.get('range');
    if (!range || /^bytes=0-/.test(range)) {
      if (!countDownload(share, file.id)) throw new HttpError(410, 'Download limit reached.', 'expired');
    }
    res.attachment(path.posix.basename(file.name));
  }
  res.sendFile(filePath(file.storage_name), { cacheControl: false, headers: { 'Cache-Control': 'private, no-store' } }, err => {
    if (err && !res.headersSent) res.status(err.status || 500).end();
  });
}));

router.get('/z/:id', downloadGuard(async (req, res, share) => {
  const files = db.prepare('SELECT * FROM files WHERE share_id = ? ORDER BY rowid').all(share.id);
  const plan = zipPlan(files);
  if (!plan.supported) throw new HttpError(413, 'This share is too large to download as a single ZIP.');
  if (!countDownload(share, null)) throw new HttpError(410, 'Download limit reached.', 'expired');
  const base = (share.title || `share-${share.id}`).replace(/[\\/:*?"<>|]/g, '_');
  res.attachment(`${base}.zip`);
  res.set({ 'Content-Type': 'application/zip', 'Content-Length': String(plan.total), 'Cache-Control': 'private, no-store' });
  await streamZip(plan, res).catch(() => res.destroy());
}));

export default router;
