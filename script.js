// ============================================================
// McDonald's Inventory System — client app
// Backend/database: Google Apps Script + Google Sheets (see config.js)
// Single admin account, login only.
// ============================================================

let SESSION = { token: null, user: null };
let CACHE = { categories: [], suppliers: [], inventory: [] };

// ===================== CORE API CALL =====================
// Content-Type: text/plain keeps this a CORS "simple request" (no preflight),
// since Apps Script Web Apps can't respond to an OPTIONS preflight call.
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
  setTimeout(() => { t.className = 'toast'; }, 3200);
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

// ===================== LOGIN =====================
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
    SESSION.token = res.token;
    SESSION.user = res.user;
    sessionStorage.setItem('mcdo_token', res.token);
    sessionStorage.setItem('mcdo_user', JSON.stringify(res.user));
    enterApp();
  } catch (err) {
    errBox.textContent = err.message || 'Login failed.';
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Log In';
  }
});

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
  document.getElementById('userInitial').textContent = SESSION.user.fullName.charAt(0).toUpperCase();
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

document.getElementById('changePwBtn').addEventListener('click', () => {
  openModal(`
    <h3>Change Password</h3>
    <form id="pwForm">
      <div class="field"><label>Current Password</label><input type="password" id="oldPw" required></div>
      <div class="field"><label>New Password</label><input type="password" id="newPw" required minlength="6"></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Update</button>
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

// ===================== INVENTORY (CRUD) =====================
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
    }).join('') : '<tr><td colspan="10" class="empty-msg">No inventory items yet. Click "+ Add Item" to get started.</td></tr>';

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

// ===================== STOCK MOVEMENTS =====================
async function loadMovements() {
  try {
    const rows = await apiCall('apiGetStockMovements', [SESSION.token]);
    const tbody = document.querySelector('#movementsTable tbody');
    tbody.innerHTML = rows.length ? rows.map(m => `<tr>
        <td>${m.itemName}</td><td><span class="badge ${m.type === 'IN' ? 'in' : 'out'}">${m.type}</span></td>
        <td>${m.quantity}</td><td>${m.reason || '-'}</td><td>${fmtDate(m.timestamp)}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="empty-msg">No stock movements recorded yet.</td></tr>';
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

// ===================== CATEGORIES =====================
async function loadCategories() {
  try {
    const cats = await apiCall('apiGetCategories', [SESSION.token]);
    CACHE.categories = cats;
    const grid = document.getElementById('categoriesGrid');
    grid.innerHTML = cats.length ? cats.map(c => `
      <div class="cat-card"><h4>${c.name}</h4><p>${c.description || 'No description'}</p>
      <button class="btn-sm danger" data-del="${c.id}">Delete</button></div>`).join('')
      : '<div class="empty-msg">No categories yet.</div>';
    grid.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteCategory(b.dataset.del)));
  } catch (err) { handleError(err); }
}
document.getElementById('addCategoryBtn').addEventListener('click', () => {
  openModal(`<h3>Add Category</h3>
    <form id="catForm">
      <div class="field"><label>Name</label><input type="text" id="c_name" required></div>
      <div class="field"><label>Description</label><input type="text" id="c_desc"></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Save</button>
      </div>
    </form>`);
  document.getElementById('catForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = { name: document.getElementById('c_name').value.trim(), description: document.getElementById('c_desc').value.trim() };
    try {
      await apiCall('apiAddCategory', [SESSION.token, payload]);
      showToast('Category added.', 'success');
      closeModal();
      loadCategories();
    } catch (err) { handleError(err); }
  });
});
async function deleteCategory(id) {
  if (!confirm('Delete this category?')) return;
  try {
    await apiCall('apiDeleteCategory', [SESSION.token, id]);
    showToast('Category deleted.', 'success');
    loadCategories();
  } catch (err) { handleError(err); }
}

// ===================== SUPPLIERS =====================
async function loadSuppliers() {
  try {
    const rows = await apiCall('apiGetSuppliers', [SESSION.token]);
    CACHE.suppliers = rows;
    const tbody = document.querySelector('#suppliersTable tbody');
    tbody.innerHTML = rows.length ? rows.map(s => `<tr>
        <td>${s.name}</td><td>${s.contactPerson || '-'}</td><td>${s.phone || '-'}</td>
        <td>${s.email || '-'}</td><td>${s.address || '-'}</td>
        <td><button class="btn-sm edit" data-edit="${s.id}">Edit</button><button class="btn-sm danger" data-del="${s.id}">Delete</button></td>
      </tr>`).join('') : '<tr><td colspan="6" class="empty-msg">No suppliers yet.</td></tr>';
    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditSupplier(b.dataset.edit)));
    tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteSupplier(b.dataset.del)));
  } catch (err) { handleError(err); }
}
function supplierFormHtml(s) {
  s = s || {};
  return `<h3>${s.id ? 'Edit Supplier' : 'Add Supplier'}</h3>
    <form id="supForm">
      <div class="field"><label>Name</label><input type="text" id="s_name" value="${s.name || ''}" required></div>
      <div class="field"><label>Contact Person</label><input type="text" id="s_contact" value="${s.contactPerson || ''}"></div>
      <div class="field"><label>Phone</label><input type="text" id="s_phone" value="${s.phone || ''}"></div>
      <div class="field"><label>Email</label><input type="email" id="s_email" value="${s.email || ''}"></div>
      <div class="field"><label>Address</label><input type="text" id="s_address" value="${s.address || ''}"></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Save</button>
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
    const action = existing ? 'apiUpdateSupplier' : 'apiAddSupplier';
    try {
      await apiCall(action, [SESSION.token, payload]);
      showToast('Supplier saved.', 'success');
      closeModal();
      loadSuppliers();
    } catch (err) { handleError(err); }
  });
}
async function deleteSupplier(id) {
  if (!confirm('Delete this supplier?')) return;
  try {
    await apiCall('apiDeleteSupplier', [SESSION.token, id]);
    showToast('Supplier deleted.', 'success');
    loadSuppliers();
  } catch (err) { handleError(err); }
}

// ===================== REPORTS =====================
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

// expose functions used via inline onclick= in modal HTML
window.closeModal = closeModal;

// ===================== INIT =====================
tryRestoreSession();
