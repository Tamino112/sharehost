import { init, t, $, $$, icon, api, applyI18n, setLang, state, setLoading, showError, passwordScore, applyAppearance, formatBytes, formatNumber } from './core.js';

const config = await init({ page: 'setup' });
const steps = $$('.setup__step');
const bars = $$('.setup__progress i');
const next = $('#next');
const back = $('#back');
let current = 0;
const LAST = 3; // the step that submits; the one after it is the success screen
let designStyle = config.settings?.designStyle || 'glass';
let background = config.settings?.backgroundMode === 'none' ? 'none' : 'aurora'; // 'aurora' | 'none' | 'image:<preset>'

for (const el of $$('[data-icon]')) el.outerHTML = icon(el.dataset.icon);

function renderButtons() {
  back.hidden = current === 0 || current > LAST;
  $('#foot').hidden = current > LAST;
  back.innerHTML = `${icon('arrowLeft')}<span>${t('common.back')}</span>`;
  const label = current === LAST ? t('setup.finish') : current === 0 ? t('setup.start') : t('common.continue');
  next.innerHTML = `<span>${label}</span>${icon(current === LAST ? 'check' : 'arrowRight')}`;
  bars.forEach((b, i) => b.classList.toggle('is-done', i <= current));
  $('#to-admin').innerHTML = `${icon('settings')}<span>${t('setup.toAdmin')}</span>`;
  for (const b of $$('#lang-switch button')) b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang));
  renderStyle();
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

// Look step: style and background are applied to the whole page right away, and the preview
// below is a scaled copy of the start page built from the same classes, so both show the real result.
const appearance = () => background.startsWith('image:')
  ? { ...config.settings, designStyle, backgroundMode: 'image', backgroundImage: `/assets/backgrounds/${background.slice(6)}.webp` }
  : { ...config.settings, designStyle, backgroundMode: background };
function renderStyle() {
  $('#style-switch').setAttribute('aria-label', t('settings.designStyle'));
  $('#bg-picks').setAttribute('aria-label', t('settings.backgroundMode'));
  for (const b of $$('#style-switch button')) b.setAttribute('aria-pressed', String(b.dataset.stylePick === designStyle));
  for (const b of $$('#bg-picks button')) b.setAttribute('aria-pressed', String(b.dataset.bgPick === background));
  const bg = appearance();
  $('#style-preview').dataset.bg = background;
  $('#pv-media').style.backgroundImage = bg.backgroundMode === 'image' ? `url(${bg.backgroundImage})` : '';
  // The aurora is part of the Glass look; the solid styles show the plain page colour instead.
  $('#style-hint').textContent = t(`setup.style.${designStyle}`) + (background === 'aurora' && designStyle !== 'glass' ? ` ${t('setup.bg.auroraGlassOnly')}` : '');
  $('#pv-add').innerHTML = `${icon('plus')}<span>${t('upload.choose')}</span>${icon('chevronDown')}`;
  const up = config.upload;
  $('#pv-hint').textContent = up ? t('upload.hint', { size: formatBytes(up.maxFileSizeMB * 1048576, 0), count: formatNumber(up.maxFiles) }) : '';
  $('#pv-name').textContent = $('#site-name').value.trim() || 'ShareHost';
}
function applyLook() {
  const apply = () => { applyAppearance(appearance()); renderStyle(); };
  if (document.startViewTransition && document.documentElement.dataset.motion !== 'off') document.startViewTransition(apply);
  else apply();
}
$('#style-switch').addEventListener('click', e => {
  const pick = e.target.closest('button')?.dataset.stylePick;
  if (!pick || pick === designStyle) return;
  designStyle = pick;
  applyLook();
});
$('#bg-picks').addEventListener('click', e => {
  const pick = e.target.closest('button')?.dataset.bgPick;
  if (!pick || pick === background) return;
  background = pick;
  applyLook();
});
$('#pv-icon').innerHTML = icon('cloud');
// Mirror the start page layout: without the intro it is just the centred uploader.
if (!config.settings?.showIntro) { $('#style-preview .hero__copy').remove(); $('#style-preview .hero').classList.add('is-minimal'); }
const preview = $('#style-preview');
new ResizeObserver(([entry]) => preview.style.setProperty('--pv-scale', String(entry.contentRect.width / 880))).observe(preview);

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
  const box = $('[data-errors]', steps[LAST]);
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
        designStyle,
        background,
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
    go(LAST + 1);
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
  else if (current === 2) go(3);
  else if (current === LAST) finish();
});
back.addEventListener('click', () => go(current - 1));
$('#setup-form').addEventListener('submit', e => { e.preventDefault(); next.click(); });
$('#setup-form').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'radio') { e.preventDefault(); next.click(); }
});

renderButtons();
updateStrength();
