// 휴지통: 복원·영구 삭제·비우기
import { api } from '../shared/api.js';
import { photoFrame } from '../shared/gallery.js';
import { boot } from '../shared/layout.js';
import { button, confirmDialog, el, emptyState, errorState, formatDate, formatNumber, icon, loadingState, plural, toast, toastError } from '../shared/ui.js';

const main = document.getElementById('main');
await boot({ ownerOnly: true });
main.className = 'manage-page';

const KIND = { model: 'Model', album: 'Album', photo: 'Photo' };
let data;
const selected = new Map();

function remaining(deletedAt) {
  const days = data.retention_days - Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86400000);
  return days <= 0 ? 'Deleting soon' : `Deletes in ${plural(days, 'day')}`;
}

async function restore(items) {
  try {
    const byType = Object.groupBy(items, (i) => i.type);
    let restored = 0;
    for (const [type, group] of Object.entries(byType)) {
      restored += (await api('/trash/restore', { method: 'POST', body: { type, ids: group.map((i) => i.id) } })).restored;
    }
    toast(`Restored ${plural(restored, 'item')}.`, { type: 'success' });
    load();
  } catch (error) { toastError(error); }
}

async function purge(items) {
  const photos = items.reduce((n, i) => n + (i.type === 'photo' ? 1 : i.photo_count || 0), 0);
  const ok = await confirmDialog({
    title: 'Delete permanently?',
    description: `The originals and all image sizes for the ${plural(items.length, 'selected item')} (about ${plural(photos, 'photo')}) will be deleted. This can\'t be undone.`,
    confirmLabel: `Permanently delete ${plural(photos, 'photo')}`,
    destructive: true,
  });
  if (!ok) return;
  try {
    const byType = Object.groupBy(items, (i) => i.type);
    for (const [type, group] of Object.entries(byType)) {
      await api('/trash/purge', { method: 'POST', body: { type, ids: group.map((i) => i.id) } });
    }
    toast('Deleted permanently.', { type: 'success' });
    load();
  } catch (error) { toastError(error); }
}

async function emptyTrash() {
  const ok = await confirmDialog({
    title: 'Empty the trash?',
    description: `All ${plural(data.items.length, 'item')} in the trash will be permanently deleted. This can\'t be undone.`,
    confirmLabel: 'Empty trash',
    destructive: true,
  });
  if (!ok) return;
  try { await api('/trash/purge', { method: 'POST', body: { all: true } }); toast('Trash emptied.', { type: 'success' }); load(); } catch (error) { toastError(error); }
}

function toolbar() {
  const items = [...selected.values()];
  return el('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Trash actions' },
    el('span', { class: 'text-meta', 'aria-live': 'polite' }, items.length ? `${formatNumber(items.length)} selected` : `Kept for ${plural(data.retention_days, 'day')}`),
    el('div', { class: 'row-actions' },
      button('Restore selected', { variant: 'btn-outline', iconName: 'rotate-ccw', onclick: () => restore(items) }),
      button('Delete selected', { variant: 'btn-outline', iconName: 'trash-2', onclick: () => purge(items) }),
      button('Empty trash', { variant: 'btn-destructive', onclick: emptyTrash })));
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
      el('label', { class: 'checkbox-row', for: id }, check, el('span', { class: 'visually-hidden' }, `Select ${KIND[item.type].toLowerCase()} ${item.title}`)),
      preview,
      el('div', { style: undefined },
        el('p', { class: 'title' }, el('span', { class: 'badge' }, KIND[item.type]), ' ', item.title),
        el('p', { class: 'sub' }, [item.subtitle, item.photo_count ? plural(item.photo_count, 'photo') : null, `Deleted ${formatDate(item.deleted_at)}`, remaining(item.deleted_at)].filter(Boolean).join(' · '))),
      el('div', { class: 'actions' },
        button('Restore', { variant: 'btn-ghost', iconName: 'rotate-ccw', onclick: () => restore([item]) }),
        button('Delete', { variant: 'btn-ghost', iconName: 'trash-2', onclick: () => purge([item]) })));
  });
  main.replaceChildren(
    el('div', { class: 'page-head' }, el('h1', {}, 'Trash')),
    data.items.length ? bar : null,
    data.items.length ? el('div', { class: 'trash-list', role: 'list' }, rows)
      : emptyState('trash-2', 'Trash is empty', `Deleted photos are kept here for ${plural(data.retention_days, 'day')}.`));
}

async function load() {
  main.replaceChildren(loadingState());
  selected.clear();
  try { data = await api('/trash'); render(); } catch (error) { main.replaceChildren(errorState(error, load)); }
}
load();
