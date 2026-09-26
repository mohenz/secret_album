// 모델 목록
import { api } from '../shared/api.js';
import { modelForm } from '../shared/forms.js';
import { modelCard } from '../shared/gallery.js';
import { boot, isOwner } from '../shared/layout.js';
import { button, el, emptyState, errorState, formatNumber, loadingState } from '../shared/ui.js';

const main = document.getElementById('main');
let sort = new URLSearchParams(location.search).get('sort') || 'name_asc';
const grid = el('div', { class: 'cover-grid', role: 'list' });
const count = el('p', { class: 'text-meta', role: 'status' });

async function load() {
  grid.replaceChildren(loadingState());
  try {
    const { items } = await api(`/models?sort=${sort}`);
    count.textContent = `${formatNumber(items.length)}명`;
    if (!items.length) {
      grid.replaceChildren(emptyState('user', '등록된 모델이 없습니다', isOwner() ? '모델을 등록하면 앨범을 만들 수 있습니다.' : null));
      return;
    }
    grid.replaceChildren(...items.map((m) => { const card = modelCard(m); card.setAttribute('role', 'listitem'); return card; }));
  } catch (error) { grid.replaceChildren(errorState(error, load)); }
}

await boot({ active: 'models' });
const select = el('select', { class: 'select', 'aria-label': '정렬' },
  [['name_asc', '이름순'], ['recent_desc', '최근 촬영순'], ['photos_desc', '사진 많은 순']].map(([v, l]) => el('option', { value: v, selected: v === sort }, l)));
select.addEventListener('change', () => {
  sort = select.value;
  const url = new URL(location.href);
  url.searchParams.set('sort', sort);
  history.replaceState(null, '', url);
  load();
});
main.replaceChildren(
  el('div', { class: 'page-top' }, el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, '모델'), count),
    el('div', { class: 'row-actions' }, select, isOwner() ? button('모델 등록', { variant: 'btn-outline', iconName: 'plus', onclick: async () => { const r = await modelForm(null); if (r) location.href = `/pages/model.html?id=${r.id}`; } }) : null))),
  grid);
load();
