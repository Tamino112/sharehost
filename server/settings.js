import crypto from 'node:crypto';
import { db } from './db.js';

/**
 * Every instance setting lives here. The admin panel renders its forms from this schema,
 * so adding a setting is a one-line change (plus a label in public/assets/js/i18n.js).
 */
export const SCHEMA = {
  // General
  siteName:        { group: 'general', type: 'string', default: 'ShareHost', max: 60, public: true },
  tagline:         { group: 'general', type: 'string', default: 'Share files. On your own terms.', max: 120, public: true },
  description:     { group: 'general', type: 'text', default: 'A private file sharing space on your own server. No tracking, no ads, no limits you did not set yourself.', max: 500, public: true },
  defaultLanguage: { group: 'general', type: 'enum', values: ['en', 'de'], default: 'en', public: true },
  publicUrl:       { group: 'general', type: 'string', default: '', max: 200, placeholder: 'https://share.example.com', public: true },
  // Off: the start page shows only the upload box. On: headline, description and feature cards too.
  showIntro:       { group: 'general', type: 'bool', default: false, public: true },

  // Uploads
  maxFileSizeMB:      { group: 'uploads', type: 'int', min: 1, max: 1048576, default: 2048, unit: 'MB' },
  maxFilesPerShare:   { group: 'uploads', type: 'int', min: 1, max: 1000, default: 50 },
  defaultExpiryHours: { group: 'uploads', type: 'int', min: 1, max: 87600, default: 168, unit: 'h' },
  maxExpiryHours:     { group: 'uploads', type: 'int', min: 0, max: 87600, default: 720, unit: 'h' },
  allowNeverExpire:   { group: 'uploads', type: 'bool', default: false },
  allowPasswordShares:{ group: 'uploads', type: 'bool', default: true },
  allowedExtensions:  { group: 'uploads', type: 'string', default: '', max: 1000, placeholder: 'pdf, zip, png' },
  blockedExtensions:  { group: 'uploads', type: 'string', default: 'exe, bat, cmd, com, scr, msi, vbs, ps1', max: 1000 },
  requireLoginToDownload: { group: 'uploads', type: 'bool', default: false },

  // Guests
  guestUploads:        { group: 'guests', type: 'bool', default: false },
  guestMaxFileSizeMB:  { group: 'guests', type: 'int', min: 1, max: 1048576, default: 100, unit: 'MB' },
  guestMaxExpiryHours: { group: 'guests', type: 'int', min: 1, max: 87600, default: 24, unit: 'h' },
  guestMaxFiles:       { group: 'guests', type: 'int', min: 1, max: 1000, default: 10 },

  // Accounts & security
  registrationMode:    { group: 'access', type: 'enum', values: ['closed', 'invite', 'open'], default: 'closed' },
  defaultUserQuotaMB:  { group: 'access', type: 'int', min: 0, max: 104857600, default: 10240, unit: 'MB' },
  minPasswordLength:   { group: 'access', type: 'int', min: 6, max: 128, default: 8 },
  sessionLifetimeDays: { group: 'access', type: 'int', min: 1, max: 365, default: 30, unit: 'd' },
  loginRateLimit:      { group: 'access', type: 'int', min: 3, max: 1000, default: 10 },

  // Appearance
  theme:            { group: 'appearance', type: 'enum', values: ['dark', 'light', 'system'], default: 'dark', public: true },
  accentColor:      { group: 'appearance', type: 'color', default: '#ecebe6', public: true },
  backgroundMode:   { group: 'appearance', type: 'enum', values: ['aurora', 'image', 'video'], default: 'aurora', public: true },
  backgroundImage:  { group: 'appearance', type: 'media', accept: 'image', default: '', public: true },
  backgroundVideo:  { group: 'appearance', type: 'media', accept: 'video', default: '', public: true },
  backgroundPoster: { group: 'appearance', type: 'media', accept: 'image', default: '', public: true },
  logo:             { group: 'appearance', type: 'media', accept: 'image', default: '', public: true },
  backgroundDim:    { group: 'appearance', type: 'int', min: 0, max: 90, default: 35, unit: '%', slider: true, public: true },
  glassBlur:        { group: 'appearance', type: 'int', min: 0, max: 60, default: 22, unit: 'px', slider: true, public: true },
  glassOpacity:     { group: 'appearance', type: 'int', min: 0, max: 60, default: 9, unit: '%', slider: true, public: true },
  animations:       { group: 'appearance', type: 'bool', default: true, public: true },
  cursorGlow:       { group: 'appearance', type: 'bool', default: true, public: true },

  // Legal
  imprintUrl: { group: 'legal', type: 'string', default: '', max: 300, placeholder: 'https://example.com/imprint', public: true },
  privacyUrl: { group: 'legal', type: 'string', default: '', max: 300, placeholder: 'https://example.com/privacy', public: true },
  footerText: { group: 'legal', type: 'string', default: '', max: 200, public: true },
  uploadNotice: { group: 'legal', type: 'text', default: '', max: 500, public: true },
};

const cache = new Map();

function load() {
  cache.clear();
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    try { cache.set(row.key, JSON.parse(row.value)); } catch { /* ignore corrupt values */ }
  }
}
load();

export function get(key) {
  if (cache.has(key)) return cache.get(key);
  return SCHEMA[key]?.default;
}

export function all() {
  const out = {};
  for (const key of Object.keys(SCHEMA)) out[key] = get(key);
  return out;
}

export function publicSettings() {
  const out = {};
  for (const [key, def] of Object.entries(SCHEMA)) if (def.public) out[key] = get(key);
  return out;
}

const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

/** Internal (non-schema) values such as the instance secret. */
export function setRaw(key, value) {
  upsert.run(key, JSON.stringify(value));
  cache.set(key, value);
}

export function validate(key, value) {
  const def = SCHEMA[key];
  if (!def) throw new Error(`Unknown setting: ${key}`);
  switch (def.type) {
    case 'bool':
      if (typeof value !== 'boolean') throw new Error(`${key} must be true or false`);
      return value;
    case 'int': {
      const n = Number(value);
      if (!Number.isInteger(n) || n < def.min || n > def.max) throw new Error(`${key} must be a whole number between ${def.min} and ${def.max}`);
      return n;
    }
    case 'enum':
      if (!def.values.includes(value)) throw new Error(`${key} must be one of ${def.values.join(', ')}`);
      return value;
    case 'color':
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${key} must be a hex color like #aabbcc`);
      return value.toLowerCase();
    case 'string':
    case 'text': {
      if (typeof value !== 'string') throw new Error(`${key} must be text`);
      const v = value.trim();
      if (v.length > def.max) throw new Error(`${key} is too long (max ${def.max} characters)`);
      if (/Url$/.test(key) && v && !/^https?:\/\//i.test(v)) throw new Error(`${key} must start with http:// or https://`);
      return v;
    }
    case 'media':
      // Media values are only set through the branding upload endpoint.
      throw new Error(`${key} is set by uploading a file`);
    default:
      throw new Error(`Unsupported setting type for ${key}`);
  }
}

export function update(values) {
  const clean = {};
  for (const [key, value] of Object.entries(values)) clean[key] = validate(key, value);
  db.exec('BEGIN');
  try {
    for (const [key, value] of Object.entries(clean)) upsert.run(key, JSON.stringify(value));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  for (const [key, value] of Object.entries(clean)) cache.set(key, value);
  return clean;
}

// A per-instance secret used to sign share-unlock cookies.
if (!get('__secret')) setRaw('__secret', crypto.randomBytes(32).toString('hex'));
export const secret = () => get('__secret');

export function extensionList(key) {
  return String(get(key) || '')
    .split(/[\s,;]+/)
    .map(s => s.replace(/^\./, '').toLowerCase())
    .filter(Boolean);
}
