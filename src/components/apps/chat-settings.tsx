'use client';

/**
 * 聊天设置页 + 聊天背景页 + 回复条数页 + 翻译页 + 查找聊天记录页 + 信息端聊天设置页
 * （微信 / QQ / 信息三端，variant 区分主题）：
 * - ChatSettingsPage（微信/QQ）：信息卡片（头像/名字/微信号或QQ号/地区职业）、备注、置顶聊天、消息免打扰、
 *   查找聊天记录、聊天背景（均紧跟免打扰）、回复条数入口（进入独立二级页 ChatReplyCountPage）、
 *   翻译入口（进入 ChatTranslatePage）、分句发送开关、时间感知开关（AI 感知当前时间/节日/事件时长/上次聊天间隔，按会话独立）
 * - ChatReplyCountPage：回复条数选择页 —— 1/3/5/7/15/20/25/30 条（上限，可少发），AI 像
 *   真人一样一句一句连发多条消息（一句一条，由 @/lib/reply-count 切分与节奏控制）
 * - ChatTranslatePage：翻译语言页（三端共用，参考 iOS 翻译语言页）—— 总开关 + 语言对选择：
 *   上方左右两个语言槽可点选（点一侧再在下方列表选语言），中间 ⇄ 一键互换；
 *   聊天中按消息语言双向翻译：左侧语言的消息译成右侧，右侧语言的消息译成左侧
 * - SmsChatSettingsPage：信息 App 的聊天设置页（iOS 风格：翻译入口 + 分句发送开关 + 时间感知开关）
 * - ChatBgPage：聊天背景独立页 —— 顶部预览卡片、从手机相册上传、内置纯色壁纸
 * - ChatSearchPage：关键词查找当前聊天记录，点击结果定位回聊天页并高亮
 * - ChatVoicePage：「他的声音」页（三端共用二级页）——选角色说话音色（默认/内置音色/
 *   我的音色/API 音色，宿主持久化到联系人 voiceId）+「AI 语音频率」入口行
 * - ChatVoiceFreqPage：AI 语音发送频率选择页（三端共用）—— 关闭/每条都发语音/经常(1/3)/
 *   偶尔(1/7)/不经常(1/12)，按会话独立（群聊按群），发送时现场读取
 * - 置顶/免打扰/背景持久化在 @/lib/chat-flags（localStorage），回复条数/翻译/分句发送持久化在
 *   @/lib/reply-count / @/lib/chat-translate / @/lib/sentence-send（localStorage，按会话键隔离），
 *   背景图片本体在 IndexedDB（@/lib/ios/contacts-store 的 getChatBgImage/setChatBgImage）
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeftRight, AudioLines, BookMarked, Check, ChevronLeft, ChevronRight, Image as ImageIcon, Loader2, Search } from 'lucide-react';
import type { ChatBgMode } from '@/lib/chat-flags';
import { REPLY_COUNT_OPTIONS } from '@/lib/reply-count';
import { stickerToggleCaption } from '@/lib/sticker-toggle';
import { COMMON_TRANSLATE_LANGS, MORE_TRANSLATE_LANGS, translateLangLabel, type ChatTranslateCfg, type TranslateLang } from '@/lib/chat-translate';
import { AI_VOICE_FREQ_OPTIONS, aiVoiceFreqLabel, type AiVoiceFreq } from '@/lib/ios/ai-voice';
import { BUILTIN_TTS_VOICES, isBuiltinVoiceSupported, speakBuiltin, stopBuiltinSpeech } from '@/lib/ios/builtin-voices';
import { useMyVoices } from '@/lib/ios/my-voices';
import { useSettings } from '@/lib/ios/store';

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
  remark,
  pinned,
  muted,
  bg,
  bgImageUrl,
  replyCount,
  translateSummary,
  sentenceSend,
  timeAware,
  stickersOn,
  worldBooksSummary,
  onBack,
  onSaveRemark,
  onTogglePinned,
  onToggleMuted,
  onOpenReplyCount,
  onOpenTranslate,
  onToggleSentenceSend,
  onToggleTimeAware,
  onToggleStickers,
  onOpenWorldBooks,
  onOpenSearch,
  onOpenBg,
  onOpenPeerProfile,
  blockedByUser,
  onToggleBlock,
  /** 他的声音摘要（角色音色展示名；空 = 默认） */
  voiceSummary,
  /** 打开「他的声音」页；不传 = 隐藏该入口行 */
  onOpenVoice,
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
  /** 备注名（仅机主自己可见；空 = 未设置） */
  remark: string;
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
  /** 时间感知开关状态（开启后 AI 感知当前时间/节日/事件时长/上次聊天间隔） */
  timeAware: boolean;
  /** 表情包开关状态（关闭后 AI 不发表情包也不发 emoji，见 @/lib/sticker-toggle） */
  stickersOn: boolean;
  /** 挂载的世界书摘要（未挂载时「未选择」） */
  worldBooksSummary: string;
  onBack: () => void;
  /** 保存备注（空串 = 清除备注；宿主负责持久化并刷新展示名） */
  onSaveRemark: (v: string) => void;
  onTogglePinned: (v: boolean) => void;
  onToggleMuted: (v: boolean) => void;
  onOpenReplyCount: () => void;
  onOpenTranslate: () => void;
  onToggleSentenceSend: (v: boolean) => void;
  onToggleTimeAware: (v: boolean) => void;
  onToggleStickers: (v: boolean) => void;
  onOpenWorldBooks: () => void;
  onOpenSearch: () => void;
  onOpenBg: () => void;
  /** 点击信息卡片 → 进入联系人详细界面（QQ 好友资料页 / 微信好友详情页）；不传则卡片不可点 */
  onOpenPeerProfile?: () => void;
  /** 双向拉黑：当前是否已拉黑对方（不传 = 该会话不支持拉黑，隐藏开关） */
  blockedByUser?: boolean;
  /** 拉黑开关切换（宿主负责持久化 + 生成系统消息） */
  onToggleBlock?: (v: boolean) => void;
  /** 他的声音摘要（角色音色展示名；空 = 默认） */
  voiceSummary?: string;
  /** 打开「他的声音」页；不传 = 隐藏该入口行 */
  onOpenVoice?: () => void;
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
  /** 备注编辑弹窗（本地草稿，保存时交回宿主持久化） */
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [remarkDraft, setRemarkDraft] = useState('');

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
        {/* 信息卡片（点击进入联系人详细界面：QQ 好友资料页 / 微信好友详情页） */}
        <div className={`${cardCls} overflow-hidden`}>
          {(() => {
            const inner = (
              <>
                <ChatSettingsAvatar variant={variant} src={peerAvatar} alt={peerName} size={56} />
                <div className="min-w-0 flex-1">
                  <p className={`truncate ${wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold'}`}>{peerName}</p>
                  <p className="mt-1 truncate text-[13px] text-black/45 dark:text-white/45">
                    {idLabel}：{idValue}
                  </p>
                  {metaLine && <p className="mt-0.5 truncate text-[13px] text-black/45 dark:text-white/45">{metaLine}</p>}
                </div>
              </>
            );
            if (!onOpenPeerProfile) {
              return <div className={`flex items-center gap-3 px-4 ${wx ? 'py-4' : 'py-3.5'}`}>{inner}</div>;
            }
            return (
              <button
                type="button"
                data-testid={`${testPrefix}-chat-settings-card`}
                onClick={onOpenPeerProfile}
                aria-label={`查看${peerName}的资料`}
                className={`flex w-full items-center gap-3 px-4 text-left transition-colors active:bg-black/[0.04] dark:active:bg-white/[0.06] ${wx ? 'py-4' : 'py-3.5'}`}
              >
                {inner}
                <ChevronRight className="h-5 w-5 shrink-0 text-black/20 dark:text-white/25" aria-hidden="true" />
              </button>
            );
          })()}
        </div>

        {/* 备注：仅机主自己可见的显示名（保存后聊天界面/消息列表优先显示备注） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <button
            type="button"
            data-testid={`${testPrefix}-settings-remark`}
            onClick={() => {
              setRemarkDraft(remark);
              setRemarkOpen(true);
            }}
            className={rowCls}
          >
            <span>备注</span>
            <span className="flex shrink-0 items-center gap-2">
              <span data-testid={`${testPrefix}-remark-value`} className="max-w-[150px] truncate text-[14px] text-black/40 dark:text-white/40">
                {remark || '未设置'}
              </span>
              <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
            </span>
          </button>
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

        {/* 查找聊天记录（消息免打扰下方） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <button type="button" data-testid={`${testPrefix}-settings-search`} onClick={onOpenSearch} className={rowCls}>
            <span className="flex items-center gap-2.5">
              <Search className="h-[18px] w-[18px] text-black/60 dark:text-white/60" strokeWidth={1.9} aria-hidden="true" />
              查找聊天记录
            </span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>

        {/* 聊天背景：二级页入口行（右侧当前背景迷你预览；消息免打扰下方） */}
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

        {/* 时间感知：AI 感知当前时间/季节/节日、事件耗时与上次聊天间隔（按会话独立开关，发送时现场读取） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span>时间感知</span>
            <ChatToggle
              on={timeAware}
              onChange={onToggleTimeAware}
              accent={accent}
              testId={`${testPrefix}-settings-time`}
              label="时间感知"
            />
          </div>
        </div>
        <p className="px-1 pt-2 text-[12.5px] leading-[1.6] text-black/40 dark:text-white/40">
          开启后，对方能感知当前的北京时间、季节与节日，并结合事件耗时和上次聊天的间隔更自然地回应；关闭后恢复普通聊天。
        </p>

        {/* 表情包：AI 发表情包与 emoji 的总开关（关闭后不发表情包也不发 emoji，按会话独立，发送时现场读取） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span>表情包</span>
            <ChatToggle
              on={stickersOn}
              onChange={onToggleStickers}
              accent={accent}
              testId={`${testPrefix}-settings-stickers`}
              label="表情包"
            />
          </div>
        </div>
        <p className="px-1 pt-2 text-[12.5px] leading-[1.6] text-black/40 dark:text-white/40">{stickerToggleCaption(stickersOn)}</p>

        {/* 世界书：为联系人挂载设定库（命中触发词的条目注入提示词，独立二级页选择） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <button type="button" data-testid={`${testPrefix}-settings-worldbooks`} onClick={onOpenWorldBooks} className={rowCls}>
            <span className="flex items-center gap-2.5">
              <BookMarked className="h-[18px] w-[18px] text-black/60 dark:text-white/60" strokeWidth={1.9} aria-hidden="true" />
              世界书
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span data-testid={`${testPrefix}-worldbooks-summary`} className="max-w-[150px] truncate text-[14px] text-black/40 dark:text-white/40">
                {worldBooksSummary}
              </span>
              <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
            </span>
          </button>
        </div>
        <p className="px-1 pt-2 text-[12.5px] leading-[1.6] text-black/40 dark:text-white/40">
          挂载「局部」世界书后，命中触发词才注入设定（未命中不发送）；全局书无需挂载，专属书在「世界书」App 里绑定角色。
        </p>

        {/* 他的声音：角色说话音色（内置音色/我的音色/API 音色）+ AI 语音发送频率（独立二级页） */}
        {onOpenVoice && (
          <>
            <div className={`${cardCls} mt-3 overflow-hidden`}>
              <button type="button" data-testid={`${testPrefix}-settings-voice`} onClick={onOpenVoice} className={rowCls}>
                <span>他的声音</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span data-testid={`${testPrefix}-voice-summary`} className="max-w-[150px] truncate text-[14px] text-black/40 dark:text-white/40">
                    {voiceSummary || '默认'}
                  </span>
                  <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
                </span>
              </button>
            </div>
            <p className="px-1 pt-2 text-[12.5px] leading-[1.6] text-black/40 dark:text-white/40">
              选择 TA 说话用的音色，并可设置 AI 发语音的频率（按本会话独立保存）。
            </p>
          </>
        )}

        {/* 拉黑：双向拉黑开关（拉黑不拦截消息，只是关系状态；对方会知道被拉黑，AI 可申请解除） */}
        {onToggleBlock && (
          <>
            <div className={`${cardCls} mt-3 overflow-hidden`}>
              <div className={`flex items-center justify-between ${rowCls}`}>
                <span>拉黑</span>
                <ChatToggle
                  on={blockedByUser === true}
                  onChange={onToggleBlock}
                  accent={accent}
                  testId={`${testPrefix}-settings-block`}
                  label="拉黑"
                />
              </div>
            </div>
            <p className="px-1 pt-2 text-[12.5px] leading-[1.6] text-black/40 dark:text-white/40">
              开启后你将拉黑「{peerName}」：你们仍可以互相发消息，但对方会知道已被你拉黑，气泡后会出现拉黑图标；随时可关闭解除。
            </p>
          </>
        )}

        {/* 备注编辑弹窗 */}
        {remarkOpen && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-8" onClick={() => setRemarkOpen(false)}>
            <div className={`w-full max-w-[300px] ${cardCls} p-5`} onClick={(e) => e.stopPropagation()}>
              <p className="text-[16px] font-medium">备注</p>
              <input
                value={remarkDraft}
                onChange={(e) => setRemarkDraft(e.target.value)}
                placeholder={`给${peerName}添加备注`}
                maxLength={30}
                data-testid={`${testPrefix}-remark-input`}
                className="mt-3 h-10 w-full rounded-[8px] bg-black/[0.05] px-3 text-[14px] outline-none placeholder:text-black/30 focus:ring-1 focus:ring-black/10 dark:bg-white/10 dark:placeholder:text-white/30 dark:focus:ring-white/15"
              />
              <p className="mt-2 text-[12px] leading-relaxed text-black/40 dark:text-white/40">备注仅自己可见，保存后聊天界面和消息列表优先显示备注名；清空并保存即可恢复原名。</p>
              <div className="mt-4 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setRemarkOpen(false)}
                  className="h-10 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-80 dark:bg-white/10"
                >
                  取消
                </button>
                <button
                  type="button"
                  data-testid={`${testPrefix}-remark-save`}
                  onClick={() => {
                    onSaveRemark(remarkDraft.trim());
                    setRemarkOpen(false);
                  }}
                  className="h-10 flex-1 rounded-[8px] text-[14px] font-medium text-white active:opacity-80"
                  style={{ backgroundColor: accent }}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
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

// ---------------- 翻译语言页（三端共用二级页） ----------------

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
 * 翻译语言页（聊天设置二级页，微信 / QQ / 信息三端共用，参考 iOS 翻译语言页）：
 * 总开关 + 语言对选择 —— 上方左右两个语言槽都可点选（点一侧设为待选侧，再在下方列表中
 * 选择该侧语言），中间 ⇄ 一键互换两侧语言；下方「常用语言 / 更多语言」分组列表，
 * 两侧已占用的语言灰显。聊天中按消息语言双向翻译：左侧语言的消息译成右侧，反之亦然
 * （如「中文简体 ⇄ 英语」：中文消息显示英文译文，英文消息显示中文译文）。
 */
export function ChatTranslatePage({
  variant,
  cfg,
  onBack,
  onChange,
}: {
  variant: ChatSettingsVariant;
  /** 当前会话的翻译配置（on + 语言对） */
  cfg: ChatTranslateCfg;
  onBack: () => void;
  /** 开关 / 选语言 / 互换 都统一回传新配置，由调用方持久化（按会话隔离） */
  onChange: (next: ChatTranslateCfg) => void;
}) {
  const t = translateTokens(variant);
  const testPrefix = variant;
  // 当前待设置的一侧（点上方一侧切换；默认左侧）
  const [side, setSide] = useState<'left' | 'right'>('left');

  /** 列表点选：把语言设到待选侧；选到另一侧正在用的语言时直接互换两侧（不会出现两侧同语言） */
  const pick = (code: string) => {
    const other = side === 'left' ? cfg.right : cfg.left;
    if (code === other) {
      onChange({ ...cfg, left: cfg.right, right: cfg.left });
      return;
    }
    onChange(side === 'left' ? { ...cfg, left: code } : { ...cfg, right: code });
  };

  /** 语言槽（左右各一）：待选侧加浅色胶囊底，点击切换待选侧 */
  const renderSlot = (sideKey: 'left' | 'right', code: string) => {
    const active = side === sideKey;
    return (
      <button
        type="button"
        data-testid={`${testPrefix}-translate-side-${sideKey}`}
        aria-label={`选择${sideKey === 'left' ? '左' : '右'}侧语言，当前 ${translateLangLabel(code)}`}
        onClick={() => setSide(sideKey)}
        className={`max-w-[38%] truncate rounded-[12px] px-3.5 py-1.5 text-[20px] font-semibold transition-colors ${
          active ? 'bg-black/[0.06] dark:bg-white/[0.12]' : 'active:bg-black/[0.04] dark:active:bg-white/[0.06]'
        }`}
      >
        {translateLangLabel(code)}
      </button>
    );
  };

  /** 分组语言列表：两侧已占用的语言灰显；✓ 标记待选侧当前语言 */
  const renderGroup = (langs: readonly TranslateLang[], groupLabel: string) => (
    <>
      <p className="px-1 pb-2 pt-4 text-[13px] text-black/40 dark:text-white/40">{groupLabel}</p>
      <div className={`${t.cardCls} overflow-hidden`}>
        {langs.map((l, i) => {
          const activeLang = (side === 'left' ? cfg.left : cfg.right) === l.code;
          const used = cfg.left === l.code || cfg.right === l.code;
          return (
            <div key={l.code}>
              {i > 0 && <div className={`border-t ${t.dividerCls}`} />}
              <button
                type="button"
                data-testid={`${testPrefix}-translate-lang-${l.code}`}
                aria-label={`把${side === 'left' ? '左' : '右'}侧语言设为${l.label}`}
                onClick={() => pick(l.code)}
                className={t.rowCls}
              >
                <span className={used ? 'text-black/35 dark:text-white/35' : ''}>{l.label}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {activeLang && (
                    <span className="grid place-items-center" style={{ color: t.accent }} aria-label="当前语言">
                      <Check className="h-5 w-5" strokeWidth={2.4} />
                    </span>
                  )}
                  <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </>
  );

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
          <div className={`flex-1 pr-8 text-center ${t.titleCls}`}>翻译语言</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
        {/* 总开关 */}
        <div className={`${t.cardCls}`}>
          <div className={`flex items-center justify-between ${t.rowCls}`}>
            <span>翻译</span>
            <ChatToggle
              on={cfg.on}
              onChange={(v) => onChange({ ...cfg, on: v })}
              accent={t.accent}
              testId={`${testPrefix}-translate-switch`}
              label="翻译"
            />
          </div>
        </div>
        <p className={t.captionCls}>开启后，消息会按语言双向翻译：左侧语言的消息译成右侧，右侧语言的消息译成左侧，译文显示在气泡下方。</p>

        {/* 语言对选择器：左右两个语言槽 + 中间互换按钮 */}
        <div className="flex items-center justify-center gap-2 pb-1 pt-4">
          {renderSlot('left', cfg.left)}
          <button
            type="button"
            data-testid={`${testPrefix}-translate-swap`}
            aria-label="互换两侧语言"
            onClick={() => onChange({ ...cfg, left: cfg.right, right: cfg.left })}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-black/55 active:bg-black/[0.05] dark:text-white/55 dark:active:bg-white/[0.08]"
          >
            <ArrowLeftRight className="h-[19px] w-[19px]" strokeWidth={2} aria-hidden="true" />
          </button>
          {renderSlot('right', cfg.right)}
        </div>
        <p className="px-1 pb-1 pt-1 text-center text-[13.5px] text-black/40 dark:text-white/40">
          点击上方一侧，再在下方列表中选择该侧语言
        </p>

        {/* 语言列表：常用语言 / 更多语言 */}
        {renderGroup(COMMON_TRANSLATE_LANGS, '常用语言')}
        {renderGroup(MORE_TRANSLATE_LANGS, '更多语言')}

        <p className={t.captionCls}>换一个聊天对象需要单独设置。</p>
      </div>
    </div>
  );
}

// ---------------- 信息 App 聊天设置页（iOS 风格） ----------------

/**
 * 信息 App 的聊天设置页（聊天页顶栏摄像机图标进入）：
 * 对方信息卡片 + 翻译入口（ChatTranslatePage，variant=sms）+ 分句发送开关。
 */
export function SmsChatSettingsPage({
  peerName,
  peerAvatar,
  phone,
  remark,
  translateSummary,
  sentenceSend,
  timeAware,
  stickersOn,
  worldBooksSummary,
  onBack,
  onSaveRemark,
  onOpenTranslate,
  onToggleSentenceSend,
  onToggleTimeAware,
  onToggleStickers,
  onOpenWorldBooks,
  blockedByUser,
  onToggleBlock,
  /** 他的声音摘要（角色音色展示名；空 = 默认）；不传 onOpenVoice = 隐藏该入口 */
  voiceSummary,
  onOpenVoice,
}: {
  peerName: string;
  peerAvatar: string | null;
  /** 信息卡第二行：手机号（可为空） */
  phone: string;
  /** 备注名（仅机主自己可见；空 = 未设置） */
  remark: string;
  translateSummary: string;
  sentenceSend: boolean;
  /** 时间感知开关状态（开启后 AI 感知当前时间/节日/事件时长/上次聊天间隔） */
  timeAware: boolean;
  /** 表情包开关状态（关闭后 AI 不发表情包也不发 emoji，见 @/lib/sticker-toggle） */
  stickersOn: boolean;
  /** 挂载的世界书摘要（未挂载时「未选择」） */
  worldBooksSummary: string;
  onBack: () => void;
  /** 保存备注（空串 = 清除备注；宿主负责持久化并刷新展示名） */
  onSaveRemark: (v: string) => void;
  onOpenTranslate: () => void;
  onToggleSentenceSend: (v: boolean) => void;
  onToggleTimeAware: (v: boolean) => void;
  onToggleStickers: (v: boolean) => void;
  /** 打开世界书挂载页；AI 助手会话（无联系人角色）不传 → 隐藏该入口行 */
  onOpenWorldBooks?: () => void;
  /** 双向拉黑：当前是否已拉黑对方（不传 = 该会话不支持拉黑，隐藏开关） */
  blockedByUser?: boolean;
  /** 拉黑开关切换（宿主负责持久化 + 生成系统消息） */
  onToggleBlock?: (v: boolean) => void;
  /** 他的声音摘要（角色音色展示名；空 = 默认） */
  voiceSummary?: string;
  /** 打开「他的声音」页；不传 = 隐藏该入口行（AI 助手会话无角色音色） */
  onOpenVoice?: () => void;
}) {
  const t = translateTokens('sms');
  /** 备注编辑弹窗（本地草稿，保存时交回宿主持久化） */
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [remarkDraft, setRemarkDraft] = useState('');
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

        {/* 备注行：仅机主自己可见的显示名 */}
        <div className={`${t.cardCls} mt-3`}>
          <button
            type="button"
            data-testid="sms-settings-remark"
            onClick={() => {
              setRemarkDraft(remark);
              setRemarkOpen(true);
            }}
            className={t.rowCls}
          >
            <span>备注</span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span data-testid="sms-remark-value" className="max-w-[150px] truncate text-[14px] text-muted-foreground">
                {remark || '未设置'}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={2} />
            </span>
          </button>
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

        {/* 时间感知 */}
        <div className={`${t.cardCls} mt-3`}>
          <div className={`flex items-center justify-between ${t.rowCls}`}>
            <span>时间感知</span>
            <ChatToggle
              on={timeAware}
              onChange={onToggleTimeAware}
              accent="#34C759"
              testId="sms-settings-time"
              label="时间感知"
            />
          </div>
        </div>
        <p className={t.captionCls}>
          开启后，对方能感知当前的北京时间、季节与节日，并结合事件耗时和上次聊天的间隔更自然地回应；关闭后恢复普通聊天。
        </p>

        {/* 表情包：AI 发表情包与 emoji 的总开关（关闭后不发表情包也不发 emoji，按会话独立，发送时现场读取） */}
        <div className={`${t.cardCls} mt-3`}>
          <div className={`flex items-center justify-between ${t.rowCls}`}>
            <span>表情包</span>
            <ChatToggle
              on={stickersOn}
              onChange={onToggleStickers}
              accent="#34C759"
              testId="sms-settings-stickers"
              label="表情包"
            />
          </div>
        </div>
        <p className={t.captionCls}>{stickerToggleCaption(stickersOn)}</p>

        {/* 世界书：为联系人挂载设定库（命中触发词的条目注入提示词，独立二级页选择）；AI 助手会话无此入口 */}
        {onOpenWorldBooks && (
          <>
            <div className={`${t.cardCls} mt-3`}>
              <button type="button" data-testid="sms-settings-worldbooks" onClick={onOpenWorldBooks} className={t.rowCls}>
                <span className="flex items-center gap-2.5">
                  <BookMarked className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={1.9} aria-hidden="true" />
                  世界书
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span data-testid="sms-worldbooks-summary" className="max-w-[150px] truncate text-[14px] text-muted-foreground">
                    {worldBooksSummary}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={2} />
                </span>
              </button>
            </div>
            <p className={t.captionCls}>
              挂载「局部」世界书后，命中触发词才注入设定（未命中不发送）；全局书无需挂载，专属书在「世界书」App 里绑定角色。
            </p>
          </>
        )}

        {/* 他的声音：角色说话音色（内置音色/我的音色/API 音色）+ AI 语音发送频率（独立二级页） */}
        {onOpenVoice && (
          <>
            <div className={`${t.cardCls} mt-3`}>
              <button type="button" data-testid="sms-settings-voice" onClick={onOpenVoice} className={t.rowCls}>
                <span>他的声音</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span data-testid="sms-voice-summary" className="max-w-[150px] truncate text-[14px] text-muted-foreground">
                    {voiceSummary || '默认'}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={2} />
                </span>
              </button>
            </div>
            <p className={t.captionCls}>选择 TA 说话用的音色，并可设置 AI 发语音的频率（按本会话独立保存）。</p>
          </>
        )}

        {/* 拉黑：双向拉黑开关（拉黑不拦截消息，只是关系状态；对方会知道被拉黑，AI 可申请解除） */}
        {onToggleBlock && (
          <>
            <div className={`${t.cardCls} mt-3`}>
              <div className={`flex items-center justify-between ${t.rowCls}`}>
                <span>拉黑</span>
                <ChatToggle
                  on={blockedByUser === true}
                  onChange={onToggleBlock}
                  accent="#34C759"
                  testId="sms-settings-block"
                  label="拉黑"
                />
              </div>
            </div>
            <p className={t.captionCls}>
              开启后你将拉黑「{peerName}」：你们仍可以互相发消息，但对方会知道已被你拉黑，气泡后会出现拉黑图标；随时可关闭解除。
            </p>
          </>
        )}

        {/* 备注编辑弹窗 */}
        {remarkOpen && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-8" onClick={() => setRemarkOpen(false)}>
            <div className={`w-full max-w-[300px] ${t.cardCls} p-5`} onClick={(e) => e.stopPropagation()}>
              <p className="text-[16px] font-semibold">备注</p>
              <input
                value={remarkDraft}
                onChange={(e) => setRemarkDraft(e.target.value)}
                placeholder={`给${peerName}添加备注`}
                maxLength={30}
                data-testid="sms-remark-input"
                className="mt-3 h-10 w-full rounded-[8px] bg-black/[0.05] px-3 text-[14px] outline-none placeholder:text-black/30 focus:ring-1 focus:ring-black/10 dark:bg-white/10 dark:placeholder:text-white/30"
              />
              <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">备注仅自己可见，保存后聊天界面和消息列表优先显示备注名；清空并保存即可恢复原名。</p>
              <div className="mt-4 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setRemarkOpen(false)}
                  className="h-10 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-80 dark:bg-white/10"
                >
                  取消
                </button>
                <button
                  type="button"
                  data-testid="sms-remark-save"
                  onClick={() => {
                    onSaveRemark(remarkDraft.trim());
                    setRemarkOpen(false);
                  }}
                  className="h-10 flex-1 rounded-[8px] bg-[#007AFF] text-[14px] font-medium text-white active:opacity-80"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- 世界书挂载页（三端共用二级页） ----------------

/**
 * 世界书挂载页（微信/QQ/信息聊天设置二级页）：为当前联系人勾选要挂载的世界书（可多选）。
 * 范围在书级：只有「局部」范围的书需要挂载（挂载后命中关键词才注入）；
 * 「全局」书无需挂载对所有对话常驻生效；「专属」书仅对绑定的角色生效。书籍本体在「世界书」App 里维护。
 */
export function WorldBookPickerPage({
  variant,
  books,
  boundIds,
  onBack,
  onChange,
}: {
  variant: ChatSettingsVariant;
  /** 可挂载的世界书（局部范围；id/名字/条目数） */
  books: Array<{ id: string; name: string; entryCount: number; enabledCount: number }>;
  /** 当前联系人已挂载的书 id */
  boundIds: string[];
  onBack: () => void;
  /** 勾选变化（每次点选回传完整 id 列表，由调用方持久化） */
  onChange: (ids: string[]) => void;
}) {
  const t = translateTokens(variant);
  const testPrefix = variant;
  const bound = useMemo(() => new Set(boundIds), [boundIds]);

  return (
    <div className={`absolute inset-0 z-50 flex h-full w-full flex-col ${t.pageCls}`}>
      {/* 顶栏 */}
      <div className="shrink-0 pt-[54px]">
        <div className={`flex ${t.headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-worldbooks-back`}
            onClick={onBack}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${t.wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={t.wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${t.titleCls}`}>世界书</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
        {books.length === 0 ? (
          <div className="mt-16 text-center">
            <BookMarked className="mx-auto h-10 w-10 text-black/15 dark:text-white/15" strokeWidth={1.5} aria-hidden="true" />
            <p className={`mt-3 text-[14px] ${t.sms ? 'text-muted-foreground' : 'text-black/35 dark:text-white/35'}`}>
              没有可挂载的「局部」世界书；到「世界书」App 创建（范围选局部）后再来挂载
            </p>
          </div>
        ) : (
          <div className={`${t.cardCls} overflow-hidden`}>
            {books.map((book, i) => {
              const selected = bound.has(book.id);
              return (
                <div key={book.id}>
                  {i > 0 && <div className={`border-t ${t.dividerCls}`} />}
                  <button
                    type="button"
                    data-testid={`${testPrefix}-worldbook-option-${i}`}
                    aria-label={`${selected ? '取消挂载' : '挂载'}${book.name}`}
                    onClick={() => {
                      const next = new Set(bound);
                      if (selected) next.delete(book.id);
                      else next.add(book.id);
                      onChange(books.filter((b) => next.has(b.id)).map((b) => b.id));
                    }}
                    className={t.rowCls}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{book.name}</span>
                      <span
                        className={`mt-0.5 block truncate text-[12.5px] ${
                          t.sms ? 'text-muted-foreground' : 'text-black/40 dark:text-white/40'
                        }`}
                      >
                        {book.entryCount} 条目 · {book.enabledCount} 启用
                      </span>
                    </span>
                    {selected && (
                      <span className="grid shrink-0 place-items-center pl-2" style={{ color: t.accent }} aria-label="已挂载">
                        <Check className="h-5 w-5" strokeWidth={2.4} />
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <p className={t.captionCls}>
          只有「局部」范围的世界书需要挂载：挂载后，聊天内容命中条目触发词时才注入对应设定（未命中不发送）。「全局」书无需挂载、对所有对话常驻生效；「专属」书仅对绑定的角色生效——都在「世界书」App 里设置。
        </p>
      </div>
    </div>
  );
}

// ---------------- AI 语音发送频率选择页（三端共用二级页） ----------------

/**
 * AI 语音发送频率选择页（他的声音二级页 / 群聊信息页进入）：
 * 关闭 / 每条都发语音 / 经常（每 3 条 1 条语音）/ 偶尔（每 7 条 1 条语音）/ 不经常（每 12 条 1 条语音）。
 * 按会话独立保存（群聊按群）；计数器按「会话×角色」隔离，语音发出后重新计数。
 */
export function ChatVoiceFreqPage({
  variant,
  value,
  onBack,
  onSelect,
}: {
  variant: ChatSettingsVariant;
  /** 当前会话的 AI 语音频率 */
  value: AiVoiceFreq;
  onBack: () => void;
  onSelect: (freq: AiVoiceFreq) => void;
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
            data-testid={`${testPrefix}-voice-freq-back`}
            onClick={onBack}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${t.wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={t.wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${t.titleCls}`}>AI 语音频率</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
        <div className={`${t.cardCls} overflow-hidden`}>
          {AI_VOICE_FREQ_OPTIONS.map((opt, i) => (
            <div key={opt.value}>
              {i > 0 && <div className={`border-t ${t.dividerCls}`} />}
              <button
                type="button"
                data-testid={`${testPrefix}-voice-freq-option-${opt.value}`}
                aria-label={`AI 语音频率 ${opt.label}`}
                onClick={() => onSelect(opt.value)}
                className={t.rowCls}
              >
                <span className="min-w-0">
                  <span className="block truncate">{opt.label}</span>
                  <span
                    className={`mt-0.5 block truncate text-[12.5px] ${t.sms ? 'text-muted-foreground' : 'text-black/40 dark:text-white/40'}`}
                  >
                    {opt.desc}
                  </span>
                </span>
                {value === opt.value && (
                  <span className="grid shrink-0 place-items-center pl-2" style={{ color: t.accent }} aria-label="已选中">
                    <Check className="h-5 w-5" strokeWidth={2.4} />
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
        <p className={t.captionCls}>
          开启后，AI 生成回复时按该频率决定这条用语音还是文字发送：语音用 TA 的音色合成，显示为语音气泡，可点击播放、
          长按转文字；合成失败会自动降级为文字。每个角色、每个会话独立计数，发出一条语音后重新计数；群聊里各成员互不影响。
        </p>
      </div>
    </div>
  );
}

// ---------------- 他的声音页（三端共用二级页） ----------------

/**
 * 他的声音页（聊天设置二级页，微信 / QQ / 信息三端共用）：
 * 选择该角色说话用的音色 —— 默认（跟随全局）/ 内置音色（6 个免费声线，可试听）/
 * 我的音色（设置 › 语音 API 里保存的音色）/ API 音色（服务商拉取的列表）；
 * 选择结果由宿主持久化到联系人 voiceId（点已选中的=取消，恢复「默认」）。
 * 页内还有「AI 语音频率」入口行 → ChatVoiceFreqPage（按会话独立）。
 */
export function ChatVoicePage({
  variant,
  peerName,
  voiceId,
  voiceFreq,
  onBack,
  onSelect,
  onOpenFreq,
}: {
  variant: ChatSettingsVariant;
  /** 角色名（标题/说明用） */
  peerName: string;
  /** 当前角色的音色（contact.voiceId；空 = 跟随全局默认） */
  voiceId: string;
  /** 当前会话的 AI 语音频率（入口行摘要） */
  voiceFreq: AiVoiceFreq;
  onBack: () => void;
  /** 选择音色（传空串 = 恢复「默认」；宿主负责持久化） */
  onSelect: (voiceId: string) => void;
  /** 打开 AI 语音频率选择页 */
  onOpenFreq: () => void;
}) {
  const t = translateTokens(variant);
  const testPrefix = variant;
  const myVoices = useMyVoices((s) => s.voices);
  const ttsProvider = useSettings((s) => s.ttsConfig.provider);
  const apiVoices = useSettings((s) => s.ttsVoices);
  /** 内置声线试听状态（播放中的声线 id） */
  const [previewId, setPreviewId] = useState<string | null>(null);
  // 本页只在客户端渲染：直接惰性初始化（避免 effect 内 setState 的水合/告警问题）
  const [builtinSupport] = useState<boolean | null>(() => (typeof window === 'undefined' ? null : isBuiltinVoiceSupported()));

  useEffect(() => {
    return () => stopBuiltinSpeech();
  }, []);

  const previewBuiltin = (id: string) => {
    if (previewId) {
      stopBuiltinSpeech();
      setPreviewId(null);
      if (previewId === id) return;
    }
    stopBuiltinSpeech();
    setPreviewId(id);
    void speakBuiltin({
      text: '你好，用这个声音和你聊天，很高兴认识你。',
      voiceId: id,
      onEnd: () => setPreviewId(null),
      onError: () => setPreviewId(null),
    }).catch(() => setPreviewId(null));
  };

  const mutedText = t.sms ? 'text-muted-foreground' : 'text-black/40 dark:text-white/40';
  const current = voiceId.trim();

  /** 音色 chip（我的音色 / API 音色共用）：点选即用，再点取消回「默认」 */
  const voiceChip = (id: string, name: string, testId: string, key: string) => {
    const active = current === id;
    return (
      <button
        key={key}
        type="button"
        data-testid={testId}
        aria-pressed={active}
        title={name === id ? id : `${name}（${id}）`}
        onClick={() => onSelect(active ? '' : id)}
        className={`max-w-full truncate rounded-full border px-2.5 py-1.5 text-[13px] transition-colors ${
          active ? 'border-transparent text-white' : 'border-black/10 bg-white/60 text-black/75 active:bg-black/[0.04] dark:border-white/15 dark:bg-white/10 dark:text-white/80 dark:active:bg-white/[0.06]'
        }`}
        style={active ? { backgroundColor: t.accent } : undefined}
      >
        {name}
      </button>
    );
  };

  return (
    <div className={`absolute inset-0 z-50 flex h-full w-full flex-col ${t.pageCls}`}>
      {/* 顶栏 */}
      <div className="shrink-0 pt-[54px]">
        <div className={`flex ${t.headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-voice-back`}
            onClick={onBack}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${t.wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={t.wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${t.titleCls}`}>他的声音</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
        {/* AI 语音频率入口（按会话独立；关闭时 AI 只发文字） */}
        <div className={`${t.cardCls} overflow-hidden`}>
          <button type="button" data-testid={`${testPrefix}-voice-freq-row`} onClick={onOpenFreq} className={t.rowCls}>
            <span>AI 语音频率</span>
            <span className="flex shrink-0 items-center gap-2">
              <span data-testid={`${testPrefix}-voice-freq-value`} className={`max-w-[150px] truncate text-[14px] ${mutedText}`}>
                {aiVoiceFreqLabel(voiceFreq)}
              </span>
              <ChevronRight className={`h-[18px] w-[18px] ${t.sms ? 'text-muted-foreground/50' : 'text-black/25 dark:text-white/25'}`} strokeWidth={2} />
            </span>
          </button>
        </div>
        <p className={t.captionCls}>设置 TA 回复时用语音还是文字（关闭 = 只发文字）。</p>

        {/* 默认 / 音色选择状态 */}
        <p className={`px-1 pb-1.5 pt-4 text-[12.5px] ${mutedText}`}>
          {current ? `当前音色已为 ${peerName} 单独设置` : '当前为「默认」：跟随全局默认音色（全局也没设时按 TA 的性别自动选内置男女声）'}
        </p>

        {/* 内置音色（免费 · 可试听） */}
        <p className={`px-1 pb-1.5 text-[12.5px] font-medium ${t.sms ? 'text-foreground/80' : 'text-black/55 dark:text-white/55'}`}>
          内置音色（免费）
        </p>
        <div className="grid grid-cols-2 gap-2">
          {BUILTIN_TTS_VOICES.map((v) => {
            const active = current === v.id;
            const playing = previewId === v.id;
            return (
              <div
                key={v.id}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                aria-label={`选择音色${v.name}`}
                data-testid={`${testPrefix}-voice-builtin-${v.id.replace('builtin:', '')}`}
                onClick={() => onSelect(active ? '' : v.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(active ? '' : v.id);
                  }
                }}
                className={`flex flex-col gap-1 rounded-[12px] border p-2.5 transition-colors ${
                  active
                    ? 'border-transparent text-white'
                    : 'border-black/10 bg-white/70 text-black/80 active:bg-black/[0.04] dark:border-white/15 dark:bg-white/10 dark:text-white/85 dark:active:bg-white/[0.06]'
                }`}
                style={active ? { backgroundColor: t.accent } : undefined}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[14px] font-medium">{v.name}</span>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        active
                          ? 'bg-white/25 text-white'
                          : v.gender === 'female'
                            ? 'bg-pink-500/10 text-pink-600 dark:text-pink-400'
                            : 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                      }`}
                    >
                      {v.gender === 'female' ? '女' : '男'}
                    </span>
                  </span>
                  {active && <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />}
                </div>
                <div className="flex items-center justify-between gap-1.5">
                  <span className={`truncate text-[11px] ${active ? 'text-white/80' : mutedText}`}>{v.label}</span>
                  <button
                    type="button"
                    aria-label={`试听声线${v.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      previewBuiltin(v.id);
                    }}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
                      active ? 'bg-white/25 text-white' : 'bg-black/[0.06] text-black/60 active:bg-black/[0.1] dark:bg-white/15 dark:text-white/75'
                    }`}
                  >
                    <AudioLines className={`h-3.5 w-3.5 ${playing ? 'animate-pulse' : ''}`} aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {builtinSupport === false && (
          <p className="mt-1.5 px-1 text-[12px] leading-relaxed text-[#FF3B30]">
            当前浏览器不支持内置语音试听；语音消息将自动回退其它方式，不影响文字聊天。
          </p>
        )}

        {/* 我的音色（设置 › 语音 API 保存的音色） */}
        <p className={`px-1 pb-1.5 pt-4 text-[12.5px] font-medium ${t.sms ? 'text-foreground/80' : 'text-black/55 dark:text-white/55'}`}>
          我的音色
        </p>
        {myVoices.length === 0 ? (
          <p className={`rounded-[12px] bg-black/[0.03] px-3 py-3 text-[12.5px] leading-relaxed ${mutedText} dark:bg-white/[0.06]`}>
            还没有保存的音色。到「设置 › 语音 API › 我的音色」添加（填名字 + 音色 ID，永久保存），这里就能点选。
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">{myVoices.map((v, i) => voiceChip(v.voiceId, v.name, `${testPrefix}-voice-my-${i}`, v.id))}</div>
        )}

        {/* API 音色（服务商拉取的列表；内置语音服务商没有） */}
        {ttsProvider !== 'builtin' && apiVoices.length > 0 && (
          <>
            <p className={`px-1 pb-1.5 pt-4 text-[12.5px] font-medium ${t.sms ? 'text-foreground/80' : 'text-black/55 dark:text-white/55'}`}>
              API 音色
            </p>
            <div className="flex flex-wrap gap-1.5">
              {apiVoices.map((v, i) => voiceChip(v.id, v.name, `${testPrefix}-voice-api-${i}`, v.id))}
            </div>
          </>
        )}

        <p className={t.captionCls}>
          音色立即生效：TA 的语音消息、语音气泡朗读、语音通话都用这里的音色。需要自定义音色就到「设置 › 语音 API › 我的音色」添加。
        </p>
      </div>
    </div>
  );
}
