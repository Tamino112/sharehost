import {
  init, t, $, $$, h, esc, icon, api, state, formatBytes, formatNumber, formatDate, relativeTime, toast, modal,
  confirmDialog, setLoading, showError, applyI18n, applyAppearance, copyText, reveal,
} from './core.js';
import { statTile, shareRow, emptyState } from './components.js';

await init({ page: 'admin', auth: 'admin' });

const has = key => t(key) !== key;
const SETTING_VIEWS = { general: 'sliders', uploads: 'upload', guests: 'globe', access: 'shield', appearance: 'palette', legal: 'scale' };
const GROUPS = [
  ['admin.groupInsights', { overview: 'chart' }],
  ['admin.groupSettings', SETTING_VIEWS],
  ['admin.groupManage', { users: 'users', shares: 'link', invites: 'ticket' }],
  ['admin.groupSystem', { maintenance: 'wrench' }],
];
const RENDERERS = { overview: renderOverview, users: renderUsers, shares: renderShares, invites: renderInvites, maintenance: renderMaintenance };
const view = $('#view');

const store = { schema: null, values: null, pending: {} };

// ------------------------------------------------------------------ routing

$('#sidebar').innerHTML = GROUPS.map(([label, items]) => `
  <div class="sidebar__group">${esc(t(label))}</div>
  ${Object.entries(items).map(([key, ic]) => `<a href="#${key}" data-view="${key}">${icon(ic)}<span>${esc(t(`admin.view.${key}`))}</span></a>`).join('')}
`).join('');

async function route() {
  const name = location.hash.slice(1) || 'overview';
  const key = RENDERERS[name] || SETTING_VIEWS[name] ? name : 'overview';
  for (const a of $$('#sidebar a')) a.setAttribute('aria-current', String(a.dataset.view === key));
  $('#view-title').textContent = t(`admin.view.${key}`);
  const panel = h('<div class="admin-view"></div>');
  view.replaceChildren(panel);
  try {
    if (SETTING_VIEWS[key]) await renderSettings(panel, key);
    else await RENDERERS[key](panel);
  } catch (err) {
    panel.replaceChildren(emptyState('err.generic', 'share.genericText', 'alert'));
    toast(err.message, 'error');
  }
  applyI18n(panel);
  reveal(panel);
}
window.addEventListener('hashchange', route);

// ------------------------------------------------------------------ overview

async function renderOverview(panel) {
  const s = await api('/api/admin/stats');
  const stats = h('<div class="stats"></div>');
  stats.append(
    statTile({ label: t('admin.statUsers'), ic: 'users', value: formatNumber(s.users), sub: t('admin.statAdmins', { n: s.admins }), i: 0 }),
    statTile({ label: t('admin.statShares'), ic: 'link', value: formatNumber(s.shares), sub: t('admin.statSharesSub', { p: s.protectedShares, g: s.guestShares }), i: 1 }),
    statTile({ label: t('admin.statStorage'), ic: 'drive', value: formatBytes(s.storageBytes), sub: t('admin.statFiles', { n: formatNumber(s.files) }), i: 2 }),
    statTile({ label: t('admin.statDownloads'), ic: 'download', value: formatNumber(s.downloads), sub: t('admin.statSessions', { n: s.activeSessions }), i: 3 }),
  );

  const grid = h('<div style="display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:16px" class="overview-grid"></div>');
  const chartPanel = h(`<section class="panel glass" data-glow data-reveal>
    <div class="panel__head">
      <div class="stack" style="--gap:2px"><h2 class="h2" data-i18n="admin.chartTitle"></h2><span class="small muted" data-i18n="admin.chartText"></span></div>
      <div class="segmented" role="group">
        <button type="button" data-metric="shares" aria-pressed="true" data-i18n="admin.metricShares"></button>
        <button type="button" data-metric="bytes" aria-pressed="false" data-i18n="admin.metricBytes"></button>
      </div>
    </div>
    <div class="chart-host"></div>
  </section>`);
  const drawChart = metric => {
    $('.chart-host', chartPanel).replaceChildren(barChart(s.days, metric));
    for (const b of $$('[data-metric]', chartPanel)) b.setAttribute('aria-pressed', String(b.dataset.metric === metric));
  };
  chartPanel.addEventListener('click', e => { const m = e.target.closest('[data-metric]')?.dataset.metric; if (m) drawChart(m); });
  drawChart('shares');

  const diskUsed = s.disk ? s.disk.total - s.disk.free : 0;
  const side = h(`<div class="stack">
    <section class="panel glass" data-glow data-reveal style="--d:1">
      <div class="stat__label" style="margin-bottom:14px">${icon('database')}<span data-i18n="admin.disk"></span></div>
      ${s.disk ? `
        <div class="row row--between" style="margin-bottom:10px"><span class="stat__value" style="font-size:26px">${esc(formatBytes(s.disk.free))}</span><span class="small muted">${esc(t('admin.diskFree'))}</span></div>
        <div class="meter ${diskUsed / s.disk.total > 0.9 ? 'is-danger' : diskUsed / s.disk.total > 0.75 ? 'is-warn' : ''}"><i data-w="${(diskUsed / s.disk.total) * 100}"></i></div>
        <div class="small subtle" style="margin-top:8px">${esc(t('admin.diskUsed', { used: formatBytes(diskUsed), total: formatBytes(s.disk.total) }))}</div>`
      : `<span class="muted small">${esc(t('admin.diskUnknown'))}</span>`}
    </section>
    <section class="panel glass" data-glow data-reveal style="--d:2">
      <div class="stat__label" style="margin-bottom:10px">${icon('server')}<span data-i18n="admin.system"></span></div>
      <dl class="kv">
        <dt data-i18n="admin.version"></dt><dd class="mono">${esc(s.system.version)}</dd>
        <dt>Node.js</dt><dd class="mono">${esc(s.system.node)}</dd>
        <dt data-i18n="admin.uptime"></dt><dd>${esc(formatUptime(s.system.uptime))}</dd>
        <dt data-i18n="admin.memory"></dt><dd>${esc(formatBytes(s.system.memory))}</dd>
        <dt data-i18n="admin.expiringSoon"></dt><dd>${esc(formatNumber(s.expiringSoon))}</dd>
      </dl>
    </section>
  </div>`);
  setTimeout(() => { for (const i of $$('.meter i[data-w]', side)) i.style.width = `${i.dataset.w}%`; }, 300);
  grid.append(chartPanel, side);
  panel.append(stats, grid);
}

function formatUptime(ms) {
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const hh = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${hh}h` : hh ? `${hh}h ${m % 60}m` : `${m}m`;
}

/** Single-series bar chart: one hue, thin rounded bars on a shared baseline, hover tooltip per bar. */
function barChart(days, metric) {
  const fmt = metric === 'bytes' ? v => formatBytes(v, 0) : formatNumber;
  // Share counts are whole numbers: use an even maximum so the midline label is an integer too.
  const max = metric === 'bytes' ? Math.max(1, ...days.map(d => d.bytes)) : Math.ceil(Math.max(4, ...days.map(d => d.shares)) / 2) * 2;
  const dateFmt = new Intl.DateTimeFormat(state.lang, { day: 'numeric', month: 'numeric' });
  const longFmt = new Intl.DateTimeFormat(state.lang, { weekday: 'short', day: 'numeric', month: 'long' });
  const el = h(`<div class="chart" role="img">
    <div class="chart__plot">
      <div class="chart__grid"><span><b>${esc(fmt(max))}</b></span><span><b>${esc(fmt(max / 2))}</b></span><span></span></div>
      ${days.map((d, i) => {
        const v = d[metric];
        const date = new Date(`${d.day}T12:00:00`);
        return `<div class="chart__col ${v ? '' : 'is-zero'}" aria-label="${esc(`${longFmt.format(date)}: ${fmt(v)}`)}">
          <div class="chart__bar" style="--i:${i};height:${(v / max) * 100}%"></div>
          <div class="tooltip"><div class="subtle small">${esc(longFmt.format(date))}</div><strong>${esc(fmt(v))}</strong> ${esc(metric === 'shares' ? t('admin.metricShares') : '')}</div>
        </div>`;
      }).join('')}
    </div>
    <div class="chart__axis">${days.map((d, i) => `<span>${i % 2 === 0 || i === days.length - 1 ? esc(dateFmt.format(new Date(`${d.day}T12:00:00`))) : ''}</span>`).join('')}</div>
  </div>`);
  el.setAttribute('aria-label', t('admin.chartTitle'));
  return el;
}

// ------------------------------------------------------------------ settings

async function loadSettings() {
  if (store.schema) return;
  const data = await api('/api/admin/settings');
  store.schema = data.schema;
  store.values = data.values;
}

const current = key => (key in store.pending ? store.pending[key] : store.values[key]);

function setPending(key, value) {
  if (JSON.stringify(value) === JSON.stringify(store.values[key])) delete store.pending[key];
  else store.pending[key] = value;
  if (store.schema[key].group === 'appearance') applyAppearance({ ...store.values, ...store.pending });
  renderSavebar();
}

let savebar = null;
function renderSavebar() {
  const n = Object.keys(store.pending).length;
  if (!n) {
    if (savebar) {
      const el = savebar;
      savebar = null;
      el.classList.add('is-leaving');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }
    return;
  }
  if (!savebar) {
    savebar = h(`<div class="savebar glass" role="region" aria-live="polite">
      <span class="pulse-dot"></span><span class="grow small" data-count></span>
      <button class="btn btn--ghost btn--sm" data-act="discard">${esc(t('admin.discard'))}</button>
      <button class="btn btn--primary btn--sm" data-act="save">${icon('check')}<span>${esc(t('common.save'))}</span></button>
    </div>`);
    savebar.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'discard') {
        store.pending = {};
        applyAppearance(store.values);
        renderSavebar();
        route();
      } else if (act === 'save') {
        const btn = e.target.closest('button');
        setLoading(btn, true);
        try {
          const { values } = await api('/api/admin/settings', { method: 'PUT', body: store.pending });
          store.values = values;
          store.pending = {};
          Object.assign(state.config.settings, values);
          applyAppearance(values);
          const brand = $('.nav__brand span');
          if (brand) brand.textContent = values.siteName;
          toast(t('admin.saved'));
          renderSavebar();
        } catch (err) {
          toast(err.message, 'error');
          setLoading(btn, false);
        }
      }
    });
    document.body.append(savebar);
  }
  $('[data-count]', savebar).textContent = t('admin.unsaved', { n });
}

window.addEventListener('beforeunload', e => { if (Object.keys(store.pending).length) e.preventDefault(); });

async function renderSettings(panel, group) {
  await loadSettings();
  const keys = Object.entries(store.schema).filter(([, d]) => d.group === group && d.type !== 'media').map(([k]) => k);
  const section = h(`<section class="panel glass" data-reveal>
    <div class="panel__head"><div class="stack" style="--gap:4px">
      <h2 class="h2">${esc(t(`admin.view.${group}`))}</h2>
      ${has(`admin.view.${group}.text`) ? `<p class="small muted" style="margin:0">${esc(t(`admin.view.${group}.text`))}</p>` : ''}
    </div></div>
    <div class="settings-list"></div>
  </section>`);
  const list = $('.settings-list', section);
  for (const key of keys) list.append(settingRow(key, store.schema[key]));
  panel.append(section);

  if (group === 'appearance') panel.append(mediaPanel());
  if (group === 'access') {
    panel.append(h(`<section class="panel glass" data-reveal style="--d:1">
      <div class="row row--between">
        <div class="stack" style="--gap:4px"><h3 class="h3" data-i18n="admin.invitesHintTitle"></h3><span class="small muted" data-i18n="admin.invitesHintText"></span></div>
        <a class="btn btn--sm" href="#invites">${icon('ticket')}<span data-i18n="admin.view.invites"></span></a>
      </div></section>`));
  }
}

const SWATCHES = ['#ecebe6', '#d6cfc0', '#b7c4bb', '#a9b9c6', '#cdb19c', '#c2c79f', '#d9c08f', '#9aa3ab'];

function settingRow(key, def) {
  const value = current(key);
  const wide = def.type === 'text';
  const row = h(`<div class="setting ${wide ? 'setting--wide' : ''}">
    <div class="setting__text"><strong>${esc(t(`settings.${key}`))}</strong>${has(`settings.${key}.hint`) ? `<span class="hint">${esc(t(`settings.${key}.hint`))}</span>` : ''}</div>
    <div class="setting__control"></div>
  </div>`);
  const control = $('.setting__control', row);
  const id = `set-${key}`;
  $('strong', row).id = `${id}-label`;

  if (def.type === 'bool') {
    control.innerHTML = `<label class="switch"><input type="checkbox" id="${id}" aria-labelledby="${id}-label" ${value ? 'checked' : ''}><span></span></label>`;
    $('input', control).addEventListener('change', e => setPending(key, e.target.checked));
  } else if (def.type === 'enum') {
    control.innerHTML = `<div class="segmented" role="group" aria-labelledby="${id}-label">${def.values.map(v =>
      `<button type="button" data-v="${esc(v)}" aria-pressed="${v === value}">${esc(has(`enum.${key}.${v}`) ? t(`enum.${key}.${v}`) : v.toUpperCase())}</button>`).join('')}</div>`;
    control.addEventListener('click', e => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      for (const x of $$('[data-v]', control)) x.setAttribute('aria-pressed', String(x === b));
      setPending(key, b.dataset.v);
    });
  } else if (def.type === 'int' && def.slider) {
    control.innerHTML = `<input class="range" type="range" id="${id}" aria-labelledby="${id}-label" min="${def.min}" max="${def.max}" value="${value}"><span class="mono small" style="min-width:48px;text-align:right">${value}${esc(def.unit || '')}</span>`;
    const range = $('input', control);
    const paint = () => {
      range.style.setProperty('--p', `${((range.value - def.min) / (def.max - def.min)) * 100}%`);
      range.nextElementSibling.textContent = `${range.value}${def.unit || ''}`;
    };
    paint();
    range.addEventListener('input', () => { paint(); setPending(key, Number(range.value)); });
  } else if (def.type === 'int') {
    control.innerHTML = `<div class="input-unit" style="max-width:220px;width:100%"><input class="input tnum" type="number" id="${id}" aria-labelledby="${id}-label" min="${def.min}" max="${def.max}" step="1" value="${value}">${def.unit ? `<span>${esc(def.unit)}</span>` : ''}</div>`;
    $('input', control).addEventListener('input', e => setPending(key, e.target.value === '' ? '' : Number(e.target.value)));
  } else if (def.type === 'color') {
    control.innerHTML = `<div class="color-swatches">${SWATCHES.map(c => `<button type="button" class="swatch" style="--c:${c}" data-c="${c}" aria-label="${c}" aria-pressed="${c === value}"></button>`).join('')}
      <input type="color" class="color-input" id="${id}" aria-labelledby="${id}-label" value="${esc(value)}"></div>`;
    const pick = c => {
      $('input', control).value = c;
      for (const sw of $$('.swatch', control)) sw.setAttribute('aria-pressed', String(sw.dataset.c === c));
      setPending(key, c);
    };
    control.addEventListener('click', e => { const sw = e.target.closest('.swatch'); if (sw) pick(sw.dataset.c); });
    $('input', control).addEventListener('input', e => pick(e.target.value.toLowerCase()));
  } else if (def.type === 'text') {
    control.innerHTML = `<textarea class="textarea" id="${id}" aria-labelledby="${id}-label" maxlength="${def.max}" rows="3"></textarea>`;
    $('textarea', control).value = value;
    $('textarea', control).addEventListener('input', e => setPending(key, e.target.value));
  } else {
    control.innerHTML = `<input class="input" id="${id}" aria-labelledby="${id}-label" maxlength="${def.max}" placeholder="${esc(def.placeholder || '')}">`;
    $('input', control).value = value;
    $('input', control).addEventListener('input', e => setPending(key, e.target.value));
  }
  return row;
}

const PRESETS = ['glass', 'aurora'];

function mediaPanel() {
  const slots = [
    ['backgroundImage', 'image/jpeg,image/png,image/webp,image/avif', 'image'],
    ['backgroundVideo', 'video/mp4,video/webm', 'video'],
    ['backgroundPoster', 'image/jpeg,image/png,image/webp,image/avif', 'image'],
    ['logo', 'image/png,image/webp,image/jpeg', 'image'],
  ];
  const section = h(`<section class="panel glass" data-reveal style="--d:1">
    <div class="panel__head"><div class="stack" style="--gap:4px"><h2 class="h2" data-i18n="admin.media"></h2>
      <p class="small muted" style="margin:0" data-i18n="admin.mediaText"></p></div></div>
    <div class="stack media-list" style="--gap:10px"></div>
  </section>`);
  const host = $('.media-list', section);

  for (const [slot, accept, kind] of slots) {
    const row = h(`<div class="media-slot">
      <div class="media-slot__preview"></div>
      <div class="stack" style="--gap:10px">
        <div class="stack" style="--gap:2px"><strong class="h3">${esc(t(`settings.${slot}`))}</strong><span class="hint">${esc(t(`settings.${slot}.hint`))}</span></div>
        <div class="row" style="--gap:6px">
          <label class="btn btn--sm">${icon('upload')}<span>${esc(t('admin.uploadFile'))}</span><input type="file" accept="${accept}" hidden></label>
          <button class="btn btn--ghost btn--sm btn--danger" data-act="remove">${icon('trash')}<span>${esc(t('common.remove'))}</span></button>
        </div>
        ${slot === 'backgroundImage' ? `<div class="row" style="--gap:8px"><span class="hint">${esc(t('admin.presets'))}</span>
          ${PRESETS.map(p => `<button type="button" class="preset" data-preset="${p}" style="background-image:url(/assets/backgrounds/${p}.webp)" title="${esc(t(`admin.preset.${p}`))}" aria-label="${esc(t(`admin.preset.${p}`))}"></button>`).join('')}</div>` : ''}
      </div>
    </div>`);
    const paint = () => {
      const url = store.values[slot];
      const preview = $('.media-slot__preview', row);
      $('[data-act="remove"]', row).hidden = !url;
      for (const b of $$('[data-preset]', row)) b.setAttribute('aria-pressed', String(url === `/assets/backgrounds/${b.dataset.preset}.webp`));
      if (!url) { preview.innerHTML = icon(kind); return; }
      const el = kind === 'video' ? h('<video muted loop autoplay playsinline></video>') : h('<img alt="">');
      el.src = url;
      preview.replaceChildren(el);
    };
    paint();
    const btn = $('label.btn', row);
    const applied = url => {
      store.values[slot] = url;
      state.config.settings[slot] = url;
      paint();
      applyAppearance({ ...store.values, ...store.pending });
      if (slot === 'backgroundImage' || slot === 'backgroundVideo') suggestMode(slot === 'backgroundImage' ? 'image' : 'video');
    };
    row.addEventListener('click', async e => {
      const preset = e.target.closest('[data-preset]')?.dataset.preset;
      if (!preset) return;
      try {
        const { url } = await api('/api/admin/branding/backgroundImage/preset', { method: 'POST', body: { name: preset } });
        applied(url);
      } catch (err) { toast(err.message, 'error'); }
    });
    $('input', row).addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const body = new FormData();
      body.append('file', file);
      btn.classList.add('is-loading');
      try {
        const { url } = await api(`/api/admin/branding/${slot}`, { method: 'POST', body });
        applied(url);
        toast(t('admin.uploaded'));
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.classList.remove('is-loading');
      }
    });
    $('[data-act="remove"]', row).addEventListener('click', async () => {
      await api(`/api/admin/branding/${slot}`, { method: 'DELETE' });
      store.values[slot] = '';
      state.config.settings[slot] = '';
      paint();
      applyAppearance({ ...store.values, ...store.pending });
    });
    host.append(row);
  }
  return section;
}

function suggestMode(mode) {
  if (current('backgroundMode') === mode) return;
  setPending('backgroundMode', mode);
  const seg = $(`#view [data-v="${mode}"]`);
  if (seg) for (const b of $$('[data-v]', seg.parentElement)) b.setAttribute('aria-pressed', String(b === seg));
}

// ------------------------------------------------------------------ users

async function renderUsers(panel) {
  const { users, defaultQuotaMB } = await api('/api/admin/users');
  const section = h(`<section class="panel glass" data-reveal>
    <div class="panel__head">
      <div class="row" style="--gap:10px"><h2 class="h2" data-i18n="admin.view.users"></h2><span class="chip">${users.length}</span></div>
      <button class="btn btn--primary btn--sm" data-act="add">${icon('plus')}<span data-i18n="admin.addUser"></span></button>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th data-i18n="auth.username"></th><th data-i18n="admin.role"></th><th data-i18n="admin.storage"></th><th data-i18n="admin.view.shares"></th><th data-i18n="admin.lastLogin"></th><th></th></tr></thead>
      <tbody></tbody>
    </table></div>
  </section>`);
  const tbody = $('tbody', section);
  users.forEach((u, i) => {
    const quota = u.quotaMB ?? defaultQuotaMB;
    const tr = h(`<tr style="--i:${i}">
      <td><div class="row" style="--gap:12px;flex-wrap:nowrap"><span class="avatar">${esc(u.username.slice(0, 2))}</span>
        <div style="min-width:0"><div class="truncate" style="font-weight:560">${esc(u.username)} ${u.id === state.config.user.id ? `<span class="subtle small">(${esc(t('admin.you'))})</span>` : ''}</div><div class="small subtle truncate">${esc(u.email || '—')}</div></div></div></td>
      <td><span class="chip ${u.role === 'admin' ? 'chip--accent' : ''}">${esc(t(`role.${u.role}`))}</span>${u.disabled ? ` <span class="chip chip--danger">${esc(t('admin.disabled'))}</span>` : ''}</td>
      <td class="tnum small">${esc(formatBytes(u.usedBytes))} <span class="subtle">/ ${quota ? esc(formatBytes(quota * 1048576, 0)) : '∞'}</span></td>
      <td class="tnum">${esc(formatNumber(u.shares))}</td>
      <td class="small muted" title="${esc(formatDate(u.lastLogin))}">${esc(u.lastLogin ? relativeTime(u.lastLogin) : t('admin.never'))}</td>
      <td><div class="row" style="--gap:2px;justify-content:flex-end;flex-wrap:nowrap">
        <button class="btn btn--ghost btn--icon btn--sm" data-act="edit" aria-label="${esc(t('common.edit'))}">${icon('settings')}</button>
        ${u.id !== state.config.user.id ? `<button class="btn btn--ghost btn--icon btn--sm btn--danger" data-act="delete" aria-label="${esc(t('common.delete'))}">${icon('trash')}</button>` : ''}
      </div></td>
    </tr>`);
    tr.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'edit') userModal(u, defaultQuotaMB);
      if (act === 'delete' && await confirmDialog({ title: t('admin.deleteUserTitle', { name: u.username }), body: t('admin.deleteUserText') })) {
        try { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); toast(t('toast.deleted')); route(); } catch (err) { toast(err.message, 'error'); }
      }
    });
    tbody.append(tr);
  });
  $('[data-act="add"]', section).addEventListener('click', () => userModal(null, defaultQuotaMB));
  panel.append(section);
}

function userModal(user, defaultQuotaMB) {
  const isNew = !user;
  const m = modal(`<form class="stack" style="--gap:18px" novalidate>
    <div class="stack" style="--gap:4px"><h2 class="h2">${esc(isNew ? t('admin.addUser') : t('admin.editUser', { name: user.username }))}</h2></div>
    <div class="stack" data-errors>
      ${isNew ? `<div class="field"><label data-i18n="auth.username"></label><input class="input" name="username" autocomplete="off" required></div>` : ''}
      <div class="field"><label><span data-i18n="auth.email"></span> <span class="subtle" data-i18n="common.optional"></span></label><input class="input" name="email" type="email" value="${esc(user?.email || '')}"></div>
      <div class="field"><label data-i18n="${isNew ? 'auth.password' : 'admin.newPasswordOptional'}"></label><input class="input" name="password" type="password" autocomplete="new-password"></div>
      <div class="grid-2">
        <div class="field"><label data-i18n="admin.role"></label>
          <div class="segmented" data-role><button type="button" data-v="user" aria-pressed="${(user?.role || 'user') === 'user'}" data-i18n="role.user"></button><button type="button" data-v="admin" aria-pressed="${user?.role === 'admin'}" data-i18n="role.admin"></button></div>
        </div>
        <div class="field"><label data-i18n="admin.quota"></label>
          <div class="input-unit"><input class="input tnum" name="quota" type="number" min="0" placeholder="${esc(t('admin.quotaDefault', { n: defaultQuotaMB || '∞' }))}" value="${user?.quotaMB ?? ''}"><span>MB</span></div>
          <span class="hint" data-i18n="admin.quotaHint"></span>
        </div>
      </div>
      ${isNew ? '' : `<div class="toggle-row"><div class="stack" style="--gap:2px"><strong class="h3" data-i18n="admin.disableUser"></strong><span class="hint" data-i18n="admin.disableUserHint"></span></div>
        <label class="switch"><input type="checkbox" name="disabled" ${user.disabled ? 'checked' : ''}><span></span></label></div>`}
    </div>
    <div class="row" style="justify-content:flex-end">
      <button class="btn btn--ghost" type="button" data-close data-i18n="common.cancel"></button>
      <button class="btn btn--primary" type="submit" data-i18n="${isNew ? 'admin.create' : 'common.save'}"></button>
    </div>
  </form>`);
  const form = $('form', m.el);
  let role = user?.role || 'user';
  $('[data-role]', form).addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    role = b.dataset.v;
    for (const x of $$('[data-v]', b.parentElement)) x.setAttribute('aria-pressed', String(x === b));
  });
  $('[data-close]', form).addEventListener('click', m.close);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = $('button[type=submit]', form);
    const body = { email: fd.get('email').trim(), role, quotaMB: fd.get('quota') === '' ? null : Number(fd.get('quota')) };
    if (fd.get('password')) body.password = fd.get('password');
    setLoading(btn, true);
    try {
      if (isNew) await api('/api/admin/users', { method: 'POST', body: { ...body, username: fd.get('username').trim() } });
      else await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { ...body, disabled: fd.get('disabled') === 'on' } });
      m.close();
      toast(t('admin.saved'));
      route();
    } catch (err) {
      showError($('[data-errors]', form), err.message);
      setLoading(btn, false);
    }
  });
}

// ------------------------------------------------------------------ shares

async function renderShares(panel) {
  const section = h(`<section class="panel glass" data-reveal>
    <div class="panel__head">
      <div class="row" style="--gap:10px"><h2 class="h2" data-i18n="admin.allShares"></h2><span class="chip" data-count>…</span></div>
      <div class="input-group" style="width:min(300px,100%)">
        <input class="input" type="search" data-i18n-placeholder="admin.searchShares" style="height:40px;padding-left:40px">
        <span style="position:absolute;left:13px;color:var(--ink-3);pointer-events:none">${icon('search').replace('<svg', '<svg style="width:16px;height:16px"')}</span>
      </div>
    </div>
    <div class="list"></div>
  </section>`);
  const list = $('.list', section);
  const load = async q => {
    const { shares } = await api(`/api/admin/shares${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    $('[data-count]', section).textContent = formatNumber(shares.length);
    if (!shares.length) return list.replaceChildren(emptyState('admin.noShares', 'admin.noSharesText'));
    list.replaceChildren(...shares.map((s, i) => shareRow(s, i, {
      showOwner: true,
      onDelete: share => api(`/api/admin/shares/${encodeURIComponent(share.id)}`, { method: 'DELETE' }),
    })));
  };
  let timer;
  $('input', section).addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => load(e.target.value.trim()), 250); });
  panel.append(section);
  await load('');
}

// ------------------------------------------------------------------ invites

async function renderInvites(panel) {
  await loadSettings();
  const { invites } = await api('/api/admin/invites');
  if (store.values.registrationMode !== 'invite') {
    const banner = h(`<section class="panel glass" data-reveal style="padding:18px 20px">
      <div class="row row--between"><div class="row" style="--gap:12px;flex-wrap:nowrap"><div class="icon-tile" style="color:var(--warn)">${icon('alert')}</div>
        <span class="small">${esc(t('admin.inviteModeOff', { mode: t(`enum.registrationMode.${store.values.registrationMode}`) }))}</span></div>
      <button class="btn btn--sm" data-act="enable" data-i18n="admin.enableInvites"></button></div>
    </section>`);
    $('[data-act="enable"]', banner).addEventListener('click', async () => {
      const { values } = await api('/api/admin/settings', { method: 'PUT', body: { registrationMode: 'invite' } });
      store.values = values;
      toast(t('admin.saved'));
      route();
    });
    panel.append(banner);
  }

  const form = h(`<section class="panel glass" data-reveal style="--d:1">
    <div class="panel__head"><div class="stack" style="--gap:4px"><h2 class="h2" data-i18n="admin.newInvites"></h2><span class="small muted" data-i18n="admin.newInvitesText"></span></div></div>
    <form class="options" style="grid-template-columns:110px 150px 1fr auto;align-items:end;padding:0" novalidate>
      <div class="field"><label data-i18n="admin.count"></label><input class="input tnum" name="count" type="number" min="1" max="50" value="1"></div>
      <div class="field"><label data-i18n="admin.validDays"></label><div class="input-unit"><input class="input tnum" name="days" type="number" min="0" value="7"><span>d</span></div></div>
      <div class="field"><label><span data-i18n="admin.note"></span> <span class="subtle" data-i18n="common.optional"></span></label><input class="input" name="note" maxlength="120"></div>
      <button class="btn btn--primary" type="submit" style="height:46px">${icon('sparkle')}<span data-i18n="admin.generate"></span></button>
    </form>
  </section>`);
  $('form', form).addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { codes } = await api('/api/admin/invites', { method: 'POST', body: { count: Number(fd.get('count')), expiresInDays: Number(fd.get('days')), note: fd.get('note') } });
      if (codes.length === 1) copyText(inviteLink(codes[0]));
      else toast(t('admin.invitesCreated', { n: codes.length }));
      route();
    } catch (err) { toast(err.message, 'error'); }
  });

  const listPanel = h(`<section class="panel glass" data-reveal style="--d:2">
    <div class="panel__head"><h2 class="h2" data-i18n="admin.view.invites"></h2></div>
    <div class="table-wrap"><table class="table"><thead><tr><th data-i18n="admin.code"></th><th data-i18n="admin.note"></th><th data-i18n="admin.status"></th><th data-i18n="admin.created"></th><th></th></tr></thead><tbody></tbody></table></div>
  </section>`);
  const tbody = $('tbody', listPanel);
  if (!invites.length) $('.table-wrap', listPanel).replaceWith(emptyState('admin.noInvites', 'admin.noInvitesText', 'ticket'));
  invites.forEach((inv, i) => {
    const expired = inv.expiresAt && inv.expiresAt < Date.now();
    const status = inv.usedBy ? `<span class="chip">${icon('check')}${esc(t('admin.usedBy', { name: inv.usedBy }))}</span>`
      : expired ? `<span class="chip chip--danger">${esc(t('dash.expired'))}</span>`
        : `<span class="chip chip--accent" title="${esc(formatDate(inv.expiresAt))}">${esc(inv.expiresAt ? t('share.expires', { when: relativeTime(inv.expiresAt) }) : t('admin.open'))}</span>`;
    const tr = h(`<tr style="--i:${i}">
      <td><span class="code-pill">${esc(inv.code)}${!inv.usedBy && !expired ? `<button class="btn btn--ghost btn--icon btn--sm" data-act="copy" aria-label="${esc(t('common.copy'))}" style="width:28px;height:28px">${icon('copy')}</button>` : ''}</span></td>
      <td class="small muted">${esc(inv.note || '—')}</td>
      <td>${status}</td>
      <td class="small muted">${esc(formatDate(inv.createdAt, { dateStyle: 'medium' }))}</td>
      <td><button class="btn btn--ghost btn--icon btn--sm btn--danger" data-act="delete" aria-label="${esc(t('common.delete'))}">${icon('trash')}</button></td>
    </tr>`);
    tr.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'copy') copyText(inviteLink(inv.code));
      if (act === 'delete') { await api(`/api/admin/invites/${encodeURIComponent(inv.code)}`, { method: 'DELETE' }); route(); }
    });
    tbody.append(tr);
  });
  panel.append(form, listPanel);
}

const inviteLink = code => `${(state.config.settings.publicUrl || location.origin).replace(/\/+$/, '')}/register?invite=${encodeURIComponent(code)}`;

// ------------------------------------------------------------------ maintenance

async function renderMaintenance(panel) {
  const card = (ic, title, text, action, d) => `<section class="panel glass" data-glow data-reveal style="--d:${d}">
    <div class="row row--between" style="flex-wrap:nowrap;align-items:flex-start;gap:20px">
      <div class="row" style="--gap:14px;flex-wrap:nowrap;align-items:flex-start"><div class="icon-tile">${icon(ic)}</div>
      <div class="stack" style="--gap:4px"><h3 class="h3" data-i18n="${title}"></h3><p class="small muted" style="margin:0" data-i18n="${text}"></p></div></div>
      ${action}
    </div></section>`;
  const el = h(`<div class="stack">
    ${card('refresh', 'admin.cleanupTitle', 'admin.cleanupText', `<button class="btn btn--sm" data-act="cleanup" data-i18n="admin.run"></button>`, 0)}
    ${card('logout', 'admin.sessionsTitle', 'admin.sessionsText', `<button class="btn btn--sm btn--danger" data-act="sessions" data-i18n="admin.revoke"></button>`, 1)}
    ${card('download', 'admin.exportTitle', 'admin.exportText', `<a class="btn btn--sm" href="/api/admin/maintenance/export" data-i18n="admin.export"></a>`, 2)}
    ${card('upload', 'admin.importTitle', 'admin.importText', `<label class="btn btn--sm"><span data-i18n="admin.import"></span><input type="file" accept="application/json,.json" hidden></label>`, 3)}
  </div>`);
  el.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cleanup') {
      setLoading(btn, true);
      const r = await api('/api/admin/maintenance/cleanup', { method: 'POST' }).finally(() => setLoading(btn, false));
      toast(t('admin.cleanupDone', { shares: r.removedShares, orphans: r.orphans }));
    }
    if (btn.dataset.act === 'sessions' && await confirmDialog({ title: t('admin.sessionsTitle'), body: t('admin.sessionsConfirm'), confirm: t('admin.revoke') })) {
      const r = await api('/api/admin/maintenance/sessions', { method: 'POST' });
      toast(t('admin.sessionsDone', { n: r.revoked }));
    }
  });
  $('input[type=file]', el).addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const r = await api('/api/admin/maintenance/import', { method: 'POST', body: json });
      store.schema = null;
      toast(t('admin.imported', { n: r.imported }));
      setTimeout(() => location.reload(), 900);
    } catch (err) {
      toast(err instanceof SyntaxError ? t('admin.importInvalid') : err.message, 'error');
    }
  });
  panel.append(el);
}

route();
