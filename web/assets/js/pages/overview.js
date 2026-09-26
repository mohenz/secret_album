// Studio 아카이브 전체 보기: 통계 · 저장 공간 · 사진 처리 · 최근 업로드 · 앨범
import { api } from '../shared/api.js';
import { photoFrame } from '../shared/gallery.js';
import { boot } from '../shared/layout.js';
import { el, errorState, formatBytes, formatNumber, icon, joinMeta, loadingState, plural, setChildren } from '../shared/ui.js';

const main = document.getElementById('main');
await boot({ ownerOnly: true, studio: true, active: 'overview' });
main.className = 'manage-page';
main.replaceChildren(loadingState());

function stat(label, value) {
  return el('div', { class: 'stat-card' }, el('span', { class: 'label' }, label), el('span', { class: 'value' }, value));
}

try {
  const [storage, jobs, recent, albums] = await Promise.all([api('/storage'), api('/jobs/stats'), api('/uploads/recent?limit=10'), api('/albums?sort=added_desc&limit=8')]);
  const used = storage.disk.total ? Math.round((storage.disk.used / storage.disk.total) * 100) : 0;
  const meter = el('div', { class: 'meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(used), 'aria-label': 'Disk usage' }, el('span'));
  meter.firstChild.style.width = `${used}%`;
  const failed = jobs.counts.failed || 0;
  setChildren(main,
    el('div', { class: 'studio-head' },
      el('div', {}, el('p', { class: 'eyebrow' }, 'Studio'), el('h1', {}, 'Archive overview'),
        el('p', { class: 'sub' }, 'Everything in your private archive at a glance.')),
      el('div', { class: 'studio-actions' },
        el('a', { class: 'btn btn-outline', href: '/manage/photos.html' }, icon('images'), 'Photo library'),
        el('a', { class: 'btn btn-primary', href: '/manage/upload.html' }, icon('image-plus'), 'New photos'))),
    el('div', { class: 'stat-grid' },
      stat('Photos', formatNumber(storage.photos)),
      stat('Albums', formatNumber(storage.albums)),
      stat('Models', formatNumber(storage.models)),
      stat('Originals', formatBytes(storage.original_bytes))),
    el('div', { class: 'overview-grid' },
      el('section', { class: 'panel', 'aria-labelledby': 'recent-title' },
        el('div', { class: 'toolbar' }, el('h2', { id: 'recent-title' }, 'Recent uploads'), el('a', { class: 'btn btn-ghost', href: '/manage/upload.html' }, 'Quick upload')),
        recent.items.length
          ? el('div', { class: 'recent-strip' }, recent.items.map((item) => el('a', { href: `/pages/album.html?id=${item.album_id}${item.status === 'ready' ? `&photo=${item.id}` : ''}`, 'aria-label': `${item.filename} in ${item.album_title}` },
            item.status === 'ready' ? photoFrame(item.id, { color: item.color, variant: 'thumb', alt: '' }) : el('div', { class: 'photo-frame' }))))
          : el('p', { class: 'panel-desc' }, 'No uploads yet.')),
      el('div', { class: 'overview-side' },
      el('section', { class: 'panel', 'aria-labelledby': 'storage-title' },
        el('h2', { id: 'storage-title' }, 'Storage'),
        el('p', { class: 'panel-desc', 'data-numeric': true }, `${formatBytes(storage.disk.used)} of ${formatBytes(storage.disk.total)} used · ${formatBytes(storage.disk.free)} free`),
        meter,
        el('h3', { class: 'overview-sub' }, 'Photo processing'),
        el('p', { class: 'stat-line' }, el('span', {}, `Queued ${formatNumber(jobs.counts.queued || 0)}`), el('span', {}, `Running ${formatNumber(jobs.counts.running || 0)}`), el('span', {}, `Failed ${formatNumber(failed)}`)),
        failed ? el('p', { class: 'notice notice-error' }, icon('circle-alert'), `${plural(failed, 'job')} failed. Check local/worker.log on the server.`) : null),
      el('section', { class: 'panel', 'aria-labelledby': 'albums-title' },
        el('div', { class: 'toolbar' }, el('h2', { id: 'albums-title' }, 'Albums'), el('a', { class: 'btn btn-ghost', href: '/pages/albums.html' }, 'View all')),
        el('div', { class: 'album-list' }, albums.items.map((a) => el('a', { href: `/manage/photos.html?album=${a.id}` },
          photoFrame(a.cover?.id, { color: a.cover?.color, variant: 'thumb', alt: '' }),
          el('span', { class: 'title' }, joinMeta(a.title, a.model_name)),
          el('span', { class: 'count' }, plural(a.photo_count, 'photo')))))))));
} catch (error) {
  main.replaceChildren(errorState(error, () => location.reload()));
}
