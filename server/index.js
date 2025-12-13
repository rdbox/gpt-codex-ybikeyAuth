import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import dotenv from 'dotenv';
import { randomBytes } from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { initStorage, upsertUser, getUser, saveUser, listUsers, setChallenge, popChallenge } from './storage.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;
const RP_ID = process.env.RP_ID || 'localhost';
const RP_NAME = process.env.RP_NAME || 'YubiKey Auth Demo';
const ORIGIN = process.env.ORIGIN || `http://localhost:${PORT}`;
const ATTESTATION = process.env.ATTESTATION || 'none';
const AUTH_MODE = process.env.AUTH_MODE || 'touch_only'; // touch_only | pin_required | preferred
const LOCK_SETTINGS = process.env.LOCK_SETTINGS === 'true';
const SESSION_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');

const modeToUV = {
  touch_only: 'discouraged',
  pin_required: 'required',
  preferred: 'preferred',
};

let currentMode = AUTH_MODE in modeToUV ? AUTH_MODE : 'touch_only';

app.use(
  cors({
    origin: ORIGIN,
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
  }),
);

app.use(express.static(path.join(__dirname, '..', 'public')));

const toBase64url = (val) => {
  if (!val) return '';
  if (typeof val === 'string') return val;
  return Buffer.from(val).toString('base64url');
};

const fromBase64 = (val) => Buffer.from(val, 'base64');

const validateUsername = (username) => {
  if (typeof username !== 'string') return null;
  const trimmed = username.trim();
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(trimmed)) return null;
  return trimmed;
};

// SETTINGS
app.get('/api/settings', (req, res) => {
  res.json({
    modes: [
      { id: 'touch_only', name: 'Только касание', userVerification: 'discouraged' },
      { id: 'pin_required', name: 'PIN обязателен', userVerification: 'required' },
      { id: 'preferred', name: 'Авто', userVerification: 'preferred' },
    ],
    protocols: [
      { id: 'webauthn', name: 'WebAuthn/FIDO2', enabled: true },
      { id: 'u2f', name: 'FIDO U2F', enabled: true },
    ],
    currentMode,
    currentProtocol: 'webauthn',
    canChangeMode: !LOCK_SETTINGS,
    isLocked: LOCK_SETTINGS,
  });
});

app.post('/api/settings/mode', (req, res) => {
  if (LOCK_SETTINGS) return res.status(403).json({ error: 'Настройки заблокированы' });
  const { mode } = req.body || {};
  if (!mode || !(mode in modeToUV)) return res.status(400).json({ error: 'Некорректный режим' });
  currentMode = mode;
  res.json({ success: true, currentMode });
});

// REGISTER OPTIONS
app.post('/api/register/options', async (req, res) => {
  const { username, displayName } = req.body || {};
  const safeName = validateUsername(username);
  if (!safeName) return res.status(400).json({ error: 'Некорректное имя пользователя' });

  const user = await upsertUser(safeName.toLowerCase(), displayName || safeName);

  const options = generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    user: {
      id: fromBase64(user.id),
      name: user.username,
      displayName: user.displayName,
    },
    attestationType: ATTESTATION,
    authenticatorSelection: {
      authenticatorAttachment: 'cross-platform',
      residentKey: 'discouraged',
      userVerification: modeToUV[currentMode],
      requireResidentKey: false,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -8 },
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
  });

  const challenge = options.challenge ?? randomBytes(32);
  const responsePayload = {
    challenge: toBase64url(challenge),
    rp: { name: RP_NAME, id: RP_ID },
    user: {
      id: toBase64url(options.user.id),
      name: user.username,
      displayName: user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams,
    excludeCredentials: (options.excludeCredentials || []).map((cred) => ({
      id: toBase64url(cred.id),
      type: cred.type,
      transports: ['usb', 'nfc', 'ble', 'internal'],
    })),
    authenticatorSelection: options.authenticatorSelection,
    attestation: options.attestation,
    extensions: options.extensions,
    timeout: options.timeout || 120000,
  };

  await setChallenge(safeName, responsePayload.challenge);
  res.json(responsePayload);
});

// REGISTER VERIFY
app.post('/api/register/verify', async (req, res) => {
  const { username, attestationResponse } = req.body || {};
  const safeName = validateUsername(username);
  if (!safeName || !attestationResponse) return res.status(400).json({ error: 'Некорректные данные регистрации' });

  const expectedChallenge = await popChallenge(safeName);
  if (!expectedChallenge) return res.status(400).json({ error: 'Challenge не найден или просрочен' });

  const user = await getUser(safeName);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  try {
    const verification = await verifyRegistrationResponse({
      response: attestationResponse,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: currentMode === 'pin_required',
    });

    if (verification.verified) {
      const { registrationInfo } = verification;
      const {
        credentialID,
        credentialPublicKey,
        counter,
        credentialDeviceType,
        credentialBackedUp,
        aaguid,
      } = registrationInfo;
      const credentialIdBase64url = credentialID.toString('base64url');
      const exists = (user.credentials || []).find((c) => c.credentialID === credentialIdBase64url);
      if (!exists) {
        user.credentials = user.credentials || [];
        user.credentials.push({
          credentialID: credentialIdBase64url,
          credentialPublicKey: credentialPublicKey.toString('base64'),
          counter,
          transports: attestationResponse.response?.transports || ['usb'],
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          aaguid: aaguid || '',
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
        });
        await saveUser(user);
      }
    }

    req.session.user = { username: user.username, displayName: user.displayName };
    res.json({ verified: verification.verified, registrationInfo: verification.registrationInfo });
  } catch (error) {
    res.status(400).json({ error: 'Ошибка проверки регистрации', details: error.message });
  }
});

// LOGIN OPTIONS
app.post('/api/login/options', async (req, res) => {
  const { username } = req.body || {};
  const safeName = validateUsername(username);
  if (!safeName) return res.status(400).json({ error: 'Некорректное имя пользователя' });
  const user = await getUser(safeName);
  if (!user || !user.credentials || user.credentials.length === 0) {
    return res.status(404).json({ error: 'Пользователь не найден или нет credential' });
  }

  const options = generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: modeToUV[currentMode],
    allowCredentials: user.credentials.map((cred) => ({
      id: Buffer.from(cred.credentialID, 'base64url'),
      type: 'public-key',
      transports: cred.transports || ['usb'],
    })),
    timeout: 120000,
  });

  const challenge = options.challenge ?? randomBytes(32);
  const responsePayload = {
    challenge: toBase64url(challenge),
    rpId: options.rpID,
    allowCredentials: (options.allowCredentials || []).map((cred) => ({
      ...cred,
      id: toBase64url(cred.id),
      transports: cred.transports || ['usb'],
    })),
    timeout: options.timeout || 120000,
    userVerification: options.userVerification,
    extensions: options.extensions,
  };

  await setChallenge(safeName, responsePayload.challenge);
  res.json(responsePayload);
});

// LOGIN VERIFY
app.post('/api/login/verify', async (req, res) => {
  const { username, assertionResponse } = req.body || {};
  const safeName = validateUsername(username);
  if (!safeName || !assertionResponse) return res.status(400).json({ error: 'Некорректные данные авторизации' });

  const expectedChallenge = await popChallenge(safeName);
  if (!expectedChallenge) return res.status(400).json({ error: 'Challenge не найден или просрочен' });

  const user = await getUser(safeName);
  if (!user || !user.credentials || user.credentials.length === 0) {
    return res.status(404).json({ error: 'Пользователь не найден или нет credential' });
  }

  const credId = assertionResponse.id;
  const authenticator = user.credentials.find((c) => c.credentialID === credId);
  if (!authenticator) return res.status(400).json({ error: 'Credential не найден' });

  try {
    const verification = await verifyAuthenticationResponse({
      response: assertionResponse,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: currentMode === 'pin_required',
      authenticator: {
        credentialID: Buffer.from(authenticator.credentialID, 'base64url'),
        credentialPublicKey: fromBase64(authenticator.credentialPublicKey),
        counter: authenticator.counter,
        transports: authenticator.transports,
      },
    });

    if (verification.verified) {
      authenticator.counter = verification.authenticationInfo.newCounter;
      authenticator.lastUsed = new Date().toISOString();
      await saveUser(user);
    }

    req.session.user = { username: user.username, displayName: user.displayName };
    res.json({ verified: verification.verified, authenticationInfo: verification.authenticationInfo });
  } catch (error) {
    res.status(400).json({ error: 'Ошибка проверки авторизации', details: error.message });
  }
});

// USERS LIST
app.get('/api/users', async (req, res) => {
  const users = await listUsers();
  res.json(
    users.map((u) => ({
      username: u.username,
      displayName: u.displayName,
      credentialsCount: (u.credentials || []).length,
    })),
  );
});

// CURRENT USER
app.get('/api/user', (req, res) => {
  if (req.session.user) return res.json(req.session.user);
  return res.status(401).json({ error: 'Не авторизован' });
});

// LOGOUT
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// FALLBACK
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const start = async () => {
  await initStorage();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
};

start();
