// Studio 모델 관리: 목록(검색·정렬·선택 삭제) + 선택한 모델 상세(정보·대표 사진·앨범 선택 삭제)
import { api } from '../shared/api.js';
import { albumForm, modelForm } from '../shared/forms.js';
import { photoFrame } from '../shared/gallery.js';
import { boot } from '../shared/layout.js';
import { button, confirmDialog, debounce, el, emptyState, errorState, formatDate, formatNumber, icon, loadingState, plural, setChildren, showDialog, toast, toastError } from '../shared/ui.js';

const main = document.getElementById('main');
await boot({ ownerOnly: true, studio: true, active: 'models' });
main.className = 'manage-page';

const params = new URLSearchParams(location.search);
const state = { id: params.get('id') || '', q: '', sort: 'name_asc' };
let models = [];
let current = null;
const pickedModels = new Set();
const pickedAlbums = new Set();

const subline = el('p', { class: 'sub', 'data-numeric': true });
const searchInput = el('input', { class: 'input', type: 'search', id: 'model-search', autocomplete: 'off', spellcheck: 'false', placeholder: 'Name or stage name' });
const sortSelect = el('select', { class: 'select', id: 'model-sort', 'aria-label': 'Sort' },
  el('option', { value: 'name_asc' }, 'Name'),
  el('option', { value: 'recent_desc' }, 'Latest shoot'),
  el('option', { value: 'photos_desc' }, 'Most photos'));
const listBar = el('div', { class: 'select-bar', role: 'toolbar', 'aria-label': 'Model selection' });
const list = el('div', { class: 'model-admin-list', role: 'list', 'aria-label': 'Models' });
const detail = el('section', { class: 'panel model-detail', id: 'model-detail', 'aria-labelledby': 'detail-name' });

searchInput.addEventListener('input', debounce(() => { state.q = searchInput.value.trim().toLowerCase(); renderList(); }, 150));
sortSelect.addEventListener('change', () => { state.sort = sortSelect.value; loadModels(); });

const initial = (name) => name.trim().charAt(0).toUpperCase() || '?';
const isDesktop = () => matchMedia('(min-width: 1024px)').matches;

function avatar(model) {
  return model.cover
    ? el('span', { class: 'model-avatar' }, photoFrame(model.cover.id, { color: model.cover.color, variant: 'thumb', alt: '' }))
    : el('span', { class: 'model-avatar initial-only', 'aria-hidden': 'true' }, initial(model.name));
}

function setIdParam(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('id', id); else url.searchParams.delete('id');
  history.replaceState(null, '', url);
}

// 전체 선택 체크박스 + 선택 개수 + 휴지통 버튼. 일부만 고르면 중간 상태로 보인다.
function selectionBar(bar, { id, label, items, picked, onChange, onTrash, trashLabel }) {
  const all = el('input', { type: 'checkbox', id, checked: items.length > 0 && items.every((i) => picked.has(i.id)) });
  all.indeterminate = picked.size > 0 && !all.checked;
  all.addEventListener('change', () => {
    if (all.checked) items.forEach((i) => picked.add(i.id)); else picked.clear();
    onChange();
    document.getElementById(id)?.focus();
  });
  const trash = button(trashLabel, { variant: 'btn-destructive', iconName: 'trash-2', onclick: onTrash });
  trash.disabled = picked.size === 0;
  bar.replaceChildren(
    el('label', { class: 'checkbox-row', for: id }, all, el('span', {}, label)),
    el('span', { class: 'text-meta', 'aria-live': 'polite', 'data-numeric': true }, picked.size ? `${formatNumber(picked.size)} selected` : ''),
    trash);
  bar.hidden = items.length === 0;
}

// ------------------------------------------------ 모델 목록
function renderList() {
  const shown = models.filter((m) => !state.q || m.name.toLowerCase().includes(state.q) || (m.stage_name || '').toLowerCase().includes(state.q));
  const photos = models.reduce((n, m) => n + m.photo_count, 0);
  subline.replaceChildren(`${plural(models.length, 'model')} · ${plural(photos, 'photo')}`);
  for (const id of pickedModels) if (!models.some((m) => m.id === id)) pickedModels.delete(id);
  selectionBar(listBar, {
    id: 'models-select-all', label: 'Select all', items: shown, picked: pickedModels, onChange: renderList,
    trashLabel: 'Delete', onTrash: () => trashModels(models.filter((m) => pickedModels.has(m.id))),
  });
  if (!shown.length) {
    list.replaceChildren(emptyState('user', models.length ? 'No models match' : 'No models yet', models.length ? 'Try another name.' : 'Add a model to start organizing albums.'));
    return;
  }
  list.replaceChildren(...shown.map((m) => {
    const checkId = `pick-model-${m.id}`;
    const check = el('input', { type: 'checkbox', id: checkId, checked: pickedModels.has(m.id) });
    check.addEventListener('change', () => { if (check.checked) pickedModels.add(m.id); else pickedModels.delete(m.id); renderList(); document.getElementById(checkId)?.focus(); });
    return el('div', { class: 'model-row', role: 'listitem', 'aria-current': m.id === state.id ? 'true' : undefined, 'data-selected': String(pickedModels.has(m.id)) },
      el('label', { class: 'pick', for: checkId }, check, el('span', { class: 'visually-hidden' }, `Select ${m.name}`)),
      el('button', { type: 'button', class: 'open', onclick: () => select(m.id, true) },
        avatar(m),
        el('span', { class: 'text' },
          el('span', { class: 'name' }, m.name),
          el('span', { class: 'meta', 'data-numeric': true }, [m.stage_name, plural(m.album_count, 'album'), plural(m.photo_count, 'photo')].filter(Boolean).join(' · '))),
        icon('chevron-right')));
  }));
}

async function loadModels() {
  models = (await api(`/models?sort=${state.sort}`)).items;
  if (state.id && !models.some((m) => m.id === state.id)) state.id = '';
  if (!state.id && models.length && isDesktop()) state.id = models[0].id;
  renderList();
}

// ------------------------------------------------ 모델 상세
async function select(id, scroll = false) {
  if (id !== state.id) pickedAlbums.clear();
  state.id = id;
  setIdParam(id);
  renderList();
  detail.replaceChildren(loadingState());
  if (scroll && !isDesktop()) detail.scrollIntoView({ block: 'start' });
  try { current = await api(`/models/${id}`); renderDetail(); } catch (error) { detail.replaceChildren(errorState(error, () => select(id))); }
}

function renderDetail() {
  const model = current;
  for (const id of pickedAlbums) if (!model.albums.some((a) => a.id === id)) pickedAlbums.delete(id);
  const albumBar = el('div', { class: 'select-bar', role: 'toolbar', 'aria-label': 'Album selection' });
  selectionBar(albumBar, {
    id: 'albums-select-all', label: 'Select all albums', items: model.albums, picked: pickedAlbums, onChange: renderDetail,
    trashLabel: 'Delete albums', onTrash: () => trashAlbums(model.albums.filter((a) => pickedAlbums.has(a.id))),
  });
  const albumRows = model.albums.map((a) => {
    const checkId = `pick-album-${a.id}`;
    const check = el('input', { type: 'checkbox', id: checkId, checked: pickedAlbums.has(a.id) });
    check.addEventListener('change', () => { if (check.checked) pickedAlbums.add(a.id); else pickedAlbums.delete(a.id); renderDetail(); document.getElementById(checkId)?.focus(); });
    return el('div', { class: 'model-album', role: 'listitem', 'data-selected': String(pickedAlbums.has(a.id)) },
      el('label', { class: 'pick', for: checkId }, check, el('span', { class: 'visually-hidden' }, `Select album ${a.title}`)),
      photoFrame(a.cover?.id, { color: a.cover?.color, variant: 'thumb', alt: '' }),
      el('div', { class: 'text' },
        el('a', { class: 'title', href: `/pages/album.html?id=${a.id}` }, a.title),
        el('span', { class: 'meta', 'data-numeric': true }, [a.shot_on ? formatDate(a.shot_on) : 'No shoot date', a.location, plural(a.photo_count, 'photo')].filter(Boolean).join(' · '))),
      el('div', { class: 'actions' },
        el('a', { class: 'btn btn-ghost btn-icon', href: `/manage/photos.html?album=${a.id}`, 'aria-label': `Manage photos in ${a.title}`, title: 'Photos' }, icon('images')),
        button('Edit', { variant: 'btn-ghost', iconName: 'pencil', ariaLabel: `Edit album ${a.title}`, onclick: () => editAlbum(a.id) })));
  });

  setChildren(detail,
    el('div', { class: 'model-detail-head' },
      el('div', { class: 'model-cover' },
        model.cover ? photoFrame(model.cover.id, { color: model.cover.color, variant: 'medium', alt: `${model.name} cover` }) : el('div', { class: 'photo-frame initial-only' }, el('span', {}, initial(model.name))),
        button('Change cover', { variant: 'btn-secondary', iconName: 'image', className: 'cover-change', onclick: () => coverDialog(model) })),
      el('div', { class: 'model-info' },
        el('p', { class: 'eyebrow' }, 'Model'),
        el('h2', { id: 'detail-name' }, model.name),
        model.stage_name ? el('p', { class: 'stage' }, model.stage_name) : null,
        el('dl', { class: 'model-stats' },
          el('div', {}, el('dt', {}, 'Albums'), el('dd', { 'data-numeric': true }, formatNumber(model.album_count))),
          el('div', {}, el('dt', {}, 'Photos'), el('dd', { 'data-numeric': true }, formatNumber(model.photo_count))),
          el('div', {}, el('dt', {}, 'Latest shoot'), el('dd', { 'data-numeric': true }, model.last_shot ? formatDate(model.last_shot) : '—'))),
        el('p', { class: model.bio ? 'bio' : 'bio is-blank' }, model.bio || 'No bio yet.'),
        el('div', { class: 'row-actions' },
          button('Edit details', { variant: 'btn-primary', iconName: 'pencil', onclick: async () => { if (await modelForm(model)) { toast('Model updated.', { type: 'success' }); await refresh(); } } }),
          el('a', { class: 'btn btn-outline', href: `/pages/model.html?id=${model.id}` }, icon('eye'), 'Portfolio'),
          el('a', { class: 'btn btn-outline', href: `/manage/photos.html?model=${model.id}` }, icon('images'), 'Photos'),
          button('Delete', { variant: 'btn-ghost', iconName: 'trash-2', className: 'danger-text', onclick: () => trashModels([model]) })))),
    el('div', { class: 'toolbar' },
      el('h3', { class: 'section-title' }, 'Albums', el('span', { class: 'count', 'data-numeric': true }, formatNumber(model.albums.length))),
      button('New album', { variant: 'btn-outline', iconName: 'plus', onclick: async () => { if (await albumForm(null, { modelId: model.id })) { toast('Album created.', { type: 'success' }); await refresh(); } } })),
    albumBar,
    albumRows.length ? el('div', { class: 'model-albums', role: 'list' }, albumRows) : el('p', { class: 'panel-desc' }, 'No albums yet. Create one to start uploading.'));
}

async function refresh() {
  await loadModels();
  if (state.id) await select(state.id);
  else { current = null; detail.replaceChildren(emptyState('user', models.length ? 'Select a model' : 'No models yet', models.length ? 'Choose a model from the list to see its details and albums.' : 'Add a model to get started.')); }
}

async function editAlbum(id) {
  try {
    const album = await api(`/albums/${id}`);
    if (await albumForm(album)) { toast('Album updated.', { type: 'success' }); await refresh(); }
  } catch (error) { toastError(error); }
}

// ------------------------------------------------ 휴지통으로 옮기기 (선택 삭제)
function trashedToast(message) {
  toast(message, { type: 'success', actionLabel: 'Open trash', onAction: () => { location.href = '/manage/trash.html'; } });
}

async function trashModels(targets) {
  if (!targets.length) return;
  const albums = targets.reduce((n, m) => n + m.album_count, 0);
  const photos = targets.reduce((n, m) => n + m.photo_count, 0);
  const one = targets.length === 1;
  const ok = await confirmDialog({
    title: one ? `Delete ${targets[0].name}?` : `Delete ${plural(targets.length, 'model')}?`,
    description: `${plural(albums, 'album')} and ${plural(photos, 'photo')} will move to Trash with ${one ? 'this model' : 'them'}. You can restore them from Trash.`,
    confirmLabel: one ? 'Move model to trash' : `Move ${plural(targets.length, 'model')} to trash`,
    destructive: true,
  });
  if (!ok) return;
  let done = 0;
  try {
    for (const m of targets) { await api(`/models/${m.id}`, { method: 'DELETE' }); pickedModels.delete(m.id); done += 1; }
  } catch (error) { toastError(error); }
  if (targets.some((m) => m.id === state.id)) { state.id = ''; setIdParam(''); }
  if (done) trashedToast(`${plural(done, 'model')} moved to trash.`);
  await refresh();
}

async function trashAlbums(targets) {
  if (!targets.length) return;
  const photos = targets.reduce((n, a) => n + a.photo_count, 0);
  const one = targets.length === 1;
  const ok = await confirmDialog({
    title: one ? `Delete ${targets[0].title}?` : `Delete ${plural(targets.length, 'album')}?`,
    description: `${plural(photos, 'photo')} will move to Trash with ${one ? 'this album' : 'them'}. You can restore them from Trash.`,
    confirmLabel: one ? 'Move album to trash' : `Move ${plural(targets.length, 'album')} to trash`,
    destructive: true,
  });
  if (!ok) return;
  let done = 0;
  try {
    for (const a of targets) { await api(`/albums/${a.id}`, { method: 'DELETE' }); pickedAlbums.delete(a.id); done += 1; }
  } catch (error) { toastError(error); }
  if (done) trashedToast(`${plural(done, 'album')} moved to trash.`);
  await refresh();
}

// 대표 사진: 모델의 사진 중에서 고르거나 자동(첫 사진)으로 되돌린다.
async function coverDialog(model) {
  let photos;
  try { photos = (await api(`/models/${model.id}/photos`)).items; } catch (error) { toastError(error); return; }
  const save = async (photoId) => {
    try {
      await api(`/models/${model.id}`, { method: 'PATCH', body: { cover_photo_id: photoId } });
      dialog.close();
      toast(photoId ? 'Cover updated.' : 'Cover set to automatic.', { type: 'success' });
      await refresh();
    } catch (error) { toastError(error); }
  };
  const grid = photos.length
    ? el('div', { class: 'cover-pick', role: 'list' }, photos.slice(0, 300).map((p, i) => el('button', {
      type: 'button', role: 'listitem', 'aria-pressed': String(p.id === model.cover?.id), 'aria-label': `Use photo ${i + 1} as cover`, onclick: () => save(p.id),
    }, photoFrame(p.id, { color: p.color, variant: 'thumb', alt: '' }))))
    : el('p', { class: 'dialog-description' }, 'This model has no photos yet.');
  const dialog = el('dialog', { class: 'dialog dialog-wide', 'aria-labelledby': 'cover-title' },
    el('div', { class: 'dialog-body' },
      el('h2', { class: 'dialog-title', id: 'cover-title' }, `Cover · ${model.name}`),
      el('p', { class: 'dialog-description' }, 'Pick the photo shown on the model card and portfolio.'),
      grid,
      el('div', { class: 'dialog-actions' },
        button('Use automatic cover', { variant: 'btn-ghost', onclick: () => save(null) }),
        button('Cancel', { variant: 'btn-outline', onclick: () => dialog.close() }))));
  showDialog(dialog);
  (dialog.querySelector('.cover-pick button[aria-pressed="true"]') || dialog.querySelector('.cover-pick button, .btn-outline'))?.focus();
}

// ------------------------------------------------ 화면
setChildren(main,
  el('div', { class: 'studio-head' },
    el('div', {}, el('p', { class: 'eyebrow' }, 'Studio'), el('h1', {}, 'Models'), subline),
    el('div', { class: 'studio-actions' },
      button('Add model', { variant: 'btn-primary', iconName: 'plus', onclick: async () => {
        const created = await modelForm(null);
        if (created) { toast('Model added.', { type: 'success' }); state.id = created.id; await refresh(); }
      } }))),
  el('div', { class: 'models-admin' },
    el('aside', { class: 'models-admin-side', 'aria-label': 'Model list' },
      el('div', { class: 'filter-row' },
        el('div', { class: 'search-wrap' }, icon('search'), el('label', { class: 'visually-hidden', for: 'model-search' }, 'Search models'), searchInput),
        sortSelect),
      listBar,
      list),
    detail));

try {
  await refresh();
} catch (error) {
  main.replaceChildren(errorState(error, () => location.reload()));
}
