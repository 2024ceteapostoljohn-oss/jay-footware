const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const authModal = $('#authModal');
const formMessage = $('#formMessage');
let currentUser = null;
let bagCount = 0;

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
    throw new Error(data.error || `Server request failed (${response.status}).`);
  }
  return data;
}

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

async function loadProducts() {
  try {
    const products = await api('/api/products');
    const colors = [['#1e1e21','#d71920'],['#222b47','#f2efe6'],['#ddd7ca','#202020'],['#72171b','#f0e9dc'],['#c7c2b8','#2f4a3d'],['#8c8b8b','#e7e0d3']];
    $('#productGrid').innerHTML = products.map((p, i) => `
      <article class="product-card">
        <div class="product-visual" style="--shoe-a:${colors[i % colors.length][0]};--shoe-b:${colors[i % colors.length][1]}"><span class="condition-tag">${escapeHtml(p.condition)}</span></div>
        <div class="product-info"><div class="product-top"><h3>${escapeHtml(p.name)}</h3><span class="product-price">${money(p.price)}</span></div>
        <p class="product-meta">${escapeHtml(p.brand)} · ${escapeHtml(p.size)} · ${p.stock} in stock</p>
        <button class="add-button" data-product="${escapeHtml(p.name)}">Add to bag</button></div>
      </article>`).join('');
    $$('.add-button').forEach(button => button.addEventListener('click', () => { bagCount++; $('#bagCount').textContent = bagCount; toast(`${button.dataset.product} added to your bag.`); }));
  } catch (err) { $('#productGrid').innerHTML = `<p class="form-message">${escapeHtml(err.message)}</p>`; }
}

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
  $('#modalTitle').textContent = login ? 'Welcome back' : 'Join Jay Footware';
  $('#modalSubtitle').textContent = login ? 'Sign in to your Jay Footware account.' : 'Create an account for faster checkout.';
  formMessage.textContent = '';
}
async function submitAuth(form, endpoint) {
  formMessage.textContent = 'Please wait…';
  const payload = Object.fromEntries(new FormData(form));
  try { const { user } = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) }); setUser(user); form.reset(); closeModal(); toast(`Welcome, ${user.fullName}!`); if (user.role === 'admin') setTimeout(() => { location.href = '/admin.html'; }, 350); }
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
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
$('#loginTab').addEventListener('click', () => switchTab('login'));
$('#signupTab').addEventListener('click', () => switchTab('signup'));
$('#loginForm').addEventListener('submit', event => { event.preventDefault(); submitAuth(event.currentTarget, '/api/auth/login'); });
$('#signupForm').addEventListener('submit', event => { event.preventDefault(); submitAuth(event.currentTarget, '/api/auth/signup'); });
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
$('#bagButton').addEventListener('click', () => toast(bagCount ? `Your bag has ${bagCount} item${bagCount === 1 ? '' : 's'}.` : 'Your bag is empty.'));
$('#newsletterForm').addEventListener('submit', event => { event.preventDefault(); event.currentTarget.reset(); toast('You’re on the list!'); });

Promise.all([loadProducts(), api('/api/auth/me').then(({ user }) => setUser(user)).catch(() => {})]);
setupGoogle();
