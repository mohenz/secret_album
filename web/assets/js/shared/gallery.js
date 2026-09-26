// 사진 카드·커버 카드·저스티파이드 흐름.
import { mediaUrl, srcsetFor } from './api.js';
import { el, formatDate, formatNumber, icon, joinMeta, plural } from './ui.js';

export function photoFrame(photoId, { color, alt = '', sizes = '100vw', photo, variant = 'medium', eager = false, width, height } = {}) {
  const frame = el('div', { class: 'photo-frame' });
  if (color) frame.style.backgroundColor = color;
  if (!photoId) return frame;
  const img = el('img', {
    alt, decoding: 'async', loading: eager ? 'eager' : 'lazy', fetchpriority: eager ? 'high' : undefined,
    width: width || photo?.w, height: height || photo?.h,
    src: mediaUrl(photoId, variant === 'large' ? 'medium' : variant),
    srcset: photo ? srcsetFor(photo, variant === 'thumb' ? 'medium' : 'large') : undefined,
    sizes: photo ? sizes : undefined,
  });
  img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
  img.addEventListener('error', () => { frame.classList.add('failed'); img.remove(); frame.append(el('span', { class: 'visually-hidden' }, 'Could not load photo')); }, { once: true });
  frame.append(img);
  return frame;
}

export function albumCard(album, { sizes = '(min-width: 1440px) 25vw, (min-width: 768px) 33vw, 50vw', showModel = true } = {}) {
  const cover = album.cover ? { id: album.cover.id, w: album.cover.w || 4, h: album.cover.h || 5 } : null;
  return el('a', { class: 'photo-link cover-card', href: `/pages/album.html?id=${album.id}` },
    photoFrame(cover?.id, { color: album.cover?.color, photo: cover, sizes, variant: 'medium', alt: '' }),
    el('div', { class: 'cover-text' },
      el('span', { class: 'cover-title' }, album.title),
      el('span', { class: 'cover-meta' }, joinMeta(showModel ? album.model_name : null, formatDate(album.shot_on), album.photo_count ? plural(album.photo_count, 'photo') : null))));
}

export function modelCard(model) {
  return el('a', { class: 'photo-link model-card cover-card', href: `/pages/model.html?id=${model.id}` },
    photoFrame(model.cover?.id, { color: model.cover?.color, alt: '', variant: 'medium' }),
    el('div', { class: 'cover-text' },
      el('span', { class: 'cover-title' }, model.name),
      el('span', { class: 'cover-meta' }, joinMeta(model.album_count ? plural(model.album_count, 'album') : null, model.photo_count ? plural(model.photo_count, 'photo') : null))));
}

// ------------------------------------------------ 저스티파이드 레이아웃 계산
export function computeRows(items, width, targetHeight, gap, maxPauseHeight) {
  const rows = [];
  let current = [];
  let aspectSum = 0;
  const flush = (stretch) => {
    if (!current.length) return;
    const gaps = gap * (current.length - 1);
    const height = stretch ? (width - gaps) / aspectSum : Math.min(targetHeight, (width - gaps) / aspectSum);
    rows.push({ items: current.map((item) => ({ item, width: (item.w / item.h) * height })), height });
    current = [];
    aspectSum = 0;
  };
  for (const item of items) {
    if (item.pause) {
      flush(true);
      const height = Math.min(width * (item.h / item.w), maxPauseHeight);
      rows.push({ items: [{ item, width }], height, pause: true });
      continue;
    }
    current.push(item);
    aspectSum += item.w / item.h;
    if (aspectSum * targetHeight + gap * (current.length - 1) >= width) flush(true);
  }
  flush(false);
  return rows;
}

function targetRowHeight(width) {
  if (width < 768) return 160;
  if (width < 1280) return 220;
  return 280;
}

/*
  사진 흐름. 화면에 가까운 행만 조금씩 만들어 수천 장 앨범에서도 가볍게 유지한다.
  options: onOpen(index), onToggleFavorite(photo), editing, onSelectionChange(set), onReorder(ids)
*/
export class PhotoFlow {
  constructor(container, items, options = {}) {
    this.container = container;
    this.items = items;
    this.options = options;
    this.selected = new Set();
    this.editing = false;
    this.rendered = 0;
    this.rows = [];
    this.container.classList.add('flow');
    this.container.setAttribute('role', 'list');
    this.sentinel = el('div', { class: 'flow-sentinel', 'aria-hidden': 'true' });
    this.observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) this.renderMore(); }, { rootMargin: '1200px 0px' });
    let lastWidth = 0;
    this.resizeObserver = new ResizeObserver(() => {
      const width = this.container.clientWidth;
      if (Math.abs(width - lastWidth) > 1) { lastWidth = width; this.layout(); }
    });
    this.resizeObserver.observe(this.container);
    this.container.addEventListener('keydown', (event) => this.onKey(event));
  }

  setItems(items) {
    this.items = items;
    this.selected = new Set([...this.selected].filter((id) => items.some((p) => p.id === id)));
    this.layout();
  }

  layout() {
    const width = this.container.clientWidth;
    if (!width) return;
    const focusedId = document.activeElement?.closest?.('.flow-item')?.dataset.id;
    const scale = this.options.density === 'compact' ? 0.6 : 1;
    this.rows = computeRows(this.items, width, Math.round(targetRowHeight(width) * scale), 2, innerHeight * 0.8);
    this.container.replaceChildren();
    this.rendered = 0;
    this.renderMore(focusedId ? this.rows.length : 30);
    if (focusedId) this.container.querySelector(`[data-id="${focusedId}"] a`)?.focus({ preventScroll: true });
  }

  renderMore(count = 30) {
    this.sentinel.remove();
    const end = Math.min(this.rows.length, this.rendered + count);
    const fragment = document.createDocumentFragment();
    let index = this.rows.slice(0, this.rendered).reduce((n, row) => n + row.items.length, 0);
    for (let r = this.rendered; r < end; r += 1) {
      const row = this.rows[r];
      const rowNode = el('div', { class: `flow-row${row.pause ? ' pause-row' : ''}`, role: 'presentation' });
      rowNode.style.height = `${row.height}px`;
      for (const cell of row.items) {
        rowNode.append(this.renderItem(cell, row, index));
        index += 1;
      }
      fragment.append(rowNode);
    }
    this.rendered = end;
    this.container.append(fragment);
    if (this.rendered < this.rows.length) {
      this.container.append(this.sentinel);
      this.observer.observe(this.sentinel);
    }
  }

  renderItem(cell, row, index) {
    const photo = cell.item;
    const node = el('div', { class: `flow-item ${row.pause ? 'pause-item' : ''}`, role: 'listitem', dataset: { id: photo.id, index: String(index) }, 'aria-selected': this.editing ? String(this.selected.has(photo.id)) : undefined });
    node.style.width = `${cell.width}px`;
    node.style.height = `${row.height}px`;
    const label = `Photo ${formatNumber(index + 1)}${photo.status === 'processing' ? ' (processing)' : photo.status === 'failed' ? ' (processing failed)' : ''}${photo.fav ? ', favorite' : ''}`;
    const link = el('a', { class: 'photo-link', href: `?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), photo: photo.id })}`, 'aria-label': label, draggable: this.editing ? 'true' : 'false' });
    link.style.height = '100%';
    if (photo.status === 'ready') {
      link.append(photoFrame(photo.id, { color: photo.color, photo, sizes: `${Math.ceil(cell.width)}px`, variant: row.pause ? 'large' : 'medium', alt: '' }));
    } else {
      const frame = el('div', { class: 'photo-frame' });
      frame.append(el('div', { class: 'status-mark' }, icon(photo.status === 'failed' ? 'circle-alert' : 'loader-circle', photo.status === 'failed' ? 'icon-20' : 'spin icon-20'), el('span', {}, photo.status === 'failed' ? 'Processing failed' : 'Processing…')));
      link.append(frame);
    }
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (this.editing) this.toggle(photo.id, node);
      else if (photo.status === 'ready') this.options.onOpen?.(index);
      else if (photo.status === 'failed') this.options.onFailed?.(photo);
    });
    node.append(link);
    if (photo.fav && !this.editing) node.append(el('span', { class: 'fav-mark' }, icon('heart', 'icon-18')));
    if (this.options.onToggleFavorite && !this.editing && photo.status === 'ready') {
      const fav = el('button', { type: 'button', class: 'btn btn-icon quick-fav', 'aria-label': photo.fav ? 'Remove from favorites' : 'Add to favorites', 'aria-pressed': String(!!photo.fav), onclick: () => this.options.onToggleFavorite(photo) }, icon('heart', 'icon-18'));
      node.append(fav);
    }
    if (this.editing) {
      node.append(el('span', { class: 'select-box', 'aria-hidden': 'true' }, el('span', { class: 'box' }, this.selected.has(photo.id) ? icon('check') : null)));
      this.bindDrag(node, link, photo);
    }
    return node;
  }

  bindDrag(node, link, photo) {
    link.addEventListener('dragstart', (event) => { event.dataTransfer.setData('text/plain', photo.id); event.dataTransfer.effectAllowed = 'move'; });
    node.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; });
    node.addEventListener('drop', (event) => {
      event.preventDefault();
      const dragged = event.dataTransfer.getData('text/plain');
      if (!dragged || dragged === photo.id) return;
      const ids = this.items.map((p) => p.id).filter((id) => id !== dragged);
      ids.splice(ids.indexOf(photo.id), 0, dragged);
      this.options.onReorder?.(ids);
    });
  }

  setDensity(density) {
    this.options.density = density;
    this.layout();
  }

  setEditing(on) {
    this.editing = on;
    this.selected.clear();
    this.container.dataset.editing = on ? 'true' : 'false';
    this.container.setAttribute('aria-multiselectable', on ? 'true' : 'false');
    this.layout();
    this.options.onSelectionChange?.(this.selected);
  }

  toggle(id, node) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    node.setAttribute('aria-selected', String(this.selected.has(id)));
    node.querySelector('.box')?.replaceChildren(...(this.selected.has(id) ? [icon('check')] : []));
    this.options.onSelectionChange?.(this.selected);
  }

  selectAll(on) {
    this.selected = on ? new Set(this.items.map((p) => p.id)) : new Set();
    this.layout();
    this.options.onSelectionChange?.(this.selected);
  }

  // 방향키로 사진 사이 이동 (Bloom 접근성: 그리드 키보드 탐색)
  onKey(event) {
    const current = event.target.closest?.('.flow-item');
    if (!current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const all = [...this.container.querySelectorAll('.flow-item')];
    const index = all.indexOf(current);
    let target;
    if (event.key === 'ArrowRight') target = all[index + 1];
    if (event.key === 'ArrowLeft') target = all[index - 1];
    if (event.key === 'Home') target = all[0];
    if (event.key === 'End') target = all.at(-1);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const row = current.parentElement;
      const sibling = event.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
      if (sibling?.classList.contains('flow-row')) {
        const x = current.getBoundingClientRect().left + current.offsetWidth / 2;
        target = [...sibling.children].reduce((best, item) => {
          const cx = item.getBoundingClientRect().left + item.offsetWidth / 2;
          return !best || Math.abs(cx - x) < Math.abs(best.cx - x) ? { item, cx } : best;
        }, null)?.item;
      }
    }
    if (target) {
      event.preventDefault();
      target.querySelector('a').focus();
    }
  }

  focusPhoto(id) {
    let node = this.container.querySelector(`[data-id="${id}"] a`);
    while (!node && this.rendered < this.rows.length) {
      this.renderMore(30);
      node = this.container.querySelector(`[data-id="${id}"] a`);
    }
    node?.focus({ preventScroll: false });
  }

  destroy() {
    this.observer.disconnect();
    this.resizeObserver.disconnect();
  }
}
