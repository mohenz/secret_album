// 휴지통: 복원·영구 삭제·비우기
import { api } from '../shared/api.js';
import { photoFrame } from '../shared/gallery.js';
import { boot } from '../shared/layout.js';
import { button, confirmDialog, el, emptyState, errorState, formatDate, formatNumber, icon, loadingState, toast, toastError } from '../shared/ui.js';

const main = document.getElementById('main');
await boot({ ownerOnly: true });
main.className = 'manage-page';

const KIND = { model: '모델', album: '앨범', photo: '사진' };
let data;
const selected = new Map();

function remaining(deletedAt) {
  const days = data.retention_days - Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86400000);
  return days <= 0 ? '곧 영구 삭제' : `${formatNumber(days)}일 후 영구 삭제`;
}

async function restore(items) {
  try {
    const byType = Object.groupBy(items, (i) => i.type);
    let restored = 0;
    for (const [type, group] of Object.entries(byType)) {
      restored += (await api('/trash/restore', { method: 'POST', body: { type, ids: group.map((i) => i.id) } })).restored;
    }
    toast(`${formatNumber(restored)}개 항목을 복원했습니다.`, { type: 'success' });
    load();
  } catch (error) { toastError(error); }
}

async function purge(items) {
  const photos = items.reduce((n, i) => n + (i.type === 'photo' ? 1 : i.photo_count || 0), 0);
  const ok = await confirmDialog({
    title: '영구 삭제할까요?',
    description: `선택한 ${formatNumber(items.length)}개 항목(사진 약 ${formatNumber(photos)}장)의 원본과 모든 크기의 이미지가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`,
    confirmLabel: `사진 ${formatNumber(photos)}장 영구 삭제`,
    destructive: true,
  });
  if (!ok) return;
  try {
    const byType = Object.groupBy(items, (i) => i.type);
    for (const [type, group] of Object.entries(byType)) {
      await api('/trash/purge', { method: 'POST', body: { type, ids: group.map((i) => i.id) } });
    }
    toast('영구 삭제했습니다.', { type: 'success' });
    load();
  } catch (error) { toastError(error); }
}

async function emptyTrash() {
  const ok = await confirmDialog({
    title: '휴지통을 비울까요?',
    description: `휴지통의 항목 ${formatNumber(data.items.length)}개가 모두 영구 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`,
    confirmLabel: '휴지통 비우기',
    destructive: true,
  });
  if (!ok) return;
  try { await api('/trash/purge', { method: 'POST', body: { all: true } }); toast('휴지통을 비웠습니다.', { type: 'success' }); load(); } catch (error) { toastError(error); }
}

function toolbar() {
  const items = [...selected.values()];
  return el('div', { class: 'toolbar', role: 'toolbar', 'aria-label': '휴지통 작업' },
    el('span', { class: 'text-meta', 'aria-live': 'polite' }, items.length ? `${formatNumber(items.length)}개 선택` : `보관 기간 ${formatNumber(data.retention_days)}일`),
    el('div', { class: 'row-actions' },
      button('선택 복원', { variant: 'btn-outline', iconName: 'rotate-ccw', onclick: () => restore(items) }),
      button('선택 영구 삭제', { variant: 'btn-outline', iconName: 'trash-2', onclick: () => purge(items) }),
      button('휴지통 비우기', { variant: 'btn-destructive', onclick: emptyTrash })));
}

function render() {
  const bar = toolbar();
  bar.querySelectorAll('.row-actions button').forEach((b, i) => { if (i < 2) b.disabled = selected.size === 0; });
  const rows = data.items.map((item) => {
    const id = `t-${item.type}-${item.id}`;
    const check = el('input', { type: 'checkbox', id, checked: selected.has(item.id) });
    check.addEventListener('change', () => { if (check.checked) selected.set(item.id, item); else selected.delete(item.id); render(); document.getElementById(id)?.focus(); });
    const preview = item.type === 'photo' ? photoFrame(item.status === 'ready' ? item.id : null, { color: item.color, variant: 'thumb', alt: '' })
      : item.type === 'album' ? photoFrame(item.cover_id, { variant: 'thumb', alt: '' }) : el('div', { class: 'photo-frame' }, icon('user', 'icon-24'));
    return el('div', { class: 'trash-item', role: 'listitem' },
      el('label', { class: 'checkbox-row', for: id }, check, el('span', { class: 'visually-hidden' }, `${KIND[item.type]} ${item.title} 선택`)),
      preview,
      el('div', { style: undefined },
        el('p', { class: 'title' }, el('span', { class: 'badge' }, KIND[item.type]), ' ', item.title),
        el('p', { class: 'sub' }, [item.subtitle, item.photo_count ? `사진 ${formatNumber(item.photo_count)}장` : null, `${formatDate(item.deleted_at)} 삭제`, remaining(item.deleted_at)].filter(Boolean).join(' · '))),
      el('div', { class: 'actions' },
        button('복원', { variant: 'btn-ghost', iconName: 'rotate-ccw', onclick: () => restore([item]) }),
        button('영구 삭제', { variant: 'btn-ghost', iconName: 'trash-2', onclick: () => purge([item]) })));
  });
  main.replaceChildren(
    el('div', { class: 'page-head' }, el('h1', {}, '휴지통')),
    data.items.length ? bar : null,
    data.items.length ? el('div', { class: 'trash-list', role: 'list' }, rows)
      : emptyState('trash-2', '휴지통이 비어 있습니다', `삭제한 사진은 ${formatNumber(data.retention_days)}일 동안 여기에 보관됩니다.`));
}

async function load() {
  main.replaceChildren(loadingState());
  selected.clear();
  try { data = await api('/trash'); render(); } catch (error) { main.replaceChildren(errorState(error, load)); }
}
load();
