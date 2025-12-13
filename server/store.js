import { randomUUID } from 'crypto';

class InMemoryStore {
  constructor() {
    this.users = new Map(); // username -> user object
    this.challenges = new Map(); // username -> last challenge
  }

  upsertUser(username) {
    const key = username.toLowerCase();
    if (!this.users.has(key)) {
      this.users.set(key, {
        username,
        userId: randomUUID(),
        credentials: [],
        createdAt: new Date().toISOString(),
      });
    }
    return this.users.get(key);
  }

  getUser(username) {
    if (!username) return null;
    return this.users.get(username.toLowerCase()) || null;
  }

  setChallenge(username, challenge) {
    this.challenges.set(username.toLowerCase(), challenge);
  }

  popChallenge(username) {
    const key = username.toLowerCase();
    const value = this.challenges.get(key);
    this.challenges.delete(key);
    return value;
  }
}

export const db = new InMemoryStore();
