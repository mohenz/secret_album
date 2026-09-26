// 퀵 업로드 (cinetube 갤러리 퀵등록 방식이 표준).
// 붙여넣기(Ctrl+V)·끌어 놓기·파일 선택으로 들어온 이미지를 받는 즉시 한 장씩 순서대로 저장하고,
// 한 줄 상태 표시로 진행 상황을 알린다: 저장 중(대기 n장) → 완료(4초 뒤 사라짐) / 건너뜀 / 실패.
import { uploadFile } from './api.js';
import { el, icon, plural } from './ui.js';

const IMAGE_NAME = /\.(jpe?g|png|webp|heic|heif)$/i;

// ------------------------------------------------ 상태 표시줄
export function createStatusLine({ floating = false } = {}) {
  const base = `quick-status${floating ? ' floating' : ''}`;
  const node = el('p', { class: base, role: 'status', 'aria-live': 'polite', hidden: true });
  let timer = null;
  const ICONS = { uploading: 'loader-circle', done: 'circle-check', skipped: 'circle-alert', error: 'circle-alert' };
  return {
    node,
    set(text, kind) {
      clearTimeout(timer);
      node.hidden = !text;
      node.className = `${base} is-${kind}`;
      node.replaceChildren(icon(ICONS[kind] || 'info', kind === 'uploading' ? 'spin' : ''), el('span', {}, text));
      if (kind === 'done') timer = setTimeout(() => { node.hidden = true; }, 4000);
    },
  };
}

// ------------------------------------------------ 파일 이름
// 복사한 이미지는 대개 "image.png" 같은 이름으로 들어오므로, 로컬 시각과 순번으로 새 이름을 붙인다.
function stamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function normalizeFile(file, source, index) {
  const generic = !file.name || /^image\.(png|jpe?g|gif|webp)$/i.test(file.name);
  if (!generic) return file;
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' }[file.type] || 'png';
  return new File([file], `${source}-${stamp()}${index ? `-${index + 1}` : ''}.${ext}`, { type: file.type || 'image/png', lastModified: Date.now() });
}

const isImage = (file) => file.type.startsWith('image/') || IMAGE_NAME.test(file.name || '');

// ------------------------------------------------ 저장 대기열 (한 장씩 순서대로)
export class QuickUploader {
  /*
    getAlbumId(): 올릴 앨범 id (없으면 onNoAlbum 호출)
    status: createStatusLine() 결과
    onSaved(result, file): 서버가 받은 직후 (사진 처리는 Worker가 이어서 한다)
    onIdle(batch): 대기열이 비었을 때
  */
  constructor({ getAlbumId, status, onSaved, onNoAlbum, onIdle }) {
    Object.assign(this, { getAlbumId, status, onSaved, onNoAlbum, onIdle });
    this.queue = [];
    this.processing = false;
    this.batch = { saved: 0, skipped: 0, failed: 0, total: 0 };
    addEventListener('beforeunload', (event) => { if (this.busy()) { event.preventDefault(); event.returnValue = ''; } });
  }

  busy() {
    return this.processing || this.queue.length > 0;
  }

  add(fileList, source = 'upload') {
    const files = [...(fileList || [])];
    const images = files.filter(isImage);
    if (!images.length) {
      this.status.set(files.length ? 'Only JPEG, PNG, WebP, and HEIC images can be uploaded.' : 'There is no image to upload.', 'error');
      return;
    }
    const albumId = this.getAlbumId();
    if (!albumId) { this.onNoAlbum?.(); return; }
    if (!this.busy()) this.batch = { saved: 0, skipped: 0, failed: 0, total: 0 };
    images.forEach((file, index) => this.queue.push({ file: normalizeFile(file, source, images.length > 1 ? index : 0), albumId }));
    this.batch.total += images.length;
    this.process();
  }

  async process() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length) {
      const { file, albumId } = this.queue.shift();
      await this.save(file, albumId);
    }
    this.processing = false;
    const { saved, skipped, failed, total } = this.batch;
    if (total > 1) {
      const kind = failed ? 'error' : skipped && !saved ? 'skipped' : 'done';
      this.status.set(`Done: ${plural(saved, 'photo')} saved · ${skipped} skipped · ${failed} failed`, kind);
    }
    this.onIdle?.(this.batch);
  }

  async save(file, albumId) {
    const waiting = this.queue.length;
    const label = (percent) => `Saving ${file.name}${percent ? ` ${percent}%` : '…'}${waiting ? ` (${waiting} waiting)` : ''}`;
    this.status.set(label(0), 'uploading');
    try {
      const result = await uploadFile(file, albumId, (p) => this.status.set(label(Math.round(p * 100)), 'uploading'));
      this.batch.saved += 1;
      this.status.set(`Saved: ${file.name}`, 'done');
      this.onSaved?.(result, file);
    } catch (error) {
      if (error.code === 'duplicate') {
        this.batch.skipped += 1;
        this.status.set(`${file.name} — ${error.message}`, 'skipped');
      } else {
        this.batch.failed += 1;
        this.status.set(`Failed (${file.name}): ${error.message}`, 'error');
      }
    }
  }
}

// ------------------------------------------------ 클립보드
export function imagesFromClipboard(clipboardData) {
  if (!clipboardData) return [];
  return [...(clipboardData.items || [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

// 버튼으로 붙여넣기: 보안 컨텍스트(https 또는 localhost)에서만 된다. 그 밖에서는 Ctrl+V만 쓴다.
export const canReadClipboard = () => Boolean(window.isSecureContext && navigator.clipboard?.read);

export async function readClipboardImages() {
  const items = await navigator.clipboard.read();
  const files = [];
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (type) files.push(new File([await item.getType(type)], '', { type }));
  }
  return files;
}

// 입력칸에 글자를 붙여넣을 때는 가로채지 않는다.
export function enablePagePaste(onFiles, onNoImage) {
  addEventListener('paste', (event) => {
    if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const files = imagesFromClipboard(event.clipboardData);
    if (files.length) {
      event.preventDefault();
      onFiles(files);
    } else {
      onNoImage?.();
    }
  });
}

// 화면 어디에 끌어 놓아도 전체 화면 드롭 영역을 보여 준다.
export function enablePageDrop(onFiles) {
  let depth = 0;
  let overlay = null;
  const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    depth += 1;
    if (!overlay) { overlay = el('div', { class: 'drop-overlay', 'aria-hidden': 'true' }, el('div', {}, icon('upload', 'icon-32'), el('p', {}, 'Drop to upload'))); document.body.append(overlay); }
  });
  addEventListener('dragleave', (event) => { if (!hasFiles(event)) return; depth -= 1; if (depth <= 0) { depth = 0; overlay?.remove(); overlay = null; } });
  addEventListener('dragover', (event) => { if (hasFiles(event)) event.preventDefault(); });
  addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    overlay?.remove();
    overlay = null;
    if (event.dataTransfer.files.length) onFiles(event.dataTransfer.files);
  });
}
