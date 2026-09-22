/**
 * 群聊数据层（宿主：微信 / QQ 双 App）。
 *
 * 设计要点：
 * - 群 = ChatGroup：独立会话实体（非联系人），成员是 AI 角色（char/npc）联系人 ID，机主固定参与；
 * - 会话身份 sessionKey = `<app>:group:<id>`（复用流总线/未读/标志/时间感知等按字符串键隔离的设施）；
 * - 存储：微信群 `wx-chat-groups`（历史数据兼容）、QQ 群 `qq-chat-groups` 两池分开，群 id 全局唯一，
 *   getGroup 双池查找；消息落 `<app>-group-msgs:<id>`（微信群沿用历史 wx-group-msgs 前缀）；
 * - 记忆互通开关 memoryInterop 按群独立（设置页唯一入口，不再有按成员覆盖）：开启时群记忆参与成员角色的
 *   私聊召回、角色私聊记忆参与群聊召回；effectiveInterop 统一解析，聊天页把结果以 interopOn 回调
 *   传给记忆召回；角色之间的隔离永远由记忆存储键（mem-frag:<contactId>）保证，与开关无关；
 * - 谁来回复由每个角色按自己的人设与消息内容自判（无需回复只回 [SKIP]，不落盘），@ 成员始终优先；
 * - 群红包（普通/拼手气/专属）与指定成员转账：消息落本群消息库，状态随群持久化（按群 ID 隔离，
 *   与单聊互不相通）；成员按人设领取/收款/退回，纯本地模拟不涉及真实资金；
 * - 解散群聊级联清理：群记录/群消息（含红包/转账卡片状态）/会话附属数据/群聊天背景 + 群来源记忆
 *   （onGroupDissolved 钩子由 memory 层注册，删去各成员记忆库里 sourceGroupId=本群的碎片/总结，
 *   依赖方向保持 memory → groups 单向，不反向 import）。
 */

import { kvDel, kvGet, kvSet } from './idb-kv';
import { genId, localDB } from './db';

// ---------------- 类型 ----------------

export type GroupApp = 'wx' | 'qq';

/** 群成员身份：群主 / 管理员 / 普通成员（机主与 AI 成员同一套规则，权限按身份分配） */
export type GroupMemberRole = 'owner' | 'admin' | 'member';

/** 群事件类型（系统消息 + AI 感知注入共用同一套分类） */
export type GroupEventType =
  | 'create'
  | 'join'
  | 'leave'
  | 'kick'
  | 'mute'
  | 'unmute'
  | 'admin-add'
  | 'admin-remove'
  | 'owner-transfer'
  | 'rename'
  | 'avatar'
  | 'announcement';

const EVENT_TYPES: ReadonlySet<string> = new Set([
  'create', 'join', 'leave', 'kick', 'mute', 'unmute', 'admin-add', 'admin-remove', 'owner-transfer', 'rename', 'avatar', 'announcement',
]);

/** 群事件详情（挂在系统消息上：渲染用 noticeText，AI 感知用 type + 文本） */
export interface GroupEventDetail {
  type: GroupEventType;
  /** 操作发起人联系人 ID（'me' = 机主；纯系统事件可省） */
  actorId?: string;
  /** 事件对象成员联系人 ID */
  targetId?: string;
  /** 附加信息（新群名/禁言时长文本等） */
  extra?: string;
}

export interface ChatGroup {
  id: string;
  /** 宿主 App（微信 / QQ） */
  app: GroupApp;
  name: string;
  /** 群备注名（仅机主自己可见；设置后聊天界面/消息列表优先显示备注，群资料真实名不变） */
  remark?: string;
  /** 群头像 dataURL；空 = 用成员头像拼贴渲染 */
  avatar: string | null;
  /** 创建者（机主）联系人 ID；可转让给任意成员（AI 成员也可成为群主） */
  ownerId: string;
  /** AI 角色成员联系人 ID（不含机主；机主恒为群成员） */
  memberIds: string[];
  /** 管理员联系人 ID 列表（不含群主；机主/AI 成员均可担任） */
  adminIds: string[];
  /** 禁言表：联系人 ID → 解禁时间戳（null = 永久；缺失 = 未禁言；过期视为自动解禁） */
  mutes: Record<string, number | null>;
  announcement: string;
  /** 群公告最近一次更新时间（QQ 群公告页展示；旧数据缺省） */
  annAt?: number;
  /** 群号（建群时分配的 9 位唯一数字，仅展示用途；旧群首次进入设置页时惰性补发并落盘） */
  no?: string;
  /** 记忆与私聊互通（按群独立；默认关闭 = 群记忆与私聊完全隔离；设置页唯一入口） */
  memoryInterop: boolean;
  createdAt: number;
}

/** 禁言时长预设（信息页禁言选择单；ms = null 表示永久） */
export const GROUP_MUTE_PRESETS: Array<{ label: string; ms: number | null }> = [
  { label: '10 分钟', ms: 10 * 60_000 },
  { label: '1 小时', ms: 60 * 60_000 },
  { label: '3 小时', ms: 3 * 60 * 60_000 },
  { label: '1 天', ms: 24 * 60 * 60_000 },
  { label: '永久', ms: null },
];

/**
 * 群红包数据（随群消息持久化；群间按群 ID 隔离、与单聊红包互不相通）。
 * 状态机：待领取（claims 空）→ 部分领取（0 < claims.length < count）→ 已抢完（claims.length ≥ count）/
 * 已过期（sentAt + 24h 后仍有剩余 → expired，剩余金额按剩余份退回发起人）。
 * 每个成员（含机主 'me'）领取记录独立，不能重复领取；专属红包只有被指定成员能领。
 */
export interface GroupRpData {
  /** 拼手气 = 总金额；普通/专属 = 单个金额 */
  amount: number;
  /** 红包个数（普通/专属固定 1..n；专属固定 1） */
  count: number;
  /** 普通 normal / 拼手气 lucky / 专属 exclusive */
  mode: 'normal' | 'lucky' | 'exclusive';
  blessing: string;
  /** 专属红包指定成员的联系人 ID / 名字（exclusive 时有值；其他人看到但不能领） */
  targetId?: string;
  targetName?: string;
  /** 领取记录（按领取顺序追加；contactId = 'me' 表示机主领取） */
  claims: Array<{ contactId: string; name: string; avatar: string | null; amount: number; ts: number }>;
  /** 发出时间（24h 过期判定基准） */
  sentAt: number;
  /** 已过期（剩余金额已退回发起人；终态不可再改） */
  expired?: boolean;
  expiredAt?: number;
  /** AI 处理动作用的短 ID（机主发的红包；成员在回复标记里引用） */
  cid?: string;
}

/** 群转账数据（机主 → 指定群成员；只有被选中的成员能收款；按群 ID 隔离） */
export interface GroupTrData {
  amount: number;
  note: string;
  /** 指定收款成员（联系人 ID / 名字；只有 TA 能收款，其他人只看到有转账发生） */
  toId: string;
  toName: string;
  received?: boolean;
  receivedAt?: number;
  /** 退还/拒收终态（被指定成员退回/拒收；终态后不可再改） */
  status?: 'returned' | 'rejected';
  /** AI 处理动作用的短 ID */
  cid?: string;
}

/** 合并转发「聊天记录」卡片里的一条对话快照（与单聊 FwdRecord 同构；转发卡片随群消息持久化） */
export interface GroupFwdRecord {
  name: string;
  role: 'me' | 'peer';
  text: string;
  /** 原消息引用了其他消息时的引用行（「名字：内容」） */
  quote?: string;
  time: number;
  /** 记录快照自带头像（转发时定格原说话人头像；详情页用它渲染） */
  avatar?: string | null;
  /** 原消息类型快照：表情包/图片详情页显示原图，其余显示 text 文字 */
  kind?: 'text' | 'sticker' | 'image';
  imgSrc?: string;
  stkMeaning?: string;
}

/** 群消息：role 沿用 me/peer 语义，senderId 区分具体发言人（'me' = 机主，否则为角色联系人 ID） */
export interface WxGroupMsg {
  id: string;
  role: 'me' | 'peer';
  senderId: string;
  senderName: string;
  content: string;
  time: number;
  kind?: 'text' | 'notice' | 'image' | 'location' | 'sticker' | 'redpacket' | 'transfer' | 'forward';
  /** 群红包卡片数据（kind = 'redpacket' 时有值） */
  rp?: GroupRpData;
  /** 群转账卡片数据（kind = 'transfer' 时有值） */
  tr?: GroupTrData;
  /** 系统通知行（进群/退出等），居中灰字渲染；有 notice（红包/转账通知）时用带图标的彩色尾词样式 */
  noticeText?: string;
  /** 群事件详情（noticeText 为群事件文本时有值：加入/退出/禁言/管理员/转让/改名/公告/建群）；
   *  事件不参与 AI 正常回复（历史过滤掉），但会按时间排序注入 system 让成员感知 */
  evt?: GroupEventDetail;
  /** 资金通知行数据（xx领取了你的红包/收下了你的转账；渲染用彩色尾词行） */
  notice?: { icon: 'rp' | 'tr' | 'fam'; pre: string; accent: string };
  img?: { src: string };
  /** 位置卡片消息（群里所有角色可见，进上下文映射为 [位置] 文本） */
  loc?: { name: string; address: string };
  /** 表情包消息（用户从表情面板发送；AI 上下文映射为 [发送了表情：意思]） */
  stk?: { url: string; meaning: string; sid?: string };
  quote?: {
    name: string;
    content: string;
    /** 引用源消息 ID（原消息删除/撤回后引用显示「原消息已删除」） */
    id?: string;
    /** 被引用消息的发送时间（QQ 引用卡显示「星期X HH:MM」样式；旧数据缺省由 UI 回源查找兜底） */
    time?: number;
  };
  recalled?: boolean;
  /** 转发卡片（kind='forward'；fwd.from = 来源会话名；merged=true 为合并转发的「聊天记录」卡片，records 存原始对话） */
  fwd?: { from: string; merged?: boolean; title?: string; records?: GroupFwdRecord[] };
}

// ---------------- 存储（IndexedDB kv 写穿层，与消息/记忆同款） ----------------

/** 两个宿主各自的群池（微信群沿用历史键，QQ 独立新键） */
const POOLS: Record<GroupApp, string> = { wx: 'wx-chat-groups', qq: 'qq-chat-groups' };
const MSGS_CAP = 200;

/** 会话级 localStorage map 键（未读/标志/隐藏）：按宿主区分，解散群时同构清理 */
const LS_MAPS: Record<GroupApp, { unreads: string; flags: string; hidden: string }> = {
  wx: { unreads: 'wx-chat-unreads', flags: 'wx-chat-flags', hidden: 'wx-chat-hidden' },
  qq: { unreads: 'qq-chat-unreads', flags: 'qq-chat-flags', hidden: 'qq-chat-hidden' },
};

const groupMsgsKey = (app: GroupApp, groupId: string) => `${app}-group-msgs:${groupId}`;

function readJSON<T>(key: string): T | null {
  try {
    return kvGet<T>(key);
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    kvSet(key, value);
  } catch {
    // 存储失败不中断（群是增强能力）
  }
}

// ---------------- 群 CRUD ----------------

/** 群成员人数上限（对齐真微信群的「人多即散」体验上限；防止 AI 回合无节制放大） */
export const GROUP_MEMBER_CAP = 50;

function normalizeGroup(g: unknown): ChatGroup | null {
  if (!g || typeof g !== 'object') return null;
  const r = g as Partial<ChatGroup>;
  if (typeof r.id !== 'string' || !Array.isArray(r.memberIds)) return null;
  return {
    id: r.id,
    app: r.app === 'qq' ? 'qq' : 'wx',
    name: typeof r.name === 'string' ? r.name : '未命名群聊',
    // 群备注为新增字段：旧数据缺省补空串
    remark: typeof r.remark === 'string' ? r.remark : '',
    avatar: typeof r.avatar === 'string' ? r.avatar : null,
    ownerId: typeof r.ownerId === 'string' ? r.ownerId : '',
    memberIds: r.memberIds.filter((x): x is string => typeof x === 'string'),
    // 管理员/禁言为新增字段：旧数据缺省补空值（normalize 保证读写形状一致）
    adminIds: Array.isArray(r.adminIds) ? r.adminIds.filter((x): x is string => typeof x === 'string') : [],
    mutes:
      r.mutes && typeof r.mutes === 'object' && !Array.isArray(r.mutes)
        ? Object.fromEntries(
            Object.entries(r.mutes as Record<string, unknown>).filter(
              (entry): entry is [string, number | null] => typeof entry[0] === 'string' && (entry[1] === null || typeof entry[1] === 'number'),
            ),
          )
        : {},
    announcement: typeof r.announcement === 'string' ? r.announcement : '',
    annAt: typeof r.annAt === 'number' ? r.annAt : undefined,
    no: typeof r.no === 'string' && /^\d{6,}$/.test(r.no) ? r.no : undefined,
    memoryInterop: r.memoryInterop === true,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
  };
}

function readPool(app: GroupApp): ChatGroup[] {
  const raw = readJSON<ChatGroup[]>(POOLS[app]);
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeGroup).filter((g): g is ChatGroup => g != null);
}

function writePool(app: GroupApp, list: ChatGroup[]): void {
  writeJSON(POOLS[app], list);
}

/** 全部群（双宿主；app 传参时只看该宿主） */
export function listGroups(app?: GroupApp): ChatGroup[] {
  if (app) return readPool(app);
  return [...readPool('wx'), ...readPool('qq')];
}

/** 生成唯一群号（9 位数字、首位非 0；跨双宿主查重，保证每个群的群号都不一样） */
function genUniqueGroupNo(): string {
  const used = new Set(listGroups().map((g) => g.no).filter((x): x is string => Boolean(x)));
  for (let i = 0; i < 50; i++) {
    const no = String(Math.floor(100000000 + Math.random() * 900000000));
    if (!used.has(no)) return no;
  }
  return String(Date.now()).slice(-9); // 极端兜底：时间尾数（同毫秒建多群概率可忽略）
}

/** 群号（建群时已分配则直接返回；旧群缺省时惰性生成唯一号码并落盘，同群恒定） */
export function ensureGroupNo(groupId: string): string {
  const g = getGroup(groupId);
  if (!g) return '';
  if (g.no) return g.no;
  const no = genUniqueGroupNo();
  const list = readPool(g.app);
  const idx = list.findIndex((x) => x.id === groupId);
  if (idx !== -1) {
    list[idx] = { ...list[idx], no };
    writePool(g.app, list);
  }
  return no;
}

export function getGroup(groupId: string): ChatGroup | null {
  return listGroups().find((g) => g.id === groupId) ?? null;
}

export function createGroup(input: {
  name: string;
  memberIds: string[];
  ownerId: string;
  /** 宿主 App（缺省 wx，兼容旧调用） */
  app?: GroupApp;
  avatar?: string | null;
  announcement?: string;
}): ChatGroup {
  const app: GroupApp = input.app ?? 'wx';
  const group: ChatGroup = {
    id: genId(),
    app,
    name: input.name.trim() || '未命名群聊',
    avatar: input.avatar ?? null,
    ownerId: input.ownerId,
    memberIds: Array.from(new Set(input.memberIds)).slice(0, GROUP_MEMBER_CAP),
    adminIds: [],
    mutes: {},
    announcement: input.announcement?.trim() ?? '',
    no: genUniqueGroupNo(),
    memoryInterop: false,
    createdAt: Date.now(),
  };
  writePool(app, [...readPool(app), group]);
  // 建群系统消息（三.9）：居中灰字「群聊创建」，随群消息持久化
  pushGroupEvent(group.id, '群聊创建', { type: 'create' });
  return group;
}

/**
 * 更新群（名字/头像/公告/互通开关/成员等）；返回更新后的群（群不存在返回 null）。
 * 群资料变更（改名/换头像/改公告）自动落一条群事件系统消息（三.7/8：所有操作要生成对应系统消息），
 * 机主无关调用方是谁（信息页/聊天页/宿主壳层统一在此处发事件，避免遗漏）。
 */
export function updateGroup(
  groupId: string,
  patch: Partial<Pick<ChatGroup, 'name' | 'remark' | 'avatar' | 'announcement' | 'memoryInterop' | 'memberIds'>>
): ChatGroup | null {
  const app = getGroup(groupId)?.app;
  if (!app) return null;
  const list = readPool(app);
  const idx = list.findIndex((g) => g.id === groupId);
  if (idx === -1) return null;
  const prev = list[idx];
  const next: ChatGroup = { ...prev, ...patch };
  if (patch.name !== undefined) next.name = patch.name.trim() || next.name;
  if (patch.remark !== undefined) next.remark = patch.remark.trim();
  list[idx] = next;
  writePool(app, list);
  // 群资料事件（只在值真正变化时发，成员增删走专用函数不经过这里）
  if (patch.name !== undefined && next.name !== prev.name) {
    pushGroupEvent(groupId, `群名被修改为「${next.name}」`, { type: 'rename', extra: next.name });
  }
  if (patch.avatar !== undefined && (patch.avatar ?? null) !== (prev.avatar ?? null)) {
    pushGroupEvent(groupId, '群头像已更新', { type: 'avatar' });
  }
  if (patch.announcement !== undefined && (patch.announcement ?? '') !== (prev.announcement ?? '')) {
    next.annAt = Date.now();
    pushGroupEvent(groupId, '群公告已更新', { type: 'announcement' });
  }
  return next;
}

/** 邀请成员：已在群里原样返回；人数达上限（GROUP_MEMBER_CAP）返回 null（UI 提示「已达上限」）。
 *  成功时落「XX加入了群聊」系统消息（三.1；opts.name = 新成员显示名，供事件文本使用）。 */
export function addGroupMember(groupId: string, contactId: string, opts?: { name?: string }): ChatGroup | null {
  const g = getGroup(groupId);
  if (!g) return null;
  if (g.memberIds.includes(contactId)) return g;
  if (g.memberIds.length >= GROUP_MEMBER_CAP) return null;
  const next = updateGroup(groupId, { memberIds: [...g.memberIds, contactId] });
  if (next && opts?.name) {
    pushGroupEvent(groupId, `${opts.name}加入了群聊`, { type: 'join', targetId: contactId });
  }
  return next;
}

/** 原始移除（不发事件；供联系人删除级联等内部路径使用；UI 踢人请用 kickGroupMember） */
export function removeGroupMember(groupId: string, contactId: string): ChatGroup | null {
  const g = getGroup(groupId);
  if (!g) return null;
  return updateGroup(groupId, { memberIds: g.memberIds.filter((id) => id !== contactId) });
}

// ---------------- 群角色 / 禁言 / 群事件 ----------------

/** 成员身份：群主 > 管理员 > 普通成员（ownerId 命中即群主，其次 adminIds，其余为普通成员） */
export function groupRoleOf(g: ChatGroup, contactId: string): GroupMemberRole {
  if (g.ownerId === contactId) return 'owner';
  if (g.adminIds.includes(contactId)) return 'admin';
  return 'member';
}

/** 群显示名：有备注用备注（仅机主自己可见），否则用群名（聊天顶栏/消息列表/群列表统一走这里） */
export function groupDisplayName(g: Pick<ChatGroup, 'name' | 'remark'>): string {
  const rk = g.remark?.trim();
  return rk ? rk : g.name;
}

/** 是否处于禁言中（永久禁言或未到解禁时间；过期即视为自动解禁，无需写回） */
export function isGroupMuted(g: ChatGroup, contactId: string, now: number = Date.now()): boolean {
  const until = g.mutes[contactId];
  if (until === null) return true;
  if (typeof until === 'number' && until > now) return true;
  return false;
}

/** 禁言剩余描述（「剩 X 分钟 / X 小时 / X 天」或「永久」；未禁言返回 null） */
export function groupMuteLeftText(g: ChatGroup, contactId: string, now: number = Date.now()): string | null {
  const until = g.mutes[contactId];
  if (until === null) return '永久';
  if (typeof until !== 'number' || until <= now) return null;
  const left = Math.max(1, Math.ceil((until - now) / 60_000));
  if (left < 60) return `剩 ${left} 分钟`;
  const hours = Math.ceil(left / 60);
  if (hours < 24) return `剩 ${hours} 小时`;
  return `剩 ${Math.ceil(hours / 24)} 天`;
}

/** 时长毫秒 → 人类可读（事件文本用；固定档位优先用 GROUP_MUTE_PRESETS 的 label） */
function muteDurationText(ms: number | null): string {
  if (ms === null) return '永久';
  const preset = GROUP_MUTE_PRESETS.find((p) => p.ms === ms);
  if (preset) return preset.label;
  if (ms % 60_000 === 0) {
    const mins = ms / 60_000;
    if (mins % 60 === 0) return `${mins / 60} 小时`;
    return `${mins} 分钟`;
  }
  return `${Math.round(ms / 60_000)} 分钟`;
}

/**
 * 追加一条群事件系统消息（居中灰字；随群消息持久化）。
 * 事件不参与 AI 正常回复（历史/预览都过滤），但会经 collectGroupEventLines 按时间注入 system。
 * 追加失败（群不存在/存储异常）返回 null，不阻塞调用方。
 */
export function pushGroupEvent(groupId: string, text: string, evt: GroupEventDetail): WxGroupMsg | null {
  const g = getGroup(groupId);
  if (!g) return null;
  const msg: WxGroupMsg = {
    id: genId(),
    role: 'peer',
    senderId: 'system',
    senderName: '',
    content: '',
    time: Date.now(),
    kind: 'notice',
    noticeText: text,
    evt,
  };
  try {
    const key = groupMsgsKey(g.app, groupId);
    const cur = readJSON<WxGroupMsg[]>(key);
    const list = Array.isArray(cur) ? cur : [];
    writeJSON(key, [...list, msg].slice(-MSGS_CAP));
  } catch {
    return null;
  }
  return msg;
}

/** 设置/取消管理员（仅群主可操作；群主本人不能被设为管理员）。opts.name 供事件文本。 */
export function setGroupAdmin(groupId: string, contactId: string, admin: boolean, opts?: { name?: string }): ChatGroup | null {
  const g = getGroup(groupId);
  if (!g || contactId === g.ownerId) return g ?? null;
  const has = g.adminIds.includes(contactId);
  if (admin === has) return g; // 幂等：状态不变不发事件
  const adminIds = admin ? [...g.adminIds, contactId] : g.adminIds.filter((id) => id !== contactId);
  const app = g.app;
  const list = readPool(app);
  const idx = list.findIndex((x) => x.id === groupId);
  if (idx === -1) return null;
  list[idx] = { ...g, adminIds };
  writePool(app, list);
  const name = opts?.name ?? '群成员';
  pushGroupEvent(groupId, admin ? `${name}成为管理员` : `${name}被取消管理员`, {
    type: admin ? 'admin-add' : 'admin-remove',
    targetId: contactId,
  });
  return list[idx];
}

/** 禁言（群主可禁言除自己外的任何成员；管理员只应禁言普通成员——权限门控由 UI 层负责，数据层只拦群主）。duration=null 表示永久 */
export function muteGroupMember(groupId: string, contactId: string, duration: number | null, opts?: { name?: string }): ChatGroup | null {
  const g = getGroup(groupId);
  if (!g || contactId === g.ownerId) return g ?? null;
  const mutes = { ...g.mutes, [contactId]: duration === null ? null : Date.now() + duration };
  const app = g.app;
  const list = readPool(app);
  const idx = list.findIndex((x) => x.id === groupId);
  if (idx === -1) return null;
  list[idx] = { ...g, mutes };
  writePool(app, list);
  const name = opts?.name ?? '群成员';
  pushGroupEvent(groupId, `${name}被禁言${muteDurationText(duration)}`, {
    type: 'mute',
    targetId: contactId,
    extra: muteDurationText(duration),
  });
  return list[idx];
}

/** 解除禁言（未禁言时静默返回，不发事件） */
export function unmuteGroupMember(groupId: string, contactId: string, opts?: { name?: string }): ChatGroup | null {
  const g = getGroup(groupId);
  if (!g || !(contactId in g.mutes)) return g;
  const mutes = { ...g.mutes };
  delete mutes[contactId];
  const app = g.app;
  const list = readPool(app);
  const idx = list.findIndex((x) => x.id === groupId);
  if (idx === -1) return null;
  list[idx] = { ...g, mutes };
  writePool(app, list);
  if (opts?.name) {
    pushGroupEvent(groupId, `${opts.name}被解除禁言`, { type: 'unmute', targetId: contactId });
  }
  return list[idx];
}

/** 踢人（移出群聊）：群主不可被移出；成功落「XX被移出群聊」事件（三.3）；被移出者不再参与该群回复 */
export function kickGroupMember(groupId: string, contactId: string, opts?: { name?: string }): ChatGroup | null {
  const g = getGroup(groupId);
  if (!g || contactId === g.ownerId) return g ?? null;
  if (!g.memberIds.includes(contactId)) return g;
  const next = updateGroup(groupId, { memberIds: g.memberIds.filter((id) => id !== contactId) });
  if (next) {
    // 被踢成员的管理员身份/禁言记录一并清理（人已不在群里）
    if (next.adminIds.includes(contactId) || contactId in next.mutes) {
      const app = g.app;
      const list = readPool(app);
      const idx = list.findIndex((x) => x.id === groupId);
      if (idx !== -1) {
        list[idx] = {
          ...next,
          adminIds: next.adminIds.filter((id) => id !== contactId),
          mutes: Object.fromEntries(Object.entries(next.mutes).filter(([k]) => k !== contactId)),
        };
        writePool(app, list);
      }
    }
    const name = opts?.name ?? '群成员';
    pushGroupEvent(groupId, `${name}被移出群聊`, { type: 'kick', targetId: contactId });
  }
  return next;
}

/** 转让群主：新群主从管理员列表移除（群主不兼任管理员），原群主变为普通成员；落「群主转让给 XX」事件（三.6） */
export function transferGroupOwner(groupId: string, newOwnerId: string, opts?: { name?: string }): ChatGroup | null {
  const g = getGroup(groupId);
  if (!g || !newOwnerId || newOwnerId === g.ownerId) return g;
  const app = g.app;
  const list = readPool(app);
  const idx = list.findIndex((x) => x.id === groupId);
  if (idx === -1) return null;
  list[idx] = { ...g, ownerId: newOwnerId, adminIds: g.adminIds.filter((id) => id !== newOwnerId) };
  writePool(app, list);
  if (opts?.name) {
    pushGroupEvent(groupId, `群主转让给 ${opts.name}`, { type: 'owner-transfer', targetId: newOwnerId });
  }
  return list[idx];
}

/**
 * 收集本群最近的群事件行（按时间升序，AI system 注入用；四.1/4.3：事件按时间排序注入，不能错乱）。
 * 返回「- 刚刚：红红加入了群聊」形态的行数组；无事件返回空数组。
 */
export function collectGroupEventLines(groupId: string, limit = 12, now: number = Date.now()): string[] {
  return loadGroupMsgs(groupId)
    .filter((m) => m.evt)
    .sort((a, b) => a.time - b.time)
    .slice(-limit)
    .map((m) => `- ${groupEventAgo(m.time, now)}：${m.noticeText ?? ''}`);
}

/** 事件相对时间标签（刚刚 / X 分钟前 / X 小时前 / 昨天 / M月D日 HH:MM） */
export function groupEventAgo(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))} 小时前`;
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const yest = new Date(now - 24 * 60 * 60_000);
  if (d.getFullYear() === yest.getFullYear() && d.getMonth() === yest.getMonth() && d.getDate() === yest.getDate()) {
    return `昨天 ${hh}:${mm}`;
  }
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

/**
 * 该群的记忆互通生效值：只跟群级开关（按成员覆盖已移除，旧数据里的覆盖记录随 normalize 丢弃）。
 * 群不存在一律视为隔离。
 */
export function effectiveInterop(groupId: string): boolean {
  return getGroup(groupId)?.memoryInterop === true;
}

/** 从 localStorage JSON map 里删掉一个键（unreads/flags/hidden/time-aware 同构清理用） */
function removeLocalMapKey(lsKey: string, id: string): void {
  try {
    const raw = localStorage.getItem(lsKey);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, unknown>;
    if (!(id in map)) return;
    delete map[id];
    localStorage.setItem(lsKey, JSON.stringify(map));
  } catch {
    // 忽略
  }
}

type GroupDissolveHook = (group: ChatGroup) => void;
const dissolveHooks: GroupDissolveHook[] = [];

/** 注册「群已解散」钩子（依赖方各自注册清理逻辑；群数据层不反向依赖记忆层）。
 *  钩子异常互不影响：单个失败不阻塞其它清理，也不阻塞解散本身。 */
export function onGroupDissolved(fn: GroupDissolveHook): void {
  dissolveHooks.push(fn);
}

/**
 * 解散群聊：删除群 + 群消息（红包/转账卡片状态随消息一并清除）+ 会话级附属数据
 * （未读/标志/隐藏/时间感知/每成员的群记忆提取轮次计数/群聊天背景）+ 群来源记忆
 * （通过 onGroupDissolved 钩子级联，见 memory 层 memPurgeGroupSource）。
 * opts.purgeMemory = false 时跳过群来源记忆清理（用于「退出群聊」：群对其他成员仍然存在，
 * AI 成员的群记忆应当保留，只有机主本机删除该群）。
 * 返回被解散的群（供 UI 提示），群不存在返回 null。
 */
export function dissolveGroup(groupId: string, opts?: { purgeMemory?: boolean }): ChatGroup | null {
  const g = getGroup(groupId);
  if (!g) return null;
  writePool(g.app, readPool(g.app).filter((x) => x.id !== groupId));
  try {
    kvDel(groupMsgsKey(g.app, groupId));
    // 未读/标志/隐藏为 localStorage JSON map（键 = 会话 id；群会话 id = `group:<gid>`）
    const maps = LS_MAPS[g.app];
    removeLocalMapKey(maps.unreads, `group:${groupId}`);
    removeLocalMapKey(maps.flags, `group:${groupId}`);
    removeLocalMapKey(maps.hidden, `group:${groupId}`);
    // 时间感知开关（localStorage map 里的键）
    removeLocalMapKey('chat-time-aware', `${g.app}:group:${groupId}`);
    // 每个成员的群记忆提取轮次计数（mem-round:<contactId>:<app>:group:<gid>）
    for (const cid of g.memberIds) {
      kvDel(`mem-round:${cid}:${g.app}:group:${groupId}`);
    }
    // 群聊天背景图片本体（IndexedDB settings store，键同 contacts-store 的 chat-bg 前缀；群背景与单聊相互独立）
    void localDB.delete('settings', `chat-bg:${g.app}:group:${groupId}`).catch(() => undefined);
  } catch {
    // 清理失败不阻塞解散
  }
  // 群来源记忆级联清理（钩子逐个调用；单个钩子异常不影响其余清理，更不阻塞解散）。
  // opts.purgeMemory = false（退出群聊）时跳过：群对 AI 成员仍然存在，记忆保留。
  if (opts?.purgeMemory !== false) {
    for (const fn of dissolveHooks) {
      try {
        fn(g);
      } catch {
        // 忽略
      }
    }
  }
  return g;
}

/**
 * 退出群聊（机主本人退群）：本机删除该群（群记录/消息/未读/标志/时间感知/背景等附属数据），
 * 但不清 AI 成员的群来源记忆（群对其他成员仍然存在，他们记得群里发生过什么）。
 * 与「解散群聊」的区别：解散 = 群对所有人消失且记忆级联清理；退出 = 仅机主本机移除。
 */
export function quitGroup(groupId: string): ChatGroup | null {
  return dissolveGroup(groupId, { purgeMemory: false });
}

/** 从所有群中移除某联系人（删除联系人级联）；成员清空的群自动解散。返回受影响的群名（toast 汇总用）。
 *  opts.name 提供时给留下的成员落「XX退出了群聊」事件（三.2；AI 由此知道人为什么不见了）。 */
export function purgeContactFromGroups(contactId: string, opts?: { name?: string }): string[] {
  const affected: string[] = [];
  for (const g of listGroups()) {
    if (!g.memberIds.includes(contactId)) continue;
    affected.push(g.name);
    const next = g.memberIds.filter((id) => id !== contactId);
    if (next.length === 0) {
      dissolveGroup(g.id);
    } else {
      updateGroup(g.id, { memberIds: next });
      if (opts?.name) {
        pushGroupEvent(g.id, `${opts.name}退出了群聊`, { type: 'leave', targetId: contactId });
      }
    }
  }
  return affected;
}

// ---------------- 群消息存取 ----------------

function normalizeMsg(m: unknown): WxGroupMsg | null {
  if (!m || typeof m !== 'object') return null;
  const r = m as Partial<WxGroupMsg>;
  if (typeof r.id !== 'string' || typeof r.content !== 'string' || typeof r.time !== 'number') return null;
  return {
    id: r.id,
    role: r.role === 'me' ? 'me' : 'peer',
    senderId: typeof r.senderId === 'string' ? r.senderId : 'unknown',
    senderName: typeof r.senderName === 'string' ? r.senderName : '',
    content: r.content,
    time: r.time,
    kind:
      r.kind === 'notice' || r.kind === 'image' || r.kind === 'location' || r.kind === 'sticker' || r.kind === 'redpacket' || r.kind === 'transfer' || r.kind === 'forward'
        ? r.kind
        : 'text',
    rp:
      r.kind === 'redpacket' && r.rp && typeof r.rp.amount === 'number'
        ? {
            amount: r.rp.amount,
            count: typeof r.rp.count === 'number' && r.rp.count >= 1 ? Math.floor(r.rp.count) : 1,
            mode: r.rp.mode === 'lucky' || r.rp.mode === 'exclusive' ? r.rp.mode : 'normal',
            blessing: typeof r.rp.blessing === 'string' ? r.rp.blessing : '恭喜发财，大吉大利',
            targetId: typeof r.rp.targetId === 'string' ? r.rp.targetId : undefined,
            targetName: typeof r.rp.targetName === 'string' ? r.rp.targetName : undefined,
            claims: Array.isArray(r.rp.claims)
              ? r.rp.claims
                  .filter((c): c is GroupRpData['claims'][number] => Boolean(c) && typeof (c as { name?: unknown }).name === 'string')
                  .map((c) => ({
                    contactId: typeof c.contactId === 'string' ? c.contactId : '',
                    name: c.name,
                    avatar: typeof c.avatar === 'string' ? c.avatar : null,
                    amount: typeof c.amount === 'number' ? c.amount : 0,
                    ts: typeof c.ts === 'number' ? c.ts : 0,
                  }))
              : [],
            sentAt: typeof r.rp.sentAt === 'number' ? r.rp.sentAt : r.time,
            expired: r.rp.expired === true || undefined,
            expiredAt: typeof r.rp.expiredAt === 'number' ? r.rp.expiredAt : undefined,
            cid: typeof r.rp.cid === 'string' ? r.rp.cid : undefined,
          }
        : undefined,
    tr:
      r.kind === 'transfer' && r.tr && typeof r.tr.amount === 'number'
        ? {
            amount: r.tr.amount,
            note: typeof r.tr.note === 'string' ? r.tr.note : '',
            toId: typeof r.tr.toId === 'string' ? r.tr.toId : '',
            toName: typeof r.tr.toName === 'string' ? r.tr.toName : '',
            received: r.tr.received === true || undefined,
            receivedAt: typeof r.tr.receivedAt === 'number' ? r.tr.receivedAt : undefined,
            status: r.tr.status === 'returned' || r.tr.status === 'rejected' ? r.tr.status : undefined,
            cid: typeof r.tr.cid === 'string' ? r.tr.cid : undefined,
          }
        : undefined,
    noticeText: typeof r.noticeText === 'string' ? r.noticeText : undefined,
    evt:
      r.evt && typeof r.evt.type === 'string' && EVENT_TYPES.has(r.evt.type)
        ? {
            type: r.evt.type as GroupEventDetail['type'],
            actorId: typeof r.evt.actorId === 'string' ? r.evt.actorId : undefined,
            targetId: typeof r.evt.targetId === 'string' ? r.evt.targetId : undefined,
            extra: typeof r.evt.extra === 'string' ? r.evt.extra : undefined,
          }
        : undefined,
    notice:
      r.notice && typeof r.notice.pre === 'string' && typeof r.notice.accent === 'string'
        ? { icon: r.notice.icon === 'tr' || r.notice.icon === 'fam' ? r.notice.icon : 'rp', pre: r.notice.pre, accent: r.notice.accent }
        : undefined,
    img: r.img && typeof r.img.src === 'string' ? { src: r.img.src } : undefined,
    loc:
      r.loc && typeof r.loc.name === 'string' && typeof r.loc.address === 'string'
        ? { name: r.loc.name, address: r.loc.address }
        : undefined,
    stk:
      r.stk && typeof r.stk.url === 'string'
        ? { url: r.stk.url, meaning: typeof r.stk.meaning === 'string' ? r.stk.meaning : '', sid: typeof r.stk.sid === 'string' ? r.stk.sid : undefined }
        : undefined,
    quote:
      r.quote && typeof r.quote.name === 'string' && typeof r.quote.content === 'string'
        ? {
            name: r.quote.name,
            content: r.quote.content,
            // 引用源消息 ID（删除/撤回后把引用内容改写为「原消息已删除」用；旧数据无此字段照常渲染）
            id: typeof r.quote.id === 'string' ? r.quote.id : undefined,
          }
        : undefined,
    recalled: r.recalled === true,
    fwd:
      r.kind === 'forward' && r.fwd && typeof r.fwd.from === 'string'
        ? {
            from: r.fwd.from,
            merged: r.fwd.merged === true || undefined,
            title: typeof r.fwd.title === 'string' ? r.fwd.title : undefined,
            records: Array.isArray(r.fwd.records)
              ? r.fwd.records
                  .filter((x): x is GroupFwdRecord => Boolean(x) && typeof (x as GroupFwdRecord).name === 'string' && typeof (x as GroupFwdRecord).text === 'string')
                  .map((x) => ({
                    name: x.name,
                    role: x.role === 'me' ? ('me' as const) : ('peer' as const),
                    text: x.text,
                    quote: typeof x.quote === 'string' ? x.quote : undefined,
                    time: typeof x.time === 'number' ? x.time : 0,
                    avatar: typeof x.avatar === 'string' ? x.avatar : x.avatar === null ? null : undefined,
                    kind: x.kind === 'sticker' || x.kind === 'image' ? x.kind : undefined,
                    imgSrc: typeof x.imgSrc === 'string' ? x.imgSrc : undefined,
                    stkMeaning: typeof x.stkMeaning === 'string' ? x.stkMeaning : undefined,
                  }))
              : undefined,
          }
        : undefined,
  };
}

export function loadGroupMsgs(groupId: string): WxGroupMsg[] {
  const app = getGroup(groupId)?.app ?? 'wx';
  const raw = readJSON<WxGroupMsg[]>(groupMsgsKey(app, groupId));
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeMsg).filter((m): m is WxGroupMsg => m != null);
}

/** 落盘（保留最后 200 条，与私聊同量级） */
export function saveGroupMsgs(groupId: string, msgs: WxGroupMsg[]): void {
  const app = getGroup(groupId)?.app ?? 'wx';
  writeJSON(groupMsgsKey(app, groupId), msgs.slice(-MSGS_CAP));
}

/** 该群最后一条非通知消息（会话列表预览用） */
export function groupPreview(groupId: string): { text: string; time: number } {
  const msgs = loadGroupMsgs(groupId);
  const last = [...msgs].reverse().find((m) => m.kind !== 'notice');
  if (!last) return { text: '', time: 0 };
  if (last.recalled) return { text: `${last.role === 'me' ? '你' : last.senderName || '有人'}撤回了一条消息`, time: last.time };
  if (last.kind === 'image') return { text: '[图片]', time: last.time };
  if (last.kind === 'sticker') return { text: `[表情]${last.stk?.meaning ? ` ${last.stk.meaning}` : ''}`, time: last.time };
  if (last.kind === 'location') return { text: `[位置] ${last.loc?.name ?? ''}`.trim(), time: last.time };
  if (last.kind === 'redpacket') return { text: '[红包]', time: last.time };
  if (last.kind === 'transfer') return { text: '[转账]', time: last.time };
  if (last.kind === 'forward') return { text: last.fwd?.merged ? '[聊天记录]' : last.content, time: last.time };
  const prefix = last.role === 'me' ? '我' : last.senderName;
  return { text: `${prefix}：${last.content}`, time: last.time };
}
