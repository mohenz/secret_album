// 홈: 대표 앨범 히어로 → 최근 앨범 모자이크 → 모델 → 쉼표 사진
import { api } from '../shared/api.js';
import { albumForm, modelForm } from '../shared/forms.js';
import { albumCard, modelCard, photoFrame } from '../shared/gallery.js';
import { boot, isOwner } from '../shared/layout.js';
import { button, el, emptyState, errorState, formatDate, icon, joinMeta, loadingState } from '../shared/ui.js';

const main = document.getElementById('main');

async function load() {
  main.replaceChildren(el('div', { class: 'page-top' }, loadingState()));
  let data;
  try { data = await api('/home'); } catch (error) { main.replaceChildren(el('div', { class: 'page-top' }, errorState(error, load))); return; }
  const header = document.getElementById('site-header');
  if (!data.hero) Object.assign(header.dataset, { overPhoto: 'false', solid: 'true' });
  const blocks = [];
  if (data.hero) {
    const hero = data.hero;
    blocks.push(el('section', { class: 'hero', 'aria-labelledby': 'hero-title' },
      el('a', { class: 'photo-link', href: `/pages/album.html?id=${hero.id}`, tabindex: '-1', 'aria-hidden': 'true' },
        photoFrame(hero.cover.id, { color: hero.cover.color, photo: { id: hero.cover.id, w: hero.cover.w, h: hero.cover.h }, sizes: '100vw', variant: 'large', eager: true })),
      el('div', { class: 'hero-caption' },
        el('h1', { class: 'display-title', id: 'hero-title' }, hero.title),
        el('p', { class: 'hero-meta' }, joinMeta(hero.model_name, formatDate(hero.shot_on))),
        el('a', { class: 'hero-link', href: `/pages/album.html?id=${hero.id}` }, '앨범 보기', icon('chevron-right')))));
  } else {
    blocks.push(el('div', { class: 'page-top' }, el('h1', { class: 'visually-hidden' }, '홈'),
      emptyState('images', '아직 등록된 모델이 없습니다', isOwner() ? '모델을 등록하고 앨범을 만든 뒤 사진을 올려 주세요.' : '공유받은 앨범이 아직 없습니다.',
        isOwner() ? el('div', { class: 'row-actions' },
          button('모델 등록', { variant: 'btn-primary', iconName: 'plus', onclick: async () => { if (await modelForm(null)) load(); } }),
          button('앨범 만들기', { variant: 'btn-outline', onclick: async () => { const r = await albumForm(null); if (r) location.href = `/pages/album.html?id=${r.id}`; } })) : null)));
  }
  if (data.recent_albums.length) {
    blocks.push(el('section', { class: 'section', 'aria-labelledby': 'recent-title' },
      el('div', { class: 'section-head' }, el('h2', { id: 'recent-title' }, '최근 앨범'), el('a', { href: '/pages/albums.html' }, '전체 보기')),
      el('div', { class: 'mosaic' }, data.recent_albums.slice(0, 5).map((a, i) => albumCard(a, { sizes: i === 0 ? '(min-width: 1024px) 50vw, 100vw' : '(min-width: 1024px) 25vw, 50vw' })))));
  }
  if (data.models.length) {
    blocks.push(el('section', { class: 'section', 'aria-labelledby': 'models-title' },
      el('div', { class: 'section-head' }, el('h2', { id: 'models-title' }, '모델'), el('a', { href: '/pages/models.html' }, '전체 보기')),
      el('div', { class: 'model-strip' }, data.models.map(modelCard))));
  }
  if (data.pause_photo) {
    const p = data.pause_photo;
    blocks.push(el('section', { class: 'pause-photo', 'aria-label': '즐겨찾기 사진' },
      el('a', { class: 'photo-link', href: `/pages/album.html?id=${p.album_id}&photo=${p.id}`, 'aria-label': '즐겨찾기 사진 크게 보기' }, photoFrame(p.id, { color: p.color, photo: p, sizes: '100vw', variant: 'large' }))));
  }
  blocks.push(el('footer', { class: 'page-foot' }, 'Shift+H로 언제든 화면을 가릴 수 있습니다.'));
  main.replaceChildren(...blocks);
}

await boot({ active: 'home', overPhoto: true });
load();
