import { icon } from './icons.js';
import { DICT } from './i18n.js';

export { icon };
export const PROJECT_URL = 'https://github.com/tamino112/sharehost';
export const state = { config: null, lang: 'en' };

document.documentElement.classList.add('js');

// ------------------------------------------------------------------ helpers

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ESC[c]);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

export function t(key, vars) {
  let s = DICT[state.lang]?.[key] ?? DICT.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return s;
}

export function applyI18n(root = document) {
  for (const el of $$('[data-i18n]', root)) el.textContent = t(el.dataset.i18n);
  for (const el of $$('[data-i18n-placeholder]', root)) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of $$('[data-i18n-title]', root)) { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); }
}

export function setLang(lang) {
  state.lang = DICT[lang] ? lang : 'en';
  try { localStorage.setItem('sh_lang', state.lang); } catch { /* storage unavailable */ }
  document.documentElement.lang = state.lang;
}

export function formatBytes(bytes, digits = 1) {
  if (!Number.isFinite(bytes)) return '∞';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = bytes;
  let i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
  return `${v.toLocaleString(state.lang, { maximumFractionDigits: v < 10 ? digits : 0 })} ${units[i]}`;
}

export const formatNumber = n => Number(n || 0).toLocaleString(state.lang);

export function formatDate(ms, opts = { dateStyle: 'medium', timeStyle: 'short' }) {
  return ms ? new Intl.DateTimeFormat(state.lang, opts).format(new Date(ms)) : '—';
}

export function relativeTime(ms) {
  if (!ms) return '—';
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(state.lang, { numeric: 'auto' });
  const steps = [[60000, 'second', 1000], [3600000, 'minute', 60000], [86400000, 'hour', 3600000], [2592000000, 'day', 86400000], [31536000000, 'month', 2592000000], [Infinity, 'year', 31536000000]];
  for (const [limit, unit, div] of steps) if (abs < limit) return rtf.format(Math.round(diff / div), unit);
}

export function formatHours(hours) {
  if (hours === 0) return t('expiry.never');
  if (hours % 8760 === 0) return t(hours === 8760 ? 'unit.year' : 'unit.years', { n: hours / 8760 });
  if (hours % 168 === 0 && hours < 720) return t(hours === 168 ? 'unit.week' : 'unit.weeks', { n: hours / 168 });
  if (hours % 24 === 0) return t(hours === 24 ? 'unit.day' : 'unit.days', { n: hours / 24 });
  return t(hours === 1 ? 'unit.hour' : 'unit.hours', { n: hours });
}

export const shareUrl = id => `${(state.config?.settings.publicUrl || location.origin).replace(/\/+$/, '')}/s/${id}`;

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('<textarea style="position:fixed;opacity:0"></textarea>');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(t('toast.copied'));
}

// ------------------------------------------------------------------ API

export async function api(path, { method = 'GET', body, headers = {}, onProgress } = {}) {
  const opts = { method, headers: { 'x-sharehost': '1', ...headers }, credentials: 'same-origin' };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers['content-type'] = 'application/json';
  }
  const res = await fetch(path, opts);
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw apiError(res.status, data);
  return data;
}

export function apiError(status, data) {
  const code = data?.code;
  const translated = code && DICT[state.lang]?.[`err.${code}`];
  const err = new Error(translated || data?.error || t('err.generic'));
  err.status = status;
  err.code = code;
  return err;
}

// ------------------------------------------------------------------ appearance

function inkFor(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.32 ? '#0c0f05' : '#ffffff';
}

export function resolveTheme(setting) {
  let stored = null;
  try { stored = localStorage.getItem('sh_theme'); } catch { /* ignore */ }
  const pref = stored || setting;
  if (pref === 'system') return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return pref === 'light' ? 'light' : 'dark';
}

let backdropKey = '';
export function applyAppearance(s) {
  const root = document.documentElement;
  root.style.setProperty('--accent', s.accentColor);
  root.style.setProperty('--accent-ink', inkFor(s.accentColor));
  root.style.setProperty('--ga', String(s.glassOpacity / 100));
  root.style.setProperty('--blur', `${s.glassBlur}px`);
  root.style.setProperty('--dim', String(s.backgroundDim / 100));
  root.dataset.theme = resolveTheme(s.theme);
  root.dataset.motion = s.animations ? 'on' : 'off';
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = root.dataset.theme === 'light' ? '#e7e9e3' : '#07080a';

  const key = [s.backgroundMode, s.backgroundImage, s.backgroundVideo, s.backgroundPoster, s.cursorGlow, s.animations].join('|');
  if (key === backdropKey) return;
  backdropKey = key;
  $('.backdrop')?.remove();

  const mode = (s.backgroundMode === 'image' && s.backgroundImage) ? 'image'
    : (s.backgroundMode === 'video' && s.backgroundVideo) ? 'video' : 'aurora';
  const bd = h(`<div class="backdrop" aria-hidden="true">
    <div class="aurora"><i></i><i></i><i></i><i></i></div>
    ${mode === 'aurora' ? '<div class="backdrop__grid"></div>' : '<div class="backdrop__dim"></div>'}
    ${s.cursorGlow ? '<div class="backdrop__spot"></div>' : ''}
    <div class="backdrop__grain"></div>
    <div class="backdrop__vignette"></div>
  </div>`);

  let media = null;
  const reduced = !s.animations || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (mode === 'image') {
    media = h('<img class="backdrop__media" alt="" decoding="async">');
    media.src = s.backgroundImage;
  } else if (mode === 'video') {
    if (reduced && s.backgroundPoster) {
      media = h('<img class="backdrop__media" alt="">');
      media.src = s.backgroundPoster;
    } else {
      media = h('<video class="backdrop__media" muted loop playsinline preload="auto"></video>');
      if (s.backgroundPoster) media.poster = s.backgroundPoster;
      media.src = s.backgroundVideo;
      media.autoplay = !reduced;
      media.addEventListener('canplay', () => media.classList.add('is-ready'), { once: true });
      // Poster frames show immediately; the video itself fades in once playable.
      if (s.backgroundPoster) media.classList.add('is-ready');
    }
  }
  if (media) {
    if (media.tagName === 'IMG') media.addEventListener('load', () => media.classList.add('is-ready'), { once: true });
    bd.children[0].after(media);
  }
  document.body.prepend(bd);
}

// Cursor-reactive glass + background spotlight
let raf = 0;
let lastEvent = null;
document.addEventListener('pointermove', e => {
  lastEvent = e;
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const ev = lastEvent;
    const spot = $('.backdrop__spot');
    if (spot) {
      spot.style.setProperty('--sx', `${ev.clientX}px`);
      spot.style.setProperty('--sy', `${ev.clientY}px`);
    }
    const glass = ev.target.closest?.('[data-glow]');
    if (glass) {
      const r = glass.getBoundingClientRect();
      glass.style.setProperty('--mx', `${ev.clientX - r.left}px`);
      glass.style.setProperty('--my', `${ev.clientY - r.top}px`);
    }
  });
}, { passive: true });

// ------------------------------------------------------------------ motion helpers

const io = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' })
  : null;

export function reveal(root = document) {
  for (const el of $$('[data-reveal]:not(.is-in)', root)) io ? io.observe(el) : el.classList.add('is-in');
}

/** Wraps each word in a span so headings can blur-in word by word. */
export function splitWords(el, text, dimFrom = Infinity) {
  el.textContent = '';
  const words = text.split(/(\s+)/);
  let i = 0;
  let wordIndex = 0;
  for (const w of words) {
    if (!w) continue;
    if (/^\s+$/.test(w)) { el.append(' '); continue; }
    const span = document.createElement(wordIndex >= dimFrom ? 'em' : 'span');
    span.className = 'split-word';
    span.style.setProperty('--i', i++);
    span.textContent = w;
    el.append(span);
    wordIndex++;
  }
}

// ------------------------------------------------------------------ toasts & dialogs

export function toast(message, type = 'ok') {
  let host = $('.toasts');
  if (!host) { host = h('<div class="toasts" role="status" aria-live="polite"></div>'); document.body.append(host); }
  const el = h(`<div class="toast glass toast--${type}"><span class="toast__icon">${icon(type === 'error' ? 'x' : 'check')}</span><span></span></div>`);
  el.lastElementChild.textContent = message;
  host.append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, type === 'error' ? 5000 : 2800);
}

export function modal(html, { wide = false, onClose } = {}) {
  const prev = document.activeElement;
  const backdrop = h(`<div class="modal-backdrop"><div class="modal glass glass--xl ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`);
  const close = () => {
    backdrop.style.animation = 'fade .25s var(--ease) reverse both';
    setTimeout(() => backdrop.remove(), 220);
    document.removeEventListener('keydown', onKey);
    prev?.focus?.();
    onClose?.();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  applyI18n(backdrop);
  setTimeout(() => $('input, textarea, select, button.btn--primary', backdrop)?.focus(), 50);
  return { el: backdrop.firstElementChild, close };
}

export function confirmDialog({ title, body = '', confirm = t('common.delete'), danger = true }) {
  return new Promise(resolve => {
    let result = false;
    const m = modal(`
      <div class="stack" style="--gap:18px">
        <div class="icon-tile ${danger ? '' : 'icon-tile--accent'}" style="${danger ? 'color:var(--danger)' : ''}">${icon(danger ? 'alert' : 'sparkle')}</div>
        <div class="stack" style="--gap:6px"><h2 class="h2">${esc(title)}</h2>${body ? `<p class="muted" style="margin:0">${esc(body)}</p>` : ''}</div>
        <div class="row" style="justify-content:flex-end">
          <button class="btn btn--ghost" data-act="cancel">${esc(t('common.cancel'))}</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-act="ok" style="${danger ? 'box-shadow:0 0 0 1px color-mix(in oklab,var(--danger) 40%,transparent) inset' : ''}">${esc(confirm)}</button>
        </div>
      </div>`, { onClose: () => resolve(result) });
    m.el.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      result = act === 'ok';
      m.close();
    });
    setTimeout(() => $('[data-act="ok"]', m.el).focus(), 60);
  });
}

export function setLoading(btn, on) {
  btn.classList.toggle('is-loading', on);
  btn.disabled = on;
}

export function showError(container, message) {
  container.querySelector('.form-error')?.remove();
  if (!message) return;
  const el = h(`<div class="form-error" role="alert">${icon('alert')}<span></span></div>`);
  el.querySelector('svg').style.cssText = 'width:16px;height:16px;flex:none;margin-top:2px';
  el.lastElementChild.textContent = message;
  container.prepend(el);
}

export function passwordScore(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) score++;
  return Math.max(1, Math.min(4, score));
}

// ------------------------------------------------------------------ chrome

function renderNav(active) {
  const { config } = state;
  const s = config.settings;
  const user = config.user;
  const brand = `<img src="${esc(s.logo || '/assets/brand/logo-128.webp')}" alt="">`;
  const link = (href, key, name) => `<a class="nav__link" href="${href}" ${active === name ? 'aria-current="page"' : ''} data-i18n="${key}"></a>`;
  const nav = h(`<nav class="nav glass" data-glow>
    <a class="nav__brand" href="/">${brand}<span>${esc(s.siteName)}</span></a>
    <div class="nav__links">
      ${link('/', 'nav.upload', 'home')}
      ${user ? link('/dashboard', 'nav.dashboard', 'dashboard') : ''}
      ${user?.role === 'admin' ? link('/admin', 'nav.admin', 'admin') : ''}
    </div>
    <div class="nav__tools">
      <button class="btn btn--ghost btn--sm" data-act="lang" data-i18n-title="nav.language" style="font:500 12px var(--mono);letter-spacing:.06em">${state.lang.toUpperCase()}</button>
      <button class="btn btn--ghost btn--icon btn--sm" data-act="theme" data-i18n-title="nav.theme">${icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun')}</button>
      ${user ? `<div class="menu">
          <button class="btn btn--ghost btn--icon" data-act="user" aria-haspopup="menu" aria-expanded="false" style="width:40px;height:40px"><span class="avatar">${esc(user.username.slice(0, 2))}</span></button>
        </div>`
        : `<a class="btn btn--sm" href="/login" data-i18n="nav.signIn"></a>`}
      <button class="btn btn--ghost btn--icon btn--sm nav__menu" data-act="menu" data-i18n-title="nav.menu">${icon('menu')}</button>
    </div>
  </nav>`);

  nav.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'lang') {
      const langs = Object.keys(DICT);
      setLang(langs[(langs.indexOf(state.lang) + 1) % langs.length]);
      location.reload();
    } else if (act === 'theme') {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      try { localStorage.setItem('sh_theme', next); } catch { /* ignore */ }
      document.documentElement.dataset.theme = next;
      btn.innerHTML = icon(next === 'light' ? 'moon' : 'sun');
    } else if (act === 'menu') {
      $('.nav__links', nav).classList.toggle('is-open');
    } else if (act === 'user') {
      toggleUserMenu(btn);
    } else if (act === 'logout') {
      await api('/api/auth/logout', { method: 'POST' });
      location.href = '/';
    }
  });

  const header = $('#nav') || document.body.insertBefore(document.createElement('header'), document.body.firstChild);
  header.replaceChildren(nav);
}

function toggleUserMenu(btn) {
  const host = btn.parentElement;
  const open = $('.menu__panel', host);
  if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
  const user = state.config.user;
  const panel = h(`<div class="menu__panel glass glass--md" role="menu">
    <div class="menu__head"><div class="h3">${esc(user.username)}</div><div class="small subtle">${esc(user.email || t(user.role === 'admin' ? 'role.admin' : 'role.user'))}</div></div>
    <hr class="divider" style="margin:4px 0">
    <a class="menu__item" href="/dashboard" role="menuitem">${icon('layout')}<span data-i18n="nav.dashboard"></span></a>
    ${user.role === 'admin' ? `<a class="menu__item" href="/admin" role="menuitem">${icon('settings')}<span data-i18n="nav.admin"></span></a>` : ''}
    <a class="menu__item" href="/dashboard#account" role="menuitem">${icon('key')}<span data-i18n="nav.account"></span></a>
    <hr class="divider" style="margin:4px 0">
    <button class="menu__item" data-act="logout" role="menuitem">${icon('logout')}<span data-i18n="nav.signOut"></span></button>
  </div>`);
  applyI18n(panel);
  host.append(panel);
  btn.setAttribute('aria-expanded', 'true');
  setTimeout(() => document.addEventListener('click', function off(e) {
    if (!host.contains(e.target)) { panel.remove(); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', off); }
  }));
}

function renderFooter() {
  const s = state.config.settings;
  const footer = h(`<footer class="footer"><div class="shell">
    <span>${esc(s.footerText || `© ${new Date().getFullYear()} ${s.siteName}`)}</span>
    <nav>
      ${s.imprintUrl ? `<a href="${esc(s.imprintUrl)}" rel="noopener" data-i18n="footer.imprint"></a>` : ''}
      ${s.privacyUrl ? `<a href="${esc(s.privacyUrl)}" rel="noopener" data-i18n="footer.privacy"></a>` : ''}
      <a href="${PROJECT_URL}" target="_blank" rel="noopener" class="row" style="--gap:6px"><span data-i18n="footer.powered"></span> <span class="mono">ShareHost ${esc(state.config.version)}</span></a>
    </nav>
  </div></footer>`);
  document.body.append(footer);
}

/**
 * Boots a page: loads config, applies language/theme/background, renders nav + footer
 * and enforces access rules. Returns the instance config.
 */
export async function init({ page = '', auth = null } = {}) {
  let config;
  try {
    config = await api('/api/config');
  } catch {
    document.body.innerHTML = '<p style="padding:40px;font-family:system-ui">ShareHost is not reachable. Please try again.</p>';
    throw new Error('config unavailable');
  }
  state.config = config;

  let lang = null;
  try { lang = localStorage.getItem('sh_lang'); } catch { /* ignore */ }
  setLang(lang || config.settings.defaultLanguage);
  applyAppearance(config.settings);

  if (config.setupRequired && page !== 'setup') { location.replace('/setup'); return new Promise(() => {}); }
  if (!config.setupRequired && page === 'setup') { location.replace('/'); return new Promise(() => {}); }
  if (auth && !config.user) { location.replace(`/login?next=${encodeURIComponent(location.pathname + location.hash)}`); return new Promise(() => {}); }
  if (auth === 'admin' && config.user.role !== 'admin') { location.replace('/dashboard'); return new Promise(() => {}); }

  document.title = document.title ? `${t(document.title)} · ${config.settings.siteName}` : config.settings.siteName;
  if (page !== 'setup') {
    renderNav(page);
    renderFooter();
  }
  applyI18n();
  reveal();
  return config;
}
