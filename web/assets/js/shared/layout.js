// 모든 앱 화면의 시작점: 세션 확인 → 헤더 → 프라이버시 기능 → 검색.
import { api, ApiError, goLogin, mediaUrl } from './api.js';
import { initPrivacy, lockNow, setShield } from './privacy.js';
import { debounce, el, formatNumber, icon, iconButton, joinMeta, openMenu, showDialog, toastError } from './ui.js';

export let me = null;

export function setTheme(value) {
  try { localStorage.setItem('album-theme', value); } catch { /* 이 기기에 저장할 수 없음 */ }
  if (value === 'light' || (value === 'system' && matchMedia('(prefers-color-scheme: light)').matches)) document.documentElement.dataset.theme = 'light';
  else document.documentElement.dataset.theme = 'dark';
}

function currentTheme() {
  try { return localStorage.getItem('album-theme') || 'dark'; } catch { return 'dark'; }
}

const NAV = [
  ['albums', '/pages/albums.html', '앨범'],
  ['models', '/pages/models.html', '모델'],
  ['favorites', '/pages/favorites.html', '즐겨찾기'],
];

function renderHeader(active, overPhoto) {
  const header = document.getElementById('site-header') || el('header', { id: 'site-header' });
  header.className = 'site-header';
  header.dataset.overPhoto = overPhoto ? 'true' : 'false';
  header.dataset.solid = overPhoto ? 'false' : 'true';
  const menuButton = iconButton('ellipsis', '메뉴 열기', () => openMenu(menuButton, menuItems()));
  menuButton.setAttribute('aria-haspopup', 'menu');
  menuButton.setAttribute('aria-expanded', 'false');
  header.replaceChildren(
    el('a', { class: 'brand', href: '/' }, '비밀앨범'),
    el('nav', { class: 'site-nav', 'aria-label': '주요 메뉴' },
      NAV.map(([key, href, label]) => el('a', { href, 'aria-current': key === active ? 'page' : undefined }, label))),
    el('div', { class: 'header-actions' },
      iconButton('search', '검색', openSearch),
      iconButton('eye-off', '화면 가리기 (Shift+H)', () => setShield(true)),
      menuButton));
  if (!header.isConnected) document.body.prepend(header);

  // 아래로 스크롤하면 숨기고 위로 스크롤하면 다시 보인다.
  let lastY = scrollY;
  addEventListener('scroll', () => {
    const y = scrollY;
    header.dataset.hidden = y > lastY && y > 120 && !header.contains(document.activeElement) ? 'true' : 'false';
    if (overPhoto) {
      const solid = y > innerHeight * 0.6;
      header.dataset.overPhoto = solid ? 'false' : 'true';
      header.dataset.solid = solid ? 'true' : 'false';
    }
    lastY = y;
  }, { passive: true });
  header.addEventListener('focusin', () => { header.dataset.hidden = 'false'; });
}

function menuItems() {
  const items = [];
  if (window.matchMedia('(max-width: 767px)').matches) {
    for (const [, href, label] of NAV) items.push({ label, href });
    items.push('separator');
  }
  if (me?.user.role === 'owner') {
    items.push({ label: '사진 업로드', icon: 'upload', href: '/manage/upload.html' });
    items.push({ label: '휴지통', icon: 'trash-2', href: '/manage/trash.html' });
    items.push({ label: '설정', icon: 'settings', href: '/manage/settings.html' });
    items.push('separator');
  }
  const theme = currentTheme();
  items.push({ label: theme === 'light' ? '다크 테마로 보기' : '라이트 테마로 보기', icon: theme === 'light' ? 'moon' : 'sun', onSelect: () => setTheme(theme === 'light' ? 'dark' : 'light') });
  items.push({ label: '지금 잠그기', icon: 'lock', onSelect: lockNow });
  items.push({ label: '로그아웃', icon: 'log-out', onSelect: logout });
  return items;
}

async function logout() {
  try { await api('/auth/logout', { method: 'POST', noRedirect: true }); } catch { /* 이미 끊긴 세션 */ }
  location.replace('/login.html');
}

// ------------------------------------------------ 빠른 검색 (전체 화면)
function openSearch() {
  const input = el('input', { class: 'input search-input', type: 'search', id: 'quick-search', autocomplete: 'off', spellcheck: 'false', placeholder: '모델, 앨범, 태그' });
  const results = el('div', { class: 'search-results', 'aria-live': 'polite' });
  let controller;
  const run = debounce(async () => {
    const q = input.value.trim();
    controller?.abort();
    if (!q) { results.replaceChildren(); return; }
    controller = new AbortController();
    try {
      const data = await api(`/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
      results.replaceChildren(...renderQuickResults(data));
    } catch (error) { toastError(error); }
  }, 250);
  input.addEventListener('input', run);
  const form = el('form', { class: 'dialog-body', role: 'search', onsubmit: (event) => {
    event.preventDefault();
    const q = input.value.trim();
    if (q) location.href = `/pages/search.html?q=${encodeURIComponent(q)}`;
  } },
  el('div', { class: 'page-head' }, el('label', { class: 'label', for: 'quick-search' }, '검색'), iconButton('x', '검색 닫기', () => dialog.close())),
  input, results);
  const dialog = el('dialog', { class: 'dialog search-dialog', 'aria-label': '검색' }, form);
  showDialog(dialog);
  input.focus();
}

function thumb(id) {
  const frame = el('div', { class: 'photo-frame' });
  if (id) {
    const img = el('img', { src: mediaUrl(id, 'thumb'), alt: '', loading: 'lazy', decoding: 'async', width: 44, height: 44 });
    img.addEventListener('load', () => img.classList.add('loaded'));
    frame.append(img);
  }
  return frame;
}

function renderQuickResults(data) {
  const groups = [];
  if (data.models.length) groups.push(el('section', { class: 'search-group' }, el('h2', {}, '모델'),
    data.models.slice(0, 5).map((m) => el('a', { class: 'search-item', href: `/pages/model.html?id=${m.id}` }, thumb(m.cover?.id), el('span', { class: 'name' }, m.name)))));
  if (data.albums.length) groups.push(el('section', { class: 'search-group' }, el('h2', {}, '앨범'),
    data.albums.slice(0, 5).map((a) => el('a', { class: 'search-item', href: `/pages/album.html?id=${a.id}` }, thumb(a.cover?.id),
      el('span', { class: 'name' }, a.title, el('span', { class: 'text-meta' }, ` ${joinMeta(a.model_name)}`))))));
  if (data.tags.length) groups.push(el('section', { class: 'search-group' }, el('h2', {}, '태그'),
    el('div', { class: 'chip-row' }, data.tags.slice(0, 12).map((t) => el('a', { class: 'tag-chip', href: `/pages/search.html?q=${encodeURIComponent(t.name)}` }, icon('tag'), t.name, el('span', { class: 'text-meta' }, formatNumber(t.count)))))));
  if (!groups.length) return [el('p', { class: 'text-ui', role: 'status' }, `‘${data.query}’에 맞는 사진이 없습니다. 다른 검색어를 입력해 보세요.`)];
  groups.push(el('a', { class: 'btn btn-outline', href: `/pages/search.html?q=${encodeURIComponent(data.query)}` }, '모든 결과 보기'));
  return groups;
}

// ------------------------------------------------ 시작
export async function boot({ active = '', overPhoto = false, ownerOnly = false } = {}) {
  try {
    me = await api('/auth/me', { noRedirect: true });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) { goLogin(error.code); return new Promise(() => {}); }
    throw error;
  }
  if (me.state !== 'active') { goLogin(me.state); return new Promise(() => {}); }
  renderHeader(active, overPhoto);
  initPrivacy({ idleMinutes: me.settings.session_idle_minutes || 15, blurThumbnails: !!me.settings.blur_thumbnails });
  if (ownerOnly && me.user.role !== 'owner') {
    document.getElementById('main').replaceChildren(el('div', { class: 'empty' }, icon('lock', 'icon-32'), el('p', { class: 'text-card' }, '이 화면은 소유자만 볼 수 있습니다.')));
    return new Promise(() => {});
  }
  return me;
}

export const isOwner = () => me?.user.role === 'owner';
