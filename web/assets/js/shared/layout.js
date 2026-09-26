// 모든 앱 화면의 시작점: 세션 확인 → 헤더 → 프라이버시 기능 → 검색.
import { api, ApiError, goLogin, mediaUrl } from './api.js';
import { initPrivacy, lockNow, setShield } from './privacy.js';
import { debounce, el, formatBytes, formatNumber, icon, iconButton, joinMeta, openMenu, showDialog, toastError } from './ui.js';

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
  ['albums', '/pages/albums.html', 'Albums'],
  ['models', '/pages/models.html', 'Models'],
  ['favorites', '/pages/favorites.html', 'Favorites'],
];

function renderHeader(active, overPhoto, onSlideshow) {
  const header = document.getElementById('site-header') || el('header', { id: 'site-header' });
  header.className = 'site-header';
  header.dataset.overPhoto = overPhoto ? 'true' : 'false';
  header.dataset.solid = overPhoto ? 'false' : 'true';
  const menuButton = iconButton('ellipsis-vertical', 'Open menu', () => openMenu(menuButton, menuItems()));
  menuButton.setAttribute('aria-haspopup', 'menu');
  menuButton.setAttribute('aria-expanded', 'false');
  const initial = (me?.user.display_name || me?.user.login_id || '?').trim().charAt(0).toUpperCase();
  const accountButton = el('button', { type: 'button', class: 'avatar-button', 'aria-label': `Account: ${me?.user.display_name || ''}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openMenu(accountButton, accountItems()) },
    el('span', { class: 'avatar', 'aria-hidden': 'true' }, initial));
  header.replaceChildren(
    el('a', { class: 'brand', href: '/' }, icon('lock', 'icon-18'), el('span', {}, 'Secret Album')),
    el('nav', { class: 'site-nav', 'aria-label': 'Main' },
      NAV.map(([key, href, label]) => el('a', { href, 'aria-current': key === active ? 'page' : undefined }, label))),
    el('div', { class: 'header-actions' },
      iconButton('search', 'Search', openSearch),
      iconButton('eye-off', 'Hide screen (Shift+H)', () => setShield(true)),
      onSlideshow ? iconButton('square-play', 'Start slideshow', onSlideshow) : null,
      menuButton,
      accountButton));
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
    items.push({ label: 'Studio', icon: 'layout-grid', href: '/manage/index.html' });
    items.push({ label: 'Quick upload', icon: 'upload', href: '/manage/upload.html' });
    items.push({ label: 'Trash', icon: 'trash-2', href: '/manage/trash.html' });
    items.push({ label: 'Settings', icon: 'settings', href: '/manage/settings.html' });
    items.push('separator');
  }
  const theme = currentTheme();
  items.push({ label: theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme', icon: theme === 'light' ? 'moon' : 'sun', onSelect: () => setTheme(theme === 'light' ? 'dark' : 'light') });
  return items;
}

function accountItems() {
  return [
    { label: `${me?.user.display_name || ''} (${me?.user.login_id || ''})`, icon: 'circle-user', href: me?.user.role === 'owner' ? '/manage/settings.html' : undefined },
    'separator',
    { label: 'Lock now', icon: 'lock', onSelect: lockNow },
    { label: 'Sign out', icon: 'log-out', onSelect: logout },
  ];
}

async function logout() {
  try { await api('/auth/logout', { method: 'POST', noRedirect: true }); } catch { /* 이미 끊긴 세션 */ }
  location.replace('/login.html');
}

// ------------------------------------------------ 빠른 검색 (전체 화면)
function openSearch() {
  const input = el('input', { class: 'input search-input', type: 'search', id: 'quick-search', autocomplete: 'off', spellcheck: 'false', placeholder: 'Models, albums, tags' });
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
  el('div', { class: 'page-head' }, el('label', { class: 'label', for: 'quick-search' }, 'Search'), iconButton('x', 'Close search', () => dialog.close())),
  input, results);
  const dialog = el('dialog', { class: 'dialog search-dialog', 'aria-label': 'Search' }, form);
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
  if (data.models.length) groups.push(el('section', { class: 'search-group' }, el('h2', {}, 'Models'),
    data.models.slice(0, 5).map((m) => el('a', { class: 'search-item', href: `/pages/model.html?id=${m.id}` }, thumb(m.cover?.id), el('span', { class: 'name' }, m.name)))));
  if (data.albums.length) groups.push(el('section', { class: 'search-group' }, el('h2', {}, 'Albums'),
    data.albums.slice(0, 5).map((a) => el('a', { class: 'search-item', href: `/pages/album.html?id=${a.id}` }, thumb(a.cover?.id),
      el('span', { class: 'name' }, a.title, el('span', { class: 'text-meta' }, ` ${joinMeta(a.model_name)}`))))));
  if (data.tags.length) groups.push(el('section', { class: 'search-group' }, el('h2', {}, 'Tags'),
    el('div', { class: 'chip-row' }, data.tags.slice(0, 12).map((t) => el('a', { class: 'tag-chip', href: `/pages/search.html?q=${encodeURIComponent(t.name)}` }, icon('tag'), t.name, el('span', { class: 'text-meta' }, formatNumber(t.count)))))));
  if (!groups.length) return [el('p', { class: 'text-ui', role: 'status' }, `No results for “${data.query}”. Try a different search.`)];
  groups.push(el('a', { class: 'btn btn-outline', href: `/pages/search.html?q=${encodeURIComponent(data.query)}` }, 'See all results'));
  return groups;
}

// ------------------------------------------------ 시작
// ------------------------------------------------ Studio (관리 영역, 가이드 시안 _5~_8)
const STUDIO_NAV = [
  ['overview', '/manage/index.html', 'Archive overview', 'layout-grid'],
  ['photos', '/manage/photos.html', 'Photo library', 'images'],
  ['upload', '/manage/upload.html', 'Quick upload', 'upload'],
  ['trash', '/manage/trash.html', 'Trash', 'trash-2'],
  ['settings', '/manage/settings.html', 'Settings', 'settings'],
];

function renderStudio(active) {
  document.body.classList.add('studio');
  document.getElementById('site-header')?.remove();
  const main = document.getElementById('main');
  const current = STUDIO_NAV.find(([key]) => key === active);
  const storage = el('p', { class: 'studio-storage', 'data-numeric': true }, 'Storage …');
  const sidebar = el('aside', { class: 'studio-sidebar', id: 'studio-sidebar', 'aria-label': 'Studio' },
    el('a', { class: 'studio-brand', href: '/manage/index.html' }, icon('lock', 'icon-20'), el('span', {}, 'Secret Album'), el('span', { class: 'studio-tag' }, 'STUDIO')),
    el('nav', { class: 'studio-nav', 'aria-label': 'Studio menu' },
      STUDIO_NAV.map(([key, href, label, iconName]) => el('a', { href, 'aria-current': key === active ? 'page' : undefined }, icon(iconName, 'icon-18'), el('span', {}, label)))),
    el('div', { class: 'studio-foot' },
      el('a', { class: 'studio-back', href: '/' }, icon('arrow-left'), el('span', {}, 'Back to exhibition'), el('span', { class: 'hint' }, 'View')),
      storage));
  const accountButton = el('button', { type: 'button', class: 'avatar-button', 'aria-label': `Account: ${me?.user.display_name || ''}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openMenu(accountButton, accountItems()) },
    el('span', { class: 'avatar', 'aria-hidden': 'true' }, (me?.user.display_name || '?').trim().charAt(0).toUpperCase()));
  const menuToggle = iconButton('ellipsis-vertical', 'Open studio menu', () => document.body.classList.toggle('studio-open'));
  menuToggle.classList.add('studio-menu-toggle');
  const topbar = el('header', { class: 'studio-topbar' },
    menuToggle,
    el('nav', { class: 'breadcrumb', 'aria-label': 'Breadcrumb' }, el('a', { href: '/manage/index.html' }, 'Studio'), el('span', { 'aria-hidden': 'true' }, '/'), el('span', { 'aria-current': 'page' }, current ? current[2] : '')),
    el('div', { class: 'studio-top-actions' },
      el('span', { class: 'session-pill' }, el('span', { class: 'dot', 'aria-hidden': 'true' }), 'Secure session'),
      iconButton('eye-off', 'Hide screen (Shift+H)', () => setShield(true)),
      accountButton));
  const shell = el('div', { class: 'studio-shell' }, sidebar, el('div', { class: 'studio-body' }, topbar, main));
  document.body.insertBefore(shell, document.body.querySelector('script') || null);
  document.body.addEventListener('click', (event) => { if (document.body.classList.contains('studio-open') && !event.target.closest('#studio-sidebar, .studio-menu-toggle')) document.body.classList.remove('studio-open'); });
  api('/storage').then((s) => { storage.textContent = `Storage ${formatBytes(s.disk.used)} / ${formatBytes(s.disk.total)}`; }).catch(() => { storage.textContent = ''; });
}

export async function boot({ active = '', overPhoto = false, ownerOnly = false, onSlideshow = null, studio = false } = {}) {
  try {
    me = await api('/auth/me', { noRedirect: true });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) { goLogin(error.code); return new Promise(() => {}); }
    throw error;
  }
  if (me.state !== 'active') { goLogin(me.state); return new Promise(() => {}); }
  if (studio) renderStudio(active); else renderHeader(active, overPhoto, onSlideshow);
  initPrivacy({ idleMinutes: me.settings.session_idle_minutes || 15, blurThumbnails: !!me.settings.blur_thumbnails });
  if (ownerOnly && me.user.role !== 'owner') {
    document.getElementById('main').replaceChildren(el('div', { class: 'empty' }, icon('lock', 'icon-32'), el('p', { class: 'text-card' }, 'Only the owner can view this page.')));
    return new Promise(() => {});
  }
  return me;
}

export const isOwner = () => me?.user.role === 'owner';
