import { db } from './db.js';
import * as settings from './settings.js';
import { HttpError } from './auth.js';

const MB = 1048576;
const pools = new Map();
let activeUploads = 0;

/** One process owns the SQLite database, including all in-flight upload reservations. */
export function reserveUpload(user) {
  const ownerId = user?.id ?? null;
  const key = ownerId ?? 'guests';
  const pool = pools.get(key) || { bytes: 0, count: 0 };
  if (activeUploads >= 16 || pool.count >= 4) {
    throw new HttpError(429, 'Too many uploads in progress. Please try again shortly.', 'rate_limited');
  }
  pools.set(key, pool);
  pool.count++;
  activeUploads++;
  let bytes = 0;
  let released = false;
  const controller = new AbortController();

  return {
    controller,
    files: new Set(),
    writes: new Set(),
    releases: new Set(),
    add(size) {
      controller.signal.throwIfAborted();
      // Read current settings/account state: an administrator can change a quota mid-upload.
      const account = ownerId === null ? null : db.prepare('SELECT quota_mb, disabled FROM users WHERE id = ?').get(ownerId);
      if (ownerId !== null && (!account || account.disabled)) {
        throw new HttpError(403, 'This account is no longer active.', 'disabled');
      }
      const quotaMB = ownerId === null ? settings.get('guestStorageMB') : account.quota_mb ?? settings.get('defaultUserQuotaMB');
      const used = db.prepare(`SELECT COALESCE(SUM(f.size), 0) AS n FROM files f
                               JOIN shares s ON s.id = f.share_id WHERE s.owner_id IS ?`).get(ownerId).n;
      if (quotaMB > 0 && used + pool.bytes + size > quotaMB * MB) {
        throw new HttpError(413, ownerId === null
          ? 'Guest uploads are full right now. Please try again later.'
          : 'This upload would exceed your storage quota.', ownerId === null ? 'guest_quota' : 'quota');
      }
      // Reserve before handing the chunk to the disk stream. No await between check and reserve.
      pool.bytes += size;
      bytes += size;
    },
    release() {
      if (released) return;
      released = true;
      pool.bytes -= bytes;
      pool.count--;
      activeUploads--;
      if (!pool.count) pools.delete(key);
    },
  };
}
