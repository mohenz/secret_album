// 설정: 보안 · 표시 · 저장 공간 · 작업 상태
import { api } from '../shared/api.js';
import { boot, setTheme } from '../shared/layout.js';
import { setBlurThumbnails } from '../shared/privacy.js';
import { button, confirmDialog, el, errorState, formatBytes, formatDateTime, formatNumber, icon, loadingState, setBusy, showDialog, toast, toastError } from '../shared/ui.js';

const main = document.getElementById('main');
const me = await boot({ ownerOnly: true });
main.className = 'manage-page';
main.replaceChildren(loadingState());

function settingRow(title, desc, control, controlId) {
  return el('div', { class: 'setting-row' },
    el('div', { class: 'text' }, el('label', { class: 'title', for: controlId }, title), desc ? el('p', { class: 'desc' }, desc) : null),
    el('div', { class: 'control' }, control));
}

async function save(patch, message = '설정을 저장했습니다.') {
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
  const submit = el('button', { type: 'submit', class: 'btn btn-primary' }, '비밀번호 변경');
  const form = el('form', { class: 'form-grid', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    error.hidden = true;
    const fail = (message, field) => { error.hidden = false; error.replaceChildren(icon('circle-alert'), el('span', {}, message)); field?.focus(); };
    if (!current.value) return fail('현재 비밀번호를 입력해 주세요.', current);
    if (next.value.length < 10) return fail('새 비밀번호는 10자 이상이어야 합니다.', next);
    if (next.value !== confirm.value) return fail('새 비밀번호와 확인이 다릅니다. 다시 입력해 주세요.', confirm);
    setBusy(submit, true, '변경 중…');
    try {
      await api('/auth/password', { method: 'POST', body: { current: current.value, new: next.value } });
      form.reset();
      toast('비밀번호를 바꿨습니다. 다른 기기의 로그인은 모두 끊었습니다.', { type: 'success' });
      loadSessions();
    } catch (err) { fail(err.message, current); } finally { setBusy(submit, false); }
  } },
  error,
  el('div', { class: 'field' }, el('label', { class: 'label', for: 'pw-current' }, '현재 비밀번호'), current),
  el('div', { class: 'form-grid two' },
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'pw-new' }, '새 비밀번호'), next, el('p', { class: 'hint', id: 'pw-hint' }, '10자 이상, 아이디를 넣을 수 없습니다.')),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'pw-confirm' }, '새 비밀번호 확인'), confirm)),
  el('div', { class: 'row-actions' }, submit));
  return form;
}

async function regenerateCodes() {
  const ok = await confirmDialog({ title: '복구 코드를 새로 만들까요?', description: '지금까지의 복구 코드는 더 이상 쓸 수 없습니다.', confirmLabel: '복구 코드 새로 만들기' });
  if (!ok) return;
  try {
    const { recovery_codes: codes } = await api('/auth/recovery-codes', { method: 'POST' });
    const dialog = el('dialog', { class: 'dialog', 'aria-labelledby': 'rc-title' }, el('div', { class: 'dialog-body' },
      el('h2', { class: 'dialog-title', id: 'rc-title' }, '새 복구 코드'),
      el('p', { class: 'dialog-description' }, '지금만 표시됩니다. 안전한 곳에 적어 두세요.'),
      el('ol', { class: 'recovery-list' }, codes.map((c) => el('li', {}, c))),
      el('div', { class: 'dialog-actions' }, button('보관했습니다', { variant: 'btn-primary', onclick: () => dialog.close() }))));
    showDialog(dialog);
    dialog.querySelector('.btn-primary').focus();
  } catch (error) { toastError(error); }
}

const sessionsBox = el('div', {}, loadingState());
async function loadSessions() {
  try {
    const { items } = await api('/auth/sessions');
    sessionsBox.replaceChildren(...items.map((s) => el('div', { class: 'session-item' },
      el('div', {}, el('p', {}, s.current ? '이 기기' : (s.user_agent || '알 수 없는 기기').slice(0, 80)), el('p', { class: 'text-meta' }, `${s.ip || ''} · 마지막 사용 ${formatDateTime(s.last_seen_at)}`)),
      s.current ? el('span', { class: 'badge badge-success' }, '현재') : button('이 기기 로그아웃', { variant: 'btn-outline', onclick: async () => {
        try { await api(`/auth/sessions/${s.id}`, { method: 'DELETE' }); toast('해당 기기를 로그아웃했습니다.', { type: 'success' }); loadSessions(); } catch (error) { toastError(error); }
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
  const meter = el('div', { class: 'meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(usedPercent), 'aria-label': '디스크 사용량' }, el('span'));
  meter.firstChild.style.width = `${usedPercent}%`;
  const failed = jobs.counts.failed || 0;
  main.replaceChildren(
    el('div', { class: 'page-head' }, el('h1', {}, '설정')),
    el('section', { class: 'panel', 'aria-labelledby': 's-security' },
      el('h2', { id: 's-security' }, '보안'),
      el('p', { class: 'panel-desc' }, `${me.user.display_name} (${me.user.login_id}) · 2단계 인증 ${me.user.totp_enabled ? '사용 중' : '미등록'}`),
      settingRow('자동 잠금', '입력이 없으면 화면을 잠급니다. 잠금 해제는 비밀번호만 입력합니다.',
        selectControl('idle', [[5, '5분'], [15, '15분'], [30, '30분'], [60, '1시간'], [240, '4시간']], settings.session_idle_minutes, (v) => save({ session_idle_minutes: Number(v) }, '자동 잠금 시간을 바꿨습니다. 다음 화면부터 적용됩니다.')), 'idle'),
      settingRow('복구 코드', '휴대폰을 잃어버렸을 때 쓰는 1회용 코드를 새로 만듭니다.', button('복구 코드 새로 만들기', { variant: 'btn-outline', onclick: regenerateCodes })),
      el('h3', { class: 'label' }, '비밀번호 변경'),
      passwordPanel()),
    el('section', { class: 'panel', 'aria-labelledby': 's-sessions' }, el('h2', { id: 's-sessions' }, '로그인한 기기'), sessionsBox),
    el('section', { class: 'panel', 'aria-labelledby': 's-display' },
      el('h2', { id: 's-display' }, '표시'),
      settingRow('테마', '이 기기에만 저장됩니다. 기본값은 다크입니다.', selectControl('theme', [['dark', '다크'], ['light', '라이트'], ['system', '시스템 설정']], theme, setTheme), 'theme'),
      settingRow('썸네일 가리기', '모든 사진을 흐리게 보여 주고, 누른 사진만 선명하게 합니다.', el('label', { class: 'checkbox-row', for: 'blur' }, blur, el('span', {}, '사용')), 'blur'),
      settingRow('뷰어 컨트롤 숨김', '입력이 없으면 뷰어 버튼을 숨깁니다.', selectControl('hide', [[2, '2초'], [3, '3초'], [5, '5초'], [10, '10초']], settings.viewer_controls_hide_seconds, (v) => save({ viewer_controls_hide_seconds: Number(v) })), 'hide'),
      settingRow('휴지통 보관 기간', '기간이 지나면 원본까지 영구 삭제합니다.', selectControl('trash-days', [[7, '7일'], [30, '30일'], [90, '90일']], settings.trash_retention_days, (v) => save({ trash_retention_days: Number(v) })), 'trash-days'),
      settingRow('브라우저 캐시', '끄면 사진을 매번 서버에서 받습니다. 공용 PC에서는 끄세요.', (() => {
        const c = el('input', { type: 'checkbox', id: 'cache', checked: settings.media_cache_enabled });
        c.addEventListener('change', async () => { if (!(await save({ media_cache_enabled: c.checked }))) c.checked = !c.checked; });
        return el('label', { class: 'checkbox-row', for: 'cache' }, c, el('span', {}, '사용'));
      })(), 'cache')),
    el('section', { class: 'panel', 'aria-labelledby': 's-storage' },
      el('h2', { id: 's-storage' }, '저장 공간'),
      el('p', { class: 'panel-desc', 'data-numeric': true }, `${formatBytes(storage.disk.used)} / ${formatBytes(storage.disk.total)} 사용 중 · 여유 ${formatBytes(storage.disk.free)}`),
      meter,
      storage.disk.free / storage.disk.total < 0.1 ? el('p', { class: 'notice notice-error', role: 'alert' }, icon('circle-alert'), '디스크 여유 공간이 10%보다 적습니다. 사진 디스크를 정리하거나 늘려 주세요.') : null,
      el('p', { class: 'stat-line' }, `모델 ${formatNumber(storage.models)}명`, `앨범 ${formatNumber(storage.albums)}개`, `사진 ${formatNumber(storage.photos)}장`, `원본 ${formatBytes(storage.original_bytes)}`)),
    el('section', { class: 'panel', 'aria-labelledby': 's-jobs' },
      el('h2', { id: 's-jobs' }, '사진 처리 상태'),
      el('p', { class: 'stat-line' }, `대기 ${formatNumber(jobs.counts.queued || 0)}`, `처리 중 ${formatNumber(jobs.counts.running || 0)}`, `완료 ${formatNumber(jobs.counts.succeeded || 0)}`, `실패 ${formatNumber(failed)}`),
      failed ? el('p', { class: 'notice notice-error' }, icon('circle-alert'), `처리하지 못한 작업이 ${formatNumber(failed)}건 있습니다. 서버의 local/worker.log를 확인해 주세요.`) : null,
      storage.processing ? el('p', { class: 'hint' }, `처리 중인 사진 ${formatNumber(storage.processing)}장. Worker가 실행 중인지 확인해 주세요.`) : null));
  loadSessions();
} catch (error) {
  main.replaceChildren(errorState(error, () => location.reload()));
}
