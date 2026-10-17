import {
  init, t, $, $$, h, esc, icon, api, formatBytes, formatDate, relativeTime, copyText, toast, modal, confirmDialog,
  setLoading, showError, applyI18n,
} from './core.js';
import { fileIcon } from './icons.js';

await init({ page: 'share' });
const id = decodeURIComponent(location.pathname.split('/').pop());
const root = $('#root');

function mount(el) {
  root.replaceChildren(el);
  applyI18n(el);
}

function renderError(err) {
  const map = {
    not_found: ['share.notFoundTitle', 'share.notFoundText', 'inbox'],
    expired: ['share.expiredTitle', 'share.expiredText', 'hourglass'],
    login_required: ['share.loginTitle', 'share.loginText', 'lock'],
  };
  const [title, text, ic] = map[err.code] || ['err.generic', 'share.genericText', 'alert'];
  mount(h(`<div class="auth-card glass glass--xl" data-glow style="text-align:center;align-items:center">
    <div class="lock-icon">${icon(ic)}</div>
    <div class="stack" style="--gap:8px"><h1 class="h2" data-i18n="${title}"></h1><p class="muted" style="margin:0" data-i18n="${text}"></p></div>
    ${err.code === 'login_required'
      ? `<a class="btn btn--primary" href="/login?next=${encodeURIComponent(location.pathname)}" data-i18n="nav.signIn"></a>`
      : '<a class="btn" href="/" data-i18n="share.home"></a>'}
  </div>`));
}

function renderLocked() {
  const card = h(`<form class="auth-card glass glass--xl" data-glow novalidate style="text-align:center">
    <div class="lock-icon">${icon('lock')}</div>
    <div class="stack" style="--gap:8px"><h1 class="h2" data-i18n="share.lockedTitle"></h1><p class="muted" style="margin:0" data-i18n="share.lockedText"></p></div>
    <div class="stack" data-errors style="text-align:left">
      <input class="input" type="password" autocomplete="off" autofocus data-i18n-placeholder="auth.password" aria-label="Password">
    </div>
    <button class="btn btn--primary btn--lg btn--block" type="submit">${icon('unlock')}<span data-i18n="share.unlock"></span></button>
  </form>`);
  card.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button', card);
    setLoading(btn, true);
    try {
      await api(`/api/s/${encodeURIComponent(id)}/unlock`, { method: 'POST', body: { password: $('input', card).value } });
      $('.lock-icon', card).innerHTML = icon('unlock');
      $('.lock-icon', card).style.cssText = 'background:var(--accent);color:var(--accent-ink);transition:all .4s';
      setTimeout(load, 420);
    } catch (err) {
      showError($('[data-errors]', card), err.message);
      setLoading(btn, false);
    }
  });
  mount(card);
}

function renderShare(share) {
  const fileUrl = (f, preview) => `/d/${encodeURIComponent(share.id)}/${encodeURIComponent(f.id)}${preview ? '?preview=1' : ''}`;
  const left = share.maxDownloads ? share.maxDownloads - share.downloadCount : null;
  const heading = share.title || (share.files.length === 1 ? share.files[0].name : t('share.nFiles', { n: share.files.length }));

  const card = h(`<div class="share-card glass glass--xl" data-glow>
    <div class="share-card__head">
      <span class="eyebrow">${share.owner ? esc(t('share.sharedBy', { name: share.owner })) : esc(t('share.sharedWithYou'))}</span>
      <h1 class="h1" style="overflow-wrap:anywhere"></h1>
      ${share.message ? '<p class="lead" style="white-space:pre-wrap;overflow-wrap:anywhere" data-msg></p>' : ''}
      <div class="row" style="--gap:6px">
        <span class="chip">${icon('file')}${esc(t('share.nFiles', { n: share.files.length }))} · ${esc(formatBytes(share.totalSize))}</span>
        <span class="chip ${share.expiresAt && share.expiresAt - Date.now() < 86400000 ? 'chip--warn' : ''}" title="${esc(formatDate(share.expiresAt))}">${icon('clock')}${share.expiresAt ? esc(t('share.expires', { when: relativeTime(share.expiresAt) })) : esc(t('share.noExpiry'))}</span>
        ${left !== null ? `<span class="chip chip--accent">${icon('download')}${esc(t('share.downloadsLeft', { n: left }))}</span>` : ''}
        ${share.protected ? `<span class="chip">${icon('lock')}<span data-i18n="share.protected"></span></span>` : ''}
      </div>
    </div>
    <div class="share-files"></div>
    <div class="share-foot">
      ${share.zip ? `<a class="btn btn--primary btn--lg" href="/z/${encodeURIComponent(share.id)}" download>${icon('archive')}<span data-i18n="share.downloadAll"></span></a>` : ''}
      <button class="btn btn--lg" data-act="copy">${icon('link')}<span data-i18n="share.copyLink"></span></button>
      <span class="grow"></span>
      ${share.canDelete ? `<button class="btn btn--ghost btn--danger btn--icon" data-act="delete" data-i18n-title="common.delete">${icon('trash')}</button>` : ''}
    </div>
  </div>`);
  $('h1', card).textContent = heading;
  if (share.message) $('[data-msg]', card).textContent = share.message;

  const list = $('.share-files', card);
  share.files.forEach((f, i) => {
    const row = h(`<div class="share-file" style="--i:${Math.min(i, 10)}">
      <div class="file-thumb ${f.preview ? 'is-previewable' : ''}" ${f.preview ? 'role="button" tabindex="0"' : ''}>${icon(fileIcon(f.mime, f.name))}</div>
      <div class="file-meta"><div class="file-name"></div><div class="file-size">${esc(formatBytes(f.size))}</div></div>
      ${f.preview ? `<button class="btn btn--ghost btn--icon btn--sm" data-act="preview" data-i18n-title="share.preview">${icon(f.mime.startsWith('image/') ? 'eye' : 'play')}</button>` : ''}
      <a class="btn btn--sm" href="${fileUrl(f)}" download>${icon('download')}<span class="hide-sm" data-i18n="share.download"></span></a>
    </div>`);
    $('.file-name', row).textContent = f.name;
    if (f.preview && f.mime.startsWith('image/') && f.size < 15 * 1048576) {
      const img = new Image();
      img.alt = '';
      img.loading = 'lazy';
      img.src = fileUrl(f, true);
      img.onload = () => $('.file-thumb', row).replaceChildren(img);
    }
    const open = () => openPreview(f, fileUrl(f, true), fileUrl(f));
    row.addEventListener('click', e => { if (e.target.closest('[data-act="preview"], .is-previewable')) open(); });
    row.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('is-previewable')) open(); });
    list.append(row);
  });

  card.addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'copy') copyText(location.href.split('#')[0]);
    if (act === 'delete' && await confirmDialog({ title: t('share.deleteTitle'), body: t('share.deleteText') })) {
      try {
        await api(`/api/shares/${encodeURIComponent(share.id)}`, { method: 'DELETE' });
        toast(t('toast.deleted'));
        setTimeout(() => { location.href = '/dashboard'; }, 600);
      } catch (err) { toast(err.message, 'error'); }
    }
  });
  mount(card);
}

function openPreview(file, src, dl) {
  const kind = file.mime.split('/')[0];
  const media = kind === 'image' ? `<img class="lightbox-media" src="${src}" alt="">`
    : kind === 'video' ? `<video class="lightbox-media" src="${src}" controls autoplay playsinline></video>`
      : `<div style="padding:40px 20px"><audio src="${src}" controls autoplay style="width:100%"></audio></div>`;
  const m = modal(`<div class="stack" style="--gap:10px">
    ${media}
    <div class="row row--between" style="padding:4px 8px 6px">
      <span class="truncate grow" data-name></span>
      <div class="row" style="--gap:6px"><a class="btn btn--sm" href="${dl}" download>${icon('download')}<span data-i18n="share.download"></span></a>
      <button class="btn btn--ghost btn--icon btn--sm" data-close data-i18n-title="common.close">${icon('x')}</button></div>
    </div>
  </div>`, { wide: true });
  $('[data-name]', m.el).textContent = file.name;
  applyI18n(m.el);
  $('[data-close]', m.el).addEventListener('click', m.close);
}

async function load() {
  try {
    const share = await api(`/api/s/${encodeURIComponent(id)}`);
    if (!share.unlocked) return renderLocked();
    document.title = `${share.title || t('title.share')} · ${document.title.split(' · ').pop()}`;
    renderShare(share);
  } catch (err) {
    renderError(err);
  }
}

load();
