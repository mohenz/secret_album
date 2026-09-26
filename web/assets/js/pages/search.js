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
} }, el('label', { class: 'visually-hidden', for: 'search-q' }, 'Search terms'), input, el('button', { type: 'submit', class: 'btn btn-primary' }, icon('search'), 'Search'));
const body = el('div', {}, query ? loadingState() : null);
main.replaceChildren(el('div', { class: 'page-top' }, el('div', { class: 'page-head' }, el('h1', {}, query ? `Results for “${query}”` : 'Search'), form)), body);

function section(title, content, id) {
  return el('section', { class: 'section', 'aria-labelledby': id }, el('div', { class: 'section-head' }, el('h2', { id }, title)), content);
}

async function load() {
  if (!query) { input.focus(); return; }
  try {
    const data = await api(`/search?q=${encodeURIComponent(query)}`);
    const blocks = [];
    if (data.models.length) blocks.push(section(`Models ${formatNumber(data.models.length)}`, el('div', { class: 'cover-grid' }, data.models.map(modelCard)), 'r-models'));
    if (data.albums.length) blocks.push(section(`Albums ${formatNumber(data.albums.length)}`, el('div', { class: 'cover-grid' }, data.albums.map((a) => albumCard(a))), 'r-albums'));
    if (data.tags.length) blocks.push(section('Tags', el('div', { class: 'chip-row', style: undefined },
      data.tags.map((t) => el('a', { class: 'tag-chip', href: `/pages/search.html?q=${encodeURIComponent(t.name)}` }, icon('tag'), t.name, el('span', { class: 'text-meta' }, formatNumber(t.count))))), 'r-tags'));
    if (data.photos.length) {
      const flowNode = el('div', { 'aria-label': 'Photos' });
      blocks.push(section(`Photos ${formatNumber(data.photos.length)}`, flowNode, 'r-photos'));
      const flow = new PhotoFlow(flowNode, data.photos, {
        onOpen: (index) => openViewer({ items: data.photos, index, owner: me.user.role === 'owner', hideSeconds: me.settings.viewer_controls_hide_seconds, onFavorite: () => flow.layout() }),
      });
    }
    body.replaceChildren(...(blocks.length ? blocks : [emptyState('search', `No results for “${query}”`, 'Try a different search.')]));
  } catch (error) { body.replaceChildren(errorState(error, load)); }
}
load();
