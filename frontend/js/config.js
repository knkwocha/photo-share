// ─── PhotoShare Frontend Config ───────────────────────────────────────────────
// Change API_BASE_URL to your deployed Azure App Service URL
const CONFIG = {
  API_BASE_URL: window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://photoshare-api-kj.azurewebsites.net',  // ← update after deploying backend

  MAX_FILE_SIZE_MB: 20,
  ITEMS_PER_PAGE: 12,
};

// Convenience: authenticated fetch helper
async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('ps_token');
  const headers = { ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${CONFIG.API_BASE_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'API error'), { status: res.status, data });
  return data;
}

function getUser() {
  const raw = localStorage.getItem('ps_user');
  return raw ? JSON.parse(raw) : null;
}

function logout() {
  localStorage.removeItem('ps_token');
  localStorage.removeItem('ps_user');
  window.location.href = 'index.html';
}

function requireAuth(redirectTo = 'index.html') {
  if (!localStorage.getItem('ps_token')) {
    window.location.href = redirectTo;
    return false;
  }
  return true;
}

function showToast(message, type = 'info') {
  const existing = document.getElementById('ps-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'ps-toast';
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
  setTimeout(() => { toast.classList.remove('toast--visible'); setTimeout(() => toast.remove(), 400); }, 3500);
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function starRating(avg, count) {
  const full = Math.round(avg);
  const stars = Array.from({ length: 5 }, (_, i) => `<span class="star${i < full ? ' star--filled' : ''}">${i < full ? '★' : '☆'}</span>`).join('');
  return `<span class="rating">${stars} <span class="rating-count">(${count})</span></span>`;
}
