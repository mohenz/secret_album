// 앨범: 표지 → 설명 → 사진 흐름 → 다음 앨범. 소유자는 편집 모드·끌어 놓기 업로드를 쓸 수 있다.
import { api } from '../shared/api.js';
import { albumForm } from '../shared/forms.js';
import { albumCard, photoFrame, PhotoFlow } from '../shared/gallery.js';
import { boot, isOwner } from '../shared/layout.js';
import { enablePageDrop, enablePagePaste, Uploader } from '../shared/uploader.js';
import {
  button, confirmDialog, el, errorState, emptyState, formatDate, formatNumber, icon, iconButton, joinMeta, loadingState, openMenu, plural, setChildren, showDialog, toast, toastError,
} from '../shared/ui.js';
import { openViewer, saveSlideshowOptions, slideshowOptions } from '../shared/viewer.js';

const main = document.getElementById('main');
const params = new URLSearchParams(location.search);
const albumId = params.get('id');
let album;
let photos = [];
let flow;
let me;
let bulkBar;

function setPhotoParam(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('photo', id); else url.searchParams.delete('photo');
  history.replaceState(null, '', url);
}

function view(index, { startSlideshow = false, slideshow } = {}) {
  openViewer({
    items: photos, index, owner: isOwner(), hideSeconds: me.settings.viewer_controls_hide_seconds, startSlideshow, slideshow,
    onChange: (photo) => setPhotoParam(photo.id),
    onFavorite: () => flow.layout(),
    onOwnerAction: (action) => { if (['trash', 'restore', 'set_album_cover'].includes(action)) refresh(); },
    onClose: (photo) => { setPhotoParam(null); if (photo) flow.focusPhoto(photo.id); },
  });
}

function slideshowDialog() {
  const options = slideshowOptions();
  const interval = el('select', { class: 'select', id: 'ss-interval' }, [3, 5, 10].map((n) => el('option', { value: n, selected: n === options.interval }, `${n} seconds`)));
  const loop = el('input', { type: 'checkbox', id: 'ss-loop', checked: options.loop });
  const shuffle = el('input', { type: 'checkbox', id: 'ss-shuffle', checked: options.shuffle });
  const dialog = el('dialog', { class: 'dialog', 'aria-labelledby': 'ss-title' },
    el('form', { class: 'dialog-body', method: 'dialog', onsubmit: (event) => {
      event.preventDefault();
      const chosen = { interval: Number(interval.value), loop: loop.checked, shuffle: shuffle.checked };
      saveSlideshowOptions(chosen);
      dialog.close();
      view(0, { startSlideshow: true, slideshow: chosen });
    } },
    el('h2', { class: 'dialog-title', id: 'ss-title' }, 'Slideshow'),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'ss-interval' }, 'Interval'), interval),
    el('label', { class: 'checkbox-row', for: 'ss-loop' }, loop, el('span', {}, 'Loop from the start when finished')),
    el('label', { class: 'checkbox-row', for: 'ss-shuffle' }, shuffle, el('span', {}, 'Shuffle')),
    el('div', { class: 'dialog-actions' }, button('Cancel', { variant: 'btn-outline', onclick: () => dialog.close() }), button('Start', { variant: 'btn-primary', type: 'submit', iconName: 'play' }))));
  showDialog(dialog);
  interval.focus();
}

// ------------------------------------------------ 편집 모드
function renderBulkBar(selected) {
  bulkBar?.remove();
  bulkBar = null;
  if (!flow.editing) return;
  const ids = [...selected];
  const n = ids.length;
  const act = (action, extra = {}, message = 'Changes saved.') => async () => {
    try {
      await api('/photos/bulk', { method: 'POST', body: { action, ids, ...extra } });
      toast(message, { type: 'success', duration: 2500 });
      await refresh();
    } catch (error) { toastError(error); }
  };
  const one = n === 1;
  const moveBy = (delta) => async () => {
    const order = photos.map((p) => p.id);
    const from = order.indexOf(ids[0]);
    const to = Math.max(0, Math.min(order.length - 1, from + delta));
    order.splice(to, 0, order.splice(from, 1)[0]);
    await reorder(order);
    flow.selected = new Set(ids);
    flow.layout();
    renderBulkBar(flow.selected);
  };
  bulkBar = el('div', { class: 'bulk-bar', role: 'toolbar', 'aria-label': 'Selected photo actions' },
    el('span', { class: 'count', 'aria-live': 'polite' }, `${formatNumber(n)} selected`),
    button(n === photos.length ? 'Clear selection' : 'Select all', { variant: 'btn-ghost', onclick: () => flow.selectAll(n !== photos.length) }),
    n ? button('Favorite', { variant: 'btn-ghost', iconName: 'heart', onclick: act('favorite', {}, 'Added to favorites.') }) : null,
    n ? button('Edit tags', { variant: 'btn-ghost', iconName: 'tag', onclick: () => tagDialog(ids) }) : null,
    n ? button('Move to album', { variant: 'btn-ghost', iconName: 'folder-input', onclick: () => moveDialog(ids) }) : null,
    one ? button('Set as cover', { variant: 'btn-ghost', iconName: 'star', onclick: act('set_album_cover', {}, 'Set as album cover.') }) : null,
    n ? button('Make full-width', { variant: 'btn-ghost', iconName: 'rectangle-horizontal', onclick: act('set_pause', {}, 'Shown full-width.') }) : null,
    n ? button('Undo full-width', { variant: 'btn-ghost', onclick: act('unset_pause', {}, 'Back to regular size.') }) : null,
    one ? iconButton('arrow-up', 'Move earlier', moveBy(-1)) : null,
    one ? iconButton('arrow-down', 'Move later', moveBy(1)) : null,
    n ? button('Move to trash', { variant: 'btn-ghost', iconName: 'trash-2', onclick: () => trashSelected(ids) }) : null);
  document.body.append(bulkBar);
}

async function trashSelected(ids) {
  try {
    await api('/photos/bulk', { method: 'POST', body: { action: 'trash', ids } });
    await refresh();
    toast(`Moved ${plural(ids.length, 'photo')} to trash.`, {
      type: 'success', actionLabel: 'Undo', duration: 5000,
      onAction: async () => { try { await api('/trash/restore', { method: 'POST', body: { type: 'photo', ids } }); await refresh(); } catch (error) { toastError(error); } },
    });
  } catch (error) { toastError(error); }
}

async function reorder(ids) {
  try {
    await api('/photos/bulk', { method: 'POST', body: { action: 'reorder', ids } });
    const byId = new Map(photos.map((p) => [p.id, p]));
    photos = ids.map((id) => byId.get(id));
    flow.setItems(photos);
  } catch (error) { toastError(error); }
}

async function tagDialog(ids) {
  const input = el('input', { class: 'input', id: 'bulk-tags', autocomplete: 'off', spellcheck: 'false' });
  const mode = el('select', { class: 'select', id: 'bulk-mode' }, el('option', { value: 'tag' }, 'Add tags'), el('option', { value: 'untag' }, 'Remove tags'));
  const dialog = el('dialog', { class: 'dialog', 'aria-labelledby': 'tag-title' }, el('form', { class: 'dialog-body', onsubmit: async (event) => {
    event.preventDefault();
    const tags = input.value.split(',').map((t) => t.trim()).filter(Boolean);
    if (!tags.length) { input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    try { await api('/photos/bulk', { method: 'POST', body: { action: mode.value, ids, tags } }); dialog.close(); toast('Tags updated.', { type: 'success' }); } catch (error) { toastError(error); }
  } },
  el('h2', { class: 'dialog-title', id: 'tag-title' }, `Edit tags · ${plural(ids.length, 'photo')}`),
  el('div', { class: 'field' }, el('label', { class: 'label', for: 'bulk-mode' }, 'Action'), mode),
  el('div', { class: 'field' }, el('label', { class: 'label', for: 'bulk-tags' }, 'Tags'), input, el('p', { class: 'hint' }, 'Separate with commas, e.g. outdoor, black and white')),
  el('div', { class: 'dialog-actions' }, button('Cancel', { variant: 'btn-outline', onclick: () => dialog.close() }), button('Apply', { variant: 'btn-primary', type: 'submit' }))));
  showDialog(dialog);
  input.focus();
}

async function moveDialog(ids) {
  let albums;
  try { albums = (await api('/albums?sort=title_asc&limit=1000')).items.filter((a) => a.id !== albumId); } catch (error) { toastError(error); return; }
  if (!albums.length) { toast('There is no other album to move to. Create one first.', { type: 'error' }); return; }
  const select = el('select', { class: 'select', id: 'move-target' }, albums.map((a) => el('option', { value: a.id }, joinMeta(a.title, a.model_name))));
  const dialog = el('dialog', { class: 'dialog', 'aria-labelledby': 'move-title' }, el('form', { class: 'dialog-body', onsubmit: async (event) => {
    event.preventDefault();
    try { await api('/photos/bulk', { method: 'POST', body: { action: 'move', ids, album_id: select.value } }); dialog.close(); toast('Photos moved.', { type: 'success' }); await refresh(); } catch (error) { toastError(error); }
  } },
  el('h2', { class: 'dialog-title', id: 'move-title' }, `Move to album · ${plural(ids.length, 'photo')}`),
  el('div', { class: 'field' }, el('label', { class: 'label', for: 'move-target' }, 'Destination album'), select),
  el('div', { class: 'dialog-actions' }, button('Cancel', { variant: 'btn-outline', onclick: () => dialog.close() }), button('Move', { variant: 'btn-primary', type: 'submit' }))));
  showDialog(dialog);
  select.focus();
}

function setEditing(on) {
  flow.setEditing(on);
  document.getElementById('edit-banner').hidden = !on;
  document.getElementById('album-toolbar').hidden = on;
  if (on) document.getElementById('edit-done').focus();
  else { bulkBar?.remove(); bulkBar = null; }
}

// ------------------------------------------------ 끌어 놓기 업로드
let uploadDialog = null;
function uploadHere(files) {
  if (!uploadDialog) {
    const list = el('div', { class: 'upload-list', role: 'list' });
    const summary = el('div', { class: 'upload-summary', role: 'status' });
    uploadDialog = el('dialog', { class: 'dialog sheet', 'aria-labelledby': 'up-title' }, el('div', { class: 'dialog-body' },
      el('h2', { class: 'dialog-title', id: 'up-title' }, `Upload to “${album.title}”`), summary, list,
      el('div', { class: 'dialog-actions' }, button('Close', { variant: 'btn-outline', onclick: () => uploadDialog.close() }))));
    uploadDialog.uploader = new Uploader({ list, summary, getAlbumId: () => albumId, onFinished: () => refresh() });
    uploadDialog.addEventListener('close', () => { uploadDialog.uploader.destroy(); uploadDialog = null; refresh(); }, { once: true });
    showDialog(uploadDialog);
  }
  uploadDialog.uploader.add(files);
}

// ------------------------------------------------ 화면
async function refresh() {
  const [info, list] = await Promise.all([api(`/albums/${albumId}`), api(`/albums/${albumId}/photos`)]);
  album = info;
  photos = list.items;
  if (!flow.container.isConnected) { flow.destroy(); render(); return; }
  flow.setItems(photos);
  document.getElementById('album-count').textContent = plural(album.photo_count, 'photo');
  if (flow.editing) renderBulkBar(flow.selected);
}

function render() {
  const cover = album.cover ? { id: album.cover.id, w: album.cover.w, h: album.cover.h } : null;
  const owner = isOwner();
  const moreButton = owner ? iconButton('ellipsis', 'Album menu', () => openMenu(moreButton, [
    { label: 'Edit', icon: 'pencil', onSelect: () => setEditing(true) },
    { label: 'Upload photos', icon: 'upload', href: `/manage/upload.html?album=${albumId}` },
    { label: 'Edit album details', icon: 'settings', onSelect: async () => { if (await albumForm(album)) location.reload(); } },
    'separator',
    { label: 'Move album to trash', icon: 'trash-2', danger: true, onSelect: trashAlbum },
  ])) : null;
  moreButton?.setAttribute('aria-haspopup', 'menu');
  const flowNode = el('div', { 'aria-label': 'Photos' });
  flow = new PhotoFlow(flowNode, photos, {
    onOpen: (index) => view(index),
    onToggleFavorite: async (photo) => {
      try { await api(`/favorites/${photo.id}`, { method: photo.fav ? 'DELETE' : 'PUT' }); photo.fav = !photo.fav; flow.layout(); } catch (error) { toastError(error); }
    },
    onFailed: (photo) => toast('This photo could not be processed. Move it to trash and upload the original again.', { type: 'error' }),
    onSelectionChange: renderBulkBar,
    onReorder: reorder,
  });
  setChildren(main,
    el('section', { class: 'album-cover', 'aria-labelledby': 'album-title' },
      cover ? photoFrame(cover.id, { color: album.cover.color, photo: cover, sizes: '100vw', variant: 'large', eager: true }) : null,
      el('div', { class: 'hero-caption' },
        el('h1', { class: 'display-title', id: 'album-title' }, album.title),
        el('p', { class: 'hero-meta' },
          el('a', { href: `/pages/model.html?id=${album.model_id}` }, album.model_name), ' · ',
          joinMeta(album.location, formatDate(album.shot_on)), album.location || album.shot_on ? ' · ' : '',
          el('span', { id: 'album-count', 'data-numeric': true }, plural(album.photo_count, 'photo'))))),
    album.description ? el('div', { class: 'album-intro' }, el('p', { class: 'readable' }, album.description)) : null,
    el('div', { class: 'edit-banner', id: 'edit-banner', hidden: true },
      el('span', { class: 'text-card' }, 'Editing'),
      el('span', { class: 'text-meta' }, 'Tap photos to select them. Drag to reorder.'),
      button('Done', { variant: 'btn-primary', onclick: () => setEditing(false), className: 'edit-done' })),
    el('div', { class: 'album-toolbar', id: 'album-toolbar' },
      el('div', { class: 'group' }),
      el('div', { class: 'group' }, photos.length ? button('Slideshow', { variant: 'btn-outline', iconName: 'play', onclick: slideshowDialog }) : null, moreButton)),
    photos.length ? flowNode : emptyState('image', 'No photos in this album yet', owner ? 'Drop photos onto this page, paste with Ctrl+V, or use the upload page.' : null,
      owner ? el('a', { class: 'btn btn-primary', href: `/manage/upload.html?album=${albumId}` }, icon('upload'), 'Upload photos') : null),
    album.next_album ? el('section', { class: 'next-album', 'aria-label': 'Next album' }, el('p', { class: 'label' }, 'More from this model'), albumCard(album.next_album, { sizes: '100vw' })) : null,
    el('footer', { class: 'page-foot' }, '← → browse · Space slideshow · F favorite · I details · Shift+H hide screen'));
  document.getElementById('edit-banner').querySelector('.edit-done').id = 'edit-done';
}

async function trashAlbum() {
  const ok = await confirmDialog({
    title: 'Move this album to trash?',
    description: `“${album.title}” and its ${plural(album.photo_count, 'photo')} will be moved to trash. You can restore them from the trash until the retention period ends.`,
    confirmLabel: 'Move album to trash',
    destructive: true,
  });
  if (!ok) return;
  try { await api(`/albums/${albumId}`, { method: 'DELETE' }); location.replace('/pages/albums.html'); } catch (error) { toastError(error); }
}

me = await boot({ active: 'albums', overPhoto: true });
main.replaceChildren(el('div', { class: 'page-top' }, loadingState()));
try {
  if (!albumId) throw Object.assign(new Error('Album not found. Please pick it again from the album list.'), { code: 'not_found' });
  const [info, list] = await Promise.all([api(`/albums/${albumId}`), api(`/albums/${albumId}/photos`)]);
  album = info;
  photos = list.items;
  if (!album.cover) Object.assign(document.getElementById('site-header').dataset, { overPhoto: 'false', solid: 'true' });
  render();
  if (isOwner()) {
    addEventListener('keydown', (event) => { if (event.key === 'Escape' && flow.editing && !document.querySelector('dialog[open], .pswp')) setEditing(false); });
    enablePageDrop(uploadHere);
    enablePagePaste(uploadHere);
  }
  const photoParam = params.get('photo');
  if (photoParam) {
    const index = photos.findIndex((p) => p.id === photoParam);
    if (index >= 0) view(index);
  }
  // 처리 중인 사진이 있으면 잠시 뒤 다시 확인한다.
  const poll = setInterval(async () => {
    if (!photos.some((p) => p.status === 'processing')) { clearInterval(poll); return; }
    try { await refresh(); } catch { /* 다음 확인 때 다시 */ }
  }, 4000);
} catch (error) {
  Object.assign(document.getElementById('site-header').dataset, { overPhoto: 'false', solid: 'true' });
  main.replaceChildren(el('div', { class: 'page-top' }, errorState(error, () => location.reload())));
}
