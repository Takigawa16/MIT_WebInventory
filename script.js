// ============================================================
// McDonald's Inventory System — client app
// Backend/database: Google Apps Script + Google Sheets (see config.js)
// Security: login OTP, role-based access (admin / inventory_manager),
// OTP-gated config-change approvals with audit trail.
// ============================================================

let SESSION = { token: null, user: null };
let CACHE = { categories: [], suppliers: [], inventory: [] };
let PENDING_LOGIN = { tempToken: null };

// ===================== CORE API CALL =====================
async function apiCall(action, args) {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_YOUR') !== -1) {
    throw new Error('config.js is not set up yet — paste your Apps Script Web App URL in there.');
  }
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, args: args || [] })
  });
  if (!res.ok) throw new Error('Network error (' + res.status + '). Please try again.');
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.data;
}

// ===================== UTILITIES =====================
function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  setTimeout(() => { t.className = 'toast'; }, 3500);
}
function fmtMoney(n) {
  return '₱' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(v) {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleString();
}
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.getElementById('modalBox').innerHTML = '';
}
function openModal(html) {
  document.getElementById('modalBox').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('open');
}
function handleError(err) {
  console.error(err);
  showToast(err.message || 'Something went wrong.', 'error');
}
function isAdmin() { return SESSION.user && SESSION.user.role === 'admin'; }

// ===================== LOGIN (2-step: password, then OTP) =====================
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errBox = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  errBox.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Logging in...';

  try {
    const res = await apiCall('apiLogin', [username, password]);
    if (res.otpRequired) {
      PENDING_LOGIN.tempToken = res.tempToken;
      document.getElementById('loginForm').style.display = 'none';
      document.getElementById('otpForm').style.display = 'block';
      document.getElementById('loginModeHint').style.display = 'none';
      document.getElementById('otpMaskedEmail').textContent = res.maskedEmail;
      document.getElementById('authSubtitle').textContent = 'Verify it\'s really you';
    } else {
      startSession(res);
    }
  } catch (err) {
    errBox.textContent = err.message || 'Login failed.';
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Log In';
  }
});

document.getElementById('otpForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('otpCode').value.trim();
  const errBox = document.getElementById('otpError');
  const btn = document.getElementById('otpBtn');
  errBox.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Verifying...';

  try {
    const res = await apiCall('apiVerifyOtp', [PENDING_LOGIN.tempToken, code]);
    startSession(res);
  } catch (err) {
    errBox.textContent = err.message || 'Verification failed.';
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Verify & Log In';
  }
});

document.getElementById('resendOtpBtn').addEventListener('click', async () => {
  try {
    const res = await apiCall('apiResendOtp', [PENDING_LOGIN.tempToken]);
    document.getElementById('otpMaskedEmail').textContent = res.maskedEmail;
    showToast('A new code was sent.', 'success');
  } catch (err) { handleError(err); }
});

document.getElementById('backToLoginBtn').addEventListener('click', () => {
  PENDING_LOGIN.tempToken = null;
  document.getElementById('otpForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('loginModeHint').style.display = 'block';
  document.getElementById('authSubtitle').textContent = 'Store Inventory System';
  document.getElementById('otpCode').value = '';
  document.getElementById('otpError').style.display = 'none';
});

function startSession(res) {
  SESSION.token = res.token;
  SESSION.user = res.user;
  sessionStorage.setItem('mcdo_token', res.token);
  sessionStorage.setItem('mcdo_user', JSON.stringify(res.user));
  enterApp();
}

function tryRestoreSession() {
  const token = sessionStorage.getItem('mcdo_token');
  const user = sessionStorage.getItem('mcdo_user');
  if (token && user) {
    SESSION.token = token;
    SESSION.user = JSON.parse(user);
    enterApp();
  }
}

function enterApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  document.getElementById('userFullName').textContent = SESSION.user.fullName;
  document.getElementById('userRole').textContent = SESSION.user.role === 'admin' ? 'Administrator' : 'Inventory Manager';
  document.getElementById('userInitial').textContent = SESSION.user.fullName.charAt(0).toUpperCase();

  document.querySelectorAll('[data-role="admin"]').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });
  document.getElementById('categoriesNote').style.display = isAdmin() ? 'none' : 'block';
  document.getElementById('suppliersNote').style.display = isAdmin() ? 'none' : 'block';

  loadDashboard();
}

async function doLogout() {
  try { await apiCall('apiLogout', [SESSION.token]); } catch (e) { /* ignore */ }
  sessionStorage.removeItem('mcdo_token');
  sessionStorage.removeItem('mcdo_user');
  location.reload();
}
document.getElementById('logoutBtn').addEventListener('click', doLogout);
document.getElementById('logoutBtnMobile').addEventListener('click', doLogout);

// ===================== ACCOUNT & SECURITY (password + OTP email) =====================
document.getElementById('securityBtn').addEventListener('click', () => {
  openModal(`
    <h3>Account &amp; Security</h3>
    <form id="pwForm">
      <div class="field"><label>Current Password</label><input type="password" id="oldPw" required></div>
      <div class="field"><label>New Password</label><input type="password" id="newPw" required minlength="10"
        placeholder="10+ chars, upper/lower/number/symbol"></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Update Password</button>
      </div>
    </form>
    <hr style="margin:20px 0;border:none;border-top:1px solid var(--border);">
    <form id="emailForm">
      <div class="field">
        <label>Security Email (for login &amp; approval OTP codes)</label>
        <input type="email" id="secEmail" placeholder="you@example.com">
      </div>
      <p style="font-size:12px;color:var(--muted);margin:-8px 0 14px;">
        Leave blank to disable OTP and log in with just a password. Setting an email here enables 2-factor login.
      </p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Save Email</button>
      </div>
    </form>`);
  document.getElementById('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPw = document.getElementById('oldPw').value;
    const newPw = document.getElementById('newPw').value;
    try {
      await apiCall('apiChangePassword', [SESSION.token, oldPw, newPw]);
      showToast('Password updated successfully.', 'success');
      closeModal();
    } catch (err) { handleError(err); }
  });
  document.getElementById('emailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('secEmail').value.trim();
    try {
      await apiCall('apiSetSecurityEmail', [SESSION.token, email]);
      showToast(email ? 'Security email saved. OTP login is now active.' : 'Security email removed. OTP login disabled.', 'success');
      closeModal();
    } catch (err) { handleError(err); }
  });
});

// ===================== NAVIGATION =====================
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const page = link.dataset.page;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    closeSidebar();
    loadPage(page);
  });
});
function loadPage(page) {
  if (page === 'dashboard') loadDashboard();
  else if (page === 'inventory') loadInventory();
  else if (page === 'movements') loadMovements();
  else if (page === 'categories') loadCategories();
  else if (page === 'suppliers') loadSuppliers();
  else if (page === 'reports') loadReports();
  else if (page === 'approvals') loadApprovals();
  else if (page === 'users') { loadUsers(); loadLogs(); loadAuditLog(); }
}
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('sidebarOverlay');
document.getElementById('hamburgerBtn').addEventListener('click', () => { sidebar.classList.add('open'); overlay.classList.add('open'); });
overlay.addEventListener('click', closeSidebar);
function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('open'); }

// ===================== DASHBOARD =====================
async function loadDashboard() {
  try {
    const d = await apiCall('apiGetDashboardStats', [SESSION.token]);
    document.getElementById('statTotalItems').textContent = d.totalItems;
    document.getElementById('statLowStock').textContent = d.lowStockCount;
    document.getElementById('statValue').textContent = fmtMoney(d.totalValue);
    document.getElementById('statMovements').textContent = d.todaysMovementsCount;

    document.getElementById('lowStockList').innerHTML = d.lowStockItems.length
      ? d.lowStockItems.map(i => `<div class="list-row"><span>${i.name}</span><span class="badge low">${i.quantity} ${i.unit}</span></div>`).join('')
      : '<div class="empty-msg">No low stock items. Great job!</div>';

    document.getElementById('recentMovementsList').innerHTML = d.recentMovements.length
      ? d.recentMovements.map(m => `<div class="list-row"><span>${m.itemName} (${m.quantity})</span><span class="badge ${m.type === 'IN' ? 'in' : 'out'}">${m.type}</span></div>`).join('')
      : '<div class="empty-msg">No recent movements.</div>';
  } catch (err) { handleError(err); }
}

// ===================== INVENTORY (CRUD — both roles) =====================
async function loadInventory() {
  try {
    const items = await apiCall('apiGetInventory', [SESSION.token]);
    CACHE.inventory = items;
    const tbody = document.querySelector('#inventoryTable tbody');
    tbody.innerHTML = items.length ? items.map(i => {
      const low = Number(i.quantity) <= Number(i.reorderLevel);
      return `<tr>
        <td>${i.name}</td><td>${i.category}</td><td>${i.sku || '-'}</td>
        <td class="${low ? 'qty-low' : ''}">${i.quantity}</td><td>${i.unit}</td>
        <td>${i.reorderLevel}</td><td>${fmtMoney(i.unitPrice)}</td><td>${i.supplier || '-'}</td>
        <td>${fmtDate(i.lastUpdated)}</td>
        <td><button class="btn-sm edit" data-edit="${i.id}">Edit</button><button class="btn-sm danger" data-del="${i.id}">Delete</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="10" class="empty-msg">No inventory items yet.</td></tr>';

    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditItem(b.dataset.edit)));
    tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteItem(b.dataset.del)));
  } catch (err) { handleError(err); }
}

function categoryOptions(selected) {
  return CACHE.categories.map(c => `<option value="${c.name}" ${c.name === selected ? 'selected' : ''}>${c.name}</option>`).join('');
}
function supplierOptions(selected) {
  return '<option value="">- None -</option>' + CACHE.suppliers.map(s => `<option value="${s.name}" ${s.name === selected ? 'selected' : ''}>${s.name}</option>`).join('');
}
async function ensureLookupsLoaded() {
  [CACHE.categories, CACHE.suppliers] = await Promise.all([
    apiCall('apiGetCategories', [SESSION.token]),
    apiCall('apiGetSuppliers', [SESSION.token])
  ]);
}

function itemFormHtml(item) {
  item = item || {};
  return `<h3>${item.id ? 'Edit Item' : 'Add Inventory Item'}</h3>
    <form id="itemForm">
      <div class="field"><label>Item Name</label><input type="text" id="f_name" value="${item.name || ''}" required></div>
      <div class="field"><label>Category</label><select id="f_category">${categoryOptions(item.category)}</select></div>
      <div class="field"><label>SKU</label><input type="text" id="f_sku" value="${item.sku || ''}"></div>
      <div class="field"><label>Quantity</label><input type="number" id="f_qty" value="${item.quantity ?? 0}" min="0" required></div>
      <div class="field"><label>Unit (pcs, kg, box, liters)</label><input type="text" id="f_unit" value="${item.unit || 'pcs'}" required></div>
      <div class="field"><label>Reorder Level</label><input type="number" id="f_reorder" value="${item.reorderLevel ?? 10}" min="0" required></div>
      <div class="field"><label>Unit Price (₱)</label><input type="number" id="f_price" value="${item.unitPrice || 0}" min="0" step="0.01" required></div>
      <div class="field"><label>Supplier</label><select id="f_supplier">${supplierOptions(item.supplier)}</select></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Save</button>
      </div>
    </form>`;
}

document.getElementById('addItemBtn').addEventListener('click', async () => {
  try { await ensureLookupsLoaded(); openModal(itemFormHtml()); bindItemForm(null); }
  catch (err) { handleError(err); }
});
async function openEditItem(id) {
  const item = CACHE.inventory.find(i => i.id === id);
  try { await ensureLookupsLoaded(); openModal(itemFormHtml(item)); bindItemForm(item); }
  catch (err) { handleError(err); }
}
function bindItemForm(existingItem) {
  document.getElementById('itemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      id: existingItem ? existingItem.id : undefined,
      name: document.getElementById('f_name').value.trim(),
      category: document.getElementById('f_category').value,
      sku: document.getElementById('f_sku').value.trim(),
      quantity: Number(document.getElementById('f_qty').value) || 0,
      unit: document.getElementById('f_unit').value.trim(),
      reorderLevel: Number(document.getElementById('f_reorder').value) || 0,
      unitPrice: Number(document.getElementById('f_price').value) || 0,
      supplier: document.getElementById('f_supplier').value
    };
    const action = existingItem ? 'apiUpdateInventoryItem' : 'apiAddInventoryItem';
    try {
      await apiCall(action, [SESSION.token, payload]);
      showToast('Item saved.', 'success');
      closeModal();
      loadInventory();
    } catch (err) { handleError(err); }
  });
}
async function deleteItem(id) {
  if (!confirm('Delete this inventory item? This cannot be undone.')) return;
  try {
    await apiCall('apiDeleteInventoryItem', [SESSION.token, id]);
    showToast('Item deleted.', 'success');
    loadInventory();
  } catch (err) { handleError(err); }
}

// ===================== STOCK MOVEMENTS (both roles) =====================
async function loadMovements() {
  try {
    const rows = await apiCall('apiGetStockMovements', [SESSION.token]);
    const tbody = document.querySelector('#movementsTable tbody');
    tbody.innerHTML = rows.length ? rows.map(m => `<tr>
        <td>${m.itemName}</td><td><span class="badge ${m.type === 'IN' ? 'in' : 'out'}">${m.type}</span></td>
        <td>${m.quantity}</td><td>${m.reason || '-'}</td><td>${m.user}</td><td>${fmtDate(m.timestamp)}</td>
      </tr>`).join('') : '<tr><td colspan="6" class="empty-msg">No stock movements recorded yet.</td></tr>';
  } catch (err) { handleError(err); }
}

document.getElementById('addMovementBtn').addEventListener('click', async () => {
  try {
    const items = await apiCall('apiGetInventory', [SESSION.token]);
    CACHE.inventory = items;
    const options = items.map(i => `<option value="${i.id}">${i.name} (current: ${i.quantity} ${i.unit})</option>`).join('');
    openModal(`<h3>Record Stock Movement</h3>
      <form id="movForm">
        <div class="field"><label>Item</label><select id="m_item" required>${options}</select></div>
        <div class="field"><label>Movement Type</label>
          <select id="m_type"><option value="IN">Stock In (received)</option><option value="OUT">Stock Out (used/sold/wastage)</option></select></div>
        <div class="field"><label>Quantity</label><input type="number" id="m_qty" min="1" required></div>
        <div class="field"><label>Reason / Notes</label><input type="text" id="m_reason" placeholder="e.g. Delivery, wastage, daily usage"></div>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn-primary">Save</button>
        </div>
      </form>`);

    document.getElementById('movForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const itemId = document.getElementById('m_item').value;
      const item = items.find(i => i.id === itemId);
      const payload = {
        itemId: itemId,
        type: document.getElementById('m_type').value,
        quantity: Number(document.getElementById('m_qty').value),
        reason: document.getElementById('m_reason').value.trim()
      };
      try {
        await apiCall('apiAddStockMovement', [SESSION.token, payload]);
        showToast(item.name + ' stock updated.', 'success');
        closeModal();
        loadMovements();
      } catch (err) { handleError(err); }
    });
  } catch (err) { handleError(err); }
});

// ===================== CATEGORIES (admin: direct — manager: request+OTP) =====================
async function loadCategories() {
  try {
    const cats = await apiCall('apiGetCategories', [SESSION.token]);
    CACHE.categories = cats;
    const grid = document.getElementById('categoriesGrid');
    grid.innerHTML = cats.length ? cats.map(c => `
      <div class="cat-card"><h4>${c.name}</h4><p>${c.description || 'No description'}</p>
      <button class="btn-sm danger" data-del="${c.id}">${isAdmin() ? 'Delete' : 'Request Delete'}</button></div>`).join('')
      : '<div class="empty-msg">No categories yet.</div>';
    grid.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteCategory(b.dataset.del)));
  } catch (err) { handleError(err); }
}
document.getElementById('addCategoryBtn').addEventListener('click', () => {
  openModal(`<h3>${isAdmin() ? 'Add Category' : 'Request: Add Category'}</h3>
    <form id="catForm">
      <div class="field"><label>Name</label><input type="text" id="c_name" required></div>
      <div class="field"><label>Description</label><input type="text" id="c_desc"></div>
      ${isAdmin() ? '' : '<p style="font-size:12px;color:var(--muted);">This will be sent to an administrator for OTP approval before it takes effect.</p>'}
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">${isAdmin() ? 'Save' : 'Submit Request'}</button>
      </div>
    </form>`);
  document.getElementById('catForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = { name: document.getElementById('c_name').value.trim(), description: document.getElementById('c_desc').value.trim() };
    try {
      if (isAdmin()) {
        await apiCall('apiAddCategory', [SESSION.token, payload]);
        showToast('Category added.', 'success');
      } else {
        await apiCall('apiRequestConfigChange', [SESSION.token, 'ADD_CATEGORY', payload]);
        showToast('Request submitted — sent to an admin for approval.', 'success');
      }
      closeModal();
      loadCategories();
    } catch (err) { handleError(err); }
  });
});
async function deleteCategory(id) {
  const cat = CACHE.categories.find(c => c.id === id);
  const msg = isAdmin() ? 'Delete this category?' : 'Request deletion of this category? An admin must approve it.';
  if (!confirm(msg)) return;
  try {
    if (isAdmin()) {
      await apiCall('apiDeleteCategory', [SESSION.token, id]);
      showToast('Category deleted.', 'success');
    } else {
      await apiCall('apiRequestConfigChange', [SESSION.token, 'DELETE_CATEGORY', { id: id, name: cat ? cat.name : id }]);
      showToast('Deletion request submitted for admin approval.', 'success');
    }
    loadCategories();
  } catch (err) { handleError(err); }
}

// ===================== SUPPLIERS (admin: direct — manager: request+OTP) =====================
async function loadSuppliers() {
  try {
    const rows = await apiCall('apiGetSuppliers', [SESSION.token]);
    CACHE.suppliers = rows;
    const tbody = document.querySelector('#suppliersTable tbody');
    tbody.innerHTML = rows.length ? rows.map(s => `<tr>
        <td>${s.name}</td><td>${s.contactPerson || '-'}</td><td>${s.phone || '-'}</td>
        <td>${s.email || '-'}</td><td>${s.address || '-'}</td>
        <td><button class="btn-sm edit" data-edit="${s.id}">${isAdmin() ? 'Edit' : 'Request Edit'}</button>
        <button class="btn-sm danger" data-del="${s.id}">${isAdmin() ? 'Delete' : 'Request Delete'}</button></td>
      </tr>`).join('') : '<tr><td colspan="6" class="empty-msg">No suppliers yet.</td></tr>';
    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditSupplier(b.dataset.edit)));
    tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteSupplier(b.dataset.del)));
  } catch (err) { handleError(err); }
}
function supplierFormHtml(s) {
  s = s || {};
  return `<h3>${s.id ? (isAdmin() ? 'Edit Supplier' : 'Request: Edit Supplier') : (isAdmin() ? 'Add Supplier' : 'Request: Add Supplier')}</h3>
    <form id="supForm">
      <div class="field"><label>Name</label><input type="text" id="s_name" value="${s.name || ''}" required></div>
      <div class="field"><label>Contact Person</label><input type="text" id="s_contact" value="${s.contactPerson || ''}"></div>
      <div class="field"><label>Phone</label><input type="text" id="s_phone" value="${s.phone || ''}"></div>
      <div class="field"><label>Email</label><input type="email" id="s_email" value="${s.email || ''}"></div>
      <div class="field"><label>Address</label><input type="text" id="s_address" value="${s.address || ''}"></div>
      ${isAdmin() ? '' : '<p style="font-size:12px;color:var(--muted);">This will be sent to an administrator for OTP approval before it takes effect.</p>'}
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">${isAdmin() ? 'Save' : 'Submit Request'}</button>
      </div>
    </form>`;
}
document.getElementById('addSupplierBtn').addEventListener('click', () => { openModal(supplierFormHtml()); bindSupplierForm(null); });
function openEditSupplier(id) {
  const s = CACHE.suppliers.find(x => x.id === id);
  openModal(supplierFormHtml(s));
  bindSupplierForm(s);
}
function bindSupplierForm(existing) {
  document.getElementById('supForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      id: existing ? existing.id : undefined,
      name: document.getElementById('s_name').value.trim(),
      contactPerson: document.getElementById('s_contact').value.trim(),
      phone: document.getElementById('s_phone').value.trim(),
      email: document.getElementById('s_email').value.trim(),
      address: document.getElementById('s_address').value.trim()
    };
    try {
      if (isAdmin()) {
        await apiCall(existing ? 'apiUpdateSupplier' : 'apiAddSupplier', [SESSION.token, payload]);
        showToast('Supplier saved.', 'success');
      } else {
        await apiCall('apiRequestConfigChange', [SESSION.token, existing ? 'UPDATE_SUPPLIER' : 'ADD_SUPPLIER', payload]);
        showToast('Request submitted — sent to an admin for approval.', 'success');
      }
      closeModal();
      loadSuppliers();
    } catch (err) { handleError(err); }
  });
}
async function deleteSupplier(id) {
  const sup = CACHE.suppliers.find(s => s.id === id);
  const msg = isAdmin() ? 'Delete this supplier?' : 'Request deletion of this supplier? An admin must approve it.';
  if (!confirm(msg)) return;
  try {
    if (isAdmin()) {
      await apiCall('apiDeleteSupplier', [SESSION.token, id]);
      showToast('Supplier deleted.', 'success');
    } else {
      await apiCall('apiRequestConfigChange', [SESSION.token, 'DELETE_SUPPLIER', { id: id, name: sup ? sup.name : id }]);
      showToast('Deletion request submitted for admin approval.', 'success');
    }
    loadSuppliers();
  } catch (err) { handleError(err); }
}

// ===================== REPORTS (both roles) =====================
async function loadReports() {
  try {
    const r = await apiCall('apiGetReports', [SESSION.token]);
    document.getElementById('reportLowStock').innerHTML = r.lowStock.length
      ? r.lowStock.map(i => `<div class="list-row"><span>${i.name}</span><span class="badge low">${i.quantity} ${i.unit}</span></div>`).join('')
      : '<div class="empty-msg">No low stock items.</div>';

    const cats = Object.keys(r.valueByCategory);
    document.getElementById('reportByCategory').innerHTML = cats.length
      ? cats.map(c => `<div class="list-row"><span>${c}</span><span>${fmtMoney(r.valueByCategory[c])}</span></div>`).join('')
      : '<div class="empty-msg">No data yet.</div>';

    document.getElementById('reportStockIn').textContent = r.stockIn30d;
    document.getElementById('reportStockOut').textContent = r.stockOut30d;
    document.getElementById('reportTotalValue').textContent = fmtMoney(r.totalInventoryValue);
  } catch (err) { handleError(err); }
}

// ===================== PENDING APPROVALS (admin only) =====================
async function loadApprovals() {
  if (!isAdmin()) return;
  try {
    const rows = await apiCall('apiGetPendingConfigChanges', [SESSION.token]);
    const list = document.getElementById('approvalsList');
    list.innerHTML = rows.length ? rows.map(r => `
      <div class="cat-card approval-card">
        <div class="approval-type">${r.type.replace(/_/g, ' ')}</div>
        <div class="approval-meta">Requested by ${r.requestedBy} · ${fmtDate(r.requestedAt)}</div>
        <div class="approval-payload">${escapeHtml(JSON.stringify(r.payload, null, 2))}</div>
        <div class="approval-actions">
          <button class="btn-primary" data-approve="${r.id}">Approve</button>
          <button class="btn-secondary" data-reject="${r.id}">Reject</button>
        </div>
      </div>`).join('') : '<div class="empty-msg">No pending requests.</div>';

    list.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => openApproveModal(b.dataset.approve)));
    list.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => rejectRequest(b.dataset.reject)));
  } catch (err) { handleError(err); }
}
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function openApproveModal(requestId) {
  openModal(`<h3>Approve Change</h3>
    <p style="font-size:13px;color:var(--muted);">Enter the OTP code that was emailed to your security address to confirm this change.</p>
    <form id="approveForm">
      <div class="field"><label>Approval Code</label><input type="text" id="approveOtp" inputmode="numeric" maxlength="6" class="otp-input" required></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Approve</button>
      </div>
    </form>`);
  document.getElementById('approveForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('approveOtp').value.trim();
    try {
      await apiCall('apiApproveConfigChange', [SESSION.token, requestId, code]);
      showToast('Change approved and applied.', 'success');
      closeModal();
      loadApprovals();
    } catch (err) { handleError(err); }
  });
}
async function rejectRequest(requestId) {
  const reason = prompt('Optional: reason for rejecting this request') || '';
  try {
    await apiCall('apiRejectConfigChange', [SESSION.token, requestId, reason]);
    showToast('Request rejected.', 'success');
    loadApprovals();
  } catch (err) { handleError(err); }
}

// ===================== USERS, LOGS & AUDIT (admin only) =====================
async function loadUsers() {
  if (!isAdmin()) return;
  try {
    const rows = await apiCall('apiGetUsers', [SESSION.token]);
    const tbody = document.querySelector('#usersTable tbody');
    tbody.innerHTML = rows.length ? rows.map(u => `<tr>
        <td>${u.username}</td><td>${u.fullName}</td><td>${u.role === 'admin' ? 'Admin' : 'Inventory Manager'}</td>
        <td>${u.status}</td><td>${fmtDate(u.lastLogin)}</td>
        <td><button class="btn-sm toggle" data-toggle="${u.id}">${u.status === 'active' ? 'Disable' : 'Enable'}</button>
        <button class="btn-sm edit" data-resetpw="${u.id}">Reset Pw</button></td>
      </tr>`).join('') : '<tr><td colspan="6" class="empty-msg">No users found.</td></tr>';
    tbody.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => toggleUser(b.dataset.toggle)));
    tbody.querySelectorAll('[data-resetpw]').forEach(b => b.addEventListener('click', () => resetUserPw(b.dataset.resetpw)));
  } catch (err) { handleError(err); }
}
async function loadLogs() {
  if (!isAdmin()) return;
  try {
    const rows = await apiCall('apiGetActivityLogs', [SESSION.token]);
    const tbody = document.querySelector('#logsTable tbody');
    tbody.innerHTML = rows.length ? rows.map(l => `<tr>
        <td>${l.user}</td><td>${l.action}</td><td>${l.details || '-'}</td><td>${fmtDate(l.timestamp)}</td>
      </tr>`).join('') : '<tr><td colspan="4" class="empty-msg">No activity logs yet.</td></tr>';
  } catch (err) { handleError(err); }
}
async function loadAuditLog() {
  if (!isAdmin()) return;
  try {
    const rows = await apiCall('apiGetConfigAuditLog', [SESSION.token]);
    const tbody = document.querySelector('#auditTable tbody');
    tbody.innerHTML = rows.length ? rows.map(a => `<tr>
        <td>${a.action}</td><td>${a.entity}</td>
        <td style="max-width:180px;white-space:normal;">${a.oldValue || '-'}</td>
        <td style="max-width:180px;white-space:normal;">${a.newValue || '-'}</td>
        <td>${a.requestedBy}</td><td>${a.approvedBy}</td><td>${fmtDate(a.timestamp)}</td>
      </tr>`).join('') : '<tr><td colspan="7" class="empty-msg">No configuration changes yet.</td></tr>';
  } catch (err) { handleError(err); }
}

document.getElementById('addUserBtn').addEventListener('click', () => {
  openModal(`<h3>Add User</h3>
    <form id="userForm">
      <div class="field"><label>Username</label><input type="text" id="u_username" required></div>
      <div class="field"><label>Full Name</label><input type="text" id="u_fullname" required></div>
      <div class="field"><label>Role</label>
        <select id="u_role"><option value="inventory_manager">Inventory Manager</option><option value="admin">Admin</option></select></div>
      <div class="field"><label>Temporary Password</label>
        <input type="password" id="u_password" required minlength="10" placeholder="10+ chars, upper/lower/number/symbol"></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Create</button>
      </div>
    </form>`);
  document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      username: document.getElementById('u_username').value.trim(),
      fullName: document.getElementById('u_fullname').value.trim(),
      role: document.getElementById('u_role').value,
      password: document.getElementById('u_password').value
    };
    try {
      await apiCall('apiAddUser', [SESSION.token, payload]);
      showToast('User created.', 'success');
      closeModal();
      loadUsers();
    } catch (err) { handleError(err); }
  });
});

async function toggleUser(id) {
  if (!confirm("Change this user's active status?")) return;
  try {
    await apiCall('apiToggleUserStatus', [SESSION.token, id]);
    showToast('User status updated.', 'success');
    loadUsers();
  } catch (err) { handleError(err); }
}

async function resetUserPw(id) {
  const newPw = prompt('Enter a new temporary password (10+ chars, upper/lower/number/symbol):');
  if (!newPw) return;
  try {
    await apiCall('apiResetUserPassword', [SESSION.token, id, newPw]);
    showToast('Password reset.', 'success');
  } catch (err) { handleError(err); }
}

// expose functions used via inline onclick= in modal HTML
window.closeModal = closeModal;

// ===================== INIT =====================
tryRestoreSession();
