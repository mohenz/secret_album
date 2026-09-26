// 잠금·로그인 화면. 사진·모델 정보는 전혀 보여 주지 않는다.
import { api, ApiError } from '../shared/api.js';
import { el, icon, setBusy } from '../shared/ui.js';

const card = document.getElementById('auth-card');
const params = new URLSearchParams(location.search);

function nextUrl() {
  const next = params.get('next') || '/';
  // 같은 사이트 안의 경로만 허용한다.
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login.html') ? next : '/';
}

function frame(title, description, ...content) {
  card.replaceChildren(
    el('div', { class: 'auth-brand' }, '비밀앨범'),
    el('h1', { id: 'auth-title' }, title),
    description ? el('p', { class: 'hint' }, description) : null,
    ...content);
  card.querySelector('input')?.focus();
}

function errorBox() {
  return el('div', { class: 'notice notice-error', role: 'alert', hidden: true });
}
function showError(box, error) {
  box.hidden = false;
  box.replaceChildren(icon('circle-alert'), el('span', {}, error.message || '문제가 생겼습니다. 다시 시도해 주세요.'));
}

function field(id, label, attrs) {
  return el('div', { class: 'field' }, el('label', { class: 'label', for: id }, label), el('input', { id, class: 'input', required: true, spellcheck: 'false', ...attrs }));
}

async function submitting(form, run) {
  const submit = form.querySelector('[type="submit"]');
  const box = form.querySelector('.notice');
  box.hidden = true;
  setBusy(submit, true, '확인 중…');
  try {
    await run();
  } catch (error) {
    showError(box, error);
    setBusy(submit, false);
    const input = form.querySelector('input');
    input.select();
    input.focus();
  }
}

// ------------------------------------------------ 단계별 화면
function showLogin() {
  const box = errorBox();
  const form = el('form', { novalidate: true, 'aria-labelledby': 'auth-title' }, box,
    field('login-id', '아이디', { name: 'username', autocomplete: 'username', autocapitalize: 'none' }),
    field('password', '비밀번호', { name: 'password', type: 'password', autocomplete: 'current-password' }),
    el('button', { type: 'submit', class: 'btn btn-primary btn-block' }, '로그인'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const loginId = form.querySelector('#login-id').value.trim();
    const password = form.querySelector('#password').value;
    if (!loginId || !password) { showError(box, { message: '아이디와 비밀번호를 입력해 주세요.' }); (loginId ? form.querySelector('#password') : form.querySelector('#login-id')).focus(); return; }
    submitting(form, async () => {
      const result = await api('/auth/login', { method: 'POST', body: { login_id: loginId, password }, noRedirect: true });
      route(result.state);
    });
  });
  frame('로그인', null, form);
}

function showOtp() {
  const box = errorBox();
  const form = el('form', { novalidate: true, 'aria-labelledby': 'auth-title' }, box,
    field('otp', '인증 코드', { name: 'otp', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '11' }),
    el('p', { class: 'hint' }, '인증 앱의 6자리 숫자를 입력합니다. 휴대폰을 쓸 수 없으면 복구 코드(예: abcd-2345)를 입력해 주세요.'),
    el('button', { type: 'submit', class: 'btn btn-primary btn-block' }, '인증'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitting(form, async () => {
      await api('/auth/otp', { method: 'POST', body: { code: form.querySelector('#otp').value }, noRedirect: true });
      location.replace(nextUrl());
    });
  });
  frame('2단계 인증', null, form, otherAccount());
}

async function showTotpSetup() {
  frame('2단계 인증 등록', '처음 한 번만 등록합니다.', el('p', { class: 'text-meta', role: 'status' }, '등록 정보를 만드는 중…'));
  let setup;
  try { setup = await api('/auth/totp/setup', { noRedirect: true }); } catch (error) { frame('2단계 인증 등록', null, errorAfter(error)); return; }
  const qr = el('div', { class: 'qr-box' });
  if (window.qrcode) {
    const code = window.qrcode(0, 'M');
    code.addData(setup.uri);
    code.make();
    qr.append(el('img', { src: code.createDataURL(6, 0), alt: '인증 앱 등록용 QR 코드', width: 200, height: 200 }));
  }
  qr.append(el('p', { class: 'hint' }, 'QR 코드를 찍을 수 없으면 아래 키를 인증 앱에 직접 입력합니다.'), el('div', { class: 'secret-text', 'aria-label': '등록 키' }, setup.secret.replace(/(.{4})/g, '$1 ').trim()));
  const box = errorBox();
  const form = el('form', { novalidate: true, 'aria-labelledby': 'auth-title' }, box,
    field('otp-setup', '인증 앱에 표시된 6자리 숫자', { name: 'otp', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7' }),
    el('button', { type: 'submit', class: 'btn btn-primary btn-block' }, '등록 완료'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitting(form, async () => {
      const result = await api('/auth/totp/enable', { method: 'POST', body: { code: form.querySelector('#otp-setup').value }, noRedirect: true });
      showRecoveryCodes(result.recovery_codes);
    });
  });
  frame('2단계 인증 등록', 'Google Authenticator 같은 인증 앱으로 QR 코드를 찍은 뒤, 표시된 숫자를 입력합니다.', qr, form, otherAccount());
}

function showRecoveryCodes(codes) {
  const confirm = el('input', { type: 'checkbox', id: 'saved' });
  const go = el('button', { type: 'button', class: 'btn btn-primary btn-block', disabled: true, onclick: () => location.replace(nextUrl()) }, '계속');
  confirm.addEventListener('change', () => { go.disabled = !confirm.checked; });
  frame('복구 코드', '휴대폰을 잃어버렸을 때 인증 코드 대신 쓰는 1회용 코드입니다. 지금만 표시되니 안전한 곳에 적어 두세요.',
    el('ol', { class: 'recovery-list' }, codes.map((code) => el('li', {}, code))),
    el('label', { class: 'checkbox-row', for: 'saved' }, confirm, el('span', {}, '복구 코드를 안전한 곳에 보관했습니다.')),
    go);
  confirm.focus();
}

function showUnlock() {
  const box = errorBox();
  const form = el('form', { novalidate: true, 'aria-labelledby': 'auth-title' }, box,
    field('unlock-password', '비밀번호', { name: 'password', type: 'password', autocomplete: 'current-password' }),
    el('button', { type: 'submit', class: 'btn btn-primary btn-block' }, '잠금 해제'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitting(form, async () => {
      const result = await api('/auth/unlock', { method: 'POST', body: { password: form.querySelector('#unlock-password').value }, noRedirect: true });
      if (result.state === 'active') location.replace(nextUrl());
      else route(result.state);
    });
  });
  frame('화면이 잠겼습니다', '비밀번호를 다시 입력하면 보던 화면으로 돌아갑니다.', form, otherAccount());
}

function otherAccount() {
  return el('div', { class: 'auth-links' }, el('button', { type: 'button', onclick: async () => {
    try { await api('/auth/logout', { method: 'POST', noRedirect: true }); } catch { /* 이미 끊김 */ }
    showLogin();
  } }, '다른 계정으로 로그인'));
}

function errorAfter(error) {
  return el('div', {}, el('div', { class: 'notice notice-error', role: 'alert' }, icon('circle-alert'), el('span', {}, error.message)),
    el('button', { type: 'button', class: 'btn btn-outline btn-block', onclick: start }, '다시 시도'));
}

function route(state) {
  if (state === 'active') location.replace(nextUrl());
  else if (state === 'mfa_required') showOtp();
  else if (state === 'totp_setup_required') showTotpSetup();
  else if (state === 'locked') showUnlock();
  else showLogin();
}

async function start() {
  try {
    const me = await api('/auth/me', { noRedirect: true });
    route(me.state);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) showLogin();
    else frame('연결할 수 없습니다', null, errorAfter(error));
  }
}

start();
