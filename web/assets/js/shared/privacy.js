// 화면 가리기(Shift+H), 백그라운드 가림, 자동 잠금, 썸네일 가리기.
import { api, loginUrl } from './api.js';
import { el, toast } from './ui.js';

let shield;
let idleTimer;
let warnTimer;
let closeWarning;
let idleMs = 15 * 60 * 1000;

export function isShielded() {
  return document.documentElement.dataset.shielded === 'true';
}

export function setShield(on) {
  if (!shield) {
    shield = el('div', { class: 'privacy-shield', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Screen hidden' },
      el('div', { class: 'inner' },
        el('div', { class: 'brand-mark' }, 'Secret Album'),
        el('p', {}, 'The screen is hidden. Press Shift+H or use the button below to show it again.'),
        el('button', { type: 'button', class: 'btn btn-outline', onclick: () => setShield(false) }, 'Show screen')));
    document.body.append(shield);
  }
  shield.hidden = !on;
  document.documentElement.dataset.shielded = on ? 'true' : 'false';
  if (on) shield.querySelector('button').focus();
}

export async function lockNow() {
  try { await api('/auth/lock', { method: 'POST', noRedirect: true }); } catch { /* 서버가 없어도 화면은 잠근다 */ }
  location.replace(loginUrl('locked'));
}

function resetIdle() {
  clearTimeout(idleTimer);
  clearTimeout(warnTimer);
  closeWarning?.();
  closeWarning = null;
  if (idleMs <= 0) return;
  warnTimer = setTimeout(() => {
    closeWarning = toast('The screen will lock in 30 seconds. Move the mouse or press a key to stay.', { duration: 30000 });
  }, Math.max(0, idleMs - 30000));
  idleTimer = setTimeout(lockNow, idleMs);
}

export function setBlurThumbnails(on) {
  document.documentElement.dataset.blur = on ? 'true' : 'false';
}

export function initPrivacy({ idleMinutes = 15, blurThumbnails = false } = {}) {
  idleMs = idleMinutes * 60 * 1000;
  setBlurThumbnails(blurThumbnails);
  document.addEventListener('keydown', (event) => {
    if (event.shiftKey && (event.key === 'H' || event.key === 'h') && !event.target.closest?.('input, textarea, select, [contenteditable]')) {
      event.preventDefault();
      setShield(!isShielded());
    }
  });
  // 다른 탭·앱으로 가면 즉시 가린다 (앱 전환 미리보기 노출 방지).
  // 돌아오면 자동으로 걷는다. 직접 가린 화면(Shift+H)은 그대로 둔다.
  let hiddenByBackground = false;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (!isShielded()) { hiddenByBackground = true; setShield(true); }
    } else if (hiddenByBackground) {
      hiddenByBackground = false;
      setShield(false);
    }
  });
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    window.addEventListener(type, resetIdle, { passive: true, capture: true });
  }
  // 썸네일 가리기 모드: 누른 사진만 선명하게
  document.addEventListener('click', (event) => {
    if (document.documentElement.dataset.blur !== 'true') return;
    const frame = event.target.closest?.('.photo-frame');
    if (frame && !frame.classList.contains('revealed') && !frame.closest('[data-editing="true"]')) {
      frame.classList.add('revealed');
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  resetIdle();
}
