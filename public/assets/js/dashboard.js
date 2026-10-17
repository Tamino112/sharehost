import { init, t, $, esc, icon, api, formatBytes, formatNumber, toast, setLoading, showError, reveal } from './core.js';
import { statTile, shareRow, emptyState } from './components.js';

const config = await init({ page: 'dashboard', auth: 'user' });
const hour = new Date().getHours();
$('#greeting').textContent = t(hour < 12 ? 'dash.morning' : hour < 18 ? 'dash.afternoon' : 'dash.evening', { name: config.user.username });
$('#new-btn').innerHTML = `${icon('plus')}<span>${esc(t('dash.newUpload'))}</span>`;

async function loadStats() {
  const { user, usage } = await api('/api/account');
  const unlimited = usage.quotaBytes === 0;
  $('#stats').replaceChildren(
    statTile({ label: t('dash.statShares'), ic: 'link', value: formatNumber(usage.shares), i: 0 }),
    statTile({
      label: t('dash.statStorage'), ic: 'drive', value: formatBytes(usage.bytes),
      sub: unlimited ? t('dash.unlimited') : t('dash.ofQuota', { quota: formatBytes(usage.quotaBytes) }),
      meter: unlimited ? null : usage.bytes / usage.quotaBytes, i: 1,
    }),
    statTile({ label: t('dash.statDownloads'), ic: 'download', value: formatNumber(usage.downloads), i: 2 }),
    statTile({ label: t('dash.statRole'), ic: 'shield', value: t(user.role === 'admin' ? 'role.admin' : 'role.user'), sub: user.email || '', i: 3 }),
  );
  $('#account-meta').textContent = `${user.username}${user.email ? ` · ${user.email}` : ''}`;
  reveal();
}

async function loadShares() {
  const { shares } = await api('/api/shares');
  $('#share-count').textContent = formatNumber(shares.length);
  const list = $('#shares');
  if (!shares.length) {
    list.replaceChildren(emptyState('dash.emptyTitle', 'dash.emptyText', 'cloud', `<a class="btn btn--primary btn--sm" href="/">${icon('upload')}<span>${esc(t('dash.newUpload'))}</span></a>`));
    return;
  }
  list.replaceChildren(...shares.map((s, i) => shareRow(s, i, {
    onDelete: async share => {
      await api(`/api/shares/${encodeURIComponent(share.id)}`, { method: 'DELETE' });
      loadStats();
    },
  })));
}

$('#pw-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.currentTarget;
  const box = $('[data-errors]', form);
  const btn = $('button[type=submit]', form);
  if ($('#pw-new').value !== $('#pw-new2').value) return showError(box, t('auth.mismatch'));
  setLoading(btn, true);
  try {
    await api('/api/account/password', { method: 'POST', body: { current: $('#pw-current').value, next: $('#pw-new').value } });
    form.reset();
    showError(box, null);
    toast(t('dash.passwordChanged'));
  } catch (err) {
    showError(box, err.message);
  } finally {
    setLoading(btn, false);
  }
});

await Promise.all([loadStats(), loadShares()]);
if (location.hash === '#account') $('#account').scrollIntoView({ behavior: 'smooth' });
