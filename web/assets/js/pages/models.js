// 모델 목록
import { api } from '../shared/api.js';
import { modelForm } from '../shared/forms.js';
import { modelCard } from '../shared/gallery.js';
import { boot, isOwner } from '../shared/layout.js';
import { button, el, emptyState, errorState, loadingState, plural } from '../shared/ui.js';

const main = document.getElementById('main');
let sort = new URLSearchParams(location.search).get('sort') || 'name_asc';
const grid = el('div', { class: 'cover-grid', role: 'list' });
const count = el('p', { class: 'text-meta', role: 'status' });

async function load() {
  grid.replaceChildren(loadingState());
  try {
    const { items } = await api(`/models?sort=${sort}`);
    count.textContent = plural(items.length, 'model');
    if (!items.length) {
      grid.replaceChildren(emptyState('user', 'No models yet', isOwner() ? 'Add a model to start creating albums.' : null));
      return;
    }
    grid.replaceChildren(...items.map((m) => { const card = modelCard(m); card.setAttribute('role', 'listitem'); return card; }));
  } catch (error) { grid.replaceChildren(errorState(error, load)); }
}

await boot({ active: 'models' });
const select = el('select', { class: 'select', 'aria-label': 'Sort' },
  [['name_asc', 'Name'], ['recent_desc', 'Recently shot'], ['photos_desc', 'Most photos']].map(([v, l]) => el('option', { value: v, selected: v === sort }, l)));
select.addEventListener('change', () => {
  sort = select.value;
  const url = new URL(location.href);
  url.searchParams.set('sort', sort);
  history.replaceState(null, '', url);
  load();
});
main.replaceChildren(
  el('div', { class: 'page-top' }, el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, 'Models'), count),
    el('div', { class: 'row-actions' }, select, isOwner() ? button('Add model', { variant: 'btn-outline', iconName: 'plus', onclick: async () => { const r = await modelForm(null); if (r) location.href = `/pages/model.html?id=${r.id}`; } }) : null))),
  grid);
load();
