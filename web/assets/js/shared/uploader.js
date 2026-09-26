// 업로드 대기열: 동시 3개, 파일별 진행률, 서버 처리 상태 확인(2초 간격).
import { api, uploadFile } from './api.js';
import { el, formatBytes, formatNumber, icon } from './ui.js';

const ACCEPT = /\.(jpe?g|png|webp|heic|heif)$/i;
const CONCURRENCY = 3;

const LABEL = {
  waiting: '대기 중',
  uploading: '업로드 중…',
  processing: '처리 중…',
  done: '완료',
  failed: '실패',
  skipped: '건너뜀',
};

export class Uploader {
  constructor({ list, summary, getAlbumId, onFinished }) {
    this.list = list;
    this.summary = summary;
    this.getAlbumId = getAlbumId;
    this.onFinished = onFinished;
    this.entries = [];
    this.active = 0;
    this.pollTimer = null;
    this.beforeUnload = (event) => { if (this.busy()) { event.preventDefault(); event.returnValue = ''; } };
    addEventListener('beforeunload', this.beforeUnload);
  }

  busy() {
    return this.entries.some((e) => ['waiting', 'uploading', 'processing'].includes(e.state));
  }

  add(fileList) {
    const albumId = this.getAlbumId();
    if (!albumId) throw new Error('업로드할 앨범을 먼저 선택해 주세요.');
    for (const file of fileList) {
      const entry = { file, albumId, state: 'waiting', progress: 0, message: '', photoId: null };
      entry.node = this.renderEntry(entry);
      if (!ACCEPT.test(file.name) && !file.type.startsWith('image/')) {
        entry.state = 'failed';
        entry.message = '지원하지 않는 파일 형식입니다. JPEG·PNG·WebP·HEIC 사진만 올릴 수 있습니다.';
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
      el('span', { 'data-numeric': true }, `${formatNumber(finished)} / ${formatNumber(total)} 완료`),
      el('span', { class: 'text-meta' }, `성공 ${formatNumber(count('done'))} · 건너뜀 ${formatNumber(count('skipped'))} · 실패 ${formatNumber(count('failed'))}`));
    if (total && finished === total) this.onFinished?.(this.entries);
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
    } }, '다시 시도'));
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
          if (item.status === 'failed') { entry.state = 'failed'; entry.message = item.error || '사진을 처리하지 못했습니다. 원본을 확인해 다시 올려 주세요.'; this.update(entry); }
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

// 화면 어디에 끌어 놓아도 전체 화면 드롭 영역을 보여 준다.
export function enablePageDrop(onFiles) {
  let depth = 0;
  let overlay = null;
  const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    depth += 1;
    if (!overlay) { overlay = el('div', { class: 'drop-overlay', 'aria-hidden': 'true' }, el('div', {}, icon('upload', 'icon-32'), el('p', {}, '여기에 놓으면 업로드합니다'))); document.body.append(overlay); }
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
