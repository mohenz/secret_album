// 사진 뷰어 (PhotoSwipe 5). 어두운 고정 배경(예외 E2), 컨트롤 자동 숨김, 슬라이드쇼, 정보 패널.
import PhotoSwipeLightbox from '/assets/vendor/photoswipe/photoswipe-lightbox.esm.min.js';
import { api, mediaUrl, srcsetFor } from './api.js';
import { addLockGuard } from './privacy.js';
import { el, formatBytes, formatDateTime, icon, joinMeta, showDialog, toast, toastError } from './ui.js';

const SLIDESHOW_KEY = 'album-slideshow';

export function slideshowOptions() {
  try { return { interval: 5, loop: true, shuffle: false, ...JSON.parse(localStorage.getItem(SLIDESHOW_KEY) || '{}') }; } catch { return { interval: 5, loop: true, shuffle: false }; }
}
export function saveSlideshowOptions(options) {
  try { localStorage.setItem(SLIDESHOW_KEY, JSON.stringify(options)); } catch { /* 이 기기에 저장할 수 없음 */ }
}

function svgHtml(name) {
  return `<svg class="icon" aria-hidden="true" focusable="false"><use href="/assets/icons/sprite.svg#${name}"></use></svg>`;
}

/*
  openViewer({ items, index, owner, hideSeconds, slideshow, onFavorite, onChange, onClose, onOwnerAction })
  items: [{ id, w, h, fav }]
*/
export function openViewer(config) {
  let items = config.items.filter((p) => p.status === undefined || p.status === 'ready');
  let startIndex = Math.max(0, items.findIndex((p) => p.id === config.items[config.index]?.id));
  if (config.slideshow?.shuffle) {
    const first = items[startIndex];
    const rest = items.filter((p) => p !== first).sort(() => Math.random() - 0.5);
    items = [first, ...rest];
    startIndex = 0;
  }
  const hideMs = (config.hideSeconds || 3) * 1000;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lightbox = new PhotoSwipeLightbox({
    dataSource: items.map((p) => ({
      src: mediaUrl(p.id, 'large'), msrc: mediaUrl(p.id, 'thumb'), srcset: srcsetFor(p, 'large'), width: p.w, height: p.h, alt: '', id: p.id,
    })),
    pswpModule: () => import('/assets/vendor/photoswipe/photoswipe.esm.min.js'),
    bgOpacity: 1,
    showHideAnimationType: reduceMotion ? 'none' : 'fade',
    showAnimationDuration: 250,
    hideAnimationDuration: 200,
    preload: [2, 2],
    wheelToZoom: true,
    returnFocus: true,
    closeTitle: 'Close (Esc)',
    zoomTitle: 'Zoom',
    arrowPrevTitle: 'Previous photo',
    arrowNextTitle: 'Next photo',
    errorMsg: 'Could not load this photo.',
    indexIndicatorSep: ' / ',
    counter: true,
    clickToCloseNonZoomable: false,
    imageClickAction: 'zoom',
    tapAction: 'toggle-controls',
    doubleTapAction: 'zoom',
  });

  let pswp;
  let hideTimer;
  let slideshowTimer;
  let playing = false;
  const releaseLockGuard = addLockGuard(() => playing);
  let infoPanel = null;
  const slide = () => items[pswp.currIndex];

  const showControls = () => {
    pswp?.element?.classList.remove('controls-hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const focusInBar = pswp?.element?.querySelector('.pswp__top-bar')?.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
      if (!focusInBar && !infoPanel) pswp?.element?.classList.add('controls-hidden');
    }, hideMs);
  };

  const status = el('div', { class: 'viewer-slide-status', role: 'status', 'aria-live': 'polite', hidden: true });

  function stopSlideshow() {
    playing = false;
    clearInterval(slideshowTimer);
    status.hidden = true;
    updateButtons();
  }
  function startSlideshow() {
    const options = config.slideshow || slideshowOptions();
    playing = true;
    clearInterval(slideshowTimer);
    slideshowTimer = setInterval(() => {
      if (!options.loop && pswp.currIndex >= items.length - 1) { stopSlideshow(); return; }
      pswp.next();
    }, options.interval * 1000);
    status.hidden = false;
    status.textContent = `Slideshow playing · every ${options.interval} s · Space to pause`;
    updateButtons();
    showControls();
  }
  function toggleSlideshow() { if (playing) stopSlideshow(); else startSlideshow(); }

  async function toggleFavorite() {
    const photo = slide();
    const next = !photo.fav;
    try {
      await api(`/favorites/${photo.id}`, { method: next ? 'PUT' : 'DELETE' });
      photo.fav = next;
      config.onFavorite?.(photo);
      updateButtons();
      toast(next ? 'Added to favorites.' : 'Removed from favorites.', { type: 'success', duration: 2500 });
    } catch (error) { toastError(error); }
  }

  function updateButtons() {
    if (!pswp?.element) return;
    const fav = pswp.element.querySelector('.viewer-fav');
    if (fav) {
      fav.setAttribute('aria-pressed', String(!!slide()?.fav));
      fav.setAttribute('aria-label', slide()?.fav ? 'Remove from favorites (F)' : 'Add to favorites (F)');
      fav.title = fav.getAttribute('aria-label');
    }
    const play = pswp.element.querySelector('.viewer-play');
    if (play) {
      play.innerHTML = svgHtml(playing ? 'pause' : 'play');
      play.setAttribute('aria-label', playing ? 'Pause slideshow (Space)' : 'Start slideshow (Space)');
      play.title = play.getAttribute('aria-label');
    }
    const info = pswp.element.querySelector('.viewer-info-btn');
    info?.setAttribute('aria-pressed', String(!!infoPanel));
  }

  async function toggleInfo() {
    if (infoPanel) { closeInfo(); return; }
    infoPanel = el('aside', { class: 'viewer-info', 'aria-label': 'Photo details', tabindex: '-1' },
      el('button', { type: 'button', class: 'btn btn-icon close', 'aria-label': 'Close details (I)', onclick: closeInfo }, icon('x', 'icon-20')),
      el('p', { class: 'text-ui' }, 'Loading…'));
    pswp.element.append(infoPanel);
    pswp.element.classList.add('info-open');
    updateButtons();
    infoPanel.focus();
    await renderInfo();
  }
  function closeInfo() {
    infoPanel?.remove();
    infoPanel = null;
    pswp?.element?.classList.remove('info-open');
    updateButtons();
    pswp?.element?.querySelector('.viewer-info-btn')?.focus();
  }

  async function renderInfo() {
    if (!infoPanel) return;
    const photo = slide();
    const panel = infoPanel;
    let detail;
    try { detail = await api(`/photos/${photo.id}`); } catch (error) { panel.lastChild.textContent = error.message; return; }
    if (panel !== infoPanel || slide().id !== photo.id) return;
    const exposure = detail.exposure || {};
    const rows = [
      ['Taken', formatDateTime(detail.taken_at) || 'Unknown'],
      ['Model', detail.model_name],
      ['Album', detail.album_title],
      ['Camera', joinMeta(detail.camera, detail.lens) || 'Unknown'],
      ['Exposure', joinMeta(exposure.shutter, exposure.aperture, exposure.iso ? `ISO ${exposure.iso}` : null, exposure.focal) || 'Unknown'],
      ['Resolution', `${detail.w} × ${detail.h}`],
      ['File', joinMeta(config.owner ? detail.original_filename : null, formatBytes(detail.byte_size))],
      ['Tags', detail.tags.length ? detail.tags.join(', ') : 'None'],
      ['Note', detail.caption || 'None'],
    ];
    const content = [el('h2', { class: 'text-card' }, 'Photo details'),
      el('dl', {}, rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]))];
    if (config.owner) content.push(editForm(detail));
    panel.replaceChildren(panel.querySelector('.close') || el('span'), ...content);
  }

  function editForm(detail) {
    const tagsId = 'info-tags';
    const captionId = 'info-caption';
    const tags = el('input', { class: 'input', id: tagsId, value: detail.tags.join(', '), autocomplete: 'off', spellcheck: 'false' });
    const caption = el('textarea', { class: 'textarea', id: captionId, maxlength: '2000' });
    caption.value = detail.caption || '';
    const save = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save changes');
    const form = el('form', { class: 'form-grid', onsubmit: async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        await api(`/photos/${detail.id}`, { method: 'PATCH', body: { tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean), caption: caption.value } });
        toast('Photo details saved.', { type: 'success', duration: 2500 });
        await renderInfo();
      } catch (error) { toastError(error); save.disabled = false; }
    } },
    el('div', { class: 'field' }, el('label', { class: 'label', for: tagsId }, 'Tags'), tags, el('p', { class: 'hint' }, 'Separate with commas, e.g. outdoor, black and white')),
    el('div', { class: 'field' }, el('label', { class: 'label', for: captionId }, 'Note'), caption),
    save,
    el('div', { class: 'row-actions' },
      el('button', { type: 'button', class: 'btn btn-outline', onclick: () => ownerAction('set_album_cover', 'Set as album cover.') }, 'Set as album cover'),
      el('button', { type: 'button', class: 'btn btn-outline', onclick: () => ownerAction('set_model_cover', 'Set as model cover.') }, 'Set as model cover'),
      el('button', { type: 'button', class: 'btn btn-outline', onclick: () => ownerAction('trash', 'Moved to trash.') }, icon('trash-2'), 'Move to trash')));
    return el('div', {}, el('div', { class: 'divider', role: 'separator' }), form);
  }

  async function ownerAction(action, message) {
    const photo = slide();
    try {
      await api('/photos/bulk', { method: 'POST', body: { action, ids: [photo.id] } });
      if (action === 'trash') {
        config.onOwnerAction?.(action, photo);
        const undo = async () => {
          try { await api('/trash/restore', { method: 'POST', body: { type: 'photo', ids: [photo.id] } }); config.onOwnerAction?.('restore', photo); toast('Restored.', { type: 'success' }); } catch (error) { toastError(error); }
        };
        pswp.close();
        toast(message, { type: 'success', actionLabel: 'Undo', onAction: undo, duration: 5000 });
        return;
      }
      config.onOwnerAction?.(action, photo);
      toast(message, { type: 'success', duration: 2500 });
    } catch (error) { toastError(error); }
  }

  function showHelp() {
    const list = [['←  →', 'Previous / next photo'], ['Space', 'Play / pause slideshow'], ['F', 'Favorite'], ['I', 'Photo details'], ['Esc', 'Close'], ['Shift+H', 'Hide screen'], ['?', 'Keyboard shortcuts']];
    const dialog = el('dialog', { class: 'dialog', 'aria-labelledby': 'help-title' },
      el('div', { class: 'dialog-body' }, el('h2', { class: 'dialog-title', id: 'help-title' }, 'Keyboard shortcuts'),
        el('div', { class: 'shortcut-list' }, list.flatMap(([k, v]) => [el('kbd', {}, k), el('span', {}, v)])),
        el('div', { class: 'dialog-actions' }, el('button', { type: 'button', class: 'btn btn-primary', onclick: () => dialog.close() }, 'Close'))));
    showDialog(dialog);
    dialog.querySelector('button').focus();
  }

  lightbox.on('uiRegister', () => {
    const ui = lightbox.pswp.ui;
    const register = (name, order, iconName, label, onClick, className) => ui.registerElement({
      name, order, isButton: true, html: svgHtml(iconName), title: label, ariaLabel: label, className: `viewer-btn ${className}`,
      onClick: (event) => { event.stopPropagation(); onClick(); showControls(); },
    });
    register('favorite', 8, 'heart', 'Add to favorites (F)', toggleFavorite, 'viewer-fav');
    register('slideshow', 9, 'play', 'Start slideshow (Space)', toggleSlideshow, 'viewer-play');
    register('info', 10, 'info', 'Photo details (I)', toggleInfo, 'viewer-info-btn');
    if (config.owner || config.canDownload) {
      register('download', 11, 'download', 'Download original', () => { location.href = `${mediaUrl(slide().id, 'original')}?download=1`; }, 'viewer-download');
    }
  });

  lightbox.on('afterInit', () => {
    pswp = lightbox.pswp;
    pswp.element.append(status);
    ['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach((type) => pswp.element.addEventListener(type, showControls, { passive: true }));
    showControls();
    updateButtons();
    config.onChange?.(slide());
    if (config.startSlideshow) startSlideshow();
  });
  lightbox.on('change', () => {
    if (!pswp) return;
    updateButtons();
    config.onChange?.(slide());
    if (infoPanel) renderInfo();
  });
  lightbox.on('keydown', (event) => {
    const key = event.originalEvent.key;
    if (event.originalEvent.target.closest?.('input, textarea, select')) return;
    if (key === ' ') { event.preventDefault(); toggleSlideshow(); }
    else if (key === 'f' || key === 'F') { if (!event.originalEvent.shiftKey) { event.preventDefault(); toggleFavorite(); } }
    else if (key === 'i' || key === 'I') { event.preventDefault(); toggleInfo(); }
    else if (key === '?') { event.preventDefault(); showHelp(); }
    else if (key === 'Escape' && infoPanel) { event.preventDefault(); closeInfo(); }
  });
  lightbox.on('close', () => { stopSlideshow(); clearTimeout(hideTimer); releaseLockGuard(); });
  lightbox.on('destroy', () => config.onClose?.(slide?.() || null));
  lightbox.init();
  lightbox.loadAndOpen(startIndex);
  return lightbox;
}
