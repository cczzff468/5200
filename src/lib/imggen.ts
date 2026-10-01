'use client';

/**
 * 图像生成（生图）+ 锁脸 —— 共享逻辑层（微信 / QQ / 信息单聊共用；群聊暂不触发）。
 *
 * 功能结构：
 * 1. 配置：全局 ImgGenConfig（settings store，与聊天/识图配置独立）——提供方固定 OpenAI 兼容
 *    （DALL·E / gpt-image / Flux 等兼容 /images/generations、/images/edits 的网关）；
 *    请求方式 = 服务端转发（/api/imggen，推荐，免跨域）或浏览器直连（需接口允许 CORS）；
 * 2. 锁脸：每个角色独立的「参考图」（imggen-ref:<contactId>，dataURL 压缩存 kv）+ 可选「外貌描述」
 *    （imggen-appearance:<contactId>）。生成时：
 *    - 有参考图 → 优先走 /images/edits（multipart，参考图作为输入图），脸随参考图保持一致；
 *      若接口不支持 edits（4xx），自动回退 generations 并把外貌描述拼进提示词兜底；
 *    - 无参考图 → generations，把「外貌描述」拼进提示词尽量保持一致性；
 * 3. 照片标签：AI 回复文本里输出 [照片:描述]（或朋友圈同款 [照片:使用参考图:描述] /
 *    [照片:不使用参考图:描述]，兼容全角【】与中英文冒号），extractPhotoTags 从气泡文本剥出标签，
 *    每个标签经 generateCharacterPhoto 生图后以 kind='image' 消息追加进聊天；
 * 4. 生成结果：聊天显示 + 自动存入该角色相册（origin 'ai'，AI 后续可用 [选图发送] 重发）+
 *    写记忆（30 分钟节流，不刷屏）；失败只落系统提示行，不影响聊天；
 * 5. 手动触发：微信加号面板 / QQ 星星面板「生成照片」（填描述 → 角色以第一人称拍一张发出来）。
 */

import { kvDel, kvGet, kvSet } from '@/lib/ios/idb-kv';
import type { ImgGenConfig } from '@/lib/ios/store';
import { memAddEventFragment } from '@/lib/memory';

// ---------------- 锁脸：角色参考图 + 外貌描述（按 contactId 隔离） ----------------

export interface ImgGenFaceRef {
  /** 参考图 dataURL（上传时已压缩） */
  src: string;
  updatedAt: number;
}

const refKeyOf = (contactId: string) => `imggen-ref:${contactId}`;
const appearKeyOf = (contactId: string) => `imggen-appearance:${contactId}`;

/** 读角色参考图（无 / 坏数据 = null） */
export function getFaceRef(contactId: string): ImgGenFaceRef | null {
  const raw = kvGet(refKeyOf(contactId)) as Partial<ImgGenFaceRef> | null | undefined;
  if (raw && typeof raw.src === 'string' && raw.src.startsWith('data:image/')) {
    return { src: raw.src, updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0 };
  }
  return null;
}

/** 写 / 替换角色参考图；src=null 删除 */
export function setFaceRef(contactId: string, src: string | null): void {
  if (!contactId) return;
  if (src === null) {
    kvDel(refKeyOf(contactId));
    return;
  }
  kvSet(refKeyOf(contactId), { src, updatedAt: Date.now() });
}

/** 读角色外貌描述（锁脸兜底文案；空串 = 未填） */
export function getAppearanceNote(contactId: string): string {
  const v = kvGet(appearKeyOf(contactId));
  return typeof v === 'string' ? v.trim() : '';
}

/** 写角色外貌描述（空串 = 清除） */
export function setAppearanceNote(contactId: string, note: string): void {
  if (!contactId) return;
  kvSet(appearKeyOf(contactId), note.trim());
}

// ---------------- 图片压缩（上传参考图 / 落库生成结果共用） ----------------

/**
 * 把 dataURL 压缩（缩放到 maxPx 内 + JPEG 重编码）；失败原样返回（不阻塞主流程）。
 * 参考图默认 512px（脸要清楚、体积可控 ~50-150KB），生成结果默认 1024px（聊天展示清晰）。
 */
export function compressImageSrc(src: string, maxPx = 512, quality = 0.86): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(src);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          resolve(src);
        }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    } catch {
      resolve(src);
    }
  });
}

// ---------------- 照片标签：提取（从 AI 回复文本剥出） ----------------

export interface PhotoTag {
  /** 画面描述（生图提示词主体） */
  desc: string;
  /** 是否指定使用参考图（朋友圈同款三段式标签 [照片:使用参考图:desc]） */
  useRef: boolean;
}

const PHOTO_TAG_RE =
  /[【\[]\s*照片\s*[:：]\s*(使用参考图|不使用参考图|不用参考图)?\s*[:：]?\s*([^\]】]{1,160})[\]】]/g;

/**
 * 从回复文本里提取全部照片标签并从原文剥除：
 * 支持 [照片:描述] / 【照片：描述】 / [照片:使用参考图:描述] / [照片:不使用参考图:描述]
 * （desc 为空 / 全空白的标签直接丢弃）；
 * useRef 语义：默认 true（有参考图就锁脸），仅明确写「不使用参考图/不用参考图」才为 false。
 */
export function extractPhotoTags(text: string): { text: string; tags: PhotoTag[] } {
  if (!text || text.indexOf('照片') === -1) return { text, tags: [] };
  const tags: PhotoTag[] = [];
  const stripped = text.replace(PHOTO_TAG_RE, (_m, mode: string | undefined, desc: string) => {
    const d = (desc ?? '').trim();
    if (d) tags.push({ desc: d, useRef: mode !== '不使用参考图' && mode !== '不用参考图' });
    return '';
  });
  return { text: stripped.replace(/[ \t]{2,}/g, ' ').trim(), tags };
}

/** 文本里是否含未剥除的照片标签（渲染层防御性提示用；一般提取后即无） */
export function hasPhotoTag(text: string): boolean {
  return /[【\[]\s*照片\s*[:：]/.test(text ?? '');
}

// ---------------- 提示词规则（聊天 system 注入） ----------------

/**
 * 生图照片标签规则：开启生图后注入聊天 system，让 AI 知道自己可以「发照片」。
 * 描述用第三人称画面描述（锁脸会自动带上角色本人形象），不要在描述里写文字/水印要求。
 */
export function buildPhotoTagRule(charName: string): string {
  return (
    `【发照片能力】你（${charName}）可以在回复里输出照片标签来给对方发一张你拍的照片：\n` +
    `- 格式：[照片:画面描述]，描述用具体的画面语言（场景/构图/光线/动作/表情，20~60字），如「[照片:黄昏的咖啡厅窗边，长发女生托腮看镜头，暖光落在侧脸上]」。\n` +
    `- 一次最多一张；照片描述不要包含文字、水印、分镜要求；标签单独或放在消息末尾，不要套在引号里。\n` +
    `- 何时发：对方想看你的样子/让你发自拍/分享当下瞬间（做饭、散步、风景+你）等自然场景；不要每条消息都发，不要连发。\n` +
    `- 标签会被系统替换成真实照片，你不需要描述照片「已发出」以外的话，也不要假装用户点评过照片内容。`
  );
}

// ---------------- 生成管线 ----------------

/** 配置是否可用（自动/手动生图前的统一门槛） */
export function imgGenConfigReady(cfg: ImgGenConfig): boolean {
  return Boolean(cfg.baseUrl.trim() && cfg.apiKey.trim() && cfg.model.trim());
}

/** 生图最终提示词拼装：画面描述 + （无参考图时）外貌描述 + 补充提示词 */
export function buildFinalPrompt(cfg: ImgGenConfig, desc: string, appearance: string, withAppearance: boolean): string {
  const parts: string[] = [];
  const d = desc.trim();
  if (d) parts.push(d);
  if (withAppearance && appearance) parts.push(appearance);
  const extra = cfg.extraPrompt.trim();
  if (extra) parts.push(extra);
  return parts.join('，');
}

/** 记忆节流：同角色两条照片记忆至少间隔 30 分钟（「不刷屏」） */
const MEM_THROTTLE_MS = 30 * 60 * 1000;
const memLastKey = (contactId: string) => `imggen-mem-last:${contactId}`;

/** 生图成功后写一条轻量记忆（节流；失败静默） */
export function notePhotoMemory(contactId: string, app: 'wx' | 'qq' | 'sms', desc: string): void {
  try {
    const last = Number(kvGet(memLastKey(contactId)) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < MEM_THROTTLE_MS) return;
    kvSet(memLastKey(contactId), Date.now());
    const d = desc.trim().slice(0, 60) || '一张照片';
    void memAddEventFragment(contactId, app, `（拍了一张照片发给你：${d}）`, { sourceTag: 'imggen' });
  } catch {
    /* 记忆失败不影响聊天 */
  }
}

// ---------------- OpenAI 兼容生图（服务端转发 / 浏览器直连 共用参数拼装） ----------------

/** 归一化基地址 → /images/generations 与 /images/edits 两个端点候选（修 /v1/v1、粘贴完整端点等常见错误） */
export function imggenEndpoints(baseUrl: string): { generations: string[]; edits: string[] } {
  const t = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/(\/v\d+)\/v\d+$/, '$1');
  // 已粘贴完整端点：直接用
  if (/\/images\/generations$/.test(t)) return { generations: [t], edits: [t.replace(/generations$/, 'edits')] };
  if (/\/images\/edits$/.test(t)) return { generations: [t.replace(/edits$/, 'generations')], edits: [t] };
  // /chat/completions 结尾（从聊天配置顺手抄来）：退一层
  const base = t.replace(/\/chat\/completions$/, '');
  // 已带 /v1：直接拼；否则补 /v1（OpenAI 兼容网关默认）
  const root = /\/v\d+$/.test(base) ? base : `${base}/v1`;
  return { generations: [`${root}/images/generations`], edits: [`${root}/images/edits`] };
}

/** dataURL → Blob（multipart edits 用） */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const m = /^data:([^;,]+)(;[^,]*)?,(.*)$/.exec(dataUrl);
    if (!m) return null;
    const bin = atob(m[3]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m[1] || 'image/png' });
  } catch {
    return null;
  }
}

/** 从任意形态的图片响应里取出图片（b64_json 直转 / url 拉取；多张取第一张） */
export async function pickImageFromResponse(payload: unknown): Promise<string | null> {
  try {
    const obj = payload as { data?: unknown; images?: unknown; url?: unknown; b64_json?: unknown };
    let item: unknown = null;
    if (Array.isArray(obj?.data) && obj.data.length > 0) item = obj.data[0];
    else if (Array.isArray(obj?.images) && obj.images.length > 0) item = obj.images[0];
    else if (typeof obj?.url === 'string' || typeof obj?.b64_json === 'string') item = obj;
    if (item && typeof item === 'object') {
      const it = item as { b64_json?: unknown; url?: unknown; image_url?: unknown };
      if (typeof it.b64_json === 'string' && it.b64_json) return `data:image/png;base64,${it.b64_json}`;
      const u = typeof it.url === 'string' ? it.url : typeof it.image_url === 'string' ? it.image_url : null;
      if (u) {
        const res = await fetch(u);
        if (res.ok) {
          const blob = await res.blob();
          return await new Promise<string | null>((resolve) => {
            const fr = new FileReader();
            fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
            fr.onerror = () => resolve(null);
            fr.readAsDataURL(blob);
          });
        }
      }
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

/** 尽力提取上游错误信息 */
export function extractImgGenError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const obj = payload as { error?: unknown; message?: unknown };
    if (typeof obj.error === 'string' && obj.error) return obj.error;
    if (obj.error && typeof obj.error === 'object') {
      const e = obj.error as { message?: unknown };
      if (typeof e.message === 'string' && e.message) return e.message;
    }
    if (typeof obj.message === 'string' && obj.message) return obj.message;
  }
  return fallback;
}

export interface GenerateCharacterPhotoArgs {
  cfg: ImgGenConfig & { mode?: 'proxy' | 'direct' };
  /** 角色 ID（读参考图/外貌描述） */
  contactId: string;
  /** 画面描述（照片标签内容 / 手动输入） */
  desc: string;
  /** 角色名（错误提示/日志用） */
  charName: string;
  /** 是否尝试使用参考图（标签明确「不使用参考图」时传 false） */
  useRef?: boolean;
}

export interface GenerateCharacterPhotoResult {
  /** 生成图 dataURL（已压缩） */
  src: string;
  /** 实际使用的提示词（记忆/日志用） */
  prompt: string;
  /** 是否走了参考图（edits） */
  usedRef: boolean;
}

/**
 * 给角色生成一张照片（锁脸主入口）：
 * 1. 读参考图/外貌描述 → 拼提示词；
 * 2. 有参考图且 useRef：先试 /images/edits（multipart 带参考图）；接口不支持（非 2xx）→ 回退 generations+外貌描述；
 * 3. mode='proxy' 走 /api/imggen 服务端转发；mode='direct' 浏览器直连（需 CORS）；
 * 4. 结果压缩到 ≤1024px 返回。
 */
export async function generateCharacterPhoto(args: GenerateCharacterPhotoArgs): Promise<GenerateCharacterPhotoResult> {
  const { cfg, contactId, desc, charName } = args;
  const useRef = args.useRef !== false;
  const ref = useRef ? getFaceRef(contactId) : null;
  const appearance = getAppearanceNote(contactId);
  const prompt = buildFinalPrompt(cfg, desc, appearance, !ref);

  // —— 请求参数（proxy/direct 共用） ——
  const mode: 'proxy' | 'direct' = cfg.mode === 'direct' ? 'direct' : 'proxy';
  const bodyBase = {
    mode,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    prompt,
    size: cfg.size.trim() || '1024x1024',
    quality: cfg.quality.trim(),
  };

  let rawSrc: string | null = null;
  let usedRef = false;

  if (ref) {
    // 先试 edits（带参考图锁脸）
    try {
      rawSrc = await requestImage({ ...bodyBase, refDataUrl: ref.src });
      usedRef = rawSrc != null;
    } catch {
      rawSrc = null;
    }
    // edits 不支持 → 回退 generations + 外貌描述兜底
    if (!rawSrc) {
      const fallbackPrompt = buildFinalPrompt(cfg, desc, appearance, true);
      rawSrc = await requestImage({ ...bodyBase, prompt: fallbackPrompt, refDataUrl: null });
      usedRef = false;
    }
  } else {
    rawSrc = await requestImage({ ...bodyBase, refDataUrl: null });
  }

  if (!rawSrc) {
    throw new Error(`${charName}的照片生成失败：接口没有返回图片`);
  }

  const src = await compressImageSrc(rawSrc, 1024, 0.9);
  if (!src.startsWith('data:image/')) throw new Error(`${charName}的照片生成失败：返回内容不是有效图片`);
  return { src, prompt, usedRef };
}

/** 单次生图请求：proxy 走 /api/imggen；direct 浏览器直连。返回原始 dataURL；失败抛错 */
async function requestImage(body: {
  mode: 'proxy' | 'direct';
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  size: string;
  quality: string;
  refDataUrl: string | null;
}): Promise<string | null> {
  if (body.refDataUrl) {
    // edits：multipart（proxy 与 direct 都用 FormData）
    const fd = new FormData();
    fd.append('baseUrl', body.baseUrl);
    fd.append('apiKey', body.apiKey);
    fd.append('model', body.model);
    fd.append('prompt', body.prompt);
    fd.append('size', body.size);
    if (body.quality && body.quality !== 'auto') fd.append('quality', body.quality);
    const blob = dataUrlToBlob(body.refDataUrl);
    if (blob) fd.append('image', blob, 'ref.png');
    return body.mode === 'proxy'
      ? postProxy(fd)
      : postDirectMultipart(body.baseUrl, body.apiKey, body.model, body.prompt, body.size, body.quality, blob);
  }
  if (body.mode === 'proxy') {
    const res = await fetch('/api/imggen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as { src?: string; error?: string } | null;
    if (!res.ok || !data?.src) throw new Error(data?.error || `生图接口错误（${res.status}）`);
    return data.src;
  }
  // direct JSON generations
  const eps = imggenEndpoints(body.baseUrl);
  let lastErr = '生图失败';
  for (const ep of eps.generations) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.apiKey}` },
        body: JSON.stringify({
          model: body.model,
          prompt: body.prompt,
          n: 1,
          ...(body.size && body.size !== 'auto' ? { size: body.size } : {}),
          ...(body.quality && body.quality !== 'auto' ? { quality: body.quality } : {}),
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        lastErr = extractImgGenError(payload, `生图接口错误（${res.status}）`);
        continue;
      }
      const src = await pickImageFromResponse(payload);
      if (src) return src;
      lastErr = '接口没有返回图片';
    } catch (e) {
      lastErr = e instanceof Error ? e.message : '网络错误（检查接口是否允许跨域 CORS）';
    }
  }
  throw new Error(lastErr);
}

/** proxy + multipart：/api/imggen 原样转发 FormData */
async function postProxy(fd: FormData): Promise<string | null> {
  const res = await fetch('/api/imggen', { method: 'POST', body: fd });
  const data = (await res.json().catch(() => null)) as { src?: string; error?: string } | null;
  if (!res.ok || !data?.src) throw new Error(data?.error || `生图接口错误（${res.status}）`);
  return data.src;
}

/** direct + multipart：浏览器直连 /images/edits */
async function postDirectMultipart(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  size: string,
  quality: string,
  blob: Blob | null,
): Promise<string | null> {
  const eps = imggenEndpoints(baseUrl);
  let lastErr = '生图失败';
  for (const ep of eps.edits) {
    try {
      const fd = new FormData();
      if (blob) fd.append('image', blob, 'ref.png');
      fd.append('prompt', prompt);
      fd.append('model', model);
      fd.append('n', '1');
      if (size && size !== 'auto') fd.append('size', size);
      if (quality && quality !== 'auto') fd.append('quality', quality);
      const res = await fetch(ep, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: fd });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        lastErr = extractImgGenError(payload, `生图接口错误（${res.status}）`);
        continue;
      }
      const src = await pickImageFromResponse(payload);
      if (src) return src;
      lastErr = '接口没有返回图片';
    } catch (e) {
      lastErr = e instanceof Error ? e.message : '网络错误（检查接口是否允许跨域 CORS）';
    }
  }
  throw new Error(lastErr);
}

// ---------------- 「文字图片」：AI 自动构思画面描述（三端加号面板共用） ----------------

/** 聊天记录条目的最小形态（ChatMsg/WxMsg/QQMsg 的公共子集；图片 dataURL 不外泄，只取描述占位） */
export type PhotoDescHistoryItem = {
  role: string;
  content: string;
  kind?: string;
  img?: { desc?: string } | null;
  voice?: { transcript?: string; localText?: string } | null;
};

/**
 * 聊天记录 → 文字图片构思上下文：逐条压成「我：… / TA：…」短行；
 * 图片 →「[图片]（图片内容：…）」占位（QQ 端图片 dataURL 存 content，绝不进上下文）；
 * 语音 → 转写文本；每行截断 80 字，最多取最近 max 条。
 */
export function buildPhotoDescHistory(
  items: PhotoDescHistoryItem[],
  myLabel = '我',
  peerLabel = 'TA',
  max = 14,
): string[] {
  const line = (who: string, text: string) => `${who}：${text}`;
  return items
    .filter((m) => m.kind !== 'sys' && m.kind !== 'notice')
    .slice(-max)
    .map((m) => {
      const who = m.role === 'me' || m.role === 'user' ? myLabel : peerLabel;
      if (m.kind === 'image') return line(who, m.img?.desc ? `[图片]（图片内容：${m.img.desc}）` : '[图片]');
      if (m.kind === 'voice') return line(who, m.voice?.transcript || m.voice?.localText || '[语音]');
      const t = (m.content ?? '').trim();
      if (!t || t.startsWith('data:image/')) return '';
      return line(who, t.length > 80 ? `${t.slice(0, 80)}…` : t);
    })
    .filter(Boolean);
}

/**
 * 「文字图片」自动构思：AI 根据人设 + 最近聊天记录写一句画面描述（描述留空时调用）。
 * 走 /api/photodesc（用户上游优先、服务端内置模型兜底）；失败抛错由调用方展示。
 */
export async function autoPhotoDesc(args: {
  /** 聊天模型配置（设置 › API 设置；可为 null → 服务端直接用内置模型） */
  config: { baseUrl: string; apiKey: string; model: string; temperature?: number; maxTokens?: number } | null;
  charName: string;
  channel: '短信' | '微信' | 'QQ';
  /** 角色人设（联系人 persona；小助手会话可空） */
  persona?: string;
  /** 用户在弹层里顺手写的画面提示（可空） */
  hint?: string;
  /** 最近聊天记录（buildPhotoDescHistory 产物） */
  history?: string[];
}): Promise<string> {
  const res = await fetch('/api/photodesc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data: unknown = await res.json().catch(() => null);
  if (res.ok && data && typeof data === 'object') {
    const d = (data as { desc?: unknown }).desc;
    if (typeof d === 'string' && d.trim()) return d.trim();
  }
  const msg = data && typeof data === 'object' ? (data as { error?: unknown }).error : null;
  throw new Error(typeof msg === 'string' && msg ? msg : '画面构思失败，请重试');
}
