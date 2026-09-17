/**
 * 世界书（World Book / Lorebook）—— 按关键词触发的静态设定库。
 *
 * 整体链路（「给 AI 挂载静态设定和世界观」需求）：
 * 1. 用户在「世界书」App 里维护若干本书，每本书含若干条目（触发词 + 设定内容）；
 * 2. 聊天界面（微信/QQ/信息）的聊天设置里，可以为联系人挂载任意多本书；
 * 3. 每次发送消息时扫描最近上下文，命中任一触发词且处于启用状态的条目被激活；
 * 4. 激活条目按「插入位置」分组、同位置按「优先级」降序拼接，注入到发送给 AI 的提示词中；
 * 5. 未命中的条目不参与发送——世界书内容不进记忆库，两者完全独立。
 *
 * 生效范围（scope，决定条目对哪些聊天生效）：
 * - global    全局：不绑定角色，所有聊天共享生效（无需挂载）；
 * - local     局部：仅当本书被挂载到当前联系人时生效；
 * - exclusive 专属：仅对条目上指定的那个联系人生效（无需挂载）。
 *
 * 插入位置（position，决定激活内容注入到提示词的哪个部分）：
 * - before_system 系统提示词之前 / after_system 系统提示词之后
 * - before_char   角色定义之前   / after_char   角色定义之后
 * - before_user   用户消息之前   / after_user   用户消息之后（包裹最后一条用户消息）
 *
 * 存储：书籍全量存 IndexedDB kv（键 worldbooks）；联系人挂载关系按联系人隔离
 * （键 wb-bind:<contactId>）。读写走 @/lib/ios/idb-kv 的内存写穿层（与朋友圈/记忆同层）。
 */

import { hasEmoji } from '@/lib/emoji';
import { kvDel, kvGet, kvSet } from './idb-kv';

// ---------------- 类型 ----------------

export const WB_POSITIONS = [
  'before_system',
  'after_system',
  'before_char',
  'after_char',
  'before_user',
  'after_user',
] as const;
export type WbPosition = (typeof WB_POSITIONS)[number];

export const WB_POSITION_LABELS: Record<WbPosition, string> = {
  before_system: '系统提示词之前',
  after_system: '系统提示词之后',
  before_char: '角色定义之前',
  after_char: '角色定义之后',
  before_user: '用户消息之前',
  after_user: '用户消息之后',
};

export const WB_SCOPES = ['global', 'local', 'exclusive'] as const;
export type WbScope = (typeof WB_SCOPES)[number];

export const WB_SCOPE_LABELS: Record<WbScope, string> = {
  global: '全局',
  local: '局部',
  exclusive: '专属',
};

/** 条目结构（条目名字仅本地显示，不发送给 AI） */
export interface WbEntry {
  id: string;
  /** 开关：关闭后永不发送 */
  enabled: boolean;
  /** 条目名字（仅本地显示） */
  name: string;
  /** 触发词：一个或多个关键词，命中任一即激活 */
  keywords: string[];
  /** 内容：激活后插入的设定文本 */
  content: string;
  /** 插入位置 */
  position: WbPosition;
  /** 生效范围 */
  scope: WbScope;
  /** scope === 'exclusive' 时的指定联系人 id */
  targetContactId?: string | null;
  /** 优先级：同一位置多条命中时数字大的排前面 */
  priority: number;
  /** 触发词匹配是否忽略大小写 */
  ignoreCase: boolean;
}

export interface WorldBook {
  id: string;
  name: string;
  entries: WbEntry[];
  createdAt: number;
  updatedAt: number;
}

// ---------------- 存储（kv 内存写穿层） ----------------

const BOOKS_KEY = 'worldbooks';

/** 联系人挂载的书籍 id 列表（按联系人隔离） */
export const wbBindKey = (contactId: string): string => `wb-bind:${contactId}`;

export function loadBooks(): WorldBook[] {
  const raw = kvGet<WorldBook[]>(BOOKS_KEY);
  return Array.isArray(raw) ? raw : [];
}

export function saveBooks(books: WorldBook[]): void {
  kvSet(BOOKS_KEY, books);
}

export function getBook(books: WorldBook[], bookId: string): WorldBook | null {
  return books.find((b) => b.id === bookId) ?? null;
}

export function getBoundBookIds(contactId: string): string[] {
  const raw = kvGet<string[]>(wbBindKey(contactId));
  return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
}

export function setBoundBookIds(contactId: string, ids: string[]): void {
  kvSet(wbBindKey(contactId), [...new Set(ids)]);
}

/** 删除联系人时清理挂载关系（书籍本体与条目是用户创作，保留不删） */
export function clearContactBinding(contactId: string): void {
  kvDel(wbBindKey(contactId));
}

/** 删除世界书时，把该书从所有联系人的挂载列表里摘除（避免残留失效的挂载 id） */
export async function pruneBookFromAllBindings(bookId: string): Promise<void> {
  try {
    const { listContacts } = await import('./contacts-store');
    const contacts = await listContacts();
    for (const c of contacts) {
      const ids = getBoundBookIds(c.id);
      if (ids.includes(bookId)) setBoundBookIds(c.id, ids.filter((x) => x !== bookId));
    }
  } catch {
    // 联系人不可用时静默：失效挂载 id 不影响注入（collectWbBlocks 以现存书籍为准）
  }
}

export function newWbId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------- 校验 ----------------

/** 世界书名字校验：非空且不含 emoji（条目名字无此限制，可随便取） */
export function wbNameCheck(name: string): { ok: boolean; reason: string } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: '世界书名字不能为空' };
  if (hasEmoji(trimmed)) return { ok: false, reason: '世界书名字不能包含 emoji' };
  if (trimmed.length > 30) return { ok: false, reason: '世界书名字不能超过 30 个字' };
  return { ok: true, reason: '' };
}

/** 条目保存校验：至少 1 个触发词、内容非空（否则该条目永远不会被激活，没有意义） */
export function wbEntryCheck(entry: Pick<WbEntry, 'keywords' | 'content'>): { ok: boolean; reason: string } {
  if (entry.keywords.length === 0) return { ok: false, reason: '至少填写 1 个触发词' };
  if (!entry.content.trim()) return { ok: false, reason: '内容不能为空' };
  return { ok: true, reason: '' };
}

/** 输入框文本 → 触发词数组（逗号/顿号/分号/空白分隔，去空去重） */
export function parseKeywordsInput(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,，、;；\s]+/)) {
    const kw = raw.trim();
    if (!kw || seen.has(kw)) continue;
    seen.add(kw);
    out.push(kw);
  }
  return out;
}

export function createEntryDraft(): WbEntry {
  return {
    id: newWbId('wbe'),
    enabled: true,
    name: '',
    keywords: [],
    content: '',
    position: 'after_char',
    scope: 'local',
    targetContactId: null,
    priority: 0,
    ignoreCase: true,
  };
}

// ---------------- 导入 / 导出 ----------------

const EXPORT_APP_TAG = 'worldbook';

interface ExportedEntry {
  enabled?: unknown;
  name?: unknown;
  keywords?: unknown;
  content?: unknown;
  position?: unknown;
  scope?: unknown;
  /** 导出格式里带目标角色名字（id 跨设备无意义），导入时按当前联系人名单解析 */
  targetContactName?: unknown;
  priority?: unknown;
  ignoreCase?: unknown;
}

interface ExportedBook {
  name?: unknown;
  entries?: unknown;
}

export interface WorldBookExportPayload {
  app: typeof EXPORT_APP_TAG;
  version: number;
  exportedAt: number;
  books: Array<{ name: string; entries: ExportedEntry[] }>;
}

/** 导出载荷（targetContactId → targetContactName，跨设备可读） */
export function buildExportPayload(books: WorldBook[], contactNameOf: (id: string) => string): WorldBookExportPayload {
  return {
    app: EXPORT_APP_TAG,
    version: 1,
    exportedAt: Date.now(),
    books: books.map((b) => ({
      name: b.name,
      entries: b.entries.map((e) => ({
        enabled: e.enabled,
        name: e.name,
        keywords: e.keywords,
        content: e.content,
        position: e.position,
        scope: e.scope,
        targetContactName: e.scope === 'exclusive' && e.targetContactId ? contactNameOf(e.targetContactId) : undefined,
        priority: e.priority,
        ignoreCase: e.ignoreCase,
      })),
    })),
  };
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function normalizePosition(v: unknown): WbPosition {
  return (WB_POSITIONS as readonly string[]).includes(typeof v === 'string' ? v : '') ? (v as WbPosition) : 'after_char';
}

function normalizeScope(v: unknown): WbScope {
  return (WB_SCOPES as readonly string[]).includes(typeof v === 'string' ? v : '') ? (v as WbScope) : 'local';
}

/**
 * 解析导入内容 → 书籍数组（联系人名字按当前名单解析为 id，解析不到时降级为 local）。
 * 兼容三种形状：标准导出 {app, books:[...]} / 裸书籍数组 [...] / 单本书 {name, entries}。
 * 抛错时 message 直接可展示（emoji 名字校验也在这里做）。
 */
export function parseWorldBookImport(
  parsed: unknown,
  resolveContactByName: (name: string) => string | null,
): WorldBook[] {
  let rawBooks: unknown;
  if (Array.isArray(parsed)) {
    rawBooks = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.books)) rawBooks = obj.books;
    else if (typeof obj.name === 'string') rawBooks = [parsed];
  }
  if (!Array.isArray(rawBooks) || rawBooks.length === 0) {
    throw new Error('文件里没有找到世界书（需要标准导出格式）');
  }

  const now = Date.now();
  const books: WorldBook[] = [];
  rawBooks.forEach((rb, bi) => {
    if (!rb || typeof rb !== 'object') throw new Error(`第 ${bi + 1} 本书格式不正确`);
    const b = rb as ExportedBook;
    const name = asString(b.name).trim();
    const check = wbNameCheck(name);
    if (!check.ok) throw new Error(`导入失败：${check.reason}${name ? `（${name}）` : ''}`);
    const rawEntries = Array.isArray(b.entries) ? b.entries : [];
    const entries: WbEntry[] = [];
    for (const re of rawEntries) {
      if (!re || typeof re !== 'object') continue;
      const e = re as ExportedEntry;
      const content = asString(e.content);
      const keywords = Array.isArray(e.keywords)
        ? [...new Set(e.keywords.filter((k): k is string => typeof k === 'string' && k.trim() !== '').map((k) => k.trim()))]
        : [];
      if (!content.trim() || keywords.length === 0) continue; // 无法激活的条目直接丢弃
      let scope = normalizeScope(e.scope);
      let targetContactId: string | null = null;
      if (scope === 'exclusive') {
        const targetName = asString(e.targetContactName).trim();
        targetContactId = targetName ? resolveContactByName(targetName) : null;
        if (!targetContactId) scope = 'local'; // 目标角色不存在（跨设备）：降级为局部
      }
      const priorityNum = typeof e.priority === 'number' && Number.isFinite(e.priority) ? Math.floor(e.priority) : 0;
      entries.push({
        id: newWbId('wbe'),
        enabled: e.enabled !== false,
        name: asString(e.name).trim() || '未命名条目',
        keywords,
        content,
        position: normalizePosition(e.position),
        scope,
        targetContactId,
        priority: Math.min(9999, Math.max(0, priorityNum)),
        ignoreCase: e.ignoreCase !== false,
      });
    }
    books.push({ id: newWbId('wb'), name, entries, createdAt: now, updatedAt: now });
  });
  if (books.length === 0) throw new Error('文件里没有可导入的条目');
  return books;
}

// ---------------- 触发匹配与注入 ----------------

/** 注入块（六个位置；空串 = 该位置没有命中条目） */
export interface WbBlocks {
  beforeSystem: string;
  afterSystem: string;
  beforeChar: string;
  afterChar: string;
  beforeUser: string;
  afterUser: string;
}

export const WB_EMPTY_BLOCKS: WbBlocks = {
  beforeSystem: '',
  afterSystem: '',
  beforeChar: '',
  afterChar: '',
  beforeUser: '',
  afterUser: '',
};

/** 扫描文本拼装：最新一条用户消息 + 最近若干条上下文（调用方传入，顺序不限） */
export function wbScanText(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join('\n');
}

/** 单条条目是否命中扫描文本（任一触发词包含即命中；空触发词永不命中） */
export function wbEntryMatches(entry: Pick<WbEntry, 'keywords' | 'ignoreCase'>, scanText: string): boolean {
  if (entry.keywords.length === 0 || !scanText) return false;
  const hay = entry.ignoreCase ? scanText.toLowerCase() : scanText;
  return entry.keywords.some((kw) => {
    const needle = entry.ignoreCase ? kw.toLowerCase() : kw;
    return needle !== '' && hay.includes(needle);
  });
}

const WB_GROUP_HEADER = '【世界书设定】';

function formatGroup(entries: WbEntry[]): string {
  return `${WB_GROUP_HEADER}\n${entries.map((e) => e.content.trim()).join('\n\n')}`;
}

/**
 * 收集当前聊天应注入的世界书内容：
 * - global 条目：所有聊天生效（无需挂载）；
 * - local 条目：仅当本书挂载到当前联系人时生效；
 * - exclusive 条目：仅当条目指定目标 = 当前联系人时生效；
 * 再按「启用 + 命中触发词」过滤，按插入位置分组、同位置优先级降序拼接。
 * contactId 为 null（无联系人的会话）时只有 global 条目可能生效。
 */
export function collectWbBlocks(contactId: string | null, scanText: string): WbBlocks {
  if (!scanText.trim()) return WB_EMPTY_BLOCKS;
  const books = loadBooks();
  if (books.length === 0) return WB_EMPTY_BLOCKS;
  const bound = contactId ? new Set(getBoundBookIds(contactId)) : new Set<string>();

  const byPosition: Record<WbPosition, WbEntry[]> = {
    before_system: [],
    after_system: [],
    before_char: [],
    after_char: [],
    before_user: [],
    after_user: [],
  };
  for (const book of books) {
    const isBound = bound.has(book.id);
    for (const entry of book.entries) {
      if (!entry.enabled) continue;
      if (entry.scope === 'local' && !isBound) continue;
      if (entry.scope === 'exclusive' && (!contactId || entry.targetContactId !== contactId)) continue;
      if (!wbEntryMatches(entry, scanText)) continue;
      byPosition[entry.position].push(entry);
    }
  }

  const blocks = { ...WB_EMPTY_BLOCKS };
  for (const pos of WB_POSITIONS) {
    const list = byPosition[pos];
    if (list.length === 0) continue;
    list.sort((a, b) => b.priority - a.priority); // 数字大的排前面；同优先级保持书内顺序（sort 稳定）
    const text = formatGroup(list);
    if (pos === 'before_system') blocks.beforeSystem = text;
    else if (pos === 'after_system') blocks.afterSystem = text;
    else if (pos === 'before_char') blocks.beforeChar = text;
    else if (pos === 'after_char') blocks.afterChar = text;
    else if (pos === 'before_user') blocks.beforeUser = text;
    else blocks.afterUser = text;
  }
  return blocks;
}

/**
 * 把 before_user / after_user 块包裹到消息数组最后一条 user 消息上（就地返回新数组）；
 * 没有 user 消息时原样返回。system 消息与 assistant 消息不受影响。
 */
export function applyWbUserBlocks<T extends { role: string; content: string }>(
  messages: T[],
  blocks: WbBlocks,
): T[] {
  if (!blocks.beforeUser && !blocks.afterUser) return messages;
  let idx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      idx = i;
      break;
    }
  }
  if (idx < 0) return messages;
  const target = messages[idx];
  const merged = [blocks.beforeUser, target.content, blocks.afterUser].filter(Boolean).join('\n\n');
  const next = messages.slice();
  next[idx] = { ...target, content: merged };
  return next;
}
