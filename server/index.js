import path from 'path';
import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { randomBytes } from 'crypto';
import { RP_ID, RP_NAME, ORIGIN, PORT, ATTESTATION } from './config.js';
import { db } from './store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({ logger: true });

fastify.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/',
});

const toBase64url = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return Buffer.from(value).toString('base64url');
};

const validateUsername = (username) => {
  if (typeof username !== 'string') return null;
  const trimmed = username.trim();
  if (!trimmed) return null;
  // ограничиваем простой алфанумерикой для демо
  const safe = trimmed.toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(safe)) return null;
  return safe;
};

fastify.post('/api/register/options', async (request, reply) => {
  const { username } = request.body || {};
  const safeName = validateUsername(username);
  if (!safeName) {
    return reply.code(400).send({ error: 'Некорректное имя пользователя' });
  }

  const user = db.upsertUser(safeName);

  const options = generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    user: {
      id: Buffer.from(user.userId, 'utf8'),
      name: user.username,
      displayName: user.username,
    },
    attestationType: ATTESTATION,
    authenticatorSelection: {
      residentKey: 'preferred',
      // просим не требовать PIN/UV для демо
      userVerification: 'discouraged',
    },
    excludeCredentials: user.credentials.map((cred) => ({
      id: Buffer.from(cred.credentialID, 'base64url'),
      type: 'public-key',
    })),
  });

  // Преобразуем двоичные поля в base64url-строки, чтобы фронт мог корректно декодировать
  const challenge = options.challenge ?? randomBytes(32);
  const userId = options.user?.id ?? Buffer.from(user.userId, 'utf8');
  const rp = { name: RP_NAME, id: RP_ID };
  const pubKeyCredParams =
    options.pubKeyCredParams && options.pubKeyCredParams.length
      ? options.pubKeyCredParams
      : [
          { type: 'public-key', alg: -8 },
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ];

  const responsePayload = {
    rp,
    user: {
      id: toBase64url(userId),
      name: user.username,
      displayName: user.username,
    },
    challenge: toBase64url(challenge),
    pubKeyCredParams,
    timeout: options.timeout,
    attestation: options.attestation,
    authenticatorSelection: options.authenticatorSelection,
    excludeCredentials: (options.excludeCredentials || []).map((cred) => ({
      ...cred,
      id: toBase64url(cred.id),
    })),
    extensions: options.extensions,
  };

  db.setChallenge(safeName, responsePayload.challenge);
  request.log.info(
    {
      route: 'register/options',
      username: safeName,
      challenge: responsePayload.challenge,
      user: responsePayload.user,
    },
    'registration options issued'
  );
  return responsePayload;
});

fastify.post('/api/register/verify', async (request, reply) => {
  const { username, attestationResponse } = request.body || {};
  const safeName = validateUsername(username);
  if (!safeName || !attestationResponse) {
    return reply.code(400).send({ error: 'Некорректные данные регистрации' });
  }

  const expectedChallenge = db.popChallenge(safeName);
  if (!expectedChallenge) {
    return reply.code(400).send({ error: 'Challenge не найден или просрочен' });
  }

  const user = db.getUser(safeName);
  if (!user) {
    return reply.code(404).send({ error: 'Пользователь не найден' });
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: attestationResponse,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
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
      const existing = user.credentials.find((c) => c.credentialID === credentialIdBase64url);
      if (!existing) {
        user.credentials.push({
          credentialID: credentialIdBase64url,
          publicKey: credentialPublicKey.toString('base64'),
          counter,
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          aaguid: aaguid || '',
          transports: attestationResponse.response?.transports || [],
          createdAt: new Date().toISOString(),
        });
      }
    }

    return verification;
  } catch (error) {
    request.log.error(error);
    return reply.code(400).send({ error: 'Ошибка проверки регистрации', details: error.message });
  }
});

fastify.post('/api/login/options', async (request, reply) => {
  const { username } = request.body || {};
  const safeName = validateUsername(username);
  if (!safeName) {
    return reply.code(400).send({ error: 'Некорректное имя пользователя' });
  }
  const user = db.getUser(safeName);
  if (!user || user.credentials.length === 0) {
    return reply.code(404).send({ error: 'Пользователь не найден или нет credential' });
  }

  const options = generateAuthenticationOptions({
    rpID: RP_ID,
    // просим не требовать PIN/UV для демо
    userVerification: 'discouraged',
    allowCredentials: user.credentials.map((cred) => ({
      id: Buffer.from(cred.credentialID, 'base64url'),
      type: 'public-key',
      transports: cred.transports || undefined,
    })),
    timeout: 60000,
  });

  const challenge = options.challenge ?? randomBytes(32);

  const responsePayload = {
    challenge: toBase64url(challenge),
    rpId: options.rpID,
    allowCredentials: (options.allowCredentials || []).map((cred) => ({
      ...cred,
      id: toBase64url(cred.id),
      transports: cred.transports || ['usb', 'nfc', 'ble', 'internal'],
    })),
    timeout: options.timeout,
    userVerification: options.userVerification,
    extensions: options.extensions,
  };

  db.setChallenge(safeName, responsePayload.challenge);
  return responsePayload;
});

fastify.post('/api/login/verify', async (request, reply) => {
  const { username, assertionResponse } = request.body || {};
  const safeName = validateUsername(username);
  if (!safeName || !assertionResponse) {
    return reply.code(400).send({ error: 'Некорректные данные авторизации' });
  }

  const expectedChallenge = db.popChallenge(safeName);
  if (!expectedChallenge) {
    return reply.code(400).send({ error: 'Challenge не найден или просрочен' });
  }

  const user = db.getUser(safeName);
  if (!user || user.credentials.length === 0) {
    return reply.code(404).send({ error: 'Пользователь не найден или нет credential' });
  }

  const credentialFromClient = assertionResponse.id;
  const authenticator = user.credentials.find((c) => c.credentialID === credentialFromClient);
  if (!authenticator) {
    return reply.code(400).send({ error: 'Credential не найден для пользователя' });
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response: assertionResponse,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
      authenticator: {
        credentialID: Buffer.from(authenticator.credentialID, 'base64url'),
        credentialPublicKey: Buffer.from(authenticator.publicKey, 'base64'),
        counter: authenticator.counter,
        transports: authenticator.transports,
      },
    });

    if (verification.verified) {
      authenticator.counter = verification.authenticationInfo.newCounter;
    }

    return verification;
  } catch (error) {
    request.log.error(error);
    return reply.code(400).send({ error: 'Ошибка проверки авторизации', details: error.message });
  }
});

fastify.get('/api/users/:username', async (request, reply) => {
  const { username } = request.params;
  const safeName = validateUsername(username);
  if (!safeName) {
    return reply.code(400).send({ error: 'Некорректное имя пользователя' });
  }
  const user = db.getUser(safeName);
  if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });
  return {
    username: user.username,
    createdAt: user.createdAt,
    credentials: user.credentials.map((c) => ({
      credentialID: c.credentialID,
      deviceType: c.deviceType,
      backedUp: c.backedUp,
      aaguid: c.aaguid,
      counter: c.counter,
      createdAt: c.createdAt,
    })),
  };
});

fastify.setNotFoundHandler((request, reply) => {
  // отдаём SPA главную страницу
  return reply.sendFile('index.html');
});

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`Server running on http://localhost:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
