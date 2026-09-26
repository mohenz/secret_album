// 검색 결과: 모델·앨범·태그·사진
import { api } from '../shared/api.js';
import { albumCard, modelCard, PhotoFlow } from '../shared/gallery.js';
import { boot } from '../shared/layout.js';
import { el, emptyState, errorState, formatNumber, icon, loadingState } from '../shared/ui.js';
import { openViewer } from '../shared/viewer.js';

const main = document.getElementById('main');
const query = (new URLSearchParams(location.search).get('q') || '').trim();
const me = await boot({ active: '' });

const input = el('input', { class: 'input', type: 'search', id: 'search-q', value: query, autocomplete: 'off', spellcheck: 'false' });
const form = el('form', { role: 'search', class: 'row-actions', onsubmit: (event) => {
  event.preventDefault();
  const q = input.value.trim();
  if (q) location.href = `/pages/search.html?q=${encodeURIComponent(q)}`;
} }, el('label', { class: 'visually-hidden', for: 'search-q' }, '검색어'), input, el('button', { type: 'submit', class: 'btn btn-primary' }, icon('search'), '검색'));
const body = el('div', {}, query ? loadingState() : null);
main.replaceChildren(el('div', { class: 'page-top' }, el('div', { class: 'page-head' }, el('h1', {}, query ? `‘${query}’ 검색 결과` : '검색'), form)), body);

function section(title, content, id) {
  return el('section', { class: 'section', 'aria-labelledby': id }, el('div', { class: 'section-head' }, el('h2', { id }, title)), content);
}

async function load() {
  if (!query) { input.focus(); return; }
  try {
    const data = await api(`/search?q=${encodeURIComponent(query)}`);
    const blocks = [];
    if (data.models.length) blocks.push(section(`모델 ${formatNumber(data.models.length)}`, el('div', { class: 'cover-grid' }, data.models.map(modelCard)), 'r-models'));
    if (data.albums.length) blocks.push(section(`앨범 ${formatNumber(data.albums.length)}`, el('div', { class: 'cover-grid' }, data.albums.map((a) => albumCard(a))), 'r-albums'));
    if (data.tags.length) blocks.push(section('태그', el('div', { class: 'chip-row', style: undefined },
      data.tags.map((t) => el('a', { class: 'tag-chip', href: `/pages/search.html?q=${encodeURIComponent(t.name)}` }, icon('tag'), t.name, el('span', { class: 'text-meta' }, formatNumber(t.count))))), 'r-tags'));
    if (data.photos.length) {
      const flowNode = el('div', { 'aria-label': '사진' });
      blocks.push(section(`사진 ${formatNumber(data.photos.length)}`, flowNode, 'r-photos'));
      const flow = new PhotoFlow(flowNode, data.photos, {
        onOpen: (index) => openViewer({ items: data.photos, index, owner: me.user.role === 'owner', hideSeconds: me.settings.viewer_controls_hide_seconds, onFavorite: () => flow.layout() }),
      });
    }
    body.replaceChildren(...(blocks.length ? blocks : [emptyState('search', `‘${query}’에 맞는 사진이 없습니다`, '다른 검색어를 입력해 보세요.')]));
  } catch (error) { body.replaceChildren(errorState(error, load)); }
}
load();
