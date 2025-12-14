import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '..', 'data');
const usersFile = path.join(dataDir, 'users.json');
const challengesFile = path.join(dataDir, 'challenges.json');

async function ensureFiles() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(usersFile);
  } catch {
    await fs.writeFile(usersFile, '{}', 'utf8');
  }
  try {
    await fs.access(challengesFile);
  } catch {
    await fs.writeFile(challengesFile, '{}', 'utf8');
  }
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

async function writeJson(filePath, data) {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}

function toBuffer(val) {
  if (!val) return null;
  if (Buffer.isBuffer(val)) return Buffer.from(val);
  if (Array.isArray(val)) {
    const bytes = val.filter((n) => Number.isFinite(n) && n >= 0 && n <= 255);
    return bytes.length ? Buffer.from(bytes) : null;
  }
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;

  // Legacy format: "26,156,19,..."
  if (trimmed.includes(',')) {
    const bytes = trimmed
      .split(',')
      .map((v) => parseInt(v.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 255);
    if (bytes.length) return Buffer.from(bytes);
  }

  // Try base64 / base64url
  try {
    return Buffer.from(trimmed, 'base64');
  } catch {
    /* ignore */
  }
  try {
    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64');
  } catch {
    return null;
  }
}

function normalizeCredential(raw) {
  const cred = { ...raw };
  let changed = false;

  const idBuf = toBuffer(cred.credentialID || cred.id);
  if (!idBuf) return { credential: null, changed: true };
  const nextId = idBuf.toString('base64url');
  if (nextId !== cred.credentialID) {
    cred.credentialID = nextId;
    changed = true;
  } else {
    cred.credentialID = nextId;
  }

  const pkBuf = toBuffer(cred.credentialPublicKey);
  if (!pkBuf) return { credential: null, changed: true };
  const nextPk = pkBuf.toString('base64');
  if (nextPk !== cred.credentialPublicKey) {
    cred.credentialPublicKey = nextPk;
    changed = true;
  }

  if (!Array.isArray(cred.transports) || cred.transports.length === 0) {
    cred.transports = ['usb', 'nfc', 'ble'];
    changed = true;
  }

  if (!Number.isFinite(cred.counter)) {
    cred.counter = 0;
    changed = true;
  }

  return { credential: cred, changed };
}

function normalizeUser(user) {
  if (!user) return { user: null, changed: false };
  const normalized = { ...user };
  let changed = false;
  const credentials = Array.isArray(user.credentials) ? user.credentials : [];

  const normalizedCreds = [];
  credentials.forEach((cred) => {
    const { credential, changed: credChanged } = normalizeCredential(cred);
    if (credential) normalizedCreds.push(credential);
    if (credChanged) changed = true;
  });

  if (normalizedCreds.length !== credentials.length) changed = true;
  normalized.credentials = normalizedCreds;

  return { user: normalized, changed };
}

async function readUsersNormalized() {
  const users = await readJson(usersFile);
  let changed = false;
  const normalizedUsers = {};

  Object.entries(users).forEach(([username, user]) => {
    const { user: normalizedUser, changed: userChanged } = normalizeUser(user);
    if (normalizedUser) normalizedUsers[username] = normalizedUser;
    if (userChanged) changed = true;
  });

  if (changed) {
    await writeJson(usersFile, normalizedUsers);
  }

  return normalizedUsers;
}

export async function initStorage() {
  await ensureFiles();
}

export async function upsertUser(username, displayName) {
  const users = await readUsersNormalized();
  if (!users[username]) {
    users[username] = {
      id: randomBytes(16).toString('base64'),
      username,
      displayName: displayName || username,
      credentials: [],
      createdAt: new Date().toISOString(),
    };
    await writeJson(usersFile, users);
  }
  return users[username];
}

export async function getUser(username) {
  const users = await readUsersNormalized();
  return users[username] || null;
}

export async function saveUser(user) {
  const users = await readUsersNormalized();
  const { user: normalizedUser } = normalizeUser(user);
  if (!normalizedUser) return;
  users[normalizedUser.username] = normalizedUser;
  await writeJson(usersFile, users);
}

export async function listUsers() {
  const users = await readUsersNormalized();
  return Object.values(users);
}

export async function setChallenge(username, challenge) {
  const challenges = await readJson(challengesFile);
  challenges[username] = challenge;
  await writeJson(challengesFile, challenges);
}

export async function popChallenge(username) {
  const challenges = await readJson(challengesFile);
  const value = challenges[username];
  if (value) {
    delete challenges[username];
    await writeJson(challengesFile, challenges);
  }
  return value;
}
