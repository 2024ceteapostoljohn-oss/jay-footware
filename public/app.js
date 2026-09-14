const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const authModal = $('#authModal');
const formMessage = $('#formMessage');
let currentUser = null;
let productsCatalog = [];
let selectedProduct = null;
let cart = JSON.parse(localStorage.getItem('jayFootwearCart') || '[]');

const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(value);
const dateText = value => new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(`${value}T00:00:00`));
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));

async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  } catch (_error) {
    throw new Error('Cannot connect to the server. Run “npm start” and open the server URL—not index.html by itself.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 405) throw new Error('The login server is not active here. Open the live website or run “npm start”—do not open index.html directly.');
    const err = new Error(data.error || `Server request failed (${response.status}).`);
    err.status = response.status;
    err.fields = data.fields || null;
    throw err;
  }
  return data;
}

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

async function loadProducts() {
  try {
    productsCatalog = await api('/api/products');
    $('#productGrid').innerHTML = productsCatalog.map(p => `
      <article class="product-card" tabindex="0" role="button" data-variant="${p.variantId}" aria-label="View ${escapeHtml(p.name)} details">
        <div class="product-visual"><img src="${escapeHtml(p.image)}" alt="Pre-loved ${escapeHtml(p.brand)} ${escapeHtml(p.name)}" loading="lazy"><span class="condition-tag">${escapeHtml(p.condition)}</span></div>
        <div class="product-info"><div class="product-top"><h3>${escapeHtml(p.name)}</h3><span class="product-price">${money(p.price)}</span></div>
        <p class="product-meta">${escapeHtml(p.brand)} · ${escapeHtml(p.size)}</p>
        <div class="availability ${p.stock > 0 ? 'available' : 'sold-out'}"><span></span>${p.stock > 0 ? `${p.stock} pair${p.stock === 1 ? '' : 's'} available` : 'Sold out'}</div></div>
      </article>`).join('');
    $$('.product-card').forEach(card => {
      const open = () => openProduct(Number(card.dataset.variant));
      card.addEventListener('click', open);
      card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    });
  } catch (err) { $('#productGrid').innerHTML = `<p class="form-message">${escapeHtml(err.message)}</p>`; }
}

function saveCart() { localStorage.setItem('jayFootwearCart', JSON.stringify(cart)); updateCartCount(); }
function updateCartCount() { $('#cartCount').textContent = cart.reduce((sum, item) => sum + item.quantity, 0); }
function openProduct(variantId) {
  selectedProduct = productsCatalog.find(product => product.variantId === variantId);
  if (!selectedProduct) return;
  $('#productModalImage').src = selectedProduct.image;
  $('#productModalImage').alt = `${selectedProduct.brand} ${selectedProduct.name}`;
  $('#productModalBrand').textContent = selectedProduct.brand;
  $('#productModalName').textContent = selectedProduct.name;
  $('#productModalMeta').textContent = `${selectedProduct.size} · ${selectedProduct.condition} condition · SKU ${selectedProduct.sku}`;
  $('#productModalPrice').textContent = money(selectedProduct.price);
  $('#productModalStock').textContent = selectedProduct.stock > 0 ? `${selectedProduct.stock} pair${selectedProduct.stock === 1 ? '' : 's'} available` : 'Sold out';
  $('#productQuantity').value = 1; $('#productQuantity').max = selectedProduct.stock;
  $('#addToOrder').disabled = selectedProduct.stock < 1;
  $('#addToOrder').textContent = selectedProduct.stock > 0 ? 'Add to order' : 'Sold out';
  $('#productModal').classList.remove('is-hidden'); document.body.style.overflow = 'hidden';
}
function closeProduct() { $('#productModal').classList.add('is-hidden'); document.body.style.overflow = ''; }
function addSelectedToCart() {
  if (!selectedProduct) return;
  const quantity = Number($('#productQuantity').value);
  const existing = cart.find(item => item.variantId === selectedProduct.variantId);
  const current = existing?.quantity || 0;
  if (!Number.isInteger(quantity) || quantity < 1 || current + quantity > selectedProduct.stock) return toast(`Only ${selectedProduct.stock} pair(s) are available.`);
  if (existing) existing.quantity += quantity; else cart.push({ variantId: selectedProduct.variantId, quantity });
  saveCart(); closeProduct(); toast(`${selectedProduct.name} added to your order.`);
}
function cartRows() {
  return cart.map(item => ({ ...item, product: productsCatalog.find(product => product.variantId === item.variantId) })).filter(item => item.product);
}
function renderOrder() {
  const rows = cartRows();
  $('#orderItems').innerHTML = rows.length ? rows.map(item => `<div class="order-row"><img src="${escapeHtml(item.product.image)}" alt=""><div><h3>${escapeHtml(item.product.name)}</h3><p>${escapeHtml(item.product.brand)} · ${escapeHtml(item.product.size)} · ${money(item.product.price)}</p><div class="order-row-actions"><button data-cart-minus="${item.variantId}">−</button><strong>${item.quantity}</strong><button data-cart-plus="${item.variantId}">+</button><button class="order-remove" data-cart-remove="${item.variantId}">Remove</button></div></div><span class="order-line-price">${money(item.product.price * item.quantity)}</span></div>`).join('') : '<div class="order-empty">Your order is empty. Select a shoe to add it.</div>';
  $('#orderTotal').textContent = money(rows.reduce((sum, item) => sum + item.product.price * item.quantity, 0));
  $$('[data-cart-minus]').forEach(button => button.onclick = () => changeCart(Number(button.dataset.cartMinus), -1));
  $$('[data-cart-plus]').forEach(button => button.onclick = () => changeCart(Number(button.dataset.cartPlus), 1));
  $$('[data-cart-remove]').forEach(button => button.onclick = () => { cart = cart.filter(item => item.variantId !== Number(button.dataset.cartRemove)); saveCart(); renderOrder(); prepareCheckout(); });
}
function changeCart(variantId, amount) {
  const item = cart.find(row => row.variantId === variantId), product = productsCatalog.find(row => row.variantId === variantId); if (!item || !product) return;
  if (item.quantity + amount < 1) return;
  if (item.quantity + amount > product.stock) return toast(`Only ${product.stock} pair(s) are available.`);
  item.quantity += amount; saveCart(); renderOrder();
}
async function prepareCheckout() {
  const hasItems = cartRows().length > 0;
  $('#checkoutGuest').classList.toggle('is-hidden', !!currentUser && currentUser.role === 'customer' || !hasItems);
  $('#checkoutForm').classList.add('is-hidden'); $('#orderSuccess').classList.add('is-hidden');
  if (!hasItems || !currentUser || currentUser.role !== 'customer') return;
  try {
    const info = await api('/api/customer/checkout');
    const form = $('#checkoutForm');
    for (const key of ['houseStreet','barangay','city','province','postalCode']) if (form.elements[key]) form.elements[key].value = info.customer?.[key.replace(/[A-Z]/g, m => '_' + m.toLowerCase())] || '';
    $('#checkoutPayment').innerHTML = info.paymentMethods.map(method => `<option value="${method.method_id}">${escapeHtml(method.method_name)}</option>`).join('');
    form.classList.remove('is-hidden');
  } catch (error) { $('#checkoutMessage').textContent = error.message; }
}
async function openOrder() { renderOrder(); $('#orderModal').classList.remove('is-hidden'); document.body.style.overflow = 'hidden'; await prepareCheckout(); }
function closeOrder() { $('#orderModal').classList.add('is-hidden'); document.body.style.overflow = ''; }

const tableDefinitions = {
  products: { title: 'Products', columns: [['sku','SKU'],['name','Shoe Name'],['brand','Brand'],['size','Size'],['condition','Condition'],['price','Price'],['stock','Stock']] },
  orders: { title: 'Orders', columns: [['order_no','Order No.'],['customer_name','Customer'],['item','Item'],['total','Total'],['status','Status'],['order_date','Order Date']] },
  customers: { title: 'Customers', columns: [['customer_no','Customer No.'],['name','Name'],['email','Email'],['city','City'],['orders_count','Orders'],['joined_date','Joined']] },
  suppliers: { title: 'Suppliers', columns: [['supplier_no','Supplier No.'],['name','Supplier Name'],['contact_person','Contact Person'],['contact','Phone'],['email','Email'],['location','Location'],['status','Status']] },
  cashiers: { title: 'Cashier Accounts', columns: [['user_no','User No.'],['username','Username'],['name','Cashier Name'],['role','Role'],['status','Status'],['created_date','Created']] }
};
function formatCell(key, value) {
  if (key === 'price' || key === 'total') return money(value);
  if (key.endsWith('date')) return dateText(value);
  if (key === 'status') return `<span class="status ${escapeHtml(String(value).toLowerCase())}">${escapeHtml(value)}</span>`;
  return escapeHtml(value);
}
function renderTable(key, rows) {
  const definition = tableDefinitions[key];
  return `<article class="table-block"><header class="table-title"><h3>${definition.title}</h3><span class="record-count">${rows.length} RECORDS</span></header><div class="table-scroll"><table class="data-table"><thead><tr>${definition.columns.map(([, label]) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${definition.columns.map(([field]) => `<td>${formatCell(field, row[field])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></article>`;
}
async function loadRecords() {
  try {
    const [records, schema] = await Promise.all([api('/api/admin/records'), api('/api/admin/schema-status')]);
    $('#recordTables').innerHTML = Object.keys(tableDefinitions).map(key => renderTable(key, records[key])).join('');
    const totalRecords = schema.tables.reduce((sum, table) => sum + table.records, 0);
    $('#schemaSummary').textContent = `${schema.tables.length} normalized ERD tables · ${totalRecords} linked records`;
  } catch (err) { $('#recordTables').innerHTML = `<p class="form-message">${escapeHtml(err.message)}</p>`; }
}

function setUser(user) {
  currentUser = user;
  if (user) {
    $('#authButton').textContent = `${user.fullName} · Sign out`;
    if (user.role === 'admin') { $$('.admin-link').forEach(el => el.classList.remove('is-hidden')); }
  } else {
    $('#authButton').textContent = 'Sign in / Sign up';
    $$('.admin-link').forEach(el => el.classList.add('is-hidden')); $('#records').classList.add('is-hidden');
  }
}
function openModal(mode = 'login') { switchTab(mode); authModal.classList.remove('is-hidden'); document.body.style.overflow = 'hidden'; setTimeout(() => $('.auth-form:not(.is-hidden) input')?.focus(), 50); }
function closeModal() { authModal.classList.add('is-hidden'); document.body.style.overflow = ''; formMessage.textContent = ''; }
function switchTab(mode) {
  const login = mode === 'login';
  $('#loginTab').classList.toggle('active', login); $('#signupTab').classList.toggle('active', !login);
  $('#loginForm').classList.toggle('is-hidden', !login); $('#signupForm').classList.toggle('is-hidden', login);
  $('#modalTitle').textContent = login ? 'Welcome back' : 'Join Jay Footwear';
  $('#modalSubtitle').textContent = login ? 'Sign in to your Jay Footwear account.' : 'Create an account to browse available pairs.';
  $('#authSwitchPrompt').firstChild.textContent = login ? 'New to Jay Footwear? ' : 'Already have an account? ';
  $('#authSwitchButton').textContent = login ? 'Create an account' : 'Sign in instead';
  $('#authSwitchButton').dataset.mode = login ? 'signup' : 'login';
  formMessage.textContent = '';
}
async function submitAuth(form, endpoint) {
  formMessage.textContent = 'Please wait…';
  const payload = Object.fromEntries(new FormData(form));
  try { const { user } = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) }); setUser(user); form.reset(); closeModal(); toast(`Welcome, ${user.fullName}!`); const rolePages = { admin:'/admin.html', cashier:'/cashier.html', 'owner/manager':'/owner.html' }; if (rolePages[user.role]) setTimeout(() => { location.href = rolePages[user.role]; }, 350); }
  catch (err) { formMessage.textContent = err.message; }
}
async function setupGoogle() {
  try {
    const { googleClientId } = await api('/api/config');
    if (!googleClientId) return;
    $('#googleArea').classList.remove('is-hidden');
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    script.onload = () => { google.accounts.id.initialize({ client_id: googleClientId, callback: async response => { try { const { user } = await api('/api/auth/google', { method:'POST', body:JSON.stringify({ credential:response.credential }) }); setUser(user); closeModal(); toast(`Welcome, ${user.fullName}!`); } catch (err) { formMessage.textContent = err.message; } } }); google.accounts.id.renderButton($('#googleButton'), { theme:'outline', size:'large', width:360, text:'continue_with' }); };
    document.head.appendChild(script);
  } catch (_) {}
}

$('#authButton').addEventListener('click', async () => { if (!currentUser) openModal(); else { await api('/api/auth/logout', { method:'POST' }); setUser(null); toast('You have signed out.'); } });
$('#modalClose').addEventListener('click', closeModal);
authModal.addEventListener('click', event => { if (event.target === authModal) closeModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeModal(); closeProduct(); closeOrder(); } });
$('#loginTab').addEventListener('click', () => switchTab('login'));
$('#signupTab').addEventListener('click', () => switchTab('signup'));
$('#authSwitchButton').addEventListener('click', event => switchTab(event.currentTarget.dataset.mode));
$('#loginForm').addEventListener('submit', event => { event.preventDefault(); window.jayAuth.handleLogin(event.currentTarget, submitAuth); });
$('#signupForm').addEventListener('submit', event => { event.preventDefault(); window.jayAuth.handleSignup(event.currentTarget); });
$$('.password-toggle').forEach(button => button.addEventListener('click', () => {
  const input = button.closest('.password-field').querySelector('input');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  button.setAttribute('title', showing ? 'Show password' : 'Hide password');
  button.querySelector('.eye-open').classList.toggle('is-hidden', !showing);
  button.querySelector('.eye-closed').classList.toggle('is-hidden', showing);
}));
$('#menuButton').addEventListener('click', () => { const open = $('#mobileNav').classList.toggle('open'); $('#menuButton').setAttribute('aria-expanded', open); });
$$('#mobileNav a').forEach(link => link.addEventListener('click', () => $('#mobileNav').classList.remove('open')));
$('#cartButton').addEventListener('click', openOrder);
$('#productModalClose').addEventListener('click', closeProduct);
$('#productModal').addEventListener('click', event => { if (event.target.id === 'productModal') closeProduct(); });
$('#addToOrder').addEventListener('click', addSelectedToCart);
$('#orderModalClose').addEventListener('click', closeOrder);
$('#orderModal').addEventListener('click', event => { if (event.target.id === 'orderModal') closeOrder(); });
$('#checkoutSignIn').addEventListener('click', () => { closeOrder(); openModal('login'); });
$('#checkoutForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
  $('#checkoutMessage').textContent = 'Placing your order…';
  try {
    const { order } = await api('/api/customer/orders', { method:'POST', body:JSON.stringify({ methodId:Number(values.methodId), address:{ houseStreet:values.houseStreet, barangay:values.barangay, city:values.city, province:values.province, postalCode:values.postalCode }, items:cart.map(item => ({ variantId:item.variantId, quantity:item.quantity })) }) });
    cart = []; saveCart(); form.classList.add('is-hidden'); $('#orderItems').innerHTML = ''; $('#orderTotal').textContent = money(0);
    $('#orderSuccess').innerHTML = `<h3>Order placed!</h3><p>Reference: <strong>${escapeHtml(order.reference)}</strong></p><p>Total: <strong>${money(order.total)}</strong> · Status: ${escapeHtml(order.status)}</p><p>We’ll prepare your order for nationwide shipping.</p>`;
    $('#orderSuccess').classList.remove('is-hidden'); await loadProducts();
  } catch (error) { $('#checkoutMessage').textContent = error.message; }
});
$('#newsletterForm').addEventListener('submit', event => { event.preventDefault(); event.currentTarget.reset(); toast('You’re on the list!'); });

updateCartCount();
Promise.all([loadProducts(), api('/api/auth/me').then(({ user }) => setUser(user)).catch(() => {})]);
setupGoogle();
