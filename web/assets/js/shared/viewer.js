// 사진 뷰어 (PhotoSwipe 5). 어두운 고정 배경(예외 E2), 컨트롤 자동 숨김, 슬라이드쇼, 정보 패널.
import PhotoSwipeLightbox from '/assets/vendor/photoswipe/photoswipe-lightbox.esm.min.js';
import { api, mediaUrl, srcsetFor } from './api.js';
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
    closeTitle: '닫기 (Esc)',
    zoomTitle: '확대',
    arrowPrevTitle: '이전 사진',
    arrowNextTitle: '다음 사진',
    errorMsg: '사진을 불러오지 못했습니다.',
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
    status.textContent = `슬라이드쇼 재생 중 · ${options.interval}초 간격 · Space로 멈춤`;
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
      toast(next ? '즐겨찾기에 추가했습니다.' : '즐겨찾기에서 뺐습니다.', { type: 'success', duration: 2500 });
    } catch (error) { toastError(error); }
  }

  function updateButtons() {
    if (!pswp?.element) return;
    const fav = pswp.element.querySelector('.viewer-fav');
    if (fav) {
      fav.setAttribute('aria-pressed', String(!!slide()?.fav));
      fav.setAttribute('aria-label', slide()?.fav ? '즐겨찾기에서 빼기 (F)' : '즐겨찾기에 추가 (F)');
      fav.title = fav.getAttribute('aria-label');
    }
    const play = pswp.element.querySelector('.viewer-play');
    if (play) {
      play.innerHTML = svgHtml(playing ? 'pause' : 'play');
      play.setAttribute('aria-label', playing ? '슬라이드쇼 멈춤 (Space)' : '슬라이드쇼 시작 (Space)');
      play.title = play.getAttribute('aria-label');
    }
    const info = pswp.element.querySelector('.viewer-info-btn');
    info?.setAttribute('aria-pressed', String(!!infoPanel));
  }

  async function toggleInfo() {
    if (infoPanel) { closeInfo(); return; }
    infoPanel = el('aside', { class: 'viewer-info', 'aria-label': '사진 정보', tabindex: '-1' },
      el('button', { type: 'button', class: 'btn btn-icon close', 'aria-label': '정보 닫기 (I)', onclick: closeInfo }, icon('x', 'icon-20')),
      el('p', { class: 'text-ui' }, '불러오는 중…'));
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
      ['촬영일', formatDateTime(detail.taken_at) || '정보 없음'],
      ['모델', detail.model_name],
      ['앨범', detail.album_title],
      ['카메라', joinMeta(detail.camera, detail.lens) || '정보 없음'],
      ['노출', joinMeta(exposure.shutter, exposure.aperture, exposure.iso ? `ISO ${exposure.iso}` : null, exposure.focal) || '정보 없음'],
      ['해상도', `${detail.w} × ${detail.h}`],
      ['파일', joinMeta(config.owner ? detail.original_filename : null, formatBytes(detail.byte_size))],
      ['태그', detail.tags.length ? detail.tags.join(', ') : '없음'],
      ['메모', detail.caption || '없음'],
    ];
    const content = [el('h2', { class: 'text-card' }, '사진 정보'),
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
    const save = el('button', { type: 'submit', class: 'btn btn-primary' }, '변경사항 저장');
    const form = el('form', { class: 'form-grid', onsubmit: async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        await api(`/photos/${detail.id}`, { method: 'PATCH', body: { tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean), caption: caption.value } });
        toast('사진 정보를 저장했습니다.', { type: 'success', duration: 2500 });
        await renderInfo();
      } catch (error) { toastError(error); save.disabled = false; }
    } },
    el('div', { class: 'field' }, el('label', { class: 'label', for: tagsId }, '태그'), tags, el('p', { class: 'hint' }, '쉼표로 구분합니다. 예: 야외, 흑백')),
    el('div', { class: 'field' }, el('label', { class: 'label', for: captionId }, '메모'), caption),
    save,
    el('div', { class: 'row-actions' },
      el('button', { type: 'button', class: 'btn btn-outline', onclick: () => ownerAction('set_album_cover', '앨범 커버로 지정했습니다.') }, '앨범 커버로 지정'),
      el('button', { type: 'button', class: 'btn btn-outline', onclick: () => ownerAction('set_model_cover', '모델 대표 사진으로 지정했습니다.') }, '모델 대표 사진으로 지정'),
      el('button', { type: 'button', class: 'btn btn-outline', onclick: () => ownerAction('trash', '휴지통으로 옮겼습니다.') }, icon('trash-2'), '휴지통으로 이동')));
    return el('div', {}, el('div', { class: 'divider', role: 'separator' }), form);
  }

  async function ownerAction(action, message) {
    const photo = slide();
    try {
      await api('/photos/bulk', { method: 'POST', body: { action, ids: [photo.id] } });
      if (action === 'trash') {
        config.onOwnerAction?.(action, photo);
        const undo = async () => {
          try { await api('/trash/restore', { method: 'POST', body: { type: 'photo', ids: [photo.id] } }); config.onOwnerAction?.('restore', photo); toast('되돌렸습니다.', { type: 'success' }); } catch (error) { toastError(error); }
        };
        pswp.close();
        toast(message, { type: 'success', actionLabel: '실행 취소', onAction: undo, duration: 5000 });
        return;
      }
      config.onOwnerAction?.(action, photo);
      toast(message, { type: 'success', duration: 2500 });
    } catch (error) { toastError(error); }
  }

  function showHelp() {
    const list = [['←  →', '이전·다음 사진'], ['Space', '슬라이드쇼 재생·멈춤'], ['F', '즐겨찾기'], ['I', '사진 정보'], ['Esc', '닫기'], ['Shift+H', '화면 가리기'], ['?', '단축키 안내']];
    const dialog = el('dialog', { class: 'dialog', 'aria-labelledby': 'help-title' },
      el('div', { class: 'dialog-body' }, el('h2', { class: 'dialog-title', id: 'help-title' }, '단축키'),
        el('div', { class: 'shortcut-list' }, list.flatMap(([k, v]) => [el('kbd', {}, k), el('span', {}, v)])),
        el('div', { class: 'dialog-actions' }, el('button', { type: 'button', class: 'btn btn-primary', onclick: () => dialog.close() }, '닫기'))));
    showDialog(dialog);
    dialog.querySelector('button').focus();
  }

  lightbox.on('uiRegister', () => {
    const ui = lightbox.pswp.ui;
    const register = (name, order, iconName, label, onClick, className) => ui.registerElement({
      name, order, isButton: true, html: svgHtml(iconName), title: label, ariaLabel: label, className: `viewer-btn ${className}`,
      onClick: (event) => { event.stopPropagation(); onClick(); showControls(); },
    });
    register('favorite', 8, 'heart', '즐겨찾기에 추가 (F)', toggleFavorite, 'viewer-fav');
    register('slideshow', 9, 'play', '슬라이드쇼 시작 (Space)', toggleSlideshow, 'viewer-play');
    register('info', 10, 'info', '사진 정보 (I)', toggleInfo, 'viewer-info-btn');
    if (config.owner || config.canDownload) {
      register('download', 11, 'download', '원본 내려받기', () => { location.href = `${mediaUrl(slide().id, 'original')}?download=1`; }, 'viewer-download');
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
  lightbox.on('close', () => { stopSlideshow(); clearTimeout(hideTimer); });
  lightbox.on('destroy', () => config.onClose?.(slide?.() || null));
  lightbox.init();
  lightbox.loadAndOpen(startIndex);
  return lightbox;
}
