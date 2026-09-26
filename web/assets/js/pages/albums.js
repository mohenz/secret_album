// 앨범 목록: 커버 그리드 + 작은 정렬 메뉴 하나
import { api } from '../shared/api.js';
import { albumForm } from '../shared/forms.js';
import { albumCard } from '../shared/gallery.js';
import { boot, isOwner } from '../shared/layout.js';
import { button, el, emptyState, errorState, loadingState, plural, setBusy, toastError } from '../shared/ui.js';

const main = document.getElementById('main');
const params = new URLSearchParams(location.search);
const PAGE = 60;
let sort = params.get('sort') || 'shot_desc';
let offset = 0;

const grid = el('div', { class: 'cover-grid', role: 'list' });
const more = button('Load more', { variant: 'btn-outline', onclick: () => loadMore() });
const moreRow = el('div', { class: 'row-actions', hidden: true }, more);
const count = el('p', { class: 'text-meta', role: 'status' });

function head() {
  const select = el('select', { class: 'select', id: 'sort', 'aria-label': 'Sort' },
    [['shot_desc', 'Recently shot'], ['added_desc', 'Recently added'], ['title_asc', 'Title']].map(([v, l]) => el('option', { value: v, selected: v === sort }, l)));
  select.addEventListener('change', () => {
    sort = select.value;
    const url = new URL(location.href);
    url.searchParams.set('sort', sort);
    history.replaceState(null, '', url);
    reload();
  });
  return el('div', { class: 'page-top' },
    el('div', { class: 'page-head' },
      el('div', {}, el('h1', {}, 'Albums'), count),
      el('div', { class: 'row-actions' }, select,
        isOwner() ? button('Create album', { variant: 'btn-outline', iconName: 'plus', onclick: async () => { const r = await albumForm(null); if (r) location.href = `/pages/album.html?id=${r.id}`; } }) : null)));
}

async function loadMore() {
  setBusy(more, true, 'Loading…');
  try {
    const data = await api(`/albums?sort=${sort}&limit=${PAGE}&offset=${offset}`);
    if (offset === 0 && !data.items.length) {
      grid.replaceWith(emptyState('images', 'No albums yet', isOwner() ? 'Create an album and upload photos.' : 'No albums have been shared with you yet.'));
    }
    grid.append(...data.items.map((a) => { const card = albumCard(a); card.setAttribute('role', 'listitem'); return card; }));
    offset += data.items.length;
    count.textContent = plural(data.total, 'album');
    moreRow.hidden = offset >= data.total;
  } catch (error) {
    if (offset === 0) grid.replaceChildren(errorState(error, reload)); else toastError(error);
  } finally { setBusy(more, false); }
}

function reload() {
  offset = 0;
  grid.replaceChildren(loadingState());
  loadMore().then(() => grid.querySelector('.loading')?.remove());
}

await boot({ active: 'albums' });
main.replaceChildren(head(), grid, moreRow);
reload();
