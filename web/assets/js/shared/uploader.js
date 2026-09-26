// 업로드 대기열: 동시 3개, 파일별 진행률, 서버 처리 상태 확인(2초 간격).
import { api, uploadFile } from './api.js';
import { el, formatBytes, formatNumber, icon } from './ui.js';

const ACCEPT = /\.(jpe?g|png|webp|heic|heif)$/i;
const CONCURRENCY = 3;

const LABEL = {
  waiting: 'Waiting',
  uploading: 'Uploading…',
  processing: 'Processing…',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};

export class Uploader {
  constructor({ list, summary, getAlbumId, onFinished }) {
    this.list = list;
    this.summary = summary;
    this.getAlbumId = getAlbumId;
    this.onFinished = onFinished;
    this.entries = [];
    this.active = 0;
    this.reported = 0;  // 이미 완료를 알린 항목 수. 새 항목이 모두 끝났을 때만 한 번 알린다.
    this.pollTimer = null;
    this.beforeUnload = (event) => { if (this.busy()) { event.preventDefault(); event.returnValue = ''; } };
    addEventListener('beforeunload', this.beforeUnload);
  }

  busy() {
    return this.entries.some((e) => ['waiting', 'uploading', 'processing'].includes(e.state));
  }

  add(fileList) {
    const albumId = this.getAlbumId();
    if (!albumId) throw new Error('Choose an album to upload to first.');
    for (const file of fileList) {
      const entry = { file, albumId, state: 'waiting', progress: 0, message: '', photoId: null };
      entry.node = this.renderEntry(entry);
      if (!ACCEPT.test(file.name) && !file.type.startsWith('image/')) {
        entry.state = 'failed';
        entry.message = 'Unsupported file type. Only JPEG, PNG, WebP, and HEIC photos can be uploaded.';
      }
      this.entries.push(entry);
      this.list.append(entry.node);
      this.update(entry);
    }
    this.pump();
  }

  renderEntry(entry) {
    const preview = el('img', { class: 'thumb', alt: '', width: 48, height: 48 });
    if (entry.file.type.startsWith('image/') && entry.file.size < 30 * 1024 * 1024 && !/heic|heif/i.test(entry.file.type)) {
      const url = URL.createObjectURL(entry.file);
      preview.src = url;
      preview.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    }
    entry.bar = el('span');
    entry.sub = el('p', { class: 'sub' });
    entry.badge = el('span', { class: 'badge' });
    return el('div', { class: 'upload-item', role: 'listitem' }, preview,
      el('div', { style: undefined }, el('p', { class: 'name' }, entry.file.name), entry.sub, el('div', { class: 'progress', 'aria-hidden': 'true' }, entry.bar)),
      entry.badge);
  }

  update(entry) {
    const badgeClass = { done: 'badge-success', failed: 'badge-error', skipped: 'badge-warning' }[entry.state] || '';
    const iconName = { done: 'circle-check', failed: 'circle-alert', skipped: 'circle-alert', uploading: 'loader-circle', processing: 'loader-circle' }[entry.state];
    entry.badge.className = `badge ${badgeClass}`;
    entry.badge.replaceChildren(...(iconName ? [icon(iconName, ['uploading', 'processing'].includes(entry.state) ? 'spin' : '')] : []), LABEL[entry.state]);
    entry.bar.style.width = `${Math.round((entry.state === 'uploading' ? entry.progress : ['done', 'processing'].includes(entry.state) ? 1 : 0) * 100)}%`;
    entry.sub.textContent = entry.message || formatBytes(entry.file.size);
    entry.sub.classList.toggle('error', entry.state === 'failed');
    this.renderSummary();
  }

  renderSummary() {
    if (!this.summary) return;
    const count = (state) => this.entries.filter((e) => e.state === state).length;
    const total = this.entries.length;
    const finished = count('done') + count('failed') + count('skipped');
    this.summary.replaceChildren(
      el('span', { 'data-numeric': true }, `${formatNumber(finished)} of ${formatNumber(total)} finished`),
      el('span', { class: 'text-meta' }, `Uploaded ${formatNumber(count('done'))} · Skipped ${formatNumber(count('skipped'))} · Failed ${formatNumber(count('failed'))}`));
    if (total && finished === total && total > this.reported) {
      const batch = this.entries.slice(this.reported);
      this.reported = total;
      this.onFinished?.(batch, this.entries);
    }
  }

  pump() {
    while (this.active < CONCURRENCY) {
      const next = this.entries.find((e) => e.state === 'waiting');
      if (!next) break;
      this.start(next);
    }
  }

  async start(entry) {
    this.active += 1;
    entry.state = 'uploading';
    this.update(entry);
    try {
      const result = await uploadFile(entry.file, entry.albumId, (p) => { entry.progress = p; this.update(entry); });
      entry.photoId = result.photo_id;
      entry.state = 'processing';
      entry.message = '';
      this.schedulePoll();
    } catch (error) {
      if (error.code === 'duplicate') { entry.state = 'skipped'; entry.message = error.message; }
      else { entry.state = 'failed'; entry.message = error.message; entry.retry = true; this.addRetry(entry); }
    } finally {
      this.active -= 1;
      this.update(entry);
      this.pump();
    }
  }

  addRetry(entry) {
    if (entry.node.querySelector('.retry')) return;
    entry.node.append(el('button', { type: 'button', class: 'btn btn-outline retry', onclick: (event) => {
      event.currentTarget.remove();
      entry.state = 'waiting';
      entry.message = '';
      this.update(entry);
      this.pump();
    } }, 'Try again'));
  }

  schedulePoll() {
    if (this.pollTimer) return;
    this.pollTimer = setTimeout(() => this.poll(), 2000);
  }

  async poll() {
    this.pollTimer = null;
    const pending = this.entries.filter((e) => e.state === 'processing' && e.photoId);
    if (!pending.length) return;
    for (let i = 0; i < pending.length; i += 200) {
      const chunk = pending.slice(i, i + 200);
      try {
        const { items } = await api(`/uploads/status?ids=${chunk.map((e) => e.photoId).join(',')}`);
        for (const item of items) {
          const entry = chunk.find((e) => e.photoId === item.id);
          if (!entry) continue;
          if (item.status === 'ready') { entry.state = 'done'; this.update(entry); }
          if (item.status === 'failed') { entry.state = 'failed'; entry.message = item.error || 'Could not process this photo. Check the original and upload it again.'; this.update(entry); }
        }
      } catch { /* 다음 확인 때 다시 시도 */ }
    }
    if (this.entries.some((e) => e.state === 'processing')) this.schedulePoll();
  }

  destroy() {
    removeEventListener('beforeunload', this.beforeUnload);
    clearTimeout(this.pollTimer);
  }
}

// ------------------------------------------------ 클립보드 이미지
// 복사한 이미지는 대개 "image.png"라는 같은 이름으로 들어오므로, 시각과 순번으로 이름을 새로 붙인다.
function pastedName(type, index) {
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' }[type] || 'png';
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `pasted-${stamp}${index ? `-${index + 1}` : ''}.${ext}`;
}

function renamePasted(blobs) {
  return blobs.map((blob, index) => new File([blob], pastedName(blob.type, index), { type: blob.type, lastModified: Date.now() }));
}

export function imagesFromClipboard(clipboardData) {
  if (!clipboardData) return [];
  const blobs = [...(clipboardData.items || [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  return renamePasted(blobs);
}

// 버튼으로 붙여넣기: 보안 컨텍스트(https 또는 localhost)에서만 된다. 그 밖에서는 Ctrl+V만 쓴다.
export const canReadClipboard = () => Boolean(window.isSecureContext && navigator.clipboard?.read);

export async function readClipboardImages() {
  const items = await navigator.clipboard.read();
  const blobs = [];
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (type) blobs.push(await item.getType(type));
  }
  return renamePasted(blobs);
}

// 입력칸에 글자를 붙여넣을 때는 가로채지 않는다.
export function enablePagePaste(onFiles, onNoImage) {
  addEventListener('paste', (event) => {
    if (event.target.closest?.('input, textarea, [contenteditable]')) return;
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
