// 퀵 업로드 (cinetube 갤러리 퀵등록 방식)
// 왼쪽: 빠른 등록 — 앨범 선택, 붙여넣기(Ctrl+V)·끌어 놓기·클릭, 한 줄 상태 표시
// 오른쪽: 등록 확인 — 최근 올린 사진 2장, 오늘 등록만·새로고침·검색, 앨범에서 보기·휴지통
import { api } from '../shared/api.js';
import { albumForm } from '../shared/forms.js';
import { photoFrame } from '../shared/gallery.js';
import { boot } from '../shared/layout.js';
import { canReadClipboard, createStatusLine, enablePageDrop, enablePagePaste, QuickUploader, readClipboardImages } from '../shared/uploader.js';
import { button, el, errorState, formatDateTime, icon, joinMeta, loadingState, setChildren, toast, toastError } from '../shared/ui.js';

const main = document.getElementById('main');
await boot({ ownerOnly: true });
main.className = 'manage-page quick-page';
main.replaceChildren(loadingState());

const ALBUM_KEY = 'album-quick-upload-album';
const REVIEW_LIMIT = 2;
const preset = new URLSearchParams(location.search).get('album');
let albums = [];
let reviewItems = [];
let todayOnly = false;
let pollTimer = null;

// ------------------------------------------------ 빠른 등록
const albumSelect = el('select', { class: 'select', id: 'album', required: true, 'aria-describedby': 'album-error' });
const albumError = el('p', { class: 'field-error', id: 'album-error' });
albumSelect.addEventListener('change', () => {
  try { localStorage.setItem(ALBUM_KEY, albumSelect.value); } catch { /* 이 기기에 저장할 수 없음 */ }
  albumError.textContent = '';
  albumSelect.removeAttribute('aria-invalid');
});

async function loadAlbums(selectId) {
  albums = (await api('/albums?sort=added_desc&limit=1000')).items;
  let remembered = null;
  try { remembered = localStorage.getItem(ALBUM_KEY); } catch { /* 없음 */ }
  albumSelect.replaceChildren(el('option', { value: '' }, 'Choose an album'),
    ...albums.map((a) => el('option', { value: a.id }, joinMeta(a.title, a.model_name))));
  const wanted = [selectId, remembered].find((id) => id && albums.some((a) => a.id === id));
  albumSelect.value = wanted || '';
}

const status = createStatusLine();
const uploader = new QuickUploader({
  getAlbumId: () => albumSelect.value,
  status,
  onNoAlbum: () => {
    albumSelect.setAttribute('aria-invalid', 'true');
    albumError.replaceChildren(icon('circle-alert'), el('span', {}, 'Choose an album to upload to first.'));
    albumSelect.focus();
  },
  onSaved: () => loadReview(),
});

const fileInput = el('input', { type: 'file', id: 'files', multiple: true, accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif', class: 'visually-hidden', tabindex: '-1' });
fileInput.addEventListener('change', () => { uploader.add(fileInput.files, 'upload'); fileInput.value = ''; });

// 드롭존은 라벨이라 클릭하면 파일 선택이 열린다. 키보드는 Enter·Space로 연다.
const dropzone = el('label', { class: 'quick-dropzone', for: 'files', tabindex: '0', id: 'dropzone' },
  icon('image-plus', 'icon-32'),
  el('strong', {}, 'Paste (Ctrl+V) or drag images here'),
  el('small', {}, 'Images are saved as soon as you paste them. Paste several and they are saved in order. Click to choose files.'),
  fileInput);
dropzone.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  fileInput.click();
});
for (const type of ['dragenter', 'dragover']) dropzone.addEventListener(type, (event) => { event.preventDefault(); dropzone.dataset.over = 'true'; });
for (const type of ['dragleave', 'drop']) dropzone.addEventListener(type, () => { dropzone.dataset.over = 'false'; });

enablePageDrop((files) => uploader.add(files, 'upload'));
enablePagePaste((files) => uploader.add(files, 'clipboard'), () => status.set('The clipboard has no image. Copy an image or take a screenshot, then paste again.', 'error'));

async function pasteFromButton() {
  try {
    const files = await readClipboardImages();
    if (files.length) uploader.add(files, 'clipboard');
    else status.set('The clipboard has no image. Copy an image or take a screenshot, then try again.', 'error');
  } catch {
    status.set('Could not read the clipboard. Allow clipboard access in the browser, or press Ctrl+V instead.', 'error');
  }
}

// ------------------------------------------------ 등록 확인
const reviewCount = el('span', { class: 'tab-count', 'data-numeric': true });
const reviewGrid = el('div', { class: 'quick-review-grid', 'aria-live': 'polite' });
const searchInput = el('input', { class: 'input', type: 'search', id: 'review-search', autocomplete: 'off', spellcheck: 'false', placeholder: 'File name, album, tag' });
searchInput.addEventListener('input', renderReview);
const todayButton = button('Today only', { variant: 'btn-outline', onclick: () => {
  todayOnly = !todayOnly;
  todayButton.setAttribute('aria-pressed', String(todayOnly));
  renderReview();
} });
todayButton.setAttribute('aria-pressed', 'false');

function isToday(value) {
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function statusBadge(item) {
  if (item.status === 'ready') return el('span', { class: 'badge badge-success' }, icon('circle-check'), 'Ready');
  if (item.status === 'failed') return el('span', { class: 'badge badge-error', title: item.error || '' }, icon('circle-alert'), 'Failed');
  return el('span', { class: 'badge badge-warning' }, icon('loader-circle', 'spin'), 'Processing…');
}

async function trashItem(item) {
  try {
    await api('/photos/bulk', { method: 'POST', body: { action: 'trash', ids: [item.id] } });
    reviewItems = reviewItems.filter((entry) => entry.id !== item.id);
    renderReview();
    toast(`Moved ${item.filename} to trash.`, {
      type: 'success', actionLabel: 'Undo', duration: 5000,
      onAction: async () => { try { await api('/trash/restore', { method: 'POST', body: { type: 'photo', ids: [item.id] } }); loadReview(); } catch (error) { toastError(error); } },
    });
  } catch (error) { toastError(error); }
}

function reviewCard(item) {
  const thumb = item.status === 'ready'
    ? photoFrame(item.id, { color: item.color, photo: { id: item.id, w: item.w, h: item.h }, sizes: '240px', variant: 'thumb', alt: item.filename })
    : el('div', { class: 'photo-frame quick-review-empty' }, icon(item.status === 'failed' ? 'circle-alert' : 'loader-circle', item.status === 'failed' ? 'icon-24' : 'spin icon-24'));
  return el('article', { class: 'quick-review-card' },
    el('div', { class: 'quick-review-thumb' }, thumb),
    el('h3', { title: item.filename }, item.filename),
    el('div', { class: 'quick-review-meta' }, statusBadge(item), el('span', { class: 'badge' }, item.album_title), item.tags.length ? el('span', { class: 'badge' }, item.tags.join(', ')) : null),
    el('p', { class: 'text-meta' }, formatDateTime(item.created_at)),
    item.status === 'failed' && item.error ? el('p', { class: 'field-error' }, item.error) : null,
    el('div', { class: 'quick-review-actions' },
      el('a', { class: 'btn btn-outline', href: `/pages/album.html?id=${item.album_id}${item.status === 'ready' ? `&photo=${item.id}` : ''}` }, 'View in album'),
      button('Move to trash', { variant: 'btn-ghost', iconName: 'trash-2', onclick: () => trashItem(item), ariaLabel: `Move ${item.filename} to trash` })));
}

function renderReview() {
  const term = searchInput.value.trim().toLowerCase();
  let items = reviewItems;
  if (todayOnly) items = items.filter((item) => isToday(item.created_at));
  if (term) items = items.filter((item) => [item.filename, item.album_title, item.model_name, item.tags.join(' ')].join(' ').toLowerCase().includes(term));
  const shown = items.slice(0, REVIEW_LIMIT);
  reviewCount.textContent = reviewItems.length ? (shown.length < items.length ? ` (${shown.length}/${items.length})` : ` (${items.length})`) : '';
  if (!items.length) {
    reviewGrid.replaceChildren(el('div', { class: 'empty' }, reviewItems.length ? 'No uploads match.' : 'No uploads yet.'));
    return;
  }
  reviewGrid.replaceChildren(...shown.map(reviewCard));
}

async function pollProcessing() {
  clearTimeout(pollTimer);
  const pending = reviewItems.filter((item) => item.status === 'processing').slice(0, 200);
  if (!pending.length) return;
  pollTimer = setTimeout(async () => {
    try {
      const { items } = await api(`/uploads/status?ids=${pending.map((p) => p.id).join(',')}`);
      if (items.some((s) => s.status !== 'processing')) { await loadReview(); return; }
    } catch { /* 다음 확인 때 다시 */ }
    pollProcessing();
  }, 2000);
}

async function loadReview() {
  try {
    reviewItems = (await api('/uploads/recent?limit=200')).items;
    renderReview();
    pollProcessing();
  } catch (error) { reviewGrid.replaceChildren(errorState(error, loadReview)); }
}

// ------------------------------------------------ 화면
try {
  await loadAlbums(preset);
  setChildren(main,
    el('div', { class: 'page-head' }, el('div', {},
      el('h1', {}, 'Quick upload'),
      el('p', { class: 'text-meta' }, 'Paste or drop images and they are saved right away. Check the results on the right.'))),
    el('div', { class: 'quick-split' },
      el('section', { class: 'panel quick-pane', 'aria-labelledby': 'quick-title', id: 'registerPanel' },
        el('div', { class: 'quick-pane-head' }, el('h2', { id: 'quick-title' }, icon('zap', 'icon-20'), 'Quick add')),
        el('div', { class: 'field' },
          el('label', { class: 'label', for: 'album' }, 'Album'),
          el('div', { class: 'album-picker' }, albumSelect, button('New album', { variant: 'btn-outline', iconName: 'plus', onclick: async () => {
            const created = await albumForm(null);
            if (created) { await loadAlbums(created.id); albumSelect.dispatchEvent(new Event('change')); status.set('Album created.', 'done'); }
          } })),
          albumError),
        dropzone,
        canReadClipboard() ? el('div', { class: 'row-actions' }, button('Paste from clipboard', { variant: 'btn-outline', iconName: 'copy', onclick: pasteFromButton })) : null,
        status.node),
      el('section', { class: 'panel quick-pane', 'aria-labelledby': 'review-title', id: 'reviewPanel' },
        el('div', { class: 'quick-pane-head' }, el('h2', { id: 'review-title' }, icon('list-checks', 'icon-20'), 'Review', reviewCount)),
        el('div', { class: 'quick-review-toolbar' },
          el('p', { class: 'text-meta' }, `Shows the ${REVIEW_LIMIT} most recent uploads. Search by file name, album, or tag.`),
          el('label', { class: 'visually-hidden', for: 'review-search' }, 'Search uploads'),
          searchInput,
          todayButton,
          button('Refresh', { variant: 'btn-ghost', iconName: 'refresh-cw', onclick: loadReview })),
        reviewGrid)));
  await loadReview();
} catch (error) {
  main.replaceChildren(errorState(error, () => location.reload()));
}
