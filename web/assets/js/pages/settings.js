// 설정: 보안 · 표시 · 저장 공간 · 작업 상태
import { api } from '../shared/api.js';
import { boot, setTheme } from '../shared/layout.js';
import { setBlurThumbnails } from '../shared/privacy.js';
import { button, el, errorState, formatBytes, formatDateTime, formatNumber, icon, loadingState, plural, setBusy, toast, toastError } from '../shared/ui.js';

const main = document.getElementById('main');
const me = await boot({ ownerOnly: true, studio: true, active: 'settings' });
main.className = 'manage-page';
main.replaceChildren(loadingState());

function settingRow(title, desc, control, controlId) {
  return el('div', { class: 'setting-row' },
    el('div', { class: 'text' }, el('label', { class: 'title', for: controlId }, title), desc ? el('p', { class: 'desc' }, desc) : null),
    el('div', { class: 'control' }, control));
}

async function save(patch, message = 'Settings saved.') {
  try { await api('/settings', { method: 'PATCH', body: patch }); toast(message, { type: 'success', duration: 2500 }); return true; } catch (error) { toastError(error); return false; }
}

function selectControl(id, options, value, onChange) {
  const select = el('select', { class: 'select', id }, options.map(([v, l]) => el('option', { value: v, selected: String(v) === String(value) }, l)));
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function passwordPanel() {
  const current = el('input', { class: 'input', id: 'pw-current', type: 'password', autocomplete: 'current-password' });
  const next = el('input', { class: 'input', id: 'pw-new', type: 'password', autocomplete: 'new-password', 'aria-describedby': 'pw-hint' });
  const confirm = el('input', { class: 'input', id: 'pw-confirm', type: 'password', autocomplete: 'new-password' });
  const error = el('div', { class: 'notice notice-error', role: 'alert', hidden: true });
  const submit = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Change password');
  const form = el('form', { class: 'form-grid', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    error.hidden = true;
    const fail = (message, field) => { error.hidden = false; error.replaceChildren(icon('circle-alert'), el('span', {}, message)); field?.focus(); };
    if (!current.value) return fail('Enter your current password.', current);
    if (next.value.length < 10) return fail('New password must be at least 10 characters.', next);
    if (next.value !== confirm.value) return fail('The new passwords don\'t match. Please re-enter them.', confirm);
    setBusy(submit, true, 'Changing…');
    try {
      await api('/auth/password', { method: 'POST', body: { current: current.value, new: next.value } });
      form.reset();
      toast('Password changed. Other devices have been signed out.', { type: 'success' });
      loadSessions();
    } catch (err) { fail(err.message, current); } finally { setBusy(submit, false); }
  } },
  error,
  el('div', { class: 'field' }, el('label', { class: 'label', for: 'pw-current' }, 'Current password'), current),
  el('div', { class: 'form-grid two' },
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'pw-new' }, 'New password'), next, el('p', { class: 'hint', id: 'pw-hint' }, 'At least 10 characters and must not contain your username.')),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'pw-confirm' }, 'Confirm new password'), confirm)),
  el('div', { class: 'row-actions' }, submit));
  return form;
}

const sessionsBox = el('div', {}, loadingState());
async function loadSessions() {
  try {
    const { items } = await api('/auth/sessions');
    sessionsBox.replaceChildren(...items.map((s) => el('div', { class: 'session-item' },
      el('div', {}, el('p', {}, s.current ? 'This device' : (s.user_agent || 'Unknown device').slice(0, 80)), el('p', { class: 'text-meta' }, `${s.ip || ''} · Last active ${formatDateTime(s.last_seen_at)}`)),
      s.current ? el('span', { class: 'badge badge-success' }, 'Current') : button('Sign out this device', { variant: 'btn-outline', onclick: async () => {
        try { await api(`/auth/sessions/${s.id}`, { method: 'DELETE' }); toast('That device has been signed out.', { type: 'success' }); loadSessions(); } catch (error) { toastError(error); }
      } }))));
  } catch (error) { sessionsBox.replaceChildren(errorState(error, loadSessions)); }
}

try {
  const [settings, storage, jobs] = await Promise.all([api('/settings'), api('/storage'), api('/jobs/stats')]);
  let theme = 'dark';
  try { theme = localStorage.getItem('album-theme') || 'dark'; } catch { /* 기본값 */ }
  const blur = el('input', { type: 'checkbox', id: 'blur', checked: settings.blur_thumbnails });
  blur.addEventListener('change', async () => { if (await save({ blur_thumbnails: blur.checked })) setBlurThumbnails(blur.checked); else blur.checked = !blur.checked; });
  const usedPercent = storage.disk.total ? Math.round((storage.disk.used / storage.disk.total) * 100) : 0;
  const meter = el('div', { class: 'meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(usedPercent), 'aria-label': 'Disk usage' }, el('span'));
  meter.firstChild.style.width = `${usedPercent}%`;
  const failed = jobs.counts.failed || 0;
  main.replaceChildren(
    el('div', { class: 'page-head' }, el('h1', {}, 'Settings')),
    el('section', { class: 'panel', 'aria-labelledby': 's-security' },
      el('h2', { id: 's-security' }, 'Security'),
      el('p', { class: 'panel-desc' }, `${me.user.display_name} (${me.user.login_id})`),
      settingRow('Auto-lock', 'Locks the screen after a period of inactivity. Unlock with your password.',
        selectControl('idle', [[5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [240, '4 hours']], settings.session_idle_minutes, (v) => save({ session_idle_minutes: Number(v) }, 'Auto-lock time updated. It applies from the next page load.')), 'idle'),
      el('h3', { class: 'label' }, 'Change password'),
      passwordPanel()),
    el('section', { class: 'panel', 'aria-labelledby': 's-sessions' }, el('h2', { id: 's-sessions' }, 'Signed-in devices'), sessionsBox),
    el('section', { class: 'panel', 'aria-labelledby': 's-display' },
      el('h2', { id: 's-display' }, 'Display'),
      settingRow('Theme', 'Saved on this device only. Dark is the default.', selectControl('theme', [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']], theme, setTheme), 'theme'),
      settingRow('Blur thumbnails', 'Show all photos blurred and reveal only the one you tap.', el('label', { class: 'checkbox-row', for: 'blur' }, blur, el('span', {}, 'On')), 'blur'),
      settingRow('Hide viewer controls', 'Hides the viewer buttons after a period of inactivity.', selectControl('hide', [[2, '2 seconds'], [3, '3 seconds'], [5, '5 seconds'], [10, '10 seconds']], settings.viewer_controls_hide_seconds, (v) => save({ viewer_controls_hide_seconds: Number(v) })), 'hide'),
      settingRow('Trash retention', 'After this period, items and their originals are deleted permanently.', selectControl('trash-days', [[7, '7 days'], [30, '30 days'], [90, '90 days']], settings.trash_retention_days, (v) => save({ trash_retention_days: Number(v) })), 'trash-days'),
      settingRow('Browser cache', 'When off, photos are downloaded from the server every time. Turn it off on shared computers.', (() => {
        const c = el('input', { type: 'checkbox', id: 'cache', checked: settings.media_cache_enabled });
        c.addEventListener('change', async () => { if (!(await save({ media_cache_enabled: c.checked }))) c.checked = !c.checked; });
        return el('label', { class: 'checkbox-row', for: 'cache' }, c, el('span', {}, 'On'));
      })(), 'cache')),
    el('section', { class: 'panel', 'aria-labelledby': 's-storage' },
      el('h2', { id: 's-storage' }, 'Storage'),
      el('p', { class: 'panel-desc', 'data-numeric': true }, `${formatBytes(storage.disk.used)} of ${formatBytes(storage.disk.total)} used · ${formatBytes(storage.disk.free)} free`),
      meter,
      storage.disk.free / storage.disk.total < 0.1 ? el('p', { class: 'notice notice-error', role: 'alert' }, icon('circle-alert'), 'Less than 10% of disk space is free. Clean up or expand the photo disk.') : null,
      el('p', { class: 'stat-line' }, plural(storage.models, 'model'), plural(storage.albums, 'album'), plural(storage.photos, 'photo'), `Originals ${formatBytes(storage.original_bytes)}`)),
    el('section', { class: 'panel', 'aria-labelledby': 's-jobs' },
      el('h2', { id: 's-jobs' }, 'Photo processing'),
      el('p', { class: 'stat-line' }, `Queued ${formatNumber(jobs.counts.queued || 0)}`, `Running ${formatNumber(jobs.counts.running || 0)}`, `Done ${formatNumber(jobs.counts.succeeded || 0)}`, `Failed ${formatNumber(failed)}`),
      failed ? el('p', { class: 'notice notice-error' }, icon('circle-alert'), `${plural(failed, 'job')} failed. Check local/worker.log on the server.`) : null,
      storage.processing ? el('p', { class: 'hint' }, `${plural(storage.processing, 'photo')} still processing. Make sure the Worker is running.`) : null));
  loadSessions();
} catch (error) {
  main.replaceChildren(errorState(error, () => location.reload()));
}
