// ============================================================
// McDonald's Inventory System — Firebase-backed client app
// ============================================================
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc,
  deleteDoc, setDoc, query, orderBy, serverTimestamp, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Fail loudly and clearly if firebase-config.js still has placeholder values,
// instead of letting Firebase throw a cryptic "invalid-api-key" error later.
if (!firebaseConfig.apiKey || firebaseConfig.apiKey === 'YOUR_API_KEY') {
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('loginScreen').innerHTML = `
      <div class="login-card">
        <div class="login-logo"><div class="arch">!</div><h1>Setup needed</h1></div>
        <p style="font-size:13.5px;color:#7a7a7a;line-height:1.6;">
          <code>firebase-config.js</code> still has placeholder values.
          Open Firebase Console &rarr; Project settings &rarr; General &rarr; Your apps,
          copy your web app's config object, and paste it into <code>firebase-config.js</code>.
          See <strong>README.md</strong> for step-by-step instructions.
        </p>
      </div>`;
  });
  throw new Error('firebase-config.js is not configured yet.');
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let CURRENT = { uid: null, email: null, fullName: '', role: 'staff' };
let CACHE = { categories: [], suppliers: [], inventory: [] };

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
function fmtDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return '-';
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
async function logActivity(action, details) {
  try {
    await addDoc(collection(db, 'activityLogs'), {
      user: CURRENT.email, action, details: details || '', timestamp: serverTimestamp()
    });
  } catch (e) { /* non-blocking */ }
}
function handleError(err) {
  console.error(err);
  showToast(friendlyAuthError(err), 'error');
}
function friendlyAuthError(err) {
  const code = err && err.code || '';
  const map = {
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/user-not-found': 'Invalid email or password.',
    'auth/wrong-password': 'Invalid email or password.',
    'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
    'auth/email-already-in-use': 'That email is already registered.',
    'auth/weak-password': 'Password must be at least 6 characters.'
  };
  return map[code] || (err && err.message) || 'Something went wrong.';
}

// ===================== LOGIN =====================
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errBox = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  errBox.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Logging in...';

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged will handle entering the app
  } catch (err) {
    errBox.textContent = friendlyAuthError(err);
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Log In';
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appShell').style.display = 'none';
    return;
  }
  // Load role/profile from Firestore "users" collection (doc id = uid)
  const profileSnap = await getDoc(doc(db, 'users', user.uid));
  if (!profileSnap.exists()) {
    showToast('No profile found for this account. Ask an administrator to set one up.', 'error');
    await signOut(auth);
    return;
  }
  const profile = profileSnap.data();
  if (profile.status === 'disabled') {
    showToast('This account has been disabled.', 'error');
    await signOut(auth);
    return;
  }
  CURRENT = { uid: user.uid, email: user.email, fullName: profile.fullName || user.email, role: profile.role || 'staff' };
  enterApp();
  logActivity('LOGIN', 'User logged in');
});

function enterApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  document.getElementById('userFullName').textContent = CURRENT.fullName;
  document.getElementById('userRole').textContent = CURRENT.role;
  document.getElementById('userInitial').textContent = CURRENT.fullName.charAt(0).toUpperCase();
  document.getElementById('navUsers').style.display = CURRENT.role === 'admin' ? '' : 'none';
  loadDashboard();
}

async function doLogout() {
  await logActivity('LOGOUT', 'User logged out');
  await signOut(auth);
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
      const cred = EmailAuthProvider.credential(CURRENT.email, oldPw);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, newPw);
      await logActivity('CHANGE_PASSWORD', 'Password updated');
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
  else if (page === 'users') { loadUsers(); loadLogs(); }
}
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('sidebarOverlay');
document.getElementById('hamburgerBtn').addEventListener('click', () => { sidebar.classList.add('open'); overlay.classList.add('open'); });
overlay.addEventListener('click', closeSidebar);
function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('open'); }

// ===================== FIRESTORE HELPERS =====================
async function fetchAll(colName, order) {
  const ref = collection(db, colName);
  const q = order ? query(ref, orderBy(order, 'desc')) : ref;
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ===================== DASHBOARD =====================
async function loadDashboard() {
  try {
    const [inventory, movements, suppliers, categories] = await Promise.all([
      fetchAll('inventory'), fetchAll('stockMovements', 'timestamp'), fetchAll('suppliers'), fetchAll('categories')
    ]);
    CACHE.inventory = inventory;
    const lowStock = inventory.filter(i => Number(i.quantity) <= Number(i.reorderLevel));
    const totalValue = inventory.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todaysMovements = movements.filter(m => m.timestamp && m.timestamp.toDate && m.timestamp.toDate() >= today);

    document.getElementById('statTotalItems').textContent = inventory.length;
    document.getElementById('statLowStock').textContent = lowStock.length;
    document.getElementById('statValue').textContent = fmtMoney(totalValue);
    document.getElementById('statMovements').textContent = todaysMovements.length;

    document.getElementById('lowStockList').innerHTML = lowStock.length
      ? lowStock.slice(0, 8).map(i => `<div class="list-row"><span>${i.name}</span><span class="badge low">${i.quantity} ${i.unit}</span></div>`).join('')
      : '<div class="empty-msg">No low stock items. Great job!</div>';

    document.getElementById('recentMovementsList').innerHTML = movements.length
      ? movements.slice(0, 6).map(m => `<div class="list-row"><span>${m.itemName} (${m.quantity})</span><span class="badge ${m.type === 'IN' ? 'in' : 'out'}">${m.type}</span></div>`).join('')
      : '<div class="empty-msg">No recent movements.</div>';
  } catch (err) { handleError(err); }
}

// ===================== INVENTORY =====================
async function loadInventory() {
  try {
    const items = await fetchAll('inventory');
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
  [CACHE.categories, CACHE.suppliers] = await Promise.all([fetchAll('categories'), fetchAll('suppliers')]);
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
  await ensureLookupsLoaded();
  openModal(itemFormHtml());
  bindItemForm(null);
});
async function openEditItem(id) {
  const item = CACHE.inventory.find(i => i.id === id);
  await ensureLookupsLoaded();
  openModal(itemFormHtml(item));
  bindItemForm(item);
}
function bindItemForm(existingItem) {
  document.getElementById('itemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('f_name').value.trim(),
      category: document.getElementById('f_category').value,
      sku: document.getElementById('f_sku').value.trim(),
      quantity: Number(document.getElementById('f_qty').value) || 0,
      unit: document.getElementById('f_unit').value.trim(),
      reorderLevel: Number(document.getElementById('f_reorder').value) || 0,
      unitPrice: Number(document.getElementById('f_price').value) || 0,
      supplier: document.getElementById('f_supplier').value,
      lastUpdated: serverTimestamp()
    };
    try {
      if (existingItem) {
        await updateDoc(doc(db, 'inventory', existingItem.id), payload);
      } else {
        await addDoc(collection(db, 'inventory'), payload);
      }
      await logActivity(existingItem ? 'UPDATE_ITEM' : 'ADD_ITEM', payload.name);
      showToast('Item saved.', 'success');
      closeModal();
      loadInventory();
    } catch (err) { handleError(err); }
  });
}
async function deleteItem(id) {
  if (!confirm('Delete this inventory item? This cannot be undone.')) return;
  try {
    const item = CACHE.inventory.find(i => i.id === id);
    await deleteDoc(doc(db, 'inventory', id));
    await logActivity('DELETE_ITEM', item ? item.name : id);
    showToast('Item deleted.', 'success');
    loadInventory();
  } catch (err) { handleError(err); }
}

// ===================== STOCK MOVEMENTS =====================
async function loadMovements() {
  try {
    const rows = await fetchAll('stockMovements', 'timestamp');
    const tbody = document.querySelector('#movementsTable tbody');
    tbody.innerHTML = rows.length ? rows.map(m => `<tr>
        <td>${m.itemName}</td><td><span class="badge ${m.type === 'IN' ? 'in' : 'out'}">${m.type}</span></td>
        <td>${m.quantity}</td><td>${m.reason || '-'}</td><td>${m.user}</td><td>${fmtDate(m.timestamp)}</td>
      </tr>`).join('') : '<tr><td colspan="6" class="empty-msg">No stock movements recorded yet.</td></tr>';
  } catch (err) { handleError(err); }
}

document.getElementById('addMovementBtn').addEventListener('click', async () => {
  const items = await fetchAll('inventory');
  CACHE.inventory = items;
  const options = items.map(i => `<option value="${i.id}">${i.name} (current: ${i.quantity} ${i.unit})</option>`).join('');
  openModal(`<h3>Record Stock Movement</h3>
    <form id="movForm">
      <div class="field"><label>Item</label><select id="m_item" required>${options}</select></div>
      <div class="field"><label>Movement Type</label>
        <select id="m_type"><option value="IN">Stock In (received)</option><option value="OUT">Stock Out (used/sold)</option></select></div>
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
    const type = document.getElementById('m_type').value;
    const qty = Number(document.getElementById('m_qty').value);
    const reason = document.getElementById('m_reason').value.trim();

    try {
      const currentQty = Number(item.quantity);
      const newQty = type === 'IN' ? currentQty + qty : currentQty - qty;
      if (newQty < 0) { showToast('Insufficient stock. Current quantity is ' + currentQty + '.', 'error'); return; }

      await updateDoc(doc(db, 'inventory', itemId), { quantity: newQty, lastUpdated: serverTimestamp() });
      await addDoc(collection(db, 'stockMovements'), {
        itemId, itemName: item.name, type, quantity: qty, reason, user: CURRENT.email, timestamp: serverTimestamp()
      });
      await logActivity('STOCK_' + type, `${item.name} qty ${qty}`);
      showToast(item.name + ' stock updated.', 'success');
      closeModal();
      loadMovements();
    } catch (err) { handleError(err); }
  });
});

// ===================== CATEGORIES =====================
async function loadCategories() {
  try {
    const cats = await fetchAll('categories');
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
    const name = document.getElementById('c_name').value.trim();
    const description = document.getElementById('c_desc').value.trim();
    try {
      await addDoc(collection(db, 'categories'), { name, description });
      await logActivity('ADD_CATEGORY', name);
      showToast('Category added.', 'success');
      closeModal();
      loadCategories();
    } catch (err) { handleError(err); }
  });
});
async function deleteCategory(id) {
  if (!confirm('Delete this category?')) return;
  try {
    await deleteDoc(doc(db, 'categories', id));
    await logActivity('DELETE_CATEGORY', id);
    showToast('Category deleted.', 'success');
    loadCategories();
  } catch (err) { handleError(err); }
}

// ===================== SUPPLIERS =====================
async function loadSuppliers() {
  try {
    const rows = await fetchAll('suppliers');
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
      name: document.getElementById('s_name').value.trim(),
      contactPerson: document.getElementById('s_contact').value.trim(),
      phone: document.getElementById('s_phone').value.trim(),
      email: document.getElementById('s_email').value.trim(),
      address: document.getElementById('s_address').value.trim()
    };
    try {
      if (existing) await updateDoc(doc(db, 'suppliers', existing.id), payload);
      else await addDoc(collection(db, 'suppliers'), payload);
      await logActivity(existing ? 'UPDATE_SUPPLIER' : 'ADD_SUPPLIER', payload.name);
      showToast('Supplier saved.', 'success');
      closeModal();
      loadSuppliers();
    } catch (err) { handleError(err); }
  });
}
async function deleteSupplier(id) {
  if (!confirm('Delete this supplier?')) return;
  try {
    await deleteDoc(doc(db, 'suppliers', id));
    await logActivity('DELETE_SUPPLIER', id);
    showToast('Supplier deleted.', 'success');
    loadSuppliers();
  } catch (err) { handleError(err); }
}

// ===================== REPORTS =====================
async function loadReports() {
  try {
    const [inventory, movements] = await Promise.all([fetchAll('inventory'), fetchAll('stockMovements', 'timestamp')]);
    const lowStock = inventory.filter(i => Number(i.quantity) <= Number(i.reorderLevel));
    const valueByCategory = {};
    inventory.forEach(i => { valueByCategory[i.category] = (valueByCategory[i.category] || 0) + Number(i.quantity) * Number(i.unitPrice); });

    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recent = movements.filter(m => m.timestamp && m.timestamp.toDate && m.timestamp.toDate() >= thirtyDaysAgo);
    const stockIn = recent.filter(m => m.type === 'IN').reduce((s, m) => s + Number(m.quantity), 0);
    const stockOut = recent.filter(m => m.type === 'OUT').reduce((s, m) => s + Number(m.quantity), 0);
    const totalValue = inventory.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0);

    document.getElementById('reportLowStock').innerHTML = lowStock.length
      ? lowStock.map(i => `<div class="list-row"><span>${i.name}</span><span class="badge low">${i.quantity} ${i.unit}</span></div>`).join('')
      : '<div class="empty-msg">No low stock items.</div>';

    const cats = Object.keys(valueByCategory);
    document.getElementById('reportByCategory').innerHTML = cats.length
      ? cats.map(c => `<div class="list-row"><span>${c}</span><span>${fmtMoney(valueByCategory[c])}</span></div>`).join('')
      : '<div class="empty-msg">No data yet.</div>';

    document.getElementById('reportStockIn').textContent = stockIn;
    document.getElementById('reportStockOut').textContent = stockOut;
    document.getElementById('reportTotalValue').textContent = fmtMoney(totalValue);
  } catch (err) { handleError(err); }
}

// ===================== USERS & LOGS (admin only) =====================
async function loadUsers() {
  if (CURRENT.role !== 'admin') return;
  try {
    const rows = await fetchAll('users');
    const tbody = document.querySelector('#usersTable tbody');
    tbody.innerHTML = rows.length ? rows.map(u => `<tr>
        <td>${u.email || '-'}</td><td>${u.fullName || '-'}</td><td>${u.role}</td><td>${u.status}</td>
        <td><button class="btn-sm toggle" data-toggle="${u.id}" data-status="${u.status}">${u.status === 'active' ? 'Disable' : 'Enable'}</button></td>
      </tr>`).join('') : '<tr><td colspan="5" class="empty-msg">No users found.</td></tr>';
    tbody.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => toggleUser(b.dataset.toggle, b.dataset.status)));
  } catch (err) { handleError(err); }
}
async function loadLogs() {
  if (CURRENT.role !== 'admin') return;
  try {
    const rows = await fetchAll('activityLogs', 'timestamp');
    const tbody = document.querySelector('#logsTable tbody');
    tbody.innerHTML = rows.length ? rows.slice(0, 200).map(l => `<tr>
        <td>${l.user}</td><td>${l.action}</td><td>${l.details || '-'}</td><td>${fmtDate(l.timestamp)}</td>
      </tr>`).join('') : '<tr><td colspan="4" class="empty-msg">No activity logs yet.</td></tr>';
  } catch (err) { handleError(err); }
}

document.getElementById('addUserBtn').addEventListener('click', () => {
  openModal(`<h3>Add User</h3>
    <form id="userForm">
      <div class="field"><label>Email</label><input type="email" id="u_email" required></div>
      <div class="field"><label>Full Name</label><input type="text" id="u_fullname" required></div>
      <div class="field"><label>Role</label><select id="u_role"><option value="staff">Staff</option><option value="admin">Admin</option></select></div>
      <div class="field"><label>Temporary Password</label><input type="password" id="u_password" required minlength="6"></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Create</button>
      </div>
    </form>
    <p style="font-size:12px;color:#7a7a7a;margin-top:10px;">Note: creating a user uses a secondary sign-in session so your own admin session stays active.</p>`);

  document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('u_email').value.trim();
    const fullName = document.getElementById('u_fullname').value.trim();
    const role = document.getElementById('u_role').value;
    const password = document.getElementById('u_password').value;

    try {
      // Use a secondary, temporary Firebase app instance so creating the new
      // auth user doesn't sign the current admin out of their own session.
      const { initializeApp: initSecondary, deleteApp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
      const secondaryApp = initSecondary(firebaseConfig, 'secondary-' + Date.now());
      const secondaryAuth = getAuth(secondaryApp);
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      await setDoc(doc(db, 'users', cred.user.uid), { email, fullName, role, status: 'active' });
      await signOut(secondaryAuth);
      await deleteApp(secondaryApp);

      await logActivity('ADD_USER', 'Created user: ' + email);
      showToast('User created.', 'success');
      closeModal();
      loadUsers();
    } catch (err) { handleError(err); }
  });
});

async function toggleUser(id, currentStatus) {
  if (!confirm("Change this user's active status?")) return;
  try {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    await updateDoc(doc(db, 'users', id), { status: newStatus });
    await logActivity('TOGGLE_USER_STATUS', id + ' -> ' + newStatus);
    showToast('User status updated.', 'success');
    loadUsers();
  } catch (err) { handleError(err); }
}

// expose functions used via inline onclick= in modal HTML
window.closeModal = closeModal;
