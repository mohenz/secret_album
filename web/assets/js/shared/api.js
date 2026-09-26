import { API_BASE } from '../api-config.js';

export class ApiError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail || {};
  }
}

const AUTH_CODES = new Set(['unauthenticated', 'locked']);

export function loginUrl(reason) {
  const next = location.pathname + location.search;
  const params = new URLSearchParams({ next });
  if (reason === 'locked') params.set('lock', '1');
  return `/login.html?${params}`;
}

export function goLogin(reason) {
  location.replace(loginUrl(reason));
}

export async function api(path, { method = 'GET', body, signal, noRedirect = false } = {}) {
  const init = { method, credentials: 'include', signal, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(0, 'network', 'Could not reach the server. Check your network connection and that the server is running.');
  }
  const type = response.headers.get('Content-Type') || '';
  const payload = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = payload?.error || {};
    const code = error.code || 'error';
    if (response.status === 401 && AUTH_CODES.has(code) && !noRedirect) {
      goLogin(code);
      return new Promise(() => {});
    }
    throw new ApiError(response.status, code, error.message || 'The request failed. Please try again shortly.', error.detail);
  }
  return payload;
}

export const mediaUrl = (id, variant) => `${API_BASE}/media/${id}/${variant}`;

const VARIANTS = [['thumb', 480], ['medium', 1600], ['large', 3200]];

// 파생 이미지 실제 너비로 srcset을 만든다. (긴 변 기준 규격, 원본보다 크게 만들지 않음)
export function srcsetFor(photo, upTo = 'large') {
  const long = Math.max(photo.w, photo.h);
  const parts = [];
  for (const [name, limit] of VARIANTS) {
    const scale = Math.min(1, limit / long);
    parts.push(`${mediaUrl(photo.id, name)} ${Math.max(1, Math.round(photo.w * scale))}w`);
    if (name === upTo) break;
  }
  return parts.join(', ');
}

// 업로드 진행률이 필요해 XMLHttpRequest를 쓴다.
export function uploadFile(file, albumId, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const params = new URLSearchParams({ album_id: albumId, filename: file.name });
    xhr.open('PUT', `${API_BASE}/uploads?${params}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'The upload was interrupted. Check your network and try again.'));
    xhr.onload = () => {
      let payload = null;
      try { payload = JSON.parse(xhr.responseText); } catch { /* 비어 있는 응답 */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(payload);
      const error = payload?.error || {};
      if (xhr.status === 401 && AUTH_CODES.has(error.code)) { goLogin(error.code); return; }
      reject(new ApiError(xhr.status, error.code || 'error', error.message || 'Upload failed. Please try again.', error.detail));
    };
    xhr.send(file);
  });
}
