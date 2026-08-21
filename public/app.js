const $ = selector => document.querySelector(selector);

const elements = {
  loginPage: $('#loginPage'),
  loginForm: $('#loginForm'),
  loginEmail: $('#loginEmail'),
  loginPassword: $('#loginPassword'),
  loginButton: $('#loginButton'),
  loginError: $('#loginError'),
  appShell: $('#appShell'),
  sidebar: $('.sidebar'),
  nav: $('#nav'),
  page: $('#page'),
  roleLabel: $('#roleLabel'),
  userName: $('#userName'),
  userRole: $('#userRole'),
  userInitials: $('#userInitials'),
  logoutButton: $('#logoutButton'),
  menuButton: $('#menuButton'),
  profileButton: $('#profileButton'),
  globalSearch: $('#globalSearch'),
  approvalBanner: $('#approvalBanner'),
  bannerAction: $('#bannerAction'),
  modalBackdrop: $('#modalBackdrop'),
  modalForm: $('#modalForm'),
  modalTitle: $('#modalTitle'),
  modalEyebrow: $('#modalEyebrow'),
  modalBody: $('#modalBody'),
  modalError: $('#modalError'),
  modalSubmit: $('#modalSubmit'),
  modalClose: $('#modalClose'),
  modalCancel: $('#modalCancel'),
  toast: $('#toast')
};

const navItems = {
  dashboard: { label: 'Dashboard', icon: '▦' },
  orders: { label: 'Orders', icon: '▤' },
  products: { label: 'Products', icon: '◫' },
  inventory: { label: 'Inventory', icon: '▥' },
  packing: { label: 'PackProof', icon: '▣' },
  fulfilment: { label: 'Shipping & returns', icon: '⇄' },
  finance: { label: 'Wallet & payouts', icon: '¤' },
  reports: { label: 'Reports & audit', icon: '▧' },
  users: { label: 'People & roles', icon: '♙' },
  integrations: { label: 'Integrations', icon: '◎' },
  settings: { label: 'Settings', icon: '⚙' }
};

const roleViews = {
  admin: ['dashboard', 'orders', 'products', 'inventory', 'packing', 'fulfilment', 'finance', 'reports', 'users', 'integrations', 'settings'],
  supplier: ['dashboard', 'orders', 'products', 'inventory', 'packing', 'fulfilment', 'finance', 'reports', 'settings'],
  dropshipper: ['dashboard', 'orders', 'products', 'packing', 'fulfilment', 'finance', 'reports', 'settings']
};

const state = {
  user: null,
  csrfToken: null,
  currentView: 'dashboard',
  products: [],
  orders: [],
  users: [],
  packingSessions: [],
  activePacking: null,
  integrations: [],
  shipments: [],
  returns: [],
  wallets: [],
  payouts: [],
  modalHandler: null,
  toastTimer: null
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function titleCase(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function formatMoney(value) {
  if (value == null || value === '') return '—';
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value));
}

function formatDate(value, includeTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-MY', includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

function statusTone(status) {
  const value = String(status || '').toLowerCase();
  if (['active', 'paid', 'delivered', 'complete', 'completed', 'captured', 'success', 'connected', 'packed'].includes(value)) return 'green';
  if (['new', 'packing', 'shipped', 'pending_review', 'credentials_detected'].includes(value)) return 'blue';
  if (['pending', 'pending_payment', 'to_ship', 'price_review', 'awaiting_activation', 'metadata_only'].includes(value)) return 'amber';
  if (['cancelled', 'disabled', 'failed', 'exception'].includes(value)) return 'red';
  return 'gray';
}

function badge(status, label = titleCase(status)) {
  return `<span class="badge ${statusTone(status)}">${escapeHtml(label)}</span>`;
}

function initials(name) {
  return String(name || 'SF').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function pageHead(title, description, actions = '') {
  return `<header class="page-head"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</header>`;
}

function emptyRow(columns, message) {
  return `<tr><td class="empty-cell" colspan="${columns}">${escapeHtml(message)}</td></tr>`;
}

function setLoading() {
  elements.page.innerHTML = '<div class="loading"><div><div class="spinner"></div><p>Loading workspace…</p></div></div>';
}

function showPageError(error) {
  elements.page.innerHTML = `${pageHead('Could not load this page', 'The request did not complete.')}<div class="notice-card"><span class="notice-icon">!</span><span><b>${escapeHtml(error.message)}</b><small>Check the connection and try again.</small></span></div><button class="button secondary" data-action="retry">Try again</button>`;
}

function showToast(message, type = 'success') {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = `${type === 'error' ? '!' : '✓'} ${message}`;
  elements.toast.className = `toast${type === 'error' ? ' error' : ''}`;
  state.toastTimer = setTimeout(() => elements.toast.classList.add('hidden'), 3200);
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method) && state.csrfToken) headers['X-CSRF-Token'] = state.csrfToken;
  const response = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Request failed with status ${response.status}.`);
    error.code = data?.error?.code || 'REQUEST_FAILED';
    error.status = response.status;
    if (response.status === 401 && path !== '/auth/login') showLogin();
    throw error;
  }
  return data;
}

function showLogin() {
  state.user = null;
  state.csrfToken = null;
  elements.appShell.classList.add('hidden');
  elements.loginPage.classList.remove('hidden');
  elements.loginPassword.value = '';
  elements.loginError.textContent = '';
}

function renderNav() {
  const views = roleViews[state.user.role] || ['dashboard'];
  elements.nav.innerHTML = views.map(view => {
    const item = navItems[view];
    return `<button class="nav-button${state.currentView === view ? ' active' : ''}" type="button" data-view="${view}"><span class="nav-icon">${item.icon}</span><span>${escapeHtml(item.label)}</span></button>`;
  }).join('');
}

function showApp() {
  elements.loginPage.classList.add('hidden');
  elements.appShell.classList.remove('hidden');
  elements.userName.textContent = state.user.name;
  elements.userRole.textContent = titleCase(state.user.role);
  elements.userInitials.textContent = initials(state.user.name);
  elements.roleLabel.textContent = titleCase(state.user.role);
  elements.bannerAction.classList.toggle('hidden', state.user.role !== 'admin');
  const requested = location.hash.replace('#', '');
  const allowed = roleViews[state.user.role] || [];
  state.currentView = allowed.includes(requested) ? requested : 'dashboard';
  renderNav();
  loadView(state.currentView);
}

async function bootstrap() {
  try {
    const data = await api('/auth/me');
    state.user = data.user;
    state.csrfToken = data.csrfToken;
    showApp();
  } catch {
    showLogin();
  }
}

async function navigate(view) {
  const allowed = roleViews[state.user.role] || [];
  if (!allowed.includes(view)) view = 'dashboard';
  state.currentView = view;
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  renderNav();
  elements.sidebar.classList.remove('open');
  await loadView(view);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadView(view) {
  setLoading();
  try {
    if (view === 'dashboard') await renderDashboard();
    else if (view === 'products') await renderProducts();
    else if (view === 'inventory') await renderInventory();
    else if (view === 'orders') await renderOrders();
    else if (view === 'packing') await renderPacking();
    else if (view === 'fulfilment') await renderFulfilment();
    else if (view === 'finance') await renderFinance();
    else if (view === 'reports') await renderReports();
    else if (view === 'users') await renderUsers();
    else if (view === 'integrations') await renderIntegrations();
    else if (view === 'settings') renderSettings();
  } catch (error) {
    if (error.status !== 401) showPageError(error);
  }
}

async function renderDashboard() {
  const data = await api('/dashboard');
  const kpi = data.kpis;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const maxStatus = Math.max(1, ...data.statuses.map(item => item.total));
  const revenueLabel = kpi.revenueVisible ? 'Recorded order value' : 'Assigned products';
  const revenueValue = kpi.revenueVisible ? formatMoney(kpi.revenue) : kpi.totalProducts.toLocaleString();
  elements.page.innerHTML = `
    ${pageHead(`${greeting}, ${state.user.name.split(' ')[0]}`, 'Here is the current operational picture for your account.', '<button class="button secondary" data-action="refresh">↻ Refresh data</button>')}
    <section class="kpi-grid">
      <article class="card kpi-card"><span class="kpi-label">${revenueLabel}</span><strong class="kpi-value">${revenueValue}</strong><span class="kpi-note">Role-scoped total</span></article>
      <article class="card kpi-card"><span class="kpi-label">Total orders</span><strong class="kpi-value">${kpi.totalOrders.toLocaleString()}</strong><span class="kpi-note">${kpi.openOrders} currently open</span></article>
      <article class="card kpi-card"><span class="kpi-label">Ready to ship</span><strong class="kpi-value">${kpi.toShip.toLocaleString()}</strong><span class="kpi-note">Packing completed</span></article>
      <article class="card kpi-card"><span class="kpi-label">Low stock</span><strong class="kpi-value">${kpi.lowStock.toLocaleString()}</strong><span class="kpi-note">10 units or fewer</span></article>
    </section>
    <section class="dashboard-grid">
      <article class="card table-card">
        <div class="card-head"><div><h2>Recent orders</h2><p>Latest activity visible to your role</p></div><button class="text-button" data-action="view-orders">View all</button></div>
        <div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Channel</th><th>Status</th><th>Created</th></tr></thead><tbody>
          ${data.recentOrders.length ? data.recentOrders.map(order => `<tr><td><span class="table-primary">${escapeHtml(order.order_no)}</span><span class="table-secondary">${escapeHtml(order.tracking_no || 'No tracking yet')}</span></td><td>${escapeHtml(order.customer_name)}</td><td>${escapeHtml(titleCase(order.channel))}</td><td>${badge(order.fulfillment_status)}</td><td>${escapeHtml(formatDate(order.created_at))}</td></tr>`).join('') : emptyRow(5, 'No orders yet. Create the first order from the Orders page.')}
        </tbody></table></div>
      </article>
      <article class="card">
        <div class="card-head"><div><h2>Order pipeline</h2><p>Current fulfillment stages</p></div></div>
        <div class="status-list">
          ${data.statuses.length ? data.statuses.map(item => `<div class="status-row"><span>${escapeHtml(titleCase(item.status))}</span><progress value="${item.total}" max="${maxStatus}"></progress><strong>${item.total}</strong></div>`).join('') : '<p class="muted">No pipeline activity yet.</p>'}
        </div>
      </article>
    </section>`;
}

async function ensureUsers() {
  if (state.user.role !== 'admin') return [];
  const data = await api('/users');
  state.users = data.users;
  return state.users;
}

async function renderProducts() {
  const [productData] = await Promise.all([api('/products'), state.user.role === 'admin' ? ensureUsers() : Promise.resolve([])]);
  state.products = productData.products;
  const canEdit = ['admin', 'supplier'].includes(state.user.role);
  const actions = canEdit ? '<button class="button primary" data-action="add-product">+ Add product</button>' : '';
  let headers;
  let rows;
  if (state.user.role === 'dropshipper') {
    headers = '<th>Product</th><th>Platform price</th><th>SRP</th><th>Available</th><th>Status</th>';
    rows = state.products.map(product => `<tr><td><span class="table-primary">${escapeHtml(product.name)}</span><span class="table-secondary">${escapeHtml(product.sku)}</span></td><td>${formatMoney(product.platform_price)}</td><td>${formatMoney(product.srp)}</td><td><span class="stock-number">${Number(product.available).toLocaleString()}</span></td><td>${badge(product.status)}</td></tr>`).join('');
  } else {
    const isAdmin = state.user.role === 'admin';
    headers = `<th>Product</th>${isAdmin ? '<th>Supplier</th>' : ''}<th>Supplier price</th>${isAdmin ? '<th>Platform price</th>' : ''}<th>Stock</th><th>Available</th><th>Status</th><th>Action</th>`;
    rows = state.products.map(product => `<tr><td><span class="table-primary">${escapeHtml(product.name)}</span><span class="table-secondary">${escapeHtml(product.sku)}</span></td>${isAdmin ? `<td>${escapeHtml(product.supplier_name || 'Platform-owned')}</td>` : ''}<td>${formatMoney(product.supplier_price)}</td>${isAdmin ? `<td>${formatMoney(product.platform_price)}</td>` : ''}<td>${Number(product.stock).toLocaleString()}</td><td><span class="stock-number">${Number(product.available).toLocaleString()}</span></td><td>${badge(product.status)}</td><td><div class="actions">${isAdmin && product.proposed_supplier_price != null ? `<button class="button small primary" data-action="approve-price" data-id="${escapeHtml(product.id)}">Approve ${formatMoney(product.proposed_supplier_price)}</button>` : ''}<button class="button small secondary" data-action="edit-product" data-id="${escapeHtml(product.id)}">Edit</button></div></td></tr>`).join('');
  }
  const columns = state.user.role === 'dropshipper' ? 5 : state.user.role === 'admin' ? 8 : 6;
  elements.page.innerHTML = `
    ${pageHead('Products', state.user.role === 'dropshipper' ? 'Approved catalogue with platform price and recommended selling price.' : 'Manage catalogue, supplier pricing and approval status.', actions)}
    ${state.user.role === 'dropshipper' ? '<div class="notice-card"><span class="notice-icon">✓</span><span><b>Commercial privacy is active</b><small>Supplier identity and supplier cost are not exposed in this account.</small></span></div>' : ''}
    <section class="card table-card"><div class="table-toolbar"><input class="search-field" id="productFilter" type="search" placeholder="Search product or SKU"><span class="badge gray">${state.products.length} products</span></div><div class="table-wrap"><table><thead><tr>${headers}</tr></thead><tbody id="productRows">${rows || emptyRow(columns, 'No products yet.')}</tbody></table></div></section>`;
  $('#productFilter')?.addEventListener('input', event => filterRows('#productRows', event.target.value));
}

function productForm(product = null) {
  const suppliers = state.users.filter(user => user.role === 'supplier' && user.status === 'active');
  const isAdmin = state.user.role === 'admin';
  return `<div class="field-grid">
    ${product ? '' : `<label class="field"><span>SKU</span><input name="sku" required maxlength="80" placeholder="SF-ITEM-001"></label>`}
    <label class="field${product ? ' wide' : ''}"><span>Product name</span><input name="name" required maxlength="190" value="${escapeHtml(product?.name || '')}"></label>
    <label class="field wide"><span>Description</span><textarea name="description" maxlength="5000">${escapeHtml(product?.description || '')}</textarea></label>
    ${isAdmin && !product ? `<label class="field wide"><span>Supplier account</span><select name="supplierUserId"><option value="">Platform-owned / unassigned</option>${suppliers.map(user => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)} — ${escapeHtml(user.companyName || user.email)}</option>`).join('')}</select></label>` : ''}
    <label class="field"><span>Supplier price (MYR)</span><input name="supplierPrice" type="number" min="0" step="0.01" required value="${escapeHtml(product?.supplier_price ?? '')}"><small>${state.user.role === 'supplier' ? 'Price increases require admin approval.' : 'Internal supplier cost.'}</small></label>
    ${isAdmin ? `<label class="field"><span>Platform price (MYR)</span><input name="platformPrice" type="number" min="0" step="0.01" value="${escapeHtml(product?.platform_price ?? '')}"></label>` : ''}
    ${isAdmin ? `<label class="field"><span>Recommended selling price</span><input name="srp" type="number" min="0" step="0.01" value="${escapeHtml(product?.srp ?? '')}"><small>Minimum 30% above platform price.</small></label>` : ''}
    ${product ? '' : '<label class="field"><span>Opening stock</span><input name="stock" type="number" min="0" step="1" required value="0"></label>'}
    ${isAdmin ? `<label class="field"><span>Status</span><select name="status">${['draft', 'active', 'paused', 'pending_review', 'price_review'].map(status => `<option value="${status}"${product?.status === status ? ' selected' : ''}>${titleCase(status)}</option>`).join('')}</select></label>` : ''}
  </div>`;
}

function openProductModal(product = null) {
  openModal({
    eyebrow: 'Catalogue',
    title: product ? `Edit ${product.sku}` : 'Add a product',
    submitLabel: product ? 'Save changes' : 'Create product',
    html: productForm(product),
    handler: async form => {
      const data = Object.fromEntries(new FormData(form));
      for (const key of ['platformPrice', 'srp', 'supplierUserId', 'description']) if (data[key] === '') delete data[key];
      if (!product) data.stock = Number(data.stock);
      data.supplierPrice = Number(data.supplierPrice);
      if (data.platformPrice != null) data.platformPrice = Number(data.platformPrice);
      if (data.srp != null) data.srp = Number(data.srp);
      await api(product ? `/products/${product.id}` : '/products', { method: product ? 'PATCH' : 'POST', body: data });
      await renderProducts();
      showToast(product ? 'Product updated.' : 'Product created.');
    }
  });
}

async function renderInventory() {
  const [movementData, productData] = await Promise.all([api('/inventory'), api('/products')]);
  state.products = productData.products;
  const movements = movementData.movements;
  elements.page.innerHTML = `
    ${pageHead('Inventory', 'Every stock change is recorded in a permanent movement ledger.', '<button class="button primary" data-action="adjust-stock">Adjust stock</button>')}
    <section class="kpi-grid">
      <article class="card kpi-card"><span class="kpi-label">Total products</span><strong class="kpi-value">${state.products.length}</strong><span class="kpi-note">Visible to your role</span></article>
      <article class="card kpi-card"><span class="kpi-label">Stock units</span><strong class="kpi-value">${state.products.reduce((sum, product) => sum + Number(product.stock || 0), 0).toLocaleString()}</strong><span class="kpi-note">Physical balance</span></article>
      <article class="card kpi-card"><span class="kpi-label">Reserved units</span><strong class="kpi-value">${state.products.reduce((sum, product) => sum + Number(product.reserved || 0), 0).toLocaleString()}</strong><span class="kpi-note">Committed to orders</span></article>
      <article class="card kpi-card"><span class="kpi-label">Low stock SKUs</span><strong class="kpi-value">${state.products.filter(product => Number(product.available) <= 10).length}</strong><span class="kpi-note">10 or fewer available</span></article>
    </section>
    <section class="card table-card dashboard-grid-single"><div class="card-head"><div><h2>Movement ledger</h2><p>Newest change first</p></div></div><div class="table-wrap"><table><thead><tr><th>Product</th><th>Movement</th><th>Delta</th><th>Balance</th><th>Reference</th><th>Time</th></tr></thead><tbody>
      ${movements.length ? movements.map(item => `<tr><td><span class="table-primary">${escapeHtml(item.product_name)}</span><span class="table-secondary">${escapeHtml(item.sku)}</span></td><td>${badge(item.reason)}</td><td class="${Number(item.delta) >= 0 ? 'positive' : 'negative'}">${Number(item.delta) > 0 ? '+' : ''}${Number(item.delta).toLocaleString()}</td><td>${Number(item.balance_after).toLocaleString()}</td><td>${escapeHtml(item.reference_id || item.reference_type || 'Manual')}</td><td>${escapeHtml(formatDate(item.created_at))}</td></tr>`).join('') : emptyRow(6, 'No inventory movements yet.')}
    </tbody></table></div></section>`;
}

function openInventoryModal() {
  if (!state.products.length) return showToast('Create a product before adjusting stock.', 'error');
  openModal({
    eyebrow: 'Inventory ledger', title: 'Adjust stock', submitLabel: 'Record adjustment',
    html: `<label class="field"><span>Product</span><select name="productId" required>${state.products.map(product => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.sku)} — ${escapeHtml(product.name)} (${Number(product.available)} available)</option>`).join('')}</select></label><div class="field-grid"><label class="field"><span>Adjustment</span><input name="delta" type="number" step="1" required placeholder="e.g. 20 or -3"><small>Positive adds stock; negative removes it.</small></label><label class="field"><span>Reason</span><input name="reason" required maxlength="80" placeholder="Restock, cycle count…"></label></div>`,
    handler: async form => {
      const data = Object.fromEntries(new FormData(form));
      data.delta = Number(data.delta);
      await api('/inventory/adjustments', { method: 'POST', body: data });
      await renderInventory();
      showToast('Inventory adjustment recorded.');
    }
  });
}

async function renderOrders(search = '') {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  const tasks = [api(`/orders${query}`)];
  if (['admin', 'dropshipper'].includes(state.user.role)) tasks.push(api('/products'));
  if (state.user.role === 'admin') tasks.push(ensureUsers());
  const [orderData, productData] = await Promise.all(tasks);
  state.orders = orderData.orders;
  if (productData?.products) state.products = productData.products;
  const canCreate = ['admin', 'dropshipper'].includes(state.user.role);
  const rows = state.orders.map(order => {
    const transitions = allowedTransitions(order.fulfillment_status);
    return `<tr><td><span class="table-primary">${escapeHtml(order.order_no)}</span><span class="table-secondary">${escapeHtml(order.tracking_no || 'No tracking yet')}</span></td><td><span class="table-primary">${escapeHtml(order.customer_name)}</span><span class="table-secondary">${escapeHtml(order.customer_phone || 'No phone')}</span></td><td>${escapeHtml(titleCase(order.channel))}</td><td>${order.items.reduce((sum, item) => sum + Number(item.quantity), 0)}</td><td>${state.user.role === 'supplier' ? 'Private' : formatMoney(order.amount)}</td><td>${badge(order.fulfillment_status)}</td><td>${escapeHtml(formatDate(order.created_at))}</td><td>${transitions.length ? `<button class="button small secondary" data-action="manage-order" data-id="${escapeHtml(order.id)}">Update</button>` : '<span class="muted">—</span>'}</td></tr>`;
  }).join('');
  elements.page.innerHTML = `
    ${pageHead('Orders', 'Create, reserve stock and move orders through controlled fulfillment stages.', canCreate ? '<button class="button primary" data-action="add-order">+ Create order</button>' : '')}
    ${state.user.role === 'supplier' ? '<div class="notice-card"><span class="notice-icon">✓</span><span><b>Seller identity and commercial value are private</b><small>You receive only the customer and fulfillment details needed to ship assigned orders.</small></span></div>' : ''}
    <section class="card table-card"><div class="table-toolbar"><input class="search-field" id="orderFilter" type="search" value="${escapeHtml(search)}" placeholder="Search order, tracking or customer"><span class="badge gray">${state.orders.length} orders</span></div><div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Channel</th><th>Items</th><th>Value</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody id="orderRows">${rows || emptyRow(8, 'No orders found.')}</tbody></table></div></section>`;
  $('#orderFilter')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') renderOrders(event.target.value.trim()).catch(showPageError);
  });
}

function allowedTransitions(status) {
  const transitions = {
    new: ['pending_payment', 'packing', 'cancelled'],
    pending_payment: ['packing', 'cancelled'],
    packing: ['cancelled'],
    to_ship: ['shipped', 'cancelled'],
    shipped: ['delivered'], delivered: ['complete'], complete: [], cancelled: []
  }[status] || [];
  if (state.user.role === 'supplier') return transitions.filter(next => ['packing', 'shipped', 'delivered'].includes(next));
  if (state.user.role === 'dropshipper') return transitions.filter(next => ['cancelled', 'complete'].includes(next));
  return transitions;
}

function productOptions() {
  return state.products.filter(product => product.status === 'active' && Number(product.available) > 0).map(product => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.sku)} — ${escapeHtml(product.name)} · ${formatMoney(product.platform_price)} · ${Number(product.available)} available</option>`).join('');
}

function orderItemRow() {
  return `<div class="order-item-row"><label class="field"><span>Product</span><select name="productId" required><option value="">Choose product</option>${productOptions()}</select></label><label class="field"><span>Qty</span><input name="quantity" type="number" min="1" max="10000" value="1" required></label><button class="remove-item" type="button" data-remove-item aria-label="Remove item">×</button></div>`;
}

function openOrderModal() {
  if (!state.products.some(product => product.status === 'active' && Number(product.available) > 0)) return showToast('No active products with available stock.', 'error');
  const dropshippers = state.users.filter(user => user.role === 'dropshipper' && user.status === 'active');
  openModal({
    eyebrow: 'Manual order', title: 'Create an order', submitLabel: 'Create & reserve stock',
    html: `<div class="field-grid"><label class="field"><span>Customer name</span><input name="customerName" required maxlength="160"></label><label class="field"><span>Phone</span><input name="customerPhone" maxlength="60"></label><label class="field wide"><span>Shipping address</span><textarea name="shippingAddress" maxlength="2000"></textarea></label><label class="field"><span>Channel</span><select name="channel"><option value="manual">Manual</option><option value="website">Website</option><option value="shopee">Shopee manual</option><option value="tiktok">TikTok Shop manual</option><option value="lazada">Lazada manual</option></select></label><label class="field"><span>Warehouse</span><input name="warehouse" maxlength="120" placeholder="Kuala Lumpur"></label>${state.user.role === 'admin' ? `<label class="field wide"><span>Dropshipper account</span><select name="dropshipperUserId"><option value="">No dropshipper assigned</option>${dropshippers.map(user => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)} — ${escapeHtml(user.companyName || user.email)}</option>`).join('')}</select></label>` : ''}</div><div class="section-label"><b>Order items</b><button class="text-button" id="addOrderItem" type="button">+ Add line</button></div><p class="muted">Items must belong to one supplier; split multi-supplier baskets into separate orders.</p><div id="orderItems">${orderItemRow()}</div>`,
    onOpen: () => {
      $('#addOrderItem').addEventListener('click', () => $('#orderItems').insertAdjacentHTML('beforeend', orderItemRow()));
      $('#orderItems').addEventListener('click', event => {
        const button = event.target.closest('[data-remove-item]');
        if (!button) return;
        if ($('#orderItems').children.length === 1) return showToast('An order needs at least one item.', 'error');
        button.closest('.order-item-row').remove();
      });
    },
    handler: async form => {
      const values = Object.fromEntries(new FormData(form));
      const items = [...form.querySelectorAll('.order-item-row')].map(row => ({
        productId: row.querySelector('[name="productId"]').value,
        quantity: Number(row.querySelector('[name="quantity"]').value)
      }));
      const body = {
        customerName: values.customerName,
        customerPhone: values.customerPhone,
        shippingAddress: values.shippingAddress,
        channel: values.channel,
        warehouse: values.warehouse,
        items
      };
      if (values.dropshipperUserId) body.dropshipperUserId = values.dropshipperUserId;
      await api('/orders', { method: 'POST', body });
      await renderOrders();
      showToast('Order created and stock reserved.');
    }
  });
}

function openOrderStatusModal(order) {
  const transitions = allowedTransitions(order.fulfillment_status);
  openModal({
    eyebrow: order.order_no, title: 'Update fulfillment status', submitLabel: 'Update order',
    html: `<div class="notice-card"><span class="notice-icon">→</span><span><b>Current status: ${escapeHtml(titleCase(order.fulfillment_status))}</b><small>Status transitions are enforced by the server.</small></span></div><label class="field"><span>Next status</span><select name="status" required>${transitions.map(status => `<option value="${status}">${titleCase(status)}</option>`).join('')}</select></label><label class="field"><span>Tracking / airway bill</span><input name="trackingNo" maxlength="120" value="${escapeHtml(order.tracking_no || '')}" placeholder="Optional until shipment"></label>`,
    handler: async form => {
      const data = Object.fromEntries(new FormData(form));
      await api(`/orders/${order.id}/status`, { method: 'PATCH', body: data });
      await renderOrders();
      showToast('Order status updated.');
    }
  });
}

async function renderPacking() {
  const data = await api('/packing');
  state.packingSessions = data.sessions;
  const canPack = ['admin', 'supplier'].includes(state.user.role);
  const active = state.activePacking;
  const activeHtml = active ? `<div class="pack-detail"><div class="pack-order-head"><div><span class="badge blue">Active session</span><h2>${escapeHtml(active.order.order_no)}</h2></div>${badge(active.status)}</div><div class="pack-meta"><div class="meta-box"><small>Customer</small><b>${escapeHtml(active.order.customer_name)}</b></div><div class="meta-box"><small>Tracking / barcode</small><b>${escapeHtml(active.order.tracking_no || active.barcode)}</b></div><div class="meta-box"><small>Channel</small><b>${escapeHtml(titleCase(active.order.channel))}</b></div><div class="meta-box"><small>Ship to</small><b>${escapeHtml(active.order.shipping_address || 'Not provided')}</b></div></div><div class="proof-callout"><b>PackProof v1 record</b><br>Enter a secure evidence URL if video is stored externally. Without one, SellFlow saves a packing metadata record. Both records receive a 30-day retention date.</div>${canPack && active.status === 'packing' ? '<form id="completePackingForm"><label class="field"><span>Evidence URL (optional)</span><input name="evidenceUrl" type="url" placeholder="https://secure-storage.example/proof"><small>HTTPS only. Video binary upload is not part of this release.</small></label><label class="field"><span>Packing notes</span><textarea name="notes" maxlength="2000" placeholder="Seal condition, item check, exception notes…"></textarea></label><button class="button primary full" type="submit">Complete packing & mark to ship</button></form>' : ''}</div>` : '<div class="pack-empty"><div><b>No active packing session</b><p>Scan an order number or airway bill to begin.</p></div></div>';
  elements.page.innerHTML = `
    ${pageHead(canPack ? 'Packing station' : 'PackProof records', canPack ? 'Scan an order or airway bill and retain accountable packing evidence.' : 'Review packing proof for your own orders.')}
    <div class="notice-card"><span class="notice-icon">30</span><span><b>30-day evidence retention policy</b><small>This release stores packing metadata and an optional secure evidence URL—not raw video files.</small></span></div>
    <section class="packing-layout">
      ${canPack ? '<article class="card scan-card"><h2>Scan barcode or AWB</h2><p class="muted">A matching assigned order moves into packing.</p><form class="scan-form" id="scanForm"><input class="scan-input" name="barcode" autocomplete="off" required maxlength="160" placeholder="Scan or enter order number"><button class="button primary" type="submit">Start</button></form></article>' : '<article class="card scan-card"><h2>Read-only proof access</h2><p class="muted">Only admins and assigned suppliers can start or complete a packing session.</p></article>'}
      <article class="card active-pack">${activeHtml}</article>
    </section>
    <section class="card table-card dashboard-grid-single"><div class="card-head"><div><h2>Recent PackProof records</h2><p>Role-scoped packing history</p></div></div><div class="table-wrap"><table><thead><tr><th>Order</th><th>Barcode</th><th>Status</th><th>Evidence</th><th>Retention until</th><th>Started</th></tr></thead><tbody>${state.packingSessions.length ? state.packingSessions.map(session => `<tr><td><span class="table-primary">${escapeHtml(session.order.order_no)}</span><span class="table-secondary">${escapeHtml(session.order.customer_name)}</span></td><td>${escapeHtml(session.barcode)}</td><td>${badge(session.status)}</td><td>${session.evidenceUrl ? `<a href="${escapeHtml(session.evidenceUrl)}" target="_blank" rel="noopener noreferrer">Open proof</a>` : badge(session.evidenceStatus)}</td><td>${escapeHtml(formatDate(session.retentionUntil, false))}</td><td>${escapeHtml(formatDate(session.startedAt))}</td></tr>`).join('') : emptyRow(6, 'No packing sessions yet.')}</tbody></table></div></section>`;

  $('#scanForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      const barcode = new FormData(event.currentTarget).get('barcode');
      const result = await api('/packing/scan', { method: 'POST', body: { barcode } });
      state.activePacking = result.session;
      await renderPacking();
      showToast(result.resumed ? 'Packing session resumed.' : 'Packing session started.');
    } catch (error) {
      showToast(error.message, 'error');
      button.disabled = false;
    }
  });
  $('#completePackingForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      await api(`/packing/${state.activePacking.id}/complete`, { method: 'POST', body: values });
      state.activePacking = null;
      await renderPacking();
      showToast('Packing completed; order is ready to ship.');
    } catch (error) {
      showToast(error.message, 'error');
      button.disabled = false;
    }
  });
}

async function renderFulfilment() {
  const [shipmentData, returnData, orderData] = await Promise.all([api('/shipments'), api('/returns'), api('/orders')]);
  state.shipments = shipmentData.shipments;
  state.returns = returnData.returns;
  state.orders = orderData.orders;
  const canBook = ['admin', 'supplier'].includes(state.user.role);
  const canReturn = ['admin', 'dropshipper'].includes(state.user.role);
  const bookable = state.orders.some(order => ['to_ship', 'shipped', 'delivered'].includes(order.fulfillment_status));
  const returnable = state.orders.some(order => ['delivered', 'complete'].includes(order.fulfillment_status));
  const actions = `${canBook && bookable ? '<button class="button primary" data-action="book-shipment">+ Book shipment</button>' : ''}${canReturn && returnable ? '<button class="button secondary" data-action="request-return">Request return</button>' : ''}`;
  elements.page.innerHTML = `
    ${pageHead('Shipping & returns', 'Manual courier records now; approved courier APIs can attach to the same workflow later.', actions)}
    <section class="card table-card"><div class="card-head"><div><h2>Shipments</h2><p>Tracking and label records scoped to your role</p></div></div><div class="table-wrap"><table><thead><tr><th>Order</th><th>Courier</th><th>Tracking</th><th>Status</th><th>Label</th><th>Updated</th></tr></thead><tbody>
      ${state.shipments.length ? state.shipments.map(item => `<tr><td>${escapeHtml(item.order_no)}</td><td><span class="table-primary">${escapeHtml(item.courier)}</span><span class="table-secondary">${escapeHtml(item.service || 'Standard')}</span></td><td>${escapeHtml(item.tracking_no)}</td><td>${badge(item.status)}</td><td>${item.label_url ? `<a href="${escapeHtml(item.label_url)}" target="_blank" rel="noopener noreferrer">Open label</a>` : '—'}</td><td>${escapeHtml(formatDate(item.updated_at))}</td></tr>`).join('') : emptyRow(6, 'No shipment records yet.')}
    </tbody></table></div></section>
    <section class="card table-card dashboard-grid-single"><div class="card-head"><div><h2>Returns</h2><p>Request, review, refund and restock trail</p></div></div><div class="table-wrap"><table><thead><tr><th>Return</th><th>Order</th><th>Reason</th><th>Items</th><th>Status</th><th>Resolution</th><th>Action</th></tr></thead><tbody>
      ${state.returns.length ? state.returns.map(item => `<tr><td>${escapeHtml(item.return_no)}</td><td><span class="table-primary">${escapeHtml(item.order_no)}</span><span class="table-secondary">${escapeHtml(item.customer_name)}</span></td><td><span class="table-primary">${escapeHtml(item.reason)}</span></td><td>${item.items.reduce((sum, row) => sum + Number(row.quantity), 0)}</td><td>${badge(item.status)}</td><td>${escapeHtml(titleCase(item.resolution))}${Number(item.refund_amount) ? `<span class="table-secondary">${formatMoney(item.refund_amount)}</span>` : ''}</td><td>${state.user.role === 'admin' && !['rejected', 'restocked', 'refunded', 'closed'].includes(item.status) ? `<button class="button small secondary" data-action="manage-return" data-id="${escapeHtml(item.id)}">Review</button>` : '—'}</td></tr>`).join('') : emptyRow(7, 'No return requests yet.')}
    </tbody></table></div></section>`;
}

function openShipmentModal() {
  const orders = state.orders.filter(order => ['to_ship', 'shipped', 'delivered'].includes(order.fulfillment_status));
  openModal({
    eyebrow: 'Manual courier', title: 'Book or update shipment', submitLabel: 'Save shipment',
    html: `<label class="field"><span>Order</span><select name="orderId" required>${orders.map(order => `<option value="${escapeHtml(order.id)}">${escapeHtml(order.order_no)} — ${escapeHtml(order.customer_name)}</option>`).join('')}</select></label><div class="field-grid"><label class="field"><span>Courier</span><input name="courier" required maxlength="100" placeholder="J&T Express"></label><label class="field"><span>Service</span><input name="service" maxlength="100" placeholder="Standard"></label><label class="field wide"><span>Tracking / AWB</span><input name="trackingNo" required maxlength="160"></label><label class="field wide"><span>HTTPS label URL (optional)</span><input name="labelUrl" type="url" maxlength="500"></label></div>`,
    handler: async form => {
      const body = Object.fromEntries(new FormData(form));
      if (!body.service) delete body.service;
      if (!body.labelUrl) delete body.labelUrl;
      await api('/shipments', { method: 'POST', body });
      await renderFulfilment();
      showToast('Shipment record saved.');
    }
  });
}

function openReturnRequestModal() {
  const orders = state.orders.filter(order => ['delivered', 'complete'].includes(order.fulfillment_status));
  const itemFields = order => `<div class="return-items">${(order?.items || []).map(item => `<label class="return-item"><input type="checkbox" data-return-item value="${escapeHtml(item.id)}" checked><span><b>${escapeHtml(item.product_name)}</b><small>${escapeHtml(item.sku)} · Ordered ${Number(item.quantity)}</small></span><input type="number" data-return-qty min="1" max="${Number(item.quantity)}" value="${Number(item.quantity)}" aria-label="Return quantity"></label>`).join('')}</div>`;
  openModal({
    eyebrow: 'Returns', title: 'Request a return', submitLabel: 'Submit request',
    html: `<label class="field"><span>Order</span><select id="returnOrderSelect" name="orderId" required>${orders.map(order => `<option value="${escapeHtml(order.id)}">${escapeHtml(order.order_no)} — ${escapeHtml(order.customer_name)}</option>`).join('')}</select></label><div class="section-label"><b>Return items</b></div><div id="returnItems">${itemFields(orders[0])}</div><label class="field"><span>Reason</span><textarea name="reason" required maxlength="500"></textarea></label><label class="field"><span>Notes (optional)</span><textarea name="notes" maxlength="2000"></textarea></label>`,
    onOpen: () => {
      $('#returnOrderSelect').addEventListener('change', event => {
        $('#returnItems').innerHTML = itemFields(orders.find(order => order.id === event.target.value));
      });
    },
    handler: async form => {
      const body = Object.fromEntries(new FormData(form));
      body.items = [...form.querySelectorAll('[data-return-item]:checked')].map(input => ({
        orderItemId: input.value,
        quantity: Number(input.closest('.return-item').querySelector('[data-return-qty]').value)
      }));
      if (!body.items.length) throw new Error('Select at least one item to return.');
      if (!body.notes) delete body.notes;
      await api('/returns', { method: 'POST', body });
      await renderFulfilment();
      showToast('Return request created.');
    }
  });
}

function openReturnReviewModal(record) {
  const transitions = {
    requested: ['approved', 'rejected'],
    approved: ['received', 'refunded', 'rejected'],
    received: ['restocked', 'refunded', 'closed'],
    restocked: ['refunded', 'closed'],
    refunded: ['closed']
  }[record.status] || [];
  openModal({
    eyebrow: record.return_no, title: 'Review return', submitLabel: 'Update return',
    html: `<div class="notice-card"><span class="notice-icon">↩</span><span><b>${escapeHtml(record.reason)}</b><small>${record.items.length} line item(s)</small></span></div><div class="field-grid"><label class="field"><span>Status</span><select name="status">${transitions.map(value => `<option value="${value}">${titleCase(value)}</option>`).join('')}</select></label><label class="field"><span>Resolution</span><select name="resolution"><option value="pending">Pending</option><option value="refund">Refund</option><option value="replacement">Replacement</option><option value="credit">Account credit</option><option value="no_action">No action</option></select></label><label class="field wide"><span>Refund amount</span><input name="refundAmount" type="number" min="0" step="0.01" value="${Number(record.refund_amount || 0)}"></label></div><p class="muted">Choosing Restocked adds returned quantities back to inventory once and records the movement.</p>`,
    handler: async form => {
      const body = Object.fromEntries(new FormData(form));
      body.refundAmount = Number(body.refundAmount || 0);
      await api(`/returns/${record.id}`, { method: 'PATCH', body });
      await renderFulfilment();
      showToast('Return updated.');
    }
  });
}

async function renderFinance() {
  const data = await api('/finance');
  state.wallets = data.wallets;
  state.payouts = data.payouts;
  const transactions = data.transactions;
  const own = state.wallets.find(wallet => wallet.user_id === state.user.id) || state.wallets[0];
  const actions = state.user.role === 'admin'
    ? '<button class="button primary" data-action="adjust-wallet">+ Adjust wallet</button>'
    : own && Number(own.available_balance) > 0 ? '<button class="button primary" data-action="request-payout">Request payout</button>' : '';
  elements.page.innerHTML = `
    ${pageHead('Wallet & payouts', 'Auditable pending and available balances; external payment APIs remain disconnected.', actions)}
    <section class="kpi-grid">
      <article class="card kpi-card"><span class="kpi-label">Wallets</span><strong class="kpi-value">${state.wallets.length}</strong><span class="kpi-note">Role-scoped accounts</span></article>
      <article class="card kpi-card"><span class="kpi-label">Pending</span><strong class="kpi-value">${formatMoney(state.wallets.reduce((sum, wallet) => sum + Number(wallet.pending_balance), 0))}</strong><span class="kpi-note">Awaiting completion</span></article>
      <article class="card kpi-card"><span class="kpi-label">Available</span><strong class="kpi-value">${formatMoney(state.wallets.reduce((sum, wallet) => sum + Number(wallet.available_balance), 0))}</strong><span class="kpi-note">Eligible for payout</span></article>
      <article class="card kpi-card"><span class="kpi-label">Open payouts</span><strong class="kpi-value">${state.payouts.filter(item => item.status === 'requested').length}</strong><span class="kpi-note">Manual processing</span></article>
    </section>
    ${state.user.role === 'admin' ? `<section class="card table-card dashboard-grid-single"><div class="card-head"><div><h2>Wallet accounts</h2><p>Supplier and dropshipper balances</p></div></div><div class="table-wrap"><table><thead><tr><th>Account</th><th>Role</th><th>Pending</th><th>Available</th><th>Currency</th></tr></thead><tbody>${state.wallets.map(wallet => `<tr><td><span class="table-primary">${escapeHtml(wallet.name)}</span><span class="table-secondary">${escapeHtml(wallet.company_name || wallet.email)}</span></td><td>${badge(wallet.role)}</td><td>${formatMoney(wallet.pending_balance)}</td><td>${formatMoney(wallet.available_balance)}</td><td>${escapeHtml(wallet.currency)}</td></tr>`).join('') || emptyRow(5, 'No wallets yet.')}</tbody></table></div></section>` : ''}
    <section class="card table-card dashboard-grid-single"><div class="card-head"><div><h2>Payout requests</h2><p>Funds are held immediately when requested</p></div></div><div class="table-wrap"><table><thead><tr><th>Account</th><th>Amount</th><th>Status</th><th>Reference</th><th>Requested</th><th>Action</th></tr></thead><tbody>${state.payouts.length ? state.payouts.map(item => `<tr><td>${escapeHtml(item.name || state.user.name)}</td><td>${formatMoney(item.amount)}</td><td>${badge(item.status)}</td><td>${escapeHtml(item.payment_reference || '—')}</td><td>${escapeHtml(formatDate(item.requested_at))}</td><td>${state.user.role === 'admin' && item.status === 'requested' ? `<button class="button small secondary" data-action="process-payout" data-id="${escapeHtml(item.id)}">Process</button>` : '—'}</td></tr>`).join('') : emptyRow(6, 'No payout requests.')}</tbody></table></div></section>
    <section class="card table-card dashboard-grid-single"><div class="card-head"><div><h2>Wallet ledger</h2><p>Immutable newest-first transaction history</p></div></div><div class="table-wrap"><table><thead><tr><th>Type</th><th>Bucket</th><th>Amount</th><th>Balance</th><th>Description</th><th>Time</th></tr></thead><tbody>${transactions.length ? transactions.map(item => `<tr><td>${badge(item.type)}</td><td>${escapeHtml(titleCase(item.bucket))}</td><td class="${Number(item.amount) >= 0 ? 'positive' : 'negative'}">${Number(item.amount) > 0 ? '+' : ''}${formatMoney(item.amount)}</td><td>${formatMoney(item.balance_after)}</td><td>${escapeHtml(item.description || '—')}</td><td>${escapeHtml(formatDate(item.created_at))}</td></tr>`).join('') : emptyRow(6, 'No wallet transactions.')}</tbody></table></div></section>`;
}

function openWalletAdjustmentModal() {
  openModal({
    eyebrow: 'Finance control', title: 'Adjust a wallet', submitLabel: 'Record adjustment',
    html: `<label class="field"><span>Account</span><select name="userId" required>${state.wallets.map(wallet => `<option value="${escapeHtml(wallet.user_id)}">${escapeHtml(wallet.name)} — ${titleCase(wallet.role)}</option>`).join('')}</select></label><div class="field-grid"><label class="field"><span>Bucket</span><select name="bucket"><option value="available">Available</option><option value="pending">Pending</option></select></label><label class="field"><span>Amount</span><input name="amount" type="number" step="0.01" required><small>Use a negative value to deduct.</small></label><label class="field wide"><span>Description</span><input name="description" required maxlength="255"></label></div>`,
    handler: async form => {
      const body = Object.fromEntries(new FormData(form));
      body.amount = Number(body.amount);
      await api('/finance/adjustments', { method: 'POST', body });
      await renderFinance();
      showToast('Wallet adjustment recorded.');
    }
  });
}

function openPayoutRequestModal() {
  const wallet = state.wallets.find(item => item.user_id === state.user.id) || state.wallets[0];
  openModal({
    eyebrow: 'Payout', title: 'Request withdrawal', submitLabel: 'Request payout',
    html: `<div class="notice-card"><span class="notice-icon">¤</span><span><b>${formatMoney(wallet?.available_balance || 0)} available</b><small>Funds are held while Admin processes the request.</small></span></div><label class="field"><span>Amount</span><input name="amount" type="number" min="0.01" max="${Number(wallet?.available_balance || 0)}" step="0.01" required></label>`,
    handler: async form => {
      await api('/finance/payouts', { method: 'POST', body: { amount: Number(new FormData(form).get('amount')) } });
      await renderFinance();
      showToast('Payout requested.');
    }
  });
}

function openPayoutProcessModal(payout) {
  openModal({
    eyebrow: 'Payout control', title: `Process ${formatMoney(payout.amount)}`, submitLabel: 'Save decision',
    html: `<label class="field"><span>Decision</span><select name="status"><option value="paid">Paid</option><option value="rejected">Rejected and return funds</option></select></label><label class="field"><span>Payment reference (optional)</span><input name="paymentReference" maxlength="160"></label>`,
    handler: async form => {
      const body = Object.fromEntries(new FormData(form));
      if (!body.paymentReference) delete body.paymentReference;
      await api(`/finance/payouts/${payout.id}`, { method: 'PATCH', body });
      await renderFinance();
      showToast('Payout decision recorded.');
    }
  });
}

async function renderReports() {
  const tasks = [api('/reports/summary')];
  if (state.user.role === 'admin') tasks.push(api('/reports/audit'));
  const [summary, auditData] = await Promise.all(tasks);
  const auditRows = auditData?.logs || [];
  elements.page.innerHTML = `
    ${pageHead('Reports & audit', 'Operational totals are role-scoped; Admin also sees the system audit trail.', '<button class="button secondary" data-action="refresh">↻ Refresh</button>')}
    <section class="kpi-grid">
      <article class="card kpi-card"><span class="kpi-label">Orders</span><strong class="kpi-value">${Number(summary.orders.total_orders || 0)}</strong><span class="kpi-note">${Number(summary.orders.completed_orders || 0)} completed</span></article>
      <article class="card kpi-card"><span class="kpi-label">Order value</span><strong class="kpi-value">${summary.orders.order_value == null ? 'Private' : formatMoney(summary.orders.order_value)}</strong><span class="kpi-note">Excludes cancelled</span></article>
      <article class="card kpi-card"><span class="kpi-label">Shipments</span><strong class="kpi-value">${Number(summary.shipments.total_shipments || 0)}</strong><span class="kpi-note">${Number(summary.shipments.delivered_shipments || 0)} delivered</span></article>
      <article class="card kpi-card"><span class="kpi-label">Returns</span><strong class="kpi-value">${Number(summary.returns.total_returns || 0)}</strong><span class="kpi-note">${Number(summary.returns.open_returns || 0)} open</span></article>
    </section>
    <section class="card table-card dashboard-grid-single"><div class="card-head"><div><h2>Inventory summary</h2><p>Current role-scoped catalogue health</p></div></div><div class="status-list"><div class="status-row"><span>Products</span><div class="status-track"><div class="status-fill" style="width:100%"></div></div><strong>${Number(summary.products.total_products || 0)}</strong></div><div class="status-row"><span>Stock units</span><div class="status-track"><div class="status-fill" style="width:100%"></div></div><strong>${Number(summary.products.stock_units || 0)}</strong></div><div class="status-row"><span>Low stock</span><div class="status-track"><div class="status-fill" style="width:${Number(summary.products.total_products) ? Math.min(100, Number(summary.products.low_stock || 0) / Number(summary.products.total_products) * 100) : 0}%"></div></div><strong>${Number(summary.products.low_stock || 0)}</strong></div></div></section>
    ${state.user.role === 'admin' ? `<section class="card table-card dashboard-grid-single"><div class="card-head"><div><h2>Audit trail</h2><p>Authentication and operational changes</p></div></div><div class="table-wrap"><table><thead><tr><th>User</th><th>Action</th><th>Entity</th><th>Reference</th><th>Time</th></tr></thead><tbody>${auditRows.length ? auditRows.map(item => `<tr><td><span class="table-primary">${escapeHtml(item.user_name || 'System')}</span><span class="table-secondary">${escapeHtml(item.user_email || '—')}</span></td><td>${badge(item.action)}</td><td>${escapeHtml(titleCase(item.entity_type))}</td><td>${escapeHtml(item.entity_id || '—')}</td><td>${escapeHtml(formatDate(item.created_at))}</td></tr>`).join('') : emptyRow(5, 'No audit events.')}</tbody></table></div></section>` : ''}`;
}

async function renderUsers() {
  await ensureUsers();
  elements.page.innerHTML = `
    ${pageHead('People & roles', 'Create accounts and enforce Admin, Supplier and Dropshipper access.', '<button class="button primary" data-action="add-user">+ Add account</button>')}
    <section class="card table-card"><div class="table-toolbar"><input class="search-field" id="userFilter" type="search" placeholder="Search name, email or company"><span class="badge gray">${state.users.length} accounts</span></div><div class="table-wrap"><table><thead><tr><th>Person</th><th>Company</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody id="userRows">${state.users.length ? state.users.map(user => `<tr><td><span class="table-primary">${escapeHtml(user.name)}</span><span class="table-secondary">${escapeHtml(user.email)}</span></td><td>${escapeHtml(user.companyName || '—')}</td><td>${badge(user.role)}</td><td>${badge(user.status)}</td><td>${escapeHtml(formatDate(user.createdAt, false))}</td><td><div class="actions"><button class="button small secondary" data-action="reset-password" data-id="${escapeHtml(user.id)}">Reset password</button>${user.id !== state.user.id ? `<button class="button small ${user.status === 'active' ? 'danger' : 'secondary'}" data-action="toggle-user" data-id="${escapeHtml(user.id)}" data-status="${user.status === 'active' ? 'disabled' : 'active'}">${user.status === 'active' ? 'Disable' : 'Enable'}</button>` : ''}</div></td></tr>`).join('') : emptyRow(6, 'No accounts found.')}</tbody></table></div></section>`;
  $('#userFilter')?.addEventListener('input', event => filterRows('#userRows', event.target.value));
}

function openUserModal() {
  openModal({
    eyebrow: 'Access control', title: 'Create an account', submitLabel: 'Create account',
    html: `<div class="field-grid"><label class="field"><span>Full name</span><input name="name" required maxlength="120"></label><label class="field"><span>Email</span><input name="email" type="email" required maxlength="190"></label><label class="field"><span>Role</span><select name="role" required><option value="supplier">Supplier</option><option value="dropshipper">Dropshipper</option><option value="admin">Admin</option></select></label><label class="field"><span>Company</span><input name="companyName" maxlength="190"></label><label class="field wide"><span>Temporary password</span><input name="password" type="password" minlength="12" maxlength="500" required autocomplete="new-password"><small>Use at least 12 characters and share it through a secure channel.</small></label></div>`,
    handler: async form => {
      await api('/users', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      await renderUsers();
      showToast('Account created.');
    }
  });
}

function openPasswordModal(user) {
  openModal({
    eyebrow: 'Account security', title: `Reset ${user.name}'s password`, submitLabel: 'Reset password',
    html: '<label class="field"><span>New temporary password</span><input name="password" type="password" minlength="12" maxlength="500" required autocomplete="new-password"><small>Existing sessions for this account will be invalidated.</small></label>',
    handler: async form => {
      const password = new FormData(form).get('password');
      await api(`/users/${user.id}/reset-password`, { method: 'POST', body: { password } });
      showToast('Password reset and old sessions invalidated.');
    }
  });
}

async function renderIntegrations() {
  const [integrationData, logData] = await Promise.all([api('/integrations'), api('/integrations/logs')]);
  state.integrations = integrationData.integrations;
  elements.page.innerHTML = `
    ${pageHead('Marketplace integrations', 'Connector boundaries are ready; live sync waits for official seller API approval.')}
    <div class="notice-card"><span class="notice-icon">!</span><span><b>No approved marketplace API access is configured</b><small>Sync attempts are logged and fail safely. Credentials belong in Hostinger environment variables, never in this browser.</small></span></div>
    <section class="integration-grid">${state.integrations.map(item => `<article class="card integration-card"><div class="integration-logo">${escapeHtml(item.platform.slice(0, 2))}</div><h2>${escapeHtml(item.platform)}</h2>${badge(item.status)}<p>${escapeHtml(item.message)}</p><div class="integration-foot"><small class="muted">Last sync: ${escapeHtml(formatDate(item.lastSyncAt))}</small><button class="button small secondary" data-action="sync-integration" data-platform="${escapeHtml(item.platform)}">Test sync</button></div></article>`).join('')}</section>
    <section class="card table-card dashboard-grid-single"><div class="card-head"><div><h2>Synchronization log</h2><p>Successes and blocked attempts are auditable</p></div></div><div class="table-wrap"><table><thead><tr><th>Platform</th><th>Direction</th><th>Status</th><th>Records</th><th>Message</th><th>Time</th></tr></thead><tbody>${logData.logs.length ? logData.logs.map(log => `<tr><td>${escapeHtml(titleCase(log.platform))}</td><td>${escapeHtml(titleCase(log.direction))}</td><td>${badge(log.status)}</td><td>${Number(log.records_processed).toLocaleString()}</td><td><span class="table-primary">${escapeHtml(log.message || '—')}</span></td><td>${escapeHtml(formatDate(log.created_at))}</td></tr>`).join('') : emptyRow(6, 'No synchronization attempts yet.')}</tbody></table></div></section>`;
}

function renderSettings() {
  const commercialRule = state.user.role === 'supplier'
    ? ['Seller privacy', 'Dropshipper identity and order value are hidden from suppliers.']
    : state.user.role === 'dropshipper'
      ? ['Supplier privacy', 'Supplier identity and supplier cost are hidden from dropshippers.']
      : ['Administrator scope', 'Admins can manage every operational record and account.'];
  elements.page.innerHTML = `
    ${pageHead('Settings', 'Account details and first-release operating boundaries.')}
    <section class="settings-grid">
      <article class="card settings-card"><h2>Your account</h2><p>This profile is loaded from the authenticated server session.</p><div class="rule-list"><div class="rule"><span>●</span><div><b>${escapeHtml(state.user.name)}</b><small>${escapeHtml(state.user.email)}</small></div></div><div class="rule"><span>●</span><div><b>${escapeHtml(titleCase(state.user.role))}</b><small>${escapeHtml(state.user.companyName || 'Boraq Express workspace')}</small></div></div><div class="rule"><span>●</span><div><b>Session security</b><small>HttpOnly signed cookie plus CSRF protection.</small></div></div><button class="button secondary" data-action="change-password">Change my password</button></div></article>
      <article class="card settings-card"><h2>Role boundary</h2><p>Commercial data is filtered again by the server, not only hidden in the interface.</p><div class="rule-list"><div class="rule"><span>✓</span><div><b>${escapeHtml(commercialRule[0])}</b><small>${escapeHtml(commercialRule[1])}</small></div></div><div class="rule"><span>✓</span><div><b>Scoped records</b><small>Suppliers see assigned fulfillment; dropshippers see only their own orders.</small></div></div><div class="rule"><span>✓</span><div><b>Audit trail</b><small>Login and operational changes are recorded in MySQL.</small></div></div></div></article>
      <article class="card settings-card"><h2>PackProof v1</h2><p>Operational and honest about its current capability.</p><div class="rule-list"><div class="rule"><span>30</span><div><b>30-day retention date</b><small>Stored on every completed packing session.</small></div></div><div class="rule"><span>↗</span><div><b>Secure evidence URL</b><small>Optional pointer to externally stored evidence; no binary video upload yet.</small></div></div></div></article>
      <article class="card settings-card"><h2>Marketplace sync</h2><p>Adapter scaffolding is present, but credentials alone are not treated as approval.</p><div class="rule-list"><div class="rule"><span>!</span><div><b>Approval pending</b><small>Shopee, TikTok Shop and Lazada developer access is still required.</small></div></div>${state.user.role === 'admin' ? '<button class="button secondary" data-action="view-integrations">Open integration status</button>' : ''}</div></article>
    </section>`;
}

function openChangePasswordModal() {
  openModal({
    eyebrow: 'Account security', title: 'Change your password', submitLabel: 'Change password',
    html: '<label class="field"><span>Current password</span><input name="currentPassword" type="password" maxlength="500" required autocomplete="current-password"></label><label class="field"><span>New password</span><input name="newPassword" type="password" minlength="12" maxlength="500" required autocomplete="new-password"><small>Use at least 12 characters. You will be signed out after the change.</small></label>',
    handler: async form => {
      await api('/auth/change-password', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      showLogin();
      showToast('Password changed. Sign in again.');
    }
  });
}

function filterRows(selector, query) {
  const normalized = String(query || '').trim().toLowerCase();
  document.querySelectorAll(`${selector} tr`).forEach(row => {
    row.classList.toggle('hidden', normalized && !row.textContent.toLowerCase().includes(normalized));
  });
}

function openModal({ title, eyebrow = 'SellFlow', submitLabel = 'Save', html, handler, onOpen }) {
  state.modalHandler = handler;
  elements.modalTitle.textContent = title;
  elements.modalEyebrow.textContent = eyebrow;
  elements.modalBody.innerHTML = html;
  elements.modalError.textContent = '';
  elements.modalSubmit.textContent = submitLabel;
  elements.modalSubmit.disabled = false;
  elements.modalBackdrop.classList.remove('hidden');
  document.body.classList.add('modal-open');
  onOpen?.();
  setTimeout(() => elements.modalBody.querySelector('input, select, textarea')?.focus(), 10);
}

function closeModal() {
  elements.modalBackdrop.classList.add('hidden');
  document.body.classList.remove('modal-open');
  elements.modalForm.reset();
  elements.modalBody.innerHTML = '';
  elements.modalError.textContent = '';
  state.modalHandler = null;
}

elements.loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  elements.loginButton.disabled = true;
  elements.loginError.textContent = '';
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { email: elements.loginEmail.value, password: elements.loginPassword.value }
    });
    state.user = data.user;
    state.csrfToken = data.csrfToken;
    showApp();
  } catch (error) {
    elements.loginError.textContent = error.message;
  } finally {
    elements.loginButton.disabled = false;
  }
});

elements.logoutButton.addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* clear local UI even if network drops */ }
  showLogin();
});

elements.nav.addEventListener('click', event => {
  const button = event.target.closest('[data-view]');
  if (button) navigate(button.dataset.view);
});
elements.menuButton.addEventListener('click', () => elements.sidebar.classList.toggle('open'));
elements.profileButton.addEventListener('click', () => navigate('settings'));
elements.bannerAction.addEventListener('click', () => navigate('integrations'));
elements.globalSearch.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.value.trim()) {
    state.currentView = 'orders';
    history.replaceState(null, '', '#orders');
    renderNav();
    renderOrders(event.target.value.trim()).catch(showPageError);
  }
});

elements.modalClose.addEventListener('click', closeModal);
elements.modalCancel.addEventListener('click', closeModal);
elements.modalBackdrop.addEventListener('click', event => {
  if (event.target === elements.modalBackdrop) closeModal();
});
elements.modalForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.modalHandler) return;
  elements.modalSubmit.disabled = true;
  elements.modalError.textContent = '';
  try {
    await state.modalHandler(elements.modalForm);
    closeModal();
  } catch (error) {
    elements.modalError.textContent = error.message;
    elements.modalSubmit.disabled = false;
  }
});

elements.page.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  try {
    if (action === 'retry' || action === 'refresh') await loadView(state.currentView);
    else if (action === 'view-orders') await navigate('orders');
    else if (action === 'view-integrations') await navigate('integrations');
    else if (action === 'add-product') openProductModal();
    else if (action === 'edit-product') openProductModal(state.products.find(item => item.id === button.dataset.id));
    else if (action === 'approve-price') {
      button.disabled = true;
      await api(`/products/${button.dataset.id}/approve-price`, { method: 'POST', body: {} });
      await renderProducts();
      showToast('Supplier price increase approved.');
    }
    else if (action === 'adjust-stock') openInventoryModal();
    else if (action === 'book-shipment') openShipmentModal();
    else if (action === 'request-return') openReturnRequestModal();
    else if (action === 'manage-return') openReturnReviewModal(state.returns.find(item => item.id === button.dataset.id));
    else if (action === 'adjust-wallet') openWalletAdjustmentModal();
    else if (action === 'request-payout') openPayoutRequestModal();
    else if (action === 'process-payout') openPayoutProcessModal(state.payouts.find(item => item.id === button.dataset.id));
    else if (action === 'change-password') openChangePasswordModal();
    else if (action === 'add-order') openOrderModal();
    else if (action === 'manage-order') openOrderStatusModal(state.orders.find(item => item.id === button.dataset.id));
    else if (action === 'add-user') openUserModal();
    else if (action === 'reset-password') openPasswordModal(state.users.find(item => item.id === button.dataset.id));
    else if (action === 'toggle-user') {
      button.disabled = true;
      await api(`/users/${button.dataset.id}/status`, { method: 'PATCH', body: { status: button.dataset.status } });
      await renderUsers();
      showToast(`Account ${button.dataset.status}.`);
    }
    else if (action === 'sync-integration') {
      button.disabled = true;
      try {
        await api(`/integrations/${button.dataset.platform}/sync`, { method: 'POST', body: {} });
      } finally {
        await renderIntegrations();
      }
    }
  } catch (error) {
    showToast(error.message, 'error');
    button.disabled = false;
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !elements.modalBackdrop.classList.contains('hidden')) closeModal();
});

window.addEventListener('hashchange', () => {
  if (!state.user) return;
  const view = location.hash.replace('#', '');
  if (view && view !== state.currentView) navigate(view);
});

bootstrap();
