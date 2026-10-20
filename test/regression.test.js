import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { crc32 } from 'node:zlib';
import { cleanName, folderPath } from '../server/filenames.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const MB = 1048576;
const password = 'RegressionPassword123!';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function eventually(check, message = 'condition did not become true') {
  const deadline = Date.now() + 5000;
  do {
    if (await check()) return;
    await delay(15);
  } while (Date.now() < deadline);
  assert.fail(message);
}

async function instance(t, { dataDir, env = {} } = {}) {
  const dir = dataDir || await fs.mkdtemp(path.join(os.tmpdir(), 'sharehost-test-'));
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', 'server/index.js'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: '', SECURE_COOKIES: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', data => { log += data; });
  child.stderr.on('data', data => { log += data; });
  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  }
  t.after(async () => {
    await stop();
    if (!dataDir) await fs.rm(dir, { recursive: true, force: true });
  });
  await eventually(() => {
    assert.equal(child.exitCode, null, log);
    return log.includes('running on');
  }, 'server did not start: ' + log);
  const base = `http://127.0.0.1:${port}`;
  let admin = '';
  async function api(url, { method = 'GET', body, cookie = admin, headers = {} } = {}) {
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { 'x-sharehost': '1', cookie, ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  async function setup() {
    const r = await api('/api/setup', { method: 'POST', body: { username: 'admin1', password, guestUploads: true } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    admin = r.headers.get('set-cookie').split(';')[0];
    return admin;
  }
  async function settings(body) {
    const r = await api('/api/admin/settings', { method: 'PUT', body });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  async function upload({ fields = {}, files = [{ name: 'hello.txt', data: 'hello' }], cookie = admin } = {}) {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, String(value));
    for (const file of files) body.append('files', new Blob([file.data]), file.name);
    return api('/api/shares', { method: 'POST', body, cookie });
  }
  async function diskBytes() {
    let bytes = 0;
    for (const name of await fs.readdir(path.join(dir, 'uploads'))) {
      bytes += (await fs.stat(path.join(dir, 'uploads', name)).catch(() => ({ size: 0 }))).size;
    }
    return bytes;
  }
  return { base, dir, child, stop, api, setup, settings, upload, diskBytes, get admin() { return admin; }, get log() { return log; } };
}

function chunkedUpload(app, cookie = '') {
  let req;
  const response = new Promise((resolve, reject) => {
    req = http.request(app.base + '/api/shares', {
      method: 'POST', headers: { cookie, 'x-sharehost': '1', 'content-type': 'multipart/form-data; boundary=regression' },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', part => { text += part; });
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text) }));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
  // Aborting clients is an intentional part of these tests.
  response.catch(() => {});
  req.write('--regression\r\nContent-Disposition: form-data; name="files"; filename="chunked.txt"\r\nContent-Type: text/plain\r\n\r\n');
  return {
    req, response,
    finish() { req.end('\r\n--regression--\r\n'); return response; },
  };
}

async function pausedDownload(app, shareId) {
  const res = await new Promise((resolve, reject) => {
    const req = http.get(app.base + '/z/' + shareId, r => { r.pause(); resolve(r); });
    req.on('error', reject);
  });
  assert.equal(res.statusCode, 200);
  // Keep aborted downloads from emitting an unhandled error in the test client.
  res.on('error', () => {});
  return res;
}

async function readDownload(res) {
  const chunks = [];
  const result = new Promise((resolve, reject) => {
    res.on('data', data => chunks.push(data));
    res.on('error', reject);
    res.on('end', () => resolve(Buffer.concat(chunks)));
  });
  res.resume();
  const bytes = await result;
  assert.equal(bytes.length, Number(res.headers['content-length']));
  return bytes;
}

function inspectZip(bytes) {
  const entries = [];
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength;
    const data = bytes.subarray(start, start + size);
    assert.equal(crc32(data), bytes.readUInt32LE(offset + 14), 'ZIP entry CRC');
    entries.push({ name: bytes.subarray(offset + 30, start).toString(), data });
    offset = start + size;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50, 'central directory exists');
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50, 'archive end exists');
  assert.equal(bytes.readUInt16LE(bytes.length - 12), entries.length);
  return entries;
}

async function createUser(app, username, { role = 'user', quotaMB } = {}) {
  const r = await app.api('/api/admin/users', { method: 'POST', body: { username, password, role, quotaMB } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const login = await app.api('/api/auth/login', { method: 'POST', body: { username, password }, cookie: '' });
  assert.equal(login.status, 200);
  return { id: r.data.user.id, cookie: login.headers.get('set-cookie').split(';')[0] };
}

function activeAdmins(app) {
  const db = new DatabaseSync(path.join(app.dir, 'sharehost.db'), { readOnly: true });
  try { return db.prepare("SELECT id, username FROM users WHERE role = 'admin' AND disabled = 0").all(); }
  finally { db.close(); }
}

test('chunked uploads cannot write beyond the guest quota', async t => {
  const app = await instance(t);
  await app.setup();
  await app.settings({ guestStorageMB: 1, guestMaxFileSizeMB: 10 });
  const upload = chunkedUpload(app);
  t.after(() => upload.req.destroy());
  upload.req.write(Buffer.alloc(MB / 2));
  await eventually(async () => (await app.diskBytes()) === MB / 2);
  // Inspect disk usage while the request is still open, rather than just after rejection.
  for (let i = 0; i < 40; i++) {
    upload.req.write(Buffer.alloc(65536));
    await delay(3);
    assert.ok(await app.diskBytes() <= MB, 'live disk usage exceeded quota');
  }
  const response = await upload.finish();
  assert.equal(response.status, 413);
  assert.equal(response.data.code, 'guest_quota');
  await eventually(async () => (await app.diskBytes()) === 0);
  assert.equal((await app.upload({ cookie: '', files: [{ name: 'retry.txt', data: Buffer.alloc(MB) }] })).status, 201);
});

test('parallel uploads share reservations; abort releases bytes and upload slots', async t => {
  const app = await instance(t);
  await app.setup();
  await app.settings({ guestStorageMB: 1 });
  const first = chunkedUpload(app);
  const second = chunkedUpload(app);
  t.after(() => { first.req.destroy(); second.req.destroy(); });
  first.req.write(Buffer.alloc(640 * 1024));
  await eventually(async () => (await app.diskBytes()) === 640 * 1024);
  second.req.write(Buffer.alloc(640 * 1024));
  const rejected = await second.finish();
  assert.equal(rejected.status, 413);
  assert.equal(rejected.data.code, 'guest_quota');
  assert.equal((await first.finish()).status, 201);
  const aborted = chunkedUpload(app);
  t.after(() => aborted.req.destroy());
  aborted.req.write(Buffer.alloc(256 * 1024));
  await eventually(async () => (await app.diskBytes()) === 896 * 1024);
  aborted.req.destroy();
  await eventually(async () => (await app.diskBytes()) === 640 * 1024);
  const retry = await app.upload({ cookie: '', files: [{ name: 'after-abort.txt', data: Buffer.alloc(384 * 1024) }] });
  assert.equal(retry.status, 201, JSON.stringify(retry.data));
});

test('simultaneous upload slots are bounded and released on disconnect', async t => {
  const app = await instance(t);
  await app.setup();
  const held = Array.from({ length: 4 }, () => chunkedUpload(app));
  t.after(() => held.forEach(upload => upload.req.destroy()));
  held.forEach(upload => upload.req.write(Buffer.alloc(1024)));
  await eventually(async () => (await app.diskBytes()) === 4096);
  assert.equal((await app.upload({ cookie: '' })).status, 429);
  held.forEach(upload => upload.req.destroy());
  await eventually(async () => (await app.diskBytes()) === 0);
  await eventually(async () => (await app.upload({ cookie: '' })).status === 201);
});

test('user quotas are enforced during streaming and isolated between accounts', async t => {
  const app = await instance(t);
  await app.setup();
  const alice = await createUser(app, 'alice', { quotaMB: 1 });
  const bob = await createUser(app, 'bob', { quotaMB: 1 });
  const held = chunkedUpload(app, alice.cookie);
  t.after(() => held.req.destroy());
  held.req.write(Buffer.alloc(768 * 1024));
  await eventually(async () => (await app.diskBytes()) === 768 * 1024);
  assert.equal((await app.upload({ cookie: bob.cookie, files: [{ name: 'bob.txt', data: Buffer.alloc(MB) }] })).status, 201);
  const competing = chunkedUpload(app, alice.cookie);
  t.after(() => competing.req.destroy());
  competing.req.write(Buffer.alloc(512 * 1024));
  const rejected = await competing.finish();
  assert.equal(rejected.status, 413);
  assert.equal(rejected.data.code, 'quota');
  assert.equal((await held.finish()).status, 201);
});

test('cleanup preserves a running limited ZIP, then removes its backing files', async t => {
  const app = await instance(t);
  await app.setup();
  const share = await app.upload({ fields: { maxDownloads: 1 }, files: [
    { name: 'large.txt', data: Buffer.alloc(16 * MB, 65) }, { name: 'ä.txt', data: 'archive tail' },
  ] });
  assert.equal(share.status, 201);
  const res = await pausedDownload(app, share.data.id);
  t.after(() => res.destroy());
  const cleanup = await app.api('/api/admin/maintenance/cleanup', { method: 'POST' });
  assert.equal(cleanup.status, 200);
  assert.equal(cleanup.data.removedShares, 1);
  assert.equal((await fs.readdir(path.join(app.dir, 'uploads'))).length, 2);
  assert.equal((await app.api('/api/s/' + share.data.id, { cookie: '' })).status, 404);
  const entries = inspectZip(await readDownload(res));
  assert.deepEqual(entries.map(e => e.name), ['large.txt', 'ä.txt']);
  assert.equal(entries[1].data.toString(), 'archive tail');
  await eventually(async () => (await app.diskBytes()) === 0);
});

test('aborting a ZIP releases deferred deletions', async t => {
  const app = await instance(t);
  await app.setup();
  const share = await app.upload({ fields: { maxDownloads: 1 }, files: [
    { name: 'large.txt', data: Buffer.alloc(16 * MB) }, { name: 'tail.txt', data: 'tail' },
  ] });
  const res = await pausedDownload(app, share.data.id);
  t.after(() => res.destroy());
  await app.api('/api/admin/maintenance/cleanup', { method: 'POST' });
  res.destroy();
  await eventually(async () => (await fs.readdir(path.join(app.dir, 'uploads'))).length === 0);
});

test('deleting an uploader preserves their running ZIP and removes their account atomically', async t => {
  const app = await instance(t);
  await app.setup();
  const user = await createUser(app, 'uploader');
  const share = await app.upload({ cookie: user.cookie, files: [
    { name: 'large.txt', data: Buffer.alloc(16 * MB) }, { name: 'tail.txt', data: 'tail' },
  ] });
  const res = await pausedDownload(app, share.data.id);
  t.after(() => res.destroy());
  assert.equal((await app.api('/api/admin/users/' + user.id, { method: 'DELETE' })).status, 200);
  assert.equal((await app.api('/api/account', { cookie: user.cookie })).status, 401);
  assert.equal(inspectZip(await readDownload(res)).length, 2);
  await eventually(async () => (await app.diskBytes()) === 0);
});

for (const action of ['demote', 'disable']) {
  test(`concurrent admin ${action} with password hashing retains an active administrator`, async t => {
    const app = await instance(t);
    const first = await app.setup();
    const second = await createUser(app, 'admin2', { role: 'admin' });
    const body = action === 'demote' ? { role: 'user', password: password + 'new' } : { disabled: true, password: password + 'new' };
    const results = await Promise.all([
      app.api('/api/admin/users/1', { method: 'PATCH', body, cookie: first }),
      app.api('/api/admin/users/' + second.id, { method: 'PATCH', body, cookie: second.cookie }),
    ]);
    assert.equal(results.filter(r => r.status === 200).length, 1, JSON.stringify(results));
    assert.ok(results.some(r => [400, 403].includes(r.status)));
    assert.equal(activeAdmins(app).length, 1);
  });
}

test('crossed administrator deletions cannot remove all administrators', async t => {
  const app = await instance(t);
  const first = await app.setup();
  const second = await createUser(app, 'admin2', { role: 'admin' });
  const results = await Promise.all([
    app.api('/api/admin/users/' + second.id, { method: 'DELETE', cookie: first }),
    app.api('/api/admin/users/1', { method: 'DELETE', cookie: second.cookie }),
  ]);
  assert.equal(results.filter(r => r.status === 200).length, 1);
  const remaining = activeAdmins(app);
  assert.equal(remaining.length, 1);
  const cookie = remaining[0].id === 1 ? first : second.cookie;
  assert.equal((await app.api('/api/admin/users/' + remaining[0].id, { method: 'PATCH', body: { disabled: true }, cookie })).status, 400);
});

test('an invitation stays consumed after its user is deleted', async t => {
  const app = await instance(t);
  await app.setup();
  await app.settings({ registrationMode: 'invite' });
  const invitation = await app.api('/api/admin/invites', { method: 'POST', body: { count: 1 } });
  const code = invitation.data.codes[0];
  const registered = await app.api('/api/auth/register', { method: 'POST', cookie: '', body: { username: 'invited', password, inviteCode: code } });
  assert.equal(registered.status, 201);
  const users = await app.api('/api/admin/users');
  const id = users.data.users.find(u => u.username === 'invited').id;
  assert.equal((await app.api('/api/admin/users/' + id, { method: 'DELETE' })).status, 200);
  const reused = await app.api('/api/auth/register', { method: 'POST', cookie: '', body: { username: 'again', password, inviteCode: code } });
  assert.equal(reused.status, 400);
  assert.equal(reused.data.code, 'invalid_invite');
  const invitations = await app.api('/api/admin/invites');
  assert.equal(invitations.data.invites[0].used, true);
  assert.equal(invitations.data.invites[0].usedBy, null);
  assert.ok(invitations.data.invites[0].usedAt > 0);
});

test('effective expiry defaults obey maxima, including unlimited and guest settings', async t => {
  const app = await instance(t);
  await app.setup();
  await app.settings({ defaultExpiryHours: 168, maxExpiryHours: 1, guestMaxExpiryHours: 6 });
  assert.equal((await app.api('/api/config')).data.upload.defaultExpiryHours, 1);
  assert.equal((await app.api('/api/config', { cookie: '' })).data.upload.defaultExpiryHours, 6);
  const start = Date.now();
  const share = await app.upload();
  assert.equal(share.status, 201);
  assert.ok(share.data.expiresAt >= start + 3600000 && share.data.expiresAt <= Date.now() + 3600000);
  await app.settings({ maxExpiryHours: 0 });
  assert.equal((await app.api('/api/config')).data.upload.defaultExpiryHours, 168);
  assert.equal((await app.upload({ fields: { expiresInHours: 0 } })).status, 400);
  await app.settings({ allowNeverExpire: true });
  const permanent = await app.upload({ fields: { expiresInHours: 0 } });
  assert.equal(permanent.status, 201);
  assert.equal(permanent.data.expiresAt, null);
});

test('folder archives use portable relative paths and blocked extensions remain blocked', async t => {
  assert.equal(folderPath('C:/../CON/test.txt', cleanName('test.txt')), 'C_/_CON/test.txt');
  assert.equal(cleanName('evil.exe. '), 'evil.exe');
  assert.equal(cleanName('NUL.txt'), '_NUL.txt');
  assert.ok(Buffer.byteLength(cleanName('ä'.repeat(255))) <= 255);
  const app = await instance(t);
  await app.setup();
  assert.equal((await app.upload({ files: [{ name: 'evil.exe. ', data: 'blocked' }] })).status, 415);
  const share = await app.upload({ fields: { paths: JSON.stringify(['C:/../CON/test.txt', '/folder/ä.txt']) }, files: [
    { name: 'test.txt', data: 'first' }, { name: 'ä.txt', data: 'second' },
  ] });
  assert.equal(share.status, 201);
  const response = await fetch(app.base + '/z/' + share.data.id);
  const names = inspectZip(Buffer.from(await response.arrayBuffer())).map(e => e.name);
  assert.deepEqual(names, ['C_/_CON/test.txt', 'folder/ä.txt']);
});

test('share passwords, HEAD requests, limits and CSRF protection still work', async t => {
  const app = await instance(t);
  await app.setup();
  assert.equal((await app.api('/api/admin/users', { cookie: '' })).status, 401);
  assert.equal((await app.api('/api/auth/logout', { method: 'POST', headers: { 'x-sharehost': '0' } })).status, 403);
  const share = await app.upload({ fields: { password: 'share-secret', maxDownloads: 1 } });
  const id = share.data.id;
  const locked = await app.api('/api/s/' + id, { cookie: '' });
  assert.equal(locked.data.unlocked, false);
  assert.equal(locked.data.files, undefined);
  assert.equal((await app.api(`/api/s/${id}/unlock`, { method: 'POST', cookie: '', body: { password: 'wrong' } })).status, 401);
  const unlocked = await app.api(`/api/s/${id}/unlock`, { method: 'POST', cookie: '', body: { password: 'share-secret' } });
  const cookie = unlocked.headers.get('set-cookie').split(';')[0];
  const metadata = await app.api('/api/s/' + id, { cookie });
  const url = `/d/${id}/${metadata.data.files[0].id}`;
  assert.equal((await app.api(url, { method: 'HEAD', cookie })).status, 200);
  assert.equal((await app.api('/api/s/' + id, { cookie })).data.downloadCount, 0);
  assert.equal((await app.api(url, { cookie })).data, 'hello');
  assert.equal((await app.api(url, { cookie })).status, 303);
});

test('a stopped-data-directory backup restores accounts, settings, passwords and file bytes', async t => {
  const app = await instance(t);
  await app.setup();
  await app.settings({ siteName: 'Restore test' });
  const share = await app.upload({ fields: { password: 'restore-secret' } });
  const id = share.data.id;
  await app.stop();
  const backupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sharehost-restore-'));
  let restored;
  t.after(async () => {
    await restored?.stop();
    await fs.rm(backupDir, { recursive: true, force: true });
  });
  await fs.cp(app.dir, backupDir, { recursive: true });
  restored = await instance(t, { dataDir: backupDir });
  assert.equal((await restored.api('/api/config')).data.settings.siteName, 'Restore test');
  const login = await restored.api('/api/auth/login', { method: 'POST', cookie: '', body: { username: 'admin1', password } });
  assert.equal(login.status, 200);
  const unlocked = await restored.api(`/api/s/${id}/unlock`, { method: 'POST', cookie: '', body: { password: 'restore-secret' } });
  assert.equal(unlocked.status, 200);
  const cookie = unlocked.headers.get('set-cookie').split(';')[0];
  const meta = await restored.api('/api/s/' + id, { cookie });
  assert.equal((await restored.api(`/d/${id}/${meta.data.files[0].id}`, { cookie })).data, 'hello');
});

test('trusted reverse proxy enables Secure cookies and does not change CSRF checks', async t => {
  const app = await instance(t, { env: { TRUST_PROXY: '1' } });
  const setup = await app.api('/api/setup', { method: 'POST', headers: { 'x-forwarded-proto': 'https' }, body: { username: 'admin1', password } });
  assert.equal(setup.status, 201);
  assert.match(setup.headers.get('set-cookie'), /; Secure;/);
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  assert.equal((await app.api('/api/account', { cookie })).status, 200);
  assert.equal((await app.api('/api/auth/logout', { method: 'POST', cookie, headers: { 'x-sharehost': '0', 'x-forwarded-proto': 'https' } })).status, 403);
});

test('cleanup keeps completed files from a multipart upload that is still in progress', async t => {
  const app = await instance(t);
  await app.setup();
  const upload = chunkedUpload(app);
  t.after(() => upload.req.destroy());
  upload.req.write(Buffer.alloc(4096));
  upload.req.write('\r\n--regression\r\nContent-Disposition: form-data; name="title"\r\n\r\nslow upload');
  await eventually(async () => (await app.diskBytes()) === 4096);
  const names = await fs.readdir(path.join(app.dir, 'uploads'));
  const old = new Date(Date.now() - 2 * 3600000);
  await fs.utimes(path.join(app.dir, 'uploads', names[0]), old, old);
  const cleanup = await app.api('/api/admin/maintenance/cleanup', { method: 'POST' });
  assert.equal(cleanup.data.orphans, 0);
  assert.equal(await app.diskBytes(), 4096);
  assert.equal((await upload.finish()).status, 201);
});

test('deletion waits for every active ZIP reader, including a disconnected last reader', async t => {
  const app = await instance(t);
  await app.setup();
  const share = await app.upload({ files: [
    { name: 'large.txt', data: Buffer.alloc(16 * MB) }, { name: 'tail.txt', data: 'tail' },
  ] });
  const first = await pausedDownload(app, share.data.id);
  const second = await pausedDownload(app, share.data.id);
  t.after(() => { first.destroy(); second.destroy(); });
  assert.equal((await app.api('/api/shares/' + share.data.id, { method: 'DELETE' })).status, 200);
  assert.equal(inspectZip(await readDownload(first)).length, 2);
  assert.equal((await fs.readdir(path.join(app.dir, 'uploads'))).length, 2);
  second.destroy();
  await eventually(async () => (await fs.readdir(path.join(app.dir, 'uploads'))).length === 0);
});

test('validation failures and file-size errors release upload reservations', async t => {
  const app = await instance(t);
  await app.setup();
  await app.settings({ guestStorageMB: 1, guestMaxFileSizeMB: 1 });
  for (let i = 0; i < 5; i++) {
    const invalid = await app.upload({ cookie: '', fields: { expiresInHours: 999999 }, files: [{ name: 'invalid.txt', data: Buffer.alloc(128 * 1024) }] });
    assert.equal(invalid.status, 400);
    assert.equal(await app.diskBytes(), 0);
  }
  assert.equal((await app.upload({ files: [{ name: 'blocked.exe', data: 'blocked' }] })).status, 415);
  // Unlimited guest quota lets the per-file limit, rather than the quota, reject this request.
  await app.settings({ guestStorageMB: 0 });
  const large = await app.upload({ cookie: '', files: [{ name: 'too-large.txt', data: Buffer.alloc(2 * MB) }] });
  assert.equal(large.status, 413);
  assert.equal(large.data.code, 'limit_file_size');
  assert.equal(await app.diskBytes(), 0);
  await app.settings({ guestStorageMB: 1 });
  assert.equal((await app.upload({ cookie: '', files: [{ name: 'retry.txt', data: Buffer.alloc(MB) }] })).status, 201);
});
