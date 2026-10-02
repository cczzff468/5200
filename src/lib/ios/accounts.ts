'use client';

/**
 * 多账号系统（Task 40）：大号（main）/ 小号（alt）/ 匿名号码（anon）。
 *
 * 设计（数据隔离核心）：
 * - 每个账号一个独立的 IndexedDB 数据库：
 *   大号固定沿用 `ios-phone-db`（零迁移，现有数据全部保留）；
 *   小号/匿名号用 `ios-phone-db--{accountId}`（首次切换/创建时按需建库，schema 与大号一致）。
 *   聊天记录、联系人、记忆（mem-*）、朋友圈、钱包、QQ 空间、小助手会话等全部走 kv/contacts store
 *   → 换库即全量隔离，AI 与小号互为陌生人（大号的人设/记忆/聊天记录一条都不带过去）。
 * - 账号注册表 + 当前账号存 localStorage（设备级、跨账号共享）：
 *   `ios-phone-accounts` / `ios-phone-active-account`。
 * - 切换账号 = 写入当前账号 id → location.reload()：整页重启后 DB 层按新账号开库，
 *   天然「无残留」；刷新很快（纯本地应用），开机屏一闪而过。
 * - 少量必须按账号隔离的小型 localStorage 键（QQ 登录态、排队补跑回合）用
 *   accountScopedKey() 加后缀；大号保持原键名（向后兼容，登录态不丢）。
 * - 设备级配置（主题/字体/状态栏/API Key/TTS 等）不入账号库，切号共享——符合
 *   「不破坏字体等设置」的范围限定。
 */

export type AccountKind = 'main' | 'alt' | 'anon';

export interface PhoneAccount {
  /** 稳定 id：大号恒为 'main'，其余为创建时生成的 a{ts}{rand} */
  id: string;
  kind: AccountKind;
  /** 显示名：小号默认「小号N」，匿名号默认「匿名账号」；大号留空（各页面优先用本机资料/登录态实时显示） */
  name: string;
  /** 手机号（大号留空用本机资料；小号生成 11 位虚拟号；匿名号生成 10 位虚拟号） */
  phone: string;
  /** QQ 号（小号生成；匿名号同号复用） */
  qqId: string;
  /** 微信号（小号生成；匿名号同号复用） */
  wechatId: string;
  createdAt: number;
}

const REG_KEY = 'ios-phone-accounts';
export const ACTIVE_KEY = 'ios-phone-active-account';
export const MAIN_ACCOUNT_ID = 'main';

// ---------------- 工具 ----------------

function readLs(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeLs(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 存储异常静默：账号功能降级为仅大号
  }
}

/** 生成小号/匿名号的虚拟号码（本地随机，不保证电信唯一性——单机模拟场景足够） */
function genDigits(prefix: string, total: number): string {
  let s = prefix;
  while (s.length < total) s += Math.floor(Math.random() * 10).toString();
  return s;
}

function genWechatId(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = 'a';
  for (let i = 0; i < 9; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

// ---------------- 注册表 ----------------

/** 账号注册表（无则自动补大号条目；大号条目不删） */
export function getAccounts(): PhoneAccount[] {
  let list: PhoneAccount[] = [];
  try {
    const raw = readLs(REG_KEY);
    if (raw) list = JSON.parse(raw) as PhoneAccount[];
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) list = [];
  if (!list.some((a) => a && a.id === MAIN_ACCOUNT_ID)) {
    list.unshift({
      id: MAIN_ACCOUNT_ID,
      kind: 'main',
      name: '',
      phone: '',
      qqId: '',
      wechatId: '',
      createdAt: 0,
    });
  }
  return list;
}

function saveAccounts(list: PhoneAccount[]): void {
  writeLs(REG_KEY, JSON.stringify(list));
}

export function getAccountById(id: string): PhoneAccount | null {
  return getAccounts().find((a) => a.id === id) ?? null;
}

// ---------------- 当前账号 ----------------

/** 当前活跃账号 id（'main' = 大号，默认值；reload 后开机即按此开库） */
export function getActiveAccountId(): string {
  const v = readLs(ACTIVE_KEY);
  return v || MAIN_ACCOUNT_ID;
}

export function getActiveAccount(): PhoneAccount {
  const id = getActiveAccountId();
  return getAccountById(id) ?? getAccounts()[0];
}

/** 仅写标记（不 reload）；界面层切换请用 switchAccount() */
export function setActiveAccountId(id: string): void {
  writeLs(ACTIVE_KEY, id);
}

export function isMainAccount(): boolean {
  return getActiveAccountId() === MAIN_ACCOUNT_ID;
}

// ---------------- DB 名 / 键名派生 ----------------

/** 账号对应的 IndexedDB 库名：大号 = 'ios-phone-db'（与历史一致），其余加后缀 */
export function accountDbName(id: string): string {
  return id === MAIN_ACCOUNT_ID ? 'ios-phone-db' : `ios-phone-db--${id}`;
}

/**
 * 按账号隔离的 localStorage 键：大号返回原键（旧数据/登录态无缝兼容），
 * 其他账号返回 `${key}--${accountId}`。仅用于「按账号各存一份」的小型状态键。
 */
export function accountScopedKey(key: string): string {
  const id = getActiveAccountId();
  return id === MAIN_ACCOUNT_ID ? key : `${key}--${id}`;
}

// ---------------- 创建 / 删除 / 切换 ----------------

/**
 * 新建账号（alt=小号 / anon=匿名号码）并持久化注册表。
 * 不自动切换：调用方拿到 id 后可自行 switchAccount()。
 */
export function createAccount(kind: 'alt' | 'anon', name?: string): PhoneAccount {
  const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const list = getAccounts();
  const seq = list.filter((a) => a.kind === 'alt').length + 1;
  const acc: PhoneAccount =
    kind === 'anon'
      ? {
          id,
          kind: 'anon',
          name: (name ?? '').trim() || '匿名账号',
          phone: genDigits('32', 10),
          qqId: '',
          wechatId: '',
          createdAt: Date.now(),
        }
      : {
          id,
          kind: 'alt',
          name: (name ?? '').trim() || `小号${seq}`,
          phone: genDigits('1', 11),
          qqId: genDigits('3', 10),
          wechatId: genWechatId(),
          createdAt: Date.now(),
        };
  saveAccounts([...list, acc]);
  return acc;
}

/**
 * 删除账号：移出注册表 + 清理该账号的 localStorage 后缀键 + 删除其 IndexedDB。
 * 大号不可删；删除当前账号由调用方先 switchAccount(MAIN_ACCOUNT_ID)。
 */
export function deleteAccount(id: string): { ok: boolean; error?: string } {
  if (id === MAIN_ACCOUNT_ID) return { ok: false, error: '大号不能删除' };
  const list = getAccounts();
  const target = list.find((a) => a.id === id);
  if (!target) return { ok: false, error: '账号不存在' };
  if (id === getActiveAccountId()) return { ok: false, error: '不能删除当前登录的账号' };
  saveAccounts(list.filter((a) => a.id !== id));
  // 清理该账号的隔离 localStorage 键（统一后缀 --{id}）
  try {
    const suffix = `--${id}`;
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.endsWith(suffix)) doomed.push(k);
    }
    doomed.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // 忽略
  }
  try {
    // 删除其数据库（该库必然不是当前打开的库：非 active）
    indexedDB.deleteDatabase(accountDbName(id));
  } catch {
    // 忽略
  }
  return { ok: true };
}

/**
 * 切换账号（持久化 + 整页重启）：reload 后 DB 层按新账号开库，所有页面数据自然切换、零残留。
 * 用户看感 = 开机屏一闪 → 锁屏 → 解锁进入新账号（iOS 切换用户语义）。
 */
export function switchAccount(id: string): void {
  if (!getAccountById(id)) return;
  if (id === getActiveAccountId()) return;
  setActiveAccountId(id);
  // 兜底：800ms 内 reload 未触发（极端环境）不做额外处理——标记已写，下次启动生效
  window.location.reload();
}

/** 供账号页展示：返回该账号的显示名（大号回退「机主」，由页面用实时资料优先） */
export function accountDisplayName(acc: PhoneAccount): string {
  if (acc.id === MAIN_ACCOUNT_ID) return acc.name.trim() || '机主';
  return acc.name;
}
