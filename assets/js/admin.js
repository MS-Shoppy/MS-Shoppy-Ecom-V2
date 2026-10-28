/* ============================================================
 *  ADMIN PANEL LOGIC  (v3)
 *  - token based sign-in; session length is set in Settings
 *  - sortable / filterable / paged tables
 * ============================================================ */

const TOKEN_KEY = 'ms_admin_token';
let ADMIN_TOKEN = '';
try { ADMIN_TOKEN = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { /* storage blocked */ }

let ADMIN_PRODUCTS = [];
let ADMIN_ORDERS = [];
let ADMIN_GALLERY = [];
let ADMIN_BANNERS = [];
let PENDING_IMAGES = [null, null, null, null]; // each: { base64, mimeType, filename } or { existingUrl }
let PENDING_GALLERY_IMAGE = null;
let PENDING_BANNER_IMAGE = null;
let ADMIN_ORDER_ITEMS_CACHE = {}; // orderId -> { order, items }
let OPEN_ORDERS = new Set();      // order panels currently expanded

const PROD_VIEW = { q: '', cat: '', status: '', stock: '', sortKey: 'name', sortDir: 1, page: 1, size: 25 };
const ORD_VIEW = { q: '', status: '', from: '', to: '', sort: 'newest', page: 1, size: 20 };

document.addEventListener('DOMContentLoaded', () => {
  bindLogin();
  bindTabs();
  bindProductModal();
  bindProductTools();
  bindOrderTools();
  bindGalleryModal();
  bindBannerModal();
  bindSettingsForm();
  bindBillModal();

  if (ADMIN_TOKEN) showDashboard(); else showLogin();
});

/* ---------- API helper: attaches the session token ---------- */
let SIGNING_OUT = false;
async function adminApi(action, payload = {}) {
  try {
    return await callApi(action, { ...payload, adminToken: ADMIN_TOKEN });
  } catch (err) {
    if (err.code === 'ADMIN_AUTH') forceLogout('Your session has ended. Please sign in again.');
    throw err;
  }
}

function forceLogout(message) {
  if (SIGNING_OUT) return;
  SIGNING_OUT = true;
  clearToken();
  showLogin(message);
  setTimeout(() => { SIGNING_OUT = false; }, 500);
}

function clearToken() {
  ADMIN_TOKEN = '';
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
}

/* ---------- Login ---------- */
function showLogin(message) {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('adminWrap').style.display = 'none';
  const errorBox = document.getElementById('loginError');
  if (message) {
    errorBox.textContent = message;
    errorBox.classList.add('show');
  } else {
    errorBox.classList.remove('show');
  }
}

function showDashboard() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminWrap').style.display = 'block';
  loadProductsAdmin();
  loadOrdersAdmin();
  loadGalleryAdmin();
  loadBannersAdmin();
  loadSettingsAdmin();
}

function bindLogin() {
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pwInput = document.getElementById('adminPassword');
    const btn = document.getElementById('loginBtn');
    const errorBox = document.getElementById('loginError');
    errorBox.classList.remove('show');
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    try {
      const data = await callApi('adminLogin', { password: pwInput.value });
      ADMIN_TOKEN = data.token;
      try { localStorage.setItem(TOKEN_KEY, ADMIN_TOKEN); } catch (err) { /* ignore */ }
      pwInput.value = '';
      showDashboard();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    const token = ADMIN_TOKEN;
    clearToken();
    showLogin();
    try { await callApi('adminLogout', { adminToken: token }); } catch (err) { /* already gone */ }
  });
}

/* ---------- Tabs ---------- */
function bindTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

/* ---------- Shared table helpers ---------- */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function renderPager(el, total, page, size, onPage) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button class="icon-btn" data-pg="prev" ${page <= 1 ? 'disabled' : ''}>&larr; Prev</button>
    <span>Page ${page} of ${pages}</span>
    <button class="icon-btn" data-pg="next" ${page >= pages ? 'disabled' : ''}>Next &rarr;</button>
  `;
  el.querySelector('[data-pg="prev"]').addEventListener('click', () => onPage(page - 1));
  el.querySelector('[data-pg="next"]').addEventListener('click', () => onPage(page + 1));
}

function fillSelect(sel, options, current) {
  sel.innerHTML = options.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
  sel.value = options.some(o => o.value === current) ? current : options[0].value;
}

/* ---------- Products ---------- */
async function loadProductsAdmin() {
  const wrap = document.getElementById('productsTableWrap');
  try {
    const data = await adminApi('getAdminProducts');
    ADMIN_PRODUCTS = data.products || [];
    refreshCategoryControls();
    renderProductsTable();
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function productCategories() {
  const map = {};
  ADMIN_PRODUCTS.forEach(p => {
    const c = String(p.category || '').trim();
    if (c && !map[c.toLowerCase()]) map[c.toLowerCase()] = c;
  });
  return Object.values(map).sort((a, b) => a.localeCompare(b));
}

function refreshCategoryControls() {
  const cats = productCategories();
  fillSelect(document.getElementById('prodCategoryFilter'),
    [{ value: '', label: 'All categories' }].concat(cats.map(c => ({ value: c, label: c }))), PROD_VIEW.cat);
  PROD_VIEW.cat = document.getElementById('prodCategoryFilter').value;
  const bulk = document.getElementById('bulkCategory');
  fillSelect(bulk,
    [{ value: '', label: 'Choose category…' }, { value: '__ALL__', label: 'All products' }].concat(cats.map(c => ({ value: c, label: c }))),
    bulk.value);
}

function filteredProducts() {
  const v = PROD_VIEW;
  const q = v.q.trim().toLowerCase();
  let rows = ADMIN_PRODUCTS.filter(p => {
    if (q && !(String(p.name).toLowerCase().includes(q) || String(p.category || '').toLowerCase().includes(q))) return false;
    if (v.cat && String(p.category || '').trim().toLowerCase() !== v.cat.toLowerCase()) return false;
    if (v.status === 'visible' && !p.active) return false;
    if (v.status === 'hidden' && p.active) return false;
    const stock = Number(p.stock) || 0;
    if (v.stock === 'low' && !(stock > 0 && stock <= 5)) return false;
    if (v.stock === 'out' && stock > 0) return false;
    if (v.stock === 'discounted' && !(Number(p.discount) > 0)) return false;
    return true;
  });

  const numeric = { price: 1, discount: 1, stock: 1, active: 1 };
  const key = v.sortKey;
  rows = rows.slice().sort((a, b) => {
    let x = a[key], y = b[key];
    if (numeric[key]) { x = Number(x) || 0; y = Number(y) || 0; return (x - y) * v.sortDir; }
    return String(x || '').localeCompare(String(y || ''), undefined, { sensitivity: 'base' }) * v.sortDir;
  });
  return rows;
}

function sortHeader(label, key, view) {
  const active = view.sortKey === key;
  const arrow = active ? (view.sortDir === 1 ? ' ▲' : ' ▼') : '';
  return `<th class="sortable ${active ? 'sorted' : ''}" data-sort="${key}">${label}${arrow}</th>`;
}

function renderProductsTable() {
  const wrap = document.getElementById('productsTableWrap');
  const countEl = document.getElementById('prodCount');

  if (ADMIN_PRODUCTS.length === 0) {
    wrap.innerHTML = '<div class="empty-state">No products yet. Add your first one.</div>';
    countEl.textContent = '';
    document.getElementById('prodPager').innerHTML = '';
    return;
  }

  const rows = filteredProducts();
  const pages = Math.max(1, Math.ceil(rows.length / PROD_VIEW.size));
  if (PROD_VIEW.page > pages) PROD_VIEW.page = pages;
  const pageRows = rows.slice((PROD_VIEW.page - 1) * PROD_VIEW.size, PROD_VIEW.page * PROD_VIEW.size);
  countEl.textContent = `Showing ${rows.length} of ${ADMIN_PRODUCTS.length}`;

  if (rows.length === 0) {
    wrap.innerHTML = '<div class="empty-state">No products match these filters.</div>';
    document.getElementById('prodPager').innerHTML = '';
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th></th>${sortHeader('Name', 'name', PROD_VIEW)}${sortHeader('Category', 'category', PROD_VIEW)}${sortHeader('Price', 'price', PROD_VIEW)}${sortHeader('Discount', 'discount', PROD_VIEW)}${sortHeader('Stock', 'stock', PROD_VIEW)}<th>Video</th>${sortHeader('Status', 'active', PROD_VIEW)}<th></th>
        </tr>
      </thead>
      <tbody>
        ${pageRows.map(p => {
          const stock = Number(p.stock) || 0;
          const stockClass = stock <= 0 ? 'stock-out' : (stock <= 5 ? 'stock-low' : '');
          return `
          <tr>
            <td>${p.imageUrl ? `<img class="table-thumb" src="${escapeHtml(p.imageUrl)}">` : '<div class="table-thumb"></div>'}</td>
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.category || '—')}</td>
            <td>${formatMoney(p.price)}</td>
            <td>${Number(p.discount) > 0 ? escapeHtml(p.discount) + '%' : '—'}</td>
            <td class="${stockClass}">${escapeHtml(stock)}${stock <= 0 ? ' · out' : (stock <= 5 ? ' · low' : '')}</td>
            <td>${p.videoUrl ? '✅' : '—'}</td>
            <td><span class="badge ${p.active ? 'active' : 'inactive'}">${p.active ? 'Visible' : 'Hidden'}</span></td>
            <td>
              <div class="table-actions">
                <button class="icon-btn" data-edit="${escapeHtml(p.id)}">Edit</button>
                <button class="icon-btn danger" data-delete="${escapeHtml(p.id)}">Delete</button>
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (PROD_VIEW.sortKey === key) PROD_VIEW.sortDir *= -1; else { PROD_VIEW.sortKey = key; PROD_VIEW.sortDir = 1; }
    PROD_VIEW.page = 1;
    renderProductsTable();
  }));
  wrap.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openProductModal(b.dataset.edit)));
  wrap.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => deleteProduct(b.dataset.delete)));

  renderPager(document.getElementById('prodPager'), rows.length, PROD_VIEW.page, PROD_VIEW.size, (pg) => {
    PROD_VIEW.page = pg;
    renderProductsTable();
    document.getElementById('tab-products').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function bindProductTools() {
  const rerender = () => { PROD_VIEW.page = 1; renderProductsTable(); };
  document.getElementById('prodSearch').addEventListener('input', debounce((e) => { PROD_VIEW.q = e.target.value; rerender(); }, 200));
  document.getElementById('prodCategoryFilter').addEventListener('change', (e) => { PROD_VIEW.cat = e.target.value; rerender(); });
  document.getElementById('prodStatusFilter').addEventListener('change', (e) => { PROD_VIEW.status = e.target.value; rerender(); });
  document.getElementById('prodStockFilter').addEventListener('change', (e) => { PROD_VIEW.stock = e.target.value; rerender(); });
  document.getElementById('prodClearBtn').addEventListener('click', () => {
    Object.assign(PROD_VIEW, { q: '', cat: '', status: '', stock: '', page: 1 });
    document.getElementById('prodSearch').value = '';
    document.getElementById('prodCategoryFilter').value = '';
    document.getElementById('prodStatusFilter').value = '';
    document.getElementById('prodStockFilter').value = '';
    renderProductsTable();
  });

  document.getElementById('bulkApplyBtn').addEventListener('click', applyBulkDiscount);
}

async function applyBulkDiscount() {
  const category = document.getElementById('bulkCategory').value;
  const raw = document.getElementById('bulkDiscount').value.trim();
  const discount = Number(raw);
  if (!category) { showToast('Choose a category (or All products)'); return; }
  if (raw === '' || !isFinite(discount) || discount < 0 || discount > 95) { showToast('Enter a discount between 0 and 95'); return; }

  const affected = category === '__ALL__'
    ? ADMIN_PRODUCTS.length
    : ADMIN_PRODUCTS.filter(p => String(p.category || '').trim().toLowerCase() === category.toLowerCase()).length;
  const target = category === '__ALL__' ? 'ALL products' : `${affected} product(s) in "${category}"`;
  const what = discount === 0 ? 'remove the discount from' : `set ${discount}% discount on`;
  if (!confirm(`This will ${what} ${target}, replacing any individual discounts. Continue?`)) return;

  const btn = document.getElementById('bulkApplyBtn');
  btn.disabled = true;
  try {
    const res = await adminApi('applyCategoryDiscount', { category, discount });
    showToast(`Discount updated on ${res.updated} product(s)`);
    document.getElementById('bulkDiscount').value = '';
    loadProductsAdmin();
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
  }
}


function bindProductModal() {
  document.getElementById('newProductBtn').addEventListener('click', () => openProductModal(null));
  document.getElementById('productForm').addEventListener('submit', saveProduct);
  [1, 2, 3, 4].forEach(slot => {
    document.getElementById('prodImage' + slot).addEventListener('change', (e) => handleImageSelect(e, slot));
  });
  document.getElementById('productModalClose').addEventListener('click', () => closeModal('productModal'));
  document.getElementById('overlay') || createOverlayIfMissing();
}

const ADMIN_MODAL_IDS = ['productModal', 'galleryModal', 'bannerModal', 'billModal'];

function createOverlayIfMissing() {
  // admin.html has no cart drawer, so add a lightweight overlay for modal backdrop clicks
  if (document.getElementById('overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'overlay';
  overlay.className = 'overlay';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', () => {
    ADMIN_MODAL_IDS.forEach(id => closeModal(id));
  });
}

function openModal(id) {
  createOverlayIfMissing();
  document.getElementById('overlay').classList.add('open');
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  const overlay = document.getElementById('overlay');
  const stillOpen = ADMIN_MODAL_IDS.some(mid => document.getElementById(mid).classList.contains('open'));
  if (overlay && !stillOpen) overlay.classList.remove('open');
}

function openProductModal(id) {
  const form = document.getElementById('productForm');
  form.reset();
  document.getElementById('productError').classList.remove('show');
  PENDING_IMAGES = [null, null, null, null];
  [1, 2, 3, 4].forEach(slot => { document.getElementById('imagePreviewWrap' + slot).innerHTML = ''; });

  if (id) {
    const p = ADMIN_PRODUCTS.find(x => String(x.id) === String(id));
    document.getElementById('productModalTitle').textContent = 'Edit product';
    document.getElementById('prodId').value = p.id;
    document.getElementById('prodName').value = p.name;
    document.getElementById('prodDescription').value = p.description || '';
    document.getElementById('prodPrice').value = p.price;
    document.getElementById('prodStock').value = p.stock;
    document.getElementById('prodDiscount').value = p.discount || 0;
    document.getElementById('prodVideoUrl').value = p.videoUrl || '';
    document.getElementById('prodCategory').value = p.category || '';
    document.getElementById('prodActive').checked = !!p.active;

    const existingImages = [p.imageUrl, p.imageUrl2, p.imageUrl3, p.imageUrl4];
    existingImages.forEach((url, i) => {
      if (url) {
        PENDING_IMAGES[i] = { existingUrl: url };
        document.getElementById('imagePreviewWrap' + (i + 1)).innerHTML = `<img src="${escapeHtml(url)}">`;
      }
    });
  } else {
    document.getElementById('productModalTitle').textContent = 'Add product';
    document.getElementById('prodId').value = '';
    document.getElementById('prodDiscount').value = 0;
    document.getElementById('prodActive').checked = true;
  }

  openModal('productModal');
}

function handleImageSelect(e, slot) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    PENDING_IMAGES[slot - 1] = {
          base64: reader.result, mimeType: file.type, filename: file.name };
    document.getElementById('imagePreviewWrap' + slot).innerHTML = `<img src="${reader.result}">`;
  };
  reader.readAsDataURL(file);
}

async function saveProduct(e) {
  e.preventDefault();
  const btn = document.getElementById('saveProductBtn');
  const errorBox = document.getElementById('productError');
  errorBox.classList.remove('show');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const imageUrls = ['', '', '', ''];
    for (let i = 0; i < 4; i++) {
      const pending = PENDING_IMAGES[i];
      if (!pending) continue;
      if (pending.existingUrl) {
        imageUrls[i] = pending.existingUrl;
      } else if (pending.base64) {
        btn.textContent = `Uploading photo ${i + 1}…`;
        const uploadResult = await adminApi('uploadImage', {
          base64: pending.base64,
          mimeType: pending.mimeType,
          filename: pending.filename,
          folderType: 'product',
        });
        imageUrls[i] = uploadResult.url;
      }
    }

    btn.textContent = 'Saving…';
    const id = document.getElementById('prodId').value;
    const payload = { name: document.getElementById('prodName').value.trim(),
      description: document.getElementById('prodDescription').value.trim(),
      price: document.getElementById('prodPrice').value,
      stock: document.getElementById('prodStock').value,
      discount: document.getElementById('prodDiscount').value || 0,
      videoUrl: document.getElementById('prodVideoUrl').value.trim(),
      category: document.getElementById('prodCategory').value.trim(),
      active: document.getElementById('prodActive').checked,
      imageUrl: imageUrls[0],
      imageUrl2: imageUrls[1],
      imageUrl3: imageUrls[2],
      imageUrl4: imageUrls[3],
    };

    if (id) {
      payload.id = id;
      await adminApi('updateProduct', payload);
    } else {
      await adminApi('addProduct', payload);
    }

    closeModal('productModal');
    showToast('Product saved');
    loadProductsAdmin();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save product';
  }
}

async function deleteProduct(id) {
  if (!confirm('Delete this product? This cannot be undone.')) return;
  try {
    await adminApi('deleteProduct', { id });
    showToast('Product deleted');
    loadProductsAdmin();
  } catch (err) {
    showToast(err.message);
  }
}

/* ---------- Orders ---------- */
const ORDER_STATUSES = ['Pending', 'Confirmed', 'Out for delivery', 'Delivered', 'Cancelled'];
const LOCKED_STATUSES = ['Delivered', 'Cancelled'];

async function loadOrdersAdmin() {
  const wrap = document.getElementById('ordersListWrap');
  try {
    const data = await adminApi('getOrders');
    ADMIN_ORDERS = data.orders || [];
    ADMIN_ORDER_ITEMS_CACHE = {};
    refreshOrderStatusFilter();
    renderOrderStats();
    renderOrdersList();
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function refreshOrderStatusFilter() {
  const counts = {};
  ADMIN_ORDERS.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1; });
  fillSelect(document.getElementById('ordStatusFilter'),
    [{ value: '', label: `All statuses (${ADMIN_ORDERS.length})` }]
      .concat(ORDER_STATUSES.map(s => ({ value: s, label: `${s} (${counts[s] || 0})` }))),
    ORD_VIEW.status);
}

function renderOrderStats() {
  const total = ADMIN_ORDERS.length;
  const pending = ADMIN_ORDERS.filter(o => o.status === 'Pending').length;
  const live = ADMIN_ORDERS.filter(o => o.status !== 'Cancelled');
  const totalQty = live.reduce((s, o) => s + Number(o.totalQty || 0), 0);
  const revenue = live.reduce((s, o) => s + Number(o.totalAmount || 0), 0);

  document.getElementById('orderStats').innerHTML = `
    <span class="stat-pill">${total} orders</span>
    <span class="stat-pill">${pending} pending</span>
    <span class="stat-pill">${totalQty} items</span>
    <span class="stat-pill">${formatMoney(revenue)} total</span>
  `;
}

function orderDay(o) {
  const d = new Date(o.timestamp);
  if (isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; // local day
}

function filteredOrders() {
  const v = ORD_VIEW;
  const q = v.q.trim().toLowerCase();
  let rows = ADMIN_ORDERS.filter(o => {
    if (v.status && o.status !== v.status) return false;
    if (q) {
      const hay = [o.orderId, o.customerName, o.mobile, o.customerEmail, o.city, o.pincode, o.notes, o.remarks]
        .map(x => String(x || '').toLowerCase()).join(' | ');
      if (!hay.includes(q)) return false;
    }
    const day = orderDay(o);
    if (v.from && (!day || day < v.from)) return false;
    if (v.to && (!day || day > v.to)) return false;
    return true;
  });

  const t = o => new Date(o.timestamp).getTime() || 0;
  const sorters = {
    newest: (a, b) => t(b) - t(a),
    oldest: (a, b) => t(a) - t(b),
    amountDesc: (a, b) => Number(b.totalAmount) - Number(a.totalAmount),
    amountAsc: (a, b) => Number(a.totalAmount) - Number(b.totalAmount),
    qtyDesc: (a, b) => Number(b.totalQty) - Number(a.totalQty),
    customer: (a, b) => String(a.customerName || '').localeCompare(String(b.customerName || ''), undefined, { sensitivity: 'base' }),
  };
  return rows.sort(sorters[v.sort] || sorters.newest);
}

function wasEdited(o) {
  return o.originalAmount !== '' && o.originalAmount !== undefined && Number(o.originalAmount) !== Number(o.totalAmount);
}

function renderOrdersList() {
  const wrap = document.getElementById('ordersListWrap');
  const countEl = document.getElementById('ordCount');

  if (ADMIN_ORDERS.length === 0) {
    wrap.innerHTML = '<div class="empty-state">No orders yet.</div>';
    countEl.textContent = '';
    document.getElementById('ordPager').innerHTML = '';
    return;
  }

  const rows = filteredOrders();
  const pages = Math.max(1, Math.ceil(rows.length / ORD_VIEW.size));
  if (ORD_VIEW.page > pages) ORD_VIEW.page = pages;
  const pageRows = rows.slice((ORD_VIEW.page - 1) * ORD_VIEW.size, ORD_VIEW.page * ORD_VIEW.size);
  countEl.textContent = `Showing ${rows.length} of ${ADMIN_ORDERS.length}`;

  if (rows.length === 0) {
    wrap.innerHTML = '<div class="empty-state">No orders match these filters.</div>';
    document.getElementById('ordPager').innerHTML = '';
    return;
  }

  wrap.innerHTML = pageRows.map(o => `
    <div class="order-collapsible ${OPEN_ORDERS.has(String(o.orderId)) ? 'open' : ''}" data-order-id="${escapeHtml(o.orderId)}">
      <button class="order-summary-row" data-toggle-admin-order="${escapeHtml(o.orderId)}">
        <span class="order-summary-id">#${escapeHtml(o.orderId)}</span>
        <span class="order-summary-date">${formatDate(o.timestamp)}</span>
        <span class="order-summary-customer">${escapeHtml(o.customerName)} · ${escapeHtml(o.mobile)}</span>
        <span class="order-summary-count">${escapeHtml(o.itemCount)} product(s) · Qty ${escapeHtml(o.totalQty)}${wasEdited(o) ? ' <em class="edited-tag">edited</em>' : ''}${o.remarks ? ' <em class="edited-tag note-tag">remark</em>' : ''}</span>
        <span class="status-chip ${escapeHtml(String(o.status || '').replace(/\s/g, ''))}">${escapeHtml(o.status)}</span>
        <span class="order-summary-total">${formatMoney(o.totalAmount)}</span>
        <span class="order-caret">&#9662;</span>
      </button>
      <div class="order-items-panel" id="admin-order-items-${escapeHtml(o.orderId)}"></div>
    </div>
  `).join('');

  wrap.querySelectorAll('[data-toggle-admin-order]').forEach(btn => {
    btn.addEventListener('click', () => toggleAdminOrderItems(btn.dataset.toggleAdminOrder));
  });

  // re-open panels that were open before a re-render
  pageRows.forEach(o => {
    const id = String(o.orderId);
    if (OPEN_ORDERS.has(id)) openOrderPanel(id);
  });

  renderPager(document.getElementById('ordPager'), rows.length, ORD_VIEW.page, ORD_VIEW.size, (pg) => {
    ORD_VIEW.page = pg;
    renderOrdersList();
    document.getElementById('tab-orders').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function bindOrderTools() {
  const rerender = () => { ORD_VIEW.page = 1; renderOrdersList(); };
  document.getElementById('ordSearch').addEventListener('input', debounce((e) => { ORD_VIEW.q = e.target.value; rerender(); }, 200));
  document.getElementById('ordStatusFilter').addEventListener('change', (e) => { ORD_VIEW.status = e.target.value; rerender(); });
  document.getElementById('ordFrom').addEventListener('change', (e) => { ORD_VIEW.from = e.target.value; rerender(); });
  document.getElementById('ordTo').addEventListener('change', (e) => { ORD_VIEW.to = e.target.value; rerender(); });
  document.getElementById('ordSort').addEventListener('change', (e) => { ORD_VIEW.sort = e.target.value; rerender(); });
  document.getElementById('ordClearBtn').addEventListener('click', () => {
    Object.assign(ORD_VIEW, { q: '', status: '', from: '', to: '', sort: 'newest', page: 1 });
    ['ordSearch', 'ordStatusFilter', 'ordFrom', 'ordTo'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('ordSort').value = 'newest';
    renderOrdersList();
  });
  document.getElementById('ordCsvBtn').addEventListener('click', exportOrdersCsv);
}

function exportOrdersCsv() {
  const rows = filteredOrders();
  if (!rows.length) { showToast('Nothing to export'); return; }
  const cols = ['orderId', 'timestamp', 'customerName', 'customerEmail', 'mobile', 'address', 'city', 'pincode', 'itemCount', 'totalQty', 'deliveryCharge', 'totalAmount', 'originalAmount', 'status', 'notes', 'remarks'];
  const esc = v => {
    let s = String(v === undefined || v === null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = [cols.join(',')].concat(rows.map(o => cols.map(c => esc(o[c])).join(','))).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'orders-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function toggleAdminOrderItems(orderId) {
  const id = String(orderId);
  if (OPEN_ORDERS.has(id)) {
    OPEN_ORDERS.delete(id);
    const row = document.querySelector(`.order-collapsible[data-order-id="${CSS.escape(id)}"]`);
    if (row) row.classList.remove('open');
    return;
  }
  OPEN_ORDERS.add(id);
  openOrderPanel(id);
}

async function openOrderPanel(orderId) {
  const row = document.querySelector(`.order-collapsible[data-order-id="${CSS.escape(orderId)}"]`);
  const panel = document.getElementById(`admin-order-items-${orderId}`);
  if (!row || !panel) return;
  row.classList.add('open');

  if (!ADMIN_ORDER_ITEMS_CACHE[orderId]) {
    panel.innerHTML = '<div class="loading-state">Loading items…</div>';
    try {
      ADMIN_ORDER_ITEMS_CACHE[orderId] = await adminApi('getOrderItems', { orderId });
    } catch (err) {
      panel.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
      return;
    }
  }
  renderAdminOrderPanel(orderId, panel);
}

function renderAdminOrderPanel(orderId, panel) {
  const { order, items } = ADMIN_ORDER_ITEMS_CACHE[orderId];
  const locked = LOCKED_STATUSES.includes(order.status);

  const rows = items.map(i => {
    const ordered = Number(i.originalQty !== '' && i.originalQty !== undefined ? i.originalQty : i.qty);
    const reduced = Number(i.qty) < ordered;
    const qtyCell = locked
      ? `<span class="${reduced ? 'qty-reduced' : ''}">${escapeHtml(i.qty)}</span>`
      : `<input type="number" class="qty-input" min="0" max="${ordered}" step="1" value="${escapeHtml(i.qty)}" data-pid="${escapeHtml(i.productId)}" data-max="${ordered}" data-orig="${escapeHtml(i.qty)}" aria-label="Quantity for ${escapeHtml(i.productName)}">`;
    return `
    <tr>
      <td>${escapeHtml(i.productName)}</td>
      <td class="num">${ordered}</td>
      <td class="num">${qtyCell}</td>
      <td class="num">${formatMoney(i.price)}</td>
      <td class="num">${formatMoney(i.amount)}</td>
    </tr>`;
  }).join('');

  const deliveryLine = Number(order.deliveryCharge) > 0
    ? `Delivery charge applied: ${formatMoney(order.deliveryCharge)}`
    : 'Delivery charge: Free';
  const edited = wasEdited(order);

  panel.innerHTML = `
    <div class="order-admin-address">
      ${escapeHtml(order.address)}, ${escapeHtml(order.city)} - ${escapeHtml(order.pincode)}${order.landmark ? ' · Landmark: ' + escapeHtml(order.landmark) : ''}
      ${order.customerEmail ? '<br>✉ ' + escapeHtml(order.customerEmail) : ''}
      ${order.notes ? '<br><strong>Customer note:</strong> ' + escapeHtml(order.notes) : ''}
    </div>
    <table class="order-items-table">
      <thead><tr><th>Product</th><th class="num">Ordered</th><th class="num">Deliver</th><th class="num">Price</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${locked
      ? `<div class="field-hint">This order is ${escapeHtml(order.status)}, so quantities can no longer be changed.</div>`
      : `<div class="qty-edit-row">
           <button class="icon-btn" data-save-qty="${escapeHtml(orderId)}">Save quantities</button>
           <span class="field-hint">You can only reduce a quantity (never above what was ordered). Reduced units go back into stock automatically. Delivery charge stays as it was.</span>
         </div>`}
    <div class="order-items-footer">
      <span>${deliveryLine}</span>
      <strong>${edited ? `<s class="was-total">${formatMoney(order.originalAmount)}</s> ` : ''}Total: ${formatMoney(order.totalAmount)}</strong>
    </div>

    <div class="remarks-box">
      <label for="remarks-${escapeHtml(orderId)}">Remarks for the customer <span class="field-hint">(shown in their My Account and printed on the bill)</span></label>
      <textarea id="remarks-${escapeHtml(orderId)}" rows="2" maxlength="1000" placeholder="e.g. Only 5 of 10 were available; the rest was removed from your bill.">${escapeHtml(order.remarks || '')}</textarea>
      <button class="icon-btn" data-save-remarks="${escapeHtml(orderId)}">Save remarks</button>
    </div>

    <div class="order-admin-actions">
      <select class="status-select ${escapeHtml((order.status || '').replace(/\s/g, ''))}" data-status="${escapeHtml(orderId)}">
        ${ORDER_STATUSES.map(s => `<option value="${s}" ${order.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <button class="icon-btn" data-generate-bill="${escapeHtml(orderId)}">Generate bill</button>
    </div>
  `;

  panel.querySelector('[data-status]').addEventListener('change', (e) => updateOrderStatus(orderId, e.target.value));
  panel.querySelector('[data-generate-bill]').addEventListener('click', () => generateBill(orderId));
  panel.querySelector('[data-save-remarks]').addEventListener('click', (e) => saveRemarks(orderId, e.target));
  const saveQty = panel.querySelector('[data-save-qty]');
  if (saveQty) saveQty.addEventListener('click', (e) => saveQuantities(orderId, panel, e.target));
}

function formatDate(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// keep the list row and the loaded panel in sync with what the server returned
function applyOrderUpdate(orderId, orderFields, items) {
  const idx = ADMIN_ORDERS.findIndex(o => String(o.orderId) === String(orderId));
  if (idx >= 0 && orderFields) Object.assign(ADMIN_ORDERS[idx], orderFields);
  const cached = ADMIN_ORDER_ITEMS_CACHE[orderId];
  if (cached) {
    if (orderFields) cached.order = Object.assign({}, cached.order, orderFields);
    if (items) cached.items = items;
  }
}

async function updateOrderStatus(orderId, status) {
  try {
    await adminApi('updateOrderStatus', { orderId, status });
    applyOrderUpdate(orderId, { status });
    showToast('Order status updated');
    refreshOrderStatusFilter();
    renderOrderStats();
    renderOrdersList();
    loadProductsAdmin(); // cancel / un-cancel moves stock
  } catch (err) {
    showToast(err.message);
    renderOrdersList(); // put the dropdown back to the real status
  }
}

async function saveQuantities(orderId, panel, btn) {
  const inputs = [...panel.querySelectorAll('.qty-input')];
  const changes = [];
  for (const inp of inputs) {
    const raw = inp.value.trim();
    const qty = Number(raw);
    const max = Number(inp.dataset.max);
    if (raw === '' || !Number.isInteger(qty) || qty < 0) { showToast('Quantities must be whole numbers (0 or more)'); inp.focus(); return; }
    if (qty > max) { showToast(`Quantity cannot be more than the ${max} the customer ordered`); inp.focus(); return; }
    changes.push({ productId: inp.dataset.pid, qty });
  }
  if (changes.every(c => c.qty === 0)) {
    showToast('All quantities are 0 — set the status to Cancelled instead');
    return;
  }
  const changedCount = inputs.filter(i => Number(i.value) !== Number(i.dataset.orig)).length;
  if (!changedCount) { showToast('No quantities changed'); return; }
  if (!confirm('Update this order? The reduced units will be added back to stock and the total will be recalculated.')) return;

  btn.disabled = true;
  try {
    const res = await adminApi('editOrderItems', { orderId, items: changes });
    if (res.changed) {
      applyOrderUpdate(orderId, res.order, res.items);
      showToast('Order updated and stock adjusted');
      renderOrderStats();
      renderOrdersList();
      loadProductsAdmin();
    } else {
      showToast('No changes to save');
    }
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function saveRemarks(orderId, btn) {
  const box = document.getElementById('remarks-' + orderId);
  btn.disabled = true;
  try {
    const res = await adminApi('updateOrderRemarks', { orderId, remarks: box.value });
    applyOrderUpdate(orderId, { remarks: res.remarks });
    showToast(res.remarks ? 'Remarks saved' : 'Remarks cleared');
    // refresh just the summary tags; keep the typed text intact
    const idx = ADMIN_ORDERS.findIndex(o => String(o.orderId) === String(orderId));
    if (idx >= 0) renderOrdersList();
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Printable bill ---------- */
function generateBill(orderId) {
  const cached = ADMIN_ORDER_ITEMS_CACHE[orderId];
  if (!cached) return;
  const { order, items } = cached;

  const rows = items.map(i => {
    const ordered = Number(i.originalQty !== '' && i.originalQty !== undefined ? i.originalQty : i.qty);
    const qty = Number(i.qty);
    const unavailable = qty === 0 && ordered > 0;
    const qtyText = qty < ordered ? `${qty} <span class="bill-sub">(ordered ${ordered})</span>` : String(qty);
    return `
    <tr ${unavailable ? 'class="bill-unavailable"' : ''}>
      <td>${escapeHtml(i.productName)}${unavailable ? ' <span class="bill-sub">— not available</span>' : ''}</td>
      <td class="num">${qtyText}</td>
      <td class="num">${formatMoney(i.price)}</td>
      <td class="num">${formatMoney(i.amount)}</td>
    </tr>`;
  }).join('');

  const itemsSubtotal = items.reduce((s, i) => s + Number(i.amount || 0), 0);
  const edited = wasEdited(order);

  document.getElementById('billContent').innerHTML = `
    <div class="bill-header">
      <img class="bill-logo" src="assets/img/logo.png" alt="">
      <div class="bill-order-id">Invoice — #${escapeHtml(order.orderId)}</div>
      <div class="bill-date">${escapeHtml(formatDate(order.timestamp))}</div>
    </div>
    <div class="bill-customer">
      <strong>${escapeHtml(order.customerName)}</strong><br>
      ${escapeHtml(order.mobile)}<br>
      ${escapeHtml(order.address)}, ${escapeHtml(order.city)} - ${escapeHtml(order.pincode)}
      ${order.landmark ? '<br>Landmark: ' + escapeHtml(order.landmark) : ''}
    </div>
    <table class="bill-table">
      <thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="bill-totals">
      <div class="bill-total-row"><span>Subtotal</span><span>${formatMoney(itemsSubtotal)}</span></div>
      <div class="bill-total-row"><span>Delivery</span><span>${Number(order.deliveryCharge) > 0 ? formatMoney(order.deliveryCharge) : 'Free'}</span></div>
      ${edited ? `<div class="bill-total-row bill-sub"><span>Original order total</span><span><s>${formatMoney(order.originalAmount)}</s></span></div>` : ''}
      <div class="bill-total-row bill-grand"><span>Total (Pay on delivery)</span><span>${formatMoney(order.totalAmount)}</span></div>
    </div>
    ${order.remarks ? `<div class="bill-remarks"><strong>Remarks:</strong> ${escapeHtml(order.remarks)}</div>` : ''}
    <div class="bill-footer">Thank you for shopping with ${escapeHtml(typeof CONFIG !== 'undefined' && CONFIG.SITE_NAME ? CONFIG.SITE_NAME : 'us')}!</div>
  `;
  openModal('billModal');
}

/* ---------- Settings (delivery + admin session length) ---------- */
async function loadSettingsAdmin() {
  try {
    const data = await adminApi('getAdminSettings');
    const s = data.settings || {};
    document.getElementById('deliveryCharge').value = s.deliveryCharge;
    document.getElementById('freeDeliveryThreshold').value = s.freeDeliveryThreshold;
    document.getElementById('sessionHours').value = s.sessionHours || 12;
  } catch (err) {
    showToast(err.message);
  }
}

function bindSettingsForm() {
  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveSettingsBtn');
    const errorBox = document.getElementById('settingsError');
    errorBox.classList.remove('show');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await adminApi('updateSettings', {
        deliveryCharge: document.getElementById('deliveryCharge').value,
        freeDeliveryThreshold: document.getElementById('freeDeliveryThreshold').value,
        sessionHours: document.getElementById('sessionHours').value,
      });
      showToast('Settings saved');
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save settings';
    }
  });
}


/* ---------- Gallery ---------- */
async function loadGalleryAdmin() {
  const wrap = document.getElementById('galleryAdminWrap');
  try {
    const data = await adminApi('getGallery', {});
    ADMIN_GALLERY = data.images || [];
    renderGalleryAdmin();
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderGalleryAdmin() {
  const wrap = document.getElementById('galleryAdminWrap');
  if (ADMIN_GALLERY.length === 0) {
    wrap.innerHTML = '<div class="empty-state">No gallery photos yet.</div>';
    return;
  }
  wrap.innerHTML = `
    <div class="media-admin-grid">
      ${ADMIN_GALLERY.map(img => `
        <div class="media-admin-item">
          <img src="${escapeHtml(img.imageUrl)}">
          <div class="media-admin-caption">${escapeHtml(img.caption || '')}</div>
          <div class="media-admin-actions">
            <button class="icon-btn danger" data-gallery-delete="${escapeHtml(img.id)}">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  wrap.querySelectorAll('[data-gallery-delete]').forEach(b =>
    b.addEventListener('click', () => deleteGalleryImage(b.dataset.galleryDelete)));
}

function bindGalleryModal() {
  document.getElementById('newGalleryBtn').addEventListener('click', () => {
    document.getElementById('galleryForm').reset();
    document.getElementById('galleryError').classList.remove('show');
    document.getElementById('galleryPreviewWrap').innerHTML = '';
    PENDING_GALLERY_IMAGE = null;
    openModal('galleryModal');
  });

  document.getElementById('galleryModalClose').addEventListener('click', () => closeModal('galleryModal'));

  document.getElementById('galleryImage').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      PENDING_GALLERY_IMAGE = {
          base64: reader.result, mimeType: file.type, filename: file.name };
      document.getElementById('galleryPreviewWrap').innerHTML = `<img src="${reader.result}" style="width:90px;height:90px;object-fit:cover;border-radius:8px;margin-top:10px;">`;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('galleryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveGalleryBtn');
    const errorBox = document.getElementById('galleryError');
    errorBox.classList.remove('show');

    if (!PENDING_GALLERY_IMAGE) {
      errorBox.textContent = 'Please choose a photo';
      errorBox.classList.add('show');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Uploading…';
    try {
      const uploadResult = await adminApi('uploadImage', {
          base64: PENDING_GALLERY_IMAGE.base64,
        mimeType: PENDING_GALLERY_IMAGE.mimeType,
        filename: PENDING_GALLERY_IMAGE.filename,
        folderType: 'gallery',
      });
      await adminApi('addGalleryImage', {
          imageUrl: uploadResult.url,
        caption: document.getElementById('galleryCaption').value.trim(),
      });
      closeModal('galleryModal');
      showToast('Photo added to gallery');
      loadGalleryAdmin();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add photo';
    }
  });
}

async function deleteGalleryImage(id) {
  if (!confirm('Delete this gallery photo?')) return;
  try {
    await adminApi('deleteGalleryImage', { id });
    showToast('Photo deleted');
    loadGalleryAdmin();
  } catch (err) {
    showToast(err.message);
  }
}

/* ---------- Banners ---------- */
async function loadBannersAdmin() {
  const wrap = document.getElementById('bannerAdminWrap');
  try {
    const data = await adminApi('getAdminBanners', {});
    ADMIN_BANNERS = data.banners || [];
    renderBannersAdmin();
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderBannersAdmin() {
  const wrap = document.getElementById('bannerAdminWrap');
  if (ADMIN_BANNERS.length === 0) {
    wrap.innerHTML = '<div class="empty-state">No banners yet.</div>';
    return;
  }
  wrap.innerHTML = `
    <div class="media-admin-grid">
      ${ADMIN_BANNERS.map(b => `
        <div class="media-admin-item banner-admin-item">
          <img src="${escapeHtml(b.imageUrl)}">
          <div class="media-admin-caption">${b.linkUrl ? escapeHtml(b.linkUrl) : 'No link'} · <span class="badge ${b.active ? 'active' : 'inactive'}">${b.active ? 'Live' : 'Hidden'}</span></div>
          <div class="media-admin-actions">
            <button class="icon-btn" data-banner-toggle="${escapeHtml(b.id)}" data-active="${b.active ? 'true' : 'false'}">${b.active ? 'Hide' : 'Show'}</button>
            <button class="icon-btn danger" data-banner-delete="${escapeHtml(b.id)}">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  wrap.querySelectorAll('[data-banner-delete]').forEach(b =>
    b.addEventListener('click', () => deleteBanner(b.dataset.bannerDelete)));
  wrap.querySelectorAll('[data-banner-toggle]').forEach(b =>
    b.addEventListener('click', () => toggleBanner(b.dataset.bannerToggle, b.dataset.active !== 'true')));
}

function bindBannerModal() {
  document.getElementById('newBannerBtn').addEventListener('click', () => {
    document.getElementById('bannerForm').reset();
    document.getElementById('bannerError').classList.remove('show');
    document.getElementById('bannerPreviewWrap').innerHTML = '';
    PENDING_BANNER_IMAGE = null;
    openModal('bannerModal');
  });

  document.getElementById('bannerModalClose').addEventListener('click', () => closeModal('bannerModal'));

  document.getElementById('bannerImage').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      PENDING_BANNER_IMAGE = {
          base64: reader.result, mimeType: file.type, filename: file.name };
      document.getElementById('bannerPreviewWrap').innerHTML = `<img src="${reader.result}" style="width:100%;max-width:260px;aspect-ratio:16/6;object-fit:cover;border-radius:8px;margin-top:10px;">`;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('bannerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveBannerBtn');
    const errorBox = document.getElementById('bannerError');
    errorBox.classList.remove('show');

    if (!PENDING_BANNER_IMAGE) {
      errorBox.textContent = 'Please choose a banner image';
      errorBox.classList.add('show');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Uploading…';
    try {
      const uploadResult = await adminApi('uploadImage', {
          base64: PENDING_BANNER_IMAGE.base64,
        mimeType: PENDING_BANNER_IMAGE.mimeType,
        filename: PENDING_BANNER_IMAGE.filename,
        folderType: 'banner',
      });
      await adminApi('addBanner', {
          imageUrl: uploadResult.url,
        linkUrl: document.getElementById('bannerLink').value.trim(),
      });
      closeModal('bannerModal');
      showToast('Banner added');
      loadBannersAdmin();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add banner';
    }
  });
}

async function deleteBanner(id) {
  if (!confirm('Delete this banner?')) return;
  try {
    await adminApi('deleteBanner', { id });
    showToast('Banner deleted');
    loadBannersAdmin();
  } catch (err) {
    showToast(err.message);
  }
}

async function toggleBanner(id, active) {
  try {
    await adminApi('toggleBannerActive', { id, active });
    showToast(active ? 'Banner is now live' : 'Banner hidden');
    loadBannersAdmin();
  } catch (err) {
    showToast(err.message);
  }
}

function bindBillModal() {
  document.getElementById('billModalClose').addEventListener('click', () => closeModal('billModal'));
  document.getElementById('printBillBtn').addEventListener('click', () => window.print());
}

/* ---------- Utilities ---------- */
function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let toastTimer;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

