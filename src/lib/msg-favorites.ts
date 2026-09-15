/**
 * 消息收藏（微信 / QQ 双端共用存储模型；「信息」App 无收藏功能）：
 * - localStorage 分端存储：wx-favorites / qq-favorites
 * - 收藏项 = 原消息快照（文本 / 表情 / 图片 / 位置 / 卡片摘要）+ 来源会话信息
 * - 聊天气泡长按菜单「收藏」与多选批量收藏写入；收藏页（微信「我」/ QQ 个人抽屉）读取
 */

export type FavApp = 'wx' | 'qq';

export interface MsgFavorite {
  id: string;
  app: FavApp;
  /** 来源会话联系人 */
  contactId: string;
  contactName: string;
  contactAvatar: string | null;
  /** 原消息发送方：me=我发的，peer=对方发的 */
  msgRole: 'me' | 'peer';
  /** 内容类型：text / sticker / image / location / redpacket / transfer / family / forward */
  kind: string;
  /** 文本内容或占位描述（[图片] / [表情] xx / [位置] xx / [红包] …） */
  content: string;
  /** 图片消息原图（dataURL） */
  imgSrc?: string;
  /** 表情消息图 */
  stkUrl?: string;
  /** 原消息时间 */
  time: number;
  /** 收藏时间 */
  savedAt: number;
}

const LS_KEYS: Record<FavApp, string> = { wx: 'wx-favorites', qq: 'qq-favorites' };

export function favId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function loadFavorites(app: FavApp): MsgFavorite[] {
  try {
    const raw = window.localStorage.getItem(LS_KEYS[app]);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is MsgFavorite =>
        Boolean(x) &&
        typeof (x as MsgFavorite).id === 'string' &&
        typeof (x as MsgFavorite).content === 'string' &&
        typeof (x as MsgFavorite).contactId === 'string'
    );
  } catch {
    return [];
  }
}

export function saveFavorites(app: FavApp, list: MsgFavorite[]): void {
  try {
    window.localStorage.setItem(LS_KEYS[app], JSON.stringify(list.slice(-200)));
  } catch {
    // 持久化失败忽略
  }
}

/** 追加一条收藏（插到最前；新收藏 id 由本模块生成） */
export function addFavorite(app: FavApp, item: Omit<MsgFavorite, 'id' | 'app' | 'savedAt'>): MsgFavorite {
  const full: MsgFavorite = { ...item, id: favId(), app, savedAt: Date.now() };
  saveFavorites(app, [full, ...loadFavorites(app)]);
  return full;
}

export function removeFavorite(app: FavApp, id: string): void {
  saveFavorites(app, loadFavorites(app).filter((x) => x.id !== id));
}
