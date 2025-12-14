const $ = (id) => document.getElementById(id);
const usernameInput = $('username');
const displayNameInput = $('displayName');
const registerBtn = $('registerBtn');
const loginBtn = $('loginBtn');
const logoutBtn = $('logoutBtn');
const resetBtn = $('resetBtn');
const stepsEl = $('steps');
const rawEl = $('rawData');
const serverEl = $('serverData');
const statusEl = $('status');
const modesEl = $('modes');
const tabs = document.querySelectorAll('.tab');
const displayNameWrap = $('displayNameWrap');
const sessionCard = $('sessionCard');
const sessionStatusEl = $('sessionStatus');
const sessionUserEl = $('sessionUser');
const sessionExpiryEl = $('sessionExpiry');
const sessionBadgeEl = $('sessionBadge');
const sessionLoginBtn = $('sessionLoginBtn');
const sessionLogoutBtn = $('sessionLogoutBtn');
const timelineCard = $('timelineCard');
const dataCards = [document.getElementById('rawCard'), document.getElementById('serverCard')];

const baseSteps = {
  register: [
    { key: 'options', title: 'Запрос challenge', desc: 'POST /api/register/options' },
    { key: 'webauthn', title: 'WebAuthn create()', desc: 'navigator.credentials.create' },
    { key: 'verify', title: 'Проверка на сервере', desc: 'verifyRegistrationResponse' },
    { key: 'done', title: 'Готово', desc: 'Credential сохранён' },
  ],
  login: [
    { key: 'options', title: 'Запрос challenge', desc: 'POST /api/login/options' },
    { key: 'webauthn', title: 'WebAuthn get()', desc: 'navigator.credentials.get' },
    { key: 'verify', title: 'Проверка на сервере', desc: 'verifyAuthenticationResponse' },
    { key: 'done', title: 'Готово', desc: 'Пользователь вошёл' },
  ],
};

let currentMode = 'register';
let stepState = {};
let sessionData = { loggedIn: false };
let sessionTimer = null;

function setTab(tab) {
  currentMode = tab;
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  displayNameWrap.style.display = tab === 'register' ? 'grid' : 'none';
  updateActions();
  resetUI();
}

tabs.forEach((t) =>
  t.addEventListener('click', () => {
    setTab(t.dataset.tab);
  }),
);

function updateActions() {
  const loggedIn = sessionData.loggedIn;
  registerBtn.classList.toggle('hidden', loggedIn || currentMode !== 'register');
  loginBtn.classList.toggle('hidden', loggedIn || currentMode !== 'login');
  logoutBtn.classList.toggle('hidden', !loggedIn);
  sessionLoginBtn.classList.toggle('hidden', loggedIn);
  sessionLogoutBtn.classList.toggle('hidden', !loggedIn);
}

function renderSteps() {
  stepsEl.innerHTML = '';
  timelineCard.classList.toggle('hidden', Object.keys(stepState).length === 0);
  const steps = baseSteps[currentMode];
  steps.forEach((s) => {
    const status = stepState[s.key]?.status || 'idle';
    const msg = stepState[s.key]?.msg || s.desc;
    const badgeClass = {
      idle: 'badge idle',
      running: 'badge running',
      ok: 'badge ok',
      fail: 'badge fail',
    }[status];
    const el = document.createElement('div');
    el.className = 'step';
    el.innerHTML = `
      <div>
        <div class="title">${s.title}</div>
        <div class="desc">${msg}</div>
      </div>
      <span class="${badgeClass}">${status}</span>
    `;
    stepsEl.appendChild(el);
  });
}

function setStep(key, status, msg) {
  stepState[key] = { status, msg };
  renderSteps();
}

function bufferToBase64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlToBuffer(str) {
  if (!str) return new ArrayBuffer(0);
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function prepareRegistrationOptions(opts) {
  if (!opts) throw new Error('Пустые options для регистрации');
  const pubKeyCredParams =
    (opts.pubKeyCredParams && opts.pubKeyCredParams.length && opts.pubKeyCredParams) ||
    [
      { type: 'public-key', alg: -8 },
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ];
  return {
    ...opts,
    rp: opts.rp || {},
    pubKeyCredParams,
    challenge: base64urlToBuffer(opts.challenge),
    user: {
      ...opts.user,
      id: base64urlToBuffer(opts.user.id),
    },
    excludeCredentials: (opts.excludeCredentials || []).map((cred) => ({
      ...cred,
      id: base64urlToBuffer(cred.id),
    })),
  };
}

function prepareAuthenticationOptions(opts) {
  return {
    ...opts,
    challenge: base64urlToBuffer(opts.challenge),
    allowCredentials: (opts.allowCredentials || []).map((cred) => ({
      ...cred,
      id: base64urlToBuffer(cred.id),
    })),
  };
}

function publicKeyCredentialToJSON(cred) {
  if (!cred) return null;
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: cred.response
      ? {
          attestationObject: cred.response.attestationObject
            ? bufferToBase64url(cred.response.attestationObject)
            : undefined,
          clientDataJSON: cred.response.clientDataJSON
            ? bufferToBase64url(cred.response.clientDataJSON)
            : undefined,
          authenticatorData: cred.response.authenticatorData
            ? bufferToBase64url(cred.response.authenticatorData)
            : undefined,
          signature: cred.response.signature ? bufferToBase64url(cred.response.signature) : undefined,
          userHandle: cred.response.userHandle ? bufferToBase64url(cred.response.userHandle) : undefined,
          transports: cred.response.getTransports ? cred.response.getTransports() : undefined,
        }
      : {},
  };
}

async function fetchJSON(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || json.details || 'Запрос не удался');
  return json;
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

function formatTtl(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'менее 1 сек';
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec} сек`;
  return `${min} мин ${sec.toString().padStart(2, '0')} сек`;
}

function clearSessionTimer() {
  if (sessionTimer) {
    clearInterval(sessionTimer);
    sessionTimer = null;
  }
}

function renderSession() {
  const { loggedIn, user, ttlMs, expiresAt } = sessionData;
  sessionStatusEl.textContent = loggedIn ? 'Вы в системе' : 'Не авторизован';
  sessionBadgeEl.textContent = loggedIn ? 'online' : 'offline';
  sessionBadgeEl.style.background = loggedIn ? '#d1fae5' : '#fee2e2';
  sessionBadgeEl.style.color = loggedIn ? '#065f46' : '#b91c1c';
  sessionUserEl.textContent = loggedIn ? `${user.displayName || user.username}` : '—';
  sessionExpiryEl.textContent = loggedIn && ttlMs ? `${formatTtl(ttlMs)} (до ${expiresAt || '—'})` : '—';
  sessionLogoutBtn.disabled = !loggedIn;
  updateActions();
}

async function loadSession() {
  clearSessionTimer();
  try {
    const res = await fetch('/api/session', { credentials: 'include' });
    const data = await res.json();
    sessionData = data;
    renderSession();
    if (data.loggedIn && Number.isFinite(data.ttlMs) && data.ttlMs > 0) {
      let remaining = data.ttlMs;
      sessionTimer = setInterval(() => {
        remaining -= 1000;
        sessionExpiryEl.textContent = `${formatTtl(remaining)} (до ${data.expiresAt || '—'})`;
        if (remaining <= 0) {
          clearSessionTimer();
          sessionData = { loggedIn: false };
          renderSession();
        }
      }, 1000);
    }
  } catch {
    sessionData = { loggedIn: false };
    renderSession();
  }
}

async function loadSettings() {
  const res = await fetch('/api/settings');
  if (!res.ok) return;
  const data = await res.json();
  modesEl.innerHTML = '';
  data.modes.forEach((mode) => {
    const label = document.createElement('label');
    label.className = 'mode';
    label.innerHTML = `<input type="radio" name="mode" value="${mode.id}" ${mode.id === data.currentMode ? 'checked' : ''} ${data.canChangeMode ? '' : 'disabled'} /> ${mode.name}`;
    modesEl.appendChild(label);
  });
  modesEl.querySelectorAll('input[type=radio]').forEach((radio) =>
    radio.addEventListener('change', async () => {
      await fetchJSON('/api/settings/mode', { mode: radio.value }).catch(() => {});
      statusEl.textContent = `Режим: ${radio.value}`;
    }),
  );
}

async function handleRegister() {
  const username = usernameInput.value.trim();
  const displayName = displayNameInput.value.trim() || username;
  if (!username) return alert('Введите username');
  currentMode = 'register';
  setStep('options', 'running', 'Запрашиваем options...');
  try {
    const options = await fetchJSON('/api/register/options', { username, displayName });
    setStep('options', 'ok', 'Получены options');
    timelineCard.classList.remove('hidden');
    const publicKey = prepareRegistrationOptions(options);
    setStep('webauthn', 'running', 'Коснитесь ключа...');
    const cred = await navigator.credentials.create({ publicKey });
    const credentialJSON = publicKeyCredentialToJSON(cred);
    rawEl.textContent = pretty(credentialJSON);
    dataCards.forEach((c) => c.classList.remove('hidden'));
    setStep('webauthn', 'ok', 'Credential создан');

    setStep('verify', 'running', 'Отправляем на сервер...');
    const verification = await fetchJSON('/api/register/verify', {
      username,
      attestationResponse: credentialJSON,
    });
    serverEl.textContent = pretty(verification);
    dataCards.forEach((c) => c.classList.remove('hidden'));
    setStep('verify', verification.verified ? 'ok' : 'fail', verification.verified ? 'Проверено' : 'Ошибка проверки');
    setStep('done', verification.verified ? 'ok' : 'fail', verification.verified ? 'Готово' : 'Ошибка');
    statusEl.textContent = verification.verified ? 'Регистрация успешна — можно входить' : 'Не удалось зарегистрировать';
    if (verification.verified) {
      setTab('login');
      await loadSession();
    }
  } catch (err) {
    serverEl.textContent = err.message;
    setStep('verify', 'fail', err.message);
    setStep('done', 'fail', 'Ошибка');
    statusEl.textContent = err.message;
  }
}

async function handleLogin() {
  const username = usernameInput.value.trim();
  if (!username) return alert('Введите username');
  currentMode = 'login';
  setStep('options', 'running', 'Запрашиваем options...');
  try {
    const options = await fetchJSON('/api/login/options', { username });
    setStep('options', 'ok', 'Получены options');
    timelineCard.classList.remove('hidden');
    const publicKey = prepareAuthenticationOptions(options);
    setStep('webauthn', 'running', 'Коснитесь ключа...');
    const assertion = await navigator.credentials.get({ publicKey });
    const assertionJSON = publicKeyCredentialToJSON(assertion);
    rawEl.textContent = pretty(assertionJSON);
    dataCards.forEach((c) => c.classList.remove('hidden'));
    setStep('webauthn', 'ok', 'Assertion получен');

    setStep('verify', 'running', 'Проверяем на сервере...');
    const verification = await fetchJSON('/api/login/verify', {
      username,
      assertionResponse: assertionJSON,
    });
    serverEl.textContent = pretty(verification);
    dataCards.forEach((c) => c.classList.remove('hidden'));
    setStep('verify', verification.verified ? 'ok' : 'fail', verification.verified ? 'Подтверждено' : 'Ошибка');
    setStep('done', verification.verified ? 'ok' : 'fail', verification.verified ? 'Вход выполнен' : 'Ошибка');
    statusEl.textContent = verification.verified ? 'Вход выполнен' : 'Не удалось войти';
    await loadSession();
  } catch (err) {
    serverEl.textContent = err.message;
    setStep('verify', 'fail', err.message);
    setStep('done', 'fail', 'Ошибка');
    statusEl.textContent = err.message;
  }
}

async function handleLogout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
  statusEl.textContent = 'Сессия завершена';
  await loadSession();
  resetUI();
}

function resetUI() {
  stepState = {};
  rawEl.textContent = '';
  serverEl.textContent = '';
  statusEl.textContent = '';
  renderSteps();
  dataCards.forEach((c) => c.classList.add('hidden'));
  timelineCard.classList.add('hidden');
}

registerBtn.addEventListener('click', handleRegister);
loginBtn.addEventListener('click', handleLogin);
logoutBtn.addEventListener('click', handleLogout);
sessionLogoutBtn.addEventListener('click', handleLogout);
sessionLoginBtn.addEventListener('click', () => setTab('login'));
resetBtn.addEventListener('click', resetUI);

renderSteps();
setTab('register');
loadSettings();
loadSession();
