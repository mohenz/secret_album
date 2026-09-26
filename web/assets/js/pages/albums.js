// 앨범 목록: 커버 그리드 + 작은 정렬 메뉴 하나
import { api } from '../shared/api.js';
import { albumForm } from '../shared/forms.js';
import { albumCard } from '../shared/gallery.js';
import { boot, isOwner } from '../shared/layout.js';
import { button, el, emptyState, errorState, loadingState, setBusy, toastError } from '../shared/ui.js';

const main = document.getElementById('main');
const params = new URLSearchParams(location.search);
const PAGE = 60;
let sort = params.get('sort') || 'shot_desc';
let offset = 0;

const grid = el('div', { class: 'cover-grid', role: 'list' });
const more = button('더 보기', { variant: 'btn-outline', onclick: () => loadMore() });
const moreRow = el('div', { class: 'row-actions', hidden: true }, more);
const count = el('p', { class: 'text-meta', role: 'status' });

function head() {
  const select = el('select', { class: 'select', id: 'sort', 'aria-label': '정렬' },
    [['shot_desc', '최근 촬영순'], ['added_desc', '최근 추가순'], ['title_asc', '이름순']].map(([v, l]) => el('option', { value: v, selected: v === sort }, l)));
  select.addEventListener('change', () => {
    sort = select.value;
    const url = new URL(location.href);
    url.searchParams.set('sort', sort);
    history.replaceState(null, '', url);
    reload();
  });
  return el('div', { class: 'page-top' },
    el('div', { class: 'page-head' },
      el('div', {}, el('h1', {}, '앨범'), count),
      el('div', { class: 'row-actions' }, select,
        isOwner() ? button('앨범 만들기', { variant: 'btn-outline', iconName: 'plus', onclick: async () => { const r = await albumForm(null); if (r) location.href = `/pages/album.html?id=${r.id}`; } }) : null)));
}

async function loadMore() {
  setBusy(more, true, '불러오는 중…');
  try {
    const data = await api(`/albums?sort=${sort}&limit=${PAGE}&offset=${offset}`);
    if (offset === 0 && !data.items.length) {
      grid.replaceWith(emptyState('images', '앨범이 없습니다', isOwner() ? '앨범을 만들고 사진을 올려 주세요.' : '공유받은 앨범이 아직 없습니다.'));
    }
    grid.append(...data.items.map((a) => { const card = albumCard(a); card.setAttribute('role', 'listitem'); return card; }));
    offset += data.items.length;
    count.textContent = `${new Intl.NumberFormat('ko-KR').format(data.total)}개`;
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
