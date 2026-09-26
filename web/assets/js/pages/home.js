// 홈 (가이드 시안 _1): 히어로 → 앨범(큰 커버 + 넓은 커버 + 세로 커버 2) → 쉼표 사진 → 모델 → 푸터
import { api } from '../shared/api.js';
import { albumForm, modelForm } from '../shared/forms.js';
import { modelCard, photoFrame } from '../shared/gallery.js';
import { boot, isOwner } from '../shared/layout.js';
import { button, el, emptyState, errorState, icon, loadingState, setChildren } from '../shared/ui.js';

const main = document.getElementById('main');
let heroAlbumId = null;

function featureCard(album, kind, label) {
  const cover = album.cover ? { id: album.cover.id, w: album.cover.w || 16, h: album.cover.h || 10 } : null;
  const sizes = kind === 'feature-main' ? '(min-width: 1024px) 55vw, 100vw' : kind === 'feature-wide' ? '(min-width: 1024px) 40vw, 100vw' : '(min-width: 1024px) 20vw, 50vw';
  return el('a', { class: `feature-card ${kind}`, href: `/pages/album.html?id=${album.id}` },
    label ? el('span', { class: 'feature-label' }, label) : null,
    photoFrame(cover?.id, { color: album.cover?.color, photo: cover, sizes, variant: kind === 'feature-tall' ? 'medium' : 'large', alt: '' }),
    el('span', { class: 'caption' }, album.title));
}

async function load() {
  main.replaceChildren(el('div', { class: 'page-top' }, loadingState()));
  let data;
  try { data = await api('/home'); } catch (error) { main.replaceChildren(el('div', { class: 'page-top' }, errorState(error, load))); return; }
  const header = document.getElementById('site-header');
  if (!data.hero) Object.assign(header.dataset, { overPhoto: 'false', solid: 'true' });
  heroAlbumId = data.hero?.id || null;
  const blocks = [];
  if (data.hero) {
    const hero = data.hero;
    blocks.push(el('section', { class: 'hero', 'aria-labelledby': 'hero-title' },
      // 사진 전체를 보여 주고(잘라 내지 않음), 남는 여백은 같은 사진을 흐리게 깔아 채운다.
      el('div', { class: 'hero-backdrop', 'aria-hidden': 'true' }, photoFrame(hero.cover.id, { color: hero.cover.color, variant: 'thumb', alt: '' })),
      el('a', { class: 'photo-link', href: `/pages/album.html?id=${hero.id}`, tabindex: '-1', 'aria-hidden': 'true' },
        photoFrame(hero.cover.id, { color: hero.cover.color, photo: { id: hero.cover.id, w: hero.cover.w, h: hero.cover.h }, sizes: '(min-width: 1024px) 50vw, 100vw', variant: 'large', eager: true })),
      el('div', { class: 'hero-caption' },
        el('h1', { class: 'visually-hidden', id: 'hero-title' }, hero.title), // 화면에는 제목을 표시하지 않는다(화면 낭독기용으로만 유지).
        el('a', { class: 'hero-go', href: `/pages/album.html?id=${hero.id}`, 'aria-label': `View album ${hero.title}` }, icon('arrow-right', 'icon-20'))),
      el('span', { class: 'scroll-cue', 'aria-hidden': 'true' }, icon('chevron-down', 'icon-20'))));
  } else {
    blocks.push(el('div', { class: 'page-top' }, el('h1', { class: 'visually-hidden' }, 'Home'),
      emptyState('images', 'No models yet', isOwner() ? 'Add a model, create an album, then upload photos.' : 'No albums have been shared with you yet.',
        isOwner() ? el('div', { class: 'row-actions' },
          button('Add model', { variant: 'btn-primary', iconName: 'plus', onclick: async () => { if (await modelForm(null)) load(); } }),
          button('Create album', { variant: 'btn-outline', onclick: async () => { const r = await albumForm(null); if (r) location.href = `/pages/album.html?id=${r.id}`; } })) : null)));
  }
  // 히어로 앨범도 앨범 영역에 포함한다 (앨범이 하나뿐이어도 영역이 보이도록).
  const albums = [data.hero, ...data.recent_albums].filter(Boolean);
  if (albums.length) {
    const [first, second, third, fourth] = albums;
    blocks.push(el('section', { class: 'home-section', 'aria-labelledby': 'albums-title' },
      el('h2', { id: 'albums-title' }, 'Albums'),
      el('div', { class: 'feature-grid' },
        el('div', { class: 'feature-main-wrap' }, featureCard(first, 'feature-main', 'Latest')),
        second ? el('div', { class: 'feature-side' },
          featureCard(second, 'feature-wide'),
          third ? featureCard(third, 'feature-tall') : null,
          fourth ? featureCard(fourth, 'feature-tall') : null) : null)));
  }
  if (data.pause_photo) {
    const p = data.pause_photo;
    blocks.push(el('section', { class: 'pause-band', 'aria-label': 'Favorite photo' },
      el('a', { class: 'photo-link', href: `/pages/album.html?id=${p.album_id}&photo=${p.id}`, 'aria-label': 'View favorite photo' }, photoFrame(p.id, { color: p.color, photo: p, sizes: '100vw', variant: 'large' }))));
  }
  if (data.models.length) {
    blocks.push(el('section', { class: 'home-section plain', 'aria-labelledby': 'models-title' },
      el('h2', { id: 'models-title' }, 'Models'),
      el('div', { class: 'model-row' }, data.models.slice(0, 4).map(modelCard))));
  }
  blocks.push(el('footer', { class: 'site-footer center' }, `© ${new Date().getFullYear()} Private Exhibition`));
  setChildren(main, ...blocks);
}

await boot({ active: 'home', overPhoto: true, onSlideshow: () => { if (heroAlbumId) location.href = `/pages/album.html?id=${heroAlbumId}&slideshow=1`; } });
load();
