'use client';

/**
 * 微信 App：
 * - 登录：账号数据来自「联系人 App」中 kind = user 的联系人
 *   ① 手机号 + 微信密码 ② 微信号 / QQ 号 + 对应密码（本地 IndexedDB 联系人校验，不调服务端）
 * - 登录后：微信 / 通讯录 / 发现 / 我 四个 tab + 好友 AI 聊天 + 朋友圈（发布/点赞/评论）+ 好友朋友圈 + 添加朋友 + 设置（退出登录）
 * - 通讯录与「信息」App 一致：只有添加过的微信好友（friendWx，独立于 QQ/信息）才显示；首次登录只有「我」自己
 * - char / npc 账号暂不支持登录（本地校验拦截）
 */

import { useLayoutEffect, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  AtSign,
  Banknote,
  BellOff,
  Camera,
  Check,
  CirclePlus,
  Clock,
  Compass,
  EyeOff,
  Forward,
  Gift,
  Heart,
  Image as ImageIcon,
  Loader2,
  MailOpen,
  MapPin,
  MessageCircle,
  Newspaper,
  Pencil,
  Phone,
  Pin,
  PinOff,
  Plus,
  QrCode,
  Radar,
  ScanLine,
  Search,
  Smartphone,
  Smile,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Undo2,
  User,
  UserPlus,
  Users,
  Video,
  Wallet,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { addFavorite, isMsgFavorited, loadFavorites, removeFavorite, unfavoriteMsg, type MsgFavorite } from '@/lib/msg-favorites';
import { useSettings, useUI } from '@/lib/ios/store';
import { groupPreview, listGroups, updateGroup as updateGroupRecord, dissolveGroup as dissolveGroupRecord, effectiveInterop, type ChatGroup } from '@/lib/ios/groups';
import { WxGroupChatPage, WxGroupCreatePage, WxGroupInfoPage, WxGroupListPage, GroupAvatar, groupRowId } from './wx-group';
import { BUBBLE_MENU_ICONS, BubbleActionMenu, computeBubbleMenuPos, useBubbleLongPress, type BubbleMenuItem, type BubbleMenuPos } from './bubble-menu';
import { LocalToast, useLocalToast } from './page-toast';
import { fwdRecordDate, fwdRecordTime, fwdRecordTitle, type FwdMode, type FwdRecord, type FwdSheetTarget } from './forward-sheet';
import {
  beginChatStream,
  clearChatStream,
  isChatStreaming,
  useChatStream,
  useChatStreamFinalized,
  type ChatPayloadMessage,
} from '@/lib/chat-stream-store';
import { buildPersonaSystemPrompt } from '@/lib/ios/persona';
import { buildNpcPromptExtra, type NpcPromptExtra } from '@/lib/ios/npc-bond';
import {
  WxIcMoments,
  WxIcChannels,
  WxIcScan,
  WxIcListen,
  WxIcStories,
  WxIcSearch,
  WxIcGames,
  WxIcMiniProgram,
  WxIcServices,
  WxIcFavorites,
  WxIcWorks,
  WxIcShop,
  WxIcSticker,
  WxIcSettings,
} from './wx-icons';
import { getReplyCount, saveReplyCount, buildReplyCountPrompt, splitReplySegments, splitReplyRender } from '@/lib/reply-count';
import {
  buildRichRules,
  buildActionRules,
  extractRichActionParts,
  actionVerb,
  mergeRichSegments,
  parseRichParts,
  prettifyRichText,
  type PendingCardInfo,
  type RichAction,
  type RichMsg,
} from '@/lib/chat-rich';
import { getTranslateCfg, saveTranslateCfg, requestTranslation, translateLangLabel, normalizeTranslateCfg, detectTranslateTarget, type ChatTranslateCfg } from '@/lib/chat-translate';
import { getSentenceSend, saveSentenceSend, hasPendingBatch, markPendingBatch } from '@/lib/sentence-send';
import { getStickersOn, saveStickersOn, STICKER_OFF_RULE } from '@/lib/sticker-toggle';
import { stripEmojiText } from '@/lib/emoji';
import { getTimeAware, setTimeAware, buildTimeAwareBlock } from '@/lib/time-aware';
import { kvGet, kvSet, kvDel } from '@/lib/ios/idb-kv';
import { memAfterAiTurn, memConvoFromRaw, memLastMsgId, memRecallBlock } from '@/lib/memory';
import {
  addCharMomentPost,
  addUserMomentComment,
  addUserMomentPost,
  aiPostMoment,
  buildMomentsChatBlock,
  deleteMomentComment,
  deleteMomentPost,
  enqueuePostInteractions,
  isPostByPeer,
  listMomentPosts,
  subscribeMomentsChanged,
  toggleUserMomentLike,
  updateMomentPostContent,
} from '@/lib/moments';
import { AskPostSheet, CommentDeleteDialog, EditPostDialog, MomentAutoCfgSheet, momentFriendsOf } from './moments-shared';
import { loginWechat, getWxBg, setWxBg, getChatBgImage, setChatBgImage, removeChatBgImage, listContacts, ownerRealName, contactRealName, updateContact } from '@/lib/ios/contacts-store';
import { displayNameOf, isFriendIn, withDisplayNames } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import { loadStickers, saveStickers, newStickerId, extractMeaningFromUrl, fileNameMeaning, isImageUrl } from '@/lib/ios/stickers';
import type { Sticker } from '@/lib/ios/stickers';
import { useUnreadMap, wxUnreads as wxUnreadStore } from '@/lib/unread-store';
import { useChatFlags, NO_FLAGS, wxChatFlags as wxChatFlagsStore } from '@/lib/chat-flags';
import {
  ChatBgPage,
  ChatReplyCountPage,
  ChatSearchPage,
  ChatSettingsPage,
  ChatTranslatePage,
  WorldBookPickerPage,
  chatBgLayerStyle,
  type ChatSearchItem,
  type ChatSettingsBg,
} from './chat-settings';
import { applyWbUserBlocks, collectWbBlocks, getBoundBookIds, loadBooks, setBoundBookIds, wbRulesBlock, wbScanText } from '@/lib/ios/worldbook';
import { BatchStickerSheet, StickerMeaningPicker } from '@/components/apps/sticker-batch';
import type { BatchDraftItem } from '@/components/apps/sticker-batch';
import {
  WxServices,
  fmtMoney,
  loadJSON,
  saveJSON,
  LS_WALLET,
  LS_BILLS,
  loadCards,
  BankDot,
  loadFamilyCards,
  loadFamilyCardsIn,
  saveFamilyCards,
  saveFamilyCardsIn,
  wxLoadPayPwd,
  WxPayPwdGate,
  type WxCard,
  type WxFamilyCard,
  type WxFamilyCardIn,
} from './wechat-wallet';

// ---------------- 类型 / 常量 / 工具 ----------------

interface WxUser {
  id: string;
  name: string;
  avatar: string | null;
  wechatId: string | null;
  phone: string | null;
  qqId: string | null;
}

interface WxRpData {
  amount: number;
  blessing: string;
  /** 是否已被領取（領取后金额存入零钱） */
  opened: boolean;
  openedAt?: number;
  /** 领取人名字（我领 AI 的→我；AI 领我发的→对方）；仅单人群场景 */
  openedBy?: string;
  /** 退还/拒收终态（我退回 AI 发的红包，或 AI 退回/拒收我发的红包；终态后不能重复处理） */
  status?: 'returned' | 'rejected';
  /** AI 处理动作用的短 ID（我发给 AI 的红包才有；AI 在动作标记里引用它） */
  cid?: string;
}

interface WxTrData {
  amount: number;
  note: string;
  /** 对方是否已收款（打开详情时模拟对方确认） */
  received: boolean;
  receivedAt?: number;
  /** 接收卡片凭据：'me'=这张卡是对方收我转账的凭据；'peer'=这张卡是我收对方转账的凭据（详情页文案按此区分「××已收款 / 你已收款」） */
  receiptOf?: 'me' | 'peer';
  /** 退还/拒收终态（我退回 AI 发的转账，或 AI 退回/拒收我发的转账；终态后不能重复处理） */
  status?: 'returned' | 'rejected';
  /** 退款时间（退还后写入；详情页「退款时间」行） */
  refundedAt?: number;
  /** 退还凭据卡专用：原转账发生时间（详情页「转账时间」行显示原转账时间） */
  originTime?: number;
  /** 退还凭据卡专用：退还人（'me'=我退的→详情显示「你已退还」；'peer'=对方退的→「对方已退还」）；原卡省略时按消息角色反推 */
  refundedBy?: 'me' | 'peer';
  /** AI 处理动作用的短 ID（我发给 AI 的转账才有） */
  cid?: string;
}

/** 聊天中的系统通知行（对方领取/退回/拒收了你的红包/转账/亲属卡）：居中灰字 + 彩色尾词 */
interface WxNoticeData {
  /** 小图标：rp=红红包 / tr=橙转账 / fam=金亲属卡 */
  icon: 'rp' | 'tr' | 'fam';
  /** 主体文案（不含尾词），如「晚晴宝领取了你的」 */
  pre: string;
  /** 尾词高亮：「红包」/「转账」/「亲属卡」 */
  accent: string;
}

/** 亲属卡消息数据（我赠送 / 好友赠送共用；点卡片进详情） */
interface WxFamData {
  /** 每月消费上限（元） */
  monthlyLimit: number;
  /** 关系（女朋友/爸爸…） */
  relation: string;
  /** 赠卡留言 */
  message: string;
  /** 是否已被领取（我发的→对方领；对方发的→我领） */
  claimed: boolean;
  claimedAt?: number;
  /** 本月已用额度（展示用） */
  used: number;
  /** 优先扣款方式（我发的卡展示） */
  method?: string;
  /** 被收卡方退还/拒收（终态，卡片变灰） */
  rejected?: boolean;
  /** AI 处理动作用的短 ID（我发给 AI 的亲属卡才有） */
  cid?: string;
}

interface WxMsg {
  id: string;
  role: 'me' | 'peer';
  content: string;
  time: number;
  /** 消息类型：默认 text；红包/转账/亲属卡为卡片消息；image 图片；location 位置卡片；sticker 表情包；notice = 红包领取通知；forward = 转发卡片 */
  kind?: 'text' | 'redpacket' | 'transfer' | 'notice' | 'family' | 'image' | 'location' | 'sticker' | 'forward';
  rp?: WxRpData;
  tr?: WxTrData;
  notice?: WxNoticeData;
  fam?: WxFamData;
  img?: { src: string };
  loc?: { name: string; address: string };
  /** 表情消息（stk.url 图片，stk.meaning 意思，stk.sid 本地表情包唯一 ID——AI 上下文回写 [表情包:ID] 示范格式） */
  stk?: { url: string; meaning: string; sid?: string };
  /** 引用回复（长按菜单「引用」后发送时带上；气泡内嵌小引用块；AI 上下文带引用前缀） */
  quote?: { name: string; content: string };
  /** 已撤回（渲染为居中灰字「你撤回一条消息 / 对方撤回一条消息」，不再参与上下文） */
  recalled?: boolean;
  /** 转发卡片（kind='forward'；fwd.from = 来源会话联系人名；merged=true 为合并转发的「聊天记录」卡片，records 存原始对话） */
  fwd?: { from: string; merged?: boolean; title?: string; records?: { name: string; role: 'me' | 'peer'; text: string; quote?: string; time: number; avatar?: string | null; kind?: 'text' | 'sticker' | 'image'; imgSrc?: string; stkMeaning?: string }[] };
}

/** 朋友圈评论（replyTo = 「回复某人」的名字） */
interface WxMomentComment {
  id: string;
  author: string;
  text: string;
  time: number;
  replyTo: string | null;
}

/** 朋友圈动态（localStorage 持久化，新动态在最前） */
interface WxMoment {
  id: string;
  authorName: string;
  avatar: string | null;
  text: string;
  images: string[];
  time: number;
  likes: string[];
  comments: WxMomentComment[];
}

/** 新的朋友通知（添加好友成功后写入） */
interface WxFriendReq {
  id: string;
  name: string;
  avatar: string | null;
  message: string;
  time: number;
}

const LS_SESSION = 'wx-session-user-id';
const LS_MOMENTS = 'wx-moments';
const LS_WX_REQS = 'wx-friend-reqs';
const lsMsgsKey = (contactId: string) => `wx-chat-msgs:${contactId}`;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 当前正在查看的微信聊天（ChatPage 挂载时写入/卸载时清除）：AI 回复落盘时不在该会话 → 未读角标 +1 */
let wxActiveChatId: string | null = null;

function loadMsgs(contactId: string): WxMsg[] {
  try {
    // 持久化在 IndexedDB kv store（启动时由 idb-kv 从 localStorage 迁移，内存同步读）
    const raw = kvGet<WxMsg[]>(lsMsgsKey(contactId));
    if (!Array.isArray(raw)) return [];
    const parsed: unknown = raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is WxMsg =>
          Boolean(m) &&
          typeof (m as WxMsg).content === 'string' &&
          ((m as WxMsg).role === 'me' || (m as WxMsg).role === 'peer')
      )
      // 引用/撤回/转发字段规范化（旧记录无这些字段时补默认值）
      .map((m) => ({
        ...m,
        quote:
          m.quote && typeof m.quote.name === 'string' && typeof m.quote.content === 'string'
            ? { name: m.quote.name, content: m.quote.content }
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
      }))
      .map((m) => {
        if (m.kind === 'redpacket' && m.rp && typeof m.rp.amount === 'number') {
          return {
            ...m,
            rp: {
              amount: m.rp.amount,
              blessing: typeof m.rp.blessing === 'string' ? m.rp.blessing : '恭喜发财，大吉大利',
              opened: m.rp.opened === true,
              openedAt: typeof m.rp.openedAt === 'number' ? m.rp.openedAt : undefined,
              openedBy: typeof m.rp.openedBy === 'string' ? m.rp.openedBy : undefined,
              status: m.rp.status === 'returned' || m.rp.status === 'rejected' ? m.rp.status : undefined,
              cid: typeof m.rp.cid === 'string' ? m.rp.cid : undefined,
            },
          };
        }
        if (m.kind === 'transfer' && m.tr && typeof m.tr.amount === 'number') {
          return {
            ...m,
            tr: {
              amount: m.tr.amount,
              note: typeof m.tr.note === 'string' ? m.tr.note : '',
              received: m.tr.received === true,
              receivedAt: typeof m.tr.receivedAt === 'number' ? m.tr.receivedAt : undefined,
              status: m.tr.status === 'returned' || m.tr.status === 'rejected' ? m.tr.status : undefined,
              cid: typeof m.tr.cid === 'string' ? m.tr.cid : undefined,
              // 收款方向标记（详情页文案「你已收款 / ××已收款」）：必须在规范化中保留，否则落盘回读后丢失
              receiptOf: m.tr.receiptOf === 'me' || m.tr.receiptOf === 'peer' ? m.tr.receiptOf : undefined,
              // 退还链路字段（退款时间/原转账时间/退还人）：退还凭据卡与详情页退还态依赖，落盘回读必须保留
              refundedAt: typeof m.tr.refundedAt === 'number' ? m.tr.refundedAt : undefined,
              originTime: typeof m.tr.originTime === 'number' ? m.tr.originTime : undefined,
              refundedBy: m.tr.refundedBy === 'me' || m.tr.refundedBy === 'peer' ? m.tr.refundedBy : undefined,
            },
          };
        }
        if (m.kind === 'family' && m.fam && typeof m.fam.monthlyLimit === 'number') {
          return {
            ...m,
            fam: {
              monthlyLimit: m.fam.monthlyLimit,
              relation: typeof m.fam.relation === 'string' ? m.fam.relation : '家人',
              message: typeof m.fam.message === 'string' ? m.fam.message : '我为你准备了亲属卡，你消费我买单',
              claimed: m.fam.claimed === true,
              claimedAt: typeof m.fam.claimedAt === 'number' ? m.fam.claimedAt : undefined,
              used: typeof m.fam.used === 'number' ? m.fam.used : 0,
              method: typeof m.fam.method === 'string' ? m.fam.method : '零钱',
              rejected: m.fam.rejected === true,
              cid: typeof m.fam.cid === 'string' ? m.fam.cid : undefined,
            },
          };
        }
        if (m.kind === 'image' && m.img && typeof m.img.src === 'string') {
          return m;
        }
        if (m.kind === 'location' && m.loc && typeof m.loc.name === 'string') {
          return { ...m, loc: { name: m.loc.name, address: typeof m.loc.address === 'string' ? m.loc.address : '' } };
        }
        if (m.kind === 'sticker' && m.stk && typeof m.stk.url === 'string') {
          return { ...m, stk: { url: m.stk.url, meaning: typeof m.stk.meaning === 'string' ? m.stk.meaning : '' } };
        }
        return m;
      });
  } catch {
    return [];
  }
}

function saveMsgs(contactId: string, msgs: WxMsg[]): void {
  // 持久化写穿到 IndexedDB（内存同步，异步落盘）；旧 localStorage 键已由迁移器删除
  kvSet(lsMsgsKey(contactId), msgs.slice(-100));
  // 新消息自动恢复被「删除/不显示」的会话（真微信行为）
  try {
    const hid = loadStrList(LS_CHAT_HIDDEN);
    if (hid.includes(contactId)) saveStrList(LS_CHAT_HIDDEN, hid.filter((x) => x !== contactId));
  } catch {
    // 忽略
  }
}

// ---------------- 转发感知：目标会话的 AI 事件队列 ----------------

/** 转发消息落到目标会话时，同时给目标 AI 排一条「感知事件」；对方会话被打开时 drain 并触发一次 AI 回合，
 *  让被分享的 AI 知道收到了什么（与页面是否存活无关） */
const lsAiEventsKey = (contactId: string) => `wx-ai-events:${contactId}`;

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

/** 聊天列表长按菜单状态（置顶迁移至 @/lib/chat-flags 的 wxChatFlags 表；未读/已隐藏仍存 localStorage） */
const LS_CHAT_HIDDEN = 'wx-chat-hidden';

/** 未读计数总线（单例在 @/lib/unread-store）：会话列表角标 / 聊天页返回键角标 / 底部 tab 角标 / 主屏图标角标共享 */
const wxUnreads = wxUnreadStore;

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

function loadMoments(): WxMoment[] {
  try {
    const parsed: unknown = kvGet<WxMoment[]>(LS_MOMENTS);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is WxMoment => Boolean(p) && typeof (p as WxMoment).id === 'string' && typeof (p as WxMoment).time === 'number')
      .map((p) => ({
        ...p,
        text: typeof p.text === 'string' ? p.text : '',
        avatar: typeof p.avatar === 'string' ? p.avatar : null,
        authorName: typeof p.authorName === 'string' ? p.authorName : '微信用户',
        images: Array.isArray(p.images) ? p.images.filter((i) => typeof i === 'string') : [],
        likes: Array.isArray(p.likes) ? p.likes.filter((i) => typeof i === 'string') : [],
        comments: Array.isArray(p.comments)
          ? p.comments
              .filter(
                (c): c is WxMomentComment =>
                  Boolean(c) &&
                  typeof (c as WxMomentComment).author === 'string' &&
                  typeof (c as WxMomentComment).text === 'string' &&
                  typeof (c as WxMomentComment).time === 'number'
              )
              .map((c) => {
                // 旧版遗留修复：AI「回复自己」的历史 bug 数据（replyTo 是自己的名字且作者为 char）读时摘掉错误指向
                const rawReplyTo = typeof c.replyTo === 'string' ? c.replyTo : null;
                const selfReplyBug =
                  rawReplyTo !== null && rawReplyTo === c.author && (c as { authorKind?: unknown }).authorKind === 'char';
                return {
                  id: typeof c.id === 'string' ? c.id : uid(),
                  author: c.author,
                  text: c.text,
                  time: c.time,
                  replyTo: selfReplyBug ? null : rawReplyTo,
                };
              })
          : [],
      }));
  } catch {
    return [];
  }
}

/** 好友朋友圈示例动态（首次进入该好友的朋友圈时补齐，走动态引擎写入：writeMemory=false 不入记忆） */
const FRIEND_POST_TEMPLATES: ReadonlyArray<{ text: string; agoMs: number }> = [
  { text: '今天天气不错，出去走了走 ☀️', agoMs: 2 * 3_600_000 },
  { text: '忙完这个项目，终于可以休息一下了', agoMs: 26 * 3_600_000 },
  { text: '新的开始，加油！', agoMs: 3 * 86_400_000 },
];

function loadReqs(): WxFriendReq[] {
  try {
    const parsed: unknown = kvGet<WxFriendReq[]>(LS_WX_REQS);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is WxFriendReq =>
        Boolean(r) && typeof (r as WxFriendReq).id === 'string' && typeof (r as WxFriendReq).time === 'number'
    );
  } catch {
    return [];
  }
}

function saveReqs(list: WxFriendReq[]): void {
  try {
    kvSet(LS_WX_REQS, list.slice(0, 100));
  } catch {
    // 持久化失败忽略
  }
}

/** 由 WxUser 构造兜底 ContactRecord（联系人列表里找不到自己时用于进入自己聊天） */
function meAsContact(me: WxUser): ContactRecord {
  return {
    id: me.id,
    kind: 'user',
    ownerId: null,
    name: me.name,
    nickname: null,
    gender: null,
    age: null,
    height: null,
    weight: null,
    persona: null,
    background: null,
    occupation: null,
    company: null,
    region: null,
    relation: null,
    phone: me.phone,
    wechatId: me.wechatId,
    wechatPassword: null,
    qqId: me.qqId,
    qqPassword: null,
    avatar: me.avatar,
    isFriend: true,
    createdAt: '',
  };
}

/** 会话列表预览（最后一条非通知消息 + 时间）；撤回的消息显示「你/对方撤回一条消息」 */
function readPreview(contactId: string): { text: string; time: number } {
  const msgs = loadMsgs(contactId);
  const last = [...msgs].reverse().find((m) => m.kind !== 'notice');
  if (!last) return { text: '', time: 0 };
  if (last.recalled) return { text: last.role === 'me' ? '你撤回一条消息' : '对方撤回一条消息', time: last.time };
  if (last.kind === 'redpacket') return { text: '[微信红包]', time: last.time };
  if (last.kind === 'transfer') return { text: '[转账]', time: last.time };
  if (last.kind === 'family') return { text: '[亲属卡]', time: last.time };
  if (last.kind === 'image') return { text: '[图片]', time: last.time };
  if (last.kind === 'location') return { text: '[位置]', time: last.time };
  if (last.kind === 'sticker') return { text: '[表情]', time: last.time };
  if (last.kind === 'forward') return { text: last.fwd?.merged ? '[聊天记录]' : last.content, time: last.time };
  return { text: last.content, time: last.time };
}

/** 微信零钱余额（与「服务」钱包共用 wx-wallet 存储） */
function wxLoadBalance(): number {
  const w = loadJSON<{ balance?: number }>(LS_WALLET, {});
  return typeof w.balance === 'number' && w.balance >= 0 ? w.balance : 0;
}

const LS_CARDS = 'wx-wallet-cards';

/** 零钱增减 + 可选写一条零钱明细账单；余额不足返回 false（单聊/群聊共用） */
export function wxPatchBalance(delta: number, bill?: { kind: '红包' | '转账'; amount: number }): boolean {
  const next = Math.round((wxLoadBalance() + delta) * 100) / 100;
  if (next < 0) return false;
  saveJSON(LS_WALLET, { balance: next });
  if (bill) wxPushBill(bill.kind, bill.amount);
  return true;
}

/** 追加一条零钱明细账单（新的在前，最多 100 条） */
function wxPushBill(kind: '红包' | '转账', amount: number): void {
  const bills = loadJSON<{ id?: string; kind?: string; amount?: number; time?: number }[]>(LS_BILLS, []).filter(
    (b) => Boolean(b) && typeof b.kind === 'string' && typeof b.amount === 'number' && typeof b.time === 'number'
  );
  saveJSON(LS_BILLS, [{ id: uid(), kind, amount, time: Date.now() }, ...bills].slice(0, 100));
}

/** 支付方式可用性预检：零钱 / 银行卡 / 我收到的亲属卡（本月剩余额度）；单聊/群聊共用 */
export function wxCanPay(methodId: string, amount: number): boolean {
  if (!(amount > 0)) return false;
  if (methodId === 'balance') return wxLoadBalance() >= amount;
  if (methodId.startsWith('fcin-')) {
    const fc = loadFamilyCardsIn().find((f) => f.id === methodId);
    return Boolean(fc) && Math.max(0, (fc?.monthlyLimit ?? 0) - (fc?.used ?? 0)) >= amount;
  }
  const c = loadCards().find((x) => x.id === methodId);
  return Boolean(c) && (c?.balance ?? 0) >= amount;
}

/** 按所选支付方式扣款（零钱 / 银行卡 / 亲属卡额度；亲属卡不动零钱不写账单，其余写零钱明细）；单聊/群聊共用 */
export function wxExecutePayment(methodId: string, amount: number, kind: '红包' | '转账'): boolean {
  if (!(amount > 0)) return false;
  if (methodId === 'balance') return wxPatchBalance(-amount, { kind, amount: -amount });
  if (methodId.startsWith('fcin-')) {
    const list = loadFamilyCardsIn();
    const fc = list.find((f) => f.id === methodId);
    if (!fc || Math.max(0, fc.monthlyLimit - fc.used) < amount) return false;
    saveFamilyCardsIn(list.map((f) => (f.id === methodId ? { ...f, used: Math.round((f.used + amount) * 100) / 100 } : f)));
    return true;
  }
  const list = loadCards();
  const c = list.find((x) => x.id === methodId);
  if (!c || c.balance < amount) return false;
  saveJSON(
    LS_CARDS,
    list.map((x) => (x.id === methodId ? { ...x, balance: Math.round((x.balance - amount) * 100) / 100 } : x))
  );
  wxPushBill(kind, -amount);
  return true;
}

/** 支付方式展示名（发送页支付方式行 / 支付密码验证浮层副标题用）；单聊/群聊共用 */
export function wxMethodLabel(methodId: string): string {
  if (methodId === 'balance') return `零钱（可用 ${fmtMoney(wxLoadBalance())} 元）`;
  if (methodId.startsWith('fcin-')) {
    const f = loadFamilyCardsIn().find((x) => x.id === methodId);
    return f ? `${f.fromName}的亲属卡（本月可用 ${fmtMoney(Math.max(0, f.monthlyLimit - f.used))} 元）` : '亲属卡';
  }
  const c = loadCards().find((x) => x.id === methodId);
  return c ? `${c.bank}（尾号${c.tail}）` : '支付方式';
}

/** 金额输入通用约束：最多 7 位整数 + 2 位小数（单聊/群聊共用） */
export function sanitizeAmount(v: string): string {
  return /^\d{0,7}(\.\d{0,2})?$/.test(v) ? v : v.slice(0, -1);
}

/** 完整时间：2026年09月07日 20:32:28（转账详情页用） */
/** 完整日期（2026年9月14日，不带时间；亲属卡领取时间等用） */
function fmtFullDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function fmtFullTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${p(d.getMonth() + 1)}月${p(d.getDate())}日 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 时间展示：今天 HH:mm / 昨天 / 周X / M/D */
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
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 聊天时间分隔（同微信）：今天 HH:mm / 昨天 HH:mm / 一周内 星期X HH:mm / 一周前 M月D日 HH:mm */
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

/** 手机号打码（同微信「个人资料」）：18300000033 → 183******33（前3后2，中间打码） */
function maskPhone(p: string | null): string {
  const digits = (p ?? '').replace(/\s/g, '');
  if (!digits) return '未绑定';
  if (digits.length < 7) return digits;
  return `${digits.slice(0, 3)}${'*'.repeat(Math.max(4, digits.length - 5))}${digits.slice(-2)}`;
}

/** 朋友圈时间：刚刚 / n分钟前 / HH:mm / 昨天 / M月D日 */
function fmtMomentsTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 新的朋友分组标签：今天 / 昨天 / n天前 / M月D日 */
function fmtReqDayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.floor((dayStart - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays <= 3) return `${diffDays}天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

const PINYIN_ANCHORS: Array<[string, string]> = [
  ['A', '阿'], ['B', '八'], ['C', '嚓'], ['D', '搭'], ['E', '蛾'], ['F', '发'], ['G', '噶'],
  ['H', '哈'], ['J', '击'], ['K', '喀'], ['L', '垃'], ['M', '妈'], ['N', '拿'], ['O', '哦'],
  ['P', '啪'], ['Q', '期'], ['R', '然'], ['S', '撒'], ['T', '塌'], ['W', '挖'], ['X', '昔'],
  ['Y', '压'], ['Z', '匝'],
];

/** 名字首字母分组：英文取首字母；中文按拼音锚点归组；其余进 # */
function initialOf(name: string): string {
  const ch = name.trim().charAt(0).toUpperCase();
  if (/[A-Z]/.test(ch)) return ch;
  if (/[\u4e00-\u9fff]/.test(name.trim().charAt(0))) {
    const c = name.trim().charAt(0);
    for (let i = PINYIN_ANCHORS.length - 1; i >= 0; i--) {
      if (c.localeCompare(PINYIN_ANCHORS[i][1], 'zh-Hans-CN-u-co-pinyin') >= 0) return PINYIN_ANCHORS[i][0];
    }
  }
  return '#';
}

/** AI 特殊消息标记 → 微信消息记录（红包/转账/亲属卡/位置/表情包；渲染与交互复用用户手动发送的同款卡片）。
 *  content 存可读摘要：进入 AI 上下文让角色知道自己发过什么；卡片渲染按 kind 走，不显示 content */
function richToWxMsg(rich: RichMsg, id: string, time: number, peer: ContactRecord): WxMsg {
  switch (rich.kind) {
    case 'redpacket':
      return { id, role: 'peer', content: '[微信红包]', time, kind: 'redpacket', rp: { amount: rich.amount, blessing: rich.blessing, opened: false } };
    case 'transfer':
      return { id, role: 'peer', content: '[转账]', time, kind: 'transfer', tr: { amount: rich.amount, note: rich.note, received: false } };
    case 'family':
      return {
        id,
        role: 'peer',
        content: '[亲属卡]',
        time,
        kind: 'family',
        fam: {
          monthlyLimit: rich.monthlyLimit,
          relation: peer.relation?.trim() || '家人',
          message: rich.message || '我为你准备了亲属卡，你消费我买单',
          claimed: false,
          used: 0,
        },
      };
    case 'location':
      return { id, role: 'peer', content: '[位置]', time, kind: 'location', loc: { name: rich.name, address: rich.coords || '地图上的一个位置' } };
    case 'sticker': {
      // parseRichParts 已保证 ID/意思能匹配上；取不到时兜底为文字
      const s = loadStickers('wx').find((x) => x.id === rich.stickerId);
      return s
        ? { id, role: 'peer', content: '', time, kind: 'sticker', stk: { url: s.url, meaning: s.meaning, sid: s.id } }
        : { id, role: 'peer', content: '[表情包]', time };
    }
  }
}

/** 联系人 AI 人设（微信聊天语境）：七要素结构化人设由全 App 共用模块组装，从联系人数据读取；
 *  特殊消息规则（红包/转账/亲属卡/位置/表情包标记）随表情包清单一起注入（表情包开关关闭时不下发表情包规则，
 *  并注入禁用 emoji/表情包的显式规则）；
 *  npcExtra：配角圈注入（CHAR=认识的配角/背景近况，NPC=归属者资料卡/背景近况） */
function buildPersonaPrompt(peer: ContactRecord, me: WxUser, ownerName: string | null, stickers: Sticker[], stickersOn: boolean, npcExtra?: NpcPromptExtra | null): string {
  return buildPersonaSystemPrompt(peer, {
    channel: '微信',
    userName: me.name,
    ownerName,
    ...npcExtra,
    extraRules: [
      '聊天记录中「[发送了表情：XX]」表示对方发来一张含义为「XX」的表情包，你要理解并自然回应表情的含义（可以调侃或接住情绪），不要字面复述括号内容。',
      ...buildRichRules(stickersOn ? stickers : []),
      ...(stickersOn ? [] : [STICKER_OFF_RULE]),
    ],
  });
}

/** 用户发给 AI 的红包/转账/亲属卡短 ID（AI 动作标记里引用；短小易抄写） */
function nextWxCid(prefix: 'rp' | 'tr' | 'fam'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36).slice(-3)}`;
}

/** 红包/转账/亲属卡消息的状态标签（卡片文案 + AI 上下文摘要共用） */
function wxCardStateLabel(m: WxMsg): string {
  if (m.kind === 'redpacket' && m.rp) {
    if (m.rp.status === 'returned') return '已退回';
    if (m.rp.status === 'rejected') return '已拒收';
    return m.rp.opened ? '已领取' : '待领取';
  }
  if (m.kind === 'transfer' && m.tr) {
    if (m.tr.status === 'returned') return '已退回';
    if (m.tr.status === 'rejected') return '已拒收';
    return m.tr.received ? '已收款' : '待收款';
  }
  if (m.kind === 'family' && m.fam) {
    if (m.fam.rejected) return '已退回';
    return m.fam.claimed ? '已领取' : '待领取';
  }
  return '';
}

/** 卡片是否已到终态（领取/收款/退还/拒收都算；终态后不可重复处理） */
function wxCardIsFinal(m: WxMsg): boolean {
  const label = wxCardStateLabel(m);
  return label !== '待领取' && label !== '待收款';
}

/** 收集「我发给 AI 的、待处理」的红包/转账/亲属卡（生成 system 待处理清单） */
function wxCollectPendingCards(msgs: WxMsg[]): PendingCardInfo[] {
  return msgs
    .filter((m) => m.role === 'me' && !wxCardIsFinal(m))
    .map<PendingCardInfo | null>((m) => {
      if (m.kind === 'redpacket' && m.rp) {
        return { id: m.rp.cid ?? m.id, kind: 'redpacket', amount: m.rp.amount, label: `祝福语"${m.rp.blessing}"` };
      }
      if (m.kind === 'transfer' && m.tr) {
        return { id: m.tr.cid ?? m.id, kind: 'transfer', amount: m.tr.amount, label: m.tr.note ? `备注"${m.tr.note}"` : '无备注' };
      }
      if (m.kind === 'family' && m.fam) {
        return { id: m.fam.cid ?? m.id, kind: 'family', amount: m.fam.monthlyLimit, label: `每月额度，${m.fam.message || '无留言'}` };
      }
      return null;
    })
    .filter((x): x is PendingCardInfo => x !== null);
}

/**
 * 应用 AI 的处理动作（领取/退回/拒收我发的红包/转账/收下/拒收亲属卡）：只处理「待处理」状态的目标（幂等），
 * 返回更新后的消息数组 + 动作产生的通知行/接收凭据卡（extras），由调用方按
 * 流式输出顺序插在动作发生位置。标记不带感谢语/理由，回应内容由 AI 人设正文承担。纯本地模拟：
 * 领取 → 记入领取人；退回 → 金额退回零钱（写账单）；亲属卡收下 → claimed + 存入「我收到的亲属卡」由调用方处理（这里只标记状态）。
 */
function wxApplyAiActions(
  actions: RichAction[],
  msgs: WxMsg[],
  peer: ContactRecord,
  timeBase = Date.now()
): { msgs: WxMsg[]; notices: WxMsg[]; extras: WxMsg[] } {
  const next = msgs.map((m) => ({ ...m }));
  const notices: WxMsg[] = [];
  const extras: WxMsg[] = [];
  const matchIdx = (a: RichAction): number =>
    next.findIndex(
      (m) =>
        m.role === 'me' &&
        ((m.kind === 'redpacket' && (m.rp?.cid === a.targetId || m.id === a.targetId)) ||
          (m.kind === 'transfer' && (m.tr?.cid === a.targetId || m.id === a.targetId)) ||
          (m.kind === 'family' && (m.fam?.cid === a.targetId || m.id === a.targetId)))
    );
  for (const a of actions) {
    const idx = matchIdx(a);
    if (idx < 0) continue;
    const m = next[idx];
    if (wxCardIsFinal(m)) continue; // 只处理待处理状态
    const verb = actionVerb(a.kind);
    const time = timeBase + notices.length + extras.length;
    if (m.kind === 'redpacket' && m.rp) {
      const rp = m.rp;
      if (verb === 'claim') {
        next[idx] = { ...m, content: `[微信红包]（${peer.name}已领取）`, rp: { ...rp, opened: true, openedAt: Date.now(), openedBy: peer.name } };
        notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'rp', pre: `${peer.name}领取了你的`, accent: '红包' } });
      } else if (verb === 'return') {
        next[idx] = { ...m, content: '[微信红包]（已退回）', rp: { ...rp, status: 'returned' } };
        wxPatchBalance(rp.amount, { kind: '红包', amount: rp.amount });
        notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'rp', pre: `${peer.name}退回了你的`, accent: '红包' } });
      } else {
        next[idx] = { ...m, content: '[微信红包]（已拒收）', rp: { ...rp, status: 'rejected' } };
        notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'rp', pre: `${peer.name}拒收了你的`, accent: '红包' } });
      }
    } else if (m.kind === 'transfer' && m.tr) {
      const tr = m.tr;
      if (verb === 'claim') {
        // AI 收款：原卡标记已收款 + receiptOf='me'（详情页显示「XX已收款」）+ 「已收款」接收凭据卡——
        // 凭据卡放 extras，由调用方插在动作发生位置（而不是旧代码里永远排在所有新消息之前）
        next[idx] = { ...m, content: '[转账]（已收款）', tr: { ...tr, received: true, receivedAt: Date.now(), receiptOf: 'me' as const } };
        extras.push({ id: uid(), role: 'peer', content: '', time, kind: 'transfer', tr: { amount: tr.amount, note: tr.note, received: true, receivedAt: Date.now(), receiptOf: 'me' } });
      } else if (verb === 'return') {
        // AI 退回我发的转账：原卡标记终态（变灰）+ 「对方」发出的退还凭据卡放 extras（灰卡↩+已退还，详情页「对方已退还」）
        const refundedAt = Date.now();
        next[idx] = { ...m, content: '[转账]（已退回）', tr: { ...tr, status: 'returned', refundedAt } };
        wxPatchBalance(tr.amount, { kind: '转账', amount: tr.amount });
        extras.push({
          id: uid(),
          role: 'peer',
          content: '',
          time,
          kind: 'transfer',
          tr: { amount: tr.amount, note: tr.note, received: false, status: 'returned' as const, refundedAt, originTime: m.time, refundedBy: 'peer' as const },
        });
      } else {
        next[idx] = { ...m, content: '[转账]（已拒收）', tr: { ...tr, status: 'rejected' } };
        notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'tr', pre: `${peer.name}拒收了你的`, accent: '转账' } });
      }
    } else if (m.kind === 'family' && m.fam) {
      const fam = m.fam;
      if (verb === 'claim') {
        next[idx] = { ...m, content: `[亲属卡]（${peer.name}已收下）`, fam: { ...fam, claimed: true, claimedAt: Date.now() } };
        // AI 收下亲属卡 → 同步存入「我收到的亲属卡」（钱包亲属卡页可见；发红包/转账可用它支付）
        const listIn = loadFamilyCardsIn();
        if (!listIn.some((f) => f.friendId === peer.id)) {
          saveFamilyCardsIn([
            ...listIn,
            {
              id: `fcin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
              friendId: peer.id,
              fromName: peer.name,
              fromAvatar: peer.avatar,
              relation: fam.relation,
              monthlyLimit: fam.monthlyLimit,
              used: 0,
              createdAt: Date.now(),
            },
          ]);
        }
        notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'fam', pre: `${peer.name}收下了你的`, accent: '亲属卡' } });
      } else {
        next[idx] = { ...m, content: '[亲属卡]（已退回）', fam: { ...fam, rejected: true } };
        notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'fam', pre: `${peer.name}拒收了你的`, accent: '亲属卡' } });
      }
    } else {
      continue;
    }
  }
  return { msgs: next, notices, extras };
}

/** 读取用户选择的图片：压缩为最长边 max（默认 720，背景图传 1280）px 的 JPEG dataURL；
 *  GIF 动图直通原始 dataURL（canvas 重绘会丢帧变静态图）；群聊发图复用同一套压缩逻辑 */
export function readImageFile(file: File, max = 720): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.onload = () => {
      const result = String(reader.result);
      // GIF 动图直通：不经 canvas（重绘会只保留第一帧）
      if (file.type === 'image/gif' || /^data:image\/gif/i.test(result)) {
        resolve(result);
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        try {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('图片处理失败'));
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        } catch {
          reject(new Error('图片处理失败'));
        }
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------------- 通用小部件 ----------------

/** 微信行内图标方块（功能行用） */
function WxTileIcon({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <div
      className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[8px] text-white shadow-sm"
      style={{ backgroundColor: bg }}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

/** 头像：微信风格「正方形圆角」（有图用图，无图用灰底剪影，绝不出现在圆形） */
export function WxAvatar({ src, alt, size = 44 }: { src: string | null; alt: string; size?: number }) {
  const radius = Math.max(4, Math.round(size * 0.11));
  const style: React.CSSProperties = { width: size, height: size, borderRadius: radius };
  if (src) {
    return <img src={src} alt={alt} className="shrink-0 bg-muted object-cover" style={style} />;
  }
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center bg-[#C9C9CE] text-white dark:bg-[#3C3C42]"
      style={style}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: size * 0.6, height: size * 0.6 }}>
        <circle cx="12" cy="8.2" r="4.3" />
        <path d="M12 14.1c-4.7 0-8.1 2.7-8.1 6.3 0 .9.7 1.6 1.6 1.6h13c.9 0 1.6-.7 1.6-1.6 0-3.6-3.4-6.3-8.1-6.3z" />
      </svg>
    </div>
  );
}

/** 微信风格功能行：白色卡片内，分隔线与文字对齐（左缩进 66px） */
function WxMenuRow({
  label,
  icon,
  onClick,
  first = false,
  right,
  redDot = false,
  testId,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  first?: boolean;
  right?: React.ReactNode;
  redDot?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="relative flex w-full items-center gap-3 px-4 py-[11px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
    >
      {!first && <span className="absolute left-[66px] right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />}
      {icon}
      <span className="min-w-0 flex-1 truncate text-[16px]">{label}</span>
      {redDot && <span className="mr-0.5 h-2 w-2 shrink-0 rounded-full bg-[#FA5151]" aria-hidden="true" />}
      {right ?? <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />}
    </button>
  );
}

/** 「···」更多图标（微信风格） */
function EllipsisGlyph() {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden="true">
      <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
      <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
      <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
    </span>
  );
}

/** 语音声波图标（聊天输入栏左侧圆钮用，单色细线：一个点 + 三道声波弧） */
function VoiceWaveGlyph({ size = 19 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="6.2" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <path d="M10.3 9.3a5.2 5.2 0 0 1 0 5.4" />
      <path d="M13.5 7a8.8 8.8 0 0 1 0 10" />
      <path d="M16.7 4.7a12.6 12.6 0 0 1 0 14.6" />
    </svg>
  );
}

/** 伪二维码（确定性花纹，种子 = 微信号）：加我微信的名片码 */
function PseudoQR({ seed, size = 176 }: { seed: string; size?: number }) {
  const { cells, n } = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const rand = () => {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      return (h >>> 0) / 4294967296;
    };
    const n = 25;
    const inFinder = (r: number, c: number) => (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8);
    const cells: boolean[][] = [];
    for (let r = 0; r < n; r++) {
      cells[r] = [];
      for (let c = 0; c < n; c++) cells[r][c] = !inFinder(r, c) && rand() > 0.52;
    }
    return { cells, n };
  }, [seed]);
  const s = size / n;
  const finder = (x: number, y: number, key: string) => (
    <g key={key}>
      <rect x={x * s} y={y * s} width={7 * s} height={7 * s} rx={s} fill="currentColor" />
      <rect x={(x + 1) * s} y={(y + 1) * s} width={5 * s} height={5 * s} rx={s * 0.55} fill="#fff" />
      <rect x={(x + 2) * s} y={(y + 2) * s} width={3 * s} height={3 * s} rx={s * 0.35} fill="currentColor" />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="text-[#07C160]" aria-hidden="true">
      {cells.flatMap((row, r) =>
        row.map((on, c) =>
          on ? (
            <rect key={`${r}-${c}`} x={c * s + s * 0.12} y={r * s + s * 0.12} width={s * 0.76} height={s * 0.76} rx={s * 0.16} fill="currentColor" />
          ) : null
        )
      )}
      {finder(0, 0, 'tl')}
      {finder(n - 7, 0, 'tr')}
      {finder(0, n - 7, 'bl')}
    </svg>
  );
}

// ---------------- 登录页 ----------------

function LoginScreen({ onLogin }: { onLogin: (u: WxUser) => void }) {
  const closeApp = useUI((s) => s.closeApp);
  // mode phone：手机号 + 微信密码；account：微信号 / QQ号 / 邮箱 + 密码（后端自动识别）
  const [mode, setMode] = useState<'phone' | 'account'>('phone');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = account.trim().length > 0 && password.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      // 本地校验：联系人存本地 IndexedDB，不再调服务端
      const rec = await loginWechat(mode === 'phone' ? 'phone' : 'wechat', account.trim(), password);
      if (rec.ok) {
        onLogin({
          id: rec.user.id,
          name: rec.user.name,
          avatar: rec.user.avatar,
          wechatId: rec.user.wechatId,
          phone: rec.user.phone,
          qqId: rec.user.qqId,
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

  return (
    <div className="flex h-full w-full flex-col bg-[#EDEDED] pt-[54px] text-black dark:bg-[#111111] dark:text-white">
      {/* 顶部关闭 */}
      <div className="flex h-11 items-center px-4">
        <button
          type="button"
          aria-label="关闭微信"
          data-testid="wx-login-close"
          onClick={closeApp}
          className="-ml-1 rounded-full p-1.5 active:bg-black/5"
        >
          <X className="h-6 w-6" strokeWidth={1.8} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-7">
        <h1 className="mt-8 text-center text-[26px] font-semibold tracking-wide">
          {mode === 'phone' ? '手机号登录' : '微信账号登录'}
        </h1>

        <div className="mt-10 space-y-0">
          {mode === 'phone' && (
            <div className="flex h-14 items-center border-b border-black/10 dark:border-white/10">
              <span className="w-[104px] shrink-0 text-[17px]">国家/地区</span>
              <span className="text-[17px] text-black/45 dark:text-white/45">中国大陆（+86）</span>
            </div>
          )}
          <div className="flex h-14 items-center border-b border-black/10 dark:border-white/10">
            <span className="w-[104px] shrink-0 text-[17px]">{mode === 'phone' ? '手机号' : '账号'}</span>
            <input
              data-testid="wx-login-account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={mode === 'phone' ? '请填写手机号码' : '微信号 / QQ号 / 邮箱'}
              autoCapitalize="off"
              autoCorrect="off"
              className="h-full w-full bg-transparent text-[17px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
          </div>
          <div className="flex h-14 items-center border-b border-black/10 dark:border-white/10">
            <span className="w-[104px] shrink-0 text-[17px]">密码</span>
            <input
              data-testid="wx-login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              placeholder={mode === 'phone' ? '请填写微信密码' : '请填写密码'}
              className="h-full w-full bg-transparent text-[17px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
          </div>
        </div>

        {mode === 'phone' && (
          <p className="mt-3 text-[13px] text-black/35 dark:text-white/35">上述手机号仅用于登录验证</p>
        )}

        <button
          type="button"
          data-testid="wx-login-switch"
          onClick={() => {
            setMode(mode === 'phone' ? 'account' : 'phone');
            setError('');
          }}
          className="mt-3 text-[15px] font-medium text-[#576B95] active:opacity-60"
        >
          {mode === 'phone' ? '用微信号/QQ号/邮箱登录' : '用手机号登录'}
        </button>

        {error && (
          <p data-testid="wx-login-error" className="mt-4 text-center text-[13px] text-red-500">
            {error}
          </p>
        )}

        <button
          type="button"
          data-testid="wx-login-submit"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className={`mx-auto mt-10 block h-[46px] w-full max-w-[300px] rounded-[8px] text-[17px] font-medium transition-colors ${
            canSubmit
              ? 'bg-[#07C160] text-white active:bg-[#06AD56]'
              : 'bg-black/10 text-black/35 dark:bg-white/10 dark:text-white/35'
          }`}
        >
          {busy ? '正在登录…' : '同意并继续'}
        </button>
      </div>

      <div className="flex items-center justify-center gap-4 pb-8 pt-4 text-[15px] text-[#576B95]">
        <button type="button" className="active:opacity-60" onClick={() => setError('密码找回暂未开放，请到「联系人」App 查看账号密码')}>
          找回密码
        </button>
        <span className="h-3.5 w-px bg-black/15 dark:bg-white/15" />
        <span className="text-black/40 dark:text-white/40">更多</span>
      </div>
    </div>
  );
}

// ---------------- 位置 + 亲属卡聊天卡片 ----------------

/** 位置页内置地点（点击直接发送位置卡片） */
const WX_LOCATIONS: Array<{ name: string; address: string }> = [
  { name: '广州塔', address: '广东省广州市海珠区阅江西路222号' },
  { name: '天安门广场', address: '北京市东城区东长安街' },
  { name: '外滩', address: '上海市黄浦区中山东一路' },
  { name: '深圳湾公园', address: '广东省深圳市南山区滨海大道' },
  { name: '西湖风景区', address: '浙江省杭州市西湖区龙井路1号' },
  { name: '春熙路', address: '四川省成都市锦江区' },
];

/** 简易地图艺术块（位置卡片 / 位置页 / 位置详情复用：米色底 + 道路线网 + 绿地水域 + 红色定位针） */
function LocMapArt({ className = '', pinSize = 22 }: { className?: string; pinSize?: number }) {
  return (
    <span className={`relative block overflow-hidden bg-[#EAE7DE] dark:bg-[#26261F] ${className}`} aria-hidden="true">
      <span className="absolute left-0 top-[38%] h-[7px] w-full bg-white/90 dark:bg-white/15" />
      <span className="absolute left-[30%] top-0 h-full w-[6px] bg-white/90 dark:bg-white/15" />
      <span className="absolute left-[-10%] top-[8%] h-[4px] w-[75%] rotate-[24deg] bg-white/60 dark:bg-white/10" />
      <span className="absolute left-[42%] top-[30%] h-[4px] w-[70%] rotate-[38deg] bg-[#F6D98A]/80 dark:bg-[#5A5142]" />
      <span className="absolute left-[8%] top-[62%] h-[5px] w-[60%] rotate-[-16deg] bg-white/60 dark:bg-white/10" />
      <span className="absolute right-[6%] top-[8%] h-[26%] w-[22%] rounded-[6px] bg-[#CDE3C1]/80 dark:bg-[#2C3526]" />
      <span className="absolute bottom-[8%] left-[6%] h-[22%] w-[20%] rounded-[6px] bg-[#BFD9EA]/80 dark:bg-[#22303A]" />
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
        <span
          className="relative block rotate-45 rounded-full rounded-br-full bg-[#E64340] shadow-[0_2px_4px_rgba(0,0,0,0.28)]"
          style={{ width: pinSize, height: pinSize }}
        >
          <span className="absolute inset-[26%] rounded-full bg-white" />
        </span>
      </span>
    </span>
  );
}

/** 亲属卡黄色圆标（白色卡片 + 环绕轨道 + 小心，对照微信亲属卡图标） */
function FamGlyph({ size = 42 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: 'linear-gradient(180deg, #FFCE43, #F5B000)' }}
      aria-hidden="true"
    >
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none">
        <rect x="5.8" y="8.4" width="12" height="8" rx="1.5" transform="rotate(-14 11.8 12.4)" fill="#fff" />
        <path d="M3 12.8c1.1 3.7 6.2 6.3 11.6 5.4 4.3-.7 7.2-3.2 7.5-6.2" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
        <path
          d="M19.1 3.4c.42-.5 1.22-.5 1.64 0 .42-.5 1.22-.5 1.64 0 .48.55.34 1.4-.24 1.9l-1.4 1.2-1.4-1.2c-.58-.5-.72-1.35-.24-1.9z"
          fill="#fff"
        />
      </svg>
    </span>
  );
}

/** 亲属卡聊天卡片（图①：白底 + 黄圆图标 + 「给C的亲属卡/待对方领取」+ 右侧淡黄星球轨道装饰 + 左下「亲属卡」；领取/退回后卡片颜色变灰） */
function FamilyBubble({ title, sub, settled, onClick }: { title: string; sub: string; settled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="wx-fc-bubble"
      onClick={onClick}
      className="relative block w-[206px] overflow-hidden rounded-[10px] bg-white text-left shadow-sm transition-all duration-300 active:brightness-[0.97] dark:bg-[#1E1E1E]"
      style={{ filter: settled ? 'grayscale(0.62) brightness(0.97)' : undefined }}
      aria-label={`${title}（${sub}）`}
    >
      <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-[#FBF0C4] dark:bg-[#3B3722]" />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-3 top-4 h-[82px] w-[150px] -rotate-[24deg] rounded-[50%] border-[3px] border-[#F6DFA2] dark:border-[#4A4426]"
      />
      <span className="relative flex items-center gap-2.5 px-3 pb-1.5 pt-3">
        <FamGlyph size={42} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-medium leading-snug text-[#574423] dark:text-[#E6D6AE]" data-testid="wx-fc-bubble-title">
            {title}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-[#BCA678] dark:text-[#9A8B62]" data-testid="wx-fc-bubble-status">
            {sub}
          </span>
        </span>
      </span>
      <span className="relative block px-3 pb-2 pt-2 text-[12px] text-black/30 dark:text-white/30">亲属卡</span>
    </button>
  );
}

/** 位置聊天卡片（微信同款：上部名称/地址白底 + 下方小地图 + 红色定位针；群聊复用同一套组件） */
export function LocBubble({ name, address, onClick }: { name: string; address: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="wx-loc-bubble"
      onClick={onClick}
      className="block w-[206px] overflow-hidden rounded-[8px] bg-white text-left shadow-sm active:brightness-95 dark:bg-[#1E1E1E]"
    >
      <span className="block px-3 pb-2 pt-2.5">
        <span className="block truncate text-[15px] leading-snug">{name}</span>
        <span className="mt-0.5 block truncate text-[12px] text-black/40 dark:text-white/40">{address}</span>
      </span>
      <LocMapArt className="h-[64px] w-full" pinSize={24} />
    </button>
  );
}

/** 图片消息气泡（圆角直出，点开全屏预览）：中等尺寸（用户反馈过大 → 从 250×330 收敛）。
 *  img 用固定像素上限（max-w/max-h 均为绝对值，按比例缩放互不冲突；百分比在 flex 包裹层内会循环解析导致尺寸失真）；群聊复用同一套组件 */
export function ImageMsgBubble({ src, onClick }: { src: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="wx-img-bubble"
      onClick={onClick}
      className="block overflow-hidden rounded-[6px] active:opacity-80"
    >
      <img src={src} alt="图片消息" className="block max-h-[220px] w-auto min-w-[110px] max-w-[168px] object-cover" loading="lazy" />
    </button>
  );
}

/** 位置页（大地图 + 内置地点列表 + 自定义位置；选中即发送位置卡片；群聊复用同一套组件） */
export function LocationPickerPage({
  onClose,
  onSend,
  onToast,
}: {
  onClose: () => void;
  onSend: (name: string, address: string) => void;
  onToast: (m: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const submitCustom = () => {
    const n = name.trim();
    if (!n) {
      onToast('请输入位置名称');
      return;
    }
    onSend(n, address.trim() || n);
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-loc-picker">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-loc-back" onClick={onClose} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 text-center text-[17px] font-medium">{custom ? '自定义位置' : '位置'}</div>
          <span className="w-[46px]" />
        </div>
      </div>
      {custom ? (
        <div className="min-h-0 flex-1 px-4 pt-4">
          <div className="rounded-[10px] bg-white px-4 dark:bg-[#1A1A1A]">
            <input
              data-testid="wx-loc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="位置名称"
              autoFocus
              className="h-[52px] w-full border-b border-black/[0.06] bg-transparent text-[16px] outline-none placeholder:text-black/30 dark:border-white/[0.08] dark:placeholder:text-white/30"
            />
            <input
              data-testid="wx-loc-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="详细地址（可选）"
              className="h-[52px] w-full bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
          </div>
          <button
            type="button"
            data-testid="wx-loc-send"
            onClick={submitCustom}
            className="mt-6 h-12 w-full rounded-[8px] bg-[#07C160] text-[16px] font-medium text-white active:bg-[#06AD56]"
          >
            发送位置
          </button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pb-6">
          <LocMapArt className="mx-4 mt-3 h-[170px] rounded-[10px]" pinSize={34} />
          <div className="mt-3 bg-white dark:bg-[#1A1A1A]">
            {WX_LOCATIONS.map((l, i) => (
              <button
                key={l.name}
                type="button"
                data-testid={`wx-loc-item-${i}`}
                onClick={() => onSend(l.name, l.address)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                  i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.07]' : ''
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px]">{l.name}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-black/40 dark:text-white/40">{l.address}</span>
                </span>
                <MapPin className="h-[18px] w-[18px] shrink-0 text-[#E64340]" strokeWidth={1.8} />
              </button>
            ))}
          </div>
          <button
            type="button"
            data-testid="wx-loc-custom"
            onClick={() => setCustom(true)}
            className="mt-3 flex w-full items-center justify-between bg-white px-4 py-3.5 text-left text-[16px] active:bg-black/[0.04] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
          >
            自定义位置
            <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}

/** 位置详情页（点聊天中的位置卡片进入：大地图 + 名称地址；群聊复用同一套组件） */
export function LocViewLayer({ name, address, onClose }: { name: string; address: string; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-loc-view">
      <div className="flex h-12 shrink-0 items-center px-2 pt-[54px]">
        <button type="button" aria-label="关闭" data-testid="wx-loc-view-close" onClick={onClose} className="active:opacity-60">
          <ChevronLeft className="h-7 w-7" strokeWidth={2} />
        </button>
        <div className="flex-1 text-center text-[16px] font-medium">位置</div>
        <span className="w-[46px]" />
      </div>
      <div className="min-h-0 flex-1 px-4 pt-3">
        <LocMapArt className="h-[44vh] rounded-[10px]" pinSize={40} />
        <div className="mt-3 rounded-[10px] bg-white px-4 py-3 dark:bg-[#1A1A1A]">
          <p className="text-[17px]">{name}</p>
          <p className="mt-1 text-[13px] text-black/45 dark:text-white/45">{address}</p>
        </div>
      </div>
    </div>
  );
}

/** 表情消息气泡（点开全屏预览 + 意思提示；群聊复用同一套组件） */
export function StickerMsgBubble({ src, meaning, onClick }: { src: string; meaning: string; onClick: () => void }) {
  return (
    <button type="button" data-testid="wx-sticker-bubble" onClick={onClick} className="block active:opacity-80" title={meaning || '表情'}>
      <img
        src={src}
        alt={meaning ? `表情：${meaning}` : '表情'}
        className="max-h-[110px] w-auto max-w-[118px] rounded-[10px] object-contain"
        loading="lazy"
      />
    </button>
  );
}

/** 表情添加表单（面板与管理页共用渲染逻辑抽出的内部组件） */
function StickerAddForm({
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
            className={`h-8 rounded-full px-4 text-[13px] ${tab === k ? 'bg-[#07C160] text-white' : 'bg-black/[0.05] text-black/60 dark:bg-white/10 dark:text-white/60'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'file' ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mt-3 flex h-[96px] w-full items-center justify-center overflow-hidden rounded-[10px] border border-dashed border-black/20 bg-white text-[13px] text-black/40 active:bg-black/[0.03] dark:border-white/20 dark:bg-[#1A1A1A] dark:text-white/40"
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
          className="mt-3 h-[46px] w-full rounded-[10px] border border-black/[0.08] bg-white px-3 text-[14px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-[#1A1A1A] dark:placeholder:text-white/30"
        />
      )}
      <input
        value={meaning}
        onChange={(e) => onMeaning(e.target.value)}
        placeholder="表情的意思（AI 会据此理解并回复）"
        maxLength={20}
        className="mt-2 h-[44px] w-full rounded-[10px] border border-black/[0.08] bg-white px-3 text-[14px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-[#1A1A1A] dark:placeholder:text-white/30"
      />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          className="h-10 flex-1 rounded-[8px] bg-[#07C160] text-[15px] font-medium text-white active:bg-[#06AD56]"
        >
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-10 rounded-[8px] bg-black/[0.05] px-5 text-[15px] text-black/60 active:bg-black/[0.09] dark:bg-white/10 dark:text-white/60"
        >
          取消
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { onPickFile(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

/** 聊天表情面板（表情按钮弹出：网格点选发送 + 内嵌添加[手机图片/URL+意思] + 管理删除） */
export function WxStickerPanel({
  onPick,
  onClose,
  onToast,
}: {
  onPick: (s: Sticker) => void;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [list, setList] = useState<Sticker[]>(() => loadStickers('wx'));
  const [mode, setMode] = useState<'grid' | 'add'>('grid');
  const [tab, setTab] = useState<'file' | 'url'>('file');
  const [editMode, setEditMode] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [draftUrl, setDraftUrl] = useState('');
  const [draftMeaning, setDraftMeaning] = useState('');

  const commit = (next: Sticker[]) => {
    setList(next);
    saveStickers('wx', next);
  };
  const pickFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    try {
      setPreview(await readImageFile(f, 240));
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

  /** 长按表情 → 预览卡（真微信同款：大图 + 名称 + 删除/取消），无需进管理模式即可删除 */
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
      className="relative shrink-0 border-t border-black/[0.05] bg-[#F7F7F7] dark:border-white/[0.06] dark:bg-[#161616]"
      data-testid="wx-sticker-panel"
    >
      <div className="flex items-center justify-between px-4 pb-1 pt-2.5">
        <p className="text-[15px] font-medium">表情</p>
        <div className="flex items-center gap-4">
          {mode === 'grid' && list.length > 0 && (
            <button
              type="button"
              data-testid="wx-sticker-panel-manage"
              onClick={() => setEditMode((v) => !v)}
              className="text-[13px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
            >
              {editMode ? '完成' : '管理'}
            </button>
          )}
          <button type="button" aria-label="收起表情面板" onClick={onClose} className="text-black/40 active:opacity-60 dark:text-white/40">
            <ChevronLeft className="h-5 w-5 -rotate-90" strokeWidth={2} />
          </button>
        </div>
      </div>
      {mode === 'grid' ? (
        <div className="h-[280px] overflow-y-auto px-3 pb-4 pt-1">
          <div className="grid grid-cols-4 gap-2">
            {list.map((s, i) => (
              <div key={s.id} className="relative">
                <button
                  type="button"
                  data-testid={`wx-sticker-panel-item-${i}`}
                  onClick={() => {
                    if (suppressPickRef.current) {
                      suppressPickRef.current = false;
                      return;
                    }
                    if (!editMode) onPick(s);
                  }}
                  onPointerDown={onStickerPointerDown(s)}
                  onPointerMove={onStickerPointerMove}
                  onPointerUp={clearStickerPress}
                  onPointerCancel={clearStickerPress}
                  onPointerLeave={clearStickerPress}
                  className="aspect-square w-full overflow-hidden rounded-[10px] p-1.5 active:bg-black/[0.05]"
                  title={s.meaning || '表情'}
                >
                  <img src={s.url} alt={s.meaning || '表情'} className="h-full w-full object-contain" loading="lazy" />
                </button>
                <button
                  type="button"
                  data-testid={`wx-sticker-meaning-${i}`}
                  onClick={() => setMeaningFor(s)}
                  className="mt-0.5 block h-4 w-full truncate text-center text-[10px] leading-4 text-black/40 active:opacity-60 dark:text-white/40"
                >
                  {s.meaning || '＋意思'}
                </button>
                {editMode && (
                  <button
                    type="button"
                    aria-label="删除表情"
                    data-testid={`wx-sticker-panel-del-${i}`}
                    onClick={() => commit(list.filter((x) => x.id !== s.id))}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#FA5151] text-[11px] font-semibold text-white shadow"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              data-testid="wx-sticker-panel-add"
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
          <StickerAddForm
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
          testPrefix="wx"
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

      {/* 长按表情预览卡（真微信同款：白卡大图 + 名称 + 红色删除；点遮罩取消） */}
      {pressSticker && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/45"
          data-testid="wx-sticker-preview"
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
              data-testid="wx-sticker-preview-del"
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

/** 表情管理页（「我」→表情：网格管理 + 单张编辑[改意思/删除] + 批量导入手机图片 + URL 添加自动识别意思） */
function WxStickersPage({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  const [list, setList] = useState<Sticker[]>(() => loadStickers('wx'));
  const [editing, setEditing] = useState<Sticker | null>(null);
  const [editMeaning, setEditMeaning] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchDraftItem[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);

  const commit = (next: Sticker[]) => {
    setList(next);
    saveStickers('wx', next);
  };

  /** FileList → 批量草稿项（压缩预览 + 默认名：文件名中文优先，否则文件名去扩展名） */
  const filesToDrafts = async (files: FileList): Promise<BatchDraftItem[]> => {
    const drafts: BatchDraftItem[] = [];
    for (const f of Array.from(files)) {
      try {
        const url = await readImageFile(f, 240);
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

  const saveEdit = () => {
    if (!editing) return;
    commit(list.map((s) => (s.id === editing.id ? { ...s, meaning: editMeaning.trim() } : s)));
    setEditing(null);
    onToast('已保存');
  };

  /** 右上角「管理」：进入删除模式，点表情上的红色 × 直接删除（再点完成退出） */
  const [delMode, setDelMode] = useState(false);
  const delSticker = (s: Sticker) => {
    commit(list.filter((x) => x.id !== s.id));
    onToast('已删除表情');
    if (list.length <= 1) setDelMode(false);
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-stickers-page">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-stickers-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 text-center text-[17px] font-medium">表情</div>
          {list.length > 0 ? (
            <button
              type="button"
              data-testid="wx-stickers-manage"
              onClick={() => setDelMode((v) => !v)}
              className="w-[46px] text-center text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
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
            {list.map((s, i) => (
              <button
                key={s.id}
                type="button"
                data-testid={`wx-stickers-item-${i}`}
                onClick={() => {
                  if (delMode) {
                    delSticker(s);
                    return;
                  }
                  setEditing(s);
                  setEditMeaning(s.meaning);
                }}
                className="relative rounded-[12px] p-1 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <span className="flex aspect-square items-center justify-center overflow-hidden rounded-[8px]">
                  <img src={s.url} alt={s.meaning || '表情'} className="h-full w-full object-contain" loading="lazy" />
                </span>
                <span className="mt-1.5 block truncate text-[12px] text-black/55 dark:text-white/55">{s.meaning || '点此写意思'}</span>
                {delMode && (
                  <span
                    aria-hidden="true"
                    data-testid={`wx-stickers-del-${i}`}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#FA5151] text-[11px] font-semibold text-white shadow"
                  >
                    ×
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-black/[0.05] bg-white px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 dark:border-white/[0.06] dark:bg-[#1A1A1A]">
        <div className="flex gap-3">
          <button
            type="button"
            data-testid="wx-stickers-upload"
            onClick={() => uploadRef.current?.click()}
            className="h-11 flex-1 rounded-[8px] bg-[#07C160] text-[15px] font-medium text-white active:bg-[#06AD56]"
          >
            从手机添加（可批量）
          </button>
          <button
            type="button"
            data-testid="wx-stickers-add-url"
            onClick={() => setBatchOpen(true)}
            className="h-11 rounded-[8px] bg-black/[0.06] px-5 text-[15px] text-black/70 active:bg-black/[0.1] dark:bg-white/10 dark:text-white/70"
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
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/45" onClick={() => setEditing(null)} data-testid="wx-stickers-edit">
          <div className="rounded-t-[14px] bg-[#EDEDED] px-4 pb-8 pt-4 dark:bg-[#1C1C1C]" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex h-[110px] w-[110px] items-center justify-center overflow-hidden rounded-[12px] bg-white p-2 dark:bg-[#1A1A1A]">
              <img src={editing.url} alt={editing.meaning || '表情'} className="h-full w-full object-contain" />
            </div>
            <input
              value={editMeaning}
              onChange={(e) => setEditMeaning(e.target.value)}
              maxLength={20}
              placeholder="表情的意思（AI 会据此理解并回复）"
              data-testid="wx-stickers-edit-meaning"
              className="h-[46px] w-full rounded-[10px] border border-black/[0.08] bg-white px-3 text-[15px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-[#1A1A1A] dark:placeholder:text-white/30"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                data-testid="wx-stickers-edit-del"
                onClick={() => {
                  commit(list.filter((x) => x.id !== editing.id));
                  setEditing(null);
                  onToast('已删除');
                }}
                className="h-11 rounded-[8px] bg-[#FA5151]/10 px-5 text-[15px] text-[#FA5151] active:bg-[#FA5151]/20 dark:bg-[#FA5151]/20"
              >
                删除
              </button>
              <button
                type="button"
                data-testid="wx-stickers-edit-save"
                onClick={saveEdit}
                className="h-11 flex-1 rounded-[8px] bg-[#07C160] text-[15px] font-medium text-white active:bg-[#06AD56]"
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
        testPrefix="wx"
      />
    </div>
  );
}

/** 亲属卡领取页（图②：好友发我的——对方名 + 赠语 + 每月额度 + 说明 + 黄卡「X送的亲属卡」 + 对方头像 + 领取/退还按钮 + 财付通脚注） */
function WxFcClaimPage({
  peerName,
  peerAvatar,
  limit,
  message,
  claimed,
  claimedAt,
  rejected,
  onBack,
  onClaim,
  onRefund,
  onToast,
}: {
  peerName: string;
  peerAvatar: string | null;
  limit: number;
  message: string;
  claimed: boolean;
  claimedAt?: number;
  /** 被退还/拒收（终态，显示已退回） */
  rejected?: boolean;
  onBack: () => void;
  onClaim: () => void;
  /** 退还（拒收）该亲属卡 */
  onRefund: () => void;
  onToast: (m: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-fc-claim">
      <div className="flex h-12 shrink-0 items-center px-2 pt-[54px]">
        <button type="button" aria-label="返回" data-testid="wx-fc-claim-back" onClick={onBack} className="active:opacity-60">
          <ChevronLeft className="h-7 w-7" strokeWidth={2} />
        </button>
        <div className="flex-1 text-center text-[17px] font-medium">亲属卡</div>
        <span className="w-[46px]" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2">
        <p className="mt-8 text-[26px] font-medium" data-testid="wx-fc-claim-name">
          {peerName}
        </p>
        <p className="mt-7 text-[16px] leading-relaxed">{message}</p>
        <p className="mt-2 text-[16px]" data-testid="wx-fc-claim-limit">
          每月可用额度¥{fmtMoney(limit)}
        </p>
        {rejected ? (
          <p className="mt-3 text-[13px] text-black/45 dark:text-white/45" data-testid="wx-fc-claim-rejected">已退回该亲属卡</p>
        ) : claimed && typeof claimedAt === 'number' ? (
          <p className="mt-3 text-[13px] text-[#06AE56]" data-testid="wx-fc-claim-done">
            已于 {fmtFullDate(claimedAt)} 领取
          </p>
        ) : null}
        <p className="mt-6 text-[13px] leading-relaxed text-black/40 dark:text-white/40">
          领取后优先使用该卡支付，赠送方承担费用并收到通知，1天内未领取则自动作废。
          <button type="button" onClick={() => onToast('使用说明暂未开放')} className="text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]">
            使用说明
          </button>
        </p>
        <div
          className="relative mt-6 overflow-hidden rounded-[10px] px-4 py-4"
          style={{ background: 'linear-gradient(135deg, #FDF3CE 0%, #FAE7A8 100%)' }}
          data-testid="wx-fc-claim-card"
        >
          <span aria-hidden="true" className="pointer-events-none absolute -right-8 -top-12 h-32 w-32 rounded-full bg-[#F7E39A]/70" />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-2 top-6 h-[64px] w-[120px] -rotate-[22deg] rounded-[50%] border-[3px] border-[#EFCE74]/80"
          />
          <div className="relative flex items-center gap-3">
            <FamGlyph size={40} />
            <span className="text-[17px] font-medium text-[#C08A3A]">{peerName}送的亲属卡</span>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2.5 pb-4">
          <WxAvatar src={peerAvatar} alt={peerName} size={44} />
          <span className="text-[15px]">{peerName}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center px-5 pb-7">
        {rejected ? (
          <div className="w-[68%] rounded-[8px] bg-white py-3.5 text-center text-[17px] text-black/30 dark:text-white/30" data-testid="wx-fc-claim-btn">
            已退回
          </div>
        ) : claimed ? (
          <div className="w-[68%] rounded-[8px] bg-white py-3.5 text-center text-[17px] text-black/30 dark:text-white/30" data-testid="wx-fc-claim-btn">
            已领取
          </div>
        ) : (
          <div className="flex w-[68%] flex-col gap-2.5">
            <button
              type="button"
              data-testid="wx-fc-claim-btn"
              onClick={onClaim}
              className="rounded-[8px] bg-white py-3.5 text-center text-[17px] text-[#06AE56] shadow-sm active:bg-black/[0.03]"
            >
              领取
            </button>
            <button
              type="button"
              data-testid="wx-fc-refund-btn"
              onClick={onRefund}
              className="rounded-[8px] bg-white py-3.5 text-center text-[17px] text-black/55 shadow-sm active:bg-black/[0.03] dark:text-white/60"
            >
              退还
            </button>
          </div>
        )}
        <p className="mt-8 text-[13px] text-black/30 dark:text-white/30">本服务由财付通提供</p>
      </div>
    </div>
  );
}

/** 亲属卡管理详情页（图③：我送的——对方头像 + 本月已用 + 每月消费上限[修改] + 对方领取时间 + 优先扣款方式 + 消费记录） */
function WxFcManagePage({
  peerName,
  peerAvatar,
  limit,
  used,
  claimed,
  claimedAt,
  method,
  onBack,
  onEditLimit,
  onPickMethod,
  onToast,
}: {
  peerName: string;
  peerAvatar: string | null;
  limit: number;
  used: number;
  claimed: boolean;
  claimedAt?: number;
  method: string;
  onBack: () => void;
  onEditLimit: (v: number) => void;
  onPickMethod: (m: string) => void;
  onToast: (m: string) => void;
}) {
  const [limitSheet, setLimitSheet] = useState(false);
  const [methodSheet, setMethodSheet] = useState(false);
  const [draft, setDraft] = useState('');
  const cards = loadCards();
  const monthLabel = `${new Date().getMonth() + 1}月`;
  const saveLimit = () => {
    const n = Number(draft);
    if (!draft || Number.isNaN(n) || n <= 0) {
      onToast('请输入正确的金额');
      return;
    }
    onEditLimit(Math.round(n * 100) / 100);
    setLimitSheet(false);
  };
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-fc-detail">
      <div className="flex h-12 shrink-0 items-center px-2 pt-[54px]">
        <button type="button" aria-label="返回" data-testid="wx-fc-detail-back" onClick={onBack} className="active:opacity-60">
          <ChevronLeft className="h-7 w-7" strokeWidth={2} />
        </button>
        <div className="flex-1" />
        <button type="button" aria-label="更多" onClick={() => onToast('更多功能暂未开放')} className="px-3 active:opacity-60">
          <EllipsisGlyph />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center px-8 pt-5">
          <WxAvatar src={peerAvatar} alt={peerName} size={72} />
          <p className="mt-5 text-center text-[16px]" data-testid="wx-fc-detail-title">
            给{peerName}的亲属卡，本月已用额度
          </p>
          <p className="mt-3 font-semibold" data-testid="wx-fc-detail-used">
            <span className="text-[22px]">¥ </span>
            <span className="text-[44px] leading-none">{fmtMoney(used)}</span>
          </p>
          <p className="mt-3 text-[14px] text-black/45 dark:text-white/45">
            每月消费上限 ¥{fmtMoney(limit)}
            <button
              type="button"
              data-testid="wx-fc-edit-limit"
              onClick={() => {
                setDraft(String(limit));
                setLimitSheet(true);
              }}
              className="ml-2 text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
            >
              修改
            </button>
          </p>
        </div>
        <div className="mt-9 border-t border-black/[0.06] px-5 dark:border-white/[0.08]">
          <div className="flex items-center justify-between gap-3 py-4 text-[15px]">
            <span className="shrink-0 text-black/45 dark:text-white/45">对方领取时间</span>
            <span data-testid="wx-fc-detail-claimtime">{claimed && claimedAt ? fmtFullDate(claimedAt) : '待对方领取'}</span>
          </div>
          <button
            type="button"
            data-testid="wx-fc-method"
            onClick={() => setMethodSheet(true)}
            className="flex w-full items-center justify-between gap-3 border-t border-black/[0.06] py-4 text-left text-[15px] active:opacity-70 dark:border-white/[0.08]"
          >
            <span className="shrink-0 text-black/45 dark:text-white/45">优先扣款方式</span>
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                style={{ background: 'linear-gradient(180deg, #FFCE43, #F5B000)' }}
              >
                ¥
              </span>
              <span className="truncate">{method}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
            </span>
          </button>
        </div>
        <div className="h-[10px] bg-[#EDEDED] dark:bg-[#161616]" />
        <div className="px-5">
          <div className="flex items-center justify-between py-4">
            <span className="text-[17px]">消费记录</span>
            <button
              type="button"
              onClick={() => onToast(used > 0 ? '消费记录详情暂未开放' : '本月暂无消费')}
              className="text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
            >
              详情
            </button>
          </div>
          <div className="flex items-center justify-between border-t border-black/[0.06] py-4 text-[15px] dark:border-white/[0.08]">
            <span>{monthLabel}</span>
            <span data-testid="wx-fc-detail-month">¥{fmtMoney(used)}</span>
          </div>
        </div>
      </div>

      {/* 修改每月消费上限弹层 */}
      {limitSheet && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/45" onClick={() => setLimitSheet(false)} data-testid="wx-fc-limit-sheet">
          <div className="rounded-t-[14px] bg-[#EDEDED] px-4 pb-8 pt-4 dark:bg-[#1C1C1C]" onClick={(e) => e.stopPropagation()}>
            <p className="pb-3 text-center text-[15px] font-medium">修改每月消费上限</p>
            <div className="flex items-center gap-2 rounded-[10px] bg-white px-4 dark:bg-[#1A1A1A]">
              <span className="text-[18px] font-semibold">¥</span>
              <input
                data-testid="wx-fc-limit-input"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(sanitizeAmount(e.target.value))}
                inputMode="decimal"
                placeholder="0.00"
                className="h-[52px] w-full bg-transparent text-[18px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
              />
            </div>
            <button
              type="button"
              data-testid="wx-fc-limit-ok"
              onClick={saveLimit}
              className="mt-4 h-12 w-full rounded-[8px] bg-[#07C160] text-[16px] font-medium text-white active:bg-[#06AD56]"
            >
              确定
            </button>
          </div>
        </div>
      )}

      {/* 优先扣款方式弹层（零钱 / 银行卡） */}
      {methodSheet && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/45" onClick={() => setMethodSheet(false)} data-testid="wx-fc-method-sheet">
          <div className="rounded-t-[14px] bg-[#EDEDED] px-3 pb-8 pt-3 dark:bg-[#1C1C1C]" onClick={(e) => e.stopPropagation()}>
            <p className="pb-2 text-center text-[15px] font-medium">优先扣款方式</p>
            <div className="rounded-[10px] bg-white dark:bg-[#1A1A1A]">
              {['零钱', ...cards.map((c) => `${c.bank} 储蓄卡`)].map((m, i) => (
                <button
                  key={m}
                  type="button"
                  data-testid={`wx-fc-method-${i}`}
                  onClick={() => {
                    onPickMethod(m);
                    setMethodSheet(false);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-[13px] text-left text-[16px] active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                    i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.07]' : ''
                  }`}
                >
                  {i === 0 ? (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#07C160] text-[14px] font-semibold text-white">¥</span>
                  ) : (
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                      style={{ background: 'linear-gradient(180deg, #FFCE43, #F5B000)' }}
                    >
                      ¥
                    </span>
                  )}
                  <span className="flex-1">{m}</span>
                  {method === m && <Check className="h-5 w-5 shrink-0 text-[#07C160]" strokeWidth={2.4} aria-hidden="true" />}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setMethodSheet(false)}
              className="mt-3 h-11 w-full rounded-[10px] bg-white text-[16px] active:bg-black/[0.04] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 聊天页 ----------------

// ---------------- 聊天加号面板 + 红包/转账（对照用户微信截图 1:1） ----------------

type PlusAction = 'camera' | 'image' | 'voicecall' | 'videocall' | 'redpacket' | 'transfer' | 'location' | 'favorite';

/** 加号面板（输入栏下方弹出，输入框跟随保留在面板上方） */
function PlusPanel({ onAction }: { onAction: (a: PlusAction) => void }) {
  const items: Array<{ key: PlusAction; label: string; icon: React.ReactNode }> = [
    { key: 'camera', label: '相机', icon: <Camera className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { key: 'image', label: '图片', icon: <ImageIcon className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { key: 'voicecall', label: '语音通话', icon: <Phone className="h-[25px] w-[25px]" strokeWidth={1.6} /> },
    { key: 'videocall', label: '视频通话', icon: <Video className="h-[25px] w-[25px]" strokeWidth={1.6} /> },
    { key: 'redpacket', label: '红包', icon: <Gift className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { key: 'transfer', label: '转账', icon: <ArrowLeftRight className="h-[25px] w-[25px]" strokeWidth={1.6} /> },
    { key: 'location', label: '位置', icon: <MapPin className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { key: 'favorite', label: '收藏', icon: <Star className="h-[25px] w-[25px]" strokeWidth={1.6} /> },
  ];
  return (
    <div
      className="shrink-0 border-t border-black/[0.05] bg-[#F7F7F7] px-2 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 dark:border-white/[0.06] dark:bg-[#161616]"
      data-testid="wx-plus-panel"
    >
      <div className="grid grid-cols-4">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            data-testid={`wx-plus-${it.key}`}
            onClick={() => onAction(it.key)}
            className="flex flex-col items-center gap-[7px] py-2 active:bg-black/[0.04] dark:active:bg-white/[0.06]"
          >
            <span className="flex h-[57px] w-[57px] items-center justify-center rounded-[14px] bg-white text-black/70 shadow-[0_1px_5px_rgba(0,0,0,0.05)] dark:bg-[#242428] dark:text-white/75">
              {it.icon}
            </span>
            <span className="text-[12px] text-black/60 dark:text-white/60">{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 支付方式选择底部弹层（零钱 / 银行卡 / 我收到的亲属卡；发红包/转账页用；单聊/群聊共用） */
export function WxPayMethodSheet({
  cards,
  familyIn,
  selectedId,
  onClose,
  onPick,
}: {
  cards: WxCard[];
  familyIn: WxFamilyCardIn[];
  selectedId: string;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const rows: Array<{ id: string; name: string; sub: string; icon: React.ReactNode }> = [
    {
      id: 'balance',
      name: '零钱',
      sub: `可用 ${fmtMoney(wxLoadBalance())} 元`,
      icon: (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#07C160] text-[16px] font-semibold text-white" aria-hidden="true">
          ¥
        </span>
      ),
    },
    ...cards.map((c) => ({
      id: c.id,
      name: `${c.bank} 储蓄卡`,
      sub: `尾号${c.tail} · 可用 ${fmtMoney(c.balance)} 元`,
      icon: <BankDot bank={c.bank} size={36} />,
    })),
    ...familyIn.map((f) => ({
      id: f.id,
      name: `${f.fromName}的亲属卡`,
      sub: `${f.relation} · 本月可用 ${fmtMoney(Math.max(0, f.monthlyLimit - f.used))} 元`,
      icon: (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#F7B500] to-[#F79C00] text-white" aria-hidden="true">
          <Heart className="h-[17px] w-[17px]" strokeWidth={2} />
        </span>
      ),
    })),
  ];
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label="选择支付方式" onClick={onClose} data-testid="wx-pay-method-sheet">
      <div className="rounded-t-[14px] bg-[#EDEDED] px-3 pb-8 pt-3 dark:bg-[#1C1C1C]" onClick={(e) => e.stopPropagation()}>
        <p className="pb-2 text-center text-[15px] font-medium">选择支付方式</p>
        <div className="max-h-[340px] overflow-y-auto rounded-[10px] bg-white dark:bg-[#1A1A1A]">
          {rows.map((r, i) => (
            <button
              key={r.id}
              type="button"
              data-testid={`wx-pay-method-${r.id === 'balance' ? 'balance' : r.id.startsWith('fcin-') ? 'fc' : cards.find((c) => c.id === r.id)?.tail ?? r.id}`}
              onClick={() => onPick(r.id)}
              className={`relative flex w-full items-center gap-3 px-4 py-[13px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.07]' : ''
              }`}
            >
              {r.icon}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px]">{r.name}</span>
                <span className="block text-[12px] text-black/40 dark:text-white/40">{r.sub}</span>
              </span>
              {selectedId === r.id ? <Check className="h-5 w-5 shrink-0 text-[#07C160]" strokeWidth={2.4} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 h-11 w-full rounded-[10px] bg-white text-[16px] active:bg-black/[0.04] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
        >
          取消
        </button>
      </div>
    </div>
  );
}

/** 发红包页：金额/祝福语输入 + 支付方式行 + 底部「塞钱进红包」发送按钮（无数字键盘） */
function RedPacketCompose({
  onBack,
  onSubmit,
  onToast,
}: {
  onBack: () => void;
  onSubmit: (amount: number, blessing: string, methodId: string) => void;
  onToast: (m: string) => void;
}) {
  const [val, setVal] = useState('');
  const [blessing, setBlessing] = useState('');
  const [methodId, setMethodId] = useState('balance');
  const [methodOpen, setMethodOpen] = useState(false);
  const cards = loadCards();
  const familyIn = loadFamilyCardsIn();
  const num = parseFloat(val || '0');
  const ok = num >= 0.01;
  const denyToast = () => {
    if (methodId === 'balance') onToast('零钱不足，请先充值');
    else if (methodId.startsWith('fcin-')) onToast('亲属卡本月额度不足');
    else onToast('卡内余额不足，请更换支付方式');
  };
  const submit = () => {
    if (!ok) {
      onToast('请输入金额');
      return;
    }
    if (num > 200) {
      onToast('单个红包金额不可超过 200 元');
      return;
    }
    if (!wxCanPay(methodId, num)) {
      denyToast();
      return;
    }
    onSubmit(num, blessing.trim() || '恭喜发财，大吉大利', methodId);
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-rp-compose">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-rp-compose-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-medium">发红包</div>
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="absolute right-4">
            <EllipsisGlyph />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
        <div className="flex items-center justify-between rounded-[10px] bg-white px-4 py-[13px] dark:bg-[#1A1A1A]">
          <span className="text-[16px]">金额</span>
          <span className="flex items-center gap-1 text-[15px]">
            <span className="text-black/50 dark:text-white/50">¥</span>
            <input
              value={val}
              inputMode="decimal"
              onChange={(e) => setVal(sanitizeAmount(e.target.value))}
              placeholder="0.00"
              aria-label="红包金额"
              data-testid="wx-rp-amount-input"
              className="w-[96px] bg-transparent text-right text-[15px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
            />
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-[10px] bg-white px-4 py-[14px] dark:bg-[#1A1A1A]">
          <input
            value={blessing}
            onChange={(e) => setBlessing(e.target.value.slice(0, 25))}
            placeholder="恭喜发财，大吉大利"
            data-testid="wx-rp-blessing"
            className="h-8 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
          />
          <button type="button" aria-label="表情" onClick={() => onToast('表情暂未开放')} className="shrink-0 active:opacity-60">
            <Smile className="h-[22px] w-[22px] text-black/35 dark:text-white/35" strokeWidth={1.7} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => onToast('红包封面暂未开放')}
          className="mt-3 flex w-full items-center justify-between rounded-[10px] bg-white px-4 py-[18px] active:bg-black/[0.03] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
        >
          <span className="text-[16px]">红包封面</span>
          <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
        </button>
        {/* 支付方式 */}
        <div className="mt-3 overflow-hidden rounded-[10px] bg-white dark:bg-[#1A1A1A]">
          <button
            type="button"
            data-testid="wx-rp-method"
            onClick={() => setMethodOpen(true)}
            className="flex w-full items-center px-4 py-[14px] text-left active:bg-black/[0.03] dark:active:bg-white/[0.06]"
          >
            <span className="flex-1 text-[16px]">支付方式</span>
            <span className="mr-1 max-w-[58%] truncate text-[14px] text-black/45 dark:text-white/45">{wxMethodLabel(methodId)}</span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>

        <div className="mt-10 text-center">
          <p className="font-semibold" data-testid="wx-rp-big">
            <span className="text-[28px]">¥</span>
            <span className="ml-2 text-[48px] leading-none">{val || '0.00'}</span>
          </p>
          <button
            type="button"
            data-testid="wx-rp-send"
            onClick={submit}
            className={`mt-8 h-[46px] w-[230px] rounded-[8px] text-[17px] font-medium text-white active:brightness-95 ${
              ok ? 'bg-[#F04A3A]' : 'bg-[#F04A3A]/45'
            }`}
          >
            塞钱进红包
          </button>
        </div>
      </div>
      {methodOpen ? (
        <WxPayMethodSheet
          cards={cards}
          familyIn={familyIn}
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

/** 转账页：转账给 xx + 金额输入卡 + 转账说明 + 支付方式行 + 底部「转账」发送按钮（无数字键盘）。
 *  单聊/群聊共用（群聊传入被选中的群成员） */
export function TransferCompose({
  peer,
  onBack,
  onSubmit,
  onToast,
}: {
  peer: ContactRecord;
  onBack: () => void;
  onSubmit: (amount: number, note: string, methodId: string) => void;
  onToast: (m: string) => void;
}) {
  const [val, setVal] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [methodId, setMethodId] = useState('balance');
  const [methodOpen, setMethodOpen] = useState(false);
  const cards = loadCards();
  const familyIn = loadFamilyCardsIn();
  const num = parseFloat(val || '0');
  const ok = num >= 0.01;
  const submit = () => {
    if (!ok) {
      onToast('请输入转账金额');
      return;
    }
    if (!wxCanPay(methodId, num)) {
      if (methodId === 'balance') onToast('零钱不足，请先充值');
      else if (methodId.startsWith('fcin-')) onToast('亲属卡本月额度不足');
      else onToast('卡内余额不足，请更换支付方式');
      return;
    }
    onSubmit(num, note.trim(), methodId);
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-tr-compose">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-tr-compose-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
        <div className="flex items-center gap-3 px-1">
          <div className="min-w-0 flex-1">
            <p className="text-[21px] font-semibold" data-testid="wx-tr-peer-name">
              转账给 {peer.name}
            </p>
            <p className="mt-1 truncate text-[14px] text-black/40 dark:text-white/40">微信号：{peer.wechatId || '未设置'}</p>
          </div>
          <WxAvatar src={peer.avatar} alt={peer.name} size={54} />
        </div>
        <div className="mt-5 rounded-[14px] bg-white px-5 pb-5 pt-5 dark:bg-[#1A1A1A]">
          <p className="text-[15px] text-black/70 dark:text-white/70">转账金额</p>
          <div className="mt-3 flex items-center gap-2 border-b border-black/[0.06] pb-4 dark:border-white/[0.08]" data-testid="wx-tr-amount-big">
            <span className="text-[30px] font-semibold leading-none">¥</span>
            <input
              value={val}
              inputMode="decimal"
              onChange={(e) => setVal(sanitizeAmount(e.target.value))}
              placeholder="0.00"
              aria-label="转账金额"
              data-testid="wx-tr-amount-input"
              className="min-w-0 flex-1 bg-transparent text-[38px] font-semibold leading-none outline-none placeholder:text-black/20 dark:placeholder:text-white/20"
            />
          </div>
          <div className="mt-4">
            {noteOpen ? (
              <input
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 10))}
                placeholder="转账说明（10 字以内）"
                data-testid="wx-tr-note"
                className="w-full bg-transparent text-[15px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
              />
            ) : (
              <button type="button" data-testid="wx-tr-note-add" onClick={() => setNoteOpen(true)} className="text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]">
                添加转账说明
              </button>
            )}
          </div>
        </div>
        {/* 支付方式 */}
        <div className="mt-3 overflow-hidden rounded-[14px] bg-white dark:bg-[#1A1A1A]">
          <button
            type="button"
            data-testid="wx-tr-method"
            onClick={() => setMethodOpen(true)}
            className="flex w-full items-center px-4 py-[14px] text-left active:bg-black/[0.03] dark:active:bg-white/[0.06]"
          >
            <span className="flex-1 text-[16px]">支付方式</span>
            <span className="mr-1 max-w-[58%] truncate text-[14px] text-black/45 dark:text-white/45">{wxMethodLabel(methodId)}</span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>
        <button
          type="button"
          data-testid="wx-tr-send"
          onClick={submit}
          disabled={!ok}
          className={`mx-auto mt-9 block h-[46px] w-[230px] rounded-[8px] text-[17px] font-medium text-white ${
            ok ? 'bg-[#07C160] active:brightness-95' : 'bg-[#07C160]/45'
          }`}
        >
          转账
        </button>
        <p className="pb-6 pt-4 text-center text-[12px] text-black/35 dark:text-white/35">请确认好收款人，谨防电信诈骗</p>
      </div>
      {methodOpen ? (
        <WxPayMethodSheet
          cards={cards}
          familyIn={familyIn}
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

/** 红包聊天卡片（红橙渐变，底部「红包」条；与转账卡同宽 206px；未领取点击弹「開」，已领取进详情）。
 *  单聊/群聊共用同一套卡片组件（群聊传入群红包的祝福语/进度文案） */
export function RpBubble({ blessing, sub, settled, onClick }: { blessing: string; sub: string; settled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="wx-rp-bubble"
      onClick={onClick}
      className="relative block w-[206px] overflow-hidden rounded-[8px] text-left shadow-sm transition-all duration-300 active:brightness-95"
      style={{
        background: 'linear-gradient(135deg, #F2694C, #E94E38)',
        // 领取/退还/拒收后卡片颜色变灰（对照真实微信：已领取的红包封面褪色）
        filter: settled ? 'grayscale(0.62) brightness(0.97)' : undefined,
      }}
      aria-label={`红包 ${blessing}（${sub}）`}
    >
      <span aria-hidden="true" className="pointer-events-none absolute -right-6 -top-10 h-24 w-24 rounded-full bg-white/10" />
      <span className="relative flex items-center gap-2.5 px-3 pb-2.5 pt-3">
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border-2 border-white/90 bg-white/15" aria-hidden="true">
          <span className="text-[20px] font-semibold leading-none text-white">¥</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-snug text-white">{blessing}</span>
          <span className="mt-0.5 block text-[11px] text-white/85">{sub}</span>
        </span>
      </span>
      <span className="relative block bg-black/[0.08] px-3 py-[5px] text-[12px] text-white/90">红包</span>
    </button>
  );
}

/** 转账聊天卡片（橙色渐变 + 白描边圆⇆/对勾/退还↩ + 金额 + 状态文案 + 左下「转账」+ 朝向角标；紧凑尺寸；自己也作为「已收款/已退还」接收凭据卡复用）。
 *  状态文案按角色与收款状态区分：接收完成后才显示「已转入零钱」，之前是「待对方收款」；
 *  待收款中：有转账留言时状态行优先显示留言（没写留言才显示状态文案）；
 *  终态（已收款/已退还/已拒收）：不再显示留言，改回显示原状态文案（用户需求：退还接收以后不要显示留言）；
 *  收款/退还/拒收后卡片颜色变灰（对照真实微信：终态卡褪色），退还卡圆图标换成↩。
 *  单聊/群聊共用同一套卡片组件（群聊传入群转账的状态文案） */
export function TrBubble({ amount, status, received, refunded, fromMe, note, settled, onClick }: { amount: number; status: string; received: boolean; refunded: boolean; fromMe: boolean; note?: string; settled?: boolean; onClick: () => void }) {
  // 终态（已收款/已退还/已拒收）→ 显示原状态文案；待收款中 → 有留言显示留言、没写留言显示状态文案
  const line = !settled && note && note.trim() ? note : status;
  return (
    <button
      type="button"
      data-testid="wx-tr-bubble"
      onClick={onClick}
      className="relative block w-[206px] overflow-hidden rounded-[8px] text-left shadow-sm transition-all duration-300 active:brightness-95"
      style={{
        background: 'linear-gradient(135deg, #F6AC3D, #EF9A2E)',
        // 收款/退还/拒收后卡片颜色变灰（对照真实微信：已收款与已退还的转账卡都褪色）
        filter: received || refunded ? 'grayscale(0.62) brightness(0.97)' : undefined,
      }}
      aria-label={`转账 ¥${fmtMoney(amount)}${received ? '（已收款）' : refunded ? '（已退还）' : ''}`}
    >
      <span aria-hidden="true" className={`absolute top-[11px] h-[13px] w-[13px] rotate-45 rounded-[2px] bg-[#F2A233] ${fromMe ? '-right-[3px]' : '-left-[3px]'}`} />
      <span className="relative flex items-center gap-2.5 px-3 pb-2.5 pt-3">
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border-2 border-white/90" aria-hidden="true">
          {refunded ? <Undo2 className="h-5 w-5 text-white" strokeWidth={2.2} /> : received ? <Check className="h-5 w-5 text-white" strokeWidth={2.4} /> : <ArrowLeftRight className="h-5 w-5 text-white" strokeWidth={2} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-semibold leading-tight text-white">¥{fmtMoney(amount)}</span>
          <span className="mt-0.5 block truncate text-[13px] text-white/95" data-testid="wx-tr-bubble-status">
            {line}
          </span>
        </span>
      </span>
      <span className="relative block bg-black/[0.06] px-3 py-[4px] text-[12px] text-white/90">转账</span>
    </button>
  );
}

/** 聊天系统通知行（截图参考：居中小图标 + 灰字 + 金色尾词，如「xx领取了你的红包」；单聊/群聊共用） */
export function WxNoticeRow({ icon, pre, accent }: { icon: 'rp' | 'tr' | 'fam'; pre: string; accent: string }) {
  return (
    <div className="flex justify-center py-1.5" data-testid="wx-notice-row">
      <span className="flex max-w-[86%] items-center gap-1.5 text-[13px] text-black/45 dark:text-white/45">
        {icon === 'rp' ? (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(180deg, #F2694C, #E94E38)' }}
          >
            <span className="h-[7px] w-[7px] rounded-full border-[1.5px] border-[#F9DCA8]" />
          </span>
        ) : icon === 'tr' ? (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(135deg, #F6AC3D, #EF9A2E)' }}
          >
            <ArrowLeftRight className="h-[10px] w-[10px] text-white" strokeWidth={2.6} />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(135deg, #FDF3CE, #FAE7A8)' }}
          >
            <Heart className="h-[10px] w-[10px] text-[#E0A94C]" strokeWidth={2.4} />
          </span>
        )}
        <span className="truncate">{pre}</span>
        <span className="shrink-0 text-[#D8A244]">{accent}</span>
      </span>
    </div>
  );
}

/**
 * 开红包弹窗（对照真实微信：半透明黑底遮罩透出聊天，居中一张圆角红包封面卡，
 * 金色描边 + 头像/「XX的红包」/祝福语 + 底部亮红大弧上金色呼吸光晕「開」钮，卡片下方金色 X 关闭）；
 * 单聊/群聊共用（群聊里成员发的红包同样先开箱）
 */
export function RpOpenLayer({
  senderName,
  senderAvatar,
  blessing,
  onOpen,
  onClose,
  onRefund,
}: {
  senderName: string;
  senderAvatar: string | null;
  blessing: string;
  onOpen: () => void;
  onClose: () => void;
  /** 退还该红包（仅对方发来的未领取红包传入） */
  onRefund?: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/70 px-7 pb-12" role="dialog" aria-label="打开红包" data-testid="wx-rp-open">
      <style>{
        '@keyframes wxrp-in{from{transform:scale(.86);opacity:0}to{transform:scale(1);opacity:1}}' +
        '@keyframes wxrp-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}' +
        '@keyframes wxrp-glow{0%,100%{box-shadow:0 12px 30px rgba(0,0,0,.25),0 0 0 0 rgba(249,208,120,.5)}70%{box-shadow:0 12px 30px rgba(0,0,0,.25),0 0 0 18px rgba(249,208,120,0)}}'
      }</style>
      <div className="relative w-full max-w-[330px]" style={{ animation: 'wxrp-in 0.26s ease-out' }}>
        {/* 红包封面卡 */}
        <div
          className="relative h-[420px] overflow-hidden rounded-[20px] shadow-[0_24px_60px_rgba(0,0,0,0.4)]"
          style={{ background: 'linear-gradient(170deg, #F8755C 0%, #EF5340 55%, #E84434 100%)' }}
        >
          {/* 封面装饰：卡内光斑 + 浮动金点 + 卡顶金色饰线 */}
          <span aria-hidden="true" className="pointer-events-none absolute -left-14 -top-16 h-44 w-44 rounded-full bg-white/[0.07]" />
          <span aria-hidden="true" className="pointer-events-none absolute -right-16 top-1/3 h-52 w-52 rounded-full bg-white/[0.05]" />
          {[
            { left: '16%', top: '20%', s: 6, d: '0s' },
            { left: '80%', top: '28%', s: 5, d: '.6s' },
            { left: '22%', top: '58%', s: 5, d: '1.1s' },
            { left: '78%', top: '62%', s: 6, d: '.3s' },
          ].map((p, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="pointer-events-none absolute rounded-full bg-[#F9D08A]/70"
              style={{ left: p.left, top: p.top, width: p.s, height: p.s, animation: `wxrp-float 3.2s ease-in-out ${p.d} infinite` }}
            />
          ))}
          <span aria-hidden="true" className="absolute inset-x-9 top-0 h-[3px] rounded-b bg-gradient-to-r from-transparent via-[#F0C87E]/75 to-transparent" />

          <div className="relative flex h-full flex-col items-center">
            <div className="h-[21%] shrink-0" aria-hidden="true" />
            <span className="rounded-full border-2 border-[#F0C87E]/85 p-[3px] shadow-[0_4px_14px_rgba(0,0,0,0.18)]">
              <WxAvatar src={senderAvatar} alt={senderName} size={46} />
            </span>
            <p className="mt-3.5 text-[18px] font-medium tracking-wide text-[#F9DCA8]" data-testid="wx-rp-open-sender">
              {senderName}的红包
            </p>
            <p className="mt-7 max-w-[86%] text-center text-[24px] font-medium leading-relaxed text-[#FFF3D6] [text-shadow:0_2px_4px_rgba(170,30,25,0.3)]" data-testid="wx-rp-open-blessing">
              {blessing}
            </p>
            <div className="flex-1" aria-hidden="true" />
            {/* 底部亮红大弧 + 開 */}
            <div className="relative h-[150px] w-full shrink-0">
              <span className="absolute left-1/2 top-[46px] h-[240px] w-[480px] -translate-x-1/2 rounded-[50%]" style={{ backgroundColor: '#FF7A5F' }} aria-hidden="true" />
              <button
                type="button"
                data-testid="wx-rp-open-btn"
                onClick={onOpen}
                className="absolute left-1/2 top-[22px] grid h-[92px] w-[92px] -translate-x-1/2 place-items-center rounded-full text-[40px] font-semibold text-[#A8671F] transition-transform active:scale-95"
                style={{
                  fontFamily: 'Georgia, serif',
                  background: 'linear-gradient(180deg, #FCEBC0 0%, #F3CB72 55%, #E0A94C 100%)',
                  animation: 'wxrp-glow 1.9s ease-out infinite',
                }}
                aria-label="开红包"
              >
                <span aria-hidden="true" className="pointer-events-none absolute inset-[5px] rounded-full border-[1.5px] border-[#C08A3A]/60" />
                開
              </button>
            </div>
          </div>
        </div>

        {/* 卡片下方：退还 + 金色 X 关闭（退还可把对方发的红包原路退回） */}
        <div className="absolute -bottom-[68px] left-1/2 flex -translate-x-1/2 items-center gap-5">
          {onRefund ? (
            <button
              type="button"
              data-testid="wx-rp-refund"
              onClick={onRefund}
              className="flex h-[50px] items-center rounded-full border-2 border-[#EFC266]/90 bg-black/25 px-6 text-[16px] font-medium text-[#EFC266] active:opacity-70"
            >
              退还
            </button>
          ) : null}
          <button
            type="button"
            aria-label="关闭"
            data-testid="wx-rp-open-close"
            onClick={onClose}
            className="flex h-[50px] w-[50px] items-center justify-center rounded-full border-2 border-[#EFC266]/90 text-[#EFC266] active:opacity-70"
          >
            <X className="h-6 w-6" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 红包详情页（红色弧形头 + 头像/名字 + 祝福语 + 金色金额 + 领取详情[谁领取的] + 回复表情） */
function RpDetailPage({
  senderName,
  senderAvatar,
  blessing,
  amount,
  opened,
  statusLabel,
  claimerName,
  claimerAvatar,
  claimedAt,
  onBack,
  onToast,
}: {
  senderName: string;
  senderAvatar: string | null;
  blessing: string;
  amount: number;
  opened: boolean;
  /** 退还/拒收状态文案（未终态时不传） */
  statusLabel?: string;
  claimerName: string;
  claimerAvatar: string | null;
  claimedAt?: number;
  onBack: () => void;
  onToast: (m: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-rp-detail">
      <div className="relative shrink-0 bg-[#F25844] pt-[54px]">
        <div className="relative flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-rp-detail-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7 text-[#F6CE93]" strokeWidth={2.2} />
          </button>
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="ml-auto px-2 active:opacity-60">
            <EllipsisGlyph />
          </button>
        </div>
        {/* 弧形底（金色描边） */}
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-full h-[30px] w-[140%] -translate-x-1/2 rounded-[50%] bg-white dark:bg-[#111111]"
          style={{ boxShadow: '0 -3px 0 #E9C880' }}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto pt-[8vh]">
        <div className="flex items-center gap-2.5">
          <WxAvatar src={senderAvatar} alt={senderName} size={36} />
          <span className="text-[20px] font-medium" data-testid="wx-rp-detail-title">
            {senderName}的红包
          </span>
        </div>
        <p className="mt-2.5 text-[15px] text-black/40 dark:text-white/40">{blessing}</p>
        {statusLabel ? (
          <p className="mt-2 text-[13px] text-[#D8A244]" data-testid="wx-rp-detail-status">{statusLabel}</p>
        ) : null}
        <p className="mt-8 font-semibold text-[#D8A244]" data-testid="wx-rp-detail-amount">
          <span className="text-[46px] leading-none">{fmtMoney(amount)}</span>
          <span className="ml-1.5 text-[20px]">元</span>
        </p>

        {/* 领取详情（谁领取的） */}
        <div className="mt-9 w-[87%] max-w-[350px]" data-testid="wx-rp-claim">
          <p className="text-[12px] text-black/35 dark:text-white/35" data-testid="wx-rp-claim-caption">
            1个红包共{fmtMoney(amount)}元，已领取{opened ? 1 : 0}/1
          </p>
          {opened ? (
            <div className="mt-1.5 flex items-center gap-3 border-t border-black/[0.06] py-3.5 dark:border-white/[0.08]">
              <WxAvatar src={claimerAvatar} alt={claimerName} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px]" data-testid="wx-rp-claim-name">
                  {claimerName}
                </span>
                <span className="mt-0.5 block text-[11px] text-black/35 dark:text-white/35" data-testid="wx-rp-claim-time">
                  {fmtFullTime(claimedAt ?? Date.now())}
                </span>
              </span>
              <span className="shrink-0 text-[15px] font-medium text-[#D8A244]" data-testid="wx-rp-claim-amount">
                ¥{fmtMoney(amount)}
              </span>
            </div>
          ) : (
            <p className="mt-7 text-center text-[13px] text-black/30 dark:text-white/30">等待领取…</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => onToast('表情暂未开放')}
          className="mt-11 flex items-center gap-2 rounded-[10px] bg-black/[0.04] px-7 py-3.5 text-[16px] text-black/50 active:bg-black/[0.08] dark:bg-white/[0.08] dark:text-white/50"
        >
          <Smile className="h-5 w-5" strokeWidth={1.8} />
          回复表情到聊天
        </button>
      </div>
    </div>
  );
}

/** 收款页（点对方发来的未收款转账进入，对照截图：蓝圈时钟 + 待你收款 + 金额 + 转账时间 + 绿色收款按钮 + 退还提示） */
function WxTrReceivePage({
  peerName,
  amount,
  note,
  payTime,
  onBack,
  onAccept,
  onRefund,
}: {
  peerName: string;
  amount: number;
  note: string;
  payTime: number;
  onBack: () => void;
  onAccept: () => void;
  onRefund: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-tr-receive">
      <div className="shrink-0 bg-white pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-tr-receive-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8">
        <div className="mt-[9vh] flex flex-col items-center">
          <Clock className="h-[74px] w-[74px] text-[#4D9CF8]" strokeWidth={1.5} aria-hidden="true" />
          <p className="mt-7 text-[19px]" data-testid="wx-tr-receive-status">
            {peerName}向你转账，待你收款
          </p>
          <p className="mt-4 font-semibold" data-testid="wx-tr-receive-amount">
            <span className="text-[30px]">¥ </span>
            <span className="text-[46px] leading-none">{fmtMoney(amount)}</span>
          </p>
        </div>
        <div className="mt-14 w-full border-t border-black/[0.06] pt-5 dark:border-white/[0.08]">
          <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
            <span className="shrink-0 text-black/45 dark:text-white/45">转账时间</span>
            <span className="text-right">{fmtFullTime(payTime)}</span>
          </div>
          {note ? (
            <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
              <span className="shrink-0 text-black/45 dark:text-white/45">转账说明</span>
              <span className="min-w-0 truncate text-right">{note}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 px-14 pb-9">
        <button
          type="button"
          data-testid="wx-tr-receive-accept"
          onClick={onAccept}
          className="mx-auto block h-12 w-full rounded-[10px] text-[17px] font-medium text-white active:brightness-95"
          style={{ backgroundColor: '#07C160' }}
        >
          收款
        </button>
        <p className="mt-4 text-center text-[13.5px] text-black/45 dark:text-white/45">
          1天内未确认，将退还给对方。{' '}
          <button type="button" onClick={onRefund} className="text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]" data-testid="wx-tr-receive-refund">
            退还
          </button>
        </p>
      </div>
    </div>
  );
}

/** 转账详情页（截图⑥：绿勾大圆 + 已收款 + 金额 + 转账/收款时间 + 账单详情）。
 *  退还态（截图⑦）：黄圈↩ + 「你已退还/对方已退还」+ 金额 + 转账时间/退款时间 */
function TrDetailPage({
  peerName,
  amount,
  note,
  payTime,
  received,
  receivedAt,
  receiverIsMe,
  returned,
  refundedBy,
  refundedAt,
  originTime,
  onBack,
  onToast,
}: {
  peerName: string;
  amount: number;
  note: string;
  payTime: number;
  received: boolean;
  receivedAt?: number;
  /** 收款人是否为「我」（原卡按消息角色判断 + 凭据卡按 receiptOf 判断）：文案区分「你已收款 / XX已收款」 */
  receiverIsMe: boolean;
  /** 退还终态（status==='returned' 时 true）：整页切换为退还详情 */
  returned?: boolean;
  /** 退还人（'me'=我退的→「你已退还」；'peer'=对方退的→「对方已退还」） */
  refundedBy?: 'me' | 'peer';
  /** 退款时间（详情页「退款时间」行） */
  refundedAt?: number;
  /** 原转账时间（退还凭据卡专用；缺省回退 payTime） */
  originTime?: number;
  onBack: () => void;
  onToast: (m: string) => void;
}) {
  const isReturned = returned === true;
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-tr-detail">
      <div className="shrink-0 bg-white pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-tr-detail-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="ml-auto px-2 active:opacity-60">
            <EllipsisGlyph />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8 pt-[9vh]">
        <span
          className={`flex h-[74px] w-[74px] items-center justify-center rounded-full ${isReturned ? 'bg-[#F6AC3D]' : received ? 'bg-[#07C160]' : 'bg-[#F6AC3D]'}`}
          aria-hidden="true"
        >
          {isReturned ? <Undo2 className="h-11 w-11 text-white" strokeWidth={2.6} /> : <Check className="h-11 w-11 text-white" strokeWidth={3} />}
        </span>
        <p className="mt-7 text-[19px]" data-testid="wx-tr-status">
          {isReturned
            ? refundedBy === 'peer'
              ? '对方已退还'
              : '你已退还'
            : received
              ? receiverIsMe
                ? '你已收款，资金已存入零钱'
                : `${peerName}已收款`
              : '对方确认后到账'}
        </p>
        <p className="mt-4 font-semibold" data-testid="wx-tr-detail-amount">
          <span className="text-[30px]">¥ </span>
          <span className="text-[46px] leading-none">{fmtMoney(amount)}</span>
        </p>
        <div className="mt-14 w-full border-t border-black/[0.06] pt-5 dark:border-white/[0.08]">
          <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
            <span className="shrink-0 text-black/45 dark:text-white/45">转账时间</span>
            <span className="text-right">{fmtFullTime(isReturned ? (originTime ?? payTime) : payTime)}</span>
          </div>
          {isReturned && typeof refundedAt === 'number' && (
            <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
              <span className="shrink-0 text-black/45 dark:text-white/45">退款时间</span>
              <span className="text-right" data-testid="wx-tr-refund-time">
                {fmtFullTime(refundedAt)}
              </span>
            </div>
          )}
          {!isReturned && received && typeof receivedAt === 'number' && (
            <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
              <span className="shrink-0 text-black/45 dark:text-white/45">收款时间</span>
              <span className="text-right" data-testid="wx-tr-received-time">
                {fmtFullTime(receivedAt)}
              </span>
            </div>
          )}
          {note && (
            <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
              <span className="shrink-0 text-black/45 dark:text-white/45">转账说明</span>
              <span className="min-w-0 truncate text-right">{note}</span>
            </div>
          )}
        </div>
      </div>
      <button type="button" onClick={() => onToast('账单详情暂未开放')} className="shrink-0 pb-10 pt-4 text-center text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]">
        账单详情
      </button>
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
  onOpenFriendDetail,
}: {
  me: WxUser;
  peer: ContactRecord;
  /** 全部联系人（长按菜单「转发」选择目标会话用） */
  contacts: ContactRecord[];
  ownerName: string | null;
  /** 除当前会话外的未读总数（他人在你聊天时来信 → 返回键旁灰圆数字） */
  otherUnread: number;
  onBack: () => void;
  /** 聊天设置页点信息卡片 → 进入该好友的详情页 */
  onOpenFriendDetail: (c: ContactRecord) => void;
  /** App 根部 toast（在聊天分支不渲染，页内用 useLocalToast 自带 toast） */
  onToast?: (m: string) => void;
}) {
  // 聊天页自带 toast（App 根 toast 在聊天分支提前 return 不渲染——收藏成功等提示靠它显示）
  const [chatToast, onToast] = useLocalToast();
  const apiConfig = useSettings((s) => s.apiConfig);
  const [msgs, setMsgs] = useState<WxMsg[]>(() => loadMsgs(peer.id));
  const [input, setInput] = useState('');
  /** 全局流式回复状态（请求由 chat-stream-store 发起并接收，退出聊天页/退出 App 不中断） */
  const sessionKey = `wx:${peer.id}`;
  const stream = useChatStream(sessionKey);
  const streaming = stream?.status === 'streaming';
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 加号面板展开（输入框保持在面板上方） */
  const [plusOpen, setPlusOpen] = useState(false);
  /** 红包/转账发送页 + 位置功能页（相机/图片直接调起手机原生能力） */
  const [compose, setCompose] = useState<'redpacket' | 'transfer' | 'location' | null>(null);
  /** 原生相机 / 相册隐藏 input：加号面板「相机」「图片」直接调用手机能力（无自建页面） */
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  // 支付密码验证浮层（开启支付密码后红包/转账发送前弹出自绘键盘）
  const [gate, setGate] = useState<null | { kind: 'redpacket' | 'transfer'; amount: number; blessing?: string; note?: string; methodId: string }>(null);
  /** 正在「開」的红包消息 id */
  const [openingId, setOpeningId] = useState<string | null>(null);
  /** 待收款的转账消息 id（收款页：时钟 + 待你收款 + 收款按钮） */
  const [receiveId, setReceiveId] = useState<string | null>(null);
  /** 正在查看详情的红包/转账/亲属卡消息 id */
  const [detailId, setDetailId] = useState<string | null>(null);
  /** 全屏预览的图片（图片/表情消息点击查看） */
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  /** 表情面板展开（与加号面板互斥） */
  const [stickerOpen, setStickerOpen] = useState(false);
  /** 正在查看详情的位置消息 id */
  const [locViewId, setLocViewId] = useState<string | null>(null);
  /** runAiTurn 的稳定引用：发红包/转账（execRedPacket 等定义在 runAiTurn 之前）也要触发 AI 回复，用 ref 中转 */
  const runAiTurnRef = useRef<((userMsg: WxMsg | null, extra?: WxMsg[], sysEvent?: string, baseMsgs?: WxMsg[]) => void) | null>(null);
  /** 聊天设置页（右上角 ··· 进入）：信息卡片/置顶/免打扰/查找聊天记录/回复条数/聊天背景 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 查找聊天记录页 */
  const [searchOpen, setSearchOpen] = useState(false);
  /** 聊天背景页（设置页「聊天背景」进入的独立二级页） */
  const [bgOpen, setBgOpen] = useState(false);
  /** 回复条数页（设置页「回复条数」进入的独立二级页，按会话隔离） */
  const [replyOpen, setReplyOpen] = useState(false);
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
    wxActiveChatId = peer.id;
    return () => {
      if (wxActiveChatId === peer.id) wxActiveChatId = null;
    };
  }, [peer.id]);
  /** 搜索定位命中的消息 id（短暂高亮） */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  /** 气泡长按菜单（微信/QQ 同款横向弹窗）：消息 + 容器内坐标 */
  const [msgMenu, setMsgMenu] = useState<null | { msg: WxMsg; pos: BubbleMenuPos }>(null);
  /** 编辑消息弹窗（菜单「编辑」）：原消息 + 草稿 */
  const [editMsg, setEditMsg] = useState<WxMsg | null>(null);
  const [editDraft, setEditDraft] = useState('');
  /** 引用回复（输入框上方条；发送时挂到新消息上） */
  const [quote, setQuote] = useState<null | { name: string; content: string }>(null);
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
  const flags = useChatFlags(wxChatFlagsStore)[peer.id] ?? NO_FLAGS;
  const bg: ChatSettingsBg = { mode: flags.bgMode ?? 'default', color: flags.bgColor ?? '' };
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const [uploadingBg, setUploadingBg] = useState(false);

  const openingMsg = openingId ? msgs.find((m) => m.id === openingId) ?? null : null;
  const receiveMsg = receiveId ? msgs.find((m) => m.id === receiveId) ?? null : null;
  const detailMsg = detailId ? msgs.find((m) => m.id === detailId) ?? null : null;
  const locViewMsg = locViewId ? msgs.find((m) => m.id === locViewId) ?? null : null;

  // 本地持久化：流式中的 AI 回复不进本地 msgs（在全局 store 里），msgs 只含已落盘内容，直接保存
  useEffect(() => {
    saveMsgs(peer.id, msgs);
  }, [msgs, peer.id]);

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
      void getChatBgImage('wx', peer.id).then((d) => {
        if (alive) setBgImageUrl(d);
      });
    }
    return () => {
      alive = false;
    };
  }, [bg.mode, flags.bgV, peer.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, stream]);

  // 翻译：开启后把文字消息（最近 60 条，排除错误/兑底文案）按检测到的语言双向翻译成另一侧
  // （左侧语言的消息译成右侧，右侧语言的消息译成左侧）。缓存、并发闸、在途去重都在
  // @/lib/chat-translate 内部，这里只负责把结果写入组件状态
  useEffect(() => {
    if (!transCfg.on) return;
    const isErrText = (s: string) => s.startsWith('〔') || s.startsWith('（AI') || s.startsWith('（对方暂时');
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
    if (!content.trim() || content.startsWith('〔') || content.startsWith('（AI') || content.startsWith('（对方暂时')) return null;
    const code = detectTranslateTarget(content, transCfg.left, transCfg.right);
    const text = translations[`${msgId}|${code}`];
    if (typeof text !== 'string' || !text) return null;
    return (
      <p
        data-testid="wx-translate-row"
        className="mt-1 max-w-full whitespace-pre-wrap break-words text-[12.5px] leading-[1.45] text-black/45 dark:text-white/45"
      >
        {`${translateLangLabel(code)}：${text}`}
      </p>
    );
  };

  /** 全局流结束（成功/失败）：finalize 已把最终消息落盘，把落盘后的完整记录并回本地并清理流状态。
   *  useLayoutEffect + 微任务：渲染帧内完成同步避免气泡闪断；页面不在时流自然由 store 收尾，重进后走同逻辑。
   *  同 id 消息用落盘的 rp/tr/fam 覆盖本地（finalize 里 AI 领取/退回/拒收动作已更新卡片状态） */
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
            ...(s.rp ? { rp: s.rp } : {}),
            ...(s.tr ? { tr: s.tr } : {}),
            ...(s.fam ? { fam: s.fam } : {}),
            ...(s.content && !m.content ? { content: s.content } : {}),
          };
        });
        // 按 id 合并：本地新增的保留，落盘新增的只会是 AI 回复
        const ids = new Set(prev.map((m) => m.id));
        return [...merged, ...saved.filter((m) => !ids.has(m.id))];
      });
      clearChatStream(sessionKey);
    });
  }, [stream, sessionKey, peer.id]);

  /** AI 回合：插入用户消息并把整轮流式请求交给全局 store（文本/表情共用；表情以 [发送了表情：意思] 进入对话历史，AI 据此理解表情）。
   *  流式接收、超时、错误处理、落盘全部在 chat-stream-store 内完成：退出聊天页不中断，重进从 store 读实时内容。
   *  extra：发红包/转账随消息触发回复时，刚入列还没进 state 的消息。
   *  sysEvent：用户退还 AI 的红包/转账/亲属卡后注入的系统事件说明（只进本轮上下文，不落盘） */
  const runAiTurn = useCallback(
    (userMsg: WxMsg | null, extra?: WxMsg[], sysEvent?: string, baseMsgs?: WxMsg[]) => {
    const base = [...(baseMsgs ?? msgs), ...(userMsg ? [userMsg] : []), ...(extra ?? [])];
    const history = base
      .filter(
        (m) =>
          // 图片消息以 [图片] 占位进入历史（本轮图片的实际内容由识图模型描述追加在末尾）
          (!m.recalled && ((m.content || m.kind === 'sticker' || m.kind === 'image' || m.kind === 'redpacket' || m.kind === 'transfer' || m.kind === 'family') && !m.content.startsWith('〔') && !m.content.startsWith('（AI'))) as boolean
      )
      .slice(-20)
      .map((m) => {
        // 引用/转发让 AI 感知来源：引用 → 前缀说明引用的是谁说的什么；转发卡片 → 前缀说明来自哪个会话；
        // 合并转发的「聊天记录」卡片 → 完整注入逐条对话（说话人：内容），被分享的 AI 知道转发了什么
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
          (m.kind === 'forward' && m.fwd?.merged
            ? `[聊天记录：${(m.fwd.records ?? []).slice(-8).map((r) => `${r.name}：${r.text}`).join(' ／ ')}]`
            : m.kind === 'image'
            ? '[图片]'
            : m.kind === 'sticker' && m.stk
            ? m.role === 'me'
              ? `[发送了表情：${m.stk.meaning || '无描述'}]`
              : m.stk.sid
                ? `[表情包:${m.stk.sid}]`
                : `[发送了表情：${m.stk.meaning || '无描述'}]`
            : m.kind === 'redpacket' && m.rp
              ? `[红包 ID:${m.rp.cid ?? m.id} ¥${m.rp.amount} "${m.rp.blessing}"，${wxCardStateLabel(m)}]`
              : m.kind === 'transfer' && m.tr
                ? `[转账 ID:${m.tr.cid ?? m.id} ¥${m.tr.amount}${m.tr.note ? ` "${m.tr.note}"` : ''}，${wxCardStateLabel(m)}]`
                : m.kind === 'family' && m.fam
                  ? `[亲属卡 ID:${m.fam.cid ?? m.id} 每月额度¥${m.fam.monthlyLimit}，${wxCardStateLabel(m)}]`
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
    // 我发给 AI 的待处理红包/转账/亲属卡 → 注入处理动作规则与待处理清单（AI 用 [领取红包:ID:…] 等标记处理）
    const replyCount = getReplyCount(sessionKey);
    const stickers = loadStickers('wx');
    // 表情包开关（本会话独立，发送时现场读取；关闭后 AI 不发表情包也不发 emoji）
    const stickersOn = getStickersOn(sessionKey);
    const system = buildPersonaPrompt(peer, me, ownerName, stickers, stickersOn, buildNpcPromptExtra(peer, contacts));
    const actionRules = buildActionRules(wxCollectPendingCards(base));
    // 记忆库：召回该联系人（互通开关限定范围）的记忆注入 system，让 AI 带着记忆回复；
    // 相关性上下文用本轮触发消息（用户消息/系统事件）+ 最近几条，没记忆时返回空串不注入
    const memContext = [userMsg?.content, sysEvent, ...base.slice(-6).map((m) => m.content)]
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
      .join(' ');
    // 记忆召回（私聊）：跨 App 互通开关照旧；群聊来源记忆按群级互通开关判断可见性
    //（effectiveInterop 只跟群开关；用户和角色 A 的私聊记忆默认不对角色 B 开放——
    //  存储键即隔离边界，这里只影响该角色自己的召回范围）
    const memoryBlock = memRecallBlock(peer.id, 'wx', memContext, {
      interopOn: effectiveInterop,
    });
    // 朋友圈动态感知（四）：把「最近的动态 + 相关互动」注入 system（互通开关关闭时只看朋友圈平台的动态），
    // AI 能像真人一样自然提起；用户广播动态首次被看到时懒写入该角色记忆（动态 → 记忆双向打通）
    const momentsBlock = buildMomentsChatBlock({ contactId: peer.id, app: 'wx', userName: me.name, peer });
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
    // 用户消息前后包裹最后一条 user 消息；未命中不发送；有内容时 system 末尾附带使用规则）
    const wbBlocks = collectWbBlocks(peer.id, wbScanText([userMsg?.content, sysEvent, ...base.slice(-8).map((m) => m.content)]));
    const systemFull = [
      wbBlocks.beforeSystem,
      [wbBlocks.beforeChar, system, wbBlocks.afterChar].filter(Boolean).join('\n\n'),
      memoryBlock,
      momentsBlock,
      actionRules.length > 0 ? actionRules.join('\n\n') : '',
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
    // 最多 3 张）。识图配置存在时，chat-stream-store 会先识图再把描述作为上下文交给聊天模型；
    // 未配置时该字段不生效，行为与旧版一致
    const turnImages: string[] = [];
    for (let i = base.length - 1; i >= 0 && turnImages.length < 3; i--) {
      const m = base[i];
      if (m.role !== 'me') break;
      if (m.kind === 'image' && m.img?.src) turnImages.unshift(m.img.src);
    }

    const started = beginChatStream({
      sessionKey,
      aiMsgId: aiId,
      messages: payloadMsgs,
      apiConfig,
      replyCount,
      ...(turnImages.length > 0 ? { vision: { images: turnImages, text: userMsg?.content ?? '' } } : {}),
      finalize: ({ aiMsgId, content, error, startedAt }) => {
        if (error) {
          saveMsgs(peer.id, [
            ...loadMsgs(peer.id),
            { id: aiMsgId, role: 'peer', content: `〔${error}〕`, time: startedAt },
          ]);
          return;
        }
        // 1) 把回复按出现顺序切成「文字块 + 处理动作」交错片段：动作标记就地应用（状态流转 +
        //    通知行/接收凭据卡），保证落盘顺序与流式期间用户看到的顺序一致
        //    （正文先输出的先落盘，通知行跟随其后的动作位置，而不是永远堆在正文前）；
        //    标记不带感谢语/理由，回应内容由 AI 人设正文承担
        // 2) 文字块按边界（分隔标记/换行/句末标点，一句一条）切成多条消息；先合并被边界切碎的标记，
        //    再解析特殊消息标记（[红包:金额:祝福语]/[转账]/[亲属卡]/[位置]/[表情包:ID]）→ 对应类型的卡片消息
        //    （渲染与交互复用用户手动发送的同款卡片组件）；一条消息一个气泡、一条记录，像真人连发
        const latest = loadMsgs(peer.id);
        const parts = extractRichActionParts(content);
        let cur = latest;
        const all: WxMsg[] = [];
        let t = startedAt;
        let idx = 0;
        for (const part of parts) {
          if (part.type === 'action') {
            const applied = wxApplyAiActions([part.action], cur, peer, t);
            cur = applied.msgs;
            all.push(...applied.notices, ...applied.extras);
            continue;
          }
          const segs = mergeRichSegments(splitReplySegments(part.text, replyCount > 1));
          for (const seg of segs) {
            for (const p of parseRichParts(seg, stickersOn ? stickers : [])) {
              const id = idx === 0 ? aiMsgId : `${aiMsgId}-${idx}`;
              if (p.type === 'rich') {
                // 表情包开关关闭：AI 发的表情包卡片直接丢弃（红包/转账/亲属卡/位置卡片不受影响）
                if (!stickersOn && p.rich.kind === 'sticker') continue;
                all.push(richToWxMsg(p.rich, id, t, peer));
              } else {
                // 表情包开关关闭：文字里的 emoji 硬性剥除（prompt 禁令之外的双保险），残留的表情占位一并去掉
                const text = stickersOn ? p.text : stripEmojiText(p.text.replace(/\[表情包\]|\[表情\]/g, ' '));
                if (!stickersOn && !text.trim()) continue;
                all.push({ id, role: 'peer', content: text, time: t });
              }
              idx++;
              t += 600 + Math.floor(Math.random() * 600);
            }
          }
        }
        // 整段空白且没有任何动作产出时不算有效回复，给兜底文案
        if (all.length === 0) {
          all.push({ id: aiMsgId, role: 'peer', content: '（对方暂时没有回复，请稍后再试）', time: startedAt });
        }
        saveMsgs(peer.id, [...cur, ...all]);
        // 用户已退出该聊天才计数（在聊天页内实时可见，不重复计）：AI 发了几条消息角标就是几
        if (wxActiveChatId !== peer.id) wxUnreads.bump(peer.id, all.length);
        // 记忆库：一轮对话结束 → 轮次计数与自动提取记忆碎片（后台异步，失败静默不打断聊天）；
        // names：双方真实名字（与机主同源同规则：机主取 user 联系人 name，AI 取该联系人 name，均非昵称——
        // 展示层 withDisplayNames 会用昵称替换 name，不能进记忆），提取/总结 prompt 视角统一用（禁「对方/用户/我」混用）
        void Promise.all([ownerRealName(), contactRealName(peer.id)])
          .then(([owner, peerReal]) =>
            memAfterAiTurn(
              peer.id,
              'wx',
              apiConfig,
              () => memConvoFromRaw(loadMsgs(peer.id), peer.name),
              () => memLastMsgId(loadMsgs(peer.id)),
              { user: owner || me.name, peer: peerReal || displayNameOf(peer) || peer.name }
            )
          );
      },
    });
    // 极端竞态防御（同会话已有流在接收）：回滚这条用户消息，避免有去无回
    if (!started && userMsg) setMsgs((prev) => prev.filter((m) => m.id !== userMsg.id));
    },
    [apiConfig, msgs, me, ownerName, peer, contacts, sessionKey]
  );
  // 发红包/转账时通过 ref 触发（runAiTurn 定义在 execRedPacket 之后，见 runAiTurnRef 注释）
  runAiTurnRef.current = runAiTurn;

  /** 退还 AI 发来的红包/转账/亲属卡（红包弹窗「退还」、转账收款页「退还」、亲属卡领取页「退还」共用）：
   *  原卡标记终态（变灰）+ 聊天里追加通知行 + 注入系统事件触发 AI 人设化回应 */
  const refundPeerCard = useCallback(
    (m: WxMsg) => {
      if (m.kind === 'redpacket' && m.rp) {
        setMsgs((prev) => [
          ...prev.map((x) => (x.id === m.id && x.rp ? { ...x, rp: { ...x.rp, status: 'returned' as const } } : x)),
          { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'notice', notice: { icon: 'rp', pre: `你退回了${peer.name}的`, accent: '红包' } },
        ]);
        setOpeningId(null);
        setReceiveId(null);
        setDetailId(null);
        onToast('红包已退还给对方');
        runAiTurnRef.current?.(null, [], `（系统事件：你发给对方的红包被对方退还了（¥${m.rp.amount}，祝福语"${m.rp.blessing}"），金额已退回你的账户。请用符合人设的一两句话自然回应这件事。）`);
      } else if (m.kind === 'transfer' && m.tr) {
        const refundedAt = Date.now();
        const trAmt = m.tr.amount;
        const trNote = m.tr.note;
        // 我退还 AI 发的转账：原卡标记终态（变灰）+ 追加「我」发出的退还凭据卡（灰卡↩+已退还，详情页「你已退还」）
        setMsgs((prev) => [
          ...prev.map((x) => (x.id === m.id && x.tr ? { ...x, tr: { ...x.tr, status: 'returned' as const, refundedAt } } : x)),
          {
            id: uid(),
            role: 'me',
            content: '',
            time: refundedAt,
            kind: 'transfer',
            tr: { amount: trAmt, note: trNote, received: false, status: 'returned' as const, refundedAt, originTime: m.time, refundedBy: 'me' as const },
          },
        ]);
        setReceiveId(null);
        setDetailId(null);
        onToast('转账已退还给对方');
        runAiTurnRef.current?.(null, [], `（系统事件：你发给对方的转账被对方退还了（¥${m.tr.amount}${m.tr.note ? `，备注"${m.tr.note}"` : ''}）。请用符合人设的一两句话自然回应这件事。）`);
      } else if (m.kind === 'family' && m.fam) {
        setMsgs((prev) => [
          ...prev.map((x) => (x.id === m.id && x.fam ? { ...x, fam: { ...x.fam, rejected: true } } : x)),
          { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'notice', notice: { icon: 'fam', pre: `你退回了${peer.name}的`, accent: '亲属卡' } },
        ]);
        setDetailId(null);
        onToast('亲属卡已退还');
        runAiTurnRef.current?.(null, [], `（系统事件：你送给对方的亲属卡被对方退还了（每月额度¥${m.fam.monthlyLimit}）。请用符合人设的一两句话自然回应这件事。）`);
      }
    },
    [peer.name, onToast]
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || isChatStreaming(sessionKey)) return;
    const userMsg: WxMsg = { id: uid(), role: 'me', content: text, time: Date.now(), quote: quote ?? undefined };
    setInput('');
    setQuote(null);
    // 给自己发消息（「我」详情页「发消息」入口）：只记录，不触发 AI 回复
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
  }, [input, me, peer, runAiTurn, sessionKey, sentenceSend, quote]);

  /** 分句发送批次触发：把已发出的整批消息交给 AI 统一回复（输入框为空时点「发送」） */
  const dispatchBatch = useCallback(() => {
    if (!pendingDispatch || isChatStreaming(sessionKey)) return;
    setPendingDispatch(false);
    markPendingBatch(sessionKey, false);
    runAiTurn(null);
  }, [pendingDispatch, runAiTurn, sessionKey]);

  // ---------------- 气泡长按菜单：复制/删除/编辑/引用/多选/撤回/转发/收藏/重新生成 ----------------

  /** 消息的可复制/引用文本快照（表情/图片/位置/卡片/转发都有占位描述） */
  const quoteContentOf = (m: WxMsg): string =>
    m.kind === 'sticker'
      ? m.stk?.meaning
        ? `[表情] ${m.stk.meaning}`
        : '[表情]'
      : m.kind === 'image'
        ? '[图片]'
        : m.kind === 'location'
          ? `[位置] ${m.loc?.name ?? ''}`
          : m.kind === 'redpacket' && m.rp
            ? `[红包] ¥${m.rp.amount} ${m.rp.blessing}`
            : m.kind === 'transfer' && m.tr
              ? `[转账] ¥${m.tr.amount}${m.tr.note ? ` ${m.tr.note}` : ''}`
              : m.kind === 'family' && m.fam
                ? '[亲属卡]'
                : m.kind === 'forward'
                  ? m.fwd?.merged
                    ? `[聊天记录] ${m.fwd.title ?? m.content}`
                    : `[转发] ${m.content}`
                  : m.content;

  /** 消息是否可长按弹菜单 / 多选勾选（通知行与已撤回行除外） */
  const isSelectable = (m: WxMsg): boolean => m.kind !== 'notice' && !m.recalled;

  /** 按发送方与消息类型组装长按菜单项（我的/AI 气泡都可：复制 删除 编辑 引用 多选 撤回 转发 收藏；AI 气泡多一个重新生成；已收藏的消息显示「已收藏」） */
  const buildMsgMenuItems = (m: WxMsg): BubbleMenuItem[] => {
    const B = BUBBLE_MENU_ICONS;
    const isText = !m.kind || m.kind === 'text';
    const items: BubbleMenuItem[] = [{ key: 'copy', label: '复制', icon: B.copy }];
    items.push({ key: 'del', label: '删除', icon: B.del, danger: true });
    if (isText) items.push({ key: 'edit', label: '编辑', icon: B.edit });
    if (isText) items.push({ key: 'quote', label: '引用', icon: B.quote });
    items.push({ key: 'multi', label: '多选', icon: B.multi });
    items.push({ key: 'recall', label: '撤回', icon: B.recall });
    items.push({ key: 'forward', label: '转发', icon: B.forward });
    items.push({ key: 'fav', label: isMsgFavorited('wx', m.id) ? '已收藏' : '收藏', icon: B.fav, filled: isMsgFavorited('wx', m.id) });
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
  const favOf = (m: WxMsg): Omit<MsgFavorite, 'id' | 'app' | 'savedAt'> => ({
    contactId: peer.id,
    contactName: peer.name,
    contactAvatar: peer.avatar,
    msgRole: m.role,
    kind: m.kind ?? 'text',
    content: quoteContentOf(m),
    msgId: m.id,
    imgSrc: m.kind === 'image' ? m.img?.src : undefined,
    stkUrl: m.kind === 'sticker' ? m.stk?.url : undefined,
    time: m.time,
  });

  /** 重新生成：删除该条 AI 回复所在轮次及其后的全部消息（包括我又发出去的消息），
   *  以剩余历史重新发起请求（回复条数按本会话设置重新连发）；任意历史 AI 气泡都可触发 */
  const regenerate = (m: WxMsg) => {
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
  const forwardClone = (m: WxMsg): WxMsg => {
    const id = uid();
    if (m.fwd?.merged) return { id, role: 'me', content: m.content, time: Date.now(), kind: 'forward', fwd: { from: m.fwd.from, merged: true, title: m.fwd.title, records: m.fwd.records } };
    if (m.kind === 'sticker' && m.stk) return { id, role: 'me', content: '', time: Date.now(), kind: 'sticker', stk: { url: m.stk.url, meaning: m.stk.meaning } };
    if (m.kind === 'image' && m.img) return { id, role: 'me', content: '', time: Date.now(), kind: 'image', img: { ...m.img } };
    if (m.kind === 'location' && m.loc) return { id, role: 'me', content: '', time: Date.now(), kind: 'location', loc: { ...m.loc } };
    const isCard = m.kind === 'redpacket' || m.kind === 'transfer' || m.kind === 'family';
    return { id, role: 'me', content: isCard ? quoteContentOf(m) : m.content, time: Date.now(), kind: 'forward', fwd: { from: peer.name }, quote: m.quote };
  };

  /** 转发目标：微信好友（排除当前会话）+ 自己（文件传输助手式入口） */
  const forwardTargets = useMemo(() => {
    const list = contacts.filter((c) => c.kind !== 'user' && c.id !== peer.id && isFriendIn(c, 'wx'));
    const self = contacts.find((c) => c.id === me.id);
    return self ? [self, ...list] : list;
  }, [contacts, peer.id, me.id]);

  /** 执行转发（逐条/合并）：写入目标会话存储 + 未读角标 + 给目标 AI 排感知事件（打开会话即触发 AI 回应） */
  const doForward = (mode: FwdMode, ids: string[], target: FwdSheetTarget) => {
    const list = msgs.filter((m) => ids.includes(m.id));
    if (list.length === 0 || target.id === peer.id) return;
    const nameOf = (m: WxMsg) => (m.role === 'me' ? me.name : peer.name);
    if (mode === 'each') {
      // 逐条转发：按时间顺序每条克隆成独立消息
      saveMsgs(target.id, [...loadMsgs(target.id), ...list.map(forwardClone)]);
    } else {
      // 合并转发：合成一张「聊天记录」卡片（标题 = 我与对方，内嵌逐条对话，点击可看全文）
      const title = fwdRecordTitle(me.name, peer.name);
      const card: WxMsg = {
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
            imgSrc: m.kind === 'sticker' ? m.stk?.url : m.kind === 'image' ? m.img?.src : undefined,
            stkMeaning: m.kind === 'sticker' ? m.stk?.meaning : undefined,
          })),
        },
      };
      saveMsgs(target.id, [...loadMsgs(target.id), card]);
    }
    // 逐条转发 N 条 → 角标 +N；合并转发是 1 张卡片 → 角标 +1
    wxUnreads.bump(target.id, mode === 'each' ? list.length : 1);
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
      case 'copy':
        copyTextWithToast(quoteContentOf(m), onToast);
        break;
      case 'del': {
        if (isChatStreaming(sessionKey)) {
          onToast('对方正在回复，请稍后再试');
          return;
        }
        setMsgs((prev) => prev.filter((x) => x.id !== m.id));
        onToast('已删除');
        break;
      }
      case 'edit':
        setEditMsg(m);
        setEditDraft(m.content);
        break;
      case 'quote':
        setQuote({ name: m.role === 'me' ? me.name : peer.name, content: quoteContentOf(m) });
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
        setMsgs((prev) => prev.map((x) => (x.id === m.id ? { ...x, recalled: true } : x)));
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
        if (isMsgFavorited('wx', m.id)) {
          unfavoriteMsg('wx', m.id);
          onToast('取消收藏');
          break;
        }
        addFavorite('wx', favOf(m));
        onToast('收藏成功');
        break;
      case 'regen':
        regenerate(m);
        break;
    }
  };

  /** 编辑保存：更新该条消息内容（quote 等字段保留），自动落盘 */
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
    setMsgs((prev) => prev.filter((x) => !ids.has(x.id)));
    onToast(`已删除 ${selectedIds.length} 条消息`);
    exitSelect();
  };

  /** 多选批量收藏（已收藏过的消息自动跳过） */
  const batchFav = () => {
    const list = msgs.filter((x) => selectedIds.includes(x.id));
    if (list.length === 0) return;
    const fresh = list.filter((m) => !isMsgFavorited('wx', m.id));
    if (fresh.length === 0) {
      onToast('所选消息均已收藏');
      exitSelect();
      return;
    }
    for (const m of fresh) addFavorite('wx', favOf(m));
    onToast(fresh.length === list.length ? `已收藏 ${fresh.length} 条消息` : `已收藏 ${fresh.length} 条（${list.length - fresh.length} 条已收藏过）`);
    exitSelect();
  };

  /** 多选批量转发（进入聊天内勾选模式，可继续增删、选逐条/合并） */
  const batchForward = () => {
    if (selectedIds.length === 0) return;
    setFwdFlow('choose');
  };

  const selfChat = peer.id === me.id;

  /** 空输入时可点「发送」触发批次回复（分句发送开启且有未回复的批次） */
  const canDispatch = sentenceSend && pendingDispatch && !streaming && !selfChat;

  /** 发红包提交：校验 → 开启支付密码先验证 → 扣款（按支付方式）并插卡消息 */
  const submitRedPacket = (amount: number, blessing: string, methodId: string) => {
    if (!wxCanPay(methodId, amount)) {
      onToast(methodId === 'balance' ? '零钱不足，请先充值' : methodId.startsWith('fcin-') ? '亲属卡本月额度不足' : '卡内余额不足，请更换支付方式');
      return;
    }
    const pp = wxLoadPayPwd();
    if (pp.enabled && pp.pwd) {
      setGate({ kind: 'redpacket', amount, blessing, methodId });
      return;
    }
    execRedPacket(amount, blessing, methodId);
  };

  const execRedPacket = (amount: number, blessing: string, methodId: string) => {
    if (!wxExecutePayment(methodId, amount, '红包')) {
      onToast(methodId === 'balance' ? '零钱不足，请先充值' : methodId.startsWith('fcin-') ? '亲属卡本月额度不足' : '卡内余额不足，请更换支付方式');
      return;
    }
    // 生成 AI 可引用的短 ID；发出后立即触发 AI 回复（红包进待处理清单，AI 按人设决定领取/退回/拒收）
    const msg: WxMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'redpacket', rp: { amount, blessing, opened: false, cid: nextWxCid('rp') } };
    setMsgs((prev) => [...prev, msg]);
    setCompose(null);
    if (peer.id !== me.id) runAiTurnRef.current?.(null, [msg]);
  };

  /** 发转账提交：校验 → 开启支付密码先验证 → 扣款（按支付方式）并插卡消息；对方打开详情时确认收款 */
  const submitTransfer = (amount: number, note: string, methodId: string) => {
    if (!wxCanPay(methodId, amount)) {
      onToast(methodId === 'balance' ? '零钱不足，请先充值' : methodId.startsWith('fcin-') ? '亲属卡本月额度不足' : '卡内余额不足，请更换支付方式');
      return;
    }
    const pp = wxLoadPayPwd();
    if (pp.enabled && pp.pwd) {
      setGate({ kind: 'transfer', amount, note, methodId });
      return;
    }
    execTransfer(amount, note, methodId);
  };

  const execTransfer = (amount: number, note: string, methodId: string) => {
    if (!wxExecutePayment(methodId, amount, '转账')) {
      onToast(methodId === 'balance' ? '零钱不足，请先充值' : methodId.startsWith('fcin-') ? '亲属卡本月额度不足' : '卡内余额不足，请更换支付方式');
      return;
    }
    // 生成 AI 可引用的短 ID；发出后立即触发 AI 回复（AI 按人设决定收款/退回/拒收）
    const msg: WxMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'transfer', tr: { amount, note, received: false, cid: nextWxCid('tr') } };
    setMsgs((prev) => [...prev, msg]);
    setCompose(null);
    if (peer.id !== me.id) runAiTurnRef.current?.(null, [msg]);
  };

  /** 領红包（仅限对方发的）：金额存入零钱 + 记收入账单 + 聊天里发「你领取了XX的红包」提示行 → 进详情；自己发的红包不能自己领 */
  const openRedPacket = (id: string) => {
    const m = msgs.find((x) => x.id === id);
    if (!m?.rp || m.rp.opened || m.rp.status || m.role !== 'peer') return;
    wxPatchBalance(m.rp.amount, { kind: '红包', amount: m.rp.amount });
    // 领取提示行（居中灰字 + 金色尾词）：与对方领取我的红包同款样式
    const notice: WxMsg = { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'notice', notice: { icon: 'rp', pre: `你领取了${peer.name}的`, accent: '红包' } };
    setMsgs((prev) => [
      ...prev.map((x) => (x.id === id && x.rp ? { ...x, rp: { ...x.rp, opened: true, openedAt: Date.now(), openedBy: me.name } } : x)),
      notice,
    ]);
    setOpeningId(null);
    setDetailId(id);
  };

  /** 打开红包详情（我发的红包由 AI 用动作标记处理，这里只看详情） */
  const openRedPacketDetail = (id: string) => {
    setDetailId(id);
  };

  /** 打开转账详情（我发的转账由 AI 用动作标记决定收款/退回/拒收，这里只看详情） */
  const openTransferDetail = (id: string) => {
    setDetailId(id);
  };

  /** 收款（对方发来的转账，收款页点「收款」）：原卡标记已收款 + 金额入零钱 + 记收入账单
   *  + 追加我的「已收款」接收卡片（receiptOf=peer，详情页显示「你已收款」）——与 AI 收我转账的凭据卡同款、方向相反 */
  const acceptTransfer = (id: string) => {
    const m = msgs.find((x) => x.id === id);
    if (!m?.tr || m.tr.received) return;
    wxPatchBalance(m.tr.amount, { kind: '转账', amount: m.tr.amount });
    const receipt: WxMsg = {
      id: uid(),
      role: 'me',
      content: '',
      time: Date.now(),
      kind: 'transfer',
      tr: { amount: m.tr.amount, note: m.tr.note, received: true, receivedAt: Date.now(), receiptOf: 'peer' },
    };
    setMsgs((prev) => [
      // 原卡也标记 receiptOf='peer'（我收的款）：打开原卡详情显示「你已收款」而非「XX已收款」
      ...prev.map((x) => (x.id === id && x.tr ? { ...x, tr: { ...x.tr, received: true, receivedAt: Date.now(), receiptOf: 'peer' as const } } : x)),
      receipt,
    ]);
    setReceiveId(null);
    setDetailId(id);
    onToast(`已收款 ¥${fmtMoney(m.tr.amount)}`);
  };

  /** 原生相机/相册选到的图片发送（压缩 dataURL，最多 9 张；相机拍摄单张也走这里）。
   *  已配置识图模型时：发图触发 AI 回合（识图模型先看图，聊天模型再回复）；
   *  未配置时保持旧行为（图片只入聊天记录，不触发回复） */
  const sendImageFiles = async (files: FileList) => {
    const created: WxMsg[] = [];
    for (const f of Array.from(files).slice(0, 9)) {
      try {
        const d = await readImageFile(f);
        const msg: WxMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'image', img: { src: d } };
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
  };

  /** 发送位置卡片消息（内置地点 / 自定义位置） */
  const sendLocation = (name: string, address: string) => {
    setPlusOpen(false);
    setMsgs((prev) => [...prev, { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'location', loc: { name, address } }]);
    setCompose(null);
  };

  /** 发送表情消息（表情面板点选；AI 通过 stk.meaning 理解表情含义并据此回复） */
  const sendSticker = (s: Sticker) => {
    setStickerOpen(false);
    const msg: WxMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'sticker', stk: { url: s.url, meaning: s.meaning } };
    if (peer.id === me.id) {
      setMsgs((prev) => [...prev, msg]);
      return;
    }
    void runAiTurn(msg);
  };

  /** 打开亲属卡详情（我发的卡由 AI 用动作标记决定收下/拒收，这里只看详情） */
  const openFamilyDetail = (id: string) => {
    setDetailId(id);
  };

  /** 领取好友发来的亲属卡：claimed=true + 存入「我收到的亲属卡」（发红包/转账可用它支付） */
  const claimFamily = (id: string) => {
    const m = msgs.find((x) => x.id === id);
    if (!m?.fam || m.fam.claimed) return;
    const now = Date.now();
    setMsgs((prev) => prev.map((x) => (x.id === id && x.fam ? { ...x, fam: { ...x.fam, claimed: true, claimedAt: now } } : x)));
    const list = loadFamilyCardsIn();
    if (!list.some((f) => f.fromName === peer.name)) {
      saveFamilyCardsIn([
        ...list,
        {
          id: `fcin-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          friendId: peer.id,
          fromName: peer.name,
          fromAvatar: peer.avatar,
          relation: m.fam.relation,
          monthlyLimit: m.fam.monthlyLimit,
          used: 0,
          createdAt: now,
        },
      ]);
    }
    onToast('已领取，发红包/转账时可用它支付');
  };

  const handlePlusAction = (a: PlusAction) => {
    if (a === 'redpacket') {
      setPlusOpen(false);
      setStickerOpen(false);
      setCompose('redpacket');
      return;
    }
    if (a === 'transfer') {
      setPlusOpen(false);
      setCompose('transfer');
      return;
    }
    if (a === 'camera') {
      // 直接调用手机原生相机（input capture 调起后置摄像头），不再使用自建取景页
      setPlusOpen(false);
      setStickerOpen(false);
      cameraInputRef.current?.click();
      return;
    }
    if (a === 'image') {
      // 直接调用手机原生相册（系统图片选择器，可多选），不再使用自建相册页
      setPlusOpen(false);
      setStickerOpen(false);
      photoInputRef.current?.click();
      return;
    }
    if (a === 'location') {
      setPlusOpen(false);
      setCompose('location');
      return;
    }
    const label: Record<string, string> = { voicecall: '语音通话', videocall: '视频通话', favorite: '收藏' };
    onToast(`${label[a] ?? '该功能'}暂未开放`);
  };

  // ---- 聊天设置：置顶 / 免打扰 / 聊天背景 / 查找聊天记录 ----

  const handlePickBgColor = useCallback(
    (c: string) => {
      wxChatFlagsStore.update(peer.id, { bgMode: 'color', bgColor: c, bgV: Date.now() });
    },
    [peer.id]
  );

  const handleResetBg = useCallback(() => {
    void removeChatBgImage('wx', peer.id).catch(() => undefined);
    wxChatFlagsStore.update(peer.id, { bgMode: 'default', bgV: Date.now() });
  }, [peer.id]);

  const handleUploadBg = useCallback(
    async (file: File) => {
      setUploadingBg(true);
      try {
        const data = await readImageFile(file, 1280);
        await setChatBgImage('wx', peer.id, data);
        wxChatFlagsStore.update(peer.id, { bgMode: 'image', bgV: Date.now() });
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
              : m.kind === 'redpacket' && m.rp
                ? `[红包] ${m.rp.blessing}`
                : m.kind === 'transfer' && m.tr
                  ? `[转账] ${m.tr.note}`
                  : m.kind === 'family'
                    ? '[亲属卡]'
                    : m.kind === 'location' && m.loc
                      ? `[位置] ${m.loc.name}${m.loc.address ? ` ${m.loc.address}` : ''}`
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
    <div ref={pageRef} className="absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      {/* 聊天背景层（聊天设置页设置：纯色/图片；顶栏与输入栏自身有底色，不受影响） */}
      {bg.mode !== 'default' && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0" style={chatBgLayerStyle(bg, bgImageUrl)} />
      )}
      {/* 顶栏：与消息区/底部输入栏同色（微信灰，非白）；多选模式下变为「取消 + 已选计数」操作栏 */}
      <div className="relative z-10 shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        {selectMode ? (
          fwdFlow === 'choose' ? (
            /* 转发勾选模式顶栏（对照原生微信多选转发：取消 + 已选择计数 + 搜索） */
            <div className="flex h-11 items-center px-2">
              <button
                type="button"
                data-testid="wx-select-cancel"
                onClick={exitSelect}
                className="flex items-center px-1 text-[16px] active:opacity-50"
              >
                取消
              </button>
              <div className="flex flex-1 items-center justify-center">
                <span data-testid="wx-select-count" className="text-[17px] font-medium">已选择 {selectedIds.length} 条消息</span>
              </div>
              <button
                type="button"
                aria-label="搜索"
                data-testid="wx-fwd-search"
                onClick={() => onToast('搜索转发消息暂未开放')}
                className="flex w-[68px] justify-end px-2 active:opacity-50"
              >
                <Search className="h-[19px] w-[19px]" strokeWidth={2} />
              </button>
            </div>
          ) : (
          <div className="flex h-11 items-center px-2">
            <button
              type="button"
              data-testid="wx-select-cancel"
              onClick={exitSelect}
              className="flex items-center px-1 text-[16px] active:opacity-50"
            >
              取消
            </button>
            <div className="flex flex-1 items-center justify-center">
              <span data-testid="wx-select-count" className="text-[17px] font-medium">已选 {selectedIds.length} 条消息</span>
            </div>
            <div className="w-[68px]" />
          </div>
          )
        ) : (
        <div className="flex h-11 items-center px-2">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-chat-back"
            onClick={onBack}
            className="flex items-center px-1 active:opacity-50"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          {otherUnread > 0 && (
            <span
              data-testid="wx-chat-back-badge"
              aria-label={`${otherUnread} 条未读`}
              className="-ml-0.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-black/[0.08] px-[5px] text-[12px] font-medium leading-none text-black/75 dark:bg-white/[0.16] dark:text-white/85"
            >
              {otherUnread > 99 ? '99+' : otherUnread}
            </span>
          )}
          <div className="flex flex-1 items-center justify-center gap-1.5" data-testid="wx-chat-peer-name">
            <span className="truncate text-[17px] font-medium">{streaming ? '正在输入中…' : peer.name}</span>
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
            aria-label="聊天信息"
            data-testid="wx-chat-settings-entry"
            className="px-2 active:opacity-50"
            onClick={() => setSettingsOpen(true)}
          >
            <EllipsisGlyph />
          </button>
        </div>
        )}
      </div>

      {/* 消息列表：浅灰背景（同微信），自定义聊天背景时透出背景层 */}
      <div ref={scrollRef} className="relative z-10 min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {msgs.length === 0 && (
          <p className="mt-16 text-center text-[13px] text-black/35 dark:text-white/35">
            {selfChat ? '给自己发条消息吧' : `和 ${peer.name} 打个招呼吧`}
          </p>
        )}
        {msgs.map((m, i) => (
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
            className={`rounded-[10px] transition-colors duration-500 ${
              highlightId === m.id ? 'bg-[#07C160]/15 ring-1 ring-[#07C160]/50' : ''
            }`}
          >
            {/* 时间分隔（同微信）：首条或与上一条间隔超 5 分钟时显示 */}
            {(i === 0 || m.time - msgs[i - 1].time > 5 * 60_000) && (
              <p className="py-2 text-center text-[12px] text-black/35 dark:text-white/35">{fmtChatTime(m.time)}</p>
            )}
            {m.recalled ? (
              /* 已撤回：居中灰字（你撤回一条消息 / 对方撤回一条消息） */
              <p data-testid="wx-recall-row" className="py-1.5 text-center text-[12.5px] text-black/35 dark:text-white/35">
                {m.role === 'me' ? '你撤回一条消息' : '对方撤回一条消息'}
              </p>
            ) : m.kind === 'notice' && m.notice ? (
              <WxNoticeRow icon={m.notice.icon} pre={m.notice.pre} accent={m.notice.accent} />
            ) : (
            <div className={`flex items-start py-1.5 ${m.kind === 'image' || m.kind === 'sticker' ? 'gap-[3px]' : 'gap-2'} ${m.role === 'me' ? 'flex-row-reverse' : ''}`}>
              {selectMode && isSelectable(m) && (
                /* 多选模式勾选圈（我的消息在行右侧、对方在行左侧；转发勾选模式全部放左侧，对照原生微信） */
                <span
                  aria-hidden="true"
                  data-testid={`wx-select-${m.id}`}
                  className={`mt-2 flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border ${
                    fwdFlow === 'choose' && m.role === 'me' ? 'order-last' : ''
                  } ${
                    selectedIds.includes(m.id) ? 'border-[#07C160] bg-[#07C160] text-white' : 'border-black/25 dark:border-white/35'
                  }`}
                >
                  {selectedIds.includes(m.id) && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}
                </span>
              )}
              <WxAvatar src={m.role === 'me' ? me.avatar : peer.avatar} alt={m.role === 'me' ? me.name : peer.name} size={38} />
              {m.kind === 'redpacket' && m.rp ? (
                <RpBubble
                  blessing={m.rp.blessing}
                  sub={m.rp.status === 'returned' ? '已退回' : m.rp.status === 'rejected' ? '已拒收' : m.rp.opened ? '已领取' : '待领取'}
                  settled={m.rp.opened || Boolean(m.rp.status)}
                  onClick={() => {
                    // 自己发的红包不能领：直接进详情；已到终态进详情；对方发的未处理弹「開」
                    if (m.rp?.opened || m.rp?.status) setDetailId(m.id);
                    else if (m.role === 'me') openRedPacketDetail(m.id);
                    else setOpeningId(m.id);
                  }}
                />
              ) : m.kind === 'transfer' && m.tr ? (
                <TrBubble
                  amount={m.tr.amount}
                  note={m.tr.note}
                  settled={m.tr.received === true || Boolean(m.tr.status)}
                  status={
                    m.tr.status === 'returned'
                      ? '已退还'
                      : m.tr.status === 'rejected'
                        ? '已拒收'
                        : m.tr.received
                          ? m.role === 'me'
                            ? '已转入对方零钱'
                            : '已收款'
                          : m.role === 'me'
                            ? '待对方收款'
                            : '向你转账'
                  }
                  received={m.tr.received === true}
                  refunded={m.tr.status === 'returned'}
                  fromMe={m.role === 'me'}
                  onClick={() =>
                    // 对方发来的未收款且未退还的转账 → 收款页（时钟+待你收款+收款）；其余 → 交易详情
                    m.role === 'peer' && m.tr?.received !== true && !m.tr?.status ? setReceiveId(m.id) : openTransferDetail(m.id)
                  }
                />
              ) : m.kind === 'family' && m.fam ? (
                <FamilyBubble
                  title={`给${m.role === 'me' ? peer.name : me.name}的亲属卡`}
                  sub={m.fam.rejected ? '已退回' : m.fam.claimed ? (m.role === 'me' ? '对方已领取' : '已领取') : m.role === 'me' ? '待对方领取' : '待你领取'}
                  settled={m.fam.claimed === true || m.fam.rejected === true}
                  onClick={() => (m.role === 'me' ? openFamilyDetail(m.id) : setDetailId(m.id))}
                />
              ) : m.kind === 'image' && m.img ? (
                <div {...bubblePress}>
                  <ImageMsgBubble src={m.img.src} onClick={() => setViewerSrc(m.img?.src ?? null)} />
                </div>
              ) : m.kind === 'location' && m.loc ? (
                <div {...bubblePress}>
                  <LocBubble name={m.loc.name} address={m.loc.address} onClick={() => setLocViewId(m.id)} />
                </div>
              ) : m.kind === 'sticker' && m.stk ? (
                <div {...bubblePress}>
                  <StickerMsgBubble
                    src={m.stk.url}
                    meaning={m.stk.meaning}
                    onClick={() => {
                      setViewerSrc(m.stk?.url ?? null);
                      if (m.stk?.meaning) onToast(`表情：${m.stk.meaning}`);
                    }}
                  />
                </div>
              ) : m.kind === 'forward' && m.fwd?.merged ? (
                /* 合并转发「聊天记录」卡片（原生微信同款：两面都白底）：标题 + 逐条预览 + 「聊天记录」脚注；点击进详情 */
                <div
                  {...bubblePress}
                  data-testid="wx-forward-bubble"
                  onClick={() => {
                    if (!selectMode) setFwdDetailId(m.id);
                  }}
                  className="relative w-fit max-w-[calc(100%-92px)] select-none rounded-[5px] bg-white px-3 py-2 text-black dark:bg-[#1E1E1E] dark:text-white"
                >
                  <p className="text-[15.5px] font-semibold leading-[1.35]">{m.fwd.title ?? m.content}</p>
                  <div className="mt-1 space-y-[1px] text-[13.5px] leading-[1.5] text-black/55 dark:text-white/60">
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
                  data-testid="wx-forward-bubble"
                  className={`relative w-fit max-w-[calc(100%-92px)] select-none rounded-[5px] px-3 py-2 ${
                    m.role === 'me'
                      ? 'bg-[#95EC69] text-black dark:bg-[#3EB575]'
                      : 'bg-white text-black dark:bg-[#1E1E1E] dark:text-white'
                  }`}
                >
                  <div className="line-clamp-8 whitespace-pre-wrap break-words border-l-2 border-black/25 pl-2 text-[14px] leading-[1.4]">
                    {m.quote && (
                      <span className="mb-0.5 block text-[12px] text-black/50 dark:text-black/55">
                        {m.quote.name}：{m.quote.content}
                      </span>
                    )}
                    {m.content}
                  </div>
                </div>
              ) : (
                <div className={`flex min-w-0 max-w-[calc(100%-92px)] flex-col ${m.role === 'me' ? 'items-end' : 'items-start'}`}>
                  <div
                    {...bubblePress}
                    className={`relative w-fit max-w-full select-none whitespace-pre-wrap break-words rounded-[5px] px-3 py-2 text-[16px] leading-[1.45] ${
                      m.role === 'me'
                        ? 'bg-[#95EC69] text-black dark:bg-[#3EB575] dark:text-black'
                        : 'bg-white text-black dark:bg-[#1E1E1E] dark:text-white'
                    }`}
                  >
                    {/* 气泡小三角（微信同款） */}
                    <span
                      aria-hidden="true"
                      className={`absolute top-[11px] h-[8px] w-[8px] rotate-45 ${
                        m.role === 'me'
                          ? '-right-[3px] bg-[#95EC69] dark:bg-[#3EB575]'
                          : '-left-[3px] bg-white dark:bg-[#1E1E1E]'
                      }`}
                    />
                    {/* 引用块（菜单「引用」发送的消息）：名字 + 内容小字嵌在气泡顶部 */}
                    {m.quote && (
                      <div
                        data-testid="wx-quote-block"
                        className={`mb-1 max-w-full overflow-hidden rounded-[4px] px-2 py-1 text-[12.5px] leading-[1.35] ${
                          m.role === 'me'
                            ? 'bg-black/[0.08] text-black/60'
                            : 'bg-black/[0.05] text-black/50 dark:bg-white/10 dark:text-white/60'
                        }`}
                      >
                        <p className="line-clamp-2 whitespace-pre-wrap break-all">
                          {m.quote.name}：{m.quote.content}
                        </p>
                      </div>
                    )}
                    {m.content ? (
                      m.content
                    ) : (
                      <span className="flex h-[23px] items-center gap-1" aria-label="对方正在输入">
                        <span className="h-[6px] w-[6px] animate-bounce rounded-full bg-black/25 dark:bg-white/35" />
                        <span className="h-[6px] w-[6px] animate-bounce rounded-full bg-black/25 [animation-delay:150ms] dark:bg-white/35" />
                        <span className="h-[6px] w-[6px] animate-bounce rounded-full bg-black/25 [animation-delay:300ms] dark:bg-white/35" />
                      </span>
                    )}
                  </div>
                  {/* 翻译开启时在气泡下方显示所选语言的译文 */}
                  {renderTranslations(m.id, m.content)}
                </div>
              )}
            </div>
            )}
          </div>
        ))}
        {/* 全局流式回复气泡（聊天页外发起的流 / 退出后重进同样从这里实时渲染；与上方 peer 文字气泡同款样式）。
            回复条数 > 1 时按边界（标记/换行/句末标点，一句一条）实时切成多个气泡，下一句没打完时显示打字中动画（一句一句连发节奏） */}
        {stream && stream.status === 'streaming' &&
          (() => {
            const split = splitReplyRender(stream.content, (stream.replyCount ?? 1) > 1);
            const showTime = msgs.length === 0 || stream.startedAt - msgs[msgs.length - 1].time > 5 * 60_000;
            return (
              <div key={stream.aiMsgId} data-testid="wx-stream-bubble">
                {showTime && (
                  <p className="py-2 text-center text-[12px] text-black/35 dark:text-white/35">{fmtChatTime(stream.startedAt)}</p>
                )}
                {/* 识图失败系统提示：只作展示，不进对话上下文、不当角色台词 */}
                {stream.visionNotice && (
                  <p data-testid="wx-vision-notice" className="py-1 text-center text-[12px] leading-relaxed text-black/40 dark:text-white/40">
                    {stream.visionNotice}
                  </p>
                )}
                {split.texts.map((t, i) => (
                  <div className="flex items-start gap-2 py-1.5" key={i} data-testid={`wx-stream-bubble-${i}`}>
                    <WxAvatar src={peer.avatar} alt={peer.name} size={38} />
                    <div className="relative max-w-[calc(100%-92px)] whitespace-pre-wrap break-words rounded-[5px] bg-white px-3 py-2 text-[16px] leading-[1.45] text-black dark:bg-[#1E1E1E] dark:text-white">
                      <span
                        aria-hidden="true"
                        className="absolute -left-[3px] top-[11px] h-[8px] w-[8px] rotate-45 bg-white dark:bg-[#1E1E1E]"
                      />
                      {stickersOn ? prettifyRichText(t) : stripEmojiText(prettifyRichText(t).replace(/\[表情包\]/g, ' '))}
                    </div>
                  </div>
                ))}
                {(split.pending || split.texts.length === 0) && (
                  <div className="flex items-start gap-2 py-1.5" data-testid="wx-stream-typing">
                    <WxAvatar src={peer.avatar} alt={peer.name} size={38} />
                    <div className="relative max-w-[calc(100%-92px)] rounded-[5px] bg-white px-3 py-2 dark:bg-[#1E1E1E]">
                      <span
                        aria-hidden="true"
                        className="absolute -left-[3px] top-[11px] h-[8px] w-[8px] rotate-45 bg-white dark:bg-[#1E1E1E]"
                      />
                      <span className="flex h-[23px] items-center gap-1" aria-label="对方正在输入">
                        <span className="h-[6px] w-[6px] animate-bounce rounded-full bg-black/25 dark:bg-white/35" />
                        <span className="h-[6px] w-[6px] animate-bounce rounded-full bg-black/25 [animation-delay:150ms] dark:bg-white/35" />
                        <span className="h-[6px] w-[6px] animate-bounce rounded-full bg-black/25 [animation-delay:300ms] dark:bg-white/35" />
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
      </div>

      {/* 底部：输入栏 + 加号面板（面板展开时输入栏保持在上方）；多选模式下变为批量删除/分享/收藏操作栏 */}
      <div className="relative z-10 shrink-0 bg-[#EDEDED] dark:bg-[#111111]">
        {selectMode ? (
          <div className="flex items-center justify-around px-6 pb-[26px] pt-3" data-testid="wx-select-bar">
            <button
              type="button"
              data-testid="wx-select-del"
              disabled={selectedIds.length === 0}
              onClick={batchDelete}
              className="flex flex-col items-center gap-1 text-[12px] text-[#FA5151] disabled:opacity-35"
            >
              <Trash2 className="h-[21px] w-[21px]" strokeWidth={1.9} />
              删除
            </button>
            <button
              type="button"
              data-testid="wx-select-forward"
              disabled={selectedIds.length === 0}
              onClick={batchForward}
              className="flex flex-col items-center gap-1 text-[12px] text-black/75 disabled:opacity-35 dark:text-white/75"
            >
              <Forward className="h-[21px] w-[21px]" strokeWidth={1.9} />
              分享
            </button>
            <button
              type="button"
              data-testid="wx-select-fav"
              disabled={selectedIds.length === 0}
              onClick={batchFav}
              className="flex flex-col items-center gap-1 text-[12px] text-black/75 disabled:opacity-35 dark:text-white/75"
            >
              <Star className="h-[21px] w-[21px]" strokeWidth={1.9} />
              收藏
            </button>
          </div>
        ) : (
        <>
        {/* 引用条（长按菜单「引用」后显示在输入框上方；发送时挂到新消息上） */}
        {quote && (
          <div className="px-2.5 pt-2" data-testid="wx-quote-bar">
            <div className="flex items-start gap-2 rounded-[6px] bg-black/[0.05] px-2.5 py-1.5 dark:bg-white/[0.08]">
              <p className="min-w-0 flex-1 truncate text-[12px] leading-[1.4] text-black/55 dark:text-white/55">
                引用 {quote.name}：{quote.content}
              </p>
              <button
                type="button"
                aria-label="取消引用"
                data-testid="wx-quote-cancel"
                onClick={() => setQuote(null)}
                className="shrink-0 text-black/35 active:opacity-60 dark:text-white/35"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        )}
        <div className="px-2.5 pb-[18px] pt-2">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              aria-label="语音输入"
              onClick={() => onToast('语音输入暂未开放')}
              className="shrink-0 active:opacity-70"
            >
              <span className="flex h-[35px] w-[35px] items-center justify-center rounded-full border-[1.7px] border-black/75 bg-transparent text-black/85 transition-colors active:bg-black/[0.06] dark:border-white/70 dark:text-white/85 dark:active:bg-white/10">
                <VoiceWaveGlyph size={20} />
              </span>
            </button>
            <input
              data-testid="wx-chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send();
              }}
              placeholder=""
              className="h-9 min-w-0 flex-1 rounded-[6px] border border-black/10 bg-white px-3 text-[16px] outline-none dark:border-white/15 dark:bg-[#1A1A1A]"
            />
            {(input.trim() || canDispatch) ? (
              <button
                type="button"
                aria-label={input.trim() ? '发送' : '发送（让对方回复）'}
                data-testid="wx-chat-send"
                disabled={streaming}
                onClick={() => {
                  if (input.trim()) void send();
                  else dispatchBatch();
                }}
                className="shrink-0 rounded-[5px] bg-[#07C160] px-3.5 py-1.5 text-[14px] font-medium text-white active:bg-[#06AD56] disabled:opacity-50"
              >
                发送
              </button>
            ) : (
              <div className="flex shrink-0 items-center gap-[13px] text-black/80 dark:text-white/80">
                <button
                  type="button"
                  aria-label="表情"
                  data-testid="wx-chat-sticker"
                  aria-expanded={stickerOpen}
                  onClick={() => {
                    setPlusOpen(false);
                    setStickerOpen((v) => !v);
                  }}
                  className={`active:opacity-60 ${stickerOpen ? 'text-[#07C160]' : ''}`}
                >
                  <Smile className="h-[25px] w-[25px]" strokeWidth={1.7} />
                </button>
                <button
                  type="button"
                  aria-label="更多功能"
                  data-testid="wx-chat-plus"
                  onClick={() => {
                    setStickerOpen(false);
                    setPlusOpen((v) => !v);
                  }}
                  className="active:opacity-60"
                >
                  <CirclePlus className={`h-[26px] w-[26px] transition-transform duration-200 ${plusOpen ? 'rotate-45' : ''}`} strokeWidth={1.5} />
                </button>
              </div>
            )}
          </div>
        </div>
        {stickerOpen && <WxStickerPanel onPick={sendSticker} onClose={() => setStickerOpen(false)} onToast={onToast} />}
        {plusOpen && <PlusPanel onAction={handlePlusAction} />}
        </>
        )}
      </div>

      {/* 红包/转账发送页 + 位置功能页（相机/图片由加号面板直接调起手机原生相机/相册，无自建页面） */}
      {compose === 'redpacket' && <RedPacketCompose onBack={() => setCompose(null)} onSubmit={submitRedPacket} onToast={onToast} />}
      {compose === 'transfer' && <TransferCompose peer={peer} onBack={() => setCompose(null)} onSubmit={submitTransfer} onToast={onToast} />}
      {compose === 'location' && <LocationPickerPage onClose={() => setCompose(null)} onSend={sendLocation} onToast={onToast} />}
      {/* 原生相机/相册隐藏 input：相机单张（capture 调起后置摄像头）、图片可多选 */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void sendImageFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void sendImageFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {/* 支付密码验证浮层（开启支付密码后红包/转账发送前弹出自绘键盘） */}
      {gate && (
        <WxPayPwdGate
          label={`${gate.kind === 'redpacket' ? '发红包' : '转账'} ¥${fmtMoney(gate.amount)} 元`}
          onOk={() => {
            const g = gate;
            setGate(null);
            if (g.kind === 'redpacket') execRedPacket(g.amount, g.blessing ?? '恭喜发财，大吉大利', g.methodId);
            else execTransfer(g.amount, g.note ?? '', g.methodId);
          }}
          onClose={() => setGate(null)}
        />
      )}

      {/* 聊天设置页（右上角 ··· 进入）：信息卡片/置顶聊天/消息免打扰/回复条数/查找聊天记录/聊天背景 */}
      {settingsOpen && (
        <ChatSettingsPage
          variant="wx"
          title="聊天信息"
          peerName={peer.name}
          peerAvatar={peer.avatar}
          idLabel="微信号"
          idValue={peer.wechatId || peer.qqId || '未设置'}
          metaLine={[peer.region, peer.occupation].filter((x): x is string => Boolean(x)).join(' · ')}
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
          onTogglePinned={(v) => wxChatFlagsStore.update(peer.id, { pinned: v })}
          onToggleMuted={(v) => wxChatFlagsStore.update(peer.id, { muted: v })}
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
          onOpenPeerProfile={() => onOpenFriendDetail(peer)}
        />
      )}

      {/* 世界书挂载页（聊天设置二级页）：为联系人勾选挂载的书籍（按联系人隔离持久化） */}
      {wbOpen && (
        <WorldBookPickerPage
          variant="wx"
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
      )}

      {/* 翻译语言页（聊天设置二级页）：总开关 + 语言对双侧选择（按会话隔离保存） */}
      {translateOpen && (
        <ChatTranslatePage
          variant="wx"
          cfg={transCfg}
          onBack={() => setTranslateOpen(false)}
          onChange={(next) => {
            const n = normalizeTranslateCfg(next);
            saveTranslateCfg(sessionKey, n);
            setTransCfgState(n);
          }}
        />
      )}

      {/* 回复条数页（聊天设置二级页）：AI 按选定条数连发多条消息（按会话隔离保存） */}
      {replyOpen && (
        <ChatReplyCountPage
          variant="wx"
          value={replyCount}
          onBack={() => setReplyOpen(false)}
          onSelect={(n) => {
            saveReplyCount(sessionKey, n);
            setReplyCountState(n);
          }}
        />
      )}

      {/* 聊天背景页（聊天设置二级页）：预览卡片 + 从手机相册上传 + 内置纯色壁纸 */}
      {bgOpen && (
        <ChatBgPage
          variant="wx"
          bg={bg}
          bgImageUrl={bgImageUrl}
          uploading={uploadingBg}
          onBack={() => setBgOpen(false)}
          onPickColor={handlePickBgColor}
          onPickImageFile={(f) => void handleUploadBg(f)}
          onResetBg={handleResetBg}
        />
      )}

      {/* 查找聊天记录页：关键词过滤 → 点击结果定位回聊天页并高亮 */}
      {searchOpen && (
        <ChatSearchPage
          variant="wx"
          items={searchItems}
          myName={me.name}
          peerName={peer.name}
          myAvatar={me.avatar}
          peerAvatar={peer.avatar}
          onClose={() => setSearchOpen(false)}
          onJumpTo={jumpToMessage}
        />
      )}

      {/* 收款页（对方发来的未收款转账） */}
      {receiveMsg?.tr && (
        <WxTrReceivePage
          peerName={peer.name}
          amount={receiveMsg.tr.amount}
          note={receiveMsg.tr.note}
          payTime={receiveMsg.time}
          onBack={() => setReceiveId(null)}
          onAccept={() => acceptTransfer(receiveMsg.id)}
          onRefund={() => refundPeerCard(receiveMsg)}
        />
      )}

      {/* 開红包弹层 */}
      {openingMsg?.rp && (
        <RpOpenLayer
          senderName={openingMsg.role === 'me' ? me.name : peer.name}
          senderAvatar={openingMsg.role === 'me' ? me.avatar : peer.avatar}
          blessing={openingMsg.rp.blessing}
          onOpen={() => openRedPacket(openingMsg.id)}
          onClose={() => setOpeningId(null)}
          onRefund={openingMsg.role === 'peer' ? () => refundPeerCard(openingMsg) : undefined}
        />
      )}

      {/* 红包详情页 */}
      {detailMsg?.kind === 'redpacket' && detailMsg.rp && (() => {
        const claimer = detailMsg.rp.openedBy ?? (detailMsg.role === 'me' ? peer.name : me.name);
        return (
          <RpDetailPage
            senderName={detailMsg.role === 'me' ? me.name : peer.name}
            senderAvatar={detailMsg.role === 'me' ? me.avatar : peer.avatar}
            blessing={detailMsg.rp.blessing}
            amount={detailMsg.rp.amount}
            opened={detailMsg.rp.opened}
            statusLabel={detailMsg.rp.status === 'returned' ? '该红包已退回，金额已存入零钱' : detailMsg.rp.status === 'rejected' ? '对方拒收了该红包' : undefined}
            claimerName={claimer}
            claimerAvatar={claimer === me.name ? me.avatar : peer.avatar}
            claimedAt={detailMsg.rp.openedAt}
            onBack={() => setDetailId(null)}
            onToast={onToast}
          />
        );
      })()}

      {/* 转账详情页 */}
      {detailMsg?.kind === 'transfer' && detailMsg.tr && (
        <TrDetailPage
          peerName={peer.name}
          amount={detailMsg.tr.amount}
          note={detailMsg.tr.note}
          payTime={detailMsg.time}
          received={detailMsg.tr.received}
          receivedAt={detailMsg.tr.receivedAt}
          receiverIsMe={(() => {
            // 收款人是否为「我」：receiptOf 精准标记优先；
            // 旧数据（receiptOf 被旧版规范化丢弃）兑底：对方已收款卡片，若此前有我发的同额同言且已收款的转账 →
            // 它是 AI 收我转账后生成的「已收款」接收凭据卡（对方收）；否则是 AI 发给我的原卡被我收（我收）
            const t = detailMsg.tr;
            if (t.receiptOf) return t.receiptOf === 'peer';
            if (detailMsg.role === 'me') return false;
            if (t.received !== true) return false;
            const idx = msgs.findIndex((x) => x.id === detailMsg.id);
            return !msgs.slice(0, Math.max(idx, 0)).some((x) => x.role === 'me' && x.tr && x.tr.received === true && x.tr.amount === t.amount && (x.tr.note || '') === (t.note || ''));
          })()}
          returned={detailMsg.tr.status === 'returned'}
          // 退还人：退还凭据卡自带 refundedBy 标记；原卡按消息角色反推（我发的→对方退的；对方发的→我退的）
          refundedBy={detailMsg.tr.refundedBy ?? (detailMsg.role === 'me' ? 'peer' : 'me')}
          refundedAt={detailMsg.tr.refundedAt}
          originTime={detailMsg.tr.originTime}
          onBack={() => setDetailId(null)}
          onToast={onToast}
        />
      )}

      {/* 亲属卡详情页：我发的 → 管理详情（图③）；对方发的 → 领取页（图②） */}
      {detailMsg?.kind === 'family' && detailMsg.fam && (detailMsg.role === 'me' ? (
        <WxFcManagePage
          peerName={peer.name}
          peerAvatar={peer.avatar}
          limit={detailMsg.fam.monthlyLimit}
          used={detailMsg.fam.used}
          claimed={detailMsg.fam.claimed}
          claimedAt={detailMsg.fam.claimedAt}
          method={detailMsg.fam.method ?? '零钱'}
          onBack={() => setDetailId(null)}
          onEditLimit={(v) => {
            setMsgs((prev) => prev.map((x) => (x.id === detailMsg.id && x.fam ? { ...x, fam: { ...x.fam, monthlyLimit: v } } : x)));
            const list = loadFamilyCards();
            saveFamilyCards(list.map((c) => (c.friendId === peer.id ? { ...c, monthlyLimit: v } : c)));
            onToast('已修改每月消费上限');
          }}
          onPickMethod={(mth) => {
            setMsgs((prev) => prev.map((x) => (x.id === detailMsg.id && x.fam ? { ...x, fam: { ...x.fam, method: mth } } : x)));
            onToast(`优先扣款方式：${mth}`);
          }}
          onToast={onToast}
        />
      ) : (
        <WxFcClaimPage
          peerName={peer.name}
          peerAvatar={peer.avatar}
          limit={detailMsg.fam.monthlyLimit}
          message={detailMsg.fam.message}
          claimed={detailMsg.fam.claimed}
          claimedAt={detailMsg.fam.claimedAt}
          rejected={detailMsg.fam.rejected}
          onBack={() => setDetailId(null)}
          onClaim={() => claimFamily(detailMsg.id)}
          onRefund={() => refundPeerCard(detailMsg)}
          onToast={onToast}
        />
      ))}

      {/* 图片全屏预览 */}
      {viewerSrc && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black" data-testid="wx-img-view" onClick={() => setViewerSrc(null)}>
          <img src={viewerSrc} alt="图片预览" className="max-h-full max-w-full object-contain" />
          <button type="button" aria-label="关闭预览" className="absolute right-4 top-[64px] text-white/85 active:opacity-60">
            <X className="h-7 w-7" strokeWidth={1.8} />
          </button>
        </div>
      )}

      {/* 位置详情页（点聊天位置卡片） */}
      {locViewMsg?.loc && <LocViewLayer name={locViewMsg.loc.name} address={locViewMsg.loc.address} onClose={() => setLocViewId(null)} />}

      {/* 编辑消息弹窗（长按菜单「编辑」）：修改内容后更新该条消息并落盘 */}
      {editMsg && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/40 px-8" data-testid="wx-edit-layer" onClick={() => setEditMsg(null)}>
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#2A2A2C]"
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
                data-testid="wx-edit-input"
                className="w-full resize-none rounded-[8px] border border-black/10 bg-black/[0.03] px-2.5 py-2 text-[15px] leading-[1.45] outline-none focus:border-[#07C160] dark:border-white/15 dark:bg-white/[0.06]"
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
                data-testid="wx-edit-save"
                onClick={saveEdit}
                className="h-11 flex-1 text-[16px] font-medium text-[#07C160] active:bg-black/5 dark:active:bg-white/10"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 转发方式弹层（多选底栏点「分享」图标才弹出：逐条转发 / 合并转发；点弹层以外任意处关闭不执行，对照原生微信） */}
      {selectMode && fwdFlow === 'choose' && (
        <div className="absolute inset-0 z-[60]" data-testid="wx-fwd-choose-mask" onClick={() => setFwdFlow(null)}>
          <div
            className="absolute inset-x-3 bottom-[88px] overflow-hidden rounded-[14px] bg-white shadow-[0_8px_32px_rgba(0,0,0,0.20)] dark:bg-[#2C2C2C]"
            data-testid="wx-fwd-choose-bar"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              data-testid="wx-fwd-each"
              disabled={selectedIds.length === 0}
              onClick={() => {
                setFwdMode('each');
                setFwdFlow('target');
              }}
              className={`w-full py-[15px] text-center text-[17px] ${
                selectedIds.length === 0 ? 'text-black/25 dark:text-white/25' : 'text-black active:bg-black/[0.04] dark:text-white dark:active:bg-white/[0.06]'
              }`}
            >
              逐条转发
            </button>
            <button
              type="button"
              data-testid="wx-fwd-merge"
              disabled={selectedIds.length === 0}
              onClick={() => {
                setFwdMode('merge');
                setFwdFlow('target');
              }}
              className={`w-full border-t border-black/[0.06] py-[15px] text-center text-[17px] dark:border-white/[0.08] ${
                selectedIds.length === 0 ? 'text-black/25 dark:text-white/25' : 'text-black active:bg-black/[0.04] dark:text-white dark:active:bg-white/[0.06]'
              }`}
            >
              合并转发
            </button>
          </div>
        </div>
      )}

      {/* 转发目标选择（转发流程第二步：聊天内勾选完 → 逐条/合并 → 选会话；对照原生微信选人页） */}
      {fwdFlow === 'target' && (
        <div
          className="absolute inset-0 z-[70] flex flex-col justify-end bg-black/40"
          data-testid="wx-fwd-target-layer"
        >
          <div className="mx-2 mb-3 overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#1E1E1E]" onClick={(e) => e.stopPropagation()}>
            <p className="border-b border-black/[0.06] py-3 text-center text-[15px] font-medium dark:border-white/[0.08]">
              {fwdMode === 'merge' ? '合并转发给' : '逐条转发给'}
            </p>
            <div className="max-h-[46vh] overflow-y-auto">
              {forwardTargets.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid={`wx-fwd-target-${c.id}`}
                  onClick={() => doForward(fwdMode, selectedIds, { id: c.id, name: c.name, avatar: c.avatar, self: c.id === me.id })}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  <WxAvatar src={c.avatar} alt={c.name} size={38} />
                  <span className="min-w-0 flex-1 truncate text-[15.5px]">{c.id === me.id ? `${c.name}（我自己）` : c.name}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              data-testid="wx-fwd-back"
              onClick={() => setFwdFlow('choose')}
              className="w-full border-t border-black/[0.06] py-3 text-center text-[15px] text-black/55 active:bg-black/5 dark:border-white/[0.08] dark:text-white/55 dark:active:bg-white/10"
            >
              上一步
            </button>
          </div>
        </div>
      )}

      {/* 合并转发「聊天记录」详情页（点卡片打开；对照微信合并转发详情） */}
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
          <div className="absolute inset-0 z-[65] flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-fwd-detail">
            <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
              <div className="flex h-11 items-center px-2">
                <button type="button" aria-label="返回" data-testid="wx-fwd-detail-back" onClick={() => setFwdDetailId(null)} className="active:opacity-60">
                  <ChevronLeft className="h-7 w-7" strokeWidth={2} />
                </button>
                <p className="min-w-0 flex-1 truncate pr-2 text-center text-[16px] font-medium">{d.fwd.title ?? '聊天记录'}</p>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
              <p className="py-3 text-center text-[13px] text-black/40 dark:text-white/40">{fwdRecordDate(records[0]?.time ?? d.time)}</p>
              {/* 逐条记录：行间分割线（对照原生微信聊天记录详情） */}
              <div className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
                {records.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 py-3">
                    <WxAvatar src={resolveAvatar(r)} alt={r.name} size={34} />
                    <div className="min-w-0 flex-1">
                      {/* 名字在左、时间顶到最右（对照原生微信聊天记录详情） */}
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[11.5px] text-black/40 dark:text-white/40">{r.name}</p>
                        <span className="shrink-0 text-[10.5px] text-black/30 dark:text-white/30">{fwdRecordTime(r.time)}</span>
                      </div>
                      {/* 表情包/图片显示原图；其余类型（文字/红包/转账/亲属卡/位置）显示快照文字 */}
                      {r.kind === 'sticker' && r.imgSrc ? (
                        <img
                          src={r.imgSrc}
                          alt={r.stkMeaning ? `表情：${r.stkMeaning}` : '表情'}
                          data-testid="wx-fwd-detail-sticker"
                          className="mt-0.5 max-h-[96px] w-auto max-w-[110px] rounded-[8px] object-contain"
                          loading="lazy"
                        />
                      ) : r.kind === 'image' && r.imgSrc ? (
                        <img
                          src={r.imgSrc}
                          alt="图片消息"
                          data-testid="wx-fwd-detail-image"
                          className="mt-0.5 max-h-[190px] w-auto max-w-[210px] rounded-[8px] object-cover"
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

      {/* 气泡长按横向菜单（微信/QQ 同款深色卡片；点菜单项执行动作，点空白处关闭） */}
      {msgMenu && (
        <BubbleActionMenu
          pos={msgMenu.pos}
          items={buildMsgMenuItems(msgMenu.msg)}
          onSelect={handleMenuAction}
          onClose={() => setMsgMenu(null)}
          testPrefix="wx-menu"
        />
      )}

      {/* 页内 toast（收藏成功/取消收藏/已复制/已转发给 xx 等操作提示） */}
      <LocalToast msg={chatToast} />
    </div>
  );
}

// ---------------- 朋友圈页 ----------------

/** 单条动态 */
function MomentRow({
  post,
  meName,
  menuOpen,
  onToggleMenu,
  onToggleLike,
  onComment,
  onDelete,
  onDeleteComment,
  onEditRequest,
}: {
  post: WxMoment;
  /** 机主展示名（点赞高亮用） */
  meName: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onToggleLike: () => void;
  onComment: (text: string, reply: { commentId: string; name: string } | null) => void;
  onDelete: () => void;
  /** 长按评论删除（任何人的评论都可删，其下回复一并删；好友朋友圈页不传） */
  onDeleteComment?: (commentId: string) => void;
  /** 编辑动态正文（自己的和 AI 的都可以编辑；好友朋友圈页不传） */
  onEditRequest?: () => void;
}) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  /** 回复目标：点某条评论设置（再点一次取消），带评论 id（回复 AI 评论可触发多轮） */
  const [replyTarget, setReplyTarget] = useState<{ commentId: string; name: string } | null>(null);
  /** 长按删除的评论（确认弹层） */
  const [delTarget, setDelTarget] = useState<{ id: string; author: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
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

  const startCommentPress = (c: WxMomentComment) => (e: React.PointerEvent) => {
    if (!onDeleteComment) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearPress();
    pressRef.current = { x: e.clientX, y: e.clientY, timer: null };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = null;
      suppressClickRef.current = true;
      setDelTarget({ id: c.id, author: c.author });
    }, 480);
  };
  const onCommentPointerMove = (e: React.PointerEvent) => {
    const t = pressRef.current;
    if (!t.timer) return;
    if (Math.abs(e.clientX - t.x) > 10 || Math.abs(e.clientY - t.y) > 10) clearPress();
  };

  useEffect(() => {
    if (composerOpen) inputRef.current?.focus();
  }, [composerOpen, replyTarget]);

  /** 评论框打开时，点击输入框以外的任意位置自动收起（不想评论了点别处即可关闭） */
  useEffect(() => {
    if (!composerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (composerRef.current && target && composerRef.current.contains(target)) return;
      setComposerOpen(false);
      setReplyTarget(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [composerOpen]);

  const sendComment = () => {
    const text = draft.trim();
    if (!text) return;
    onComment(text, replyTarget);
    setDraft('');
    setReplyTarget(null);
    setComposerOpen(false);
  };

  return (
    <div className="flex gap-3 border-b border-black/[0.06] px-4 py-3 last:border-b-0 dark:border-white/[0.08]">
      <WxAvatar src={post.avatar} alt={post.authorName} size={44} />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-[#576B95] dark:text-[#8FA5C9]">{post.authorName}</p>
        {post.text && (
          <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-[1.5]">{post.text}</p>
        )}
        {post.images.length === 1 && (
          <img
            src={post.images[0]}
            alt="配图"
            className="mt-2 max-h-[280px] w-auto max-w-[200px] rounded-[4px] border border-black/5 object-cover dark:border-white/10"
          />
        )}
        {post.images.length > 1 && (
          <div className="mt-2 grid max-w-[237px] grid-cols-3 gap-1">
            {post.images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`配图${i + 1}`}
                className="aspect-square w-full rounded-[3px] object-cover"
              />
            ))}
          </div>
        )}

        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[12.5px] text-black/35 dark:text-white/35">{fmtMomentsTime(post.time)}</span>
          <button
            type="button"
            aria-label="赞与评论"
            data-testid={`wx-moment-menu-${post.id}`}
            onClick={onToggleMenu}
            className="flex items-center gap-[3px] rounded-[4px] bg-[#F2F2F2] px-2.5 py-1 active:bg-black/10 dark:bg-[#2A2A2A] dark:active:bg-white/10"
          >
            <span className="h-[4px] w-[4px] rounded-full bg-[#576B95] dark:bg-[#8FA5C9]" />
            <span className="h-[4px] w-[4px] rounded-full bg-[#576B95] dark:bg-[#8FA5C9]" />
          </button>
        </div>

        {menuOpen && (
          <div className="mt-2 flex justify-end" data-testid={`wx-moment-actions-${post.id}`}>
            <div className="flex overflow-hidden rounded-[6px] bg-[#4C4C4C] text-white shadow-md dark:bg-[#383838]">
              <button
                type="button"
                data-testid={`wx-moment-like-${post.id}`}
                onClick={onToggleLike}
                className="flex items-center gap-1.5 px-3.5 py-2 text-[13.5px] active:bg-white/10"
              >
                <Heart className={`h-4 w-4 ${post.likes.includes(meName) ? 'fill-[#FA5151] text-[#FA5151]' : ''}`} strokeWidth={1.8} />
                {post.likes.includes(meName) ? '取消' : '赞'}
              </button>
              <span className="my-1.5 w-px bg-white/25" aria-hidden="true" />
              <button
                type="button"
                data-testid={`wx-moment-comment-open-${post.id}`}
                onClick={() => {
                  setComposerOpen(true);
                  onToggleMenu();
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 text-[13.5px] active:bg-white/10"
              >
                <MessageCircle className="h-4 w-4" strokeWidth={1.8} />
                评论
              </button>
              {onEditRequest && (
                <>
                  <span className="my-1.5 w-px bg-white/25" aria-hidden="true" />
                  <button
                    type="button"
                    data-testid={`wx-moment-edit-${post.id}`}
                    onClick={onEditRequest}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-[13.5px] active:bg-white/10"
                  >
                    <Pencil className="h-4 w-4" strokeWidth={1.8} />
                    编辑
                  </button>
                </>
              )}
              <span className="my-1.5 w-px bg-white/25" aria-hidden="true" />
              <button
                type="button"
                data-testid={`wx-moment-delete-${post.id}`}
                onClick={onDelete}
                className="flex items-center gap-1.5 px-3.5 py-2 text-[13.5px] text-[#FF9C9C] active:bg-white/10"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                删除
              </button>
            </div>
          </div>
        )}

        {(post.likes.length > 0 || post.comments.length > 0) && (
          <div className="relative mt-2">
            <span
              className="absolute -top-[4px] left-[12px] h-2 w-2 rotate-45 rounded-[1px] bg-[#F7F7F7] dark:bg-[#242424]"
              aria-hidden="true"
            />
            <div className="relative rounded-[4px] bg-[#F7F7F7] px-2 py-1.5 text-[13px] dark:bg-[#242424]">
              {post.likes.length > 0 && (
                <div className="flex items-center gap-1.5 text-[#576B95] dark:text-[#8FA5C9]">
                  <Heart className="h-3.5 w-3.5 shrink-0 fill-[#576B95] dark:fill-[#8FA5C9]" strokeWidth={0} aria-hidden="true" />
                  <span className="min-w-0 truncate">{post.likes.join('、')}</span>
                </div>
              )}
              {post.likes.length > 0 && post.comments.length > 0 && (
                <span className="my-1.5 block h-px bg-black/[0.06] dark:bg-white/[0.08]" aria-hidden="true" />
              )}
              {post.comments.length > 0 && (
                <div className="min-w-0">
                  {post.comments.map((c) => (
                    <div key={c.id} className="flex items-start gap-1">
                      <button
                        type="button"
                        data-testid={`wx-moment-comment-${post.id}-${c.id}`}
                        title={`回复 ${c.author}（长按删除）`}
                        onPointerDown={startCommentPress(c)}
                        onPointerUp={clearPress}
                        onPointerLeave={clearPress}
                        onPointerCancel={clearPress}
                        onPointerMove={onCommentPointerMove}
                        onClick={() => {
                          // 长按后拦截紧随的 click（不弹出回复框）
                          if (suppressClickRef.current) {
                            suppressClickRef.current = false;
                            return;
                          }
                          setComposerOpen(true);
                          setReplyTarget((r) => (r && r.commentId === c.id ? null : { commentId: c.id, name: c.author }));
                        }}
                        className="min-w-0 flex-1 text-left text-[13px] leading-[1.6] active:opacity-70"
                      >
                        <span className="text-[#576B95] dark:text-[#8FA5C9]">{c.author}</span>
                        {c.replyTo && (
                          <>
                            <span className="text-black/85 dark:text-white/85"> 回复 </span>
                            <span className="text-[#576B95] dark:text-[#8FA5C9]">{c.replyTo}</span>
                          </>
                        )}
                        <span className="text-black/85 dark:text-white/85">：{c.text}</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {composerOpen && (
          <div ref={composerRef} className="mt-2 flex items-center gap-2" data-testid={`wx-moment-commentbar-${post.id}`}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  sendComment();
                }
              }}
              placeholder={replyTarget ? `回复 ${replyTarget.name}：` : '评论'}
              aria-label={replyTarget ? `回复 ${replyTarget.name}` : '写评论'}
              data-testid={`wx-moment-comment-input-${post.id}`}
              className="h-8 min-w-0 flex-1 rounded-[4px] bg-[#F7F7F7] px-2.5 text-[13.5px] outline-none placeholder:text-black/30 focus:bg-white focus:ring-1 focus:ring-black/15 dark:bg-[#242424] dark:placeholder:text-white/30 dark:focus:bg-[#1F1F1F] dark:focus:ring-white/20"
            />
            <button
              type="button"
              data-testid={`wx-moment-comment-send-${post.id}`}
              onClick={sendComment}
              disabled={!draft.trim()}
              className="shrink-0 rounded-[4px] bg-[#07C160] px-3.5 py-[7px] text-[13px] font-medium text-white disabled:opacity-40 active:opacity-80"
            >
              发送
            </button>
          </div>
        )}

        {/* 长按评论 → 删除确认（任何人的评论都可删；其下回复一并删） */}
        {delTarget && onDeleteComment && (
          <CommentDeleteDialog
            author={delTarget.author}
            onCancel={() => setDelTarget(null)}
            onDelete={() => {
              onDeleteComment(delTarget.id);
              setDelTarget(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function MomentsPage({
  me,
  owner,
  posts,
  onBack,
  onCompose,
  onToggleLike,
  onComment,
  onDelete,
  onDeleteComment,
  onEditRequest,
  onOpenAsk,
  onToast,
}: {
  me: WxUser;
  /** 传入 = 好友的朋友圈：界面同款，但名字/头像换好友、无发布与换封面入口 */
  owner?: { name: string; avatar: string | null } | null;
  posts: WxMoment[];
  onBack: () => void;
  onCompose: () => void;
  onToggleLike: (id: string) => void;
  onComment: (id: string, text: string, reply: { commentId: string; name: string } | null) => void;
  onDelete: (id: string) => void;
  /** 删除自己的评论（好友朋友圈页不传） */
  onDeleteComment?: (postId: string, commentId: string) => void;
  /** 编辑动态正文（仅自己的动态；好友朋友圈页不传） */
  onEditRequest?: (post: WxMoment) => void;
  /** 顶部「让好友发一条」入口（仅自己的朋友圈页传入） */
  onOpenAsk?: () => void;
  onToast: (m: string) => void;
}) {
  const isMine = !owner;
  const shownName = owner?.name ?? me.name;
  const shownAvatar = owner ? owner.avatar : me.avatar;
  const [menuId, setMenuId] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  /** 封面（本地 IndexedDB settings 存 data URL；迁移时从服务端一次性搬入） */
  const [cover, setCover] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);

  // 启动读取本地封面
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const bg = await getWxBg('moments');
        if (alive && bg) setCover(bg.data);
      } catch {
        // 忽略，用默认封面
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** 从手机相册选图换封面：压缩 → 存本地 IndexedDB → 立即生效 */
  const pickCover = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setCoverBusy(true);
    try {
      const dataUrl = await readImageFile(file, 1280);
      const rec = await setWxBg('moments', dataUrl);
      setCover(rec.data);
      onToast('封面已更换');
    } catch (e) {
      onToast(e instanceof Error ? e.message : '封面保存失败');
    } finally {
      setCoverBusy(false);
      if (coverRef.current) coverRef.current.value = '';
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-white text-black dark:bg-[#111111] dark:text-white">
      {/* 滚动容器：封面 + 动态列表（封面随内容滚动，同微信） */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="wx-moments-list"
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 230)}
      >
        {/* 封面：自定义上传图（无则默认风景照）+ 底部渐晕；点击封面图直接换（从手机上传，永久保存） */}
        <div className="relative h-[300px]">
          {isMine ? (
            <button
              type="button"
              data-testid="wx-cover-change"
              aria-label="更换封面"
              title="点击更换封面"
              onClick={() => coverRef.current?.click()}
              disabled={coverBusy}
              className="absolute inset-0 block h-full w-full cursor-pointer disabled:cursor-default"
            >
              <img
                src={cover ?? '/wx/moments-cover.png'}
                alt="朋友圈封面，点击可更换"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </button>
          ) : (
            <img
              src="/wx/moments-cover.png"
              alt={`${shownName}的朋友圈封面`}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/30 to-transparent"
            aria-hidden="true"
          />
          {/* 昵称 + 头像：微信同款，头像一半探出封面下沿 */}
          <div className="absolute -bottom-[30px] right-4 flex items-end gap-3">
            <span className="pb-2 text-[17px] font-medium text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
              {shownName}
            </span>
            <span className="block rounded-[8px] shadow-lg ring-[2.5px] ring-white">
              <WxAvatar src={shownAvatar} alt={shownName} size={68} />
            </span>
          </div>
        </div>

        {posts.length === 0 ? (
          <div className="flex flex-col items-center pt-[88px] text-black/35 dark:text-white/35">
            <Camera className="h-9 w-9" strokeWidth={1.2} />
            <p className="mt-3 text-[14px]">{owner ? 'TA 还没有发过动态' : '还没有动态'}</p>
            {!owner && <p className="mt-1 text-[12.5px]">点右上角相机，发布第一条朋友圈吧</p>}
          </div>
        ) : (
          <div className="pt-[40px]">
            {posts.map((p) => (
              <MomentRow
                key={p.id}
                post={p}
                meName={me.name}
                menuOpen={menuId === p.id}
                onToggleMenu={() => setMenuId(menuId === p.id ? null : p.id)}
                onToggleLike={() => {
                  onToggleLike(p.id);
                  setMenuId(null);
                }}
                onComment={(text, reply) => onComment(p.id, text, reply)}
                onDelete={() => {
                  onDelete(p.id);
                  setMenuId(null);
                }}
                onDeleteComment={onDeleteComment ? (commentId) => onDeleteComment(p.id, commentId) : undefined}
                onEditRequest={onEditRequest ? () => onEditRequest(p) : undefined}
              />
            ))}
            <p className="py-6 text-center text-[12px] text-black/25 dark:text-white/25">没有更多了</p>
          </div>
        )}
        {isMine && (
          <input
            ref={coverRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => void pickCover(e.target.files)}
          />
        )}
      </div>

      {/* 顶部导航（悬浮在封面上）：滚过封面后切换为白底黑字并显示「朋友圈」标题 */}
      <div
        className={`absolute inset-x-0 top-0 z-10 pt-[54px] transition-colors duration-200 ${
          scrolled
            ? 'bg-white/95 shadow-[0_0.5px_0_rgba(0,0,0,0.1)] backdrop-blur dark:bg-[#111111]/95 dark:shadow-[0_0.5px_0_rgba(255,255,255,0.12)]'
            : ''
        }`}
      >
        <div className="flex h-11 items-center justify-between px-3">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-moments-back"
            onClick={onBack}
            className={`rounded-full p-1 active:bg-black/10 dark:active:bg-white/10 ${
              scrolled ? 'text-black/75 dark:text-white/75' : 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]'
            }`}
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <span className={`text-[17px] font-medium ${scrolled ? '' : 'hidden'}`}>朋友圈</span>
          {isMine ? (
            <div className="flex items-center gap-1">
              {onOpenAsk && (
                <button
                  type="button"
                  aria-label="让好友发一条动态"
                  title="让好友发一条动态"
                  data-testid="wx-moments-ask"
                  onClick={onOpenAsk}
                  className={`rounded-full p-1 active:bg-black/10 dark:active:bg-white/10 ${
                    scrolled ? 'text-black/75 dark:text-white/75' : 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]'
                  }`}
                >
                  <Sparkles className="h-[21px] w-[21px]" strokeWidth={1.8} />
                </button>
              )}
              <button
                type="button"
                aria-label="发布朋友圈"
                data-testid="wx-moments-compose"
                onClick={onCompose}
                className={`rounded-full p-1 active:bg-black/10 dark:active:bg-white/10 ${
                  scrolled ? 'text-black/75 dark:text-white/75' : 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]'
                }`}
              >
                <Camera className="h-[22px] w-[22px]" strokeWidth={1.8} />
              </button>
            </div>
          ) : (
            <span className="w-[60px] shrink-0" aria-hidden="true" />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- 发布朋友圈页 ----------------

function ComposeMomentsPage({
  onCancel,
  onPublish,
  onToast,
}: {
  onCancel: () => void;
  onPublish: (text: string, images: string[]) => void;
  onToast: (m: string) => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const canPost = (text.trim().length > 0 || images.length > 0) && !busy;

  const pick = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setBusy(true);
    setErr('');
    try {
      const room = 9 - images.length;
      const list = Array.from(files).slice(0, Math.max(0, room));
      const urls: string[] = [];
      for (const f of list) urls.push(await readImageFile(f));
      setImages((prev) => [...prev, ...urls].slice(0, 9));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '图片读取失败');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-white text-black dark:bg-[#111111] dark:text-white">
      {/* 顶栏：取消 / 发表 */}
      <div className="pt-[54px]">
        <div className="flex h-12 items-center justify-between px-4">
          <button
            type="button"
            data-testid="wx-compose-cancel"
            onClick={onCancel}
            className="text-[16px] active:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="wx-compose-submit"
            disabled={!canPost}
            onClick={() => onPublish(text.trim(), images)}
            className={`rounded-[5px] px-4 py-1.5 text-[15px] font-medium transition-colors ${
              canPost
                ? 'bg-[#07C160] text-white active:bg-[#06AD56]'
                : 'bg-black/[0.06] text-black/25 dark:bg-white/10 dark:text-white/30'
            }`}
          >
            发表
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
        <textarea
          data-testid="wx-compose-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="这一刻的想法..."
          rows={5}
          autoFocus
          className="w-full resize-none bg-transparent text-[17px] leading-relaxed outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
        />

        {/* 图片选择网格 */}
        <div className="mt-2 grid max-w-[268px] grid-cols-3 gap-2">
          {images.map((src, i) => (
            <div key={i} className="relative aspect-square">
              <img src={src} alt={`已选图片${i + 1}`} className="h-full w-full rounded-[4px] object-cover" />
              <button
                type="button"
                aria-label={`移除图片${i + 1}`}
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white active:bg-black/80"
              >
                <X className="h-3 w-3" strokeWidth={2.5} />
              </button>
            </div>
          ))}
          {images.length < 9 && (
            <button
              type="button"
              aria-label="添加图片"
              data-testid="wx-compose-add-img"
              onClick={() => fileRef.current?.click()}
              className="flex aspect-square items-center justify-center rounded-[4px] border border-dashed border-black/15 bg-[#F7F7F7] text-black/30 active:bg-black/10 dark:border-white/15 dark:bg-[#1E1E1E] dark:text-white/30"
            >
              {busy ? (
                <Loader2 className="h-7 w-7 animate-spin" strokeWidth={1.6} />
              ) : (
                <Plus className="h-8 w-8" strokeWidth={1.1} />
              )}
            </button>
          )}
        </div>
        {busy && <p className="mt-2 text-[13px] text-black/40 dark:text-white/40">正在处理图片…</p>}
        {err && <p className="mt-2 text-[13px] text-red-500">{err}</p>}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => void pick(e.target.files)}
        />
      </div>

      {/* 底部：所在位置 / 提醒谁看 / 谁可以看（预留底部横杠安全区） */}
      <div className="shrink-0 border-t border-black/[0.06] pb-[14px] dark:border-white/[0.08]">
        {(
          [
            ['所在位置', '', <MapPin key="l" className="h-[19px] w-[19px]" strokeWidth={1.8} />],
            ['提醒谁看', '', <AtSign key="a" className="h-[19px] w-[19px]" strokeWidth={1.8} />],
            ['谁可以看', '公开', <User key="u" className="h-[19px] w-[19px]" strokeWidth={1.8} />],
          ] as Array<[string, string, React.ReactNode]>
        ).map(([label, value, icon], i) => (
          <button
            key={label}
            type="button"
            onClick={() => onToast(label === '谁可以看' ? '谁可以看：公开' : `「${label}」暂未开放`)}
            className="relative flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
          >
            {i > 0 && <span className="absolute left-0 right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />}
            <span className="text-black/55 dark:text-white/55">{icon}</span>
            <span className="min-w-0 flex-1 text-[15.5px]">{label}</span>
            {value && <span className="text-[15px] text-black/45 dark:text-white/45">{value}</span>}
            <ChevronRight className="h-4 w-4 shrink-0 text-black/20 dark:text-white/20" strokeWidth={2} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- 新的朋友页 ----------------

function NewFriendsPage({
  reqs,
  onBack,
  onGoAdd,
}: {
  reqs: WxFriendReq[];
  onBack: () => void;
  onGoAdd: () => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, WxFriendReq[]>();
    for (const r of reqs) {
      const k = fmtReqDayLabel(r.time);
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
    return [...map.entries()];
  }, [reqs]);

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      <div className="pt-[54px]">
        <div className="flex h-11 items-center px-3">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-newfriends-back"
            onClick={onBack}
            className="active:opacity-50"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 text-center text-[17px] font-medium">新的朋友</div>
          <button
            type="button"
            data-testid="wx-newfriends-add"
            onClick={onGoAdd}
            className="text-[15px] active:opacity-50"
          >
            添加朋友
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {/* 搜索框（点击进入添加朋友） */}
        <button
          type="button"
          onClick={onGoAdd}
          className="mx-3 mt-1 flex h-[38px] w-[calc(100%-24px)] items-center justify-center gap-1.5 rounded-[6px] bg-white text-[14px] text-black/30 active:bg-black/5 dark:bg-[#1E1E1E] dark:text-white/30"
        >
          <Search className="h-4 w-4" strokeWidth={2} />
          搜索 账号/手机号
        </button>

        {/* 添加手机联系人 */}
        <button
          type="button"
          onClick={onGoAdd}
          className="mt-2 flex w-full items-center gap-3 border-y border-black/[0.05] bg-white px-4 py-3 text-left active:bg-black/[0.04] dark:border-white/[0.08] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
        >
          <Phone className="h-[26px] w-[26px] text-[#07C160]" strokeWidth={1.8} aria-hidden="true" />
          <span className="min-w-0 flex-1 text-[16px]">添加手机联系人</span>
          <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
        </button>

        {reqs.length === 0 ? (
          <p className="py-14 text-center text-[13.5px] text-black/35 dark:text-white/35">
            暂无新的朋友通知，去「添加朋友」认识新朋友吧
          </p>
        ) : (
          groups.map(([label, list]) => (
            <div key={label}>
              <p className="px-4 pb-1 pt-3 text-[13px] text-black/45 dark:text-white/45">{label}</p>
              <div className="bg-white dark:bg-[#1A1A1A]">
                {list.map((r) => (
                  <div
                    key={`${r.id}-${r.time}`}
                    data-testid={`wx-req-${r.name}`}
                    className="flex items-center gap-3 border-b border-black/[0.05] px-4 py-2.5 last:border-b-0 dark:border-white/[0.08]"
                  >
                    <WxAvatar src={r.avatar} alt={r.name} size={42} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[16px]">{r.name}</p>
                      <p className="mt-0.5 truncate text-[13px] text-black/40 dark:text-white/40">{r.message}</p>
                    </div>
                    <span className="shrink-0 text-[14px] text-black/35 dark:text-white/35" data-testid={`wx-req-status-${r.name}`}>
                      已添加
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------- 添加朋友页 ----------------

function AddFriendPage({
  contacts,
  me,
  onBack,
  onAdded,
  onOpenChat,
  onToast,
}: {
  contacts: ContactRecord[];
  me: WxUser;
  onBack: () => void;
  /** 添加好友成功：父组件写入「新的朋友」并刷新联系人 */
  onAdded: (c: ContactRecord) => void;
  /** 点「发消息」：直接打开与该好友的聊天 */
  onOpenChat: (c: ContactRecord) => void;
  onToast: (m: string) => void;
}) {
  const [q, setQ] = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [err, setErr] = useState('');

  const query = q.trim().toLowerCase();
  const searched = query.length > 0;
  const results = useMemo(() => {
    if (!query) return [];
    return contacts.filter(
      (c) =>
        c.kind !== 'user' &&
        ((c.phone ?? '').toLowerCase().includes(query) ||
          (c.wechatId ?? '').toLowerCase().includes(query) ||
          (c.qqId ?? '').toLowerCase().includes(query))
    );
  }, [contacts, query]);

  const add = async (c: ContactRecord) => {
    if (addingId) return;
    setAddingId(c.id);
    setErr('');
    try {
      const updated = await updateContact(c.id, { friendWx: true });
      if (!updated) throw new Error('联系人不存在');
      setAddedIds((prev) => new Set(prev).add(c.id));
      onAdded(updated);
      onToast(`已添加「${displayNameOf(updated)}」`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '添加失败，请重试');
    } finally {
      setAddingId(null);
    }
  };

  const options: Array<[string, string, string, React.ReactNode]> = [
    ['扫一扫', '扫描二维码名片', '#5A9CF8', <ScanLine key="1" className="h-[21px] w-[21px]" strokeWidth={2} />],
    ['手机联系人', '添加通讯录中的朋友', '#07C160', <Smartphone key="2" className="h-[21px] w-[21px]" strokeWidth={2} />],
    ['雷达', '添加身边的朋友', '#7B68EE', <Radar key="3" className="h-[21px] w-[21px]" strokeWidth={2} />],
    ['面对面建群', '与身边的朋友进入同一个群聊', '#07C160', <Users key="5" className="h-[21px] w-[21px]" strokeWidth={2} />],
    ['公众号', '获取更多资讯', '#5A9CF8', <Newspaper key="6" className="h-[21px] w-[21px]" strokeWidth={2} />],
    ['服务号', '获取更多购物信息和服务', '#F26D6D', <Wallet key="7" className="h-[21px] w-[21px]" strokeWidth={2} />],
  ];

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-white text-black dark:bg-[#111111] dark:text-white">
      <div className="pt-[54px]">
        <div className="flex h-11 items-center px-2">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-addfriend-back"
            onClick={onBack}
            className="active:opacity-50"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-medium">添加朋友</div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {/* 搜索框 */}
        <div className="px-3 pb-2 pt-1">
          <div className="flex h-[38px] items-center gap-2 rounded-[6px] bg-[#F2F2F2] px-3 dark:bg-[#1E1E1E]">
            <Search className="h-4 w-4 shrink-0 text-black/30 dark:text-white/30" strokeWidth={2} />
            <input
              data-testid="wx-addfriend-query"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setErr('');
              }}
              placeholder="搜索 账号/手机号"
              aria-label="搜索微信号或手机号添加朋友"
              autoCapitalize="off"
              autoCorrect="off"
              className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
          </div>
          {err && (
            <p className="mt-1.5 px-1 text-[12.5px] text-red-500" role="alert">
              {err}
            </p>
          )}
        </div>

        {searched ? (
          results.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-[15px] text-black/45 dark:text-white/45">该用户不存在</p>
              <p className="mt-1.5 text-[12.5px] text-black/30 dark:text-white/30">
                换个手机号 / 微信号 / QQ号 试试，或先到「联系人」App 创建
              </p>
            </div>
          ) : (
            <div>
              {results.map((c) => {
                const added = isFriendIn(c, 'wx') || addedIds.has(c.id);
                return (
                  <div
                    key={c.id}
                    data-testid={`wx-add-result-${c.name}`}
                    className="flex items-center gap-3 border-b border-black/[0.06] px-4 py-2.5 dark:border-white/[0.08]"
                  >
                    <WxAvatar src={c.avatar} alt={c.name} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[16px]">{c.name}</p>
                      <p className="mt-0.5 truncate text-[12.5px] text-black/40 dark:text-white/40">
                        微信号：{c.wechatId || c.qqId || c.phone || '未设置'}
                      </p>
                    </div>
                    {added ? (
                      <button
                        type="button"
                        data-testid={`wx-add-chat-${c.name}`}
                        onClick={() => onOpenChat(c)}
                        className="shrink-0 rounded-[5px] border border-[#07C160] px-3 py-1.5 text-[13.5px] font-medium text-[#07C160] active:bg-[#07C160]/10"
                      >
                        发消息
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid={`wx-add-btn-${c.name}`}
                        onClick={() => void add(c)}
                        disabled={addingId === c.id}
                        className="flex shrink-0 items-center gap-1 rounded-[5px] bg-[#07C160] px-3 py-1.5 text-[13.5px] font-medium text-white active:bg-[#06AD56] disabled:opacity-60"
                      >
                        {addingId === c.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {addingId === c.id ? '添加中…' : '添加到通讯录'}
                      </button>
                    )}
                  </div>
                );
              })}
              <p className="px-4 pt-2.5 text-[12.5px] leading-relaxed text-black/35 dark:text-white/35">
                该账号来自「联系人」App；已是好友的可以直接发消息，未添加的加为好友后即可聊天
              </p>
            </div>
          )
        ) : (
          <>
            {/* 功能入口列表 */}
            <div className="bg-white dark:bg-[#1A1A1A]">
              {options.map(([label, sub, color, icon], i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => onToast(`「${label}」暂未开放`)}
                  className="relative flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  {i > 0 && <span className="absolute left-[66px] right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />}
                  <WxTileIcon bg={color}>{icon}</WxTileIcon>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px]">{label}</span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-black/35 dark:text-white/35">{sub}</span>
                  </span>
                  <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
                </button>
              ))}
            </div>

            {/* 我的二维码名片 */}
            <div className="flex flex-col items-center pb-6 pt-10">
              <div className="rounded-[12px] bg-white p-3.5 shadow-[0_3px_18px_rgba(0,0,0,0.09)] ring-1 ring-black/5 dark:ring-white/10">
                <PseudoQR seed={me.wechatId || me.id} size={172} />
              </div>
              <p className="mt-3 text-[12.5px] text-black/35 dark:text-white/35">扫一扫上面的二维码图案，加我微信</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- 好友详情页（通讯录点好友进入，同微信） ----------------

function FriendDetailPage({
  friend,
  onBack,
  onOpenChat,
  onOpenMoments,
  onToast,
}: {
  friend: ContactRecord;
  onBack: () => void;
  onOpenChat: (c: ContactRecord) => void;
  onOpenMoments: (c: ContactRecord) => void;
  onToast: (m: string) => void;
}) {
  // 跨 App 跳转：点「朋友资料」→ 打开联系人 App 后直接进入该联系人的编辑页
  const switchToApp = useUI((s) => s.switchToApp);
  const setPendingContactEdit = useUI((s) => s.setPendingContactEdit);
  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      {/* 顶栏：返回 + ··· */}
      <div className="shrink-0 pt-[54px]">
        <div className="flex h-11 items-center px-2">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-fdetail-back"
            onClick={onBack}
            className="active:opacity-50"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            aria-label="更多"
            onClick={() => onToast('资料设置暂未开放')}
            className="px-3 active:opacity-50"
          >
            <EllipsisGlyph />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {/* 头部：头像 + 名字 + 性别 + 微信号 */}
        <div className="bg-white px-4 py-5 dark:bg-[#1A1A1A]">
          <div className="flex items-start gap-4">
            <WxAvatar src={friend.avatar} alt={friend.name} size={64} />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="flex items-center gap-1.5 text-[21px] font-semibold leading-tight">
                <span className="truncate">{friend.name}</span>
                {friend.gender === '男' && (
                  <User className="h-[18px] w-[18px] shrink-0 text-[#4D9CF8]" aria-hidden="true" strokeWidth={2} />
                )}
                {friend.gender === '女' && (
                  <User className="h-[18px] w-[18px] shrink-0 text-[#FF6B81]" aria-hidden="true" strokeWidth={2} />
                )}
              </p>
              <p className="mt-2 truncate text-[14px] text-black/45 dark:text-white/45">
                微信号：{friend.wechatId || friend.qqId || friend.phone || '未设置'}
              </p>
            </div>
          </div>
        </div>

        {/* 朋友资料（点击 → 联系人 App 对应联系人的编辑界面） */}
        <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
          <button
            type="button"
            data-testid="wx-fdetail-edit"
            onClick={() => {
              setPendingContactEdit(friend.id);
              switchToApp('contacts');
            }}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[16px]">朋友资料</span>
              <span className="mt-1 block text-[13px] leading-[1.55] text-black/35 dark:text-white/35">
                添加朋友的备注名、电话、标签、备忘、照片等，并设置朋友权限。
              </span>
            </span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>

        {/* 朋友圈 / 视频号 */}
        <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
          <WxMenuRow
            first
            label="朋友圈"
            testId="wx-fdetail-moments"
            onClick={() => onOpenMoments(friend)}
            icon={<span />}
          />
          <WxMenuRow
            label="视频号"
            onClick={() => onToast('视频号暂未开放')}
            icon={<span />}
          />
        </div>

        {/* 发消息 / 音视频通话 */}
        <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
          <button
            type="button"
            data-testid="wx-fdetail-chat"
            onClick={() => onOpenChat(friend)}
            className="flex w-full items-center justify-center gap-2.5 py-[15px] text-[16px] text-[#576B95] active:bg-black/[0.04] dark:text-[#8FA5C9] dark:active:bg-white/[0.06]"
          >
            <MessageCircle className="h-[21px] w-[21px]" strokeWidth={1.8} />
            发消息
          </button>
          <div className="relative">
            <span className="absolute inset-x-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />
            <button
              type="button"
              onClick={() => onToast('音视频通话暂未开放')}
              className="flex w-full items-center justify-center gap-2.5 py-[15px] text-[16px] text-[#576B95] active:bg-black/[0.04] dark:text-[#8FA5C9] dark:active:bg-white/[0.06]"
            >
              <Phone className="h-[21px] w-[21px]" strokeWidth={1.8} />
              音视频通话
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- 我的资料页（个人资料，微信同款） ----------------

function ProfilePage({
  me,
  record,
  onBack,
  onToast,
}: {
  me: WxUser;
  /** 自己在「联系人 App」里的完整资料（性别 / 地区用） */
  record: ContactRecord | null;
  onBack: () => void;
  onToast: (m: string) => void;
}) {
  const rows: Array<{ key: string; label: string; value: React.ReactNode; toast: string }> = [
    { key: 'name', label: '名字', value: <span className="block max-w-[190px] truncate">{me.name}</span>, toast: '名字暂不支持修改' },
    { key: 'gender', label: '性别', value: record?.gender || '未设置', toast: '性别暂不支持修改' },
    { key: 'region', label: '地区', value: <span className="block max-w-[210px] truncate">{record?.region || '美国边远小岛'}</span>, toast: '地区暂不支持修改' },
    { key: 'phone', label: '手机号', value: maskPhone(me.phone), toast: '手机号暂不支持修改' },
    { key: 'wechat', label: '微信号', value: <span className="block max-w-[190px] truncate">{me.wechatId || '未设置'}</span>, toast: '微信号暂不支持修改' },
    {
      key: 'qr',
      label: '我的二维码',
      value: <QrCode className="h-[20px] w-[20px] text-black/45 dark:text-white/45" strokeWidth={1.7} />,
      toast: '我的二维码暂未开放',
    },
    { key: 'clap', label: '拍一拍', value: <span className="block max-w-[190px] truncate">未设置</span>, toast: '拍一拍暂未开放' },
  ];

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      <div className="pt-[54px]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-profile-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-medium">个人资料</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <div className="bg-white dark:bg-[#1A1A1A]">
          {/* 头像行 */}
          <button
            type="button"
            data-testid="wx-profile-avatar"
            onClick={() => onToast('头像暂不支持修改')}
            className="flex w-full items-center px-4 py-[9px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
          >
            <span className="min-w-0 flex-1 text-[17px]">头像</span>
            <WxAvatar src={me.avatar} alt={me.name} size={60} />
            <ChevronRight className="ml-2 h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
          {/* 资料 / 二维码 / 拍一拍行 */}
          {rows.map((r, i) => (
            <button
              key={r.key}
              type="button"
              data-testid={`wx-profile-${r.key}`}
              onClick={() => onToast(r.toast)}
              className="relative flex w-full items-center px-4 py-[15px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              <span className="absolute left-4 right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-[17px]">{r.label}</span>
              <span className="mr-2 flex min-w-0 items-center justify-end text-right text-[15.5px] text-black/45 dark:text-white/45">
                {r.value}
              </span>
              <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
            </button>
          ))}
        </div>

      </div>
    </div>
  );
}

// ---------------- 微信设置页（含退出登录） ----------------

function WxSettingsPage({ onBack, onLogout }: { onBack: () => void; onLogout: () => void }) {
  const rows = ['账号与安全', '青少年模式', '关怀模式', '消息通知', '隐私', '通用', '关于微信'];
  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      <div className="pt-[54px]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-settings-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-medium">设置</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        <div className="overflow-hidden rounded-[10px] bg-white dark:bg-[#1A1A1A]">
          {rows.map((label, i) => (
            <button
              key={label}
              type="button"
              className={`flex w-full items-center justify-between px-4 py-3 text-[16px] active:bg-black/5 ${
                i > 0 ? 'border-t border-black/5 dark:border-white/10' : ''
              }`}
            >
              <span>{label}</span>
              <ChevronRight className="h-4 w-4 opacity-30" strokeWidth={2} />
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="wx-logout"
          onClick={onLogout}
          className="mt-4 w-full rounded-[10px] bg-white py-3 text-center text-[16px] text-red-500 active:bg-black/5 dark:bg-[#1A1A1A]"
        >
          退出登录
        </button>
      </div>
    </div>
  );
}

// ---------------- 收藏页（「我」tab 收藏入口；数据在 @/lib/msg-favorites） ----------------

function WxFavoritesPage({ onBack }: { onBack: () => void; onToast?: (m: string) => void }) {
  // 收藏页在 App 根提前 return 的分支里，App 根 toast 不渲染 → 页内自带 toast
  const [toast, showToast] = useLocalToast();
  const onToast = showToast;
  const [list, setList] = useState<MsgFavorite[]>(() => loadFavorites('wx'));

  const del = (id: string) => {
    removeFavorite('wx', id);
    setList((prev) => prev.filter((x) => x.id !== id));
    onToast('已删除收藏');
  };

  return (
    <div className="relative flex h-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      {/* 顶栏（微信灰同聊天页） */}
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-fav-back"
            onClick={onBack}
            className="flex items-center px-1 active:opacity-50"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex flex-1 items-center justify-center pr-9">
            <span className="text-[17px] font-medium">收藏</span>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-24 text-black/35 dark:text-white/35" data-testid="wx-fav-empty">
            <Star className="h-10 w-10" strokeWidth={1.2} />
            <p className="text-[13px]">暂无收藏 · 长按聊天消息可收藏</p>
          </div>
        ) : (
          <div className="space-y-2">
            {list.map((f) => (
              <div key={f.id} data-testid="wx-fav-item" className="rounded-[10px] bg-white p-3 dark:bg-[#1A1A1A]">
                <div className="flex items-center gap-2">
                  <WxAvatar src={f.contactAvatar} alt={f.contactName} size={30} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-black/60 dark:text-white/60">{f.contactName}</span>
                  <span className="shrink-0 text-[11px] text-black/35 dark:text-white/35">
                    {f.msgRole === 'me' ? '我' : '对方'} · {fmtChatTime(f.time)}
                  </span>
                  <button
                    type="button"
                    aria-label="删除收藏"
                    data-testid="wx-fav-del"
                    onClick={() => del(f.id)}
                    className="shrink-0 text-black/30 active:opacity-60 dark:text-white/30"
                  >
                    <Trash2 className="h-[16px] w-[16px]" strokeWidth={1.8} />
                  </button>
                </div>
                <div className="mt-2 rounded-[6px] bg-black/[0.03] px-2.5 py-2 dark:bg-white/[0.05]">
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

// ---------------- 主界面（四 tab） ----------------

type Tab = 'chats' | 'contacts' | 'discover' | 'me';
type Page =
  | 'main'
  | 'moments'
  | 'compose'
  | 'newFriends'
  | 'addFriend'
  | 'friendDetail'
  | 'friendMoments'
  | 'profile'
  | 'settings'
  | 'services'
  | 'stickers'
  | 'favorites';

function MainScreen({
  me,
  contacts,
  myRealName,
  ownerName,
  reloadContacts,
  onLogout,
  onExit,
}: {
  me: WxUser;
  contacts: ContactRecord[];
  /** 当前登录用户的真实姓名（钱包持卡人用，非昵称） */
  myRealName: string;
  /** NPC 归属者名字查询（按聊天对端计算，供人设 prompt 使用） */
  ownerName: (peer: ContactRecord) => string | null;
  reloadContacts: () => Promise<void>;
  onLogout: () => void;
  onExit: () => void;
}) {
  const [tab, setTab] = useState<Tab>('chats');
  const [chatPeer, setChatPeer] = useState<ContactRecord | null>(null);
  /** 群聊：群列表缓存 / 正在聊的群 / 群子页（create=发起群聊、list=通讯录群聊列表）/ 群聊信息页 */
  const [wxGroups, setWxGroups] = useState<ChatGroup[]>(() => listGroups('wx'));
  const [groupPeer, setGroupPeer] = useState<ChatGroup | null>(null);
  const [groupPage, setGroupPage] = useState<null | 'create' | 'list'>(null);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const refreshGroups = useCallback(() => setWxGroups(listGroups('wx')), []);
  /** 详情页（联系人详细界面）：从聊天设置信息卡片 / 通讯录进入；返回与朋友圈回退链见渲染分支 */
  const [detail, setDetail] = useState<ContactRecord | null>(null);
  /** 正在浏览其朋友圈的好友（page = 'friendMoments'） */
  const [friendMoments, setFriendMoments] = useState<ContactRecord | null>(null);
  const [page, setPage] = useState<Page>('main');
  const [menuOpen, setMenuOpen] = useState(false);
  const [moments, setMoments] = useState<WxMoment[]>(() => loadMoments());
  /** 用户 API 配置（让 AI 发动态时按人设生成内容用） */
  const apiConfig = useSettings((s) => s.apiConfig);
  /** 「让好友发一条」弹层与生成中的联系人 id */
  const [askOpen, setAskOpen] = useState(false);
  const [askBusyId, setAskBusyId] = useState<string | null>(null);
  /** 正在配置自动发动态的好友（每角色 × 朋友圈） */
  const [cfgPeer, setCfgPeer] = useState<ContactRecord | null>(null);
  /** 正在编辑的动态（id + 当前正文） */
  const [editingPost, setEditingPost] = useState<{ id: string; text: string } | null>(null);
  const [reqs, setReqs] = useState<WxFriendReq[]>(() => loadReqs());
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1600);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  /** 聊天列表管理（真微信同款）：置顶排序、消息免打扰铃铛（chat-flags 总线）、标为未读红点、不显示/删除（新消息自动恢复） */
  const flagsMap = useChatFlags(wxChatFlagsStore);
  const unreads = useUnreadMap(wxUnreads);
  const [hidden, setHidden] = useState<string[]>(() => loadStrList(LS_CHAT_HIDDEN));
  // 好友来信 / 未读变化 tick：会话预览与排序派生自 localStorage，需要 tick 触发 useMemo 重算
  const [msgTick, setMsgTick] = useState(0);
  useEffect(() => wxUnreads.subscribe(() => setMsgTick((t) => t + 1)), []);
  // 全局流式回复落盘 tick：聊天页外收到的 AI 回复写入存储后刷新会话预览/排序
  useChatStreamFinalized('wx:', () => setMsgTick((t) => t + 1));
  /** 长按菜单（QQ 同款竖向卡片：标为未读/置顶该聊天/不显示该聊天/删除该聊天；浅色白底黑字/深色深底白字） */
  const [ctx, setCtx] = useState<null | { contact: ContactRecord; x: number; y: number }>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<{ timer: number | null; x: number; y: number }>({ timer: null, x: 0, y: 0 });
  const suppressClickRef = useRef(false);
  const pinSet = useMemo(
    () => new Set(Object.keys(flagsMap).filter((id) => flagsMap[id]?.pinned === true)),
    [flagsMap]
  );

  /** 返回列表：从聊天页/详情页回来时重同步隐藏列表（saveMsgs 收到新消息会把联系人从隐藏中移除） */
  const backToList = () => {
    setHidden(loadStrList(LS_CHAT_HIDDEN));
    setChatPeer(null);
  };

  /** 好友（可聊天对象）：CHAR / NPC 中已添加微信好友的（微信好友独立，QQ/信息里添加的不算） */
  const friends = useMemo(
    () => contacts.filter((c) => c.kind !== 'user' && isFriendIn(c, 'wx')),
    [contacts]
  );

  /** 自己的完整联系人资料（个人资料页的性别 / 地区用） */
  const meRecord = useMemo(() => contacts.find((c) => c.id === me.id) ?? null, [contacts, me.id]);

  /** 会话列表：置顶优先，其余按最后消息时间倒序；已删除/不显示的隐藏（新消息自动恢复）；跟自己的会话有消息时也显示（同文件传输助手）；群会话按 group:<gid> 键共用置顶/免打扰/未读设施 */
  const sessions = useMemo<{ key: string; contact: ContactRecord | null; group: ChatGroup | null; preview: string; time: number }[]>(() => {
    const hiddenSet = new Set(hidden);
    const items: { key: string; contact: ContactRecord | null; group: ChatGroup | null; preview: string; time: number }[] = friends
      .filter((c) => !hiddenSet.has(c.id))
      .map((c) => {
        const p = readPreview(c.id);
        return { key: c.id, contact: c, group: null, preview: p.text, time: p.time };
      });
    const mine = readPreview(me.id);
    if (mine.text && !hiddenSet.has(me.id)) {
      const meContact = contacts.find((c) => c.id === me.id) ?? meAsContact(me);
      items.push({ key: meContact.id, contact: meContact, group: null, preview: mine.text, time: mine.time });
    }
    for (const g of wxGroups) {
      if (hiddenSet.has(groupRowId(g.id))) continue;
      const p = groupPreview(g.id);
      items.push({ key: groupRowId(g.id), contact: null, group: g, preview: p.text, time: p.time });
    }
    items.sort((a, b) => {
      const pa = pinSet.has(a.key) ? 0 : 1;
      const pb = pinSet.has(b.key) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (b.time || 0) - (a.time || 0);
    });
    return items;
    // chatPeer 入依赖：从聊天返回（或进入聊天）时重算预览，红包/转账/新消息即时反映到列表；msgTick：好友来信时重算；groups：群数据变更时重算
  }, [contacts, friends, me, chatPeer, pinSet, hidden, msgTick, wxGroups]);

  /** 幽灵未读清理：只保留当前可见会话的未读（不显示该聊天/已删联系人的残留计数没有行可清，
   *  会让底部 tab 与主屏图标角标卡死；prune 无变化时不写入，可安全随 sessions 重算触发） */
  useEffect(() => {
    wxUnreads.prune(sessions.map((s) => s.key));
  }, [sessions]);

  /** 长按会话 → 弹出 QQ 同款竖向卡片菜单（480ms 触发，移动超 12px 视为滚动取消） */
  const clearPress = () => {
    if (pressRef.current.timer) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current.timer = null;
    }
  };
  const onSessionPointerDown = (e: React.PointerEvent, c: ContactRecord) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearPress();
    pressRef.current = { x: e.clientX, y: e.clientY, timer: null };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = null;
      const rect = rootRef.current?.getBoundingClientRect();
      const px = rect ? e.clientX - rect.left : e.clientX;
      const py = rect ? e.clientY - rect.top : e.clientY;
      // 竖向卡片（4 项，约 176×190）：水平居中于触点，上下钳制不溢出页面
      const rootW = rootRef.current?.clientWidth ?? 390;
      const rootH = rootRef.current?.clientHeight ?? 700;
      const MENU_W = 176;
      const MENU_H = 190;
      const x = Math.min(Math.max(px - MENU_W / 2, 10), Math.max(rootW - MENU_W - 10, 10));
      const y = Math.min(py, Math.max(rootH - MENU_H - 10, 10));
      setCtx({ contact: c, x, y });
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

  // 菜单操作（置顶/未读/不显示/删除）：置顶/未读写入与订阅通知由总线负责（落盘 + 实时同步各角标）
  const togglePin = (id: string) => {
    wxChatFlagsStore.togglePinned(id);
  };
  const toggleUnread = (id: string) => wxUnreads.toggle(id);
  const markRead = (id: string) => wxUnreads.clear(id);
  const hideSession = (id: string) => {
    if (!hidden.includes(id)) {
      const next = [...hidden, id];
      saveStrList(LS_CHAT_HIDDEN, next);
      setHidden(next);
    }
    showToast('已不显示该聊天');
  };
  const deleteSession = (id: string) => {
    saveMsgs(id, []); // 清空聊天记录；有新消息时该会话自动重新出现
    const nextHidden = hidden.includes(id) ? hidden : [...hidden, id];
    saveStrList(LS_CHAT_HIDDEN, nextHidden);
    setHidden(nextHidden);
    wxChatFlagsStore.reset(id); // 置顶/免打扰/聊天背景一并清除
    if (unreads[id]) wxUnreads.clear(id);
    showToast('已删除该聊天');
  };

  /** 聊天页返回键角标：除当前会话外的未读总数（和 A 聊天时 B 来信 → 返回键旁显示 B 的未读数） */
  const chatOtherUnread = useMemo(() => {
    if (!chatPeer) return 0;
    let sum = 0;
    for (const [id, n] of Object.entries(unreads)) {
      if (id !== chatPeer.id && n > 0) sum += n;
    }
    return sum;
  }, [unreads, chatPeer]);

  /** 底部「微信」tab 角标：全部会话未读总数 */
  const totalUnread = useMemo(() => {
    let sum = 0;
    for (const n of Object.values(unreads)) {
      if (n > 0) sum += n;
    }
    return sum;
  }, [unreads]);

  /** 通讯录字母分组 */
  const groups = useMemo(() => {
    const map = new Map<string, ContactRecord[]>();
    for (const c of friends) {
      const key = initialOf(c.name);
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return [...map.entries()]
      .map(([letter, list]) => ({
        letter,
        list: list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN-u-co-pinyin')),
      }))
      .sort((a, b) => {
        if (a.letter === '#') return 1;
        if (b.letter === '#') return -1;
        return a.letter.localeCompare(b.letter);
      });
  }, [friends]);

  /** 朋友圈更新：改由动态引擎写入，这里只从存储重读刷新视图（引擎每次落盘也广播 moments-changed） */
  const reloadMoments = useCallback(() => setMoments(loadMoments()), []);
  // 引擎（调度器/AI）在别处写入动态后同步本地视图（点赞/评论/新动态实时出现）
  useEffect(
    () =>
      subscribeMomentsChanged((platform) => {
        if (platform && platform !== 'wx') return;
        reloadMoments();
      }),
    [reloadMoments]
  );

  const publishMoment = useCallback(
    (text: string, images: string[]) => {
      // 统一走动态引擎：入库 + 写看到它的角色记忆（聊天时懒入库）+ 排 AI 互动队列（8~18s 后好友点赞/评论）
      const post = addUserMomentPost('wx', { userName: me.name, avatar: me.avatar, content: text, images });
      enqueuePostInteractions('wx', post.id);
      reloadMoments();
      setPage('moments');
      showToast('已发表到朋友圈');
    },
    [me.avatar, me.name, reloadMoments, showToast]
  );

  const toggleLike = useCallback(
    (id: string) => {
      toggleUserMomentLike('wx', id, me.name);
      reloadMoments();
    },
    [me.name, reloadMoments]
  );

  /** 发表评论（reply = 回复目标的评论 id + 名字；回复 AI 评论会自动排一条 AI 的再回复，多轮） */
  const addComment = useCallback(
    (id: string, text: string, reply: { commentId: string; name: string } | null) => {
      addUserMomentComment('wx', id, {
        userName: me.name,
        content: text,
        replyTo: reply ? { commentId: reply.commentId, name: reply.name } : undefined,
      });
      reloadMoments();
    },
    [me.name, reloadMoments]
  );

  /** 进入好友朋友圈：首次自动补三条示例动态（示例动态不入记忆），界面与自己朋友圈同款 */
  const openFriendMoments = useCallback(
    (c: ContactRecord) => {
      const known = listMomentPosts('wx', me.name, contacts);
      if (!known.some((p) => isPostByPeer(p, c))) {
        const now = Date.now();
        for (const t of FRIEND_POST_TEMPLATES) {
          addCharMomentPost('wx', {
            peer: c,
            userName: me.name,
            content: t.text,
            writeMemory: false,
            createdAt: now - t.agoMs,
          });
        }
      }
      reloadMoments();
      setFriendMoments(c);
      setPage('friendMoments');
    },
    [contacts, me.name, reloadMoments]
  );

  const deleteMoment = useCallback(
    (id: string) => {
      deleteMomentPost('wx', id, me.name);
      reloadMoments();
      showToast('已删除动态');
    },
    [me.name, reloadMoments, showToast]
  );

  /** 删除评论（自己的评论；其下的回复一并删，AI 未结算的回复一并撤掉） */
  const deleteComment = useCallback(
    (postId: string, commentId: string) => {
      deleteMomentComment('wx', postId, commentId, me.name);
      reloadMoments();
    },
    [me.name, reloadMoments]
  );

  /** 编辑动态正文（自己的动态） */
  const editMomentPost = useCallback(
    (id: string, text: string) => {
      if (!updateMomentPostContent('wx', id, me.name, text)) showToast('动态内容不能为空');
      reloadMoments();
    },
    [me.name, reloadMoments, showToast]
  );

  /** 让 AI 好友现在发一条动态（内容按人设 + 最近聊天 + 记忆生成；发布即写该角色记忆） */
  const askMomentPost = useCallback(
    async (c: ContactRecord) => {
      setAskBusyId(c.id);
      try {
        await aiPostMoment({ apiConfig, platform: 'wx', peer: c, userName: me.name });
        reloadMoments();
        showToast(`已让「${displayNameOf(c)}」发了一条动态`);
        setAskOpen(false);
      } catch (e) {
        showToast(e instanceof Error && e.message ? e.message : '生成失败，请稍后再试');
      } finally {
        setAskBusyId(null);
      }
    },
    [apiConfig, me.name, reloadMoments, showToast]
  );

  /** 添加好友成功：写入「新的朋友」通知并刷新联系人列表 */
  const handleFriendAdded = useCallback(
    (c: ContactRecord) => {
      const entry: WxFriendReq = {
        id: c.id,
        name: displayNameOf(c),
        avatar: c.avatar,
        message: `我是${me.name}，加个好友吧`,
        time: Date.now(),
      };
      const next = [entry, ...reqs];
      setReqs(next);
      saveReqs(next);
      void reloadContacts();
    },
    [me.name, reloadContacts, reqs]
  );

  /** 打开好友详情页（fromChat 参数仅保留调用点兼容；页面退回逻辑已统一） */
  const openFriendDetail = useCallback((c: ContactRecord) => {
    setDetail(c);
    setPage('friendDetail');
  }, []);

  if (page === 'friendDetail' && detail) {
    return (
      <FriendDetailPage
        friend={detail}
        onBack={() => {
          // 从聊天设置进入：chatPeer 仍保留，回到聊天页；否则回主列表
          setDetail(null);
          setPage('main');
        }}
        onOpenChat={(c) => {
          // 详情页发消息：退回 page 并打开聊天（chatPeer 渲染聊天页）。
          // 从聊天进入的详情页：chatPeer 已是此人，退回 page 即回聊天；从通讯录进入的：直接进聊天。
          setPage('main');
          setChatPeer(c);
        }}
        onOpenMoments={(c) => {
          // 自己的详情页：「朋友圈」进自己的朋友圈；好友才自动补示例动态
          if (c.id === me.id) setPage('moments');
          else openFriendMoments(c);
        }}
        onToast={showToast}
      />
    );
  }
  // 朋友圈三页（自己的朋友圈 / 发布页 / 好友朋友圈）必须渲染在 chat 之前：
  // 从聊天 → 联系人详情 → 朋友圈进入时 chatPeer 仍保留（返回时还要回聊天），
  // 若 chat 判断在前会错误地直接渲染聊天页，退出聊天后才看到朋友圈（导航栈错乱）。
  if (page === 'moments') {
    return (
      <>
        <MomentsPage
          me={me}
          posts={moments}
          onBack={() => (detail ? setPage('friendDetail') : setPage('main'))}
          onCompose={() => setPage('compose')}
          onToggleLike={toggleLike}
          onComment={addComment}
          onDelete={deleteMoment}
          onDeleteComment={deleteComment}
          onEditRequest={(p) => setEditingPost({ id: p.id, text: p.text })}
          onOpenAsk={() => setAskOpen(true)}
          onToast={showToast}
        />
        {/* 让好友发一条（一.2）+ 每角色自动发动态设置（一.3）+ 编辑动态（六.4） */}
        {askOpen && (
          <AskPostSheet
            title="让好友发一条"
            friends={momentFriendsOf(contacts, 'wx')}
            busyId={askBusyId}
            onClose={() => setAskOpen(false)}
            onAsk={(c) => void askMomentPost(c)}
            onOpenCfg={(c) => setCfgPeer(c)}
            renderAvatar={(c, size) => <WxAvatar src={c.avatar} alt={displayNameOf(c)} size={size} />}
          />
        )}
        {cfgPeer && (
          <MomentAutoCfgSheet
            contact={cfgPeer}
            platform="wx"
            platformLabel="朋友圈"
            onClose={() => setCfgPeer(null)}
            onToast={showToast}
          />
        )}
        {editingPost && (
          <EditPostDialog
            key={editingPost.id}
            initial={editingPost.text}
            busy={false}
            onCancel={() => setEditingPost(null)}
            onSave={(text) => {
              editMomentPost(editingPost.id, text);
              setEditingPost(null);
            }}
          />
        )}
      </>
    );
  }
  if (page === 'compose') {
    return (
      <ComposeMomentsPage
        onCancel={() => setPage('moments')}
        onPublish={publishMoment}
        onToast={showToast}
      />
    );
  }
  if (page === 'friendMoments' && friendMoments) {
    return (
      <>
        <MomentsPage
          me={me}
          owner={{ name: friendMoments.name, avatar: friendMoments.avatar }}
          posts={moments.filter((p) => p.authorName === friendMoments.name)}
          onBack={() => (detail ? setPage('friendDetail') : setPage('main'))}
          onCompose={() => setPage('compose')}
          onToggleLike={toggleLike}
          onComment={addComment}
          onDelete={deleteMoment}
          onToast={showToast}
        />
        {editingPost && (
          <EditPostDialog
            key={editingPost.id}
            initial={editingPost.text}
            busy={false}
            onCancel={() => setEditingPost(null)}
            onSave={(text) => {
              editMomentPost(editingPost.id, text);
              setEditingPost(null);
            }}
          />
        )}
      </>
    );
  }
  if (groupPage === 'create') {
    return (
      <WxGroupCreatePage
        contacts={contacts}
        onBack={() => setGroupPage(null)}
        onCreated={(g) => {
          refreshGroups();
          setGroupPage(null);
          setGroupPeer(g);
        }}
      />
    );
  }
  if (groupPage === 'list') {
    return (
      <WxGroupListPage
        contacts={contacts}
        onBack={() => setGroupPage(null)}
        onOpen={(g) => {
          refreshGroups();
          setGroupPage(null);
          setGroupPeer(g);
        }}
        onCreate={() => setGroupPage('create')}
      />
    );
  }
  if (groupPeer && groupInfoOpen) {
    return (
      <WxGroupInfoPage
        key={`info-${groupPeer.id}`}
        group={groupPeer}
        contacts={contacts}
        onBack={() => setGroupInfoOpen(false)}
        onUpdate={(patch) => {
          const next = updateGroupRecord(groupPeer.id, patch);
          refreshGroups();
          if (next) setGroupPeer(next);
        }}
        onDissolve={() => {
          dissolveGroupRecord(groupPeer.id);
          refreshGroups();
          setGroupPeer(null);
          setGroupInfoOpen(false);
          showToast('群聊已解散');
        }}
        onToast={showToast}
      />
    );
  }
  if (groupPeer) {
    return (
      <WxGroupChatPage
        key={groupPeer.id}
        group={groupPeer}
        me={me}
        contacts={contacts}
        ownerLabelOf={(p) => ownerName(p)}
        onBack={() => {
          refreshGroups();
          setGroupPeer(null);
        }}
        onUpdate={(patch) => {
          const next = updateGroupRecord(groupPeer.id, patch);
          refreshGroups();
          if (next) setGroupPeer(next);
        }}
        onOpenInfo={() => setGroupInfoOpen(true)}
        onDissolve={() => {
          dissolveGroupRecord(groupPeer.id);
          refreshGroups();
          setGroupPeer(null);
          showToast('群聊已解散');
        }}
        onToast={showToast}
      />
    );
  }
  if (chatPeer) {
    return (
      <ChatPage
        key={chatPeer.id}
        me={me}
        peer={chatPeer}
        contacts={contacts}
        ownerName={ownerName(chatPeer)}
        otherUnread={chatOtherUnread}
        onBack={backToList}
        onOpenFriendDetail={(c) => openFriendDetail(c)}
        onToast={showToast}
      />
    );
  }
  if (page === 'newFriends') {
    return <NewFriendsPage reqs={reqs} onBack={() => setPage('main')} onGoAdd={() => setPage('addFriend')} />;
  }
  if (page === 'addFriend') {
    return (
      <AddFriendPage
        contacts={contacts}
        me={me}
        onBack={() => setPage('main')}
        onAdded={handleFriendAdded}
        onOpenChat={(c) => setChatPeer(c)}
        onToast={showToast}
      />
    );
  }
  if (page === 'profile')
    return <ProfilePage me={me} record={meRecord} onBack={() => setPage('main')} onToast={showToast} />;
  if (page === 'settings') return <WxSettingsPage onBack={() => setPage('main')} onLogout={onLogout} />;
  if (page === 'services') return <WxServices friends={friends} myRealName={myRealName} onExit={() => setPage('main')} />;
  if (page === 'stickers') return <WxStickersPage onBack={() => setPage('main')} onToast={showToast} />;
  if (page === 'favorites') return <WxFavoritesPage onBack={() => setPage('main')} onToast={showToast} />;

  const TITLES: Record<Tab, string> = { chats: '微信', contacts: '通讯录', discover: '发现', me: '我' };

  return (
    <div ref={rootRef} className="relative flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      {/* 顶栏（微信：返回+搜索+＋；通讯录：＋；发现/我：无图标；左侧返回键退出微信回主屏） */}
      <div className="shrink-0 pt-[54px]">
        <div className="flex h-11 items-center px-4">
          <div className="flex flex-1 items-center justify-start">
            <button
              type="button"
              aria-label="返回主屏幕"
              data-testid="wx-exit"
              onClick={onExit}
              className="-ml-1.5 p-1 text-black/75 active:opacity-50 dark:text-white/75"
            >
              <ChevronLeft className="h-[23px] w-[23px]" strokeWidth={2.2} />
            </button>
          </div>
          <div className="text-[17px] font-medium">{TITLES[tab]}</div>
          <div className="flex flex-1 items-center justify-end gap-5">
            {tab === 'chats' && (
              <button
                type="button"
                aria-label="搜索"
                onClick={() => showToast('搜索暂未开放')}
                className="text-black/75 active:opacity-50 dark:text-white/75"
              >
                <Search className="h-[21px] w-[21px]" strokeWidth={1.9} />
              </button>
            )}
            {(tab === 'chats' || tab === 'contacts') && (
              <button
                type="button"
                aria-label={tab === 'chats' ? '更多功能' : '添加朋友'}
                data-testid="wx-plus"
                onClick={() => {
                  if (tab === 'contacts') {
                    setPage('addFriend');
                    return;
                  }
                  setMenuOpen(true);
                }}
                className="text-black/75 active:opacity-50 dark:text-white/75"
              >
                <Plus className="h-[22px] w-[22px]" strokeWidth={1.9} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 右上角 + 菜单 */}
      {menuOpen && (
        <>
          <div className="absolute inset-0 z-30" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div className="absolute right-3 top-[94px] z-40 w-[152px] overflow-hidden rounded-[8px] bg-[#4C4C4C] text-white shadow-xl dark:bg-[#383838]">
            <button
              type="button"
              data-testid="wx-menu-addfriend"
              onClick={() => {
                setMenuOpen(false);
                setPage('addFriend');
              }}
              className="flex w-full items-center gap-2.5 px-4 py-[11px] text-left text-[15.5px] active:bg-white/10"
            >
              <UserPlus className="h-[18px] w-[18px]" strokeWidth={1.9} />
              添加朋友
            </button>
            <button
              type="button"
              data-testid="wx-menu-group"
              onClick={() => {
                setMenuOpen(false);
                setGroupPage('create');
              }}
              className="flex w-full items-center gap-2.5 border-t border-white/10 px-4 py-[11px] text-left text-[15.5px] active:bg-white/10"
            >
              <Users className="h-[18px] w-[18px]" strokeWidth={1.9} />
              发起群聊
            </button>
            <button
              type="button"
              data-testid="wx-menu-scan"
              onClick={() => {
                setMenuOpen(false);
                showToast('「扫一扫」暂未开放');
              }}
              className="flex w-full items-center gap-2.5 border-t border-white/10 px-4 py-[11px] text-left text-[15.5px] active:bg-white/10"
            >
              <ScanLine className="h-[18px] w-[18px]" strokeWidth={1.9} />
              扫一扫
            </button>
            <button
              type="button"
              data-testid="wx-menu-pay"
              onClick={() => {
                setMenuOpen(false);
                showToast('「收付款」暂未开放');
              }}
              className="flex w-full items-center gap-2.5 border-t border-white/10 px-4 py-[11px] text-left text-[15.5px] active:bg-white/10"
            >
              <Banknote className="h-[18px] w-[18px]" strokeWidth={1.9} />
              收付款
            </button>
          </div>
        </>
      )}

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'chats' && (
          <div className="min-h-full bg-white dark:bg-[#1A1A1A]">
            {sessions.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-[14px] text-black/35 dark:text-white/35">还没有会话</p>
                <p className="mt-1 text-[12.5px] text-black/30 dark:text-white/30">添加好友后，在这里和 TA 聊天</p>
              </div>
            )}
            {sessions.map((row) => {
              const pinned = pinSet.has(row.key);
              const unreadCount = unreads[row.key] ?? 0;
              if (row.group) {
                // 群会话行（无长按菜单；点开进群聊页）
                const g = row.group;
                const gid = groupRowId(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    data-testid={`wx-chat-item-group-${g.id}`}
                    onClick={() => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      markRead(gid);
                      setGroupPeer(g);
                    }}
                    className={`flex w-full select-none items-center gap-3 border-b border-black/5 px-4 py-2.5 text-left active:bg-black/5 dark:border-white/10 dark:active:bg-white/5 ${
                      pinned ? 'bg-[#ECECEC] dark:bg-white/[0.06]' : ''
                    }`}
                  >
                    <span className="relative shrink-0">
                      <GroupAvatar group={g} contacts={contacts} size={44} />
                      {unreadCount > 0 && (
                        <span
                          data-testid={`wx-unread-badge-${gid}`}
                          aria-label={`${unreadCount} 条未读`}
                          className={
                            flagsMap[gid]?.muted === true
                              ? 'absolute -right-[3px] -top-[3px] block h-[9px] w-[9px] rounded-full bg-[#FA5151] ring-2 ring-white dark:ring-[#1A1A1A]'
                              : 'absolute -right-[7px] -top-[7px] flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[#FA5151] px-[5px] text-[11px] font-semibold leading-none text-white shadow-[0_1px_4px_rgba(0,0,0,0.25)] ring-2 ring-white dark:ring-[#1A1A1A]'
                          }
                        >
                          {flagsMap[gid]?.muted === true ? null : unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[16px]">{g.name}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          {flagsMap[gid]?.muted === true && (
                            <BellOff className="h-3.5 w-3.5 text-black/30 dark:text-white/30" strokeWidth={2} aria-label="消息免打扰" />
                          )}
                          <span className="text-[12px] text-black/35 dark:text-white/35">{fmtListTime(row.time)}</span>
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-black/40 dark:text-white/40">{row.preview || '群聊已创建'}</p>
                    </div>
                  </button>
                );
              }
              const contact = row.contact;
              if (!contact) return null;
              return (
                <button
                  key={contact.id}
                  type="button"
                  data-testid={`wx-chat-item-${contact.name}`}
                    onClick={() => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      markRead(contact.id);
                      setChatPeer(contact);
                    }}
                    onPointerDown={(e) => onSessionPointerDown(e, contact)}
                    onPointerMove={onSessionPointerMove}
                    onPointerUp={clearPress}
                    onPointerCancel={clearPress}
                    onPointerLeave={clearPress}
                    className={`flex w-full select-none items-center gap-3 border-b border-black/5 px-4 py-2.5 text-left active:bg-black/5 dark:border-white/10 dark:active:bg-white/5 ${
                      pinned ? 'bg-[#ECECEC] dark:bg-white/[0.06]' : ''
                    }`}
                  >
                    <span className="relative shrink-0">
                      <WxAvatar src={contact.avatar} alt={contact.name} size={44} />
                      {unreadCount > 0 && (
                        <span
                          data-testid={`wx-unread-badge-${contact.id}`}
                          aria-label={`${unreadCount} 条未读`}
                          className={
                            flagsMap[contact.id]?.muted === true
                              ? /* 免打扰：不显示数字，只显示小红点（原生微信同款） */
                                'absolute -right-[3px] -top-[3px] block h-[9px] w-[9px] rounded-full bg-[#FA5151] ring-2 ring-white dark:ring-[#1A1A1A]'
                              : 'absolute -right-[7px] -top-[7px] flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[#FA5151] px-[5px] text-[11px] font-semibold leading-none text-white shadow-[0_1px_4px_rgba(0,0,0,0.25)] ring-2 ring-white dark:ring-[#1A1A1A]'
                          }
                        >
                          {flagsMap[contact.id]?.muted === true ? null : unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[16px]">{contact.name}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          {flagsMap[contact.id]?.muted === true && (
                            <BellOff className="h-3.5 w-3.5 text-black/30 dark:text-white/30" strokeWidth={2} aria-label="消息免打扰" />
                          )}
                          <span className="text-[12px] text-black/35 dark:text-white/35">{fmtListTime(row.time)}</span>
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-black/40 dark:text-white/40">
                        {row.preview || '开始聊天吧'}
                      </p>
                    </div>
                  </button>
              );
            })}
          </div>
        )}

        {tab === 'contacts' && (
          <div className="relative min-h-full pb-4">
            {/* 功能入口 */}
            <div className="bg-white dark:bg-[#1A1A1A]">
              <WxMenuRow
                first
                label="新的朋友"
                testId="wx-newfriends-entry"
                onClick={() => setPage('newFriends')}
                icon={
                  <WxTileIcon bg="#F5A623">
                    <UserPlus className="h-[21px] w-[21px]" strokeWidth={2} />
                  </WxTileIcon>
                }
              />
              <WxMenuRow
                label="群聊"
                onClick={() => setGroupPage('list')}
                icon={
                  <WxTileIcon bg="#07C160">
                    <Users className="h-[21px] w-[21px]" strokeWidth={2} />
                  </WxTileIcon>
                }
              />
              <WxMenuRow
                label="标签"
                onClick={() => showToast('「标签」暂未开放')}
                icon={
                  <WxTileIcon bg="#4D9CF8">
                    <Tag className="h-[21px] w-[21px]" strokeWidth={2} />
                  </WxTileIcon>
                }
              />
              <WxMenuRow
                label="公众号"
                onClick={() => showToast('「公众号」暂未开放')}
                icon={
                  <WxTileIcon bg="#4D9CF8">
                    <Newspaper className="h-[21px] w-[21px]" strokeWidth={2} />
                  </WxTileIcon>
                }
              />
              <WxMenuRow
                label="服务号"
                onClick={() => showToast('「服务号」暂未开放')}
                icon={
                  <WxTileIcon bg="#4D9CF8">
                    <Wallet className="h-[21px] w-[21px]" strokeWidth={2} />
                  </WxTileIcon>
                }
              />
            </div>

            {/* 我（本人）—— 首次登录通讯录只有这一位；点击进入与好友同款的详情页 */}
            <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
              <WxMenuRow
                first
                label={me.name}
                testId="wx-contact-me"
                onClick={() => {
                  openFriendDetail(contacts.find((c) => c.id === me.id) ?? meAsContact(me));
                }}
                icon={<WxAvatar src={me.avatar} alt={me.name} size={38} />}
              />
            </div>

            {/* 好友（添加过才会出现，和信息 App 一致） */}
            {friends.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13.5px] leading-relaxed text-black/35 dark:text-white/35">
                还没有好友
                <br />
                点右上角 ＋ ›「添加朋友」认识新朋友
              </p>
            ) : (
              <div className="relative">
                {groups.map((g) => (
                  <div key={g.letter} id={`wx-letter-${g.letter}`}>
                    <p className="sticky top-0 bg-[#EDEDED] px-4 py-1 text-[13px] text-black/50 dark:bg-[#111111] dark:text-white/50">
                      {g.letter}
                    </p>
                    <div className="bg-white dark:bg-[#1A1A1A]">
                      {g.list.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          data-testid={`wx-contact-${c.name}`}
                          onClick={() => openFriendDetail(c)}
                          className="flex w-full items-center gap-3 border-b border-black/5 px-4 py-2.5 text-left active:bg-black/5 dark:border-white/10 dark:active:bg-white/5"
                        >
                          <WxAvatar src={c.avatar} alt={c.name} size={40} />
                          <span className="flex-1 truncate text-[16px]">{c.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {/* 字母索引条（只在好友列表区域悬浮） */}
                <div className="absolute right-1 top-2 flex flex-col items-center gap-[1px] text-[10px] text-black/45 dark:text-white/45">
                  {'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').map((ch) => (
                    <span
                      key={ch}
                      className={`px-1 ${groups.some((g) => g.letter === ch) ? '' : 'opacity-30'}`}
                    >
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'discover' && (
          <div className="space-y-2 pb-6">
            <div className="bg-white dark:bg-[#1A1A1A]">
              <WxMenuRow
                first
                label="朋友圈"
                testId="wx-moments-entry"
                onClick={() => setPage('moments')}
                icon={<WxIcMoments small />}
              />
            </div>
            <div className="bg-white dark:bg-[#1A1A1A]">
              <WxMenuRow
                first
                label="视频号"
                onClick={() => showToast('「视频号」暂未开放')}
                icon={<WxIcChannels />}
              />
            </div>
            <div className="bg-white dark:bg-[#1A1A1A]">
              <WxMenuRow
                first
                label="扫一扫"
                onClick={() => showToast('「扫一扫」暂未开放')}
                icon={<WxIcScan />}
              />
              <WxMenuRow
                label="听一听"
                onClick={() => showToast('「听一听」暂未开放')}
                icon={<WxIcListen />}
              />
            </div>
            <div className="bg-white dark:bg-[#1A1A1A]">
              <WxMenuRow
                first
                label="看一看"
                onClick={() => showToast('「看一看」暂未开放')}
                icon={<WxIcStories />}
              />
              <WxMenuRow
                label="搜一搜"
                onClick={() => showToast('「搜一搜」暂未开放')}
                icon={<WxIcSearch />}
              />
            </div>
            <div className="bg-white dark:bg-[#1A1A1A]">
              <WxMenuRow
                first
                label="游戏"
                onClick={() => showToast('「游戏」暂未开放')}
                icon={<WxIcGames />}
              />
            </div>
            <div className="bg-white dark:bg-[#1A1A1A]">
              <WxMenuRow
                first
                label="小程序"
                onClick={() => showToast('「小程序」暂未开放')}
                icon={<WxIcMiniProgram />}
              />
            </div>
          </div>
        )}

        {tab === 'me' && (
          <div className="space-y-2 pb-6">
            {/* 名片：头像 + 名字 + 微信号（微信原生白底样式，点击进个人信息页） */}
            <div className="bg-white dark:bg-[#1A1A1A]">
              <button
                type="button"
                data-testid="wx-me-profile"
                onClick={() => setPage('profile')}
                className="flex w-full items-center gap-4 px-4 py-5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <span className="block shrink-0">
                  <WxAvatar src={me.avatar} alt={me.name} size={64} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[21px] font-semibold leading-tight">{me.name}</span>
                  <span
                    data-testid="wx-me-wxid"
                    className="mt-1.5 block truncate text-[13.5px] text-black/45 dark:text-white/45"
                  >
                    微信号：{me.wechatId || me.phone || '未设置'}
                  </span>
                </span>
                <QrCode className="h-5 w-5 shrink-0 text-black/50 dark:text-white/50" strokeWidth={1.8} />
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
              </button>
            </div>

            <div className="bg-white dark:bg-[#1A1A1A]">
              <WxMenuRow
                first
                label="服务"
                testId="wx-services-entry"
                onClick={() => setPage('services')}
                icon={<WxIcServices />}
              />
            </div>

            <div className="bg-white dark:bg-[#1A1A1A]">
              <WxMenuRow
                first
                label="收藏"
                testId="wx-me-favorites"
                onClick={() => setPage('favorites')}
                icon={<WxIcFavorites />}
              />
              <WxMenuRow
                label="朋友圈"
                testId="wx-me-moments"
                onClick={() => setPage('moments')}
                icon={<WxIcMoments small />}
              />
              <WxMenuRow
                label="作品"
                onClick={() => showToast('「作品」暂未开放')}
                icon={<WxIcWorks />}
              />
              <WxMenuRow
                label="小店与卡包"
                onClick={() => showToast('「小店与卡包」暂未开放')}
                icon={<WxIcShop />}
              />
              <WxMenuRow
                label="表情"
                testId="wx-me-stickers"
                onClick={() => setPage('stickers')}
                icon={<WxIcSticker />}
              />
            </div>

            <div className="bg-white dark:bg-[#1A1A1A]">
              <WxMenuRow
                first
                label="设置"
                testId="wx-me-settings"
                onClick={() => setPage('settings')}
                icon={<WxIcSettings />}
              />
            </div>
          </div>
        )}
      </div>

      {/* 底部 TabBar（上移预留底部横杠安全区） */}
      <div className="shrink-0 border-t border-black/10 bg-[#F7F7F7] pb-[16px] dark:border-white/10 dark:bg-[#1A1A1A]">
        <div className="flex h-[52px] items-stretch">
          {(
            [
              ['chats', '微信', <MessageCircle key="i" className="h-[26px] w-[26px]" strokeWidth={1.8} />, true],
              ['contacts', '通讯录', <Users key="i" className="h-[26px] w-[26px]" strokeWidth={1.8} />, false],
              ['discover', '发现', <Compass key="i" className="h-[26px] w-[26px]" strokeWidth={1.8} />, false],
              ['me', '我', <User key="i" className="h-[26px] w-[26px]" strokeWidth={1.8} />, false],
            ] as Array<[Tab, string, React.ReactNode, boolean]>
          ).map(([id, label, icon, fillActive]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                data-testid={`wx-tab-${id}`}
                onClick={() => setTab(id)}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 ${
                  active ? 'text-[#07C160]' : 'text-black/55 dark:text-white/55'
                }`}
                aria-label={label}
              >
                <span className={`relative ${active && fillActive ? '[&>svg]:fill-current' : ''}`}>
                  {icon}
                  {id === 'chats' && totalUnread > 0 && (
                    <span
                      data-testid="wx-tab-badge-chats"
                      aria-label={`${totalUnread} 条未读`}
                      className="absolute -right-[9px] -top-[6px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#FA5151] px-[4px] text-[10.5px] font-semibold leading-none text-white ring-2 ring-[#F7F7F7] dark:ring-[#1A1A1A]"
                    >
                      {totalUnread > 99 ? '99+' : totalUnread}
                    </span>
                  )}
                </span>
                <span className="text-[10px]">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 长按会话菜单（QQ 同款竖向卡片：标为未读/置顶该聊天/不显示该聊天/删除该聊天；浅色白底黑字，点空白处关闭） */}
      {ctx && (
        <div
          className="absolute inset-0 z-40"
          data-testid="wx-session-ctx-overlay"
          onClick={closeCtx}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            role="menu"
            aria-label="会话操作"
            data-testid="wx-session-ctx"
            className="absolute z-50 min-w-[176px] overflow-hidden rounded-[12px] border border-black/[0.08] bg-white/95 text-black shadow-[0_12px_36px_rgba(0,0,0,0.18)] backdrop-blur-md dark:border-white/[0.08] dark:bg-[#4C4C4C]/95 dark:text-white dark:shadow-[0_12px_36px_rgba(0,0,0,0.35)]"
            style={{ left: ctx.x, top: ctx.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              data-testid="wx-ctx-unread"
              onClick={() => {
                toggleUnread(ctx.contact.id);
                closeCtx();
              }}
              className="flex h-[46px] w-full items-center gap-2.5 border-b border-black/[0.06] px-4 text-left text-[15px] active:bg-black/[0.05] dark:border-white/10 dark:active:bg-white/10"
            >
              <MailOpen className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
              {unreads[ctx.contact.id] ? '标为已读' : '标为未读'}
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="wx-ctx-pin"
              onClick={() => {
                togglePin(ctx.contact.id);
                closeCtx();
              }}
              className="flex h-[46px] w-full items-center gap-2.5 border-b border-black/[0.06] px-4 text-left text-[15px] active:bg-black/[0.05] dark:border-white/10 dark:active:bg-white/10"
            >
              {pinSet.has(ctx.contact.id) ? (
                <PinOff className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
              ) : (
                <Pin className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
              )}
              {pinSet.has(ctx.contact.id) ? '取消置顶' : '置顶该聊天'}
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="wx-ctx-hide"
              onClick={() => {
                hideSession(ctx.contact.id);
                closeCtx();
              }}
              className="flex h-[46px] w-full items-center gap-2.5 border-b border-black/[0.06] px-4 text-left text-[15px] active:bg-black/[0.05] dark:border-white/10 dark:active:bg-white/10"
            >
              <EyeOff className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
              不显示该聊天
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="wx-ctx-delete"
              onClick={() => {
                deleteSession(ctx.contact.id);
                closeCtx();
              }}
              className="flex h-[46px] w-full items-center gap-2.5 px-4 text-left text-[15px] text-[#FA5151] active:bg-black/[0.05] dark:text-[#FF9A97] dark:active:bg-white/10"
            >
              <Trash2 className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
              删除该聊天
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-[8px] bg-black/75 px-4 py-2.5 text-[14px] text-white">
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------- App 入口 ----------------

export default function WeChatApp() {
  const closeApp = useUI((s) => s.closeApp);
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<WxUser | null>(null);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  /** id → 真实名字（钱包持卡人用；微信内显示的是昵称，昵称不是真实名字） */
  const [realNameById, setRealNameById] = useState<Record<string, string>>({});

  const toWxUser = useCallback((c: ContactRecord): WxUser => {
    return {
      id: c.id,
      name: displayNameOf(c),
      avatar: c.avatar,
      wechatId: c.wechatId,
      phone: c.phone,
      qqId: c.qqId,
    };
  }, []);

  /** NPC 归属者名字（聊天人设用） */
  const ownerName = useMemo(() => {
    const byId = new Map(contacts.map((c) => [c.id, c.name]));
    const npcOwner = (c: ContactRecord): string | null => {
      if (c.kind !== 'npc' || !c.ownerId) return null;
      return byId.get(c.ownerId) ?? null;
    };
    return npcOwner;
  }, [contacts]);

  const loadContacts = useCallback(async (): Promise<ContactRecord[]> => {
    // 微信内显示昵称（昵称优先于真实名字）；真实名字另存映射供钱包持卡人使用
    const raw = await listContacts();
    setRealNameById(Object.fromEntries(raw.map((c) => [c.id, c.name])));
    return withDisplayNames(raw);
  }, []);

  /** 重新拉取联系人（添加好友后调用，列表即时生效） */
  const reloadContacts = useCallback(async () => {
    const list = await loadContacts().catch(() => [] as ContactRecord[]);
    setContacts(list);
  }, [loadContacts]);

  // 启动：拉联系人 + 恢复登录态（联系人被删则自动登出）
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await loadContacts().catch(() => [] as ContactRecord[]);
      if (!alive) return;
      setContacts(list);
      try {
        const savedId = window.localStorage.getItem(LS_SESSION);
        if (savedId) {
          const u = list.find((c) => c.id === savedId && c.kind === 'user');
          if (u) setUser(toWxUser(u));
          else window.localStorage.removeItem(LS_SESSION);
        }
      } catch {
        // 忽略
      }
      setBooting(false);
    })();
    return () => {
      alive = false;
    };
  }, [loadContacts, toWxUser]);

  const handleLogin = useCallback((u: WxUser) => {
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

  if (booting) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#EDEDED] dark:bg-[#111111]">
        <svg viewBox="0 0 40 40" className="h-16 w-16 opacity-90" aria-hidden="true">
          <path
            d="M15.5 6.5C9.1 6.5 4 10.8 4 16.1c0 3 1.7 5.7 4.4 7.5l-1.1 3.9 4.3-2.3c1.2.3 2.5.5 3.9.5h.8c-.2-.9-.3-1.8-.3-2.7 0-5.6 5.2-10.1 11.7-10.1.3 0 .5 0 .8.1C26.9 9.2 21.6 6.5 15.5 6.5z"
            fill="#3ECB5C"
          />
          <path
            d="M27.5 14.5c-5.6 0-10.2 3.9-10.2 8.7s4.6 8.7 10.2 8.7c1.1 0 2.2-.2 3.2-.4l3.8 2-1-3.5c2.2-1.6 3.6-4 3.6-6.8 0-4.8-4.6-8.7-9.6-8.7z"
            fill="#07C160"
          />
        </svg>
        <p className="mt-4 text-[13px] text-black/40 dark:text-white/40">微信</p>
      </div>
    );
  }

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  return (
    <MainScreen
      me={user}
      contacts={contacts}
      myRealName={realNameById[user.id] ?? user.name}
      ownerName={ownerName}
      reloadContacts={reloadContacts}
      onLogout={handleLogout}
      onExit={closeApp}
    />
  );
}
