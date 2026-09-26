// 업로드: 모델·앨범 선택 → 끌어 놓기/파일 선택 → 파일별 진행 상태
import { api } from '../shared/api.js';
import { albumForm } from '../shared/forms.js';
import { boot } from '../shared/layout.js';
import { enablePageDrop, Uploader } from '../shared/uploader.js';
import { button, el, errorState, icon, joinMeta, loadingState, toast } from '../shared/ui.js';

const main = document.getElementById('main');
await boot({ ownerOnly: true });
main.className = 'manage-page';
main.replaceChildren(loadingState());

const preset = new URLSearchParams(location.search).get('album');
let albums = [];
const albumSelect = el('select', { class: 'select', id: 'album', required: true, 'aria-describedby': 'album-error' });
const albumError = el('p', { class: 'field-error', id: 'album-error' });

async function loadAlbums(selectId) {
  albums = (await api('/albums?sort=added_desc&limit=1000')).items;
  albumSelect.replaceChildren(el('option', { value: '' }, '앨범을 선택해 주세요'),
    ...albums.map((a) => el('option', { value: a.id }, joinMeta(a.title, a.model_name))));
  albumSelect.value = selectId && albums.some((a) => a.id === selectId) ? selectId : '';
}

const fileInput = el('input', { type: 'file', id: 'files', multiple: true, accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif', class: 'visually-hidden' });
const dropzone = el('div', { class: 'dropzone' },
  icon('upload', 'icon-32'),
  el('p', { class: 'text-card' }, '사진을 여기에 끌어 놓으세요'),
  el('p', { class: 'text-ui' }, 'JPEG·PNG·WebP·HEIC, 파일당 200MB까지'),
  el('label', { class: 'btn btn-primary', for: 'files' }, icon('images'), '파일 선택'),
  fileInput);
const list = el('div', { class: 'upload-list', role: 'list', 'aria-label': '업로드 목록' });
const summary = el('div', { class: 'upload-summary', role: 'status' });
const doneLink = el('a', { class: 'btn btn-outline', hidden: true }, '앨범 보기');

const uploader = new Uploader({
  list, summary, getAlbumId: () => albumSelect.value,
  onFinished: (entries) => {
    doneLink.hidden = false;
    doneLink.href = `/pages/album.html?id=${albumSelect.value}`;
    const ok = entries.filter((e) => e.state === 'done').length;
    toast(`업로드를 마쳤습니다. 성공 ${ok}장`, { type: 'success' });
  },
});

function addFiles(files) {
  albumError.textContent = '';
  albumSelect.removeAttribute('aria-invalid');
  if (!albumSelect.value) {
    albumSelect.setAttribute('aria-invalid', 'true');
    albumError.replaceChildren(icon('circle-alert'), el('span', {}, '업로드할 앨범을 먼저 선택해 주세요.'));
    albumSelect.focus();
    return;
  }
  uploader.add(files);
  list.hidden = false;
}

fileInput.addEventListener('change', () => { if (fileInput.files.length) addFiles(fileInput.files); fileInput.value = ''; });
dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.dataset.over = 'true'; });
dropzone.addEventListener('dragleave', () => { dropzone.dataset.over = 'false'; });
dropzone.addEventListener('drop', () => { dropzone.dataset.over = 'false'; });
enablePageDrop(addFiles);

try {
  await loadAlbums(preset);
  main.replaceChildren(
    el('div', { class: 'page-head' }, el('h1', {}, '사진 업로드')),
    el('section', { class: 'panel', 'aria-labelledby': 'target-title' },
      el('h2', { id: 'target-title' }, '올릴 앨범'),
      el('p', { class: 'panel-desc' }, '앨범을 고르면 그 앨범의 모델로 사진이 분류됩니다.'),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'album' }, '앨범'), albumSelect, albumError),
      el('div', { class: 'row-actions' }, button('새 앨범 만들기', { variant: 'btn-outline', iconName: 'plus', onclick: async () => {
        const created = await albumForm(null);
        if (created) { await loadAlbums(created.id); toast('앨범을 만들었습니다.', { type: 'success' }); }
      } }))),
    dropzone,
    el('div', { class: 'upload-summary-row toolbar' }, summary, doneLink),
    list);
  list.hidden = true;
} catch (error) {
  main.replaceChildren(errorState(error, () => location.reload()));
}
