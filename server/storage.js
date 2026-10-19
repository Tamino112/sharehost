import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { db, now } from './db.js';
import { config } from './config.js';

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', heic: 'image/heic',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo', m4v: 'video/mp4',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/opus',
  pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  gz: 'application/gzip', tar: 'application/x-tar', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

// Only these types are ever served inline (for previews). Everything else is forced to download,
// so an uploaded HTML/SVG file can never execute in the context of this site.
const INLINE_SAFE = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/aac', 'audio/opus',
]);

export const extOf = name => (path.extname(name || '').slice(1) || '').toLowerCase();
export const mimeFor = name => MIME[extOf(name)] || 'application/octet-stream';
export const isInlineSafe = mime => INLINE_SAFE.has(mime);
export const filePath = storageName => path.join(config.uploadDir, path.basename(storageName));

export async function removeFiles(storageNames) {
  await Promise.all(storageNames.map(n => fsp.rm(filePath(n), { force: true })));
}

/** Deletes shares (rows + files on disk). */
export async function deleteShares(shareIds) {
  if (!shareIds.length) return 0;
  const names = [];
  const getFiles = db.prepare('SELECT storage_name FROM files WHERE share_id = ?');
  const del = db.prepare('DELETE FROM shares WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const id of shareIds) {
      for (const f of getFiles.all(id)) names.push(f.storage_name);
      del.run(id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  await removeFiles(names);
  return shareIds.length;
}

/** Removes expired / exhausted shares, stale sessions, and orphaned upload files. */
export async function cleanup() {
  const t = now();
  const expired = db.prepare(`
    SELECT id FROM shares
    WHERE (expires_at IS NOT NULL AND expires_at < ?)
       OR (max_downloads IS NOT NULL AND download_count >= max_downloads)
  `).all(t).map(r => r.id);
  const removed = await deleteShares(expired);

  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);

  // Files on disk with no DB row (e.g. an upload that crashed mid-way) are swept after an hour.
  const known = new Set(db.prepare('SELECT storage_name FROM files').all().map(r => r.storage_name));
  let orphans = 0;
  for (const name of await fsp.readdir(config.uploadDir)) {
    if (known.has(name)) continue;
    const full = path.join(config.uploadDir, name);
    const stat = await fsp.stat(full).catch(() => null);
    if (stat && t - stat.mtimeMs > 3600000) {
      await fsp.rm(full, { force: true, recursive: true });
      orphans++;
    }
  }
  return { removedShares: removed, orphans };
}

export async function diskInfo() {
  try {
    const s = await fsp.statfs(config.dataDir);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Streaming ZIP (stored, no compression). CRC-32 is computed at upload time, so the
// archive can be streamed with an exact Content-Length and no temp files.

const ZIP_LIMIT = 0xffffffff - 1024 * 1024;

function dosDateTime(ms) {
  const d = new Date(ms);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function uniqueNames(files) {
  const used = new Set();
  return files.map(f => {
    const base = f.name.replace(/\\/g, '_'); // keep "/" so folder uploads unpack into folders
    const ext = path.posix.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem} (${n})${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

export function zipPlan(files) {
  const names = uniqueNames(files).map(n => Buffer.from(n, 'utf8'));
  let offset = 0;
  const entries = files.map((f, i) => {
    const entry = { file: f, name: names[i], offset, ...dosDateTime(f.created_at) };
    offset += 30 + names[i].length + f.size;
    return entry;
  });
  const cdSize = entries.reduce((sum, e) => sum + 46 + e.name.length, 0);
  const total = offset + cdSize + 22;
  return { entries, cdOffset: offset, cdSize, total, supported: total < ZIP_LIMIT && files.length < 0xffff };
}

export async function streamZip(plan, res) {
  for (const e of plan.entries) {
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8 file names
    h.writeUInt16LE(0, 8);      // stored
    h.writeUInt16LE(e.time, 10);
    h.writeUInt16LE(e.date, 12);
    h.writeUInt32LE(e.file.crc32 >>> 0, 14);
    h.writeUInt32LE(e.file.size, 18);
    h.writeUInt32LE(e.file.size, 22);
    h.writeUInt16LE(e.name.length, 26);
    h.writeUInt16LE(0, 28);
    if (!res.write(Buffer.concat([h, e.name]))) await new Promise(r => res.once('drain', r));
    await pipeline(fs.createReadStream(filePath(e.file.storage_name)), res, { end: false });
  }
  const parts = [];
  for (const e of plan.entries) {
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(e.time, 12);
    c.writeUInt16LE(e.date, 14);
    c.writeUInt32LE(e.file.crc32 >>> 0, 16);
    c.writeUInt32LE(e.file.size, 20);
    c.writeUInt32LE(e.file.size, 24);
    c.writeUInt16LE(e.name.length, 28);
    // extra len, comment len, disk start, internal attrs, external attrs stay 0
    c.writeUInt32LE(e.offset, 42);
    parts.push(c, e.name);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(plan.entries.length, 8);
  end.writeUInt16LE(plan.entries.length, 10);
  end.writeUInt32LE(plan.cdSize, 12);
  end.writeUInt32LE(plan.cdOffset, 16);
  parts.push(end);
  res.end(Buffer.concat(parts));
}
