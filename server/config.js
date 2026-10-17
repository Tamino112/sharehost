import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));

export const config = {
  root,
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  // Set to the number of reverse proxies in front of ShareHost (e.g. 1 for nginx/Caddy/Traefik).
  trustProxy: process.env.TRUST_PROXY ? (Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY) : false,
  // Force the "Secure" flag on cookies. Defaults to auto-detect via req.secure.
  secureCookies: process.env.SECURE_COOKIES === 'true',
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),
  brandingDir: path.join(dataDir, 'branding'),
  dbFile: path.join(dataDir, 'sharehost.db'),
  publicDir: path.join(root, 'public'),
  version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
};

for (const dir of [config.dataDir, config.uploadDir, config.brandingDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
