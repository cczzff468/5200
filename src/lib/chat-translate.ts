'use client';

/**
 * 聊天翻译（微信 / QQ / 信息三端共用）：
 *
 * - 每个会话独立保存翻译配置（sessionKey = wx:<contactId> / qq:<contactId> / sms:<storageKey>，
 *   天然按角色/App 隔离），localStorage 单键 JSON map 持久化；开启后聊天中的文字消息
 *   会在气泡下方显示所选语言的翻译，可多选多种语言（每条消息下方逐行显示全部已选语言）；
 * - 译文缓存：localStorage 单键（容量上限 FIFO），key = `<语言>|<原文>`（与具体会话无关，
 *   同样的原文+目标语言全局复用），组件内存里另有一份运行时 Map 避免反复读盘；
 * - requestTranslation：带并发闸（最多 3 个同时在途）+ 在途去重（同 key 复用同一 Promise）；
 *   优先走 /api/translate 服务器代理，服务器不可达 / 直连标记 / 内网地址时回退
 *   浏览器直连（directChatStream 兼容非流式 JSON 解析），与聊天链路的兜底策略一致。
 */
import type { ApiConfig } from '@/lib/ios/store';
import { directChatStream, isPrivateApiUrl } from '@/lib/ios/direct-api';

// ---------------- 语言清单 ----------------

export interface TranslateLang {
  /** 语言代码（持久化用） */
  code: string;
  /** 中文名（设置页与译文行前缀显示） */
  label: string;
  /** 原文名 */
  native: string;
}

/** 可选翻译语言（可多选） */
export const TRANSLATE_LANGS: readonly TranslateLang[] = [
  { code: 'en', label: '英语', native: 'English' },
  { code: 'ja', label: '日语', native: '日本語' },
  { code: 'ko', label: '韩语', native: '한국어' },
  { code: 'fr', label: '法语', native: 'Français' },
  { code: 'de', label: '德语', native: 'Deutsch' },
  { code: 'es', label: '西班牙语', native: 'Español' },
  { code: 'ru', label: '俄语', native: 'Русский' },
  { code: 'zh-Hant', label: '繁体中文', native: '繁體中文' },
];

const LANG_CODES = new Set(TRANSLATE_LANGS.map((l) => l.code));

/** 语言代码 → 中文名（未知代码原样返回） */
export function translateLangLabel(code: string): string {
  return TRANSLATE_LANGS.find((l) => l.code === code)?.label ?? code;
}

// ---------------- 配置持久化（按会话隔离） ----------------

export interface ChatTranslateCfg {
  /** 是否开启翻译 */
  on: boolean;
  /** 已选目标语言代码列表（多选；顺序即译文显示顺序） */
  langs: string[];
}

export const DEFAULT_TRANSLATE_CFG: ChatTranslateCfg = { on: false, langs: [] };

const CFG_KEY = 'chat-translate-cfg';

/** 把任意值收窄为合法配置（非法字段丢弃/回退默认） */
export function normalizeTranslateCfg(raw: unknown): ChatTranslateCfg {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_TRANSLATE_CFG };
  const rec = raw as { on?: unknown; langs?: unknown };
  const langs = Array.isArray(rec.langs)
    ? [...new Set(rec.langs.filter((c): c is string => typeof c === 'string' && LANG_CODES.has(c)))]
    : [];
  return { on: rec.on === true, langs };
}

function loadCfgMap(): Record<string, ChatTranslateCfg> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CFG_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, ChatTranslateCfg> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const cfg = normalizeTranslateCfg(v);
      if (cfg.on || cfg.langs.length > 0) out[k] = cfg;
    }
    return out;
  } catch {
    return {};
  }
}

/** 读取某会话的翻译配置（未设置时返回默认关闭） */
export function getTranslateCfg(sessionKey: string): ChatTranslateCfg {
  return normalizeTranslateCfg(loadCfgMap()[sessionKey]);
}

/** 保存某会话的翻译配置（持久化到 localStorage，按 sessionKey 隔离） */
export function saveTranslateCfg(sessionKey: string, cfg: ChatTranslateCfg): void {
  if (typeof window === 'undefined') return;
  const map = loadCfgMap();
  const next = normalizeTranslateCfg(cfg);
  if (next.on || next.langs.length > 0) map[sessionKey] = next;
  else delete map[sessionKey];
  try {
    window.localStorage.setItem(CFG_KEY, JSON.stringify(map));
  } catch {
    // 持久化失败忽略（本次会话内存态仍然生效）
  }
}

// ---------------- 译文缓存 ----------------

const CACHE_KEY = 'chat-translate-cache';
const CACHE_MAX = 300;

const memCache = new Map<string, string>();
let cacheLoaded = false;

function ensureCache(): void {
  if (cacheLoaded || typeof window === 'undefined') return;
  cacheLoaded = true;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && typeof item[1] === 'string') {
        memCache.set(item[0], item[1]);
      }
    }
  } catch {
    // 缓存损坏：忽略（内存缓存仍然有效）
  }
}

function persistCache(): void {
  if (typeof window === 'undefined') return;
  // FIFO 淘汰最旧的
  while (memCache.size > CACHE_MAX) {
    const oldest = memCache.keys().next().value;
    if (oldest === undefined) break;
    memCache.delete(oldest);
  }
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify([...memCache.entries()]));
  } catch {
    // 持久化失败忽略（内存缓存仍然有效）
  }
}

function cacheKey(lang: string, text: string): string {
  return `${lang}|${text}`;
}

// ---------------- 翻译请求（并发闸 + 在途去重） ----------------

const MAX_ACTIVE = 3;
let active = 0;
const waiters: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_ACTIVE) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
  }
}

/** 翻译 system 提示（三端共用）：只输出译文，保留语气与表情 */
function buildTranslateMessages(text: string, langLabel: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content:
        `你是一个翻译引擎。把用户发来的内容准确、自然地翻译成${langLabel}。` +
        `只输出译文本身：不要解释、不要加引号、不要输出原文或任何多余内容；` +
        `保留原文的语气、标点和表情符号；如果内容本身已经是${langLabel}，原样输出。`,
    },
    { role: 'user', content: text },
  ];
}

/** 服务器代理翻译：POST /api/translate（非流式，返回 { translation }） */
async function translateViaServer(apiConfig: ApiConfig, text: string, langLabel: string): Promise<string> {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang: langLabel, config: apiConfig }),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // 忽略解析失败
  }
  const rec = (data && typeof data === 'object' ? data : {}) as { translation?: unknown; error?: unknown; directOnly?: unknown };
  if (res.ok && typeof rec.translation === 'string' && rec.translation.trim()) {
    return rec.translation.trim();
  }
  const detail = typeof rec.error === 'string' ? rec.error : `请求失败（${res.status}）`;
  const err = new Error(detail) as Error & { directOnly?: boolean };
  err.directOnly = rec.directOnly === true;
  throw err;
}

async function runTranslate(apiConfig: ApiConfig, text: string, langLabel: string): Promise<string> {
  try {
    return await translateViaServer(apiConfig, text, langLabel);
  } catch (err) {
    const directOnly = err instanceof Error && (err as Error & { directOnly?: boolean }).directOnly === true;
    // 内网地址 / 服务器建议直连：浏览器直连兜底（directChatStream 兼容非流式 JSON 解析）
    if (directOnly || isPrivateApiUrl(apiConfig.baseUrl)) {
      const out = await directChatStream(apiConfig, buildTranslateMessages(text, langLabel), () => undefined);
      const trimmed = out.trim();
      if (trimmed) return trimmed;
    }
    throw err;
  }
}

const inflight = new Map<string, Promise<string>>();

/** 失败冷却：同一 key 失败后 60s 内不再重试（避免上游不可用时反复轰炸） */
const FAILED_TTL = 60_000;
const failedAt = new Map<string, number>();

/**
 * 请求一条译文（带缓存 / 并发闸 / 在途去重；失败会 reject，由调用方决定兜底展示）。
 * lang 用语言代码（TRANSLATE_LANGS 的 code），内部换算中文名进提示词。
 */
export function requestTranslation(opts: { text: string; lang: string; apiConfig: ApiConfig }): Promise<string> {
  const text = opts.text.trim();
  const key = cacheKey(opts.lang, text);
  ensureCache();
  const cached = memCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const failed = failedAt.get(key);
  if (failed !== undefined && Date.now() - failed < FAILED_TTL) {
    return Promise.reject(new Error('翻译刚才失败过，冷却中'));
  }
  const existing = inflight.get(key);
  if (existing) return existing;
  const langLabel = translateLangLabel(opts.lang);
  const p = withSlot(() => runTranslate(opts.apiConfig, text, langLabel))
    .then((t) => {
      memCache.set(key, t);
      persistCache();
      failedAt.delete(key);
      return t;
    })
    .catch((err) => {
      failedAt.set(key, Date.now());
      throw err;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}
