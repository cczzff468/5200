'use client';

/**
 * 聊天设置页 + 聊天背景页 + 回复条数页 + 翻译页 + 查找聊天记录页 + 信息端聊天设置页
 * （微信 / QQ / 信息三端，variant 区分主题）：
 * - ChatSettingsPage（微信/QQ）：信息卡片（头像/名字/微信号或QQ号/地区职业）、置顶聊天、消息免打扰、
 *   回复条数入口（进入独立二级页 ChatReplyCountPage）、翻译入口（进入 ChatTranslatePage）、
 *   分句发送开关、查找聊天记录入口、聊天背景入口（进入独立二级页 ChatBgPage）
 * - ChatReplyCountPage：回复条数选择页 —— 1/3/5/7/15/20/25/30 条（上限，可少发），AI 像
 *   真人一样一句一句连发多条消息（一句一条，由 @/lib/reply-count 切分与节奏控制）
 * - ChatTranslatePage：翻译设置页（三端共用）—— 总开关 + 目标语言多选（每条消息气泡下方
 *   显示全部已选语言的译文，由 @/lib/chat-translate 请求与缓存）
 * - SmsChatSettingsPage：信息 App 的聊天设置页（iOS 风格：翻译入口 + 分句发送开关）
 * - ChatBgPage：聊天背景独立页 —— 顶部预览卡片、从手机相册上传、内置纯色壁纸
 * - ChatSearchPage：关键词查找当前聊天记录，点击结果定位回聊天页并高亮
 * - 置顶/免打扰/背景持久化在 @/lib/chat-flags（localStorage），回复条数/翻译/分句发送持久化在
 *   @/lib/reply-count / @/lib/chat-translate / @/lib/sentence-send（localStorage，按会话键隔离），
 *   背景图片本体在 IndexedDB（@/lib/ios/contacts-store 的 getChatBgImage/setChatBgImage）
 */
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronLeft, ChevronRight, Image as ImageIcon, Loader2, Search } from 'lucide-react';
import type { ChatBgMode } from '@/lib/chat-flags';
import { REPLY_COUNT_OPTIONS } from '@/lib/reply-count';
import { TRANSLATE_LANGS } from '@/lib/chat-translate';

export type ChatSettingsVariant = 'wx' | 'qq' | 'sms';

/** 当前聊天背景状态（从 chat-flags 取） */
export interface ChatSettingsBg {
  mode: ChatBgMode;
  /** mode === 'color' 时的纯色 */
  color: string;
}

/** App 默认聊天底色（预览卡片与「默认」色块用） */
export const WX_CHAT_BG_DEFAULT = '#EDEDED';
export const QQ_CHAT_BG_DEFAULT = '#F5F6F7';

/** 内置纯色壁纸（淡色系 14 款，搭配白/绿气泡均可读） */
export const CHAT_BG_SOLID_COLORS: readonly string[] = [
  '#BAD5E8',
  '#A8D8B9',
  '#FFE3B3',
  '#FFC9D4',
  '#D6C9F0',
  '#B5E3D8',
  '#FFF6B3',
  '#CDD7E0',
  '#FFC7A8',
  '#E2E8CD',
  '#F3D9E5',
  '#C9E7F5',
  '#E5D3BD',
  '#D7DBDE',
];

/** 聊天页背景层样式：color → 纯色；image → 图片（cover 居中）；default → undefined（不渲染层） */
export function chatBgLayerStyle(bg: ChatSettingsBg, imageUrl: string | null): CSSProperties | undefined {
  if (bg.mode === 'color' && bg.color) {
    return { backgroundColor: bg.color };
  }
  if (bg.mode === 'image' && imageUrl) {
    return {
      backgroundImage: `url(${imageUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    };
  }
  return undefined;
}

/** iOS 风格开关（微信绿 / QQ 绿，on 色随 variant） */
export function ChatToggle({
  on,
  onChange,
  accent,
  testId,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  accent: string;
  testId?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!on)}
      className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 ${
        on ? '' : 'bg-black/[0.12] dark:bg-white/[0.22]'
      }`}
      style={on ? { backgroundColor: accent } : undefined}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] h-[26px] w-[26px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] transition-all duration-200 ${
          on ? 'left-[22px]' : 'left-[2px]'
        }`}
      />
    </button>
  );
}

/** 聊天设置页 */

export function ChatSettingsPage({
  variant,
  title,
  peerName,
  peerAvatar,
  idLabel,
  idValue,
  metaLine,
  pinned,
  muted,
  bg,
  bgImageUrl,
  replyCount,
  translateSummary,
  sentenceSend,
  onBack,
  onTogglePinned,
  onToggleMuted,
  onOpenReplyCount,
  onOpenTranslate,
  onToggleSentenceSend,
  onOpenSearch,
  onOpenBg,
}: {
  variant: ChatSettingsVariant;
  /** 标题：微信「聊天信息」/ QQ「聊天设置」 */
  title: string;
  peerName: string;
  peerAvatar: string | null;
  /** 信息卡第二行：微信号 / QQ 号 */
  idLabel: string;
  idValue: string;
  /** 信息卡第三行：地区 · 职业（可为空） */
  metaLine: string;
  pinned: boolean;
  muted: boolean;
  bg: ChatSettingsBg;
  /** mode === 'image' 时已加载的图片 data URL（未加载完为 null；入口行迷你预览用） */
  bgImageUrl: string | null;
  /** 当前会话的回复条数（AI 连发多条消息） */
  replyCount: number;
  /** 翻译入口行右侧摘要：未开启 / 已选语言列表 / 未选择语言 */
  translateSummary: string;
  /** 分句发送开关状态（开启后连续发消息 AI 不回复，输入框为空再点发送才触发回复） */
  sentenceSend: boolean;
  onBack: () => void;
  onTogglePinned: (v: boolean) => void;
  onToggleMuted: (v: boolean) => void;
  onOpenReplyCount: () => void;
  onOpenTranslate: () => void;
  onToggleSentenceSend: (v: boolean) => void;
  onOpenSearch: () => void;
  onOpenBg: () => void;
}) {
  const wx = variant === 'wx';

  // 主题 token（微信灰白 / QQ 冷灰白）
  const pageCls = wx ? 'bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white' : 'bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white';
  const cardCls = wx ? 'rounded-[10px] bg-white dark:bg-[#1A1A1A]' : 'rounded-[14px] bg-white dark:bg-[#232529]';
  const dividerCls = wx ? 'border-black/5 dark:border-white/10' : 'border-black/[0.04] dark:border-white/[0.06]';
  const rowCls = wx
    ? 'flex w-full items-center justify-between px-4 py-3 text-left text-[16px] active:bg-black/[0.04] dark:active:bg-white/[0.06]'
    : 'flex w-full items-center justify-between px-4 min-h-[54px] text-left text-[15.5px] active:bg-black/[0.03] dark:active:bg-white/[0.05]';
  // 开关选中色：微信绿 / QQ 蓝
  const accent = wx ? '#07C160' : '#0099FF';
  const defaultBg = wx ? WX_CHAT_BG_DEFAULT : QQ_CHAT_BG_DEFAULT;
  const titleCls = wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold';
  const headerH = wx ? 'h-11' : 'h-12';
  const testPrefix = variant;

  return (
    <div className={`absolute inset-0 z-40 flex h-full w-full flex-col ${pageCls}`}>
      {/* 顶栏 */}
      <div className="shrink-0 pt-[54px]">
        <div className={`flex ${headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-chat-settings-back`}
            onClick={onBack}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${titleCls}`}>{title}</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
        {/* 信息卡片 */}
        <div className={`${cardCls} overflow-hidden`}>
          <div className={`flex items-center gap-3 px-4 ${wx ? 'py-4' : 'py-3.5'}`}>
            <ChatSettingsAvatar variant={variant} src={peerAvatar} alt={peerName} size={56} />
            <div className="min-w-0 flex-1">
              <p className={`truncate ${wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold'}`}>{peerName}</p>
              <p className="mt-1 truncate text-[13px] text-black/45 dark:text-white/45">
                {idLabel}：{idValue}
              </p>
              {metaLine && <p className="mt-0.5 truncate text-[13px] text-black/45 dark:text-white/45">{metaLine}</p>}
            </div>
          </div>
        </div>

        {/* 置顶 / 免打扰开关（纯文字行，无图标） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span>置顶聊天</span>
            <ChatToggle
              on={pinned}
              onChange={onTogglePinned}
              accent={accent}
              testId={`${testPrefix}-settings-pin`}
              label="置顶聊天"
            />
          </div>
          <div className={`border-t ${dividerCls}`} />
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span>消息免打扰</span>
            <ChatToggle
              on={muted}
              onChange={onToggleMuted}
              accent={accent}
              testId={`${testPrefix}-settings-mute`}
              label="消息免打扰"
            />
          </div>
        </div>

        {/* 回复条数：AI 按选定条数连发多条消息（独立二级页选择） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <button
            type="button"
            data-testid={`${testPrefix}-settings-reply-count`}
            onClick={onOpenReplyCount}
            className={rowCls}
          >
            <span>回复条数</span>
            <span className="flex shrink-0 items-center gap-2">
              <span data-testid={`${testPrefix}-reply-count-value`} className="text-[14px] text-black/40 dark:text-white/40">
                {replyCount} 条
              </span>
              <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
            </span>
          </button>
        </div>

        {/* 翻译：气泡下方多语言翻译（独立二级页选语言，三端共用 ChatTranslatePage） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <button
            type="button"
            data-testid={`${testPrefix}-settings-translate`}
            onClick={onOpenTranslate}
            className={rowCls}
          >
            <span>翻译</span>
            <span className="flex shrink-0 items-center gap-2">
              <span
                data-testid={`${testPrefix}-translate-summary`}
                className="max-w-[150px] truncate text-[14px] text-black/40 dark:text-white/40"
              >
                {translateSummary}
              </span>
              <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
            </span>
          </button>
        </div>

        {/* 分句发送：开启后连续发的消息对方不回复，输入框为空时再点一次「发送」才触发回复 */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span>分句发送</span>
            <ChatToggle
              on={sentenceSend}
              onChange={onToggleSentenceSend}
              accent={accent}
              testId={`${testPrefix}-settings-sentence`}
              label="分句发送"
            />
          </div>
        </div>
        <p className="px-1 pt-2 text-[12.5px] leading-[1.6] text-black/40 dark:text-white/40">
          开启后，你可以连续发送多条消息，对方都不会回复；输入框为空时再点一次「发送」，对方才会一并回复。
        </p>

        {/* 查找聊天记录 */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <button type="button" data-testid={`${testPrefix}-settings-search`} onClick={onOpenSearch} className={rowCls}>
            <span className="flex items-center gap-2.5">
              <Search className="h-[18px] w-[18px] text-black/60 dark:text-white/60" strokeWidth={1.9} aria-hidden="true" />
              查找聊天记录
            </span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>

        {/* 聊天背景：二级页入口行（右侧当前背景迷你预览） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <button type="button" data-testid={`${testPrefix}-settings-bg`} onClick={onOpenBg} className={rowCls}>
            <span>聊天背景</span>
            <span className="flex shrink-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="h-[22px] w-[22px] rounded-[5px] border border-black/10 bg-cover bg-center dark:border-white/15"
                style={chatBgLayerStyle(bg, bgImageUrl) ?? { backgroundColor: defaultBg }}
              />
              <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** 回复条数选择页（聊天设置二级页）：AI 像真人一样按选定条数连发多条消息 */

export function ChatReplyCountPage({
  variant,
  value,
  onBack,
  onSelect,
}: {
  variant: ChatSettingsVariant;
  /** 当前会话的回复条数 */
  value: number;
  onBack: () => void;
  onSelect: (n: number) => void;
}) {
  const wx = variant === 'wx';

  // 主题 token（与 ChatSettingsPage 一致）
  const pageCls = wx ? 'bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white' : 'bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white';
  const cardCls = wx ? 'rounded-[10px] bg-white dark:bg-[#1A1A1A]' : 'rounded-[14px] bg-white dark:bg-[#232529]';
  const dividerCls = wx ? 'border-black/5 dark:border-white/10' : 'border-black/[0.04] dark:border-white/[0.06]';
  const rowCls = wx
    ? 'flex w-full items-center justify-between px-4 py-3 text-left text-[16px] active:bg-black/[0.04] dark:active:bg-white/[0.06]'
    : 'flex w-full items-center justify-between px-4 min-h-[54px] text-left text-[15.5px] active:bg-black/[0.03] dark:active:bg-white/[0.05]';
  // 选中勾色：微信绿 / QQ 蓝
  const accent = wx ? '#07C160' : '#0099FF';
  const titleCls = wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold';
  const headerH = wx ? 'h-11' : 'h-12';
  const testPrefix = variant;

  return (
    <div className={`absolute inset-0 z-50 flex h-full w-full flex-col ${pageCls}`}>
      {/* 顶栏 */}
      <div className="shrink-0 pt-[54px]">
        <div className={`flex ${headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-reply-count-back`}
            onClick={onBack}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${titleCls}`}>回复条数</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
        <div className={`${cardCls} overflow-hidden`}>
          {REPLY_COUNT_OPTIONS.map((n, i) => (
            <div key={n}>
              {i > 0 && <div className={`border-t ${dividerCls}`} />}
              <button
                type="button"
                data-testid={`${testPrefix}-reply-count-option-${n}`}
                aria-label={`回复条数 ${n} 条`}
                onClick={() => onSelect(n)}
                className={rowCls}
              >
                <span>{n} 条</span>
                {value === n && (
                  <span className="grid place-items-center" style={{ color: accent }} aria-label="已选中">
                    <Check className="h-5 w-5" strokeWidth={2.4} />
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
        <p className="px-1 pt-3 text-[12.5px] leading-[1.6] text-black/40 dark:text-white/40">
          对方将按选定条数像真人一样连续发送多条消息，每条独立一个气泡；换一个聊天对象需要单独设置。
        </p>
      </div>
    </div>
  );
}

/** 聊天背景页（聊天设置二级页）：顶部预览卡片 → 从手机相册上传 → 内置纯色壁纸 */

export function ChatBgPage({
  variant,
  bg,
  bgImageUrl,
  uploading,
  onBack,
  onPickColor,
  onPickImageFile,
  onResetBg,
}: {
  variant: ChatSettingsVariant;
  bg: ChatSettingsBg;
  /** mode === 'image' 时已加载的图片 data URL（未加载完为 null） */
  bgImageUrl: string | null;
  uploading: boolean;
  onBack: () => void;
  onPickColor: (color: string) => void;
  onPickImageFile: (file: File) => void;
  onResetBg: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const wx = variant === 'wx';

  // 主题 token（与 ChatSettingsPage 一致）
  const pageCls = wx ? 'bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white' : 'bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white';
  const cardCls = wx ? 'rounded-[10px] bg-white dark:bg-[#1A1A1A]' : 'rounded-[14px] bg-white dark:bg-[#232529]';
  // 选中/勾色：微信绿 / QQ 蓝
  const accent = wx ? '#07C160' : '#0099FF';
  const defaultBg = wx ? WX_CHAT_BG_DEFAULT : QQ_CHAT_BG_DEFAULT;
  const titleCls = wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold';
  const headerH = wx ? 'h-11' : 'h-12';
  const testPrefix = variant;

  // 「默认」色块当前选中 = 背景为默认模式
  const isDefault = bg.mode === 'default';

  return (
    <div className={`absolute inset-0 z-50 flex h-full w-full flex-col ${pageCls}`}>
      {/* 顶栏 */}
      <div className="shrink-0 pt-[54px]">
        <div className={`flex ${headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-bg-page-back`}
            onClick={onBack}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${titleCls}`}>聊天背景</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
        <div className={`${cardCls} overflow-hidden p-4`}>
          {/* 预览卡片（9:16 竖版，模拟聊天效果，即时反映当前选择） */}
          <div
            data-testid={`${testPrefix}-bg-preview`}
            className="relative mx-auto w-full max-w-[248px] overflow-hidden rounded-[14px] border border-black/10 shadow-[0_2px_12px_rgba(0,0,0,0.08)] dark:border-white/10"
            style={{ aspectRatio: '9 / 16' }}
          >
            <div className="absolute inset-0" style={chatBgLayerStyle(bg, bgImageUrl) ?? { backgroundColor: defaultBg }} />
            <div className={`relative flex h-full flex-col p-3 text-[11px] leading-[1.5] ${wx ? 'text-black' : 'text-[#1F2329]'}`}>
              <p className="text-center text-[9px] text-black/35 dark:text-white/40">昨天 20:15</p>
              <div className="mt-2 max-w-[78%] self-start rounded-[7px] bg-white/95 px-2 py-1.5 shadow-sm dark:bg-[#2A2C31]/95 dark:text-white">
                在吗？
              </div>
              <div
                className="mt-2 max-w-[78%] self-end rounded-[7px] px-2 py-1.5 text-black shadow-sm"
                style={{ backgroundColor: wx ? '#95EC69' : '#0099FF', color: wx ? '#000' : '#fff' }}
              >
                刚看到消息啦～
              </div>
              <div className="mt-2 max-w-[78%] self-start rounded-[7px] bg-white/95 px-2 py-1.5 shadow-sm dark:bg-[#2A2C31]/95 dark:text-white">
                周末一起出去玩吗？
              </div>
              <div
                className="mt-auto max-w-[78%] self-end rounded-[7px] px-2 py-1.5 text-black shadow-sm"
                style={{ backgroundColor: wx ? '#95EC69' : '#0099FF', color: wx ? '#000' : '#fff' }}
              >
                好呀好呀 😄
              </div>
            </div>
            {bg.mode === 'image' && !bgImageUrl && (
              <div className="absolute inset-0 grid place-items-center bg-black/25">
                <Loader2 className="h-5 w-5 animate-spin text-white" aria-label="背景加载中" />
              </div>
            )}
          </div>

          {/* 从手机相册上传 */}
          <button
            type="button"
            data-testid={`${testPrefix}-bg-upload`}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className={`mt-4 flex w-full items-center justify-center gap-2 rounded-[10px] border border-black/10 py-2.5 text-[15px] active:bg-black/[0.04] disabled:opacity-60 dark:border-white/15 dark:active:bg-white/[0.06] ${
              wx ? '' : 'text-[14.5px]'
            }`}
          >
            {uploading ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
            ) : (
              <ImageIcon className="h-[18px] w-[18px] text-black/55 dark:text-white/55" strokeWidth={1.9} aria-hidden="true" />
            )}
            {uploading ? '正在处理图片…' : '从手机相册上传'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            data-testid={`${testPrefix}-bg-input`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onPickImageFile(f);
            }}
          />

          {/* 内置纯色壁纸 */}
          <p className="pb-2.5 pt-4 text-[13px] text-black/40 dark:text-white/40">内置纯色壁纸</p>
          <div className="grid grid-cols-5 gap-3">
            {/* 默认壁纸 */}
            <button
              type="button"
              aria-label="恢复默认背景"
              data-testid={`${testPrefix}-bg-default`}
              onClick={onResetBg}
              className="relative h-14 overflow-hidden rounded-[10px] border border-black/10 active:opacity-70 dark:border-white/15"
              style={{ backgroundColor: defaultBg }}
            >
              {isDefault && (
                <span className="absolute inset-0 grid place-items-center" style={{ color: accent }}>
                  <Check className="h-5 w-5" strokeWidth={2.4} />
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 bg-black/25 py-[2px] text-center text-[10px] leading-none text-white">
                默认
              </span>
            </button>
            {CHAT_BG_SOLID_COLORS.map((c) => {
              const selected = bg.mode === 'color' && bg.color.toLowerCase() === c.toLowerCase();
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={`壁纸 ${c}`}
                  data-testid={`${testPrefix}-bg-color-${c.slice(1)}`}
                  onClick={() => onPickColor(c)}
                  className="relative h-14 overflow-hidden rounded-[10px] border border-black/10 active:opacity-70 dark:border-white/10"
                  style={{ backgroundColor: c }}
                >
                  {selected && (
                    <span className="absolute inset-0 grid place-items-center text-black/55">
                      <Check className="h-5 w-5" strokeWidth={2.4} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 设置页头像（微信圆角方 / QQ、信息圆形，首字母兜底同各 App 风格） */
function ChatSettingsAvatar({ variant, src, alt, size }: { variant: ChatSettingsVariant; src: string | null; alt: string; size: number }) {
  const wx = variant === 'wx';
  const style: CSSProperties = { width: size, height: size };
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        draggable={false}
        className={`shrink-0 bg-muted object-cover ${wx ? 'rounded-[7px]' : 'rounded-full'}`}
        style={style}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center font-semibold text-white ${
        wx ? 'rounded-[7px] bg-[#C9C9CE] dark:bg-[#3C3C42]' : variant === 'sms' ? 'rounded-full bg-[#C7C7CC] dark:bg-[#3A3A3C]' : 'rounded-full bg-[#B9D9F3]'
      }`}
      style={{ ...style, fontSize: Math.round(size * 0.42) }}
    >
      {alt.slice(0, 1) || (wx ? '' : 'Q')}
    </div>
  );
}

/** 查找聊天记录页 */

export interface ChatSearchItem {
  id: string;
  role: 'me' | 'peer';
  text: string;
  time: number;
}

function fmtSearchTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

export function ChatSearchPage({
  variant,
  items,
  myName,
  peerName,
  myAvatar,
  peerAvatar,
  onClose,
  onJumpTo,
}: {
  variant: ChatSettingsVariant;
  /** 可搜索的聊天记录（调用方已把各类消息规整成文本摘要） */
  items: ChatSearchItem[];
  myName: string;
  peerName: string;
  myAvatar: string | null;
  peerAvatar: string | null;
  onClose: () => void;
  onJumpTo: (id: string) => void;
}) {
  const [kw, setKw] = useState('');
  const wx = variant === 'wx';

  const pageCls = wx ? 'bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white' : 'bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white';
  const cardCls = wx ? 'rounded-[10px] bg-white dark:bg-[#1A1A1A]' : 'rounded-[14px] bg-white dark:bg-[#232529]';
  const titleCls = wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold';
  const headerH = wx ? 'h-11' : 'h-12';
  const testPrefix = variant;

  const results = useMemo(() => {
    const key = kw.trim().toLowerCase();
    if (!key) return null;
    return items.filter((it) => it.text.toLowerCase().includes(key));
  }, [items, kw]);

  /** 命中片段高亮：按关键词切片 */
  const renderSnippet = (text: string, key: string) => {
    const lower = text.toLowerCase();
    const k = key.toLowerCase();
    const parts: Array<{ t: string; hit: boolean }> = [];
    let i = 0;
    while (true) {
      const idx = lower.indexOf(k, i);
      if (idx < 0) {
        parts.push({ t: text.slice(i), hit: false });
        break;
      }
      if (idx > i) parts.push({ t: text.slice(i, idx), hit: false });
      parts.push({ t: text.slice(idx, idx + k.length), hit: true });
      i = idx + k.length;
    }
    return parts.map((p, n) =>
      p.hit ? (
        <span key={n} className="rounded-[2px] bg-[#F7E36D]/70 text-black dark:bg-[#8A7A2E]/70 dark:text-white">
          {p.t}
        </span>
      ) : (
        <span key={n}>{p.t}</span>
      )
    );
  };

  const key = kw.trim();

  return (
    <div className={`absolute inset-0 z-40 flex h-full w-full flex-col ${pageCls}`}>
      {/* 顶栏 */}
      <div className="shrink-0 pt-[54px]">
        <div className={`flex ${headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-chat-search-back`}
            onClick={onClose}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${titleCls}`}>查找聊天记录</div>
        </div>
        {/* 搜索框 */}
        <div className={`flex items-center gap-2 px-4 pb-2.5 ${wx ? 'pt-1' : 'pt-1.5'}`}>
          <div className="flex h-[34px] flex-1 items-center gap-2 rounded-[9px] bg-black/[0.05] px-2.5 dark:bg-white/[0.08]">
            <Search className="h-[15px] w-[15px] shrink-0 text-black/35 dark:text-white/35" strokeWidth={2.2} aria-hidden="true" />
            <input
              autoFocus
              type="text"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder="搜索聊天内容"
              data-testid={`${testPrefix}-chat-search-input`}
              aria-label="搜索聊天内容"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
            {kw && (
              <button type="button" aria-label="清空" onClick={() => setKw('')} className="shrink-0 active:opacity-60">
                <span className="grid h-[16px] w-[16px] place-items-center rounded-full bg-black/25 text-[10px] leading-none text-white dark:bg-white/30">
                  ×
                </span>
              </button>
            )}
          </div>
          <button type="button" onClick={onClose} className={`shrink-0 text-[15px] active:opacity-60 ${wx ? '' : 'text-[15px]'}`}>
            取消
          </button>
        </div>
      </div>

      {/* 结果 */}
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {results === null ? (
          <div className="mt-16 text-center">
            <Search className="mx-auto h-10 w-10 text-black/15 dark:text-white/15" strokeWidth={1.5} aria-hidden="true" />
            <p className="mt-3 text-[14px] text-black/35 dark:text-white/35">输入关键词查找聊天记录</p>
          </div>
        ) : results.length === 0 ? (
          <p className="mt-16 text-center text-[14px] text-black/35 dark:text-white/35">没有找到与「{key}」相关的聊天记录</p>
        ) : (
          <>
            <p className="px-1 pb-2 pt-1 text-[12.5px] text-black/40 dark:text-white/40">
              共 {results.length} 条与「{key}」相关的记录，点击可定位
            </p>
            <div className={`${cardCls} overflow-hidden`}>
              {results.map((it, n) => (
                <button
                  key={it.id}
                  type="button"
                  data-testid={`${testPrefix}-chat-search-item-${n}`}
                  onClick={() => onJumpTo(it.id)}
                  className={`flex w-full items-start gap-2.5 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                    n > 0 ? (wx ? 'border-t border-black/5 dark:border-white/10' : 'border-t border-black/[0.04] dark:border-white/[0.06]') : ''
                  }`}
                >
                  <ChatSettingsAvatar variant={variant} src={it.role === 'me' ? myAvatar : peerAvatar} alt={it.role === 'me' ? myName : peerName} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[14.5px]">{it.role === 'me' ? myName : peerName}</span>
                      <span className="shrink-0 text-[11.5px] text-black/35 dark:text-white/35">{fmtSearchTime(it.time)}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block break-all text-[13.5px] leading-[1.45] text-black/60 dark:text-white/60">
                      {renderSnippet(it.text, key)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- 翻译设置页（三端共用二级页） ----------------

/** 翻译页主题 token（微信灰白 / QQ 冷灰白 / 信息 iOS 风） */
function translateTokens(variant: ChatSettingsVariant) {
  const wx = variant === 'wx';
  const sms = variant === 'sms';
  return {
    wx,
    sms,
    pageCls: sms
      ? 'bg-background text-foreground'
      : wx
        ? 'bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white'
        : 'bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white',
    cardCls: sms
      ? 'overflow-hidden rounded-[14px] bg-black/[0.045] dark:bg-white/[0.08]'
      : wx
        ? 'rounded-[10px] bg-white dark:bg-[#1A1A1A]'
        : 'rounded-[14px] bg-white dark:bg-[#232529]',
    dividerCls: sms
      ? 'border-border/60'
      : wx
        ? 'border-black/5 dark:border-white/10'
        : 'border-black/[0.04] dark:border-white/[0.06]',
    rowCls: sms
      ? 'flex w-full items-center justify-between px-4 py-3 text-left text-[15.5px] active:bg-black/[0.04] dark:active:bg-white/[0.06]'
      : wx
        ? 'flex w-full items-center justify-between px-4 py-3 text-left text-[16px] active:bg-black/[0.04] dark:active:bg-white/[0.06]'
        : 'flex w-full items-center justify-between px-4 min-h-[54px] text-left text-[15.5px] active:bg-black/[0.03] dark:active:bg-white/[0.05]',
    accent: sms ? '#007AFF' : wx ? '#07C160' : '#0099FF',
    titleCls: wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold',
    headerH: wx ? 'h-11' : 'h-12',
    captionCls: sms
      ? 'px-1 pt-2.5 text-[12.5px] leading-[1.6] text-muted-foreground'
      : 'px-1 pt-2.5 text-[12.5px] leading-[1.6] text-black/40 dark:text-white/40',
  };
}

/**
 * 翻译设置页（聊天设置二级页，微信 / QQ / 信息三端共用）：
 * 总开关 + 目标语言多选（每条文字消息气泡下方按顺序显示全部已选语言的译文）。
 * 开关打开且未选语言时由调用方自动补默认语言；取消最后一个语言时由调用方自动关闭开关。
 */
export function ChatTranslatePage({
  variant,
  on,
  langs,
  onBack,
  onToggle,
  onToggleLang,
}: {
  variant: ChatSettingsVariant;
  /** 翻译总开关 */
  on: boolean;
  /** 已选语言代码列表（多选） */
  langs: string[];
  onBack: () => void;
  onToggle: (v: boolean) => void;
  onToggleLang: (code: string) => void;
}) {
  const t = translateTokens(variant);
  const testPrefix = variant;

  return (
    <div className={`absolute inset-0 z-50 flex h-full w-full flex-col ${t.pageCls}`}>
      {/* 顶栏 */}
      <div className="shrink-0 pt-[54px]">
        <div className={`flex ${t.headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-translate-back`}
            onClick={onBack}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${t.wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={t.wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${t.titleCls}`}>翻译</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
        {/* 总开关 */}
        <div className={`${t.cardCls}`}>
          <div className={`flex items-center justify-between ${t.rowCls}`}>
            <span>翻译</span>
            <ChatToggle
              on={on}
              onChange={onToggle}
              accent={t.accent}
              testId={`${testPrefix}-translate-switch`}
              label="翻译"
            />
          </div>
        </div>
        <p className={t.captionCls}>开启后，聊天中的文字消息会在气泡下方显示所选语言的翻译。</p>

        {/* 目标语言多选 */}
        <p className="px-1 pb-2 pt-4 text-[13px] text-black/40 dark:text-white/40">目标语言（可多选）</p>
        <div className={`${t.cardCls}`}>
          {TRANSLATE_LANGS.map((l, i) => {
            const selected = langs.includes(l.code);
            return (
              <div key={l.code}>
                {i > 0 && <div className={`border-t ${t.dividerCls}`} />}
                <button
                  type="button"
                  data-testid={`${testPrefix}-translate-lang-${l.code}`}
                  aria-pressed={selected}
                  aria-label={`翻译成${l.label}`}
                  onClick={() => onToggleLang(l.code)}
                  className={t.rowCls}
                >
                  <span className="flex items-baseline gap-2">
                    <span>{l.label}</span>
                    <span className="text-[12.5px] text-black/35 dark:text-white/35">{l.native}</span>
                  </span>
                  {selected && (
                    <span className="grid place-items-center" style={{ color: t.accent }} aria-label="已选中">
                      <Check className="h-5 w-5" strokeWidth={2.4} />
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <p className={t.captionCls}>
          可多选：每条消息下方将按顺序显示所有已选语言的译文；换一个聊天对象需要单独设置。
        </p>
      </div>
    </div>
  );
}

// ---------------- 信息 App 聊天设置页（iOS 风格） ----------------

/**
 * 信息 App 的聊天设置页（聊天页右上角进入）：
 * 对方信息卡片 + 翻译入口（ChatTranslatePage，variant=sms）+ 分句发送开关。
 */
export function SmsChatSettingsPage({
  peerName,
  peerAvatar,
  phone,
  translateSummary,
  sentenceSend,
  onBack,
  onOpenTranslate,
  onToggleSentenceSend,
}: {
  peerName: string;
  peerAvatar: string | null;
  /** 信息卡第二行：手机号（可为空） */
  phone: string;
  translateSummary: string;
  sentenceSend: boolean;
  onBack: () => void;
  onOpenTranslate: () => void;
  onToggleSentenceSend: (v: boolean) => void;
}) {
  const t = translateTokens('sms');
  return (
    <div className={`absolute inset-0 z-50 flex h-full w-full flex-col ${t.pageCls}`}>
      {/* 顶栏 */}
      <div className="shrink-0 pt-[54px]">
        <div className="relative flex h-12 items-center px-2">
          <button
            type="button"
            aria-label="返回"
            data-testid="sms-chat-settings-back"
            onClick={onBack}
            className="flex items-center rounded-full p-1 active:opacity-50"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-semibold">
            聊天设置
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-3">
        {/* 对方信息卡片 */}
        <div className={`${t.cardCls}`}>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <ChatSettingsAvatar variant="sms" src={peerAvatar} alt={peerName} size={52} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-semibold">{peerName}</p>
              {phone && (
                <p className="mt-0.5 truncate text-[13px] tabular-nums text-muted-foreground">{phone}</p>
              )}
            </div>
          </div>
        </div>

        {/* 翻译入口 */}
        <div className={`${t.cardCls} mt-3`}>
          <button type="button" data-testid="sms-settings-translate" onClick={onOpenTranslate} className={t.rowCls}>
            <span>翻译</span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span data-testid="sms-translate-summary" className="max-w-[150px] truncate text-[14px] text-muted-foreground">
                {translateSummary}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={2} />
            </span>
          </button>
        </div>

        {/* 分句发送 */}
        <div className={`${t.cardCls} mt-3`}>
          <div className={`flex items-center justify-between ${t.rowCls}`}>
            <span>分句发送</span>
            <ChatToggle
              on={sentenceSend}
              onChange={onToggleSentenceSend}
              accent="#34C759"
              testId="sms-settings-sentence"
              label="分句发送"
            />
          </div>
        </div>
        <p className={t.captionCls}>
          开启后，你可以连续发送多条消息，对方都不会回复；输入框为空时再点一次「发送」，对方才会一并回复。
        </p>
      </div>
    </div>
  );
}
