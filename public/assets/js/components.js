import {
  t, $, h, esc, icon, formatBytes, formatNumber, formatDate, relativeTime, shareUrl, copyText, toast, confirmDialog, applyI18n,
} from './core.js';
import { fileIcon } from './icons.js';

export function statTile({ label, ic, value, sub = '', meter = null, i = 0 }) {
  const level = meter === null ? '' : meter > 0.9 ? 'is-danger' : meter > 0.75 ? 'is-warn' : '';
  const el = h(`<div class="stat glass" data-glow data-reveal style="--d:${i}">
    <div class="stat__label">${icon(ic)}<span>${esc(label)}</span></div>
    <div class="stat__value">${esc(value)}</div>
    ${meter !== null ? `<div class="meter ${level}"><i></i></div>` : ''}
    ${sub ? `<div class="stat__sub">${esc(sub)}</div>` : ''}
  </div>`);
  if (meter !== null) requestAnimationFrame(() => setTimeout(() => { $('.meter i', el).style.width = `${Math.min(100, meter * 100)}%`; }, 250));
  return el;
}

export function shareRow(s, i, { onDelete, showOwner = false } = {}) {
  const expired = s.expiresAt && s.expiresAt < Date.now();
  const soon = s.expiresAt && s.expiresAt - Date.now() < 86400000;
  const name = s.title || s.firstName || s.id;
  const row = h(`<div class="list-row" style="--i:${Math.min(i, 12)}">
    <div class="file-thumb" style="width:44px;height:44px;border-radius:13px">${icon(s.fileCount > 1 ? 'archive' : fileIcon('', s.firstName || ''))}</div>
    <div style="min-width:0">
      <div class="row" style="--gap:8px;flex-wrap:nowrap"><a class="truncate" style="font-weight:560" href="/s/${encodeURIComponent(s.id)}" target="_blank" rel="noopener"></a>
        ${s.protected ? `<span class="subtle" title="${esc(t('share.protected'))}" style="display:inline-flex">${icon('lock').replace('<svg', '<svg style="width:14px;height:14px"')}</span>` : ''}</div>
      <div class="list-row__meta">
        <span>${icon('file')}${esc(t('share.nFiles', { n: s.fileCount }))} · ${esc(formatBytes(s.totalSize))}</span>
        <span style="${soon ? 'color:var(--warn)' : ''}" title="${esc(formatDate(s.expiresAt))}">${icon('clock')}${esc(s.expiresAt ? (expired ? t('dash.expired') : t('share.expires', { when: relativeTime(s.expiresAt) })) : t('share.noExpiry'))}</span>
        <span>${icon('download')}${esc(formatNumber(s.downloadCount))}${s.maxDownloads ? ` / ${esc(s.maxDownloads)}` : ''}</span>
        <span>${icon('eye')}${esc(formatNumber(s.viewCount))}</span>
        ${showOwner ? `<span>${icon('user')}${esc(s.owner || t('dash.guest'))}</span>` : ''}
        <span class="hide-sm">${esc(formatDate(s.createdAt, { dateStyle: 'medium' }))}</span>
      </div>
    </div>
    <div class="list-row__actions">
      <button class="btn btn--ghost btn--icon btn--sm" data-act="copy" title="${esc(t('share.copyLink'))}" aria-label="${esc(t('share.copyLink'))}">${icon('copy')}</button>
      <a class="btn btn--ghost btn--icon btn--sm hide-sm" href="/s/${encodeURIComponent(s.id)}" target="_blank" rel="noopener" title="${esc(t('common.open'))}" aria-label="${esc(t('common.open'))}">${icon('external')}</a>
      <button class="btn btn--ghost btn--icon btn--sm btn--danger" data-act="delete" title="${esc(t('common.delete'))}" aria-label="${esc(t('common.delete'))}">${icon('trash')}</button>
    </div>
  </div>`);
  $('a.truncate', row).textContent = name;
  row.addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'copy') copyText(shareUrl(s.id));
    if (act === 'delete' && await confirmDialog({ title: t('share.deleteTitle'), body: t('share.deleteTextNamed', { name }) })) {
      try {
        await onDelete(s);
        row.classList.add('is-leaving');
        row.style.animation = 'row-out .35s var(--ease) both';
        setTimeout(() => row.remove(), 340);
        toast(t('toast.deleted'));
      } catch (err) { toast(err.message, 'error'); }
    }
  });
  return row;
}

export function emptyState(titleKey, textKey, ic = 'inbox', action = '') {
  const el = h(`<div class="empty"><div class="icon-tile">${icon(ic)}</div>
    <div class="stack" style="--gap:4px"><div class="h3" data-i18n="${titleKey}"></div><div class="muted small" data-i18n="${textKey}"></div></div>${action}</div>`);
  applyI18n(el);
  return el;
}
