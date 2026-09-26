// 공통 DOM·Dialog·메뉴·Toast·서식 도우미. 모든 사용자 문구는 한국어로 넘긴다.

const SPRITE = '/assets/icons/sprite.svg';
const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `${SPRITE}#${name}`);
  svg.append(use);
  return svg;
}

// replaceChildren()·append()는 null을 "null" 글자로 넣으므로, 조건부 자식은 이 함수로 거른다.
export function setChildren(parent, ...children) {
  parent.replaceChildren(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function button(label, { variant = '', iconName, onclick, type = 'button', ariaLabel, className = '' } = {}) {
  const content = [];
  if (iconName) content.push(icon(iconName));
  if (label) content.push(el('span', {}, label));
  return el('button', { type, class: `btn ${variant} ${className}`.trim(), onclick, 'aria-label': ariaLabel }, content);
}

export function iconButton(name, ariaLabel, onclick, className = '') {
  return el('button', { type: 'button', class: `btn btn-icon ${className}`.trim(), 'aria-label': ariaLabel, title: ariaLabel, onclick }, icon(name, 'icon-20'));
}

// ------------------------------------------------ Tooltip: 아이콘 버튼에 마우스를 올리거나 키보드로 포커스하면 기능 설명을 띄운다.
// 화면 가장자리에서 잘리지 않도록 body에 고정 위치로 그리고, 버튼 이름(aria-label)은 같은 문구로 둔다.
let tipNode = null;
let tipTimer = 0;
function hideTip() {
  clearTimeout(tipTimer);
  if (tipNode) tipNode.hidden = true;
}
function showTip(target, text) {
  tipNode ??= document.body.appendChild(el('div', { class: 'tooltip', 'aria-hidden': 'true', hidden: true }));
  tipNode.textContent = text;
  tipNode.hidden = false;
  const r = target.getBoundingClientRect();
  const w = tipNode.offsetWidth;
  const h = tipNode.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  const above = r.top - h - 8;
  tipNode.style.left = `${left}px`;
  tipNode.style.top = `${above >= 8 ? above : r.bottom + 8}px`;
}
export function withTooltip(target, text) {
  target.setAttribute('aria-label', text);
  target.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showTip(target, text), 250);
  });
  target.addEventListener('focus', () => { if (target.matches(':focus-visible')) showTip(target, text); });
  for (const type of ['pointerleave', 'blur', 'click']) target.addEventListener(type, hideTip);
  target.addEventListener('keydown', (event) => { if (event.key === 'Escape' && tipNode && !tipNode.hidden) { hideTip(); event.stopPropagation(); } });
  return target;
}

export function tipButton(iconName, text, onclick, { type = 'button', className = '' } = {}) {
  return withTooltip(el('button', { type, class: `btn btn-icon tip-btn ${className}`.trim(), onclick }, icon(iconName, 'icon-20')), text);
}

export function setBusy(buttonEl, busy, busyLabel) {
  if (!buttonEl) return;
  if (busy) {
    buttonEl.dataset.label = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.replaceChildren(icon('loader-circle', 'spin'), el('span', {}, busyLabel || 'Working…'));
  } else {
    buttonEl.disabled = false;
    if (buttonEl.dataset.label !== undefined) buttonEl.replaceChildren(el('span', {}, buttonEl.dataset.label));
  }
}

// ------------------------------------------------ Toast (aria-live)
let toastRegion;
export function toast(message, { type = 'info', actionLabel, onAction, duration = 5000 } = {}) {
  if (!toastRegion) {
    toastRegion = el('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastRegion);
  }
  const iconName = type === 'error' ? 'circle-alert' : type === 'success' ? 'circle-check' : 'info';
  const node = el('div', { class: `toast toast-${type}` }, icon(iconName, 'icon-18'), el('div', { class: 'toast-message' }, message));
  let timer;
  const close = () => { clearTimeout(timer); node.remove(); };
  if (actionLabel) {
    node.append(button(actionLabel, { variant: 'btn-ghost', onclick: () => { close(); onAction?.(); } }));
  }
  toastRegion.append(node);
  timer = setTimeout(close, duration);
  return close;
}

export function toastError(error) {
  if (error?.name === 'AbortError') return;
  toast(error?.message || 'Something went wrong. Please try again.', { type: 'error', duration: 8000 });
}

// ------------------------------------------------ Dialog (네이티브 <dialog>: 포커스 가두기·Esc 닫기, 닫힌 뒤 실행 버튼으로 포커스 복귀)
export function showDialog(dialog) {
  const opener = document.activeElement;
  document.body.append(dialog);
  document.documentElement.classList.add('dialog-open');
  dialog.showModal();
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (!document.querySelector('dialog[open]')) document.documentElement.classList.remove('dialog-open');
    if (opener && document.contains(opener)) opener.focus();
  }, { once: true });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close('dismiss'); });
  return dialog;
}

export function confirmDialog({ title, description, confirmLabel, destructive = false, cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    const titleId = `d-${crypto.randomUUID()}`;
    const confirmBtn = button(confirmLabel, { variant: destructive ? 'btn-destructive' : 'btn-primary', onclick: () => { dialog.close('ok'); } });
    const dialog = el('dialog', { class: 'dialog', 'aria-labelledby': titleId, role: destructive ? 'alertdialog' : 'dialog' },
      el('div', { class: 'dialog-body' },
        el('h2', { class: 'dialog-title', id: titleId }, title),
        description ? el('p', { class: 'dialog-description' }, description) : null,
        el('div', { class: 'dialog-actions' }, button(cancelLabel, { variant: 'btn-outline', onclick: () => dialog.close('cancel') }), confirmBtn)));
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    showDialog(dialog);
    (destructive ? dialog.querySelector('.btn-outline') : confirmBtn).focus();
  });
}

/*
  폼 Dialog. fields: [{name, label, type, required, value, options, hint, maxlength, inputmode, autocomplete}]
  onSubmit(values) → Promise. 실패하면 오류를 필드 근처나 상단에 표시하고 첫 오류 필드로 포커스를 옮긴다.
*/
export function formDialog({ title, description, fields, submitLabel, onSubmit, sheet = false }) {
  return new Promise((resolve) => {
    const titleId = `d-${crypto.randomUUID()}`;
    const formError = el('div', { class: 'notice notice-error', role: 'alert', hidden: true });
    const inputs = {};
    const fieldNodes = fields.map((field) => {
      const id = `f-${crypto.randomUUID()}`;
      const errorId = `${id}-error`;
      let control;
      const common = { id, name: field.name, 'aria-describedby': errorId, required: field.required || undefined };
      if (field.type === 'textarea') {
        control = el('textarea', { ...common, class: 'textarea', maxlength: field.maxlength });
        control.value = field.value ?? '';
      } else if (field.type === 'select') {
        control = el('select', { ...common, class: 'select' }, field.options.map((o) => el('option', { value: o.value }, o.label)));
        control.value = field.value ?? field.options[0]?.value ?? '';
      } else {
        control = el('input', { ...common, class: 'input', type: field.type || 'text', maxlength: field.maxlength, inputmode: field.inputmode, autocomplete: field.autocomplete || 'off', spellcheck: 'false' });
        control.value = field.value ?? '';
      }
      inputs[field.name] = control;
      return el('div', { class: 'field' },
        el('label', { class: 'label', for: id }, field.label, field.required ? el('span', { 'aria-hidden': 'true' }, ' *') : null),
        control,
        field.hint ? el('p', { class: 'hint' }, field.hint) : null,
        el('p', { class: 'field-error', id: errorId }));
    });
    const submit = button(submitLabel, { variant: 'btn-primary', type: 'submit' });
    const form = el('form', { class: 'dialog-body', novalidate: true },
      el('h2', { class: 'dialog-title', id: titleId }, title),
      description ? el('p', { class: 'dialog-description' }, description) : null,
      formError,
      ...fieldNodes,
      el('div', { class: 'dialog-actions' }, button('Cancel', { variant: 'btn-outline', onclick: () => dialog.close('cancel') }), submit));
    const dialog = el('dialog', { class: `dialog ${sheet ? 'sheet' : ''}`, 'aria-labelledby': titleId }, form);
    let result = null;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      formError.hidden = true;
      for (const node of form.querySelectorAll('.field-error')) node.textContent = '';
      for (const control of Object.values(inputs)) control.removeAttribute('aria-invalid');
      const missing = fields.find((f) => f.required && !inputs[f.name].value.trim());
      if (missing) {
        const control = inputs[missing.name];
        control.setAttribute('aria-invalid', 'true');
        document.getElementById(control.getAttribute('aria-describedby')).textContent = `Please enter ${missing.label.toLowerCase()}.`;
        control.focus();
        return;
      }
      const values = Object.fromEntries(Object.entries(inputs).map(([k, c]) => [k, c.value.trim()]));
      setBusy(submit, true, 'Saving…');
      try {
        result = await onSubmit(values);
        dialog.close('ok');
      } catch (error) {
        formError.hidden = false;
        formError.replaceChildren(icon('circle-alert'), el('span', {}, error.message || 'Could not save. Please try again.'));
        setBusy(submit, false);
        form.querySelector('[aria-invalid="true"], input, textarea, select')?.focus();
      }
    });
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? result : null), { once: true });
    showDialog(dialog);
    inputs[fields[0].name]?.focus();
  });
}

// ------------------------------------------------ 메뉴 (popover, 방향키 이동)
export function openMenu(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const menu = el('div', { class: 'menu', role: 'menu', popover: 'auto' });
  for (const item of items) {
    if (item === 'separator') { menu.append(el('div', { class: 'menu-separator', role: 'separator' })); continue; }
    const tag = item.href ? 'a' : 'button';
    const node = el(tag, {
      class: `menu-item ${item.danger ? 'danger' : ''}`, role: 'menuitem', href: item.href, type: item.href ? undefined : 'button', tabindex: '-1',
      onclick: () => { menu.hidePopover(); item.onSelect?.(); },
    }, item.icon ? icon(item.icon) : null, el('span', {}, item.label));
    menu.append(node);
  }
  document.body.append(menu);
  menu.showPopover();
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
  const top = rect.bottom + 6 + menu.offsetHeight > window.innerHeight ? Math.max(8, rect.top - menu.offsetHeight - 6) : rect.bottom + 6;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  anchor.setAttribute('aria-expanded', 'true');
  const entries = [...menu.querySelectorAll('[role="menuitem"]')];
  entries[0]?.focus();
  menu.addEventListener('keydown', (event) => {
    const index = entries.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); entries[(index + 1) % entries.length].focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); entries[(index - 1 + entries.length) % entries.length].focus(); }
    if (event.key === 'Home') { event.preventDefault(); entries[0].focus(); }
    if (event.key === 'End') { event.preventDefault(); entries.at(-1).focus(); }
  });
  menu.addEventListener('toggle', (event) => {
    if (event.newState === 'closed') {
      anchor.setAttribute('aria-expanded', 'false');
      const wasInside = menu.contains(document.activeElement) || document.activeElement === document.body;
      menu.remove();
      if (wasInside) anchor.focus();
    }
  });
  return menu;
}

// ------------------------------------------------ 서식 (Intl, en-US)
const dateFormat = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const numberFormat = new Intl.NumberFormat('en-US');

export function formatDate(value) {
  if (!value) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
}
export function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateTimeFormat.format(date);
}
export const formatNumber = (value) => numberFormat.format(value ?? 0);
export const plural = (count, word, words = `${word}s`) => `${numberFormat.format(count ?? 0)} ${count === 1 ? word : words}`;
export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: unit >= 3 ? 1 : 0 }).format(value)} ${units[unit]}`;
}
export function joinMeta(...parts) {
  return parts.filter(Boolean).join(' · ');
}

export function debounce(fn, wait) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
}

export function emptyState(iconName, title, description, action) {
  return el('div', { class: 'empty' }, icon(iconName, 'icon-32'), el('p', { class: 'text-card' }, title), description ? el('p', { class: 'text-ui' }, description) : null, action || null);
}

export function loadingState(label = 'Loading…') {
  return el('div', { class: 'loading', role: 'status' }, icon('loader-circle', 'spin icon-20'), el('span', {}, label));
}

export function errorState(error, retry) {
  return el('div', { class: 'empty', role: 'alert' }, icon('circle-alert', 'icon-32'),
    el('p', { class: 'text-card' }, 'Could not load this page'),
    el('p', { class: 'text-ui' }, error?.message || 'Check your network connection and try again.'),
    retry ? button('Try again', { variant: 'btn-outline', iconName: 'refresh-cw', onclick: retry }) : null);
}
