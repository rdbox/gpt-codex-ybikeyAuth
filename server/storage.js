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

export async function initStorage() {
  await ensureFiles();
}

export async function upsertUser(username, displayName) {
  const users = await readJson(usersFile);
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
  const users = await readJson(usersFile);
  return users[username] || null;
}

export async function saveUser(user) {
  const users = await readJson(usersFile);
  users[user.username] = user;
  await writeJson(usersFile, users);
}

export async function listUsers() {
  const users = await readJson(usersFile);
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
