import { init, t, $, $$, icon, api, applyI18n, setLang, state, setLoading, showError, passwordScore } from './core.js';

const config = await init({ page: 'setup' });
const steps = $$('.setup__step');
const bars = $$('.setup__progress i');
const next = $('#next');
const back = $('#back');
let current = 0;

for (const el of $$('[data-icon]')) el.outerHTML = icon(el.dataset.icon);

function renderButtons() {
  back.hidden = current === 0 || current === 3;
  $('#foot').hidden = current === 3;
  back.innerHTML = `${icon('arrowLeft')}<span>${t('common.back')}</span>`;
  const label = current === 2 ? t('setup.finish') : current === 0 ? t('setup.start') : t('common.continue');
  next.innerHTML = `<span>${label}</span>${icon(current === 2 ? 'check' : 'arrowRight')}`;
  bars.forEach((b, i) => b.classList.toggle('is-done', i <= current));
  $('#to-admin').innerHTML = `${icon('settings')}<span>${t('setup.toAdmin')}</span>`;
  for (const b of $$('#lang-switch button')) b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang));
}

function go(to) {
  const from = steps[current];
  const target = steps[to];
  const backwards = to < current;
  for (const s of steps) s.classList.toggle('is-back', backwards);
  from.classList.remove('is-active');
  from.classList.add('is-leaving');
  from.addEventListener('animationend', () => from.classList.remove('is-leaving'), { once: true });
  target.classList.add('is-active');
  current = to;
  renderButtons();
  setTimeout(() => $('input:not([type=radio]):not([type=checkbox])', target)?.focus(), 350);
}

$('#lang-switch').addEventListener('click', e => {
  const lang = e.target.closest('button')?.dataset.lang;
  if (!lang) return;
  setLang(lang);
  applyI18n();
  renderButtons();
  updateStrength();
});

const pw = $('#password');
function updateStrength() {
  $('#strength').dataset.score = passwordScore(pw.value);
  $('#pw-hint').textContent = t('auth.minLength', { n: config.minPasswordLength });
}
pw.addEventListener('input', updateStrength);

function validateAccount() {
  const box = $('[data-errors]', steps[1]);
  const username = $('#username').value.trim();
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return showError(box, t('err.invalid_username')), false;
  const email = $('#email').value.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError(box, t('err.invalid_email')), false;
  if (pw.value.length < config.minPasswordLength) return showError(box, t('auth.minLength', { n: config.minPasswordLength })), false;
  if (pw.value !== $('#password2').value) return showError(box, t('auth.mismatch')), false;
  showError(box, null);
  return true;
}

async function finish() {
  const box = $('[data-errors]', steps[2]);
  setLoading(next, true);
  try {
    await api('/api/setup', {
      method: 'POST',
      body: {
        username: $('#username').value.trim(),
        email: $('#email').value.trim(),
        password: pw.value,
        siteName: $('#site-name').value.trim() || 'ShareHost',
        registrationMode: $('input[name=reg]:checked').value,
        guestUploads: $('#guest').checked,
        language: state.lang,
      },
    });
    $('#done-badge').innerHTML = '<svg class="check-draw" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19.5 7"/></svg>';
    for (let i = 0; i < 22; i++) {
      const p = document.createElement('i');
      p.style.setProperty('--r', `${i * 16.4}deg`);
      p.style.setProperty('--dist', `${80 + Math.random() * 70}px`);
      if (i % 3 === 0) p.style.background = 'var(--ink)';
      $('#burst').append(p);
    }
    go(3);
  } catch (err) {
    if (err.code === 'setup_done') return location.replace('/');
    const accountError = ['invalid_username', 'invalid_email', 'weak_password'].includes(err.code);
    if (accountError) { go(1); showError($('[data-errors]', steps[1]), err.message); } else showError(box, err.message);
  } finally {
    setLoading(next, false);
  }
}

next.addEventListener('click', () => {
  if (current === 0) go(1);
  else if (current === 1 && validateAccount()) go(2);
  else if (current === 2) finish();
});
back.addEventListener('click', () => go(current - 1));
$('#setup-form').addEventListener('submit', e => { e.preventDefault(); next.click(); });
$('#setup-form').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'radio') { e.preventDefault(); next.click(); }
});

renderButtons();
updateStrength();
