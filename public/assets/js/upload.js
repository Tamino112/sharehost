import {
  init, t, $, $$, h, esc, icon, formatBytes, formatHours, shareUrl, copyText, toast, splitWords, apiError, api,
} from './core.js';
import { fileIcon } from './icons.js';
import { DICT } from './i18n.js';

const config = await init({ page: 'home' });
const s = config.settings;
const up = config.upload;
const MB = 1048576;

// ---------------------------------------------------------------- hero copy

// Untouched default texts follow the visitor's language; custom texts are shown as written.
const tagline = s.tagline === DICT.en['home.tagline'] ? t('home.tagline') : s.tagline;
const firstStop = tagline.search(/[.!?]\s/);
const dimFrom = firstStop > 0 ? tagline.slice(0, firstStop + 1).split(/\s+/).length : Infinity;
splitWords($('#tagline'), tagline, dimFrom);
$('#description').textContent = s.description === DICT.en['home.description'] ? t('home.description') : s.description;
$('#stat-size').textContent = formatBytes(up.maxFileSizeMB * MB, 0);
$('#stat-expiry').textContent = up.allowNeverExpire || up.maxExpiryHours === 0 ? '∞' : formatHours(up.maxExpiryHours);
if (!s.showFeatures) { $('#features').remove(); $('#marquee').remove(); }
for (const el of $$('[data-icon]')) el.innerHTML = icon(el.dataset.icon);

const marquee = $('.marquee__track', document);
if (marquee) {
  const items = ['feature.chip1', 'feature.chip2', 'feature.chip3', 'feature.chip4', 'feature.chip5', 'feature.chip6', 'feature.chip7'];
  const icons = ['zap', 'lock', 'hourglass', 'archive', 'users', 'palette', 'github'];
  const html = items.map((k, i) => `<span class="chip">${icon(icons[i])}${esc(t(k))}</span>`).join('');
  marquee.innerHTML = html + html;
}

// ---------------------------------------------------------------- views

const views = Object.fromEntries($$('[data-view]').map(v => [v.dataset.view, v]));
function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
}

if (!up.allowed) {
  $('.hero__stats').hidden = true;
  $('#locked-icon').innerHTML = icon('lock');
  if (config.registrationMode === 'open') $('#locked-register').hidden = false;
  show('locked');
}

$('#drop-icon').innerHTML = icon('cloud');
$('#chev').innerHTML = icon('chevronDown');
$('#pw-toggle').innerHTML = icon('eye');
$('#drop-hint').textContent = t('upload.hint', { size: formatBytes(up.maxFileSizeMB * MB, 0), count: up.maxFiles });
if (s.uploadNotice) { $('#upload-notice').textContent = s.uploadNotice; $('#upload-notice').hidden = false; }
if (!up.allowPassword) $('#opt-password-field').remove();

// Expiry choices limited by the instance settings
const expirySelect = $('#opt-expiry');
const presets = [1, 6, 24, 72, 168, 336, 720, 2160, 4320, 8760];
let choices = presets.filter(hrs => up.maxExpiryHours === 0 || hrs <= up.maxExpiryHours);
if (up.maxExpiryHours > 0 && !choices.includes(up.maxExpiryHours)) choices.push(up.maxExpiryHours);
if (!choices.includes(up.defaultExpiryHours)) choices.push(up.defaultExpiryHours);
choices = [...new Set(choices)].sort((a, b) => a - b);
if (up.allowNeverExpire) choices.push(0);
expirySelect.innerHTML = choices.map(hrs => `<option value="${hrs}" ${hrs === up.defaultExpiryHours ? 'selected' : ''}>${esc(formatHours(hrs))}</option>`).join('');

// ---------------------------------------------------------------- file selection

const files = [];
const input = $('#file-input');
const dropzone = $('#dropzone');
const list = $('#file-list');
const uploadBtn = $('#upload-btn');

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

function addFiles(incoming) {
  let rejected = 0;
  for (const file of incoming) {
    if (files.length >= up.maxFiles) { toast(t('upload.tooMany', { count: up.maxFiles }), 'error'); break; }
    const ext = extOf(file.name);
    if (file.size > up.maxFileSizeMB * MB) { toast(t('upload.tooLarge', { name: file.name, size: formatBytes(up.maxFileSizeMB * MB, 0) }), 'error'); continue; }
    if ((up.allowedExtensions.length && !up.allowedExtensions.includes(ext)) || (ext && up.blockedExtensions.includes(ext))) { rejected++; continue; }
    if (files.some(f => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) continue;
    files.push(file);
  }
  if (rejected) toast(t('upload.typeBlocked', { count: rejected }), 'error');
  renderFiles();
}

function renderFiles() {
  const known = new Map($$('.file-row', list).map(r => [r.fileRef, r]));
  list.replaceChildren();
  files.forEach((file, i) => {
    let row = known.get(file);
    if (!row) {
      row = h(`<div class="file-row" style="--i:${Math.min(i, 8)}">
        <div class="file-thumb">${icon(fileIcon(file.type, file.name))}</div>
        <div class="file-meta"><div class="file-name"></div><div class="file-size">${esc(formatBytes(file.size))}</div></div>
        <button class="btn btn--ghost btn--icon btn--sm" aria-label="${esc(t('common.remove'))}">${icon('x')}</button>
      </div>`);
      row.fileRef = file;
      $('.file-name', row).textContent = file.name;
      if (file.type.startsWith('image/') && file.size < 25 * MB) {
        const img = new Image();
        img.alt = '';
        img.onload = () => URL.revokeObjectURL(img.src);
        img.src = URL.createObjectURL(file);
        $('.file-thumb', row).replaceChildren(img);
      }
      $('button', row).addEventListener('click', e => {
        e.stopPropagation();
        row.classList.add('is-leaving');
        row.addEventListener('animationend', () => {
          files.splice(files.indexOf(file), 1);
          renderFiles();
        }, { once: true });
      });
    }
    list.append(row);
  });

  const total = files.reduce((sum, f) => sum + f.size, 0);
  dropzone.classList.toggle('is-compact', files.length > 0);
  $('#options-wrap').hidden = files.length === 0;
  uploadBtn.disabled = files.length === 0;
  uploadBtn.innerHTML = files.length
    ? `${icon('upload')}<span>${esc(t(files.length === 1 ? 'upload.btnOne' : 'upload.btnMany', { count: files.length, size: formatBytes(total) }))}</span>`
    : `<span>${esc(t('upload.btnEmpty'))}</span>`;
  updateSummary();
}

function updateSummary() {
  const parts = [formatHours(Number(expirySelect.value))];
  if ($('#opt-password')?.value) parts.push(t('upload.protected'));
  if ($('#opt-max').value) parts.push(t('upload.nDownloads', { n: $('#opt-max').value }));
  $('#options-summary').textContent = `· ${parts.join(' · ')}`;
}

dropzone.addEventListener('click', () => input.click());
dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });

// Drag & drop anywhere on the page
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e) || !up.allowed) return; dragDepth++; dropzone.classList.add('is-over'); });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropzone.classList.remove('is-over'); });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove('is-over');
  if (up.allowed && !views.pick.hidden) addFiles(e.dataTransfer.files);
});
window.addEventListener('paste', e => {
  const pasted = [...(e.clipboardData?.files || [])];
  if (pasted.length && up.allowed && !views.pick.hidden) addFiles(pasted);
});

$('#options-toggle').addEventListener('click', e => {
  const btn = e.currentTarget;
  const open = btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', String(open));
  $('#options').classList.toggle('is-open', open);
});
for (const el of [expirySelect, $('#opt-max'), $('#opt-password')].filter(Boolean)) el.addEventListener('input', updateSummary);
$('#pw-toggle')?.addEventListener('click', e => {
  const pw = $('#opt-password');
  pw.type = pw.type === 'password' ? 'text' : 'password';
  e.currentTarget.innerHTML = icon(pw.type === 'password' ? 'eye' : 'eyeOff');
});

// ---------------------------------------------------------------- upload

const ring = $('#ring');
const bar = $('.ring__bar', ring);
const CIRC = 2 * Math.PI * 76;
bar.style.strokeDasharray = CIRC;
bar.style.strokeDashoffset = CIRC;
let xhr = null;

function setProgress(p) {
  bar.style.strokeDashoffset = CIRC * (1 - p);
  $('#pct').textContent = Math.floor(p * 100);
}

uploadBtn.addEventListener('click', () => {
  if (!files.length) return;
  const form = new FormData();
  form.append('expiresInHours', expirySelect.value);
  if ($('#opt-max').value) form.append('maxDownloads', $('#opt-max').value);
  if ($('#opt-password')?.value) form.append('password', $('#opt-password').value);
  if ($('#opt-title').value.trim()) form.append('title', $('#opt-title').value.trim());
  if ($('#opt-message').value.trim()) form.append('message', $('#opt-message').value.trim());
  for (const f of files) form.append('files', f, f.name);

  setProgress(0);
  ring.classList.remove('is-done');
  show('progress');
  const started = performance.now();
  const total = files.reduce((sum, f) => sum + f.size, 0);

  xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/shares');
  xhr.setRequestHeader('x-sharehost', '1');
  xhr.responseType = 'json';
  xhr.upload.onprogress = e => {
    if (!e.lengthComputable) return;
    const p = e.loaded / e.total;
    setProgress(p);
    const secs = (performance.now() - started) / 1000;
    const speed = e.loaded / Math.max(secs, 0.001);
    const eta = (e.total - e.loaded) / Math.max(speed, 1);
    $('#progress-meta').textContent = `${formatBytes(Math.min(e.loaded, total))} / ${formatBytes(total)} · ${formatBytes(speed)}/s · ${t('upload.eta', { s: Math.ceil(eta) })}`;
  };
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      setProgress(1);
      ring.classList.add('is-done');
      setTimeout(() => done(xhr.response), 450);
    } else {
      show('pick');
      toast(apiError(xhr.status, xhr.response).message, 'error');
    }
  };
  xhr.onerror = () => { show('pick'); toast(t('err.network'), 'error'); };
  xhr.onabort = () => { show('pick'); toast(t('upload.cancelled')); };
  xhr.send(form);
});

$('#cancel-btn').addEventListener('click', () => xhr?.abort());

let lastShare = null;
function done(result) {
  lastShare = result;
  const url = shareUrl(result.id);
  $('#share-link').value = url;
  $('#open-btn').href = url;
  $('#open-btn').innerHTML = `${icon('external')}<span>${esc(t('common.open'))}</span>`;
  $('#again-btn').innerHTML = `${icon('plus')}<span>${esc(t('upload.again'))}</span>`;
  $('#copy-btn').innerHTML = `${icon('copy')}<span>${esc(t('common.copy'))}</span>`;
  $('#undo-btn').innerHTML = `${icon('trash')}<span>${esc(t('common.delete'))}</span>`;
  $('#undo-btn').hidden = !result.manageToken;
  $('#done-meta').textContent = result.expiresAt
    ? t('upload.doneMeta', { count: result.fileCount, when: new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: 'medium', timeStyle: 'short' }).format(result.expiresAt) })
    : t('upload.doneMetaNever', { count: result.fileCount });
  $('#success-badge').innerHTML = `<svg class="check-draw" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19.5 7"/></svg>`;
  const burst = $('#burst');
  burst.replaceChildren();
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('i');
    p.style.setProperty('--r', `${i * 20 + Math.random() * 10}deg`);
    p.style.setProperty('--dist', `${70 + Math.random() * 60}px`);
    if (i % 3 === 0) p.style.background = 'var(--ink)';
    burst.append(p);
  }
  show('done');
  if (result.manageToken) {
    try {
      const saved = JSON.parse(localStorage.getItem('sh_guest_shares') || '{}');
      saved[result.id] = result.manageToken;
      localStorage.setItem('sh_guest_shares', JSON.stringify(saved));
    } catch { /* storage unavailable */ }
  }
  $('#copy-btn').focus();
}

$('#copy-btn').addEventListener('click', () => copyText($('#share-link').value));
$('#share-link').addEventListener('focus', e => e.target.select());
$('#again-btn').addEventListener('click', () => {
  files.length = 0;
  for (const id of ['#opt-title', '#opt-message', '#opt-max', '#opt-password']) if ($(id)) $(id).value = '';
  renderFiles();
  show('pick');
});
$('#undo-btn').addEventListener('click', async () => {
  try {
    await api(`/api/shares/${lastShare.id}`, { method: 'DELETE', headers: { 'x-manage-token': lastShare.manageToken } });
    toast(t('toast.deleted'));
    $('#again-btn').click();
  } catch (err) {
    toast(err.message, 'error');
  }
});

renderFiles();
