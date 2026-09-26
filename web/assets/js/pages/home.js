import { API_BASE } from '../api-config.js';

const health = document.querySelector('[data-health]');

async function checkHealth() {
  try {
    const response = await fetch(`${API_BASE}/health`, { credentials: 'include' });
    if (!response.ok) throw new Error(String(response.status));
    health.dataset.state = 'ok';
    health.querySelector('span:last-child').textContent = 'API 연결됨';
  } catch {
    health.dataset.state = 'offline';
    health.querySelector('span:last-child').textContent = 'API를 시작해 주세요';
  }
}

checkHealth();

