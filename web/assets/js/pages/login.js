// 잠금·로그인 화면. 사진·모델 정보는 전혀 보여 주지 않는다.
import { api, ApiError } from '../shared/api.js';
import { el, icon, setBusy, setChildren } from '../shared/ui.js';
import { setShield } from '../shared/privacy.js';

const card = document.getElementById('auth-card');
const params = new URLSearchParams(location.search);

function nextUrl() {
  const next = params.get('next') || '/';
  // 같은 사이트 안의 경로만 허용한다.
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login.html') ? next : '/';
}

// 가이드 시안 _4: 자물쇠 배지 · 큰 제목 · 카드 안 입력 · 아래 보관소 표기
function frame(title, description, form, ...extra) {
  setChildren(card,
    el('div', { class: 'auth-badge', 'aria-hidden': 'true' }, icon('lock', 'icon-24'), el('span', { class: 'auth-badge-mark' }, icon('shield-check'))),
    el('p', { class: 'auth-brand' }, 'Secret Album'),
    el('h1', { id: 'auth-title', class: 'visually-hidden' }, title),
    description ? el('p', { class: 'hint' }, description) : null,
    form ? el('div', { class: 'auth-panel' }, form) : null,
    ...extra);
  card.querySelector('input')?.focus();
}

function passwordField(id, label, autocomplete) {
  const input = el('input', { id, class: 'input', type: 'password', name: 'password', autocomplete, required: true, spellcheck: 'false', placeholder: label });
  const toggle = el('button', { type: 'button', class: 'reveal', 'aria-label': 'Show password', 'aria-pressed': 'false', onclick: () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    toggle.replaceChildren(icon(show ? 'eye-off' : 'eye', 'icon-18'));
    input.focus();
  } }, icon('eye', 'icon-18'));
  return el('div', { class: 'field' }, el('label', { class: 'visually-hidden', for: id }, label), el('div', { class: 'password-wrap' }, input, toggle));
}

function errorBox() {
  return el('div', { class: 'notice notice-error', role: 'alert', hidden: true });
}
function showError(box, error) {
  box.hidden = false;
  box.replaceChildren(icon('circle-alert'), el('span', {}, error.message || 'Something went wrong. Please try again.'));
}

function field(id, label, attrs) {
  return el('div', { class: 'field' }, el('label', { class: 'label', for: id }, label), el('input', { id, class: 'input', required: true, spellcheck: 'false', ...attrs }));
}

async function submitting(form, run) {
  const submit = form.querySelector('[type="submit"]');
  const box = form.querySelector('.notice');
  box.hidden = true;
  setBusy(submit, true, 'Checking…');
  try {
    await run();
  } catch (error) {
    showError(box, error);
    setBusy(submit, false);
    const input = form.querySelector('input[type="password"]') || form.querySelector('input');
    input.select();
    input.focus();
  }
}

function showLogin() {
  const box = errorBox();
  const form = el('form', { novalidate: true, 'aria-labelledby': 'auth-title' }, box,
    field('login-id', 'Username', { name: 'username', autocomplete: 'username', autocapitalize: 'none' }),
    passwordField('password', 'Password', 'current-password'),
    el('button', { type: 'submit', class: 'btn btn-primary btn-block' }, icon('lock'), el('span', {}, 'Sign in')));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const loginId = form.querySelector('#login-id').value.trim();
    const password = form.querySelector('#password').value;
    if (!loginId || !password) { showError(box, { message: 'Enter your username and password.' }); (loginId ? form.querySelector('#password') : form.querySelector('#login-id')).focus(); return; }
    submitting(form, async () => {
      const result = await api('/auth/login', { method: 'POST', body: { login_id: loginId, password }, noRedirect: true });
      route(result.state);
    });
  });
  frame('Sign in', null, form);
}

function showUnlock() {
  const box = errorBox();
  const form = el('form', { novalidate: true, 'aria-labelledby': 'auth-title' }, box,
    passwordField('unlock-password', 'Password', 'current-password'),
    el('button', { type: 'submit', class: 'btn btn-primary btn-block' }, icon('lock'), el('span', {}, 'Unlock')));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitting(form, async () => {
      const result = await api('/auth/unlock', { method: 'POST', body: { password: form.querySelector('#unlock-password').value }, noRedirect: true });
      route(result.state);
    });
  });
  frame('Screen locked', 'Screen locked. Enter your password to return to where you were.', form, otherAccount());
}

function otherAccount() {
  return el('div', { class: 'auth-links' }, el('button', { type: 'button', onclick: async () => {
    try { await api('/auth/logout', { method: 'POST', noRedirect: true }); } catch { /* 이미 끊김 */ }
    showLogin();
  } }, 'Sign in with a different account'));
}

function errorAfter(error) {
  return el('div', {}, el('div', { class: 'notice notice-error', role: 'alert' }, icon('circle-alert'), el('span', {}, error.message)),
    el('button', { type: 'button', class: 'btn btn-outline btn-block', onclick: start }, 'Try again'));
}

function route(state) {
  if (state === 'active') location.replace(nextUrl());
  else if (state === 'locked') showUnlock();
  else showLogin();
}

async function start() {
  try {
    const me = await api('/auth/me', { noRedirect: true });
    route(me.state);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) showLogin();
    else frame('Can\'t connect', null, null, errorAfter(error));
  }
}

document.getElementById('auth-hide')?.addEventListener('click', () => setShield(true));
start();
