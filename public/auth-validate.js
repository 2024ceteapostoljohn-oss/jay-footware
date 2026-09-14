/* ============================================================
   Jay Footwear — Strict Signup & Login Validation
   Loaded AFTER app.js. Reuses the global helpers app.js exposes:
     api(), setUser(), closeModal(), toast(), formMessage
   Client-side validation mirrors the backend rules in server.js.
   ============================================================ */
(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const SIGNUP = $('#signupForm');
  const LOGIN = $('#loginForm');
  if (!SIGNUP || !LOGIN) return;

  // Reused globals from app.js: api, toast, formMessage, setUser, closeModal.
  const DRAFT_KEY = 'jaySignupDraft';
  // Fields that are SAFE to persist (passwords NEVER saved).
  const SAFE_FIELDS = ['firstName','middleName','lastName','suffix','dateOfBirth','phone','email','confirmEmail','country','region','province','city','barangay','street','zip'];

  let ADDRESS = { regions: [] };
  const cityInput = $('#suCity');
  const barangayInput = $('#suBarangay');

  /* ---------- validation primitives (mirror server.js) ---------- */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const NAME_RE = /^[A-Za-z\u00C0-\u024F\u1E00-\u1EFF'\-.\s]+$/;
  const PH_E164 = /^\+639\d{9}$/;

  function isValidEmail(value) {
    const email = String(value || '').trim();
    if (email.length > 254 || !EMAIL_RE.test(email)) return false;
    const parts = email.split('@');
    if (parts.length !== 2) return false;
    const [local, domain] = parts;
    if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
    if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;
    return !/\s/.test(email);
  }

  // Normalize a Philippine mobile number to E.164 (+63 9xx xxx xxxx).
  function normalizePh(value) {
    let p = String(value || '').trim().replace(/[\s\-\.\(\)]/g, '');
    if (!p) return null;
    if (p.startsWith('0')) p = '+63' + p.slice(1);       // 09171234567 -> +639171234567
    else if (p.startsWith('63') && p.length >= 12) p = '+' + p;   // 639171234567 -> +639171234567
    else if (p.startsWith('9') && p.length === 10) p = '+63' + p;  // 9171234567 -> +639171234567
    return PH_E164.test(p) ? p : null;
  }

  function ageFromDob(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return null;
    const today = new Date();
    if (date > today) return null;                      // future birth date
    let age = today.getFullYear() - date.getFullYear();
    const m = today.getMonth() - date.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < date.getDate())) age--;
    return age >= 0 && age <= 120 ? age : null;
  }

  function isStrongPassword(pw) {
    if (typeof pw !== 'string' || pw.length < 12 || pw.length > 128) return false;
    if (!/[A-Z]/.test(pw)) return false;
    if (!/[a-z]/.test(pw)) return false;
    if (!/[0-9]/.test(pw)) return false;
    if (!/[^A-Za-z0-9]/.test(pw)) return false;
    return true;
  }

  function nameOk(v) {
    v = String(v || '').replace(/\s+/g, ' ').trim();
    return v.length > 0 && v.length <= 80 && NAME_RE.test(v);
  }

  function fieldVal(name) { const el = SIGNUP.elements[name]; return el ? el.value : ''; }

  /* ---------- full form rules (returns { fields, payload }) ---------- */
  function runRules() {
    const fields = {};
    const firstName = String(fieldVal('firstName')).replace(/\s+/g, ' ').trim();
    const middleName = String(fieldVal('middleName')).replace(/\s+/g, ' ').trim();
    const lastName = String(fieldVal('lastName')).replace(/\s+/g, ' ').trim();
    const suffix = String(fieldVal('suffix')).replace(/\s+/g, ' ').trim();
    const email = String(fieldVal('email')).trim().toLowerCase();
    const confirmEmail = String(fieldVal('confirmEmail')).trim().toLowerCase();
    const phoneRaw = String(fieldVal('phone')).trim();
    const password = String(fieldVal('password'));
    const confirmPassword = String(fieldVal('confirmPassword'));
    const dob = String(fieldVal('dateOfBirth')).trim();
    const country = String(fieldVal('country')).trim();
    const region = String(fieldVal('region')).trim();
    const province = String(fieldVal('province')).trim();
    const city = String(fieldVal('city')).trim();
    const barangay = String(fieldVal('barangay')).trim();
    const street = String(fieldVal('street')).trim();
    const zip = String(fieldVal('zip')).trim();

    if (!firstName) fields.firstName = 'First name is required.';
    else if (!nameOk(firstName)) fields.firstName = 'Enter a valid first name (letters only).';
    if (middleName && !nameOk(middleName)) fields.middleName = 'Middle name must contain letters only.';
    if (!lastName) fields.lastName = 'Last name is required.';
    else if (!nameOk(lastName)) fields.lastName = 'Enter a valid last name (letters only).';
    if (suffix && !nameOk(suffix)) fields.suffix = 'Suffix must contain letters only.';

    if (!dob) fields.dateOfBirth = 'Date of birth is required.';
    else {
      const age = ageFromDob(dob);
      if (age === null) fields.dateOfBirth = 'Enter a valid past birth date.';
      else if (age < 13) fields.dateOfBirth = 'You must be at least 13 years old.';
      else if (age > 120) fields.dateOfBirth = 'Birth date is out of range.';
    }

    if (!email) fields.email = 'Email address is required.';
    else if (!isValidEmail(email)) fields.email = 'Enter a valid email address (e.g. name@example.com).';
    if (!confirmEmail) fields.confirmEmail = 'Please confirm your email.';
    else if (confirmEmail !== email) fields.confirmEmail = 'Emails do not match.';

    const phone = normalizePh(phoneRaw);
    if (!phoneRaw) fields.phone = 'Philippine mobile number is required.';
    else if (!phone) fields.phone = 'Enter a valid Philippine mobile number (e.g. +639171234567).';

    if (!password) fields.password = 'Password is required.';
    else if (!isStrongPassword(password)) fields.password = 'Password must be 12+ characters with an uppercase, lowercase, number, and special character.';
    if (!confirmPassword) fields.confirmPassword = 'Please confirm your password.';
    else if (confirmPassword !== password) fields.confirmPassword = 'Passwords do not match.';

    if (!country) fields.country = 'Country is required.';
    else if (!/^philippines$/i.test(country)) fields.country = 'Only the Philippines is currently supported.';
    if (!region) fields.region = 'Region is required.';
    if (!province) fields.province = 'Province is required.';
    if (!city) fields.city = 'City / Municipality is required.';
    else if (!isComboValid(cityInput, city)) fields.city = 'Select a valid city / municipality from the list.';
    if (!barangay) fields.barangay = 'Barangay is required.';
    else if (!isComboValid(barangayInput, barangay)) fields.barangay = 'Select a valid barangay from the list.';
    if (!street) fields.street = 'Street address is required.';
    else if (street.length < 3 || street.length > 200) fields.street = 'Street address must be 3–200 characters.';
    if (zip && !/^\d{4}$/.test(zip)) fields.zip = 'ZIP / Postal code must be 4 digits.';

    return {
      fields,
      payload: {
        firstName, middleName, lastName, suffix, email,
        phone, password, confirmPassword, confirmEmail,
        country, region, province, city, barangay, street, zip,
        dateOfBirth: dob
      }
    };
  }

  /* ---------- error / success display ---------- */
  function clearAllErrors() {
    $$('[data-error]').forEach(em => { em.textContent = ''; em.classList.remove('show'); });
    $$('input, select').forEach(el => el.classList.remove('invalid', 'valid'));
  }
  function showErrors(fields) {
    clearAllErrors();
    let first = null;
    Object.entries(fields).forEach(([name, msg]) => {
      const em = SIGNUP.querySelector(`[data-error="${name}"]`);
      if (em) { em.textContent = msg; em.classList.add('show'); }
      const inp = SIGNUP.elements[name];
      if (inp) { inp.classList.add('invalid'); if (!first) first = inp; }
    });
    return first;
  }
  function refreshField(name) {
    const { fields } = runRules();
    const em = SIGNUP.querySelector(`[data-error="${name}"]`);
    const inp = SIGNUP.elements[name];
    if (fields[name]) {
      if (em) { em.textContent = fields[name]; em.classList.add('show'); }
      if (inp) inp.classList.add('invalid');
    } else {
      if (em) { em.textContent = ''; em.classList.remove('show'); }
      if (inp) { inp.classList.remove('invalid'); if (inp.value.trim()) inp.classList.add('valid'); }
    }
  }

  /* ---------- searchable combobox ---------- */
  function makeCombo(input) {
    input.__options = [];
    const box = input.closest('.combo');
    const ul = box.querySelector('.combo-list');

    input.addEventListener('focus', () => { if (input.__options.length) ul.classList.add('open'); });
    input.addEventListener('input', () => {
      const q = input.value.toLowerCase();
      ul.innerHTML = '';
      const matches = input.__options.filter(o => o.label.toLowerCase().includes(q)).slice(0, 80);
      if (!matches.length) {
        const li = document.createElement('li');
        li.textContent = 'No matches';
        li.className = 'empty';
        ul.appendChild(li);
      } else {
        matches.forEach(o => {
          const li = document.createElement('li');
          li.textContent = o.label;
          li.setAttribute('role', 'option');
          li.addEventListener('mousedown', e => { e.preventDefault(); choose(ul, o); });
          ul.appendChild(li);
        });
      }
      ul.classList.add('open');
    });
    input.addEventListener('blur', () => setTimeout(() => ul.classList.remove('open'), 140));
    document.addEventListener('click', e => { if (!box.contains(e.target)) ul.classList.remove('open'); });
  }
  function setComboOptions(input, opts) {
    input.__options = (opts || []).slice();
  }
  function choose(ul, o) {
    const input = ul.closest('.combo').querySelector('input');
    input.value = o.label;
    input.dataset.value = o.value;
    ul.innerHTML = ''; ul.classList.remove('open');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function isComboValid(input, value) {
    return (input.__options || []).some(o => o.label.toLowerCase() === String(value).trim().toLowerCase());
  }

  /* ---------- address cascade ---------- */
  function populateCountries() {
    const sel = $('#suCountry');
    const o = document.createElement('option');
    o.value = 'Philippines'; o.textContent = 'Philippines';
    sel.appendChild(o);
  }
  function populateRegions() {
    const sel = $('#suRegion');
    sel.innerHTML = '<option value="">— Select region —</option>';
    ADDRESS.regions.forEach(r => { const o = document.createElement('option'); o.value = r.name; o.textContent = r.full || r.name; sel.appendChild(o); });
    sel.disabled = false;
  }
  function populateProvinces(regionName) {
    const sel = $('#suProvince');
    sel.innerHTML = '<option value="">— Select province —</option>';
    const region = ADDRESS.regions.find(r => r.name === regionName);
    if (!region) { sel.disabled = true; return; }
    region.provinces.forEach(p => { const o = document.createElement('option'); o.value = p.name; o.textContent = p.name; sel.appendChild(o); });
    sel.disabled = false;
  }
  function populateCities(provinceName) {
    const region = ADDRESS.regions.find(r => r.name === $('#suRegion').value);
    const prov = region && region.provinces.find(p => p.name === provinceName);
    setComboOptions(cityInput, (prov && prov.municipalities || []).map(m => ({ value: m.name, label: m.name })));
  }
  function populateBarangays(cityName) {
    const region = ADDRESS.regions.find(r => r.name === $('#suRegion').value);
    const prov = region && region.provinces.find(p => p.name === $('#suProvince').value);
    const muni = prov && prov.municipalities.find(m => m.name === cityName);
    setComboOptions(barangayInput, (muni && muni.barangays || []).map(b => ({ value: b, label: b })));
  }
  // Address hierarchy depth: province=1, city=2, barangay=3.
  const DEPTH_PROVINCE = 1, DEPTH_CITY = 2, DEPTH_BARANGAY = 3;
  function resetAddressBelow(depth) {
    if (depth <= DEPTH_PROVINCE) { const p = $('#suProvince'); p.value = ''; setComboOptions(cityInput, []); }
    cityInput.value = ''; cityInput.dataset.value = '';
    barangayInput.value = ''; barangayInput.dataset.value = ''; setComboOptions(barangayInput, []);
  }
  function bindCascade() {
    $('#suCountry').addEventListener('change', () => {
      const c = $('#suCountry').value;
      if (/^philippines$/i.test(c)) populateRegions();
      else { const r = $('#suRegion'); r.innerHTML = '<option value="">— Select region —</option>'; r.disabled = true; }
      resetAddressBelow(DEPTH_PROVINCE);
    });
    $('#suRegion').addEventListener('change', () => {
      populateProvinces($('#suRegion').value);
      resetAddressBelow(DEPTH_PROVINCE);
    });
    $('#suProvince').addEventListener('change', () => {
      populateCities($('#suProvince').value);
      resetAddressBelow(DEPTH_CITY);
    });
    cityInput.addEventListener('change', () => {
      const name = cityInput.value.trim();
      if (!name) { setComboOptions(barangayInput, []); }
      else populateBarangays(name);
      barangayInput.value = ''; barangayInput.dataset.value = '';   // clear the value, keep the new options
    });
  }

  /* ---------- auto-capitalization ---------- */
  function attachTitleCaps(input) {
    if (!input) return;
    input.addEventListener('input', () => {
      const start = input.selectionStart;
      const v = input.value;
      const capped = v.replace(/(^|\s)([a-z\u00C0-\u024F])/g, (m, pre, ch) => pre + ch.toUpperCase());
      if (capped !== v) {
        input.value = capped;
        const delta = capped.length - v.length;
        try { input.setSelectionRange(start + delta, start + delta); } catch (_) {}
      }
    });
  }

  /* ---------- age auto-calc + password strength meter ---------- */
  function updateAge() {
    const age = ageFromDob($('#suDob').value);
    $('#suAge').value = age === null ? '' : age;
  }
  function updateStrength() {
    const pw = String(fieldVal('password'));
    const meter = $('#suStrength');
    let score = 0;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    meter.dataset.score = score;
    meter.querySelector('span').style.width = (score / 4 * 100) + '%';
  }

  /* ---------- autosave drafts (no passwords) ---------- */
  let saveTimer = null;
  function updateDraftNote() {
    const note = $('#draftNote');
    if (!note) return;
    note.textContent = localStorage.getItem(DRAFT_KEY)
      ? 'Your draft is saved automatically. Refresh and continue where you left off.'
      : '';
  }
  function saveDraft() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!SIGNUP) return;
      const data = {};
      SAFE_FIELDS.forEach(n => { const el = SIGNUP.elements[n]; if (el) data[n] = el.dataset.value || el.value; });
      localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
      updateDraftNote();
    }, 400);
  }
  function restoreDraft() {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    let d; try { d = JSON.parse(raw); } catch (_) { return; }
    SAFE_FIELDS.forEach(n => {
      if (d[n] == null) return;
      const el = SIGNUP.elements[n];
      if (!el) return;
      el.value = d[n];
      if (el.dataset) el.dataset.value = d[n];
    });
    if (d.country && /^philippines$/i.test(d.country)) {
      populateRegions();
      if (d.region) { $('#suRegion').value = d.region; populateProvinces(d.region);
        if (d.province) { $('#suProvince').value = d.province; populateCities(d.province);
          if (d.city) { cityInput.value = d.city; cityInput.dataset.value = d.city; populateBarangays(d.city);
            if (d.barangay) { barangayInput.value = d.barangay; barangayInput.dataset.value = d.barangay; }
          }
        }
      }
    }
    updateAge();
  }
  function restoreAddressDefaults() {
    ['suRegion', 'suProvince'].forEach(id => { const el = $('#' + id); el.innerHTML = '<option value="">— Select ' + (id.includes('Region') ? 'region' : 'province') + ' —</option>'; el.disabled = true; });
    $('#suCountry').value = '';
    cityInput.value = ''; cityInput.dataset.value = ''; setComboOptions(cityInput, []);
    barangayInput.value = ''; barangayInput.dataset.value = ''; setComboOptions(barangayInput, []);
  }

  /* ---------- login helpers (client gate; server still enforces) ---------- */
  function setLoginError(name, msg) {
    const em = LOGIN.querySelector(`[data-error="${name}"]`);
    const inp = LOGIN.elements[name];
    if (em) { em.textContent = msg; em.classList.add('show'); }
    if (inp) inp.classList.add('invalid');
  }
  function clearLoginErrors() {
    $$('#loginForm [data-error]').forEach(em => { em.textContent = ''; em.classList.remove('show'); });
    $$('#loginForm input').forEach(inp => inp.classList.remove('invalid'));
  }
  function handleLogin(form, submitAuth) {
    clearLoginErrors();
    const login = String(form.elements.login.value || '').trim();
    const password = form.elements.password.value;
    let ok = true;
    if (!login) { setLoginError('login', 'Enter your username or email.'); ok = false; }
    else if (login.includes('@') && !isValidEmail(login)) { setLoginError('login', 'Enter a valid email address.'); ok = false; }
    if (!password) { setLoginError('password', 'Password is required.'); ok = false; }
    if (!ok) {
      if (formMessage) formMessage.textContent = 'Please correct the highlighted fields before continuing.';
      toast('Please correct the highlighted fields before continuing.');
      return;
    }
    submitAuth(form, '/api/auth/login');
  }

  /* ---------- signup submit ---------- */
  async function handleSignup(form) {
    const { fields, payload } = runRules();
    if (Object.keys(fields).length) {
      const first = showErrors(fields);
      if (formMessage) formMessage.textContent = 'Please correct the highlighted fields before continuing.';
      toast('Please correct the highlighted fields before continuing.');
      if (first) first.focus();
      return;
    }
    const phoneInput = form.elements.phone;
    if (phoneInput) phoneInput.value = payload.phone;      // show normalized E.164
    clearAllErrors();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Creating account…';
    if (formMessage) formMessage.textContent = 'Please wait…';
    try {
      const data = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify(payload) });
      localStorage.removeItem(DRAFT_KEY);
      const user = data.user;
      setUser(user);
      form.reset();
      clearAllErrors();
      restoreAddressDefaults();
      updateDraftNote();
      closeModal();
      toast(data.toast || `Welcome, ${user.fullName}!`);
      const rolePages = { admin: '/admin.html', cashier: '/cashier.html', 'owner/manager': '/owner.html' };
      if (rolePages[user.role]) setTimeout(() => { location.href = rolePages[user.role]; }, 350);
    } catch (err) {
      if (err.fields) { const f = showErrors(err.fields); if (f) f.focus(); }
      if (formMessage) formMessage.textContent = err.message || 'Unable to create your account.';
      toast(err.message || 'Please try again.');
    } finally {
      btn.disabled = false; btn.textContent = 'Create account';
    }
  }

  /* ---------- wire everything up ---------- */
  makeCombo(cityInput);
  makeCombo(barangayInput);
  attachTitleCaps($('#suFirst'));
  attachTitleCaps($('#suMiddle'));
  attachTitleCaps($('#suLast'));
  attachTitleCaps($('#suSuffix'));
  $('#suDob').addEventListener('change', updateAge);
  $('#suPassword').addEventListener('input', updateStrength);
  $('#suPassword2').addEventListener('input', updateStrength);

  bindCascade();

  // Live field feedback: validate on blur/change, clear as user fixes.
  SIGNUP.addEventListener('blur', (e) => { const f = e.target; if (f.name) refreshField(f.name); }, true);
  SIGNUP.addEventListener('change', (e) => { const f = e.target; if (f.name) refreshField(f.name); }, true);
  SIGNUP.addEventListener('input', (e) => {
    const f = e.target;
    if (!f.name) return;
    const em = SIGNUP.querySelector(`[data-error="${f.name}"]`);
    if (em && em.classList.contains('show')) {
      const { fields } = runRules();
      if (!fields[f.name]) { em.textContent = ''; em.classList.remove('show'); f.classList.remove('invalid'); }
    }
    saveDraft();
  });
  SIGNUP.addEventListener('change', saveDraft);

  // Restore the draft whenever the signup tab is shown (incl. after reload).
  new MutationObserver((muts) => {
    muts.forEach((m) => {
      if (m.type === 'attributes' && m.attributeName === 'class' && !SIGNUP.classList.contains('is-hidden')) {
        restoreDraft();
        clearAllErrors();
      }
    });
  }).observe(SIGNUP, { attributes: true, attributeFilter: ['class'] });

  // Load the bundled Philippine address data.
  fetch('/data/ph-addresses.json')
    .then(r => r.json())
    .then(data => { ADDRESS = data; populateCountries(); restoreDraft(); updateDraftNote(); })
    .catch(() => {});

  window.jayAuth = { handleLogin, handleSignup };
})();
