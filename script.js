<script>
  // ===================== STATE =====================
  let SESSION = { token: null, user: null };
  let CACHE = { categories: [], suppliers: [], inventory: [] };

  // ===================== UTILITIES =====================
  function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' ' + type : '');
    setTimeout(function () { t.className = 'toast'; }, 3200);
  }

  function fmtMoney(n) {
    return '₱' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(d) {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt)) return String(d);
    return dt.toLocaleString();
  }

  function serverCall(fnName, args, onSuccess, onError) {
    google.script.run
      .withSuccessHandler(onSuccess)
      .withFailureHandler(function (err) {
        showToast(err.message || 'Something went wrong.', 'error');
        if (onError) onError(err);
      })
      [fnName].apply(null, args || []);
  }

  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
    document.getElementById('modalBox').innerHTML = '';
  }

  function openModal(html) {
    document.getElementById('modalBox').innerHTML = html;
    document.getElementById('modalOverlay').classList.add('open');
  }

  // ===================== LOGIN =====================
  document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errBox = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');
    errBox.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Logging in...';

    serverCall('apiLogin', [username, password], function (res) {
      btn.disabled = false; btn.textContent = 'Log In';
      SESSION.token = res.token;
      SESSION.user = res.user;
      sessionStorage.setItem('mcdo_token', res.token);
      sessionStorage.setItem('mcdo_user', JSON.stringify(res.user));
      enterApp();
    }, function (err) {
      btn.disabled = false; btn.textContent = 'Log In';
      errBox.textContent = err.message || 'Login failed.';
      errBox.style.display = 'block';
    });
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
    document.getElementById('userRole').textContent = SESSION.user.role;
    document.getElementById('userInitial').textContent = SESSION.user.fullName.charAt(0).toUpperCase();
    if (SESSION.user.role !== 'admin') {
      document.getElementById('navUsers').style.display = 'none';
    }
    loadDashboard();
  }

  function doLogout() {
    serverCall('apiLogout', [SESSION.token], function () {
      sessionStorage.removeItem('mcdo_token');
      sessionStorage.removeItem('mcdo_user');
      location.reload();
    });
  }
  document.getElementById('logoutBtn').addEventListener('click', doLogout);
  document.getElementById('logoutBtnMobile').addEventListener('click', doLogout);

  document.getElementById('changePwBtn').addEventListener('click', function () {
    openModal(
      '<h3>Change Password</h3>' +
      '<form id="pwForm">' +
        '<div class="field"><label>Current Password</label><input type="password" id="oldPw" required></div>' +
        '<div class="field"><label>New Password</label><input type="password" id="newPw" required minlength="6"></div>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>' +
          '<button type="submit" class="btn-primary">Update</button>' +
        '</div>' +
      '</form>'
    );
    document.getElementById('pwForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const oldPw = document.getElementById('oldPw').value;
      const newPw = document.getElementById('newPw').value;
      serverCall('apiChangePassword', [SESSION.token, oldPw, newPw], function () {
        showToast('Password updated successfully.', 'success');
        closeModal();
      });
    });
  });

  // ===================== NAVIGATION =====================
  document.querySelectorAll('.nav-link').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      const page = this.dataset.page;
      document.querySelectorAll('.nav-link').forEach(function (l) { l.classList.remove('active'); });
      this.classList.add('active');
      document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
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

  // Mobile sidebar toggle
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  document.getElementById('hamburgerBtn').addEventListener('click', function () {
    sidebar.classList.add('open'); overlay.classList.add('open');
  });
  overlay.addEventListener('click', closeSidebar);
  function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('open'); }

  // ===================== DASHBOARD =====================
  function loadDashboard() {
    serverCall('apiGetDashboardStats', [SESSION.token], function (d) {
      document.getElementById('statTotalItems').textContent = d.totalItems;
      document.getElementById('statLowStock').textContent = d.lowStockCount;
      document.getElementById('statValue').textContent = fmtMoney(d.totalValue);
      document.getElementById('statMovements').textContent = d.todaysMovementsCount;

      const lowBox = document.getElementById('lowStockList');
      lowBox.innerHTML = d.lowStockItems.length ? d.lowStockItems.map(function (i) {
        return '<div class="list-row"><span>' + i.name + '</span><span class="badge low">' + i.quantity + ' ' + i.unit + '</span></div>';
      }).join('') : '<div class="empty-msg">No low stock items. Great job!</div>';

      const movBox = document.getElementById('recentMovementsList');
      movBox.innerHTML = d.recentMovements.length ? d.recentMovements.map(function (m) {
        return '<div class="list-row"><span>' + m.itemName + ' (' + m.quantity + ')</span>' +
          '<span class="badge ' + (m.type === 'IN' ? 'in' : 'out') + '">' + m.type + '</span></div>';
      }).join('') : '<div class="empty-msg">No recent movements.</div>';
    });
  }

  // ===================== INVENTORY =====================
  function loadInventory() {
    serverCall('apiGetInventory', [SESSION.token], function (items) {
      CACHE.inventory = items;
      const tbody = document.querySelector('#inventoryTable tbody');
      tbody.innerHTML = items.length ? items.map(function (i) {
        const low = Number(i.quantity) <= Number(i.reorderLevel);
        return '<tr>' +
          '<td>' + i.name + '</td><td>' + i.category + '</td><td>' + (i.sku || '-') + '</td>' +
          '<td class="' + (low ? 'qty-low' : '') + '">' + i.quantity + '</td><td>' + i.unit + '</td>' +
          '<td>' + i.reorderLevel + '</td><td>' + fmtMoney(i.unitPrice) + '</td><td>' + (i.supplier || '-') + '</td>' +
          '<td>' + fmtDate(i.lastUpdated) + '</td>' +
          '<td>' +
            '<button class="btn-sm edit" onclick="openEditItem(\'' + i.id + '\')">Edit</button>' +
            '<button class="btn-sm danger" onclick="deleteItem(\'' + i.id + '\')">Delete</button>' +
          '</td></tr>';
      }).join('') : '<tr><td colspan="10" class="empty-msg">No inventory items yet.</td></tr>';
    });
  }

  function categoryOptions(selected) {
    return CACHE.categories.map(function (c) {
      return '<option value="' + c.name + '"' + (c.name === selected ? ' selected' : '') + '>' + c.name + '</option>';
    }).join('');
  }
  function supplierOptions(selected) {
    return '<option value="">- None -</option>' + CACHE.suppliers.map(function (s) {
      return '<option value="' + s.name + '"' + (s.name === selected ? ' selected' : '') + '>' + s.name + '</option>';
    }).join('');
  }

  function ensureLookupsLoaded(cb) {
    let pending = 2;
    function done() { pending--; if (pending === 0) cb(); }
    serverCall('apiGetCategories', [SESSION.token], function (c) { CACHE.categories = c; done(); });
    serverCall('apiGetSuppliers', [SESSION.token], function (s) { CACHE.suppliers = s; done(); });
  }

  function itemFormHtml(item) {
    item = item || {};
    return (
      '<h3>' + (item.id ? 'Edit Item' : 'Add Inventory Item') + '</h3>' +
      '<form id="itemForm">' +
        '<div class="field"><label>Item Name</label><input type="text" id="f_name" value="' + (item.name || '') + '" required></div>' +
        '<div class="field"><label>Category</label><select id="f_category">' + categoryOptions(item.category) + '</select></div>' +
        '<div class="field"><label>SKU</label><input type="text" id="f_sku" value="' + (item.sku || '') + '"></div>' +
        '<div class="field"><label>Quantity</label><input type="number" id="f_qty" value="' + (item.quantity != null ? item.quantity : 0) + '" min="0" required></div>' +
        '<div class="field"><label>Unit (pcs, kg, box, liters)</label><input type="text" id="f_unit" value="' + (item.unit || 'pcs') + '" required></div>' +
        '<div class="field"><label>Reorder Level</label><input type="number" id="f_reorder" value="' + (item.reorderLevel != null ? item.reorderLevel : 10) + '" min="0" required></div>' +
        '<div class="field"><label>Unit Price (₱)</label><input type="number" id="f_price" value="' + (item.unitPrice || 0) + '" min="0" step="0.01" required></div>' +
        '<div class="field"><label>Supplier</label><select id="f_supplier">' + supplierOptions(item.supplier) + '</select></div>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>' +
          '<button type="submit" class="btn-primary">Save</button>' +
        '</div>' +
      '</form>'
    );
  }

  document.getElementById('addItemBtn').addEventListener('click', function () {
    ensureLookupsLoaded(function () {
      openModal(itemFormHtml());
      bindItemForm(null);
    });
  });

  function openEditItem(id) {
    const item = CACHE.inventory.find(function (i) { return i.id === id; });
    ensureLookupsLoaded(function () {
      openModal(itemFormHtml(item));
      bindItemForm(item);
    });
  }

  function bindItemForm(existingItem) {
    document.getElementById('itemForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const payload = {
        id: existingItem ? existingItem.id : undefined,
        name: document.getElementById('f_name').value.trim(),
        category: document.getElementById('f_category').value,
        sku: document.getElementById('f_sku').value.trim(),
        quantity: document.getElementById('f_qty').value,
        unit: document.getElementById('f_unit').value.trim(),
        reorderLevel: document.getElementById('f_reorder').value,
        unitPrice: document.getElementById('f_price').value,
        supplier: document.getElementById('f_supplier').value
      };
      const fn = existingItem ? 'apiUpdateInventoryItem' : 'apiAddInventoryItem';
      serverCall(fn, [SESSION.token, payload], function () {
        showToast('Item saved.', 'success');
        closeModal();
        loadInventory();
      });
    });
  }

  function deleteItem(id) {
    if (!confirm('Delete this inventory item? This cannot be undone.')) return;
    serverCall('apiDeleteInventoryItem', [SESSION.token, id], function () {
      showToast('Item deleted.', 'success');
      loadInventory();
    });
  }

  // ===================== STOCK MOVEMENTS =====================
  function loadMovements() {
    serverCall('apiGetStockMovements', [SESSION.token], function (rows) {
      const tbody = document.querySelector('#movementsTable tbody');
      tbody.innerHTML = rows.length ? rows.map(function (m) {
        return '<tr><td>' + m.itemName + '</td>' +
          '<td><span class="badge ' + (m.type === 'IN' ? 'in' : 'out') + '">' + m.type + '</span></td>' +
          '<td>' + m.quantity + '</td><td>' + (m.reason || '-') + '</td><td>' + m.user + '</td><td>' + fmtDate(m.timestamp) + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="empty-msg">No stock movements recorded yet.</td></tr>';
    });
  }

  document.getElementById('addMovementBtn').addEventListener('click', function () {
    serverCall('apiGetInventory', [SESSION.token], function (items) {
      CACHE.inventory = items;
      const options = items.map(function (i) { return '<option value="' + i.id + '">' + i.name + ' (current: ' + i.quantity + ' ' + i.unit + ')</option>'; }).join('');
      openModal(
        '<h3>Record Stock Movement</h3>' +
        '<form id="movForm">' +
          '<div class="field"><label>Item</label><select id="m_item" required>' + options + '</select></div>' +
          '<div class="field"><label>Movement Type</label><select id="m_type"><option value="IN">Stock In (received)</option><option value="OUT">Stock Out (used/sold)</option></select></div>' +
          '<div class="field"><label>Quantity</label><input type="number" id="m_qty" min="1" required></div>' +
          '<div class="field"><label>Reason / Notes</label><input type="text" id="m_reason" placeholder="e.g. Delivery, wastage, daily usage"></div>' +
          '<div class="modal-actions">' +
            '<button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>' +
            '<button type="submit" class="btn-primary">Save</button>' +
          '</div>' +
        '</form>'
      );
      document.getElementById('movForm').addEventListener('submit', function (e) {
        e.preventDefault();
        const itemId = document.getElementById('m_item').value;
        const item = items.find(function (i) { return i.id === itemId; });
        const payload = {
          itemId: itemId,
          type: document.getElementById('m_type').value,
          quantity: document.getElementById('m_qty').value,
          reason: document.getElementById('m_reason').value.trim()
        };
        serverCall('apiAddStockMovement', [SESSION.token, payload], function () {
          showToast(item.name + ' stock updated.', 'success');
          closeModal();
          loadMovements();
        });
      });
    });
  });

  // ===================== CATEGORIES =====================
  function loadCategories() {
    serverCall('apiGetCategories', [SESSION.token], function (cats) {
      CACHE.categories = cats;
      const grid = document.getElementById('categoriesGrid');
      grid.innerHTML = cats.length ? cats.map(function (c) {
        return '<div class="cat-card"><h4>' + c.name + '</h4><p>' + (c.description || 'No description') + '</p>' +
          '<button class="btn-sm danger" onclick="deleteCategory(\'' + c.id + '\')">Delete</button></div>';
      }).join('') : '<div class="empty-msg">No categories yet.</div>';
    });
  }

  document.getElementById('addCategoryBtn').addEventListener('click', function () {
    openModal(
      '<h3>Add Category</h3>' +
      '<form id="catForm">' +
        '<div class="field"><label>Name</label><input type="text" id="c_name" required></div>' +
        '<div class="field"><label>Description</label><input type="text" id="c_desc"></div>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>' +
          '<button type="submit" class="btn-primary">Save</button>' +
        '</div>' +
      '</form>'
    );
    document.getElementById('catForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const payload = { name: document.getElementById('c_name').value.trim(), description: document.getElementById('c_desc').value.trim() };
      serverCall('apiAddCategory', [SESSION.token, payload], function () {
        showToast('Category added.', 'success');
        closeModal();
        loadCategories();
      });
    });
  });

  function deleteCategory(id) {
    if (!confirm('Delete this category?')) return;
    serverCall('apiDeleteCategory', [SESSION.token, id], function () {
      showToast('Category deleted.', 'success');
      loadCategories();
    });
  }

  // ===================== SUPPLIERS =====================
  function loadSuppliers() {
    serverCall('apiGetSuppliers', [SESSION.token], function (rows) {
      CACHE.suppliers = rows;
      const tbody = document.querySelector('#suppliersTable tbody');
      tbody.innerHTML = rows.length ? rows.map(function (s) {
        return '<tr><td>' + s.name + '</td><td>' + (s.contactPerson || '-') + '</td><td>' + (s.phone || '-') + '</td>' +
          '<td>' + (s.email || '-') + '</td><td>' + (s.address || '-') + '</td>' +
          '<td><button class="btn-sm edit" onclick="openEditSupplier(\'' + s.id + '\')">Edit</button>' +
          '<button class="btn-sm danger" onclick="deleteSupplier(\'' + s.id + '\')">Delete</button></td></tr>';
      }).join('') : '<tr><td colspan="6" class="empty-msg">No suppliers yet.</td></tr>';
    });
  }

  function supplierFormHtml(s) {
    s = s || {};
    return '<h3>' + (s.id ? 'Edit Supplier' : 'Add Supplier') + '</h3>' +
      '<form id="supForm">' +
        '<div class="field"><label>Name</label><input type="text" id="s_name" value="' + (s.name || '') + '" required></div>' +
        '<div class="field"><label>Contact Person</label><input type="text" id="s_contact" value="' + (s.contactPerson || '') + '"></div>' +
        '<div class="field"><label>Phone</label><input type="text" id="s_phone" value="' + (s.phone || '') + '"></div>' +
        '<div class="field"><label>Email</label><input type="email" id="s_email" value="' + (s.email || '') + '"></div>' +
        '<div class="field"><label>Address</label><input type="text" id="s_address" value="' + (s.address || '') + '"></div>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>' +
          '<button type="submit" class="btn-primary">Save</button>' +
        '</div>' +
      '</form>';
  }

  document.getElementById('addSupplierBtn').addEventListener('click', function () {
    openModal(supplierFormHtml());
    bindSupplierForm(null);
  });

  function openEditSupplier(id) {
    const s = CACHE.suppliers.find(function (x) { return x.id === id; });
    openModal(supplierFormHtml(s));
    bindSupplierForm(s);
  }

  function bindSupplierForm(existing) {
    document.getElementById('supForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const payload = {
        id: existing ? existing.id : undefined,
        name: document.getElementById('s_name').value.trim(),
        contactPerson: document.getElementById('s_contact').value.trim(),
        phone: document.getElementById('s_phone').value.trim(),
        email: document.getElementById('s_email').value.trim(),
        address: document.getElementById('s_address').value.trim()
      };
      const fn = existing ? 'apiUpdateSupplier' : 'apiAddSupplier';
      serverCall(fn, [SESSION.token, payload], function () {
        showToast('Supplier saved.', 'success');
        closeModal();
        loadSuppliers();
      });
    });
  }

  function deleteSupplier(id) {
    if (!confirm('Delete this supplier?')) return;
    serverCall('apiDeleteSupplier', [SESSION.token, id], function () {
      showToast('Supplier deleted.', 'success');
      loadSuppliers();
    });
  }

  // ===================== REPORTS =====================
  function loadReports() {
    serverCall('apiGetReports', [SESSION.token], function (r) {
      document.getElementById('reportLowStock').innerHTML = r.lowStock.length ? r.lowStock.map(function (i) {
        return '<div class="list-row"><span>' + i.name + '</span><span class="badge low">' + i.quantity + ' ' + i.unit + '</span></div>';
      }).join('') : '<div class="empty-msg">No low stock items.</div>';

      const cats = Object.keys(r.valueByCategory);
      document.getElementById('reportByCategory').innerHTML = cats.length ? cats.map(function (c) {
        return '<div class="list-row"><span>' + c + '</span><span>' + fmtMoney(r.valueByCategory[c]) + '</span></div>';
      }).join('') : '<div class="empty-msg">No data yet.</div>';

      document.getElementById('reportStockIn').textContent = r.stockIn30d;
      document.getElementById('reportStockOut').textContent = r.stockOut30d;
      document.getElementById('reportTotalValue').textContent = fmtMoney(r.totalInventoryValue);
    });
  }

  // ===================== USERS & LOGS (admin only) =====================
  function loadUsers() {
    serverCall('apiGetUsers', [SESSION.token], function (rows) {
      const tbody = document.querySelector('#usersTable tbody');
      tbody.innerHTML = rows.length ? rows.map(function (u) {
        return '<tr><td>' + u.username + '</td><td>' + u.fullName + '</td><td>' + u.role + '</td>' +
          '<td>' + u.status + '</td><td>' + fmtDate(u.lastLogin) + '</td>' +
          '<td><button class="btn-sm toggle" onclick="toggleUser(\'' + u.id + '\')">' + (u.status === 'active' ? 'Disable' : 'Enable') + '</button>' +
          '<button class="btn-sm edit" onclick="resetUserPw(\'' + u.id + '\')">Reset Pw</button></td></tr>';
      }).join('') : '<tr><td colspan="6" class="empty-msg">No users found.</td></tr>';
    });
  }

  function loadLogs() {
    serverCall('apiGetActivityLogs', [SESSION.token], function (rows) {
      const tbody = document.querySelector('#logsTable tbody');
      tbody.innerHTML = rows.length ? rows.map(function (l) {
        return '<tr><td>' + l.user + '</td><td>' + l.action + '</td><td>' + (l.details || '-') + '</td><td>' + fmtDate(l.timestamp) + '</td></tr>';
      }).join('') : '<tr><td colspan="4" class="empty-msg">No activity logs yet.</td></tr>';
    });
  }

  document.getElementById('addUserBtn').addEventListener('click', function () {
    openModal(
      '<h3>Add User</h3>' +
      '<form id="userForm">' +
        '<div class="field"><label>Username</label><input type="text" id="u_username" required></div>' +
        '<div class="field"><label>Full Name</label><input type="text" id="u_fullname" required></div>' +
        '<div class="field"><label>Role</label><select id="u_role"><option value="staff">Staff</option><option value="admin">Admin</option></select></div>' +
        '<div class="field"><label>Temporary Password</label><input type="password" id="u_password" required minlength="6"></div>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>' +
          '<button type="submit" class="btn-primary">Create</button>' +
        '</div>' +
      '</form>'
    );
    document.getElementById('userForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const payload = {
        username: document.getElementById('u_username').value.trim(),
        fullName: document.getElementById('u_fullname').value.trim(),
        role: document.getElementById('u_role').value,
        password: document.getElementById('u_password').value
      };
      serverCall('apiAddUser', [SESSION.token, payload], function () {
        showToast('User created.', 'success');
        closeModal();
        loadUsers();
      });
    });
  });

  function toggleUser(id) {
    if (!confirm('Change this user\'s active status?')) return;
    serverCall('apiToggleUserStatus', [SESSION.token, id], function () {
      showToast('User status updated.', 'success');
      loadUsers();
    });
  }

  function resetUserPw(id) {
    const newPw = prompt('Enter a new temporary password for this user (min 6 characters):');
    if (!newPw) return;
    if (newPw.length < 6) { showToast('Password too short.', 'error'); return; }
    serverCall('apiResetUserPassword', [SESSION.token, id, newPw], function () {
      showToast('Password reset.', 'success');
    });
  }

  // ===================== INIT =====================
  tryRestoreSession();
</script>
