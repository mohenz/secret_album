// 모델: 포트폴리오형 표지 → 앨범 커버 → 모든 사진
import { api } from '../shared/api.js';
import { albumForm, modelForm } from '../shared/forms.js';
import { albumCard, photoFrame, PhotoFlow } from '../shared/gallery.js';
import { boot, isOwner } from '../shared/layout.js';
import { button, confirmDialog, el, errorState, emptyState, formatNumber, iconButton, joinMeta, loadingState, openMenu, toastError } from '../shared/ui.js';
import { openViewer } from '../shared/viewer.js';

const main = document.getElementById('main');
const params = new URLSearchParams(location.search);
const modelId = params.get('id');

function setPhotoParam(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('photo', id); else url.searchParams.delete('photo');
  history.replaceState(null, '', url);
}

const me = await boot({ active: 'models' });
main.replaceChildren(el('div', { class: 'page-top' }, loadingState()));
try {
  const [model, { items: photos }] = await Promise.all([api(`/models/${modelId}`), api(`/models/${modelId}/photos`)]);
  const owner = isOwner();
  const menuButton = owner ? iconButton('ellipsis', '모델 메뉴', () => openMenu(menuButton, [
    { label: '모델 정보 수정', icon: 'pencil', onSelect: async () => { if (await modelForm(model)) location.reload(); } },
    { label: '앨범 만들기', icon: 'plus', onSelect: async () => { const r = await albumForm(null, { modelId }); if (r) location.href = `/pages/album.html?id=${r.id}`; } },
    'separator',
    { label: '모델을 휴지통으로 이동', icon: 'trash-2', danger: true, onSelect: async () => {
      const ok = await confirmDialog({ title: '모델을 휴지통으로 옮길까요?', description: `‘${model.name}’의 앨범 ${formatNumber(model.album_count)}개와 사진 ${formatNumber(model.photo_count)}장이 함께 휴지통으로 이동합니다.`, confirmLabel: '모델을 휴지통으로 이동', destructive: true });
      if (!ok) return;
      try { await api(`/models/${modelId}`, { method: 'DELETE' }); location.replace('/pages/models.html'); } catch (error) { toastError(error); }
    } },
  ])) : null;
  menuButton?.setAttribute('aria-haspopup', 'menu');

  const flowNode = el('div', { 'aria-label': '모든 사진' });
  const flow = new PhotoFlow(flowNode, photos, {
    onOpen: (index) => openViewer({
      items: photos, index, owner, hideSeconds: me.settings.viewer_controls_hide_seconds,
      onChange: (p) => setPhotoParam(p.id), onFavorite: () => flow.layout(),
      onClose: (p) => { setPhotoParam(null); if (p) flow.focusPhoto(p.id); },
    }),
  });
  main.replaceChildren(
    el('section', { class: 'model-hero', 'aria-labelledby': 'model-name' },
      photoFrame(model.cover?.id, { color: model.cover?.color, sizes: '(min-width: 1024px) 42vw, 100vw', variant: 'large', eager: true, alt: '' }),
      el('div', { class: 'model-hero-text' },
        el('h1', { class: 'display-title', id: 'model-name' }, model.name),
        model.stage_name ? el('p', { class: 'text-section' }, model.stage_name) : null,
        el('p', { class: 'text-meta', 'data-numeric': true }, joinMeta(`앨범 ${formatNumber(model.album_count)}개`, `사진 ${formatNumber(model.photo_count)}장`)),
        model.bio ? el('p', { class: 'readable' }, model.bio) : null,
        el('div', { class: 'row-actions', style: undefined }, menuButton))),
    el('section', { class: 'section', 'aria-labelledby': 'albums-title' },
      el('div', { class: 'section-head' }, el('h2', { id: 'albums-title' }, '앨범')),
      model.albums.length ? el('div', { class: 'cover-grid' }, model.albums.map((a) => albumCard(a, { showModel: false })))
        : emptyState('images', '앨범이 없습니다', owner ? '메뉴에서 앨범을 만들어 주세요.' : null, owner ? button('앨범 만들기', { variant: 'btn-outline', iconName: 'plus', onclick: async () => { const r = await albumForm(null, { modelId }); if (r) location.href = `/pages/album.html?id=${r.id}`; } }) : null)),
    photos.length ? el('section', { class: 'section', 'aria-labelledby': 'photos-title' },
      el('div', { class: 'section-head' }, el('h2', { id: 'photos-title' }, '모든 사진')), flowNode) : null,
    el('footer', { class: 'page-foot' }, 'Shift+H로 언제든 화면을 가릴 수 있습니다.'));
  const photoParam = params.get('photo');
  const index = photoParam ? photos.findIndex((p) => p.id === photoParam) : -1;
  if (index >= 0) flow.options.onOpen(index);
} catch (error) {
  main.replaceChildren(el('div', { class: 'page-top' }, errorState(error, () => location.reload())));
}
