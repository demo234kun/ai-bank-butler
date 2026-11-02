import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { UserProfile } from '@bank/shared';
import { config, ensureDirs } from '../config';
import { clock } from './clock';
import { createSeededState } from './seed';
import type { BankState } from './state';
import { hashPassword } from '../security/password';

export const DEMO_USER_ID = 'u_chenyu';
export const DEMO_PHONE = '13800006677';
export const DEMO_PASSWORD = 'demo1234';

export interface AuthUser {
  id: string;
  name: string;
  phone: string;
  phoneMasked: string;
  passwordSalt: string;
  passwordHash: string;
  isGuest: boolean;
  createdAt: string;
  spouseName: string;
  spouseBirthday: string;
  riskLevel: UserProfile['riskProfile']['level'];
  webauthn?: WebAuthnCredential[];
}

/** 本机生物识别（Windows Hello / Touch ID / Face ID / 指纹）注册出来的通行密钥 */
export interface WebAuthnCredential {
  id: string;
  publicKey: string;
  counter: number;
  registeredAt: string;
  label: string;
  transports: string[];
}

export interface AuthSession {
  id: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string;
  ip: string;
}

export interface UserBundle {
  auth: AuthUser;
  bank: BankState;
}

interface PersistedStore {
  version: number;
  demoNow: string;
  users: Record<string, UserBundle>;
  sessions: Record<string, AuthSession>;
}

const STORE_VERSION = 3;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STORE_FILE = () => path.join(config.runtimeDir, 'store.json');

let data: PersistedStore | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function seedFromString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function bankFor(auth: AuthUser): BankState {
  return createSeededState({
    userId: auth.id,
    name: auth.name,
    phoneMasked: auth.phoneMasked,
    tier: auth.isGuest || auth.id === DEMO_USER_ID ? '私人银行 · 金桂级' : '数字银行 · 金卡',
    spouseName: auth.spouseName,
    spouseBirthday: auth.spouseBirthday,
    riskLevel: auth.riskLevel,
    seed: auth.isGuest || auth.id === DEMO_USER_ID ? 20261030 : seedFromString(auth.id),
  });
}

function makeAuth(input: {
  id: string;
  name: string;
  phone: string;
  passwordSalt: string;
  passwordHash: string;
  isGuest: boolean;
  spouseName: string;
  spouseBirthday: string;
  riskLevel: UserProfile['riskProfile']['level'];
}): AuthUser {
  return {
    id: input.id,
    name: input.name,
    phone: input.phone,
    phoneMasked: `${input.phone.slice(0, 3)}****${input.phone.slice(-4)}`,
    passwordSalt: input.passwordSalt,
    passwordHash: input.passwordHash,
    isGuest: input.isGuest,
    createdAt: clock.nowIso(),
    spouseName: input.spouseName,
    spouseBirthday: input.spouseBirthday,
    riskLevel: input.riskLevel,
  };
}

function createDemoBundle(): UserBundle {
  const demo = hashPassword(DEMO_PASSWORD);
  const auth = makeAuth({
    id: DEMO_USER_ID,
    name: '陈屿',
    phone: DEMO_PHONE,
    passwordSalt: demo.salt,
    passwordHash: demo.hash,
    isGuest: false,
    spouseName: '林晚',
    spouseBirthday: '1992-11-02',
    riskLevel: '稳健型',
  });
  return { auth, bank: bankFor(auth) };
}

function seedStore(): PersistedStore {
  const demo = createDemoBundle();
  return {
    version: STORE_VERSION,
    demoNow: config.demoNow,
    users: { [demo.auth.id]: demo },
    sessions: {},
  };
}

function loadFromDisk(): PersistedStore | null {
  try {
    const file = STORE_FILE();
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<PersistedStore>;
    if (!parsed.users) return null;
    if (parsed.version === 2) {
      return {
        version: STORE_VERSION,
        demoNow: parsed.demoNow ?? config.demoNow,
        users: parsed.users,
        sessions: {},
      };
    }
    if (parsed.version === STORE_VERSION && parsed.users) {
      return {
        version: STORE_VERSION,
        demoNow: parsed.demoNow ?? config.demoNow,
        users: parsed.users,
        sessions: parsed.sessions ?? {},
      };
    }
    return null;
  } catch {
    return null;
  }
}

function ensureData(): PersistedStore {
  if (data) return data;
  ensureDirs();
  const loaded = loadFromDisk();
  data = loaded ?? seedStore();
  let changed = !loaded;
  // 结构演进只做补齐，不重置已有账户数据（争议工单为新增字段）
  for (const bundle of Object.values(data.users)) {
    if (!Array.isArray(bundle.bank.disputes)) {
      bundle.bank.disputes = [];
      changed = true;
    }
    if (!Array.isArray(bundle.bank.notifications)) {
      bundle.bank.notifications = [];
      changed = true;
    }
    if (!Array.isArray(bundle.auth.webauthn)) {
      bundle.auth.webauthn = [];
      changed = true;
    }
  }
  if (!data.users[DEMO_USER_ID]) {
    data.users[DEMO_USER_ID] = createDemoBundle();
    changed = true;
  }
  if (data.demoNow !== config.demoNow) {
    for (const bundle of Object.values(data.users)) {
      bundle.bank = bankFor(bundle.auth);
    }
    data.demoNow = config.demoNow;
    changed = true;
  }
  const now = clock.wallNow().getTime();
  for (const [id, session] of Object.entries(data.sessions)) {
    if (!data.users[session.userId] || new Date(session.expiresAt).getTime() <= now) {
      delete data.sessions[id];
      changed = true;
    }
  }
  if (changed) saveNow();
  return data;
}

export function getState(userId: string = DEMO_USER_ID): BankState {
  const store = ensureData();
  const bundle = store.users[userId];
  if (!bundle) throw new Error(`USER_NOT_FOUND:${userId}`);
  return bundle.bank;
}

export function getAuthUser(userId: string): AuthUser | undefined {
  return ensureData().users[userId]?.auth;
}

export function findUserByPhone(phone: string): UserBundle | undefined {
  return Object.values(ensureData().users).find((bundle) => bundle.auth.phone === phone);
}

export function listAuthUsers(): AuthUser[] {
  return Object.values(ensureData().users).map((bundle) => bundle.auth);
}

export function createRegisteredUser(input: {
  name: string;
  phone: string;
  password: string;
  spouseName?: string;
  spouseBirthday?: string;
}): UserBundle {
  const store = ensureData();
  if (findUserByPhone(input.phone)) throw new Error('PHONE_EXISTS');
  const id = `u_${randomUUID().slice(0, 10)}`;
  const password = hashPassword(input.password);
  const auth = makeAuth({
    id,
    name: input.name,
    phone: input.phone,
    passwordSalt: password.salt,
    passwordHash: password.hash,
    isGuest: false,
    spouseName: input.spouseName?.trim() || '林晚',
    spouseBirthday: input.spouseBirthday?.trim() || '1992-11-02',
    // 新用户未测评前先按最低适当性等级放置，测评完成后才会放开
    riskLevel: '保守型',
  });
  const bundle: UserBundle = { auth, bank: bankFor(auth) };
  bundle.bank.user.riskProfile = { level: '保守型', score: 0, assessedAt: '' };
  store.users[id] = bundle;
  saveNow();
  return bundle;
}

export function createGuestUser(): UserBundle {
  const store = ensureData();
  let phone = '';
  do {
    phone = `139${String(Math.floor(10000000 + Math.random() * 89999999))}`;
  } while (findUserByPhone(phone));
  const password = hashPassword(randomBytes(24).toString('hex'));
  const auth = makeAuth({
    id: `u_guest_${randomUUID().slice(0, 8)}`,
    name: '陈屿',
    phone,
    passwordSalt: password.salt,
    passwordHash: password.hash,
    isGuest: true,
    spouseName: '林晚',
    spouseBirthday: '1992-11-02',
    riskLevel: '稳健型',
  });
  const bundle: UserBundle = { auth, bank: bankFor(auth) };
  store.users[auth.id] = bundle;
  saveNow();
  return bundle;
}

export function updateUserProfile(
  userId: string,
  patch: {
    name?: string;
    spouseName?: string;
    spouseBirthday?: string;
  },
): UserBundle {
  const store = ensureData();
  const bundle = store.users[userId];
  if (!bundle) throw new Error('USER_NOT_FOUND');
  if (patch.name?.trim()) {
    bundle.auth.name = patch.name.trim().slice(0, 20);
    bundle.bank.user.name = bundle.auth.name;
  }
  if (patch.spouseName?.trim()) {
    bundle.auth.spouseName = patch.spouseName.trim().slice(0, 20);
    bundle.bank.user.spouse.name = bundle.auth.spouseName;
    const contact = bundle.bank.user.contacts.find((c) => c.id === 'ct_spouse');
    if (contact) contact.name = bundle.auth.spouseName;
  }
  if (patch.spouseBirthday?.trim()) {
    bundle.auth.spouseBirthday = patch.spouseBirthday.trim();
    bundle.bank.user.spouse.birthday = bundle.auth.spouseBirthday;
  }
  saveNow();
  return bundle;
}

/**
 * 风险测评结果只能由测评流程写入：
 * 直接改 level 会绕过适当性管理，/api/profile 已拒绝该字段。
 */
export function updateRiskAssessment(
  userId: string,
  result: {
    score: number;
    level: UserProfile['riskProfile']['level'];
    assessedAt: string;
  },
): UserBundle {
  const store = ensureData();
  const bundle = store.users[userId];
  if (!bundle) throw new Error('USER_NOT_FOUND');
  const score = Math.max(0, Math.min(100, Math.round(result.score)));
  bundle.auth.riskLevel = result.level;
  bundle.bank.user.riskProfile = {
    level: result.level,
    score,
    assessedAt: result.assessedAt,
  };
  saveNow();
  return bundle;
}

export function createAuthSession(
  userId: string,
  meta: { userAgent?: string; ip?: string } = {},
): AuthSession {
  const store = ensureData();
  if (!store.users[userId]) throw new Error('USER_NOT_FOUND');
  const now = clock.wallNow();
  const session: AuthSession = {
    id: `ses_${randomUUID().slice(0, 12)}`,
    userId,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    userAgent: (meta.userAgent ?? '').slice(0, 240),
    ip: (meta.ip ?? '').slice(0, 80),
  };
  store.sessions[session.id] = session;
  saveNow();
  return session;
}

export function getAuthSession(sessionId: string): AuthSession | undefined {
  const session = ensureData().sessions[sessionId];
  if (!session) return undefined;
  if (new Date(session.expiresAt).getTime() <= clock.wallNow().getTime()) {
    delete ensureData().sessions[sessionId];
    return undefined;
  }
  return session;
}

export function touchAuthSession(sessionId: string): void {
  const session = ensureData().sessions[sessionId];
  if (!session) return;
  const now = clock.wallNow();
  if (now.getTime() - new Date(session.lastSeenAt).getTime() < 60_000) return;
  session.lastSeenAt = now.toISOString();
  persist();
}

export function listAuthSessions(userId: string): AuthSession[] {
  return Object.values(ensureData().sessions)
    .filter(
      (session) =>
        session.userId === userId &&
        new Date(session.expiresAt).getTime() > clock.wallNow().getTime(),
    )
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
}

export function revokeAuthSession(sessionId: string): boolean {
  const store = ensureData();
  if (!store.sessions[sessionId]) return false;
  delete store.sessions[sessionId];
  saveNow();
  return true;
}

export function revokeUserSessions(userId: string, exceptSessionId?: string): number {
  const store = ensureData();
  let count = 0;
  for (const [id, session] of Object.entries(store.sessions)) {
    if (session.userId === userId && id !== exceptSessionId) {
      delete store.sessions[id];
      count += 1;
    }
  }
  if (count) saveNow();
  return count;
}

export function updateUserPassword(userId: string, password: string): UserBundle {
  const store = ensureData();
  const bundle = store.users[userId];
  if (!bundle) throw new Error('USER_NOT_FOUND');
  const hashed = hashPassword(password);
  bundle.auth.passwordSalt = hashed.salt;
  bundle.auth.passwordHash = hashed.hash;
  saveNow();
  return bundle;
}

export function resetUserState(userId: string): BankState {
  const store = ensureData();
  const bundle = store.users[userId];
  if (!bundle) throw new Error('USER_NOT_FOUND');
  bundle.bank = bankFor(bundle.auth);
  saveNow();
  return bundle.bank;
}

export function saveNow(): void {
  if (!data) return;
  ensureDirs();
  const target = STORE_FILE();
  const tmp = `${target}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, target);
  } catch {
    try {
      fs.writeFileSync(target, JSON.stringify(data), 'utf8');
    } catch {
      // 展示原型：持久化失败不阻断内存事务
    }
  }
}

export function persist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 100);
}

/** 仅用于本地演示/测试的重置，不改认证账号。 */
export function resetDemoDataOnly(): void {
  ensureDirs();
  clock.reset();
  data = seedStore();
  saveNow();
}

export function listWebAuthnCredentials(userId: string): WebAuthnCredential[] {
  return ensureData().users[userId]?.auth.webauthn ?? [];
}

export function addWebAuthnCredential(userId: string, credential: WebAuthnCredential): WebAuthnCredential[] {
  const store = ensureData();
  const bundle = store.users[userId];
  if (!bundle) throw new Error('USER_NOT_FOUND');
  bundle.auth.webauthn = [
    ...(bundle.auth.webauthn ?? []).filter((item) => item.id !== credential.id),
    credential,
  ].slice(-5);
  saveNow();
  return bundle.auth.webauthn;
}

export function removeWebAuthnCredential(userId: string, credentialId: string): WebAuthnCredential[] {
  const bundle = ensureData().users[userId];
  if (!bundle) throw new Error('USER_NOT_FOUND');
  bundle.auth.webauthn = (bundle.auth.webauthn ?? []).filter((item) => item.id !== credentialId);
  saveNow();
  return bundle.auth.webauthn;
}

export function bumpWebAuthnCounter(userId: string, credentialId: string, counter: number): void {
  const credential = ensureData().users[userId]?.auth.webauthn?.find((item) => item.id === credentialId);
  if (credential) {
    credential.counter = counter;
    saveNow();
  }
}
