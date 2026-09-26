// Studio 사진 관리 (가이드 시안 _5·_8): 모델 탭 · 검색·앨범·정렬 필터 · 카드/목록 보기 · 선택 · 일괄 작업
import { api, mediaUrl } from '../shared/api.js';
import { modelForm } from '../shared/forms.js';
import { photoFrame } from '../shared/gallery.js';
import { boot } from '../shared/layout.js';
import {
  button, debounce, el, emptyState, errorState, formatBytes, formatDate, formatNumber, icon, iconButton, joinMeta, loadingState, plural, setChildren, showDialog, toast, toastError,
} from '../shared/ui.js';
import { openViewer } from '../shared/viewer.js';

const main = document.getElementById('main');
const me = await boot({ ownerOnly: true, studio: true, active: 'photos' });
main.className = 'manage-page';

const PAGE = 120;
const params = new URLSearchParams(location.search);
const state = {
  model: params.get('model') || '',
  album: params.get('album') || '',
  q: params.get('q') || '',
  sort: params.get('sort') || 'shot_desc',
  view: params.get('view') === 'list' ? 'list' : 'card',
};
let models = [];
let albums = [];
let items = [];
let total = 0;
let grandTotal = 0;
const selected = new Set();
let bulkBar = null;

function syncUrl() {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(state)) {
    if (value && !(key === 'sort' && value === 'shot_desc') && !(key === 'view' && value === 'card')) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  history.replaceState(null, '', url);
}

function exifLine(item) {
  const e = item.exposure || {};
  const mp = item.w && item.h ? `${Math.max(1, Math.round((item.w * item.h) / 1e6))}MP` : null;
  return joinMeta(mp, e.shutter, e.aperture, e.iso ? `ISO ${e.iso}` : null, e.focal) || 'No EXIF';
}

// ------------------------------------------------ 머리·탭·필터
const subline = el('p', { class: 'sub', 'aria-live': 'polite' });
const grid = el('div', {});
const moreRow = el('div', { class: 'row-actions', hidden: true }, button('Load more', { variant: 'btn-outline', onclick: () => load(true) }));
const tabs = el('div', { class: 'model-tabs', role: 'group', 'aria-label': 'Models' });
const searchInput = el('input', { class: 'input', type: 'search', id: 'lib-search', value: state.q, autocomplete: 'off', spellcheck: 'false', placeholder: 'File name, tag, camera, album' });
const albumSelect = el('select', { class: 'select', id: 'lib-album', 'aria-label': 'Album' });
const sortSelect = el('select', { class: 'select', id: 'lib-sort', 'aria-label': 'Sort' },
  [['shot_desc', 'Newest shot (EXIF)'], ['added_desc', 'Newest added'], ['name_asc', 'File name']].map(([v, l]) => el('option', { value: v, selected: v === state.sort }, l)));
const chips = el('div', { class: 'chip-bar' });

searchInput.addEventListener('input', debounce(() => { state.q = searchInput.value.trim(); reload(); }, 300));
albumSelect.addEventListener('change', () => { state.album = albumSelect.value; reload(); });
sortSelect.addEventListener('change', () => { state.sort = sortSelect.value; reload(); });

function viewToggle() {
  const make = (value, iconName, label) => {
    const node = el('button', { type: 'button', 'aria-pressed': String(state.view === value), onclick: () => {
      state.view = value;
      node.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === node)));
      syncUrl();
      render();
    } }, icon(iconName), label);
    return node;
  };
  return el('div', { class: 'view-toggle', role: 'group', 'aria-label': 'View' }, make('list', 'rectangle-horizontal', 'List'), make('card', 'layout-grid', 'Cards'));
}

function renderTabs() {
  const tab = (value, label, count, initial) => el('button', { type: 'button', class: 'model-tab', 'aria-pressed': String(state.model === value), onclick: () => {
    state.model = value;
    state.album = '';
    renderTabs();
    renderAlbumSelect();
    reload();
  } }, initial ? el('span', { class: 'initial', 'aria-hidden': 'true' }, initial) : icon('images'), el('span', {}, label), el('span', { class: 'count', 'data-numeric': true }, formatNumber(count)));
  tabs.replaceChildren(
    tab('', 'All', grandTotal),
    ...models.map((m) => tab(m.id, m.name, m.photo_count, m.name.trim().charAt(0).toUpperCase())),
    el('button', { type: 'button', class: 'model-tab add', onclick: async () => { if (await modelForm(null)) { await loadMeta(); renderTabs(); } } }, icon('plus'), 'Add model'),
    el('div', { class: 'select-links' },
      el('button', { type: 'button', onclick: () => { items.forEach((i) => selected.add(i.id)); render(); } }, 'Select all'),
      el('button', { type: 'button', onclick: () => { selected.clear(); render(); } }, 'Clear selection')));
}

function renderAlbumSelect() {
  const list = albums.filter((a) => !state.model || a.model_id === state.model);
  albumSelect.replaceChildren(el('option', { value: '' }, 'All albums'), ...list.map((a) => el('option', { value: a.id }, `${a.title} (${a.photo_count})`)));
  albumSelect.value = list.some((a) => a.id === state.album) ? state.album : '';
}

function renderChips() {
  const out = [];
  const chip = (label, clear) => el('span', { class: 'filter-chip' }, label, el('button', { type: 'button', 'aria-label': `Remove filter ${label}`, onclick: clear }, icon('x')));
  const model = models.find((m) => m.id === state.model);
  const album = albums.find((a) => a.id === state.album);
  if (model) out.push(chip(`Model: ${model.name}`, () => { state.model = ''; state.album = ''; renderTabs(); renderAlbumSelect(); reload(); }));
  if (album) out.push(chip(`Album: ${album.title}`, () => { state.album = ''; renderAlbumSelect(); reload(); }));
  if (state.q) out.push(chip(`Search: ${state.q}`, () => { state.q = ''; searchInput.value = ''; reload(); }));
  chips.replaceChildren(...(out.length ? [el('span', {}, 'Active filters:'), ...out, button('Reset', { variant: 'btn-ghost', iconName: 'rotate-ccw', onclick: () => {
    Object.assign(state, { model: '', album: '', q: '' });
    searchInput.value = '';
    renderTabs(); renderAlbumSelect(); reload();
  } })] : []));
}

// ------------------------------------------------ 카드·목록
function toggle(id, on) {
  if (on ?? !selected.has(id)) selected.add(id); else selected.delete(id);
  render();
}

function openAt(item) {
  const ready = items.filter((i) => i.status === 'ready');
  const index = ready.findIndex((i) => i.id === item.id);
  if (index < 0) return;
  openViewer({ items: ready, index, owner: true, hideSeconds: me.settings.viewer_controls_hide_seconds, onFavorite: () => render(), onOwnerAction: () => reload() });
}

async function toggleFav(item) {
  try { await api(`/favorites/${item.id}`, { method: item.fav ? 'DELETE' : 'PUT' }); item.fav = !item.fav; render(); } catch (error) { toastError(error); }
}

function card(item) {
  const isSelected = selected.has(item.id);
  const checkId = `sel-${item.id}`;
  const check = el('input', { type: 'checkbox', id: checkId, checked: isSelected });
  check.addEventListener('change', () => toggle(item.id, check.checked));
  const flags = [];
  if (item.is_album_cover) flags.push(el('span', { class: 'flag' }, 'Cover'));
  if (item.pause) flags.push(el('span', { class: 'flag pause' }, 'Full-width'));
  return el('article', { class: 'lib-card', 'aria-selected': String(isSelected), role: 'listitem' },
    el('button', { type: 'button', class: 'shot', 'aria-label': `View ${item.filename}`, onclick: () => openAt(item) },
      item.status === 'ready' ? photoFrame(item.id, { color: item.color, photo: item, sizes: '300px', variant: 'thumb', alt: '' })
        : el('span', { class: 'state' }, icon(item.status === 'failed' ? 'circle-alert' : 'loader-circle', item.status === 'failed' ? 'icon-24' : 'spin icon-24'))),
    el('label', { class: 'check', for: checkId }, check, el('span', { class: 'visually-hidden' }, `Select ${item.filename}`)),
    el('button', { type: 'button', class: 'fav', 'aria-pressed': String(item.fav), 'aria-label': item.fav ? 'Remove from favorites' : 'Add to favorites', onclick: () => toggleFav(item) }, icon('heart', 'icon-18')),
    flags.length ? el('div', { class: 'flags' }, flags) : null,
    el('div', { class: 'meta' },
      el('div', { class: 'row' }, el('span', { class: 'name', title: item.filename }, item.filename), el('span', { class: 'album', title: item.album_title }, item.album_title)),
      el('div', { class: 'row sub' }, el('span', {}, `Model: ${item.model_name}`), el('span', { 'data-numeric': true }, formatDate(item.taken_at || item.created_at))),
      el('div', { class: 'exif' }, exifLine(item))));
}

function tableView() {
  const rows = items.map((item) => {
    const isSelected = selected.has(item.id);
    const check = el('input', { type: 'checkbox', checked: isSelected, 'aria-label': `Select ${item.filename}` });
    check.addEventListener('change', () => toggle(item.id, check.checked));
    return el('tr', { 'aria-selected': String(isSelected) },
      el('td', {}, el('label', { class: 'checkbox-row' }, check)),
      el('td', { class: 'thumb' }, item.status === 'ready' ? photoFrame(item.id, { color: item.color, variant: 'thumb', alt: '' }) : el('div', { class: 'photo-frame' })),
      el('td', {}, el('button', { type: 'button', class: 'linkish', onclick: () => openAt(item) }, item.filename)),
      el('td', {}, item.album_title),
      el('td', {}, item.model_name),
      el('td', { 'data-numeric': true }, formatDate(item.taken_at || item.created_at)),
      el('td', { class: 'exif' }, exifLine(item)),
      el('td', { class: 'num' }, formatBytes(item.byte_size)));
  });
  return el('div', { class: 'table-wrap' }, el('table', { class: 'library-table' },
    el('thead', {}, el('tr', {}, ['', '', 'File', 'Album', 'Model', 'Date', 'EXIF', 'Size'].map((h, i) => el('th', { scope: 'col', class: i === 7 ? 'num' : undefined }, h ? h : el('span', { class: 'visually-hidden' }, i ? 'Thumbnail' : 'Select'))))),
    el('tbody', {}, rows)));
}

function render() {
  subline.replaceChildren(`${plural(total, 'photo')}`, selected.size ? ' · ' : '', selected.size ? el('strong', {}, `${formatNumber(selected.size)} selected`) : '', ` · ${plural(models.length, 'model')}`);
  renderChips();
  if (!items.length) {
    grid.replaceChildren(emptyState('images', total === 0 && !state.q && !state.model && !state.album ? 'No photos yet' : 'No photos match', 'Upload photos or change the filters.',
      el('a', { class: 'btn btn-primary', href: '/manage/upload.html' }, icon('upload'), 'Quick upload')));
  } else if (state.view === 'list') {
    grid.replaceChildren(tableView());
  } else {
    grid.replaceChildren(el('div', { class: 'library-grid', role: 'list' }, items.map(card)));
  }
  moreRow.hidden = items.length >= total;
  renderBulkBar();
}

// ------------------------------------------------ 일괄 작업
function renderBulkBar() {
  bulkBar?.remove();
  bulkBar = null;
  if (!selected.size) return;
  const ids = [...selected];
  const act = (action, extra, message) => async () => {
    try { await api('/photos/bulk', { method: 'POST', body: { action, ids, ...extra } }); toast(message, { type: 'success', duration: 2500 }); await reload(false); } catch (error) { toastError(error); }
  };
  const one = ids.length === 1;
  bulkBar = el('div', { class: 'bulk-bar', role: 'toolbar', 'aria-label': 'Selected photo actions' },
    el('span', { class: 'count', 'aria-live': 'polite' }, `${formatNumber(ids.length)} selected`),
    button('Favorite', { variant: 'btn-ghost', iconName: 'heart', onclick: act('favorite', {}, 'Added to favorites.') }),
    button('Tags', { variant: 'btn-ghost', iconName: 'tag', onclick: () => tagDialog(ids) }),
    button('Move to album', { variant: 'btn-ghost', iconName: 'folder-input', onclick: () => moveDialog(ids) }),
    one ? button('Set as cover', { variant: 'btn-ghost', iconName: 'star', onclick: act('set_album_cover', {}, 'Set as album cover.') }) : null,
    button('Full-width', { variant: 'btn-ghost', iconName: 'rectangle-horizontal', onclick: act('set_pause', {}, 'Shown full-width.') }),
    button('Download', { variant: 'btn-ghost', iconName: 'download', onclick: () => download(ids) }),
    button('Trash', { variant: 'btn-ghost', iconName: 'trash-2', onclick: () => trash(ids) }),
    iconButton('x', 'Clear selection', () => { selected.clear(); render(); }));
  document.body.append(bulkBar);
}

function download(ids) {
  // 원본을 차례로 내려받는다. 브라우저가 여러 파일 내려받기를 물어볼 수 있다.
  ids.slice(0, 20).forEach((id, i) => setTimeout(() => {
    const a = el('a', { href: `${mediaUrl(id, 'original')}?download=1` });
    document.body.append(a); a.click(); a.remove();
  }, i * 400));
  if (ids.length > 20) toast('Only the first 20 originals are downloaded at once.', { type: 'info' });
}

async function trash(ids) {
  try {
    await api('/photos/bulk', { method: 'POST', body: { action: 'trash', ids } });
    selected.clear();
    await reload(false);
    toast(`Moved ${plural(ids.length, 'photo')} to trash.`, { type: 'success', actionLabel: 'Undo', duration: 5000,
      onAction: async () => { try { await api('/trash/restore', { method: 'POST', body: { type: 'photo', ids } }); reload(false); } catch (error) { toastError(error); } } });
  } catch (error) { toastError(error); }
}

function tagDialog(ids) {
  const input = el('input', { class: 'input', id: 'bulk-tags', autocomplete: 'off', spellcheck: 'false' });
  const mode = el('select', { class: 'select', id: 'bulk-mode' }, el('option', { value: 'tag' }, 'Add tags'), el('option', { value: 'untag' }, 'Remove tags'));
  const dialog = el('dialog', { class: 'dialog', 'aria-labelledby': 'tag-title' }, el('form', { class: 'dialog-body', onsubmit: async (event) => {
    event.preventDefault();
    const tags = input.value.split(',').map((t) => t.trim()).filter(Boolean);
    if (!tags.length) { input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    try { await api('/photos/bulk', { method: 'POST', body: { action: mode.value, ids, tags } }); dialog.close(); toast('Tags updated.', { type: 'success' }); } catch (error) { toastError(error); }
  } },
  el('h2', { class: 'dialog-title', id: 'tag-title' }, `Tags · ${plural(ids.length, 'photo')}`),
  el('div', { class: 'field' }, el('label', { class: 'label', for: 'bulk-mode' }, 'Action'), mode),
  el('div', { class: 'field' }, el('label', { class: 'label', for: 'bulk-tags' }, 'Tags'), input, el('p', { class: 'hint' }, 'Separate with commas, e.g. outdoor, black and white')),
  el('div', { class: 'dialog-actions' }, button('Cancel', { variant: 'btn-outline', onclick: () => dialog.close() }), button('Apply', { variant: 'btn-primary', type: 'submit' }))));
  showDialog(dialog);
  input.focus();
}

function moveDialog(ids) {
  const select = el('select', { class: 'select', id: 'move-target' }, albums.map((a) => el('option', { value: a.id }, joinMeta(a.title, a.model_name))));
  const dialog = el('dialog', { class: 'dialog', 'aria-labelledby': 'move-title' }, el('form', { class: 'dialog-body', onsubmit: async (event) => {
    event.preventDefault();
    try { await api('/photos/bulk', { method: 'POST', body: { action: 'move', ids, album_id: select.value } }); dialog.close(); toast('Photos moved.', { type: 'success' }); await reload(false); } catch (error) { toastError(error); }
  } },
  el('h2', { class: 'dialog-title', id: 'move-title' }, `Move to album · ${plural(ids.length, 'photo')}`),
  el('div', { class: 'field' }, el('label', { class: 'label', for: 'move-target' }, 'Destination album'), select),
  el('div', { class: 'dialog-actions' }, button('Cancel', { variant: 'btn-outline', onclick: () => dialog.close() }), button('Move', { variant: 'btn-primary', type: 'submit' }))));
  showDialog(dialog);
  select.focus();
}

// ------------------------------------------------ 불러오기
async function loadMeta() {
  const [m, a, all] = await Promise.all([api('/models?sort=name_asc'), api('/albums?sort=title_asc&limit=1000'), api('/library?limit=1')]);
  models = m.items;
  albums = a.items;
  grandTotal = all.total;
}

async function load(append = false) {
  const query = new URLSearchParams({ sort: state.sort, limit: String(PAGE), offset: String(append ? items.length : 0) });
  if (state.model) query.set('model_id', state.model);
  if (state.album) query.set('album_id', state.album);
  if (state.q) query.set('q', state.q);
  const data = await api(`/library?${query}`);
  items = append ? items.concat(data.items) : data.items;
  total = data.total;
  render();
}

async function reload(clearSelection = true) {
  if (clearSelection) selected.clear();
  syncUrl();
  try { await load(false); } catch (error) { grid.replaceChildren(errorState(error, () => reload())); }
}

main.replaceChildren(loadingState());
try {
  await loadMeta();
  setChildren(main,
    el('div', { class: 'studio-head' },
      el('div', {}, el('h1', {}, 'Photo library', el('span', { class: 'badge' }, 'ARCHIVE')), subline),
      el('div', { class: 'studio-actions' }, viewToggle(),
        el('a', { class: 'btn btn-primary', href: '/manage/upload.html' }, icon('image-plus'), 'New photos'))),
    tabs,
    el('div', { class: 'filter-row' },
      el('div', { class: 'search-wrap' }, icon('search'), el('label', { class: 'visually-hidden', for: 'lib-search' }, 'Search photos'), searchInput),
      albumSelect, sortSelect),
    chips, grid, moreRow);
  renderTabs();
  renderAlbumSelect();
  await reload(false);
} catch (error) {
  main.replaceChildren(errorState(error, () => location.reload()));
}
