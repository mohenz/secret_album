// 즐겨찾기: 사진 흐름 하나
import { api } from '../shared/api.js';
import { PhotoFlow } from '../shared/gallery.js';
import { boot } from '../shared/layout.js';
import { el, emptyState, errorState, loadingState, plural } from '../shared/ui.js';
import { openViewer } from '../shared/viewer.js';

const main = document.getElementById('main');
const me = await boot({ active: 'favorites' });
const count = el('p', { class: 'text-meta', role: 'status' });
const body = el('div', {}, loadingState());
main.replaceChildren(el('div', { class: 'page-top' }, el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'Favorites'), count))), body);

async function load() {
  try {
    let { items } = await api('/favorites');
    count.textContent = plural(items.length, 'photo');
    if (!items.length) {
      body.replaceChildren(emptyState('heart', 'No favorites yet', 'Tap the heart while viewing a photo to collect it here.'));
      return;
    }
    const flowNode = el('div', { 'aria-label': 'Favorite photos' });
    body.replaceChildren(flowNode);
    const flow = new PhotoFlow(flowNode, items, {
      rowScale: 0.5, // 사용자 요청: 사진 크기 50%
      onOpen: (index) => openViewer({
        items, index, owner: me.user.role === 'owner', hideSeconds: me.settings.viewer_controls_hide_seconds,
        onClose: () => {
          const kept = items.filter((p) => p.fav !== false);
          if (kept.length !== items.length) { items = kept; count.textContent = plural(items.length, 'photo'); flow.setItems(items); }
        },
      }),
    });
  } catch (error) { body.replaceChildren(errorState(error, load)); }
}
load();
