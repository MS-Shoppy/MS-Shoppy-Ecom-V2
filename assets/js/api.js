/**
 * Thin wrapper around the Apps Script backend.
 * Always POSTs with Content-Type text/plain — this avoids the
 * CORS preflight (OPTIONS) request, which Apps Script web apps
 * don't handle. The backend still parses the body as JSON.
 */
async function callApi(action, payload = {}) {
  if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('PASTE_YOUR') === 0) {
    throw new Error('Backend not configured yet. Set API_URL in assets/js/config.js');
  }

  const body = JSON.stringify({ action, ...payload });

  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
  });

  if (!res.ok) {
    throw new Error('Network error: ' + res.status);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error || 'Something went wrong');
  }
  return data;
}

function formatMoney(amount) {
  const n = Number(amount) || 0;
  return CONFIG.CURRENCY + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
