/**
 * 表情包数据层（微信 / QQ 共用）：
 * - localStorage 持久化：wx-stickers / qq-stickers
 * - 每张表情：图片（dataURL 或 URL）+ 意思（供 AI 理解并据此回复）
 * - URL 添加时自动从 URL 中识别中文意思（query 参数或文件名/路径段）
 */

export interface Sticker {
  id: string;
  /** 图片地址：dataURL（本机上传）或 http(s) URL */
  url: string;
  /** 表情包的意思（AI 回复依据） */
  meaning: string;
  createdAt: number;
}

const LS_KEY = (app: 'wx' | 'qq') => `${app}-stickers`;

export function loadStickers(app: 'wx' | 'qq'): Sticker[] {
  try {
    const raw = window.localStorage.getItem(LS_KEY(app));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is Partial<Sticker> => Boolean(s) && typeof (s as Partial<Sticker>).url === 'string')
      .slice(0, 200)
      .map((s) => ({
        id: typeof s.id === 'string' ? s.id : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        url: s.url as string,
        meaning: typeof s.meaning === 'string' ? s.meaning : '',
        createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

export function saveStickers(app: 'wx' | 'qq', list: Sticker[]): void {
  try {
    window.localStorage.setItem(LS_KEY(app), JSON.stringify(list.slice(0, 200)));
  } catch {
    // 持久化失败忽略（dataURL 过多可能超配额）
  }
}

export function newStickerId(): string {
  return `stk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 从文件名提取意思：取去扩展名后文件名里的连续中文（如「哈哈笑死.png」→「哈哈笑死」） */
export function fileNameMeaning(name: string): string {
  const stem = name.replace(/\.[a-z0-9]+$/i, '');
  const m = stem.match(/[\u4e00-\u9fa5]{2,}/);
  return m ? m[0] : '';
}

/**
 * URL 意思自动识别：
 * ① query 参数 meaning/name/text/cn/title/desc
 * ② 文件名（最后一个 / 后、扩展名前）中的连续中文
 * ③ 路径段中的连续中文（取最靠后的段）
 */
export function extractMeaningFromUrl(url: string): string {
  try {
    const decoded = decodeURIComponent(url.trim());
    const [path, query = ''] = decoded.split('?');
    for (const part of query.split('&')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const k = part.slice(0, eq);
      const v = part.slice(eq + 1);
      if (/^(meaning|name|text|cn|title|desc)$/i.test(k) && v) {
        const m = v.match(/[\u4e00-\u9fa5A-Za-z0-9]{1,20}/);
        if (m) return m[0];
      }
    }
    const file = (path.split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '');
    const mFile = file.match(/[\u4e00-\u9fa5]{2,}/);
    if (mFile) return mFile[0];
    const seg = path
      .split('/')
      .reverse()
      .find((s) => /[\u4e00-\u9fa5]{2,}/.test(s));
    if (seg) return (seg.match(/[\u4e00-\u9fa5]{2,}/) ?? [''])[0];
    return '';
  } catch {
    return '';
  }
}

/** URL 合法性粗校验（http/https/data） */
export function isImageUrl(url: string): boolean {
  const t = url.trim();
  return /^https?:\/\/\S+$/i.test(t) || /^data:image\//i.test(t);
}
