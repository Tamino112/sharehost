import path from 'node:path';

function segment(value, maxBytes) {
  let name = String(value).replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim().replace(/[.\s]+$/, '');
  // Windows device names are special even when followed by a file extension.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  let out = '';
  for (const char of name) {
    if (Buffer.byteLength(out + char, 'utf8') > maxBytes) break;
    out += char;
  }
  return out.replace(/[.\s]+$/, '');
}

export function cleanName(value) {
  return segment(path.posix.basename(String(value || 'file').replace(/\\/g, '/')), 255) || 'file';
}

/** Portable, relative archive paths, including for shares created by older versions. */
export function folderPath(rel, fileName) {
  if (typeof rel !== 'string') return fileName;
  const dirs = rel.replace(/\\/g, '/').split('/').slice(0, -1)
    .map(s => segment(s, 120)).filter(Boolean).slice(0, 24);
  return [...dirs, fileName].join('/');
}
