const $ = (id) => document.getElementById(id);
const usernameInput = $('username');
const registerBtn = $('registerBtn');
const loginBtn = $('loginBtn');
const resetBtn = $('resetBtn');
const stepsEl = $('steps');
const rawEl = $('rawData');
const serverEl = $('serverData');

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

function setMode(mode) {
  currentMode = mode;
  stepState = {};
  renderSteps();
  rawEl.textContent = '';
  serverEl.textContent = '';
}

function renderSteps() {
  stepsEl.innerHTML = '';
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
  if (!opts.user || !opts.user.id) throw new Error('Пустой user.id в options регистрации');
  if (!opts.challenge) throw new Error('Пустой challenge в options регистрации');
  if (!opts.pubKeyCredParams || !opts.pubKeyCredParams.length) {
    throw new Error('Пустой pubKeyCredParams в options регистрации');
  }
  return {
    ...opts,
    pubKeyCredParams: opts.pubKeyCredParams,
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
    response: cred.response ? {
      attestationObject: cred.response.attestationObject
        ? bufferToBase64url(cred.response.attestationObject)
        : undefined,
      clientDataJSON: cred.response.clientDataJSON
        ? bufferToBase64url(cred.response.clientDataJSON)
        : undefined,
      authenticatorData: cred.response.authenticatorData
        ? bufferToBase64url(cred.response.authenticatorData)
        : undefined,
      signature: cred.response.signature
        ? bufferToBase64url(cred.response.signature)
        : undefined,
      userHandle: cred.response.userHandle
        ? bufferToBase64url(cred.response.userHandle)
        : undefined,
    } : {},
  };
}

async function fetchJSON(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || json.details || 'Запрос не удался');
  return json;
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

async function handleRegister() {
  const username = usernameInput.value.trim();
  if (!username) return alert('Введите username');
  setMode('register');
  setStep('options', 'running', 'Ждём challenge...');

  try {
    const options = await fetchJSON('/api/register/options', { username });
    setStep('options', 'ok', 'Challenge получен');

    const publicKey = prepareRegistrationOptions(options);
    setStep('webauthn', 'running', 'Ожидание касания YubiKey...');
    const cred = await navigator.credentials.create({ publicKey });
    const credentialJSON = publicKeyCredentialToJSON(cred);
    rawEl.textContent = pretty(credentialJSON);
    setStep('webauthn', 'ok', 'Credential создан');

    setStep('verify', 'running', 'Отправка на сервер...');
    const verification = await fetchJSON('/api/register/verify', {
      username,
      attestationResponse: credentialJSON,
    });
    serverEl.textContent = pretty(verification);
    setStep('verify', verification.verified ? 'ok' : 'fail', verification.verified ? 'Проверено' : 'Ошибка проверки');
    setStep('done', verification.verified ? 'ok' : 'fail', verification.verified ? 'Credential сохранён' : 'Не удалось сохранить');
  } catch (err) {
    console.error(err);
    serverEl.textContent = err.message;
    setStep('verify', 'fail', err.message);
    setStep('done', 'fail', 'Ошибка');
  }
}

async function handleLogin() {
  const username = usernameInput.value.trim();
  if (!username) return alert('Введите username');
  setMode('login');
  setStep('options', 'running', 'Ждём challenge...');

  try {
    const options = await fetchJSON('/api/login/options', { username });
    setStep('options', 'ok', 'Challenge получен');

    const publicKey = prepareAuthenticationOptions(options);
    setStep('webauthn', 'running', 'Коснитесь ключа для входа...');
    const assertion = await navigator.credentials.get({ publicKey });
    const assertionJSON = publicKeyCredentialToJSON(assertion);
    rawEl.textContent = pretty(assertionJSON);
    setStep('webauthn', 'ok', 'Assertion получен');

    setStep('verify', 'running', 'Проверяем подпись...');
    const verification = await fetchJSON('/api/login/verify', {
      username,
      assertionResponse: assertionJSON,
    });
    serverEl.textContent = pretty(verification);
    setStep('verify', verification.verified ? 'ok' : 'fail', verification.verified ? 'Подпись валидна' : 'Ошибка проверки');
    setStep('done', verification.verified ? 'ok' : 'fail', verification.verified ? 'Вход выполнен' : 'Не удалось войти');
  } catch (err) {
    console.error(err);
    serverEl.textContent = err.message;
    setStep('verify', 'fail', err.message);
    setStep('done', 'fail', 'Ошибка');
  }
}

function resetUI() {
  stepState = {};
  rawEl.textContent = '';
  serverEl.textContent = '';
  renderSteps();
}

registerBtn.addEventListener('click', handleRegister);
loginBtn.addEventListener('click', handleLogin);
resetBtn.addEventListener('click', resetUI);

renderSteps();
