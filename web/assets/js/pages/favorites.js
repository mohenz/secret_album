// 즐겨찾기: 사진 흐름 하나
import { api } from '../shared/api.js';
import { PhotoFlow } from '../shared/gallery.js';
import { boot } from '../shared/layout.js';
import { el, emptyState, errorState, formatNumber, loadingState } from '../shared/ui.js';
import { openViewer } from '../shared/viewer.js';

const main = document.getElementById('main');
const me = await boot({ active: 'favorites' });
const count = el('p', { class: 'text-meta', role: 'status' });
const body = el('div', {}, loadingState());
main.replaceChildren(el('div', { class: 'page-top' }, el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, '즐겨찾기'), count))), body);

async function load() {
  try {
    let { items } = await api('/favorites');
    count.textContent = `${formatNumber(items.length)}장`;
    if (!items.length) {
      body.replaceChildren(emptyState('heart', '아직 즐겨찾기한 사진이 없습니다', '사진을 볼 때 하트를 눌러 모아 보세요.'));
      return;
    }
    const flowNode = el('div', { 'aria-label': '즐겨찾기 사진' });
    body.replaceChildren(flowNode);
    const flow = new PhotoFlow(flowNode, items, {
      onOpen: (index) => openViewer({
        items, index, owner: me.user.role === 'owner', hideSeconds: me.settings.viewer_controls_hide_seconds,
        onClose: () => {
          const kept = items.filter((p) => p.fav !== false);
          if (kept.length !== items.length) { items = kept; count.textContent = `${formatNumber(items.length)}장`; flow.setItems(items); }
        },
      }),
    });
  } catch (error) { body.replaceChildren(errorState(error, load)); }
}
load();
