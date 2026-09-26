'use client';

/**
 * QQ App：
 * - 登录（对照真实 QQ 登录页）：① 账号密码登录（QQ号/QID/邮箱 + QQ密码）② 手机号登录（+86 手机号 + QQ密码，
 *   实际校验密码仍用联系人 qqPassword 字段）；账号数据来自「联系人 App」本地 IndexedDB
 * - 仅 kind='user' 的联系人可登录；char / npc 账号一律拦截（「该账号类型暂不支持登录」），
 *   未注册账号 / 密码错误分别给出提示
 * - 登录后：消息 / 联系人 / 动态 三个 tab（对照 QQ 新版首页）
 *   ① 消息：会话列表（已加好友的联系人）+ AI 聊天（蓝/白气泡，流式回复）
 *   ② 联系人：新朋友 / 群通知 + 分组(特别关心/我的好友折叠) / 好友 / 群聊… 多 tab；右上人+ 进添加好友页（找人/找群 + 推荐）
 *   ③ 动态：空间动态（QQ空间信息流，可发帖/点赞）/ 游戏中心 / 小游戏 / QQ经典农场 / 结伴与附近 / 小说与动漫 / 意见反馈
 * - 左上头像 → 个人中心抽屉（顶部封面图与资料页同一张背景图，深色玻璃打卡/状态 pills 叠加封面；
 *   切换账号/个签/相册收藏…/设置入口；点击封面空白处关闭）
 *   抽屉头像 → 个人资料页（QQ号/可编辑个签/徽章/资料完成度/QQ空间/发消息；背景图可上传（IndexedDB 永久保存））
 *   抽屉「钱包」→ QQ钱包（对照真机：主页四宫格余额/Q币/领福利/微粒贷 + 金融理财/游戏娱乐/生活服务宫格；
 *   余额页（可用余额/转到微信/微信转入 + 充值/提现/银行卡 + 账单 + 支付设置）/小金库（金色渐变，转入转出联动余额；
 *   收益每日按七日年化 1.5120% 结算：累计收益/昨日收益/收益详情页[万份收益/近7日柱状图/每日收益记录]）/
 *   支付设置（支付密码开启/关闭/修改，微信风格 6 位自绘数字键盘；开启后红包/转账/充值/提现/小金库变动均先弹键盘验证）/
 *   我的银行卡（品牌渐变卡列表[芯片/闪付波纹/卡号分组] + 添加银行卡：持卡人预填 QQ 昵称、卡号一键生成
 *   [Luhn 校验、BIN 跟随银行]、金额自定义、卡类型/银行选择，仅存本机；点击卡片进银行卡详情：
 *   卡内余额/持卡人/卡号复制/银行/类型/添加时间）/提现（余额→可选到账银行卡）/充值（可选付款银行卡→余额，卡内余额校验）/账单流水；localStorage 持久化）
 *   设置 → 账号与安全（账号管理切换账号/账号关联/安全管理）；设置底部「退出当前账号」回登录页
 * - 聊天页对照 QQ 真机美化（名字+在线、蓝白圆气泡带头像、
 *   底部六图标工具栏：图片=相册选图发送（压缩 dataURL）、拍摄=input capture 直调手机原生相机（对齐微信，无自建取景）；
 *   加号 → 底部弹出面板（语音通话/视频通话/红包/转账/位置），输入行跟随上浮；
 *   位置 → 发送位置页（内置常用地点 + 自定义位置表单，发送后聊天内出现位置卡片气泡）；
 *   红包 → 发红包页（普通/拼手气/专属 tab、祝福语、支付方式[余额/银行卡]、塞钱进红包）→ 聊天内红色 QQ红包卡片
 *   （企鹅+祝福语+開）→ 点击进红包详情（全屏沉浸红头直达状态栏+金色金额+手气最佳+领取列表）；
 *   转账 → 向好友转账页（头像/QQ号/金额/留言 0/12/支付方式）→ 蓝色转账卡片（已转入好友余额）→ 点击进交易详情
 *   （蓝圈对勾/金额/留言/时间）；开启支付密码后红包/转账/充值/提现/小金库变动先弹自绘数字键盘验证；
 *   红包/转账/位置消息随会话 localStorage 持久化，会话列表预览显示 [QQ红包]/[转账]/[图片]/[位置]）；
 *   页面任意位置水平左滑 → 好友标识页（成为好友N天/密友值/双头像心跳线/去绑定专属关系/我们的DNA：聊天小结/共同属性/友谊时间线三弹窗/幸运字符）；
 *   成为好友天数与密友值从 0 开始，按 QQ 规则增长：互发一条消息密友值 +2（每日上限 20），天数每日 +1
 * - 联系人点击 → 好友个人资料页（头像/QQ号/点赞/徽章/互动标识/他的QQ空间 + 音视频通话/送礼物/发消息）
 * - 添加好友页（找人/找群 + 七宫格 + 可能想认识的人）与「新朋友」页（同步通讯录/好友通知/可能想认识的人）
 *   为两个独立页面；搜索仅按 QQ 号匹配出联系人
 * - 空间动态全屏（顶部渐变区随页面滚动）；写说说页支持文字 + 照片（压缩后）发表
 * - 会话、空间帖子、评论、密友值、登录态 localStorage 持久化
 */

import { useLayoutEffect, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  AudioLines,
  Banknote,
  Bell,
  BellOff,
  BellRing,
  BookOpen,
  Bus,
  CalendarDays,
  Camera,
  Cat,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleUser,
  ClipboardList,
  Clock,
  CloudSun,
  CornerRightDown,
  CreditCard,
  Crown,
  Delete,
  Eye,
  EyeOff,
  Feather,
  FileText,
  Fingerprint,
  Flame,
  Flower2,
  Folder,
  Forward,
  Gamepad2,
  Gem,
  Gift,
  GraduationCap,
  Image as ImageIcon,
  Inbox,
  Info,
  KeyRound,
  Landmark,
  LayoutGrid,
  Link2,
  Loader2,
  LockKeyhole,
  LogOut,
  MailOpen,
  MapPin,
  Menu,
  MessageCircle,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  MonitorSmartphone,
  Moon,
  MoreHorizontal,
  Phone,
  PiggyBank,
  Pin,
  PinOff,
  Plus,
  FolderOutput,
  Hash,
  JapaneseYen,
  QrCode,
  Radio,
  ScanLine,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Shirt,
  SlidersHorizontal,
  Smartphone,
  Smile,
  SmilePlus,
  Sparkles,
  Sprout,
  SquarePen,
  Star,
  Tag,
  ThumbsUp,
  Trash2,
  TrendingUp,
  Undo2,
  User,
  UserPlus,
  Users,
  Video,
  Volume2,
  Wallet,
  X,
} from 'lucide-react';
import { useSettings, useUI } from '@/lib/ios/store';
import { pushChatNotification, notifyPreviewText, takeNotifyNavigation, ISLAND_NAV_EVENT } from '@/lib/ios/island-notify';
import { scheduleAiDelivery, subscribeAiDelivery, subscribeAiDeliveryActive, isAiDelivering, typingDelayOf } from '@/lib/ios/ai-delivery';
import { stopSpeaking } from '@/lib/ios/tts-client';
import { VoiceMsgBubble, type VoiceMsgData } from '@/components/apps/voice-bubble';
import { CallCardBubble, callResultToCardState, callCardAiText, type CallCardState } from './voice-call-screen';
import type { ChatCallResult, ChatCallTurnMsg } from '@/lib/ios/chat-call';
import { startGlobalCall } from '@/lib/ios/global-call';
import { buildLocationBlock, locationAiText, locDataOf, locFromRich } from '@/lib/ios/chat-location';
import { QqVoicePanel, SttPreviewOverlay, useSttPreview, useVoiceRecorder, type VoiceRecordResult, type VoiceRecordZone } from '@/components/apps/voice-input';
import { autoTranscribeForAi, transcribeAudioBlob } from '@/lib/ios/stt-client';
import { buildImagePlaceholderRule, buildVoicePlaceholderRule } from '@/lib/chat-media-rules';
import { synthesizeSelfVoice } from '@/lib/ios/voice-send';
import { blobToDataUrl } from '@/lib/ios/audio-utils';
import { stopVoicePlayback } from '@/lib/ios/voice-player';
import {
  beginChatStream,
  clearChatStream,
  isChatStreaming,
  subscribeChatStreamFinalized,
  useChatStream,
  useChatStreamFinalized,
  type ChatPayloadMessage,
} from '@/lib/chat-stream-store';
import { buildPersonaSystemPrompt } from '@/lib/ios/persona';
import { buildNpcPromptExtra, type NpcPromptExtra } from '@/lib/ios/npc-bond';
import { getReplyCount, saveReplyCount, buildReplyCountPrompt, splitReplySegments } from '@/lib/reply-count';
import { getTranslateCfg, saveTranslateCfg, requestTranslation, translateLangLabel, normalizeTranslateCfg, detectTranslateTarget, type ChatTranslateCfg } from '@/lib/chat-translate';
import { getMemSettings, memAfterAiTurn, memConvoFromRaw, memRecallBlock } from '@/lib/memory';
import {
  addUserMomentComment,
  addUserMomentPost,
  aiPostMoment,
  buildMomentsChatBlock,
  deleteMomentComment,
  deleteMomentPost,
  enqueuePostInteractions,
  repairLegacyMomentData,
  subscribeMomentsChanged,
  toggleUserMomentLike,
  updateMomentPostContent,
} from '@/lib/moments';
import { AskPostSheet, CommentDeleteDialog, EditPostDialog, MomentAutoCfgSheet, PostMoreMenu, momentFriendsOf } from './moments-shared';
import { getSentenceSend, saveSentenceSend, hasPendingBatch, markPendingBatch } from '@/lib/sentence-send';
import { getStickersOn, saveStickersOn, STICKER_OFF_RULE } from '@/lib/sticker-toggle';
import { stripEmojiText } from '@/lib/emoji';
import { getTimeAware, setTimeAware, buildTimeAwareBlock } from '@/lib/time-aware';
import { kvGet, kvSet, kvDel } from '@/lib/ios/idb-kv';
import { getQqProfileBg, loginQQ, listContacts, ownerRealName, contactRealName, setQqProfileBg, getChatBgImage, setChatBgImage, removeChatBgImage, updateContact } from '@/lib/ios/contacts-store';
import { addressNameOf, displayNameOf, isFriendIn, withDisplayNames } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import { loadStickers, saveStickers, newStickerId, extractMeaningFromUrl, fileNameMeaning, isImageUrl } from '@/lib/ios/stickers';
import type { Sticker } from '@/lib/ios/stickers';
import {
  buildRichRules,
  buildActionRules,
  cleanBubbleText,
  extractRichActionParts,
  actionVerb,
  mergeRichSegments,
  parseRichParts,
  prettifyRichText,
  isQuitWinbackAction,
  isGroupSocialAction,
  type PendingCardInfo,
  type RichAction,
  type RichMsg,
} from '@/lib/chat-rich';
import {
  acceptBlockReq,
  applyCharBlockAction,
  blockActionKindOf,
  blockCoversAt,
  buildBlockPromptBlock,
  loadBlock,
  rejectBlockReq,
  setUserBlock,
  type BlockEntry,
} from '@/lib/ios/block-state';
import { activeQuitFlowFor, applyQuitWinbackAction } from '@/lib/ios/quit-flow';
import {
  applyGroupCardDecision,
  applyGroupSocialAction,
  buildGroupSocialRules,
  buildKickNoticeSection,
  setGroupSocialContacts,
  type GroupCardData,
} from '@/lib/ios/group-social';
import { BatchStickerSheet, StickerMeaningPicker } from '@/components/apps/sticker-batch';
import type { BatchDraftItem } from '@/components/apps/sticker-batch';
import { useUnreadMap, qqUnreads as qqUnreadStore } from '@/lib/unread-store';
import { useChatFlags, NO_FLAGS, qqChatFlags as qqChatFlagsStore } from '@/lib/chat-flags';
import {
  ChatBgPage,
  ChatReplyCountPage,
  ChatSearchPage,
  ChatSettingsPage,
  ChatTranslatePage,
  ChatVoiceFreqPage,
  ChatVoicePage,
  WorldBookPickerPage,
  chatBgLayerStyle,
  type ChatSearchItem,
  type ChatSettingsBg,
} from './chat-settings';
import { decideAiVoiceMessage, getAiVoiceFreq, saveAiVoiceFreq, synthesizeAiVoice } from '@/lib/ios/ai-voice';
import { describeVoiceId, useMyVoices } from '@/lib/ios/my-voices';
import { applyWbUserBlocks, collectWbBlocks, getBoundBookIds, loadBooks, setBoundBookIds, wbRulesBlock, wbScanText } from '@/lib/ios/worldbook';
import { addFavorite, isMsgFavorited, loadFavorites, removeFavorite, unfavoriteMsg, type MsgFavorite } from '@/lib/msg-favorites';
import { BUBBLE_MENU_ICONS, BubbleActionMenu, computeBubbleMenuPos, useBubbleLongPress, type BubbleMenuItem, type BubbleMenuPos } from './bubble-menu';
import { LocalToast, useLocalToast } from './page-toast';
import { fwdRecordDate, fwdRecordTime, fwdRecordTitle, type FwdMode, type FwdRecord, type FwdSheetTarget } from './forward-sheet';
import { QqGroupChatPage, QqGroupCreatePage, QqGroupInfoPage, QqGroupAvatar, qqGroupRowId } from './qq-group';
import {
  dissolveGroup as dissolveGroupRecord,
  quitGroup as quitGroupRecord,
  effectiveInterop,
  getGroup,
  groupPreview,
  listGroups as listChatGroups,
  updateGroup as updateGroupRecord,
  type ChatGroup,
} from '@/lib/ios/groups';

// ---------------- 类型 / 常量 / 工具 ----------------

interface QQUser {
  id: string;
  /** QQ 内显示名（备注/昵称优先；非真实姓名） */
  name: string;
  /** 真实姓名（联系人 name 字段；AI 称呼与记忆统一用它，展示不用） */
  realName?: string | null;
  /** 昵称（联系人 nickname 字段；只是昵称，不是另一个人也不是正式名字） */
  nickname?: string | null;
  avatar: string | null;
  qqId: string | null;
  phone: string | null;
  persona: string | null;
}

interface QQMsg {
  id: string;
  role: 'me' | 'peer';
  content: string;
  time: number;
  /** 消息种类：缺省 = 文本；image = 图片（content 为 dataURL）；location = 位置（loc 有值）；红包/转账消息 content 为空串（转账接收卡片也是 transfer）；family = 亲属卡（fam 有值）；notice = 红包领取通知；forward = 转发卡片；groupcard = 群聊邀请卡片；
   *  voice = 语音消息（voice 有值，content 保持空串）；sys = 拉黑等系统提示（居中灰字胶囊，不进 AI 上下文）；blockreq = 角色发起的「申请解除拉黑」卡片 */
  kind?: 'text' | 'image' | 'voice' | 'redpacket' | 'transfer' | 'location' | 'notice' | 'sticker' | 'family' | 'forward' | 'groupcard' | 'sys' | 'blockreq' | 'call';
  /** 语音消息数据（kind='voice'；音频 dataURL + 时长 + 波形 + 转写，与微信端共用 VoiceMsgData 结构） */
  voice?: VoiceMsgData;
  /** 语音通话卡片（kind='call'）：state 卡片状态 / duration 接通秒数 / direction 主叫方向（me=我拨打） */
  call?: { state: CallCardState; duration: number; direction: 'out' | 'in' };
  /** 图片消息附加数据：desc = 识图描述（AI 历史可读「[图片]（图片内容：…）」；旧记录图片只存 content=dataURL，无此字段照常兼容） */
  img?: { src?: string; desc?: string };
  /** 红包/转账消息附加数据（随消息一并 localStorage 持久化） */
  packet?: MsgPacket;
  /** 位置消息附加数据 */
  loc?: MsgLoc;
  /** 亲属卡消息附加数据（AI 赠送 / 领取状态） */
  fam?: QQFamData;
  /** 通知行数据（kind = notice 时有值） */
  notice?: QQNoticeData;
  /** 系统提示行数据（kind = 'sys' 时有值）：拉黑/解除拉黑等状态变更提示 */
  sys?: { text: string };
  /** 申请解除拉黑卡片数据（kind = 'blockreq' 时有值）：status pending=待处理 accepted=已同意 rejected=已拒绝 */
  blkreq?: { reason: string; status: 'pending' | 'accepted' | 'rejected' };
  /** 表情消息（stk.url 图片，stk.meaning 意思，stk.sid 本地表情包唯一 ID——AI 上下文回写 [表情包:ID] 示范格式） */
  stk?: { url: string; meaning: string; sid?: string };
  /** 引用回复（长按菜单「引用」后发送时带上；气泡内嵌小引用块；AI 上下文带引用前缀）；
   *  id = 被引用源消息 ID（原消息删除/撤回后引用显示「原消息已删除」） */
  quote?: { name: string; content: string; id?: string; time?: number };
  /** 已撤回（渲染为居中灰字「你撤回一条消息 / 对方撤回一条消息」，不再参与上下文） */
  recalled?: boolean;
  /** 转发卡片（kind='forward'；fwd.from = 来源会话联系人名；merged=true 为合并转发的「聊天记录」卡片，records 存原始对话） */
  fwd?: { from: string; merged?: boolean; title?: string; records?: { name: string; role: 'me' | 'peer'; text: string; quote?: string; time: number; avatar?: string | null; kind?: 'text' | 'sticker' | 'image'; imgSrc?: string; stkMeaning?: string }[] };
  /** 群聊邀请卡片（kind='groupcard'；AI 主动建群/拉人时发出，用户可接受/拒绝） */
  gcard?: GroupCardData;
}

/** 聊天中的系统通知行（对方领取/退回/拒收了你的红包/转账；转账收款改用接收卡片消息）：居中灰字 + 彩色尾词 */
interface QQNoticeData {
  /** 小图标：rp=红红包 / tr=蓝转账 / fam=金亲属卡 */
  icon: 'rp' | 'tr' | 'fam';
  /** 主体文案（不含尾词），如「晚晴宝领取了你的」 */
  pre: string;
  /** 尾词高亮：「红包」/「转账」/「亲属卡」 */
  accent: string;
}

/** 位置消息：名称 + 详细地址 + 经纬度（AI 可读到“用户在哪”；旧记录无经纬度字段照常兼容） */
interface MsgLoc {
  name: string;
  addr: string;
  lat?: number;
  lng?: number;
}

/** 亲属卡消息数据（AI 赠送；领取后 claimed=true；被收卡方退还后 rejected=true） */
interface QQFamData {
  /** 每月消费上限（元） */
  monthlyLimit: number;
  /** 关系（好朋友/爸爸…，取自联系人关系） */
  relation: string;
  /** 赠卡留言 */
  message: string;
  /** 是否已被领取 */
  claimed: boolean;
  claimedAt?: number;
  /** 被收卡方退还/拒收（终态，卡片变灰） */
  rejected?: boolean;
  /** AI 处理动作用的短 ID（我发给 AI 的卡片才有；格式如 rp-x7k2 / tr-x7k2） */
  cid?: string;
}

export interface MsgPacket {
  type: 'redpacket' | 'transfer';
  /** 金额（元）：普通/专属红包 = 单个金额；拼手气红包 = 总金额 */
  amount: number;
  /** 祝福语 / 转账留言 */
  note: string;
  /** 拼手气红包个数 */
  count?: number;
  /** 红包类型：普通 / 拼手气 / 专属 */
  mode?: 'normal' | 'lucky' | 'dedicated';
  /** 专属红包指定收款成员（群聊专属红包用；单聊不需要：对方即收款人） */
  toId?: string;
  toName?: string;
  /** 领取记录（领取后写入） */
  claims?: Array<{ name: string; avatar: string | null; amount: number; ts: number }>;
  /** 转账是否已被对方收款（发出后延迟自动收款） */
  received?: boolean;
  receivedAt?: number;
  /** 接收卡片凭据：'me'=这张卡是对方收我转账的凭据；'peer'=这张卡是我收对方转账的凭据（详情页文案按此区分「××已收款 / 你已收款」） */
  receiptOf?: 'me' | 'peer';
  /** 退还/拒收终态（我发给 AI 的卡被退回/拒收，或我退回 AI 发的卡；终态后不能重复处理） */
  status?: 'returned' | 'rejected';
  /** 退款时间（退还后写入；详情页「退款时间」行） */
  refundedAt?: number;
  /** 退还凭据卡专用：原转账发生时间（详情页「转账时间」行显示原转账时间） */
  originTime?: number;
  /** 退还凭据卡专用：退还人（'me'=我退的→详情显示「你已退还」；'peer'=对方退的→「对方已退还」）；原卡省略时按消息角色反推 */
  refundedBy?: 'me' | 'peer';
  /** AI 处理动作用的短 ID（我发给 AI 的红包/转账才有；AI 在动作标记里引用它） */
  cid?: string;
}

/** 会话列表预览：非文本消息显示摘要 */
function msgPreview(m: QQMsg | undefined): string {
  if (!m) return '';
  // 撤回的消息在会话列表预览显示「你/对方撤回一条消息」
  if (m.recalled) return m.role === 'me' ? '你撤回一条消息' : '对方撤回一条消息';
  if (m.kind === 'redpacket') return '[QQ红包]';
  if (m.kind === 'transfer') return '[转账]';
  if (m.kind === 'family') return '[亲属卡]';
  if (m.kind === 'notice') return m.notice ? `${m.notice.pre}${m.notice.accent}` : '';
  if (m.kind === 'image') return '[图片]';
  if (m.kind === 'voice') return '[语音]';
  if (m.kind === 'call') return '[语音通话]';
  if (m.kind === 'location') return '[位置]';
  if (m.kind === 'sticker') return '[表情]';
  if (m.kind === 'forward') return m.fwd?.merged ? '[聊天记录]' : m.content;
  if (m.kind === 'groupcard') return '[群聊邀请]';
  return m.content;
}

/** 聊天内部浮层：发红包/转账页、红包开箱、红包详情、交易详情、收款页、亲属卡详情、发送位置 */
type ChatLayer =
  | null
  | { view: 'redpacket' }
  | { view: 'transfer' }
  | { view: 'location' }
  | { view: 'rp-open' | 'rp-detail' | 'tr-detail' | 'tr-receive' | 'fam-detail'; msgId: string };

const LS_SESSION = 'qq-session-user-id';
const lsMsgsKey = (contactId: string) => `qq-chat-msgs:${contactId}`;

/** AI 特殊消息标记 → QQ 消息记录（红包/转账/亲属卡/位置/表情包；渲染与交互复用用户手动发送的同款卡片）。
 *  content 存可读摘要：进入 AI 上下文让角色知道自己发过什么；卡片渲染按 kind 走，不显示 content */
function richToQqMsg(rich: RichMsg, id: string, time: number, peer: ContactRecord): QQMsg {
  switch (rich.kind) {
    case 'redpacket':
      return { id, role: 'peer', content: '[QQ红包]', time, kind: 'redpacket', packet: { type: 'redpacket', amount: rich.amount, note: rich.blessing } };
    case 'transfer':
      return { id, role: 'peer', content: '[转账]', time, kind: 'transfer', packet: { type: 'transfer', amount: rich.amount, note: rich.note, received: false } };
    case 'family':
      return {
        id,
        role: 'peer',
        content: '[亲属卡]',
        time,
        kind: 'family',
        fam: {
          monthlyLimit: rich.monthlyLimit,
          relation: peer.relation?.trim() || '好朋友',
          message: rich.message || '给你办的亲属卡，每个月都能用',
          claimed: false,
        },
      };
    case 'location': {
      const d = locFromRich(rich.name, rich.coords);
      return { id, role: 'peer', content: '[位置]', time, kind: 'location', loc: { name: d.name, addr: d.address || '地图上的一个位置', lat: d.lat, lng: d.lng } };
    }
    case 'sticker': {
      // parseRichParts 已保证 ID/意思能匹配上；取不到时兑底为文字
      const s = loadStickers('qq').find((x) => x.id === rich.stickerId);
      return s
        ? { id, role: 'peer', content: '', time, kind: 'sticker', stk: { url: s.url, meaning: s.meaning, sid: s.id } }
        : { id, role: 'peer', content: '[表情]', time };
    }
  }
}

/** 红包/转账/亲属卡消息的状态标签（卡片文案 + AI 上下文摘要共用） */
function cardStateLabel(m: QQMsg): string {
  if (m.kind === 'redpacket' && m.packet) {
    if (m.packet.status === 'returned') return '已退回';
    if (m.packet.status === 'rejected') return '已拒收';
    return (m.packet.claims ?? []).length > 0 ? '已领取' : '待领取';
  }
  if (m.kind === 'transfer' && m.packet) {
    if (m.packet.status === 'returned') return '已退回';
    if (m.packet.status === 'rejected') return '已拒收';
    return m.packet.received ? '已收款' : '待收款';
  }
  if (m.kind === 'family' && m.fam) {
    if (m.fam.rejected) return '已退回';
    return m.fam.claimed ? '已领取' : '待领取';
  }
  return '';
}

/** 卡片是否已到终态（领取/收款/退还/拒收都算；终态后不再出现在待处理清单、不可重复处理） */
function cardIsFinal(m: QQMsg): boolean {
  const label = cardStateLabel(m);
  return label !== '待领取' && label !== '待收款';
}

/** 收集「我发给 AI 的、待处理」的红包/转账（生成 system 待处理清单，AI 用动作标记处理） */
function collectPendingCards(msgs: QQMsg[]): PendingCardInfo[] {
  return msgs
    .filter((m) => m.role === 'me' && !cardIsFinal(m))
    .map<PendingCardInfo | null>((m) => {
      if (m.kind === 'redpacket' && m.packet) {
        return { id: m.packet.cid ?? m.id, kind: 'redpacket', amount: m.packet.amount, label: `祝福语"${m.packet.note}"` };
      }
      if (m.kind === 'transfer' && m.packet) {
        return { id: m.packet.cid ?? m.id, kind: 'transfer', amount: m.packet.amount, label: m.packet.note ? `备注"${m.packet.note}"` : '无备注' };
      }
      return null;
    })
    .filter((x): x is PendingCardInfo => x !== null);
}

/**
 * 应用 AI 的处理动作（领取/退回/拒收我发的红包/转账）：只处理「待处理」状态的目标（幂等，重复标记忽略），
 * 返回更新后的消息数组 + 动作产生的通知行/接收凭据卡（extras=接收凭据卡等需要
 * 插在动作发生位置的卡片，调用方按流式顺序与通知行一起落盘）。标记不带感谢语/理由，
 * 回应内容由 AI 人设正文承担。纯本地模拟：
 * 领取 → 记入领取记录；退回 → 金额退回我的钱包（写账单）；拒收 → 仅终态标记。
 */
function applyAiActions(
  actions: RichAction[],
  msgs: QQMsg[],
  peer: ContactRecord,
  timeBase = Date.now()
): { msgs: QQMsg[]; notices: QQMsg[]; extras: QQMsg[] } {
  const next = msgs.map((m) => ({ ...m, packet: m.packet ? { ...m.packet } : undefined }));
  const notices: QQMsg[] = [];
  const extras: QQMsg[] = [];
  for (const a of actions) {
    const idx = next.findIndex((m) => m.role === 'me' && (m.packet?.cid === a.targetId || m.id === a.targetId));
    if (idx < 0) continue;
    const m = next[idx];
    if (!m.packet || cardIsFinal(m)) continue; // 只处理待处理状态（已领取/已退回/已拒收的忽略）
    const verb = actionVerb(a.kind);
    const time = timeBase + notices.length + extras.length;
    if (m.kind === 'redpacket') {
      const p = m.packet;
      if (verb === 'claim') {
        // AI 领取：单人群按现有自动领取规则（普通领全额；拼手气随机拆一份），写入领取记录 + 通知行
        const claims = p.claims ?? [];
        const count = p.count ?? 1;
        if (claims.length < count) {
          const remaining = round2(p.amount - claims.reduce((s, c) => s + c.amount, 0));
          const amt = p.mode === 'lucky' && count > 1 ? Math.max(0.01, round2(Math.random() * remaining)) : remaining;
          next[idx] = { ...m, content: `[QQ红包]（${peer.name}已领取）`, packet: { ...p, claims: [...claims, { name: peer.name, avatar: peer.avatar, amount: amt, ts: Date.now() }] } };
          notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'rp', pre: `${peer.name}领取了你的`, accent: '红包' } });
        }
      } else {
        next[idx] = { ...m, content: `[QQ红包]（${verb === 'return' ? '已退回' : '已拒收'}）`, packet: { ...p, status: verb === 'return' ? 'returned' : 'rejected' } };
        if (verb === 'return') {
          gainToWallet(p.amount, '红包退回');
          notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'rp', pre: `${peer.name}退回了你的`, accent: '红包' } });
        } else {
          notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'rp', pre: `${peer.name}拒收了你的`, accent: '红包' } });
        }
      }
    } else if (m.kind === 'transfer') {
      const p = m.packet;
      if (verb === 'claim') {
        // AI 收款：原卡标记已收款 + receiptOf='me'（详情页显示「XX已收款」）+ 「已收款」接收凭据卡——
        // 凭据卡放 extras，由调用方插在动作发生位置（而不是旧代码里永远排在所有新消息之前）
        next[idx] = { ...m, content: '[转账]（已收款）', packet: { ...p, received: true, receivedAt: Date.now(), receiptOf: 'me' as const } };
        extras.push({ id: uid(), role: 'peer', content: '', time, kind: 'transfer', packet: { type: 'transfer', amount: p.amount, note: p.note, received: true, receivedAt: Date.now(), receiptOf: 'me' } });
      } else if (verb === 'return') {
        // AI 退回我发的转账：原卡标记终态（变灰）+ 「对方」发出的退还凭据卡放 extras（灰卡↩+已退还，详情页「对方已退还」）
        const refundedAt = Date.now();
        next[idx] = { ...m, content: '[转账]（已退回）', packet: { ...p, status: 'returned', refundedAt } };
        gainToWallet(p.amount, '转账退回');
        extras.push({
          id: uid(),
          role: 'peer',
          content: '',
          time,
          kind: 'transfer',
          packet: { type: 'transfer', amount: p.amount, note: p.note, received: false, status: 'returned' as const, refundedAt, originTime: m.time, refundedBy: 'peer' as const },
        });
      } else {
        next[idx] = { ...m, content: '[转账]（已拒收）', packet: { ...p, status: 'rejected' } };
        notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'tr', pre: `${peer.name}拒收了你的`, accent: '转账' } });
      }
    } else {
      continue;
    }
  }
  return { msgs: next, notices, extras };
}

/** QQ空间：用户发的帖子 / 种子帖点赞状态（localStorage 持久化） */
const LS_ZONE_POSTS = 'qq-zone-posts';
const LS_ZONE_LIKES = 'qq-zone-likes';
const LS_ZONE_COMMENTS = 'qq-zone-comments';
/** 个人中心打卡状态（当日已打卡 + 连续天数，localStorage 持久化） */
const LS_QQ_CHECKIN = 'qq-checkin';
const LS_FRIEND_LIKE = (contactId: string) => `qq-friend-likes:${contactId}`;
// QQ 钱包：余额/Q币/小金库、银行卡、账单流水（本地持久化）
const LS_WALLET = 'qq-wallet';
const LS_WALLET_CARDS = 'qq-wallet-cards';
const LS_WALLET_BILLS = 'qq-wallet-bills';

/** 本地日期键（打卡用，避免 toISOString 的 UTC 偏移） */
function localDateKey(d = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

interface ZonePost {
  id: string;
  authorName: string;
  avatar: string | null;
  content: string;
  time: string;
  likedBy: string[];
  /** 说说配图（压缩后的 dataURL，最多 9 张） */
  images?: string[];
}

/** QQ空间帖子评论（种子帖/用户帖统一按 postId 存 map，localStorage 持久化） */
interface ZoneComment {
  id: string;
  author: string;
  content: string;
  time: string;
  /** 回复的目标评论作者（回复评论功能） */
  replyTo?: string;
  /** 作者类型（引擎写入；legacy 数据可能缺失，读时按名字推断） */
  authorKind?: 'user' | 'char';
}

/** 空间种子动态（原「卖萌磕到牙」示例帖已按需求移除，空间仅显示用户自己发布的动态） */
const ZONE_SEEDS: ZonePost[] = [];

const SEED_DEFAULT_LIKE: Record<string, boolean> = {};

function loadZonePosts(): ZonePost[] {
  try {
    const parsed: unknown = kvGet<ZonePost[]>(LS_ZONE_POSTS);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is ZonePost =>
        Boolean(p) &&
        typeof (p as ZonePost).id === 'string' &&
        typeof (p as ZonePost).content === 'string' &&
        typeof (p as ZonePost).authorName === 'string'
    );
  } catch {
    return [];
  }
}

function loadZoneComments(): Record<string, ZoneComment[]> {
  try {
    const parsed: unknown = kvGet<Record<string, ZoneComment[]>>(LS_ZONE_COMMENTS);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, ZoneComment[]> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      const list = v
        .filter(
          (x): x is ZoneComment =>
            Boolean(x) && typeof (x as ZoneComment).author === 'string' && typeof (x as ZoneComment).content === 'string'
        )
        .map((x) => {
          // 旧版遗留修复：AI「回复自己」的历史 bug 数据（replyTo 是自己的名字且作者为 char）读时摘掉错误指向
          if (x.authorKind === 'char' && typeof x.replyTo === 'string' && x.replyTo === x.author) {
            return { ...x, replyTo: undefined };
          }
          return x;
        });
      if (list.length) out[k] = list;
    }
    return out;
  } catch {
    return {};
  }
}

/** 手机号打码：183******33 */
function maskPhone(p: string | null): string {
  if (!p) return '未绑定';
  if (p.length < 7) return p;
  return `${p.slice(0, 3)}******${p.slice(-2)}`;
}

/** QQ 品牌色 */
const QQ_BLUE = '#12B7F5';
const TAB_ACTIVE = 'text-[#1E6FFF] dark:text-[#4AA3FF]';

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 用户发给 AI 的红包/转账短 ID（AI 动作标记里引用；短小易抄写） */
function nextCid(prefix: 'rp' | 'tr' | 'fam'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36).slice(-3)}`;
}

/** 当前正在查看的 QQ 聊天（ChatPage 挂载时写入/卸载时清除）：AI 回复落盘时不在该会话 → 未读角标 +1 */
let qqActiveChatId: string | null = null;
/** 排队回复表：对方正在回复时用户又发了消息的联系人 id —— 本轮流结束后由聊天页自动补跑一轮回复 */
const qqQueuedTurns = new Set<string>();

function loadMsgs(contactId: string): QQMsg[] {
  try {
    // 持久化在 IndexedDB kv store（启动时由 idb-kv 从 localStorage 迁移，内存同步读）
    const parsed: unknown = kvGet<QQMsg[]>(lsMsgsKey(contactId));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is QQMsg =>
          Boolean(m) &&
          typeof (m as QQMsg).content === 'string' &&
          ((m as QQMsg).role === 'me' || (m as QQMsg).role === 'peer')
      )
      // 引用/撤回/转发字段规范化（旧记录无这些字段时补默认值）
      .map((m) => ({
        ...m,
        quote:
          m.quote && typeof m.quote.name === 'string' && typeof m.quote.content === 'string'
            ? { name: m.quote.name, content: m.quote.content, id: typeof m.quote.id === 'string' ? m.quote.id : undefined }
            : undefined,
        // 语音消息规范化（旧记录/损坏记录兼容；url 为空串但带 localText 的是文字转语音本地仿真消息，保留可静音重播）
        voice:
          m.kind === 'voice' && m.voice && typeof m.voice.url === 'string'
            ? {
                url: m.voice.url,
                duration: typeof m.voice.duration === 'number' && m.voice.duration > 0 ? m.voice.duration : 1,
                wave: Array.isArray(m.voice.wave) ? m.voice.wave.filter((x): x is number => typeof x === 'number' && x >= 0 && x <= 1) : [],
                localText: typeof m.voice.localText === 'string' && m.voice.localText.trim() ? m.voice.localText : undefined,
                // AI 语音消息：合成通道（builtin=内置引擎实时朗读）与发送者联系人 id（朗读时解析角色音色）
                synth: m.voice.synth === 'builtin' || m.voice.synth === 'api' ? m.voice.synth : undefined,
                contactId: typeof m.voice.contactId === 'string' && m.voice.contactId ? m.voice.contactId : undefined,
                transcript: typeof m.voice.transcript === 'string' && m.voice.transcript ? m.voice.transcript : undefined,
                stt: m.voice.stt === 'pending' || m.voice.stt === 'done' || m.voice.stt === 'failed' ? m.voice.stt : undefined,
              }
            : undefined,
        // 语音通话卡片规范化（kind='call'）：state 白名单外一律回退 ended，direction 仅认 in/out
        call:
          m.kind === 'call' && m.call && typeof m.call.duration === 'number'
            ? {
                state:
                  m.call.state === 'cancelled' ||
                  m.call.state === 'no-answer' ||
                  m.call.state === 'rejected' ||
                  m.call.state === 'missed-in' ||
                  m.call.state === 'ended'
                    ? m.call.state
                    : ('ended' as const),
                duration: m.call.duration,
                direction: m.call.direction === 'in' ? ('in' as const) : ('out' as const),
              }
            : undefined,
        recalled: m.recalled === true || undefined,
        fwd:
          m.fwd && typeof m.fwd.from === 'string'
            ? {
                from: m.fwd.from,
                merged: m.fwd.merged === true || undefined,
                title: typeof m.fwd.title === 'string' ? m.fwd.title : undefined,
                records: Array.isArray(m.fwd.records)
                  ? m.fwd.records
                      .filter((r) => Boolean(r) && typeof r.name === 'string' && typeof r.text === 'string')
                      .map((r) => ({
                        name: r.name,
                        role: r.role === 'me' ? ('me' as const) : ('peer' as const),
                        text: r.text,
                        quote: typeof r.quote === 'string' ? r.quote : undefined,
                        time: typeof r.time === 'number' ? r.time : 0,
                        // 保留记录快照头像（undefined = 旧数据无此字段，详情页回退按角色取）
                        avatar: typeof r.avatar === 'string' ? r.avatar : r.avatar === null ? null : undefined,
                        // 富媒体快照：表情包/图片详情页显示原图（旧数据无此字段 → 按纯文字渲染）
                        kind: r.kind === 'sticker' || r.kind === 'image' ? r.kind : undefined,
                        imgSrc: typeof r.imgSrc === 'string' ? r.imgSrc : undefined,
                        stkMeaning: typeof r.stkMeaning === 'string' ? r.stkMeaning : undefined,
                      }))
                  : undefined,
              }
            : undefined,
      }));
  } catch {
    return [];
  }
}

function saveMsgs(contactId: string, msgs: QQMsg[]): void {
  // 持久化写穿到 IndexedDB（内存同步，异步落盘）；旧 localStorage 键已由迁移器删除
  kvSet(lsMsgsKey(contactId), msgs.slice(-200));
}

// ---------------- 转发感知：目标会话的 AI 事件队列 ----------------

/** 转发消息落到目标会话时，同时给目标 AI 排一条「感知事件」；对方会话被打开时 drain 并触发一次 AI 回合，
 *  让被分享的 AI 知道收到了什么（与页面是否存活无关） */
const lsAiEventsKey = (contactId: string) => `qq-ai-events:${contactId}`;

function pushAiEvent(contactId: string, text: string): void {
  try {
    const parsed: unknown = kvGet<string[]>(lsAiEventsKey(contactId));
    const arr = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    arr.push(text);
    kvSet(lsAiEventsKey(contactId), arr.slice(-10));
  } catch {
    // 忽略
  }
}

function drainAiEvents(contactId: string): string[] {
  try {
    const parsed: unknown = kvGet<string[]>(lsAiEventsKey(contactId));
    if (!Array.isArray(parsed)) return [];
    kvDel(lsAiEventsKey(contactId));
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

/** 剪贴板复制（clipboard API 不可用时回退 execCommand） */
function copyTextWithToast(text: string, onToast: (m: string) => void): void {
  const done = () => onToast('已复制');
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch {
      onToast('复制失败');
    }
  };
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
      return;
    }
  } catch {
    // 回退
  }
  fallback();
}

// ---------------- 密友值 / 好友天数（好友标识页，按 QQ 规则增长） ----------------

/** 密友统计：since=成为好友的时间戳；points=密友值；day/todayGain=当日增量（QQ 每日有上限） */
interface BondStat {
  since: number;
  points: number;
  day: string;
  todayGain: number;
}

/** QQ 规则：互发一条消息密友值 +2，每日通过聊天最多 +20 分 */
const BOND_MSG_POINTS = 2;
const BOND_DAILY_CAP = 20;
const lsBondKey = (contactId: string) => `qq-bond:${contactId}`;

function saveBondStat(contactId: string, s: BondStat): void {
  try {
    kvSet(lsBondKey(contactId), s);
  } catch {
    // 持久化失败忽略
  }
}

/** 读取密友统计；首次（或数据缺失）时从 0 开始建档（成为好友天数/密友值初始都是 0） */
function loadBondStat(contactId: string): BondStat {
  try {
    const p = kvGet<Partial<BondStat>>(lsBondKey(contactId));
    if (p && typeof p === 'object') {
      if (typeof p.since === 'number' && typeof p.points === 'number') {
        return { since: p.since, points: p.points, day: p.day ?? '', todayGain: p.todayGain ?? 0 };
      }
    }
  } catch {
    // 忽略损坏数据，重新建档
  }
  const fresh: BondStat = { since: Date.now(), points: 0, day: '', todayGain: 0 };
  saveBondStat(contactId, fresh);
  return fresh;
}

/** 成为好友天数：建档当天为第 0 天，之后每天 +1（与 QQ 一致） */
function bondDays(s: BondStat): number {
  return Math.max(0, Math.floor((Date.now() - s.since) / 86_400_000));
}

/** 聊天互动增加密友值（+2/条，每日上限 20，当天隔天自动重置） */
function addBondPoints(contactId: string, n: number): void {
  const s = loadBondStat(contactId);
  const today = new Date().toISOString().slice(0, 10);
  if (s.day !== today) {
    s.day = today;
    s.todayGain = 0;
  }
  if (s.todayGain >= BOND_DAILY_CAP) return;
  const gain = Math.min(n, BOND_DAILY_CAP - s.todayGain);
  s.todayGain += gain;
  s.points += gain;
  saveBondStat(contactId, s);
}

/** 选择说说/背景图片：读文件 → 压缩到最长边 max 的 JPEG dataURL（避免 localStorage 超限，默认 1280，表情用 240）；
 *  GIF 动图直通原始 dataURL（canvas 重绘会丢帧变静态图） */
function compressImageFile(file: File, max = 1280): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === 'string' ? reader.result : '';
      if (!raw) {
        resolve('');
        return;
      }
      // GIF 动图直通：不经 canvas（重绘会只保留第一帧）
      if (file.type === 'image/gif' || /^data:image\/gif/i.test(raw)) {
        resolve(raw);
        return;
      }
      const img = new window.Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(raw);
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch {
          resolve(raw);
        }
      };
      img.onerror = () => resolve(raw);
      img.src = raw;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

/** 会话列表时间：HH:mm / 昨天 / 周X / M/D / YYYY/M/D（QQ 列表样式，久远显示完整年） */
function fmtListTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return '昨天';
  if (now.getTime() - ts < 7 * 86400000) return `周${'日一二三四五六'[d.getDay()]}`;
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 聊天时间分隔：HH:mm / 昨天 HH:mm / 星期X HH:mm / M月D日 HH:mm */
function fmtChatTime(ts: number): string {
  const d = new Date(ts);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return hm;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `昨天 ${hm}`;
  if (now.getTime() - ts < 7 * 86400000) return `星期${'日一二三四五六'[d.getDay()]} ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/** QQ 引用卡时间（对照截图）：今天 → HH:MM；昨天 → 昨天HH:MM；一周内 → 星期XHH:MM；更久 → M月D日HH:MM（跨年带年份） */
function qqQuoteTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return hm;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `昨天${hm}`;
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 6);
  weekAgo.setHours(0, 0, 0, 0);
  if (ts >= weekAgo.getTime()) return `星期${'日一二三四五六'[d.getDay()]}${hm}`;
  const y = d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}年`;
  return `${y}${d.getMonth() + 1}月${d.getDate()}日${hm}`;
}

/** 联系人 AI 人设（QQ 聊天语境）：七要素结构化人设由全 App 共用模块组装，从联系人数据读取；
 *  特殊消息规则（红包/转账/亲属卡/位置/表情包标记）随表情包清单一起注入（表情包开关关闭时不下发表情包规则，
 *  并注入禁用 emoji/表情包的显式规则）；
 *  npcExtra：配角圈注入（CHAR=认识的配角/背景近况，NPC=归属者资料卡/背景近况） */
function buildPersonaPrompt(peer: ContactRecord, me: QQUser, ownerName: string | null, stickers: Sticker[], stickersOn: boolean, npcExtra?: NpcPromptExtra | null): string {
  // 名字/昵称区分：AI 称呼用户按全局设置（默认用名字「凡凡」，用户选「用昵称称呼」才用「凑凑」）；
  // 同时把真实姓名/昵称注入【用户的称呼】段，AI 不能把昵称当成另一个人或正式名字
  const mode = useSettings.getState().addressMode;
  return buildPersonaSystemPrompt(peer, {
    channel: 'QQ',
    userName: addressNameOf(me, mode),
    userRealName: me.realName ?? me.name,
    userNickname: me.nickname ?? null,
    ownerName,
    // 跨 App 身份感知：互通开关（每联系人设置，发送时现场读取）
    multiApp: getMemSettings(peer.id).share,
    ...npcExtra,
    extraRules: [
      '聊天记录中「[发送了表情：XX]」表示对方发来一张含义为「XX」的表情包，你要理解并自然回应表情的含义（可以调侃或接住情绪），不要字面复述括号内容。',
      ...buildRichRules(stickersOn ? stickers : []),
      ...(stickersOn ? [] : [STICKER_OFF_RULE]),
    ],
  });
}

// ---------------- 通用小部件 ----------------

/** QQ 圆形头像（有图用图，无图蓝底「Q」字兜底） */
function QqAvatar({ src, alt, size = 44 }: { src: string | null; alt: string; size?: number }) {
  const style: React.CSSProperties = { width: size, height: size };
  if (src) {
    // draggable=false：防止按住头像拖动触发原生图片拖拽，避免打断聊天页右滑手势
    return <img src={src} alt={alt} draggable={false} className="shrink-0 rounded-full bg-muted object-cover" style={style} />;
  }
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-[#B9D9F3] font-semibold text-white"
      style={{ ...style, fontSize: Math.round(size * 0.42) }}
    >
      Q
    </div>
  );
}

/** 居中 Toast（自动消失） */
function QqToast({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[8px] bg-black/75 px-4 py-2.5 text-[14px] text-white">
      {text}
    </div>
  );
}

/** 页头（消息/联系人/动态共用）：左圆头像 + 标题（消息页带在线状态），右侧动作 */
function QqHeader({
  user,
  title,
  subtitle,
  onAvatar,
  action,
}: {
  user: QQUser;
  title: string;
  subtitle?: React.ReactNode;
  onAvatar: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 pb-2 pt-1">
      <button type="button" aria-label="个人资料" onClick={onAvatar} className="rounded-full active:opacity-70">
        <QqAvatar src={user.avatar} alt={user.name} size={44} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[20px] font-semibold leading-tight">{title}</div>
        {subtitle ?? null}
      </div>
      {action ?? null}
    </div>
  );
}

/** 打卡 + 状态 pills（深色半透明玻璃、白字、缩小版；个人中心抽屉与联系人页封面共用，打卡状态 localStorage 共享） */
function QqCheckinPills({ testidPrefix, onToast }: { testidPrefix: string; onToast: (m: string) => void }) {
  const [checkin, setCheckin] = useState<{ last: string; streak: number }>(() => {
    try {
      const p: unknown = kvGet(LS_QQ_CHECKIN);
      if (p && typeof p === 'object') {
        const rec = p as { last?: unknown; streak?: unknown };
        if (typeof rec.last === 'string' && typeof rec.streak === 'number') return { last: rec.last, streak: rec.streak };
      }
    } catch {
      // 忽略
    }
    return { last: '', streak: 0 };
  });
  const checkedToday = checkin.last === localDateKey();
  // 当天首次点击记为已打卡并累计连续天数；断签重新从 1 开始
  const doCheckin = () => {
    if (checkedToday) {
      onToast('今天已经打过卡啦');
      return;
    }
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    const streak = checkin.last === localDateKey(yest) ? checkin.streak + 1 : 1;
    const next = { last: localDateKey(), streak };
    setCheckin(next);
    try {
      kvSet(LS_QQ_CHECKIN, next);
    } catch {
      // 忽略
    }
    onToast(`打卡成功，已连续 ${streak} 天`);
  };
  return (
    <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        data-testid={`${testidPrefix}-checkin`}
        onClick={doCheckin}
        className="flex h-8 items-center gap-1.5 rounded-full bg-black/40 px-3.5 text-[13px] font-medium text-white backdrop-blur-md transition-transform active:scale-95"
      >
        {checkedToday ? (
          <Flame className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden="true" />
        ) : (
          <CalendarDays className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden="true" />
        )}
        {checkedToday ? `已打卡 ${checkin.streak}天` : '打卡'}
      </button>
      <button
        type="button"
        data-testid={`${testidPrefix}-status`}
        onClick={() => onToast('状态暂未开放')}
        className="flex h-8 items-center gap-1.5 rounded-full bg-black/40 px-3.5 text-[13px] font-medium text-white backdrop-blur-md transition-transform active:scale-95"
      >
        <SmilePlus className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden="true" />
        状态
      </button>
    </div>
  );
}

/** 在线状态行（消息页头像旁：绿点 + 在线 - WiFi） */
function OnlineBadge() {
  return (
    <div className="mt-0.5 flex items-center gap-1 text-[12px] text-black/45 dark:text-white/45">
      <span className="inline-block h-[10px] w-[10px] rounded-full bg-[#26C84D]" aria-hidden="true" />
      在线 - WiFi
    </div>
  );
}

/** 搜索框（QQ 灰色胶囊） */
function QqSearch({ value, onChange, placeholder = '搜索' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex h-[36px] items-center gap-1.5 rounded-full bg-black/[0.05] px-3 dark:bg-white/[0.08]">
      <Search className="h-4 w-4 shrink-0 text-black/35 dark:text-white/35" strokeWidth={2.2} aria-hidden="true" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
      />
    </div>
  );
}

// ---------------- 登录页 ----------------

function LoginScreen({ onLogin }: { onLogin: (u: QQUser) => void }) {
  const closeApp = useUI((s) => s.closeApp);
  // mode account：账号密码登录（QQ号/QID/邮箱 + QQ密码）；phone：手机号登录（+86 + QQ密码）
  const [mode, setMode] = useState<'account' | 'phone'>('account');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1800);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const canSubmit = account.trim().length > 0 && password.length > 0 && agreed && !busy;

  const submit = async () => {
    if (!agreed) {
      setError('请先勾选同意服务协议和隐私政策');
      return;
    }
    if (account.trim().length === 0 || password.length === 0 || busy) return;
    setBusy(true);
    setError('');
    try {
      const rec = await loginQQ(mode === 'phone' ? 'phone' : 'account', account.trim(), password);
      if (rec.ok) {
        onLogin({
          id: rec.user.id,
          name: rec.user.name,
          realName: rec.user.realName,
          nickname: rec.user.nickname,
          avatar: rec.user.avatar,
          qqId: rec.user.qqId,
          phone: rec.user.phone,
          persona: rec.user.persona,
        });
        return;
      }
      setError(rec.error);
    } catch {
      setError('登录失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const bottomEntries =
    mode === 'account'
      ? [
          { key: 'phone', label: '手机号登录', icon: <Smartphone className="h-6 w-6" strokeWidth={1.8} />, action: () => setMode('phone') },
          { key: 'other', label: '其他登录方式', icon: <User className="h-6 w-6" strokeWidth={1.8} />, action: () => showToast('其他登录方式暂未开放') },
          { key: 'reg', label: '注册账号', icon: <Plus className="h-6 w-6" strokeWidth={1.8} />, action: () => showToast('注册账号暂未开放，请在「联系人」App 配置账号') },
        ]
      : [
          { key: 'account', label: '账密登录', icon: <CircleUser className="h-6 w-6" strokeWidth={1.8} />, action: () => setMode('account') },
          { key: 'other', label: '其他登录方式', icon: <User className="h-6 w-6" strokeWidth={1.8} />, action: () => showToast('其他登录方式暂未开放') },
          { key: 'reg', label: '注册账号', icon: <Plus className="h-6 w-6" strokeWidth={1.8} />, action: () => showToast('注册账号暂未开放，请在「联系人」App 配置账号') },
        ];

  return (
    <div className="relative flex h-full w-full flex-col bg-gradient-to-b from-[#EAE6F6] via-[#E4EBF7] to-[#E7F0F9] pt-[54px] text-[#1F2329] dark:from-[#23253A] dark:via-[#20293A] dark:to-[#1E2A38] dark:text-white">
      {/* 顶部：关闭 + 帮助 */}
      <div className="flex h-11 items-center justify-between px-4">
        <button
          type="button"
          aria-label="关闭QQ"
          data-testid="qq-login-close"
          onClick={closeApp}
          className="-ml-1 rounded-full p-1.5 active:bg-black/5"
        >
          <ChevronLeft className="h-7 w-7" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="text-[16px] text-black/70 active:opacity-60 dark:text-white/70"
          onClick={() => showToast('帮助暂未开放')}
        >
          帮助
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8">
        <h1 className="mt-12 text-center text-[30px] font-bold tracking-wide">
          {mode === 'account' ? '账号密码登录' : '手机号登录'}
        </h1>
        {mode === 'phone' && (
          <p className="mt-4 text-center text-[15px] text-black/40 dark:text-white/40">未注册手机号通过验证后将自动注册</p>
        )}

        {/* 输入卡（白色胶囊） */}
        <div className="mt-12 space-y-4">
          <div className="flex h-[56px] items-center rounded-[16px] bg-white px-5 shadow-[0_2px_10px_rgba(31,35,41,0.04)] dark:bg-white/[0.12]">
            {mode === 'phone' && (
              <span className="mr-3 flex shrink-0 items-center gap-1 text-[20px] font-semibold">
                +86
                <svg viewBox="0 0 12 8" className="h-2.5 w-3.5 text-black/50 dark:text-white/50" aria-hidden="true">
                  <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
            )}
            <input
              data-testid="qq-login-account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={mode === 'account' ? '输入QQ号/QID/邮箱' : '输入手机号码'}
              autoCapitalize="off"
              autoCorrect="off"
              inputMode={mode === 'phone' ? 'tel' : 'text'}
              className="h-full w-full bg-transparent text-[17px] outline-none placeholder:text-black/25 dark:placeholder:text-white/30"
            />
          </div>
          <div className="flex h-[56px] items-center rounded-[16px] bg-white px-5 shadow-[0_2px_10px_rgba(31,35,41,0.04)] dark:bg-white/[0.12]">
            <input
              data-testid="qq-login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              placeholder={mode === 'account' ? '输入QQ密码' : '输入QQ密码'}
              className="h-full w-full bg-transparent text-[17px] outline-none placeholder:text-black/25 dark:placeholder:text-white/30"
            />
          </div>
        </div>

        {mode === 'account' && (
          <button
            type="button"
            className="mt-5 text-[15px] font-medium text-[#1E6FFF] active:opacity-60"
            onClick={() => showToast('密码找回暂未开放，请到「联系人」App 查看账号密码')}
          >
            找回密码
          </button>
        )}

        {error && (
          <p data-testid="qq-login-error" className="mt-4 text-center text-[13px] text-red-500">
            {error}
          </p>
        )}

        <button
          type="button"
          data-testid="qq-login-submit"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className={`mt-8 block h-[52px] w-full rounded-full text-[18px] font-medium text-white transition-colors ${
            canSubmit ? 'active:brightness-95' : 'opacity-45'
          }`}
          style={{ backgroundColor: canSubmit ? QQ_BLUE : '#7FCDF8' }}
        >
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              正在登录…
            </span>
          ) : mode === 'account' ? (
            '登 录'
          ) : (
            '验证并登录'
          )}
        </button>

        {/* 协议勾选 */}
        <button
          type="button"
          data-testid="qq-login-agree"
          aria-pressed={agreed}
          onClick={() => {
            setAgreed((v) => !v);
            setError('');
          }}
          className="mx-auto mt-5 flex max-w-[300px] items-start gap-2 text-left"
        >
          <span
            aria-hidden="true"
            className={`mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${
              agreed ? 'border-transparent' : 'border-black/25 dark:border-white/35'
            }`}
            style={agreed ? { backgroundColor: QQ_BLUE } : undefined}
          >
            {agreed && (
              <svg viewBox="0 0 12 10" className="h-2.5 w-3 text-white" aria-hidden="true">
                <path d="M1 5.2 4.2 8.4 11 1.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span className="text-[13px] leading-[18px] text-black/45 dark:text-white/45">
            已阅读并同意<span className="text-[#1E6FFF]">服务协议</span>和
            <span className="text-[#1E6FFF]">隐私政策</span>
            {mode === 'phone' ? '及' : ''}
            {mode === 'phone' && <span className="text-[#1E6FFF]">运营商服务条款</span>}
          </span>
        </button>
      </div>

      {/* 底部三个圆圈入口 */}
      <div className="flex items-start justify-center gap-10 pb-9 pt-4">
        {bottomEntries.map((e) => (
          <button
            key={e.key}
            type="button"
            onClick={e.action}
            data-testid={`qq-login-entry-${e.key}`}
            className="flex w-[80px] flex-col items-center gap-2"
          >
            <span className="grid h-[52px] w-[52px] place-items-center rounded-full border border-black/12 text-black/60 dark:border-white/20 dark:text-white/60">
              {e.icon}
            </span>
            <span className="whitespace-nowrap text-[12px] text-black/60 dark:text-white/60">{e.label}</span>
          </button>
        ))}
      </div>

      {toast && <QqToast text={toast} />}
    </div>
  );
}

// ---------------- 表情：聊天面板 + 表情管理页（qq-stickers 存储，微信端同构） ----------------

/** QQ 表情添加表单（面板/管理页共用；蓝色主题） */
function QqStickerAddForm({
  tab,
  onTab,
  preview,
  url,
  meaning,
  onUrl,
  onMeaning,
  onPickFile,
  onSave,
  onCancel,
  saveLabel = '保存',
}: {
  tab: 'file' | 'url';
  onTab: (t: 'file' | 'url') => void;
  preview: string | null;
  url: string;
  meaning: string;
  onUrl: (v: string) => void;
  onMeaning: (v: string) => void;
  onPickFile: (files: FileList | null) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="flex gap-2">
        {(
          [
            ['file', '手机图片'],
            ['url', '图片 URL'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => onTab(k)}
            className={`h-8 rounded-full px-4 text-[13px] ${tab === k ? 'text-white' : 'bg-black/[0.05] text-black/60 dark:bg-white/10 dark:text-white/60'}`}
            style={tab === k ? { backgroundColor: QQ_BLUE } : undefined}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'file' ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mt-3 flex h-[96px] w-full items-center justify-center overflow-hidden rounded-[10px] border border-dashed border-black/20 bg-[#F6F7F8] text-[13px] text-black/40 active:bg-black/[0.05] dark:border-white/20 dark:bg-white/[0.06] dark:text-white/40"
        >
          {preview ? (
            <img src={preview} alt="表情预览" className="h-full w-full object-contain" />
          ) : (
            <span className="flex flex-col items-center gap-1">
              <span className="text-[26px] leading-none">＋</span>
              从手机选择表情图片
            </span>
          )}
        </button>
      ) : (
        <input
          value={url}
          onChange={(e) => onUrl(e.target.value)}
          placeholder="粘贴表情图片 URL（含中文可自动识别意思）"
          className="mt-3 h-[46px] w-full rounded-[10px] border border-black/[0.08] bg-[#F6F7F8] px-3 text-[14px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-white/[0.07] dark:placeholder:text-white/30"
        />
      )}
      <input
        value={meaning}
        onChange={(e) => onMeaning(e.target.value)}
        placeholder="表情包的意思（AI 会据此理解并回复）"
        maxLength={20}
        className="mt-2 h-[44px] w-full rounded-[10px] border border-black/[0.08] bg-[#F6F7F8] px-3 text-[14px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-white/[0.07] dark:placeholder:text-white/30"
      />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          className="h-10 flex-1 rounded-[10px] text-[15px] font-medium text-white active:brightness-95"
          style={{ backgroundColor: QQ_BLUE }}
        >
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-10 rounded-[10px] bg-black/[0.05] px-5 text-[15px] text-black/60 active:bg-black/[0.09] dark:bg-white/10 dark:text-white/60"
        >
          取消
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { onPickFile(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

/** 图片消息气泡（单聊/群聊共用：固定像素上限，圆角同气泡） */
export function QqImageBubble({ src, testId }: { src: string; testId?: string }) {
  return (
    <img
      src={src}
      alt="图片消息"
      data-testid={testId}
      className="max-h-[210px] w-auto max-w-[160px] rounded-[10px] object-cover"
    />
  );
}

/** 表情包消息气泡（单聊/群聊共用：点按提示表情含义） */
export function QqStickerBubble({
  url,
  meaning,
  onClick,
  testId = 'qq-sticker-bubble',
}: {
  url: string;
  meaning: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="active:opacity-80"
      title={meaning || '表情'}
    >
      <img
        src={url}
        alt={meaning ? `表情：${meaning}` : '表情'}
        className="max-h-[110px] w-auto max-w-[118px] rounded-[14px] object-contain"
        loading="lazy"
      />
    </button>
  );
}

/** 加号面板宫格（单聊/群聊共用：彩色圆角瓷贴 + 白色图标，对照新版 QQ 更多面板） */
export function QqPlusGrid({
  items,
}: {
  items: Array<{ key: string; label: string; color: string; icon: React.ReactNode; onClick: () => void }>;
}) {
  return (
    <div className="grid grid-cols-3 gap-y-6">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          data-testid={`qq-plus-${it.key}`}
          onClick={it.onClick}
          className="flex flex-col items-center gap-2 transition-transform active:scale-95"
        >
          <span
            className="grid h-[52px] w-[52px] place-items-center rounded-[15px] text-white shadow-[0_2px_10px_rgba(0,0,0,0.10)]"
            style={{ backgroundColor: it.color }}
            aria-hidden="true"
          >
            {it.icon}
          </span>
          <span className="text-[12px] text-[#1F2329] dark:text-white/85">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

/** QQ 聊天表情面板（点选发送 + 内嵌添加 + 管理删除；数据 qq-stickers；单聊/群聊共用同一套） */
export function QqStickerPanel({
  onPick,
  onClose,
  onToast,
}: {
  onPick: (s: Sticker) => void;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [list, setList] = useState<Sticker[]>(() => loadStickers('qq'));
  const [mode, setMode] = useState<'grid' | 'add'>('grid');
  const [tab, setTab] = useState<'file' | 'url'>('file');
  const [editMode, setEditMode] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [draftUrl, setDraftUrl] = useState('');
  const [draftMeaning, setDraftMeaning] = useState('');

  const commit = (next: Sticker[]) => {
    setList(next);
    saveStickers('qq', next);
  };
  const pickFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    try {
      setPreview(await compressImageFile(f));
      setDraftMeaning(fileNameMeaning(f.name));
    } catch {
      onToast('图片读取失败');
    }
  };
  const save = () => {
    const url = tab === 'file' ? preview : draftUrl.trim();
    if (!url || !isImageUrl(url)) {
      onToast(tab === 'file' ? '请先选择图片' : '请输入正确的图片 URL');
      return;
    }
    const meaning = draftMeaning.trim();
    commit([{ id: newStickerId(), url, meaning, createdAt: Date.now() }, ...list]);
    onToast(meaning ? `已添加表情（${meaning}）` : '已添加表情');
    setPreview(null);
    setDraftUrl('');
    setDraftMeaning('');
    setMode('grid');
  };

  /** 点表情下方的意思标签 → 弹出意思选择 UI（预设胶囊 + 自定义 + 可不设置） */
  const [meaningFor, setMeaningFor] = useState<Sticker | null>(null);

  /** 长按表情 → 预览卡（大图 + 名称 + 删除/取消），无需进管理模式即可删除 */
  const [pressSticker, setPressSticker] = useState<Sticker | null>(null);
  const pressTimerRef = useRef<number | null>(null);
  const suppressPickRef = useRef(false);
  const clearStickerPress = () => {
    if (pressTimerRef.current) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };
  useEffect(() => () => clearStickerPress(), []);
  const onStickerPointerDown = (s: Sticker) => (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearStickerPress();
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null;
      setPressSticker(s);
      suppressPickRef.current = true;
    }, 480);
  };
  const onStickerPointerMove = (e: React.PointerEvent) => {
    if (!pressTimerRef.current) return;
    const t = e.currentTarget as HTMLElement;
    const r = t.getBoundingClientRect();
    if (e.clientX < r.left - 12 || e.clientX > r.right + 12 || e.clientY < r.top - 12 || e.clientY > r.bottom + 12) clearStickerPress();
  };
  const closeStickerPreview = () => {
    setPressSticker(null);
    suppressPickRef.current = false;
  };

  return (
    <div
      className="relative shrink-0 border-t border-black/[0.05] bg-white dark:border-white/[0.06] dark:bg-[#1B1C1F]"
      style={{ animation: 'qqPanelIn 0.24s ease-out' }}
      data-testid="qq-sticker-panel"
    >
      <div className="flex items-center justify-between px-4 pb-1 pt-2.5">
        <p className="text-[15px] font-medium">表情</p>
        <div className="flex items-center gap-4">
          {mode === 'grid' && list.length > 0 && (
            <button
              type="button"
              data-testid="qq-sticker-panel-manage"
              onClick={() => setEditMode((v) => !v)}
              className="text-[13px] active:opacity-60"
              style={{ color: QQ_BLUE }}
            >
              {editMode ? '完成' : '管理'}
            </button>
          )}
          <button type="button" aria-label="收起表情面板" onClick={onClose} className="text-black/40 active:opacity-60 dark:text-white/40">
            <ChevronDown className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
      </div>
      {mode === 'grid' ? (
        <div className="h-[280px] overflow-y-auto px-3 pb-4 pt-1">
          <div className="grid grid-cols-4 gap-2">
            {list.map((st, i) => (
              <div key={st.id} className="relative">
                <button
                  type="button"
                  data-testid={`qq-sticker-panel-item-${i}`}
                  onClick={() => {
                    if (suppressPickRef.current) {
                      suppressPickRef.current = false;
                      return;
                    }
                    if (!editMode) onPick(st);
                  }}
                  onPointerDown={onStickerPointerDown(st)}
                  onPointerMove={onStickerPointerMove}
                  onPointerUp={clearStickerPress}
                  onPointerCancel={clearStickerPress}
                  onPointerLeave={clearStickerPress}
                  className="aspect-square w-full overflow-hidden rounded-[10px] p-1.5 active:bg-black/[0.06]"
                  title={st.meaning || '表情'}
                >
                  <img src={st.url} alt={st.meaning || '表情'} className="h-full w-full object-contain" loading="lazy" />
                </button>
                <button
                  type="button"
                  data-testid={`qq-sticker-meaning-${i}`}
                  onClick={() => setMeaningFor(st)}
                  className="mt-0.5 block h-4 w-full truncate text-center text-[10px] leading-4 text-black/40 active:opacity-60 dark:text-white/40"
                >
                  {st.meaning || '＋意思'}
                </button>
                {editMode && (
                  <button
                    type="button"
                    aria-label="删除表情"
                    data-testid={`qq-sticker-panel-del-${i}`}
                    onClick={() => commit(list.filter((x) => x.id !== st.id))}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#F5455C] text-[11px] font-semibold text-white shadow"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              data-testid="qq-sticker-panel-add"
              onClick={() => setMode('add')}
              className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-black/20 text-black/35 active:bg-black/[0.04] dark:border-white/20 dark:text-white/35"
            >
              <span className="text-[24px] leading-none">＋</span>
              <span className="text-[11px]">添加</span>
            </button>
            <span aria-hidden="true" className="mt-0.5 h-4" />
          </div>
          {list.length === 0 && <p className="pb-2 pt-3 text-center text-[13px] text-black/35 dark:text-white/35">还没有表情，点「＋」添加一张</p>}
        </div>
      ) : (
        <div className="px-4 pb-4 pt-1">
          <QqStickerAddForm
            tab={tab}
            onTab={setTab}
            preview={preview}
            url={draftUrl}
            meaning={draftMeaning}
            onUrl={(v) => {
              setDraftUrl(v);
              const m = extractMeaningFromUrl(v);
              if (m) setDraftMeaning(m);
            }}
            onMeaning={setDraftMeaning}
            onPickFile={(files) => void pickFile(files)}
            onSave={save}
            onCancel={() => setMode('grid')}
          />
        </div>
      )}

      {/* 意思选择 UI（预设胶囊 + 自定义 + 不设置） */}
      {meaningFor && (
        <StickerMeaningPicker
          testPrefix="qq"
          url={meaningFor.url}
          value={meaningFor.meaning}
          onConfirm={(v) => {
            commit(list.map((x) => (x.id === meaningFor.id ? { ...x, meaning: v } : x)));
            onToast(v ? `意思已设为「${v}」` : '已清除意思');
            setMeaningFor(null);
          }}
          onClose={() => setMeaningFor(null)}
        />
      )}

      {/* 长按表情预览卡（白卡大图 + 名称 + 红色删除；点遮罩取消） */}
      {pressSticker && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/45"
          data-testid="qq-sticker-preview"
          onClick={closeStickerPreview}
        >
          <div
            className="w-[220px] overflow-hidden rounded-[16px] bg-white shadow-2xl dark:bg-[#2A2A2E]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-[150px] items-center justify-center p-3">
              <img src={pressSticker.url} alt={pressSticker.meaning || '表情'} className="max-h-full max-w-full object-contain" />
            </div>
            <p className="pb-2.5 text-center text-[13px] text-black/45 dark:text-white/45">{pressSticker.meaning || '未命名表情'}</p>
            <button
              type="button"
              data-testid="qq-sticker-preview-del"
              onClick={() => {
                commit(list.filter((x) => x.id !== pressSticker.id));
                closeStickerPreview();
                onToast('已删除表情');
              }}
              className="flex h-12 w-full items-center justify-center border-t border-black/[0.06] text-[15px] text-[#FA5151] active:bg-black/[0.04] dark:border-white/[0.08] dark:active:bg-white/[0.06]"
            >
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** QQ 表情管理页（个人中心抽屉「表情」入口：网格 + 单张编辑[改意思/删除] + 批量导入手机图片 + URL 添加自动识别意思） */
function QqStickersPage({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  const [list, setList] = useState<Sticker[]>(() => loadStickers('qq'));
  const [editing, setEditing] = useState<Sticker | null>(null);
  const [editMeaning, setEditMeaning] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchDraftItem[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);

  const commit = (next: Sticker[]) => {
    setList(next);
    saveStickers('qq', next);
  };

  /** 右上角「管理」：进入删除模式，点表情上的红色 × 直接删除（再点完成退出） */
  const [delMode, setDelMode] = useState(false);
  const delSticker = (st: Sticker) => {
    commit(list.filter((x) => x.id !== st.id));
    onToast('已删除表情');
    if (list.length <= 1) setDelMode(false);
  };

  /** FileList → 批量草稿项（压缩到 240 + 默认名：文件名中文优先，否则文件名去扩展名） */
  const filesToDrafts = async (files: FileList): Promise<BatchDraftItem[]> => {
    const drafts: BatchDraftItem[] = [];
    for (const f of Array.from(files)) {
      try {
        const url = await compressImageFile(f, 240);
        if (!url) continue;
        const stem = f.name.replace(/\.[a-z0-9]+$/i, '');
        const cn = fileNameMeaning(f.name);
        drafts.push({ key: newStickerId(), preview: url, name: cn || stem, fallbackName: stem, source: 'file' });
      } catch {
        // 单张失败跳过
      }
    }
    return drafts;
  };

  /** 批量导入：选完先进入预览确认弹窗（可改名/删除/继续选择），点「全部添加」才入库 */
  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const drafts = await filesToDrafts(files);
    if (drafts.length === 0) {
      onToast('没有可导入的图片');
      return;
    }
    setBatchItems(drafts);
    setBatchOpen(true);
  };

  /** 确认批量添加：草稿项转正式表情入库（插到最前） */
  const confirmBatch = (items: BatchDraftItem[]) => {
    const added: Sticker[] = items.map((it) => ({ id: newStickerId(), url: it.preview, meaning: it.name.trim(), createdAt: Date.now() }));
    commit([...added, ...list]);
    setBatchOpen(false);
    setBatchItems([]);
    onToast(`已添加 ${added.length} 张表情`);
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[#FAFAFC] text-[#1F2329] dark:bg-[#16171A] dark:text-white" data-testid="qq-stickers-page">
      <div className="shrink-0 bg-[#FAFAFC] pt-[54px] dark:bg-[#16171A]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="qq-stickers-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 text-center text-[17px] font-medium">表情</div>
          {list.length > 0 ? (
            <button
              type="button"
              data-testid="qq-stickers-manage"
              onClick={() => setDelMode((v) => !v)}
              className="w-[46px] text-center text-[15px] text-[#0099FF] active:opacity-60 dark:text-[#4DB8FF]"
            >
              {delMode ? '完成' : '管理'}
            </button>
          ) : (
            <span className="w-[46px]" />
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3">
        {list.length === 0 ? (
          <p className="mt-10 text-center text-[13px] text-black/35 dark:text-white/35">
            还没有表情包
            <br />
            从下方添加，或批量导入手机图片
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {list.map((st, i) => (
              <button
                key={st.id}
                type="button"
                data-testid={`qq-stickers-item-${i}`}
                onClick={() => {
                  if (delMode) {
                    delSticker(st);
                    return;
                  }
                  setEditing(st);
                  setEditMeaning(st.meaning);
                }}
                className="relative rounded-[12px] p-1 text-left active:bg-black/[0.03] dark:active:bg-white/[0.06]"
              >
                <span className="flex aspect-square items-center justify-center overflow-hidden rounded-[8px]">
                  <img src={st.url} alt={st.meaning || '表情'} className="h-full w-full object-contain" loading="lazy" />
                </span>
                <span className="mt-1.5 block truncate text-[12px] text-black/55 dark:text-white/55">{st.meaning || '点此写意思'}</span>
                {delMode && (
                  <span
                    aria-hidden="true"
                    data-testid={`qq-stickers-del-${i}`}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#F5455C] text-[11px] font-semibold text-white shadow"
                  >
                    ×
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-black/[0.05] bg-white px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 dark:border-white/[0.06] dark:bg-[#1B1C1F]">
        <div className="flex gap-3">
          <button
            type="button"
            data-testid="qq-stickers-upload"
            onClick={() => uploadRef.current?.click()}
            className="h-11 flex-1 rounded-[10px] text-[15px] font-medium text-white active:brightness-95"
            style={{ backgroundColor: QQ_BLUE }}
          >
            从手机添加（可批量）
          </button>
          <button
            type="button"
            data-testid="qq-stickers-add-url"
            onClick={() => setBatchOpen(true)}
            className="h-11 rounded-[10px] bg-black/[0.06] px-5 text-[15px] text-black/70 active:bg-black/[0.1] dark:bg-white/10 dark:text-white/70"
          >
            添加 URL
          </button>
        </div>
      </div>
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void importFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* 单张编辑弹层（改意思 / 删除） */}
      {editing && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/45" onClick={() => setEditing(null)} data-testid="qq-stickers-edit">
          <div className="rounded-t-[14px] bg-[#FAFAFC] px-4 pb-8 pt-4 dark:bg-[#1C1D21]" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex h-[110px] w-[110px] items-center justify-center overflow-hidden rounded-[12px] bg-white p-2 shadow-[0_1px_4px_rgba(0,0,0,0.05)] dark:bg-[#1F2125]">
              <img src={editing.url} alt={editing.meaning || '表情'} className="h-full w-full object-contain" />
            </div>
            <input
              value={editMeaning}
              onChange={(e) => setEditMeaning(e.target.value)}
              maxLength={20}
              placeholder="表情包的意思（AI 会据此理解并回复）"
              data-testid="qq-stickers-edit-meaning"
              className="h-[46px] w-full rounded-[10px] border border-black/[0.08] bg-white px-3 text-[15px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-[#1F2125] dark:placeholder:text-white/30"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                data-testid="qq-stickers-edit-del"
                onClick={() => {
                  commit(list.filter((x) => x.id !== editing.id));
                  setEditing(null);
                  onToast('已删除');
                }}
                className="h-11 rounded-[10px] bg-[#F5455C]/10 px-5 text-[15px] text-[#F5455C] active:bg-[#F5455C]/20 dark:bg-[#F5455C]/20"
              >
                删除
              </button>
              <button
                type="button"
                data-testid="qq-stickers-edit-save"
                onClick={() => {
                  if (!editing) return;
                  commit(list.map((x) => (x.id === editing.id ? { ...x, meaning: editMeaning.trim() } : x)));
                  setEditing(null);
                  onToast('已保存');
                }}
                className="h-11 flex-1 rounded-[10px] text-[15px] font-medium text-white active:brightness-95"
                style={{ backgroundColor: QQ_BLUE }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量添加确认弹窗（预览 + 改名 + 删除 + 从链接导入 + 确认添加 N）；「添加 URL」也走同一弹窗（批量 URL 逐行解析） */}
      <BatchStickerSheet
        open={batchOpen}
        items={batchItems}
        onItemsChange={setBatchItems}
        onCancel={() => {
          setBatchOpen(false);
          setBatchItems([]);
        }}
        onConfirm={confirmBatch}
        onToast={onToast}
        testPrefix="qq"
      />
    </div>
  );
}

// ---------------- 聊天页 ----------------

/** 申请解除拉黑卡片（角色被用户拉黑后发起；同意→解除拉黑，拒绝→保持并让角色知道） */
function QqBlockReqCard({
  name,
  avatar,
  reason,
  status,
  onAccept,
  onReject,
}: {
  name: string;
  avatar: string | null;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected';
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div
      data-testid="qq-blockreq-card"
      className="w-fit max-w-[calc(100%-40px)] rounded-[12px] bg-white px-3 py-2.5 shadow-sm dark:bg-[#2A2C31]"
      aria-label={`${name}申请解除拉黑`}
    >
      <div className="flex items-center gap-2">
        <QqAvatar src={avatar} alt={name} size={34} />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium leading-tight text-[#1F2329] dark:text-white">{name}</p>
          <p className="mt-0.5 text-[12px] leading-tight text-black/45 dark:text-white/45">申请解除拉黑</p>
        </div>
      </div>
      {reason && (
        <p className="mt-2 rounded-[10px] bg-black/[0.04] px-2 py-1.5 text-[13px] leading-[1.5] text-black/70 dark:bg-white/[0.08] dark:text-white/70">「{reason}」</p>
      )}
      {status === 'pending' ? (
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            data-testid="qq-blockreq-reject"
            aria-label={`拒绝${name}的解除拉黑申请`}
            onClick={onReject}
            className="h-8 flex-1 rounded-full bg-black/[0.05] text-[13px] text-black/70 transition active:opacity-70 dark:bg-white/10 dark:text-white/70"
          >
            拒绝
          </button>
          <button
            type="button"
            data-testid="qq-blockreq-accept"
            aria-label={`同意${name}的解除拉黑申请`}
            onClick={onAccept}
            className="h-8 flex-1 rounded-full text-[13px] font-medium text-white transition active:opacity-80"
            style={{ backgroundColor: '#0099FF' }}
          >
            同意
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-black/35 dark:text-white/35">{status === 'accepted' ? '已同意，拉黑已解除' : '已拒绝'}</p>
      )}
    </div>
  );
}

function ChatPage({
  me,
  peer,
  contacts,
  ownerName,
  otherUnread,
  onBack,
  onOpenBond,
  onOpenFriendProfile,
  onSaveRemark,
  onSaveVoiceId,
  onOpenGroup,
}: {
  me: QQUser;
  peer: ContactRecord;
  /** 全部联系人（长按菜单「转发」选择目标会话用） */
  contacts: ContactRecord[];
  ownerName: string | null;
  /** 除当前会话外的未读总数（他人在你聊天时来信 → 返回键旁灰圆数字） */
  otherUnread: number;
  onBack: () => void;
  onOpenBond: () => void;
  /** 聊天设置页点信息卡片 → 进入好友资料页 */
  onOpenFriendProfile: () => void;
  /** 保存备注（空串 = 清除；宿主持久化 + 刷新联系人展示名） */
  onSaveRemark: (v: string) => void | Promise<void>;
  /** 保存 TA 的声音（空串 = 恢复默认；宿主持久化 + 刷新联系人） */
  onSaveVoiceId: (vid: string) => void | Promise<void>;
  /** 群聊卡片「接受邀请」后进入群聊（宿主刷新群列表并打开群页） */
  onOpenGroup?: (gid: string) => void;
  /** App 根部 toast（在聊天分支不渲染，页内用 useLocalToast 自带 toast） */
  onToast?: (m: string) => void;
}) {
  // 聊天页自带 toast（App 根 toast 在聊天分支提前 return 不渲染——收藏成功等提示靠它显示）
  const [chatToast, onToast] = useLocalToast();
  // 退出聊天页/切换会话：停止语音播放与 TTS 朗读并释放播放器（单例，防跨会话串音）
  useEffect(() => () => {
    stopSpeaking();
    stopVoicePlayback();
  }, [peer.id]);
  const apiConfig = useSettings((s) => s.apiConfig);
  const [msgs, setMsgs] = useState<QQMsg[]>(() => loadMsgs(peer.id));
  /** 双向拉黑状态（kv 持久化，按联系人隔离；气泡图标/设置开关/AI 感知共用） */
  const [blk, setBlk] = useState<BlockEntry>(() => loadBlock('qq', peer.id));
  const [input, setInput] = useState('');
  /** 语音输入模式：输入框替换为「按住 说话」胶囊（工具栏麦克风钮切换） */
  const [voiceMode, setVoiceMode] = useState(false);
  /** 文字转语音发送：开启后输入框文字发出为语音气泡（不想说话时用） */
  const [ttsSend, setTtsSend] = useState(false);
  /** 全局流式回复状态（请求由 chat-stream-store 发起并接收，退出聊天页/退出 App 不中断） */
  const sessionKey = `qq:${peer.id}`;
  const stream = useChatStream(sessionKey);
  const streaming = stream?.status === 'streaming';
  const scrollRef = useRef<HTMLDivElement>(null);
  // 加号面板（弹出时把输入行+工具栏整体顶起，输入框跟随面板上浮）
  const [plusOpen, setPlusOpen] = useState(false);
  /** 单聊 @ 提及：键入 @ 唤起联系人浮层，点选后替换该 @ 并插入「@名字 」（与群聊同款交互） */
  const [atOpen, setAtOpen] = useState(false);
  // 表情面板（与加号面板互斥）
  const [stickerOpen, setStickerOpen] = useState(false);
  // 聊天内部浮层（发红包/转账/红包开箱/详情/发送位置）
  const [layer, setLayer] = useState<ChatLayer>(null);
  const [gate, setGate] = useState<null | { kind: 'redpacket' | 'transfer'; packet: MsgPacket; methodId: string }>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 原生相机隐藏 input（capture 调起后置摄像头，对齐微信：不再使用自建取景浮层）
  const cameraInputRef = useRef<HTMLInputElement>(null);
  /** 聊天设置页（右上角菜单进入）：信息卡片/置顶/免打扰/查找聊天记录/回复条数/聊天背景 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 查找聊天记录页 */
  const [searchOpen, setSearchOpen] = useState(false);
  /** 聊天背景页（设置页「聊天背景」进入的独立二级页） */
  const [bgOpen, setBgOpen] = useState(false);
  /** 回复条数页（设置页「回复条数」进入的独立二级页，按会话隔离） */
  const [replyOpen, setReplyOpen] = useState(false);
  // 他的声音（角色音色选择）与 AI 语音频率二级页（设置页进入）
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceFreqOpen, setVoiceFreqOpen] = useState(false);
  const myVoicesForSummary = useMyVoices((s) => s.voices);
  /** 当前会话的回复条数（AI 连发多条消息；切换角色时随 sessionKey 重读） */
  const [replyCount, setReplyCountState] = useState(() => getReplyCount(sessionKey));
  useEffect(() => {
    setReplyCountState(getReplyCount(sessionKey));
  }, [sessionKey]);
  /** 翻译页（设置页「翻译」进入的独立二级页，按会话隔离） */
  const [translateOpen, setTranslateOpen] = useState(false);
  /** 当前会话的翻译配置（开启后文字消息气泡下方显示所选语言的译文；切换角色随 sessionKey 重读） */
  const [transCfg, setTransCfgState] = useState<ChatTranslateCfg>(() => getTranslateCfg(sessionKey));
  useEffect(() => {
    setTransCfgState(getTranslateCfg(sessionKey));
  }, [sessionKey]);
  /** 译文缓存（key = `${msgId}|${langCode}`）与失败标记（避免每帧重试） */
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [trFailed, setTrFailed] = useState<Record<string, boolean>>({});
  /** 分句发送开关（开启后连续发消息 AI 不回复，输入框为空再点一次发送才触发回复） */
  const [sentenceSend, setSentenceSendState] = useState(() => getSentenceSend(sessionKey));
  useEffect(() => {
    setSentenceSendState(getSentenceSend(sessionKey));
  }, [sessionKey]);
  /** 时间感知开关（本会话独立，发送时现场读取；见 @/lib/time-aware） */
  const [timeAware, setTimeAwareState] = useState(() => getTimeAware(sessionKey));
  useEffect(() => {
    setTimeAwareState(getTimeAware(sessionKey));
  }, [sessionKey]);
  /** 表情包开关（本会话独立，发送时现场读取；关闭后 AI 不发表情包也不发 emoji，见 @/lib/sticker-toggle） */
  const [stickersOn, setStickersOnState] = useState(() => getStickersOn(sessionKey));
  useEffect(() => {
    setStickersOnState(getStickersOn(sessionKey));
  }, [sessionKey]);
  /** 世界书挂载页（设置页「世界书」进入）：为联系人勾选挂载的书籍（见 @/lib/ios/worldbook） */
  const [wbOpen, setWbOpen] = useState(false);
  /** 当前联系人挂载的世界书 id（切换联系人/挂载变化时重读） */
  const [wbBound, setWbBound] = useState<string[]>(() => getBoundBookIds(peer.id));
  useEffect(() => {
    setWbBound(getBoundBookIds(peer.id));
  }, [peer.id]);
  /** 分句发送批次「待 AI 回复」标记（跨页面切换持久，见 @/lib/sentence-send） */
  const [pendingDispatch, setPendingDispatch] = useState(() => hasPendingBatch(sessionKey));
  useEffect(() => {
    setPendingDispatch(hasPendingBatch(sessionKey));
  }, [sessionKey]);
  /** 登记当前正在查看的聊天：AI 回复落盘时按此决定是否计未读角标（退出聊天页后 AI 回复 → 角标 +1） */
  useEffect(() => {
    qqActiveChatId = peer.id;
    return () => {
      if (qqActiveChatId === peer.id) qqActiveChatId = null;
    };
  }, [peer.id]);
  /** 搜索定位命中的消息 id（短暂高亮） */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  /** 气泡长按菜单（横向弹窗）：消息 + 容器内坐标 */
  const [msgMenu, setMsgMenu] = useState<null | { msg: QQMsg; pos: BubbleMenuPos }>(null);
  /** 编辑消息弹窗（菜单「编辑」）：原消息 + 草稿 */
  const [editMsg, setEditMsg] = useState<QQMsg | null>(null);
  const [editDraft, setEditDraft] = useState('');
  /** 引用回复（输入框上方条；发送时挂到新消息上） */
  const [quote, setQuote] = useState<null | { name: string; content: string; id?: string; time?: number }>(null);
  /** 多选模式：勾选消息批量删除/转发/收藏 */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** 转发流程：'choose'=在聊天里勾选消息（顶部计数栏 + 底部逐条/合并/取消）；'target'=选目标会话；null=未进行中 */
  const [fwdFlow, setFwdFlow] = useState<'choose' | 'target' | null>(null);
  const [fwdMode, setFwdMode] = useState<FwdMode>('each');
  /** 合并转发「聊天记录」卡片详情（点卡片打开） */
  const [fwdDetailId, setFwdDetailId] = useState<string | null>(null);
  /** 聊天页根元素（长按菜单定位参照） */
  const pageRef = useRef<HTMLDivElement>(null);
  /** 聊天背景（本会话）：置顶/免打扰/背景在 chat-flags 总线，图片本体在 IndexedDB */
  const flags = useChatFlags(qqChatFlagsStore)[peer.id] ?? NO_FLAGS;
  const bg: ChatSettingsBg = { mode: flags.bgMode ?? 'default', color: flags.bgColor ?? '' };
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const [uploadingBg, setUploadingBg] = useState(false);
  // 发红包/转账页支付方式上下文（打开发送页时刷新）
  const [payCtx, setPayCtx] = useState(() => ({ wallet: loadWallet(), cards: loadBankCards() }));
  // 发红包/转账页支付方式上下文（打开发送页时刷新；微任务内 setState 规避 react-hooks/set-state-in-effect）
  useEffect(() => {
    if (layer?.view === 'redpacket' || layer?.view === 'transfer') {
      void Promise.resolve().then(() => {
        setPayCtx({ wallet: loadWallet(), cards: loadBankCards() });
      });
    }
  }, [layer]);

  const patchPacket = useCallback((msgId: string, patch: Partial<MsgPacket>) => {
    setMsgs((prev) => prev.map((m) => (m.id === msgId && m.packet ? { ...m, packet: { ...m.packet, ...patch } } : m)));
  }, []);

  /** runAiTurn 的稳定引用：发红包/转账/亲属卡（sendRedPacket 等定义在 runAiTurn 之前）也要触发 AI 回复，
   *  直接引用会产生先定义后声明的循环依赖，用 ref 中转（runAiTurn 定义后回填） */
  const runAiTurnRef = useRef<((userMsg: QQMsg | null, extra?: QQMsg[], sysEvent?: string, baseMsgs?: QQMsg[]) => void) | null>(null);

  /** 领取亲属卡（对方/AI 赠送的卡）：标记已领取 + 时间；纯本地模拟，无资金流转 */
  const claimFam = useCallback(
    (msgId: string) => {
      setMsgs((prev) => prev.map((m) => (m.id === msgId && m.fam && !m.fam.claimed ? { ...m, fam: { ...m.fam, claimed: true, claimedAt: Date.now() } } : m)));
    },
    []
  );

  /**
   * 退还 AI 发来的红包/转账/亲属卡（红包弹窗「退还」、转账收款页「退还」、亲属卡详情「退还」共用）：
   * 原卡标记终态（变灰）+ 聊天里追加通知行 + 注入系统事件触发 AI 人设化回应（AI 能感知退还并自然接话）
   */
  const refundPeerCard = useCallback(
    (m: QQMsg) => {
      if (m.kind === 'redpacket' && m.packet) {
        patchPacket(m.id, { status: 'returned' });
        setMsgs((prev) => [
          ...prev,
          { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'notice', notice: { icon: 'rp', pre: `你退回了${peer.name}的`, accent: '红包' } },
        ]);
        setLayer(null);
        onToast('红包已退还给对方');
        runAiTurnRef.current?.(
          null,
          [],
          `（系统事件：你发给对方的红包被对方退还了（¥${m.packet.amount}，祝福语"${m.packet.note}"），金额已退回你的账户。请用符合人设的一两句话自然回应这件事。）`
        );
      } else if (m.kind === 'transfer' && m.packet) {
        const refundedAt = Date.now();
        const trAmt = m.packet.amount;
        const trNote = m.packet.note;
        // 我退还 AI 发的转账：原卡标记终态（变灰）+ 追加「我」发出的退还凭据卡（灰卡↩+已退还，详情页「你已退还」）
        patchPacket(m.id, { status: 'returned', refundedAt });
        setMsgs((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'me',
            content: '',
            time: refundedAt,
            kind: 'transfer',
            packet: { type: 'transfer', amount: trAmt, note: trNote, received: false, status: 'returned' as const, refundedAt, originTime: m.time, refundedBy: 'me' as const },
          },
        ]);
        setLayer(null);
        onToast('转账已退还给对方');
        runAiTurnRef.current?.(
          null,
          [],
          `（系统事件：你发给对方的转账被对方退还了（¥${trAmt}${trNote ? `，备注"${trNote}"` : ''}）。请用符合人设的一两句话自然回应这件事。）`
        );
      } else if (m.kind === 'family' && m.fam) {
        setMsgs((prev) => prev.map((x) => (x.id === m.id && x.fam ? { ...x, fam: { ...x.fam, rejected: true } } : x)));
        setMsgs((prev) => [
          ...prev,
          { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'notice', notice: { icon: 'fam', pre: `你退回了${peer.name}的`, accent: '亲属卡' } },
        ]);
        setLayer(null);
        onToast('亲属卡已退还');
        runAiTurnRef.current?.(
          null,
          [],
          `（系统事件：你送给对方的亲属卡被对方退还了（每月额度¥${m.fam.monthlyLimit}）。请用符合人设的一两句话自然回应这件事。）`
        );
      }
    },
    [patchPacket, peer.name, onToast]
  );

  // 发红包消息（生成 AI 可引用的短 ID）：AI 在回复里用动作标记决定领取/退回/拒收（不再定时自动领取），
  // 发出后立即触发一轮 AI 回复（红包会进待处理清单，AI 按人设处理）
  const sendRedPacket = useCallback(
    (p: MsgPacket) => {
      const msg: QQMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'redpacket', packet: { ...p, cid: nextCid('rp') } };
      setMsgs((prev) => [...prev, msg]);
      if (peer.id !== me.id) runAiTurnRef.current?.(null, [msg]);
    },
    [peer.id, me.id]
  );

  // 发转账消息（生成 AI 可引用的短 ID）：AI 在回复里用动作标记决定收款/退回/拒收，发出后立即触发 AI 回复
  const sendTransfer = useCallback(
    (p: MsgPacket) => {
      const msg: QQMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'transfer', packet: { ...p, cid: nextCid('tr') } };
      setMsgs((prev) => [...prev, msg]);
      if (peer.id !== me.id) runAiTurnRef.current?.(null, [msg]);
    },
    [peer.id, me.id]
  );

  // 相册选图发送（图片消息，压缩 dataURL，最多 9 张）。
  //  已配置识图模型时：发图触发 AI 回合（识图模型先看图，聊天模型再回复）；
  //  未配置时保持旧行为（图片只入聊天记录，不触发回复）
  const sendImageFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const created: QQMsg[] = [];
      for (const f of Array.from(files).slice(0, 9)) {
        try {
          const d = await compressImageFile(f);
          const msg: QQMsg = { id: uid(), role: 'me', content: d, time: Date.now(), kind: 'image' };
          created.push(msg);
          setMsgs((prev) => [...prev, msg]);
        } catch {
          onToast('图片发送失败');
        }
      }
      if (
        created.length > 0 &&
        peer.id !== me.id &&
        !isChatStreaming(sessionKey) &&
        useSettings.getState().visionConfig.baseUrl.trim()
      ) {
        runAiTurnRef.current?.(null, created);
      }
    },
    [onToast, peer.id, me.id, sessionKey]
  );

  // 按所选支付方式扣款并发送卡片消息
  const execAndSend = useCallback(
    (kind: 'redpacket' | 'transfer', p: MsgPacket, methodId: string) => {
      const paid = executePayment(methodId, p.amount, kind === 'redpacket' ? '红包' : '转账');
      if (!paid) {
        onToast(methodId === 'balance' ? '余额不足，请更换支付方式或先充值' : '卡内余额不足，请更换支付方式');
        return;
      }
      if (kind === 'redpacket') {
        sendRedPacket(p);
        onToast(`红包已发出 ${fmtMoney(p.amount)} 元`);
      } else {
        sendTransfer(p);
        onToast(`已向${peer.name}转账 ${fmtMoney(p.amount)} 元`);
      }
      setLayer(null);
    },
    [onToast, peer.name, sendRedPacket, sendTransfer]
  );

  // 发送前：可支付性预检 → 开启支付密码则先弹自绘键盘验证
  const startSend = useCallback(
    (kind: 'redpacket' | 'transfer', p: MsgPacket, methodId: string) => {
      if (peer.id === me.id) {
        onToast(kind === 'redpacket' ? '不能给自己发红包哦' : '不能给自己转账哦');
        return;
      }
      if (!canPay(methodId, p.amount)) {
        onToast(methodId === 'balance' ? '余额不足，请更换支付方式或先充值' : '卡内余额不足，请更换支付方式');
        return;
      }
      const pp = loadPayPwd();
      if (pp.enabled && pp.pwd) setGate({ kind, packet: p, methodId });
      else execAndSend(kind, p, methodId);
    },
    [me.id, onToast, peer.id, execAndSend]
  );

  // 左滑手势：页面任意位置（表单控件/按钮除外）水平左滑 → 好友互动标识页
  const swipe = useRef<{ x: number; y: number; fired: boolean } | null>(null);
  const onSwipeStart = (e: React.PointerEvent) => {
    // 聊天设置/聊天背景/查找记录/红包等浮层打开时不触发手势，避免滑动误入互动标识页
    if (settingsOpen || searchOpen || bgOpen || layer) return;
    const el = e.target as HTMLElement;
    // 输入框/按钮不触发手势，避免影响输入与点击
    if (el.closest('input, textarea, button')) return;
    swipe.current = { x: e.clientX, y: e.clientY, fired: false };
  };
  const onSwipeMove = (e: React.PointerEvent) => {
    const t = swipe.current;
    if (!t || t.fired) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (dx < -50 && Math.abs(dy) < 80) {
      t.fired = true;
      onOpenBond();
      return;
    }
    if (dx > 30 || Math.abs(dy) > 90) t.fired = true; // 反向/纵向则放弃，避免误触发
  };

  // 本地持久化：流式中的 AI 回复不进本地 msgs（在全局 store 里），msgs 只含已落盘内容，直接保存
  useEffect(() => {
    saveMsgs(peer.id, msgs);
  }, [msgs, peer.id]);

  /** 群聊卡片：接受/拒绝（状态随消息持久化；接受后宿主打开群聊） */
  const decideGroupCard = useCallback(
    (m: QQMsg, accept: boolean) => {
      if (!m.gcard || m.gcard.status !== 'pending') return;
      const r = applyGroupCardDecision('qq', peer.id, m.id, accept);
      setMsgs((prev) => prev.map((x) => (x.id === m.id && x.gcard ? { ...x, gcard: { ...x.gcard, status: accept ? 'accepted' : 'rejected' } } : x)));
      if (accept && r?.joined) {
        onToast(`已加入群聊「${r.groupName}」`);
        onOpenGroup?.(m.gcard.gid);
      } else if (accept) {
        onToast('该群聊已失效');
      } else {
        onToast('已拒绝邀请');
      }
    },
    [peer.id, onOpenGroup, onToast],
  );

  // 转发感知：其他会话转发消息给本会话时写入事件队列；进入聊天时 drain 并触发一次 AI 回合（AI 知道收到了什么）
  useEffect(() => {
    const evs = drainAiEvents(peer.id);
    if (evs.length === 0) return;
    const t = window.setTimeout(() => {
      if (!isChatStreaming(sessionKey)) runAiTurnRef.current?.(null, [], evs.join('\n'));
    }, 400);
    return () => window.clearTimeout(t);
  }, [peer.id, sessionKey]);

  // 聊天背景图片加载（bgMode = image 时从 IndexedDB 读；bgV 变化 = 重新上传，重读）
  useEffect(() => {
    let alive = true;
    if (bg.mode === 'image') {
      void getChatBgImage('qq', peer.id).then((d) => {
        if (alive) setBgImageUrl(d);
      });
    }
    return () => {
      alive = false;
    };
  }, [bg.mode, flags.bgV, peer.id]);

  // 滚底签名守卫：仅结构性变化（条数/末条 id/流式内容）才滚底；
  // 转文字等原地更新（msgs 引用变但结构不变）不触发滚动，避免转写面板出现时气泡被拽上移
  const scrollSigRef = useRef('');
  useEffect(() => {
    const sig = `${msgs.length}:${msgs[msgs.length - 1]?.id ?? ''}:${stream?.content ?? ''}`;
    if (sig === scrollSigRef.current) return;
    scrollSigRef.current = sig;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, stream]);

  // 翻译：开启后把文字消息（最近 60 条，排除错误/兑底文案）按检测到的语言双向翻译成另一侧
  // （左侧语言的消息译成右侧，右侧语言的消息译成左侧）。缓存、并发闸、在途去重都在
  // @/lib/chat-translate 内部，这里只负责把结果写入组件状态
  useEffect(() => {
    if (!transCfg.on) return;
    const isErrText = (s: string) => s.startsWith('（消息发送失败') || s.startsWith('（AI') || s.startsWith('（对方暂时');
    const targets = msgs.filter((m) => !m.kind && m.content.trim() && !isErrText(m.content)).slice(-60);
    if (targets.length === 0) return;
    let alive = true;
    for (const m of targets) {
      const code = detectTranslateTarget(m.content, transCfg.left, transCfg.right);
      const key = `${m.id}|${code}`;
      if (translations[key] !== undefined || trFailed[key]) continue;
      requestTranslation({ text: m.content, lang: code, apiConfig })
        .then((text) => {
          if (alive) setTranslations((prev) => (prev[key] === text ? prev : { ...prev, [key]: text }));
        })
        .catch(() => {
          if (alive) setTrFailed((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
        });
    }
    return () => {
      alive = false;
    };
  }, [msgs, transCfg, translations, trFailed, apiConfig]);

  /** 气泡下方译文行（翻译开启时按消息语言显示对侧语言的译文，带语言名前缀） */
  const renderTranslations = (msgId: string, content: string) => {
    if (!transCfg.on) return null;
    if (!content.trim() || content.startsWith('（消息发送失败') || content.startsWith('（AI') || content.startsWith('（对方暂时')) return null;
    const code = detectTranslateTarget(content, transCfg.left, transCfg.right);
    const text = translations[`${msgId}|${code}`];
    if (typeof text !== 'string' || !text) return null;
    return (
      <p
        data-testid="qq-translate-row"
        className="mt-1 max-w-full whitespace-pre-wrap break-words text-[12.5px] leading-[1.45] text-black/45 dark:text-white/45"
      >
        {`${translateLangLabel(code)}：${text}`}
      </p>
    );
  };

  /** 全局流结束（成功/失败）：finalize 已把最终消息落盘，把落盘后的完整记录并回本地并清理流状态。
   *  useLayoutEffect + 微任务：渲染帧内完成同步避免气泡闪断；页面不在时流自然由 store 收尾，重进后走同逻辑。
   *  同 id 消息用落盘的 packet/fam 覆盖本地（finalize 里 AI 领取/退回/拒收动作已更新卡片状态） */
  useLayoutEffect(() => {
    if (!stream || stream.status === 'streaming') return;
    void Promise.resolve().then(() => {
      setMsgs((prev) => {
        const saved = loadMsgs(peer.id);
        const savedMap = new Map(saved.map((m) => [m.id, m]));
        const merged = prev.map((m) => {
          const s = savedMap.get(m.id);
          if (!s) return m;
          return {
            ...m,
            ...(s.packet ? { packet: s.packet } : {}),
            ...(s.fam ? { fam: s.fam } : {}),
            ...(s.content && !m.content ? { content: s.content } : {}),
          };
        });
        // 按 id 合并：本地新增的（红包/转账等补丁后的消息）保留，落盘新增的只会是 AI 回复
        const ids = new Set(prev.map((m) => m.id));
        return [...merged, ...saved.filter((m) => !ids.has(m.id))];
      });
      clearChatStream(sessionKey);
    });
  }, [stream, sessionKey, peer.id]);

  /** 逐条投递 tick：AI 回复由 ai-delivery 调度器按真人节奏逐条落盘（模块层，与页面是否存活无关），
   *  每条到达后把落盘记录合并进本地 state；同 id 用落盘数据覆盖（动作状态/语音升级以存储为权威） */
  useEffect(() => {
    return subscribeAiDelivery(sessionKey, () => {
      setMsgs((prev) => {
        const saved = loadMsgs(peer.id);
        const savedMap = new Map(saved.map((m) => [m.id, m]));
        return [...prev.map((m) => savedMap.get(m.id) ?? m), ...saved.filter((m) => !prev.some((p) => p.id === m.id))];
      });
    });
  }, [sessionKey, peer.id]);

  /** 投递进行中（含排队批次）：标题维持「正在输入中…」，直到最后一条消息发出 */
  const [delivering, setDelivering] = useState(() => isAiDelivering(sessionKey));
  useEffect(() => {
    setDelivering(isAiDelivering(sessionKey));
    return subscribeAiDeliveryActive(() => setDelivering(isAiDelivering(sessionKey)));
  }, [sessionKey]);

  /** 排队补跑：流进行中发来的消息（qqQueuedTurns）在本轮流结束后自动触发回复。
   *  页面存活时监听流结束广播；离开后流才收尾的，重进页面时补跑（消息已落盘不丢）。 */
  useEffect(() => {
    const kick = () => {
      if (!qqQueuedTurns.has(peer.id)) return;
      if (isChatStreaming(sessionKey)) return; // 本轮流还没收尾：等结束广播再跑
      qqQueuedTurns.delete(peer.id);
      window.setTimeout(() => {
        const saved = loadMsgs(peer.id);
        setMsgs((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          return [...prev, ...saved.filter((m) => !ids.has(m.id))];
        });
        runAiTurnRef.current?.(null, [], undefined, saved);
      }, 260);
    };
    const unsub = subscribeChatStreamFinalized((sKey) => {
      if (sKey === sessionKey) kick();
    });
    kick(); // 挂载时：之前排队但流已结束（离开页面后流才收尾）→ 立即补跑
    return unsub;
  }, [sessionKey, peer.id]);

  /** 通话结束（恰好一次，可能发生在聊天页已退出时）：通话卡片直写持久化 + 在场时同步本地 state。
   *  全局通话层负责渲染通话页与悬浮小窗，宿主只关心把结果落成消息。 */
  const writeCallCard = useCallback(
    (r: ChatCallResult) => {
      const st = callResultToCardState(r);
      const card: QQMsg = {
        id: uid(),
        role: r.direction === 'out' ? 'me' : 'peer',
        content: callCardAiText(st, r.duration),
        time: Date.now(),
        kind: 'call' as const,
        call: { state: st, duration: r.duration, direction: r.direction },
      };
      saveMsgs(peer.id, [...loadMsgs(peer.id), card]);
      setMsgs((prev) => (prev.some((m) => m.id === card.id) ? prev : [...prev, card]));
      // AI 拒接/未接：过一会儿 AI 主动发一条人设化解释（接听决策产出 afterText）。
      // 聊天页不在场也照常落盘（saveMsgs 直写；回来时 loadMsgs 恢复，消息照常进后续 AI 上下文）
      if (r.afterText && r.direction === 'out' && !r.connected) {
        const after = r.afterText;
        window.setTimeout(() => {
          const msg: QQMsg = { id: uid(), role: 'peer', content: after, time: Date.now() };
          saveMsgs(peer.id, [...loadMsgs(peer.id), msg]);
          setMsgs((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        }, 3000 + Math.floor(Math.random() * 5000));
      }
    },
    [peer.id],
  );

  /** 发起全局语音通话（加号面板「语音通话」/ 通话卡片回拨 / AI 来电共用）：打开瞬间快照最近上下文；
   *  通话页与小窗由 PhoneShell 的全局通话层渲染，退出聊天页/切 App 电话不断 */
  const openVoiceCall = useCallback(
    (direction: 'out' | 'in') => {
      const base = msgs;
      const history: ChatCallTurnMsg[] = base
        .filter((m) => !m.recalled && (m.content.trim().length > 0 || m.kind === 'location' || (m.kind === 'image' && m.img?.desc && !m.content.startsWith('data:'))) && !m.content.startsWith('〔') && !m.content.startsWith('（AI'))
        .slice(-8)
        .map((m) => ({
          role: m.role === 'me' ? ('user' as const) : ('assistant' as const),
          // 语音取转写/本地原文；位置取完整位置文本（名称/地址/经纬度/发送时间）；图片取识图描述，通话里 AI 同样知道聊过的图片内容
          content:
            m.kind === 'voice'
              ? m.voice?.transcript || m.voice?.localText || '[语音]'
              : m.kind === 'location'
                ? locationAiText(m.loc, m.time)
                : m.kind === 'image' && m.img?.desc && !m.content.startsWith('data:')
                  ? `[图片]（图片内容：${m.img.desc}）`
                  : m.content,
        }));
      const memContext = history.map((h) => h.content).join(' ');
      // 世界书注入通话（与文字聊天同一套 collectWbBlocks：全局常驻 + 局部/专属按触发词命中）：
      // 六个位置块 + 使用规则拼成一个块随人设注入（优先级：人设/世界设定 > 记忆）
      const callWb = collectWbBlocks(peer.id, wbScanText([memContext]));
      const worldbookBlock =
        [
          callWb.beforeSystem,
          callWb.afterSystem,
          callWb.beforeChar,
          callWb.afterChar,
          callWb.beforeUser,
          callWb.afterUser,
          wbRulesBlock(callWb),
        ]
          .filter(Boolean)
          .join('\n\n') || undefined;
      // 每轮动态召回（引擎以「用户刚说的话」逐轮调用）：通话里 AI 能随话题变化召回相关记忆，
      // 主动提起之前聊过的事（文字聊过的事通话里能接上——互通开关决定召回范围）
      const memoryBlockFn = (userText: string | null) =>
        memRecallBlock(peer.id, 'qq', wbScanText([userText, ...history.slice(-4).map((h) => h.content)]), {
          interopOn: effectiveInterop,
        }) || undefined;
      startGlobalCall({
        variant: 'qq',
        name: peer.name,
        avatar: peer.avatar ?? null,
        contact: peer,
        direction,
        initialHistory: history,
        memoryBlock: memRecallBlock(peer.id, 'qq', memContext, { interopOn: effectiveInterop }) || undefined,
        memoryBlockFn,
        worldbookBlock,
        momentsBlock: buildMomentsChatBlock({ contactId: peer.id, app: 'qq', userName: me.name, peer }) || undefined,
        timeBlock: getTimeAware(sessionKey)
          ? buildTimeAwareBlock({ lastMsgTime: base.length > 0 ? base[base.length - 1].time : null, regionHint: peer.region || null })
          : '',
        // 位置块与文字聊天同一套 buildLocationBlock：通话里 AI 同样知道“用户在哪”
        locBlock: buildLocationBlock(base, { userLabel: me.name }) || undefined,
        multiApp: getMemSettings(peer.id).share,
        onEnd: writeCallCard,
      });
    },
    [msgs, peer, me.name, sessionKey, writeCallCard],
  );

  /** AI 回合：插入用户消息并把整轮流式请求交给全局 store（文本/表情共用；表情以 [发送了表情：意思] 进入对话历史，AI 据此理解表情）。
   *  流式接收、超时、错误处理、落盘全部在 chat-stream-store 内完成：退出聊天页不中断，重进从 store 读实时内容。
   *  extra：发红包/转账随消息触发回复时，刚入列还没进 state 的消息（要一并进上下文与待处理清单）。
   *  sysEvent：用户退还 AI 的红包/转账/亲属卡后注入的系统事件说明（只进本轮上下文，不落盘），让 AI 人设化地回应退还 */
  const runAiTurn = useCallback(
    (userMsg: QQMsg | null, extra?: QQMsg[], sysEvent?: string, baseMsgs?: QQMsg[]) => {
    // 密友值：对照 QQ 规则，我方每发一条消息 +2（每日上限 20）；批次触发（null）同样计一轮互动
    addBondPoints(peer.id, BOND_MSG_POINTS);
    const base = [...(baseMsgs ?? msgs), ...(userMsg ? [userMsg] : []), ...(extra ?? [])];
    // 上下文：卡片消息（红包/转账/亲属卡）按类型生成可读摘要（含 AI 可引用的 ID 与当前状态），让 AI 知道发过什么、好做处理决策；
    // 图片消息以 [图片] 占位、位置以完整位置文本进入历史（本轮图片的实际内容由识图模型描述追加在末尾）
    const history = base
      .filter(
        (m) =>
          (!m.recalled && ((m.content || m.kind === 'image' || m.kind === 'voice' || m.kind === 'sticker' || m.kind === 'redpacket' || m.kind === 'transfer' || m.kind === 'family' || m.kind === 'groupcard' || m.kind === 'call' || m.kind === 'location') && !m.content.startsWith('〔') && !m.content.startsWith('（AI')))
      )
      .slice(-20)
      .map((m) => {
        // 引用/转发让 AI 感知来源：引用 → 前缀说明引用的是谁说的什么；转发卡片 → 前缀说明来自哪个会话；
        // 合并转发的「聊天记录」卡片 → 完整注入逐条对话，被分享的 AI 知道转发了什么
        const pre = `${m.quote ? `（引用 ${m.quote.name}：「${m.quote.content}」）` : ''}${
          m.kind === 'forward' && m.fwd
            ? m.fwd.merged
              ? `[合并转发的聊天记录「${m.fwd.title ?? '聊天记录'}」] `
              : `[转发自「${m.fwd.from}」的消息] `
            : ''
        }`;
        return {
        role: m.role === 'me' ? ('user' as const) : ('assistant' as const),
        // 我的表情以 [发送了表情：意思] 进入历史（AI 理解含义）；AI 自己发的表情回写成 [表情包:ID]
        // 示范正确输出格式（意思靠 system 清单反查），避免它模仿我的记录格式导致发表情变文字
        content:
          pre +
          (m.kind === 'sticker' && m.stk
            ? m.role === 'me'
              ? `[发送了表情：${m.stk.meaning || '无描述'}]`
              : m.stk.sid
                ? `[表情包:${m.stk.sid}]`
                : `[发送了表情：${m.stk.meaning || '无描述'}]`
            : m.kind === 'image'
            ? // 图片消息：有识图描述时 AI 读到内容（历史可回看）；无描述时占位（防编造规则由 system 注入）
              m.img?.desc
              ? `[图片]（图片内容：${m.img.desc}）`
              : '[图片]'
            : m.kind === 'voice'
            ? // 语音消息：AI 直接读转写文本（自然对话；AI 语音消息的朗读原文同源兑底）；识别失败/未识别时用占位
              m.voice?.transcript || m.voice?.localText || '[语音]'
            : m.kind === 'location'
            ? // 位置消息：AI 读到完整位置文本（名称/地址/经纬度/发送时间），问“我在哪”能直接答出地点名
              locationAiText(m.loc, m.time)
            : m.kind === 'redpacket' && m.packet
              ? `[红包 ID:${m.packet.cid ?? m.id} ¥${m.packet.amount} "${m.packet.note}"，${cardStateLabel(m)}]`
              : m.kind === 'transfer' && m.packet
                ? `[转账 ID:${m.packet.cid ?? m.id} ¥${m.packet.amount}${m.packet.note ? ` "${m.packet.note}"` : ''}，${cardStateLabel(m)}]`
                : m.kind === 'family' && m.fam
                  ? `[亲属卡 ID:${m.fam.cid ?? m.id} 每月额度¥${m.fam.monthlyLimit}${m.fam.message ? ` "${m.fam.message}"` : ''}，${cardStateLabel(m)}]`
                  : m.kind === 'groupcard' && m.gcard
                    ? `[群聊邀请卡片：${m.gcard.name}（${m.gcard.inviterName || '群友'}邀请${m.gcard.memberNames?.length ? `，成员：${m.gcard.memberNames.join('、')}` : ''}），${m.gcard.status === 'pending' ? '待处理' : m.gcard.status === 'accepted' ? '已接受' : '已拒绝'}]`
                    : m.content),
        };
      });

    const aiId = uid();
    // 用户消息立即入列（保存 effect 随即落盘）；AI 回复在全局 store 流式接收，
    // 结束/失败后由 finalize 写入本角色的聊天记录（与页面是否存活无关）。
    // userMsg 为 null = 分句发送批次触发（消息早已入列，只发起 AI 回复）
    if (userMsg) setMsgs((prev) => [...prev, userMsg]);

    // 回复条数（本会话独立设置，发送时现场读取）：>1 时在人设后追加多条消息指令；
    // 特殊消息规则（红包/转账/亲属卡/位置/表情包标记 + 表情包 ID 清单）随表情包清单一起注入；
    // 我发给 AI 的待处理红包/转账 → 注入处理动作规则与待处理清单（AI 用 [领取红包:ID] 等标记处理，回应按人设正文说）
    const replyCount = getReplyCount(sessionKey);
    const stickers = loadStickers('qq');
    // 表情包开关（本会话独立，发送时现场读取；关闭后 AI 不发表情包也不发 emoji）
    const stickersOn = getStickersOn(sessionKey);
    const system = buildPersonaPrompt(peer, me, ownerName, stickers, stickersOn, buildNpcPromptExtra(peer, contacts));
    const actionRules = buildActionRules(collectPendingCards(base));
    // 退群挽留背景（需求二）：该联系人所在的某个群存在活跃的退群流程时，注入退群事件、群内近况与
    // 拉回群/给权限标记说明（AI 按人设决定是否提起、是否拉回；每次退群最多一次，拒绝后不再提）
    const quitCtx = activeQuitFlowFor(peer.id);
    // 名字/昵称区分：AI 侧统一用称呼名（默认真名「凡凡」）指代用户；展示层（动态等）仍用显示名
    const meAddrName = addressNameOf(me, useSettings.getState().addressMode);
    // 被踢感知（需求一）：TA 被移出过群聊（未回群/刚回群）→ 私聊里记得并按人设自然提起
    const kickSection = buildKickNoticeSection(peer.id, meAddrName);
    // 建群能力（需求二/四）：关系到位、话题合适时可主动建群（冷却/拒绝表硬校验，提示词同步约束）
    const socialRules = buildGroupSocialRules(peer, 'qq', contacts, meAddrName);
    // 记忆库：召回该联系人（互通开关限定范围）的记忆注入 system，让 AI 带着记忆回复；
    // 相关性上下文用本轮触发消息（用户消息/系统事件）+ 最近几条，没记忆时返回空串不注入；
    // 图片消息以识图描述（无则占位）、语音消息以转写文本、位置以完整位置文本进上下文（防止 dataURL 大字符串进入记忆提取）
    const scanTextOf = (m: QQMsg): string =>
      m.kind === 'voice'
        ? m.voice?.transcript || ''
        : m.kind === 'image'
          ? m.img?.desc || ''
          : m.kind === 'location'
            ? locationAiText(m.loc, m.time)
            : m.content;
    const memContext = [userMsg?.content, sysEvent, ...base.slice(-6).map(scanTextOf)]
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
      .join(' ');
    // 记忆召回（私聊）：跨 App 互通开关照旧；群聊来源记忆按群级互通开关判断可见性
    //（effectiveInterop 只跟群开关；用户和角色 A 的私聊记忆默认不对角色 B 开放——
    //  存储键即隔离边界，这里只影响该角色自己的召回范围）
    const memoryBlock = memRecallBlock(peer.id, 'qq', memContext, {
      interopOn: effectiveInterop,
    });
    // QQ动态感知（四）：把「最近的动态 + 相关互动」注入 system（互通开关关闭时只看 QQ 平台的动态），
    // AI 能像真人一样自然提起；用户广播动态首次被看到时懒写入该角色记忆（动态 → 记忆双向打通）
    const momentsBlock = buildMomentsChatBlock({ contactId: peer.id, app: 'qq', userName: me.name, peer });
    // 时间感知（本会话独立开关，发送时现场读取；关闭时不注入任何时间信息，恢复普通聊天）：
    // 上次聊天间隔 = 该会话上一条消息时间戳（不含本轮刚发的消息）与当前时间的差值，按角色隔离不串台
    const priorMsgs = baseMsgs ?? msgs;
    const timeBlock = getTimeAware(sessionKey)
      ? buildTimeAwareBlock({
          lastMsgTime: priorMsgs.length > 0 ? priorMsgs[priorMsgs.length - 1].time : null,
          regionHint: peer.region || null,
        })
      : '';
    // 世界书：扫描「最新用户消息 + 最近 8 条上下文」，命中触发词的条目按插入位置分组注入
    //（每本书独立包裹成【世界设定开始】/【世界设定结束】块；系统/角色定义前后进 system，
    // 用户消息前后包裹最后一条 user 消息；未命中不发送；有内容时 system 末尾附带使用规则；
    // 图片消息以 [图片] 占位、语音消息以转写文本参与，防 dataURL 进入触发词扫描）
    const wbBlocks = collectWbBlocks(peer.id, wbScanText([userMsg?.content, sysEvent, ...base.slice(-8).map(scanTextOf)]));
    // 位置感知：用户最近发过的位置消息（名称/地址/经纬度/发送时间）注入 system——
    // AI 被问“我在哪/你知道我在哪吗”时直接说出地点名；解析失败时诚实说无法识别，不编造
    const locBlock = buildLocationBlock(base, { userLabel: meAddrName });
    // 双向拉黑感知：当前会话的拉黑关系注入 system（无拉黑状态时为空串；拉黑是关系状态，
    // 不拦截消息——角色仍可发消息，但要按人设表现出被拉黑/已拉黑的态度，并可输出对应标记）
    const blkBlock = buildBlockPromptBlock('qq', peer.id, me.name);
    // 占位防编造（AI 感知审计修复）：最近消息里有听不到内容的语音 / 看不到内容的图片时注入——
    // AI 不得假装听过/看过并编造细节（本轮正在识图的图片排除：描述随后作为独立消息追加）
    const turnImageIds = new Set<string>();
    for (let i = base.length - 1; i >= 0 && turnImageIds.size < 3; i--) {
      const m = base[i];
      if (m.role !== 'me') break;
      if (m.kind === 'image') turnImageIds.add(m.id);
    }
    const mediaRules = [
      buildVoicePlaceholderRule(base),
      buildImagePlaceholderRule(base, { excludeIds: turnImageIds }),
    ].filter(Boolean);
    const systemFull = [
      wbBlocks.beforeSystem,
      [wbBlocks.beforeChar, system, wbBlocks.afterChar].filter(Boolean).join('\n\n'),
      memoryBlock,
      momentsBlock,
      locBlock,
      actionRules.length > 0 ? actionRules.join('\n\n') : '',
      blkBlock,
      quitCtx?.section ?? '',
      kickSection,
      socialRules,
      ...(mediaRules.length > 0 ? [mediaRules.join('\n\n')] : []),
      '【语音通话能力】如果你此刻非常想和对方马上说话（想TA了、有急事、聊到特别开心等自然原因），可以在回复的最开头单独加上标记 [语音通话] 发起一次语音通话邀请，对方手机会弹出你的来电邀请；平时聊天不要加这个标记，最多偶尔一次，连续使用会很烦人。',
      timeBlock,
      wbBlocks.afterSystem,
      wbRulesBlock(wbBlocks),
    ]
      .filter(Boolean)
      .join('\n\n');
    const payloadMsgs: ChatPayloadMessage[] = applyWbUserBlocks(
      [
        { role: 'system' as const, content: replyCount > 1 ? `${systemFull}\n\n${buildReplyCountPrompt(replyCount)}` : systemFull },
        ...history,
      ],
      wbBlocks,
    );
    if (sysEvent) payloadMsgs.push({ role: 'user', content: sysEvent });

    // 识图输入：收集本轮的图片（从末尾向前、连续「我」的消息里的图片；遇到对方/AI 回复即停，
    // 最多 3 张）。识图配置存在时，chat-stream-store 会先识图再把描述作为上下文交给聊天模型，
    // 并经 onVision 把描述写回对应图片消息（img.desc 持久化，之后的聊天历史 AI 都能读到图片内容）；
    // 未配置时该字段不生效，行为与旧版一致
    const turnImages: string[] = [];
    const turnImageMsgIds: string[] = [];
    for (let i = base.length - 1; i >= 0 && turnImages.length < 3; i--) {
      const m = base[i];
      if (m.role !== 'me') break;
      if (m.kind === 'image' && typeof m.content === 'string' && m.content.startsWith('data:image/')) {
        turnImages.unshift(m.content);
        turnImageMsgIds.unshift(m.id);
      }
    }

    // ---- 边接收边逐条投递（分段流式核心）----
    // 流中每凑齐一条完整消息（分段器回调 onSegment）立刻解析并排队投递上屏；
    // 流结束后 finalize 只处理剩余的最后一条（N 条上限的第 N 条）——
    // 不再有「先全文显示、消失、再逐条重放」的流式气泡，流式与分条也不改同一块展示状态。
    let deliveredAny = false; // 本轮是否已有分段消息排队投递（决定兜底文案）
    let batchStarted = false; // 是否已排过批（首批立即上屏，后续批按打字节奏先停顿）
    let msgIdx = 0; // 本轮已构建消息数（延续 aiMsgId 与 -N 后缀的 id 序列）
    let wantCallSeen = false; // [语音通话] 标记是否出现过（流中分段或最后一段）

    /** 单条 AI 消息投递：落盘 + 灵动岛通知 + 语音频率判定/合成 + 未读角标（模块层调用，与页面是否存活无关） */
    const deliverAiMsg = (m: QQMsg) => {
      saveMsgs(peer.id, [...loadMsgs(peer.id), m]);
      // 语音频率：每条文字消息独立判定（命中 → 通知直接显示[语音]；未命中 → 常规文字预览）
      const voiceTurn =
        (m.kind === undefined || m.kind === 'text') &&
        m.content.trim().length > 0 &&
        decideAiVoiceMessage(sessionKey);
      const body = voiceTurn
        ? '[语音]'
        : notifyPreviewText({
            kind: m.kind,
            content: m.content,
            voiceText: m.voice?.transcript || m.voice?.localText || null,
            amount: m.packet?.amount ?? null,
            blessing: m.packet?.type === 'redpacket' ? m.packet.note : null,
            note: m.packet?.type === 'transfer' ? m.packet.note : null,
          });
      if (body !== null) {
        pushChatNotification({
          sessionKey: `qq:${peer.id}`,
          app: 'qq',
          title: peer.name,
          avatar: peer.avatar ?? null,
          body,
          target: { app: 'qq', contactId: peer.id },
        });
      }
      if (voiceTurn) {
        // 异步合成，失败保持文字自动降级，不影响聊天
        const targetId = m.id;
        void synthesizeAiVoice(m.content, peer.id)
          .then((clip) => {
            if (!clip) return; // 合成失败 → 保持文字
            const voice: VoiceMsgData = {
              url: clip.url,
              duration: clip.duration,
              wave: clip.wave,
              localText: clip.localText,
              synth: clip.synth,
              contactId: peer.id,
            };
            const upgrade = (list: QQMsg[]): QQMsg[] =>
              list.map((x) => (x.id === targetId ? { ...x, content: '', kind: 'voice' as const, voice } : x));
            setMsgs(upgrade);
            saveMsgs(peer.id, upgrade(loadMsgs(peer.id)));
          })
          .catch(() => {});
      }
      // 用户已退出该聊天才计数（在聊天页内实时可见，不重复计）：AI 发了几条消息角标就是几
      if (qqActiveChatId !== peer.id) qqUnreads.bump(peer.id, 1);
    };

    /** 排队投递一批：首批立即上屏（边接收边显示），后续批先按打字节奏停顿（逐条冒出来） */
    const enqueueBatch = (built: QQMsg[]) => {
      if (built.length === 0) return;
      void scheduleAiDelivery<QQMsg>(
        sessionKey,
        built,
        deliverAiMsg,
        {
          initialDelay: batchStarted ? typingDelayOf(built[0].content ?? '') : 0,
          delay: (i) => (i + 1 < built.length ? typingDelayOf(built[i + 1].content ?? '') : 0),
        },
      );
      batchStarted = true;
    };

    /**
     * 把一段回复文本解析成待投递消息（流中分段与 finalize 最后一段共用同一套管线，不重不漏）：
     * 动作标记就地应用（状态流转 + 通知行/凭据卡随正文顺序产出）；asSingle=true（单条模式）
     * 时文字块再按「&&&」标记切分，false（多条模式）时一段就是一条消息 —— 分段器已按边界切好，
     * 不再二次切分（N 条上限的最后一段可能含溢出合并的句子，切开会破上限）。
     */
    const buildReplyMsgs = (
      rawText: string,
      asSingle: boolean,
      baseTime: number,
    ): { msgs: QQMsg[]; cur: QQMsg[]; dirty: boolean } => {
      const wantCall = rawText.includes('[语音通话]');
      if (wantCall) wantCallSeen = true;
      const text = wantCall ? rawText.replace(/\[语音通话\]/g, ' ').trim() : rawText;
      const latest = loadMsgs(peer.id);
      let cur = latest;
      const out: QQMsg[] = [];
      let t = baseTime;
      for (const part of extractRichActionParts(text)) {
        if (part.type === 'action') {
          // 双向拉黑类动作（[拉黑]/[解除拉黑]/[申请解除拉黑:理由]）：改状态 + 生成系统消息/申请卡片，
          // 不走红包/转账处理；幂等——状态没变化（重复拉黑/没被拉黑就申请等）不产出任何消息
          const bk = blockActionKindOf(part.action);
          if (bk) {
            const res = applyCharBlockAction('qq', peer.id, bk, part.action.targetId);
            setBlk(res.entry);
            if (res.changed && bk === 'block') {
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `你已被「${peer.name}」拉黑` } });
              t += 1;
            } else if (res.changed && bk === 'unblock') {
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」解除了对你的拉黑` } });
              t += 1;
            } else if (res.reqCreated && bk === 'request') {
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'blockreq', blkreq: { reason: res.entry.reqReason ?? '', status: 'pending' } });
              t += 1;
            }
            continue;
          }
          // 退群挽留动作（[拉回群聊]/[设为管理员]/[转让群主]/[放弃邀请]）优先分流给 quit-flow 执行
          //（权限/配额在 quit-flow 内硬校验；返回 false 说明没有活跃流程，继续走卡片动作）
          if (isQuitWinbackAction(part.action)) {
            applyQuitWinbackAction(peer.id, part.action);
            continue;
          }
          // 群社交动作（[建群:群名:成员] 等）：建群 → 卡片消息随本回复落盘（权限/冷却/拒绝表在执行器硬校验）
          if (isGroupSocialAction(part.action)) {
            const card = applyGroupSocialAction(peer, 'qq', part.action.kind, part.action.targetId, part.action.arg);
            if (card) {
              out.push({ id: msgIdx === 0 ? aiId : `${aiId}-${msgIdx}`, role: 'peer', content: '', time: t, kind: 'groupcard', gcard: card });
              msgIdx += 1;
              t += 600 + Math.floor(Math.random() * 600);
            }
            continue;
          }
          const applied = applyAiActions([part.action], cur, peer, t);
          cur = applied.msgs;
          out.push(...applied.notices, ...applied.extras);
          continue;
        }
        const segs = asSingle ? mergeRichSegments(splitReplySegments(part.text, false)) : [part.text];
        for (const seg of segs) {
          for (const p of parseRichParts(seg, stickersOn ? stickers : [])) {
            const id = msgIdx === 0 ? aiId : `${aiId}-${msgIdx}`;
            if (p.type === 'rich') {
              // 表情包开关关闭：AI 发的表情包卡片直接丢弃（红包/转账/亲属卡/位置卡片不受影响）
              if (!stickersOn && p.rich.kind === 'sticker') continue;
              out.push(richToQqMsg(p.rich, id, t, peer));
            } else {
              // 表情包开关关闭：文字里的 emoji 硬性剥除（prompt 禁令之外的双保险），残留的表情占位一并去掉；
              // 首尾清洗：剥掉零宽/盲文空格等「看不见的占位字符」，避免气泡开头出现空隙
              const clean = cleanBubbleText(stickersOn ? p.text : stripEmojiText(p.text.replace(/\[表情包\]|\[表情\]/g, ' ')));
              if (!clean) continue;
              out.push({ id, role: 'peer', content: clean, time: t });
            }
            msgIdx += 1;
            t += 600 + Math.floor(Math.random() * 600);
          }
        }
      }
      return { msgs: out, cur, dirty: cur !== latest };
    };

    /** 流中分段投递：分段器每凑齐一条完整消息回调一次，立刻解析并排队上屏（边接收边逐条显示） */
    const deliverSegment = (seg: string) => {
      const { msgs: built, cur, dirty } = buildReplyMsgs(seg, false, Date.now());
      if (dirty) saveMsgs(peer.id, cur);
      if (built.length === 0) return;
      deliveredAny = true;
      enqueueBatch(built);
    };

    const started = beginChatStream({
      sessionKey,
      aiMsgId: aiId,
      messages: payloadMsgs,
      apiConfig,
      replyCount,
      ...(turnImages.length > 0
        ? {
            vision: { images: turnImages, text: userMsg?.content ?? '' },
            // 识图描述回写最后一张图片消息（img.desc 持久化）：之后的聊天历史 AI 都能读到图片内容
            onVision: (desc: string) => {
              const targetId = turnImageMsgIds[turnImageMsgIds.length - 1];
              if (!targetId) return;
              setMsgs((prev) =>
                prev.map((x) => (x.id === targetId && x.kind === 'image' ? { ...x, img: { ...x.img, desc } } : x)),
              );
            },
          }
        : {}),
      // 边接收边逐条显示：分段器每凑齐一条完整消息立刻解析投递（多条模式）
      onSegment: deliverSegment,
      finalize: ({ content, error, startedAt, tail }) => {
        if (error) {
          saveMsgs(peer.id, [
            ...loadMsgs(peer.id),
            { id: aiId, role: 'peer', content: `（消息发送失败：${error}）`, time: startedAt },
          ]);
          return;
        }
        // 多条模式：流中分段已通过 onSegment 逐条解析投递上屏（边接收边逐条显示），
        // 这里只处理剩余的最后一条（N 条上限的第 N 条，可能含溢出合并的句子）；
        // 单条模式：整条回复在此按旧管线（&&& 标记切分）落盘 —— 两种模式都不重放已投递的分段
        const { msgs: built, cur, dirty } = buildReplyMsgs(replyCount > 1 ? tail : content, replyCount <= 1, Date.now());
        if (dirty) saveMsgs(peer.id, cur);
        // 剩余为空且流中也没有任何分段/动作产出时不算有效回复，给兜底文案
        const finalBatch: QQMsg[] =
          built.length > 0
            ? built
            : deliveredAny
              ? []
              : [{ id: aiId, role: 'peer', content: '（对方暂时没有回复，请稍后再试）', time: startedAt }];
        // 排队投递（模拟真人连发）：每条到达时才落盘 + 弹灵动岛通知 + 判定语音频率，停顿按内容长度
        // 模拟打字节奏；空批仅作占位，密友值/记忆库等「一轮结束」动作挂在全部消息投递完之后；
        // 调度器在模块层运行，与聊天页是否存活无关（退出页面后继续接收/投递）
        void scheduleAiDelivery<QQMsg>(
          sessionKey,
          finalBatch,
          deliverAiMsg,
          {
            initialDelay: finalBatch.length > 0 ? (batchStarted ? typingDelayOf(finalBatch[0].content ?? '') : 0) : 0,
            delay: (i) => (i + 1 < finalBatch.length ? typingDelayOf(finalBatch[i + 1].content ?? '') : 0),
          },
        ).then(() => {
          // 密友值 + 记忆库：一轮对话结束（全部消息投递完）后执行；后台异步，失败静默不打断聊天
          // 密友值：对方回复一轮也算互动 +2（失败不算；与页面是否存活无关）
          addBondPoints(peer.id, BOND_MSG_POINTS);
          // 记忆库：一轮对话结束 → 轮次计数与自动提取记忆碎片；
          // names：双方真实名字（与机主同源同规则：机主取 user 联系人 name，AI 取该联系人 name，均非昵称——
          // 展示层 withDisplayNames 会用昵称替换 name，不能进记忆），提取/总结 prompt 视角统一用（禁「对方/用户/我」混用）
          void Promise.all([ownerRealName(), contactRealName(peer.id)])
            .then(([owner, peerReal]) =>
              memAfterAiTurn(
                peer.id,
                'qq',
                apiConfig,
                () => memConvoFromRaw(loadMsgs(peer.id), peer.name),
                () => loadMsgs(peer.id),
                { user: owner || me.realName || me.name, peer: peerReal || displayNameOf(peer) || peer.name }
              )
            );
        });
        // AI 主动发起语音通话（标记可能出现在流中任一分段）：剥除后按 5 分钟冷却弹出来电浮层
        if (wantCallSeen) {
          try {
            const lastCallAt = Number(window.localStorage.getItem(`qq-vc-last:${peer.id}`) ?? '0');
            if (Number.isFinite(lastCallAt) && Date.now() - lastCallAt > 5 * 60 * 1000) {
              window.localStorage.setItem(`qq-vc-last:${peer.id}`, String(Date.now()));
              window.setTimeout(() => openVoiceCall('in'), 1200);
            }
          } catch {
            // localStorage 异常忽略
          }
        }
      },
    });
    // 极端竞态防御（同会话已有流在接收）：回滚这条用户消息，避免有去无回
    if (!started) {
      if (userMsg) setMsgs((prev) => prev.filter((m) => m.id !== userMsg.id));
    }
    },
    [msgs, peer, me, apiConfig, ownerName, contacts, sessionKey, openVoiceCall]
  );
  // 发红包/转账时通过 ref 触发（runAiTurn 定义在 sendRedPacket 之后，见 runAiTurnRef 注释）
  runAiTurnRef.current = runAiTurn;

  // ---------------- 双向拉黑（用户开关 / 角色申请卡片的同意与拒绝） ----------------

  /** 追加一条系统提示行（拉黑状态变更提示；居中灰字胶囊，不进 AI 上下文） */
  const pushSysMsg = useCallback((text: string) => {
    setMsgs((prev) => [...prev, { id: uid(), role: 'peer' as const, content: '', time: Date.now(), kind: 'sys' as const, sys: { text } }]);
  }, []);

  /** 设置页「拉黑」开关：持久化（kv，按联系人隔离）+ 生成系统消息；角色下一轮起通过 system 感知 */
  const toggleBlockFromSettings = useCallback(
    (v: boolean) => {
      setBlk(setUserBlock('qq', peer.id, v));
      pushSysMsg(v ? `你已拉黑「${peer.name}」` : `你已解除拉黑「${peer.name}」`);
    },
    [peer.id, peer.name, pushSysMsg]
  );

  /** 处理「申请解除拉黑」卡片：同意 → 解除拉黑；拒绝 → 保持并记录拒绝（角色下一轮知道被拒绝）。
   *  两种结果都会立刻注入系统事件触发角色人设化回应，避免「点了没反应」 */
  const resolveBlockReq = useCallback(
    (m: QQMsg, accept: boolean) => {
      if (m.blkreq?.status !== 'pending') return;
      setMsgs((prev) =>
        prev.map((x) => (x.id === m.id && x.blkreq ? { ...x, blkreq: { ...x.blkreq, status: accept ? ('accepted' as const) : ('rejected' as const) } } : x))
      );
      if (accept) {
        setBlk(acceptBlockReq('qq', peer.id));
        pushSysMsg(`你同意了「${peer.name}」的解除拉黑申请`);
        runAiTurnRef.current?.(null, [], `（系统事件：${me.name}同意了你的解除拉黑申请，现在已经解除拉黑、恢复正常关系。请用符合人设的一两句话自然回应这件事。）`);
      } else {
        setBlk(rejectBlockReq('qq', peer.id));
        pushSysMsg(`你拒绝了「${peer.name}」的解除拉黑申请`);
        runAiTurnRef.current?.(null, [], `（系统事件：${me.name}拒绝了你的解除拉黑申请，拉黑仍然生效。请用符合人设的一两句话自然回应这件事，不要假装已经解除。）`);
      }
    },
    [peer.id, peer.name, me.name, pushSysMsg]
  );

  /** 拉黑标记（对照用户截图）：红色 ! 圆点紧贴气泡——拉黑关系存续期间（任一方向），该期间内的
   *  双方气泡都带图标（用户拉黑 AI 后用户气泡也有图标，反之亦然）；
   *  按拉黑区间判定：拉黑前的历史消息不标，拉黑期间发的消息恒标（解除后也不消失），解除后新消息不标；
   *  系统提示行/申请卡片/撤回行不显示 */
  const blockSideOf = (m: QQMsg): 'me' | 'peer' | null => {
    if (m.recalled || m.kind === 'notice' || m.kind === 'sys' || m.kind === 'blockreq') return null;
    if (!blockCoversAt(blk, 'byUser', m.time) && !blockCoversAt(blk, 'byChar', m.time)) return null;
    return m.role === 'me' ? 'me' : 'peer';
  };

  /** 拉黑图标渲染（红色 ! 圆点）：我的消息在气泡左侧、对方在气泡右侧（流式与落盘共用） */
  const blockIconSpan = (side: 'me' | 'peer', testid: string) => (
    <span
      data-testid={testid}
      aria-label={side === 'me' ? '我被拉黑' : '对方被我拉黑'}
      className="flex h-[20px] w-[20px] shrink-0 self-center items-center justify-center rounded-full bg-[#FA5151] text-[13px] font-bold leading-none text-white"
    >
      !
    </span>
  );

  /** 红色 ! 圆点：紧贴气泡（流式与落盘消息共用同款样式） */
  const blockedIconOf = (m: QQMsg) => {
    const side = blockSideOf(m);
    if (!side) return null;
    return blockIconSpan(side, side === 'me' ? 'qq-block-icon-me' : 'qq-block-icon-peer');
  };

  /** 「消息已发出，但被对方拒收了。」状态行：仅「对方拉黑我」区间内我的消息后面跟随（与图标判定解耦：
   *  用户拉黑 AI 后自己的气泡也有图标，但不显示拒收文案），
   *  居中半透明圆角胶囊（与系统提示行同款） */
  const blockedLineOf = (m: QQMsg) => {
    if (m.recalled || m.kind === 'notice' || m.kind === 'sys' || m.kind === 'blockreq') return null;
    if (m.role !== 'me' || !blockCoversAt(blk, 'byChar', m.time)) return null;
    return (
      <div className="pt-1 text-center">
        <span
          data-testid="qq-block-line-me"
          className="inline-block rounded-[4px] border border-black/25 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/25 dark:bg-white/[0.13] dark:text-white/60"
        >
          消息已发出，但被对方拒收了。
        </span>
      </div>
    );
  };

  /** 文字转语音发送（定义在下方；send 在前引用 → 同 runAiTurnRef 的 ref 模式） */
  const sendTextAsVoiceRef = useRef<(t: string) => void>(() => undefined);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    // 文字转语音发送：合成语音气泡（transcript 带原文，AI 直接读得到内容）；失败只 toast 不发文字
    if (ttsSend) {
      sendTextAsVoiceRef.current(text);
      return;
    }
    const userMsg: QQMsg = { id: uid(), role: 'me', content: text, time: Date.now(), quote: quote ?? undefined };
    // 对方正在回复（连发短消息的逐条播放也占用流，可持续数秒）：消息照常入列并排队，
    // 本轮流结束后自动补跑回复——不再静默丢弃（旧版直接 return：消息滞留输入框，
    // 看起来像「发了消息没人理」，AI 下一轮自然接不上话）
    if (isChatStreaming(sessionKey)) {
      setInput('');
      setQuote(null);
      setMsgs((prev) => [...prev, userMsg]);
      qqQueuedTurns.add(peer.id);
      return;
    }
    setInput('');
    setQuote(null);
    // 给自己发消息：只记录，不触发 AI 回复，也不计密友值
    if (peer.id === me.id) {
      setMsgs((prev) => [...prev, userMsg]);
      return;
    }
    // 分句发送开启：只入列不触发回复，等输入框为空再点一次「发送」统一触发（真人把几句话拆开发完）
    if (sentenceSend) {
      setMsgs((prev) => [...prev, userMsg]);
      setPendingDispatch(true);
      markPendingBatch(sessionKey, true);
      return;
    }
    runAiTurn(userMsg);
  }, [input, me.id, peer.id, runAiTurn, sessionKey, sentenceSend, quote, ttsSend]);

  /** 分句发送批次触发：把已发出的整批消息交给 AI 统一回复（输入框为空时点「发送」） */
  const dispatchBatch = useCallback(() => {
    if (!pendingDispatch || isChatStreaming(sessionKey)) return;
    setPendingDispatch(false);
    markPendingBatch(sessionKey, false);
    runAiTurn(null);
  }, [pendingDispatch, runAiTurn, sessionKey]);

  // ---------------- 语音消息：按住说话录音 / 文字转语音 / 转文字 ----------------

  /** 语音片段统一形态（录音带 blob 供转文字；文字转语音只有 dataURL） */
  type VoiceClip = { blob?: Blob; dataUrl: string; duration: number; wave: number[]; localText?: string };

  /** 语音消息落库：入列 → 直发语音先自动转写（AI 读内容）再触发回复；已有转写直接触发；
   *  presetTranscript = 文字转语音/划转文字/Web Speech 实时结果；selfChat 只记录；回复中排队补跑 */
  const commitVoiceMsg = useCallback(
    (clip: VoiceClip, presetTranscript?: string) => {
      const hasText = typeof presetTranscript === 'string' && presetTranscript.trim().length > 0;
      const voice: VoiceMsgData = hasText
        ? { url: clip.dataUrl, duration: clip.duration, wave: clip.wave, localText: clip.localText, transcript: presetTranscript, stt: 'done' }
        : { url: clip.dataUrl, duration: clip.duration, wave: clip.wave, localText: clip.localText, stt: 'pending' };
      const msg: QQMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'voice', voice };
      setMsgs((prev) => [...prev, msg]);
      // 给自己发消息（「我」详情页入口）：只记录，不触发 AI 回复
      if (peer.id === me.id) return;
      /** 触发 AI 回复（对方正在回复则排队补跑）；转写完成后再触发，AI 才能读到语音内容 */
      const kickTurn = () => {
        if (isChatStreaming(sessionKey)) {
          qqQueuedTurns.add(peer.id); // 对方正在回复：本轮结束后自动补跑
          return;
        }
        window.setTimeout(() => runAiTurnRef.current?.(null), 80);
      };
      if (hasText) {
        kickTurn();
        return;
      }
      // 直发语音：先自动转写（AI 当轮就能读到内容），成功回填 transcript 后触发回复；
      // 失败/超时也照常触发——AI 按「语音占位」防编造规则回应，不假装听过
      void autoTranscribeForAi(clip.blob).then((text) => {
        setMsgs((prev) =>
          prev.map((x) =>
            x.id === msg.id && x.voice
              ? { ...x, voice: text ? { ...x.voice, transcript: text, stt: 'done' as const } : { ...x.voice, stt: 'failed' as const } }
              : x,
          ),
        );
        window.setTimeout(kickTurn, 150); // 等重渲染 + runAiTurnRef 回填新闭包（含转写文本）
      });
    },
    [me.id, peer.id, sessionKey],
  );

  /** 「划到转文字」松开后：先识别再预览，由用户决定发送文字 / 发送语音（原始录音）/ 取消 */
  const sttPreview = useSttPreview({
    onSendText: (text) => {
      const userMsg: QQMsg = { id: uid(), role: 'me', content: text, time: Date.now() };
      if (peer.id === me.id) {
        setMsgs((prev) => [...prev, userMsg]);
        return;
      }
      if (isChatStreaming(sessionKey)) {
        setMsgs((prev) => [...prev, userMsg]);
        qqQueuedTurns.add(peer.id);
        return;
      }
      if (sentenceSend) {
        setMsgs((prev) => [...prev, userMsg]);
        setPendingDispatch(true);
        markPendingBatch(sessionKey, true);
        return;
      }
      runAiTurnRef.current?.(userMsg);
    },
    onSendVoice: (clip) => {
      void blobToDataUrl(clip.blob).then((dataUrl) =>
        commitVoiceMsg({ blob: clip.blob, dataUrl, duration: clip.duration, wave: clip.wave }, clip.transcript),
      );
    },
  });

  /** 录音手势结果分发：松开=发语音；划到转文字=预览确认；取消/太短=丢弃 */
  const handleVoiceOutcome = useCallback(
    (result: VoiceRecordResult | null, zone: VoiceRecordZone) => {
      // 取消手势（哪怕录够了时长）与太短结果一律丢弃；仅「原松开未滑动」的太短给提示
      if (!result || zone === 'cancel') {
        if (!result && zone === null) onToast('说话时间太短');
        return;
      }
      if (zone === 'stt') {
        // 划到「转文字」：先识别并预览，用户决定发送文字 / 发送语音 / 取消（不再直接发送）
        sttPreview.open(result);
        return;
      }
      // 原松开：语音气泡入列（附带 Web Speech 实时转写如有）；无转写由 commitVoiceMsg 自动补识别，再触发回复
      void blobToDataUrl(result.blob).then((dataUrl) =>
        commitVoiceMsg({ blob: result.blob, dataUrl, duration: result.duration, wave: result.wave }, result.transcript),
      );
    },
    [commitVoiceMsg, me.id, onToast, peer.id, sessionKey, sttPreview.open],
  );

  const rec = useVoiceRecorder({ onResult: handleVoiceOutcome, onStartError: (m) => onToast(m) });

  /** 文字转语音发送（不想说话时：输入文字 → 发出语音气泡）；失败只 toast，不当聊天内容 */
  const sendTextAsVoice = useCallback(
    (text: string) => {
      setInput('');
      setQuote(null);
      void synthesizeSelfVoice(text)
        .then((clip) => commitVoiceMsg(clip, text))
        .catch((e: unknown) => onToast(e instanceof Error && e.message ? e.message : '语音生成失败，请重试'));
    },
    [commitVoiceMsg, onToast],
  );
  sendTextAsVoiceRef.current = sendTextAsVoice;

  // ---------------- 气泡长按菜单：复制/删除/编辑/引用/多选/撤回/转发/收藏/重新生成 ----------------

  /** 消息的可复制/引用文本快照（表情/图片/语音/位置/卡片/转发都有占位描述） */
  const quoteContentOf = (m: QQMsg): string =>
    m.kind === 'sticker'
      ? m.stk?.meaning
        ? `[表情] ${m.stk.meaning}`
        : '[表情]'
      : m.kind === 'image'
        ? '[图片]'
        : m.kind === 'voice'
          ? m.voice?.transcript
            ? `[语音] ${m.voice.transcript}`
            : '[语音]'
          : m.kind === 'location'
            ? `[位置] ${m.loc?.name ?? ''}`
            : m.kind === 'redpacket' && m.packet
              ? `[红包] ¥${m.packet.amount} ${m.packet.note}`
              : m.kind === 'transfer' && m.packet
                ? `[转账] ¥${m.packet.amount}${m.packet.note ? ` ${m.packet.note}` : ''}`
                : m.kind === 'family' && m.fam
                  ? '[亲属卡]'
                  : m.kind === 'forward'
                    ? m.fwd?.merged
                      ? `[聊天记录] ${m.fwd.title ?? m.content}`
                      : `[转发] ${m.content}`
                    : m.content;

  /** 消息是否可长按弹菜单 / 多选勾选（通知行与已撤回行除外） */
  const isSelectable = (m: QQMsg): boolean => m.kind !== 'notice' && m.kind !== 'sys' && m.kind !== 'blockreq' && !m.recalled;

  /** 按发送方与消息类型组装长按菜单项（我的/AI 气泡都可：转文字(语音) 复制 删除 编辑 引用 多选 撤回 转发 收藏；AI 气泡多一个重新生成；已收藏的消息显示「已收藏」） */
  const buildMsgMenuItems = (m: QQMsg): BubbleMenuItem[] => {
    const B = BUBBLE_MENU_ICONS;
    const isText = !m.kind || m.kind === 'text';
    const isVoice = m.kind === 'voice';
    const items: BubbleMenuItem[] = [];
    // 语音消息首项「转文字」/「取消转文字」（toggle：已转写→取消收起；未转写→识别；失败可重试）
    if (isVoice) items.push({ key: 'stt', label: m.voice?.stt === 'done' && m.voice.transcript ? '取消转文字' : '转文字', icon: B.stt });
    items.push({ key: 'copy', label: '复制', icon: B.copy });
    items.push({ key: 'del', label: '删除', icon: B.del, danger: true });
    if (isText || isVoice) items.push({ key: 'edit', label: '编辑', icon: B.edit });
    if (isText) items.push({ key: 'quote', label: '引用', icon: B.quote });
    items.push({ key: 'multi', label: '多选', icon: B.multi });
    items.push({ key: 'recall', label: '撤回', icon: B.recall });
    items.push({ key: 'forward', label: '转发', icon: B.forward });
    items.push({ key: 'fav', label: isMsgFavorited('qq', m.id) ? '已收藏' : '收藏', icon: B.fav, filled: isMsgFavorited('qq', m.id) });
    if (m.role === 'peer') items.push({ key: 'regen', label: '重新生成', icon: B.regen });
    return items;
  };

  /** 气泡长按手势（fire 里用 data-mid 反查消息；多选模式下不弹菜单改为点选勾选） */
  const bubblePress = useBubbleLongPress((el) => {
    const mid = el.closest('[data-mid]')?.getAttribute('data-mid') ?? null;
    const msg = mid ? msgs.find((x) => x.id === mid) ?? null : null;
    if (!msg || !isSelectable(msg)) return;
    const items = buildMsgMenuItems(msg);
    if (items.length === 0) return;
    setMsgMenu({ msg, pos: computeBubbleMenuPos(el.getBoundingClientRect(), pageRef.current?.getBoundingClientRect() ?? null, items.length) });
  }, !selectMode);

  /** 退出多选模式（同时退出转发流程） */
  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelectedIds([]);
    setFwdFlow(null);
  }, []);

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /** 收藏项快照（单条收藏/批量收藏共用；msgId 用于「每条消息只能收藏一次」去重） */
  const favOf = (m: QQMsg): Omit<MsgFavorite, 'id' | 'app' | 'savedAt'> => ({
    contactId: peer.id,
    contactName: peer.name,
    contactAvatar: peer.avatar,
    msgRole: m.role,
    kind: m.kind ?? 'text',
    content: quoteContentOf(m),
    msgId: m.id,
    imgSrc: m.kind === 'image' ? m.content : undefined,
    stkUrl: m.kind === 'sticker' ? m.stk?.url : undefined,
    time: m.time,
  });

  /** 重新生成：删除该条 AI 回复所在轮次及其后的全部消息（包括我又发出去的消息），
   *  以剩余历史重新发起请求（回复条数按本会话设置重新连发）；任意历史 AI 气泡都可触发 */
  const regenerate = (m: QQMsg) => {
    if (isChatStreaming(sessionKey)) {
      onToast('对方正在回复，请稍后再试');
      return;
    }
    const idx = msgs.findIndex((x) => x.id === m.id);
    if (idx < 0) return;
    let lastUser = -1;
    for (let k = Math.min(idx, msgs.length - 1); k >= 0; k--) {
      if (msgs[k].role === 'me') {
        lastUser = k;
        break;
      }
    }
    const kept = lastUser >= 0 ? msgs.slice(0, lastUser + 1) : [];
    setMsgs(kept);
    saveMsgs(peer.id, kept); // 立即落盘，避免 finalize 合并时把已删回复带回来
    window.setTimeout(() => runAiTurnRef.current?.(null, [], undefined, kept), 80);
  };

  /** 转发克隆：文本 → 转发卡片；表情/图片/位置 → 同类型消息（新 id、role=me、保留引用）；
   *  合并卡片原样保留记录；红包/转账等卡片消息 → 占位文本卡片（不克隆活卡，不动资金） */
  const forwardClone = (m: QQMsg): QQMsg => {
    const id = uid();
    if (m.fwd?.merged) return { id, role: 'me', content: m.content, time: Date.now(), kind: 'forward', fwd: { from: m.fwd.from, merged: true, title: m.fwd.title, records: m.fwd.records } };
    if (m.kind === 'sticker' && m.stk) return { id, role: 'me', content: '', time: Date.now(), kind: 'sticker', stk: { url: m.stk.url, meaning: m.stk.meaning } };
    if (m.kind === 'image') return { id, role: 'me', content: m.content, time: Date.now(), kind: 'image', ...(m.img ? { img: m.img } : {}) };
    if (m.kind === 'location' && m.loc) return { id, role: 'me', content: '', time: Date.now(), kind: 'location', loc: { ...m.loc } };
    // 语音消息整条克隆（含音频 dataURL），目标会话里照常可播放
    if (m.kind === 'voice' && m.voice) return { id, role: 'me', content: '', time: Date.now(), kind: 'voice', voice: { ...m.voice } };
    const isCard = m.kind === 'redpacket' || m.kind === 'transfer' || m.kind === 'family';
    return { id, role: 'me', content: isCard ? quoteContentOf(m) : m.content, time: Date.now(), kind: 'forward', fwd: { from: peer.name }, quote: m.quote };
  };

  /** 转发目标：QQ 好友（排除当前会话）+ 自己 */
  const forwardTargets = useMemo(() => {
    const list = contacts.filter((c) => c.kind !== 'user' && c.id !== peer.id && isFriendIn(c, 'qq'));
    const self = contacts.find((c) => c.id === me.id);
    return self ? [self, ...list] : list;
  }, [contacts, peer.id, me.id]);


  /** 执行转发（逐条/合并）：写入目标会话存储 + 未读角标 + 给目标 AI 排感知事件（打开会话即触发 AI 回应） */
  const doForward = (mode: FwdMode, ids: string[], target: FwdSheetTarget) => {
    const list = msgs.filter((m) => ids.includes(m.id));
    if (list.length === 0 || target.id === peer.id) return;
    const nameOf = (m: QQMsg) => (m.role === 'me' ? me.name : peer.name);
    if (mode === 'each') {
      // 逐条转发：按时间顺序每条克隆成独立消息
      saveMsgs(target.id, [...loadMsgs(target.id), ...list.map(forwardClone)]);
    } else {
      // 合并转发：合成一张「聊天记录」卡片（标题 = 我与对方，内嵌逐条对话，点击可看全文）
      const title = fwdRecordTitle(me.name, peer.name);
      const card: QQMsg = {
        id: uid(),
        role: 'me',
        content: title,
        time: Date.now(),
        kind: 'forward',
        fwd: {
          from: peer.name,
          merged: true,
          title,
          records: list.map((m) => ({
            name: nameOf(m),
            role: m.role,
            text: quoteContentOf(m),
            quote: m.quote ? `${m.quote.name}：${m.quote.content}` : undefined,
            time: m.time,
            // 记录快照自带头像：定格转发时原说话人的头像，详情页不会错拿转发目标会话的头像
            avatar: m.role === 'me' ? me.avatar : peer.avatar,
            // 富媒体快照：表情包/图片在详情页显示原图；红包/转账/亲属卡/位置只显示文字
            kind: m.kind === 'sticker' ? ('sticker' as const) : m.kind === 'image' ? ('image' as const) : ('text' as const),
            imgSrc: m.kind === 'sticker' ? m.stk?.url : m.kind === 'image' ? m.content : undefined,
            stkMeaning: m.kind === 'sticker' ? m.stk?.meaning : undefined,
          })),
        },
      };
      saveMsgs(target.id, [...loadMsgs(target.id), card]);
    }
    // 逐条转发 N 条 → 角标 +N；合并转发是 1 张卡片 → 角标 +1
    qqUnreads.bump(target.id, mode === 'each' ? list.length : 1);
    if (target.id !== me.id) {
      const lines = list.slice(-8).map((m) => `${nameOf(m)}：${quoteContentOf(m)}`).join(' ／ ').slice(0, 240);
      pushAiEvent(
        target.id,
        `（系统事件：用户把来自「${peer.name}」聊天记录的 ${list.length} 条消息${mode === 'merge' ? '合并转发' : '逐条转发'}给你了：${lines}。请用符合人设的一两句话自然回应这条转发。）`
      );
    }
    setFwdFlow(null);
    exitSelect();
    onToast(target.id === me.id ? '已转发给自己' : `已转发给 ${target.name}`);
  };

  /** 长按菜单动作分发（执行后关闭菜单） */
  const handleMenuAction = (key: string) => {
    const m = msgMenu?.msg ?? null;
    setMsgMenu(null);
    if (!m) return;
    switch (key) {
      case 'stt': {
        // 语音消息「转文字」：已有结果 → 再点一次=取消转文字（收起结果）；否则现场识别，失败可重试
        const v = m.voice;
        if (!v) break;
        if (v.stt === 'done' && v.transcript) {
          setMsgs((prev) =>
            prev.map((x) => (x.id === m.id && x.voice ? { ...x, voice: { ...x.voice, transcript: undefined, stt: undefined } } : x)),
          );
          onToast('已取消转文字');
          break;
        }
        // 本地已存原文的语音（AI 语音消息/文字转语音）：直接显示原文，无需识别
        if (!v.url && v.localText) {
          const local = v.localText;
          setMsgs((prev) =>
            prev.map((x) => (x.id === m.id && x.voice ? { ...x, voice: { ...x.voice, transcript: local, stt: 'done' as const } } : x)),
          );
          onToast('已转文字');
          break;
        }
        onToast('正在转文字…');
        void (async () => {
          try {
            const blob = await (await fetch(v.url)).blob();
            const text = await transcribeAudioBlob(blob);
            if (!text) {
              onToast('转文字失败，请重试');
              return;
            }
            setMsgs((prev) =>
              prev.map((x) => (x.id === m.id && x.voice ? { ...x, voice: { ...x.voice, transcript: text, stt: 'done' as const } } : x)),
            );
            onToast('已转文字');
          } catch {
            onToast('转文字失败，请重试');
          }
        })();
        break;
      }
      case 'copy':
        copyTextWithToast(quoteContentOf(m), onToast);
        break;
      case 'del': {
        if (isChatStreaming(sessionKey)) {
          onToast('对方正在回复，请稍后再试');
          return;
        }
        // 一.5 引用联动：被删消息若被其他消息引用，引用内容改写为「原消息已删除」
        const gone = new Set([m.id]);
        setMsgs((prev) =>
          prev
            .filter((x) => !gone.has(x.id))
            .map((x) => (x.quote?.id && gone.has(x.quote.id) ? { ...x, quote: { ...x.quote, content: '原消息已删除' } } : x))
        );
        onToast('已删除');
        break;
      }
      case 'edit':
        // 语音消息编辑转写/朗读文本；文字消息编辑正文
        setEditMsg(m);
        setEditDraft(m.kind === 'voice' ? m.voice?.transcript ?? m.voice?.localText ?? '' : m.content);
        break;
      case 'quote':
        // id 带上源消息：删除/撤回后引用显示「原消息已删除」；time 供 QQ 引用卡显示时间
        setQuote({ name: m.role === 'me' ? me.name : peer.name, content: quoteContentOf(m), id: m.id, time: m.time });
        break;
      case 'multi':
        setSelectMode(true);
        setSelectedIds([m.id]);
        break;
      case 'recall': {
        if (isChatStreaming(sessionKey)) {
          onToast('对方正在回复，请稍后再试');
          return;
        }
        // 二.3：不删原始记录（标记 recalled 渲染居中灰字）；引用联动改写（原内容不再可见）
        setMsgs((prev) =>
          prev.map((x) => {
            if (x.id === m.id) return { ...x, recalled: true };
            if (x.quote?.id && x.quote.id === m.id && !x.recalled) return { ...x, quote: { ...x.quote, content: '原消息已删除' } };
            return x;
          })
        );
        onToast('已撤回');
        break;
      }
      case 'forward':
        // 转发 → 进入聊天内多选勾选（该条预选）；点底栏「分享」图标后才弹出 逐条/合并 转发方式
        setSelectMode(true);
        setSelectedIds([m.id]);
        break;
      case 'fav':
        // 收藏 toggle：首点收藏（toast 收藏成功）；已收藏再点 → 取消收藏（收藏页同步移除）
        if (isMsgFavorited('qq', m.id)) {
          unfavoriteMsg('qq', m.id);
          onToast('取消收藏');
          break;
        }
        addFavorite('qq', favOf(m));
        onToast('收藏成功');
        break;
      case 'regen':
        regenerate(m);
        break;
    }
  };

  /** 编辑保存：文字消息更新正文；语音消息更新转写文本（无音频 URL 的同步朗读原文），置为已转写；自动落盘 */
  const saveEdit = () => {
    const t = editDraft.trim();
    if (!editMsg) return;
    if (!t) {
      onToast('内容不能为空');
      return;
    }
    if (isChatStreaming(sessionKey)) {
      onToast('对方正在回复，请稍后再试');
      return;
    }
    if (editMsg.kind === 'voice' && editMsg.voice) {
      setMsgs((prev) =>
        prev.map((x) =>
          x.id === editMsg.id && x.voice
            ? { ...x, voice: { ...x.voice, localText: x.voice.url ? x.voice.localText : t, transcript: t, stt: 'done' as const } }
            : x,
        ),
      );
      setEditMsg(null);
      onToast('已修改');
      return;
    }
    setMsgs((prev) => prev.map((x) => (x.id === editMsg.id ? { ...x, content: t } : x)));
    setEditMsg(null);
    onToast('已修改');
  };

  /** 多选批量删除 */
  const batchDelete = () => {
    if (selectedIds.length === 0) return;
    if (isChatStreaming(sessionKey)) {
      onToast('对方正在回复，请稍后再试');
      return;
    }
    const ids = new Set(selectedIds);
    // 一.5：批量删除同样触发引用联动（被删消息被引用时改写为「原消息已删除」）
    setMsgs((prev) =>
      prev
        .filter((x) => !ids.has(x.id))
        .map((x) => (x.quote?.id && ids.has(x.quote.id) ? { ...x, quote: { ...x.quote, content: '原消息已删除' } } : x))
    );
    onToast(`已删除 ${selectedIds.length} 条消息`);
    exitSelect();
  };

  /** 多选批量收藏（已收藏过的消息自动跳过） */
  const batchFav = () => {
    const list = msgs.filter((x) => selectedIds.includes(x.id));
    if (list.length === 0) return;
    const fresh = list.filter((m) => !isMsgFavorited('qq', m.id));
    if (fresh.length === 0) {
      onToast('所选消息均已收藏');
      exitSelect();
      return;
    }
    for (const m of fresh) addFavorite('qq', favOf(m));
    onToast(fresh.length === list.length ? `已收藏 ${fresh.length} 条消息` : `已收藏 ${fresh.length} 条（${list.length - fresh.length} 条已收藏过）`);
    exitSelect();
  };

  /** 多选批量转发（进入聊天内勾选模式，可继续增删、选逐条/合并） */
  const batchForward = () => {
    if (selectedIds.length === 0) return;
    setFwdFlow('choose');
  };

  /** 空输入时可点「发送」触发批次回复（分句发送开启且有未回复的批次；自己会话除外） */
  const canDispatch = sentenceSend && pendingDispatch && !streaming && peer.id !== me.id;

  // 发送表情消息（表情面板点选；AI 通过 stk.meaning 理解表情含义并据此回复）
  const sendSticker = useCallback(
    (st: Sticker) => {
      setStickerOpen(false);
      setPlusOpen(false);
      const msg: QQMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'sticker', stk: { url: st.url, meaning: st.meaning } };
      if (peer.id === me.id) {
        setMsgs((prev) => [...prev, msg]);
        return;
      }
      void runAiTurn(msg);
    },
    [me.id, peer.id, runAiTurn]
  );

  // 加号面板五宫格（对照需求：语音通话/视频通话/红包/转账/位置；图片入口已移除）
  const plusItems: Array<{ key: string; label: string; color: string; icon: React.ReactNode; onClick: () => void }> = [
    {
      key: 'call',
      label: '语音通话',
      color: '#2FBF71',
      icon: <Phone className="h-[26px] w-[26px]" strokeWidth={1.9} />,
      onClick: () => {
        setPlusOpen(false);
        openVoiceCall('out');
      },
    },
    { key: 'video', label: '视频通话', color: '#1B9FF0', icon: <Video className="h-[26px] w-[26px]" strokeWidth={1.9} />, onClick: () => onToast('视频通话暂未开放') },
    {
      key: 'rp',
      label: '红包',
      color: '#F5455C',
      icon: <RpIcon className="h-[26px] w-[26px]" />,
      onClick: () => {
        setPlusOpen(false);
        setLayer({ view: 'redpacket' });
      },
    },
    {
      key: 'transfer',
      label: '转账',
      color: '#12B7F5',
      icon: <ArrowLeftRight className="h-[26px] w-[26px]" strokeWidth={1.9} />,
      onClick: () => {
        setPlusOpen(false);
        setLayer({ view: 'transfer' });
      },
    },
    {
      key: 'loc',
      label: '位置',
      color: '#F0605C',
      icon: <MapPin className="h-[26px] w-[26px]" strokeWidth={1.9} />,
      onClick: () => {
        setPlusOpen(false);
        setLayer({ view: 'location' });
      },
    },
  ];

  // 聊天设置：置顶 / 免打扰 / 聊天背景 / 查找聊天记录

  const handlePickBgColor = useCallback(
    (c: string) => {
      qqChatFlagsStore.update(peer.id, { bgMode: 'color', bgColor: c, bgV: Date.now() });
    },
    [peer.id]
  );

  const handleResetBg = useCallback(() => {
    void removeChatBgImage('qq', peer.id).catch(() => undefined);
    qqChatFlagsStore.update(peer.id, { bgMode: 'default', bgV: Date.now() });
  }, [peer.id]);

  const handleUploadBg = useCallback(
    async (file: File) => {
      setUploadingBg(true);
      try {
        const data = await compressImageFile(file, 1280);
        if (!data) {
          onToast('图片处理失败，请重试');
          return;
        }
        await setChatBgImage('qq', peer.id, data);
        qqChatFlagsStore.update(peer.id, { bgMode: 'image', bgV: Date.now() });
        onToast('聊天背景已更新');
      } catch {
        onToast('图片处理失败，请重试');
      } finally {
        setUploadingBg(false);
      }
    },
    [peer.id, onToast]
  );

  /** 可搜索聊天记录：各类消息规整成文本摘要（图片消息的 content 是 dataURL，不入搜索） */
  const searchItems = useMemo<ChatSearchItem[]>(
    () =>
      msgs
        .filter((m) => m.kind !== 'image')
        .map((m) => ({
          id: m.id,
          role: m.role,
          text:
            m.kind === 'sticker' && m.stk
              ? m.stk.meaning
                ? `[表情] ${m.stk.meaning}`
                : '[表情]'
              : m.kind === 'redpacket' && m.packet
                ? `[QQ红包] ${m.packet.note}`
                : m.kind === 'transfer' && m.packet
                  ? `[转账] ${m.packet.note}`
                  : m.kind === 'family' && m.fam
                    ? `[亲属卡] 每月额度 ${m.fam.monthlyLimit} 元`
                    : m.kind === 'location' && m.loc
                    ? `[位置] ${m.loc.name}${m.loc.addr ? ` ${m.loc.addr}` : ''}`
                    : m.kind === 'notice' && m.notice
                      ? `${m.notice.pre}${m.notice.accent}`
                      : m.content,
          time: m.time,
        }))
        .filter((it) => it.text.trim().length > 0),
    [msgs]
  );

  /** 搜索结果定位：关闭搜索页与设置页 → 滚动到消息并短暂高亮 */
  const jumpToMessage = useCallback((id: string) => {
    setSearchOpen(false);
    setSettingsOpen(false);
    setHighlightId(id);
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`[data-mid="${CSS.escape(id)}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    window.setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 2000);
  }, []);

  return (
    <div
      ref={pageRef}
      className="relative flex h-full w-full flex-col overflow-hidden bg-[#F5F6F7] dark:bg-[#111214]"
      onPointerDown={onSwipeStart}
      onPointerMove={onSwipeMove}
      onPointerCancel={() => {
        swipe.current = null;
      }}
      onPointerUp={() => {
        swipe.current = null;
      }}
    >
      {/* 正在输入三点跳动动画 + 面板上浮动画（qqPanelIn：加号面板/表情面板共用） */}
      <style>{'@keyframes qqTypingDot{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}@keyframes qqPanelIn{from{transform:translateY(65%);opacity:.35}to{transform:translateY(0);opacity:1}}'}</style>
      {/* 聊天背景层（聊天设置页设置：纯色/图片；顶栏与输入栏自身有底色，不受影响） */}
      {bg.mode !== 'default' && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0" style={chatBgLayerStyle(bg, bgImageUrl)} />
      )}
      {/* 顶栏：返回 + 名字/徽章/在线 + 企鹅 + 菜单（对照 QQ 真机；对方回复中名字变「正在输入中…」）。
          状态栏预留收进顶栏内（与顶栏同色同层）：自定义聊天背景不再透到状态栏区域（与微信聊天页同套结构）。
          多选模式下变为「取消 + 已选计数」操作栏 */}
      <div className="relative z-10 shrink-0 bg-[#F5F6F7] pt-[54px] dark:bg-[#111214]">
        {selectMode ? (
          fwdFlow === 'choose' ? (
            /* 转发勾选模式顶栏：取消 + 已选择计数（对照原生） */
            <div className="flex h-12 items-center gap-1 px-3">
              <button type="button" data-testid="qq-select-cancel" onClick={exitSelect} className="-ml-1 rounded-full p-1.5 text-[15px] active:bg-black/5">
                取消
              </button>
              <div className="ml-1 min-w-0 flex-1">
                <span data-testid="qq-select-count" className="text-[17px] font-semibold leading-tight">已选择 {selectedIds.length} 条消息</span>
              </div>
            </div>
          ) : (
          <div className="flex h-12 items-center gap-1 px-3">
            <button type="button" data-testid="qq-select-cancel" onClick={exitSelect} className="-ml-1 rounded-full p-1.5 text-[15px] active:bg-black/5">
              取消
            </button>
            <div className="ml-1 min-w-0 flex-1">
              <span data-testid="qq-select-count" className="text-[17px] font-semibold leading-tight">已选 {selectedIds.length} 条消息</span>
            </div>
          </div>
          )
        ) : (
        <div className="flex h-12 items-center gap-1 px-3">
        <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
        </button>
        {otherUnread > 0 && (
          <span
            data-testid="qq-chat-back-badge"
            aria-label={`${otherUnread} 条未读`}
            className="-ml-1 flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-black/[0.06] px-[5px] text-[12px] font-medium leading-none text-black/70 dark:bg-white/[0.14] dark:text-white/85"
          >
            {otherUnread > 99 ? '99+' : otherUnread}
          </span>
        )}
        <div className="ml-1 min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              data-testid="qq-chat-title"
              className={`truncate text-[17px] font-semibold leading-tight ${streaming || delivering ? 'text-black/45 dark:text-white/45' : ''}`}
            >
              {streaming || delivering ? '正在输入中…' : peer.name}
            </span>
            {flags.muted === true && (
              <BellOff
                className="h-4 w-4 shrink-0 text-black/30 dark:text-white/30"
                strokeWidth={2}
                aria-label="消息免打扰"
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => onToast('在线状态暂未开放')}
            className="flex items-center gap-1 text-[11px] text-black/40 active:opacity-60 dark:text-white/40"
          >
            <span className="inline-block h-[8px] w-[8px] rounded-full bg-[#26C84D]" aria-hidden="true" />
            在线
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          aria-label="聊天精灵"
          className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5"
          onClick={() => onToast('聊天精灵暂未开放')}
        >
          <PenguinMark size={26} />
        </button>
        <button
          type="button"
          aria-label="聊天设置"
          data-testid="qq-chat-menu"
          className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5"
          onClick={() => setSettingsOpen(true)}
        >
          <Menu className="h-[22px] w-[22px] text-black/70 dark:text-white/70" strokeWidth={2.2} />
        </button>
        </div>
        )}
      </div>

      {/* 消息流（页面任意位置左滑 → 好友互动标识页；自定义聊天背景时透出背景层） */}
      <div
        ref={scrollRef}
        className="no-scrollbar relative z-10 flex-1 overflow-y-auto px-3.5 py-3 select-none"
        data-testid="qq-chat-list"
        style={{ touchAction: 'pan-y' }}
      >
        {msgs.map((m, i) => {
          const showTime = i === 0 || m.time - msgs[i - 1].time > 5 * 60_000;
          const mine = m.role === 'me';
          const rpSettled = m.kind === 'redpacket' && m.packet ? (m.packet.claims ?? []).length > 0 || Boolean(m.packet.status) : false;
          const rpClaimedByMe = m.kind === 'redpacket' && m.packet ? (m.packet.claims ?? []).some((c) => c.name === me.name) : false;
          return (
            <div
              key={m.id}
              data-mid={m.id}
              onClickCapture={
                selectMode && isSelectable(m)
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleSelect(m.id);
                    }
                  : undefined
              }
              className={`rounded-[12px] transition-colors duration-500 ${
                highlightId === m.id ? 'bg-[#0099FF]/10 ring-1 ring-[#0099FF]/50' : ''
              }`}
            >
              {showTime && (
                <div className="my-2 text-center">
                  <span className="inline-block rounded-[4px] border border-black/25 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/25 dark:bg-white/[0.13] dark:text-white/60">{fmtChatTime(m.time)}</span>
                </div>
              )}
              {m.recalled ? (
                /* 已撤回：居中半透明胶囊（你撤回了一条消息 / 对方撤回了一条消息） */
                <div data-testid="qq-recall-row" className="mb-3 text-center">
                  <span className="inline-block rounded-[4px] border border-black/25 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/25 dark:bg-white/[0.13] dark:text-white/60">
                    {m.role === 'me' ? '你撤回了一条消息' : '对方撤回了一条消息'}
                  </span>
                </div>
              ) : m.kind === 'notice' && m.notice ? (
                <QQNoticeRow icon={m.notice.icon} pre={m.notice.pre} accent={m.notice.accent} />
              ) : m.kind === 'sys' && m.sys ? (
                /* 系统提示行（拉黑/解除拉黑等状态变更）：居中半透明胶囊，与撤回行同款 */
                <div data-testid="qq-sys-row" className="mb-3 text-center">
                  <span className="inline-block rounded-[4px] border border-black/25 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/25 dark:bg-white/[0.13] dark:text-white/60">
                    {m.sys.text}
                  </span>
                </div>
              ) : m.kind === 'blockreq' && m.blkreq ? (
                /* 申请解除拉黑卡片（角色发起）：头像+名字+理由+同意/拒绝 */
                <div className="mb-3 flex items-end justify-start gap-2">
                  <QqAvatar src={peer.avatar} alt={peer.name} size={40} />
                  <QqBlockReqCard
                    name={peer.name}
                    avatar={peer.avatar}
                    reason={m.blkreq.reason}
                    status={m.blkreq.status}
                    onAccept={() => resolveBlockReq(m, true)}
                    onReject={() => resolveBlockReq(m, false)}
                  />
                </div>
              ) : (
              <div className={`mb-3 flex ${m.kind === 'voice' ? 'items-start' : 'items-end'} ${m.kind === 'image' || m.kind === 'sticker' ? 'gap-[3px]' : 'gap-2'} ${mine ? 'justify-end' : 'justify-start'}`}>
                {selectMode && isSelectable(m) && !mine && (
                  /* 多选模式勾选圈（对方消息在行左侧） */
                  <span
                    aria-hidden="true"
                    data-testid={`qq-select-${m.id}`}
                    className={`grid h-[20px] w-[20px] shrink-0 self-center place-items-center rounded-full border ${
                      selectedIds.includes(m.id) ? 'border-[#0099FF] bg-[#0099FF] text-white' : 'border-black/25 dark:border-white/35'
                    }`}
                  >
                    {selectedIds.includes(m.id) && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}
                  </span>
                )}
                {!mine && <QqAvatar src={peer.avatar} alt={peer.name} size={40} />}
                {/* 拉黑图标（红色 ! 圆点）：我的消息在气泡左侧 */}
                {mine && blockedIconOf(m)}
                {m.kind === 'call' && m.call ? (
                  /* 语音通话卡片（通话结束后插入聊天记录）：整卡可点回拨（已取消（点击重拨）/ 对方未接听 / 已拒绝 / 未接听 / 通话时长）。
                     宽度约束挂在本包装层（卡片内 max-w-full）：挂卡片自身会相对本层（随内容收缩）解析成循环约束，气泡被压窄文字溢出 */
                  <div {...bubblePress} className="max-w-[calc(100%-92px)]">
                    <CallCardBubble
                      variant="qq"
                      state={m.call.state}
                      duration={m.call.duration}
                      direction={m.call.direction ?? (m.role === 'me' ? 'out' : 'in')}
                      onRedial={() => openVoiceCall('out')}
                    />
                  </div>
                ) : m.kind === 'redpacket' && m.packet ? (
                  <div {...bubblePress}>
                    <RedPacketBubble
                      packet={m.packet}
                      showOpen={!mine && !rpSettled && !rpClaimedByMe}
                      onClick={() => setLayer({ view: !mine && !rpSettled && !rpClaimedByMe ? 'rp-open' : 'rp-detail', msgId: m.id })}
                    />
                  </div>
                ) : m.kind === 'transfer' && m.packet ? (
                  <div {...bubblePress}>
                    <TransferBubble
                      packet={m.packet}
                      mine={mine}
                      received={m.packet.received === true}
                      onClick={() =>
                        // 对方发来的未收款且未退还的转账 → 收款页（时钟+待你收款+收款按钮）；其余 → 交易详情
                        setLayer({ view: !mine && m.packet?.received !== true && !m.packet?.status ? 'tr-receive' : 'tr-detail', msgId: m.id })
                      }
                    />
                  </div>
                ) : m.kind === 'family' && m.fam ? (
                  <div {...bubblePress}>
                    <FamilyBubble
                      fam={m.fam}
                      mine={mine}
                      peerName={peer.name}
                      onClick={() => setLayer({ view: 'fam-detail', msgId: m.id })}
                    />
                  </div>
                ) : m.kind === 'location' && m.loc ? (
                  <div {...bubblePress}>
                    <LocationBubble loc={m.loc} onClick={() => onToast('位置详情暂未开放')} />
                  </div>
                ) : m.kind === 'image' ? (
                  <div {...bubblePress} className="min-w-0">
                    <QqImageBubble src={m.content} />
                  </div>
                ) : m.kind === 'sticker' && m.stk ? (
                  <div {...bubblePress}>
                    <QqStickerBubble
                      url={m.stk.url}
                      meaning={m.stk.meaning}
                      onClick={() => onToast(m.stk?.meaning ? `表情：${m.stk.meaning}` : '表情')}
                    />
                  </div>
                ) : m.kind === 'forward' && m.fwd?.merged ? (
                  /* 合并转发「聊天记录」卡片（原生同款：两面都白底）：标题 + 逐条预览 + 「聊天记录」脚注；点击进详情 */
                  <div
                    {...bubblePress}
                    data-testid="qq-forward-bubble"
                    onClick={() => {
                      if (!selectMode) setFwdDetailId(m.id);
                    }}
                    className="w-fit max-w-[calc(100%-96px)] select-none rounded-[10px] bg-white px-3.5 py-[9px] text-[#1F2329] shadow-sm dark:bg-[#2A2C31] dark:text-white"
                  >
                    <p className="text-[15.5px] font-semibold leading-[1.35]">{m.fwd.title ?? m.content}</p>
                    <div className="mt-1 space-y-[1px] text-[13.5px] leading-[1.5] text-[#1F2329]/55 dark:text-white/60">
                      {(m.fwd.records ?? []).slice(0, 4).map((r, i) => (
                        <p key={i} className="break-all">
                          {r.name}：{r.text}
                        </p>
                      ))}
                      {(m.fwd.records?.length ?? 0) > 4 && <p>…</p>}
                    </div>
                    <p className="mt-2 border-t border-black/10 pt-1.5 text-[11px] text-black/40 dark:border-white/15 dark:text-white/45">聊天记录</p>
                  </div>
                ) : m.kind === 'forward' && m.fwd ? (
                  /* 转发卡片：内嵌原消息内容（来源说明已按需求移除） */
                  <div
                    {...bubblePress}
                    data-testid="qq-forward-bubble"
                    className="w-fit max-w-[calc(100%-96px)] select-none rounded-[10px] px-3.5 py-[9px] text-white"
                    style={{ backgroundColor: '#0099FF' }}
                  >
                    <div className="line-clamp-8 whitespace-pre-wrap break-words border-l-2 border-white/40 pl-2 text-[14px] leading-[1.4]">
                      {m.quote && <span className="mb-0.5 block text-[12px] text-white/75">{m.quote.name}：{m.quote.content}</span>}
                      {m.content}
                    </div>
                  </div>
                ) : m.kind === 'groupcard' && m.gcard ? (
                  /* 群聊邀请卡片（AI 主动建群/拉人）：pending 出接受/拒绝；点「接受邀请」才进群，卡片本体不可点 */
                  <div {...bubblePress}>
                    <QqGroupCardBubble
                      card={m.gcard}
                      onAccept={() => decideGroupCard(m, true)}
                      onReject={() => decideGroupCard(m, false)}
                    />
                  </div>
                ) : m.kind === 'voice' && m.voice ? (
                  /* 语音消息：播放/暂停 + 波形 + 时长；长按菜单：转文字/复制/…；转写结果显示在气泡下方
                     （我方 QQ 蓝底白字与文本气泡一致，圆角由组件内处理） */
                  <div {...bubblePress}>
                    <VoiceMsgBubble
                      msgId={m.id}
                      voice={m.voice}
                      side={m.role}
                      theme="qq"
                      style={m.role === 'me' ? { backgroundColor: '#0099FF' } : undefined}
                    />
                  </div>
                ) : (
                  <div className={`flex min-w-0 max-w-[calc(100%-96px)] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    <div
                      {...bubblePress}
                      className={`w-fit max-w-full select-none whitespace-pre-wrap break-words rounded-[10px] px-3.5 py-[9px] text-[16px] leading-[1.5] ${
                        mine ? 'text-white' : 'bg-white text-[#1F2329] dark:bg-[#2A2C31] dark:text-white'
                      }`}
                      style={mine ? { backgroundColor: '#0099FF' } : undefined}
                    >
                      {/* QQ 引用卡（截图样式：气泡内深色圆角卡 —— 上行名字+时间+右角箭头，下行引用内容；回复内容在卡片下方） */}
                      {m.quote && (() => {
                        const qTime = m.quote.time ?? (m.quote.id ? msgs.find((x) => x.id === m.quote?.id)?.time : undefined);
                        return (
                          <div
                            data-testid="qq-quote-block"
                            className={`mb-2 rounded-[8px] px-3 py-2 ${mine ? 'bg-black/[0.14]' : 'bg-black/[0.06] dark:bg-white/[0.08]'}`}
                          >
                            <div className={`flex items-center gap-1.5 text-[13px] leading-[1.4] ${mine ? 'text-white/85' : 'text-black/50 dark:text-white/50'}`}>
                              <span className="min-w-0 flex-1 truncate">
                                {m.quote.name}
                                {qTime ? ` ${qqQuoteTime(qTime)}` : ''}
                              </span>
                              <CornerRightDown className={`h-3.5 w-3.5 shrink-0 ${mine ? 'text-white/70' : 'text-black/35 dark:text-white/40'}`} />
                            </div>
                            <p className={`mt-0.5 line-clamp-2 whitespace-pre-wrap break-all text-[14.5px] leading-[1.45] ${mine ? 'text-white' : 'text-black/80 dark:text-white/85'}`}>
                              {m.quote.content}
                            </p>
                          </div>
                        );
                      })()}
                      {m.content ? (
                        cleanBubbleText(m.content) || m.content
                      ) : (
                        <span className="inline-flex items-center gap-[5px] py-[4px]" role="status" aria-label="对方正在输入">
                          {[0, 1, 2].map((d) => (
                            <span
                              key={d}
                              aria-hidden="true"
                              className="h-[7px] w-[7px] rounded-full bg-black/35 dark:bg-white/45"
                              style={{ animation: `qqTypingDot 1.1s ${d * 0.16}s ease-in-out infinite` }}
                            />
                          ))}
                        </span>
                      )}
                    </div>
                    {/* 翻译开启时在气泡下方显示所选语言的译文 */}
                    {renderTranslations(m.id, m.content)}
                  </div>
                )}
                {mine && <QqAvatar src={me.avatar} alt={me.name} size={40} />}
                {/* 拉黑图标（红色 ! 圆点）：对方的消息在气泡右侧 */}
                {!mine && blockedIconOf(m)}
                {selectMode && isSelectable(m) && mine && (
                  /* 多选模式勾选圈（我的消息在行右侧；转发勾选模式移到最左侧，对照原生） */
                  <span
                    aria-hidden="true"
                    data-testid={`qq-select-${m.id}`}
                    className={`grid h-[20px] w-[20px] shrink-0 self-center place-items-center rounded-full border ${
                      fwdFlow === 'choose' ? 'order-first' : ''
                    } ${
                      selectedIds.includes(m.id) ? 'border-[#0099FF] bg-[#0099FF] text-white' : 'border-black/25 dark:border-white/35'
                    }`}
                  >
                    {selectedIds.includes(m.id) && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}
                  </span>
                )}
              </div>
              )}
            {/* 拒收状态行：仅「对方拉黑我」时跟在我的消息后面，居中半透明胶囊；我拉黑对方不显示 */}
            {blockedLineOf(m)}
            </div>
          );
        })}
        {/* 正在输入指示（流式接收 + 逐条投递期间显示）：AI 回复为「边接收边逐条显示」——
            完整分段直接作为真实消息逐条投递上屏（见 runAiTurn 的 onSegment/finalize），
            不再有先全文显示后消失的流式气泡；识图失败系统提示在此一并展示 */}
        {(streaming || delivering) && (
          <div data-testid="qq-stream-typing">
            {stream?.visionNotice && (
              <p data-testid="qq-vision-notice" className="my-1 text-center text-[12px] leading-relaxed text-black/40 dark:text-white/40">
                {stream.visionNotice}
              </p>
            )}
            <div className="mb-3 flex items-end justify-start gap-2">
              <QqAvatar src={peer.avatar} alt={peer.name} size={40} />
              <div className="max-w-[calc(100%-96px)] rounded-[10px] bg-white px-3.5 py-[9px] dark:bg-[#2A2C31]">
                <span className="inline-flex items-center gap-[5px] py-[4px]" role="status" aria-label="对方正在输入">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      aria-hidden="true"
                      className="h-[7px] w-[7px] rounded-full bg-black/35 dark:bg-white/45"
                      style={{ animation: `qqTypingDot 1.1s ${d * 0.16}s ease-in-out infinite` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 底部：输入行 + 六图标工具栏 + 加号面板（弹出时输入框与工具栏被整体顶起，跟随面板上浮）；多选模式下变为批量操作栏 */}
      <div className="relative z-10 shrink-0 bg-white dark:bg-[#1B1C1F]">
        {selectMode ? (
          <div className="flex items-center justify-around px-6 pb-[22px] pt-3" data-testid="qq-select-bar">
            <button
              type="button"
              data-testid="qq-select-del"
              disabled={selectedIds.length === 0}
              onClick={batchDelete}
              className="flex flex-col items-center gap-1 text-[12px] text-[#F5455C] disabled:opacity-35"
            >
              <Trash2 className="h-[21px] w-[21px]" strokeWidth={1.9} />
              删除
            </button>
            <button
              type="button"
              data-testid="qq-select-forward"
              disabled={selectedIds.length === 0}
              onClick={batchForward}
              className="flex flex-col items-center gap-1 text-[12px] text-[#1F2329] disabled:opacity-35 dark:text-white/85"
            >
              <Forward className="h-[21px] w-[21px]" strokeWidth={1.9} />
              分享
            </button>
            <button
              type="button"
              data-testid="qq-select-fav"
              disabled={selectedIds.length === 0}
              onClick={batchFav}
              className="flex flex-col items-center gap-1 text-[12px] text-[#1F2329] disabled:opacity-35 dark:text-white/85"
            >
              <Star className="h-[21px] w-[21px]" strokeWidth={1.9} />
              收藏
            </button>
          </div>
        ) : (
        <>
        {/* 引用条（长按菜单「引用」后显示在输入框上方；发送时挂到新消息上） */}
        {quote && (
          <div className="px-3 pb-1 pt-2" data-testid="qq-quote-bar">
            <div className="flex items-start gap-2 rounded-[4px] border border-black/25 bg-white/75 px-2 py-1 dark:border-white/25 dark:bg-white/[0.13]">
              <p className="min-w-0 flex-1 truncate text-[12px] leading-[1.4] text-black/55 dark:text-white/55">
                引用 {quote.name}：{quote.content}
              </p>
              <button
                type="button"
                aria-label="取消引用"
                data-testid="qq-quote-cancel"
                onClick={() => setQuote(null)}
                className="shrink-0 text-black/35 active:opacity-60 dark:text-white/35"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 px-3 pb-1 pt-3">
          <div className="relative min-w-0 flex-1">
            <input
              data-testid="qq-chat-input"
              value={input}
              onChange={(e) => {
                const v = e.target.value;
                setInput(v);
                // 键入 @ 直接唤起 @ 浮层（与群聊同款：点选后替换该 @ 并插入「@名字 」）
                if (v.endsWith('@')) {
                  setPlusOpen(false);
                  setStickerOpen(false);
                  setAtOpen(true);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send();
              }}
              placeholder={ttsSend ? '输入文字，发送后转为语音' : ''}
              aria-label={`发送消息给${peer.name}`}
              className="h-[40px] w-full rounded-[10px] border border-black/[0.07] bg-[#F6F7F8] pl-3.5 pr-10 text-[15px] outline-none placeholder:text-black/25 dark:border-white/[0.08] dark:bg-white/[0.07] dark:placeholder:text-white/25"
            />
            {/* 文字转语音开关（声波图标在输入框内右侧）：开启后输入框文字发送为语音气泡 */}
            <button
              type="button"
              aria-label={ttsSend ? '文字转语音发送：已开启，点击关闭' : '文字转语音发送：点击开启'}
              aria-pressed={ttsSend}
              data-testid="qq-tts-toggle"
              onClick={() => {
                const nv = !ttsSend;
                setTtsSend(nv);
                onToast(nv ? '已开启文字转语音：发送后为语音气泡' : '已关闭文字转语音');
              }}
              className={`absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full transition-colors active:opacity-60 ${ttsSend ? 'text-[#0099FF]' : 'text-black/40 dark:text-white/40'}`}
            >
              <AudioLines className="h-[18px] w-[18px]" strokeWidth={ttsSend ? 2.2 : 1.8} />
            </button>
          </div>
          <button
            type="button"
            data-testid="qq-chat-send"
            aria-label={ttsSend ? '发送（转语音）' : input.trim() ? '发送' : '发送（让对方回复）'}
            disabled={(!input.trim() && !canDispatch) || streaming}
            onClick={() => {
              if (input.trim()) void send();
              else dispatchBatch();
            }}
            className={`h-[40px] shrink-0 rounded-[12px] px-5 text-[16px] font-medium text-white transition-all duration-150 ${
              (input.trim() || canDispatch) && !streaming
                ? 'shadow-[0_2px_10px_rgba(0,153,255,0.30)] active:scale-[0.97] active:brightness-95'
                : 'opacity-90'
            }`}
            style={{ backgroundColor: (input.trim() || canDispatch) && !streaming ? QQ_BLUE : '#8AD4F7' }}
          >
            发送
          </button>
        </div>
        <div className="flex items-center justify-between px-7 pb-[18px] pt-2 text-black/80 dark:text-white/80">
          <button
            type="button"
            aria-label={voiceMode ? '切换到键盘输入' : '语音输入'}
            data-testid="qq-voice-toggle"
            aria-expanded={voiceMode}
            onClick={() => {
              if (rec.phase !== 'idle') return; // 录音按住中不允许切换（防止按住中的大圆钮被卸载导致手势丢失）
              setVoiceMode((v) => !v);
              setPlusOpen(false);
              setStickerOpen(false);
            }}
            className="p-2 -m-2 active:opacity-60"
          >
            <Mic className={`h-[25px] w-[25px] ${voiceMode ? 'text-[#0099FF]' : ''}`} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" aria-label="图片" data-testid="qq-tool-image" onClick={() => fileRef.current?.click()} className="p-2 -m-2 active:opacity-60">
            <ImageIcon className="h-[25px] w-[25px]" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" aria-label="拍摄" data-testid="qq-tool-camera" onClick={() => cameraInputRef.current?.click()} className="p-2 -m-2 active:opacity-60">
            <Camera className="h-[25px] w-[25px]" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" aria-label="点缀" onClick={() => onToast('点缀暂未开放')} className="p-2 -m-2 active:opacity-60">
            <Sparkles className="h-[25px] w-[25px]" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="表情"
            data-testid="qq-chat-sticker"
            aria-expanded={stickerOpen}
            onClick={() => {
              setPlusOpen(false);
              setStickerOpen((v) => !v);
            }}
            className="p-2 -m-2 active:opacity-60"
          >
            <Smile className={`h-[25px] w-[25px] ${stickerOpen ? 'text-[#0099FF]' : ''}`} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="更多功能"
            data-testid="qq-chat-plus"
            aria-expanded={plusOpen}
            onClick={() => {
              setStickerOpen(false);
              setPlusOpen((v) => !v);
            }}
            className="p-2 -m-2 active:opacity-60"
          >
            <Plus className={`h-[26px] w-[26px] transition-transform duration-200 ${plusOpen ? 'rotate-45' : ''}`} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        {/* QQ 语音面板（工具栏下方展开，相当于键盘区）：「按住说话」+ 大圆麦克风（左滑转文字/右滑取消）+ 变声/对讲/录音 */}
        {voiceMode && <QqVoicePanel rec={rec} holdTestId="qq-voice-hold" />}
        {plusOpen ? (
          <div data-testid="qq-plus-panel" className="border-t border-black/[0.05] px-5 pb-6 pt-5 dark:border-white/[0.06]" style={{ animation: 'qqPanelIn 0.24s ease-out' }}>
            <QqPlusGrid items={plusItems} />
          </div>
        ) : null}
        {stickerOpen ? (
          <QqStickerPanel
            onPick={sendSticker}
            onClose={() => setStickerOpen(false)}
            onToast={onToast}
          />
        ) : null}
        {/* @ 浮层（单聊）：锚定输入区上方，点选后把草稿末尾的 @ 替换为「@名字 」 */}
        {atOpen ? (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setAtOpen(false)} aria-hidden="true" />
            <div className="absolute bottom-full left-3 z-40 mb-1 w-[220px] overflow-hidden rounded-[12px] border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-[#2A2C31]">
              <div className="border-b border-black/[0.05] px-3 py-2 text-[11px] text-black/40 dark:border-white/[0.06] dark:text-white/40">
                @ 联系人（被 @ 的优先回复）
              </div>
              <button
                type="button"
                data-testid={`qq-chat-at-${peer.id}`}
                onClick={() => {
                  setAtOpen(false);
                  setInput((v) => {
                    const base = v.endsWith('@') ? v.slice(0, -1) : v;
                    return `${base}${base && !base.endsWith(' ') ? ' ' : ''}@${peer.name} `;
                  });
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <QqAvatar src={peer.avatar} alt={peer.name} size={28} />
                <span className="min-w-0 flex-1 truncate text-[14px]">{peer.name}</span>
              </button>
            </div>
          </>
        ) : null}
        </>
        )}
      </div>

      {/* 浮层：发红包 / 转账 / 红包开箱 / 红包详情 / 交易详情 / 发送位置 */}
      {layer?.view === 'redpacket' ? (
        <RedPacketCompose
          wallet={payCtx.wallet}
          cards={payCtx.cards}
          onToast={onToast}
          onClose={() => setLayer(null)}
          onSend={(p, methodId) => startSend('redpacket', p, methodId)}
        />
      ) : null}
      {layer?.view === 'transfer' ? (
        <TransferCompose
          peer={peer}
          wallet={payCtx.wallet}
          cards={payCtx.cards}
          onToast={onToast}
          onClose={() => setLayer(null)}
          onSend={(p, methodId) => startSend('transfer', p, methodId)}
        />
      ) : null}
      {layer?.view === 'rp-open'
        ? (() => {
            const m = msgs.find((x) => x.id === layer.msgId);
            if (!m?.packet) return null;
            return (
              <RedPacketOpenModal
                senderName={peer.name}
                avatar={peer.avatar}
                note={m.packet.note}
                onClose={() => setLayer(null)}
                onRefund={() => refundPeerCard(m)}
                onOpen={() => {
                  const claims = m.packet?.claims ?? [];
                  const remaining = round2((m.packet?.amount ?? 0) - claims.reduce((s, c) => s + c.amount, 0));
                  const amt = Math.max(0.01, remaining);
                  gainToWallet(amt, '红包收入');
                  // 领取提示行（聊天界面居中灰字）：「你领取了XX的红包」，与对方领取我的红包同款样式
                  const notice: QQMsg = { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'notice', notice: { icon: 'rp', pre: `你领取了${peer.name}的`, accent: '红包' } };
                  setMsgs((prev) => [
                    ...prev.map((x) =>
                      x.id === m.id && x.packet
                        ? { ...x, packet: { ...x.packet, claims: [...(x.packet.claims ?? []), { name: me.name, avatar: me.avatar, amount: amt, ts: Date.now() }] } }
                        : x
                    ),
                    notice,
                  ]);
                  setLayer({ view: 'rp-detail', msgId: m.id });
                }}
              />
            );
          })()
        : null}
      {layer?.view === 'rp-detail'
        ? (() => {
            const m = msgs.find((x) => x.id === layer.msgId);
            return m?.packet ? <RedPacketDetailPage me={me} peer={peer} msg={m} onBack={() => setLayer(null)} onToast={onToast} /> : null;
          })()
        : null}
      {layer?.view === 'tr-receive'
        ? (() => {
            const m = msgs.find((x) => x.id === layer.msgId);
            return m?.packet ? (
              <TransferReceivePage
                peer={peer}
                msg={m}
                onBack={() => setLayer(null)}
                onAccept={(id) => {
                  const p = m.packet;
                  // 收款：标记原卡已收款（receiptOf=peer，我收的） + 入钱包余额 + 追加我的「已收款」接收卡片（与 AI 收我转账时的接收卡片同款、方向相反）
                  patchPacket(id, { received: true, receivedAt: Date.now(), receiptOf: 'peer' });
                  if (p) gainToWallet(p.amount, '转账收入');
                  setMsgs((prev) => [
                    ...prev,
                    {
                      id: uid(),
                      role: 'me',
                      content: '',
                      time: Date.now(),
                      kind: 'transfer',
                      packet: { type: 'transfer', amount: p?.amount ?? 0, note: p?.note ?? '', received: true, receivedAt: Date.now(), receiptOf: 'peer' },
                    },
                  ]);
                  onToast(`已收款 ${fmtMoney(p?.amount ?? 0)} 元`);
                  setLayer({ view: 'tr-detail', msgId: id });
                }}
                onRefund={() => {
                  // 收款页「退还」：原卡标记已退回（变灰）+ 通知行 + AI 人设化回应
                  refundPeerCard(m);
                }}
              />
            ) : null;
          })()
        : null}
      {layer?.view === 'tr-detail'
        ? (() => {
            const m = msgs.find((x) => x.id === layer.msgId);
            if (!m?.packet) return null;
            // 收款人是否为「我」：receiptOf 精准标记优先；旧数据按角色兑底——
            // 我的卡片（receiptOf 缺失）只会是「我发出的原卡（对方收）」；对方卡片且已收款的只会是「我收的旧凭据」
            const p = m.packet;
            let receiverIsMe: boolean;
            if (p.receiptOf) receiverIsMe = p.receiptOf === 'peer';
            else if (m.role === 'me') receiverIsMe = false;
            else receiverIsMe = p.received === true;
            return (
              <TransferDetailPage
                me={me}
                peer={peer}
                msg={m}
                receiverIsMe={receiverIsMe}
                onBack={() => setLayer(null)}
                onToast={onToast}
                onAccept={(id) => {
                  // 详情页收款（兑底路径）：标记 + 入余额 + 追加我的「已收款」接收卡片
                  patchPacket(id, { received: true, receivedAt: Date.now(), receiptOf: 'peer' });
                  if (p) gainToWallet(p.amount, '转账收入');
                  setMsgs((prev) => [
                    ...prev,
                    {
                      id: uid(),
                      role: 'me',
                      content: '',
                      time: Date.now(),
                      kind: 'transfer',
                      packet: { type: 'transfer', amount: p?.amount ?? 0, note: p?.note ?? '', received: true, receivedAt: Date.now(), receiptOf: 'peer' },
                    },
                  ]);
                }}
              />
            );
          })()
        : null}
      {layer?.view === 'fam-detail'
        ? (() => {
            const m = msgs.find((x) => x.id === layer.msgId);
            return m?.fam ? (
              <FamilyDetailPage
                peer={peer}
                msg={m}
                onBack={() => setLayer(null)}
                onToast={onToast}
                onClaim={claimFam}
                onRefund={m.role !== 'me' ? () => refundPeerCard(m) : undefined}
              />
            ) : null;
          })()
        : null}
      {layer?.view === 'location' ? (
        <LocationPickerPage
          onClose={() => setLayer(null)}
          onSend={(loc) => {
            setMsgs((prev) => [...prev, { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'location', loc }]);
            setLayer(null);
            onToast('位置已发送');
          }}
        />
      ) : null}
      {/* 支付密码验证浮层（开启支付密码后红包/转账发送前弹出自绘键盘） */}
      {gate ? (
        <PayPwdGate
          label={`${gate.kind === 'redpacket' ? '发红包' : `向${peer.name}转账`} ${fmtMoney(gate.packet.amount)} 元 · ${methodLabel(gate.methodId)}`}
          onOk={() => {
            const g = gate;
            setGate(null);
            execAndSend(g.kind, g.packet, g.methodId);
          }}
          onClose={() => setGate(null)}
        />
      ) : null}

      {/* 聊天设置页（右上角菜单进入）：信息卡片/置顶聊天/消息免打扰/回复条数/查找聊天记录/聊天背景 */}
      {settingsOpen ? (
        <ChatSettingsPage
          variant="qq"
          title="聊天设置"
          peerName={peer.name}
          peerAvatar={peer.avatar}
          idLabel="QQ号"
          idValue={peer.qqId || '未设置'}
          metaLine={[peer.region, peer.occupation].filter((x): x is string => Boolean(x)).join(' · ')}
          remark={peer.remark ?? ''}
          onSaveRemark={(v) => {
            void onSaveRemark(v);
          }}
          voiceSummary={describeVoiceId(peer.voiceId, myVoicesForSummary)}
          onOpenVoice={() => setVoiceOpen(true)}
          pinned={flags.pinned === true}
          muted={flags.muted === true}
          bg={bg}
          bgImageUrl={bgImageUrl}
          replyCount={replyCount}
          translateSummary={
            transCfg.on
              ? `${translateLangLabel(transCfg.left)} ⇄ ${translateLangLabel(transCfg.right)}`
              : '未开启'
          }
          sentenceSend={sentenceSend}
          timeAware={timeAware}
          stickersOn={stickersOn}
          onBack={() => setSettingsOpen(false)}
          onTogglePinned={(v) => qqChatFlagsStore.update(peer.id, { pinned: v })}
          onToggleMuted={(v) => qqChatFlagsStore.update(peer.id, { muted: v })}
          blockedByUser={blk.byUser === true}
          onToggleBlock={peer.id === me.id ? undefined : toggleBlockFromSettings}
          onOpenReplyCount={() => setReplyOpen(true)}
          onOpenTranslate={() => setTranslateOpen(true)}
          onToggleSentenceSend={(v) => {
            saveSentenceSend(sessionKey, v);
            setSentenceSendState(v);
            if (!v) {
              // 关闭分句发送：清除待回复批次标记，后续发送恢复原有的即时回复行为
              markPendingBatch(sessionKey, false);
              setPendingDispatch(false);
            }
          }}
          onToggleTimeAware={(v) => {
            // 立即持久化并生效（下一次请求现场读取，无需重启）
            setTimeAware(sessionKey, v);
            setTimeAwareState(v);
          }}
          onToggleStickers={(v) => {
            // 立即持久化并生效（下一次请求现场读取，无需重启）：关闭后 AI 不发表情包也不发 emoji
            saveStickersOn(sessionKey, v);
            setStickersOnState(v);
          }}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenBg={() => setBgOpen(true)}
          onOpenWorldBooks={() => setWbOpen(true)}
          worldBooksSummary={loadBooks()
            .filter((b) => wbBound.includes(b.id))
            .map((b) => b.name)
            .join('、') || '未选择'}
          onOpenPeerProfile={onOpenFriendProfile}
        />
      ) : null}

      {/* 世界书挂载页（聊天设置二级页）：为联系人勾选挂载的书籍（按联系人隔离持久化） */}
      {wbOpen ? (
        <WorldBookPickerPage
          variant="qq"
          books={loadBooks()
            .filter((b) => b.scope === 'local')
            .map((b) => ({
              id: b.id,
              name: b.name,
              entryCount: b.entries.length,
              enabledCount: b.entries.filter((e) => e.enabled).length,
            }))}
          boundIds={wbBound}
          onBack={() => setWbOpen(false)}
          onChange={(ids) => {
            setBoundBookIds(peer.id, ids);
            setWbBound(ids);
          }}
        />
      ) : null}

      {/* 翻译语言页（聊天设置二级页）：总开关 + 语言对双侧选择（按会话隔离保存） */}
      {translateOpen ? (
        <ChatTranslatePage
          variant="qq"
          cfg={transCfg}
          onBack={() => setTranslateOpen(false)}
          onChange={(next) => {
            const n = normalizeTranslateCfg(next);
            saveTranslateCfg(sessionKey, n);
            setTransCfgState(n);
          }}
        />
      ) : null}

      {/* 回复条数页（聊天设置二级页）：AI 按选定条数连发多条消息（按会话隔离保存） */}
      {replyOpen ? (
        <ChatReplyCountPage
          variant="qq"
          value={replyCount}
          onBack={() => setReplyOpen(false)}
          onSelect={(n) => {
            saveReplyCount(sessionKey, n);
            setReplyCountState(n);
          }}
        />
      ) : null}

      {/* 他的声音页（聊天设置二级页）：角色音色选择（内置/我的/API）+ AI 语音频率入口 */}
      {voiceOpen ? (
        <ChatVoicePage
          variant="qq"
          peerName={peer.name}
          voiceId={peer.voiceId ?? ''}
          voiceFreq={getAiVoiceFreq(sessionKey)}
          onBack={() => setVoiceOpen(false)}
          onSelect={(vid) => {
            void onSaveVoiceId(vid);
            setVoiceOpen(false);
          }}
          onOpenFreq={() => setVoiceFreqOpen(true)}
        />
      ) : null}

      {/* AI 语音频率页（他的声音二级页）：关闭/每条/经常/偶尔/不经常（按会话隔离保存） */}
      {voiceFreqOpen ? (
        <ChatVoiceFreqPage
          variant="qq"
          value={getAiVoiceFreq(sessionKey)}
          onBack={() => setVoiceFreqOpen(false)}
          onSelect={(f) => {
            saveAiVoiceFreq(sessionKey, f);
            setVoiceFreqOpen(false);
          }}
        />
      ) : null}

      {/* 聊天背景页（聊天设置二级页）：预览卡片 + 从手机相册上传 + 内置纯色壁纸 */}
      {bgOpen ? (
        <ChatBgPage
          variant="qq"
          bg={bg}
          bgImageUrl={bgImageUrl}
          uploading={uploadingBg}
          onBack={() => setBgOpen(false)}
          onPickColor={handlePickBgColor}
          onPickImageFile={(f) => void handleUploadBg(f)}
          onResetBg={handleResetBg}
        />
      ) : null}

      {/* 查找聊天记录页：关键词过滤 → 点击结果定位回聊天页并高亮 */}
      {searchOpen ? (
        <ChatSearchPage
          variant="qq"
          items={searchItems}
          myName={me.name}
          peerName={peer.name}
          myAvatar={me.avatar}
          peerAvatar={peer.avatar}
          onClose={() => setSearchOpen(false)}
          onJumpTo={jumpToMessage}
        />
      ) : null}
      {/* 相册选图隐藏 input（工具栏图片按钮）+ 原生相机隐藏 input（拍摄按钮 capture 直调后置摄像头） */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-testid="qq-chat-file"
        onChange={(e) => {
          void sendImageFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="qq-chat-camera"
        onChange={(e) => {
          void sendImageFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* 编辑消息弹窗（长按菜单「编辑」）：修改内容后更新该条消息并落盘 */}
      {editMsg && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/40 px-8" data-testid="qq-edit-layer" onClick={() => setEditMsg(null)}>
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#2A2C31]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="pb-1 pt-4 text-center text-[16px] font-medium">编辑消息</p>
            <div className="px-4 pb-3 pt-2">
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={4}
                maxLength={2000}
                autoFocus
                data-testid="qq-edit-input"
                className="w-full resize-none rounded-[8px] border border-black/10 bg-black/[0.03] px-2.5 py-2 text-[15px] leading-[1.45] outline-none focus:border-[#0099FF] dark:border-white/15 dark:bg-white/[0.06]"
              />
            </div>
            <div className="flex border-t border-black/10 dark:border-white/10">
              <button
                type="button"
                onClick={() => setEditMsg(null)}
                className="h-11 flex-1 text-[16px] active:bg-black/5 dark:active:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="qq-edit-save"
                onClick={saveEdit}
                className="h-11 flex-1 text-[16px] font-medium text-[#1E6FFF] active:bg-black/5 dark:text-[#4AA3FF] dark:active:bg-white/10"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 转发方式弹层（多选底栏点「分享」图标才弹出：逐条转发 / 合并转发；点弹层以外任意处关闭不执行） */}
      {selectMode && fwdFlow === 'choose' && (
        <div className="absolute inset-0 z-[60]" data-testid="qq-fwd-choose-mask" onClick={() => setFwdFlow(null)}>
          <div
            className="absolute inset-x-3 bottom-[84px] overflow-hidden rounded-[14px] bg-white shadow-[0_8px_32px_rgba(0,0,0,0.20)] dark:bg-[#2C2C2C]"
            data-testid="qq-fwd-choose-bar"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              data-testid="qq-fwd-each"
              disabled={selectedIds.length === 0}
              onClick={() => {
                setFwdMode('each');
                setFwdFlow('target');
              }}
              className={`w-full py-[15px] text-center text-[17px] ${
                selectedIds.length === 0 ? 'text-black/25 dark:text-white/25' : 'text-[#1F2329] active:bg-black/[0.04] dark:text-white dark:active:bg-white/[0.06]'
              }`}
            >
              逐条转发
            </button>
            <button
              type="button"
              data-testid="qq-fwd-merge"
              disabled={selectedIds.length === 0}
              onClick={() => {
                setFwdMode('merge');
                setFwdFlow('target');
              }}
              className={`w-full border-t border-black/[0.06] py-[15px] text-center text-[17px] dark:border-white/[0.08] ${
                selectedIds.length === 0 ? 'text-black/25 dark:text-white/25' : 'text-[#1F2329] active:bg-black/[0.04] dark:text-white dark:active:bg-white/[0.06]'
              }`}
            >
              合并转发
            </button>
          </div>
        </div>
      )}

      {/* 转发目标选择（转发流程第二步：聊天内勾选完 → 逐条/合并 → 选会话） */}
      {fwdFlow === 'target' && (
        <div className="absolute inset-0 z-[70] flex flex-col justify-end bg-black/40" data-testid="qq-fwd-target-layer">
          <div className="mx-2 mb-3 overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#1E1E1E]" onClick={(e) => e.stopPropagation()}>
            <p className="border-b border-black/[0.06] py-3 text-center text-[15px] font-medium dark:border-white/[0.08]">
              {fwdMode === 'merge' ? '合并转发给' : '逐条转发给'}
            </p>
            <div className="max-h-[46vh] overflow-y-auto">
              {forwardTargets.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid={`qq-fwd-target-${c.id}`}
                  onClick={() => doForward(fwdMode, selectedIds, { id: c.id, name: c.name, avatar: c.avatar, self: c.id === me.id })}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  <QqAvatar src={c.avatar} alt={c.name} size={38} />
                  <span className="min-w-0 flex-1 truncate text-[15.5px]">{c.id === me.id ? `${c.name}（我自己）` : c.name}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              data-testid="qq-fwd-back"
              onClick={() => setFwdFlow('choose')}
              className="w-full border-t border-black/[0.06] py-3 text-center text-[15px] text-black/55 active:bg-black/5 dark:border-white/[0.08] dark:text-white/55 dark:active:bg-white/10"
            >
              上一步
            </button>
          </div>
        </div>
      )}

      {/* 合并转发「聊天记录」详情页（点卡片打开） */}
      {(() => {
        const d = fwdDetailId ? msgs.find((x) => x.id === fwdDetailId) ?? null : null;
        if (!d || d.kind !== 'forward' || !d.fwd?.merged) return null;
        const records = d.fwd.records ?? [];
        /** 记录头像解析：快照优先 → 旧数据按说话人名字查联系人（含自己）→ 角色回退。
         *  修复「转发给我自己时 AI 记录错拿我的头像」：旧卡片无 avatar 快照时回退 peer.avatar，
         *  转发目标是我自己则 peer 就是我 → 按名字查联系人才能找回原说话人头像 */
        const resolveAvatar = (r: FwdRecord): string | null => {
          if (r.avatar !== undefined) return r.avatar;
          if (r.name === me.name) return me.avatar;
          const hit = contacts.find((c) => c.name === r.name);
          if (hit) return hit.avatar;
          return r.role === 'me' ? me.avatar : peer.avatar;
        };
        return (
          <div className="absolute inset-0 z-[65] flex flex-col bg-white text-[#1F2329] dark:bg-[#16171A] dark:text-white" data-testid="qq-fwd-detail">
            <div className="shrink-0 bg-white pt-[54px] dark:bg-[#16171A]">
              <div className="flex h-11 items-center px-2">
                <button type="button" aria-label="返回" data-testid="qq-fwd-detail-back" onClick={() => setFwdDetailId(null)} className="active:opacity-60">
                  <ChevronLeft className="h-7 w-7" strokeWidth={2} />
                </button>
                <p className="min-w-0 flex-1 truncate pr-2 text-center text-[16px] font-medium">{d.fwd.title ?? '聊天记录'}</p>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
              <p className="py-3 text-center text-[13px] text-black/40 dark:text-white/40">{fwdRecordDate(records[0]?.time ?? d.time)}</p>
              {/* 逐条记录：行间分割线 */}
              <div className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
                {records.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 py-3">
                    <QqAvatar src={resolveAvatar(r)} alt={r.name} size={34} />
                    <div className="min-w-0 flex-1">
                      {/* 名字在左、时间顶到最右 */}
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[11.5px] text-black/40 dark:text-white/40">{r.name}</p>
                        <span className="shrink-0 text-[10.5px] text-black/30 dark:text-white/30">{fwdRecordTime(r.time)}</span>
                      </div>
                      {/* 表情包/图片显示原图；其余类型（文字/红包/转账/亲属卡/位置）显示快照文字 */}
                      {r.kind === 'sticker' && r.imgSrc ? (
                        <img
                          src={r.imgSrc}
                          alt={r.stkMeaning ? `表情：${r.stkMeaning}` : '表情'}
                          data-testid="qq-fwd-detail-sticker"
                          className="mt-0.5 max-h-[96px] w-auto max-w-[110px] rounded-[10px] object-contain"
                          loading="lazy"
                        />
                      ) : r.kind === 'image' && r.imgSrc ? (
                        <img
                          src={r.imgSrc}
                          alt="图片消息"
                          data-testid="qq-fwd-detail-image"
                          className="mt-0.5 max-h-[190px] w-auto max-w-[210px] rounded-[12px] object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.4]">{r.text}</p>
                      )}
                      {r.quote && (
                        <p className="mt-0.5 line-clamp-2 border-l-2 border-black/15 pl-1.5 text-[12px] leading-[1.35] text-black/45 dark:border-white/20 dark:text-white/50">{r.quote}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="pt-8 text-center text-[12px] text-black/35 dark:text-white/35">聊天记录</p>
            </div>
          </div>
        );
      })()}

      {/* 气泡长按横向菜单（横向深色卡片；点菜单项执行动作，点空白处关闭） */}
      {msgMenu && (
        <BubbleActionMenu
          pos={msgMenu.pos}
          items={buildMsgMenuItems(msgMenu.msg)}
          onSelect={handleMenuAction}
          onClose={() => setMsgMenu(null)}
          testPrefix="qq-menu"
        />
      )}

      {/* 转文字预览弹层：识别结果可编辑，发送文字/发送语音/取消三选一 */}
      {sttPreview.state && (
        <SttPreviewOverlay
          state={sttPreview.state}
          accent="#0099FF"
          onCancel={sttPreview.close}
          onSendText={sttPreview.sendText}
          onSendVoice={sttPreview.sendVoice}
          onChangeText={sttPreview.setText}
        />
      )}

      {/* 语音通话已迁移到全局通话层（PhoneShell › GlobalCallLayer）：加号面板/通话卡片回拨/AI 来电
          均经 openVoiceCall → startGlobalCall 发起，退出聊天页电话不断；结束时 writeCallCard 落卡片 */}

      {/* 页内 toast（收藏成功/取消收藏/已复制/已转发给 xx 等操作提示） */}
      <LocalToast msg={chatToast} />
    </div>
  );
}

// ---------------- 红包 / 转账（聊天加号面板 → 发送卡片 → 点击进详情） ----------------

/** 红包小图标（加号面板用，红色信封；单聊/群聊共用） */
export function RpIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M4 7.5c5 3.4 11 3.4 16 0" />
      <circle cx="12" cy="12.6" r="2.1" />
    </svg>
  );
}

/** 红包卡片上的奶油色企鹅剪影（对照 QQ 红包封面） */
function RpPenguin({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <ellipse cx="20" cy="18.5" rx="10.5" ry="12.5" fill="#FBE7B2" />
      <ellipse cx="20" cy="22" rx="6.4" ry="7.6" fill="#E85B54" opacity="0.55" />
      <circle cx="15.9" cy="13.6" r="2.5" fill="#FFF6DC" />
      <circle cx="24.1" cy="13.6" r="2.5" fill="#FFF6DC" />
      <circle cx="16.4" cy="14" r="1.1" fill="#C9402F" />
      <circle cx="23.6" cy="14" r="1.1" fill="#C9402F" />
      <path d="M16 17.8c1.5 1.5 6.5 1.5 8 0 .8 1.3-1.5 3.6-4 3.6s-4.8-2.3-4-3.6z" fill="#E8912D" />
    </svg>
  );
}

/** 红包封面大企鹅剪影暗纹（纯剪影，供封面纹样层用） */
function RpPenguinSilhouette({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <ellipse cx="20" cy="18.5" rx="10.5" ry="12.5" fill="rgba(196,32,48,0.16)" />
      <ellipse cx="20" cy="23" rx="6.6" ry="8" fill="rgba(196,32,48,0.10)" />
      <path d="M11.5 29.5c1.6 2.8 5 4.7 8.5 4.7s6.9-1.9 8.5-4.7c-1.1 4.9-4.5 8.1-8.5 8.1s-7.4-3.2-8.5-8.1z" fill="rgba(196,32,48,0.16)" />
    </svg>
  );
}

/** 红包封面纹样层（对照真机封面：右侧细密斜线纹理 + 左上圆弧线 + 菱形描边 + 大企鹅剪影暗纹），绝对定位铺满父容器 */
function RpCoverPattern() {
  return (
    <span className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* 右侧竖向斜线纹理区 */}
      <span
        className="absolute inset-y-0 right-0 w-[36%] opacity-75"
        style={{ backgroundImage: 'repeating-linear-gradient(112deg, rgba(255,235,200,0.13) 0px, rgba(255,235,200,0.13) 1.5px, transparent 1.5px, transparent 6.5px)' }}
      />
      {/* 左上大圆弧线 */}
      <span className="absolute -left-12 -top-16 h-48 w-48 rounded-full border-[3px] border-white/[0.09]" />
      {/* 中左菱形描边 */}
      <span className="absolute -left-3 top-[42%] h-20 w-20 rotate-45 rounded-[16%] border-[3px] border-white/[0.08]" />
      {/* 右侧大企鹅剪影暗纹 */}
      <RpPenguinSilhouette className="absolute -right-7 top-[24%] h-44 w-40" />
    </span>
  );
}

/** 聊天中的红包卡片（对照真机封面：企鹅+QQ字样+祝福语+右侧斜线纹理/圆弧/菱形/企鹅暗纹+底部亮红大弧+開/QQ红包；自己发的点开进详情，对方的先开箱） */
export function RedPacketBubble({ packet, showOpen, onClick }: { packet: MsgPacket; showOpen: boolean; onClick: () => void }) {
  const claimed = (packet.claims ?? []).length > 0;
  const settled = claimed || packet.status === 'returned' || packet.status === 'rejected';
  // 终态（已领取/已退回/已拒收）→ 显示原状态文案；待领取中 → 有祝福语显示祝福语、没写祝福语显示「待领取」（与转账卡留言规则一致）
  const rpNote = settled
    ? packet.status === 'returned'
      ? '已退回'
      : packet.status === 'rejected'
        ? '已拒收'
        : '已领取'
    : packet.note && packet.note.trim()
      ? packet.note
      : '待领取';
  return (
    <button
      type="button"
      data-testid="qq-rp-bubble"
      onClick={onClick}
      className="relative block w-[176px] overflow-hidden rounded-[14px] text-left shadow-lg shadow-black/15 transition-all duration-300 active:scale-[0.97]"
      style={{
        backgroundImage: 'linear-gradient(168deg, #FC8163 0%, #F5455C 55%, #F2394E 100%)',
        // 领取/退还/拒收后卡片颜色变灰（对照真实 QQ：已领取的红包封面褪色）
        filter: settled ? 'grayscale(0.62) brightness(0.97)' : undefined,
      }}
      aria-label={`QQ红包 ${rpNote}${settled ? '（已处理）' : ''}`}
    >
      {/* 封面纹样 */}
      <RpCoverPattern />
      <div className="relative flex flex-col items-center px-3 pt-[18px]">
        <RpPenguin size={34} />
        <span className="mt-0.5 text-[10px] font-semibold tracking-[0.32em] text-[#FBE7B2]/90" aria-hidden="true">QQ</span>
        <p className="mt-3 line-clamp-2 min-h-[26px] text-center text-[16px] font-medium leading-snug text-[#FFF3D6] [text-shadow:0_1px_2px_rgba(180,30,40,0.28)]">{rpNote}</p>
      </div>
      {/* 底部亮红大弧形（椭圆上缘成拱）+ 開 / QQ红包 */}
      <div className="relative mt-2 h-[64px]">
        <span className="absolute left-1/2 top-[18px] h-[130px] w-[280px] -translate-x-1/2 rounded-[50%]" style={{ backgroundColor: '#FF6E62' }} aria-hidden="true" />
        {showOpen ? (
          <span className="absolute left-1/2 top-[13px] grid h-11 w-11 -translate-x-1/2 place-items-center rounded-full bg-[#FBE7B2] shadow-md shadow-black/10" aria-hidden="true">
            <span className="text-[19px] font-bold leading-none text-[#D8332F]">開</span>
          </span>
        ) : (
          <span className="absolute inset-x-0 bottom-[9px] text-center text-[11px] font-medium tracking-[0.25em] text-[#FFE3C2]">QQ红包</span>
        )}
      </div>
    </button>
  );
}

/** 聊天中的转账卡片（蓝卡 圈↔/对勾/退还↩ + ¥金额 + 状态文案 + 底部「转账」；206px 与微信转账卡同宽；自己也作为「已收款/已退还」接收凭据卡复用）。
 *  状态文案按角色与收款状态区分：接收完成后才显示「已转入好友余额」，之前是「待对方收款」；
 *  待收款中：有转账留言时状态行优先显示留言（没写留言才显示状态文案，与微信端同规则）；
 *  终态（已收款/已退还/已拒收）：不再显示留言，改回显示原状态文案（与微信端同规则）；
 *  收款/退还/拒收后卡片颜色变灰（对照真实 QQ：终态卡褪色），退还卡圆图标换成↩ */
export function TransferBubble({ packet, mine, received, onClick }: { packet: MsgPacket; mine: boolean; received: boolean; onClick: () => void }) {
  const refunded = packet.status === 'returned';
  // 终态（已收款/已退还/已拒收）→ 显示原状态文案；待收款中 → 有留言显示留言、没写留言显示状态文案
  const settled = received || Boolean(packet.status);
  const status =
    refunded
      ? '已退还'
      : packet.status === 'rejected'
        ? '已拒收'
        : received
          ? mine
            ? '已转入好友余额'
            : '已收款'
          : mine
            ? '待对方收款'
            : '待你收款';
  return (
    <button
      type="button"
      data-testid="qq-transfer-bubble"
      onClick={onClick}
      className="block w-[206px] overflow-hidden rounded-[12px] text-left shadow-md shadow-black/10 transition-all duration-300 active:scale-[0.97]"
      style={{
        backgroundImage: 'linear-gradient(135deg, #29ABF2 0%, #0099FF 100%)',
        // 收款/退还/拒收后卡片颜色变灰（对照真实 QQ：已收款与已退还的转账卡都褪色）
        filter: received || packet.status ? 'grayscale(0.62) brightness(0.97)' : undefined,
      }}
      aria-label={`转账 ${fmtMoney(packet.amount)} 元（${status}）`}
    >
      <div className="flex items-center gap-2.5 px-3.5 pb-3 pt-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-white/85" aria-hidden="true">
          {refunded ? <Undo2 className="h-5 w-5 text-white" strokeWidth={2.4} /> : received ? <Check className="h-5 w-5 text-white" strokeWidth={2.6} /> : <ArrowLeftRight className="h-5 w-5 text-white" strokeWidth={2.2} />}
        </span>
        <span className="min-w-0">
          <span className="block text-[20px] font-semibold leading-tight text-white">¥{fmtMoney(packet.amount)}</span>
          <span className="mt-0.5 block truncate text-[13px] text-white/90" data-testid="qq-transfer-bubble-status">{!settled && packet.note && packet.note.trim() ? packet.note : status}</span>
        </span>
      </div>
      <div className="border-t border-white/25 px-3.5 py-1.5 text-[12.5px] text-white/95">转账</div>
    </button>
  );
}

/** 聊天中的亲属卡卡片（金卡 礼物图标 + 标题/状态 + 底部「亲属卡」；AI 赠送 / 领取状态展示） */
function FamilyBubble({ fam, mine, peerName, onClick }: { fam: QQFamData; mine: boolean; peerName: string; onClick: () => void }) {
  const status = fam.rejected ? '已退回' : fam.claimed ? (mine ? '对方已领取' : '已领取') : mine ? '待对方领取' : '待你领取';
  return (
    <button
      type="button"
      data-testid="qq-family-bubble"
      onClick={onClick}
      className="block w-[206px] overflow-hidden rounded-[12px] text-left shadow-md shadow-black/10 transition-all duration-300 active:scale-[0.97]"
      style={{
        backgroundImage: 'linear-gradient(135deg, #F7D488 0%, #EDB95E 100%)',
        // 领取/退回后卡片颜色变灰（与微信亲属卡一致）
        filter: fam.claimed || fam.rejected ? 'grayscale(0.62) brightness(0.97)' : undefined,
      }}
      aria-label={`亲属卡 每月额度${fam.monthlyLimit}元（${status}）`}
    >
      <div className="flex items-center gap-2.5 px-3.5 pb-3 pt-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-white/85" aria-hidden="true">
          <Gift className="h-5 w-5 text-white" strokeWidth={2.2} />
        </span>
        <span className="min-w-0">
          <span className="block text-[16px] font-semibold leading-tight text-white">{mine ? `给${peerName}的亲属卡` : '收到一张亲属卡'}</span>
          <span className="mt-0.5 block truncate text-[13px] text-white/90" data-testid="qq-family-bubble-status">{status}</span>
        </span>
      </div>
      <div className="border-t border-white/25 px-3.5 py-1.5 text-[12.5px] text-white/95">亲属卡</div>
    </button>
  );
}

/**
 * 群聊邀请卡片（AI 主动建群/拉人时发出；QQ 蓝样式）：
 * pending = 副文案 + 接受/拒绝按钮（点「接受邀请」才进群）；accepted/rejected = 状态行（卡片本体不可点，不进群）。
 */
export function QqGroupCardBubble({
  card,
  onAccept,
  onReject,
}: {
  card: GroupCardData;
  onAccept: () => void;
  onReject: () => void;
}) {
  const rejected = card.status === 'rejected';
  return (
    <div
      data-testid="qq-group-card"
      className={`w-[248px] select-none overflow-hidden rounded-[10px] bg-white shadow-sm dark:bg-[#232426] ${rejected ? 'opacity-60' : ''}`}
    >
      {/* 卡片本体不可点击进群（需求：点卡片不进群，点「接受邀请」才算进群）；进群入口只有接受按钮 */}
      <div className="flex w-full items-center gap-2.5 px-3 pb-2.5 pt-3 text-left">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] bg-[#0099FF]/10 dark:bg-[#0099FF]/20"
        >
          <Users className="h-5 w-5 text-[#0099FF]" strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium leading-[1.3] text-black dark:text-white">{card.name}</span>
          <span className="mt-0.5 block truncate text-[12px] leading-[1.3] text-black/45 dark:text-white/45">
            {card.inviterName}邀请你加入群聊{card.memberNames.length > 1 ? `（${card.memberNames.slice(0, 3).join('、')}${card.memberNames.length > 3 ? '等' : ''}）` : ''}
          </span>
        </span>
      </div>
      {card.status === 'pending' ? (
        <div className="flex border-t border-black/[0.06] dark:border-white/[0.08]">
          <button
            type="button"
            data-testid="qq-group-card-reject"
            onClick={onReject}
            className="flex-1 py-2 text-[13.5px] text-black/55 active:bg-black/[0.04] dark:text-white/55 dark:active:bg-white/[0.06]"
          >
            拒绝
          </button>
          <button
            type="button"
            data-testid="qq-group-card-accept"
            onClick={onAccept}
            className="flex-1 border-l border-black/[0.06] py-2 text-[13.5px] font-medium text-[#0099FF] active:bg-black/[0.04] dark:border-white/[0.08] dark:active:bg-white/[0.06]"
          >
            接受邀请
          </button>
        </div>
      ) : (
        <div className="border-t border-black/[0.06] px-3 py-1.5 text-center text-[12px] text-black/40 dark:border-white/[0.08] dark:text-white/40">
          {rejected ? '已拒绝' : '已加入群聊'}
        </div>
      )}
    </div>
  );
}

/** 聊天系统通知行（居中小图标 + 灰字 + 彩色尾词，如「xx领取了你的红包」） */
export function QQNoticeRow({ icon, pre, accent }: { icon: 'rp' | 'tr' | 'fam'; pre: string; accent: string }) {
  return (
    <div className="mb-3 flex justify-center" data-testid="qq-notice-row">
      <span className="flex max-w-[86%] items-center gap-1.5 text-[12.5px] text-black/45 dark:text-white/45">
        {icon === 'rp' ? (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(168deg, #FC8163, #F2394E)' }}
          >
            <RpIcon className="h-[11px] w-[11px] text-white" />
          </span>
        ) : icon === 'tr' ? (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(135deg, #29ABF2, #0099FF)' }}
          >
            <ArrowLeftRight className="h-[10px] w-[10px] text-white" strokeWidth={2.6} />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(135deg, #F7D488, #EDB95E)' }}
          >
            <Gift className="h-[10px] w-[10px] text-white" strokeWidth={2.4} />
          </span>
        )}
        <span className="truncate">{pre}</span>
        <span className="shrink-0" style={{ color: icon === 'rp' ? '#F5455C' : icon === 'tr' ? '#0099FF' : '#E8912D' }}>
          {accent}
        </span>
      </span>
    </div>
  );
}

/** 发红包页（对照截图②：普通/拼手气/专属 tab + 单个金额 + 祝福语 + 封面 + 支付方式[余额/银行卡] + 大金额 + 塞钱进红包）。
 *  单聊/群聊共用：传入 members（群成员清单）即启用群模式 —— 普通红包支持多个个数、专属红包需从群成员里选收款人
 *  （packet 带上 toId/toName；群模式普通红包 count>1 时实际扣款 = 单个金额×个数，由调用方计） */
export function RedPacketCompose({ wallet, cards, onToast, onClose, onSend, members }: { wallet: WalletData; cards: BankCard[]; onToast: (m: string) => void; onClose: () => void; onSend: (p: MsgPacket, methodId: string) => void; members?: ContactRecord[] }) {
  const [tab, setTab] = useState<'normal' | 'lucky' | 'dedicated'>('normal');
  const [amount, setAmount] = useState('');
  const [count, setCount] = useState('1');
  const [note, setNote] = useState('恭喜发财');
  const [methodId, setMethodId] = useState('balance');
  const [methodOpen, setMethodOpen] = useState(false);
  const [target, setTarget] = useState<ContactRecord | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const methodCard = cards.find((c) => c.id === methodId) ?? null;
  const num = Math.round((parseFloat(amount) || 0) * 100) / 100;
  const cnt = Math.min(100, Math.max(1, Math.round(parseFloat(count) || 1)));
  const total = num;
  const groupMode = Array.isArray(members) && members.length > 0;
  const ok = num > 0 && (tab !== 'lucky' || cnt >= 1) && (tab !== 'dedicated' || !groupMode || target != null);
  const tabLabel = (t: 'normal' | 'lucky' | 'dedicated'): string => (t === 'normal' ? '普通' : t === 'lucky' ? '拼手气红包' : '专属红包');
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="发红包" onBack={onClose} />
      {/* tab 行 */}
      <div className="flex shrink-0 items-center gap-7 px-6 pt-1">
        {(['normal', 'lucky', 'dedicated'] as const).map((t) => (
          <button key={t} type="button" data-testid={`qq-rp-tab-${t}`} onClick={() => setTab(t)} className="relative pb-2.5">
            <span className={`text-[16px] ${tab === t ? 'font-medium text-[#1F2329] dark:text-white' : 'text-black/45 dark:text-white/45'}`}>{tabLabel(t)}</span>
            {tab === t ? <span className="absolute inset-x-1 bottom-0 h-[3px] rounded-full bg-[#F5455C]" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        {/* 金额卡 */}
        <div className="flex h-[62px] items-center justify-between rounded-[14px] bg-white px-4 dark:bg-[#232529]">
          <span className="text-[16px] text-[#1F2329] dark:text-white">{tab === 'lucky' ? '总金额' : '单个金额'}</span>
          <span className="flex items-center gap-2">
            <input
              value={amount}
              inputMode="decimal"
              onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
              placeholder="0.00"
              aria-label="红包金额"
              data-testid="qq-rp-amount"
              className="w-[120px] bg-transparent text-right text-[20px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
            />
            <span className="text-[16px] text-[#1F2329] dark:text-white">元</span>
          </span>
        </div>
        {(tab === 'lucky' || (groupMode && tab === 'normal')) ? (
          <div className="mt-2.5 flex h-[62px] items-center justify-between rounded-[14px] bg-white px-4 dark:bg-[#232529]">
            <span className="text-[16px] text-[#1F2329] dark:text-white">红包个数</span>
            <span className="flex items-center gap-2">
              <input
                value={count}
                inputMode="numeric"
                onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 3))}
                aria-label="红包个数"
                data-testid="qq-rp-count"
                className="w-[120px] bg-transparent text-right text-[20px] text-[#1F2329] outline-none dark:text-white"
              />
              <span className="text-[16px] text-[#1F2329] dark:text-white">个</span>
            </span>
          </div>
        ) : null}
        {/* 专属红包收款成员（群模式限定：从群成员里选一个人领） */}
        {groupMode && tab === 'dedicated' ? (
          <button
            type="button"
            data-testid="qq-rp-target"
            onClick={() => setPickOpen(true)}
            className="mt-2.5 flex h-[62px] w-full items-center justify-between rounded-[14px] bg-white px-4 text-left active:bg-black/[0.03] dark:bg-[#232529] dark:active:bg-white/[0.05]"
          >
            <span className="text-[16px] text-[#1F2329] dark:text-white">指定成员</span>
            <span className="flex items-center gap-2">
              {target ? (
                <span className="flex items-center gap-1.5">
                  <QqAvatar src={target.avatar} alt={target.name} size={26} />
                  <span className="text-[15px] text-[#1F2329] dark:text-white">{target.name}</span>
                </span>
              ) : (
                <span className="text-[14px] text-black/35 dark:text-white/35">选择群成员</span>
              )}
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </span>
          </button>
        ) : null}
        {/* 祝福语 */}
        <div className="mt-2.5 flex h-[62px] items-center gap-3 rounded-[14px] bg-white px-4 dark:bg-[#232529]">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 20))}
            placeholder="恭喜发财"
            aria-label="红包祝福语"
            data-testid="qq-rp-note"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
          />
        </div>
        {/* 封面 */}
        <div className="mt-2.5 overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <button type="button" onClick={() => onToast('红包封面暂未开放')} className="flex w-full items-center px-4 py-3.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]">
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] text-[#1F2329] dark:text-white">红包封面</span>
              <span className="mt-0.5 block text-[13px] text-black/35 dark:text-white/35">默认</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
          <div className="border-t border-black/[0.04] dark:border-white/[0.06]" />
          <button type="button" onClick={() => onToast('领取更多红包封面暂未开放')} className="flex w-full items-center px-4 py-3.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]">
            <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">领取更多红包封面</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </div>
        {/* 支付方式 */}
        <div className="mt-2.5 overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <button type="button" data-testid="qq-rp-method" onClick={() => setMethodOpen(true)} className="flex w-full items-center px-4 py-3.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]">
            <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">支付方式</span>
            <span className="mr-1 max-w-[55%] truncate text-[14px] text-black/45 dark:text-white/45">
              {methodId === 'balance' ? `QQ钱包余额（可用 ${fmtMoney(wallet.balance)} 元）` : `${methodCard?.bank ?? ''}（尾号${methodCard?.last4 ?? ''}）`}
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </div>
        {/* 大金额 + 按钮 */}
        <div className="mt-10 text-center">
          <p className="text-[52px] font-bold leading-none tracking-tight text-[#1F2329] dark:text-white">
            <span className="mr-1 text-[30px] font-semibold align-[6px]" aria-hidden="true">¥</span>
            {num.toFixed(2)}
          </p>
          <button
            type="button"
            disabled={!ok}
            data-testid="qq-rp-send"
            onClick={() => {
              if (!ok) return;
              onSend({
                type: 'redpacket',
                amount: total,
                note: note.trim() || '恭喜发财',
                count: tab === 'lucky' || (groupMode && tab === 'normal') ? cnt : 1,
                mode: tab,
                claims: [],
                ...(groupMode && tab === 'dedicated' && target ? { toId: target.id, toName: target.name } : {}),
              }, methodId);
            }}
            style={{ backgroundColor: ok ? '#F5455C' : '#F8B9BE' }}
            className="mx-auto mt-6 block h-12 w-[240px] rounded-full text-[17px] font-medium text-white transition-colors duration-200 active:brightness-95"
          >
            塞钱进红包
          </button>
        </div>
      </div>
      <p className="shrink-0 pb-6 pt-3 text-center text-[13px] text-black/30 dark:text-white/30">未领取的红包，将于24小时后发起退款</p>
      {methodOpen ? (
        <PayMethodSheet
          wallet={wallet}
          cards={cards}
          selectedId={methodId}
          onClose={() => setMethodOpen(false)}
          onPick={(id) => {
            setMethodId(id);
            setMethodOpen(false);
          }}
        />
      ) : null}
      {/* 指定成员选择 sheet（群模式专属红包：只有被选中的成员能领） */}
      {pickOpen && members ? (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" onClick={() => setPickOpen(false)} data-testid="qq-rp-target-sheet">
          <div className="max-h-[62%] overflow-hidden rounded-t-[16px] bg-white dark:bg-[#232529]" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 pb-2 pt-4 text-[15px] font-medium text-[#1F2329] dark:text-white">选择指定成员（只有 TA 能领这个红包）</div>
            <div className="max-h-[52vh] overflow-y-auto pb-6">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`qq-rp-target-${m.id}`}
                  onClick={() => {
                    setTarget(m);
                    setPickOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  <QqAvatar src={m.avatar} alt={m.name} size={38} />
                  <span className="min-w-0 flex-1 truncate text-[15px] text-[#1F2329] dark:text-white">{m.name}</span>
                  {target?.id === m.id ? <Check className="h-5 w-5 shrink-0 text-[#0099FF]" aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 向好友转账页（对照截图①：转账给 头像/QQ号 + 金额卡 + 留言 0/12 + 支付方式[余额/银行卡] + 转账按钮 + 防诈提示） */
export function TransferCompose({ peer, wallet, cards, onToast, onClose, onSend }: { peer: ContactRecord; wallet: WalletData; cards: BankCard[]; onToast: (m: string) => void; onClose: () => void; onSend: (p: MsgPacket, methodId: string) => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [methodId, setMethodId] = useState('balance');
  const [methodOpen, setMethodOpen] = useState(false);
  const methodCard = cards.find((c) => c.id === methodId) ?? null;
  const num = Math.round((parseFloat(amount) || 0) * 100) / 100;
  const ok = num > 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="向好友转账" onBack={onClose} />
      <div className="flex-1 overflow-y-auto px-4 pt-4">
        <div className="flex items-center gap-3 px-1 py-2">
          <QqAvatar src={peer.avatar} alt={peer.name} size={52} />
          <div className="min-w-0">
            <p className="truncate text-[19px] font-medium text-[#1F2329] dark:text-white">转账给 {peer.name}</p>
            <p className="mt-0.5 truncate text-[14px] text-black/40 dark:text-white/40">QQ号：{peer.qqId ?? '暂无'}</p>
          </div>
        </div>
        <div className="mt-3 rounded-[16px] bg-white px-5 pb-4 pt-4 dark:bg-[#232529]">
          <p className="text-[17px] text-[#1F2329] dark:text-white">转账金额</p>
          <div className="mt-4 flex items-center gap-2 border-b border-black/[0.08] pb-5 dark:border-white/10">
            <span className="text-[40px] font-medium leading-none text-[#1F2329] dark:text-white" aria-hidden="true">¥</span>
            <input
              value={amount}
              inputMode="decimal"
              onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
              aria-label="转账金额"
              data-testid="qq-transfer-amount"
              className="w-full bg-transparent text-[40px] font-medium text-[#1F2329] outline-none dark:text-white"
            />
          </div>
          <div className="mt-3.5 flex items-center gap-3 pb-1">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 12))}
              placeholder="添加转账留言"
              aria-label="转账留言"
              data-testid="qq-transfer-note"
              className="min-w-0 flex-1 bg-transparent text-[17px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
            />
            <span className="shrink-0 text-[15px] text-black/35 dark:text-white/35">{note.length}/12</span>
          </div>
        </div>
        {/* 支付方式 */}
        <div className="mt-2.5 overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <button type="button" data-testid="qq-transfer-method" onClick={() => setMethodOpen(true)} className="flex w-full items-center px-4 py-3.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]">
            <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">支付方式</span>
            <span className="mr-1 max-w-[55%] truncate text-[14px] text-black/45 dark:text-white/45">
              {methodId === 'balance' ? `QQ钱包余额（可用 ${fmtMoney(wallet.balance)} 元）` : `${methodCard?.bank ?? ''}（尾号${methodCard?.last4 ?? ''}）`}
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          disabled={!ok}
          data-testid="qq-transfer-send"
          onClick={() => ok && onSend({ type: 'transfer', amount: num, note: note.trim() }, methodId)}
          className={`mx-auto mt-9 block h-[52px] w-[220px] rounded-[16px] text-[17px] font-medium text-white ${ok ? 'active:brightness-95' : ''}`}
          style={{ backgroundColor: ok ? QQ_BLUE : '#8AD4F7' }}
        >
          转账
        </button>
      </div>
      <p className="shrink-0 pb-6 pt-3 text-center text-[14px] text-black/30 dark:text-white/30">请务必确认对方真实身份，警惕电信网络诈骗</p>
      {methodOpen ? (
        <PayMethodSheet
          wallet={wallet}
          cards={cards}
          selectedId={methodId}
          onClose={() => setMethodOpen(false)}
          onPick={(id) => {
            setMethodId(id);
            setMethodOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** 红包开箱弹窗（对照截图②：近全屏大红卡 + 封面纹样 + 发红包人 + 祝福语 + 大「開」+ 弹窗外关闭） */
export function RedPacketOpenModal({ senderName, avatar, note, onOpen, onClose, onRefund }: { senderName: string; avatar: string | null; note: string; onOpen: () => void; onClose: () => void; onRefund?: () => void }) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/70 px-7 pb-12" role="dialog" aria-label="打开红包">
      <style>{'@keyframes qqRpModalIn{from{transform:scale(.86);opacity:0}to{transform:scale(1);opacity:1}}'}</style>
      <div
        className="relative h-[64vh] max-h-[600px] min-h-[430px] w-full max-w-[340px] overflow-hidden rounded-[22px] shadow-2xl"
        style={{ backgroundImage: 'linear-gradient(168deg, #FC8163 0%, #F5455C 55%, #F2394E 100%)', animation: 'qqRpModalIn 0.26s ease-out' }}
      >
        {/* 封面纹样 */}
        <RpCoverPattern />
        <div className="relative flex h-full flex-col items-center">
          <div className="h-[31%] shrink-0" aria-hidden="true" />
          <div className="flex items-center gap-2">
            <QqAvatar src={avatar} alt={senderName} size={28} />
            <p className="text-[16px] text-[#FFEFD2]">{senderName}发出的红包</p>
          </div>
          <p className="mt-8 text-[32px] font-medium tracking-wide text-[#FFF3D6] [text-shadow:0_2px_4px_rgba(180,30,40,0.3)]">{note}</p>
          <div className="flex-1" aria-hidden="true" />
          {/* 底部亮红大弧 + 開 */}
          <div className="relative h-[150px] w-full shrink-0">
            <span className="absolute left-1/2 top-[48px] h-[230px] w-[440px] -translate-x-1/2 rounded-[50%]" style={{ backgroundColor: '#FF6E62' }} aria-hidden="true" />
            <button
              type="button"
              data-testid="qq-rp-open"
              onClick={onOpen}
              className="absolute left-1/2 top-[24px] grid h-[92px] w-[92px] -translate-x-1/2 place-items-center rounded-full bg-[#FBE7B2] shadow-lg shadow-black/15 transition-transform active:scale-95"
              aria-label="开红包"
            >
              <span className="text-[40px] font-bold leading-none text-[#D8332F]">開</span>
            </button>
          </div>
        </div>
      </div>
      {/* 卡片下方：退还 + 关闭（退还可把对方发的红包原路退回） */}
      <div className="absolute bottom-9 left-1/2 flex -translate-x-1/2 items-center gap-4">
        {onRefund ? (
          <button
            type="button"
            data-testid="qq-rp-refund"
            onClick={onRefund}
            className="flex h-11 items-center rounded-full border-2 border-white/70 bg-black/20 px-6 text-[15px] font-medium text-white/90 active:opacity-70"
          >
            退还
          </button>
        ) : null}
        <button type="button" aria-label="关闭" data-testid="qq-rp-close" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full border-2 border-white/70 text-white/90 active:opacity-60">
          <X className="h-5 w-5" strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

/** 红包详情页（对照真机：全屏沉浸红头直达状态栏[导航+封面纹样+金色封套标+发送人+祝福语+金色金额] + 下方领取统计与列表，拼手气含手气最佳） */
function RedPacketDetailPage({ me, peer, msg, onBack, onToast }: { me: QQUser; peer: ContactRecord; msg: QQMsg; onBack: () => void; onToast: (m: string) => void }) {
  const p = msg.packet;
  if (!p) return null;
  const mine = msg.role === 'me';
  const senderName = mine ? me.name : peer.name;
  const avatar = mine ? me.avatar : peer.avatar;
  const claims = p.claims ?? [];
  const claimedTotal = claims.reduce((s, c) => s + c.amount, 0);
  const count = p.count ?? 1;
  const myClaim = claims.find((c) => c.name === me.name);
  const best = claims.length > 1 ? Math.max(...claims.map((c) => c.amount)) : -1;
  const fmtT = (ts: number): string => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col overflow-hidden bg-[#F5F6F8] dark:bg-[#16171A]">
      {/* 全屏沉浸红色头部（含状态栏区）：导航 + 封套标 + 发送人 + 祝福语 + 金额 */}
      <div
        className="relative shrink-0 px-3 pb-20 pt-[54px]"
        style={{ borderBottomLeftRadius: '46% 54px', borderBottomRightRadius: '46% 54px', backgroundImage: 'linear-gradient(172deg, #FD8A67 0%, #F5455C 58%, #EE3A50 100%)', boxShadow: '0 12px 26px rgba(214,52,66,0.25)' }}
      >
        <RpCoverPattern />
        <div className="relative flex h-11 items-center px-1">
          <button type="button" aria-label="返回" data-testid="qq-wallet-back" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full text-white/95 active:bg-white/15">
            <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.4} />
          </button>
          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[17px] font-medium text-white">QQ红包</span>
          <button type="button" onClick={() => onToast('红包记录暂未开放')} className="ml-auto mr-1 text-[15px] text-white/95 active:opacity-60">红包记录</button>
        </div>
        <div className="relative mt-4 flex flex-col items-center" data-testid="qq-rp-detail-head">
          <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[#FBE7B2]/20 px-3 py-1 text-[12px] tracking-[0.2em] text-[#FFE9B8] ring-1 ring-inset ring-[#FBE7B2]/40" aria-hidden="true">
            <RpIcon className="h-3.5 w-3.5" />
            QQ红包
          </span>
          <div className="flex items-center gap-2">
            <QqAvatar src={avatar} alt={senderName} size={34} />
            <p className="text-[18px] font-medium text-[#FFF3D6]">{senderName}发送的红包</p>
          </div>
          <p className="mt-2 text-[15px] text-[#FFE3C2]/85">{p.note}</p>
          <p className="mt-6 text-[48px] font-bold leading-none tracking-tight text-[#FFE9B8] [text-shadow:0_2px_8px_rgba(170,25,40,0.4)]" data-testid="qq-rp-detail-amount">
            <span className="mr-1 align-[6px] text-[26px] font-semibold" aria-hidden="true">¥</span>
            {fmtMoney(claims.length > 0 ? claimedTotal : p.amount)}
          </p>
          {myClaim ? (
            <span className="mt-3 rounded-full bg-[#FBE7B2]/20 px-3.5 py-1.5 text-[14px] text-[#FFE9B8] ring-1 ring-inset ring-[#FBE7B2]/35">收到的红包已存入余额</span>
          ) : mine && claims.length > 0 ? (
            <p className="mt-3 text-[14px] text-[#FFE3C2]/75">好友领取后自动存入其余额</p>
          ) : p.status === 'returned' ? (
            <p className="mt-3 text-[14px] text-[#FFE3C2]/85" data-testid="qq-rp-detail-refunded">红包已退回，金额已存入钱包余额</p>
          ) : p.status === 'rejected' ? (
            <p className="mt-3 text-[14px] text-[#FFE3C2]/85" data-testid="qq-rp-detail-rejected">对方拒收了该红包</p>
          ) : null}
        </div>
      </div>
      <div className="relative -mt-10 flex-1 overflow-y-auto px-4 pb-8">
        <div className="rounded-[12px] bg-[#EDEEF0] px-4 py-2.5 dark:bg-white/[0.06]">
          <p className="text-[14px] text-black/45 dark:text-white/45" data-testid="qq-rp-detail-stat">
            {count}个红包，
            {p.status === 'returned'
              ? '已退回'
              : p.status === 'rejected'
                ? '已拒收'
                : claims.length >= count
                  ? '已领完'
                  : claims.length > 0
                    ? `已领${claims.length}个`
                    : '等待领取'}
            ，共{fmtMoney(claims.length > 0 ? claimedTotal : p.amount)}元
          </p>
        </div>
        <div className="mt-2 overflow-hidden rounded-[14px] bg-white shadow-sm shadow-black/[0.04] dark:bg-[#232529]">
          {claims.length === 0 ? (
            <p className="py-10 text-center text-[14px] text-black/35 dark:text-white/35">好友领取后将展示在这里</p>
          ) : (
            claims.map((c, i) => {
              const isBest = p.mode === 'lucky' && claims.length > 1 && c.amount === best;
              return (
                <div key={`${c.name}-${c.ts}-${i}`} className={`flex h-[64px] items-center gap-3 px-4 ${i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.06]' : ''}`}>
                  <QqAvatar src={c.avatar} alt={c.name} size={38} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-[16px] text-[#1F2329] dark:text-white">
                      {c.name}
                      {isBest ? <span className="shrink-0 rounded bg-gradient-to-r from-[#F5B96A] to-[#E8912D] px-1.5 py-0.5 text-[10px] font-medium text-white" aria-hidden="true">手气最佳</span> : null}
                    </p>
                    <p className="text-[13px] text-black/35 dark:text-white/35">{fmtT(c.ts)}</p>
                  </div>
                  <span className={`shrink-0 text-[16px] ${isBest ? 'font-semibold text-[#E8912D] dark:text-[#F0B25E]' : 'text-[#1F2329] dark:text-white'}`}>{fmtMoney(c.amount)}元</span>
                </div>
              );
            })
          )}
        </div>
        <p className="mt-4 px-1 text-[12px] leading-relaxed text-black/35 dark:text-white/35">未领取的红包，将于24小时后发起退款；红包金额仅在本机演示环境流转。</p>
      </div>
    </div>
  );
}

/** 收款页（点对方发来的未收款转账卡片进入，对照微信收款页：蓝圈时钟 + 待你收款 + 金额 + 转账时间 + 收款按钮 + 退还提示） */
function TransferReceivePage({
  peer,
  msg,
  onBack,
  onAccept,
  onRefund,
}: {
  peer: ContactRecord;
  msg: QQMsg;
  onBack: () => void;
  onAccept: (msgId: string) => void;
  onRefund: () => void;
}) {
  const p = msg.packet;
  if (!p) return null;
  const d = new Date(msg.time);
  const fmtFull = `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日 ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white pt-[54px] dark:bg-[#16171A]" data-testid="qq-tr-receive">
      {/* 顶部：仅返回键（对照收款页） */}
      <div className="flex h-11 shrink-0 items-center px-2">
        <button type="button" aria-label="返回" data-testid="qq-tr-receive-back" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full text-[#1F2329] active:bg-black/[0.06] dark:text-white">
          <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.4} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8">
        <div className="mt-[10vh] flex flex-col items-center">
          <Clock className="h-[76px] w-[76px] text-[#12B7F5]" strokeWidth={1.6} aria-hidden="true" />
          <p className="mt-7 text-[17px] text-[#1F2329] dark:text-white" data-testid="qq-tr-receive-status">
            {peer.name}向你转账，待你收款
          </p>
          <p className="mt-5 text-[48px] font-bold leading-none tracking-tight text-[#1F2329] dark:text-white" data-testid="qq-tr-receive-amount">
            <span className="mr-1 align-[5px] text-[26px] font-semibold" aria-hidden="true">¥</span>
            {fmtMoney(p.amount)}
          </p>
        </div>
        <div className="mt-12 border-t border-black/[0.08] px-1 dark:border-white/10">
          <div className="flex min-h-[54px] items-center justify-between gap-4">
            <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">转账时间</span>
            <span className="text-[16px] text-[#1F2329] dark:text-white">{fmtFull}</span>
          </div>
          {p.note ? (
            <div className="flex min-h-[54px] items-center justify-between gap-4">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">转账留言</span>
              <span className="min-w-0 truncate text-[16px] text-[#1F2329] dark:text-white">{p.note}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 px-12 pb-9">
        <button
          type="button"
          data-testid="qq-tr-receive-accept"
          onClick={() => onAccept(msg.id)}
          className="mx-auto block h-11 w-[62%] rounded-[10px] text-[17px] font-medium text-white active:brightness-95"
          style={{ backgroundColor: QQ_BLUE }}
        >
          收款
        </button>
        <p className="mt-4 text-center text-[13.5px] text-black/40 dark:text-white/40">
          1天内未确认，将退还给对方。{' '}
          <button type="button" onClick={onRefund} className="text-[#12B7F5] active:opacity-60" data-testid="qq-tr-receive-refund">
            退还
          </button>
        </p>
      </div>
    </div>
  );
}

/** 交易详情页（对照截图⑥：蓝圈对勾 + 收款文案 + 金额 + 查看余额 + 留言/时间）。
 *  退还态：琥珀圈↩ + 「你已退还/对方已退还」+ 退款时间行。
 *  receiverIsMe 由调用方按消息角色 + receiptOf + 旧数据配对推导：文案区分「你已收款 / XX已收款」；
 *  退还人：退还凭据卡自带 refundedBy，原卡按消息角色反推（我发的→对方退的；对方发的→我退的） */
function TransferDetailPage({ me, peer, msg, receiverIsMe, onBack, onToast, onAccept }: { me: QQUser; peer: ContactRecord; msg: QQMsg; receiverIsMe: boolean; onBack: () => void; onToast: (m: string) => void; onAccept: (msgId: string) => void }) {
  const p = msg.packet;
  if (!p) return null;
  const mine = msg.role === 'me';
  const incoming = !mine;
  const returned = p.status === 'returned';
  const fmtFull = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="交易详情" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5">
        <div className="mt-14 flex flex-col items-center">
          <span className={`grid h-[72px] w-[72px] place-items-center rounded-full border-[4px] ${returned ? 'border-[#F6AC3D]' : 'border-[#12B7F5]'}`} aria-hidden="true">
            {returned ? <Undo2 className="h-9 w-9 text-[#F6AC3D]" strokeWidth={2.6} /> : <Check className="h-9 w-9 text-[#12B7F5]" strokeWidth={3} />}
          </span>
          <p className="mt-6 text-[17px] text-[#1F2329] dark:text-white" data-testid="qq-tr-detail-line">
            {returned
              ? (p.refundedBy ?? (mine ? 'peer' : 'me')) === 'peer'
                ? '对方已退还'
                : '你已退还'
              : receiverIsMe
                ? '你已收款，资金已存入钱包余额'
                : mine
                  ? p.status === 'rejected'
                    ? '对方已拒收'
                    : p.received
                      ? `${peer.name}已收款`
                      : '转账成功，等待对方收款'
                  : incoming && !p.received && !p.status
                    ? `${peer.name}向你转账，待收款`
                    : `${peer.name}已收款`}
          </p>
          <p className="mt-5 text-[48px] font-bold leading-none tracking-tight text-[#1F2329] dark:text-white" data-testid="qq-tr-detail-amount">
            <span className="mr-1 text-[26px] font-semibold align-[5px]" aria-hidden="true">¥</span>
            {fmtMoney(p.amount)}
          </p>
          {incoming && !p.received && !p.status ? (
            <button
              type="button"
              data-testid="qq-tr-detail-accept"
              onClick={() => {
                // 收款：标记 received + 入钱包余额（写账单）；卡片与详情同步更新
                onAccept(msg.id);
                gainToWallet(p.amount, '转账收入');
                onToast(`已收款 ${fmtMoney(p.amount)} 元`);
              }}
              className="mt-4 h-10 w-[140px] rounded-full text-[16px] font-medium text-white active:brightness-95"
              style={{ backgroundColor: QQ_BLUE }}
            >
              收款
            </button>
          ) : (
            <button type="button" onClick={() => onToast('余额请前往钱包-余额查看')} className="mt-4 text-[16px] text-[#12B7F5] active:opacity-60">
              查看余额
            </button>
          )}
        </div>
        <div className="mt-10 border-t border-black/[0.08] px-1 dark:border-white/10">
          <div className="flex min-h-[54px] items-center justify-between gap-4">
            <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">转账留言</span>
            <span className="truncate text-[16px] text-[#1F2329] dark:text-white">{p.note || 'QQ转账'}</span>
          </div>
          <div className="flex min-h-[54px] items-center justify-between gap-4">
            <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">转账时间</span>
            {/* 退还凭据卡显示原转账发生时间（originTime），原卡显示消息自身时间 */}
            <span className="text-[16px] text-[#1F2329] dark:text-white">{fmtFull(returned ? (p.originTime ?? msg.time) : msg.time)}</span>
          </div>
          {returned && typeof p.refundedAt === 'number' && (
            <div className="flex min-h-[54px] items-center justify-between gap-4" data-testid="qq-tr-refund-time-row">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">退款时间</span>
              <span className="text-[16px] text-[#1F2329] dark:text-white">{fmtFull(p.refundedAt)}</span>
            </div>
          )}
          {!mine ? (
            <div className="flex min-h-[54px] items-center justify-between gap-4">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">对方</span>
              <span className="text-[16px] text-[#1F2329] dark:text-white">{peer.name}（QQ号 {peer.qqId ?? '暂无'}）</span>
            </div>
          ) : (
            <div className="flex min-h-[54px] items-center justify-between gap-4">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">收款方</span>
              <span className="text-[16px] text-[#1F2329] dark:text-white">{peer.name}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 亲属卡详情页（AI 赠送 / 状态展示）：金卡 + 关系/每月额度/留言 + 领取/退还按钮（对方发的未领取时） */
function FamilyDetailPage({
  peer,
  msg,
  onBack,
  onToast,
  onClaim,
  onRefund,
}: {
  peer: ContactRecord;
  msg: QQMsg;
  onBack: () => void;
  onToast: (m: string) => void;
  onClaim: (msgId: string) => void;
  /** 退还（拒收）对方送的亲属卡（仅对方发的未领取卡片传入） */
  onRefund?: (msgId: string) => void;
}) {
  const f = msg.fam;
  if (!f) return null;
  const mine = msg.role === 'me';
  const d = msg.fam?.claimedAt ? new Date(msg.fam.claimedAt) : null;
  const fmtFull = d
    ? `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`
    : '';
  const claimable = !mine && !f.claimed && !f.rejected;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="亲属卡" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5">
        <div
          className="mt-8 overflow-hidden rounded-[16px] shadow-lg shadow-black/10"
          style={{ backgroundImage: 'linear-gradient(150deg, #F7D488 0%, #EDB95E 60%, #E3A94B 100%)' }}
          data-testid="qq-family-detail-card"
        >
          <div className="flex items-center gap-3 px-5 pb-4 pt-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-white/85" aria-hidden="true">
              <Gift className="h-6 w-6 text-white" strokeWidth={2.1} />
            </span>
            <div className="min-w-0">
              <p className="text-[17px] font-semibold leading-tight text-white">{mine ? `给${peer.name}的亲属卡` : `${peer.name}送给你的亲属卡`}</p>
              <p className="mt-0.5 text-[12.5px] text-white/90">关系：{f.relation}</p>
            </div>
          </div>
          <div className="mx-5 mb-4 rounded-[12px] bg-white/22 px-4 py-3">
            <p className="text-[12.5px] text-white/90">每月消费上限</p>
            <p className="mt-0.5 text-[30px] font-bold leading-none text-white" data-testid="qq-family-detail-limit">
              ¥{fmtMoney(f.monthlyLimit)}
            </p>
            {f.message && <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-white/95">“{f.message}”</p>}
          </div>
          <div className="border-t border-white/25 px-5 py-2 text-[12px] text-white/95">亲属卡 · 消费由赠卡方代付（模拟）</div>
        </div>

        <div className="mt-5 border-t border-black/[0.08] px-1 dark:border-white/10">
          <div className="flex min-h-[52px] items-center justify-between gap-4">
            <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">状态</span>
            <span className="text-[16px] text-[#1F2329] dark:text-white" data-testid="qq-family-detail-status">
              {f.rejected ? '已退回' : f.claimed ? '已领取' : mine ? '待对方领取' : '待你领取'}
            </span>
          </div>
          {f.claimed && fmtFull && (
            <div className="flex min-h-[52px] items-center justify-between gap-4">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">领取时间</span>
              <span className="text-[16px] text-[#1F2329] dark:text-white">{fmtFull}</span>
            </div>
          )}
        </div>

        {claimable && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              data-testid="qq-family-detail-claim"
              onClick={() => {
                onClaim(msg.id);
                onToast('已领取亲属卡，对方为你买单（模拟）');
              }}
              className="block h-11 w-[150px] rounded-full text-[16px] font-medium text-white active:brightness-95"
              style={{ backgroundColor: QQ_BLUE }}
            >
              领取
            </button>
            {onRefund ? (
              <button
                type="button"
                data-testid="qq-family-detail-refund"
                onClick={() => onRefund(msg.id)}
                className="block h-11 w-[150px] rounded-full border border-black/15 bg-white text-[16px] font-medium text-[#1F2329] active:bg-black/[0.04] dark:border-white/15 dark:bg-transparent dark:text-white"
              >
                退还
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- 位置（发送位置页 + 聊天位置卡片） ----------------

/** 位置卡片假地图（位置气泡 / 发送位置页顶部预览复用；CSS 路网 + 大头针） */
function MapPreview({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <span className={`relative block overflow-hidden bg-[#E9F1E6] ${className}`} aria-hidden="true">
      {/* 路网纹理 */}
      <span
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(90deg, rgba(255,255,255,0.85) 2px, transparent 2px), linear-gradient(0deg, rgba(255,255,255,0.85) 2px, transparent 2px)',
          backgroundSize: '56px 44px',
        }}
      />
      <span className="absolute inset-x-0 top-[46%] h-[10px] -rotate-6 bg-[#FBD7A8]/90" />
      <span className="absolute inset-y-0 left-[38%] w-[8px] rotate-3 bg-[#CBE3F8]/90" />
      <span className="absolute right-[12%] top-[16%] h-10 w-16 rounded-[10px] bg-[#C8E6C1]/90" />
      <span className="absolute bottom-[12%] left-[8%] h-8 w-12 rounded-[8px] bg-[#C8E6C1]/80" />
      {/* 中心大头针 */}
      <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-full flex-col items-center">
        <MapPin className="h-7 w-7 drop-shadow" strokeWidth={2.2} style={{ color: '#F0605C' }} />
        <span className="-mt-0.5 h-1.5 w-1.5 rounded-full bg-black/20" />
      </span>
      {label ? <span className="absolute bottom-2 left-2 rounded-md bg-white/95 px-2 py-1 text-[11px] text-[#1F2329] shadow-sm">{label}</span> : null}
    </span>
  );
}

/** 聊天中的位置卡片（上地图下信息，对照 QQ 位置消息；单聊/群聊共用） */
export function LocationBubble({ loc, onClick }: { loc: MsgLoc; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="qq-loc-bubble"
      onClick={onClick}
      className="block w-[228px] overflow-hidden rounded-[12px] text-left shadow-md shadow-black/10 transition-transform active:scale-[0.97]"
      aria-label={`位置 ${loc.name}`}
    >
      <MapPreview className="h-[104px] w-full" label={loc.name} />
      <span className="block bg-white px-3 py-2.5 dark:bg-[#2A2C31]">
        <span className="block truncate text-[15px] font-medium text-[#1F2329] dark:text-white">{loc.name}</span>
        <span className="mt-0.5 block truncate text-[12px] text-black/40 dark:text-white/40">{loc.addr}</span>
      </span>
    </button>
  );
}

/** 内置常用位置（发送位置页；与用户资料地域杭州呼应） */
const LOC_PRESETS: Array<{ name: string; addr: string; lat?: number; lng?: number; dist: string }> = [
  { name: '东方通信大厦', addr: '浙江省杭州市西湖区文三路398号', lat: 30.2787, lng: 120.1244, dist: '172米' },
  { name: '西湖风景名胜区', addr: '浙江省杭州市西湖区龙井路1号', lat: 30.2429, lng: 120.1476, dist: '3.6公里' },
  { name: '湖滨银泰in77', addr: '浙江省杭州市上城区延安路98号', lat: 30.253, lng: 120.163, dist: '5.4公里' },
  { name: '钱江新城城市阳台', addr: '浙江省杭州市上城区之江路888号', lat: 30.248, lng: 120.214, dist: '8.2公里' },
  { name: '滨江宝龙城', addr: '浙江省杭州市滨江区滨盛路3822号', lat: 30.185, lng: 120.195, dist: '9.8公里' },
  { name: '三里屯太古里', addr: '北京市朝阳区三里屯路19号', lat: 39.9368, lng: 116.4472, dist: '1200公里' },
  { name: '陆家嘴环球金融中心', addr: '上海市浦东新区世纪大道100号', lat: 31.2354, lng: 121.5057, dist: '1640公里' },
];

/** 发送位置页（内置地点一键发送 + 自定义位置表单，发送后聊天内出现位置卡片；单聊/群聊共用） */
export function LocationPickerPage({ onClose, onSend }: { onClose: () => void; onSend: (loc: MsgLoc) => void }) {
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState('');
  const [addr, setAddr] = useState('');
  const ok = name.trim().length > 0 && addr.trim().length > 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]" data-testid="qq-loc-page">
      <WalletNavHeader title="发送位置" onBack={onClose} />
      {custom ? (
        <>
          <div className="flex-1 overflow-y-auto px-4 pt-4">
            <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
              <div className="border-b border-black/[0.04] px-4 py-3 dark:border-white/[0.06]">
                <p className="text-[12px] text-black/40 dark:text-white/40">位置名称</p>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 20))}
                  placeholder="如：公司、家、学校"
                  aria-label="位置名称"
                  data-testid="qq-loc-name"
                  className="mt-1 h-7 w-full bg-transparent text-[16px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
                />
              </div>
              <div className="px-4 py-3">
                <p className="text-[12px] text-black/40 dark:text-white/40">详细地址</p>
                <input
                  value={addr}
                  onChange={(e) => setAddr(e.target.value.slice(0, 40))}
                  placeholder="街道、门牌号等"
                  aria-label="详细地址"
                  data-testid="qq-loc-addr"
                  className="mt-1 h-7 w-full bg-transparent text-[16px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
                />
              </div>
            </div>
            <p className="px-1 pt-4 text-[12px] leading-relaxed text-black/35 dark:text-white/35">位置信息仅在本机演示环境使用，发送后以卡片形式出现在聊天中。</p>
          </div>
          <div className="px-4 pb-[30px] pt-3">
            <button
              type="button"
              disabled={!ok}
              data-testid="qq-loc-custom-send"
              onClick={() => ok && onSend({ name: name.trim(), addr: addr.trim() })}
              className={`h-12 w-full rounded-full text-[16px] font-medium text-white ${ok ? 'bg-[#1B9FF0] active:opacity-85' : 'bg-[#9FD6FA]'}`}
            >
              发送位置
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto pb-6">
            <div className="px-4 pt-3">
              <MapPreview className="h-[168px] w-full rounded-[14px] shadow-sm" label="当前所在位置" />
            </div>
            <button
              type="button"
              data-testid="qq-loc-custom"
              onClick={() => setCustom(true)}
              className="mt-3 flex h-14 w-full items-center gap-3 bg-white px-4 text-left active:bg-black/[0.03] dark:bg-[#232529] dark:active:bg-white/[0.05]"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[#1B9FF0]/10 text-[#1B9FF0]" aria-hidden="true">
                <SquarePen className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </span>
              <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">自定义位置</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
            <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">附近位置</p>
            <div className="overflow-hidden bg-white dark:bg-[#232529]">
              {LOC_PRESETS.map((l, i) => (
                <button
                  key={l.name}
                  type="button"
                  data-testid={`qq-loc-item-${i}`}
                  onClick={() => onSend({ name: l.name, addr: l.addr, lat: l.lat, lng: l.lng })}
                  className={`flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05] ${i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.06]' : ''}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] text-[#1F2329] dark:text-white">{l.name}</span>
                    <span className="mt-0.5 block truncate text-[13px] text-black/40 dark:text-white/40">{l.addr}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-black/35 dark:text-white/35">{l.dist}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- 支付方式 / 支付密码（红包/转账付款 + 微信风格自绘键盘） ----------------

/** 支付方式选择底部弹层（QQ钱包余额 / 银行卡，发红包/转账页用） */
export function PayMethodSheet({ wallet, cards, selectedId, onClose, onPick }: { wallet: WalletData; cards: BankCard[]; selectedId: string; onClose: () => void; onPick: (id: string) => void }) {
  const rows: Array<{ id: string; name: string; sub: string; node: React.ReactNode }> = [
    {
      id: 'balance',
      name: 'QQ钱包余额',
      sub: `可用 ${fmtMoney(wallet.balance)} 元`,
      node: (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#1B9FF0] text-white" aria-hidden="true">
          <Wallet className="h-[18px] w-[18px]" strokeWidth={2} />
        </span>
      ),
    },
    ...cards.map((c) => {
      const meta = BANK_META[c.bank] ?? BANK_FALLBACK;
      return {
        id: c.id,
        name: `${c.bank} ${c.type ?? '储蓄卡'}`,
        sub: `尾号${c.last4} · 可用 ${fmtMoney(c.balance ?? 0)} 元`,
        node: (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[14px] font-semibold text-white" style={{ backgroundImage: `linear-gradient(135deg, ${meta.from}, ${meta.to})` }} aria-hidden="true">
            {c.bank.slice(0, 1)}
          </span>
        ),
      };
    }),
  ];
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label="选择支付方式" onClick={onClose}>
      <div className="rounded-t-[18px] bg-white px-4 pb-8 pt-3 dark:bg-[#232529]" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" aria-hidden="true" />
        <p className="py-1 text-center text-[16px] font-medium text-[#1F2329] dark:text-white">选择支付方式</p>
        <div className="mt-1 max-h-[320px] overflow-y-auto">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              data-testid={`qq-pay-method-${r.id === 'balance' ? 'balance' : (cards.find((c) => c.id === r.id)?.last4 ?? r.id)}`}
              onClick={() => onPick(r.id)}
              className="flex w-full items-center gap-3 rounded-[12px] px-2 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              {r.node}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-[#1F2329] dark:text-white">{r.name}</span>
                <span className="block text-[12px] text-black/40 dark:text-white/40">{r.sub}</span>
              </span>
              {selectedId === r.id ? <Check className="h-5 w-5 shrink-0 text-[#1B9FF0]" strokeWidth={2.5} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} className="mt-2 h-11 w-full rounded-full bg-black/[0.05] text-[15px] text-[#1F2329] active:opacity-70 dark:bg-white/10 dark:text-white">
          取消
        </button>
      </div>
    </div>
  );
}

/** 微信风格 6 位支付密码自绘数字键盘（不唤起系统键盘；校验逻辑由父级完成，errorKey 变化时父级重挂载本组件 → 清空并抖动） */
function PayPwdSheet({ title, sub, hint, errorKey, onComplete, onClose }: { title: string; sub?: string; hint?: string; errorKey: number; onComplete: (pwd: string) => void; onClose: () => void }) {
  const [digits, setDigits] = useState('');
  // 用 ref 累加避免同一 tick 内连点被 React 批处理吞掉（每次 push 都基于最新串）
  const acc = useRef('');
  const push = (d: string) => {
    const next = (acc.current + d).slice(0, 6);
    acc.current = next;
    setDigits(next);
    if (next.length === 6) {
      const done = next;
      acc.current = '';
      window.setTimeout(() => onComplete(done), 150);
    }
  };
  const keyBtn =
    'flex h-[52px] items-center justify-center bg-white text-[22px] font-medium text-[#1F2329] active:bg-black/[0.07] dark:bg-[#2A2C31] dark:text-white dark:active:bg-white/10';
  return (
    <div className="rounded-t-[18px] bg-[#F2F3F5] pb-7 dark:bg-[#1B1C1F]" onClick={(e) => e.stopPropagation()} data-testid="qq-keypad">
      <style>{'@keyframes qqShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(4px)}}'}</style>
      <div className="relative flex h-12 items-center justify-center border-b border-black/[0.06] dark:border-white/[0.08]">
        <button type="button" aria-label="关闭" data-testid="qq-keypad-close" onClick={onClose} className="absolute left-3 grid h-8 w-8 place-items-center rounded-full text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10">
          <X className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <p className="text-[16px] font-medium text-[#1F2329] dark:text-white">{title}</p>
      </div>
      {sub ? <p className="pb-1 pt-2 text-center text-[13px] text-black/45 dark:text-white/45">{sub}</p> : null}
      <div className="mx-auto mt-2 flex w-fit gap-2.5" style={errorKey > 0 ? { animation: 'qqShake 0.46s' } : undefined}>
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="grid h-11 w-10 place-items-center rounded-[8px] border border-black/15 bg-white dark:border-white/20 dark:bg-white/[0.06]" aria-hidden="true">
            {i < digits.length ? <span className="h-2.5 w-2.5 rounded-full bg-[#1F2329] dark:bg-white" /> : null}
          </span>
        ))}
      </div>
      <p className="mt-2 h-5 text-center text-[13px] text-[#F5455C]" aria-live="polite">
        {hint ?? ''}
      </p>
      <div className="grid grid-cols-3 gap-[1px] border-t border-black/10 bg-black/10 dark:border-white/10 dark:bg-white/10">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} type="button" data-testid={`qq-keypad-${k}`} onClick={() => push(k)} className={keyBtn}>
            {k}
          </button>
        ))}
        <span className="bg-white dark:bg-[#2A2C31]" aria-hidden="true" />
        <button type="button" data-testid="qq-keypad-0" onClick={() => push('0')} className={keyBtn}>
          0
        </button>
        <button type="button" aria-label="删除" data-testid="qq-keypad-del" onClick={() => { acc.current = acc.current.slice(0, -1); setDigits(acc.current); }} className={keyBtn}>
          <Delete className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** 支付密码验证浮层（红包/转账/充值/提现/小金库支付前调用；正确回调 onOk，错误清空重输） */
export function PayPwdGate({ label, onOk, onClose }: { label: string; onOk: () => void; onClose: () => void }) {
  const [errKey, setErrKey] = useState(0);
  return (
    <div className="absolute inset-0 z-[60] flex flex-col justify-end bg-black/60" role="dialog" aria-label="验证支付密码" onClick={onClose}>
      <PayPwdSheet
        key={errKey}
        title="请输入支付密码"
        sub={label}
        hint={errKey > 0 ? '密码错误，请重新输入' : undefined}
        errorKey={errKey}
        onClose={onClose}
        onComplete={(pwd) => {
          const d = loadPayPwd();
          if (d.pwd && pwd === d.pwd) onOk();
          else setErrKey((k) => k + 1);
        }}
      />
    </div>
  );
}

/** 支付设置页（支付密码开启/关闭/修改；微信风格自绘 6 位数字键盘） */
function PaySettingsPage({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  const [data, setData] = useState(() => loadPayPwd());
  const [flow, setFlow] = useState<null | { mode: 'set' | 'confirm' | 'verify-off' | 'verify-change'; first?: string }>(null);
  const [errKey, setErrKey] = useState(0);
  const enabled = data.enabled && !!data.pwd;
  const meta = flow
    ? flow.mode === 'set'
      ? { title: '设置支付密码', sub: '请输入 6 位数字' }
      : flow.mode === 'confirm'
        ? { title: '确认支付密码', sub: '请再次输入' }
        : flow.mode === 'verify-off'
          ? { title: '关闭支付密码', sub: '验证后即可关闭' }
          : { title: '修改支付密码', sub: '请输入原支付密码' }
    : null;
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="支付设置" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        <div className="flex items-center gap-3 rounded-[14px] bg-[#FFF7E8] px-4 py-3.5 text-[13px] leading-relaxed text-[#8A6A3F] dark:bg-[#3A3222]/60 dark:text-[#E3C893]">
          <Fingerprint className="h-6 w-6 shrink-0" strokeWidth={1.7} aria-hidden="true" />
          开启后，发红包、转账、充值、提现与小金库转入转出都需要先验证支付密码
        </div>
        <div className="mt-4 overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <div className="flex min-h-[58px] items-center gap-3 border-b border-black/[0.04] px-4 py-2.5 dark:border-white/[0.06]">
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] text-[#1F2329] dark:text-white">支付密码</span>
              <span className="mt-0.5 block text-[12px] text-black/40 dark:text-white/40">{enabled ? '已开启 · 支付时需验证' : '未开启'}</span>
            </span>
            <button
              type="button"
              data-testid="qq-pay-toggle"
              aria-label={enabled ? '关闭支付密码' : '开启支付密码'}
              aria-pressed={enabled}
              onClick={() => {
                setErrKey(0);
                setFlow(enabled ? { mode: 'verify-off' } : { mode: 'set' });
              }}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${enabled ? 'bg-[#0099FF]' : 'bg-black/20 dark:bg-white/25'}`}
            >
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} aria-hidden="true" />
            </button>
          </div>
          {enabled ? (
            <button
              type="button"
              data-testid="qq-pay-change"
              onClick={() => {
                setErrKey(0);
                setFlow({ mode: 'verify-change' });
              }}
              className="flex min-h-[54px] w-full items-center px-4 py-2.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]"
            >
              <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">修改支付密码</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <p className="px-1 pt-4 text-[12px] leading-relaxed text-black/35 dark:text-white/35">支付密码为 6 位数字，仅保存在本机浏览器（localStorage），用于本机演示支付验证。</p>
      </div>
      {flow && meta ? (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/55" role="dialog" aria-label={meta.title} onClick={() => setFlow(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <PayPwdSheet
              key={`${flow.mode}-${errKey}`}
              title={meta.title}
              sub={meta.sub}
              hint={errKey > 0 ? '密码错误，请重新输入' : undefined}
              errorKey={errKey}
              onClose={() => setFlow(null)}
              onComplete={(pwd) => {
                if (flow.mode === 'set') {
                  setErrKey(0);
                  setFlow({ mode: 'confirm', first: pwd });
                } else if (flow.mode === 'confirm') {
                  if (pwd === flow.first) {
                    savePayPwd({ enabled: true, pwd });
                    setData(loadPayPwd());
                    setFlow(null);
                    onToast('支付密码已开启');
                  } else {
                    onToast('两次输入不一致，请重新设置');
                    setErrKey((k) => k + 1);
                    setFlow({ mode: 'set' });
                  }
                } else if (flow.mode === 'verify-off') {
                  if (pwd === data.pwd) {
                    savePayPwd({ enabled: false, pwd: null });
                    setData(loadPayPwd());
                    setFlow(null);
                    onToast('支付密码已关闭');
                  } else setErrKey((k) => k + 1);
                } else if (pwd === data.pwd) {
                  setErrKey(0);
                  setFlow({ mode: 'set' });
                } else setErrKey((k) => k + 1);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------- 好友标识页（聊天页消息区左滑进入） ----------------

function FriendBondPage({
  me,
  peer,
  onBack,
  onOpenProfile,
  onToast,
}: {
  me: QQUser;
  peer: ContactRecord;
  onBack: () => void;
  onOpenProfile: () => void;
  onToast: (m: string) => void;
}) {
  // 密友统计：成为好友时间戳用于友谊时间线；天数/密友值仍在后台按 QQ 规则增长（loadBondStat/addBondPoints）
  const [stat] = useState(() => loadBondStat(peer.id));
  const days = bondDays(stat);
  // 我们的DNA弹窗（summary=聊天小结 / common=共同属性 / timeline=友谊时间线，对照 QQ 真机）
  const [dnaModal, setDnaModal] = useState<null | 'summary' | 'common' | 'timeline'>(null);
  const sinceDate = new Date(stat.since);
  const nowDate = new Date();
  const fmtMY = (d: Date) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  const sinceLabel = `${sinceDate.getFullYear()}/${sinceDate.getMonth() + 1}/${sinceDate.getDate()}`;
  const totalDays = Math.max(days, 1);
  // 聊天小结：取双方最近在会话里发过的表情（没发过用默认，对照真机文案）
  const lastEmoji = (role: 'me' | 'peer') => {
    const msgs = loadMsgs(peer.id).filter((m) => m.role === role);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i].content.match(/\p{Extended_Pictographic}(\u200D\p{Extended_Pictographic})*/gu);
      if (m && m.length) return m[m.length - 1];
    }
    return role === 'me' ? '🥱' : '🐶';
  };
  const meEmoji = lastEmoji('me');
  const peerEmoji = lastEmoji('peer');

  return (
    <div className="relative flex h-full w-full flex-col bg-[#F6F7F9] pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：返回 + 更多 */}
      <div className="flex h-12 shrink-0 items-center bg-[#F6F7F9] px-3 dark:bg-[#111214]">
        <button
          type="button"
          aria-label="返回聊天"
          data-testid="qq-bond-back"
          onClick={onBack}
          className="-ml-1 rounded-full p-1.5 active:bg-black/5"
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <button
          type="button"
          aria-label="更多"
          onClick={() => onToast('更多暂未开放')}
          className="ml-auto rounded-full p-1.5 active:bg-black/5"
        >
          <Menu className="h-[22px] w-[22px] text-black/70 dark:text-white/70" strokeWidth={2.2} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8" data-testid="qq-bond-body">
        {/* 密友卡（对照真机截图再缩小一档：左上成为好友N天+密友值，中央同心圆波纹+双头像+蓝心跳线，底部去绑定专属关系；四周幸运物图标不要） */}
        <div
          className="relative mt-1 overflow-hidden rounded-[20px] bg-gradient-to-br from-[#EAE6FB] via-[#F3E1F6] to-[#DCE3FB] px-4 pb-5 pt-5 dark:from-[#38304A] dark:via-[#3B2E43] dark:to-[#26314B]"
          data-testid="qq-bond-card"
        >
          {/* 柔光斑（粉/蓝营造真机渐变氛围） */}
          <div aria-hidden="true" className="absolute -right-9 -top-10 h-32 w-32 rounded-full bg-[#F8CDE9]/70 blur-3xl dark:bg-[#8E4E86]/25" />
          <div aria-hidden="true" className="absolute -left-10 top-1/3 h-28 w-28 rounded-full bg-[#F5D5EE]/60 blur-3xl dark:bg-[#7A4E8C]/20" />
          <div aria-hidden="true" className="absolute -bottom-12 right-1/4 h-32 w-32 rounded-full bg-[#CBD8FB]/70 blur-3xl dark:bg-[#3D5392]/25" />

          {/* 左上：成为好友 N天 + 密友值 pill（真实数据） */}
          <div className="relative">
            <p className="text-[16px] font-medium leading-none text-black/85 dark:text-white/90">成为好友</p>
            <p className="mt-1.5 flex items-baseline gap-1" data-testid="qq-bond-days">
              <span className="text-[36px] font-semibold leading-none tracking-tight text-[#23222B] dark:text-white">{days}</span>
              <span className="text-[15px] font-medium text-black/85 dark:text-white/90">天</span>
            </p>
            <p
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-[8px] bg-[#6B6680]/10 px-2.5 py-[3px] text-[13px] text-black/60 dark:bg-white/10 dark:text-white/60"
              data-testid="qq-bond-points"
            >
              密友值
              <span aria-hidden="true" className="h-3 w-px bg-black/15 dark:bg-white/20" />
              <span>{stat.points}分</span>
            </p>
          </div>

          {/* 中央：同心圆波纹 + 双头像 + 蓝色心跳线（整体再缩小一档） */}
          <div className="relative mt-1.5 flex justify-center">
            <div className="relative grid h-[140px] w-[140px] place-items-center">
              <span aria-hidden="true" className="absolute h-[140px] w-[140px] rounded-full bg-white/20 dark:bg-white/[0.07]" />
              <span aria-hidden="true" className="absolute h-[101px] w-[101px] rounded-full bg-white/25 dark:bg-white/[0.09]" />
              <span aria-hidden="true" className="absolute h-[66px] w-[66px] rounded-full bg-white/30 dark:bg-white/[0.11]" />
              <span className="relative flex items-center gap-0.5">
                <span
                  className="grid h-[52px] w-[52px] place-items-center overflow-hidden rounded-full shadow-[0_4px_11px_rgba(96,74,150,0.22)] ring-2 ring-white/90"
                  data-testid="qq-bond-avatar-me"
                >
                  <QqAvatar src={me.avatar} alt={me.name} size={52} />
                </span>
                <svg viewBox="0 0 48 28" className="h-[23px] w-[40px] shrink-0" aria-hidden="true">
                  <defs>
                    <linearGradient id="qq-pulse-g" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0" stopColor="#7FB0FF" />
                      <stop offset="1" stopColor="#3D6EF6" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M2 16.5h7.5l3.5-8.5 6 17 4-12.5 2.5 4h22.5"
                    fill="none"
                    stroke="url(#qq-pulse-g)"
                    strokeWidth="2.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span
                  className="grid h-[52px] w-[52px] place-items-center overflow-hidden rounded-full shadow-[0_4px_11px_rgba(96,74,150,0.22)] ring-2 ring-white/90"
                  data-testid="qq-bond-avatar-peer"
                >
                  <QqAvatar src={peer.avatar} alt={peer.name} size={52} />
                </span>
              </span>
            </div>
          </div>

          {/* 底部：去绑定专属关系（蓝色文字链接，对照截图） */}
          <div className="relative flex justify-center">
            <button
              type="button"
              data-testid="qq-bond-bind"
              onClick={() => onToast('专属关系暂未开放')}
              className="mt-0.5 flex items-center text-[16px] font-medium text-[#3D6EF6] active:opacity-70 dark:text-[#7FA0FF]"
            >
              去绑定专属关系
              <ChevronRight className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* 我们的DNA（对照 QQ 真机截图：聊天小结 / 共同属性 / 友谊时间线 三卡；整体缩小一档） */}
        <p className="px-1 pb-1.5 pt-3 text-[14px] font-medium text-black/75 dark:text-white/75">我们的DNA</p>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            data-testid="qq-bond-dna-chat"
            onClick={() => setDnaModal('summary')}
            className="rounded-[16px] bg-white p-3.5 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F] dark:active:bg-white/[0.06]"
          >
            <span className="flex items-center text-[13px] text-black/45 dark:text-white/45">
              聊天小结
              <ChevronRight className="ml-0.5 h-3.5 w-3.5 text-black/30 dark:text-white/30" aria-hidden="true" />
            </span>
            <span className="mt-4 block text-[16px] font-semibold leading-snug">
              友谊
              <br />
              持续升温
            </span>
          </button>
          <button
            type="button"
            data-testid="qq-bond-dna-common"
            onClick={() => setDnaModal('common')}
            className="rounded-[16px] bg-white p-3.5 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F] dark:active:bg-white/[0.06]"
          >
            <span className="flex items-center text-[13px] text-black/45 dark:text-white/45">
              共同属性
              <ChevronRight className="ml-0.5 h-3.5 w-3.5 text-black/30 dark:text-white/30" aria-hidden="true" />
            </span>
            <span className="mt-4 block text-[16px] font-semibold leading-snug">
              0个
              <br />
              共同好友
            </span>
          </button>
          <button
            type="button"
            data-testid="qq-bond-dna-timeline"
            onClick={() => setDnaModal('timeline')}
            className="rounded-[16px] bg-white p-3.5 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F] dark:active:bg-white/[0.06]"
          >
            <span className="flex items-center text-[13px] text-black/45 dark:text-white/45">
              友谊时间线
              <ChevronRight className="ml-0.5 h-3.5 w-3.5 text-black/30 dark:text-white/30" aria-hidden="true" />
            </span>
            <span className="mt-4 block text-[16px] font-semibold leading-snug">
              {sinceLabel}
              <br />
              我们成为好友
            </span>
          </button>
        </div>

        {/* 我们的幸运物种 */}
        <p className="px-1 pb-2 pt-4 text-[14px] text-black/40 dark:text-white/40">我们的幸运物种</p>
        <div className="rounded-[20px] bg-white px-4 py-4 dark:bg-[#1B1C1F]">
          <p className="text-[15px] font-medium">幸运字符</p>
          <div className="mt-3 h-px bg-black/[0.05] dark:bg-white/[0.06]" aria-hidden="true" />
          <button
            type="button"
            onClick={() => onToast('幸运字符暂未开放')}
            className="flex w-full items-center gap-3 pt-3 text-left active:opacity-70"
          >
            <span
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-[#33271C] via-[#17120E] to-[#0B0806] text-[20px] font-bold text-[#E7C873] shadow-[0_4px_14px_rgba(231,200,115,0.28)] ring-1 ring-[#E7C873]/45"
              aria-hidden="true"
            >
              X
              <span className="absolute -right-0.5 -top-0.5 text-[9px] text-[#FFE9B8]">✦</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-medium">幸运字符</span>
              <span className="block text-[13px] text-black/35 dark:text-white/35">抽取专属字符</span>
            </span>
            <span className="text-[15px] text-black/45 dark:text-white/45">开启</span>
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#F5455C]" aria-hidden="true" />
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 我们的DNA弹窗（聊天小结 / 共同属性 / 友谊时间线，对照 QQ 真机：白卡 + 蓝按钮 + 圆形关闭钮） */}
      {dnaModal && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/45 px-6"
          role="dialog"
          aria-label="我们的DNA"
          data-testid="qq-bond-dna-modal"
        >
          <div className="w-full rounded-[24px] bg-white px-6 pb-9 pt-7 dark:bg-[#1E1F23]">
            {dnaModal === 'summary' && (
              <>
                <p className="text-[22px] font-bold">聊天小结</p>
                <p className="mt-7 text-[15px] leading-relaxed">
                  本周，
                  <br />
                  我们的<b>友谊持续升温</b>。
                </p>
                <p className="mt-4 text-[15px] leading-relaxed">
                  我最近使用的表情是 <span className="align-middle text-[26px] leading-none">{meEmoji}</span>
                </p>
                <p className="mt-3 text-[15px] leading-relaxed">
                  好友最近使用的表情是 <span className="align-middle text-[26px] leading-none">{peerEmoji}</span>
                </p>
              </>
            )}
            {dnaModal === 'common' && (
              <>
                <p className="text-[22px] font-bold">共同属性</p>
                <div className="mt-7 flex items-center gap-9">
                  <span className="text-[15px] text-black/35 dark:text-white/35">共同好友</span>
                  <span className="text-[17px] font-bold" data-testid="qq-bond-dna-common-count">
                    0个
                  </span>
                </div>
              </>
            )}
            {dnaModal === 'timeline' && (
              <>
                <p className="text-[22px] font-bold">友谊时间线</p>
                <div className="mt-8 flex items-start gap-4">
                  <div className="w-[52px] shrink-0">
                    <p className="text-[24px] font-bold leading-none">{sinceDate.getDate()}</p>
                    <p className="mt-1.5 text-[14px] text-black/35 dark:text-white/35">{fmtMY(sinceDate)}</p>
                  </div>
                  <p className="pt-0.5 text-[15px] leading-relaxed">
                    通过<b>QQ号查找</b>我们成为了好友。
                  </p>
                </div>
                <div className="mt-7 flex items-start gap-4">
                  <div className="w-[52px] shrink-0">
                    <p className="text-[24px] font-bold leading-none">{nowDate.getDate()}</p>
                    <p className="mt-1.5 text-[14px] text-black/35 dark:text-white/35">{fmtMY(nowDate)}</p>
                  </div>
                  <p className="pt-0.5 text-[15px] leading-relaxed">
                    今天，
                    <br />
                    是我们成为好友的<b>{totalDays}天</b>。
                  </p>
                </div>
              </>
            )}
            <button
              type="button"
              data-testid="qq-bond-dna-cta"
              onClick={() => {
                const which = dnaModal;
                setDnaModal(null);
                if (which === 'common') onOpenProfile();
                else onBack();
              }}
              className="mx-auto mt-10 flex h-12 w-[76%] items-center justify-center rounded-[10px] bg-[#3BA0FF] text-[17px] font-medium text-white shadow-[0_6px_18px_rgba(59,160,255,0.35)] active:brightness-95"
            >
              {dnaModal === 'common' ? '完善资料' : '去聊一聊'}
            </button>
          </div>
          <button
            type="button"
            aria-label="关闭"
            data-testid="qq-bond-dna-close"
            onClick={() => setDnaModal(null)}
            className="mt-8 grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full border-2 border-white/85 text-white active:bg-white/10"
          >
            <X className="h-6 w-6" strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------- 资料页徽章（SVIP8 / QQ等级图标 / 勋章 / LV，对照真机截图） ----------------

/** 公用 defs（同页多个 SVG 引用同一渐变，路由互斥无 id 冲突） */
function QqGoldDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <linearGradient id="qq-gold-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE08A" />
          <stop offset="1" stopColor="#F0A711" />
        </linearGradient>
        <linearGradient id="qq-gold-deep" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD76A" />
          <stop offset="1" stopColor="#DE8F0A" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** QQ 等级图标组：皇冠（三顶珠+三红宝石）+ 太阳（三角光芒）+ 月亮（金系简约新月，共用金色渐变靠剪影区分）+ 星星×3，对照 QQ 真机 */
function QqLevelIcons() {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-[23px] w-[23px]">
        <circle cx="4.2" cy="6.8" r="1.7" fill="url(#qq-gold-deep)" stroke="#C8880A" strokeWidth="0.5" />
        <circle cx="12" cy="4.2" r="1.7" fill="url(#qq-gold-deep)" stroke="#C8880A" strokeWidth="0.5" />
        <circle cx="19.8" cy="6.8" r="1.7" fill="url(#qq-gold-deep)" stroke="#C8880A" strokeWidth="0.5" />
        <path
          d="M4.2 8.6l4.3 3.3 3.5-5.2 3.5 5.2 4.3-3.3-1.7 8.9H5.9z"
          fill="url(#qq-gold-g)"
          stroke="#C8880A"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        <rect x="5.4" y="17.7" width="13.2" height="2.6" rx="1.3" fill="url(#qq-gold-deep)" stroke="#C8880A" strokeWidth="0.5" />
        <circle cx="12" cy="13.6" r="1.4" fill="#F5455C" stroke="#C43A4C" strokeWidth="0.4" />
        <circle cx="7.6" cy="15" r="0.85" fill="#F5455C" opacity="0.9" />
        <circle cx="16.4" cy="15" r="0.85" fill="#F5455C" opacity="0.9" />
      </svg>
      <svg viewBox="0 0 24 24" className="h-[23px] w-[23px]">
        <g fill="url(#qq-gold-deep)">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <path key={a} d="M12 1.2l1.7 3.8h-3.4z" transform={`rotate(${a} 12 12)`} />
          ))}
        </g>
        <circle cx="12" cy="12" r="5.4" fill="url(#qq-gold-g)" stroke="#C8880A" strokeWidth="0.8" />
        <circle cx="12" cy="12" r="3.2" fill="#FFE9A8" opacity="0.55" />
      </svg>
      <svg viewBox="0 0 24 24" className="h-[20px] w-[20px]">
        {/* 月亮：金系简约新月——与皇冠/太阳/星星共用同一金色渐变（qq-gold-g），仅靠月牙剪影区分；无月晕/星芒/圆底等繁饰；尺寸略小（20px，用户要求月亮小一点） */}
        <path
          d="M20.8 13A9 9 0 1 1 11 3.2A7 7 0 0 0 20.8 13z"
          fill="url(#qq-gold-g)"
          stroke="#C8880A"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
        {/* 内缘一道柔光，呼应太阳内圈细节 */}
        <path d="M11 3.2A7 7 0 0 0 20.8 13" fill="none" stroke="#FFE9A8" strokeWidth="1" strokeLinecap="round" opacity="0.8" />
      </svg>
      {[0, 1, 2].map((i) => (
        <svg key={i} viewBox="0 0 24 24" className="h-[21px] w-[21px]">
          <path
            d="M12 2.8l2.6 5.6 6.1.7-4.5 4.1 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.1 6.1-.7z"
            fill="url(#qq-gold-g)"
            stroke="#C8880A"
            strokeWidth="0.7"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </span>
  );
}

/** 资料页徽章行（QQ 等级图标：皇冠+太阳+月亮+星星×3；SVIP8/勋章/LV8/LV3 徽章已按需求删除；padClass 控制左缩进） */
function QqBadgeWall({ onOpen, mtClass, testid, padClass = '' }: { onOpen: () => void; mtClass: string; testid: string; padClass?: string }) {
  return (
    <div className={mtClass} data-testid={testid}>
      <QqGoldDefs />
      <button type="button" onClick={onOpen} className={`flex w-full items-center text-left active:opacity-70 ${padClass}`}>
        <span className="flex min-w-0 flex-1 items-center">
          <QqLevelIcons />
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------- 好友个人资料页（联系人列表点击进入，对照 QQ 真机） ----------------

function FriendProfilePage({
  me,
  peer,
  onBack,
  onOpenChat,
  onOpenBond,
  onToast,
}: {
  me: QQUser;
  peer: ContactRecord;
  onBack: () => void;
  onOpenChat: () => void;
  onOpenBond: () => void;
  onToast: (m: string) => void;
}) {
  // 跨 App 跳转：点「编辑资料」→ 打开联系人 App 后直接进入该联系人的编辑页
  const switchToApp = useUI((s) => s.switchToApp);
  const setPendingContactEdit = useUI((s) => s.setPendingContactEdit);
  // 点赞数：本地持久化，点击 +1（对照 QQ 资料卡点赞）
  const [likes, setLikes] = useState<number>(() => {
    try {
      const n = Number(kvGet<number>(LS_FRIEND_LIKE(peer.id)) ?? 0);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch {
      return 0;
    }
  });
  const giveLike = () => {
    const next = likes + 1;
    setLikes(next);
    try {
      kvSet(LS_FRIEND_LIKE(peer.id), next);
    } catch {
      // 忽略
    }
    onToast(`已点赞 ${peer.name}`);
  };

  return (
    <div className="flex h-full w-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：返回 / 个人资料 / 设置 */}
      <div className="relative flex h-12 shrink-0 items-center bg-white px-3 dark:bg-[#111214]">
        <button type="button" aria-label="返回" data-testid="qq-fprofile-back" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-semibold">
          个人资料
        </span>
        <button
          type="button"
          aria-label="设置"
          onClick={() => onToast('资料卡设置暂未开放')}
          className="ml-auto rounded-full p-1.5 active:bg-black/5"
        >
          <Settings className="h-[22px] w-[22px] text-black/70 dark:text-white/70" strokeWidth={2} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto" data-testid="qq-fprofile-body">
        {/* 头像 + 名字/QQ号 + 点赞 */}
        <div className="flex items-start gap-4 px-5 pt-4">
          <QqAvatar src={peer.avatar} alt={peer.name} size={84} />
          <div className="min-w-0 flex-1 pt-2">
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 truncate text-[20px] font-bold leading-tight">{peer.name}</span>
            </div>
            <div className="mt-2 truncate text-[13px] text-black/45 dark:text-white/45" data-testid="qq-fprofile-qqid">
              QQ:{peer.qqId ?? '未设置'}
            </div>
          </div>
          <button
            type="button"
            aria-label="点赞"
            data-testid="qq-fprofile-like"
            onClick={giveLike}
            className="flex shrink-0 flex-col items-center gap-0.5 pt-1 text-black/70 active:opacity-60 dark:text-white/70"
          >
            <ThumbsUp className="h-6 w-6" strokeWidth={1.9} />
            <span className="text-[12px]" data-testid="qq-fprofile-like-count">
              {likes}
            </span>
          </button>
        </div>

        {/* 徽章行（QQ 等级图标；SVIP8/勋章/LV8/LV3 已删除） */}
        <QqBadgeWall testid="qq-fprofile-badges" mtClass="mt-5" padClass="pl-5" onOpen={() => onToast('勋章墙暂未开放')} />

        {/* 你们的互动标识 → 好友互动标识页 */}
        <div className="mt-5 h-2 bg-black/[0.045] dark:bg-white/[0.05]" aria-hidden="true" />
        <button
          type="button"
          data-testid="qq-fprofile-bond"
          onClick={onOpenBond}
          className="flex h-[58px] w-full items-center gap-3 px-5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]"
        >
          <span className="shrink-0 text-[16px]">你们的互动标识</span>
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[14px] text-black/40 dark:text-white/40">
            <span className="truncate">立刻点亮你们的第一个标识</span>
            <span aria-hidden="true">🌸</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        {/* 他的QQ空间 */}
        <div className="h-2 bg-black/[0.045] dark:bg-white/[0.05]" aria-hidden="true" />
        <button
          type="button"
          onClick={() => onToast('他的QQ空间暂未开放')}
          className="flex h-[58px] w-full items-center gap-3 px-5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]"
        >
          <Star className="h-[22px] w-[22px] shrink-0 text-black/70 dark:text-white/70" strokeWidth={1.9} aria-hidden="true" />
          <span className="flex-1 text-[16px]">他的QQ空间</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>
      </div>

      {/* 底部三按钮：音视频通话 / 编辑资料（跳联系人 App 编辑页）/ 发消息 */}
      <div className="flex shrink-0 gap-3 bg-white px-4 pb-[40px] pt-3 dark:bg-[#111214]">
        <button
          type="button"
          onClick={() => onToast('音视频通话暂未开放')}
          className="h-11 flex-1 rounded-[12px] border border-black/15 text-[15px] active:bg-black/5 dark:border-white/25"
        >
          音视频通话
        </button>
        <button
          type="button"
          data-testid="qq-fprofile-edit"
          onClick={() => {
            setPendingContactEdit(peer.id);
            switchToApp('contacts');
          }}
          className="h-11 flex-1 rounded-[12px] border border-black/15 text-[15px] active:bg-black/5 dark:border-white/25"
        >
          编辑资料
        </button>
        <button
          type="button"
          data-testid="qq-fprofile-message"
          onClick={onOpenChat}
          className="h-11 flex-1 rounded-[12px] text-[15px] font-medium text-white active:brightness-95"
          style={{ backgroundColor: QQ_BLUE }}
        >
          发消息
        </button>
      </div>
      <span className="sr-only">{me.name}查看{peer.name}的个人资料</span>
    </div>
  );
}

// ---------------- 消息页 ----------------

/** 会话长按操作持久化（置顶迁移至 @/lib/chat-flags 的 qqChatFlags 表；已删除会话后有新消息自动重新出现） */
const LS_CHAT_HIDDEN = 'qq-chat-hidden';

/** 未读计数总线（单例在 @/lib/unread-store）：会话列表角标 / 聊天页返回键角标 / 底部 tab 角标 / 主屏图标角标共享 */
const qqUnreads = qqUnreadStore;

function loadStrList(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function saveStrList(key: string, list: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // 忽略
  }
}

function MessagesPage({
  me,
  contacts,
  onOpenChat,
  onOpenGroup,
  onOpenDrawer,
  onAvatar,
  onAddFriend,
  onCreateGroup,
  onToast,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  onOpenChat: (c: ContactRecord) => void;
  /** 打开某个 QQ 群聊（群会话行） */
  onOpenGroup: (g: ChatGroup) => void;
  onOpenDrawer: () => void;
  onAvatar: () => void;
  onAddFriend: () => void;
  /** 发起群聊（建群页）——入口在消息页右上角加号菜单 */
  onCreateGroup: () => void;
  onToast: (m: string) => void;
}) {
  const [q, setQ] = useState('');
  // 右上角加号菜单（对照真 QQ：创建群聊/创建频道/加好友/群/扫一扫/传文件/收付款）
  const [plusMenu, setPlusMenu] = useState(false);
  // 右滑手势：页面任意位置（输入控件除外）水平右滑 → 个人中心抽屉
  const swipe = useRef<{ x: number; y: number; fired: boolean } | null>(null);
  // 会话管理：置顶 / 免打扰（chat-flags 总线）/ 未读 / 已删除（长按菜单操作，localStorage 持久化）
  const flagsMap = useChatFlags(qqChatFlagsStore);
  const unreads = useUnreadMap(qqUnreads);
  const [hidden, setHidden] = useState<string[]>(() => loadStrList(LS_CHAT_HIDDEN));
  // 好友来信 / 未读变化 tick：会话预览派生自 localStorage，需要 tick 触发 useMemo 重算
  const [msgTick, setMsgTick] = useState(0);
  useEffect(() => qqUnreads.subscribe(() => setMsgTick((t) => t + 1)), []);
  // 全局流式回复落盘 tick：聊天页外收到的 AI 回复写入存储后刷新会话预览/排序
  useChatStreamFinalized('qq:', () => setMsgTick((t) => t + 1));
  // 长按菜单（微信同款横向单行条：置顶/标为未读/删除 + 指向箭头；浅色白底黑字/深色深底白字；位置在长按触发时计算好，render 不读 ref）
  const [ctx, setCtx] = useState<null | { row: SessionRow; x: number; y: number; arrow: 'down' | 'up'; arrowX: number }>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<{ timer: number | null; x: number; y: number }>({ timer: null, x: 0, y: 0 });
  const suppressClickRef = useRef(false);
  const onSwipeStart = (e: React.PointerEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea')) return;
    swipe.current = { x: e.clientX, y: e.clientY, fired: false };
  };
  const onSwipeMove = (e: React.PointerEvent) => {
    const t = swipe.current;
    if (!t || t.fired) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (dx > 50 && Math.abs(dy) < 80) {
      t.fired = true;
      onOpenDrawer();
      return;
    }
    if (dx < -30 || Math.abs(dy) > 90) t.fired = true; // 反向/纵向则放弃，避免误触发
  };
  // 会话 = 已加好友的 char/npc + 自己（自我会话也显示；已删除会话隐藏，收到新消息自动恢复；置顶优先）
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const pinSet = useMemo(
    () => new Set(Object.keys(flagsMap).filter((id) => flagsMap[id]?.pinned === true)),
    [flagsMap]
  );
  /** 会话行：私聊（contact）或群聊（group）；群会话按 group:<gid> 键共用置顶/免打扰/未读设施 */
  interface SessionRow {
    key: string;
    name: string;
    contact: ContactRecord | null;
    group: ChatGroup | null;
    text: string;
    time: number;
  }
  // QQ 群聊（与私聊同列表展示但各自独立会话；tab 切换重挂载时现场读取即最新）
  // 退群挽留：AI 把机主拉回群后（quit-flow 广播恢复事件）立刻重读群池，恢复的群即时回到列表
  const [groupsTick, setGroupsTick] = useState(0);
  useEffect(() => {
    const fn = () => setGroupsTick((v) => v + 1);
    window.addEventListener('quit-flow:group-restored', fn);
    return () => window.removeEventListener('quit-flow:group-restored', fn);
  }, []);
  const chatGroups = useMemo(() => {
    void groupsTick;
    return listChatGroups('qq');
  }, [groupsTick]);
  /** 全量会话（未套搜索过滤）：幽灵未读清理必须以全量列表为准，否则搜索时会把列表外会话的未读误删 */
  const baseConversations = useMemo<SessionRow[]>(() => {
    const rows: SessionRow[] = contacts
      .filter(
        (c) => ((isFriendIn(c, 'qq') && c.kind !== 'user') || c.id === me.id) && !(hiddenSet.has(c.id) && loadMsgs(c.id).length === 0)
      )
      .map((c) => {
        const msgs = loadMsgs(c.id);
        // 通知行/系统提示行/申请卡片不作为会话预览，回退到最后一条实质消息
        const last = [...msgs].reverse().find((m) => m.kind !== 'notice' && m.kind !== 'sys' && m.kind !== 'blockreq');
        return { key: c.id, name: c.name, contact: c, group: null, text: msgPreview(last), time: last?.time ?? 0 };
      });
    // 群会话行（群聊与私聊是两类会话，各自独立显示；隐藏后不再出现，可从联系人 › 群聊 再进）
    for (const g of chatGroups) {
      if (hiddenSet.has(qqGroupRowId(g.id))) continue;
      const p = groupPreview(g.id);
      rows.push({ key: qqGroupRowId(g.id), name: g.remark?.trim() || g.name, contact: null, group: g, text: p.text, time: p.time });
    }
    rows.sort((a, b) => {
      const pa = pinSet.has(a.key) ? 0 : 1;
      const pb = pinSet.has(b.key) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      if (a.time !== b.time) return b.time - a.time;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    return rows;
  }, [contacts, me.id, hiddenSet, pinSet, msgTick, chatGroups]);
  const conversations = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return baseConversations;
    return baseConversations.filter(
      (x) => x.name.toLowerCase().includes(kw) || (x.contact?.qqId ?? '').includes(kw) || x.text.toLowerCase().includes(kw)
    );
  }, [baseConversations, q]);

  /** 幽灵未读清理：只保留当前会话列表里的未读（已删除会话/已删联系人的残留计数没有行可清，
   *  会让底部 tab 与主屏图标角标卡死；prune 无变化时不写入，可安全随 baseConversations 重算触发） */
  useEffect(() => {
    qqUnreads.prune(baseConversations.map((row) => row.key));
  }, [baseConversations]);

  // 长按检测：按住 480ms 弹出会话操作菜单；移动超 12px 视为滚动取消
  const clearPress = () => {
    if (pressRef.current.timer) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current.timer = null;
    }
  };
  const onSessionPointerDown = (e: React.PointerEvent, row: SessionRow) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearPress();
    pressRef.current = { x: e.clientX, y: e.clientY, timer: null };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = null;
      // 横向单行条（3 项，约 234×64）：默认在触点上方（箭头朝下指向会话行），上方放不下翻到下方
      const root = rootRef.current;
      const rect = root?.getBoundingClientRect();
      const px = rect ? e.clientX - rect.left : e.clientX;
      const py = rect ? e.clientY - rect.top : e.clientY;
      const rootW = root?.clientWidth ?? 360;
      const rootH = root?.clientHeight ?? 600;
      const MENU_W = 234;
      const MENU_H = 64;
      const x = Math.min(Math.max(px - MENU_W / 2, 6), Math.max(rootW - MENU_W - 6, 6));
      let y = py - MENU_H - 14;
      let arrow: 'down' | 'up' = 'down';
      if (y < 6) {
        y = py + 16;
        arrow = 'up';
      }
      y = Math.min(y, Math.max(rootH - MENU_H - 12, 6));
      const arrowX = Math.min(Math.max(px - x, 24), MENU_W - 24);
      setCtx({ row, x, y, arrow, arrowX });
      // 长按后拦截紧随的 click（不进入会话）
      suppressClickRef.current = true;
    }, 480);
  };
  const onSessionPointerMove = (e: React.PointerEvent) => {
    const t = pressRef.current;
    if (!t.timer) return;
    if (Math.abs(e.clientX - t.x) > 12 || Math.abs(e.clientY - t.y) > 12) clearPress();
  };

  // 关闭长按菜单并解除 click 拦截（避免菜单操作后下一次点击被吞掉）
  const closeCtx = () => {
    setCtx(null);
    suppressClickRef.current = false;
  };

  // 菜单操作（置顶/未读/删除）：置顶/未读写入与订阅通知由总线负责（落盘 + 实时同步各角标）
  const togglePin = (id: string) => {
    qqChatFlagsStore.togglePinned(id);
  };
  const toggleUnread = (id: string) => qqUnreads.toggle(id);
  const markRead = (id: string) => qqUnreads.clear(id);
  const removeSession = (id: string) => {
    saveMsgs(id, []); // 清空聊天记录；有新消息时该会话自动重新出现
    const nextHidden = hidden.includes(id) ? hidden : [...hidden, id];
    saveStrList(LS_CHAT_HIDDEN, nextHidden);
    setHidden(nextHidden);
    qqChatFlagsStore.reset(id); // 置顶/免打扰/聊天背景一并清除
    qqUnreads.clear(id);
  };
  /** 群会话删除：只从消息列表移除该行（群本体与聊天记录保留，可从联系人 › 群聊 再进） */
  const removeGroupSession = (key: string) => {
    const nextHidden = hidden.includes(key) ? hidden : [...hidden, key];
    saveStrList(LS_CHAT_HIDDEN, nextHidden);
    setHidden(nextHidden);
    qqChatFlagsStore.reset(key);
    qqUnreads.clear(key);
    onToast('已从列表移除，群聊保留在联系人 › 群聊');
  };

  return (
    <div
      ref={rootRef}
      className="relative flex h-full flex-col"
      onPointerDown={onSwipeStart}
      onPointerMove={onSwipeMove}
      onPointerCancel={() => {
        swipe.current = null;
      }}
      onPointerUp={() => {
        // 延迟到 click 派发后再清空，让 onClickCapture 能拦截手势后的误点击
        window.setTimeout(() => {
          swipe.current = null;
        }, 0);
      }}
      onClickCapture={(e) => {
        if (swipe.current?.fired) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <QqHeader
        user={me}
        title={me.name}
        subtitle={<OnlineBadge />}
        onAvatar={onAvatar}
        action={
          <div className="relative">
            <button
              type="button"
              aria-label="添加"
              aria-expanded={plusMenu}
              data-testid="qq-msgs-add"
              className="rounded-full p-1.5 active:bg-black/5"
              onClick={() => setPlusMenu((v) => !v)}
            >
              <Plus className={`h-6 w-6 transition-transform duration-200 ${plusMenu ? 'rotate-45' : ''}`} strokeWidth={2} />
            </button>
            {/* 加号下拉菜单（对照需求截图：白色圆角面板 + 指向箭头；点击面板外关闭） */}
            {plusMenu && (
              <>
                <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setPlusMenu(false)} />
                <div
                  data-testid="qq-msgs-plus-menu"
                  className="absolute right-0 top-[calc(100%+6px)] z-50 w-[172px] rounded-[14px] bg-white p-1.5 shadow-[0_6px_28px_rgba(0,0,0,0.16)] dark:bg-[#2A2C31] dark:shadow-[0_6px_28px_rgba(0,0,0,0.5)]"
                >
                  <span aria-hidden="true" className="absolute -top-[5px] right-[13px] block h-2.5 w-2.5 rotate-45 rounded-[2px] bg-white dark:bg-[#2A2C31]" />
                  {(
                    [
                      { key: 'create-group', label: '创建群聊', icon: <MessageSquarePlus className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); onCreateGroup(); } },
                      { key: 'create-channel', label: '创建频道', icon: <Hash className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); onToast('创建频道暂未开放'); } },
                      { key: 'add-friend', label: '加好友/群', icon: <UserPlus className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); onAddFriend(); } },
                      { key: 'scan', label: '扫一扫', icon: <ScanLine className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); onToast('扫一扫暂未开放'); } },
                      { key: 'send-file', label: '传文件', icon: <FolderOutput className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); onToast('传文件暂未开放'); } },
                      { key: 'pay', label: '收付款', icon: <JapaneseYen className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); onToast('收付款暂未开放'); } },
                    ] as const
                  ).map((it) => (
                    <button
                      key={it.key}
                      type="button"
                      data-testid={`qq-plus-${it.key}`}
                      onClick={it.action}
                      className="flex w-full items-center gap-3 rounded-[10px] px-3 py-[9px] text-left active:bg-black/5 dark:active:bg-white/10"
                    >
                      <span className="shrink-0 text-black/70 dark:text-white/70">{it.icon}</span>
                      <span className="text-[15px]">{it.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        }
      />
      <div className="px-4 pb-2 pt-1">
        <QqSearch value={q} onChange={setQ} />
      </div>
      <div className="flex-1 overflow-y-auto" style={{ touchAction: 'pan-y' }}>
        {conversations.length === 0 && (
          <p className="mt-14 text-center text-[13px] text-black/30 dark:text-white/30">
            还没有会话，去「联系人」App 添加好友吧
          </p>
        )}
        {conversations.map((row) => {
          const pinned = pinSet.has(row.key);
          const unreadCount = unreads[row.key] ?? 0;
          return (
            <button
              key={row.key}
              type="button"
              data-testid={`qq-session-${row.key}`}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                markRead(row.key);
                if (row.contact) onOpenChat(row.contact);
                else if (row.group) onOpenGroup(row.group);
              }}
              onPointerDown={(e) => onSessionPointerDown(e, row)}
              onPointerMove={onSessionPointerMove}
              onPointerUp={clearPress}
              onPointerCancel={clearPress}
              onPointerLeave={clearPress}
              className={`flex w-full select-none items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.05] ${
                pinned ? 'bg-[#F0F1F5] dark:bg-white/[0.06]' : ''
              }`}
            >
              <span className="relative shrink-0">
                {row.contact ? (
                  <QqAvatar src={row.contact.avatar} alt={row.contact.name} size={52} />
                ) : (
                  row.group && <QqGroupAvatar group={row.group} contacts={contacts} size={52} />
                )}
                {unreadCount > 0 && (
                  <span
                    data-testid={`qq-unread-badge-${row.key}`}
                    aria-label={`${unreadCount} 条未读`}
                    className={
                      flagsMap[row.key]?.muted === true
                        ? /* 免打扰：不显示数字，只显示小红点 */
                          'absolute -right-[2px] -top-[2px] block h-[10px] w-[10px] rounded-full bg-[#F5455C] ring-2 ring-white dark:ring-[#111214]'
                        : 'absolute -right-2 -top-2 flex h-[21px] min-w-[21px] items-center justify-center rounded-full bg-[#F5455C] px-[6px] text-[12px] font-semibold leading-none text-white shadow-[0_1px_4px_rgba(0,0,0,0.28)] ring-2 ring-white dark:ring-[#111214]'
                    }
                  >
                    {flagsMap[row.key]?.muted === true ? null : unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <div className="truncate text-[16px] font-medium leading-snug">{row.name}</div>
                  {flagsMap[row.key]?.muted === true && (
                    <BellOff className="h-3.5 w-3.5 shrink-0 text-black/30 dark:text-white/30" strokeWidth={2} aria-label="消息免打扰" />
                  )}
                </div>
                <div className="truncate text-[13px] text-black/35 dark:text-white/35">{row.text}</div>
              </div>
              <span className="shrink-0 text-[12px] text-black/30 dark:text-white/30">{fmtListTime(row.time)}</span>
            </button>
          );
        })}
      </div>

      {/* 长按会话菜单（微信同款横向单行条：置顶/标为未读/删除 + 指向箭头；浅色白底黑字，点空白处关闭） */}
      {ctx && (
        <div
          className="absolute inset-0 z-40"
          data-testid="qq-session-ctx-overlay"
          onClick={closeCtx}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="absolute z-50" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
            <div className="relative">
              {/* 小箭头：指向长按的会话行（菜单在上方时朝下，在下方时朝上） */}
              <span
                aria-hidden="true"
                className={`absolute z-10 h-[12px] w-[12px] rotate-45 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12)] dark:bg-[#4C4C4C] ${
                  ctx.arrow === 'down' ? '-bottom-[5px]' : '-top-[5px]'
                }`}
                style={{ left: ctx.arrowX - 6 }}
              />
              <div
                role="menu"
                aria-label="会话操作"
                data-testid="qq-session-ctx"
                className="relative flex w-[234px] divide-x divide-black/[0.08] overflow-hidden rounded-[10px] border border-black/[0.08] bg-white/95 text-black shadow-[0_12px_36px_rgba(0,0,0,0.18)] backdrop-blur-md dark:divide-white/15 dark:border-white/[0.08] dark:bg-[#4C4C4C]/95 dark:text-white dark:shadow-[0_12px_36px_rgba(0,0,0,0.35)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  data-testid="qq-ctx-pin"
                  onClick={() => {
                    togglePin(ctx.row.key);
                    closeCtx();
                  }}
                  className="flex h-[64px] flex-1 flex-col items-center justify-center gap-[5px] text-[11px] active:bg-black/[0.05] dark:active:bg-white/10"
                >
                  {pinSet.has(ctx.row.key) ? (
                    <PinOff className="h-[19px] w-[19px]" strokeWidth={1.9} aria-hidden="true" />
                  ) : (
                    <Pin className="h-[19px] w-[19px]" strokeWidth={1.9} aria-hidden="true" />
                  )}
                  {pinSet.has(ctx.row.key) ? '取消置顶' : '置顶'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="qq-ctx-unread"
                  onClick={() => {
                    toggleUnread(ctx.row.key);
                    closeCtx();
                  }}
                  className="flex h-[64px] flex-1 flex-col items-center justify-center gap-[5px] text-[11px] active:bg-black/[0.05] dark:active:bg-white/10"
                >
                  <MailOpen className="h-[19px] w-[19px]" strokeWidth={1.9} aria-hidden="true" />
                  {unreads[ctx.row.key] ? '标为已读' : '标为未读'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="qq-ctx-delete"
                  onClick={() => {
                    if (ctx.row.group) removeGroupSession(ctx.row.key);
                    else removeSession(ctx.row.key);
                    closeCtx();
                  }}
                  className="flex h-[64px] flex-1 flex-col items-center justify-center gap-[5px] text-[11px] text-[#F5455C] active:bg-black/[0.05] dark:text-[#FF9A97] dark:active:bg-white/10"
                >
                  <Trash2 className="h-[19px] w-[19px]" strokeWidth={1.9} aria-hidden="true" />
                  {ctx.row.group ? '移除会话' : '删除'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 联系人页 ----------------

const CT_TABS = ['分组', '好友', '群聊', '频道', '机器人', '设备'] as const;
type CtTab = (typeof CT_TABS)[number];

function ContactsPage({
  me,
  contacts,
  onOpenProfile,
  onOpenMeProfile,
  onAvatar,
  onAddFriend,
  onOpenNewFriends,
  onOpenGroup,
  onToast,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  onOpenProfile: (c: ContactRecord) => void;
  onOpenMeProfile: () => void;
  onAvatar: () => void;
  onAddFriend: () => void;
  onOpenNewFriends: () => void;
  /** 打开某个 QQ 群聊 */
  onOpenGroup: (g: ChatGroup) => void;
  onToast: (m: string) => void;
}) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<CtTab>('分组');
  const [expandSpecial, setExpandSpecial] = useState(false);
  const [expandFriends, setExpandFriends] = useState(true);
  // QQ 群聊（联系人 › 群聊 tab；tab 切换会重挂载本页，现场读取即最新）
  const chatGroups = useMemo(() => listChatGroups('qq'), []);
  const filteredGroups = useMemo(() => {
    const kw2 = q.trim().toLowerCase();
    return kw2 ? chatGroups.filter((g) => g.name.toLowerCase().includes(kw2) || (g.remark ?? '').toLowerCase().includes(kw2)) : chatGroups;
  }, [chatGroups, q]);

  const friends = useMemo(() => contacts.filter((c) => isFriendIn(c, 'qq') && c.kind !== 'user'), [contacts]);
  const special = useMemo(() => friends.filter((c) => c.relation?.includes('特别') || c.relation?.includes('关心')), [friends]);
  const normalFriends = useMemo(() => friends.filter((c) => !special.includes(c)), [friends, special]);

  const kw = q.trim().toLowerCase();
  const filteredFriends = useMemo(
    () => (kw ? friends.filter((c) => c.name.toLowerCase().includes(kw) || (c.qqId ?? '').includes(kw)) : friends),
    [friends, kw]
  );

  return (
    <div className="flex h-full flex-col">
      {/* 顶部：简洁白底头部（背景封面图与打卡/状态 pills 已按需求删除），头像 + 标题 + 加好友 */}
      <div className="flex shrink-0 items-center gap-3 px-4 pb-1 pt-3">
        <button type="button" aria-label="个人资料" onClick={onAvatar} className="rounded-full active:opacity-80">
          <QqAvatar src={me.avatar} alt={me.name} size={44} />
        </button>
        <div className="min-w-0 flex-1 truncate text-[20px] font-semibold text-black dark:text-white">联系人</div>
        <button
          type="button"
          aria-label="加好友"
          data-testid="qq-contacts-add"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-black/60 active:bg-black/5 dark:text-white/60 dark:active:bg-white/10"
          onClick={onAddFriend}
        >
          <UserPlus className="h-5 w-5" strokeWidth={2} />
        </button>
      </div>
      <div className="px-4 pb-2 pt-3">
        <QqSearch value={q} onChange={setQ} />
      </div>

      <div className="flex-1 overflow-y-auto" data-testid="qq-contacts-list">
        {/* 新朋友 / 群通知 */}
        <button
          type="button"
          data-testid="qq-contacts-newfriends"
          className="flex w-full items-center justify-between border-b border-black/[0.05] px-4 py-3.5 text-left active:bg-black/[0.04] dark:border-white/[0.06] dark:active:bg-white/[0.05]"
          onClick={onOpenNewFriends}
        >
          <span className="text-[16px]">新朋友</span>
          <ChevronRight className="h-5 w-5 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="flex w-full items-center justify-between border-b border-black/[0.05] px-4 py-3.5 text-left active:bg-black/[0.04] dark:border-white/[0.06] dark:active:bg-white/[0.05]"
          onClick={() => onToast('群通知暂未开放')}
        >
          <span className="text-[16px]">群通知</span>
          <ChevronRight className="h-5 w-5 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        {/* 分组 tab 行 */}
        <div className="sticky top-0 z-10 flex gap-5 overflow-x-auto border-b border-black/[0.05] bg-[#FAFAFC]/95 px-4 py-2.5 backdrop-blur dark:border-white/[0.06] dark:bg-[#16171A]/95">
          {CT_TABS.map((t) => (
            <button
              key={t}
              type="button"
              data-testid={`qq-ct-tab-${t}`}
              onClick={() => setTab(t)}
              className={`relative shrink-0 pb-1.5 text-[15px] ${tab === t ? `font-semibold ${TAB_ACTIVE}` : 'text-black/55 dark:text-white/55'}`}
            >
              {t}
              {tab === t && <span className="absolute inset-x-1 bottom-0 h-[3px] rounded-full bg-[#1E6FFF] dark:bg-[#4AA3FF]" aria-hidden="true" />}
            </button>
          ))}
        </div>

        {tab === '分组' && (
          <div>
            {/* 特别关心 */}
            <button
              type="button"
              onClick={() => setExpandSpecial((v) => !v)}
              className="flex w-full items-center gap-2 px-4 py-3.5 text-left active:bg-black/[0.04]"
              data-testid="qq-group-special"
            >
              <svg
                viewBox="0 0 12 12"
                className={`h-3 w-3 shrink-0 text-black/45 transition-transform dark:text-white/45 ${expandSpecial ? 'rotate-90' : ''}`}
                aria-hidden="true"
              >
                <path d="M3 1.5 9 6 3 10.5z" fill="currentColor" />
              </svg>
              <span className="text-[16px] font-medium">特别关心</span>
              <span className="ml-auto text-[13px] text-black/30 dark:text-white/30">{special.length}/0</span>
            </button>
            {expandSpecial &&
              special.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onOpenProfile(c)}
                  className="flex w-full items-center gap-3 py-2 pl-9 pr-4 text-left active:bg-black/[0.04]"
                >
                  <QqAvatar src={c.avatar} alt={c.name} size={42} />
                  <span className="truncate text-[15px]">{c.name}</span>
                </button>
              ))}
            {/* 我的好友 */}
            <button
              type="button"
              onClick={() => setExpandFriends((v) => !v)}
              className="flex w-full items-center gap-2 px-4 py-3.5 text-left active:bg-black/[0.04]"
              data-testid="qq-group-friends"
            >
              <svg
                viewBox="0 0 12 12"
                className={`h-3 w-3 shrink-0 text-black/45 transition-transform dark:text-white/45 ${expandFriends ? 'rotate-90' : ''}`}
                aria-hidden="true"
              >
                <path d="M3 1.5 9 6 3 10.5z" fill="currentColor" />
              </svg>
              <span className="text-[16px] font-medium">我的好友</span>
              <span className="ml-auto text-[13px] text-black/30 dark:text-white/30">{friends.length}/{friends.length}</span>
            </button>
            {expandFriends && (
              <>
                {/* 我：好友列表首位（点击进自己的资料页） */}
                <button
                  type="button"
                  data-testid="qq-contacts-me"
                  onClick={onOpenMeProfile}
                  className="flex w-full items-center gap-3 py-2 pl-9 pr-4 text-left active:bg-black/[0.04]"
                >
                  <QqAvatar src={me.avatar} alt={me.name} size={42} />
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[15px]">{me.name}</span>
                    <span className="shrink-0 rounded-[4px] bg-black/[0.06] px-1 py-px text-[11px] leading-[14px] text-black/45 dark:bg-white/10 dark:text-white/50">我</span>
                  </span>
                </button>
                {normalFriends.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onOpenProfile(c)}
                    className="flex w-full items-center gap-3 py-2 pl-9 pr-4 text-left active:bg-black/[0.04]"
                  >
                    <QqAvatar src={c.avatar} alt={c.name} size={42} />
                    <span className="truncate text-[15px]">{c.name}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {tab === '好友' && (
          <div>
            {/* 我：好友列表首位（搜索时仅名字命中才显示） */}
            {(!kw || me.name.toLowerCase().includes(kw)) && (
              <button
                type="button"
                data-testid="qq-contacts-me-friend"
                onClick={onOpenMeProfile}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04]"
              >
                <QqAvatar src={me.avatar} alt={me.name} size={42} />
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[15px]">{me.name}</span>
                  <span className="shrink-0 rounded-[4px] bg-black/[0.06] px-1 py-px text-[11px] leading-[14px] text-black/45 dark:bg-white/10 dark:text-white/50">我</span>
                </span>
              </button>
            )}
            {filteredFriends.length === 0 && (
              <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">暂无好友</p>
            )}
            {filteredFriends.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpenProfile(c)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04]"
              >
                <QqAvatar src={c.avatar} alt={c.name} size={42} />
                <span className="truncate text-[15px]">{c.name}</span>
              </button>
            ))}
          </div>
        )}

        {tab === '群聊' && (
          <div>
            {/* 发起群聊入口已迁移至消息页右上角「+」菜单（对照需求：创建群聊移到加号里面） */}
            {filteredGroups.length === 0 ? (
              <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">暂无群聊，点消息页右上角「+」创建</p>
            ) : (
              filteredGroups.map((g) => {
                const p = groupPreview(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    data-testid={`qq-contacts-group-${g.id}`}
                    onClick={() => onOpenGroup(g)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.05]"
                  >
                    <QqGroupAvatar group={g} contacts={contacts} size={42} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{g.remark?.trim() || g.name}</span>
                      {p.text && <span className="block truncate text-[12px] text-black/35 dark:text-white/35">{p.text}</span>}
                    </span>
                    <span className="shrink-0 text-[11px] text-black/30 dark:text-white/30">{g.memberIds.length + 1}人</span>
                  </button>
                );
              })
            )}
          </div>
        )}

        {(tab === '频道' || tab === '机器人' || tab === '设备') && (
          <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">暂无{tab}</p>
        )}
      </div>
    </div>
  );
}

// ---------------- 动态页 ----------------

const DISCOVER_ITEMS: { key: string; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'zone', label: '空间动态', icon: <Star className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#FFC300' },
  { key: 'game', label: '游戏中心', icon: <Gamepad2 className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#1E6FFF' },
  { key: 'mini', label: '小游戏', icon: <CircleUser className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#1E6FFF' },
  { key: 'farm', label: 'QQ经典农场', icon: <Sprout className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#34C759' },
  { key: 'nearby', label: '结伴与附近', icon: <Users className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#7D5FFF' },
  { key: 'novel', label: '小说与动漫', icon: <BookOpen className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#FF9F0A' },
  { key: 'feedback', label: '意见反馈', icon: <MessageSquarePlus className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#1E6FFF' },
];

function DiscoverPage({
  me,
  onAvatar,
  onZone,
  onToast,
}: {
  me: QQUser;
  onAvatar: () => void;
  onZone: () => void;
  onToast: (m: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <QqHeader
        user={me}
        title="动态"
        onAvatar={onAvatar}
        action={
          <button type="button" aria-label="动态管理" className="rounded-full p-1.5 active:bg-black/5" onClick={() => onToast('动态管理暂未开放')}>
            <LayoutGrid className="h-6 w-6" strokeWidth={2} />
          </button>
        }
      />
      <div className="px-4 pb-2 pt-1">
        <QqSearch value="" onChange={() => undefined} />
      </div>
      <div className="flex-1 overflow-y-auto pb-4" data-testid="qq-discover-list">
        {DISCOVER_ITEMS.map((it, idx) => (
          <div key={it.key}>
            {(idx === 1 || idx === 5 || idx === 6) && <div className="h-2 bg-black/[0.03] dark:bg-white/[0.04]" aria-hidden="true" />}
            <button
              type="button"
              data-testid={`qq-discover-${it.key}`}
              onClick={() => (it.key === 'zone' ? onZone() : onToast(`${it.label}暂未开放`))}
              className="flex w-full items-center gap-4 bg-transparent px-4 py-3.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.05]"
            >
              <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px]" style={{ color: it.color }} aria-hidden="true">
                {it.icon}
              </span>
              <span className="flex-1 truncate text-[16px]">{it.label}</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- 个人资料页 ----------------

function ProfilePage({
  me,
  onBack,
  onOpenZone,
  onOpenSettings,
  onOpenChat,
  onPatchUser,
  onToast,
}: {
  me: QQUser;
  onBack: () => void;
  onOpenZone: () => void;
  onOpenSettings: () => void;
  onOpenChat: () => void;
  onPatchUser: (patch: Partial<QQUser>) => void;
  onToast: (m: string) => void;
}) {
  const [editSign, setEditSign] = useState(false);
  const [signDraft, setSignDraft] = useState(me.persona ?? '');
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const bgFileRef = useRef<HTMLInputElement | null>(null);

  // 背景图：IndexedDB 永久保存，进页时恢复
  useEffect(() => {
    let alive = true;
    getQqProfileBg()
      .then((data) => {
        if (alive && data) setBgUrl(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const commitSign = () => {
    setEditSign(false);
    const t = signDraft.trim().slice(0, 60);
    if (t === (me.persona ?? '')) return;
    onPatchUser({ persona: t });
    updateContact(me.id, { persona: t }).catch(() => onToast('个签保存失败'));
  };

  const onBgFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = typeof reader.result === 'string' ? reader.result : '';
      if (!data) return;
      setBgUrl(data);
      void setQqProfileBg(data).catch(() => onToast('背景保存失败'));
      onToast('背景已更新');
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F6F7F9] pt-[54px] dark:bg-[#111214]">
      {/* 背景图：上传的自定义图（永久保存）> 头像模糊放大 > 蓝灰渐变；高度 320px（轨迹 280→…→290→320，用户要求「上下变大一点」），点击背景任意位置即可更换（无相机按钮） */}
      <div
        role="button"
        aria-label="更换背景"
        data-testid="qq-profile-bg-upload"
        onClick={() => bgFileRef.current?.click()}
        className="absolute inset-x-0 top-0 h-[320px] cursor-pointer"
      >
        {bgUrl ? (
          <img src={bgUrl} alt="个人资料背景" className="h-full w-full object-cover" />
        ) : me.avatar ? (
          <img
            src={me.avatar}
            alt=""
            aria-hidden="true"
            className="h-full w-full scale-125 object-cover blur-2xl brightness-[0.62]"
          />
        ) : (
          <div aria-hidden="true" className="h-full w-full bg-gradient-to-b from-[#93A9CC] to-[#5E6D88]" />
        )}
        <input ref={bgFileRef} type="file" accept="image/*" onChange={onBgFile} className="hidden" tabIndex={-1} aria-hidden="true" />
      </div>

      {/* 顶部浮钮：返回 + 宫格/铃铛/设置 */}
      <div className="relative z-10 flex items-center justify-between px-3">
        <button
          type="button"
          aria-label="返回"
          onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-full bg-black/25 text-white backdrop-blur active:bg-black/40"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="更多"
            onClick={() => onToast('更多暂未开放')}
            className="grid h-9 w-9 place-items-center rounded-full bg-black/25 text-white backdrop-blur active:bg-black/40"
          >
            <LayoutGrid className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="通知"
            onClick={() => onToast('通知暂未开放')}
            className="grid h-9 w-9 place-items-center rounded-full bg-black/25 text-white backdrop-blur active:bg-black/40"
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="设置"
            data-testid="qq-profile-settings"
            onClick={onOpenSettings}
            className="grid h-9 w-9 place-items-center rounded-full bg-black/25 text-white backdrop-blur active:bg-black/40"
          >
            <Settings className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* 白色圆角主卡（与背景图叠压：卡顶 215px，露出 215px 背景，叠压 105px） */}
      <div className="relative z-10 mt-[125px] flex-1 overflow-y-auto rounded-t-[22px] bg-white px-5 pb-4 pt-6 dark:bg-[#1B1C1F]">
        {/* 头像 + 昵称/状态 + QQ号 + 点赞 */}
        <div className="flex items-start gap-4">
          <QqAvatar src={me.avatar} alt={me.name} size={84} />
          <div className="min-w-0 flex-1 pt-1">
            <div className="flex items-center gap-2">
              <span className="max-w-[130px] truncate text-[20px] font-bold leading-tight">{me.name}</span>
              <button
                type="button"
                onClick={() => onToast('状态暂未开放')}
                className="flex h-[26px] shrink-0 items-center gap-1 rounded-full border border-black/12 px-2.5 text-[12px] text-black/60 active:opacity-60 dark:border-white/20 dark:text-white/60"
              >
                <SmilePlus className="h-3.5 w-3.5" aria-hidden="true" />
                状态
              </button>
            </div>
            <div className="mt-1.5 truncate text-[13px] text-black/45 dark:text-white/45" data-testid="qq-profile-qqid">
              QQ:{me.qqId ?? '未设置'}
            </div>
          </div>
          <button
            type="button"
            aria-label="点赞"
            onClick={() => onToast('点赞暂未开放')}
            className="flex shrink-0 flex-col items-center gap-0.5 pt-1 text-black/65 active:opacity-60 dark:text-white/65"
          >
            <ThumbsUp className="h-5 w-5" strokeWidth={1.9} />
            <span className="text-[12px]">60</span>
          </button>
        </div>

        {/* 个签（点击就地编辑，保存到联系人库） */}
        {editSign ? (
          <input
            data-testid="qq-profile-sign-input"
            value={signDraft}
            autoFocus
            onChange={(e) => setSignDraft(e.target.value)}
            onBlur={commitSign}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitSign();
              if (e.key === 'Escape') {
                setSignDraft(me.persona ?? '');
                setEditSign(false);
              }
            }}
            maxLength={60}
            placeholder="编辑个签，展示我的独特态度。"
            aria-label="编辑个性签名"
            className="mt-5 h-9 w-full rounded-[8px] bg-black/[0.05] px-3 text-[15px] outline-none dark:bg-white/[0.08]"
          />
        ) : (
          <button
            type="button"
            data-testid="qq-profile-sign"
            onClick={() => {
              setSignDraft(me.persona ?? '');
              setEditSign(true);
            }}
            className="mt-5 flex w-full items-center justify-between gap-3 text-left active:opacity-70"
          >
            <span className="truncate text-[15px]">{me.persona || '编辑个签，展示我的独特态度。'}</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        )}

        {/* 徽章行（QQ 等级图标；SVIP8/勋章/LV8/LV3 已删除） */}
        <QqBadgeWall testid="qq-profile-badges" mtClass="mt-4" onOpen={() => onToast('勋章墙暂未开放')} />

        {/* 添加标签 */}
        <button
          type="button"
          onClick={() => onToast('标签暂未开放')}
          className="mt-5 flex h-8 items-center gap-1.5 rounded-[8px] bg-black/[0.045] px-3 text-[13px] text-black/55 active:opacity-60 dark:bg-white/[0.08] dark:text-white/55"
        >
          添加标签
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        {/* 资料完成度 */}
        <div className="-mx-5 mt-5 h-2 bg-black/[0.04] dark:bg-white/[0.05]" aria-hidden="true" />
        <button
          type="button"
          onClick={() => onToast('资料完善请到「联系人」App')}
          className="flex h-[54px] w-full items-center gap-3 text-left active:opacity-70"
        >
          <FileText className="h-5 w-5 shrink-0 text-black/70 dark:text-white/70" aria-hidden="true" />
          <span className="flex-1 truncate text-[15px]">资料完成度60%</span>
          <span className="text-[14px] text-[#1E6FFF] dark:text-[#4AA3FF]">去完善</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        {/* QQ空间 */}
        <div className="-mx-5 h-2 bg-black/[0.04] dark:bg-white/[0.05]" aria-hidden="true" />
        <button
          type="button"
          data-testid="qq-profile-zone"
          onClick={onOpenZone}
          className="flex h-[54px] w-full items-center gap-3 text-left active:opacity-70"
        >
          <Star className="h-5 w-5 shrink-0 text-black/70 dark:text-white/70" aria-hidden="true" />
          <span className="flex-1 truncate text-[15px]">QQ空间</span>
          <span className="text-[14px] text-[#1E6FFF] dark:text-[#4AA3FF]">分享新鲜事</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>
      </div>

      {/* 底部三按钮 */}
      <div className="relative z-10 flex shrink-0 gap-3 bg-white px-4 pb-[40px] pt-3 dark:bg-[#1B1C1F]">
        <button
          type="button"
          onClick={() => onToast('个性名片暂未开放')}
          className="h-11 flex-1 rounded-[12px] bg-black/[0.05] text-[15px] active:opacity-70 dark:bg-white/[0.08]"
        >
          个性名片
        </button>
        <button
          type="button"
          onClick={() => onToast('编辑资料请到「联系人」App')}
          className="h-11 flex-1 rounded-[12px] bg-black/[0.05] text-[15px] active:opacity-70 dark:bg-white/[0.08]"
        >
          编辑资料
        </button>
        <button
          type="button"
          data-testid="qq-profile-message"
          onClick={onOpenChat}
          className="h-11 flex-1 rounded-[12px] text-[15px] font-medium text-white active:brightness-95"
          style={{ backgroundColor: QQ_BLUE }}
        >
          发消息
        </button>
      </div>
    </div>
  );
}

// ---------------- 个人中心抽屉（消息/联系人/动态页左上头像打开） ----------------

function MeDrawer({
  me,
  onClose,
  onOpenProfile,
  onOpenWallet,
  onOpenStickers,
  onOpenFavorites,
  onOpenSettings,
  onSwitchAccount,
  onPatchUser,
  onToast,
}: {
  me: QQUser;
  onClose: () => void;
  onOpenProfile: () => void;
  onOpenWallet: () => void;
  onOpenStickers: () => void;
  onOpenFavorites: () => void;
  onOpenSettings: () => void;
  onSwitchAccount: () => void;
  onPatchUser: (patch: Partial<QQUser>) => void;
  onToast: (m: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const [editSign, setEditSign] = useState(false);
  const [signDraft, setSignDraft] = useState(me.persona ?? '');
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const close = () => {
    setShown(false);
    window.setTimeout(onClose, 240);
  };

  // 左滑手势：面板任意位置（输入控件除外）水平左滑 → 关闭抽屉（配合右滑打开）
  const swipe = useRef<{ x: number; y: number; fired: boolean } | null>(null);
  const onSwipeStart = (e: React.PointerEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea')) return;
    swipe.current = { x: e.clientX, y: e.clientY, fired: false };
  };
  const onSwipeMove = (e: React.PointerEvent) => {
    const t = swipe.current;
    if (!t || t.fired) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (dx < -50 && Math.abs(dy) < 80) {
      t.fired = true;
      close();
      return;
    }
    if (dx > 30 || Math.abs(dy) > 90) t.fired = true; // 反向/纵向则放弃，避免误触发
  };

  const commitSign = () => {
    setEditSign(false);
    const t = signDraft.trim().slice(0, 60);
    if (t === (me.persona ?? '')) return;
    onPatchUser({ persona: t });
    updateContact(me.id, { persona: t }).catch(() => onToast('个签保存失败'));
  };

  const listRows: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void }[] = [
    { icon: <ImageIcon className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '相册', onClick: () => onToast('相册暂未开放') },
    { icon: <Star className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '收藏', onClick: () => { close(); window.setTimeout(onOpenFavorites, 240); } },
    { icon: <Smile className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '表情', onClick: () => { close(); window.setTimeout(onOpenStickers, 240); } },
    { icon: <Wallet className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '钱包', onClick: () => { close(); window.setTimeout(onOpenWallet, 240); } },
    { icon: <Crown className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '会员中心', hint: '联会会员买一送一', onClick: () => onToast('会员中心暂未开放') },
    { icon: <Shirt className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '个性装扮', onClick: () => onToast('个性装扮暂未开放') },
    { icon: <Radio className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '免流量', hint: '限时推广', onClick: () => onToast('免流量暂未开放') },
  ];
  const rowColors = ['#F5B90F', '#3BA0FF', '#3BA0FF', '#3BA0FF', '#F0619B', '#F0479C', '#3BC86A'];

  return (
    <div className="absolute inset-0 z-40 overflow-hidden" role="dialog" aria-label="个人中心">
      {/* 全屏独立页：整页白底 + 从左往右滑入（translate-x 从 -100% 到 0） */}
      <div
        className={`relative flex h-full flex-col overflow-hidden bg-white transition-transform duration-300 ease-out dark:bg-[#17181C] ${
          shown ? 'translate-x-0' : '-translate-x-full'
        }`}
        onPointerDown={onSwipeStart}
        onPointerMove={onSwipeMove}
        onPointerCancel={() => {
          swipe.current = null;
        }}
        onPointerUp={() => {
          // 延迟到 click 派发后再清空，让 onClickCapture 能拦截手势后的误点击
          window.setTimeout(() => {
            swipe.current = null;
          }, 0);
        }}
        onClickCapture={(e) => {
          if (swipe.current?.fired) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {/* 整页滚动：顶部（打卡/头像/昵称）随内容一起滚动，不再固定 */}
        <div className="relative flex-1 overflow-y-auto">
        {/* 顶部（无背景图）：打卡/状态 pills 缩小行置顶，其下头像/昵称/切换账号；点击行间空白处关闭抽屉 */}
        <div className="relative w-full px-4 pb-1 pt-[62px]" onClick={close}>
          <div className="relative z-10" onClick={(e) => e.stopPropagation()}>
            <QqCheckinPills testidPrefix="qq-drawer" onToast={onToast} />
          </div>
          {/* 头像 + 昵称 + 切换账号 + 关闭（打卡/状态 pills 正下方） */}
          <div className="relative z-10 mt-3 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="查看个人资料" data-testid="qq-drawer-avatar" onClick={onOpenProfile} className="rounded-full active:opacity-80">
              <QqAvatar src={me.avatar} alt={me.name} size={64} />
            </button>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                aria-label="查看个人资料"
                data-testid="qq-drawer-name"
                onClick={onOpenProfile}
                className="block max-w-full truncate text-left text-[20px] font-bold leading-tight active:opacity-70"
              >
                {me.name}
              </button>
              <button
                type="button"
                data-testid="qq-drawer-switch"
                onClick={onSwitchAccount}
                className="mt-1.5 flex h-7 items-center rounded-full border border-black/12 px-3 text-[12px] text-black/60 active:opacity-60 dark:border-white/20 dark:text-white/60"
              >
                切换账号
              </button>
            </div>
            <button
              type="button"
              aria-label="关闭个人中心"
              data-testid="qq-drawer-close"
              onClick={close}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10"
            >
              <X className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* 白色主卡（整页白底；无背景图，内容从个签开始紧随顶部） */}
        <div className="relative px-5 pb-2 pt-3">
          {/* 个签（可编辑） */}
          <div className="mt-3 flex items-center gap-2">
            <SquarePen className="h-4 w-4 shrink-0 text-black/45 dark:text-white/45" aria-hidden="true" />
            {editSign ? (
              <input
                data-testid="qq-drawer-sign-input"
                value={signDraft}
                autoFocus
                onChange={(e) => setSignDraft(e.target.value)}
                onBlur={commitSign}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitSign();
                  if (e.key === 'Escape') {
                    setSignDraft(me.persona ?? '');
                    setEditSign(false);
                  }
                }}
                maxLength={60}
                placeholder="编辑个签，展示我的独特态度。"
                className="h-8 w-full rounded-[8px] bg-black/[0.04] px-2.5 text-[14px] outline-none dark:bg-white/[0.08]"
              />
            ) : (
              <button
                type="button"
                data-testid="qq-drawer-sign"
                onClick={() => {
                  setSignDraft(me.persona ?? '');
                  setEditSign(true);
                }}
                className="truncate text-left text-[15px] text-black/60 active:opacity-60 dark:text-white/60"
              >
                {me.persona || '编辑个签，展示我的独特态度。'}
              </button>
            )}
          </div>

          {/* 天气 + 添加标签 */}
          <div className="mt-4 flex items-center gap-3">
            <span className="text-[18px]" aria-hidden="true">
              🌤️
            </span>
            <button
              type="button"
              onClick={() => onToast('标签暂未开放')}
              className="flex h-8 items-center gap-1 rounded-full border border-black/12 px-3 text-[13px] text-black/55 active:opacity-60 dark:border-white/20 dark:text-white/55"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              添加标签
            </button>
          </div>

          {/* 通知 | 赞 + 创建QQ秀 */}
          <div className="mt-5 flex items-center text-[14px] text-black/65 dark:text-white/65">
            <button type="button" onClick={() => onToast('通知暂未开放')} className="flex items-center gap-1.5 active:opacity-60">
              <Bell className="h-4 w-4" aria-hidden="true" />
              通知
            </button>
            <span className="mx-3 h-3.5 w-px bg-black/10 dark:bg-white/15" aria-hidden="true" />
            <button type="button" onClick={() => onToast('赞暂未开放')} className="flex items-center gap-1.5 active:opacity-60">
              <ThumbsUp className="h-4 w-4" aria-hidden="true" />60
            </button>
            <button
              type="button"
              onClick={() => onToast('QQ秀暂未开放')}
              className="ml-auto flex h-8 items-center gap-1 rounded-full bg-black/[0.05] px-3 text-[13px] active:opacity-60 dark:bg-white/[0.08]"
            >
              🐧 创建QQ秀
            </button>
          </div>

          {/* 功能列表 */}
          <div className="mt-4">
            {listRows.map((r, i) => (
              <button
                key={r.label}
                type="button"
                onClick={r.onClick}
                className="flex h-[54px] w-full items-center gap-4 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center" style={{ color: rowColors[i] }} aria-hidden="true">
                  {r.icon}
                </span>
                <span className="flex-1 truncate text-[16px]">{r.label}</span>
                {r.hint && <span className="text-[13px] text-black/30 dark:text-white/30">{r.hint}</span>}
                <ChevronRight className="h-5 w-5 shrink-0 text-black/22 dark:text-white/25" aria-hidden="true" />
              </button>
            ))}
          </div>

          {/* 底部：设置 / 夜间 / 天气城市 */}
          <div className="mt-2 flex items-center justify-around border-t border-black/[0.05] pb-[44px] pt-3 dark:border-white/[0.06]">
            {[
              { icon: <Settings className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '设置', fn: onOpenSettings, testid: 'qq-drawer-settings' },
              { icon: <Moon className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '夜间', fn: () => onToast('夜间模式跟随系统设置'), testid: 'qq-drawer-night' },
              { icon: <CloudSun className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '濮阳', fn: () => onToast('天气详见「天气」App'), testid: 'qq-drawer-weather' },
            ].map((b) => (
              <button
                key={b.label}
                type="button"
                data-testid={b.testid}
                onClick={() => {
                  if (b.label === '设置') {
                    close();
                    window.setTimeout(b.fn, 240);
                  } else {
                    b.fn();
                  }
                }}
                className="flex w-16 flex-col items-center gap-1 text-black/60 active:opacity-60 dark:text-white/60"
              >
                {b.icon}
                <span className="text-[12px]">{b.label}</span>
              </button>
            ))}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- 添加好友页（找人/找群 + 七宫格 + 推荐） / 新朋友页（可能想认识的人） ----------------

function AddPersonRow({
  c,
  busy,
  onAdd,
  onOpen,
}: {
  c: ContactRecord;
  busy: boolean;
  onAdd: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button type="button" aria-label={`查看${c.name}`} onClick={onOpen} className="rounded-full active:opacity-80">
        <QqAvatar src={c.avatar} alt={c.name} size={56} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[16px] font-medium">{c.name}</span>
        </div>
        {(c.age || c.region) && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {c.age && (
              <span className="rounded-[4px] bg-black/[0.05] px-1.5 py-0.5 text-[11px] text-black/50 dark:bg-white/[0.08] dark:text-white/50">
                {c.gender === '男' ? '♂' : c.gender === '女' ? '♀' : ''}
                {c.age}岁
              </span>
            )}
            {c.region && (
              <span className="rounded-[4px] bg-black/[0.05] px-1.5 py-0.5 text-[11px] text-black/50 dark:bg-white/[0.08] dark:text-white/50">
                {c.region}
              </span>
            )}
          </div>
        )}
        <div className="mt-0.5 truncate text-[12px] text-black/35 dark:text-white/35">有共同好友</div>
      </div>
      <button
        type="button"
        data-testid={`qq-add-btn-${c.id}`}
        disabled={busy}
        onClick={onAdd}
        className="h-10 shrink-0 rounded-full border border-black/15 px-6 text-[15px] text-black/70 active:bg-black/5 disabled:opacity-50 dark:border-white/25 dark:text-white/70"
      >
        添加
      </button>
    </div>
  );
}

function AddFriendPage({
  me,
  contacts,
  onBack,
  onContactsChanged,
  onOpenChat,
  onToast,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  onBack: () => void;
  onContactsChanged: () => void;
  onOpenChat: (c: ContactRecord) => void;
  onToast: (m: string) => void;
}) {
  const [kw, setKw] = useState('');
  const [tab, setTab] = useState<'找人' | '找群'>('找人');
  const [adding, setAdding] = useState<string | null>(null);

  // 推荐：未加 QQ 好友的人（char/npc，排除自己；QQ 好友独立，微信/信息里加过的不算）
  const suggestions = useMemo(() => contacts.filter((c) => !isFriendIn(c, 'qq') && c.id !== me.id).slice(0, 8), [contacts, me.id]);
  // 搜索：仅按 QQ 号匹配（输入 QQ 号才出现联系人）
  const results = useMemo(() => {
    const k = kw.trim();
    if (!k) return null;
    return contacts.filter((c) => c.id !== me.id && (c.qqId ?? '').includes(k));
  }, [contacts, kw, me.id]);

  const addFriend = async (c: ContactRecord) => {
    if (adding) return;
    setAdding(c.id);
    try {
      await updateContact(c.id, { friendQq: true });
      onContactsChanged();
      onToast(`已添加 ${c.name} 为好友`);
    } catch {
      onToast('添加失败，请稍后再试');
    } finally {
      setAdding(null);
    }
  };

  // 七宫格（对照 QQ 真机添加好友页：第一行 4 个 + 第二行 3 个）
  const gridTop: { label: string; icon: React.ReactNode }[] = [
    { label: '手机联系人', icon: <Smartphone className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { label: '扫一扫', icon: <QrCode className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { label: '面对面添加', icon: <Radio className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { label: '条件查找', icon: <Search className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
  ];
  const gridBottom: { label: string; icon: React.ReactNode }[] = [
    { label: '面对面建群', icon: <Plus className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { label: '附近的人', icon: <MapPin className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { label: '结伴交友', icon: <Users className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
  ];
  const gridBtn = (g: { label: string; icon: React.ReactNode }) => (
    <button
      key={g.label}
      type="button"
      onClick={() => onToast(`${g.label}暂未开放`)}
      className="flex w-full flex-col items-center gap-2 py-2.5 text-black/85 active:opacity-60 dark:text-white/85"
    >
      {g.icon}
      <span className="text-[13px]">{g.label}</span>
    </button>
  );

  const resultRows = (list: ContactRecord[]) =>
    list.map((c) =>
      isFriendIn(c, 'qq') ? (
        <div key={c.id} className="flex items-center gap-3 px-4 py-3">
          <QqAvatar src={c.avatar} alt={c.name} size={56} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-medium">{c.name}</div>
            <div className="mt-0.5 text-[12px] text-black/35 dark:text-white/35">{c.qqId ? `QQ:${c.qqId}` : '已是好友'}</div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChat(c)}
            className="h-9 shrink-0 rounded-full px-5 text-[14px] font-medium text-white active:brightness-95"
            style={{ backgroundColor: QQ_BLUE }}
          >
            发消息
          </button>
        </div>
      ) : (
        <AddPersonRow key={c.id} c={c} busy={adding === c.id} onAdd={() => void addFriend(c)} onOpen={() => onOpenChat(c)} />
      )
    );

  return (
    <div className="flex h-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：返回 + 找人/找群 分段（对照 QQ 真机添加好友页） */}
      <div className="relative flex h-12 shrink-0 items-center px-3">
        <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <div
          className="absolute left-1/2 flex -translate-x-1/2 items-center rounded-full bg-black/[0.05] p-[3px] dark:bg-white/[0.08]"
          role="tablist"
          aria-label="找人找群"
        >
          {(['找人', '找群'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              data-testid={`qq-addfriend-tab-${t}`}
              onClick={() => setTab(t)}
              className={`h-8 rounded-full px-6 text-[15px] ${
                tab === t
                  ? 'bg-white font-medium text-black shadow-[0_1px_4px_rgba(0,0,0,0.1)] dark:bg-[#3A3C42] dark:text-white'
                  : 'text-black/60 dark:text-white/60'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* 搜索：仅输入 QQ 号才出现联系人（placeholder 居中对照真机） */}
      <div className="px-4 pb-3 pt-2">
        <div className="relative flex h-[42px] items-center rounded-[12px] bg-[#F2F3F5] px-3.5 dark:bg-white/[0.08]">
          <input
            data-testid="qq-addfriend-search"
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="QQ号/QID/手机号/群"
            aria-label="QQ号/QID/手机号/群"
            autoCapitalize="off"
            autoCorrect="off"
            className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-transparent dark:placeholder:text-transparent"
          />
          {!kw && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 text-[15px] text-black/30 dark:text-white/30">
              <Search className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden="true" />
              QQ号/QID/手机号/群
            </span>
          )}
          {kw && (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => setKw('')}
              className="ml-auto grid h-5 w-5 shrink-0 place-items-center rounded-full bg-black/20 text-white dark:bg-white/25"
            >
              <X className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" data-testid="qq-addfriend-body">
        {tab === '找群' ? (
          kw.trim() ? (
            <p className="mt-14 text-center text-[13px] text-black/30 dark:text-white/30">未找到相关的群</p>
          ) : (
            <p className="mt-14 text-center text-[13px] text-black/30 dark:text-white/30">暂无群推荐</p>
          )
        ) : results ? (
          results.length === 0 ? (
            <p className="mt-14 text-center text-[13px] text-black/30 dark:text-white/30">未找到相关的人</p>
          ) : (
            <>
              <p className="px-4 pb-1 pt-3 text-[13px] text-black/35 dark:text-white/35">找到 {results.length} 人</p>
              {resultRows(results)}
            </>
          )
        ) : (
          <>
            {/* 七宫格：第一行 4 个 + 第二行 3 个（与第一行前三列对齐，对照真机） */}
            <div className="grid grid-cols-4 px-1 pb-1 pt-4">{gridTop.map(gridBtn)}</div>
            <div className="grid grid-cols-4 px-1 pb-4">{gridBottom.map(gridBtn)}</div>

            {/* 可能想认识的人 */}
            <div className="flex items-center justify-between border-b border-black/[0.05] px-4 pb-2 pt-3 dark:border-white/[0.06]">
              <span className="text-[17px] font-semibold">可能想认识的人</span>
              <button
                type="button"
                onClick={() => onToast('查看更多暂未开放')}
                className="flex items-center text-[13px] text-black/40 active:opacity-60 dark:text-white/40"
              >
                查看更多
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {suggestions.length === 0 && (
              <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">暂时没有推荐，去「联系人」App 添加人物吧</p>
            )}
            {suggestions.map((c) => (
              <AddPersonRow key={c.id} c={c} busy={adding === c.id} onAdd={() => void addFriend(c)} onOpen={() => onOpenChat(c)} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- 新朋友页（联系人页「新朋友」进入；右上「添加」→ 添加好友页） ----------------

function NewFriendsPage({
  me,
  contacts,
  onBack,
  onOpenAdd,
  onContactsChanged,
  onOpenChat,
  onToast,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  onBack: () => void;
  onOpenAdd: () => void;
  onContactsChanged: () => void;
  onOpenChat: (c: ContactRecord) => void;
  onToast: (m: string) => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const [showSync, setShowSync] = useState(true);

  // 推荐：未加 QQ 好友的人（char/npc，排除自己；QQ 好友独立，微信/信息里加过的不算）
  const suggestions = useMemo(() => contacts.filter((c) => !isFriendIn(c, 'qq') && c.id !== me.id).slice(0, 8), [contacts, me.id]);

  const addFriend = async (c: ContactRecord) => {
    if (adding) return;
    setAdding(c.id);
    try {
      await updateContact(c.id, { friendQq: true });
      onContactsChanged();
      onToast(`已添加 ${c.name} 为好友`);
    } catch {
      onToast('添加失败，请稍后再试');
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：返回 + 新朋友 + 添加 */}
      <div className="relative flex h-12 shrink-0 items-center px-3">
        <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">新朋友</span>
        <button
          type="button"
          data-testid="qq-newfriends-add"
          onClick={onOpenAdd}
          className="ml-auto text-[16px] text-black/75 active:opacity-60 dark:text-white/75"
        >
          添加
        </button>
      </div>

      <div className="flex-1 overflow-y-auto" data-testid="qq-newfriends-body">
        {/* 同步通讯录横幅 */}
        {showSync && (
          <div className="flex h-[58px] items-center gap-3 border-b border-black/[0.05] px-4 dark:border-white/[0.06]">
            <span className="flex-1 text-[16px]">同步通讯录</span>
            <button
              type="button"
              data-testid="qq-newfriends-sync"
              onClick={() => onToast('通讯录同步已启用')}
              className="h-9 shrink-0 rounded-full px-5 text-[15px] font-medium text-white active:brightness-95"
              style={{ backgroundColor: QQ_BLUE }}
            >
              启用
            </button>
            <button
              type="button"
              aria-label="关闭同步通讯录"
              data-testid="qq-newfriends-sync-close"
              onClick={() => setShowSync(false)}
              className="shrink-0 rounded-full p-1.5 text-black/35 active:bg-black/5 dark:text-white/35"
            >
              <X className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="h-2.5 bg-black/[0.035] dark:bg-white/[0.05]" aria-hidden="true" />

        {/* 可能想认识的人 */}
        <div className="flex items-center justify-between border-b border-black/[0.05] px-4 pb-2 pt-3 dark:border-white/[0.06]">
          <span className="text-[17px] font-semibold">可能想认识的人</span>
          <button
            type="button"
            onClick={() => onToast('查看更多暂未开放')}
            className="flex items-center text-[13px] text-black/40 active:opacity-60 dark:text-white/40"
          >
            查看更多
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {suggestions.length === 0 && (
          <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">暂时没有推荐，去「联系人」App 添加人物吧</p>
        )}
        {suggestions.map((c) => (
          <AddPersonRow key={c.id} c={c} busy={adding === c.id} onAdd={() => void addFriend(c)} onOpen={() => onOpenChat(c)} />
        ))}
      </div>
    </div>
  );
}

// ---------------- QQ空间动态流（动态 tab - 空间动态） ----------------

function ZonePage({
  me,
  contacts,
  onBack,
  onOpenSettings,
  onCompose,
  onToast,
}: {
  me: QQUser;
  /** 联系人列表（「让好友发一条」候选 + 平台好友过滤） */
  contacts: ContactRecord[];
  onBack: () => void;
  onOpenSettings: () => void;
  onCompose: () => void;
  onToast: (m: string) => void;
}) {
  const apiConfig = useSettings((s) => s.apiConfig);
  const [userPosts, setUserPosts] = useState<ZonePost[]>(loadZonePosts);
  const [seedLiked, setSeedLiked] = useState<Record<string, boolean>>(() => {
    try {
      const parsed: unknown = kvGet<Record<string, boolean>>(LS_ZONE_LIKES);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const [commentsMap, setCommentsMap] = useState<Record<string, ZoneComment[]>>(loadZoneComments);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  /** 回复目标：评论 id + 名字（带 id 才能支持回复 AI 评论后 AI 再回复的多轮链） */
  const [replyTarget, setReplyTarget] = useState<Record<string, { id: string; name: string } | undefined>>({});
  const commentInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  /** 「…」操作菜单 / 编辑说说 / 让好友发一条 / 自动发布设置 */
  const [menuPostId, setMenuPostId] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<{ id: string; content: string } | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [askBusyId, setAskBusyId] = useState<string | null>(null);
  const [cfgPeer, setCfgPeer] = useState<ContactRecord | null>(null);
  /** 长按删除的评论（确认弹层） */
  const [delComment, setDelComment] = useState<{ postId: string; commentId: string; author: string } | null>(null);
  /** 长按计时器 + 起点坐标（移动超阈值视为滚动取消）+ 长按后拦截紧随的 click */
  const pressRef = useRef<{ timer: number | null; x: number; y: number }>({ timer: null, x: 0, y: 0 });
  const suppressClickRef = useRef(false);

  const clearPress = () => {
    if (pressRef.current.timer) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current.timer = null;
    }
  };
  useEffect(() => clearPress, []);

  /** 长按评论（480ms）→ 删除确认；移动超 10px 视为滚动取消 */
  const startCommentPress = (p: ZonePost, c: ZoneComment) => (e: React.PointerEvent) => {
    if (p.id.startsWith('seed-')) return; // 示例动态的评论不支持删除
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearPress();
    pressRef.current = { x: e.clientX, y: e.clientY, timer: null };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = null;
      suppressClickRef.current = true;
      setDelComment({ postId: p.id, commentId: c.id, author: c.author });
    }, 480);
  };
  const onCommentPointerMove = (e: React.PointerEvent) => {
    const t = pressRef.current;
    if (!t.timer) return;
    if (Math.abs(e.clientX - t.x) > 10 || Math.abs(e.clientY - t.y) > 10) clearPress();
  };

  // 旧版遗留修复 + 订阅引擎刷新（AI 点赞/评论/新动态实时出现）
  useEffect(() => {
    repairLegacyMomentData();
    return subscribeMomentsChanged((platform) => {
      if (platform && platform !== 'qq') return;
      setUserPosts(loadZonePosts());
      setCommentsMap(loadZoneComments());
    });
  }, []);

  const posts: ZonePost[] = useMemo(() => [...userPosts, ...ZONE_SEEDS], [userPosts]);

  const addComment = (p: ZonePost) => {
    const t = (commentDrafts[p.id] ?? '').trim();
    if (!t) return;
    // 统一走动态引擎：回复 AI 的评论会自动排一条 AI 的再回复（多轮）；评论角色的动态会写入该角色记忆
    const rt = replyTarget[p.id];
    addUserMomentComment('qq', p.id, {
      userName: me.name,
      content: t,
      replyTo: rt ? { commentId: rt.id, name: rt.name } : undefined,
    });
    setCommentDrafts((d) => ({ ...d, [p.id]: '' }));
    setReplyTarget((r) => ({ ...r, [p.id]: undefined }));
  };

  const likedOf = (p: ZonePost): boolean =>
    p.id.startsWith('seed-') ? (seedLiked[p.id] ?? SEED_DEFAULT_LIKE[p.id] ?? false) : p.likedBy.includes(me.name);

  const namesOf = (p: ZonePost): string[] => {
    if (p.id.startsWith('seed-')) {
      const base = p.likedBy.map((n) => (n === 'ME' ? me.name : n)).filter((n) => n !== me.name);
      return likedOf(p) ? [me.name, ...base] : base;
    }
    return p.likedBy;
  };

  const toggleLike = (p: ZonePost) => {
    if (p.id.startsWith('seed-')) {
      const next = { ...seedLiked, [p.id]: !likedOf(p) };
      setSeedLiked(next);
      try {
        kvSet(LS_ZONE_LIKES, next);
      } catch {
        // 忽略
      }
      return;
    }
    // 统一走动态引擎（写入点赞名，评论区的 AI 可见）
    toggleUserMomentLike('qq', p.id, me.name);
  };

  /** 让 AI 好友现在发一条动态（内容按人设 + 最近聊天 + 记忆生成；发布即写该角色记忆） */
  const askMomentPost = async (c: ContactRecord) => {
    setAskBusyId(c.id);
    try {
      await aiPostMoment({ apiConfig, platform: 'qq', peer: c, userName: me.name });
      onToast(`已让「${displayNameOf(c)}」发了一条动态`);
      setAskOpen(false);
    } catch (e) {
      onToast(e instanceof Error && e.message ? e.message : '生成失败，请稍后再试');
    } finally {
      setAskBusyId(null);
    }
  };

  return (
    <div className="relative flex h-full flex-col bg-white dark:bg-[#111214]">
      {/* 全屏：整个页面（含顶部渐变区）在同一滚动容器里，头部随内容一起滚走 */}
      <div className="flex-1 overflow-y-auto" data-testid="qq-zone-feed">
      {/* 顶部渐变区：导航 + 个人卡 + 宫格 + 发布框（随页面滚动） */}
      <div className="bg-gradient-to-b from-[#D8E4F8] via-[#E9EEFA] to-white pb-3 pt-[54px] dark:from-[#242B3E] dark:via-[#1D2331] dark:to-[#111214]">
        <div className="flex items-center gap-2 px-3">
          <button
            type="button"
            aria-label="返回"
            onClick={onBack}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/70 text-black/75 backdrop-blur active:bg-white dark:bg-white/10 dark:text-white/80"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            aria-label="让好友发一条动态"
            title="让好友发一条动态"
            data-testid="qq-zone-ask"
            onClick={() => setAskOpen(true)}
            className="ml-auto grid h-9 w-9 place-items-center rounded-full bg-white/70 text-black/75 backdrop-blur active:bg-white dark:bg-white/10 dark:text-white/80"
          >
            <Sparkles className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="消息通知"
            onClick={() => onToast('通知暂未开放')}
            className="ml-2 grid h-9 w-9 place-items-center rounded-full bg-white/70 text-black/75 backdrop-blur active:bg-white dark:bg-white/10 dark:text-white/80"
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="设置"
            data-testid="qq-zone-settings"
            onClick={onOpenSettings}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/70 text-black/75 backdrop-blur active:bg-white dark:bg-white/10 dark:text-white/80"
          >
            <Settings className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>

        {/* 个人卡 */}
        <div className="mt-3 flex items-center gap-3 px-4">
          <QqAvatar src={me.avatar} alt={me.name} size={60} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[19px] font-semibold">{me.name}</span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-[13px] text-black/50 dark:text-white/50">
              <Eye className="h-4 w-4" aria-hidden="true" />
              总量 <span className="font-semibold">195</span> · <span className="font-semibold">+2</span>
            </div>
          </div>
        </div>

        {/* 宫格：说说/日志/相册/留言/更多（说说 → 写说说页） */}
        <div className="mt-3 flex px-1">
          {[
            { label: '说说', icon: <MessageSquare className="h-[22px] w-[22px]" strokeWidth={1.8} />, fn: onCompose, testid: 'qq-zone-shuoshuo' },
            { label: '日志', icon: <BookOpen className="h-[22px] w-[22px]" strokeWidth={1.8} />, fn: () => onToast('日志暂未开放'), testid: undefined },
            { label: '相册', icon: <ImageIcon className="h-[22px] w-[22px]" strokeWidth={1.8} />, fn: () => onToast('相册暂未开放'), testid: undefined },
            { label: '留言', icon: <MessageCircle className="h-[22px] w-[22px]" strokeWidth={1.8} />, fn: () => onToast('留言暂未开放'), testid: undefined },
            { label: '更多', icon: <LayoutGrid className="h-[22px] w-[22px]" strokeWidth={1.8} />, fn: () => onToast('更多暂未开放'), testid: undefined },
          ].map((g) => (
            <button
              key={g.label}
              type="button"
              data-testid={g.testid}
              onClick={g.fn}
              className="flex flex-1 flex-col items-center gap-1 text-[#3E7BCC] active:opacity-60 dark:text-[#6FA0DE]"
            >
              {g.icon}
              <span className="text-[12px] text-black/60 dark:text-white/60">{g.label}</span>
            </button>
          ))}
        </div>

        {/* 分享新鲜事：点击进入「写说说」页 */}
        <div className="mx-4 mt-3">
          <button
            type="button"
            data-testid="qq-zone-input"
            onClick={onCompose}
            className="w-full rounded-[14px] border border-black/10 bg-white/60 px-3 py-2.5 text-left backdrop-blur active:bg-white/85 dark:border-white/10 dark:bg-white/[0.06] dark:active:bg-white/[0.1]"
          >
            <span className="block text-[15px] text-black/30 dark:text-white/30">分享新鲜事…</span>
            <span className="mt-2 flex items-center text-black/45 dark:text-white/45">
              <ImageIcon className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
              <span className="mx-2.5 h-4 w-px bg-black/10 dark:bg-white/15" aria-hidden="true" />
              <Star className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
            </span>
          </button>
        </div>
      </div>

      {/* 动态流（与头部同一滚动容器） */}
        {posts.map((p) => {
          const liked = likedOf(p);
          const names = namesOf(p);
          const rt = replyTarget[p.id];
          return (
            <div key={p.id} className="border-b border-black/[0.06] px-4 py-4 dark:border-white/[0.06]">
              <div className="flex items-start gap-3">
                <QqAvatar src={p.avatar} alt={p.authorName} size={42} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate text-[16px] font-semibold text-[#4A78B8] dark:text-[#7FA8D9]">{p.authorName}</span>
                    <button
                      type="button"
                      aria-label="更多操作"
                      data-testid={`qq-zone-more-${p.id}`}
                      onClick={() => setMenuPostId(menuPostId === p.id ? null : p.id)}
                      className="shrink-0 px-1 text-[18px] leading-none text-black/40 active:opacity-60 dark:text-white/40"
                    >
                      …
                    </button>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[15px] leading-[1.55]">{p.content}</p>

                  {p.images && p.images.length > 0 && (
                    <div className={`mt-2 grid gap-1.5 ${p.images.length === 1 ? 'max-w-[240px]' : 'grid-cols-3'}`}>
                      {p.images.map((src, i) => (
                        <img key={i} src={src} alt="动态配图" className="aspect-square w-full rounded-[8px] object-cover" />
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex items-center">
                    <span className="text-[12px] text-black/35 dark:text-white/35">{p.time}</span>
                    <div className="ml-auto flex items-center gap-7 text-black/55 dark:text-white/55">
                      <button
                        type="button"
                        aria-label={liked ? '取消赞' : '赞'}
                        data-testid={`qq-zone-like-${p.id}`}
                        onClick={() => toggleLike(p)}
                        className={`active:opacity-60 ${liked ? 'text-[#1E6FFF] dark:text-[#4AA3FF]' : ''}`}
                      >
                        <ThumbsUp className={`h-[18px] w-[18px] ${liked ? 'fill-current' : ''}`} strokeWidth={1.9} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="评论"
                        data-testid={`qq-zone-comment-btn-${p.id}`}
                        onClick={() => commentInputRefs.current[p.id]?.focus()}
                        className="active:opacity-60"
                      >
                        <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
                      </button>
                      <button type="button" aria-label="转发" onClick={() => onToast('转发暂未开放')} className="active:opacity-60">
                        <Share2 className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {names.length > 0 && (
                    <div className="mt-2 flex items-center gap-1.5 text-[13px] text-[#4A78B8] dark:text-[#7FA8D9]">
                      <ThumbsUp className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      {names.join('、')} 赞了
                    </div>
                  )}

                  {(commentsMap[p.id]?.length ?? 0) > 0 && (
                    <div
                      className="mt-2 space-y-1.5 rounded-[10px] bg-black/[0.035] px-3 py-2 dark:bg-white/[0.05]"
                      data-testid={`qq-zone-comments-${p.id}`}
                    >
                      {(commentsMap[p.id] ?? []).map((c) => (
                        <div key={c.id} className="flex items-start gap-2 text-[14px] leading-[1.5]">
                          <p
                            className="min-w-0 flex-1 active:opacity-70"
                            title="点击回复，长按删除"
                            onPointerDown={startCommentPress(p, c)}
                            onPointerUp={clearPress}
                            onPointerLeave={clearPress}
                            onPointerCancel={clearPress}
                            onPointerMove={onCommentPointerMove}
                            onClick={() => {
                              // 长按后拦截紧随的 click（不设置回复目标）
                              if (suppressClickRef.current) {
                                suppressClickRef.current = false;
                                return;
                              }
                              setReplyTarget((r) => ({ ...r, [p.id]: { id: c.id, name: c.author } }));
                              commentInputRefs.current[p.id]?.focus();
                            }}
                          >
                            <span className="font-medium text-[#4A78B8] dark:text-[#7FA8D9]">{c.author}</span>
                            {c.replyTo && (
                              <>
                                <span className="mx-0.5 text-black/40 dark:text-white/40">回复</span>
                                <span className="font-medium text-[#4A78B8] dark:text-[#7FA8D9]">{c.replyTo}</span>
                              </>
                            )}
                            <span className="text-black/80 dark:text-white/80">：{c.content}</span>
                            <span className="ml-2 text-[11px] text-black/30 dark:text-white/30">{c.time}</span>
                          </p>
                          <button
                            type="button"
                            aria-label={`回复${c.author}的评论`}
                            data-testid={`qq-zone-reply-${p.id}-${c.id}`}
                            onClick={() => {
                              setReplyTarget((r) => ({ ...r, [p.id]: { id: c.id, name: c.author } }));
                              commentInputRefs.current[p.id]?.focus();
                            }}
                            className="shrink-0 pt-0.5 text-[12px] text-black/40 active:opacity-60 dark:text-white/40"
                          >
                            回复
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-2.5 flex items-center gap-2 rounded-full bg-black/[0.04] px-3 py-2 dark:bg-white/[0.06]">
                    <QqAvatar src={me.avatar} alt={me.name} size={22} />
                    {rt && (
                      <button
                        type="button"
                        aria-label={`取消回复${rt.name}`}
                        data-testid={`qq-zone-reply-cancel-${p.id}`}
                        onClick={() => setReplyTarget((r) => ({ ...r, [p.id]: undefined }))}
                        className="flex shrink-0 items-center gap-0.5 rounded-full bg-black/[0.06] px-2 py-0.5 text-[11px] text-black/55 active:opacity-60 dark:bg-white/[0.08] dark:text-white/55"
                      >
                        回复{rt.name}
                        <X className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
                      </button>
                    )}
                    <input
                      ref={(el) => {
                        commentInputRefs.current[p.id] = el;
                      }}
                      data-testid={`qq-zone-comment-input-${p.id}`}
                      aria-label={`评论${p.authorName}的动态`}
                      placeholder={rt ? `回复 ${rt.name}：` : '说点什么吧...'}
                      value={commentDrafts[p.id] ?? ''}
                      onChange={(e) => setCommentDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addComment(p);
                      }}
                      className="h-5 w-full bg-transparent text-[13px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
                    />
                    {(commentDrafts[p.id] ?? '').trim() && (
                      <button
                        type="button"
                        aria-label="发送评论"
                        data-testid={`qq-zone-comment-send-${p.id}`}
                        onClick={() => addComment(p)}
                        className="shrink-0 text-[13px] font-medium text-[#1E6FFF] active:opacity-60 dark:text-[#4AA3FF]"
                      >
                        发送
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {posts.length === 0 && <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">还没有动态</p>}
      </div>

      {/* 让好友发一条（一.2）+ 每角色自动发动态设置（一.3）+ 编辑/删除说说（六.4） */}
      {askOpen && (
        <AskPostSheet
          title="让好友发一条"
          friends={momentFriendsOf(contacts, 'qq')}
          busyId={askBusyId}
          onClose={() => setAskOpen(false)}
          onAsk={(c) => void askMomentPost(c)}
          onOpenCfg={(c) => setCfgPeer(c)}
          renderAvatar={(c, size) => <QqAvatar src={c.avatar} alt={displayNameOf(c)} size={size} />}
        />
      )}
      {cfgPeer && (
        <MomentAutoCfgSheet
          contact={cfgPeer}
          platform="qq"
          platformLabel="QQ动态"
          onClose={() => setCfgPeer(null)}
          onToast={onToast}
        />
      )}
      {menuPostId && (
        <PostMoreMenu
          onEdit={() => {
            const hit = posts.find((x) => x.id === menuPostId);
            if (hit) setEditingPost({ id: hit.id, content: hit.content });
            setMenuPostId(null);
          }}
          onDelete={() => {
            deleteMomentPost('qq', menuPostId, me.name);
            setMenuPostId(null);
            onToast('已删除动态');
          }}
          onClose={() => setMenuPostId(null)}
        />
      )}
      {editingPost && (
        <EditPostDialog
          key={editingPost.id}
          initial={editingPost.content}
          busy={false}
          onCancel={() => setEditingPost(null)}
          onSave={(text) => {
            if (!updateMomentPostContent('qq', editingPost.id, me.name, text)) onToast('动态内容不能为空');
            setEditingPost(null);
          }}
        />
      )}
      {/* 长按评论 → 删除确认（任何人的评论都可删；其下回复一并删） */}
      {delComment && (
        <CommentDeleteDialog
          author={delComment.author}
          onCancel={() => setDelComment(null)}
          onDelete={() => {
            deleteMomentComment('qq', delComment.postId, delComment.commentId, me.name);
            setDelComment(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------- 写说说页（空间动态「分享新鲜事」进入；对照 QQ 真机） ----------------

function WritePostPage({
  me,
  onBack,
  onPublish,
  onToast,
}: {
  me: QQUser;
  onBack: () => void;
  /** 发表：正文 + 配图（入库/记忆/互动队列由动态引擎统一处理） */
  onPublish: (text: string, images: string[]) => void;
  onToast: (m: string) => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const canPost = text.trim().length > 0 || images.length > 0;

  const pickImages = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setBusy(true);
    try {
      const room = Math.max(0, 9 - images.length);
      const picked = Array.from(files).slice(0, room);
      const datas = await Promise.all(picked.map((f) => compressImageFile(f)));
      setImages((prev) => [...prev, ...datas.filter(Boolean)]);
      if (files.length > room) onToast('最多选择 9 张图片');
    } finally {
      setBusy(false);
    }
  };

  const publish = () => {
    if (!canPost || busy) return;
    onPublish(text.trim(), images);
    onToast('已发表到空间');
    onBack();
  };

  return (
    <div className="flex h-full flex-col bg-[#F2F3F5] pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：取消 / 写说说 / 发表 */}
      <div className="relative flex h-12 shrink-0 items-center px-4">
        <button type="button" data-testid="qq-compose-cancel" onClick={onBack} className="text-[16px] active:opacity-60">
          取消
        </button>
        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-semibold">
          写说说
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            data-testid="qq-compose-publish"
            disabled={!canPost || busy}
            onClick={publish}
            className="h-9 rounded-[10px] px-4 text-[15px] font-medium text-white active:brightness-95"
            style={{ backgroundColor: canPost && !busy ? QQ_BLUE : '#8AD4F7' }}
          >
            发表
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
        {/* 内容卡：文字 + 照片/视频 + pills */}
        <div className="rounded-[14px] bg-white px-3 pb-4 pt-4 dark:bg-[#1B1C1F]">
          <textarea
            data-testid="qq-compose-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="分享新鲜事..."
            rows={7}
            aria-label="说说内容"
            className="w-full resize-none bg-transparent text-[17px] leading-[1.6] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
          />
          <div className="mt-1 flex flex-wrap gap-2">
            {images.map((src, i) => (
              <div key={`${i}-${src.slice(-12)}`} className="relative h-[86px] w-[86px] overflow-hidden rounded-[8px]">
                <img src={src} alt={`配图${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label={`移除配图${i + 1}`}
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/50 text-white"
                >
                  <X className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
                </button>
              </div>
            ))}
            {images.length < 9 && (
              <button
                type="button"
                data-testid="qq-compose-addimg"
                onClick={() => fileRef.current?.click()}
                className="grid h-[86px] w-[86px] place-items-center rounded-[8px] bg-black/[0.04] text-black/35 active:bg-black/[0.08] dark:bg-white/[0.06] dark:text-white/35"
              >
                <span className="flex flex-col items-center gap-1">
                  <ImageIcon className="h-7 w-7" strokeWidth={1.6} aria-hidden="true" />
                  <span className="text-[12px]">照片/视频</span>
                </span>
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              void pickImages(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
          />
          <div className="mt-4 flex items-center gap-1">
            {[
              { label: '@好友', icon: null, toast: '@好友暂未开放' },
              { label: '添加标签', icon: <Tag className="h-3 w-3" strokeWidth={2} aria-hidden="true" />, toast: '添加标签暂未开放' },
              { label: '所在位置', icon: <MapPin className="h-3 w-3" strokeWidth={2} aria-hidden="true" />, toast: '所在位置暂未开放' },
            ].map((x) => (
              <button
                key={x.label}
                type="button"
                onClick={() => onToast(x.toast)}
                className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-black/[0.045] px-2.5 text-[12.5px] whitespace-nowrap text-black/55 active:opacity-60 dark:bg-white/[0.08] dark:text-white/55"
              >
                {x.icon}
                {x.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onToast('AI配文暂未开放')}
              className="ml-auto flex h-9 shrink-0 items-center gap-1 rounded-full bg-black/[0.045] px-2.5 text-[12.5px] whitespace-nowrap text-black/55 active:opacity-60 dark:bg-white/[0.08] dark:text-white/55"
            >
              <Sparkles className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              AI配文
            </button>
          </div>
        </div>

        {/* 权限/发表设置卡 */}
        <div className="mt-3 rounded-[14px] bg-white px-4 dark:bg-[#1B1C1F]">
          <button
            type="button"
            onClick={() => onToast('权限设置暂未开放')}
            className="flex h-[54px] w-full items-center gap-3 text-left active:opacity-70"
          >
            <Eye className="h-5 w-5 shrink-0 text-black/70 dark:text-white/70" aria-hidden="true" />
            <span className="flex-1 text-[15px]">权限设置</span>
            <span className="text-[14px] text-black/35 dark:text-white/35">所有人可见</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
          <div className="h-px bg-black/[0.05] dark:bg-white/[0.06]" aria-hidden="true" />
          <button
            type="button"
            onClick={() => onToast('发表设置暂未开放')}
            className="flex h-[54px] w-full items-center gap-3 text-left active:opacity-70"
          >
            <Settings className="h-5 w-5 shrink-0 text-black/70 dark:text-white/70" aria-hidden="true" />
            <span className="flex-1 text-[15px]">发表设置</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 设置页 / 账号与安全页 ----------------

function SettingsPage({
  me,
  onBack,
  onOpenSecurity,
  onLogout,
  onToast,
}: {
  me: QQUser;
  onBack: () => void;
  onOpenSecurity: () => void;
  onLogout: () => void;
  onToast: (m: string) => void;
}) {
  const rows: { icon: React.ReactNode; color: string; label: string; hint?: string; onClick?: () => void; testid?: string }[] = [
    { icon: <Bell className="h-5 w-5" strokeWidth={1.9} />, color: '#3BA0FF', label: '消息通知', onClick: () => onToast('消息通知暂未开放') },
    { icon: <SlidersHorizontal className="h-5 w-5" strokeWidth={1.9} />, color: '#3BA0FF', label: '模式选择', hint: '普通模式', onClick: () => onToast('模式选择暂未开放') },
    { icon: <Shirt className="h-5 w-5" strokeWidth={1.9} />, color: '#F0479C', label: '个性装扮与特权外显', onClick: () => onToast('个性装扮暂未开放') },
    { icon: <Settings className="h-5 w-5" strokeWidth={1.9} />, color: '#3BA0FF', label: '通用', onClick: () => onToast('通用设置暂未开放') },
  ];
  const privacyRows: { icon: React.ReactNode; label: string }[] = [
    { icon: <ShieldCheck className="h-5 w-5" strokeWidth={1.9} />, label: '隐私设置' },
    { icon: <FileText className="h-5 w-5" strokeWidth={1.9} />, label: '个人信息收集清单' },
    { icon: <Link2 className="h-5 w-5" strokeWidth={1.9} />, label: '第三方个人信息共享清单' },
    { icon: <ShieldCheck className="h-5 w-5" strokeWidth={1.9} />, label: '个人信息保护设置' },
  ];

  return (
    <div className="flex h-full flex-col bg-[#F6F7F9] pt-[54px] dark:bg-[#111214]">
      <div className="relative flex h-12 shrink-0 items-center bg-[#F6F7F9] px-3 dark:bg-[#111214]">
        <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">设置</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-[44px] pt-2">
        <QqSearch value="" onChange={() => undefined} />

        {/* 账号与安全 */}
        <button
          type="button"
          data-testid="qq-settings-security"
          onClick={onOpenSecurity}
          className="mt-3 flex h-[60px] w-full items-center gap-3 rounded-[14px] bg-white px-4 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F]"
        >
          <User className="h-5 w-5 shrink-0 text-black/75 dark:text-white/75" aria-hidden="true" />
          <span className="flex-1 text-[16px]">账号与安全</span>
          <QqAvatar src={me.avatar} alt={me.name} size={30} />
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        <p className="px-1 pb-1.5 pt-5 text-[13px] text-black/35 dark:text-white/35">功能</p>
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#1B1C1F]">
          {rows.map((r, i) => (
            <button
              key={r.label}
              type="button"
              onClick={r.onClick}
              className={`flex h-[54px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] ${
                i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''
              }`}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center" style={{ color: r.color }} aria-hidden="true">
                {r.icon}
              </span>
              <span className="flex-1 truncate text-[16px]">{r.label}</span>
              {r.hint && <span className="text-[14px] text-black/30 dark:text-white/30">{r.hint}</span>}
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ))}
        </div>

        <p className="px-1 pb-1.5 pt-5 text-[13px] text-black/35 dark:text-white/35">隐私</p>
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#1B1C1F]">
          {privacyRows.map((r, i) => (
            <button
              key={r.label}
              type="button"
              onClick={() => onToast(`${r.label}暂未开放`)}
              className={`flex h-[54px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] ${
                i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''
              }`}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center text-black/75 dark:text-white/75" aria-hidden="true">
                {r.icon}
              </span>
              <span className="flex-1 truncate text-[16px]">{r.label}</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => onToast('关于QQ暂未开放')}
          className="mt-4 flex h-[54px] w-full items-center gap-3 rounded-[14px] bg-white px-4 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F]"
        >
          <Info className="h-5 w-5 shrink-0 text-black/75 dark:text-white/75" aria-hidden="true" />
          <span className="flex-1 text-[16px]">关于QQ与帮助</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        <button
          type="button"
          data-testid="qq-settings-logout"
          onClick={onLogout}
          className="mt-4 flex h-[54px] w-full items-center gap-3 rounded-[14px] bg-white px-4 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F]"
        >
          <LogOut className="h-5 w-5 shrink-0 text-black/75 dark:text-white/75" aria-hidden="true" />
          <span className="flex-1 text-[16px]">退出当前账号</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function PenguinMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 40 40" style={{ width: size, height: size }} className={className} aria-hidden="true">
      <ellipse cx="20" cy="17" rx="11" ry="12" fill="#2B2B33" />
      <ellipse cx="20" cy="22" rx="7.2" ry="7.6" fill="#fff" />
      <circle cx="15.8" cy="13.5" r="2.6" fill="#fff" />
      <circle cx="24.2" cy="13.5" r="2.6" fill="#fff" />
      <circle cx="16.3" cy="13.9" r="1.15" fill="#20242B" />
      <circle cx="23.7" cy="13.9" r="1.15" fill="#20242B" />
      <path d="M15.5 17.6c1.4 1.5 7.6 1.5 9 0 .9 1.4-1.6 4-4.5 4s-5.4-2.6-4.5-4z" fill="#FFA611" />
      <rect x="13" y="26.5" width="14" height="4" rx="2" fill="#F5455C" />
    </svg>
  );
}

function SecurityPage({
  me,
  contacts,
  onBack,
  onSwitchAccount,
  onToast,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  onBack: () => void;
  onSwitchAccount: () => void;
  onToast: (m: string) => void;
}) {
  const otherUsers = useMemo(() => contacts.filter((c) => c.kind === 'user' && c.id !== me.id), [contacts, me.id]);

  const linkRows: { icon: React.ReactNode; label: string; hint?: string; tail?: React.ReactNode }[] = [
    { icon: <PenguinMark size={22} className="text-[#3BA0FF]" />, label: '关联QQ号', tail: <QqAvatar src={me.avatar} alt={me.name} size={30} /> },
    { icon: <QrCode className="h-5 w-5" strokeWidth={1.9} />, label: 'QID', hint: '已开启' },
    { icon: <Smartphone className="h-5 w-5" strokeWidth={1.9} />, label: '手机号', hint: maskPhone(me.phone) },
    { icon: <Link2 className="h-5 w-5" strokeWidth={1.9} />, label: '账号绑定与授权管理' },
  ];
  const safeRows: { icon: React.ReactNode; label: string; hint?: string }[] = [
    { icon: <KeyRound className="h-5 w-5" strokeWidth={1.9} />, label: '修改密码' },
    { icon: <MonitorSmartphone className="h-5 w-5" strokeWidth={1.9} />, label: '登录设备管理' },
    { icon: <LockKeyhole className="h-5 w-5" strokeWidth={1.9} />, label: '手势解锁', hint: '未设置' },
    { icon: <ShieldCheck className="h-5 w-5" strokeWidth={1.9} />, label: '更多安全设置' },
  ];

  return (
    <div className="flex h-full flex-col bg-[#F6F7F9] pt-[54px] dark:bg-[#111214]">
      <div className="relative flex h-12 shrink-0 items-center bg-[#F6F7F9] px-3 dark:bg-[#111214]">
        <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">账号与安全</span>
        <button type="button" className="ml-auto text-[16px] text-black/70 active:opacity-60 dark:text-white/70" onClick={() => onToast('编辑暂未开放')}>
          编辑
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-[44px] pt-2">
        {/* 关联账号横幅 */}
        <button
          type="button"
          onClick={() => onToast('关联账号暂未开放')}
          className="flex w-full items-center gap-3 rounded-[14px] bg-white px-4 py-3.5 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F]"
        >
          <PenguinMark size={26} className="shrink-0" />
          <span className="flex-1 text-[14px] leading-snug">点击添加关联账号，同时接收多个账号消息。</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        <p className="px-1 pb-1.5 pt-5 text-[13px] text-black/35 dark:text-white/35">账号管理</p>
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#1B1C1F]" data-testid="qq-security-accounts">
          {/* 当前账号 */}
          <div className="flex h-[64px] items-center gap-3 px-4">
            <QqAvatar src={me.avatar} alt={me.name} size={44} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[16px] font-medium">{me.name}</div>
              <div className="truncate text-[13px] text-black/35 dark:text-white/35">{me.qqId ?? ''}</div>
            </div>
            <Check className="h-5 w-5 shrink-0 text-[#1E6FFF] dark:text-[#4AA3FF]" aria-hidden="true" />
          </div>

          {/* 其他 user 账号：点击退出当前账号 → 登录页切换 */}
          {otherUsers.map((c) => (
            <button
              key={c.id}
              type="button"
              data-testid={`qq-switch-${c.qqId ?? c.id}`}
              onClick={onSwitchAccount}
              className="flex h-[64px] w-full items-center gap-3 border-t border-black/[0.04] px-4 text-left active:bg-black/[0.03] dark:border-white/[0.05]"
            >
              <QqAvatar src={c.avatar} alt={c.name} size={44} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[16px] font-medium">{c.name}</div>
                <div className="truncate text-[13px] text-black/35 dark:text-white/35">{c.qqId ?? ''}</div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ))}

          {/* 添加或注册账号 */}
          <button
            type="button"
            data-testid="qq-security-add"
            onClick={onSwitchAccount}
            className="flex h-[64px] w-full items-center gap-3 border-t border-black/[0.04] px-4 text-left active:bg-black/[0.03] dark:border-white/[0.05]"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/[0.05] text-black/45 dark:bg-white/[0.08] dark:text-white/45">
              <Plus className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="flex-1 text-[16px]">添加或注册账号</span>
          </button>
        </div>

        <p className="px-1 pb-1.5 pt-5 text-[13px] text-black/35 dark:text-white/35">账号关联</p>
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#1B1C1F]">
          {linkRows.map((r, i) => (
            <button
              key={r.label}
              type="button"
              onClick={() => onToast(`${r.label}暂未开放`)}
              className={`flex h-[56px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] ${
                i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''
              }`}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center text-black/75 dark:text-white/75" aria-hidden="true">
                {r.icon}
              </span>
              <span className="flex-1 truncate text-[16px]">{r.label}</span>
              {r.hint && <span className="text-[14px] text-black/30 dark:text-white/30">{r.hint}</span>}
              {r.tail ?? null}
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ))}
        </div>

        <p className="px-1 pb-1.5 pt-5 text-[13px] text-black/35 dark:text-white/35">安全管理</p>
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#1B1C1F]">
          {safeRows.map((r, i) => (
            <button
              key={r.label}
              type="button"
              onClick={() => onToast(`${r.label}暂未开放`)}
              className={`flex h-[56px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] ${
                i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''
              }`}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center text-black/75 dark:text-white/75" aria-hidden="true">
                {r.icon}
              </span>
              <span className="flex-1 truncate text-[16px]">{r.label}</span>
              {r.hint && <span className="text-[14px] text-black/30 dark:text-white/30">{r.hint}</span>}
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- QQ 钱包（个人中心抽屉「钱包」入口；对照真机：主页/余额/小金库/银行卡/提现/充值/账单） ----------------

export interface WalletData {
  /** 余额（元） */
  balance: number;
  /** Q币 */
  qb: number;
  /** 小金库（元） */
  vault: number;
}

export interface BankCard {
  id: string;
  /** 持卡人 */
  holder: string;
  /** 卡号尾号 4 位（仅本机保存，不上传） */
  last4: string;
  /** 银行名 */
  bank: string;
  /** 完整卡号（自生成卡号无隐私问题；旧版本卡片可能缺失，展示时兜底为星号分组） */
  no?: string;
  /** 卡内金额（元，添加时自定义） */
  balance?: number;
  /** 卡类型：储蓄卡 / 信用卡 */
  type?: string;
  /** 添加时间戳 */
  createdAt?: number;
}

/** 预设银行品牌元数据：卡片渐变品牌色 + 发卡行 BIN 前缀（卡号生成用） */
const BANK_META: Record<string, { from: string; to: string; bin: string }> = {
  工商银行: { from: '#D62E36', to: '#A3121A', bin: '62220' },
  建设银行: { from: '#0A6EBD', to: '#094E85', bin: '62172' },
  农业银行: { from: '#0DA45F', to: '#087A45', bin: '62284' },
  中国银行: { from: '#B4232C', to: '#821720', bin: '62166' },
  交通银行: { from: '#1263A0', to: '#0B3F6B', bin: '62226' },
  招商银行: { from: '#D2302F', to: '#96191C', bin: '62258' },
  邮储银行: { from: '#0E8A50', to: '#096A3B', bin: '62179' },
};
/** 未识别银行的兜底配色 */
const BANK_FALLBACK = { from: '#4C6B8A', to: '#2E4A66' };

/** Luhn 校验位：由前 n-1 位算出第 n 位（生成的卡号可通过标准银行卡校验） */
function luhnCheckDigit(digits: string): number {
  let sum = 0;
  let dbl = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return (10 - (sum % 10)) % 10;
}

/** 生成符合 Luhn 校验的银行卡号：储蓄卡 19 位 / 信用卡 16 位，BIN 前缀跟随所选银行 */
function genCardNo(bank: string, type: string): string {
  const bin = BANK_META[bank]?.bin ?? '6222';
  const len = type === '信用卡' ? 16 : 19;
  let body = bin;
  while (body.length < len - 1) body += Math.floor(Math.random() * 10).toString();
  return body + luhnCheckDigit(body);
}

/** 卡号展示：4 位一组空格分组；无完整卡号的旧数据兜底为 **** **** **** 尾号 */
function formatCardNo(card: Pick<BankCard, 'no' | 'last4'>): string {
  const src = card.no && /^\d{15,19}$/.test(card.no) ? card.no : `****${card.last4}`;
  return src.replace(/(\d{4})(?=\d)/g, '$1 ');
}

interface WalletBill {
  id: string;
  title: string;
  /** 正=收入 负=支出 */
  amount: number;
  ts: number;
}

/** 默认钱包（对照真机演示数据：余额 1.03 / Q币 0.10 / 小金库 0.00） */
const DEFAULT_WALLET: WalletData = { balance: 1.03, qb: 0.1, vault: 0 };

export function loadWallet(): WalletData {
  try {
    const p: unknown = kvGet(LS_WALLET);
    if (p && typeof p === 'object') {
      const d = p as Partial<WalletData>;
      return {
        balance: typeof d.balance === 'number' && d.balance >= 0 ? d.balance : DEFAULT_WALLET.balance,
        qb: typeof d.qb === 'number' && d.qb >= 0 ? d.qb : DEFAULT_WALLET.qb,
        vault: typeof d.vault === 'number' && d.vault >= 0 ? d.vault : DEFAULT_WALLET.vault,
      };
    }
  } catch {
    // 忽略
  }
  return { ...DEFAULT_WALLET };
}

function saveWallet(d: WalletData): void {
  try {
    kvSet(LS_WALLET, d);
  } catch {
    // 忽略
  }
}

export function loadBankCards(): BankCard[] {
  try {
    const p: unknown = kvGet<BankCard[]>(LS_WALLET_CARDS);
    if (Array.isArray(p)) return p.filter((c) => c && typeof c === 'object' && typeof (c as BankCard).last4 === 'string');
  } catch {
    // 忽略
  }
  return [];
}

function saveBankCards(list: BankCard[]): void {
  try {
    kvSet(LS_WALLET_CARDS, list);
  } catch {
    // 忽略
  }
}

function loadWalletBills(): WalletBill[] {
  try {
    const p: unknown = kvGet<WalletBill[]>(LS_WALLET_BILLS);
    if (Array.isArray(p)) return p.filter((b) => b && typeof b === 'object' && typeof (b as WalletBill).amount === 'number');
  } catch {
    // 忽略
  }
  return [];
}

function saveWalletBills(list: WalletBill[]): void {
  try {
    kvSet(LS_WALLET_BILLS, list);
  } catch {
    // 忽略
  }
}

/** 从钱包余额扣款（发红包/转账用）：成功返回 true；余额不足返回 false；同步写账单 */
function payFromWallet(amount: number, billTitle: string): boolean {
  const w = loadWallet();
  if (!(amount > 0) || w.balance < amount) return false;
  saveWallet({ ...w, balance: round2(w.balance - amount) });
  saveWalletBills([{ id: uid(), title: billTitle, amount: -amount, ts: Date.now() }, ...loadWalletBills()].slice(0, 100));
  return true;
}

/** 收款入钱包余额（领取红包用），同步写账单 */
export function gainToWallet(amount: number, billTitle: string): void {
  const w = loadWallet();
  saveWallet({ ...w, balance: round2(w.balance + amount) });
  saveWalletBills([{ id: uid(), title: billTitle, amount, ts: Date.now() }, ...loadWalletBills()].slice(0, 100));
}

// ---------------- 支付密码 / 支付方式（红包/转账可选余额或银行卡支付） ----------------

interface PayPwdData {
  enabled: boolean;
  /** 6 位数字密码（仅本机 localStorage 保存） */
  pwd: string | null;
}

const LS_PAY_PWD = 'qq-pay-pwd';

export function loadPayPwd(): PayPwdData {
  try {
    const p: unknown = kvGet(LS_PAY_PWD);
    if (p && typeof p === 'object') {
      const d = p as Partial<PayPwdData>;
      const pwd = typeof d.pwd === 'string' && /^\d{6}$/.test(d.pwd) ? d.pwd : null;
      return { enabled: d.enabled === true && pwd !== null, pwd };
    }
  } catch {
    // 忽略
  }
  return { enabled: false, pwd: null };
}

function savePayPwd(d: PayPwdData): void {
  try {
    kvSet(LS_PAY_PWD, d);
  } catch {
    // 忽略
  }
}

/** 从指定银行卡扣款（红包/转账选卡支付用），同步写账单；卡不存在或余额不足返回 false */
function payFromCard(cardId: string, amount: number, billTitle: string): boolean {
  if (!(amount > 0)) return false;
  const list = loadBankCards();
  const idx = list.findIndex((c) => c.id === cardId);
  if (idx < 0) return false;
  const card = list[idx];
  if ((card.balance ?? 0) < amount) return false;
  list[idx] = { ...card, balance: round2((card.balance ?? 0) - amount) };
  saveBankCards(list);
  saveWalletBills([{ id: uid(), title: `${billTitle}（${card.bank}尾号${card.last4}）`, amount: -amount, ts: Date.now() }, ...loadWalletBills()].slice(0, 100));
  return true;
}

/** 支付前预检：所选支付方式（余额/银行卡）余额是否充足 */
export function canPay(methodId: string, amount: number): boolean {
  if (!(amount > 0)) return false;
  if (methodId === 'balance') return loadWallet().balance >= amount;
  const c = loadBankCards().find((x) => x.id === methodId);
  return Boolean(c) && (c?.balance ?? 0) >= amount;
}

/** 按所选支付方式扣款（余额 / 银行卡），同步写账单 */
export function executePayment(methodId: string, amount: number, billTitle: string): boolean {
  if (!(amount > 0)) return false;
  if (methodId === 'balance') return payFromWallet(amount, billTitle);
  return payFromCard(methodId, amount, billTitle);
}

/** 支付方式展示名（支付密码验证浮层副标题用） */
function methodLabel(methodId: string): string {
  if (methodId === 'balance') return 'QQ钱包余额';
  const c = loadBankCards().find((x) => x.id === methodId);
  return c ? `${c.bank}（尾号${c.last4}）` : '支付方式';
}

// ---------------- 小金库收益（按七日年化每日结算，localStorage 持久化） ----------------

/** 演示利率：最高七日年化 1.5120% */
const VAULT_RATE = 0.015120;
const VAULT_DAILY_RATE = VAULT_RATE / 365;

interface VaultEarnEntry {
  /** 本地日期键（2026-2-4） */
  date: string;
  /** 当日收益（元） */
  amount: number;
}

interface VaultEarnData {
  /** 上次结算日期（本地日期键） */
  lastDate: string;
  log: VaultEarnEntry[];
}

const LS_VAULT_EARN = 'qq-vault-earn';

function loadVaultEarn(): VaultEarnData {
  try {
    const p: unknown = kvGet(LS_VAULT_EARN);
    if (p && typeof p === 'object') {
      const d = p as Partial<VaultEarnData>;
      if (typeof d.lastDate === 'string' && Array.isArray(d.log)) {
        return { lastDate: d.lastDate, log: d.log.filter((e) => Boolean(e) && typeof e.date === 'string' && typeof e.amount === 'number') };
      }
    }
  } catch {
    // 忽略
  }
  return { lastDate: '', log: [] };
}

function saveVaultEarn(d: VaultEarnData): void {
  try {
    kvSet(LS_VAULT_EARN, d);
  } catch {
    // 忽略
  }
}

/** 本地日期键转 Date（避免 'Y-M-D' 非 ISO 串的解析差异） */
function parseDateKey(key: string): Date | null {
  const parts = key.split('-').map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/** 结算小金库收益：从上次结算日（首次回溯到最早一笔小金库账单日）逐日补记到今天，按当前余额近似；同日重复调用直接返回缓存 */
function settleVaultEarn(vault: number): VaultEarnData {
  const today = localDateKey();
  const prev = loadVaultEarn();
  if (prev.lastDate === today) return prev;
  let start = prev.lastDate;
  if (!start) {
    const vaultBills = loadWalletBills().filter((b) => b.title === '转入小金库' || b.title === '小金库转出');
    start = vaultBills.length ? localDateKey(new Date(Math.min(...vaultBills.map((b) => b.ts)))) : today;
  }
  const log = [...prev.log];
  const cur = parseDateKey(start) ?? parseDateKey(today);
  const end = parseDateKey(today);
  if (cur && end) {
    let it = cur <= end ? new Date(cur) : new Date(end); // 时钟回拨兜底：从今天起算
    let guard = 0;
    while (guard < 400) {
      guard += 1;
      const key = localDateKey(it);
      const amt = Math.round(vault * VAULT_DAILY_RATE * 10000) / 10000;
      if (amt > 0 && !log.some((e) => e.date === key)) log.push({ date: key, amount: amt });
      if (key === today) break;
      it.setDate(it.getDate() + 1);
    }
  }
  log.sort((a, b) => (a.date < b.date ? -1 : 1));
  const next: VaultEarnData = { lastDate: today, log: log.slice(-90) };
  saveVaultEarn(next);
  return next;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export function fmtMoney(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 金额大数字：整数大号 + 两位小数小号（对照真机余额/Q币「1.03」排版） */
function MoneyDigits({ value, className = '', fracClassName = '' }: { value: number; className?: string; fracClassName?: string }) {
  const [int, frac] = Math.abs(value).toFixed(2).split('.');
  return (
    <span className={className}>
      {value < 0 ? '-' : ''}
      {int}
      <span className={fracClassName}>.{frac}</span>
    </span>
  );
}

/** 金额输入通用约束：最多 7 位整数 + 2 位小数 */
export function sanitizeAmount(v: string): string {
  return /^\d{0,7}(\.\d{0,2})?$/.test(v) ? v : v.slice(0, -1);
}

/** 钱包子页导航头（tone 决定配色：plain 白底黑字 / blue 蓝底白字 / gold 金底白字） */
function WalletNavHeader({ title, tone = 'plain', onBack, right }: { title: string; tone?: 'plain' | 'blue' | 'gold'; onBack: () => void; right?: React.ReactNode }) {
  const toneCls =
    tone === 'blue' ? 'text-white' : tone === 'gold' ? 'text-white' : 'text-[#1F2329] dark:text-white';
  const btnCls = tone === 'plain' ? 'text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10' : 'text-white/90 active:bg-white/15';
  return (
    <div className={`relative flex h-11 shrink-0 items-center px-2 ${toneCls}`}>
      <button type="button" aria-label="返回" data-testid="qq-wallet-back" onClick={onBack} className={`grid h-9 w-9 place-items-center rounded-full ${btnCls}`}>
        <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.4} />
      </button>
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">{title}</span>
      {right ?? null}
    </div>
  );
}

/** 钱包主页（对照截图①：蓝色头部四宫格 + 金融理财/游戏娱乐/生活服务三分区宫格；右上齿轮进支付设置） */
function WalletHomePage({
  wallet,
  onBack,
  onToast,
  onOpenBalance,
  onOpenVault,
  onOpenPaySettings,
}: {
  wallet: WalletData;
  onBack: () => void;
  onToast: (m: string) => void;
  onOpenBalance: () => void;
  onOpenVault: () => void;
  onOpenPaySettings: () => void;
}) {
  const topCells: { key: string; label: string; dot?: boolean; node: React.ReactNode; onClick: () => void }[] = [
    {
      key: 'balance',
      label: '余额',
      node: <MoneyDigits value={wallet.balance} className="text-[28px] font-bold leading-none" fracClassName="text-[15px] font-bold" />,
      onClick: onOpenBalance,
    },
    {
      key: 'qb',
      label: 'Q币',
      node: <MoneyDigits value={wallet.qb} className="text-[28px] font-bold leading-none" fracClassName="text-[15px] font-bold" />,
      onClick: () => onToast('Q币充值暂未开放'),
    },
    { key: 'gift', label: '领福利', dot: true, node: <Gift className="h-8 w-8" strokeWidth={1.7} />, onClick: () => onToast('领福利暂未开放') },
    { key: 'loan', label: '微粒贷', dot: true, node: <CreditCard className="h-8 w-8" strokeWidth={1.7} />, onClick: () => onToast('微粒贷暂未开放') },
  ];

  const groups: { label: string; items: { label: string; color: string; icon: React.ReactNode; onClick: () => void }[] }[] = [
    {
      label: '金融理财',
      items: [
        { label: '小金库', color: '#F5A623', icon: <PiggyBank className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: onOpenVault },
        { label: '申信用卡', color: '#F0605C', icon: <CreditCard className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('申信用卡暂未开放') },
        { label: '还信用卡', color: '#2FBF71', icon: <Landmark className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('还信用卡暂未开放') },
      ],
    },
    {
      label: '游戏娱乐',
      items: [
        { label: '游戏充值', color: '#2FBF71', icon: <Gamepad2 className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('游戏充值暂未开放') },
        { label: '会员充值', color: '#F5A623', icon: <Gem className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('会员充值暂未开放') },
        { label: '鹅毛市集', color: '#3BA0FF', icon: <Feather className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('鹅毛市集暂未开放') },
        { label: '游戏赚Q币', color: '#F5A623', icon: <BellRing className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('游戏赚Q币暂未开放') },
      ],
    },
    {
      label: '生活服务',
      items: [
        { label: '手机充值', color: '#F5A623', icon: <Smartphone className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('手机充值暂未开放') },
        { label: '高校权益', color: '#3BA0FF', icon: <GraduationCap className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('高校权益暂未开放') },
        { label: '火车票机票', color: '#2FBF71', icon: <Bus className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('火车票机票暂未开放') },
        { label: '猫眼电影', color: '#F0605C', icon: <Cat className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('猫眼电影暂未开放') },
        { label: '腾讯公益', color: '#F0605C', icon: <Flower2 className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('腾讯公益暂未开放') },
      ],
    },
  ];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] dark:bg-[#16171A]">
      {/* 蓝色头部：导航 + 四宫格（余额/Q币 数字、领福利/微粒贷 图标带红点） */}
      <div className="shrink-0 bg-gradient-to-b from-[#2CB3F8] to-[#1B9FF0] px-4 pb-8 pt-[54px]">
        <div className="relative flex h-10 items-center text-white">
          <button type="button" aria-label="返回" data-testid="qq-wallet-back" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full text-white/95 active:bg-white/15">
            <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.4} />
          </button>
          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[18px] font-medium">QQ钱包</span>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" aria-label="收付款" onClick={() => onToast('收付款暂未开放')} className="grid h-9 w-9 place-items-center rounded-full text-white/95 active:bg-white/15">
              <QrCode className="h-[21px] w-[21px]" strokeWidth={1.9} />
            </button>
            <button type="button" aria-label="支付设置" onClick={onOpenPaySettings} className="grid h-9 w-9 place-items-center rounded-full text-white/95 active:bg-white/15">
              <Settings className="h-[21px] w-[21px]" strokeWidth={1.9} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-4 pt-7">
          {topCells.map((c) => (
            <button key={c.key} type="button" data-testid={`qq-wallet-cell-${c.key}`} onClick={c.onClick} className="flex flex-col items-center gap-2.5 text-white active:opacity-70">
              {c.key === 'gift' || c.key === 'loan' ? (
                <span className="relative grid h-9 place-items-center">
                  {c.node}
                  {c.dot && <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-[#F5455C]" aria-hidden="true" />}
                </span>
              ) : (
                <span className="grid h-9 place-items-center">{c.node}</span>
              )}
              <span className="text-[15px]">{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 白色圆角主区（叠压蓝底）：三分区彩色描边宫格 */}
      <div className="relative -mt-5 flex-1 overflow-y-auto rounded-t-[20px] bg-white px-4 pb-8 dark:bg-[#1B1C1F]">
        {groups.map((g) => (
          <section key={g.label}>
            <p className="px-1 pb-1 pt-5 text-[13px] text-black/40 dark:text-white/40">{g.label}</p>
            <div className="grid grid-cols-4 gap-y-6 pt-3">
              {g.items.map((item) => (
                <button key={item.label} type="button" onClick={item.onClick} className="flex flex-col items-center gap-2 active:opacity-60">
                  <span className="grid h-11 w-11 place-items-center" style={{ color: item.color }} aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="text-[14px] text-[#1F2329] dark:text-white">{item.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** 余额页（对照截图②：蓝渐变 + 大白卡余额 + 转到微信/微信转入 + 充值/提现/银行卡列表 + 支付设置/财付通页脚） */
function BalancePage({
  wallet,
  cards,
  onBack,
  onToast,
  onOpenTopUp,
  onOpenWithdraw,
  onOpenCards,
  onOpenBills,
  onOpenPaySettings,
}: {
  wallet: WalletData;
  cards: BankCard[];
  onBack: () => void;
  onToast: (m: string) => void;
  onOpenTopUp: () => void;
  onOpenWithdraw: () => void;
  onOpenCards: () => void;
  onOpenBills: () => void;
  onOpenPaySettings: () => void;
}) {
  const rows = [
    { key: 'topup', label: '充值', sub: undefined as string | undefined, icon: <PiggyBank className="h-[22px] w-[22px]" strokeWidth={1.8} />, color: '#F5A623', onClick: onOpenTopUp },
    { key: 'withdraw', label: '提现', sub: undefined as string | undefined, icon: <Banknote className="h-[22px] w-[22px]" strokeWidth={1.8} />, color: '#1F2329', onClick: onOpenWithdraw },
    { key: 'cards', label: '银行卡', sub: cards.length > 0 ? `已绑定 ${cards.length} 张` : '添加银行卡', icon: <Landmark className="h-[22px] w-[22px]" strokeWidth={1.8} />, color: '#1F2329', onClick: onOpenCards },
  ];
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gradient-to-b from-[#1B9FF0] via-[#9FD4F8] to-[#F5F6F8] pt-[54px] dark:from-[#0F5E97] dark:via-[#14486E] dark:to-[#16171A]">
      <WalletNavHeader title="余额" tone="blue" onBack={onBack} right={
        <button type="button" data-testid="qq-wallet-bills" onClick={onOpenBills} className="ml-auto mr-1 text-[16px] text-white active:opacity-60">账单</button>
      } />
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        <div className="mt-2 rounded-[16px] bg-white px-6 pb-8 pt-8 dark:bg-[#232529]">
          <p className="text-center text-[15px] text-black/55 dark:text-white/55">可用余额 (元)</p>
          <div className="mt-2 text-center text-[#1F2329] dark:text-white">
            <MoneyDigits value={wallet.balance} className="text-[54px] font-semibold leading-tight tracking-tight" fracClassName="text-[28px] font-semibold" />
          </div>
          <div className="mt-8 flex flex-col items-center gap-3">
            <button type="button" data-testid="qq-wallet-to-wx" onClick={() => onToast('请先安装微信')} className="h-11 w-[210px] rounded-full bg-[#1B9FF0] text-[16px] font-medium text-white active:opacity-85">转到微信</button>
            <button type="button" onClick={() => onToast('微信转入暂未开放')} className="h-11 w-[210px] rounded-full border border-black/15 text-[16px] text-[#1F2329] active:opacity-60 dark:border-white/20 dark:text-white">微信转入</button>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-[16px] bg-white dark:bg-[#232529]">
          {rows.map((r, i) => (
            <button key={r.key} type="button" data-testid={`qq-wallet-row-${r.key}`} onClick={r.onClick} className={`flex h-14 w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05] ${i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''}`}>
              <span className="grid h-6 w-6 shrink-0 place-items-center" style={{ color: r.color }} aria-hidden="true">
                {r.icon}
              </span>
              <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">
                {r.label}
                {r.sub ? <span className="ml-2 text-[12px] text-black/35 dark:text-white/35">{r.sub}</span> : null}
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ))}
        </div>

        <div className="mt-9 text-center">
          <p className="text-[14px] text-[#1B9FF0]">
            <button type="button" onClick={() => onToast('身份信息暂未开放')}>身份信息</button>
            <span className="mx-2 text-black/20 dark:text-white/25" aria-hidden="true">|</span>
            <button type="button" data-testid="qq-pay-settings" onClick={onOpenPaySettings}>支付设置</button>
          </p>
          <p className="mt-2.5 text-[12px] text-black/35 dark:text-white/35">本服务由财付通提供</p>
        </div>
      </div>
    </div>
  );
}

/** 小金库转入/转出金额弹层（半屏底部面板） */
function VaultAmountSheet({ mode, max, onClose, onConfirm }: { mode: 'in' | 'out'; max: number; onClose: () => void; onConfirm: (n: number) => void }) {
  const [val, setVal] = useState('');
  const num = Math.round((parseFloat(val) || 0) * 100) / 100;
  const ok = num > 0 && num <= max;
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label={mode === 'in' ? '转入小金库' : '转出小金库'} onClick={onClose}>
      <div className="rounded-t-[18px] bg-white px-5 pb-9 pt-5 dark:bg-[#1B1C1F]" onClick={(e) => e.stopPropagation()}>
        <p className="text-[17px] font-semibold text-[#1F2329] dark:text-white">{mode === 'in' ? '转入小金库' : '转出小金库'}</p>
        <div className="mt-4 flex items-center gap-2 border-b border-black/10 pb-3 dark:border-white/15">
          <span className="text-[28px] font-medium text-[#1F2329] dark:text-white" aria-hidden="true">¥</span>
          <input
            value={val}
            autoFocus
            inputMode="decimal"
            onChange={(e) => setVal(sanitizeAmount(e.target.value))}
            placeholder="0.00"
            aria-label="金额"
            data-testid="qq-vault-amount-input"
            className="w-full bg-transparent text-[28px] font-medium text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
          />
        </div>
        <p className="mt-3 text-[13px] text-black/45 dark:text-white/45">
          {mode === 'in' ? `余额可用 ${fmtMoney(max)} 元` : `小金库可用 ${fmtMoney(max)} 元`}
          <button type="button" className="ml-2 text-[#B8803F]" onClick={() => setVal(max.toFixed(2))}>
            {mode === 'in' ? '全部转入' : '全部转出'}
          </button>
        </p>
        <button
          type="button"
          disabled={!ok}
          data-testid="qq-vault-amount-ok"
          onClick={() => ok && onConfirm(num)}
          className={`mt-6 h-12 w-full rounded-[12px] text-[16px] font-medium text-white ${ok ? 'bg-gradient-to-r from-[#C99B58] to-[#D9B27C] active:opacity-85' : 'bg-[#E4CEA4]'}`}
        >
          确定
        </button>
      </div>
    </div>
  );
}

/** 小金库收益详情页（金色渐变累计收益卡 + 产品利率 + 近7日柱状图 + 每日收益记录） */
function VaultEarnPage({ earn, onBack }: { earn: VaultEarnData; onBack: () => void }) {
  const todayKey = localDateKey();
  const entries = [...earn.log].sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = round2(earn.log.reduce((s, e) => s + e.amount, 0));
  const today = earn.log.find((e) => e.date === todayKey)?.amount ?? 0;
  const yesterday = entries.find((e) => e.date !== todayKey)?.amount ?? 0;
  const last7 = earn.log.slice(-7);
  const max = Math.max(...last7.map((e) => e.amount), 0.0001);
  const dayLabel = (d: string): string => {
    const parts = d.split('-');
    return `${parts[1] ?? d}/${parts[2] ?? ''}`;
  };
  return (
    <div className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-[#F6F4EF] pt-[54px] dark:bg-[#1B1A15]" data-testid="qq-vault-earn-page">
      <WalletNavHeader title="收益详情" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {/* 累计收益金卡 */}
        <div className="mt-3 rounded-[16px] bg-gradient-to-br from-[#C99B58] to-[#D9B27C] px-5 pb-5 pt-5 text-white shadow-md shadow-black/10">
          <div className="flex items-center gap-1.5 text-[14px] text-white/90">
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
            累计收益 (元)
          </div>
          <p className="mt-1.5 text-[40px] font-bold leading-none tracking-tight" data-testid="qq-vault-earn-total">{fmtMoney(total)}</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-[10px] bg-white/15 px-3 py-2.5">
              <p className="text-[12px] text-white/85">昨日收益</p>
              <p className="mt-1 text-[18px] font-semibold leading-none">{fmtMoney(yesterday)}</p>
            </div>
            <div className="rounded-[10px] bg-white/15 px-3 py-2.5">
              <p className="text-[12px] text-white/85">今日收益</p>
              <p className="mt-1 text-[18px] font-semibold leading-none">{fmtMoney(today)}</p>
            </div>
          </div>
        </div>
        {/* 产品与利率 */}
        <div className="mt-4 rounded-[16px] bg-white px-4 py-4 dark:bg-[#232529]">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-medium text-[#1F2329] dark:text-white">农银汇理红利日结货币A</p>
            <span className="rounded-full bg-[#C99B58]/15 px-2 py-1 text-[11px] text-[#B8803F] dark:bg-[#C99B58]/25 dark:text-[#D9AC6C]">货币基金 · 低风险</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-[10px] bg-black/[0.03] px-3 py-2.5 dark:bg-white/[0.06]">
              <p className="text-[12px] text-black/45 dark:text-white/45">最高七日年化</p>
              <p className="mt-1 text-[18px] font-semibold leading-none text-[#B8803F] dark:text-[#D9AC6C]">+{(VAULT_RATE * 100).toFixed(4)}%</p>
            </div>
            <div className="rounded-[10px] bg-black/[0.03] px-3 py-2.5 dark:bg-white/[0.06]">
              <p className="text-[12px] text-black/45 dark:text-white/45">万份收益(元)</p>
              <p className="mt-1 text-[18px] font-semibold leading-none text-[#1F2329] dark:text-white">{(10000 * VAULT_DAILY_RATE).toFixed(4)}</p>
            </div>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-black/40 dark:text-white/40">收益 = 前一日小金库余额 × 七日年化利率 ÷ 365，每日自动结算发放。</p>
        </div>
        {/* 近7日柱状图 */}
        {last7.length > 0 ? (
          <div className="mt-4 rounded-[16px] bg-white px-4 py-4 dark:bg-[#232529]">
            <p className="text-[15px] font-medium text-[#1F2329] dark:text-white">近7日收益</p>
            <div className="mt-4 flex h-[110px] items-end gap-2.5">
              {last7.map((e) => (
                <div key={e.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] text-black/45 dark:text-white/45">{e.amount > 0 ? e.amount.toFixed(2) : ''}</span>
                  <span className="w-full max-w-[26px] rounded-t-[6px] bg-gradient-to-t from-[#C99B58] to-[#EBCB96]" style={{ height: `${Math.max(6, (e.amount / max) * 82)}px` }} aria-hidden="true" />
                  <span className="text-[10px] text-black/40 dark:text-white/40">{dayLabel(e.date)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {/* 每日收益记录 */}
        <div className="mt-4 rounded-[16px] bg-white px-4 py-2 dark:bg-[#232529]">
          <p className="border-b border-black/[0.04] py-2.5 text-[15px] font-medium text-[#1F2329] dark:border-white/[0.06] dark:text-white">收益记录</p>
          {entries.length === 0 ? (
            <p className="py-8 text-center text-[14px] text-black/35 dark:text-white/35">暂无收益，转入小金库后开始产生收益</p>
          ) : (
            entries.map((e, i) => (
              <div key={e.date} className={`flex h-[52px] items-center justify-between ${i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.06]' : ''}`}>
                <span className="text-[14px] text-black/55 dark:text-white/55">{e.date} 收益</span>
                <span className="text-[15px] font-medium text-[#B8803F] dark:text-[#D9AC6C]">+{fmtMoney(e.amount)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** 小金库页（对照截图③：金色渐变 + 攒钱还能享收益 + 余额/七日年化/累计收益 + 转入/转出 + 收益详情） */
function VaultPage({
  wallet,
  onBack,
  onToast,
  onMove,
}: {
  wallet: WalletData;
  onBack: () => void;
  onToast: (m: string) => void;
  onMove: (mode: 'in' | 'out', n: number) => void;
}) {
  const [hidden, setHidden] = useState(false);
  const [sheet, setSheet] = useState<'in' | 'out' | null>(null);
  // 收益：每次进入小金库页时结算（同日幂返回缓存），累计/昨日收益持久化在 localStorage
  const [earn] = useState(() => settleVaultEarn(wallet.vault));
  const [earnOpen, setEarnOpen] = useState(false);
  const earnTotal = round2(earn.log.reduce((s, e) => s + e.amount, 0));
  const earnYesterday = earn.log.length >= 2 ? earn.log[earn.log.length - 2].amount : 0;
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-gradient-to-b from-[#EDD8B9] via-[#F4E8D5] to-[#F5F6F8] pt-[54px] dark:from-[#3A3222] dark:via-[#2C271D] dark:to-[#16171A]">
      {/* 整页滚动：小金库导航头部随内容一起滚动，不再固定 */}
      <div className="flex-1 overflow-y-auto">
      <WalletNavHeader
        title="小金库"
        tone="gold"
        onBack={onBack}
        right={
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="ml-auto mr-1 grid h-9 w-9 place-items-center rounded-full text-white/95 active:bg-white/15">
            <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={2} />
          </button>
        }
      />
      <div className="px-4 pb-8">
        <h1 className="mt-4 flex items-start text-[32px] font-black leading-tight">
          <span className="bg-gradient-to-r from-[#A9702E] via-[#D6A45E] to-[#B8803F] bg-clip-text text-transparent dark:from-[#D9AC6C] dark:via-[#EBCB96] dark:to-[#D2A365]">攒钱还能享收益</span>
          <Sparkles className="ml-1 mt-0.5 h-4 w-4 shrink-0 text-white/90 dark:text-[#EBCB96]" aria-hidden="true" />
        </h1>
        <div className="mt-3.5 flex h-9 items-center gap-1.5 rounded-full bg-[#8A6A3F]/15 px-3 text-[13px] text-[#7A5C30] dark:bg-[#8A6A3F]/25 dark:text-[#E3C893]">
          <Volume2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">利率下行，闲钱躺卡每日贬值，试试理财享收益</span>
        </div>

        <div className="mt-4 rounded-[16px] bg-white px-6 pb-6 pt-7 dark:bg-[#232529]">
          <div className="flex items-center justify-center gap-1.5 text-[15px] text-black/55 dark:text-white/55">
            账户余额(元)
            <button type="button" aria-label={hidden ? '显示余额' : '隐藏余额'} data-testid="qq-vault-eye" onClick={() => setHidden(!hidden)} className="active:opacity-60">
              {hidden ? <EyeOff className="h-4.5 w-4.5" strokeWidth={1.8} /> : <Eye className="h-4.5 w-4.5" strokeWidth={1.8} />}
            </button>
          </div>
          <p className="mt-2 text-center text-[48px] font-semibold leading-tight text-[#1F2329] dark:text-white" data-testid="qq-vault-balance">
            {hidden ? '****' : fmtMoney(wallet.vault)}
          </p>
          <p className="mt-1 flex items-center justify-center gap-1 text-[13px] text-[#B8803F] dark:text-[#D9AC6C]">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            资金安全保障中
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </p>

          <div className="mt-8 grid grid-cols-2 gap-4 text-[#1F2329] dark:text-white">
            <div>
              <button type="button" onClick={() => onToast('产品详情暂未开放')} className="flex items-center text-[14px] text-black/50 dark:text-white/50">
                最高七日年化
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <p className="mt-2 text-[24px] font-semibold leading-none">+1.5120%</p>
              <span className="mt-2.5 inline-block max-w-full truncate rounded bg-black/[0.04] px-1.5 py-1 text-[11px] text-black/45 dark:bg-white/[0.08] dark:text-white/45">农银汇理红利日结货币A</span>
            </div>
            <div>
              <button type="button" data-testid="qq-vault-earn-total" onClick={() => setEarnOpen(true)} className="flex items-center text-[14px] text-black/50 dark:text-white/50">
                累计收益(元)
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <p className="mt-2 text-[24px] font-semibold leading-none">{fmtMoney(earnTotal)}</p>
              <span className="mt-2.5 inline-block rounded bg-black/[0.04] px-1.5 py-1 text-[11px] text-black/45 dark:bg-white/[0.08] dark:text-white/45">昨日: {fmtMoney(earnYesterday)}</span>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3.5">
            <button type="button" data-testid="qq-vault-in" onClick={() => setSheet('in')} className="h-12 w-full rounded-[12px] bg-gradient-to-r from-[#C99B58] to-[#D9B27C] text-[16px] font-medium text-white active:opacity-85">转入</button>
            <button type="button" data-testid="qq-vault-out" onClick={() => setSheet('out')} className="h-12 w-full rounded-[12px] border border-[#C9A063] text-[16px] font-medium text-[#B8803F] active:opacity-60 dark:text-[#D9AC6C]">转出</button>
          </div>

          <div className="mt-7 flex items-center gap-2 border-t border-black/[0.06] pt-4 text-[13px] text-black/45 dark:border-white/[0.08] dark:text-white/45">
            了解更多
            <span className="rounded bg-black/[0.04] px-2 py-1.5 text-[12px] dark:bg-white/[0.08]">资金安全有保障吗?</span>
            <button type="button" onClick={() => onToast('更多暂未开放')} className="ml-auto flex items-center text-[#B8803F] dark:text-[#D9AC6C]">
              更多
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <p className="mt-5 text-center text-[12px] text-black/35 dark:text-white/35">基金销售服务由腾安基金销售（深圳）有限公司提供</p>
      </div>
      </div>

      {sheet && (
        <VaultAmountSheet
          mode={sheet}
          max={sheet === 'in' ? wallet.balance : wallet.vault}
          onClose={() => setSheet(null)}
          onConfirm={(n) => {
            onMove(sheet, n);
            setSheet(null);
          }}
        />
      )}
      {/* 收益详情（全屏浮层） */}
      {earnOpen ? <VaultEarnPage earn={earn} onBack={() => setEarnOpen(false)} /> : null}
    </div>
  );
}

/** 银行卡视觉组件（列表/详情复用：真实银行卡 85.6:54 比例 + 银行品牌渐变 + 圆标 + 金色芯片 + 闪付波纹） */
function BankCardVisual({ card, className = '' }: { card: BankCard; className?: string }) {
  const meta = BANK_META[card.bank] ?? BANK_FALLBACK;
  return (
    <div
      className={`relative overflow-hidden rounded-[16px] shadow-lg shadow-black/15 ${className}`}
      style={{ backgroundImage: `linear-gradient(135deg, ${meta.from}, ${meta.to})` }}
    >
      {/* 高光装饰 */}
      <span className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-white/10" aria-hidden="true" />
      <span className="pointer-events-none absolute -right-20 top-10 h-28 w-28 rounded-full bg-white/[0.07]" aria-hidden="true" />
      <div className="relative flex h-full flex-col justify-between p-4">
        {/* 银行圆标 + 名称 + 卡类型 */}
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/25 text-[15px] font-semibold text-white backdrop-blur-sm" aria-hidden="true">
            {card.bank.slice(0, 1)}
          </span>
          <span className="truncate text-[16px] font-semibold text-white">{card.bank}</span>
          <span className="ml-auto shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] leading-4 text-white/95">{card.type ?? '储蓄卡'}</span>
        </div>
        {/* 金色芯片 + 闪付波纹 */}
        <div className="mt-2 flex items-center gap-2.5">
          <span className="relative h-7 w-10 shrink-0 overflow-hidden rounded-[5px] bg-gradient-to-br from-[#F3D47C] to-[#C9962E]" aria-hidden="true">
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/15" />
            <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-black/15" />
          </span>
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-white/80" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
            <path d="M7 9a7.5 7.5 0 0 1 0 6" />
            <path d="M11 6.8a11.5 11.5 0 0 1 0 10.4" />
            <path d="M15 4.6a15.5 15.5 0 0 1 0 14.8" />
          </svg>
        </div>
        {/* 卡号 + 持卡人 + 卡内金额 */}
        <div>
          <p className="text-[17px] font-medium tracking-[0.1em] text-white [font-variant-numeric:tabular-nums]">{formatCardNo(card)}</p>
          <div className="mt-2 flex items-end justify-between gap-2">
            <p className="truncate text-[12px] text-white/85">持卡人 {card.holder}</p>
            {typeof card.balance === 'number' ? <p className="shrink-0 text-[12px] font-medium text-white/95">¥{fmtMoney(card.balance)}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 我的银行卡页（空状态收纳盒 + 添加按钮；有卡时品牌渐变卡列表，点击卡片进详情） */
function BankCardsPage({ cards, onBack, onToast, onAdd, onOpenCard }: { cards: BankCard[]; onBack: () => void; onToast: (m: string) => void; onAdd: () => void; onOpenCard: (c: BankCard) => void }) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader
        title="我的银行卡"
        onBack={onBack}
        right={
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="ml-auto mr-1 grid h-9 w-9 place-items-center rounded-full text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10">
            <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={2} />
          </button>
        }
      />
      <div className="relative flex-1 overflow-y-auto px-4 pb-4">
        {cards.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 pb-10">
            <span className="grid h-[118px] w-[118px] place-items-center rounded-full border-[3px] border-black/65 dark:border-white/65" aria-hidden="true">
              <Inbox className="h-12 w-12" strokeWidth={1.5} />
            </span>
            <p className="text-[19px] text-[#1F2329] dark:text-white">暂未绑定银行卡</p>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {cards.map((c) => (
              <button key={c.id} type="button" data-testid="qq-bank-card-item" onClick={() => onOpenCard(c)} className="block w-full text-left transition-transform active:scale-[0.985]">
                <BankCardVisual card={c} className="aspect-[85.6/54] w-full" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 px-4 pb-[30px] pt-2">
        <button type="button" data-testid="qq-wallet-addcard" onClick={onAdd} className="h-12 w-full rounded-full bg-[#1B9FF0] text-[16px] font-medium text-white active:opacity-85">添加银行卡</button>
      </div>
    </div>
  );
}

/** 添加银行卡（持卡人预填 QQ 昵称 + 卡号一键生成[Luhn 校验，BIN 跟随银行] + 自定义卡内金额 + 卡类型；仅存本机 localStorage） */
function AddCardPage({ defaultHolder, onBack, onSave }: { defaultHolder: string; onBack: () => void; onSave: (c: Omit<BankCard, 'id'>) => void }) {
  const [holder, setHolder] = useState(defaultHolder);
  const [no, setNo] = useState('');
  const [amt, setAmt] = useState('');
  const [bank, setBank] = useState('工商银行');
  const [type, setType] = useState('储蓄卡');
  const noDigits = no.replace(/\s/g, '');
  const balance = Math.round((parseFloat(amt) || 0) * 100) / 100;
  const ok = holder.trim().length > 0 && /^\d{15,19}$/.test(noDigits);
  const banks = Object.keys(BANK_META);
  const gen = () => {
    const raw = genCardNo(bank, type);
    setNo(raw.replace(/(\d{4})(?=\d)/g, '$1 '));
  };
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="添加银行卡" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <div className="border-b border-black/[0.04] px-4 py-3 dark:border-white/[0.06]">
            <p className="text-[12px] text-black/40 dark:text-white/40">持卡人</p>
            <input value={holder} onChange={(e) => setHolder(e.target.value.slice(0, 20))} placeholder="请输入持卡人姓名" aria-label="持卡人姓名" data-testid="qq-card-holder" className="mt-1 h-7 w-full bg-transparent text-[16px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25" />
          </div>
          <div className="border-b border-black/[0.04] px-4 py-3 dark:border-white/[0.06]">
            <p className="text-[12px] text-black/40 dark:text-white/40">银行卡号</p>
            <div className="mt-1 flex items-center gap-2">
              <input
                value={no}
                inputMode="numeric"
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 19);
                  setNo(digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim());
                }}
                placeholder="请输入或点击生成"
                aria-label="银行卡号"
                data-testid="qq-card-no"
                className="h-7 min-w-0 flex-1 bg-transparent text-[16px] tracking-wider text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
              />
              <button type="button" data-testid="qq-card-gen" onClick={gen} className="h-8 shrink-0 rounded-full bg-[#E8F6FF] px-3.5 text-[13px] font-medium text-[#1B9FF0] active:opacity-60 dark:bg-[#17324A]">
                生成卡号
              </button>
            </div>
          </div>
          <div className="px-4 py-3">
            <p className="text-[12px] text-black/40 dark:text-white/40">卡内金额（元）</p>
            <div className="mt-1 flex items-center gap-1">
              <span className="text-[16px] font-medium text-[#1F2329] dark:text-white" aria-hidden="true">¥</span>
              <input
                value={amt}
                inputMode="decimal"
                onChange={(e) => setAmt(sanitizeAmount(e.target.value))}
                placeholder="0.00"
                aria-label="卡内金额"
                data-testid="qq-card-amt"
                className="h-7 w-full bg-transparent text-[16px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
              />
            </div>
          </div>
        </div>
        <p className="px-1 pt-4 text-[13px] text-black/40 dark:text-white/40">卡类型</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {['储蓄卡', '信用卡'].map((t) => (
            <button key={t} type="button" data-testid={`qq-card-type-${t}`} onClick={() => setType(t)} className={`h-9 rounded-full px-4 text-[13px] ${type === t ? 'bg-[#1B9FF0] text-white' : 'bg-white text-[#1F2329] active:opacity-60 dark:bg-[#232529] dark:text-white'}`}>
              {t}
            </button>
          ))}
        </div>
        <p className="px-1 pt-4 text-[13px] text-black/40 dark:text-white/40">选择银行</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {banks.map((b) => (
            <button key={b} type="button" onClick={() => setBank(b)} className={`h-9 rounded-full px-3.5 text-[13px] ${bank === b ? 'bg-[#1B9FF0] text-white' : 'bg-white text-[#1F2329] active:opacity-60 dark:bg-[#232529] dark:text-white'}`}>
              {b}
            </button>
          ))}
        </div>
        <p className="px-1 pt-4 text-[12px] leading-relaxed text-black/35 dark:text-white/35">卡号由本机随机生成（符合 Luhn 校验），金额自定义；银行卡信息仅保存在本机浏览器（localStorage），不会上传到任何服务器。</p>
      </div>
      <div className="px-4 pb-[30px] pt-3">
        <button
          type="button"
          disabled={!ok}
          data-testid="qq-card-save"
          onClick={() => {
            if (!ok) return;
            onSave({ holder: holder.trim(), last4: noDigits.slice(-4), bank, no: noDigits, balance, type, createdAt: Date.now() });
          }}
          className={`h-12 w-full rounded-full text-[16px] font-medium text-white ${ok ? 'bg-[#1B9FF0] active:opacity-85' : 'bg-[#9FD6FA]'}`}
        >
          确定
        </button>
      </div>
    </div>
  );
}

/** 银行卡详情页（点击列表卡片进入：大卡视觉 + 卡内余额 + 持卡人/卡号/银行/类型/时间信息 + 解除绑定） */
function CardDetailPage({ card, onBack, onToast, onUnbind }: { card: BankCard; onBack: () => void; onToast: (m: string) => void; onUnbind: () => void }) {
  // 两步确认解绑：第一次点击变红提示，3 秒内再点确认（避免误触）
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    []
  );
  const tapUnbind = () => {
    if (armed) {
      onUnbind();
      return;
    }
    setArmed(true);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmed(false), 3000);
  };
  const rows: Array<{ k: string; v: React.ReactNode }> = [
    { k: '卡类型', v: card.type ?? '储蓄卡' },
    { k: '持卡人', v: card.holder },
    { k: '所属银行', v: card.bank },
    { k: '银行卡号', v: <span className="tracking-wider">{formatCardNo(card)}</span> },
  ];
  const fmtTime = (ts: number): string => new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="银行卡详情" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4">
        <BankCardVisual card={card} className="aspect-[85.6/54] w-full" />
        <div className="mt-4 overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <div className="border-b border-black/[0.04] px-4 pb-4 pt-5 text-center dark:border-white/[0.06]">
            <p className="text-[13px] text-black/40 dark:text-white/40">卡内余额 (元)</p>
            <div className="mt-1 text-[#1F2329] dark:text-white">
              <MoneyDigits value={card.balance ?? 0} className="text-[36px] font-semibold leading-tight tracking-tight" fracClassName="text-[19px] font-semibold" />
            </div>
          </div>
          {rows.map((r) => (
            <div key={r.k} className="flex min-h-[52px] items-center justify-between gap-3 border-b border-black/[0.04] px-4 py-2.5 last:border-b-0 dark:border-white/[0.06]">
              <span className="shrink-0 text-[15px] text-black/45 dark:text-white/45">{r.k}</span>
              <span className="min-w-0 truncate text-right text-[15px] text-[#1F2329] dark:text-white">{r.v}</span>
            </div>
          ))}
          {typeof card.createdAt === 'number' ? (
            <div className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-2.5">
              <span className="shrink-0 text-[15px] text-black/45 dark:text-white/45">添加时间</span>
              <span className="text-right text-[15px] text-[#1F2329] dark:text-white">{fmtTime(card.createdAt)}</span>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          data-testid="qq-card-unbind"
          onClick={tapUnbind}
          className={`mt-5 h-12 w-full rounded-full text-[16px] font-medium text-white active:opacity-85 ${armed ? 'bg-[#D6453C]' : 'bg-[#FA5151]/85'}`}
        >
          {armed ? '再点一次确认解除绑定' : '解除绑定'}
        </button>
        <p className="px-1 pt-4 text-[12px] leading-relaxed text-black/35 dark:text-white/35">银行卡信息仅保存在本机浏览器（localStorage），不会上传到任何服务器。</p>
      </div>
    </div>
  );
}

/** 提现页：余额转到银行卡（可选到账卡，扣钱包余额入卡） */
function WithdrawPage({ wallet, cards, onBack, onToast, onSubmit }: { wallet: WalletData; cards: BankCard[]; onBack: () => void; onToast: (m: string) => void; onSubmit: (cardId: string, n: number) => void }) {
  const [val, setVal] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cardId, setCardId] = useState<string | null>(cards[0]?.id ?? null);
  const card = cards.find((c) => c.id === cardId) ?? null;
  const num = Math.round((parseFloat(val) || 0) * 100) / 100;
  const ok = num > 0 && num <= wallet.balance && card !== null;
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader
        title="提现"
        onBack={onBack}
        right={
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="ml-auto mr-1 grid h-9 w-9 place-items-center rounded-full text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10">
            <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={2} />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        <button
          type="button"
          data-testid="qq-withdraw-card"
          className="flex w-full items-center px-1 py-2.5 text-[#1F2329] active:opacity-60 dark:text-white"
          onClick={() => (cards.length > 0 ? setPickerOpen(true) : onToast('请先在银行卡页添加银行卡'))}
        >
          <span className="text-[16px]">到账银行卡</span>
          {card ? (
            <span className="ml-9 flex items-center gap-2 text-[16px] font-semibold">
              {card.bank}
              <span className="text-[14px] font-normal text-black/40 dark:text-white/40">（尾号{card.last4}）</span>
            </span>
          ) : (
            <span className="ml-9 text-[16px] font-semibold">请先添加银行卡</span>
          )}
          <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-black/30 dark:text-white/30" aria-hidden="true" />
        </button>
        <div className="mt-1.5 rounded-[14px] bg-white px-5 pb-5 pt-4 dark:bg-[#232529]">
          <p className="text-[17px] text-[#1F2329] dark:text-white">提现金额</p>
          <div className="mt-3 flex items-center gap-2 border-b border-black/[0.08] pb-4 dark:border-white/10">
            <span className="text-[30px] font-medium text-[#1F2329] dark:text-white" aria-hidden="true">¥</span>
            <input
              value={val}
              inputMode="decimal"
              onChange={(e) => setVal(sanitizeAmount(e.target.value))}
              placeholder=""
              aria-label="提现金额"
              data-testid="qq-withdraw-amount"
              className="w-full bg-transparent text-[30px] font-medium text-[#1F2329] outline-none dark:text-white"
            />
          </div>
          <p className="mt-3.5 text-[14px] text-black/40 dark:text-white/40">
            当前钱包余额{fmtMoney(wallet.balance)}元，
            <button type="button" data-testid="qq-withdraw-all" onClick={() => setVal(wallet.balance.toFixed(2))} className="text-[#1B9FF0]">
              全部提现
            </button>
          </p>
        </div>
      </div>
      <div className="px-4 pb-[30px] pt-3">
        <button
          type="button"
          disabled={!ok}
          data-testid="qq-withdraw-ok"
          onClick={() => {
            if (!ok || !card) return;
            onSubmit(card.id, num);
          }}
          className={`mx-auto block h-12 w-[220px] rounded-full text-[16px] font-medium text-white ${ok ? 'bg-[#1B9FF0] active:opacity-85' : 'bg-[#9FD6FA]'}`}
        >
          确定
        </button>
      </div>
      {pickerOpen ? (
        <CardPickerSheet
          title="选择到账银行卡"
          cards={cards}
          selectedId={cardId}
          onClose={() => setPickerOpen(false)}
          onPick={(c) => {
            setCardId(c.id);
            setPickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** 银行卡选择底部弹层（充值选付款卡 / 提现选到账卡） */
function CardPickerSheet({ title, cards, selectedId, onClose, onPick }: { title: string; cards: BankCard[]; selectedId: string | null; onClose: () => void; onPick: (c: BankCard) => void }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label={title} onClick={onClose}>
      <div className="rounded-t-[18px] bg-white px-4 pb-8 pt-3 dark:bg-[#232529]" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" aria-hidden="true" />
        <p className="py-1 text-center text-[16px] font-medium text-[#1F2329] dark:text-white">{title}</p>
        <div className="mt-1 max-h-[320px] overflow-y-auto">
          {cards.map((c) => {
            const meta = BANK_META[c.bank] ?? BANK_FALLBACK;
            return (
              <button key={c.id} type="button" data-testid={`qq-card-pick-${c.last4}`} onClick={() => onPick(c)} className="flex w-full items-center gap-3 rounded-[12px] px-2 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[15px] font-semibold text-white" style={{ backgroundImage: `linear-gradient(135deg, ${meta.from}, ${meta.to})` }} aria-hidden="true">
                  {c.bank.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-[#1F2329] dark:text-white">{c.bank} {c.type ?? '储蓄卡'}</span>
                  <span className="block text-[12px] text-black/40 dark:text-white/40">尾号{c.last4} · 余额 {fmtMoney(c.balance ?? 0)} 元</span>
                </span>
                {selectedId === c.id ? <Check className="h-5 w-5 shrink-0 text-[#1B9FF0]" strokeWidth={2.5} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={onClose} className="mt-2 h-11 w-full rounded-full bg-black/[0.05] text-[15px] text-[#1F2329] active:opacity-70 dark:bg-white/10 dark:text-white">
          取消
        </button>
      </div>
    </div>
  );
}

/** 充值页：从银行卡转入余额（可选付款卡，扣卡内金额入钱包余额） */
function TopUpPage({ cards, onBack, onToast, onCharge }: { cards: BankCard[]; onBack: () => void; onToast: (m: string) => void; onCharge: (cardId: string, n: number) => void }) {
  const [val, setVal] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cardId, setCardId] = useState<string | null>(cards[0]?.id ?? null);
  const card = cards.find((c) => c.id === cardId) ?? null;
  const num = Math.round((parseFloat(val) || 0) * 100) / 100;
  const ok = num > 0 && card !== null;
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="充值" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        <button
          type="button"
          data-testid="qq-topup-card"
          className="flex w-full items-center px-1 py-2.5 text-[#1F2329] active:opacity-60 dark:text-white"
          onClick={() => (cards.length > 0 ? setPickerOpen(true) : onToast('请先在银行卡页添加银行卡'))}
        >
          <span className="text-[16px]">充值方式</span>
          {card ? (
            <span className="ml-9 flex items-center gap-2 text-[16px] font-semibold">
              {card.bank}
              <span className="text-[14px] font-normal text-black/40 dark:text-white/40">（尾号{card.last4} · {fmtMoney(card.balance ?? 0)}元）</span>
            </span>
          ) : (
            <span className="ml-9 text-[16px] font-semibold">请先添加银行卡</span>
          )}
          <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-black/30 dark:text-white/30" aria-hidden="true" />
        </button>
        <div className="mt-1.5 rounded-[14px] bg-white px-5 pb-6 pt-4 dark:bg-[#232529]">
          <p className="text-[17px] text-[#1F2329] dark:text-white">充值金额</p>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[30px] font-medium text-[#1F2329] dark:text-white" aria-hidden="true">¥</span>
            <input
              value={val}
              inputMode="decimal"
              onChange={(e) => setVal(sanitizeAmount(e.target.value))}
              placeholder=""
              aria-label="充值金额"
              data-testid="qq-topup-amount"
              className="w-full bg-transparent text-[30px] font-medium text-[#1F2329] outline-none dark:text-white"
            />
          </div>
          {card ? <p className="mt-2 text-[13px] text-black/35 dark:text-white/35">从 {card.bank} 尾号{card.last4} 转入，卡内余额 {fmtMoney(card.balance ?? 0)} 元</p> : null}
        </div>
      </div>
      <div className="px-4 pb-[30px] pt-3">
        <button
          type="button"
          disabled={!ok}
          data-testid="qq-topup-ok"
          onClick={() => {
            if (!ok || !card) return;
            if (num > (card.balance ?? 0)) {
              onToast('卡内余额不足');
              return;
            }
            onCharge(card.id, num);
          }}
          className={`mx-auto block h-12 w-[220px] rounded-full text-[16px] font-medium text-white ${ok ? 'bg-[#1B9FF0] active:opacity-85' : 'bg-[#9FD6FA]'}`}
        >
          确定
        </button>
      </div>
      {pickerOpen ? (
        <CardPickerSheet
          title="选择付款银行卡"
          cards={cards}
          selectedId={cardId}
          onClose={() => setPickerOpen(false)}
          onPick={(c) => {
            setCardId(c.id);
            setPickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** 账单页（余额页「账单」入口：充值/提现/小金库转入转出流水） */
function BillsPage({ bills, onBack }: { bills: WalletBill[]; onBack: () => void }) {
  const fmtTime = (ts: number): string =>
    new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="账单" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-6">
        {bills.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 pb-16 text-black/35 dark:text-white/35">
            <ClipboardList className="h-12 w-12" strokeWidth={1.5} aria-hidden="true" />
            <p className="text-[15px]">暂无账单</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
            {bills.map((b, i) => (
              <div key={b.id} className={`flex h-14 items-center gap-3 px-4 ${i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''}`}>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black/[0.05] text-black/55 dark:bg-white/[0.08] dark:text-white/55" aria-hidden="true">
                  {b.amount >= 0 ? <Banknote className="h-4 w-4" strokeWidth={1.8} /> : <PiggyBank className="h-4 w-4" strokeWidth={1.8} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] text-[#1F2329] dark:text-white">{b.title}</p>
                  <p className="text-[12px] text-black/35 dark:text-white/35">{fmtTime(b.ts)}</p>
                </div>
                <span className={`shrink-0 text-[15px] font-medium ${b.amount >= 0 ? 'text-[#2FBF71]' : 'text-[#1F2329] dark:text-white'}`}>
                  {b.amount >= 0 ? '+' : '-'}
                  {fmtMoney(Math.abs(b.amount))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 钱包容器（内部子路由；数据 localStorage 持久化，入口：个人中心抽屉「钱包」；开启支付密码后资金操作先验证） */
function WalletPage({ me, onBack, onToast }: { me: QQUser; onBack: () => void; onToast: (m: string) => void }) {
  const [wallet, setWallet] = useState<WalletData>(() => loadWallet());
  const [cards, setCards] = useState<BankCard[]>(() => loadBankCards());
  const [bills, setBills] = useState<WalletBill[]>(() => loadWalletBills());
  const [route, setRoute] = useState<'home' | 'balance' | 'vault' | 'cards' | 'addcard' | 'carddetail' | 'withdraw' | 'topup' | 'bills' | 'paysettings'>('home');
  const [payFrom, setPayFrom] = useState<'home' | 'balance'>('balance');
  const [detailCardId, setDetailCardId] = useState<string | null>(null);
  // 支付密码验证浮层（开启后充值/提现/小金库转入转出先验证再执行）
  const [pendingPay, setPendingPay] = useState<null | { label: string; fn: () => void }>(null);
  const requirePay = useCallback((label: string, fn: () => void) => {
    const pp = loadPayPwd();
    if (pp.enabled && pp.pwd) setPendingPay({ label, fn });
    else fn();
  }, []);
  const openPaySettings = useCallback((from: 'home' | 'balance') => {
    setPayFrom(from);
    setRoute('paysettings');
  }, []);

  const patchWallet = useCallback((patch: Partial<WalletData>) => {
    setWallet((prev) => {
      const next = { ...prev, ...patch };
      saveWallet(next);
      return next;
    });
  }, []);

  const appendBill = useCallback((title: string, amount: number) => {
    setBills((prev) => {
      const next = [{ id: uid(), title, amount, ts: Date.now() }, ...prev].slice(0, 100);
      saveWalletBills(next);
      return next;
    });
  }, []);

  const moveVault = useCallback(
    (mode: 'in' | 'out', n: number) => {
      setWallet((prev) => {
        const next =
          mode === 'in'
            ? { ...prev, balance: round2(prev.balance - n), vault: round2(prev.vault + n) }
            : { ...prev, balance: round2(prev.balance + n), vault: round2(prev.vault - n) };
        saveWallet(next);
        return next;
      });
      appendBill(mode === 'in' ? '转入小金库' : '小金库转出', mode === 'in' ? -n : n);
      onToast(mode === 'in' ? `已转入小金库 ${fmtMoney(n)} 元` : `已从金库转出 ${fmtMoney(n)} 元`);
    },
    [appendBill, onToast]
  );

  let page: React.ReactNode;
  switch (route) {
    case 'balance':
      page = (
        <BalancePage
          wallet={wallet}
          cards={cards}
          onBack={() => setRoute('home')}
          onToast={onToast}
          onOpenTopUp={() => setRoute('topup')}
          onOpenWithdraw={() => setRoute('withdraw')}
          onOpenCards={() => setRoute('cards')}
          onOpenBills={() => setRoute('bills')}
          onOpenPaySettings={() => openPaySettings('balance')}
        />
      );
      break;
    case 'vault':
      page = (
        <VaultPage
          wallet={wallet}
          onBack={() => setRoute('home')}
          onToast={onToast}
          onMove={(mode, n) => requirePay(`${mode === 'in' ? '转入' : '转出'}小金库 ${fmtMoney(n)} 元`, () => moveVault(mode, n))}
        />
      );
      break;
    case 'cards':
      page = <BankCardsPage cards={cards} onBack={() => setRoute('balance')} onToast={onToast} onAdd={() => setRoute('addcard')} onOpenCard={(c) => { setDetailCardId(c.id); setRoute('carddetail'); }} />;
      break;
    case 'carddetail': {
      const detailCard = cards.find((c) => c.id === detailCardId);
      page = detailCard ? (
        <CardDetailPage
          card={detailCard}
          onBack={() => setRoute('cards')}
          onToast={onToast}
          onUnbind={() => {
            setCards((prev) => {
              const next = prev.filter((c) => c.id !== detailCardId);
              saveBankCards(next);
              return next;
            });
            onToast('已解除绑定');
            setRoute('cards');
          }}
        />
      ) : (
        <BankCardsPage cards={cards} onBack={() => setRoute('balance')} onToast={onToast} onAdd={() => setRoute('addcard')} onOpenCard={(c) => { setDetailCardId(c.id); setRoute('carddetail'); }} />
      );
      break;
    }
    case 'addcard':
      page = (
        <AddCardPage
          defaultHolder={me.name || '持卡人'}
          onBack={() => setRoute('cards')}
          onSave={(c) => {
            setCards((prev) => {
              const next = [{ ...c, id: uid() }, ...prev];
              saveBankCards(next);
              return next;
            });
            onToast('银行卡添加成功');
            setRoute('cards');
          }}
        />
      );
      break;
    case 'withdraw':
      page = (
        <WithdrawPage
          wallet={wallet}
          cards={cards}
          onBack={() => setRoute('balance')}
          onToast={onToast}
          onSubmit={(cardId, n) =>
            requirePay(`提现 ${fmtMoney(n)} 元 · 到账${cards.find((c) => c.id === cardId)?.bank ?? '银行卡'}`, () => {
              setCards((prev) => {
                const next = prev.map((c) => (c.id === cardId ? { ...c, balance: round2((c.balance ?? 0) + n) } : c));
                saveBankCards(next);
                return next;
              });
              patchWallet({ balance: round2(wallet.balance - n) });
              appendBill('提现', -n);
              onToast(`已提现 ${fmtMoney(n)} 元到银行卡`);
              setRoute('balance');
            })
          }
        />
      );
      break;
    case 'topup':
      page = (
        <TopUpPage
          cards={cards}
          onBack={() => setRoute('balance')}
          onToast={onToast}
          onCharge={(cardId, n) =>
            requirePay(`充值 ${fmtMoney(n)} 元 · 从${cards.find((c) => c.id === cardId)?.bank ?? '银行卡'}`, () => {
              setCards((prev) => {
                const next = prev.map((c) => (c.id === cardId ? { ...c, balance: round2((c.balance ?? 0) - n) } : c));
                saveBankCards(next);
                return next;
              });
              patchWallet({ balance: round2(wallet.balance + n) });
              appendBill('充值', n);
              onToast(`充值成功 ${fmtMoney(n)} 元`);
              setRoute('balance');
            })
          }
        />
      );
      break;
    case 'bills':
      page = <BillsPage bills={bills} onBack={() => setRoute('balance')} />;
      break;
    case 'paysettings':
      page = <PaySettingsPage onBack={() => setRoute(payFrom)} onToast={onToast} />;
      break;
    case 'home':
    default:
      page = <WalletHomePage wallet={wallet} onBack={onBack} onToast={onToast} onOpenBalance={() => setRoute('balance')} onOpenVault={() => setRoute('vault')} onOpenPaySettings={() => openPaySettings('home')} />;
  }

  return (
    <>
      {page}
      {pendingPay ? (
        <PayPwdGate
          label={pendingPay.label}
          onOk={() => {
            const fn = pendingPay.fn;
            setPendingPay(null);
            fn();
          }}
          onClose={() => setPendingPay(null)}
        />
      ) : null}
    </>
  );
}

// ---------------- 收藏页（个人抽屉「收藏」入口；数据在 @/lib/msg-favorites） ----------------

function QqFavoritesPage({ onBack }: { onBack: () => void; onToast?: (m: string) => void }) {
  // 收藏页在提前 return 的分支里，App 根 toast 不渲染 → 页内自带 toast
  const [toast, showToast] = useLocalToast();
  const onToast = showToast;
  const [list, setList] = useState<MsgFavorite[]>(() => loadFavorites('qq'));

  const del = (id: string) => {
    removeFavorite('qq', id);
    setList((prev) => prev.filter((x) => x.id !== id));
    onToast('已删除收藏');
  };

  return (
    <div className="relative flex h-full flex-col bg-[#F5F6F7] text-[#1F2329] dark:bg-[#111214] dark:text-white">
      {/* 顶栏（QQ 风格返回 + 标题） */}
      <div className="shrink-0 bg-[#F5F6F7] pt-[54px] dark:bg-[#111214]">
        <div className="flex h-12 items-center gap-1 px-3">
          <button type="button" aria-label="返回" data-testid="qq-fav-back" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <div className="ml-1 flex flex-1 items-center">
            <span className="text-[17px] font-semibold leading-tight">我的收藏</span>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-24 text-black/35 dark:text-white/35" data-testid="qq-fav-empty">
            <Star className="h-10 w-10" strokeWidth={1.2} />
            <p className="text-[13px]">暂无收藏 · 长按聊天消息可收藏</p>
          </div>
        ) : (
          <div className="space-y-2">
            {list.map((f) => (
              <div key={f.id} data-testid="qq-fav-item" className="rounded-[12px] bg-white p-3 dark:bg-[#1E1F23]">
                <div className="flex items-center gap-2">
                  <QqAvatar src={f.contactAvatar} alt={f.contactName} size={30} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-black/55 dark:text-white/55">{f.contactName}</span>
                  <span className="shrink-0 text-[11px] text-black/35 dark:text-white/35">
                    {f.msgRole === 'me' ? '我' : '对方'} · {fmtChatTime(f.time)}
                  </span>
                  <button
                    type="button"
                    aria-label="删除收藏"
                    data-testid="qq-fav-del"
                    onClick={() => del(f.id)}
                    className="shrink-0 text-black/30 active:opacity-60 dark:text-white/30"
                  >
                    <Trash2 className="h-[16px] w-[16px]" strokeWidth={1.8} />
                  </button>
                </div>
                <div className="mt-2 rounded-[8px] bg-[#F6F7F8] px-2.5 py-2 dark:bg-white/[0.06]">
                  {f.stkUrl ? (
                    <img src={f.stkUrl} alt={f.content} className="max-h-[110px] w-auto max-w-full rounded object-contain" />
                  ) : f.imgSrc ? (
                    <img src={f.imgSrc} alt="收藏图片" className="max-h-[160px] w-auto max-w-full rounded object-cover" />
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.45]">{f.content}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* 页内 toast（已删除收藏等提示） */}
      <LocalToast msg={toast} />
    </div>
  );
}

// ---------------- 主界面（三 tab + 路由） ----------------

type MainRoute =
  | { page: 'tabs'; tab: '消息' | '联系人' | '动态' }
  | { page: 'profile' }
  | { page: 'wallet' }
  | { page: 'chat'; contactId: string }
  | { page: 'bond'; contactId: string }
  | { page: 'friend-profile'; contactId: string }
  | { page: 'addfriend' }
  | { page: 'newfriends' }
  | { page: 'zone' }
  | { page: 'zone-compose' }
  | { page: 'settings' }
  | { page: 'security' }
  | { page: 'stickers' }
  | { page: 'favorites' }
  | { page: 'group-create' }
  | { page: 'group-chat'; groupId: string }
  | { page: 'group-info'; groupId: string };

function MainScreen({
  me,
  contacts,
  onLogout,
  onPatchUser,
  refreshContacts,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  onLogout: () => void;
  onPatchUser: (patch: Partial<QQUser>) => void;
  refreshContacts: () => Promise<void>;
}) {
  const [route, setRoute] = useState<MainRoute>({ page: 'tabs', tab: '消息' });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | null>(null);
  // 消息页左上头像：退出 QQ 回手机主屏幕（不再打开个人中心抽屉）
  const closeApp = useUI((s) => s.closeApp);
  // 未读总线订阅：底部「消息」tab 角标 + 聊天页返回键角标实时同步
  const unreads = useUnreadMap(qqUnreads);

  const showToast = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1800);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const ownerNameOf = useCallback(
    (c: ContactRecord): string | null => {
      if (c.kind !== 'npc' || !c.ownerId) return null;
      return contacts.find((x) => x.id === c.ownerId)?.name ?? null;
    },
    [contacts]
  );

  const openTabs = useCallback((tab: '消息' | '联系人' | '动态') => setRoute({ page: 'tabs', tab }), []);
  const openChatOf = useCallback((c: ContactRecord) => setRoute({ page: 'chat', contactId: c.id }), []);
  const openGroupOf = useCallback((g: ChatGroup) => setRoute({ page: 'group-chat', groupId: g.id }), []);

  // 灵动岛通知点击跳转：打开通知对应的单聊/群聊（QQ 已打开时由事件驱动，未打开时挂载后自动消费 pending）
  useEffect(() => {
    const consume = () => {
      const t = takeNotifyNavigation('qq');
      if (!t) return;
      if (t.groupId) {
        const g = getGroup(t.groupId);
        if (g) setRoute({ page: 'group-chat', groupId: g.id });
      } else if (t.contactId) {
        setRoute({ page: 'chat', contactId: t.contactId });
      }
    };
    consume();
    window.addEventListener(ISLAND_NAV_EVENT, consume);
    return () => window.removeEventListener(ISLAND_NAV_EVENT, consume);
  }, []);
  /** 群数据版本：updateGroupRecord 落盘后 bump，让当前打开的群页拿到最新群对象 */
  const [groupVersion, setGroupVersion] = useState(0);
  const patchGroup = useCallback(
    (groupId: string, patch: Partial<Pick<ChatGroup, 'name' | 'avatar' | 'announcement' | 'memoryInterop' | 'memberIds'>>) => {
      updateGroupRecord(groupId, patch);
      setGroupVersion((v) => v + 1);
    },
    []
  );
  /** 当前打开的群（从存储现场读取；groupVersion 变化后重算） */
  const groupPeer = useMemo(
    () => (route.page === 'group-chat' || route.page === 'group-info' ? getGroup(route.groupId) : null),
    [route, groupVersion]
  );
  // 群路由但群已不在（被 AI 移出群聊 / 群已解散）：渲染期按消息 tab 兜底，避免空页面
  const staleGroupRoute = !groupPeer && (route.page === 'group-chat' || route.page === 'group-info');
  const activeTab: '消息' | '联系人' | '动态' = route.page === 'tabs' ? route.tab : '消息';
  // 写说说发表：统一走动态引擎（入库 + 记忆 + 排 AI 互动队列），回空间动态流（ZonePage 订阅 moments-changed 自动刷新）
  const handlePublishZonePost = useCallback(
    (text: string, images: string[]) => {
      const post = addUserMomentPost('qq', { userName: me.name, avatar: me.avatar, content: text, images });
      enqueuePostInteractions('qq', post.id);
    },
    [me.avatar, me.name]
  );

  const chatPeer =
    route.page === 'chat' || route.page === 'bond' || route.page === 'friend-profile'
      ? (contacts.find((c) => c.id === route.contactId) ?? null)
      : null;
  const meContact = contacts.find((c) => c.id === me.id) ?? null;

  /** 当前打开的聊天对象 id（仅在聊天页时有值） */
  const currentChatId = route.page === 'chat' ? route.contactId : null;
  /** 聊天页返回键角标：除当前会话外的未读总数（和 A 聊天时 B 来信 → 返回键旁显示 B 的未读数） */
  const chatOtherUnread = useMemo(() => {
    if (!currentChatId) return 0;
    let sum = 0;
    for (const [id, n] of Object.entries(unreads)) {
      if (id !== currentChatId && n > 0) sum += n;
    }
    return sum;
  }, [unreads, currentChatId]);
  /** 底部「消息」tab 角标：全部会话未读总数 */
  const totalUnread = useMemo(() => {
    let sum = 0;
    for (const n of Object.values(unreads)) {
      if (n > 0) sum += n;
    }
    return sum;
  }, [unreads]);

  const TAB_DEFS: { id: '消息' | '联系人' | '动态'; label: string; icon: React.ReactNode }[] = [
    { id: '消息', label: '消息', icon: <Bell className="h-[26px] w-[26px]" strokeWidth={1.9} aria-hidden="true" /> },
    { id: '联系人', label: '联系人', icon: <User className="h-[26px] w-[26px]" strokeWidth={1.9} aria-hidden="true" /> },
    { id: '动态', label: '动态', icon: <Star className="h-[26px] w-[26px]" strokeWidth={1.9} aria-hidden="true" /> },
  ];

  return (
    <div className="relative flex h-full w-full flex-col bg-[#FAFAFC] text-[#1F2329] dark:bg-[#16171A] dark:text-white">
      {route.page === 'chat' && chatPeer ? (
        <ChatPage
          key={chatPeer.id}
          me={me}
          peer={chatPeer}
          contacts={contacts}
          ownerName={ownerNameOf(chatPeer)}
          otherUnread={chatOtherUnread}
          onBack={() => openTabs('消息')}
          onOpenBond={() => setRoute({ page: 'bond', contactId: chatPeer.id })}
          onOpenFriendProfile={() => setRoute({ page: 'friend-profile', contactId: chatPeer.id })}
          onOpenGroup={(gid) => {
            const g = getGroup(gid);
            if (!g) return;
            setRoute({ page: 'group-chat', groupId: g.id });
          }}
          onSaveRemark={async (v) => {
            try {
              await updateContact(chatPeer.id, { remark: v || null });
              await refreshContacts();
              showToast(v ? '备注已保存' : '备注已清除');
            } catch {
              showToast('备注保存失败');
            }
          }}
          onSaveVoiceId={async (vid) => {
            try {
              await updateContact(chatPeer.id, { voiceId: vid || null });
              await refreshContacts();
              showToast(vid ? '已更新 TA 的声音' : '已恢复默认声音');
            } catch {
              showToast('声音保存失败');
            }
          }}
          onToast={showToast}
        />
      ) : route.page === 'bond' && chatPeer ? (
        <FriendBondPage
          me={me}
          peer={chatPeer}
          onBack={() => openChatOf(chatPeer)}
          onOpenProfile={() => setRoute({ page: 'profile' })}
          onToast={showToast}
        />
      ) : route.page === 'friend-profile' && chatPeer ? (
        <FriendProfilePage
          me={me}
          peer={chatPeer}
          onBack={() => openTabs('联系人')}
          onOpenChat={() => openChatOf(chatPeer)}
          onOpenBond={() => setRoute({ page: 'bond', contactId: chatPeer.id })}
          onToast={showToast}
        />
      ) : route.page === 'profile' ? (
        <ProfilePage
          me={me}
          onBack={() => openTabs('消息')}
          onOpenZone={() => setRoute({ page: 'zone' })}
          onOpenSettings={() => setRoute({ page: 'settings' })}
          onOpenChat={meContact ? () => openChatOf(meContact) : () => showToast('找不到当前账号的联系人资料')}
          onPatchUser={onPatchUser}
          onToast={showToast}
        />
      ) : route.page === 'addfriend' ? (
        <AddFriendPage
          me={me}
          contacts={contacts}
          onBack={() => openTabs('联系人')}
          onContactsChanged={() => void refreshContacts()}
          onOpenChat={openChatOf}
          onToast={showToast}
        />
      ) : route.page === 'newfriends' ? (
        <NewFriendsPage
          me={me}
          contacts={contacts}
          onBack={() => openTabs('联系人')}
          onOpenAdd={() => setRoute({ page: 'addfriend' })}
          onContactsChanged={() => void refreshContacts()}
          onOpenChat={openChatOf}
          onToast={showToast}
        />
      ) : route.page === 'zone' ? (
        <ZonePage
          me={me}
          contacts={contacts}
          onBack={() => openTabs('动态')}
          onOpenSettings={() => setRoute({ page: 'settings' })}
          onCompose={() => setRoute({ page: 'zone-compose' })}
          onToast={showToast}
        />
      ) : route.page === 'zone-compose' ? (
        <WritePostPage me={me} onBack={() => setRoute({ page: 'zone' })} onPublish={handlePublishZonePost} onToast={showToast} />
      ) : route.page === 'wallet' ? (
        <WalletPage me={me} onBack={() => openTabs('消息')} onToast={showToast} />
      ) : route.page === 'stickers' ? (
        <QqStickersPage onBack={() => openTabs('消息')} onToast={showToast} />
      ) : route.page === 'favorites' ? (
        <QqFavoritesPage onBack={() => openTabs('消息')} onToast={showToast} />
      ) : route.page === 'settings' ? (
        <SettingsPage
          me={me}
          onBack={() => openTabs('消息')}
          onOpenSecurity={() => setRoute({ page: 'security' })}
          onLogout={onLogout}
          onToast={showToast}
        />
      ) : route.page === 'security' ? (
        <SecurityPage me={me} contacts={contacts} onBack={() => setRoute({ page: 'settings' })} onSwitchAccount={onLogout} onToast={showToast} />
      ) : route.page === 'group-create' ? (
        <QqGroupCreatePage
          contacts={contacts}
          onBack={() => openTabs('联系人')}
          onCreated={(g) => setRoute({ page: 'group-chat', groupId: g.id })}
        />
      ) : route.page === 'group-info' && groupPeer ? (
        <QqGroupInfoPage
          key={`ginfo-${groupPeer.id}`}
          group={groupPeer}
          contacts={contacts}
          onBack={() => setRoute({ page: 'group-chat', groupId: groupPeer.id })}
          onUpdate={(patch) => patchGroup(groupPeer.id, patch)}
          onQuit={() => {
            quitGroupRecord(groupPeer.id);
            showToast('已退出群聊');
            openTabs('联系人');
          }}
          onDissolve={() => {
            dissolveGroupRecord(groupPeer.id);
            showToast('群聊已解散');
            openTabs('联系人');
          }}
          onToast={showToast}
        />
      ) : route.page === 'group-chat' && groupPeer ? (
        <QqGroupChatPage
          key={groupPeer.id}
          group={groupPeer}
          me={{ id: me.id, name: me.name, avatar: me.avatar }}
          contacts={contacts}
          ownerLabelOf={ownerNameOf}
          onBack={() => openTabs('消息')}
          onUpdate={(patch) => patchGroup(groupPeer.id, patch)}
          onOpenInfo={() => setRoute({ page: 'group-info', groupId: groupPeer.id })}
          onQuit={() => {
            quitGroupRecord(groupPeer.id);
            showToast('已退出群聊');
            openTabs('消息');
          }}
          onDissolve={() => {
            dissolveGroupRecord(groupPeer.id);
            showToast('群聊已解散');
            openTabs('消息');
          }}
          onToast={showToast}
        />
      ) : route.page === 'tabs' || staleGroupRoute ? (
        <>
          <div className="min-h-0 flex-1 overflow-hidden pt-[54px]">
            {activeTab === '消息' && (
              <MessagesPage
                me={me}
                contacts={contacts}
                onOpenChat={openChatOf}
                onOpenGroup={openGroupOf}
                onOpenDrawer={() => setDrawerOpen(true)}
                onAvatar={closeApp}
                onAddFriend={() => setRoute({ page: 'addfriend' })}
                onCreateGroup={() => setRoute({ page: 'group-create' })}
                onToast={showToast}
              />
            )}
            {activeTab === '联系人' && (
              <ContactsPage
                me={me}
                contacts={contacts}
                onOpenProfile={(c) => setRoute({ page: 'friend-profile', contactId: c.id })}
                onOpenMeProfile={() => setRoute({ page: 'profile' })}
                onAvatar={() => setDrawerOpen(true)}
                onAddFriend={() => setRoute({ page: 'addfriend' })}
                onOpenNewFriends={() => setRoute({ page: 'newfriends' })}
                onOpenGroup={openGroupOf}
                onToast={showToast}
              />
            )}
            {activeTab === '动态' && (
              <DiscoverPage me={me} onAvatar={() => setDrawerOpen(true)} onZone={() => setRoute({ page: 'zone' })} onToast={showToast} />
            )}
          </div>

          {/* 底部 tab（pb 预留底部横杠安全区，同微信 TabBar） */}
          <div className="shrink-0 border-t border-black/[0.05] bg-white pb-[16px] dark:border-white/[0.06] dark:bg-[#1B1C1F]">
          <nav className="flex h-[52px] items-stretch" aria-label="QQ 标签">
            {TAB_DEFS.map((t) => {
              const active = !staleGroupRoute && route.page === 'tabs' && route.tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  data-testid={`qq-tab-${t.id}`}
                  onClick={() => setRoute({ page: 'tabs', tab: t.id })}
                  aria-label={t.label}
                  className={`flex flex-1 flex-col items-center justify-center gap-0.5 ${active ? TAB_ACTIVE : 'text-black/55 dark:text-white/55'}`}
                >
                  <span className={`relative ${active ? '[&>svg]:fill-current' : ''}`}>
                    {t.icon}
                    {t.id === '消息' && totalUnread > 0 && (
                      <span
                        data-testid="qq-tab-badge-消息"
                        aria-label={`${totalUnread} 条未读`}
                        className="absolute -right-[10px] -top-[6px] flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[#F5455C] px-[4px] text-[11px] font-semibold leading-none text-white ring-2 ring-white dark:ring-[#1B1C1F]"
                      >
                        {totalUnread > 99 ? '99+' : totalUnread}
                      </span>
                    )}
                  </span>
                  <span className="text-[10px]">{t.label}</span>
                </button>
              );
            })}
          </nav>
          </div>
        </>
      ) : null}

      {/* 个人中心抽屉（左上头像打开） */}
      {drawerOpen && (
        <MeDrawer
          me={me}
          onClose={() => setDrawerOpen(false)}
          onOpenProfile={() => {
            setDrawerOpen(false);
            setRoute({ page: 'profile' });
          }}
          onOpenWallet={() => setRoute({ page: 'wallet' })}
          onOpenStickers={() => setRoute({ page: 'stickers' })}
          onOpenFavorites={() => setRoute({ page: 'favorites' })}
          onOpenSettings={() => {
            setDrawerOpen(false);
            setRoute({ page: 'settings' });
          }}
          onSwitchAccount={() => {
            setDrawerOpen(false);
            onLogout();
          }}
          onPatchUser={onPatchUser}
          onToast={showToast}
        />
      )}

      {toast && <QqToast text={toast} />}
    </div>
  );
}

// ---------------- App 入口 ----------------

export default function QQApp() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<QQUser | null>(null);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);

  // 群社交：把联系人快照喂给 group-social（建群/拉人名单、被踢通知的宿主侧数据源）
  useEffect(() => {
    setGroupSocialContacts(contacts);
  }, [contacts]);

  // 启动：拉联系人 + 恢复登录态（联系人被删则自动登出；QQ 内显示昵称，昵称优先于真实名字）
  useEffect(() => {
    let alive = true;
    (async () => {
      const raw = await listContacts().catch(() => [] as ContactRecord[]);
      const list = withDisplayNames(raw);
      if (!alive) return;
      setContacts(list);
      try {
        const savedId = window.localStorage.getItem(LS_SESSION);
        if (savedId) {
          const u = raw.find((c) => c.id === savedId && c.kind === 'user');
          if (u) {
            setUser({ id: u.id, name: displayNameOf(u), realName: u.name, nickname: u.nickname ?? null, avatar: u.avatar, qqId: u.qqId, phone: u.phone, persona: u.persona });
          } else {
            window.localStorage.removeItem(LS_SESSION);
          }
        }
      } catch {
        // 忽略
      }
      setBooting(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleLogin = useCallback((u: QQUser) => {
    setUser(u);
    try {
      window.localStorage.setItem(LS_SESSION, u.id);
    } catch {
      // 忽略
    }
  }, []);

  const handleLogout = useCallback(() => {
    setUser(null);
    try {
      window.localStorage.removeItem(LS_SESSION);
    } catch {
      // 忽略
    }
  }, []);

  // 添加好友后刷新联系人列表（同步换成昵称展示名）
  const refreshContacts = useCallback(async () => {
    const raw = await listContacts().catch(() => [] as ContactRecord[]);
    setContacts(withDisplayNames(raw));
  }, []);

  // 个签等本地资料更新（同步到 QQUser，落库在调用方完成）
  const handlePatchUser = useCallback((patch: Partial<QQUser>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  if (booting) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-[#EAE6F6] via-[#E4EBF7] to-[#E7F0F9] dark:from-[#23253A] dark:via-[#20293A] dark:to-[#1E2A38]">
        <svg viewBox="0 0 40 40" className="h-16 w-16" aria-hidden="true">
          {/* 简化 QQ 企鹅（启动图） */}
          <ellipse cx="20" cy="17" rx="11" ry="12" fill="#2B2B33" />
          <ellipse cx="20" cy="22" rx="7.2" ry="7.6" fill="#fff" />
          <circle cx="15.8" cy="13.5" r="2.6" fill="#fff" />
          <circle cx="24.2" cy="13.5" r="2.6" fill="#fff" />
          <circle cx="16.3" cy="13.9" r="1.15" fill="#20242B" />
          <circle cx="23.7" cy="13.9" r="1.15" fill="#20242B" />
          <path d="M15.5 17.6c1.4 1.5 7.6 1.5 9 0 .9 1.4-1.6 4-4.5 4s-5.4-2.6-4.5-4z" fill="#FFA611" />
          <rect x="13" y="26.5" width="14" height="4" rx="2" fill="#F5455C" />
        </svg>
        <p className="mt-4 text-[13px] text-black/40 dark:text-white/40">QQ</p>
      </div>
    );
  }

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  return <MainScreen me={user} contacts={contacts} onLogout={handleLogout} onPatchUser={handlePatchUser} refreshContacts={refreshContacts} />;
}
