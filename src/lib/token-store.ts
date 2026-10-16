import fs from 'fs';
import path from 'path';

const STORE_PATH = path.join(process.cwd(), '.data', 'token-cache.json');

interface TokenEntry {
  key: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  updatedAt: number;
}

interface TokenStore {
  tokens: Record<string, TokenEntry>;
  lastFlushed: number;
}

function readStore(): TokenStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {
    console.warn('[token-store] Failed to read, starting fresh');
  }
  return { tokens: {}, lastFlushed: Date.now() };
}

function writeStore(store: TokenStore): void {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    store.lastFlushed = Date.now();
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), { flag: 'w' });
  } catch (err) {
    console.error('[token-store] Write failed:', (err as Error).message);
  }
}

export function saveToken(key: string, entry: Omit<TokenEntry, 'key' | 'updatedAt'>): void {
  const store = readStore();
  store.tokens[key] = { ...entry, key, updatedAt: Date.now() };
  writeStore(store);
}

export function getToken(key: string): TokenEntry | null {
  const store = readStore();
  return store.tokens[key] || null;
}

export function getAllUserTokens(): TokenEntry[] {
  const store = readStore();
  return Object.values(store.tokens).filter((t) => t.key.startsWith('user:'));
}

export function getAllHubTokens(): TokenEntry[] {
  const store = readStore();
  return Object.values(store.tokens).filter((t) => t.key.startsWith('hub:'));
}

export function isTokenExpired(entry: TokenEntry): boolean {
  if (!entry.expiresAt) return false;
  return Date.now() > entry.expiresAt;
}

export function tokenRemainingHours(entry: TokenEntry): number {
  if (!entry.expiresAt) return 24;
  return (entry.expiresAt - Date.now()) / 3600000;
}

export function deleteToken(key: string): void {
  const store = readStore();
  delete store.tokens[key];
  writeStore(store);
}

export function getStoreStats() {
  const store = readStore();
  const userTokens = Object.keys(store.tokens).filter((k) => k.startsWith('user:')).length;
  const hubTokens = Object.keys(store.tokens).filter((k) => k.startsWith('hub:')).length;
  return {
    totalTokens: Object.keys(store.tokens).length,
    userTokens,
    hubTokens,
    lastFlushed: store.lastFlushed,
  };
}
