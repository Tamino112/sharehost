import { init, t, $, $$, icon, api, setLoading, showError, passwordScore } from './core.js';

const page = document.body.dataset.page;
const config = await init({ page });
const params = new URLSearchParams(location.search);
const nextUrl = (params.get('next') || '').startsWith('/') && !params.get('next').startsWith('//') ? params.get('next') : null;

for (const el of $$('[data-icon]')) el.innerHTML = icon(el.dataset.icon);
if (config.user) location.replace(nextUrl || '/dashboard');

const form = $('#form');
const errors = $('[data-errors]', form);
const submit = $('button[type=submit]', form);

if (page === 'login') {
  $('#alt').hidden = config.registrationMode === 'closed';
  form.addEventListener('submit', async e => {
    e.preventDefault();
    setLoading(submit, true);
    try {
      const { user } = await api('/api/auth/login', { method: 'POST', body: { username: $('#username').value.trim(), password: $('#password').value } });
      location.href = nextUrl || (user.role === 'admin' ? '/admin' : '/dashboard');
    } catch (err) {
      showError(errors, err.message);
      setLoading(submit, false);
    }
  });
}

if (page === 'register') {
  if (config.registrationMode === 'closed') {
    form.hidden = true;
    $('#closed').hidden = false;
  }
  if (config.registrationMode === 'invite') {
    $('#invite-field').hidden = false;
    $('#invite').value = params.get('invite') || '';
  }
  const pw = $('#password');
  $('#pw-hint').textContent = t('auth.minLength', { n: config.minPasswordLength });
  pw.addEventListener('input', () => { $('#strength').dataset.score = passwordScore(pw.value); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (pw.value.length < config.minPasswordLength) return showError(errors, t('auth.minLength', { n: config.minPasswordLength }));
    setLoading(submit, true);
    try {
      await api('/api/auth/register', {
        method: 'POST',
        body: { username: $('#username').value.trim(), email: $('#email').value.trim(), password: pw.value, inviteCode: $('#invite').value.trim() },
      });
      location.href = '/dashboard';
    } catch (err) {
      showError(errors, err.message);
      setLoading(submit, false);
    }
  });
}
